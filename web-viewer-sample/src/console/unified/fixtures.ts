// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — fixtures / 字典（1:1 移植自 design-origin/app.js）
// 像素級移植正本：scratchpad/design-origin/app.js（vanilla JS 原型）
// 所有色值 / px / 字串 byte-identical；不要「優化」任何值。
// 本檔只保留 i18n 字典、導覽設定與 style helper；A1–A4 production route
// 直接掛載 live modules，不再保存或渲染 prototype dock data。
// ═══════════════════════════════════════════════════════════════════════
import type { CSSProperties } from "react";

/* ── design props（對應 dc data-props 預設值）── */
export const ACCENT = "var(--ab-accent)";
export const SHOW_CONCEPT_APPS = true;

/** 原型 MONO = "font-family:'JetBrains Mono',monospace"；React style object 取 font-family 值。 */
export const MONO = "'JetBrains Mono',monospace";

/* ── route keys ── */
export type PageKey = "home" | "ws" | "pipe" | "ops" | "concept";
export type DockKey = "a1" | "a2" | "a3" | "a4" | "issues";
export type ConceptKey = "a5" | "a6" | "a7" | "a8" | "a9" | "a10";
export type AppCode = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9" | "A10";

/* ── i18n 字典（1:1 對應 app.js getL）── */
export interface Dict {
  sub: string; search: string; project: string;
  g_work: string; g_apps: string; designdoc: string;
  home_title: string; kpi_conv: string; kpi_sess: string;
  kpi_issue: string; kpi_issue_sub: string; kpi_outbox: string;
  pipe_snap: string; enter: string; alerts: string; launcher: string;
  f1_desc: string;
  nav_home: string; nav_ws: string; nav_pipe: string; nav_ops: string;
  a1: string; a2: string; a4: string; file: string; rules: string;
  run: string; rerun: string; fails: string; bcf: string; clear: string;
  added: string; removed: string; modified: string; overlay: string; fromdiff: string;
  order: string; unit: string; nlq: string; results: string;
  pipe_title: string; st_intake: string; st_conv: string; st_callback: string;
  trigger: string; retry: string; mksession: string; enter3d: string;
  pending: string; deliver: string; browse: string; recent: string;
  ops_title: string; svc_health: string; empty: string;
  concept_note: string;
  dock_issues: string; outbox: string;
  /* unified-console-runtime-truth：真值狀態文案 */
  offline: string; unavailable: string; last_updated: string;
}

export function getL(zh: boolean): Dict {
  return zh ? {
    sub: "BIM Governance Console", search: "搜尋專案、模型、Issue、BCF…", project: "專案",
    g_work: "工作台", g_apps: "AI 應用模組", designdoc: "前後端設計文件",
    home_title: "總覽 · Mission Control", kpi_conv: "轉檔中", kpi_sess: "活躍 Sessions",
    kpi_issue: "未結 Issue", kpi_issue_sub: "嚴重 3 · 高 5 · 中 4", kpi_outbox: "Outbox 待送",
    pipe_snap: "資料生產線快照", enter: "進入生產線", alerts: "警示 / 事件", launcher: "應用啟動器",
    f1_desc: "進件 → 轉檔 → Session → 3D Handoff → 回拋,全程 metadata-only 出雲端",
    nav_home: "總覽", nav_ws: "3D 工作區", nav_pipe: "模型資料與轉檔", nav_ops: "Runtime / Kit·GPU",
    a1: "治理檢核", a2: "版本 Diff", a4: "語意查詢", file: "選定檔案", rules: "規則集",
    run: "執行檢核", rerun: "重新執行", fails: "失敗", bcf: "匯出 BCF 2.1", clear: "清除疊加",
    added: "新增", removed: "移除", modified: "修改", overlay: "套用疊加", fromdiff: "由差異開單",
    order: "順序", unit: "單位", nlq: "自然語言查詢", results: "查詢結果",
    pipe_title: "模型資料與轉檔生產線", st_intake: "進件", st_conv: "轉檔", st_callback: "回拋",
    trigger: "觸發轉檔", retry: "重試", mksession: "建立 Review Session", enter3d: "進入 3D 工作區",
    pending: "待送", deliver: "立即回拋 deliver", browse: "物件瀏覽", recent: "最近事件",
    ops_title: "Runtime / Kit · GPU 營運", svc_health: "服務健康", empty: "無待進件",
    concept_note: "點左欄 A1–A4 體驗 live 模組;本頁為概念稿",
    dock_issues: "Issues", outbox: "回拋 Outbox",
    offline: "未連線", unavailable: "未取得", last_updated: "最後更新",
  } : {
    sub: "BIM Governance Console", search: "Search projects, models, issues, BCF…", project: "Project",
    g_work: "Workspace", g_apps: "AI App Modules", designdoc: "Design Doc (FE/BE)",
    home_title: "Overview · Mission Control", kpi_conv: "Converting", kpi_sess: "Active Sessions",
    kpi_issue: "Open Issues", kpi_issue_sub: "critical 3 · high 5 · med 4", kpi_outbox: "Outbox Pending",
    pipe_snap: "Data Pipeline Snapshot", enter: "Open pipeline", alerts: "Alerts / Events", launcher: "App Launcher",
    f1_desc: "Intake → Convert → Session → 3D Handoff → Callback, metadata-only to cloud",
    nav_home: "Overview", nav_ws: "3D Workspace", nav_pipe: "Model Data & Conversion", nav_ops: "Runtime / Kit·GPU",
    a1: "Rule Check", a2: "Version Diff", a4: "Semantic Query", file: "Selected file", rules: "Rule set",
    run: "Run check", rerun: "Re-run", fails: "failures", bcf: "Export BCF 2.1", clear: "Clear overlay",
    added: "Added", removed: "Removed", modified: "Modified", overlay: "Apply overlay", fromdiff: "Issue from diff",
    order: "order", unit: "Unit", nlq: "Natural language query", results: "Results",
    pipe_title: "Model Data & Conversion Pipeline", st_intake: "Intake", st_conv: "Convert", st_callback: "Callback",
    trigger: "Trigger conversion", retry: "Retry", mksession: "Create Review Session", enter3d: "Enter 3D Workspace",
    pending: "pending", deliver: "Deliver now", browse: "Object browser", recent: "Recent events",
    ops_title: "Runtime / Kit · GPU Operations", svc_health: "Service health", empty: "No pending intake",
    concept_note: "Click A1–A4 in sidebar for live modules; this page is a concept mock",
    dock_issues: "Issues", outbox: "Deliver Outbox",
    offline: "offline", unavailable: "not observed", last_updated: "Last updated",
  };
}

