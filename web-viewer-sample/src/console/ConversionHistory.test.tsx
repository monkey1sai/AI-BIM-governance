// web-viewer-sample/src/console/ConversionHistory.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversionSchedulingPage } from "./pages";
import { coordinatorClient } from "./coordinatorClient";
import { parseHandoff } from "./handoff";

describe("CV conversion history panel + cross-links", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  function stubBase() {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] } as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
  }

  it("renders the history panel with pass-through items (artifact)", async () => {
    stubBase();
    // source_ifc_filename (not created_at, which GET /api/dev/conversions structurally never
    // serializes — see docs/superpowers/plans/2026-07-03-seven-axis-cross-page-harmony.md Task 7
    // 2026-07-03 correction) is the third column; assert it actually renders, not just conversion_job_id.
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [{ conversion_job_id: "cj_9", status: "succeeded", source_ifc_filename: "model_A.ifc" }], count: 1 });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-history-panel"]')).not.toBeNull();
    expect(container.textContent).toContain("cj_9");
    expect(container.textContent).toContain("model_A.ifc");
  });

  it("history panel degrades honestly when the endpoint fails (no fake rows)", async () => {
    stubBase();
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockRejectedValue(new Error("404"));
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const panel = container.querySelector('[data-testid="conv-history-panel"]');
    expect(panel?.textContent).toContain("未取得");
  });

  // Steps 5 & 6 add three data-testids that are ~half this task's diff; assert them here so nothing in the
  // task's commit is unverified (this task is committed as one unit — every added chip must be covered).
  it("renders evidence-typed cross-link chips on ledger + ifc-ready rows and navigates with source=conv", async () => {
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [
      { idempotency_key: "mw_led1", project_id: "270", project_display_name: "270", category: "建築", external_model_version_id: "v1", conversion_job_id: "cj_1", status: "ready", usdc_key: null, coverage_report: null, object_key: "270專案/建築/v07/模型.ifc", detected_at: "", updated_at: "" },
    ] });
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [
      { ifc_ready_job_id: "job_1", status: "ready", project_id: "270", external_model_version_id: "v1", download_status: "done", conversion_status: "ready", conversion_authority: "bim-streaming-server", queue_position: null, conversion_job_id: "cj_1", dispatch_error: null, review_session_id: "review_session_a", viewer_url: null, expected_stage_url: null, expected_mapping_url: null, created_at: "", updated_at: "" },
    ] } as never);
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Spec §12: ID present → chip enabled and its hash correctly carries source + the target id.
    // Assert each chip's click→hash individually (not just DOM presence); each click overwrites
    // window.location.hash, so we verify one, then the next.
    // ledger row → #minio chip (evidence-typed: only when object_key exists), keyed by idempotency_key.
    // minio_key is percent-encoded in the raw hash (slashes + CJK) → decode via parseHandoff (the receiver's
    // own inverse, spec §4.2) to assert the exact object key round-trips rather than matching encoded bytes.
    const toMinio = container.querySelector('[data-testid="conv-ledger-minio-mw_led1"]') as HTMLButtonElement | null;
    expect(toMinio).not.toBeNull();
    await act(async () => { toMinio!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#minio?source=conv");
    expect(window.location.hash).toContain("conversion_id=cj_1");
    expect(parseHandoff(window.location.hash)?.minio_key).toBe("270專案/建築/v07/模型.ifc");
    // ifc-ready row → #sessions chip (only when review_session_id exists), keyed by ifc_ready_job_id
    const toSessions = container.querySelector('[data-testid="conv-job-session-job_1"]') as HTMLButtonElement | null;
    expect(toSessions).not.toBeNull();
    await act(async () => { toSessions!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#sessions?source=conv");
    expect(window.location.hash).toContain("session=review_session_a");
    // ifc-ready row → #review chip (only when review_session_id exists)
    const toReview = container.querySelector('[data-testid="conv-job-review-job_1"]') as HTMLButtonElement | null;
    expect(toReview).not.toBeNull();
    await act(async () => { toReview!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#review?source=conv");
    expect(window.location.hash).toContain("session=review_session_a");
  });

  // Spec §12 negative direction: target ID absent → chip must NOT render (evidence-typed, no invalid jump).
  // This is the regression guard the panel lacked: if a future refactor inverts the truthy gate, the chip
  // would leak on a row with no id. Paired with the positive test above, the two straddle the condition.
  it("hides all three cross-link chips when the target IDs are absent (object_key / review_session_id null)", async () => {
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [
      { idempotency_key: "mw_led2", project_id: "270", project_display_name: "270", category: "建築", external_model_version_id: "v1", conversion_job_id: "cj_2", status: "ready", usdc_key: null, coverage_report: null, object_key: null, detected_at: "", updated_at: "" },
    ] });
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [
      { ifc_ready_job_id: "job_2", status: "ready", project_id: "270", external_model_version_id: "v1", download_status: "done", conversion_status: "ready", conversion_authority: "bim-streaming-server", queue_position: null, conversion_job_id: "cj_2", dispatch_error: null, review_session_id: null, viewer_url: null, expected_stage_url: null, expected_mapping_url: null, created_at: "", updated_at: "" },
    ] } as never);
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Both rows DO render (so chip-absence below is meaningful — not a vanished row).
    expect(container.querySelector('[data-testid="conv-ledger-idem-mw_led2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="conv-job-idem-job_2"]')).not.toBeNull();
    // object_key null → #minio chip absent; the cell keeps the honest "—" placeholder instead of a fake jump.
    expect(container.querySelector('[data-testid="conv-ledger-minio-mw_led2"]')).toBeNull();
    // review_session_id null → both #sessions and #review chips absent.
    expect(container.querySelector('[data-testid="conv-job-session-job_2"]')).toBeNull();
    expect(container.querySelector('[data-testid="conv-job-review-job_2"]')).toBeNull();
  });
});
