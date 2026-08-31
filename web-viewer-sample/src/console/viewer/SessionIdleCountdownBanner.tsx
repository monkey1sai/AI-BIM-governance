import React, { useState, useCallback } from "react";
import { coordinatorClient } from "../coordinatorClient";

export interface SessionIdleCountdownBannerProps {
  sessionId: string;
  remainingSeconds: number | null;
  closedReason: string | null;
  recordActivity?: () => Promise<boolean>;
}

export const SessionIdleCountdownBanner: React.FC<SessionIdleCountdownBannerProps> = ({
  sessionId,
  remainingSeconds,
  closedReason,
  recordActivity,
}) => {
  const [keepAliveError, setKeepAliveError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleKeepAlive = useCallback(async () => {
    setIsSubmitting(true);
    setKeepAliveError(null);
    try {
      const accepted = recordActivity
        ? await recordActivity()
        : (await coordinatorClient.recordSessionActivity(sessionId)).ok;
      if (!accepted) {
        setKeepAliveError("保活未獲 coordinator 確認，倒數仍持續");
      }
    } catch {
      setKeepAliveError("保活失敗，倒數仍持續");
    } finally {
      setIsSubmitting(false);
    }
  }, [recordActivity, sessionId]);

  if (closedReason) {
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
          會議因長時間未操作已結束 ({closedReason === "inactivity" ? "閒置自動回收" : closedReason})
        </span>
      </div>
    );
  }

  if (remainingSeconds === null) return null;

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
        disabled={isSubmitting}
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
        {isSubmitting ? "確認中…" : "繼續使用"}
      </button>
      {keepAliveError && <span data-testid="session-idle-keepalive-error">{keepAliveError}</span>}
    </div>
  );
};
