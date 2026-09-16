import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { A1GovernanceWorkbenchPage } from "./A1GovernanceWorkbenchPage";
import { A1OutboxStatus } from "./A1OutboxStatus";
import { initialA1State, type A1State } from "./a1Machine";
import { useRuleRun } from "./hooks/useRuleRun";
import { governanceClient, type IssueRow } from "./governanceClient";
import { coordinatorClient, type CallbackOutboxSummaryEntry } from "./coordinatorClient";

vi.mock("./hooks/useRuleRun");
vi.mock("./ReadyReviewSessions", () => ({ ReadyReviewSessions: () => null }));
vi.mock("./ClosedSessionRecovery", () => ({ ClosedSessionRecovery: () => null }));
vi.mock("./EmbeddedViewer", async () => ({ EmbeddedViewer: (await import("react")).forwardRef(() => null) }));
let root: Root, host: HTMLDivElement, state: A1State;
const dispatch = vi.fn();
const versionA = "圖書館/建築/原版 A.ifc";
const issue = (version: string): IssueRow => ({ id: version, kind: "issue", title: version, status: "open", severity: "error", ifc_guid: "0AAAAAAAAAAAAAAAAAAAAA", usd_prim_path: null, source_type: "rule_result", model_version_id: version });
const receipt = (overrides: Partial<CallbackOutboxSummaryEntry> = {}): CallbackOutboxSummaryEntry => ({
  outbox_id: "cbk_a", event: "issue_snapshot", correlation_id: "review_session_a", conversion_job_id: null,
  status: "pending", attempts: 0, max_attempts: 5, last_error: null, created_at: "2026-09-13T00:00:00Z", delivered_at: null, ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const button = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
const render = async () => { await act(async () => { root.render(<A1GovernanceWorkbenchPage />); }); };
const click = async (id: string) => { await act(async () => { button(id).click(); }); };
const selectState = (version: string) => {
  state = { ...initialA1State, step: "issued", issuesCreated: true, ifcPath: `library://${version}`, modelVersionId: version,
    run: { rule_run_id: `rr_${version}`, status: "succeeded", score: 90, rule_set: "default", model_version_id: version, summary: { total: 2, passed: 1, failed: 1, errored: 0, target_summary: {}, warnings: [] } } };
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  dispatch.mockClear(); selectState(versionA);
  vi.mocked(useRuleRun).mockImplementation(() => ({ state, dispatch, runId: state.run?.rule_run_id ?? null, run: vi.fn() }));
  vi.spyOn(coordinatorClient, "getTestDataProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(coordinatorClient, "runtimeStatus").mockRejectedValue(new Error("test has no runtime"));
  vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({ bucket: null, count: 0, objects: [] });
  vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
  vi.spyOn(governanceClient, "filesTree").mockResolvedValue({ root: "", source_kind: "local_fs", projects: [] });
  vi.spyOn(governanceClient, "listRuleRuns").mockResolvedValue({ filters: {}, limit: 5, offset: 0, total: 0, items: [] });
  vi.spyOn(governanceClient, "listIssues").mockResolvedValue([issue(versionA), issue("other_version")]);
  vi.spyOn(governanceClient, "issuesFromRuleRun").mockResolvedValue({ created: 2, issue_ids: [versionA, "other_version"] });
  vi.spyOn(governanceClient, "getIssue").mockImplementation(async id => issue(id));
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new Blob(["test-bytes"]))));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const realClick = HTMLElement.prototype.click;
  vi.spyOn(HTMLElement.prototype, "click").mockImplementation(function (this: HTMLElement) {
    if (this instanceof HTMLAnchorElement && this.download) return;
    realClick.call(this);
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([versionA, ` ${versionA} `])("BCF 原樣傳送成功 run 的 opaque 版本 %s", async version => {
  selectState(version);
  vi.mocked(governanceClient.issuesFromRuleRun).mockResolvedValue({ created: 2, issue_ids: [version, "other_version"] });
  await render(); await click("a1-step-issues");
  expect(button("a1-step-bcf").disabled).toBe(false);
  await click("a1-step-bcf");
  expect(fetch).toHaveBeenCalledWith(governanceClient.bcfExportUrl({ model_version_id: version }));
  expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get("model_version_id")).toBe(version);
  expect(dispatch).toHaveBeenCalledWith({ type: "BCF_EXPORT_OK" });
  expect(host.textContent).toContain("other_version");
});

it.each([null, "  ", "version_without_issues"])("BCF 缺可信版本或同版本問題 %s 時拒絕匯出", async version => {
  state.run = { ...state.run!, model_version_id: version };
  await render(); await click("a1-step-issues");
  expect(button("a1-step-bcf").disabled).toBe(true);
  await click("a1-step-bcf"); expect(fetch).not.toHaveBeenCalled();
});

it.each(["export", "bcf"])("%s 讀 blob 期間 A→B→A，不能下載舊檔或標成功", async action => {
  const blob = deferred<Blob>();
  vi.mocked(fetch).mockResolvedValue({ ok: true, blob: () => blob.promise } as Response);
  await render(); await click("a1-step-issues"); await click(`a1-step-${action}`);
  expect(button(`a1-step-${action}`).disabled).toBe(true);
  selectState("other_version"); await render(); selectState(versionA); await render();
  await act(async () => blob.resolve(new Blob(["stale"])));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalledWith({ type: action === "bcf" ? "BCF_EXPORT_OK" : "EXPORT_OK" });
});

it.each(["export", "bcf"])("%s 舊失敗/finally 不顯示錯誤、不解除新請求 busy；新請求可成功", async action => {
  const old = deferred<Response>(), next = deferred<Response>();
  vi.mocked(fetch).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await render(); await click("a1-step-issues"); await click(`a1-step-${action}`);
  selectState("other_version"); await render(); await click(`a1-step-${action}`);
  await act(async () => old.reject(new Error("old-source-failure")));
  expect(host.textContent).not.toContain("old-source-failure");
  expect(button(`a1-step-${action}`).disabled).toBe(true);
  await act(async () => next.resolve(new Response(new Blob(["current"]))));
  expect(button(`a1-step-${action}`).disabled).toBe(false);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});

it("目前來源匯出失敗可重試，雙擊只送一次", async () => {
  const response = deferred<Response>(); vi.mocked(fetch).mockReturnValueOnce(response.promise);
  await render(); await act(async () => { button("a1-step-export").click(); button("a1-step-export").click(); });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => response.resolve(new Response("unavailable", { status: 503 })));
  expect(host.textContent).toContain("HTTP 503");
  expect(dispatch).not.toHaveBeenCalledWith({ type: "EXPORT_OK" });
  await click("a1-step-export");
  expect(host.textContent).not.toContain("HTTP 503");
  expect(dispatch).toHaveBeenCalledWith({ type: "EXPORT_OK" });
});

it.each([
  [receipt(), "尚未確認送達"],
  [receipt({ status: "delivered", delivered_at: "2026-09-13T01:00:00Z" }), "接收端已回應成功"],
  [receipt({ status: "dead_letter", attempts: 5 }), "投遞次數已耗盡"],
  [receipt({ status: "delivered", delivered_at: null }), "遞送紀錄不完整"],
  [receipt({ status: "delivered", delivered_at: "invalid" }), "遞送紀錄不完整"],
  [receipt({ outbox_id: "cbk_other", status: "delivered" }), "結果未知"],
  [receipt({ correlation_id: "review_session_b", status: "delivered" }), "結果未知"],
  [receipt({ event: "conversion_result_ready", status: "delivered" }), "結果未知"],
] as const)("outbox 只呈現精確身分及有證據的狀態 %j", async (entry, label) => {
  vi.spyOn(coordinatorClient, "getCallbackOutboxSummary").mockResolvedValue({ total: 201, limit: 200, entries: [{ ...entry, last_error: "callback_delivery_failed" }] });
  await act(async () => root.render(<A1OutboxStatus outboxId="cbk_a" sessionId="review_session_a" />));
  expect(host.textContent).toContain(label);
  expect(host.textContent).not.toContain("synthetic-internal-token");
});

it("outbox 查詢失敗可重試；切換身分後舊 summary 不覆寫", async () => {
  const old = deferred<Awaited<ReturnType<typeof coordinatorClient.getCallbackOutboxSummary>>>();
  const summary = vi.spyOn(coordinatorClient, "getCallbackOutboxSummary").mockRejectedValueOnce(new Error("private-error"));
  await act(async () => root.render(<A1OutboxStatus outboxId="cbk_a" sessionId="review_session_a" />));
  expect(host.textContent).toContain("無法取得遞送狀態");
  summary.mockReturnValueOnce(old.promise);
  await act(async () => host.querySelector("button")!.click());
  summary.mockResolvedValueOnce({ total: 0, limit: 200, entries: [] });
  await act(async () => root.render(<A1OutboxStatus outboxId="cbk_b" sessionId="review_session_b" />));
  await act(async () => old.resolve({ total: 1, limit: 200, entries: [receipt({ status: "delivered", delivered_at: "2026-09-13T01:00:00Z" })] }));
  expect(host.textContent).toContain("結果未知");
  expect(host.textContent).not.toContain("接收端已回應成功");
});
