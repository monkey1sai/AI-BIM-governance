import React from "react";

export interface ViewerToolbarProps {
  onResetCamera?: () => void;
  onFitAll?: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  activeMode?: "orbit" | "pan" | "measure" | "section";
  onModeChange?: (mode: "orbit" | "pan" | "measure" | "section") => void;
  measureType?: "distance" | "angle" | "area";
  onMeasureTypeChange?: (type: "distance" | "angle" | "area") => void;
  clipPlaneAxis?: "x" | "y" | "z";
  onClipPlaneAxisChange?: (axis: "x" | "y" | "z") => void;
}

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  onResetCamera,
  onFitAll,
  onToggleFullscreen,
  isFullscreen = false,
  activeMode = "orbit",
  onModeChange,
  measureType = "distance",
  onMeasureTypeChange,
  clipPlaneAxis = "z",
  onClipPlaneAxisChange,
}) => {
  return (
    <div
      className="viewer-toolbar"
      role="toolbar"
      aria-label="3D Viewer Controls"
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
        aria-label="Orbit Camera"
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
        aria-label="Pan Camera"
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
        aria-label="3D Measure"
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

      {activeMode === "measure" && (
        <div style={{ display: "flex", gap: 4, padding: "0 4px", borderLeft: "1px solid #4B5563" }}>
          <button
            type="button"
            onClick={() => onMeasureTypeChange && onMeasureTypeChange("distance")}
            style={{
              fontSize: 11,
              padding: "2px 6px",
              background: measureType === "distance" ? "#2563EB" : "#374151",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            距離
          </button>
          <button
            type="button"
            onClick={() => onMeasureTypeChange && onMeasureTypeChange("angle")}
            style={{
              fontSize: 11,
              padding: "2px 6px",
              background: measureType === "angle" ? "#2563EB" : "#374151",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            角度
          </button>
        </div>
      )}

      <button
        type="button"
        className={"toolbar-btn " + (activeMode === "section" ? "active" : "")}
        onClick={() => onModeChange && onModeChange("section")}
        title="剖切盒 Section"
        aria-label="Section Box"
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

      {activeMode === "section" && (
        <div style={{ display: "flex", gap: 4, padding: "0 4px", borderLeft: "1px solid #4B5563" }}>
          {(["x", "y", "z"] as const).map((axis) => (
            <button
              key={axis}
              type="button"
              onClick={() => onClipPlaneAxisChange && onClipPlaneAxisChange(axis)}
              style={{
                fontSize: 11,
                padding: "2px 6px",
                background: clipPlaneAxis === axis ? "#2563EB" : "#374151",
                color: "#FFFFFF",
                border: "none",
                borderRadius: 3,
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {axis} 軸
            </button>
          ))}
        </div>
      )}

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
