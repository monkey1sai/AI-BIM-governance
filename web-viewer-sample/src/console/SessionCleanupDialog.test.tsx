import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fx } from "./__testdata__/contractFixtures";
import { CoordinatorHttpError, coordinatorClient, type RuntimeStatus } from "./coordinatorClient";
import { SessionCleanupDialog } from "./SessionCleanupDialog";

const OLD = "2026-09-01T00:00:00.000Z";
describe("SessionCleanupDialog", () => {
  let container: HTMLDivElement; let root: Root;
  const q = <T extends Element>(id: string) => container.querySelector<T>(`[data-testid="${id}"]`);
  const click = async (id: string) => { await act(async () => { q<HTMLButtonElement>(id)!.click(); }); await act(async () => { await Promise.resolve(); }); };
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ now: Date.parse("2026-09-30T00:00:00.000Z"), toFake: ["Date"] });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [
      fx.runtimeSessionSummary({ session_id: "review_session_stale", status: "active", updated_at: OLD, viewer_leases: [], primary_viewer_lease_id: null }),
      fx.runtimeSessionSummary({ session_id: "review_session_busy", status: "active", updated_at: OLD, primary_viewer_lease_id: "lease", viewer_leases: [fx.publicViewerLease({})] }),
    ] } } as RuntimeStatus);
    vi.spyOn(coordinatorClient, "listClosedReviewSessions").mockResolvedValue({ items: [
      { session_id: "review_session_closed", status: "closed", project_id: "p", model_version_id: "m", created_at: OLD, updated_at: OLD, recreated_from_session_id: null, source_ifc_filename: "villa.ifc", rebuildability: { state: "ready", reason: null, checked_at: OLD } },
    ], next_cursor: null });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [fx.conversionRecord({ idempotency_key: "mw_0123456789abcdef", status: "ready", updated_at: OLD, sessions: [] })] });
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const render = async () => { await act(async () => { root.render(<SessionCleanupDialog open onClose={() => {}} onFinished={() => {}} />); }); };

  it("previews the three candidate groups for the cutoff", async () => {
    await render();
    await click("cleanup-preview");
    expect(q("cleanup-group-stale")?.textContent).toContain("review_session_stale");
    expect(q("cleanup-group-stale")?.textContent).not.toContain("review_session_busy");
    expect(q("cleanup-group-closed")?.textContent).toContain("villa.ifc");
    expect(q("cleanup-group-records")?.textContent).toContain("mw_0123456789abcdef");
  });

  it("executes sequentially: close then purge stale sessions, purge closed ones, remove records; 404 counts as gone; 409 is reported and the loop continues", async () => {
    const close = vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "review_session_stale", status: "closing" }); // SessionCloseResponse = Pick<ReviewSession, "session_id" | "status">
    const purge = vi.spyOn(coordinatorClient, "purgeReviewSession")
      .mockResolvedValueOnce({ session_id: "review_session_stale", status: "purged", purged_at: OLD, removed: { session_file: true, events_file: true } })
      .mockRejectedValueOnce(new CoordinatorHttpError("/api/review-sessions/review_session_closed", 404, "not found", "review_session_not_found"));
    const remove = vi.spyOn(coordinatorClient, "removeConversionRecord").mockRejectedValue(new CoordinatorHttpError("/api/conversion/records/k", 409, "record_in_flight", "record_in_flight", { error_code: "record_in_flight", intake_status: "dispatched" }));
    await render();
    await click("cleanup-preview");
    await click("cleanup-confirm");
    expect(close).toHaveBeenCalledWith("review_session_stale", "stale_cleanup");
    expect(purge.mock.calls.map((c) => c[0])).toEqual(["review_session_stale", "review_session_closed"]);
    expect(purge.mock.calls[0][1]).toBe("stale_cleanup");
    expect(remove).toHaveBeenCalledWith("mw_0123456789abcdef");
    expect(q("cleanup-result-row-review_session_closed")?.textContent).toContain("已不存在");
    expect(q("cleanup-result-row-mw_0123456789abcdef")?.textContent).toContain("record_in_flight");
    expect(q("cleanup-done")).not.toBeNull();
  });

  it("stops at the first 403 and tells the operator about the token path", async () => {
    vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "review_session_stale", status: "closing" });
    const purge = vi.spyOn(coordinatorClient, "purgeReviewSession").mockRejectedValue(new CoordinatorHttpError("/api/review-sessions/x", 403, "caller ip not in allowlist"));
    const remove = vi.spyOn(coordinatorClient, "removeConversionRecord");
    await render();
    await click("cleanup-preview");
    await click("cleanup-confirm");
    expect(purge).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(q("cleanup-stopped-403")).not.toBeNull();
  });
});
