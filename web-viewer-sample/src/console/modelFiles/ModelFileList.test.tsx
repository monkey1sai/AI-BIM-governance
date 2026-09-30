import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fx } from "../__testdata__/contractFixtures";
import { CoordinatorHttpError, coordinatorClient, type ConversionRecord, type RuntimeSessionSummary, type RuntimeStatus } from "../coordinatorClient";
import { ModelFileList } from "./ModelFileList";

const MW = "mw_0123456789abcdef";
const SESSION_ID = "review_session_existing";
const session: RuntimeSessionSummary = fx.runtimeSessionSummary({ ready_model_id: MW, session_id: SESSION_ID, status: "created", project_id: "project-a", model_version_id: "v1", created_at: "2026-09-20T00:00:00.000Z", updated_at: "2026-09-20T00:00:00.000Z" });
const minioRecord: ConversionRecord = fx.conversionRecord({
  idempotency_key: MW, project_id: "project-a", project_display_name: "Project A", category: "architecture", external_model_version_id: "v1",
  status: "ready", source_ifc_filename: "model.ifc",
  sessions: [{ session_id: SESSION_ID, status: "created", created_at: "2026-09-20T00:00:00.000Z", updated_at: "2026-09-20T00:00:00.000Z", link: "ready_model" }],
});
const devRecord: ConversionRecord = fx.conversionRecord({
  idempotency_key: "idem_devreg_1", project_id: "project_real_ifc_demo", project_display_name: "project_real_ifc_demo", category: "", external_model_version_id: "mv_realifc_1",
  status: "ready", source_ifc_filename: "villa.ifc", sessions: [],
});
const response = { ready_model_id: MW, review_session_id: SESSION_ID, session_status: "created" as const, session_replay: false };

function Harness({ onSelected, onModelsReloaded, currentSessionId }: { onSelected: (s: RuntimeSessionSummary) => void; onModelsReloaded?: () => void; currentSessionId?: string }) {
  const [sessions, setSessions] = useState([session]);
  return <ModelFileList sessions={sessions} onSessionsRefreshed={setSessions} onSelected={onSelected} onModelsReloaded={onModelsReloaded} currentSessionId={currentSessionId} />;
}

