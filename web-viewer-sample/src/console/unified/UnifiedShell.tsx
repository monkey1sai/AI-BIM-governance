// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 殼層（頂列 + 側欄 + Toast host + state provider）
// 像素級移植正本：scratchpad/design-origin/app.js（topbar / sidebar / toast 區塊）
// 所有 inline style / 文案 byte-identical；互動為 fixture 語意（local state +
// toast 假 API 字串），不打任何 /api。導覽一律 window.location.hash 賦值。
// data-uc / data-active 屬性為 design gate semantic contract 專用的像素中性
// 附加（e2e/design-system-semantic-cases.ts 以其定位/斷言），不影響渲染輸出。
// ═══════════════════════════════════════════════════════════════════════
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import type { ReactNode } from "react";
import { setLang, useLang } from "../i18n";
import {
  getL, navMain, apps, badgeTone, navItem,
  initialIntake, initialConv, initialSessions, initialOutbox, initialIssues, INITIAL_ISSUE_SEQ,
} from "./fixtures";
import type {
  ConceptKey, ConvItem, DockKey, IntakeItem, IssueItem, OutboxItem, PageKey, SessionItem,
} from "./fixtures";
import "./unified.css";

/* ═══ UnifiedState context（conv/intake/sessions/outbox/issues fixture + toast）═══ */

export interface UnifiedStateShape {
  intake: IntakeItem[];
  conv: ConvItem[];
  sessions: SessionItem[];
  outbox: OutboxItem[];
  issues: IssueItem[];
  issueSeq: number;
}

export interface UnifiedStateApi extends UnifiedStateShape {
  /** setState 類 API：淺合併 patch（對應原型 setState(patch)）。 */
  patch: (p: Partial<UnifiedStateShape>) => void;
  /** 顯示 toast（假 API 字串），2600ms 自動消失；重複呼叫重置計時器。 */
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
    intake: [...initialIntake],
    conv: [...initialConv],
    sessions: [...initialSessions],
    outbox: [...initialOutbox],
    issues: [...initialIssues],
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
  page: PageKey;
  /** page="ws" 時的 dock tab（A1–A4 / issues 的 active 判定）。 */
  dock?: DockKey;
  /** page="concept" 時的概念頁 key（A5–A10 的 active 判定）。 */
  concept?: ConceptKey;
  children?: ReactNode;
}

export function UnifiedShell(props: UnifiedShellProps) {
  return (
    <UnifiedStateProvider>
      <ShellFrame {...props} />
    </UnifiedStateProvider>
  );
}

