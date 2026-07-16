// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 3D Workspace（頂條 dock tabs + stage 樹 + viewport + dock 面板
// + DATACHANNEL 字條）
// 像素級移植正本：scratchpad/design-origin/app.js（ws/workspace 區段）
// 所有 inline style / 文案 byte-identical；互動為 fixture 語意（local state +
// toast 假 API 字串），不打任何 /api。
// dock 初值：props（route #a1..#a4 → a1..a4）；hash query ?dock=issues 覆寫；
// dock tab 點擊只切 local state、不改 hash。
// viewport 背景：/design-assets/vp-<VP_BASE[dock]>.png（cover 置中）。
// 例外（純加性導流）：mount 時唯讀 probe coordinatorClient.health()（GET /health，
// 3s timeout、任何失敗靜默吞掉）。成功 → liveBackend=true → 右欄 dock 標題列尾端
// 顯示「完整工具 ↗」導流 chip（docks.tsx DockLiveLink，data-prov="live"）；
// 離線/超時/例外 → 完全不渲染新 DOM（design gate 離線預設像素零變化鐵則）。
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useLang } from "../i18n";
import { coordinatorClient } from "../coordinatorClient";
import { useUnifiedState } from "./UnifiedShell";
import { A1Dock, A2Dock, A3Dock, A4Dock, IssuesDock } from "./docks";
import type { WsLocal } from "./docks";
import {
  ACCENT, MONO, getL, dockTabs, stageTree, memColors, VP_BASE,
  initialFlags, initialRuleOn, INITIAL_DC_LOG,
} from "./fixtures";
import type { DockKey } from "./fixtures";

const DOCK_KEYS: readonly DockKey[] = ["a1", "a2", "a3", "a4", "issues"];

/** hash query（如 "#a1?dock=issues"）取 dock 覆寫值；無 / 不合法 → null。 */
function dockFromHashQuery(): DockKey | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash;
  const qi = h.indexOf("?");
  if (qi < 0) return null;
  const v = new URLSearchParams(h.slice(qi + 1)).get("dock");
  return v !== null && (DOCK_KEYS as readonly string[]).includes(v) ? (v as DockKey) : null;
}

export interface WorkspacePageProps {
  /** route #a1..#a4 對映的初始 dock（未帶預設 a1）。 */
  initialDock?: DockKey;
}

/* viewport 小工具鈕（原型 vpBtn） */
const vpBtn: CSSProperties = { width: 26, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,16,24,.8)", border: "1px solid rgba(120,160,210,.18)", borderRadius: 6, fontSize: 11, color: "var(--ab-text-muted)", cursor: "pointer" };

