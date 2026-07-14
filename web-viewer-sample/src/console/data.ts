// Edge Console 單一真相源（移植自設計原型，誠實 provenance 系統）。
// 不放任何願景假數字；每個區塊 / 應用都標真實 provenance 與 phase。

// p3 / p4：僅用於 A5–A10 roadmap vision。A1–A4 live 用 asbuilt/artifact（A4＝PARTIAL 仍標 asbuilt 能力面，缺口見 TRUTH）。
// p3 = RM phase 3（A5）；p4 = RM phase 4（A6–A10）。標 vision 願景，後端不存在（不可當真實實測）。
export type Prov = "asbuilt" | "artifact" | "demo" | "p1" | "p15" | "p3" | "p4";

export const PROV_LABEL: Record<Prov, string> = {
  asbuilt: "已實作",
  artifact: "實測 artifact",
  demo: "示範資料",
  p1: "後端待建 · P1",
  p15: "後端待建 · P1.5",
  p3: "願景 · Phase 3（後端未建）",
  p4: "願景 · Phase 4（後端未建）",
};

export const PROV_CLASS: Record<Prov, string> = {
  asbuilt: "ec-asbuilt",
  artifact: "ec-artifact",
  demo: "ec-demo",
  p1: "ec-p1",
  p15: "ec-p15",
  p3: "ec-p3",
  p4: "ec-p4",
};

export interface PageDef {
  key: string;
  no: string;
  label: string;
  plane: "governance" | "omniverse";
  group: "workspace" | "core" | "omniverse" | "coordinator" | "system";
  sub?: string;
  badge?: string;
  // 對齊設計系統 badge 色碼（warn 紅 / ai 紫 / accent 綠 / info 青 / neutral 灰）。
  badgeTone?: "warn" | "ai" | "accent" | "neutral" | "info";
}

// dot：群組指示燈（ok=綠+glow / idle=灰）。對齊設計原型左欄群組標題。
export const NAV_GROUPS: { key: PageDef["group"]; title: string; sub: string; dot: "ok" | "idle" }[] = [
  { key: "workspace", title: "工作台", sub: "WORKSPACE", dot: "ok" },
  { key: "core", title: "核心治理", sub: "CORE · 語意 / 規則 / 問題", dot: "ok" },
  { key: "omniverse", title: "OMNIVERSE RUNTIME", sub: "KIT · USD · GPU", dot: "ok" },
  { key: "coordinator", title: "落地端控制台", sub: "COORDINATOR · 1..N GPU", dot: "ok" },
  { key: "system", title: "SYSTEM", sub: "Runtime · Admin · Spec", dot: "idle" },
];

