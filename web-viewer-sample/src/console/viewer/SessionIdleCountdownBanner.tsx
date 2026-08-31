import React, { useEffect, useState, useCallback } from "react";
import { coordinatorClient } from "../coordinatorClient";

export interface SessionIdleCountdownBannerProps {
  sessionId: string;
  socket?: {
    on?: (event: string, callback: (payload: { session_id?: string; remaining_seconds?: number; reason?: string }) => void) => void;
    off?: (event: string, callback: (payload: { session_id?: string; remaining_seconds?: number; reason?: string }) => void) => void;
    emit?: (event: string, payload?: unknown) => void;
  };
  onKeepAlive?: () => void;
  onClosed?: () => void;
}

export const SessionIdleCountdownBanner: React.FC<SessionIdleCountdownBannerProps> = ({
  sessionId,
  socket,
  onKeepAlive,
  onClosed,
}) => {
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(10);
  const [isClosed, setIsClosed] = useState(false);
  const [closeReason, setCloseReason] = useState<string | null>(null);

  const handleKeepAlive = useCallback(async () => {
    try {
      await coordinatorClient.recordSessionActivity(sessionId);
    } catch {
      // Ignored if network fails
    }
    if (socket && typeof socket.emit === "function") {
      socket.emit("userActivity", { session_id: sessionId });
    }
    setIsCountingDown(false);
    onKeepAlive?.();
  }, [sessionId, socket, onKeepAlive]);

  useEffect(() => {
    if (!socket || typeof socket.on !== "function") return;

    const onCountdown = (payload: { session_id?: string; remaining_seconds?: number }) => {
      if (payload.session_id === sessionId) {
        setIsCountingDown(true);
        if (typeof payload.remaining_seconds === "number") {
          setRemainingSeconds(payload.remaining_seconds);
        }
      }
    };

    const onCountdownCancelled = (payload: { session_id?: string }) => {
      if (payload.session_id === sessionId) {
        setIsCountingDown(false);
      }
    };

    const onSessionClosed = (payload: { session_id?: string; reason?: string }) => {
      if (payload.session_id === sessionId) {
        setIsCountingDown(false);
        setIsClosed(true);
        setCloseReason(payload.reason || "inactivity");
        onClosed?.();
      }
    };

    socket.on("session:idle_countdown", onCountdown);
    socket.on("session:idle_countdown_cancelled", onCountdownCancelled);
    socket.on("session:closed", onSessionClosed);

    return () => {
      if (typeof socket.off === "function") {
        socket.off("session:idle_countdown", onCountdown);
        socket.off("session:idle_countdown_cancelled", onCountdownCancelled);
        socket.off("session:closed", onSessionClosed);
      }
    };
  }, [sessionId, socket, onClosed]);

  // Global user interaction listener to keep alive while countdown is active
  useEffect(() => {
    if (!isCountingDown) return;

    const onUserInteraction = () => {
      handleKeepAlive();
    };

    window.addEventListener("keydown", onUserInteraction);
    window.addEventListener("pointerdown", onUserInteraction);

    return () => {
      window.removeEventListener("keydown", onUserInteraction);
      window.removeEventListener("pointerdown", onUserInteraction);
    };
  }, [isCountingDown, handleKeepAlive]);

  if (isClosed) {
    return (
      <div
        data-testid="session-idle-closed"
        role="alert"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 9999,
          background: "#fee2e2",
          color: "#991b1b",
          border: "1px solid #f87171",
          borderRadius: 8,
          padding: "12px 20px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontWeight: 600 }}>
          會議因長時間未操作已結束 ({closeReason === "inactivity" ? "閒置自動回收" : closeReason})
        </span>
      </div>
    );
  }

  if (!isCountingDown) return null;

  return (
    <div
      data-testid="session-idle-countdown-banner"
      role="alert"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9999,
        background: "#fef3c7",
        color: "#92400e",
        border: "1px solid #f59e0b",
        borderRadius: 8,
        padding: "12px 20px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span>
        會議閒置中，將在 <strong>{remainingSeconds}</strong> 秒後自動關閉
      </span>
      <button
        type="button"
        data-testid="session-idle-keepalive-btn"
        onClick={handleKeepAlive}
        style={{
          background: "#d97706",
          color: "#ffffff",
          border: "none",
          borderRadius: 4,
          padding: "6px 12px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        繼續使用
      </button>
    </div>
  );
};
