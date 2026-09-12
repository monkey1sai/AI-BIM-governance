import { afterEach, beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("./remediationHistoryClient", () => ({ remediationHistoryClient: { read } }));
const modules = import.meta.glob("./remediationCandidatesClient.ts");
const digest = "dsl-json-v1:sha256:" + "a".repeat(64);
const issue = { id: "i1", status: "in_progress", revision: 3, model_version_id: "v1", ifc_guid: "g1", source_ref: "a1" };
function run(id = "r1", version = "v1", passed = false) {
  return { rule_run_id: id, status: "succeeded", model_version_id: version, rule_set: "rules",
    source_metadata: { tenant_id: "t1", project_id: "p1", model_version_id: version },
    summary: { source_sha256: "b".repeat(64), rule_content_digest: digest, total: 1, passed: passed ? 1 : 0, failed: passed ? 0 : 1, errored: 0 } };
}
function rows(id = "r1", anchor = "a1", status = "fail") {
  return { rule_run_id: id, status_filter: null,
    results: [{ id: anchor, rule_run_id: id, ifc_guid: "g1", rule_code: "NAME", status, evidence_json: "private" }] };
}
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { read.mockReset().mockResolvedValue({ issue, items: [], total: 0, offset: 0, next_offset: null }); fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function response(value: unknown) { return new Response(JSON.stringify(value), { status: 200 }); }
async function client() {
  expect(modules["./remediationCandidatesClient.ts"], "candidate reader is implemented").toBeTypeOf("function");
  return (await modules["./remediationCandidatesClient.ts"]() as typeof import("./remediationCandidatesClient")).remediationCandidatesClient;
}
async function original() {
  const api = await client();
  fetcher.mockResolvedValueOnce(response(run())).mockResolvedValueOnce(response(rows()));
  return { api, context: await api.loadOriginal("i1", "r1") };
}
it("binds authorized Issue to original fail and projects away private fields", async () => {
  const { context } = await original();
  expect(context.issue.revision).toBe(3); expect(context.original.anchor_id).toBe("a1");
  expect(context.projectId).toBe("p1"); expect(JSON.stringify(context)).not.toContain("private");
  expect(fetcher.mock.calls[0][0]).toContain("/api/governance/rule-runs/r1");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", redirect: "error", cache: "no-store" });
});
it("does not read runs when history authorization denies access", async () => {
  const api = await client(); read.mockRejectedValue({ status: 403 });
  await expect(api.loadOriginal("i1", "r1")).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(["other-run", "other-version", "other-anchor", "not-fail", "duplicate", "bad-count"])("rejects original evidence %s", async kind => {
  const api = await client(), r = run(), result = rows();
  if (kind === "other-run") result.rule_run_id = "r-other";
  if (kind === "other-version") r.model_version_id = "v-other";
  if (kind === "other-anchor") result.results[0].id = "another-anchor";
  if (kind === "not-fail") result.results[0].status = "pass";
  if (kind === "duplicate") result.results.push(result.results[0]);
  if (kind === "bad-count") r.summary.total = 2;
  fetcher.mockResolvedValueOnce(response(r)).mockResolvedValueOnce(response(result));
  await expect(api.loadOriginal("i1", "r1")).rejects.toMatchObject({ code: "evidence_unavailable" });
});
it("paginates project runs even when this page has no compatible candidates", async () => {
  const { api, context } = await original();
  fetcher.mockResolvedValueOnce(response({ filters: { project_id: "p1" }, limit: 20, offset: 0, total: 21,
    items: Array.from({ length: 20 }, (_, n) => ({ ...run("old" + n), status: "running" })) }));
  const page = await api.list(context, 0);
  expect(page.items).toEqual([]); expect(page.nextOffset).toBe(20);
  expect(fetcher.mock.calls[2][0]).toContain("project_id=p1&limit=20&offset=0");
});
it("rejects a page from another project before showing its candidates", async () => {
  const { api, context } = await original();
  fetcher.mockResolvedValueOnce(response({ filters: { project_id: "p2" }, limit: 20, offset: 0, total: 0, items: [] }));
  await expect(api.list(context, 0)).rejects.toMatchObject({ code: "evidence_unavailable" });
});
it("selects only a different version with a complete matching PASS group", async () => {
  const { api, context } = await original();
  fetcher.mockResolvedValueOnce(response(run("r2", "v2", true))).mockResolvedValueOnce(response(rows("r2", "a2", "pass")));
  const selected = await api.select(context, "r2");
  expect(selected.model_version_id).toBe("v2"); expect(selected.members).toEqual([{ id: "a2", ifc_guid: "g1", rule_code: "NAME", status: "pass" }]);
});
it.each(["project", "version", "digest", "guid", "rule", "fail", "count", "result-run"])("rejects revised mismatch %s", async kind => {
  const { api, context } = await original(), r = run("r2", "v2", true), result = rows("r2", "a2", "pass");
  if (kind === "project") r.source_metadata.project_id = "p2";
  if (kind === "version") r.model_version_id = "v1";
  if (kind === "digest") r.summary.rule_content_digest = "dsl-json-v1:sha256:" + "b".repeat(64);
  if (kind === "guid") result.results[0].ifc_guid = "g2";
  if (kind === "rule") result.results[0].rule_code = "OTHER";
  if (kind === "fail") result.results[0].status = "fail";
  if (kind === "count") r.summary.passed = 2;
  if (kind === "result-run") result.results[0].rule_run_id = "wrong";
  fetcher.mockResolvedValueOnce(response(r)).mockResolvedValueOnce(response(result));
  await expect(api.select(context, "r2")).rejects.toMatchObject({ code: "evidence_unavailable" });
});
it("does not expose backend error body", async () => {
  const api = await client(); fetcher.mockResolvedValue(response("sensitive"));
  await expect(api.loadOriginal("i1", "r1")).rejects.toMatchObject({ message: "evidence_unavailable" });
});
it.each(["tenant-missing", "tenant-mismatch", "sha-missing", "sha-invalid"])("excludes invalid source-bound candidates: %s", async kind => {
  const { api, context } = await original(), candidate = run("r2", "v2", true);
  if (kind === "tenant-missing") candidate.source_metadata.tenant_id = "";
  if (kind === "tenant-mismatch") candidate.source_metadata.tenant_id = "t2";
  if (kind === "sha-missing") candidate.summary.source_sha256 = "";
  if (kind === "sha-invalid") candidate.summary.source_sha256 = "not-sha256";
  fetcher.mockResolvedValueOnce(response({ filters: { project_id: "p1" }, limit: 20, offset: 0, total: 1, items: [candidate] }));
  expect((await api.list(context)).items).toEqual([]);
  fetcher.mockResolvedValueOnce(response(candidate));
  await expect(api.select(context, "r2")).rejects.toMatchObject({ code: "evidence_unavailable" });
});
it("excludes consumed runs across every history page from listing and direct selection", async () => {
  const items = Array.from({ length: 20 }, (_, n) => ({ revised: { run_id: "used" + n } }));
  read.mockResolvedValueOnce({ issue, items, total: 21, offset: 0, next_offset: 20 })
    .mockResolvedValueOnce({ issue, items: [{ revised: { run_id: "r2" } }], total: 21, offset: 20, next_offset: null });
  const { api, context } = await original();
  expect(read).toHaveBeenCalledTimes(2);
  fetcher.mockResolvedValueOnce(response({ filters: { project_id: "p1" }, limit: 20, offset: 0, total: 2,
    items: [run("r2", "v2", true), run("r3", "v3", true)] }));
  expect((await api.list(context)).items.map(item => item.id)).toEqual(["r3"]);
  fetcher.mockResolvedValueOnce(response(run("r2", "v2", true))).mockResolvedValueOnce(response(rows("r2", "a2", "pass")));
  await expect(api.select(context, "r2")).rejects.toMatchObject({ code: "evidence_unavailable" });
});
it("rejects a history revision change between pages", async () => {
  read.mockResolvedValueOnce({ issue, items: [], total: 21, offset: 0, next_offset: 20 })
    .mockResolvedValueOnce({ issue: { ...issue, revision: 4 }, items: [], total: 21, offset: 20, next_offset: null });
  await expect(original()).rejects.toMatchObject({ code: "evidence_unavailable" });
});
it("honors an already aborted read without fetching", async () => {
  const api = await client(), controller = new AbortController(); controller.abort();
  await expect(api.loadOriginal("i1", "r1", controller.signal)).rejects.toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
it("discards a body received after cancellation", async () => {
  const api = await client(), controller = new AbortController();
  let resolve!: (value: unknown) => void;
  const json = vi.fn().mockReturnValue(new Promise(r => { resolve = r; }));
  fetcher.mockResolvedValue({ ok: true, json });
  const promise = api.loadOriginal("i1", "r1", controller.signal);
  await vi.waitFor(() => expect(json).toHaveBeenCalled());
  controller.abort(); resolve(run());
  await expect(promise).rejects.toMatchObject({ code: "request_failed" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("times out fetch with a safe error and no retry", async () => {
  const api = await client(); vi.useFakeTimers();
  fetcher.mockImplementation((_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("private endpoint details")));
  }));
  const promise = api.loadOriginal("i1", "r1");
  const expected = expect(promise).rejects.toMatchObject({ message: "request_failed" });
  await vi.advanceTimersByTimeAsync(15000); await expected; expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not consume a sensitive non-success body", async () => {
  const api = await client(), json = vi.fn(), cancel = vi.fn().mockRejectedValue(new Error("private"));
  fetcher.mockResolvedValue({ ok: false, status: 503, json, body: { cancel } });
  await expect(api.loadOriginal("i1", "r1")).rejects.toMatchObject({ status: 503, message: "request_failed" });
  expect(json).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
});