function ShellFrame({ page, dock, concept, children }: UnifiedShellProps) {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const { conv, toastMsg } = useUnifiedState();

  /* body.uc-body：html/body 級樣式（背景/overflow/字體）由殼層掛載切換 */
  useEffect(() => {
    document.body.classList.add("uc-body");
    return () => { document.body.classList.remove("uc-body"); };
  }, []);

  const nav = (hash: string) => { window.location.hash = hash; };

  /* ---- topbar ---- */
  const topbar = (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-px-14)", height: 56, padding: "0 var(--ab-space-6)", background: "var(--ab-bar)", borderBottom: "var(--ab-space-px-1) solid var(--ab-border)", flex: "none" }}>
      <div onClick={() => nav("#home")} style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-4)", cursor: "pointer" }}>
        <div style={{ width: 30, height: 30, borderRadius: "var(--ab-r-md)", background: "radial-gradient(circle at 35% 35%,var(--ab-accent-a90),var(--ab-accent-2-a55) 60%,var(--ab-bar-a20))", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--ab-mono)", fontWeight: "var(--ab-fw-600)", fontSize: "var(--ab-fs-sm)", color: "var(--ab-on-accent)" }}>⬡</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--ab-space-px-1)" }}>
          <span style={{ fontWeight: "var(--ab-fw-700)", fontSize: "var(--ab-fs-body)", letterSpacing: "var(--ab-track-01)", whiteSpace: "nowrap" }}>AI-BIM-governance</span>
          <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9)", letterSpacing: "var(--ab-track-10)", color: "var(--ab-text-dim)", textTransform: "uppercase" }}>{L.sub}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-3)", background: "var(--ab-surface)", border: "var(--ab-space-px-1) solid var(--ab-border)", borderRadius: "var(--ab-r-px-9)", padding: "var(--ab-space-px-7) var(--ab-space-5)", width: 300 }}>
        <span style={{ color: "var(--ab-text-dim)", fontSize: "var(--ab-fs-xs)" }}>⌕</span>
        <input placeholder={L.search} style={{ background: "none", border: "none", outline: "none", color: "var(--ab-text)", fontSize: "var(--ab-fs-12-5)", fontFamily: "inherit", flex: 1 }} />
        <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9-5)", color: "var(--ab-text-dimmer)", border: "var(--ab-space-px-1) solid var(--ab-border-mid)", borderRadius: "var(--ab-r-xs)", padding: "var(--ab-space-px-1) var(--ab-space-px-5)" }}>⌘K</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-3)", background: "var(--ab-surface)", border: "var(--ab-space-px-1) solid var(--ab-border)", borderRadius: "var(--ab-r-px-9)", padding: "var(--ab-space-px-7) var(--ab-space-5)", cursor: "pointer" }}>
        <span style={{ fontSize: "var(--ab-fs-mono)", color: "var(--ab-text-dim)" }}>{L.project}</span>
        <span style={{ fontSize: "var(--ab-fs-12-5)", fontWeight: "var(--ab-fw-500)", whiteSpace: "nowrap" }}>Demo Project – A1 Tower</span>
        <span style={{ color: "var(--ab-text-dim)", fontSize: "var(--ab-fs-10)" }}>▾</span>
      </div>
      <div style={{ flex: 1 }} />
      <div data-prov="fixture" style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-2)", padding: "var(--ab-space-px-5) var(--ab-space-4)", borderRadius: "var(--ab-r-pill)", background: "var(--ab-ok-a10)", border: "var(--ab-space-px-1) solid var(--ab-ok-a25)", fontSize: "var(--ab-fs-mono)", color: "var(--ab-ok-text)" }}><span data-testid="coordinator-status-dot" style={{ width: 6, height: 6, borderRadius: "var(--ab-r-round)", background: "var(--ab-ok)" }} />Coordinator OK</div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-2)", padding: "var(--ab-space-px-5) var(--ab-space-4)", borderRadius: "var(--ab-r-pill)", background: "var(--ab-ok-a10)", border: "var(--ab-space-px-1) solid var(--ab-ok-a25)", fontSize: "var(--ab-fs-mono)", color: "var(--ab-ok-text)" }}><span data-testid="governance-status-dot" style={{ width: 6, height: 6, borderRadius: "var(--ab-r-round)", background: "var(--ab-ok)" }} />Governance OK</div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-2)", padding: "var(--ab-space-px-5) var(--ab-space-4)", borderRadius: "var(--ab-r-pill)", background: "var(--ab-accent-a10)", border: "var(--ab-space-px-1) solid var(--ab-accent-a25)", fontSize: "var(--ab-fs-mono)", color: "var(--ab-accent-text)" }}><span data-testid="kit-runtime-status-dot" style={{ width: 6, height: 6, borderRadius: "var(--ab-r-round)", background: "var(--ab-accent)" }} />Kit Runtime</div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-2)", padding: "var(--ab-space-px-5) var(--ab-space-4)", borderRadius: "var(--ab-r-pill)", background: "var(--ab-ok-a10)", border: "var(--ab-space-px-1) solid var(--ab-ok-a25)", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-mono)", color: "var(--ab-ok-text)" }}>GPU/Stream 82%</div>
      </div>
      <div onClick={() => setLang(zh ? "en" : "zh")} style={{ display: "flex", alignItems: "center", gap: 0, border: "var(--ab-space-px-1) solid var(--ab-border-strong)", borderRadius: "var(--ab-r-md)", overflow: "hidden", cursor: "pointer", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10-5)" }}>
        <span data-uc="lang-zh" data-active={zh ? "true" : "false"} style={zh ? { padding: "var(--ab-space-1) var(--ab-space-px-9)", background: "var(--ab-accent-a16)", color: "var(--ab-accent-bright)" } : { padding: "var(--ab-space-1) var(--ab-space-px-9)", color: "var(--ab-text-dim)" }}>中</span>
        <span data-uc="lang-en" data-active={!zh ? "true" : "false"} style={!zh ? { padding: "var(--ab-space-1) var(--ab-space-px-9)", background: "var(--ab-accent-a16)", color: "var(--ab-accent-bright)" } : { padding: "var(--ab-space-1) var(--ab-space-px-9)", color: "var(--ab-text-dim)" }}>EN</span>
      </div>
      <span style={{ color: "var(--ab-text-muted)", fontSize: "var(--ab-fs-body)", cursor: "pointer" }}>◔</span>
      <div style={{ width: 32, height: 32, borderRadius: "var(--ab-r-round)", background: "linear-gradient(135deg,var(--ab-accent-2),var(--ab-accent))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--ab-fs-11-5)", fontWeight: "var(--ab-fw-700)", color: "var(--ab-on-accent)" }}>AD</div>
    </div>
  );

  /* ---- sidebar ---- */
  const convBadge = String(conv.filter((c) => c.st !== "done").length);
  const sidebar = (
    <div data-prov="fixture" style={{ width: 212, flex: "none", background: "var(--ab-bar)", borderRight: "var(--ab-space-px-1) solid var(--ab-border-a10)", padding: "var(--ab-space-px-14) var(--ab-space-4) var(--ab-space-4)", display: "flex", flexDirection: "column", gap: "var(--ab-space-6)", overflow: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--ab-space-px-2)" }}>
        <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9)", letterSpacing: "var(--ab-track-label)", color: "var(--ab-text-dimmer)", textTransform: "uppercase", padding: "0 var(--ab-space-4) var(--ab-space-2)" }}>{L.g_work}</span>
        {navMain.map((n) => (
          <div key={n.id} className="hv-bg" data-uc={"nav-" + n.id} data-active={page === n.id ? "true" : "false"} style={navItem(page === n.id)} onClick={() => nav(n.hash)}>
            <span style={{ width: 16, textAlign: "center", fontSize: "var(--ab-fs-xs)", opacity: 0.85 }}>{n.icon}</span>
            <span style={{ flex: 1, fontSize: "var(--ab-fs-12-5)" }}>{L[n.labelKey]}</span>
            {n.id === "pipe" ? <span data-uc="nav-pipe-badge" style={badgeTone("warn")}>{convBadge}</span> : null}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--ab-space-px-2)" }}>
        <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9)", letterSpacing: "var(--ab-track-label)", color: "var(--ab-text-dimmer)", textTransform: "uppercase", padding: "0 var(--ab-space-4) var(--ab-space-2)" }}>{L.g_apps}</span>
        {apps.map((a) => {
          const active = (page === "ws" && dock === a.code.toLowerCase()) || (page === "concept" && concept === a.code.toLowerCase());
          return (
            <div key={a.code} className="hv-bg" data-uc={"app-" + a.code.toLowerCase()} data-active={active ? "true" : "false"} style={navItem(active)} onClick={() => nav(a.hash)}>
              <span style={{ width: 26, fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10)", color: "var(--ab-text-code)" }}>{a.code}</span>
              <span style={{ flex: 1, fontSize: "var(--ab-fs-xs)" }}>{zh ? a.labelZh : a.labelEn}</span>
              <span style={badgeTone(a.tone)}>{a.badge}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--ab-space-3)" }}>
        {/* href 佔位（正本 design-doc.html 不隨產品打包；baseline 只驗外觀） */}
        <a href="#" target="_blank" rel="noreferrer" className="hv-doc" style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-3)", padding: "var(--ab-space-px-9) var(--ab-space-4)", border: "var(--ab-space-px-1) solid var(--ab-border-mid)", borderRadius: "var(--ab-r-px-9)", fontSize: "var(--ab-fs-11-5)", color: "var(--ab-text-muted)", textDecoration: "none" }}>
          <span>▦</span><span>{L.designdoc}</span><span style={{ marginLeft: "auto", fontSize: "var(--ab-fs-10)" }}>↗</span>
        </a>
        <div data-uc="runtime-note" style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-8-5)", color: "var(--ab-text-ghost)", padding: "0 var(--ab-space-1)" }}>:8004/ui · UnifiedConsole</div>
      </div>
    </div>
  );

  /* ---- toast host ---- */
  const toastHost = toastMsg ? (
    <div data-uc="toast" style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", background: "var(--ab-raised)", border: "var(--ab-space-px-1) solid var(--ab-accent-a40)", borderRadius: "var(--ab-r-lg)", padding: "var(--ab-space-4) var(--ab-space-px-18)", fontSize: "var(--ab-fs-12-5)", color: "var(--ab-text)", boxShadow: "0 12px 40px var(--ab-black-a50)", animation: "tup .18s ease-out", display: "flex", alignItems: "center", gap: "var(--ab-space-px-9)", zIndex: 99 }}>
      <span style={{ width: 7, height: 7, borderRadius: "var(--ab-r-round)", background: "var(--ab-accent)" }} />
      <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-11-5)" }}>{toastMsg}</span>
    </div>
  ) : null;

  return (
    <div className="uc-root" style={{ display: "flex", flexDirection: "column", height: "100vh", minWidth: 1360, color: "var(--ab-text)", fontSize: "var(--ab-fs-14)", background: "var(--ab-bg)" }}>
      {topbar}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {sidebar}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {children}
        </div>
      </div>
      {toastHost}
    </div>
  );
}
