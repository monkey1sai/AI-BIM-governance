import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { A1GovernanceWorkbenchPage } from "../A1GovernanceWorkbenchPage";
import { A4SemanticSearchPage } from "../A4SemanticSearchPage";
import { VersionDiffPage } from "../VersionDiffPage";
import { FederationPage, IssuesRuleCenterPage } from "../pages";
import { t, useLang } from "../i18n";
import { ACCENT, MONO } from "./fixtures";
import type { DockKey } from "./fixtures";
import { WorkspaceFlowGuide } from "./WorkspaceFlowGuide";
import { SectionPlaneControls } from "./SectionPlaneControls";
import { MeasurementControls } from "./MeasurementControls";
import { resolveViewerCommandGate, useViewportSlot } from "./viewportSlot";
import { useUsdStageTree, type USDPrimNode } from "../../hooks/useUsdStageTree";
import { HelpHint } from "../components";
import { useViewerFullscreen } from "./useViewerFullscreen";

const DOCK_KEYS: readonly DockKey[] = ["a1", "a2", "a3", "a4", "issues"];
const ROUTE_BY_DOCK: Record<DockKey, string> = {
  a1: "#a1",
  a2: "#a2",
  a3: "#a3",
  a4: "#a4",
  issues: "#issues",
};

function dockFromHashQuery(): DockKey | null {
  if (typeof window === "undefined") return null;
  const queryStart = window.location.hash.indexOf("?");
  if (queryStart < 0) return null;
  const value = new URLSearchParams(window.location.hash.slice(queryStart + 1)).get("dock");
  return value !== null && (DOCK_KEYS as readonly string[]).includes(value) ? value as DockKey : null;
}

export interface WorkspacePageProps {
  initialDock?: DockKey;
}

const tabStyle = (active: boolean): CSSProperties => ({
  padding: "6px 13px",
  borderRadius: 8,
  fontSize: 12,
  cursor: "pointer",
  fontWeight: active ? 700 : 400,
  color: active ? "var(--ab-on-accent)" : "var(--ab-text-muted)",
  background: active ? `linear-gradient(135deg,${ACCENT},var(--ab-accent-2))` : "transparent",
});

const columnLabel: CSSProperties = {
  fontFamily: MONO, fontSize: 9.5, letterSpacing: ".12em", color: "var(--ab-text-dimmer)", textTransform: "uppercase",
};

const toolbarBtnStyle = (disabled: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 8px",
  fontSize: 12,
  fontFamily: MONO,
  borderRadius: 6,
  border: "1px solid rgba(120,160,210,.25)",
  background: disabled ? "rgba(120,160,210,.05)" : "rgba(120,160,210,.12)",
  color: disabled ? "var(--ab-text-dim)" : "var(--ab-text)",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "all .15s ease",
});

