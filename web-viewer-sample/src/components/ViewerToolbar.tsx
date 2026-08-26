import React from "react";

export interface ViewerToolbarProps {
  onResetCamera?: () => void;
  onFitAll?: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  activeMode?: "orbit" | "pan" | "measure" | "section";
  onModeChange?: (mode: "orbit" | "pan" | "measure" | "section") => void;
}

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  onResetCamera,
  onFitAll,
  onToggleFullscreen,
  isFullscreen = false,
  activeMode = "orbit",
  onModeChange,
}) => {
  return (
    <div
      className="viewer-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        backgroundColor: "#1F2937",
        borderBottom: "1px solid #374151",
      }}
    >
      <button
        type="button"
        className={"toolbar-btn " + (activeMode === "orbit" ? "active" : "")}
        onClick={() => onModeChange && onModeChange("orbit")}
        title="旋轉視角 Orbit"
        style={{
          padding: "4px 8px",
          background: activeMode === "orbit" ? "#3B82F6" : "#374151",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        ⬒ 旋轉
      </button>

      <button
        type="button"
        className={"toolbar-btn " + (activeMode === "pan" ? "active" : "")}
        onClick={() => onModeChange && onModeChange("pan")}
        title="平移視角 Pan"
        style={{
          padding: "4px 8px",
          background: activeMode === "pan" ? "#3B82F6" : "#374151",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        ✥ 平移
      </button>

      <button
        type="button"
        className={"toolbar-btn " + (activeMode === "measure" ? "active" : "")}
        onClick={() => onModeChange && onModeChange("measure")}
        title="3D 測量 Measure"
        style={{
          padding: "4px 8px",
          background: activeMode === "measure" ? "#3B82F6" : "#374151",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        📏 測量
      </button>

      <button
        type="button"
        className={"toolbar-btn " + (activeMode === "section" ? "active" : "")}
        onClick={() => onModeChange && onModeChange("section")}
        title="剖切盒 Section"
        style={{
          padding: "4px 8px",
          background: activeMode === "section" ? "#3B82F6" : "#374151",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        ◫ 剖切
      </button>

      <div style={{ flex: 1 }} />

      <button
        type="button"
        className="toolbar-btn"
        onClick={onFitAll}
        title="適應視窗 Fit All"
        style={{
          padding: "4px 8px",
          background: "#374151",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        ⛶ 適應
      </button>

      <button
        type="button"
        className="toolbar-btn"
        onClick={onResetCamera}
        title="重置視角 Reset"
        style={{
          padding: "4px 8px",
          background: "#374151",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        ⟲ 重置
      </button>

      <button
        type="button"
        className="toolbar-btn"
        onClick={onToggleFullscreen}
        title={isFullscreen ? "結束全螢幕" : "全螢幕"}
        style={{
          padding: "4px 8px",
          background: "#374151",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        {isFullscreen ? "縮小" : "⛶ 全螢幕"}
      </button>
    </div>
  );
};
