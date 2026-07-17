// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — fixtures / 字典（1:1 移植自 design-origin/app.js）
// 像素級移植正本：scratchpad/design-origin/app.js（vanilla JS 原型）
// 所有色值 / px / 字串 byte-identical；不要「優化」任何值。
// 本檔只含 fixture 資料與 style helper，不打任何 /api。
// ═══════════════════════════════════════════════════════════════════════
import type { CSSProperties } from "react";

/* ── design props（對應 dc data-props 預設值）── */
export const ACCENT = "#41c7e8";
export const SHOW_CONCEPT_APPS = true;

/** 原型 MONO = "font-family:'JetBrains Mono',monospace"；React style object 取 font-family 值。 */
export const MONO = "'JetBrains Mono',monospace";

/* ── route keys ── */
export type PageKey = "home" | "ws" | "pipe" | "ops" | "concept";
export type DockKey = "a1" | "a2" | "a3" | "a4" | "issues";
export type ConceptKey = "a5" | "a6" | "a7" | "a8" | "a9" | "a10";
export type AppCode = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9" | "A10";
export type Member = "ARCH" | "STR" | "MEP" | "CIVIL" | "LAND";

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
export interface SelItem { name: string; path: string; }

export type RuleKey = "r1" | "r2" | "r3";
export type RuleOn = Record<RuleKey, boolean>;

export const initialIntake: IntakeItem[] = [
  { file: "demo_lib_2026.ifc", src: "MinIO bucket/incoming" },
  { file: "松風庵_v3.ifc", src: "MinIO bucket/incoming" },
];

export const initialConv: ConvItem[] = [
  { file: "990_model.ifc", st: "running" },
  { file: "fixture-bytes.ifc", st: "failed" },
  { file: "許良宇圖書館建築_2026.ifc", st: "done", metrics: "12.4M tris · 98%" },
];

export const initialSessions: SessionItem[] = [
  { id: "S-240601", lease: "editor lease", stage: "/Review/A1_Tower_fed.usd" },
];

export const initialOutbox: OutboxItem[] = [
  { id: "OB-201", kind: "conversion-result", st: "待送" },
  { id: "OB-202", kind: "issue-snapshot", st: "待送" },
  { id: "OB-200", kind: "conversion-result", st: "已送" },
];

export const initialIssues: IssueItem[] = [
  { id: "ISS-101", title: "FD-4F-02 防火時效不足(30min < 60min)", st: "open", src: "rule-run #87" },
  { id: "ISS-098", title: "B-3F-12 樑位移 +42mm 超容差", st: "in-review", src: "diff v11→v12" },
];

