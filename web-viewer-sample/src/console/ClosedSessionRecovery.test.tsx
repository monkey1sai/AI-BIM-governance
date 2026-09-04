import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClosedSessionRecovery } from "./ClosedSessionRecovery";
import { coordinatorClient, type ClosedReviewSessionItem } from "./coordinatorClient";

const ready: ClosedReviewSessionItem = {
  session_id: "review_session_closed_ready",
  status: "closed",
  project_id: "project-a",
  model_version_id: "model-v1",
  created_at: "2026-09-04T00:00:00Z",
  updated_at: "2026-09-04T00:00:00Z",
  recreated_from_session_id: null,
  rebuildability: { state: "ready", reason: null, checked_at: "2026-09-04T00:00:01Z" },
};

describe("ClosedSessionRecovery", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.restoreAllMocks();
  });

  const flush = async () => {
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  };

  it("shows ready, stale, and unavailable states and keeps non-ready rows disabled", async () => {
    vi.spyOn(coordinatorClient, "listClosedReviewSessions").mockResolvedValue({
      items: [
        ready,
        { ...ready, session_id: "review_session_closed_stale", rebuildability: { state: "stale", reason: "derived artifact is unreachable", checked_at: null } },
        { ...ready, session_id: "review_session_closed_unavailable", rebuildability: { state: "unavailable", reason: "artifact health could not be verified", checked_at: null } },
      ],
      next_cursor: null,
    });
    await act(async () => { root.render(<ClosedSessionRecovery />); });
    await flush();

    expect(container.querySelector<HTMLButtonElement>("[data-testid='closed-session-recreate-review_session_closed_ready']")?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("[data-testid='closed-session-recreate-review_session_closed_stale']")?.disabled).toBe(true);
    expect(container.querySelector("[data-testid='closed-session-row-review_session_closed_stale']")?.textContent).toContain("前往重新轉檔");
    expect(container.querySelector<HTMLButtonElement>("[data-testid='closed-session-recreate-review_session_closed_unavailable']")?.disabled).toBe(true);
  });

  it("keeps one idempotency key across a failed retry and returns the distinct new Session ID", async () => {
    vi.spyOn(coordinatorClient, "listClosedReviewSessions").mockResolvedValue({ items: [ready], next_cursor: null });
    const recreate = vi.spyOn(coordinatorClient, "recreateReviewSession")
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce({
        session_id: "review_session_new",
        status: "active",
        recreated_from_session_id: ready.session_id,
        idempotent_replay: true,
        kit_availability: "configured",
      });
    const onRecreated = vi.fn();
    await act(async () => { root.render(<ClosedSessionRecovery onRecreated={onRecreated} />); });
    await flush();

    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='closed-session-recreate-review_session_closed_ready']")!.click(); });
    expect(container.querySelector("[data-testid='closed-session-confirm']")?.textContent).toContain("原 Session 保持 closed");
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='closed-session-confirm-action']")!.click(); });
    await flush();
    expect(container.querySelector("[data-testid='closed-session-action-error']")).not.toBeNull();

    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='closed-session-confirm-action']")!.click(); });
    await flush();
    expect(recreate).toHaveBeenCalledTimes(2);
    expect(recreate.mock.calls[0][1]).toBe(recreate.mock.calls[1][1]);
    expect(recreate.mock.calls[0][1]).toMatch(/^closed-recreate-/);
    expect(onRecreated).toHaveBeenCalledWith(expect.objectContaining({ session_id: "review_session_new" }), ready);
    expect(container.querySelector("[data-testid='closed-session-success']")?.textContent).toContain("review_session_new");
  });
});
