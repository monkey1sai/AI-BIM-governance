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

function Harness({ onSelected, currentSessionId }: { onSelected: (s: RuntimeSessionSummary) => void; currentSessionId?: string }) {
  const [sessions, setSessions] = useState([session]);
  return <ModelFileList sessions={sessions} onSessionsRefreshed={setSessions} onSelected={onSelected} currentSessionId={currentSessionId} />;
}

describe("ModelFileList", () => {
  let container: HTMLDivElement; let root: Root;
  const selected = vi.fn();
  const q = <T extends Element>(id: string) => container.querySelector<T>(`[data-testid="${id}"]`);
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear(); selected.mockReset();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 2, items: [minioRecord, devRecord] });
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [session] } } as RuntimeStatus);
    vi.spyOn(coordinatorClient, "listIfcSources").mockResolvedValue({ items: [
      { source_id: "src_villa", filename: "villa.ifc", relative_path: "villa.ifc", size_bytes: 1, modified_at: "" },
      { source_id: "src_new", filename: "new.ifc", relative_path: "new.ifc", size_bytes: 1, modified_at: "" },
    ] });
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); sessionStorage.clear(); vi.restoreAllMocks(); });
  const render = async (currentSessionId?: string) => { await act(async () => { root.render(<Harness onSelected={selected} currentSessionId={currentSessionId} />); }); await act(async () => { await Promise.resolve(); }); };
  const click = async (id: string) => { await act(async () => { q<HTMLButtonElement>(id)!.click(); }); };

  it("renders rows with the display-name rule and a local section for unregistered sources only", async () => {
    await render();
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("Project A · architecture · 版本 v1");
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("model.ifc");
    expect(q("model-file-row-idem_devreg_1")?.textContent).toContain("villa.ifc");
    expect(q("model-file-convert-src_new")).not.toBeNull();
    expect(q("model-file-convert-src_villa")).toBeNull();
    expect(q(`model-file-create-${MW}`)?.hasAttribute("disabled")).toBe(false);
    expect(q("model-file-create-idem_devreg_1")?.hasAttribute("disabled")).toBe(true);
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
    await click("intent-confirm");
    expect(q("model-file-remove-error")?.textContent).toContain("record_in_flight");
    expect(q("model-file-remove-error")?.textContent).toContain("dispatched");
    await click("intent-confirm");
    expect(remove).toHaveBeenCalledTimes(2);
    expect(coordinatorClient.getConversionRecords).toHaveBeenCalledTimes(2); // 成功後重載
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