export function WorkspacePage({ initialDock }: WorkspacePageProps) {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const u = useUnifiedState();

  const [ws, setWs] = useState<WsLocal>(() => ({
    dock: dockFromHashQuery() ?? initialDock ?? "a1",
    sel: null,
    dcLog: INITIAL_DC_LOG,
    ...initialFlags,
    ruleOn: { ...initialRuleOn },
    opened: {},
  }));
  const patch = useCallback((p: Partial<WsLocal>) => { setWs((w) => ({ ...w, ...p })); }, []);

  /* live 導流 probe：GET /health（3s timeout）。成功才亮 liveBackend；離線/超時/例外
     一律靜默吞掉，不渲染任何新 DOM（像素零變化鐵則）。 */
  const [liveBackend, setLiveBackend] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const probe = coordinatorClient.health();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error("health probe timeout")); }, 3000);
      });
      void Promise.race([probe, timeout])
        .then(() => { if (!cancelled) setLiveBackend(true); })
        .catch(() => { /* 離線/超時/失敗：靜默（fixture 殼維持原樣） */ })
        .finally(() => { if (timer !== undefined) clearTimeout(timer); });
    } catch {
      /* health() 同步例外亦靜默：probe 絕不可炸頁 */
      if (timer !== undefined) clearTimeout(timer);
    }
    return () => { cancelled = true; };
  }, []);

  /* legend：每 dock 文案 / 色（[text, "rgba(r,g,b" 前綴]） */
  const legends: Record<DockKey, readonly [string, string]> = {
    a1: [zh ? "● 檢核失敗 ×18 疊加中" : "● 18 failures overlaid", "rgba(232,97,92"],
    a2: [ws.overlayOn ? (zh ? "■ 差異疊加:新增12 移除4 修改28" : "■ Diff overlay: +12 −4 ~28") : (zh ? "◌ 尚未套用差異疊加" : "◌ overlay not applied"), "rgba(230,178,62"],
    a3: [zh ? "● 5 領域 SubLayer 合成" : "● 5-discipline composition", "rgba(49,197,109"],
    a4: [zh ? "● 不符合 5 · 符合 7" : "● 5 fail · 7 pass", "rgba(232,97,92"],
    issues: [zh ? "◉ Issue 錨點 ×" + u.issues.length : "◉ Issue anchors ×" + u.issues.length, "rgba(65,199,232"],
  };
  const lg = legends[ws.dock];
  // BASE_URL 感知：dev/preview base='/'（design gate 像素跑）、build:ui base='/ui/'（:8004/ui 產品入口）。
  // 根絕對 '/design-assets/…' 在 /ui/ base 下會 404（viewport 背景整個破圖）。
  const vpImage = `${import.meta.env.BASE_URL}design-assets/${VP_BASE[ws.dock]}.png`;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* ---- 頂條：dock tabs + session 膠囊 + Spectator + FPS ---- */}
      <div data-prov="fixture" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderBottom: "1px solid rgba(120,160,210,.10)", background: "var(--ab-bar)", flex: "none" }}>
        {dockTabs.map((d) => (
          <div key={d.id} className="hv-text" data-uc={"dock-tab-" + d.id} data-active={ws.dock === d.id ? "true" : "false"} onClick={() => patch({ dock: d.id, sel: null })} style={{ padding: "6px 13px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: ws.dock === d.id ? 700 : 400, color: ws.dock === d.id ? "var(--ab-on-accent)" : "var(--ab-text-muted)", background: ws.dock === d.id ? `linear-gradient(135deg,${ACCENT},var(--ab-accent-2))` : "transparent" }}>{d.label(L)}</div>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: "10.5px", color: "var(--ab-accent-text)", background: "rgba(65,199,232,.08)", border: "1px solid rgba(65,199,232,.22)", borderRadius: 999, padding: "4px 10px" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ab-accent)", animation: "pulse 2s infinite" }} />S-240601 · editor lease</span>
        <span className="hv-bright" onClick={() => u.toast("已複製 Spectator 邀請連結 /ui/open?session=S-240601&streamRole=spectator(唯讀,resolveGovPanelState gate)")} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ab-on-accent)", fontWeight: 700, background: `linear-gradient(135deg,${ACCENT},var(--ab-accent-2))`, borderRadius: 999, padding: "4px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>+ 邀請 Spectator</span>
        <span style={{ fontFamily: MONO, fontSize: "10.5px", color: "var(--ab-text-dim)" }}>60 FPS · 28 ms</span>
      </div>
      {/* ---- 三欄：stage 樹 / viewport / dock 面板 ---- */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "230px 1fr 316px", minHeight: 0 }}>
        <div data-prov="fixture" style={{ borderRight: "1px solid rgba(120,160,210,.10)", background: "var(--ab-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 8, overflow: "auto" }}>
          {/* 設計稿綁定 {{ L.stagetree }} 在字典中不存在 → dc runtime 渲染為空，保留空 span 以維持相同間距 */}
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".12em", color: "var(--ab-text-dimmer)", textTransform: "uppercase" }} />
          <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--ab-text-muted)" }}>▾ /World</div>
          {stageTree.map((m) => (
            <div key={m.name} className="hv-bg-row" onClick={() => patch({ sel: { name: m.name + " · member", path: "/World/" + m.name }, dcLog: `focusPrimResult ✓ /World/${m.name}` })} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 7, cursor: "pointer", marginLeft: 10, ...(ws.sel !== null && ws.sel.path === "/World/" + m.name ? { background: "rgba(65,199,232,.1)" } : null) }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: memColors[m.name], flex: "none" }} />
              <span style={{ flex: 1, fontSize: 12 }}>{m.name}</span>
              <span style={{ fontFamily: MONO, fontSize: "9.5px", color: "var(--ab-text-dimmer)" }}>{m.ver}</span>
              <span style={{ fontSize: 11, color: "var(--ab-text-code)" }}>◉</span>
            </div>
          ))}
          <div style={{ marginTop: 6, borderTop: "1px solid rgba(120,160,210,.10)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".12em", color: "var(--ab-text-dimmer)", textTransform: "uppercase" }}>Stage</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-muted)", wordBreak: "break-all" }}>/Review/A1_Tower_fed.usd</span>
            <span style={{ fontSize: "10.5px", color: "var(--ab-text-dim)" }}>12.48M tris · 1.17 GB</span>
          </div>
        </div>
        <div data-prov="fixture" style={{ position: "relative", minWidth: 0, background: `var(--ab-black) url('${vpImage}') center/cover no-repeat` }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(5,8,13,.55),rgba(5,8,13,0) 22%,rgba(5,8,13,0) 72%,rgba(5,8,13,.6))" }} />
          <div style={{ position: "absolute", top: 10, left: 12, display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontFamily: MONO, fontSize: 10, background: "rgba(10,16,24,.8)", border: "1px solid rgba(120,160,210,.18)", borderRadius: 6, padding: "3px 8px", color: "var(--ab-text-2)", whiteSpace: "nowrap" }}>/Review/A1_Tower_fed.usd</span>
            <span style={{ fontFamily: MONO, whiteSpace: "nowrap", fontSize: 10, background: "rgba(10,16,24,.8)", border: `1px solid ${lg[1]},.45)`, borderRadius: 6, padding: "3px 8px", color: `${lg[1]},1)` }}>{lg[0]}</span>
          </div>
          <div style={{ position: "absolute", top: 10, right: 12, display: "flex", gap: 4 }}>
            <span className="hv-text" style={vpBtn}>⬒</span>
            <span className="hv-text" style={vpBtn}>✥</span>
            <span className="hv-text" style={vpBtn}>◫</span>
            <span className="hv-text" style={vpBtn}>⟲</span>
          </div>
          {ws.sel !== null ? (
            <div data-uc="sel-callout" style={{ position: "absolute", left: "44%", top: "34%", display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none" }}>
              <div style={{ width: 64, height: 64, border: "1.5px solid var(--ab-accent)", borderRadius: 4, boxShadow: "0 0 0 3px rgba(65,199,232,.18),0 0 24px rgba(65,199,232,.35)" }} />
              <span style={{ fontFamily: MONO, fontSize: 10, background: "rgba(10,16,24,.9)", border: "1px solid rgba(65,199,232,.4)", borderRadius: 6, padding: "3px 8px", color: "var(--ab-accent-bright)", whiteSpace: "nowrap" }}>{ws.sel.name}</span>
            </div>
          ) : null}
          <div style={{ position: "absolute", bottom: 10, left: 12, display: "flex", gap: 6 }}>
            <span data-uc="streaming-pill" style={{ fontFamily: MONO, fontSize: 10, background: "rgba(10,16,24,.8)", border: "1px solid rgba(120,160,210,.18)", borderRadius: 6, padding: "3px 8px", color: "var(--ab-ok-text)" }}>● Streaming · 28 ms</span>
            <span style={{ fontFamily: MONO, fontSize: 10, background: "rgba(10,16,24,.8)", border: "1px solid rgba(120,160,210,.18)", borderRadius: 6, padding: "3px 8px", color: "var(--ab-text-muted)" }}>Omniverse RTX · 60 FPS</span>
          </div>
          <div style={{ position: "absolute", bottom: 10, right: 12, width: 44, height: 44, background: "rgba(10,16,24,.8)", border: "1px solid rgba(120,160,210,.2)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 9, color: "var(--ab-text-muted)" }}>前│右</div>
        </div>
        <div style={{ borderLeft: "1px solid rgba(120,160,210,.10)", background: "var(--ab-panel)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
          {ws.dock === "a1" ? <A1Dock zh={zh} L={L} ws={ws} patch={patch} live={liveBackend} /> : null}
          {ws.dock === "a2" ? <A2Dock zh={zh} L={L} ws={ws} patch={patch} live={liveBackend} /> : null}
          {ws.dock === "a3" ? <A3Dock zh={zh} L={L} ws={ws} patch={patch} live={liveBackend} /> : null}
          {ws.dock === "a4" ? <A4Dock zh={zh} L={L} ws={ws} patch={patch} live={liveBackend} /> : null}
          {ws.dock === "issues" ? <IssuesDock zh={zh} L={L} ws={ws} patch={patch} live={liveBackend} /> : null}
        </div>
      </div>
      {/* ---- DATACHANNEL 字條 ---- */}
      <div data-prov="fixture" style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", borderTop: "1px solid rgba(120,160,210,.10)", background: "var(--ab-bar)", flex: "none", fontFamily: MONO, fontSize: "9.5px", color: "var(--ab-text-dimmer)" }}>
        <span style={{ letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ab-text-faint)" }}>DataChannel</span>
        <span>openedStageResult <span style={{ color: "var(--ab-ok-text)" }}>✓</span></span>
        <span>{ws.dcLog}</span>
        <span>loadingState <span style={{ color: "var(--ab-text-muted)" }}>idle</span></span>
        <span style={{ marginLeft: "auto" }}>lease: <span style={{ color: "var(--ab-accent-text)" }}>editor</span> · spectator ×1</span>
      </div>
    </div>
  );
}
