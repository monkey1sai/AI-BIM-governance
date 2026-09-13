import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Request } from "express";
import { z } from "zod";

const id = z.string().min(1).max(512).refine(s => s === s.trim() && !/[\u0000-\u001f\u007f]/.test(s));
const source = z.object({ model_version_id: id, run_id: id, source_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const remediationCase = z.object({
  issue_id: id, tenant_id: id, project_id: id, ifc_guid: id, rule_code: id,
  original: source, revised: source, correspondence_ref: id,
}).strict().refine(c => c.original.run_id !== c.revised.run_id && c.original.model_version_id !== c.revised.model_version_id);
const operation = z.enum(["confirm", "history", "reopen"]);
const decision = z.object({
  principal_ref: id, actor_kind: z.enum(["external_authority", "local_validation"]),
  authorization_ref: id, expires_at_ms: z.number().int().positive(),
  cases: z.array(remediationCase).min(1).max(32),
}).strict();
export type RemediationOperation = z.infer<typeof operation>;
export type RemediationDecision = z.infer<typeof decision>;
export interface RemediationTarget { issueId: string; operation: RemediationOperation }
/** Authenticate the current operator and resolve current exact source/run correspondence.
 * Deployment-owned port only: neither report preview, intake tokens, browser roles nor
 * rule-run metadata are a mutation grant. correspondence_ref MUST be stable for a pair.
 */
export type RemediationAccess = (request: Request, target: RemediationTarget, signal: AbortSignal) => Promise<RemediationDecision | null>;
export class RemediationAccessError extends Error {
  constructor(readonly status: 403 | 503) { super("Remediation authorization unavailable or denied."); }
}
export async function resolveRemediationAccess(access: RemediationAccess | undefined, request: Request,
  target: RemediationTarget, allowLocal = false): Promise<RemediationDecision> {
  if (!access) throw new RemediationAccessError(503);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new RemediationAccessError(503)); }, 5000);
    });
    const parsed = decision.safeParse(await Promise.race([access(request, target, controller.signal), timeout]));
    if (!parsed.success || parsed.data.expires_at_ms <= Date.now() ||
        parsed.data.cases.some(c => c.issue_id !== target.issueId) ||
        (parsed.data.actor_kind === "local_validation" && !allowLocal)) throw new RemediationAccessError(403);
    return parsed.data;
  } catch (error) {
    if (error instanceof RemediationAccessError) throw error;
    throw new RemediationAccessError(503);
  } finally { clearTimeout(timer); controller.abort(); }
}

const localCase = z.object({
  issue_id: id, tenant_id: id, project_id: id, ifc_guid: id, rule_code: id,
  original: source, revised: source, operations: z.array(operation).min(1).max(3),
}).strict();
const localPolicy = z.object({ version: z.literal(1), expires_at_ms: z.number().int().positive(),
  cases: z.array(localCase).min(1).max(1000) }).strict();
const loopback = (value: string | undefined) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(value ?? "");

/** Explicit, isolated local validation only; trusts local process access, not a human identity.
 * Registry is written by the owner outside HTTP, after checking actual IFC hashes and run IDs.
 * Read afresh on every request. No ledger enumeration or client-supplied grant scope.
 */
export function createLocalRemediationAccess(listener: () => AddressInfo | string | null,
  policyPath: string, viewerOrigin: string): RemediationAccess {
  return async (request, target, signal) => {
    const bound = listener();
    if (process.env.NODE_ENV === "production" || !bound || typeof bound === "string" ||
        !loopback(bound.address) || bound.port !== request.socket.localPort ||
        !loopback(request.socket.localAddress) || !loopback(request.socket.remoteAddress)) return null;
    const headers = new Map<string, string[]>();
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      const name = request.rawHeaders[i].toLowerCase();
      if (name === "forwarded" || name.startsWith("x-forwarded-")) return null;
      headers.set(name, [...(headers.get(name) ?? []), request.rawHeaders[i + 1]]);
    }
    const hosts = headers.get("host") ?? [], origins = headers.get("origin") ?? [];
    const sites = headers.get("sec-fetch-site") ?? [];
    if (hosts.length !== 1 || origins.length > 1 || sites.length > 1 ||
        !["127.0.0.1", "localhost", "[::1]"].some(host => hosts[0] === `${host}:${bound.port}`) ||
        (sites.length === 1 && !["same-origin", "same-site", "none"].includes(sites[0]))) return null;
    const allowedOrigins = [`http://${hosts[0]}`, viewerOrigin];
    if (origins.length && !allowedOrigins.includes(origins[0])) return null;
    if (target.operation !== "history" && (request.method !== "POST" || origins.length !== 1 ||
        (headers.get("x-a1-intent") ?? []).length !== 1 || request.get("x-a1-intent") !== target.operation)) return null;
    if (target.operation === "history" && request.method !== "GET") return null;
    const raw = await readFile(policyPath, { encoding: "utf8", signal });
    if (Buffer.byteLength(raw) > 1_048_576) return null;
    const policy = localPolicy.parse(JSON.parse(raw));
    if (policy.expires_at_ms <= Date.now() || policy.expires_at_ms > Date.now() + 86_400_000) return null;
    const cases = policy.cases.filter(c => c.issue_id === target.issueId && c.operations.includes(target.operation)).map(c => {
      const { operations: _operations, ...identity } = c;
      // Stable across reopen/retry and policy rewrites; never use a new random reference.
      const correspondence_ref = `source-pair:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
      return { ...identity, correspondence_ref };
    });
    if (!cases.length || cases.some(c => c.tenant_id !== "tenant_library_validation" ||
        c.project_id !== "project_library_validation" ||
        c.original.model_version_id !== "24e598ab-be3d-4dbb-a1aa-60b0ba610618" ||
        c.original.source_sha256 !== "8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce")) return null;
    return { principal_ref: "local-library-validation", actor_kind: "local_validation",
      authorization_ref: "owner-local-library-policy", expires_at_ms: policy.expires_at_ms, cases };
  };
}
