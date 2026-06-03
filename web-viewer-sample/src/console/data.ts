// Edge Console 單一真相源（移植自設計原型，誠實 provenance 系統）。
// 不放任何願景假數字；每個區塊 / 應用都標真實 provenance 與 phase。

export type Prov = "asbuilt" | "artifact" | "demo" | "p1" | "p15";

export const PROV_LABEL: Record<Prov, string> = {
  asbuilt: "已實作",
  artifact: "實測 artifact",
  demo: "示範資料",
  p1: "後端待建 · P1",
  p15: "後端待建 · P1.5",
};

export const PROV_CLASS: Record<Prov, string> = {
  asbuilt: "ec-asbuilt",
  artifact: "ec-artifact",
  demo: "ec-demo",
  p1: "ec-p1",
  p15: "ec-p15",
};

export interface PageDef {
  key: string;
  no: string;
  label: string;
  plane: "governance" | "omniverse";
}

// 兩段式導覽（雲地邊界視覺化）：Governance Platform（零 GPU）/ Omniverse Runtime（綁 GPU）。
export const PAGES: PageDef[] = [
  { key: "overview", no: "A", label: "Overview", plane: "governance" },
  { key: "coordinator", no: "B", label: "Coordinator Console", plane: "governance" },
  { key: "intake", no: "C", label: "Model Intake", plane: "governance" },
  { key: "issues", no: "D", label: "Issues · 語意驗收 / Rule Center", plane: "governance" },
  { key: "apps", no: "E", label: "Applications · A1–A10", plane: "governance" },
  { key: "runtime", no: "F", label: "Runtime Dashboard", plane: "omniverse" },
  { key: "review", no: "G", label: "Review Room", plane: "omniverse" },
  { key: "semantic", no: "H", label: "Semantic Viewer", plane: "omniverse" },
];

export interface AppCardDef {
  code: string;
  slug: string;
  title: string;
  en: string;
  phase: number;
  tier: "focus" | "roadmap";
  dep: string;
  prov: Prov;
  route?: string; // 內部 console route（有 = 可點）
}

// A1–A10 權威清單（轉述自設計原型 roadmap-data.jsx RM_APPS）。
// 本 repo 落地狀態：A1 backend AS-BUILT（rule-run + IDS 匯入 + BCF 2.1 匯出）；
// A2 backend AS-BUILT（GlobalId 多級 diff + geometry_changed opt-in + issue-impact）；
// A3 backend AS-BUILT（USD sublayer federation + per-member transform + review-room handoff）；A4–A10 roadmap。
export const A1A10: AppCardDef[] = [
  { code: "A1", slug: "governance", title: "BIM 治理與模型檢核", en: "Governance & Rule Checker", phase: 1, tier: "focus", dep: "core+omni", prov: "asbuilt", route: "issues" },
  { code: "A2", slug: "version-diff", title: "模型版本差異與責任追蹤", en: "Model Version Diff", phase: 2, tier: "focus", dep: "core", prov: "asbuilt", route: "version-diff" },
  { code: "A3", slug: "federation", title: "跨專業模型 Federation", en: "Cross-discipline Federation", phase: 2, tier: "focus", dep: "omni", prov: "asbuilt", route: "federation" },
  { code: "A4", slug: "ai-search", title: "語意搜尋與模型問答", en: "USD Search & NL Query", phase: 4, tier: "roadmap", dep: "omni", prov: "p15" },
  { code: "A5", slug: "iot-fm", title: "IoT / BMS / FM 數位分身", en: "IoT / FM Digital Twin", phase: 3, tier: "roadmap", dep: "core+omni", prov: "p15" },
  { code: "A6", slug: "4d-5d", title: "4D / 5D 施工模擬", en: "4D / 5D Construction", phase: 2, tier: "roadmap", dep: "omni", prov: "p15" },
  { code: "A7", slug: "reality-capture", title: "Reality Capture 比對", en: "Scan-to-BIM Deviation", phase: 4, tier: "roadmap", dep: "omni", prov: "p15" },
  { code: "A8", slug: "synthetic-data", title: "Synthetic Data Studio", en: "Synthetic Data Studio", phase: 4, tier: "roadmap", dep: "omni", prov: "p15" },
  { code: "A9", slug: "usd-copilot", title: "USD Code / ChatUSD", en: "USD Code Copilot", phase: 4, tier: "roadmap", dep: "omni", prov: "p15" },
  { code: "A10", slug: "robot-sim", title: "機器人 / 無人機巡檢", en: "Robot / Drone Sim", phase: 4, tier: "roadmap", dep: "omni", prov: "p15" },
];