// prototype product console 導覽。保留既有 route aliases（overview/coordinator/intake/review/semantic）
// 以免舊測試與 deep links 斷掉。
export const PAGES: PageDef[] = [
  { key: "home", no: "⌂", label: "今天要做什麼", plane: "governance", group: "workspace" },
  { key: "a1", no: "A1", label: "治理與模型檢核", plane: "governance", group: "core", badge: "P0", badgeTone: "warn" },
  { key: "a2", no: "A2", label: "版本差異與責任", plane: "governance", group: "core" },
  { key: "a3", no: "A3", label: "跨專業疊合", plane: "governance", group: "core" },
  { key: "a4", no: "A4", label: "語意搜尋問答", plane: "governance", group: "core", badge: "P0", badgeTone: "warn" },
  { key: "a5", no: "A5", label: "IoT / FM 數位分身", plane: "governance", group: "core", badge: "P3", badgeTone: "ai" },
  { key: "issues", no: "BC", label: "Issue / BCF", plane: "governance", group: "core", badge: "A1", badgeTone: "info" },
  { key: "reports", no: "RP", label: "報表中心", plane: "governance", group: "core" },
  // R4（2026-07-10 裁決）：NAV 分組以互動規格 A.1.1「群組」欄為準——
  // viewer/gpu/a6–a10＝核心治理（core）；sessions/instances/minio＝OMNIVERSE RUNTIME（omniverse）；
  // runtime＝落地端控制台（coordinator，A.1.1 row20「落地端控制台 / SYSTEM」取前者）。
  { key: "viewer", no: "3D", label: "3D Viewer 呈現", plane: "omniverse", group: "core" },
  { key: "gpu", no: "01", label: "GPU 審查室", plane: "omniverse", group: "core", badge: "MVP", badgeTone: "accent" },
  { key: "a6", no: "A6", label: "4D / 5D 施工模擬", plane: "omniverse", group: "core", badge: "P4", badgeTone: "ai" },
  { key: "a7", no: "A7", label: "Reality Capture 比對", plane: "omniverse", group: "core", badge: "P4", badgeTone: "ai" },
  { key: "a8", no: "A8", label: "Synthetic Data", plane: "omniverse", group: "core", badge: "P4", badgeTone: "ai" },
  // 2026-07-13 TARGET 身分：A9＝機器人／自主巡檢；A10＝其他應用／AI 決策（舊 HTML Copilot/Robotics 文案作廢）。
  { key: "a9", no: "A9", label: "機器人 / 自主巡檢", plane: "omniverse", group: "core", badge: "P4", badgeTone: "ai" },
  { key: "a10", no: "A10", label: "其他應用 / AI 決策", plane: "omniverse", group: "core", badge: "P4", badgeTone: "ai" },
  // MD 三頁合一（Task 7）：原 conv（轉檔排程）/ minio（MinIO 資料）/ intake（Model Intake）三個 nav 項
  // 合併為單一 MD 項；#conv / #intake 由 EdgeConsole 以 alias 重導至 #minio。舊三頁本體待 Task 9 移除。
  { key: "sessions", no: "SS", label: "Session 管理", plane: "governance", group: "omniverse" },
  { key: "instances", no: "KG", label: "Kit / GPU 機隊", plane: "omniverse", group: "omniverse" },
  { key: "minio", no: "MD", label: "模型資料與轉檔", plane: "governance", group: "omniverse" },
  { key: "runtime", no: "RT", label: "Runtime 監控", plane: "omniverse", group: "coordinator" },
  { key: "admin", no: "SY", label: "系統管理", plane: "governance", group: "system", badge: "待建", badgeTone: "neutral" },
  { key: "spec", no: "▦", label: "設計規格說明", plane: "governance", group: "system" },
  { key: "overview", no: "OV", label: "Overview", plane: "governance", group: "system" },
  { key: "review", no: "G", label: "Review Room", plane: "omniverse", group: "omniverse" },
  { key: "semantic", no: "SE", label: "Semantic Viewer", plane: "omniverse", group: "omniverse" },
  { key: "apps", no: "AP", label: "Applications · A1–A10", plane: "governance", group: "system" },
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

// A1–A10 權威清單。落地：A1–A3 AS-BUILT 能力面；A4 AS-BUILT PARTIAL（deterministic search，非 LLM／非完整 IA）；
// A5–A10 roadmap vision（後端未建）。A9/A10 身分對齊 TARGET-shell 2026-07-13（A9 機器人、A10 AI 決策）。
export const A1A10: AppCardDef[] = [
  { code: "A1", slug: "governance", title: "BIM 治理與模型檢核", en: "Governance & Rule Checker", phase: 1, tier: "focus", dep: "core+omni", prov: "asbuilt", route: "issues" },
  { code: "A2", slug: "version-diff", title: "模型版本差異與責任追蹤", en: "Model Version Diff", phase: 2, tier: "focus", dep: "core", prov: "asbuilt", route: "version-diff" },
  { code: "A3", slug: "federation", title: "跨專業模型 Federation", en: "Cross-discipline Federation", phase: 2, tier: "focus", dep: "omni", prov: "asbuilt", route: "federation" },
  { code: "A4", slug: "ai-search", title: "語意查詢與證據", en: "Semantic query & evidence", phase: 1, tier: "focus", dep: "core+omni", prov: "asbuilt", route: "a4" },
  { code: "A5", slug: "iot-fm", title: "IoT / BMS / FM 數位分身", en: "IoT / FM Digital Twin", phase: 3, tier: "roadmap", dep: "core+omni", prov: "p3", route: "app/iot-fm" },
  { code: "A6", slug: "4d-5d", title: "4D / 5D 施工模擬", en: "4D / 5D Construction", phase: 2, tier: "roadmap", dep: "omni", prov: "p4", route: "app/4d-5d" },
  { code: "A7", slug: "reality-capture", title: "Reality Capture 比對", en: "Scan-to-BIM Deviation", phase: 4, tier: "roadmap", dep: "omni", prov: "p4", route: "app/reality-capture" },
  { code: "A8", slug: "synthetic-data", title: "Synthetic Data Studio", en: "Synthetic Data Studio", phase: 4, tier: "roadmap", dep: "omni", prov: "p4", route: "app/synthetic-data" },
  { code: "A9", slug: "robot-sim", title: "機器人 / 自主巡檢", en: "Robot / autonomous inspection", phase: 4, tier: "roadmap", dep: "omni", prov: "p4", route: "app/robot-sim" },
  { code: "A10", slug: "ai-decision", title: "其他應用 / AI 決策工作台", en: "Other apps / AI decision workbench", phase: 4, tier: "roadmap", dep: "omni", prov: "p4", route: "app/ai-decision" },
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
  { id: "governance", name: "Governance service", sub: "A1 rule-run / A2 diff / A3 federation / A4 search", port: "127.0.0.1:49102", plane: "internal", prov: "asbuilt" },
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
// 誠實鐵律：A1 core 的規則檢核在 governance-service（CPU）完成，但**不可**寫成「零相依 / 零授權風險」。
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

// ── A5–A10 vision 詳頁（A4 live 在 #a4，不在本表）────────
// scenario＝範例情境（非真實 run）；api＝願景 API 設計。A9/A10 身分＝TARGET 2026-07-13。
export interface AppApiDef { m: string; u: string; d: string }
export interface AppSchemaDef { t: string; f: string }
export interface AppSprintStep { sp: string; t: string; d: string }
export interface AppVisionDetail {
  code: string;
  slug: string;
  title: string;
  en: string;
  phase: number;
  prov: Prov; // p3 / p4
  pitch: string;
  goal: string;
  // 範例情境（願景敘事，非真實 run）——明確標示避免誤當實測。
  scenarioHead: string;
  scenarioResult: string;
  schema: AppSchemaDef[];
  api: AppApiDef[]; // 願景 API 設計（非已實作 route）
  ui: string[];
  mvp: string[];
  steps: AppSprintStep[];
  risks: string[];
}

export const A1A10_DETAIL: Record<string, AppVisionDetail> = {
  "iot-fm": {
    code: "A5", slug: "iot-fm", title: "IoT / BMS / FM 數位分身", en: "IoT / FM Digital Twin", phase: 3, prov: "p3",
    pitch: "把溫濕度、CO₂、電表、設備狀態綁到 BIM 元件，並把 FM 工單 / 維保紀錄連回。",
    goal: "建立 sensor / asset / work order 與 IFC GUID / USD prim path 的對映，在 3D twin 顯示即時值、熱區、告警與工單。",
    scenarioHead: "範例情境（願景敘事）：12 樓 CO₂ sensor 量到高於閾值",
    scenarioResult: "範例輸出：Review Room 顯示紅熱區 + 24 小時曲線 + 自動建 FM work order（具體數值為原型敘事，非真實 run）",
    schema: [
      { t: "sensors", f: "id · sensor_code · sensor_type · ifc_guid · usd_prim_path · room_guid · equipment_guid" },
      { t: "sensor_readings", f: "sensor_id · timestamp · value · quality（TimescaleDB hypertable）" },
      { t: "iot_alerts", f: "id · sensor_id · severity · rule · status" },
      { t: "work_orders", f: "id · asset_id · issue_id · type · status · assignee · due_date" },
    ],
    api: [
      { m: "POST", u: "/api/sensors/bind", d: "綁 sensor → IFC GUID / USD prim path" },
      { m: "POST", u: "/api/alert-rules", d: "建立告警規則" },
      { m: "POST", u: "/api/work-orders", d: "從 alert / issue / sensor 建工單" },
      { m: "GET", u: "/api/sensors/:id/readings?range=24h", d: "讀時序資料" },
    ],
    ui: ["Sensor Tree + 3D Heatmap + Sensor Detail", "Sensor Binding：Select Space in 3D → bind", "FM Panel：asset · 維修紀錄 · 工單 · SOP"],
    mvp: ["MQTT mock sensor 每 5 秒送資料", "寫入 time-series DB", "sensor 可手動綁 IFC GUID / USD prim path", "3D viewer 顯示最新值", "超過 threshold 自動建 alert"],
    steps: [
      { sp: "S1·W1", t: "MQTT bridge + TimescaleDB", d: "broker · ingest worker · retention" },
      { sp: "S1·W2", t: "Sensor binding API + UI", d: "Select-in-3D → bind" },
      { sp: "S2·W1", t: "Alert engine", d: "threshold / rate / pattern" },
      { sp: "S2·W2", t: "3D Heatmap", d: "Kit extension 寫 custom attribute" },
    ],
    risks: ["Sensor 與 BIM 對映通常人工 — 須做易用綁定 UX。", "BMS 點位命名雜亂 — 建議 alias / normalization layer。", "3D heatmap 高頻 redraw 拖累 Kit — 用 custom attribute + throttle。"],
  },
  "4d-5d": {
    code: "A6", slug: "4d-5d", title: "4D / 5D 施工模擬", en: "4D / 5D Construction", phase: 2, prov: "p4",
    pitch: "把排程、成本、工項綁到 USD prim，模擬施工順序、場地物流與衝突。",
    goal: "把 P6 / MS Project 排程 + 工項 + 成本綁到 IFC GUID，依日期 / 進度 colour overlay 顯示。",
    scenarioHead: "範例情境（願景敘事）：Activity MEP-L12-DUCT-INSTALL",
    scenarioResult: "範例輸出：拖動 timeline 顯示綠=已完成 / 黃=施工中 / 紅=延誤 / 灰=未開始（具體數字為原型敘事，非真實 run）",
    schema: [
      { t: "schedule_activities", f: "id · activity_code · wbs_code · planned_start · planned_finish · actual_start · progress_percent" },
      { t: "activity_elements", f: "activity_id · ifc_guid · usd_prim_path · quantity · cost_code" },
    ],
    api: [
      { m: "POST", u: "/api/schedules/import", d: "P6 XML / MSP / CSV 匯入" },
      { m: "POST", u: "/api/activities/:id/bind-elements", d: "綁 IFC GUID list" },
      { m: "POST", u: "/api/schedule/overlay", d: "date + mode → 3D colour overlay" },
    ],
    ui: ["Timeline + 3D simulation + Activity Info", "WBS tree · 進度依日期變色", "[Import P6] [Link Elements] [Export 4D]"],
    mvp: ["可匯入 CSV schedule", "activity 綁到 IFC GUID list", "3D 依日期顯示 planned status", "顯示 planned vs actual", "輸出延誤元素清單"],
    steps: [
      { sp: "S1·W1", t: "Schedule import (CSV)", d: "PG schema · 簡單 mapping" },
      { sp: "S1·W2", t: "Activity ↔ element 綁定 UI", d: "select-in-3D · batch by filter" },
      { sp: "S2·W1", t: "Overlay engine (Kit)", d: "date → color → DataChannel" },
    ],
    risks: ["排程 activity 太細會讓綁定變地獄 — 需 batch by WBS。", "Planned vs actual 來自不同系統 — 需 actual feed。", "5D 成本對接需財務整合 — 第一版只做 4D。"],
  },
  "reality-capture": {
    code: "A7", slug: "reality-capture", title: "Reality Capture 比對", en: "Scan-to-BIM Deviation", phase: 4, prov: "p4",
    pitch: "用點雲、攝影測量、Gaussian Splat 與設計 BIM 比對，找出現場偏差。",
    goal: "把點雲 / mesh / drone capture 對齊 BIM，逐元素產出 deviation，並一鍵建立 issue。",
    scenarioHead: "範例情境（願景敘事）：PUMP-B1-04 設計位置 vs LiDAR 實測",
    scenarioResult: "範例輸出：deviation 超過 tolerance → Failed → 自動建 issue 附 scan 證據（具體數字為原型敘事，非真實 run）",
    schema: [
      { t: "capture_jobs", f: "id · capture_type · source_uri · alignment_status · transform_json" },
      { t: "deviation_results", f: "id · capture_job_id · ifc_guid · usd_prim_path · deviation_mm · tolerance_mm · status" },
    ],
    api: [
      { m: "POST", u: "/api/capture-jobs", d: "上傳 capture artifact" },
      { m: "POST", u: "/api/capture-jobs/:id/align", d: "手動 ICP 或自動對齊" },
      { m: "POST", u: "/api/deviations/:id/to-issue", d: "轉成 issue" },
    ],
    ui: ["Capture · Model · Alignment 三欄", "Results：missing / moved / extra / geometry mismatch", "3D overlay：設計透明藍 · scan 灰點雲 · 偏差紅向量"],
    mvp: ["支援匯入一個點雲或 mesh", "可手動對齊到 BIM 坐標", "對 selected elements 做 bbox 比對", "產出 deviation list", "deviation 轉 issue"],
    steps: [
      { sp: "S1·W1-2", t: "點雲 ingest + viewer", d: ".las / .e57 / .ply · Kit point cloud node" },
      { sp: "S2·W1", t: "手動對齊工具", d: "3-point pick · ICP refine" },
      { sp: "S2·W2", t: "Bounding compare", d: "bbox 比對 scan density" },
    ],
    risks: ["點雲座標系幾乎都要手動對齊 — UX 必須順。", "Mesh-to-mesh 距離計算成本高 — async batch。", "Drone 精度可能不足做設備偏差 — 限制 use case。"],
  },
  "synthetic-data": {
    code: "A8", slug: "synthetic-data", title: "AI 訓練資料與 Synthetic Data", en: "Synthetic Data Studio", phase: 4, prov: "p4",
    pitch: "生成工地安全、設備辨識、缺陷偵測用的合成資料（Omniverse Replicator + Isaac Sim）。",
    goal: "從 BIM USD 場景 + randomization 自動產出 RGB / depth / segmentation / bbox，可匯出 COCO / YOLO。",
    scenarioHead: "範例情境（願景敘事）：Helmet detection · virtual cameras · 工地隨機人員 / 燈光",
    scenarioResult: "範例輸出：合成 frames + COCO 標註 + 每張可回溯 USD stage / camera / seed（具體數字為原型敘事，非真實 run）",
    schema: [
      { t: "dataset_jobs", f: "id · model_version_id · scene_scope · output_types · status" },
      { t: "dataset_outputs", f: "id · dataset_job_id · output_type · uri · frame_count" },
    ],
    api: [
      { m: "POST", u: "/api/datasets", d: "建立 dataset job" },
      { m: "POST", u: "/api/datasets/:id/run", d: "提交 Replicator job" },
      { m: "GET", u: "/api/datasets/:id/export?fmt=coco", d: "COCO / YOLO 匯出" },
    ],
    ui: ["Scene · Classes · Outputs · Randomization 四欄", "Place Cameras (3D pick) · Generate Preview", "[Run Full Generation] [Export COCO]"],
    mvp: ["選一個 USD floor / zone", "手動放 3 個 virtual cameras", "對 3 類設備輸出 RGB + bbox", "產出 COCO / YOLO", "可回溯每張影像來源"],
    steps: [
      { sp: "S1·W1-2", t: "Replicator pipeline 基礎", d: "BasicWriter · USD scene scope" },
      { sp: "S2·W1", t: "Camera placement UI", d: "Web → DataChannel place camera" },
      { sp: "S2·W2", t: "Randomization knobs", d: "lighting / pose / occlusion · seed 紀錄" },
    ],
    risks: ["BIM 場景幾何細節不足 → 訓練資料寫實感差。", "GPU 時間是錢 — 須 budget cap。", "Domain gap 一直存在 — 須用真實資料 fine-tune。"],
  },
  // A9＝機器人／自主巡檢（TARGET 2026-07-13；舊 A10 robot 內容歸此）。
  "robot-sim": {
    code: "A9", slug: "robot-sim", title: "機器人 / 自主巡檢", en: "Robot / autonomous inspection", phase: 4, prov: "p4",
    pitch: "在 digital twin 驗證巡檢路線、waypoints、禁行區與 camera/LiDAR coverage，再追蹤任務與異常。",
    goal: "預設模擬；實機需 edge/ROS 證據。事件連回 BIM 空間/資產與 Issue。",
    scenarioHead: "範例情境（願景敘事）：以單層 USD＋simulated robot 建含不可達點的任務",
    scenarioResult: "範例輸出：reachable/unreachable、mission progress、注入 anomaly→Issue（非真實 run）",
    schema: [
      { t: "inspection_routes", f: "id · name · robot_type · start_location · route_json" },
      { t: "inspection_targets", f: "id · route_id · ifc_guid · usd_prim_path · target_type" },
      { t: "simulation_runs", f: "id · route_id · status · result_json · output_uri" },
    ],
    api: [
      { m: "POST", u: "/api/routes", d: "建立 inspection route（願景）" },
      { m: "POST", u: "/api/routes/:id/simulate", d: "提交 Isaac Sim job（願景）" },
      { m: "GET", u: "/api/simulation-runs/:id", d: "結果（blind spot / unreachable / collision）" },
    ],
    ui: ["Robot Type / Sensor Package / Route", "Targets · reachable / blind / collision", "[Generate Route] [Run Simulation]"],
    mvp: ["一層樓一台 simulated robot", "10 inspection targets", "路線＋coverage", "unreachable / blind spot 報告"],
    steps: [
      { sp: "S1·W1-2", t: "USD robot fixture", d: "AMR / quadruped / drone asset" },
      { sp: "S2·W1", t: "Path planning", d: "navmesh · A*" },
      { sp: "S2·W2", t: "Sensor coverage", d: "frustum cast · blind detection" },
    ],
    risks: ["Isaac Sim 重量級／GPU 成本。", "BIM navmesh 常不存在。", "模擬≠實機 ROS。"],
  },
  // A10＝其他應用／AI 決策工作台（TARGET 2026-07-13；舊 A9 Copilot 能力收斂為 session-layer 決策輔助）。
  "ai-decision": {
    code: "A10", slug: "ai-decision", title: "其他應用 / AI 決策工作台", en: "Other apps / AI decision workbench", phase: 4, prov: "p4",
    pitch: "把 BIM、能耗、IFC/IDS、IoT 與氣象證據放到同一 scenario，比較 baseline／替代方案並輸出可審計建議。",
    goal: "組合層工作台；不得複製 A1–A9 資料權威。USD 寫入只到 session layer（preview→confirm→audit）。",
    scenarioHead: "範例情境（願景敘事）：baseline＋低碳 alternative 比較",
    scenarioResult: "範例輸出：KPI delta＋evidence refs＋report job id（非真實 run）",
    schema: [{ t: "decision_scenarios", f: "id · baseline_ref · alternative_ref · module_runs_json · report_uri" }],
    api: [
      { m: "POST", u: "/api/scenarios", d: "建立 scenario（願景）" },
      { m: "POST", u: "/api/scenarios/:id/compare", d: "比較 KPI（願景）" },
      { m: "POST", u: "/api/copilot/generate", d: "prompt → operation_plan preview only（session layer）" },
    ],
    ui: ["應用總覽 tabs", "Source ledger", "Evidence-linked AI 建議", "Scenario matrix / report jobs"],
    mvp: ["至少一個真 module run", "來源 drilldown", "AI 建議必帶 evidence refs", "BCF 無 bridge 時 unavailable"],
    steps: [
      { sp: "S1·W1", t: "Scenario model", d: "ownership / 例外凍結" },
      { sp: "S2·W1", t: "Module adapter", d: "接 A1/A2 證據，不第二份 DB" },
    ],
    risks: ["Catch-all 變成第二資料庫。", "跨時間源硬比較。", "AI 無證據。"],
  },
  // 舊 deep link 別名：#app/usd-copilot → 同 A10 願景（Copilot 不再佔 A9 身分）。
  "usd-copilot": {
    code: "A10", slug: "usd-copilot", title: "其他應用 / AI 決策工作台（舊別名）", en: "AI decision workbench (legacy alias)", phase: 4, prov: "p4",
    pitch: "舊 A9 Copilot deep link；正式身分已改為 A10 AI 決策工作台。",
    goal: "請改開 #a10 或 #app/ai-decision。本頁僅保留 deep-link 相容，內容同願景 A10。",
    scenarioHead: "範例情境（願景敘事）：舊 Copilot prompt → session-layer operation plan",
    scenarioResult: "範例輸出：Preview only · source model unchanged（非真實 run）",
    schema: [{ t: "usd_operations", f: "id · review_session_id · prompt · operation_plan_json · status · target_layer" }],
    api: [
      { m: "POST", u: "/api/copilot/generate", d: "prompt → operation_plan（preview only）" },
      { m: "POST", u: "/api/copilot/apply/:id", d: "apply 到 session layer（auditable）" },
    ],
    ui: ["Prompt → Preview → Apply / Reject / Undo", "Redirect note to #a10"],
    mvp: ["別名不新增能力", "正式入口 #a10"],
    steps: [{ sp: "—", t: "別名保留", d: "gap-route-convergence 收斂時可退役" }],
    risks: ["雙入口混淆 — 以 A10 為準。"],
  },
};
