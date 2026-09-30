import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fx } from "./__testdata__/contractFixtures";
import { CoordinatorHttpError, coordinatorClient, type RuntimeStatus } from "./coordinatorClient";
import { SessionCleanupDialog } from "./SessionCleanupDialog";

const OLD = "2026-09-01T00:00:00.000Z";
describe("SessionCleanupDialog", () => {
  let container: HTMLDivElement; let root: Root;
  let baseStatus: RuntimeStatus;
  const onFinished = vi.fn();
  const q = <T extends Element>(id: string) => container.querySelector<T>(`[data-testid="${id}"]`);
  const click = async (id: string) => { await act(async () => { q<HTMLButtonElement>(id)!.click(); }); await act(async () => { await Promise.resolve(); }); };
  const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
  const setDays = async (value: string) => {
    await act(async () => {
      const input = q<HTMLInputElement>("cleanup-days")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ now: Date.parse("2026-09-30T00:00:00.000Z"), toFake: ["Date"] });
    onFinished.mockClear();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    baseStatus = { sessions: { items: [
      fx.runtimeSessionSummary({ session_id: "review_session_stale", status: "active", updated_at: OLD, viewer_leases: [], primary_viewer_lease_id: null }),
      fx.runtimeSessionSummary({ session_id: "review_session_busy", status: "active", updated_at: OLD, primary_viewer_lease_id: "lease", viewer_leases: [fx.publicViewerLease({})] }),
    ] } } as RuntimeStatus;
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(baseStatus);
    vi.spyOn(coordinatorClient, "listClosedReviewSessions").mockResolvedValue({ items: [
      { session_id: "review_session_closed", status: "closed", project_id: "p", model_version_id: "m", created_at: OLD, updated_at: OLD, recreated_from_session_id: null, source_ifc_filename: "villa.ifc", rebuildability: { state: "ready", reason: null, checked_at: OLD } },
    ], next_cursor: null });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [fx.conversionRecord({ idempotency_key: "mw_0123456789abcdef", status: "ready", updated_at: OLD, sessions: [] })] });
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const render = async (open = true) => { await act(async () => { root.render(<SessionCleanupDialog open={open} onClose={() => {}} onFinished={onFinished} />); }); };

  it("previews the three candidate groups for the cutoff", async () => {
    await render();
    await click("cleanup-preview");
    expect(q("cleanup-group-stale")?.textContent).toContain("review_session_stale");
    expect(q("cleanup-group-stale")?.textContent).not.toContain("review_session_busy");
    expect(q("cleanup-group-closed")?.textContent).toContain("villa.ifc");
    expect(q("cleanup-group-records")?.textContent).toContain("mw_0123456789abcdef");
    expect(q("cleanup-truncation")).toBeNull();
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
    expect(q("cleanup-done")?.textContent).toContain("已封存清單");
    expect(onFinished).toHaveBeenCalledTimes(1);
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
    expect(onFinished).toHaveBeenCalledTimes(1); // a 403 stop still reloads the lists
  });

  it("changing days drops the preview so confirm cannot run the list made for another cutoff", async () => {
    vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "review_session_stale", status: "closing" });
    const purge = vi.spyOn(coordinatorClient, "purgeReviewSession").mockResolvedValue({ session_id: "x", status: "purged", purged_at: OLD, removed: { session_file: true, events_file: true } });
    await render();
    await click("cleanup-preview");
    expect(q<HTMLButtonElement>("cleanup-confirm")!.disabled).toBe(false);
    await setDays("20");
    expect(q<HTMLInputElement>("cleanup-days")!.value).toBe("20");
    expect(q<HTMLButtonElement>("cleanup-confirm")!.disabled).toBe(true);
    expect(q("cleanup-group-stale")).toBeNull();
    expect(q("cleanup-group-closed")).toBeNull();
    expect(q("cleanup-group-records")).toBeNull();
    await click("cleanup-confirm");
    expect(purge).not.toHaveBeenCalled();
    await click("cleanup-preview"); // a fresh preview for the new value brings the groups back
    expect(q("cleanup-group-stale")).not.toBeNull();
    expect(q<HTMLButtonElement>("cleanup-confirm")!.disabled).toBe(false);
  });

  it("discards a preview still in flight when days changes", async () => {
    let release!: (status: RuntimeStatus) => void;
    vi.spyOn(coordinatorClient, "runtimeStatus").mockReturnValueOnce(new Promise<RuntimeStatus>((resolve) => { release = resolve; }));
    await render();
    await click("cleanup-preview");
    await setDays("30");
    await act(async () => { release(baseStatus); });
    await flush();
    expect(q("cleanup-group-stale")).toBeNull();
    expect(q<HTMLButtonElement>("cleanup-confirm")!.disabled).toBe(true);
  });

  it("closing and reopening the dialog drops the preview", async () => {
    await render();
    await click("cleanup-preview");
    expect(q("cleanup-group-stale")).not.toBeNull();
    await render(false);
    expect(q("cleanup-dialog")).toBeNull();
    await render(true);
    expect(q("cleanup-group-stale")).toBeNull();
    expect(q("cleanup-group-closed")).toBeNull();
    expect(q("cleanup-group-records")).toBeNull();
    expect(q<HTMLButtonElement>("cleanup-confirm")!.disabled).toBe(true);
  });

  it("reopening after a finished run shows no old result table", async () => {
    vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "review_session_stale", status: "closing" });
    vi.spyOn(coordinatorClient, "purgeReviewSession").mockResolvedValue({ session_id: "x", status: "purged", purged_at: OLD, removed: { session_file: true, events_file: true } });
    vi.spyOn(coordinatorClient, "removeConversionRecord").mockResolvedValue(undefined as never);
    await render();
    await click("cleanup-preview");
    await click("cleanup-confirm");
    expect(q("cleanup-done")).not.toBeNull();
    expect(q("cleanup-result-row-review_session_stale")).not.toBeNull();
    await render(false);
    await render(true);
    expect(q("cleanup-done")).toBeNull();
    expect(q("cleanup-result-row-review_session_stale")).toBeNull();
  });

  it("re-reads live state before the run: a stale session that gained a viewer is skipped, not closed or purged", async () => {
    const close = vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "review_session_stale", status: "closing" });
    const purge = vi.spyOn(coordinatorClient, "purgeReviewSession").mockResolvedValue({ session_id: "x", status: "purged", purged_at: OLD, removed: { session_file: true, events_file: true } });
    const remove = vi.spyOn(coordinatorClient, "removeConversionRecord").mockResolvedValue(undefined as never);
    const gainedViewer = { sessions: { items: [
      fx.runtimeSessionSummary({ session_id: "review_session_stale", status: "active", updated_at: OLD, viewer_leases: [], primary_viewer_lease_id: "lease_x" }),
    ] } } as RuntimeStatus;
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValueOnce(baseStatus).mockResolvedValueOnce(gainedViewer); // preview, then the run's re-read
    await render();
    await click("cleanup-preview");
    expect(q("cleanup-group-stale")?.textContent).toContain("review_session_stale");
    await click("cleanup-confirm");
    expect(close).not.toHaveBeenCalled();
    expect(purge.mock.calls.map((c) => c[0])).toEqual(["review_session_closed"]);
    expect(remove).toHaveBeenCalledWith("mw_0123456789abcdef");
    expect(q("cleanup-result-row-review_session_stale")?.textContent).toContain("略過");
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("skips stale sessions it cannot re-verify when the live re-read fails, and still processes the other groups", async () => {
    const close = vi.spyOn(coordinatorClient, "sessionClose");
    const purge = vi.spyOn(coordinatorClient, "purgeReviewSession").mockResolvedValue({ session_id: "x", status: "purged", purged_at: OLD, removed: { session_file: true, events_file: true } });
    vi.spyOn(coordinatorClient, "removeConversionRecord").mockResolvedValue(undefined as never);
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValueOnce(baseStatus).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await render();
    await click("cleanup-preview");
    await click("cleanup-confirm");
    expect(close).not.toHaveBeenCalled();
    expect(purge.mock.calls.map((c) => c[0])).toEqual(["review_session_closed"]);
    expect(q("cleanup-result-row-review_session_stale")?.textContent).toContain("略過");
    expect(q("cleanup-done")).not.toBeNull();
  });

  it("discloses records beyond the server cap instead of implying the preview is complete", async () => {
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 150, items: [fx.conversionRecord({ idempotency_key: "mw_0123456789abcdef", status: "ready", updated_at: OLD, sessions: [] })] });
    await render();
    await click("cleanup-preview");
    expect(q("cleanup-truncation")).not.toBeNull();
    expect(q("cleanup-truncation")?.textContent).toContain("150");
  });

  it("discloses a closed-session list cut off at the page cap", async () => {
    const list = vi.spyOn(coordinatorClient, "listClosedReviewSessions").mockResolvedValue({ items: [], next_cursor: "more" });
    await render();
    await click("cleanup-preview");
    expect(list).toHaveBeenCalledTimes(10);
    expect(q("cleanup-truncation")?.textContent).toContain("500");
  });
});
