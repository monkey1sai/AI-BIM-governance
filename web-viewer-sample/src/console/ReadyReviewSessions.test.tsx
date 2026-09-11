import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadyReviewSessions } from "./ReadyReviewSessions";
import { coordinatorClient, type ConversionRecord, type RuntimeSessionSummary, type RuntimeStatus } from "./coordinatorClient";

const modelId = "mw_0123456789abcdef";
const record: ConversionRecord = {
  idempotency_key: modelId, project_id: "project-a", project_display_name: "Project A",
  category: "architecture", external_model_version_id: "v1", conversion_job_id: "conv-a",
  status: "ready", usdc_key: "model.usdc", coverage_report: null, object_key: "project-a/model.ifc",
  detected_at: "", updated_at: "",
};
const session: RuntimeSessionSummary = {
  session_id: "review_session_existing", status: "created", project_id: "project-a",
  model_version_id: "v1", participant_count: 0, expected_stage_url: null,
  conversion_status: "ready", kit_instance_ids: [], created_at: "", updated_at: "",
};
const response = { ready_model_id: modelId, review_session_id: session.session_id, session_status: "created", session_replay: false };

describe("ReadyReviewSessions", () => {
  let container: HTMLDivElement;
  let root: Root;
  const selected = vi.fn();
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    selected.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [record] });
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [session] } } as RuntimeStatus);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });
  const render = async () => { await act(async () => { root.render(<ReadyReviewSessions sessions={[session]} onSelected={selected} />); }); };
  const click = async (id: string) => { await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click(); }); };
  const choose = async (id: string, value: string) => { await act(async () => {
    const element = container.querySelector<HTMLSelectElement>(`[data-testid="${id}"]`)!;
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }); };

  it("uses a distinct persisted request for each deliberate creation and never claims a viewer lease", async () => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(response);
    const claim = vi.spyOn(coordinatorClient, "claimViewerLease");
    await render();
    await choose("ready-review-model", modelId);
    await click("ready-review-create");
    await click("ready-review-create");
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][1]).toMatchObject({ mode: "create_new" });
    expect(submit.mock.calls[0][1]).not.toEqual(submit.mock.calls[1][1]);
    expect(selected).toHaveBeenCalledWith(session);
    expect(claim).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("ai-bim.ready-review-request.v1")).toBeNull();
  });
  it("keeps the same request after a lost response and remount without automatically resending", async () => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession")
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ ...response, session_replay: true });
    await render();
    await choose("ready-review-model", modelId);
    await click("ready-review-create");
    expect(container.querySelector('[data-testid="ready-review-error"]')?.textContent).toContain("response lost");
    const first = submit.mock.calls[0];
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await render();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="ready-review-pending"]')).not.toBeNull();
    await click("ready-review-retry");
    expect(submit.mock.calls[1]).toEqual(first);
    expect(selected).toHaveBeenCalledWith(session);
  });
  it.each(["404 ready_model_not_found", "409 review_request_conflict"])("allows explicit recovery after permanent %s and remount without resubmitting", async (failure) => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockRejectedValueOnce(new Error(failure)).mockResolvedValue(response);
    await render();
    await choose("ready-review-model", modelId);
    await click("ready-review-create");
    const original = submit.mock.calls[0][1];
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await render();
    await choose("ready-review-model", modelId);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="ready-review-create"]')!.disabled).toBe(true);
    await click("ready-review-stop");
    expect(container.textContent).toContain("可能已建立審查");
    await click("ready-review-confirm-stop");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="ready-review-stopped"]')?.textContent).toContain("request_id" in original ? original.request_id : "");
    await click("ready-review-create");
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][1]).not.toEqual(original);
  });
  it("opens only the selected existing review and displays a server rejection", async () => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockRejectedValue(new Error("409 review_session_source_mismatch"));
    await render();
    await choose("ready-review-model", modelId);
    await choose("ready-review-existing", session.session_id);
    await click("ready-review-open");
    expect(submit).toHaveBeenCalledWith(modelId, { mode: "open_existing", session_id: session.session_id });
    expect(selected).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("409");
  });
  it("does not post if browser storage cannot preserve the creation request", async () => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession");
    await render();
    await choose("ready-review-model", modelId);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage denied"); });
    await click("ready-review-create");
    expect(submit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("無法保存");
  });
  it("retains a closed replay result without selecting or reactivating it", async () => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue({ ...response, session_status: "closed", session_replay: true });
    await render();
    await choose("ready-review-model", modelId);
    await click("ready-review-create");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(selected).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="ready-review-success"]')?.textContent).toContain("已結束");
  });
});
