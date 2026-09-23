// GovernanceIssuePort over governance-service's existing `/api/issues` (loopback; the coordinator is the only caller
// for CFD findings, no new governance route). `GOVERNANCE_API_BASE` is resolved on every call, as the governance-library
// adapter does (docs/architecture/cfd-run-workflow-adr.md §3). Error messages are the ones the finding route has always
// reported as the `governance_unavailable` detail.
import { resolveGovernanceApiBase } from "../governanceLibraryHttpAdapter.js";
import type { CfdFindingIssuePayload } from "./findingIssuePayload.js";
import type { GovernanceIssuePort, GovernanceIssueRef } from "./workflow.js";

const TIMEOUT_MS = 5000;

export class GovernanceIssueHttpAdapter implements GovernanceIssuePort {
  async findAnnotation(query: { title: string; usdPrimPath: string; modelVersionId: string | null }): Promise<GovernanceIssueRef | null> {
    const params = new URLSearchParams({ kind: "annotation" });
    if (query.modelVersionId) params.set("model_version_id", query.modelVersionId);
    const reply = await fetch(`${resolveGovernanceApiBase()}/api/issues?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!reply.ok) throw new Error(`governance GET /api/issues HTTP ${reply.status}`);
    const body = (await reply.json()) as { issues?: Array<Record<string, unknown>> };
    const match = (body.issues ?? []).find((issue) => issue.usd_prim_path === query.usdPrimPath && issue.title === query.title
      && (issue.model_version_id ?? null) === query.modelVersionId);
    return match && typeof match.id === "string" ? { id: match.id, kind: typeof match.kind === "string" ? match.kind : "annotation" } : null;
  }

  async createIssue(payload: CfdFindingIssuePayload): Promise<GovernanceIssueRef> {
    const reply = await fetch(`${resolveGovernanceApiBase()}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (reply.status !== 201 && reply.status !== 200) {
      const detail = await reply.text().catch(() => "");
      throw new Error(`governance POST /api/issues HTTP ${reply.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }
    const body = (await reply.json()) as { id?: unknown; kind?: unknown };
    if (typeof body.id !== "string" || !body.id) throw new Error("governance issue reply carries no id");
    return { id: body.id, kind: typeof body.kind === "string" ? body.kind : "annotation" };
  }
}
