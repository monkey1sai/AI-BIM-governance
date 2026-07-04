// web-viewer-sample/src/console/IntakeCrossLinks.test.tsx
// Task 11（IN axis）：job 列（IntakePage）掛 #conv（永遠）/ #review（僅 review_session_id 存在時）
// cross-link chips。§4.3 IN → CV / IN → Review Room。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntakePage } from "./pages";
import { coordinatorClient, type IfcReadyListItem } from "./coordinatorClient";

const job = (over: Partial<IfcReadyListItem>): IfcReadyListItem => ({ ifc_ready_job_id: "job_1", status: "ready", project_id: "270", external_model_version_id: "v1", download_status: "done", conversion_status: "ready", conversion_authority: "bim-streaming-server", queue_position: null, conversion_job_id: "cj_1", dispatch_error: null, review_session_id: "review_session_a", viewer_url: null, expected_stage_url: null, expected_mapping_url: null, created_at: "", updated_at: "", ...over });

describe("IN job-row cross-link chips", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  it("renders #conv (job_id) always and #review (session) when review_session_id exists", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job({})] });
    const root = createRoot(container);
    await act(async () => { root.render(<IntakePage />); });
    await act(async () => { await Promise.resolve(); });

    const conv = container.querySelector('[data-testid="intake-link-conv-job_1"]') as HTMLButtonElement;
    expect(conv).not.toBeNull();
    await act(async () => { conv.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#conv?source=intake");
    expect(window.location.hash).toContain("job_id=job_1");
    // #review chip: assert its click→hash too (not just DOM presence). Each click overwrites
    // window.location.hash, so #conv is verified above first, then #review here — mirrors the sibling
    // ConversionHistory.test.tsx pattern so the review onClick (session=…) can't silently regress.
    const review = container.querySelector('[data-testid="intake-link-review-job_1"]') as HTMLButtonElement;
    expect(review).not.toBeNull();
    await act(async () => { review.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#review?source=intake");
    expect(window.location.hash).toContain("session=review_session_a");
  });

  it("omits the #review chip when the job has no review_session_id (no fake nav)", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job({ ifc_ready_job_id: "job_2", review_session_id: null })] });
    const root = createRoot(container);
    await act(async () => { root.render(<IntakePage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="intake-link-conv-job_2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="intake-link-review-job_2"]')).toBeNull();
  });
});