// ── 服務邊界拓樸（BoundaryDiagram 用，移植自設計原型 data.jsx SERVICES）─────────
// 三欄：WEB-PLANE（瀏覽器可達）→ CONTROL-PLANE BOUNDARY（coordinator :8004）→
// INTERNAL（瀏覽器永不直連）。port 已對齊本 repo 落地現況；governance-service :49102
// 後端 A1/A2/A3 已實作（原型時代標 p1 已過時，這裡更正為 asbuilt）。
export interface BoundaryNode {
  id: string;
  name: string;
  sub: string;
  port: string | null;
  plane: "web" | "boundary" | "internal" | "external";
  prov: Prov;
}
export const SERVICES: BoundaryNode[] = [
  { id: "browser", name: "瀏覽器 Web-plane", sub: "operator / reviewer", port: null, plane: "web", prov: "asbuilt" },
  { id: "viewer", name: "Review Room (web-viewer-sample)", sub: "USD over WebRTC", port: "127.0.0.1:5173", plane: "web", prov: "asbuilt" },
  { id: "coordinator", name: "Review Coordinator", sub: "control plane（唯一對外）", port: "127.0.0.1:8004", plane: "boundary", prov: "asbuilt" },
  { id: "streaming", name: "Streaming / Conversion authority", sub: "bim-streaming-server · 轉檔權威 + Kit 控制", port: "127.0.0.1:49101 · Kit 49100/47998", plane: "internal", prov: "asbuilt" },
  { id: "governance", name: "Governance service", sub: "A1 rule-run / A2 diff / A3 federation", port: "127.0.0.1:49102", plane: "internal", prov: "asbuilt" },
  { id: "cloud", name: "公司雲端 control-plane", sub: "bim-control · MySQL（metadata 權威）", port: "external", plane: "external", prov: "asbuilt" },
];

// ── coordinator 已實作 HTTP 路由清單（ENDPOINTS panel 用）─────────────────────
// 權威：bim-review-coordinator/src/app.ts（2026-06-03 逐一查證為真實 route，非原型轉述）。
// 只列瀏覽器 / 落地端 worker 可達的 coordinator-owned 端點；internal-token-only 端點（如
// callback-outbox 直查）標 internal，誠實說明瀏覽器不可達。governance proxy（/api/governance/*）
// 另由 governanceClient 走，不在此表重複。
export interface EndpointDef {
  m: "GET" | "POST";
  path: string;
  prov: Prov;
  note?: string;
}
export const ENDPOINTS: EndpointDef[] = [
  { m: "GET", path: "/health", prov: "asbuilt" },
  { m: "GET", path: "/api/runtime/status", prov: "asbuilt", note: "coordinator-visible runtime summary（read-only）" },
  { m: "POST", path: "/api/review-sessions", prov: "asbuilt" },
  { m: "GET", path: "/api/review-sessions/:id", prov: "asbuilt" },
  { m: "POST", path: "/api/review-sessions/:id/join", prov: "asbuilt" },
  { m: "POST", path: "/api/review-sessions/:id/leave", prov: "asbuilt" },
  { m: "GET", path: "/api/review-sessions/:id/stream-config", prov: "asbuilt" },
  { m: "GET", path: "/api/review-sessions/:id/events", prov: "asbuilt" },
  { m: "POST", path: "/api/review-sessions/:id/events", prov: "asbuilt" },
  { m: "GET", path: "/api/review-sessions/:id/lifecycle-events", prov: "asbuilt" },
  { m: "POST", path: "/api/review-sessions/:id/close", prov: "asbuilt" },
  { m: "POST", path: "/api/external/ifc-ready", prov: "asbuilt", note: "唯一對外 IFC-ready intake" },
  { m: "GET", path: "/api/external/ifc-ready", prov: "asbuilt" },
  { m: "GET", path: "/api/external/ifc-ready/:jobId", prov: "asbuilt" },
  { m: "GET", path: "/api/external/ifc-ready/:jobId/shadow", prov: "asbuilt" },
  { m: "GET", path: "/ui/open?session=:id", prov: "asbuilt", note: "server-side redirect 至 browser-visible viewer" },
  { m: "POST", path: "/api/internal/callback-outbox/deliver", prov: "asbuilt", note: "internal token only（瀏覽器不可達）" },
];

// ── 相依與授權風險（DEPENDENCIES panel 用，移植自設計原型 data.jsx）───────────
// 誠實鐵律：A1 core 是零 GPU / 零 NVIDIA runtime，但**不可**寫成「零相依 / 零授權風險」。
// 下列 LGPL / copyleft 元件商用前須法務確認。BCF 匯出本 repo 已改純 stdlib（不再依賴 GPLv3
// bcf-client），故 BCF 列標 permissive 並註明；其餘 copyleft 元件照實標。
export interface DependencyDef {
  name: string;
  license: string;
  use: string;
  risk: "copyleft" | "permissive" | "tbd";
  note?: string;
}
export const DEPENDENCIES: DependencyDef[] = [
  { name: "IfcOpenShell", license: "LGPL-3.0", use: "IFC 解析 / A1 rule-run / A2 diff", risk: "copyleft", note: "copyleft，商用前須法務確認" },
  { name: "ifctester (IDS)", license: "LGPL-3.0", use: "A1 buildingSMART IDS 規則驗證", risk: "copyleft", note: "copyleft，商用前須法務確認" },
  { name: "OpenUSD (pxr)", license: "Apache-2.0", use: "A3 federation USD authoring", risk: "permissive" },
  { name: "openpyxl", license: "MIT", use: "A1 rule-run Excel 匯出", risk: "permissive" },
  { name: "BCF 2.1 匯出（本 repo 自實作）", license: "本專案碼（純 stdlib zipfile/ElementTree）", use: "issue → .bcfzip", risk: "permissive", note: "已改純 stdlib，不依賴 GPLv3 bcf-client" },
  { name: "本地 issue / shadow metadata DB", license: "—", use: "本地 issue 表 / shadow metadata", risk: "tbd" },
];
