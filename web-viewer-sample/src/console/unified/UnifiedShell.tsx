// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 殼層（頂列 + 側欄 + Toast host + state provider）
// 像素級移植正本：scratchpad/design-origin/app.js（topbar / sidebar / toast 區塊）
// unified-console-runtime-truth slice 1：頂列狀態 chips（Coordinator／Governance／Kit Runtime／GPU）與側欄
// 「生產線狀態」badge 改綁 coordinator :8004 真值（共用 poller，ConsoleDataProvider 注入 live 單例）；
// 字面 GPU chip 已移除。導覽一律 window.location.hash 賦值。
// data-uc / data-active / data-state / data-health 屬性為 design gate semantic contract 與 vitest 定位用，像素中性。
// ═══════════════════════════════════════════════════════════════════════
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { setLang, useLang } from "../i18n";
import {
  MONO, getL, navMain, apps, badgeTone, navItem, INITIAL_ISSUE_SEQ, initialIssues,
} from "./fixtures";
import type {
  ConceptKey, DockKey, IssueItem, OutboxItem, PageKey,
} from "./fixtures";
import { ConsoleDataProvider } from "./ConsoleDataProvider";
import { useConsoleData } from "./consoleData";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import type { EndpointKey } from "./coordinatorStatusStore";
import { HEALTH_DOT, cell, cellText, conversionCounts, healthOf, kitMediaSuspect } from "./runtimeTruth";
import type { HealthState } from "./runtimeTruth";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { WorkspaceViewportHost } from "./WorkspaceViewportHost";
import "./unified.css";
import "./operator-workflow.css";

/* ═══ UnifiedState context（docks／WorkspacePage 的 issues/outbox local state + toast；intake/conv/sessions 已由共用 poller 取代）═══ */

export interface UnifiedStateShape {
  issues: IssueItem[];
  outbox: OutboxItem[];
  issueSeq: number;
}

export interface UnifiedStateApi extends UnifiedStateShape {
  /** setState 類 API：淺合併 patch（對應原型 setState(patch)）。 */
  patch: (p: Partial<UnifiedStateShape>) => void;
  /** 顯示 toast，2600ms 自動消失；重複呼叫重置計時器。 */
  toast: (msg: string) => void;
  toastMsg: string;
}

const UnifiedStateContext = createContext<UnifiedStateApi | null>(null);

export function useUnifiedState(): UnifiedStateApi {
  const v = useContext(UnifiedStateContext);
  if (!v) throw new Error("useUnifiedState must be used within UnifiedStateProvider");
  return v;
}

