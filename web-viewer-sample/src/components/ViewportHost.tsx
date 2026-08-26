import React from "react";

export interface ViewportHostProps {
  streamState: "idle" | "connecting" | "connected" | "reconnecting" | "failed";
  stageUrl?: string | null;
  selectedPrimPath?: string | null;
  aspectRatio?: string;
  onResetView?: () => void;
  onFitView?: () => void;
  children?: React.ReactNode;
}

export const ViewportHost: React.FC<ViewportHostProps> = ({
  streamState,
  stageUrl,
  selectedPrimPath,
  aspectRatio = "16/9",
  onResetView,
  onFitView,
  children,
}) => {
  return (
    <div
      className="viewport-host-container"
      data-stage-url={stageUrl ?? undefined}
      data-aspect-ratio={aspectRatio}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "#111827",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="viewport-stream-slot"
        style={{
          flex: 1,
          position: "relative",
          width: "100%",
          height: "100%",
        }}
      >
        {children}

        {streamState === "connecting" && (
          <div
            className="viewport-overlay connecting"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(17, 24, 39, 0.75)",
              color: "#F9FAFB",
              zIndex: 20,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div className="spinner" style={{ marginBottom: 12 }}>⚡</div>
              <span>WebRTC 串流連線中...</span>
            </div>
          </div>
        )}

        <div
          className="viewport-status-chip"
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            padding: "4px 10px",
            borderRadius: 6,
            fontSize: 12,
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            color: streamState === "connected" ? "#10B981" : "#F59E0B",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          {streamState === "connected" ? "● 3D 串流已連線" : "○ 串流準備中"}
          {selectedPrimPath ? " | 選取: " + selectedPrimPath : ""}
          {onResetView && onFitView ? " | 可重置" : ""}
        </div>
      </div>
    </div>
  );
};