export const INITIAL_ISSUE_SEQ = 102;
export const initialRuleOn: RuleOn = { r1: true, r2: true, r3: false };
export const initialFlags = {
  a1Ran: true, a2Ran: false, a3Built: false, overlayOn: false,
};
export const INITIAL_DC_LOG = "highlightPrimsResult ✓ (18 prims)";

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
export type AppTone = "live" | "p3" | "p4";
export interface AppDef {
  code: AppCode;
  labelZh: string;
  labelEn: string;
  badge: string;
  tone: AppTone;
  hash: string;
}
export const apps: AppDef[] = [
  { code: "A1", labelZh: "治理檢核", labelEn: "Rule Check", badge: "LIVE", tone: "live", hash: "#a1" },
  { code: "A2", labelZh: "版本 Diff", labelEn: "Version Diff", badge: "LIVE", tone: "live", hash: "#a2" },
  { code: "A3", labelZh: "Federation", labelEn: "Federation", badge: "LIVE", tone: "live", hash: "#a3" },
  { code: "A4", labelZh: "語意查詢", labelEn: "Semantic Query", badge: "LIVE", tone: "live", hash: "#a4" },
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

/* ── 色組 / tone 字典 ── */
export const memColors: Record<Member, string> = {
  ARCH: "#e8925c", STR: "#41c7e8", MEP: "#9d8cff", CIVIL: "#e6b23e", LAND: "#31c56d",
};

/** [color, "rgba(r,g,b" 前綴]；使用端補 ",.1)" / ",.3)" 等透明度。 */
export const sevTone: Record<string, readonly [string, string]> = {
  "嚴重": ["#e8615c", "rgba(232,97,92"], "高": ["#e6b23e", "rgba(230,178,62"], "中": ["#e8d35c", "rgba(232,211,92"],
  critical: ["#e8615c", "rgba(232,97,92"], high: ["#e6b23e", "rgba(230,178,62"], med: ["#e8d35c", "rgba(232,211,92"],
};

export type DiffKind = "added" | "removed" | "modified";
export const kindTone: Record<DiffKind, readonly [string, string]> = {
  added: ["#6fd6ee", "rgba(65,199,232"],
  removed: ["#e8615c", "rgba(232,97,92"],
  modified: ["#e6b23e", "rgba(230,178,62"],
};

/* ── stage tree（ws 左欄 /World members + 版本）── */
export interface StageTreeMember { name: Member; ver: string; }
export const stageTree: StageTreeMember[] = [
  { name: "ARCH", ver: "v12" },
  { name: "STR", ver: "v08" },
  { name: "MEP", ver: "v15" },
  { name: "CIVIL", ver: "v04" },
  { name: "LAND", ver: "v06" },
];

/* ── A1 規則集 3 項 ── */
export interface RuleDef { k: RuleKey; labelZh: string; labelEn: string; code: string; }
export const ruleDefs: RuleDef[] = [
  { k: "r1", labelZh: "防火門 FireRating ≥ 60min", labelEn: "Fire door rating ≥ 60min", code: "CNS 11227-1" },
  { k: "r2", labelZh: "淨高 ≥ 2100mm", labelEn: "Clear height ≥ 2100mm", code: "TBC 76" },
  { k: "r3", labelZh: "管線間距 ≥ 50mm", labelEn: "Pipe clearance ≥ 50mm", code: "MEP-S12" },
];

/* ── A1 檢核失敗 4 項 ── */
export interface FailDef {
  id: string;
  elZh: string; elEn: string;
  ruleZh: string; ruleEn: string;
  sevZh: string; sevEn: string;
  path: string;
}
export const failDefs: FailDef[] = [
  { id: "SC-132", elZh: "FD-4F-02 防火門", elEn: "FD-4F-02 fire door", ruleZh: "FireRating 30min < 60min", ruleEn: "FireRating 30min < 60min", sevZh: "嚴重", sevEn: "critical", path: "/World/ARCH/4F/Doors/FD-02" },
  { id: "SC-131", elZh: "W-2F-15 牆", elEn: "W-2F-15 wall", ruleZh: "淨高 2050mm", ruleEn: "clear height 2050mm", sevZh: "高", sevEn: "high", path: "/World/ARCH/2F/Walls/W-15" },
  { id: "SC-130", elZh: "P-2F-M32 管線", elEn: "P-2F-M32 pipe", ruleZh: "間距 32mm", ruleEn: "clearance 32mm", sevZh: "中", sevEn: "med", path: "/World/MEP/2F/Pipes/M32" },
  { id: "SC-129", elZh: "D-2F-09 風管", elEn: "D-2F-09 duct", ruleZh: "支撐間距超限", ruleEn: "support spacing", sevZh: "中", sevEn: "med", path: "/World/MEP/2F/Ducts/D09" },
];

/* ── A2 diff 4 項 ── */
export interface DiffDef {
  elZh: string; elEn: string;
  kindZh: string; kindEn: string;
  tone: DiffKind;
  detail: string;
}
export const diffDefs: DiffDef[] = [
  { elZh: "B-3F-12 樑", elEn: "B-3F-12 beam", kindZh: "修改", kindEn: "mod", tone: "modified", detail: "position.z +42mm" },
  { elZh: "FD-4F-02 防火門", elEn: "FD-4F-02 door", kindZh: "移除", kindEn: "del", tone: "removed", detail: "IfcDoor deleted in v15" },
  { elZh: "W-5F-03…08 牆組", elEn: "W-5F-03…08 walls", kindZh: "新增", kindEn: "add", tone: "added", detail: "6 new IfcWall" },
  { elZh: "P-2F-M32 管線", elEn: "P-2F-M32 pipe", kindZh: "修改", kindEn: "mod", tone: "modified", detail: "diameter 80→100" },
];

/* ── A3 federation members 5 項 ── */
export interface FedMember { name: Member; ver: string; path: string; }
export const fedMembers: FedMember[] = [
  { name: "ARCH", ver: "v12", path: "/Models/ARCH/A1_Tower.usd" },
  { name: "STR", ver: "v08", path: "/Models/STR/A1_Tower.usd" },
  { name: "MEP", ver: "v15", path: "/Models/MEP/A1_Tower.usd" },
  { name: "CIVIL", ver: "v04", path: "/Models/CIVIL/A1_Tower.usd" },
  { name: "LAND", ver: "v06", path: "/Models/LAND/A1_Tower.usd" },
];

/* ── ops 服務健康 6 項 ── */
export interface ServiceDef { name: string; port: string; ok: boolean; }
export const services: ServiceDef[] = [
  { name: "bim-review-coordinator", port: ":8004", ok: true },
  { name: "governance-service", port: ":49102", ok: true },
  { name: "conversion authority", port: ":49101", ok: true },
  { name: "Kit signaling / WebRTC", port: ":49100 / :47998", ok: true },
  { name: "kit-manager-api", port: ":8010", ok: true },
  { name: "MinIO watch", port: "s3 events", ok: true },
];

/* ── home 警示 / 事件 4 項 ── */
export interface AlertDef { msgZh: string; msgEn: string; t: string; c: string; }
export const alerts: AlertDef[] = [
  { msgZh: "rule-run #88 完成:嚴重 18 項", msgEn: "rule-run #88 done: 18 critical", t: "10:53", c: "#e8615c" },
  { msgZh: "990_model.ifc 轉檔完成,品質 98%", msgEn: "990_model.ifc converted, quality 98%", t: "10:20", c: "#31c56d" },
  { msgZh: "Outbox OB-201 重試 ×2", msgEn: "Outbox OB-201 retry ×2", t: "10:41", c: "#e6b23e" },
  { msgZh: "S-240601 first-frame 1.84s", msgEn: "S-240601 first-frame 1.84s", t: "10:53", c: "#41c7e8" },
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

/* ── viewport 背景底圖對映（ws 中欄）── */
export const VP_BASE: Record<DockKey, string> = {
  a1: "vp-semantic", a2: "vp-scan", a3: "vp-federation", a4: "vp-semantic", issues: "vp-tower",
};

/* ═══ style helpers（1:1 翻譯 app.js 產生器 → React.CSSProperties）═══ */

/** badge tone 色組：[文字色, 背景色, 邊框色] */
export const badgeToneColors: Record<AppTone | "warn", readonly [string, string, string]> = {
  live: ["#4fd68a", "rgba(49,197,109,.1)", "rgba(49,197,109,.3)"],
  p3: ["#b7a9ff", "rgba(157,140,255,.1)", "rgba(157,140,255,.3)"],
  p4: ["#8f81d8", "rgba(157,140,255,.07)", "rgba(157,140,255,.2)"],
  warn: ["#e6b23e", "rgba(230,178,62,.1)", "rgba(230,178,62,.3)"],
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
    color: active ? "#dbe6f3" : "#8aa0b8",
    background: active ? "rgba(65,199,232,.10)" : "transparent",
    borderLeft: `2px solid ${active ? ACCENT : "transparent"}`,
  };
}

export const BTN: CSSProperties = {
  textAlign: "center", fontSize: 12, fontWeight: 700, color: "#04121a",
  background: `linear-gradient(135deg,${ACCENT},#2f7bf6)`, borderRadius: 9, padding: 9, cursor: "pointer",
};

export function stChip(kind: ConvStatus): CSSProperties {
  const m: Record<ConvStatus, CSSProperties> = {
    running: { fontSize: "9.5px", color: "#6fd6ee", background: "rgba(65,199,232,.08)", border: "1px solid rgba(65,199,232,.25)", borderRadius: 4, padding: "1px 6px", fontFamily: MONO },
    failed: { fontSize: "9.5px", color: "#e8615c", background: "rgba(232,97,92,.08)", border: "1px solid rgba(232,97,92,.3)", borderRadius: 4, padding: "1px 6px", fontFamily: MONO },
    done: { fontSize: "9.5px", color: "#4fd68a", background: "rgba(49,197,109,.08)", border: "1px solid rgba(49,197,109,.25)", borderRadius: 4, padding: "1px 6px", fontFamily: MONO },
  };
  return m[kind];
}

export const label9: CSSProperties = {
  fontFamily: MONO, fontSize: 9, letterSpacing: ".1em", color: "#4d6076", textTransform: "uppercase",
};

export const chipBox: CSSProperties = {
  background: "#0e1621", border: "1px solid rgba(120,160,210,.12)", borderRadius: 12,
};

export const innerBox: CSSProperties = {
  background: "#0a1220", border: "1px solid rgba(120,160,210,.12)", borderRadius: 10,
};