function StageTreeNodeView({
  node,
  expandedPaths,
  selectedPrims,
  onToggle,
  onSelect,
  disabled,
}: {
  node: USDPrimNode;
  expandedPaths: Set<string>;
  selectedPrims: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  disabled: boolean;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPrims.has(node.path);
  // Production Kit omits children for leaves and uses [] for a lazy branch.
  const hasChildren = node.children !== undefined;

  return (
    <div style={{ marginLeft: 8, fontSize: 11 }}>
      <div
        data-uc="stage-tree-item"
        data-path={node.path}
        data-selected={isSelected ? "true" : "false"}
        aria-disabled={disabled}
        onClick={() => { if (!disabled) onSelect(node.path); }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 4px",
          borderRadius: 4,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          background: isSelected ? "rgba(120,160,210,.25)" : "transparent",
        }}
      >
        {hasChildren ? (
          <span
            data-testid={`expand-toggle-${node.path}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled) onToggle(node.path);
            }}
            style={{ cursor: "pointer", userSelect: "none", width: 12 }}
          >
            {isExpanded ? "▾" : "▸"}
          </span>
        ) : (
          <span style={{ width: 12 }} />
        )}
        <span style={{ fontFamily: MONO, color: "var(--ab-text)" }}>{node.name || node.path}</span>
        {node.type ? (
          <span style={{ fontSize: 9, color: "var(--ab-text-dim)", fontFamily: MONO }}>[{node.type}]</span>
        ) : null}
      </div>
      {isExpanded && node.children ? (
        <div>
          {node.children.map((child) => (
            <StageTreeNodeView
              key={child.path}
              node={child}
              expandedPaths={expandedPaths}
              selectedPrims={selectedPrims}
              onToggle={onToggle}
              onSelect={onSelect}
              disabled={disabled}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Canonical Unified A1-A4 workspace（design §03 IA：左 Stage 樹 · 中 WebRTC viewport · 右工具 Dock）。
 *
 * 中欄只是一個 slot：本頁以 useViewportSlot().registerSlot(el) 註冊矩形，實際 viewer 由 UnifiedShell 掛載的
 * WorkspaceViewportHost（page-root 的 absolute 兄弟層）覆蓋其上，切 dock 不 unmount、同 session 不重 claim。
 * 離線（coordinator 未連線）host 為零 DOM，中欄只顯示誠實說明；沒有 static viewport、沒有 fixture DataChannel 狀態。
 * 右欄 Dock＝原本的 live 模組頁（各自擁有真實 coordinator/governance 呼叫），上方加操作流程導引。
 * 左欄 Stage 樹：當 viewer 下傳真實 USD 樹時切換為可互動狀態，離線或未提供時誠實停用。
 */
export function WorkspacePage({ initialDock = "a1" }: WorkspacePageProps) {
  const zh = useLang() === "zh";
  const slot = useViewportSlot();
  const fullscreen = useViewerFullscreen();
  const exitButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (fullscreen.expanded) exitButtonRef.current?.focus(); }, [fullscreen.expanded]);
  const [dock, setDock] = useState<DockKey>(() => dockFromHashQuery() ?? initialDock);
  const [a1Visited, setA1Visited] = useState(dock === "a1");
  useEffect(() => { if (dock === "a1") setA1Visited(true); }, [dock]);

  const stageTreeApi = useUsdStageTree();
  const rawTree = slot?.stageTree;
  useEffect(() => {
    if (!rawTree) return;
    stageTreeApi.setUsdPrims(rawTree);
    if (rawTree.length === 0) {
      stageTreeApi.resetTree();
      return;
    }
    for (const node of rawTree) {
      if (node.children?.length && !stageTreeApi.expandedPaths.has(node.path)) {
        stageTreeApi.toggleExpand(node.path);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTree]);

  const hasStageTree = Boolean(stageTreeApi.usdPrims && stageTreeApi.usdPrims.length > 0);

  useEffect(() => {
    setDock(dockFromHashQuery() ?? initialDock);
  }, [initialDock]);

  const activeSessionId = slot?.activeSessionId;

  // 中欄 slot ref：identity 穩定（避免每 render 觸發 ref(null)/ref(el)），本頁卸載時解除註冊（host 轉 hidden，不 unmount）。
  const registerControls = slot?.registerControls;
  const controlsRef = useCallback((el: HTMLElement | null) => { registerControls?.(el); }, [registerControls]);
  const registerSlot = slot?.registerSlot;
  const slotRef = useCallback((el: HTMLElement | null) => { registerSlot?.(el); }, [registerSlot]);
  // 只由 ref(null) 清理卸載；effect cleanup 也會在 DOM 尚連接的熱更新／replay 執行。

  const openDock = (next: DockKey) => {
    setDock(next);
    if (typeof window !== "undefined") {
      const nextHash = ROUTE_BY_DOCK[next] ?? `#${next}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, "", nextHash);
      }
    }
  };

  const labels: Record<DockKey, string> = {
    a1: zh ? "A1 治理檢核" : "A1 Governance",
    a2: zh ? "A2 版本差異" : "A2 Version Diff",
    a3: "A3 Federation",
    a4: zh ? "A4 語意查詢" : "A4 Semantic Search",
    issues: "Issues / BCF",
  };

  const toolbarDisabled = !resolveViewerCommandGate(slot?.gate ?? null).canSend;

  return (
    <div
      ref={fullscreen.workspaceRef}
      data-uc="unified-live-workspace"
      data-prov="asbuilt"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "var(--ab-bg)",
        color: "var(--ab-text)",
      }}
    >
      {/* 頂部 Dock 切換列 */}
      <div
        data-uc="ws-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 16px",
          borderBottom: "1px solid rgba(120,160,210,.14)",
          background: "var(--ab-surface)",
        }}
      >
        <span style={columnLabel}>{t("工作台", "Workspace")}</span>
        {DOCK_KEYS.map((key) => (
          <div
            key={key}
            className="hv-text"
            data-uc={`dock-tab-${key}`}
            data-action="nav"
            role="tab"
            aria-selected={dock === key}
            tabIndex={0}
            data-testid={`ws-tab-${key}`}
            data-active={dock === key ? "true" : "false"}
            onClick={() => openDock(key)}
            style={tabStyle(dock === key)}
          >
            {labels[key]}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <HelpHint label={t("3D 連線條件", "3D connection requirements")} text="Coordinator :8004 · Kit primary WebRTC · first frame / stage / ACK fail-closed" />
      </div>

      <div data-uc="ws-columns" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "250px minmax(0,1fr) minmax(300px,30%)" }}>
        {/* 左：Stage 樹 */}
        <aside
          data-uc="ws-stage-tree"
          data-state={hasStageTree ? (toolbarDisabled ? "blocked" : "active") : activeSessionId ? "waiting" : "unsupported"}
          aria-label={t("模型結構與檢視工具", "Model structure and viewing tools")}
          style={{ borderRight: "1px solid rgba(120,160,210,.10)", padding: 12, display: "flex", flexDirection: "column", gap: 8, minHeight: 0, overflow: "auto" }}
        >
          {/* 工具列（Issue #605）—— 保持置頂且 zIndex: 10，永不被下方 ViewportHost 覆蓋 */}
          <div
            data-uc="ws-viewport-toolbar"
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 8,
              alignItems: "center",
              position: "relative",
              zIndex: 10,
            }}
          >
            <button
              data-testid="ws-toolbar-camera-view"
              title={t("相機視角尚未接通（Roadmap）", "Camera views are not connected yet (Roadmap)")}
              disabled
              style={toolbarBtnStyle(true)}
            >
              ⬒
            </button>
            <button
              ref={fullscreen.buttonRef}
              data-testid="ws-toolbar-fullscreen"
              title={t("在 App 內滿版顯示同一個 Viewer，不重新連線；可按退出或 Esc", "Fill the app with the same viewer without reconnecting; use Exit or Esc")}
              aria-label={fullscreen.expanded ? t("退出全螢幕", "Exit fullscreen") : t("全螢幕觀看 3D", "View 3D fullscreen")}
              aria-pressed={fullscreen.expanded}
              onClick={() => { void (fullscreen.expanded ? fullscreen.exit() : fullscreen.enter()); }}
              style={{ ...toolbarBtnStyle(false), width: "auto", padding: "0 12px", gap: 6 }}
            >
              <span aria-hidden="true">⛶</span> {fullscreen.expanded ? t("退出", "Exit") : t("全螢幕", "Fullscreen")}
            </button>
            <button
              data-testid="ws-toolbar-projection"
              title={t("投影模式尚未接通（Roadmap）", "Projection mode is not connected yet (Roadmap)")}
              disabled
              style={toolbarBtnStyle(true)}
            >
              ◫
            </button>
            <button
              data-testid="ws-toolbar-reset"
              title={t("重置視角並清除選取 (⟲)", "Reset camera and clear selection (⟲)")}
              disabled={toolbarDisabled}
              onClick={() => {
                stageTreeApi.clearSelection();
                slot?.sendToolbarAction("reset_camera");
              }}
              style={toolbarBtnStyle(toolbarDisabled)}
            >
              ⟲
            </button>
            {activeSessionId ? (
              <HelpHint label="Session" text={`Session: ${activeSessionId}`} />
            ) : null}
            {fullscreen.expanded && <span className="op-fullscreen-note" role="status">{t("App 內滿版 · Esc 退出", "In-app fullscreen · Esc to exit")}</span>}
          </div>

          <nav className="op-viewer-tools" aria-label={t("Viewer 工具", "Viewer tools")}>
            <button disabled={!activeSessionId} onClick={event => {
              const details = event.currentTarget.closest("aside")?.querySelector<HTMLDetailsElement>(".op-viewer-model");
              if (details) { details.open = !details.open; details.querySelector<HTMLElement>("summary")?.focus(); }
            }}>{t("模型", "Model")}</button>
            <button onClick={() => openDock("issues")}>{t("問題 · 治理", "Issues · Governance")}</button>
            <button disabled title={t("批註尚未實作", "Annotations are not implemented")}>{t("批註", "Annotations")}</button>
            <button disabled title={t("書籤尚未實作", "Bookmarks are not implemented")}>{t("書籤", "Bookmarks")}</button>
          </nav>
          <div ref={controlsRef} data-uc="ws-viewer-controls" />
          {!activeSessionId && <p className="op-empty-caption">{t("先在右側選擇模型與審查，再從這裡啟動 3D。", "Choose a model and review on the right, then start 3D here.")}</p>}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={columnLabel}>{t("Stage 樹", "Stage tree")}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {slot?.activeSessionId ? (
                <button
                  data-testid="ws-request-stage-tree-btn"
                  title={toolbarDisabled
                    ? t("viewer 尚未就緒，無法請求 Stage 樹", "The viewer is not ready; Stage tree request is disabled")
                    : t("向 Kit 重新請求 Stage 樹", "Request Stage tree from Kit")}
                  disabled={toolbarDisabled}
                  onClick={() => slot?.requestStageTree("/World")}
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(120,160,210,.15)",
                    border: "1px solid rgba(120,160,210,.3)",
                    color: "var(--ab-text)",
                    cursor: toolbarDisabled ? "not-allowed" : "pointer",
                    opacity: toolbarDisabled ? 0.55 : 1,
                  }}
                >
                  {t("重整", "Refresh")}
                </button>
              ) : null}
              {hasStageTree && !toolbarDisabled ? (
                <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-accent)" }}>Live</span>
              ) : hasStageTree || activeSessionId ? (
                <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dim)" }}>{t("等待 viewer", "Waiting for viewer")}</span>
              ) : (
                <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dim)" }}>{t("未載入", "Not loaded")}</span>
              )}
            </div>
          </div>
          {hasStageTree ? (
            <>
              {slot?.selectedStagePaths?.map(path => <p key={path} data-testid="stage-selected-path" style={{ overflowWrap: "anywhere" }}>已選取：{path}</p>)}
              <input
                data-uc="ws-stage-search"
                type="text"
                disabled={toolbarDisabled}
                placeholder={t("搜尋 prim...", "Search prim...")}
                value={stageTreeApi.searchQuery}
                onChange={(e) => { if (!toolbarDisabled) stageTreeApi.setSearchQuery(e.target.value); }}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  borderRadius: 4,
                  border: "1px solid rgba(120,160,210,.18)",
                  background: "var(--ab-surface)",
                  color: "var(--ab-text)",
                }}
              />
              <div style={{ flex: 1, overflow: "auto" }}>
                {stageTreeApi.filteredPrims.map((rootNode) => (
                  <StageTreeNodeView
                    key={rootNode.path}
                    node={rootNode}
                    expandedPaths={stageTreeApi.expandedPaths}
                    selectedPrims={slot?.selectedStagePaths ? new Set(slot.selectedStagePaths) : stageTreeApi.selectedPrims}
                    disabled={toolbarDisabled}
                    onToggle={(path) => {
                      const expanding = !stageTreeApi.expandedPaths.has(path);
                      const node = stageTreeApi.findNodeByPath(path);
                      stageTreeApi.toggleExpand(path);
                      if (expanding && node?.children?.length === 0) slot?.requestStageTree(path);
                    }}
                    onSelect={(p) => {
                      stageTreeApi.selectPrim(p);
                      slot?.selectPrim(p);
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            <HelpHint label={t("模型結構說明", "Model structure help")} text={t("尚未收到模型結構。3D 就緒後可按「重整」重新取得；剖切與量測依各自連線狀態啟用。", "Model structure has not arrived. Refresh it when 3D is ready; section and measurement tools use their own connection state.")} />
          )}
          <details className="op-tool-disclosure"><summary>{t("剖切", "Section plane")}</summary>
          <SectionPlaneControls ready={!toolbarDisabled} state={slot?.sectionState ?? { status: "idle" }} onSend={input => slot?.sendSectionPlane?.(input)} />
          </details>
          <details className="op-tool-disclosure"><summary>{t("距離量測", "Distance measurement")}</summary>
          <MeasurementControls ready={!toolbarDisabled} state={slot?.measurementState ?? { status: "idle" }} onSend={action => slot?.sendMeasurement?.(action)} />
          </details>
        </aside>

        {/* 中：viewport slot（live 時 host 覆蓋於容器；離線只剩下方誠實說明） */}
        <section
          data-uc="ws-viewport-slot"
          aria-label={t("3D viewport", "3D viewport")}
          style={{ minHeight: 0, minWidth: 0, position: "relative", padding: 12, display: "flex", flexDirection: "column" }}
        >
          {fullscreen.expanded && <button ref={exitButtonRef} className="op-fullscreen-exit" aria-label={t("退出全螢幕", "Exit fullscreen")} onClick={fullscreen.exit}>{t("退出全螢幕", "Exit fullscreen")} · Esc</button>}
          {/* 容器 slot：由 WorkspaceViewportHost 覆蓋於此，不遮擋上方的工具列 */}
          <div
            ref={slotRef}
            data-uc="ws-viewport-container"
            style={{
              flex: 1,
              minHeight: 0,
              position: "relative",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div data-uc="ws-viewport-offline" aria-label={t("3D Viewer；連線狀態與操作在左側", "3D Viewer; status and controls are on the left")} style={{ flex: 1, minHeight: 0 }} />
          </div>
        </section>

        {/* 右：工具 Dock＝流程導引＋live 模組頁 */}
        <aside data-uc="ws-dock" style={{ borderLeft: "1px solid rgba(120,160,210,.10)", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <WorkspaceFlowGuide dock={dock} />
          <main data-uc={`live-module-${dock}`} style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", padding: 12 }}>
            {a1Visited || dock === "a1" ? <div hidden={dock !== "a1"}>
              <A1GovernanceWorkbenchPage active={dock === "a1"} />
            </div> : null}
            {dock === "a2" ? <VersionDiffPage /> : null}
            {dock === "a3" ? <FederationPage /> : null}
            {dock === "a4" ? <A4SemanticSearchPage /> : null}
            {dock === "issues" ? <IssuesRuleCenterPage /> : null}
          </main>
        </aside>
      </div>
    </div>
  );
}
