import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { A1GovernanceWorkbenchPage } from "../A1GovernanceWorkbenchPage";
import { A4SemanticSearchPage } from "../A4SemanticSearchPage";
import { VersionDiffPage } from "../VersionDiffPage";
import { FederationPage, IssuesRuleCenterPage } from "../pages";
import { useLang } from "../i18n";
import { ACCENT, MONO } from "./fixtures";
import type { DockKey } from "./fixtures";

const DOCK_KEYS: readonly DockKey[] = ["a1", "a2", "a3", "a4", "issues"];
const ROUTE_BY_DOCK: Record<DockKey, string> = {
  a1: "#a1",
  a2: "#a2",
  a3: "#a3",
  a4: "#a4",
  issues: "#workspace?dock=issues",
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

/**
 * Canonical Unified A1-A4 workspace.
 *
 * Each route renders the existing live module directly inside Unified Console.
 * Those modules own their real coordinator/governance calls and all 3D paths
 * reuse ReviewSessionViewerPane. There is deliberately no static viewport or
 * fixture DataChannel status in this shell: no session/frame/stage/ACK means
 * the module's explicit unavailable/loading state remains visible.
 */
export function WorkspacePage({ initialDock = "a1" }: WorkspacePageProps) {
  const zh = useLang() === "zh";
  const [dock, setDock] = useState<DockKey>(() => dockFromHashQuery() ?? initialDock);

  useEffect(() => {
    setDock(dockFromHashQuery() ?? initialDock);
  }, [initialDock]);

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

      <main data-uc={`live-module-${dock}`} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
        {dock === "a1" ? <A1GovernanceWorkbenchPage /> : null}
        {dock === "a2" ? <VersionDiffPage /> : null}
        {dock === "a3" ? <FederationPage /> : null}
        {dock === "a4" ? <A4SemanticSearchPage /> : null}
        {dock === "issues" ? <IssuesRuleCenterPage /> : null}
      </main>
    </div>
  );
}