export function UnifiedStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UnifiedStateShape>(() => ({
    issues: [...initialIssues], // slice-2 欠帳：Issues/BCF dock（§2）仍 fixture 種入（P3 f1）
    outbox: [],
    issueSeq: INITIAL_ISSUE_SEQ,
  }));
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<number | null>(null);

  const toast = useCallback((msg: string) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = window.setTimeout(() => { setToastMsg(""); }, 2600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const patch = useCallback((p: Partial<UnifiedStateShape>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  const value = useMemo<UnifiedStateApi>(
    () => ({ ...state, patch, toast, toastMsg }),
    [state, patch, toast, toastMsg],
  );

  return <UnifiedStateContext.Provider value={value}>{children}</UnifiedStateContext.Provider>;
}

/* ═══ 殼層 ═══ */

export interface UnifiedShellProps {
  /** 當前 hash route 對應的頁面 key（active 判定用）。 */
  page: PageKey | "models" | "sessions" | "conversion";
  /** page="ws" 時的 dock tab（A1–A4 / issues 的 active 判定）。 */
  dock?: DockKey;
  /** page="concept" 時的概念頁 key（A5–A10 的 active 判定）。 */
  concept?: ConceptKey;
  children?: ReactNode;
}

/** 殼層自身訂閱的端點（頂列三 chip、GPU chip、側欄轉檔 badge）。模組層常數：identity 穩定。 */
const SHELL_KEYS: readonly EndpointKey[] = ["runtimeStatus", "ruleRuns", "kitHealth", "conversionRecords"];

export function UnifiedShell(props: UnifiedShellProps) {
  return (
    <ConsoleDataProvider store={coordinatorStatusStore}>
      <UnifiedStateProvider>
        <ShellFrame {...props} />
      </UnifiedStateProvider>
    </ConsoleDataProvider>
  );
}

const chipBase: CSSProperties = { display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, fontSize: 11 };
const chipByHealth: Record<HealthState, CSSProperties> = {
  ok: { ...chipBase, background: "rgba(49,197,109,.10)", border: "1px solid rgba(49,197,109,.25)", color: "var(--ab-ok-text)" },
  degraded: { ...chipBase, background: "rgba(232,97,92,.10)", border: "1px solid rgba(232,97,92,.3)", color: "var(--ab-danger)" },
  unknown: { ...chipBase, background: "rgba(230,178,62,.08)", border: "1px solid rgba(230,178,62,.3)", color: "var(--ab-warn)" },
};
const chipUnavailable: CSSProperties = { ...chipBase, background: "rgba(120,160,210,.06)", border: "1px solid rgba(120,160,210,.14)", color: "var(--ab-text-dim)", fontFamily: MONO };

function ShellFrame({ page, dock, concept, children }: UnifiedShellProps) {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const { toastMsg } = useUnifiedState();
  const snap = useConsoleData(SHELL_KEYS);

  /* body.uc-body：html/body 級樣式（背景/overflow/字體）由殼層掛載切換 */
  useEffect(() => {
    document.body.classList.add("uc-body");
    return () => { document.body.classList.remove("uc-body"); };
  }, []);

  /* ---- 頂列狀態 chips（真值；design §3.3 頂列 GPU chip 列）---- */
  // 防禦性讀取（rt.service?.）：/api/runtime/status 契約保證 service 必存在（coordinatorClient.ts RuntimeStatus
  // 非 optional），但既有測試（EdgeConsole.aliasRedirect.test.tsx「malformed higher-priority session values…」）
  // 以 `as never` 餵入缺 service 的簡化 payload 測試無關的 session/hash 邏輯——殼層一旦真讀 service 會 crash 整棵樹。
  // 不強改該測試（非本 task 列管的 patch 清單），改在讀取點防禦，缺欄位時誠實地不宣稱 ok（degraded）。
  const coordinatorHealth = healthOf(snap.runtimeStatus, (rt) => rt.service?.status !== "ok");
  const governanceHealth = healthOf(snap.ruleRuns);
  // #768：/api/kit/health 只證明 kit-manager-api 活著；coordinator 由 lease 證據推導的 media_state=suspect
  // （DataChannel 通、連續無首幀）要把 Kit chip 降為 degraded，否則假活 Kit 一整個下午都顯示「Kit Runtime OK」。
  const kitMedia = kitMediaSuspect(snap.runtimeStatus);
  const kitHealth: HealthState = kitMedia ? "degraded" : healthOf(snap.kitHealth);
  // 盤點（tasks 1.2）：/api/runtime/status 無 GPU 使用率欄位 → live 即「未取得」；不讀任何臆測欄位、不捏造。
  const gpu = cell(snap.runtimeStatus, () => null);
  const healthText = (h: HealthState, httpStatus: number | null) =>
    h === "ok" ? "OK" : h === "degraded" ? (httpStatus === null ? "degraded" : String(httpStatus)) : L.offline;
  const chip = (uc: string, label: string, h: HealthState, httpStatus: number | null, text?: string, title?: string) => (
    <div data-uc={uc} data-health={h} style={chipByHealth[h]} title={title}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: HEALTH_DOT[h] }} />{label} {text ?? healthText(h, httpStatus)}
    </div>
  );
  const gpuText = gpu.state === "unavailable" ? `GPU ${L.unavailable}` : gpu.state === "error" ? `GPU ${gpu.httpStatus ?? "error"}` : "GPU —";
  const gpuStyle: CSSProperties = gpu.state === "unavailable"
    ? chipUnavailable
    : { ...chipByHealth[gpu.state === "error" ? "degraded" : "unknown"], fontFamily: MONO };

  const topbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 14, height: 56, padding: "0 16px", background: "var(--ab-bar)", borderBottom: "1px solid rgba(120,160,210,.12)", flex: "none" }}>
      <a href="#home" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ab-text)", textDecoration: "none" }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "radial-gradient(circle at 35% 35%,rgba(65,199,232,.9),rgba(47,123,246,.55) 60%,rgba(10,16,24,.2))", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontWeight: 600, fontSize: 13, color: "var(--ab-on-accent)" }}>⬡</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".01em", whiteSpace: "nowrap" }}>AI-BIM-governance</span>
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".1em", color: "var(--ab-text-dim)", textTransform: "uppercase" }}>{L.sub}</span>
        </div>
      </a>
      <a className="op-header-link" href="#minio">{zh ? "選擇模型與版本" : "Choose model and version"}</a>
      <div style={{ flex: 1 }} />
      <div data-prov="asbuilt" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {chip("chip-coordinator", "Coordinator", coordinatorHealth, snap.runtimeStatus.httpStatus)}
        {chip("chip-governance", "Governance", governanceHealth, snap.ruleRuns.httpStatus)}
        {chip("chip-kit", "Kit Runtime", kitHealth, snap.kitHealth.httpStatus,
          kitMedia ? (zh ? `無首幀×${kitMedia.streak}` : `no-frame×${kitMedia.streak}`) : undefined,
          kitMedia ? `${kitMedia.kit_instance_id}: ${kitMedia.detail}` : undefined)}
        <div data-uc="chip-gpu" data-state={gpu.state} style={gpuStyle}>{gpuText}</div>
      </div>
      <span className="op-health-note">{zh ? "服務狀態 ≠ 3D 已就緒" : "Service health ≠ 3D ready"}</span>
      <button type="button" aria-label={zh ? "Switch to English" : "切換為繁體中文"} onClick={() => setLang(zh ? "en" : "zh")} style={{ display: "flex", alignItems: "center", minHeight: 44, gap: 0, background: "var(--ab-surface)", border: "1px solid rgba(120,160,210,.16)", borderRadius: 8, overflow: "hidden", cursor: "pointer", fontFamily: MONO, fontSize: "10.5px" }}>
        <span data-uc="lang-zh" data-active={zh ? "true" : "false"} style={zh ? { padding: "4px 9px", background: "rgba(65,199,232,.16)", color: "var(--ab-accent-bright)" } : { padding: "4px 9px", color: "var(--ab-text-dim)" }}>中</span>
        <span data-uc="lang-en" data-active={!zh ? "true" : "false"} style={!zh ? { padding: "4px 9px", background: "rgba(65,199,232,.16)", color: "var(--ab-accent-bright)" } : { padding: "4px 9px", color: "var(--ab-text-dim)" }}>EN</span>
      </button>
    </div>
  );

  /* ---- sidebar（導覽設定來自 fixtures；A1–A4 badge 文字仍為 fixture，§2.3 承接；轉檔 badge 為真值）---- */
  const convBadge = cell(snap.conversionRecords, (r) => {
    const c = conversionCounts(r);
    return c === null ? null : c.running + c.failed;
  });
  const sidebar = (
    <nav aria-label={zh ? "主要導覽" : "Main navigation"} className="op-sidebar" style={{ width: 212, flex: "none", background: "var(--ab-bar)", borderRight: "1px solid rgba(120,160,210,.10)", padding: "14px 10px 10px", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".12em", color: "var(--ab-text-dimmer)", textTransform: "uppercase", padding: "0 10px 6px" }}>{L.g_work}</span>
        {navMain.map((n) => (
          <a href={n.hash} aria-current={page === n.id ? "page" : undefined} key={n.id} className="hv-bg" data-uc={"nav-" + n.id} data-active={page === n.id ? "true" : "false"} style={navItem(page === n.id)}>
            <span style={{ width: 16, textAlign: "center", fontSize: 12, opacity: 0.85 }}>{n.icon}</span>
            <span style={{ flex: 1, fontSize: "12.5px" }}>{L[n.labelKey]}</span>
            {n.id === "pipe" ? <span data-uc="nav-pipe-badge" data-prov="asbuilt" data-state={convBadge.state} style={badgeTone("warn")}>{cellText(convBadge, L)}</span> : null}
          </a>
        ))}
        {[
          { id: "models", hash: "#minio", label: zh ? "模型庫 · IFC / USDC" : "Models · IFC / USDC" },
          { id: "conversion", hash: "#conv", label: zh ? "轉檔紀錄" : "Conversion history" },
          { id: "sessions", hash: "#sessions", label: zh ? "審查與連線管理" : "Reviews and connections" },
        ].map(item => <a key={item.id} href={item.hash} aria-current={page === item.id ? "page" : undefined}
          style={navItem(page === item.id)} className="op-nav-link">{item.label}</a>)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".12em", color: "var(--ab-text-dimmer)", textTransform: "uppercase", padding: "0 10px 6px" }}>{L.g_apps}</span>
        {apps.filter(a => a.badge === "asbuilt").map((a) => {
          const active = (page === "ws" && dock === a.code.toLowerCase()) || (page === "concept" && concept === a.code.toLowerCase());
          return (
            <a href={a.hash} aria-current={active ? "page" : undefined} key={a.code} className="hv-bg" data-prov="asbuilt" data-uc={"app-" + a.code.toLowerCase()} data-active={active ? "true" : "false"} style={navItem(active)}>
              <span style={{ width: 26, fontFamily: MONO, fontSize: 10, color: "var(--ab-text-code)" }}>{a.code}</span>
              <span style={{ flex: 1, fontSize: 12 }}>{zh ? a.labelZh : a.labelEn}</span>
            </a>
          );
        })}
        <details className="op-future-apps" open={page === "concept" ? true : undefined}>
          <summary>{zh ? "規劃中功能" : "Planned features"}</summary>
          {apps.filter(a => a.badge !== "asbuilt").map(a => <a key={a.code} href={a.hash} style={navItem(concept === a.code.toLowerCase())}>
            <span>{a.code}</span><span>{zh ? a.labelZh : a.labelEn}</span>
          </a>)}
        </details>
      </div>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* href 佔位（正本 design-doc.html 不隨產品打包；baseline 只驗外觀） */}
        <a href="#home" className="hv-doc" style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", border: "1px solid rgba(120,160,210,.14)", borderRadius: 9, fontSize: "11.5px", color: "var(--ab-text-muted)", textDecoration: "none" }}>
          <span>{zh ? "操作流程與名詞說明" : "Workflow and terminology"}</span>
        </a>
        <div data-uc="runtime-note" style={{ fontFamily: MONO, fontSize: "8.5px", color: "var(--ab-text-ghost)", padding: "0 4px" }}>:8004/ui · UnifiedConsole</div>
      </div>
    </nav>
  );

  /* ---- toast host ---- */
  const toastHost = toastMsg ? (
    <div data-uc="toast" style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", background: "var(--ab-raised)", border: "1px solid rgba(65,199,232,.4)", borderRadius: 10, padding: "10px 18px", fontSize: "12.5px", color: "var(--ab-text)", boxShadow: "0 12px 40px rgba(0,0,0,.5)", animation: "tup .18s ease-out", display: "flex", alignItems: "center", gap: 9, zIndex: 99 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ab-accent)" }} />
      <span style={{ fontFamily: MONO, fontSize: "11.5px" }}>{toastMsg}</span>
    </div>
  ) : null;

  return (
    <div className="uc-root" style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", height: "100dvh", minWidth: 0, overflow: "clip", color: "var(--ab-text)", fontSize: 14, background: "var(--ab-bg)" }}>
      {topbar}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {sidebar}
        {/* V-A′（introduce-viewer-app-integration-surface design §4）：page-root 為 position:relative 包裹層，
            WorkspaceViewportHost 是 children 的 absolute 兄弟層；只在 page="ws" 掛載，離開 workspace 由 page prop
            顯式 unmount → pane cleanup 釋放 lease（不依賴 reconciliation）。離線時 host 自身 return null＝零新 DOM。 */}
        <div data-uc="page-root" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
          <ViewportSlotProvider>
            {children}
            {page === "ws" ? <WorkspaceViewportHost /> : null}
          </ViewportSlotProvider>
        </div>
      </div>
      {toastHost}
    </div>
  );
}
