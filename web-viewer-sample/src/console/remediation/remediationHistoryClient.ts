import { coordinatorUrl } from "../coordinatorClient";

export interface HistoryMember { id: string; ifc_guid: string; rule_code: string; status: "pass" | "fail" | "error" }
export interface HistoryGroup {
  run_id: string; model_version_id: string; ifc_guid: string; rule_code: string;
  rule_content_digest: string; anchor_id: string; members: HistoryMember[];
}
export interface HistoryItem {
  schema_version: "a1-remediation/v1"; id: string; issue_id: string; principal_ref: string;
  created_at: string; revision_before: number; revision_after: number; note: string;
  original: HistoryGroup; revised: HistoryGroup;
  actor_kind?: "external_authority" | "local_validation";
}
export interface HistoryPage {
  issue: { id: string; status: string; revision: number; model_version_id: string; ifc_guid: string; source_ref: string };
  items: HistoryItem[]; total: number; limit: number; offset: number; next_offset: number | null;
  access?: { actor_kind: "external_authority" | "local_validation" };
  original_run_id?: string;
}
export class HistoryClientError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = "HistoryClientError"; }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && value.trim() === value
    && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function invalid(): never { throw new HistoryClientError(200, "invalid_response"); }
function group(value: unknown): HistoryGroup {
  if (!object(value)) return invalid();
  const { run_id, model_version_id, ifc_guid, rule_code, rule_content_digest, anchor_id, members } = value;
  if (!id(run_id) || !id(model_version_id) || !id(ifc_guid) || !id(rule_code)
    || !id(rule_content_digest) || !id(anchor_id) || !Array.isArray(members) || !members.length) return invalid();
  const rows = members.map(member => {
    if (!object(member) || !id(member.id) || member.ifc_guid !== ifc_guid || member.rule_code !== rule_code
      || (member.status !== "pass" && member.status !== "fail" && member.status !== "error")) return invalid();
    return { id: member.id, ifc_guid, rule_code, status: member.status as HistoryMember["status"] };
  });
  if (!rows.some(row => row.id === anchor_id)) return invalid();
  return { run_id, model_version_id, ifc_guid, rule_code, rule_content_digest, anchor_id, members: rows };
}
function page(value: unknown, issueId: string, offset: number): HistoryPage {
  if (!object(value) || !object(value.issue)) return invalid();
  const issue = value.issue;
  if (issue.id !== issueId || !id(issue.model_version_id) || !id(issue.ifc_guid) || !id(issue.source_ref)
    || !integer(issue.revision) || typeof issue.status !== "string"
    || !["open", "assigned", "in_progress", "resolved", "rejected", "reopened"].includes(issue.status)) return invalid();
  const current = { id: issueId, status: issue.status, revision: issue.revision,
    model_version_id: issue.model_version_id, ifc_guid: issue.ifc_guid, source_ref: issue.source_ref };
  if (!integer(value.total) || value.limit !== 20 || value.offset !== offset || !Array.isArray(value.items)
    || value.items.length !== Math.min(20, Math.max(0, value.total - offset))) return invalid();
  const next = offset + value.items.length < value.total ? offset + value.items.length : null;
  if (value.next_offset !== next) return invalid();
  const items = value.items.map(item => {
    if (!object(item) || item.schema_version !== "a1-remediation/v1" || !id(item.id) || item.issue_id !== issueId
      || !id(item.principal_ref) || !id(item.created_at) || !Number.isFinite(Date.parse(item.created_at))
      || !integer(item.revision_before) || !integer(item.revision_after)
      || item.revision_after !== item.revision_before + 1 || item.revision_after > current.revision
      || typeof item.note !== "string" || item.note.length > 4000) return invalid();
    const original = group(item.original), revised = group(item.revised);
    if (original.model_version_id !== current.model_version_id || original.anchor_id !== current.source_ref
      || original.ifc_guid !== current.ifc_guid || revised.ifc_guid !== current.ifc_guid) return invalid();
    return { schema_version: "a1-remediation/v1" as const, id: item.id, issue_id: issueId,
      principal_ref: item.principal_ref, ...(item.actor_kind === "local_validation" || item.actor_kind === "external_authority" ? { actor_kind: item.actor_kind as HistoryItem["actor_kind"] } : {}),
      created_at: item.created_at, revision_before: item.revision_before,
      revision_after: item.revision_after, note: item.note, original, revised };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) return invalid();
  return { issue: current, items, total: value.total, limit: 20, offset, next_offset: next,
    ...(id(value.original_run_id) ? { original_run_id: value.original_run_id } : {}),
    ...(object(value.access) && ["external_authority", "local_validation"].includes(String(value.access.actor_kind))
      ? { access: { actor_kind: value.access.actor_kind as "external_authority" | "local_validation" } } : {}) };
}

/** Shape/correlation validation is not independent verification of historical PASS or authority. */
async function read(issueId: string, offset = 0, signal?: AbortSignal): Promise<HistoryPage> {
  if (!id(issueId) || !integer(offset)) throw new HistoryClientError(0, "invalid_request");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const check = () => { if (controller.signal.aborted) throw new HistoryClientError(0, "request_failed"); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 15000);
  try {
    check();
    const response = await fetch(coordinatorUrl(`/api/governance/issues/${encodeURIComponent(issueId)}/remediation-history?limit=20&offset=${offset}`), {
      method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error",
      headers: { Accept: "application/json" }, signal: controller.signal,
    });
    check();
    if (!response.ok) {
      // Do not read error details or wait on a potentially stalled stream cleanup.
      void response.body?.cancel().catch(() => {});
      throw new HistoryClientError(response.status, "request_failed");
    }
    let value: unknown;
    try { value = await response.json(); } catch { check(); return invalid(); }
    check();
    return page(value, issueId, offset);
  } catch (error) {
    if (error instanceof HistoryClientError) throw error;
    throw new HistoryClientError(0, "request_failed");
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort);
  }
}
export const remediationHistoryClient = { read };