/* ── 初始 state fixture（1:1 對應 app.js state）── */
export interface IntakeItem { file: string; src: string; }
export type ConvStatus = "running" | "failed" | "done";
export interface ConvItem { file: string; st: ConvStatus; metrics?: string; }
export interface SessionItem { id: string; lease: string; stage: string; }
export type OutboxStatus = "待送" | "已送";
export interface OutboxItem { id: string; kind: string; st: OutboxStatus; }
export type IssueStatus = "open" | "in-review";
export interface IssueItem { id: string; title: string; st: IssueStatus; src: string; }
// slice-1 誠實欠帳（P3 final review f1）：Issues/BCF dock（docks.tsx，§2 範圍）仍以 fixture issue 種入；
// 若移到 test-only，workspace.a3 的 failure semantic case（open chip／防火時效不足）會空掉。留在 production、
// 由 fixtureNotInProduction.test.ts 的 SLICE2_DEBT ratchet 釘住（UnifiedShell.tsx 唯一消費者），隨 §2 dock 真值化一併移除。
export const initialIssues: IssueItem[] = [
  { id: "ISS-101", title: "FD-4F-02 防火時效不足(30min < 60min)", st: "open", src: "rule-run #87" },
  { id: "ISS-098", title: "B-3F-12 樑位移 +42mm 超容差", st: "in-review", src: "diff v11→v12" },
];
export const INITIAL_ISSUE_SEQ = 102;

/* ── nav：工作台 4 項（route hash 對映 home→#home / ws→#a1 / pipe→#pipeline / ops→#runtime）── */
export interface NavMainItem {
  id: Exclude<PageKey, "concept">;
  icon: string;
  labelKey: "nav_home" | "nav_ws" | "nav_pipe" | "nav_ops";
  hash: string;
}
export const navMain: NavMainItem[] = [
  { id: "home", icon: "◧", labelKey: "nav_home", hash: "#home" },
  { id: "ws", icon: "⬒", labelKey: "nav_ws", hash: "#a1" },
  { id: "pipe", icon: "⇶", labelKey: "nav_pipe", hash: "#pipeline" },
  { id: "ops", icon: "▣", labelKey: "nav_ops", hash: "#runtime" },
];