describe("ModelFileList", () => {
  let container: HTMLDivElement; let root: Root;
  const selected = vi.fn();
  const reloaded = vi.fn();
  const q = <T extends Element>(id: string) => container.querySelector<T>(`[data-testid="${id}"]`);
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear(); selected.mockReset(); reloaded.mockReset();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 2, items: [minioRecord, devRecord] });
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [session] } } as RuntimeStatus);
    vi.spyOn(coordinatorClient, "listIfcSources").mockResolvedValue({ items: [
      { source_id: "src_villa", filename: "villa.ifc", relative_path: "villa.ifc", size_bytes: 1, modified_at: "" },
      { source_id: "src_new", filename: "new.ifc", relative_path: "new.ifc", size_bytes: 1, modified_at: "" },
    ] });
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); sessionStorage.clear(); vi.restoreAllMocks(); });
  const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); };
  const render = async (currentSessionId?: string) => { await act(async () => { root.render(<Harness onSelected={selected} onModelsReloaded={reloaded} currentSessionId={currentSessionId} />); }); await flush(); };
  const click = async (id: string) => { await act(async () => { q<HTMLButtonElement>(id)!.click(); }); await flush(); };

  it("renders rows with the display-name rule and a local section for unregistered sources only", async () => {
    await render();
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("Project A · architecture · 版本 v1");
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("model.ifc");
    expect(q("model-file-row-idem_devreg_1")?.textContent).toContain("villa.ifc");
    expect(q("model-file-convert-src_new")).not.toBeNull();
    expect(q("model-file-convert-src_villa")).toBeNull();
    expect(q(`model-file-create-${MW}`)?.hasAttribute("disabled")).toBe(false);
    expect(q("model-file-create-idem_devreg_1")?.hasAttribute("disabled")).toBe(true);
    // 副標以鍵短碼結尾（Ruling R18）；轉檔欄用模型資料頁同一套 chip 字樣。
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("model.ifc · …89abcdef");
    expect(q("model-file-row-idem_devreg_1")?.textContent).toContain("project_real_ifc_demo · 版本 mv_realifc_1 · …devreg_1");
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("完成");
    expect(q("model-file-truncation")).toBeNull();
  });

  it("refreshes the row after a new review is created, without a manual refresh", async () => {
    const created = { ...minioRecord, sessions: [{ session_id: SESSION_ID, status: "created" as const, created_at: "", updated_at: "", link: "ready_model" as const }] };
    vi.mocked(coordinatorClient.getConversionRecords)
      .mockResolvedValueOnce({ count: 1, items: [{ ...minioRecord, sessions: [] }] })
      .mockResolvedValue({ count: 1, items: [created] });
    vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(response);
    await render();
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("進行中 0");
    expect(q(`model-file-remove-${MW}`)?.hasAttribute("disabled")).toBe(false);
    await click(`model-file-create-${MW}`);
    expect(selected).toHaveBeenCalledWith(session);
    expect(coordinatorClient.getConversionRecords).toHaveBeenCalledTimes(2);
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("進行中 1");
    expect(q(`model-file-remove-${MW}`)?.hasAttribute("disabled")).toBe(true);
    expect(q(`model-file-open-${MW}`)?.hasAttribute("disabled")).toBe(false);
  });

  it("selects an artifact_binding-linked review of a minio record directly instead of sending open_existing", async () => {
    const open = vi.spyOn(coordinatorClient, "readyReviewSession");
    vi.mocked(coordinatorClient.getConversionRecords).mockResolvedValue({ count: 1, items: [{ ...minioRecord, sessions: [{ session_id: SESSION_ID, status: "active", created_at: "", updated_at: "", link: "artifact_binding" }] }] });
    await render();
    await click(`model-file-open-${MW}`);
    expect(open).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledWith(session);
  });

  it("does not open a review that is closing", async () => {
    vi.mocked(coordinatorClient.getConversionRecords).mockResolvedValue({ count: 1, items: [{ ...minioRecord, sessions: [{ session_id: SESSION_ID, status: "closing", created_at: "", updated_at: "", link: "ready_model" }] }] });
    await render();
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("進行中 1");
    expect(q(`model-file-open-${MW}`)?.hasAttribute("disabled")).toBe(true);
    expect(q(`model-file-open-${MW}`)?.textContent).toContain("審查正在關閉，無法開啟");
  });

  it("labels the review choices with the session identity and falls back to id and status", async () => {
    const OTHER = "review_session_other";
    vi.mocked(coordinatorClient.getConversionRecords).mockResolvedValue({ count: 1, items: [{ ...minioRecord, sessions: [
      { session_id: SESSION_ID, status: "created", created_at: "", updated_at: "", link: "ready_model" },
      { session_id: OTHER, status: "active", created_at: "", updated_at: "", link: "ready_model" },
      { session_id: "review_session_closing", status: "closing", created_at: "", updated_at: "", link: "ready_model" },
    ] }] });
    await render();
    const select = q<HTMLSelectElement>(`model-file-session-${MW}`)!;
    expect(select.getAttribute("aria-label")).toContain("選擇要開啟的審查");
    expect(Array.from(select.options).map((option) => option.value)).toEqual([SESSION_ID, OTHER]);
    expect(select.options[0].textContent).toMatch(/ · 尚未啟動 · …isting$/);
    expect(select.options[1].textContent).toBe(`${OTHER}（active）`);
  });

  it("names honest captions for a pending creation and an unfinished conversion", async () => {
    sessionStorage.setItem("ai-bim.ready-review-request.v1", JSON.stringify({ readyModelId: MW, requestId: "review-abc" }));
    vi.mocked(coordinatorClient.getConversionRecords).mockResolvedValue({ count: 2, items: [minioRecord, { ...minioRecord, idempotency_key: "mw_ffffffffffffffff", status: "converting", sessions: [] }] });
    await render();
    expect(q(`model-file-create-${MW}`)?.hasAttribute("disabled")).toBe(true);
    expect(q(`model-file-create-${MW}`)?.textContent).toContain("有待確認的建立請求，先重試或停止追蹤");
    expect(q("model-file-open-mw_ffffffffffffffff")?.hasAttribute("disabled")).toBe(true);
    expect(q("model-file-open-mw_ffffffffffffffff")?.textContent).toContain("轉檔尚未完成");
  });

  it("warns when the list is truncated and shows load errors under their own id", async () => {
    vi.mocked(coordinatorClient.getConversionRecords).mockResolvedValueOnce({ count: 150, items: [minioRecord, devRecord] }).mockRejectedValue(new Error("coordinator offline"));
    await render();
    expect(q("model-file-truncation")?.textContent).toContain("僅顯示最新 2 筆／共 150 筆");
    await click("model-file-refresh");
    expect(q("model-file-load-error")?.textContent).toContain("coordinator offline");
    expect(q("model-file-load-error")?.className).toBe("ec-warn-note");
    expect(q("model-file-error")).toBeNull();
  });

  it("open existing calls onSelected only after the coordinator confirms", async () => {
    const open = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(response);
    await render();
    await click(`model-file-open-${MW}`);
    expect(open).toHaveBeenCalledWith(MW, { mode: "open_existing", session_id: SESSION_ID });
    expect(selected).toHaveBeenCalledWith(session);
  });

  it("opens a non-minio record's active session without calling the ready-review endpoint", async () => {
    const open = vi.spyOn(coordinatorClient, "readyReviewSession");
    vi.mocked(coordinatorClient.getConversionRecords).mockResolvedValue({ count: 1, items: [{ ...devRecord, sessions: [{ session_id: SESSION_ID, status: "created", created_at: "", updated_at: "", link: "intake_job" }] }] });
    await render();
    await click("model-file-open-idem_devreg_1");
    expect(open).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledWith(session);
  });

  it("creates a new review with a persisted request and keeps the pending flow", async () => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(response);
    await render();
    await click(`model-file-create-${MW}`);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][1]).toMatchObject({ mode: "create_new" });
    expect(sessionStorage.getItem("ai-bim.ready-review-request.v1")).toBeNull();
    expect(q("model-file-result")?.textContent).toContain(SESSION_ID);
  });

  it("shows the persisted pending request after a reload and retries it", async () => {
    sessionStorage.setItem("ai-bim.ready-review-request.v1", JSON.stringify({ readyModelId: MW, requestId: "review-abc" }));
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue({ ...response, session_replay: true });
    await render();
    expect(q("model-file-pending")).not.toBeNull();
    await click("model-file-retry");
    expect(submit).toHaveBeenCalledWith(MW, { mode: "create_new", request_id: "review-abc" });
    expect(q("model-file-pending")).toBeNull();
  });

  it("removes a record after confirmation and shows the server's 409 reason otherwise", async () => {
    const remove = vi.spyOn(coordinatorClient, "removeConversionRecord")
      .mockRejectedValueOnce(new CoordinatorHttpError("/api/conversion/records/idem_devreg_1", 409, "record_in_flight", "record_in_flight", { error_code: "record_in_flight", intake_status: "dispatched" }))
      .mockResolvedValueOnce({ idempotency_key: "idem_devreg_1", status: "removed", removed_at: "2026-09-30T00:00:00.000Z", intake_jobs_removed: 1 });
    await render();
    expect(q(`model-file-remove-${MW}`)?.hasAttribute("disabled")).toBe(true); // 進行中 session 佔用
    await click("model-file-remove-idem_devreg_1");
    expect(q("intent-dialog")?.textContent).toContain("對象：villa.ifc · idem_devreg_1");
    await click("intent-confirm");
    expect(q("intent-action-error")?.textContent).toContain("record_in_flight");
    expect(q("intent-action-error")?.textContent).toContain("dispatched");
    expect(reloaded).not.toHaveBeenCalled();
    await click("intent-confirm");
    expect(remove).toHaveBeenCalledTimes(2);
    expect(coordinatorClient.getConversionRecords).toHaveBeenCalledTimes(2); // 成功後重載
    expect(reloaded).toHaveBeenCalledTimes(1); // 其他模型來源（規則檢核）跟著重載
    expect(q("intent-dialog")).toBeNull();
  });

  it("shows a transient poll failure as still converting and keeps the convert button disabled", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(coordinatorClient, "registerIfcSource").mockResolvedValue({ ifc_ready_job_id: "ifcready_1", download_status: "pending", conversion_status: null });
      vi.spyOn(coordinatorClient, "getIfcReadyJob").mockRejectedValue(new TypeError("Failed to fetch"));
      await render();
      await click("model-file-convert-src_new");
      await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
      await flush();
      expect(q("model-file-convert-status-src_new")?.textContent).toBe("輪詢失敗，轉檔可能仍在進行");
      expect(q("model-file-convert-src_new")?.hasAttribute("disabled")).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("reloads the other model sources after a local conversion becomes ready", async () => {
    vi.spyOn(coordinatorClient, "registerIfcSource").mockResolvedValue({ ifc_ready_job_id: "ifcready_1", download_status: "done", conversion_status: "ready", viewer_url: "/ui/open?session=review_session_new", web_view_session_id: "review_session_new" } as never);
    await render();
    await click("model-file-convert-src_new");
    expect(coordinatorClient.getConversionRecords).toHaveBeenCalledTimes(2);
    expect(reloaded).toHaveBeenCalledTimes(1);
  });

  it("hides the local section when dev routes are disabled", async () => {
    vi.mocked(coordinatorClient.listIfcSources).mockRejectedValue(new CoordinatorHttpError("/api/dev/ifc-sources", 404, "dev routes disabled", "dev_routes_disabled"));
    await render();
    expect(q("model-file-local-section")).toBeNull();
    expect(q("model-file-local-disabled")).not.toBeNull();
  });

  it("marks the row of the current session", async () => {
    await render(SESSION_ID);
    expect(q(`model-file-row-${MW}`)?.getAttribute("data-current")).toBe("true");
  });

  it("stops tracking a persisted pending request only after the confirmation", async () => {
    sessionStorage.setItem("ai-bim.ready-review-request.v1", JSON.stringify({ readyModelId: MW, requestId: "review-abc" }));
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession");
    await render();
    await click("model-file-stop");
    expect(q("model-file-pending")?.textContent).toContain("review-abc");
    expect(sessionStorage.getItem("ai-bim.ready-review-request.v1")).not.toBeNull();
    await click("model-file-confirm-stop");
    expect(q("model-file-stopped")?.textContent).toContain("review-abc");
    expect(q("model-file-pending")).toBeNull();
    expect(sessionStorage.getItem("ai-bim.ready-review-request.v1")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("opens the preferred active review when the chosen one closed after a reload", async () => {
    const OTHER = "review_session_other";
    type RecordSession = ConversionRecord["sessions"][number];
    const link = (session_id: string, status: RecordSession["status"]): RecordSession => ({ session_id, status, created_at: "", updated_at: "", link: "ready_model" });
    vi.mocked(coordinatorClient.getConversionRecords)
      .mockResolvedValueOnce({ count: 1, items: [{ ...minioRecord, sessions: [link(SESSION_ID, "active"), link(OTHER, "active")] }] })
      .mockResolvedValue({ count: 1, items: [{ ...minioRecord, sessions: [link(SESSION_ID, "active"), link(OTHER, "closed")] }] });
    const open = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(response);
    await render();
    await act(async () => {
      const select = q<HTMLSelectElement>(`model-file-session-${MW}`)!;
      select.value = OTHER;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(q<HTMLSelectElement>(`model-file-session-${MW}`)!.value).toBe(OTHER);
    await click("model-file-refresh");
    expect(q(`model-file-session-${MW}`)).toBeNull();
    await click(`model-file-open-${MW}`);
    expect(open).toHaveBeenCalledWith(MW, { mode: "open_existing", session_id: SESSION_ID });
  });

  it("clears the previous review result when another file's review is opened", async () => {
    const LOCAL = "review_session_local";
    const localSession: RuntimeSessionSummary = { ...session, session_id: LOCAL, ready_model_id: null };
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue({ sessions: { items: [session, localSession] } } as RuntimeStatus);
    vi.mocked(coordinatorClient.getConversionRecords).mockResolvedValue({ count: 2, items: [
      minioRecord, { ...devRecord, sessions: [{ session_id: LOCAL, status: "active", created_at: "", updated_at: "", link: "intake_job" }] },
    ] });
    vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(response);
    await render();
    await click(`model-file-open-${MW}`);
    expect(q("model-file-result")?.textContent).toContain(SESSION_ID);
    await click("model-file-open-idem_devreg_1");
    expect(selected).toHaveBeenLastCalledWith(localSession);
    expect(q("model-file-result")).toBeNull();
  });
});
