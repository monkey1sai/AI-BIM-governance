import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { A1GovernanceWorkbenchPage } from "../A1GovernanceWorkbenchPage";
import { A4SemanticSearchPage } from "../A4SemanticSearchPage";
import { VersionDiffPage } from "../VersionDiffPage";
import { FederationPage, IssuesRuleCenterPage } from "../pages";
import { t, useLang } from "../i18n";
import { ACCENT, MONO } from "./fixtures";
import type { DockKey } from "./fixtures";
import { WorkspaceFlowGuide } from "./WorkspaceFlowGuide";
import { useViewportSlot } from "./viewportSlot";

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

/**
 * Canonical Unified A1-A4 workspace（design §03 IA：左 Stage 樹 · 中 WebRTC viewport · 右工具 Dock）。
 *
 * 中欄只是一個 slot：本頁以 useViewportSlot().registerSlot(el) 註冊矩形，實際 viewer 由 UnifiedShell 掛載的
 * WorkspaceViewportHost（page-root 的 absolute 兄弟層）覆蓋其上，切 dock 不 unmount、同 session 不重 claim。
 * 離線（coordinator 未連線）host 為零 DOM，中欄只顯示誠實說明；沒有 static viewport、沒有 fixture DataChannel 狀態。
 * 右欄 Dock＝原本的 live 模組頁（各自擁有真實 coordinator/governance 呼叫），上方加操作流程導引。
 * 左欄 Stage 樹：vg01 協定無 tree（issue #609）→ 依 spec 誠實停用，不放假資料。
 */
export function WorkspacePage({ initialDock = "a1" }: WorkspacePageProps) {
  const zh = useLang() === "zh";
  const slot = useViewportSlot();
  const [dock, setDock] = useState<DockKey>(() => dockFromHashQuery() ?? initialDock);

  useEffect(() => {
    setDock(dockFromHashQuery() ?? initialDock);
  }, [initialDock]);

  // 中欄 slot ref：identity 穩定（避免每 render 觸發 ref(null)/ref(el)），本頁卸載時解除註冊（host 轉 hidden，不 unmount）。
  const registerSlot = slot?.registerSlot;
  const slotRef = useCallback((el: HTMLElement | null) => { registerSlot?.(el); }, [registerSlot]);
  useEffect(() => () => { registerSlot?.(null); }, [registerSlot]);

  const labels: Record<DockKey, string> = {
    a1: zh ? "A1 治理檢核" : "A1 Governance",
    a2: zh ? "A2 版本差異" : "A2 Version Diff",
    a3: "A3 Federation",
    a4: zh ? "A4 語意查詢" : "A4 Semantic Search",
    issues: "Issues / BCF",
  };

  const openDock = (next: DockKey) => {
    setDock(next);
    window.location.hash = ROUTE_BY_DOCK[next];
  };

  return (
    <div data-uc="unified-live-workspace" data-prov="asbuilt" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderBottom: "1px solid rgba(120,160,210,.10)", background: "var(--ab-bar)", flex: "none" }}>
        {DOCK_KEYS.map((key) => (
          <div
            key={key}
            className="hv-text"
            data-uc={`dock-tab-${key}`}
            data-action="nav"
            role="tab"
            data-active={dock === key ? "true" : "false"}
            onClick={() => openDock(key)}
            style={tabStyle(dock === key)}
          >
            {labels[key]}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <span data-uc="live-contract" style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dim)" }}>
          Coordinator :8004 · Kit primary WebRTC · first frame / stage / ACK fail-closed
        </span>
      </div>

      <div data-uc="ws-columns" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "200px minmax(0,1fr) minmax(400px,36%)" }}>
        {/* 左：Stage 樹（協定缺口 → 誠實停用） */}
        <aside data-uc="ws-stage-tree" data-state="unsupported" aria-disabled="true" style={{ borderRight: "1px solid rgba(120,160,210,.10)", padding: 12, display: "flex", flexDirection: "column", gap: 8, minHeight: 0, overflow: "auto" }}>
          <span style={columnLabel}>{t("Stage 樹", "Stage tree")}</span>
          <span style={{ fontSize: 11.5, color: "var(--ab-text-muted)" }}>
            {t("viewer 協定（vg01）尚未下傳 USD stage 樹；此欄依規格誠實停用，不顯示假結構。", "The viewer protocol (vg01) does not stream the USD stage tree yet; this column stays honestly disabled instead of showing a fake tree.")}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dim)" }}>Roadmap · issue #609</span>
        </aside>

        {/* 中：viewport slot（live 時 host 覆蓋於此；離線只剩下方誠實說明） */}
        <section
          ref={slotRef}
          data-uc="ws-viewport-slot"
          aria-label={t("3D viewport", "3D viewport")}
          style={{ minHeight: 0, minWidth: 0, position: "relative", padding: 12, display: "flex", flexDirection: "column" }}
        >
          <div data-uc="ws-viewport-offline" style={{ flex: 1, minHeight: 0, border: "1px dashed rgba(120,160,210,.18)", borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
            <span style={columnLabel}>WebRTC viewport</span>
            <span style={{ fontSize: 12.5, color: "var(--ab-text-muted)" }}>
              {t("coordinator :8004 未連線時此處為空；連線後 viewer 會覆蓋在這個區域，並由右側 Dock 的「啟動 3D Session」手動啟動。", "Empty while coordinator :8004 is offline; once live, the viewer overlays this area and is started manually from “Start 3D Session” in the dock.")}
            </span>
          </div>
        </section>

        {/* 右：工具 Dock＝流程導引＋live 模組頁 */}
        <aside data-uc="ws-dock" style={{ borderLeft: "1px solid rgba(120,160,210,.10)", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <WorkspaceFlowGuide dock={dock} />
          <main data-uc={`live-module-${dock}`} style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", padding: 12 }}>
            {dock === "a1" ? <A1GovernanceWorkbenchPage /> : null}
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
