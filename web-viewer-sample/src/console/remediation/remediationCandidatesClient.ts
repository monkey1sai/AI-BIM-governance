import { coordinatorUrl } from "../coordinatorClient";
import { remediationHistoryClient, type HistoryGroup, type HistoryPage, type HistoryMember } from "./remediationHistoryClient";

export interface OriginalContext { issue: HistoryPage["issue"]; original: HistoryGroup; projectId: string; access?: HistoryPage["access"] }
export interface CandidateRun { id: string; version: string; finishedAt: string | null }
export interface CandidatePage { items: CandidateRun[]; offset: number; nextOffset: number | null }
export class CandidatesError extends Error {
  constructor(readonly code = "evidence_unavailable", readonly status = 0) { super(code); this.name = "CandidatesError"; }
}
function invalid(): never { throw new CandidatesError(); }
function object(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function id(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 512 && v.trim() === v
    && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}
function integer(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= 0; }
function check(signal?: AbortSignal) { if (signal?.aborted) throw new CandidatesError("request_failed"); }
async function get(path: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 15000);
  try {
    check(controller.signal);
    const response = await fetch(coordinatorUrl("/api/governance/" + path), {
      method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error",
      headers: { Accept: "application/json" }, signal: controller.signal,
    });
    check(controller.signal);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new CandidatesError("request_failed", response.status);
    }
    const value: unknown = await response.json(); check(controller.signal); return value;
  } catch (error) {
    if (error instanceof CandidatesError) throw error;
    throw new CandidatesError("request_failed");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
function verifiedRun(value: unknown, runId: string) {
  if (!object(value) || value.rule_run_id !== runId || value.status !== "succeeded"
    || !id(value.model_version_id) || !object(value.source_metadata) || !object(value.summary)) return invalid();
  const meta = value.source_metadata, summary = value.summary;
  if (!id(meta.project_id) || meta.model_version_id !== value.model_version_id
    || typeof summary.rule_content_digest !== "string"
    || !/^(dsl-json-v1|ids-xml-v1):sha256:[0-9a-f]{64}$/.test(summary.rule_content_digest)
    || !integer(summary.total) || !integer(summary.passed) || !integer(summary.failed) || !integer(summary.errored)
    || summary.total !== summary.passed + summary.failed + summary.errored) return invalid();
  return { id: runId, version: value.model_version_id, projectId: meta.project_id,
    digest: summary.rule_content_digest, total: summary.total, passed: summary.passed, failed: summary.failed, errored: summary.errored };
}
type Run = ReturnType<typeof verifiedRun>;
function resultGroup(value: unknown, run: Run, guid: string, rule?: string, anchorId?: string): HistoryGroup {
  if (!object(value) || value.rule_run_id !== run.id || value.status_filter !== null
    || !Array.isArray(value.results) || value.results.length !== run.total) return invalid();
  const rows = value.results.map(row => {
    if (!object(row) || !id(row.id) || row.rule_run_id !== run.id || !id(row.rule_code)
      || (row.ifc_guid !== null && !id(row.ifc_guid))
      || !["pass", "fail", "error"].includes(String(row.status))) return invalid();
    return { id: row.id, ifc_guid: row.ifc_guid as string | null, rule_code: row.rule_code, status: row.status as HistoryMember["status"] };
  });
  if (new Set(rows.map(r => r.id)).size !== rows.length
    || rows.filter(r => r.status === "pass").length !== run.passed
    || rows.filter(r => r.status === "fail").length !== run.failed
    || rows.filter(r => r.status === "error").length !== run.errored) return invalid();
  const anchor = anchorId ? rows.find(r => r.id === anchorId) : undefined;
  const ruleCode = rule ?? anchor?.rule_code;
  if (!ruleCode || (anchorId && (!anchor || anchor.ifc_guid !== guid || anchor.status !== "fail"))
    || rows.some(r => r.rule_code === ruleCode && !r.ifc_guid)) return invalid();
  const members: HistoryMember[] = rows.filter(r => r.ifc_guid === guid && r.rule_code === ruleCode)
    .map(r => ({ ...r, ifc_guid: guid }));
  if (!members.length) return invalid();
  return { run_id: run.id, model_version_id: run.version, ifc_guid: guid, rule_code: ruleCode,
    rule_content_digest: run.digest, anchor_id: anchorId ?? members[0].id, members };
}
async function loadOriginal(issueId: string, originalRunId?: string, signal?: AbortSignal): Promise<OriginalContext> {
  if (!id(issueId) || (originalRunId !== undefined && !id(originalRunId))) return invalid();
  check(signal);
  const history = await remediationHistoryClient.read(issueId, 0, signal); check(signal);
  originalRunId = originalRunId ?? history.original_run_id;
  if (!id(originalRunId)) return invalid();
  const run = verifiedRun(await get("rule-runs/" + encodeURIComponent(originalRunId), signal), originalRunId);
  if (run.version !== history.issue.model_version_id) return invalid();
  const original = resultGroup(await get("rule-runs/" + encodeURIComponent(originalRunId) + "/results", signal),
    run, history.issue.ifc_guid, undefined, history.issue.source_ref);
  return { issue: history.issue, projectId: run.projectId, original, access: history.access };
}
function compatible(run: Run, context: OriginalContext) {
  return run.projectId === context.projectId && run.id !== context.original.run_id
    && run.version !== context.issue.model_version_id && run.digest === context.original.rule_content_digest;
}
async function list(context: OriginalContext, offset = 0, signal?: AbortSignal): Promise<CandidatePage> {
  if (!id(context.projectId) || !integer(offset)) return invalid();
  const query = new URLSearchParams({ project_id: context.projectId, limit: "20", offset: String(offset) });
  const value = await get("rule-runs?" + query.toString(), signal);
  if (!object(value) || !object(value.filters) || value.filters.project_id !== context.projectId
    || value.limit !== 20 || value.offset !== offset || !integer(value.total) || !Array.isArray(value.items)
    || value.items.length !== Math.min(20, Math.max(0, value.total - offset))) return invalid();
  const seen = new Set<string>(), items: CandidateRun[] = [];
  for (const row of value.items) {
    if (!object(row) || !id(row.rule_run_id) || seen.has(row.rule_run_id)) return invalid();
    seen.add(row.rule_run_id);
    // Old/incomplete runs remain non-selectable; they are not evidence failures of the current Issue.
    let run: Run;
    try { run = verifiedRun(row, row.rule_run_id); } catch { continue; }
    if (compatible(run, context)) items.push({ id: run.id, version: run.version,
      finishedAt: typeof row.finished_at === "string" && Number.isFinite(Date.parse(row.finished_at)) ? row.finished_at : null });
  }
  return { items, offset, nextOffset: offset + value.items.length < value.total ? offset + value.items.length : null };
}
async function select(context: OriginalContext, runId: string, signal?: AbortSignal): Promise<HistoryGroup> {
  if (!id(runId)) return invalid();
  const run = verifiedRun(await get("rule-runs/" + encodeURIComponent(runId), signal), runId);
  if (!compatible(run, context)) return invalid();
  const group = resultGroup(await get("rule-runs/" + encodeURIComponent(runId) + "/results", signal),
    run, context.issue.ifc_guid, context.original.rule_code);
  if (group.members.length !== context.original.members.length || group.members.some(r => r.status !== "pass")) return invalid();
  return group;
}
// Display consistency only. The confirmation transaction independently verifies current source access and evidence.
export const remediationCandidatesClient = { loadOriginal, list, select };
