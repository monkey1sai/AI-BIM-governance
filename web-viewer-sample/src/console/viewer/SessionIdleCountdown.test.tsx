import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionIdleCountdownBanner } from "./SessionIdleCountdownBanner";

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

  it("renders the countdown state supplied by the production Socket event owner", async () => {
    await act(async () => {
      root?.render(<SessionIdleCountdownBanner sessionId={sessionId} remainingSeconds={10} closedReason={null} />);
    });

    const banner = container?.querySelector('[data-testid="session-idle-countdown-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("10");
    expect(container?.querySelector('[data-testid="session-idle-keepalive-btn"]')).not.toBeNull();
  });

  it("requires a positive coordinator acknowledgement before treating keepalive as accepted", async () => {
    const recordActivity = vi.fn().mockResolvedValue(false);

    await act(async () => {
      root?.render(
        <SessionIdleCountdownBanner
          sessionId={sessionId}
          remainingSeconds={8}
          closedReason={null}
          recordActivity={recordActivity}
        />,
      );
    });

    const btn = container?.querySelector('[data-testid="session-idle-keepalive-btn"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();

    await act(async () => {
      btn?.click();
    });

    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('[data-testid="session-idle-countdown-banner"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="session-idle-keepalive-error"]')?.textContent).toContain("未獲 coordinator 確認");
  });

  it("dismisses the banner when the event owner supplies a cancelled state", async () => {
    await act(async () => {
      root?.render(<SessionIdleCountdownBanner sessionId={sessionId} remainingSeconds={10} closedReason={null} />);
    });
    expect(container?.querySelector('[data-testid="session-idle-countdown-banner"]')).not.toBeNull();

    await act(async () => {
      root?.render(<SessionIdleCountdownBanner sessionId={sessionId} remainingSeconds={null} closedReason={null} />);
    });
    expect(container?.querySelector('[data-testid="session-idle-countdown-banner"]')).toBeNull();
  });

  it("clears a stale keepalive error when a later countdown cycle starts", async () => {
    const recordActivity = vi.fn().mockResolvedValue(false);
    await act(async () => {
      root?.render(
        <SessionIdleCountdownBanner
          sessionId={sessionId}
          remainingSeconds={8}
          closedReason={null}
          recordActivity={recordActivity}
        />,
      );
    });
    const btn = container?.querySelector('[data-testid="session-idle-keepalive-btn"]') as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });
    expect(container?.querySelector('[data-testid="session-idle-keepalive-error"]')).not.toBeNull();

    await act(async () => {
      root?.render(
        <SessionIdleCountdownBanner
          sessionId={sessionId}
          remainingSeconds={null}
          closedReason={null}
          recordActivity={recordActivity}
        />,
      );
    });
    await act(async () => {
      root?.render(
        <SessionIdleCountdownBanner
          sessionId={sessionId}
          remainingSeconds={10}
          closedReason={null}
          recordActivity={recordActivity}
        />,
      );
    });

    expect(container?.querySelector('[data-testid="session-idle-keepalive-error"]')).toBeNull();
  });

  it("renders session-idle-closed alert from the production session:closed state", async () => {
    await act(async () => {
      root?.render(
        <SessionIdleCountdownBanner
          sessionId={sessionId}
          remainingSeconds={null}
          closedReason="inactivity"
        />,
      );
    });

    const closedBanner = container?.querySelector('[data-testid="session-idle-closed"]');
    expect(closedBanner).not.toBeNull();
    expect(closedBanner?.textContent).toContain("會議因長時間未操作已結束");
  });

  it("renders generic close copy for a recovered non-idle terminal state", async () => {
    await act(async () => {
      root?.render(
        <SessionIdleCountdownBanner
          sessionId={sessionId}
          remainingSeconds={null}
          closedReason="recovered_close"
        />,
      );
    });

    const closedBanner = container?.querySelector('[data-testid="session-idle-closed"]');
    expect(closedBanner?.textContent).toBe("會議已結束");
    expect(closedBanner?.textContent).not.toContain("長時間未操作");
  });
});