/* ── AI 應用模組 10 項（A1–A4 LIVE → #a1..#a4；A5 P3 / A6–A10 P4 → #a5..#a10）── */
export type AppTone = "live" | "asbuilt" | "p3" | "p4";
export interface AppDef {
  code: AppCode;
  labelZh: string;
  labelEn: string;
  badge: string;
  tone: AppTone;
  hash: string;
}
export const apps: AppDef[] = [
  { code: "A1", labelZh: "治理檢核", labelEn: "Rule Check", badge: "asbuilt", tone: "asbuilt", hash: "#a1" },
  { code: "A2", labelZh: "版本 Diff", labelEn: "Version Diff", badge: "asbuilt", tone: "asbuilt", hash: "#a2" },
  { code: "A3", labelZh: "Federation", labelEn: "Federation", badge: "asbuilt", tone: "asbuilt", hash: "#a3" },
  { code: "A4", labelZh: "語意查詢", labelEn: "Semantic Query", badge: "asbuilt", tone: "asbuilt", hash: "#a4" },
  { code: "A5", labelZh: "IoT / FM", labelEn: "IoT / FM", badge: "P3", tone: "p3", hash: "#a5" },
  { code: "A6", labelZh: "4D / 5D", labelEn: "4D / 5D", badge: "P4", tone: "p4", hash: "#a6" },
  { code: "A7", labelZh: "Scan Compare", labelEn: "Scan Compare", badge: "P4", tone: "p4", hash: "#a7" },
  { code: "A8", labelZh: "Synthetic Data", labelEn: "Synthetic Data", badge: "P4", tone: "p4", hash: "#a8" },
  { code: "A9", labelZh: "機器人巡檢", labelEn: "Robot Inspect", badge: "P4", tone: "p4", hash: "#a9" },
  { code: "A10", labelZh: "AI 決策", labelEn: "AI Decision", badge: "P4", tone: "p4", hash: "#a10" },
];

/* ── appEn 字典（launcher 副標）── */
export const appEn: Record<AppCode, string> = {
  A1: "Governance & Rule Checker", A2: "Model Version Diff", A3: "Cross-discipline Federation",
  A4: "Semantic query & evidence", A5: "IoT / FM Digital Twin", A6: "4D/5D Construction",
  A7: "Scan-to-BIM Deviation", A8: "Synthetic Data Studio", A9: "Autonomous inspection",
  A10: "AI decision workbench",
};

/* ── dock tabs 5 項（label 依當前語言字典組合）── */
export interface DockTab { id: DockKey; label: (L: Dict) => string; }
export const dockTabs: DockTab[] = [
  { id: "a1", label: (L) => "A1 " + L.a1 },
  { id: "a2", label: () => "A2 Diff" },
  { id: "a3", label: () => "A3 Federation" },
  { id: "a4", label: (L) => "A4 " + L.a4 },
  { id: "issues", label: () => "Issues / BCF" },
];


/* ── concept（A5–A10）標題 + uploads 圖檔名 ── */
export interface ConceptMeta { titleZh: string; titleEn: string; img: string; }
export const conceptMeta: Record<ConceptKey, ConceptMeta> = {
  a5: { titleZh: "A5 · IoT / FM 數位分身", titleEn: "A5 · IoT / FM Digital Twin", img: "uploads/ai-bim-geo-viewer-A5.png" },
  a6: { titleZh: "A6 · 4D / 5D 施工模擬", titleEn: "A6 · 4D / 5D Construction", img: "uploads/ai-bim-geo-viewer-A6.png" },
  a7: { titleZh: "A7 · Reality Capture 比對", titleEn: "A7 · Reality Capture Compare", img: "uploads/ai-bim-geo-viewer-A7.png" },
  a8: { titleZh: "A8 · Synthetic Data Studio", titleEn: "A8 · Synthetic Data Studio", img: "uploads/ai-bim-geo-viewer-A8.png" },
  a9: { titleZh: "A9 · 機器人 / 自主巡檢", titleEn: "A9 · Robots / Inspection", img: "uploads/ai-bim-geo-viewer-A9.png" },
  a10: { titleZh: "A10 · 其他應用 / AI 決策", titleEn: "A10 · AI Decision Workbench", img: "uploads/ai-bim-geo-viewer-A10.png" },
};

