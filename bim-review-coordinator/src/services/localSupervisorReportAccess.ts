import type { AddressInfo } from "node:net";
import type { ValidationReportAccess, ValidationReportSource } from "./validationReportAccess.js";

// Owner-approved validation fixture only. Never infer additional grants from the ledger or request.
const library: Readonly<ValidationReportSource> = Object.freeze({
  tenantId: "tenant_library_validation",
  projectId: "project_library_validation",
  modelVersionId: "24e598ab-be3d-4dbb-a1aa-60b0ba610618",
  readyModelId: "mw_library_validation",
  sourceSha256: "8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce",
});
const loopback = (address: string | undefined) =>
  address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

/** Trusts local process access, NOT a human identity. Only wired to report GET handlers. */
export function createLocalSupervisorReportAccess(
  listener: () => AddressInfo | string | null,
): ValidationReportAccess {
  return async (request, _target, signal) => {
    const bound = listener();
    if (signal.aborted || request.method !== "GET" || !bound || typeof bound === "string" ||
        !loopback(bound.address) || bound.port !== request.socket.localPort ||
        !loopback(request.socket.localAddress) || !loopback(request.socket.remoteAddress)) return null;
    const headers = new Map<string, string[]>();
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      const name = request.rawHeaders[i].toLowerCase(), value = request.rawHeaders[i + 1];
      if (name === "forwarded" || name.startsWith("x-forwarded-")) return null;
      headers.set(name, [...(headers.get(name) ?? []), value]);
    }
    const hosts = headers.get("host") ?? [], origins = headers.get("origin") ?? [];
    const sites = headers.get("sec-fetch-site") ?? [];
    if (hosts.length !== 1 || origins.length > 1 || sites.length > 1 ||
        !["127.0.0.1", "localhost", "[::1]"].some(host => hosts[0] === host + ":" + bound.port) ||
        (origins.length === 1 && origins[0] !== "http://" + hosts[0]) ||
        (sites.length === 1 && !["same-origin", "none"].includes(sites[0]))) return null;
    return {
      subject: "local-supervisor-preview", actorKind: "local_supervisor_preview",
      expiresAt: new Date(Date.now() + 300_000).toISOString(), sources: [{ ...library }],
    };
  };
}
