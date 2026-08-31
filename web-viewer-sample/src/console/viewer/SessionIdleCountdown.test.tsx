import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionIdleCountdownBanner } from "./SessionIdleCountdownBanner";
import { coordinatorClient } from "../coordinatorClient";

describe("SessionIdleCountdownBanner (session-lifecycle frontend countdown & keepalive)", () => {
  const sessionId = "review_session_test123";
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  const createMockSocket = () => {
    const handlers: Record<string, (payload: { session_id?: string; remaining_seconds?: number; reason?: string }) => void> = {};
    return {
      on: vi.fn((event: string, callback: (payload: { session_id?: string; remaining_seconds?: number; reason?: string }) => void) => {
        handlers[event] = callback;
      }),
      off: vi.fn((event: string) => {
        delete handlers[event];
      }),
      emit: vi.fn(),
      trigger: (event: string, payload: { session_id?: string; remaining_seconds?: number; reason?: string }) => {
        handlers[event]?.(payload);
      },
    };
  };

  it("renders countdown banner when receiving session:idle_countdown event", async () => {
    const socket = createMockSocket();
    await act(async () => {
      root?.render(<SessionIdleCountdownBanner sessionId={sessionId} socket={socket} />);
    });

    expect(container?.querySelector('[data-testid="session-idle-countdown-banner"]')).toBeNull();

    // Trigger idle countdown event
    await act(async () => {
      socket.trigger("session:idle_countdown", {
        session_id: sessionId,
        remaining_seconds: 10,
        reason: "inactivity",
      });
    });

    const banner = container?.querySelector('[data-testid="session-idle-countdown-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("10");
    expect(container?.querySelector('[data-testid="session-idle-keepalive-btn"]')).not.toBeNull();
  });

  it("calls coordinatorClient.recordSessionActivity and dismisses banner on keepalive button click", async () => {
    const socket = createMockSocket();
    const recordSpy = vi.spyOn(coordinatorClient, "recordSessionActivity").mockResolvedValue({
      ok: true,
      session_id: sessionId,
      recorded_at: new Date().toISOString(),
    });
    const onKeepAlive = vi.fn();

    await act(async () => {
      root?.render(
        <SessionIdleCountdownBanner
          sessionId={sessionId}
          socket={socket}
          onKeepAlive={onKeepAlive}
        />,
      );
    });

    await act(async () => {
      socket.trigger("session:idle_countdown", {
        session_id: sessionId,
        remaining_seconds: 8,
        reason: "inactivity",
      });
    });

    const btn = container?.querySelector('[data-testid="session-idle-keepalive-btn"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();

    await act(async () => {
      btn?.click();
    });

    expect(recordSpy).toHaveBeenCalledWith(sessionId);
    expect(socket.emit).toHaveBeenCalledWith("userActivity", { session_id: sessionId });
    expect(onKeepAlive).toHaveBeenCalled();
    expect(container?.querySelector('[data-testid="session-idle-countdown-banner"]')).toBeNull();
  });

  it("dismisses countdown banner when session:idle_countdown_cancelled is received", async () => {
    const socket = createMockSocket();
    await act(async () => {
      root?.render(<SessionIdleCountdownBanner sessionId={sessionId} socket={socket} />);
    });

    await act(async () => {
      socket.trigger("session:idle_countdown", {
        session_id: sessionId,
        remaining_seconds: 10,
      });
    });
    expect(container?.querySelector('[data-testid="session-idle-countdown-banner"]')).not.toBeNull();

    await act(async () => {
      socket.trigger("session:idle_countdown_cancelled", {
        session_id: sessionId,
      });
    });
    expect(container?.querySelector('[data-testid="session-idle-countdown-banner"]')).toBeNull();
  });

  it("renders session-idle-closed alert when session:closed received with reason=inactivity", async () => {
    const socket = createMockSocket();
    const onClosed = vi.fn();

    await act(async () => {
      root?.render(
        <SessionIdleCountdownBanner
          sessionId={sessionId}
          socket={socket}
          onClosed={onClosed}
        />,
      );
    });

    await act(async () => {
      socket.trigger("session:closed", {
        session_id: sessionId,
        reason: "inactivity",
      });
    });

    const closedBanner = container?.querySelector('[data-testid="session-idle-closed"]');
    expect(closedBanner).not.toBeNull();
    expect(closedBanner?.textContent).toContain("會議因長時間未操作已結束");
    expect(onClosed).toHaveBeenCalled();
  });
});