/* ── concept 特色清單（fallback 卡）── */
export const conceptFeat: Record<ConceptKey, { zh: string[]; en: string[] }> = {
  a5: {
    zh: ["空間樹 × 樓層熱區(溫度/濕度/AQI 即時疊加)", "設備資產 × 工單(HVAC·照明·給排水·電力)", "即時警報 → 3D 空間定位 → 維修工單流轉", "營運 KPI:設備可用率 · 能耗 · 保養排程"],
    en: ["Space tree × floor heatmap (temp/RH/AQI live overlay)", "Asset registry × work orders (HVAC, lighting, plumbing, power)", "Live alert → 3D locate → maintenance dispatch", "Ops KPI: availability, energy, maintenance schedule"],
  },
  a6: {
    zh: ["施工排程 × 3D 模型逐週推演(4D)", "成本曲線與現金流投影(5D)", "關鍵路徑與干涉視窗提示", "實際進度 vs 計畫進度差異疊加"],
    en: ["Schedule × 3D weekly playback (4D)", "Cost curve & cash-flow projection (5D)", "Critical path & clash-window hints", "Actual vs planned progress overlay"],
  },
  a7: {
    zh: ["點雲 × BIM 對齊與偏差色階", "偏差超容差自動開 Issue", "掃描站位涵蓋率分析", "歷次掃描趨勢追蹤"],
    en: ["Point cloud × BIM alignment & deviation ramp", "Auto-issue on out-of-tolerance deviation", "Scan station coverage analysis", "Cross-scan trend tracking"],
  },
  a8: {
    zh: ["由 USD 場景批量產生合成影像資料集", "隨機化材質/光照/相機位姿", "自動標註(bbox/segmentation/depth)", "餵給缺陷偵測與機器人訓練"],
    en: ["Batch synthetic imagery from USD scenes", "Domain randomization: materials/lighting/camera", "Auto labels (bbox/segmentation/depth)", "Feeds defect detection & robot training"],
  },
  a9: {
    zh: ["巡檢路徑規劃 × 3D 導航", "機器人回傳影像 × BIM 構件對位", "異常偵測自動開單", "巡檢覆蓋率與歷程儀表"],
    en: ["Inspection route planning × 3D nav", "Robot imagery aligned to BIM elements", "Anomaly detection auto-issues", "Coverage & history dashboards"],
  },
  a10: {
    zh: ["跨模組資料匯流的決策工作台", "AI 建議 × 證據鏈(Evidence Trace)", "情境模擬與影響評估", "決策紀錄可稽核回放"],
    en: ["Decision workbench over cross-module data", "AI suggestions × evidence trace", "Scenario simulation & impact assessment", "Auditable decision playback"],
  },
};

/* ═══ style helpers（1:1 翻譯 app.js 產生器 → React.CSSProperties）═══ */

/** badge tone 色組：[文字色, 背景色, 邊框色] */
export const badgeToneColors: Record<AppTone | "warn", readonly [string, string, string]> = {
  live: ["var(--ab-ok-text)", "rgba(49,197,109,.1)", "rgba(49,197,109,.3)"],
  asbuilt: ["var(--ab-ok-text)", "rgba(49,197,109,.1)", "rgba(49,197,109,.3)"],
  p3: ["var(--ab-violet-text)", "rgba(157,140,255,.1)", "rgba(157,140,255,.3)"],
  p4: ["var(--ab-violet-dim)", "rgba(157,140,255,.07)", "rgba(157,140,255,.2)"],
  warn: ["var(--ab-warn)", "rgba(230,178,62,.1)", "rgba(230,178,62,.3)"],
};

export function badgeTone(tone: AppTone | "warn"): CSSProperties {
  const m = badgeToneColors[tone];
  return {
    fontFamily: MONO, fontSize: "8.5px", padding: "1px 5px", borderRadius: 4,
    color: m[0], background: m[1], border: `1px solid ${m[2]}`,
  };
}

export function navItem(active: boolean): CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8,
    cursor: "pointer",
    color: active ? "var(--ab-text)" : "var(--ab-text-muted)",
    background: active ? "rgba(65,199,232,.10)" : "transparent",
    borderLeft: `2px solid ${active ? ACCENT : "transparent"}`,
  };
}

export const BTN: CSSProperties = {
  textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--ab-on-accent)",
  background: `linear-gradient(135deg,${ACCENT},var(--ab-accent-2))`, borderRadius: 9, padding: 9, cursor: "pointer",
};

export function stChip(kind: ConvStatus): CSSProperties {
  const m: Record<ConvStatus, CSSProperties> = {
    running: { fontSize: "9.5px", color: "var(--ab-accent-text)", background: "rgba(65,199,232,.08)", border: "1px solid rgba(65,199,232,.25)", borderRadius: 4, padding: "1px 6px", fontFamily: MONO },
    failed: { fontSize: "9.5px", color: "var(--ab-danger)", background: "rgba(232,97,92,.08)", border: "1px solid rgba(232,97,92,.3)", borderRadius: 4, padding: "1px 6px", fontFamily: MONO },
    done: { fontSize: "9.5px", color: "var(--ab-ok-text)", background: "rgba(49,197,109,.08)", border: "1px solid rgba(49,197,109,.25)", borderRadius: 4, padding: "1px 6px", fontFamily: MONO },
  };
  return m[kind];
}

export const label9: CSSProperties = {
  fontFamily: MONO, fontSize: 9, letterSpacing: ".1em", color: "var(--ab-text-dimmer)", textTransform: "uppercase",
};

export const chipBox: CSSProperties = {
  background: "var(--ab-surface)", border: "1px solid rgba(120,160,210,.12)", borderRadius: 12,
};

export const innerBox: CSSProperties = {
  background: "var(--ab-inset)", border: "1px solid rgba(120,160,210,.12)", borderRadius: 10,
};
