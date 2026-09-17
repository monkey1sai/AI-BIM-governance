import { fx } from "../__testdata__/contractFixtures";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient, type ConversionRecord, type MinioObject, type RuntimeStatus } from "../coordinatorClient";
import { ReconversionPanel } from "./ReconversionPanel";

const object: MinioObject = { key: "project/main/v1/model.ifc", etag: "a".repeat(32), role: "source_ifc",
  project_id: "project", project_display_name: "Project", category: "main", version: "v1", idempotency_key: "mw_0123456789abcdef" };
const record: ConversionRecord = fx.conversionRecord({ idempotency_key: object.idempotency_key, project_id: "project", project_display_name: "Project",
  category: "main", external_model_version_id: "v1", conversion_job_id: "conv_old", status: "ready", usdc_key: "old/model.usdc",
  coverage_report: null, object_key: object.key, detected_at: "2026-09-15T01:00:00Z", updated_at: "2026-09-15T01:00:01Z" });
describe("ReconversionPanel", () => {
  let node: HTMLDivElement; let root: Root;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear(); window.location.hash = "#minio";
    node = document.createElement("div"); document.body.appendChild(node); root = createRoot(node);
    vi.spyOn(coordinatorClient, "getObjectConversionHistory").mockResolvedValue({ count: 1, items: [record] });
  });
  afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); sessionStorage.clear(); });
  const render = async () => { await act(async () => root.render(<ReconversionPanel object={object} />)); };
  const button = (id: string) => node.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
  const click = async (id: string) => { await act(async () => button(id).click()); };

  it("allows reconverting a successful model, but cancellation submits nothing", async () => {
    const submit = vi.spyOn(coordinatorClient, "reconvertIfc");
    await render();
    expect(button("reconversion-start").disabled).toBe(false);
    expect(node.textContent).toContain("版本未知");
    await click("reconversion-start");
    expect(node.querySelector("#intent-reason")).toBeNull();
    await click("intent-cancel");
    expect(submit).not.toHaveBeenCalled();
  });
  it("retries the saved intent after an uncertain response and a remount", async () => {
    const submit = vi.spyOn(coordinatorClient, "reconvertIfc").mockRejectedValueOnce(new Error("502 outcome unknown"))
      .mockResolvedValue({ ready_model_id: "mw_1111111111111111", intent_replay: true });
    await render(); await click("reconversion-start"); await click("intent-confirm");
    const first = submit.mock.calls[0];
    await act(async () => root.unmount()); root = createRoot(node); await render();
    expect(node.textContent).toContain("重試確認同一操作");
    await click("reconversion-start"); await click("intent-confirm");
    expect(submit.mock.calls[1]).toEqual(first);
    expect(first[2]).toBe(object.etag);
    expect(window.location.hash).toBe("#minio");
    expect(node.textContent).toContain("尚未切換 3D");
  });
  it("blocks new submissions while a job is pending", async () => {
    vi.mocked(coordinatorClient.getObjectConversionHistory).mockResolvedValue({ count: 1, items: [{ ...record, status: "queued" }] });
    await render(); expect(button("reconversion-start").disabled).toBe(true);
  });
  it("coalesces two confirmation clicks into one request", async () => {
    let finish!: (value: { ready_model_id: string; intent_replay: boolean }) => void;
    const submit = vi.spyOn(coordinatorClient, "reconvertIfc").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(); await click("reconversion-start");
    await act(async () => { button("intent-confirm").click(); button("intent-confirm").click(); });
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ready_model_id: "mw_new", intent_replay: false }));
  });
  it("explains 403 without requesting a service token or reporting success", async () => {
    vi.spyOn(coordinatorClient, "reconvertIfc").mockRejectedValue(new Error("403 forbidden"));
    await render(); await click("reconversion-start"); await click("intent-confirm");
    expect(node.textContent).toContain("目前沒有轉檔操作權限");
    expect(node.querySelector("[data-testid='reconversion-notice']")).toBeNull();
    expect(window.location.hash).toBe("#minio");
  });
  it("retains history on refresh failure and blocks operations on stale data", async () => {
    await render();
    vi.mocked(coordinatorClient.getObjectConversionHistory).mockRejectedValue(new Error("offline"));
    await click("reconversion-refresh");
    expect(node.textContent).toContain("conv_old");
    expect(node.textContent).toContain("保留上次資料");
    expect(button("reconversion-start").disabled).toBe(true);
    expect(button("reconversion-open").disabled).toBe(true);
  });
  it("shows a failed source reason without offering the failed artifact to the Viewer", async () => {
    vi.mocked(coordinatorClient.getObjectConversionHistory).mockResolvedValue({ count: 1, items: [{ ...record, status: "failed", failure_code: "source_changed" }] });
    await render();
    expect(node.textContent).toContain("來源 IFC 已變更");
    expect(node.querySelector('[data-testid="reconversion-open"]')).toBeNull();
    expect(window.location.hash).toBe("#minio");
  });
  it("opens only the exact result after checking the authoritative session binding", async () => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue({ ready_model_id: record.idempotency_key,
      review_session_id: "review_session_new", session_status: "active", session_replay: false });
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [{ session_id: "review_session_new", status: "active",
      ready_model_id: record.idempotency_key, project_id: record.project_id, model_version_id: record.external_model_version_id }] } } as RuntimeStatus);
    await render(); await click("reconversion-open");
    expect(submit).toHaveBeenCalledWith(record.idempotency_key, expect.objectContaining({ mode: "create_new" }));
    expect(window.location.hash).toContain("session=review_session_new");
    expect(window.location.hash).toContain("conversion_id=conv_old");
  });
  it("does not navigate when the response resolves to an old result", async () => {
    vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue({ ready_model_id: record.idempotency_key,
      review_session_id: "review_session_old", session_status: "active", session_replay: false });
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [{ session_id: "review_session_old", status: "active",
      ready_model_id: "mw_wrong", project_id: record.project_id, model_version_id: record.external_model_version_id }] } } as RuntimeStatus);
    await render(); await click("reconversion-open");
    expect(window.location.hash).toBe("#minio");
    expect(node.textContent).toContain("尚未對應");
  });
  it("labels the section as step two and offers a first conversion when there is no history", async () => {
    vi.mocked(coordinatorClient.getObjectConversionHistory).mockResolvedValue({ count: 0, items: [] });
    await render();
    expect(node.textContent).toContain("② ");
    expect(button("reconversion-start").textContent).toContain("開始轉檔");
    expect(button("reconversion-start").disabled).toBe(false);
  });
  it("shows the latest attempt first and folds older attempts away", async () => {
    const newer = { ...record, idempotency_key: "mw_newer000000000", conversion_job_id: "conv_new", detected_at: "2026-09-17T01:00:00Z" };
    vi.mocked(coordinatorClient.getObjectConversionHistory).mockResolvedValue({ count: 2, items: [newer, record] });
    await render();
    expect(button("reconversion-start").textContent).toContain("重新轉檔");
    const results = node.querySelectorAll('[data-testid="reconversion-result"]');
    expect(results).toHaveLength(2);
    expect(results[0].textContent).toContain("conv_new");
    expect(results[0].textContent).not.toContain("2026-09-17T01:00:00Z");
    expect(results[0].closest("details")).toBeNull();
    const older = node.querySelector<HTMLDetailsElement>('[data-testid="reconversion-older"]');
    expect(older?.open).toBe(false);
    expect(older?.textContent).toContain("1");
    expect(results[1].closest("details")).toBe(older);
  });
  it("reports progress and the latest finished conversion to the page", async () => {
    const seen: unknown[] = [];
    const queued = { ...record, idempotency_key: "mw_queued000000000", conversion_job_id: null, status: "queued" as const };
    const history = vi.mocked(coordinatorClient.getObjectConversionHistory);
    history.mockResolvedValue({ count: 2, items: [queued, record] });
    await act(async () => root.render(<ReconversionPanel object={object} onProgress={(change) => seen.push(change)} />));
    expect(seen[seen.length - 1]).toEqual({ progress: "running", latestReadyConversionId: "conv_old" });

    history.mockResolvedValue({ count: 1, items: [record] });
    await click("reconversion-refresh");
    expect(seen[seen.length - 1]).toEqual({ progress: "ready", latestReadyConversionId: "conv_old" });

    history.mockResolvedValue({ count: 1, items: [{ ...record, status: "failed" }] });
    await click("reconversion-refresh");
    expect(seen[seen.length - 1]).toEqual({ progress: "failed", latestReadyConversionId: null });

    history.mockResolvedValue({ count: 0, items: [] });
    await click("reconversion-refresh");
    expect(seen[seen.length - 1]).toEqual({ progress: "none", latestReadyConversionId: null });
  });
  it("reports an unreadable history before anything was loaded", async () => {
    const seen: unknown[] = [];
    vi.mocked(coordinatorClient.getObjectConversionHistory).mockRejectedValue(new Error("offline"));
    await act(async () => root.render(<ReconversionPanel object={object} onProgress={(change) => seen.push(change)} />));
    expect(seen[seen.length - 1]).toEqual({ progress: "error", latestReadyConversionId: null });
  });
});
