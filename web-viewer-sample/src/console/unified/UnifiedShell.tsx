// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 殼層（頂列 + 側欄 + Toast host + state provider）
// 像素級移植正本：scratchpad/design-origin/app.js（topbar / sidebar / toast 區塊）
// 所有 inline style / 文案 byte-identical；互動為 fixture 語意（local state +
// toast 假 API 字串），不打任何 /api。導覽一律 window.location.hash 賦值。
// ═══════════════════════════════════════════════════════════════════════
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import type { ReactNode } from "react";
import { setLang, useLang } from "../i18n";
import {
  MONO, getL, navMain, apps, badgeTone, navItem,
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
    <div style={{ display: "flex", alignItems: "center", gap: 14, height: 56, padding: "0 16px", background: "#0a1018", borderBottom: "1px solid rgba(120,160,210,.12)", flex: "none" }}>
      <div onClick={() => nav("#home")} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "radial-gradient(circle at 35% 35%,rgba(65,199,232,.9),rgba(47,123,246,.55) 60%,rgba(10,16,24,.2))", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontWeight: 600, fontSize: 13, color: "#04121a" }}>⬡</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".01em", whiteSpace: "nowrap" }}>AI-BIM-governance</span>
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".1em", color: "#5a7089", textTransform: "uppercase" }}>{L.sub}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0e1621", border: "1px solid rgba(120,160,210,.12)", borderRadius: 9, padding: "7px 12px", width: 300 }}>
        <span style={{ color: "#5a7089", fontSize: 12 }}>⌕</span>
        <input placeholder={L.search} style={{ background: "none", border: "none", outline: "none", color: "#dbe6f3", fontSize: "12.5px", fontFamily: "inherit", flex: 1 }} />
        <span style={{ fontFamily: MONO, fontSize: "9.5px", color: "#4d6076", border: "1px solid rgba(120,160,210,.14)", borderRadius: 4, padding: "1px 5px" }}>⌘K</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0e1621", border: "1px solid rgba(120,160,210,.12)", borderRadius: 9, padding: "7px 12px", cursor: "pointer" }}>
        <span style={{ fontSize: 11, color: "#5a7089" }}>{L.project}</span>
        <span style={{ fontSize: "12.5px", fontWeight: 500, whiteSpace: "nowrap" }}>Demo Project – A1 Tower</span>
        <span style={{ color: "#5a7089", fontSize: 10 }}>▾</span>
      </div>
      <div style={{ flex: 1 }} />
      <div data-prov="fixture" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, background: "rgba(49,197,109,.10)", border: "1px solid rgba(49,197,109,.25)", fontSize: 11, color: "#4fd68a" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#31c56d" }} />Coordinator OK</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, background: "rgba(49,197,109,.10)", border: "1px solid rgba(49,197,109,.25)", fontSize: 11, color: "#4fd68a" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#31c56d" }} />Governance OK</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, background: "rgba(65,199,232,.10)", border: "1px solid rgba(65,199,232,.25)", fontSize: 11, color: "#6fd6ee" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#41c7e8" }} />Kit Runtime</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, background: "rgba(49,197,109,.10)", border: "1px solid rgba(49,197,109,.25)", fontFamily: MONO, fontSize: 11, color: "#4fd68a" }}>GPU/Stream 82%</div>
      </div>
      <div onClick={() => setLang(zh ? "en" : "zh")} style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid rgba(120,160,210,.16)", borderRadius: 8, overflow: "hidden", cursor: "pointer", fontFamily: MONO, fontSize: "10.5px" }}>
        <span style={zh ? { padding: "4px 9px", background: "rgba(65,199,232,.16)", color: "#7adcf2" } : { padding: "4px 9px", color: "#5a7089" }}>中</span>
        <span style={!zh ? { padding: "4px 9px", background: "rgba(65,199,232,.16)", color: "#7adcf2" } : { padding: "4px 9px", color: "#5a7089" }}>EN</span>
      </div>
      <span style={{ color: "#8aa0b8", fontSize: 15, cursor: "pointer" }}>◔</span>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#2f7bf6,#41c7e8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11.5px", fontWeight: 700, color: "#04121a" }}>AD</div>
    </div>
  );

  /* ---- sidebar ---- */
  const convBadge = String(conv.filter((c) => c.st !== "done").length);
  const sidebar = (
    <div data-prov="fixture" style={{ width: 212, flex: "none", background: "#0a1018", borderRight: "1px solid rgba(120,160,210,.10)", padding: "14px 10px 10px", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".12em", color: "#4d6076", textTransform: "uppercase", padding: "0 10px 6px" }}>{L.g_work}</span>
        {navMain.map((n) => (
          <div key={n.id} className="hv-bg" style={navItem(page === n.id)} onClick={() => nav(n.hash)}>
            <span style={{ width: 16, textAlign: "center", fontSize: 12, opacity: 0.85 }}>{n.icon}</span>
            <span style={{ flex: 1, fontSize: "12.5px" }}>{L[n.labelKey]}</span>
            {n.id === "pipe" ? <span style={badgeTone("warn")}>{convBadge}</span> : null}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".12em", color: "#4d6076", textTransform: "uppercase", padding: "0 10px 6px" }}>{L.g_apps}</span>
        {apps.map((a) => {
          const active = (page === "ws" && dock === a.code.toLowerCase()) || (page === "concept" && concept === a.code.toLowerCase());
          return (
            <div key={a.code} className="hv-bg" style={navItem(active)} onClick={() => nav(a.hash)}>
              <span style={{ width: 26, fontFamily: MONO, fontSize: 10, color: "#5a8db0" }}>{a.code}</span>
              <span style={{ flex: 1, fontSize: 12 }}>{zh ? a.labelZh : a.labelEn}</span>
              <span style={badgeTone(a.tone)}>{a.badge}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* href 佔位（正本 design-doc.html 不隨產品打包；baseline 只驗外觀） */}
        <a href="#" target="_blank" rel="noreferrer" className="hv-doc" style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", border: "1px solid rgba(120,160,210,.14)", borderRadius: 9, fontSize: "11.5px", color: "#8aa0b8", textDecoration: "none" }}>
          <span>▦</span><span>{L.designdoc}</span><span style={{ marginLeft: "auto", fontSize: 10 }}>↗</span>
        </a>
        <div style={{ fontFamily: MONO, fontSize: "8.5px", color: "#3d4f63", padding: "0 4px" }}>:8004/ui · UnifiedConsole</div>
      </div>
    </div>
  );

  /* ---- toast host ---- */
  const toastHost = toastMsg ? (
    <div style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", background: "#101d2c", border: "1px solid rgba(65,199,232,.4)", borderRadius: 10, padding: "10px 18px", fontSize: "12.5px", color: "#dbe6f3", boxShadow: "0 12px 40px rgba(0,0,0,.5)", animation: "tup .18s ease-out", display: "flex", alignItems: "center", gap: 9, zIndex: 99 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#41c7e8" }} />
      <span style={{ fontFamily: MONO, fontSize: "11.5px" }}>{toastMsg}</span>
    </div>
  ) : null;

  return (
    <div className="uc-root" style={{ display: "flex", flexDirection: "column", height: "100vh", minWidth: 1360, color: "#dbe6f3", fontSize: 14, background: "#060a10" }}>
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
