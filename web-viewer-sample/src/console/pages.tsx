// Edge Console 頁面。誠實原則：AS-BUILT 才標已實作；待建一律標 p1/p15 並說明；
// 任何數字非真即標 artifact / demo，絕不捏造。
import { Fragment, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { t } from "./i18n";
import { Btn, Field, Metric, Panel, ProvTag, ProvLegend } from "./components";
import { a1Reducer, initialA1State, uiSteps } from "./a1Machine";
import { A1A10, A1A10_DETAIL, AppCardDef, AppVisionDetail, DEPENDENCIES, ENDPOINTS, PAGES, Prov, PROV_CLASS, SERVICES } from "./data";
import { CoordReport, DiffIssueImpact, DiffItemRow, DiffOverlayResult, DiffStatus, FailureRow, FederatedBuildResult, FileProjectRow, FileVersionRow, governanceClient, IssueRow, ReviewRoomDescriptor, RuleResultRow, RuleRunStatus } from "./governanceClient";
import { coordinatorClient, ConversionRecord, ConversionQualityMetricsResponse, ConversionLifecycleStatus, DevConversionRecord, IfcReadyListItem, MinioWatchStatus, narrowConversionStatus, RuntimeStatus } from "./coordinatorClient";
import { CoordinatorGovernanceTabs } from "./coordinator/RuntimeGovernanceTabs";
import { IntentDialog } from "./IntentDialog";
import { ReviewSessionViewerPane } from "./ReviewSessionViewerPane";
// 重用既有 viewer 的 mapping fake-vs-real 隔離工具（已有測試）：mock / allow_fake_mapping /
// fake_mapping_count>0 / mapping_method=fake_for_smoke_test 一律當 fake，不重造輪子。
import { ElementMappingDocument, isFakeMappingDocument, isFakeMappingItem, mappingVerificationBlockReason } from "../types/mapping";
// StreamConfigReader 已抽成獨立葉子檔（破解 pages ↔ coordinator/RuntimeGovernanceTabs 循環依賴）；
// RuntimePage（本檔內）由此 leaf 直接 import 復用同一元件。RuntimeGovernanceTabs 亦各自 leaf import，故無 re-export 需求。
import { StreamConfigReader } from "./StreamConfigReader";
// 七軸通用 cross-page handoff util（§4）：URL hash 帶非機密關聯 ID，接收端重驗，不帶 lease token。
import { buildHandoff } from "./handoff";

type NativeFilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<Array<{ name: string }>>;
};

// A1 真實 IFC 驗證 artifact（committed evidence，PR #151；非捏造，為實測值）。
const A1_EVIDENCE = { schema: "IFC4X3", file: "fixture-bytes.ifc", total: 7126, uniqueElements: 6715, passed: 7055, failed: 71, score: 99.0, date: "2026-06-02" };

// A1 規則檢核的預設 IFC 路徑：部署可用 VITE_A1_DEFAULT_IFC_PATH 覆寫成該機 storage 的真實路徑。
// 開發機 fallback 指向 repo 內 storage/fixture-bytes.ifc（dev/E2E 用）;部署區未設此 env 時操作員仍可手動改輸入框。
// （#/a1 移除內嵌 file-library 選擇器後若仍寫死開發機絕對路徑,別機部署會在第一步 rule-run 即 ifc_source_path not found。）
function defaultA1IfcPath(): string {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return meta?.VITE_A1_DEFAULT_IFC_PATH || "C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\fixture-bytes.ifc";
}

function defaultA1IdsPath(): string {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return meta?.VITE_A1_DEFAULT_IDS_PATH || "C:\\Repos\\active\\iot\\AI-BIM-governance\\governance-service\\rules\\sample-fire-rating.ids";
}

function fileInSameDirectory(currentPath: string, fileName: string): string {
  const cleanName = fileName.replace(/[\\/]/g, "");
  const trimmed = currentPath.trim();
  const slash = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (slash < 0) return cleanName;
  const dir = trimmed.slice(0, slash);
  const sep = trimmed.includes("\\") ? "\\" : "/";
  return `${dir}${sep}${cleanName}`;
}

// 三欄服務邊界圖（移植自原型 BoundaryDiagram）：WEB-PLANE → CONTROL-PLANE BOUNDARY → INTERNAL。
// 純展示（asbuilt 拓樸）；視覺化「瀏覽器只打 coordinator :8004」鐵律。
function BoundaryDiagram() {
  const col = (plane: "web" | "boundary" | "internal" | "external", cap: string, cls: string) => (
    <div className={`ec-bd-col ${cls}`}>
      <div className="ec-bd-cap">{cap}</div>
      {SERVICES.filter((s) => s.plane === plane).map((s) => (
        <div className="ec-bd-node" key={s.id}>
          <div className="ec-bd-name">{s.name}</div>
          <div className="ec-bd-sub">{s.sub}</div>
          {s.port && <div className="ec-bd-port">{s.port}</div>}
        </div>
      ))}
    </div>
  );
  return (
    <div className="ec-boundary">
      {col("web", t("WEB-PLANE · 瀏覽器可達", "WEB-PLANE · browser-reachable"), "web")}
      <div className="ec-bd-link"><span className="ec-bd-arrow">→</span><span>{t("僅此一條", "the only path")}<br />HTTPS / WSS</span></div>
      {col("boundary", "CONTROL-PLANE BOUNDARY", "boundary")}
      <div className="ec-bd-link"><span className="ec-bd-arrow">→</span><span>internal<br />loopback</span></div>
      <div className="ec-bd-col internal">
        <div className="ec-bd-cap">{t("INTERNAL · 瀏覽器永不直連", "INTERNAL · never directly reached by the browser")}</div>
        {SERVICES.filter((s) => s.plane === "internal" || s.plane === "external").map((s) => (
          <div className="ec-bd-node" key={s.id}>
            <div className="ec-bd-name">{s.name}</div>
            <div className="ec-bd-sub">{s.sub}</div>
            {s.port && <div className="ec-bd-port">{s.port}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniCard({ code, title, desc, prov = "asbuilt" }: { code: string; title: string; desc: string; prov?: Prov }) {
  return (
    <div className="ec-mini-card">
      <div className="ec-mini-head"><span className="ec-code">{code}</span><ProvTag prov={prov} /></div>
      <div className="ec-mini-title">{title}</div>
      <p className="ec-note">{desc}</p>
    </div>
  );
}

function LifecycleStrip({ steps, statuses }: { steps: string[]; statuses?: ("done" | "current" | "future")[] }) {
  const cls = (i: number) => {
    const st = statuses?.[i];
    if (st === "done") return "done";
    if (st === "current") return "active";
    if (st === "future") return "";
    return i === 0 ? "active" : "";
  };
  return (
    <div className="ec-flow" style={{ margin: "8px 0 12px" }}>
      {steps.map((s, i) => (
        <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span className={`ec-flow-step ${cls(i)}`}><span className="ec-flow-n">{i + 1}</span>{s}</span>
          {i < steps.length - 1 && <span className="ec-flow-arrow">→</span>}
        </span>
      ))}
    </div>
  );
}

export function HomePage({ onOpen }: { onOpen: (route: string) => void }) {
  const actions = [
    ["A1", t("跑一次治理檢核", "Run a governance check"), t("上傳或選取模型，自動檢查命名、分類、防火、LOD 是否合規。", "Upload or select a model; automatically check naming, classification, fire-rating and LOD compliance."), "a1"],
    ["A2", t("比較兩個版本", "Compare two versions"), t("看 v06 / v07 新增、修改、刪除與 issue 影響。", "See v06 / v07 added, modified, removed changes and issue impact."), "a2"],
    ["A3", t("打開跨專業疊合", "Open cross-discipline federation"), t("把建築、結構、機電模型組成 federation review room。", "Combine architecture, structure and MEP models into a federation review room."), "a3"],
    ["BC", t("整理 Issue / BCF", "Organize issues / BCF"), t("把 A1/A2/A3/A5 的問題輸出成 BCF / Excel / 報表。", "Export A1/A2/A3/A5 issues as BCF / Excel / reports."), "issues"],
    ["CV", t("查看轉檔排程", "View conversion scheduling"), t("確認 IFC-ready、conversion job、mapping coverage、stage writeback。", "Confirm IFC-ready, conversion job, mapping coverage and stage writeback."), "conv"],
    ["SS", t("檢查 Session / Viewer", "Inspect session / viewer"), t("看 primary/spectator 是否真的收到 first frame。", "Check whether primary/spectator actually received the first frame."), "sessions"],
  ] as const;
  return (
    <>
      <h1>{t("今天要做什麼 · AI-BIM Governance 工作台", "What to do today · AI-BIM Governance workbench")}</h1>
      <p className="ec-lead">{t("這是 operator 的第一屏：先看哪件事能交付、哪件事卡住、哪個 runtime 只是宣稱 ready。所有能力都保留 provenance，不把 roadmap 說成已完成。", "This is the operator's first screen: see what can be delivered, what is blocked, and which runtime merely claims to be ready. Every capability keeps its provenance; the roadmap is never presented as done.")}</p>
      <Panel title="Smart Todo" sub={t("從 prototype 收斂出的常用入口；按鈕只導向已存在頁面，不做隱藏副作用", "Common entry points distilled from the prototype; buttons only navigate to existing pages, with no hidden side effects")} prov="asbuilt">
        <div className="ec-grid">
          {actions.map(([code, title, desc, route]) => (
            <button key={route} className="ec-action-card" onClick={() => onOpen(route)}>
              <span className="ec-code">{code}</span>
              <strong>{title}</strong>
              <span>{desc}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Recent Risk" sub={t("用業務語言呈現，不把技術 ID 放第一層", "Presented in business language; technical IDs are not surfaced first")} prov="demo">
        <Field k={t("黃 · 有 viewer 等待第一幀", "Amber · a viewer is waiting for the first frame")} v={t("到 Session 管理看 first_frame_at / heartbeat", "Go to Session management to check first_frame_at / heartbeat")} prov="demo" />
        <Field k={t("黃 · 有 IFC 已轉檔但 mapping coverage 待確認", "Amber · an IFC is converted but mapping coverage is unconfirmed")} v={t("到 IFC→USD 轉檔排程看 coverage", "Go to IFC→USD conversion scheduling to check coverage")} prov="demo" />
        <Field k={t("綠 · A1 rule-run 可用", "Green · A1 rule-run is available")} v={t("governance-service :49102 經 coordinator proxy", "governance-service :49102 via coordinator proxy")} prov="asbuilt" />
      </Panel>
    </>
  );
}

export function OverviewPage() {
  // 可選接 coordinator /health 探活（真實端點）。未連線時誠實顯示「未連線」，不假裝 healthy。
  const [health, setHealth] = useState<"unknown" | "ok" | "down">("unknown");
  useEffect(() => {
    let alive = true;
    coordinatorClient.health()
      .then((h) => { if (alive) setHealth(h.status === "ok" ? "ok" : "down"); })
      .catch(() => { if (alive) setHealth("down"); });
    return () => { alive = false; };
  }, []);
  const builtCount = ENDPOINTS.length;
  return (
    <>
      <h1>{t("系統總覽 · Edge Console Overview", "System overview · Edge Console Overview")}</h1>
      <p className="ec-lead">
        {t("落地端重量伺服器（AI-BIM-governance）的操作頁。每塊資料都標來源：已實作 / 實測 artifact / 示範 / 後端待建。畫面無任何願景假數字。", "Operations page for the on-premise heavy server (AI-BIM-governance). Every piece of data is labeled with its provenance: implemented / measured artifact / demo / backend not built. No vision-only fake numbers appear on screen.")}
      </p>
      <Panel title={t("落地端健康狀態 · Edge Health", "On-premise health status · Edge Health")} sub={t("coordinator / kit 為 as-built；conversion / gpu 無遙測標未取得，不畫成 fail", "coordinator / kit are as-built; conversion / gpu have no telemetry and are marked not available, not rendered as fail")} prov="asbuilt">
        <div className="ec-grid">
          {/* /health 探活結果（up / down / 探活中）皆為真實觀測 → 一律標 asbuilt（真實探活）；
              down 是「真的探到不可達」，不是示範資料。demo 只保留給完全沒有真實遙測來源的值。 */}
          <Field
            k="COORD Coordinator :8004"
            v={health === "ok" ? "control plane · /health ok" : health === "down" ? t("未連線（/health 不可達）", "not connected (/health unreachable)") : t("control plane（探活中…）", "control plane (probing…)")}
            prov="asbuilt"
          />
          <Field k="KIT Runtime 49100/47998" v="local_fixed" prov="asbuilt" />
          <Field k="CONV Conversion :49101" v={t("未取得", "not available")} prov="demo" />
          <Field k="GPU" v={t("未取得", "not available")} prov="demo" />
          <Field k="GOV governance-service :49102" v="rule-run authority" prov="asbuilt" />
        </div>
        <p className="ec-note">{t("COORD /health 為真實探活；conversion / gpu 無統一遙測來源 → 標「未取得」（idle，非 fail），不捏造數值。", "COORD /health is a real probe; conversion / gpu have no unified telemetry source → marked \"not available\" (idle, not fail), with no fabricated values.")}</p>
      </Panel>

      <Panel title={t("服務邊界 · Web-plane → Coordinator → Internal", "Service boundary · Web-plane → Coordinator → Internal")} sub={t("瀏覽器只與 coordinator :8004 對話；49100/49101/49102 為內部，永不直連", "The browser only talks to coordinator :8004; 49100/49101/49102 are internal and never directly reached")} prov="asbuilt">
        <BoundaryDiagram />
      </Panel>

      <Panel title={t(`已實作面 · Coordinator HTTP 介面（${builtCount} 個路由）`, `Implemented surface · Coordinator HTTP interface (${builtCount} routes)`)} sub={t("權威：bim-review-coordinator/src/app.ts（逐一查證）", "Authority: bim-review-coordinator/src/app.ts (verified one by one)")} prov="asbuilt">
        <div>
          {ENDPOINTS.map((e) => (
            <div className="ec-ep" key={e.m + e.path}>
              <span className={`ec-ep-m ec-ep-${e.m.toLowerCase()}`}>{e.m}</span>
              <span className="ec-ep-p">{e.path}</span>
              {e.note && <span className="ec-ep-note">· {e.note}</span>}
            </div>
          ))}
        </div>
        <p className="ec-note">{t("另有 A1/A2/A3 governance proxy（", "There is also an A1/A2/A3 governance proxy (")}<code>/api/governance/*</code>{t("）由 governanceClient 走，透傳至 governance-service :49102。", ") routed through governanceClient and forwarded to governance-service :49102.")}</p>
      </Panel>

      <Panel
        title={t("相依與授權風險 · License posture", "Dependency & license risk · License posture")}
        sub={t("A1 core 的規則檢核在 governance-service（CPU）完成，仍依賴下列元件；LGPL / copyleft 商用前須法務確認（不得宣稱無授權風險）", "A1 core rule validation runs in the governance-service (CPU) but still depends on the components below; LGPL / copyleft must be cleared by legal before commercial use (do not claim zero license risk).")}
        prov="asbuilt"
      >
        <table className="ec-table">
          <thead><tr><th>{t("元件", "Component")}</th><th>{t("授權", "License")}</th><th>{t("用途", "Use")}</th><th>{t("風險", "Risk")}</th></tr></thead>
          <tbody>
            {DEPENDENCIES.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td>{d.license}</td>
                <td>{d.use}{d.note ? ` · ${d.note}` : ""}</td>
                <td><span className={`ec-risk ec-risk-${d.risk}`}>{d.risk === "copyleft" ? t("copyleft（須法務）", "copyleft (needs legal)") : d.risk === "permissive" ? "permissive" : t("待定", "TBD")}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Phase Backlog" sub={t("近期重點 A1–A3；A4–A10 為 ROADMAP", "Near-term focus A1–A3; A4–A10 are ROADMAP")}>
        <Field k={t("A1 治理與模型檢核（rule-run authority）", "A1 Governance & model validation (rule-run authority)")} v={t("backend 已實作", "backend implemented")} prov="asbuilt" />
        <Field k={t("A2 版本差異 · A3 Federation", "A2 Version diff · A3 Federation")} v={t("已實作（GlobalId diff + USD sublayer federation）", "Implemented (GlobalId diff + USD sublayer federation)")} prov="asbuilt" />
        <Field k={t("Issue 資料庫（lifecycle + audit + 來源綁定）· IDS 匯入", "Issue database (lifecycle + audit + source binding) · IDS import")} v={t("已實作", "Implemented")} prov="asbuilt" />
        <Field k={t("BCF 匯出（issue→.bcfzip）", "BCF export (issue→.bcfzip)")} v={t("已實作（純 stdlib，不依賴 GPLv3）", "Implemented (pure stdlib, no GPLv3 dependency)")} prov="asbuilt" />
      </Panel>
    </>
  );
}

function buildA1ReviewRoomHandoffHash(args: {
  sessionId: string;
  runId: string | null;
  row: RuleResultRow | null | undefined;
  expectedStageUrl?: string | null;
}): string {
  const q = new URLSearchParams({ source: "a1", session: args.sessionId });
  if (args.runId) q.set("rule_run_id", args.runId);
  if (args.row?.ifc_guid) q.set("ifc_guid", args.row.ifc_guid);
  if (args.row?.usd_prim_path) q.set("usd_prim_path", args.row.usd_prim_path);
  if (args.row?.rule_code) q.set("rule_code", args.row.rule_code);
  if (args.row?.severity) q.set("severity", args.row.severity);
  if (args.row?.message) q.set("label", args.row.message);
  const mappingStatus = args.row && !args.row.usd_prim_path
    ? args.row.mapping_information_status ?? "incomplete"
    : args.row?.mapping_information_status ?? null;
  if (mappingStatus) q.set("mapping_information_status", mappingStatus);
  if (args.row?.mapping_issue_code) q.set("mapping_issue_code", args.row.mapping_issue_code);
  if (typeof args.row?.mapping_issue_count === "number") q.set("mapping_issue_count", String(args.row.mapping_issue_count));
  if (args.expectedStageUrl) q.set("expected_stage_url", args.expectedStageUrl);
  return `#review?${q.toString()}`;
}

function a1ReviewRoomHandoffReason(row: RuleResultRow | null | undefined, selectedSession: string): string {
  if (!selectedSession) return t("尚未選取 review session", "No review session selected yet");
  if (!row) return t("尚無失敗構件可交給 Review Room", "No failed element to hand off to Review Room");
  if (!row.ifc_guid) return t("此構件無 ifc_guid，無法定位", "This element has no ifc_guid; it cannot be located");
  return "";
}
function isElementMappingDocumentLike(value: unknown): value is ElementMappingDocument {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ElementMappingDocument).items));
}
function mappingDiagnosticFromDocument(value: ElementMappingDocument): Pick<RuleResultRow, "mapping_information_status" | "mapping_issue_code" | "mapping_issue_count"> {
  const firstIssue = value.issues?.find((issue) => typeof issue.code === "string");
  const mappingIssueCode = value.summary?.mapping_issue_code ?? firstIssue?.code ?? null;
  const mappingIssueCount = typeof value.summary?.mapping_issue_count === "number"
    ? value.summary.mapping_issue_count
    : value.issues?.length ?? null;
  const mappingInformationStatus = value.summary?.mapping_information_status
    ?? (mappingIssueCode || mappingIssueCount ? "incomplete" : null);
  return {
    mapping_information_status: mappingInformationStatus,
    mapping_issue_code: mappingIssueCode,
    mapping_issue_count: mappingIssueCount,
  };
}
function enrichRuleResultsWithMapping(rows: RuleResultRow[], value: unknown): RuleResultRow[] {
  if (!isElementMappingDocumentLike(value) || isFakeMappingDocument(value)) return rows;
  const primByGuid = new Map<string, string>();
  for (const item of value.items ?? []) {
    if (item.ifc_guid && item.usd_prim_path && !isFakeMappingItem(item)) {
      primByGuid.set(item.ifc_guid, item.usd_prim_path);
    }
  }
  const diagnostic = mappingDiagnosticFromDocument(value);
  return rows.map((row) => {
    if (row.usd_prim_path || !row.ifc_guid) return row;
    const usdPrimPath = primByGuid.get(row.ifc_guid);
    if (usdPrimPath) return { ...row, usd_prim_path: usdPrimPath };
    if (!diagnostic.mapping_information_status && !diagnostic.mapping_issue_code && diagnostic.mapping_issue_count === null) return row;
    return { ...row, ...diagnostic };
  });
}

export function A1GovernanceWorkbenchPage() {
  const [state, dispatch] = useReducer(a1Reducer, initialA1State);
  const [idsPath, setIdsPath] = useState(defaultA1IdsPath);
  // A1（B2）step①：MinIO source_ifc 物件清單（下拉資料源）。null=載入中、[]=空/錯誤；selectedKey 供 step② PICK 與排隊轉檔共用。
  const [minioObjects, setMinioObjects] = useState<import("./coordinatorClient").MinioObject[] | null>(null);
  const [minioErr, setMinioErr] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");
  // A1（B2）task3：無 session 分支手動排入 IFC→USD 轉檔的排隊狀態 + 輪詢 ref。
  // 誠實鐵律：convStatus 原樣顯示 lifecycle（detected/queued/converting/ready/failed）或降級 fallback，轉檔未完成不偽造 ready。
  const [convJobId, setConvJobId] = useState<string | null>(null);
  const [convStatus, setConvStatus] = useState<string | null>(null); // 原樣顯示 lifecycle / fallback；誠實不偽造 ready
  const [convErr, setConvErr] = useState<string | null>(null);
  const [convBusy, setConvBusy] = useState(false);
  const convPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (convPollRef.current) clearInterval(convPollRef.current); }, []);
  // 交付動作（建 Issue / 匯出）失敗的誠實 UI 回饋：後端離線時操作員必須看得到失敗
  // （對齊 doRun 的 runError；component-local，不污染 reducer 語意）。下次成功動作清除。
  const [actionErr, setActionErr] = useState<string | null>(null);
  // F4：fetch 期間 disable 兩鈕（Excel 與 BCF 同等 loading 保護，防重送）。
  const [excelBusy, setExcelBusy] = useState(false);
  const [bcfBusy, setBcfBusy] = useState(false);
  // Review session 只作為 3D/Review Room handoff 與 mapping enrichment 的 optional target。
  // A1 v2 的治理 rule-run 直接對已選 IFC 檔案執行；A1 mount 不得自動選第一個 session 或 claim viewer lease。
  const [sessions, setSessions] = useState<{ session_id: string; status: string; expected_stage_url: string | null; expected_mapping_url?: string | null; first_frame_at?: string | null }[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const idsFileInputRef = useRef<HTMLInputElement>(null);
  const ui = uiSteps(state);
  const runId = state.run?.rule_run_id ?? null;

  // doRun 輪詢守門：pollGen 在 (a) 元件 unmount、(b) step 離開 running（PICK_FILE/RESET 重置）
  // 時遞增，讓 in-flight 輪詢迴圈以「自己的 generation 已失效」中斷，避免 unmount 後仍每秒
  // 發 getRuleRun 的資源洩漏（最多 60 次）。reducer 守門已防髒資料寫入，此處再防無謂請求。
  const pollGenRef = useRef(0);
  useEffect(() => () => { pollGenRef.current += 1; }, []);
  useEffect(() => { if (state.step !== "running") pollGenRef.current += 1; }, [state.step]);

  // Mount 時只列出可手動選取的 active/created session。不得自動選 act[0]；
  // 3D attach/lease 由 Review Room 明確按鈕啟動。
  useEffect(() => {
    let alive = true;
    coordinatorClient.runtimeStatus()
      .then((rt) => {
        if (!alive) return;
        const act = rt.sessions.items.filter((s) => s.status === "active" || s.status === "created");
        setSessions(act);
      })
      .catch(() => { if (alive) setSessions([]); }); // 連不上就空，不假資料
    return () => { alive = false; };
  }, []);

  // A1（B2）step①：列 MinIO source_ifc 物件供下拉選模型。誠實：失敗顯錯、空就空，不偽造。
  useEffect(() => {
    let alive = true;
    coordinatorClient.getMinioObjects()
      .then((res) => { if (alive) { setMinioObjects(res.objects.filter((o) => o.role === "source_ifc")); setMinioErr(null); } })
      .catch((e) => { if (alive) { setMinioObjects([]); setMinioErr(String(e)); } });
    return () => { alive = false; };
  }, []);

  const doRun = useCallback(async () => {
    // A1 v2 gating：須先選定 IFC 檔案；review session 只影響後續 3D handoff / mapping enrichment。
    if (state.step === "idle" || !state.ifcPath) return;
    // running-error 子態（RUN_FAIL 後 step 仍 running、runError=true）的重試走 RUN_RETRY；
    // 否則 plain RUN 在 running 是 no-op（防雙擊污染），「可重試」按鈕會點了沒反應（spec §5）。
    dispatch({ type: state.step === "running" && state.runError ? "RUN_RETRY" : "RUN" });
    // 開跑前捕捉 generation；不可在 await createRuleRun 之後重新捕捉，否則 await 視窗內
    // dispatch PICK_FILE 遞增的新 gen 會被抓回來，守門永遠通過、舊輪詢繼續打（資源洩漏）。
    const myGen = pollGenRef.current;
    try {
      const { rule_run_id } = await governanceClient.createRuleRun({
        ifc_source_path: state.ifcPath,
        ids_path: idsPath || undefined,
      });
      if (pollGenRef.current !== myGen) return; // createRuleRun await 視窗內取消（PICK_FILE/unmount）→ 不啟動輪詢
      let st: RuleRunStatus | null = null;
      for (let i = 0; i < 60; i++) {
        if (pollGenRef.current !== myGen) return; // unmount / step 重置 → 中斷輪詢，不再發請求
        st = await governanceClient.getRuleRun(rule_run_id);
        if (pollGenRef.current !== myGen) return; // await 期間失效 → 不再 dispatch
        dispatch({ type: "RUN_PROGRESS", run: st });
        // in-progress 白名單：只有 queued/running 才續輪詢；任何 terminal status（含後端
        // 回的型別 union 外 errored/cancelled）即時中斷，不空轉 60 次。
        if (st.status !== "queued" && st.status !== "running") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (pollGenRef.current !== myGen) return;
      if (st && st.status === "succeeded") {
        let failed = await governanceClient.getResults(rule_run_id, "failed");
        const mappingUrl = sessions.find((s) => s.session_id === selectedSession)?.expected_mapping_url ?? null;
        if (selectedSession && mappingUrl && failed.some((row) => row.ifc_guid && !row.usd_prim_path)) {
          try {
            const mappingDoc = await governanceClient.elementMappingForSession(selectedSession, mappingUrl);
            failed = enrichRuleResultsWithMapping(failed, mappingDoc);
          } catch {
            // Mapping enrichment is best-effort. The button remains honestly disabled if no usd_prim_path is observed.
          }
        }
        if (pollGenRef.current !== myGen) return;
        dispatch({ type: "RUN_DONE", run: st, failed });
      } else {
        dispatch({ type: "RUN_FAIL", error: st ? `rule-run ${st.status}` : "no status" });
      }
    } catch (e) {
      if (pollGenRef.current !== myGen) return; // unmount / 重置後吞掉殘餘錯誤，不寫回已卸載 UI
      dispatch({ type: "RUN_FAIL", error: String(e) });
    }
  }, [state.step, state.runError, state.ifcPath, idsPath, selectedSession, sessions]);

  const setIdsFileNameInCurrentDirectory = useCallback((fileName: string) => {
    setIdsPath((current) => fileInSameDirectory(current || defaultA1IdsPath(), fileName));
  }, []);

  const openIdsFilePicker = useCallback(async () => {
    const picker = (window as NativeFilePickerWindow).showOpenFilePicker;
    if (picker) {
      try {
        const [handle] = await picker({
          multiple: false,
          types: [{ description: "buildingSMART IDS", accept: { "application/xml": [".ids"], "text/xml": [".ids"] } }],
        });
        if (handle?.name) setIdsFileNameInCurrentDirectory(handle.name);
        return;
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
      }
    }
    idsFileInputRef.current?.click();
  }, [setIdsFileNameInCurrentDirectory]);

  const makeIssues = useCallback(async () => {
    if (!runId) return;
    setActionErr(null); // 重試前清掉上次錯誤
    try {
      const { created } = await governanceClient.issuesFromRuleRun(runId);
      dispatch({ type: "CREATE_ISSUES_OK", issueCount: created });
    } catch (e) {
      // 後端離線：誠實不前進（不偽造 issued），但顯示失敗讓操作員知道（誠實鐵律）。
      setActionErr(`${t("建 Issue 失敗：", "Failed to create Issue: ")}${String(e)}`);
    }
  }, [runId]);

  const doExport = useCallback(async () => {
    if (!runId) return;
    setActionErr(null); // 重試前清掉上次錯誤
    setExcelBusy(true);
    try {
      const res = await fetch(governanceClient.exportUrl(runId));
      if (!res.ok) { setActionErr(`${t("匯出失敗：HTTP ", "Export failed: HTTP ")}${res.status}`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // 錨點須掛載於 document 才觸發 .click()：Firefox（Gecko）與部分 Edge 對 detached <a> 下載不可靠，
      // 會靜默失敗（EXPORT_OK 永不 dispatch、UI 卡 scored 無回饋，違誠實鐵律）。appendChild→click→removeChild
      // 為跨瀏覽器最安全慣例。
      const a = document.createElement("a"); a.href = url; a.download = `rule-run-${runId}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      dispatch({ type: "EXPORT_OK" });
    } catch (e) {
      setActionErr(`${t("匯出失敗：", "Export failed: ")}${String(e)}`); // 誠實顯示失敗，不靜默
    } finally {
      setExcelBusy(false);
    }
  }, [runId]);

  // A1（B2）task3：無 session 時手動排入 IFC→USD 轉檔。立即輪詢一次讓 UI/測試不必等 interval；非終態才掛 2s interval。
  const queueConversion = useCallback(async () => {
    if (!selectedKey || convBusy) return;
    setConvErr(null);
    setConvBusy(true);
    // #1 race 防護：立即清除上一輪殘留的輪詢 interval，避免其在本輪 await（trigger / pollOnce）期間 fire，
    // 以舊 job 的 lifecycle 覆寫 convStatus（閃爍至舊值）。必須在第一個 await 之前清，不可等第一次 pollOnce(newJobId) resolve 後。
    if (convPollRef.current) { clearInterval(convPollRef.current); convPollRef.current = null; }
    setConvStatus(t("觸發中…", "triggering…"));
    const pollOnce = async (jobId: string): Promise<string | null> => {
      const job = await coordinatorClient.getIfcReadyJob(jobId);
      // 主讀 conversion_lifecycle_status；缺失才誠實降級到 conversion_status / download_status / status。
      const lifecycle = job.conversion_lifecycle_status ?? job.conversion_status ?? job.download_status ?? job.status;
      setConvStatus(lifecycle);
      if (job.conversion_lifecycle_status === "ready") {
        // 轉好 → coordinator 已自動建立 review session；重抓 runtime/status 讓 A1 的 Review Room handoff 能使用該 session。
        const rt = await coordinatorClient.runtimeStatus();
        const act2 = rt.sessions.items.filter((s) => s.status === "active" || s.status === "created");
        setSessions(act2);
        // 轉檔完成後只能用本 job 的 review_session_id 精準反查。不得 fallback 到 act2[0]：
        // runtime/status 是全域 session 清單，共享環境中 act2[0] 可能是別人的 session，會讓 A1 對錯模型跑治理檢核。
        if (!job.review_session_id) {
          setConvErr(t("轉檔 ready，但 job 未回 review_session_id；請手動選擇正確 review session", "conversion is ready, but the job did not return review_session_id; select the correct review session manually"));
          return job.conversion_lifecycle_status;
        }
        const ownSession = act2.find((s) => s.session_id === job.review_session_id);
        if (ownSession) {
          setSelectedSession(ownSession.session_id);
        } else {
          setConvErr(t("轉檔 ready，但 runtime/status 尚未列出該 review session；請重新整理或手動選擇", "conversion is ready, but runtime/status has not listed that review session yet; refresh or select manually"));
        }
      }
      return job.conversion_lifecycle_status;
    };
    try {
      const res = await coordinatorClient.triggerConversion(selectedKey);
      const jobId = res.ifc_ready_job_id ?? null;
      setConvJobId(jobId);
      if (!jobId) { setConvErr(t("trigger 未回 job id", "trigger returned no job id")); setConvStatus(null); return; } // 註：TriggerConversionResponse 已無 detail 欄（task#0 收緊型別），失敗 detail 由 jsonPost throw 經 catch 顯示
      const first = await pollOnce(jobId);
      if (convPollRef.current) { clearInterval(convPollRef.current); convPollRef.current = null; }
      if (first !== "ready" && first !== "failed") {
        // 捕獲本輪 interval id，清除前比對 convPollRef.current === intervalId：避免「round1 的 in-flight
        // pollOnce 其 .then/.catch 在 round2 已換上新 interval 後，誤清掉 round2 的 interval」的識別競態
        // （pollOnce in-flight 期間 convBusy 已在 finally 清掉、按鈕重啟用 → 使用者再次排入即可觸發）。
        const intervalId = setInterval(() => {
          void pollOnce(jobId)
            .then((s) => { if ((s === "ready" || s === "failed") && convPollRef.current === intervalId) { clearInterval(intervalId); convPollRef.current = null; } })
            // ready 分支若先 setConvStatus("ready") 再 await runtimeStatus()，runtimeStatus 拋（coordinator 短暫
            // 503 / 重啟）會落到此 .catch：須比照首輪 poll 的外層 catch 也 setConvStatus(null)，否則 convStatus
            // 卡在 "ready" 又顯示 error 且 sessions 仍空，誤導操作員「轉好了」卻無動作、無重試路徑（誠實鐵律）。
            .catch((e) => { if (convPollRef.current === intervalId) { clearInterval(intervalId); convPollRef.current = null; } setConvErr(String(e)); setConvStatus(null); });
        }, 2000);
        convPollRef.current = intervalId;
      }
    } catch (e) {
      setConvErr(String(e)); // 503 MinIO 未設定 / 400 key 不合法 → 誠實顯示，按鈕可重試
      setConvStatus(null);
    } finally {
      setConvBusy(false);
    }
  }, [selectedKey, convBusy]);

  // A1（B2）下拉項 label：專案·種類·版本·檔名（缺值以「?」誠實標示，不臆造）。
  const minioLabel = (o: import("./coordinatorClient").MinioObject) =>
    `${o.project_display_name ?? o.project_id ?? "?"} · ${o.category ?? "?"} · ${o.version ?? "?"} · ${o.key.split("/").pop() ?? o.key}`;

  return (
    <>
      <h1>{t("A1 · 治理與模型檢核", "A1 · Governance & Model Validation")}</h1>
      <p className="ec-lead">{t("上傳/選取 IFC，跑自動規則檢核，直接產生 Issue、Excel 匯出與 BCF 2.1 匯出（建 Issue 後方可下載）。規則檢核在 governance-service（CPU）完成；3D 檢視與高亮改由 Review Room 手動啟動 Kit/session，不在 A1 自動嵌入 viewer 或 claim lease。", "Upload/select an IFC, run automated rule validation, then generate Issues, Excel export and BCF 2.1 export (download enabled only after Issues are created). Rule validation runs in the governance-service (CPU); 3D review and highlighting are manually started in Review Room, not auto-embedded or auto-claimed by A1.")}</p>

      <Panel title={t("A1 五步引導式流程", "A1 Five-Step Guided Workflow")} sub={t("整頁狀態機驅動；步驟依當前 state 亮燈（證據型更新，禁樂觀）", "Driven by a page-level state machine; steps light up by current state (evidence-based updates, no optimistic UI)")} prov="asbuilt">
        <LifecycleStrip steps={[t("選檔", "Select File"), t("自動檢核", "Auto Validate"), t("結果記分板", "Result Scoreboard"), t("開 Issue", "Open Issue"), t("匯出 Excel", "Export Excel")]} statuses={ui} />
        <div className="ec-grid" style={{ marginBottom: 8 }}>
          <Field k="rule_run_id" v={runId ?? "—"} prov="asbuilt" />
          <Field k="step" v={state.step} prov="asbuilt" />
          {state.issueCount !== null && <Field k={t("已開 issue（artifact）", "issues opened (artifact)")} v={String(state.issueCount)} prov="asbuilt" />}
          {/* EXPORT_OK 落地後才出現的可見信號：供 E2E 直接驗「exported=true（artifact）」而非靠 RUN 清 run 的旁證 disabled。
              比照 issueCount Field，僅在 state.exported 為 true 顯示；重跑保留（a1Machine：RUN 不清 exported）。 */}
          {state.exported && <div data-testid="a1-exported-artifact"><Field k={t("已匯出（artifact）", "exported (artifact)")} v="excel" prov="asbuilt" /></div>}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select data-testid="a1-minio-select" className="ec-btn" style={{ minWidth: 420 }}
            value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
            <option value="">{minioErr ? t("（MinIO 物件不可用）", "(MinIO objects unavailable)") : minioObjects === null ? t("載入中…", "Loading…") : minioObjects.length === 0 ? t("（無 source_ifc 物件）", "(no source_ifc objects)") : t("— 選擇 MinIO 模型 —", "— select a MinIO model —")}</option>
            {(minioObjects ?? []).map((o) => <option key={o.key} value={o.key}>{minioLabel(o)}</option>)}
          </select>
          <Btn data-testid="a1-step-pick" disabled={!selectedKey}
            caption={t("鎖定此模型（進入步驟2；只對選定檔跑 CPU rule-run，不觸發轉檔）", "Lock this model (proceed to step 2; run CPU rule-run on the selected file without triggering conversion)")}
            onClick={() => dispatch({ type: "PICK_FILE", ifcPath: selectedKey })}>{t("選取模型", "Select Model")}</Btn>
        </div>
        {minioErr && <p className="ec-warn-note" data-testid="a1-minio-error" style={{ marginTop: 4 }}>{t("MinIO 物件清單不可用：", "MinIO object list unavailable: ")}{minioErr}</p>}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <input className="ec-btn" data-testid="a1-ids-path" style={{ minWidth: 420 }} placeholder={t("（選填）buildingSMART IDS .ids 路徑", "(optional) buildingSMART IDS .ids path")} value={idsPath} onChange={(e) => setIdsPath(e.target.value)} />
          <input
            ref={idsFileInputRef}
            data-testid="a1-ids-file-input"
            type="file"
            accept=".ids,application/xml,text/xml"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) setIdsFileNameInCurrentDirectory(file.name);
              e.currentTarget.value = "";
            }}
          />
          <Btn data-testid="a1-ids-open-folder" caption={t("選取 .ids 後沿用目前欄位資料夾組成 server-local path", "Selecting an .ids keeps the current field folder and composes a server-local path")} onClick={() => { void openIdsFilePicker(); }}>
            {t("開啟資料夾", "Open Folder")}
          </Btn>
          <span className="ec-s">{t("預設為 repo 內 sample IDS；清空欄位則改用內建 YAML 規則集。", "Defaults to the repo sample IDS; clear the field to use the built-in YAML rule set.")}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          {/* running-error 子態（runError=true）解除 disabled，讓「可重試」真的點得到（spec §5）；
              健康 running（輪詢中、runError=false）仍 disabled 防雙擊。 */}
          <Btn primary data-testid="a1-step-run" disabled={state.step === "idle" || !state.ifcPath || (state.step === "running" && !state.runError)}
            caption={state.ifcPath ? "POST /api/governance/rule-runs" : t("先選定 IFC 模型；不需要 review session 即可檢核", "Select an IFC model first; review session is not required for validation")} onClick={doRun}>
            {state.runError ? t("重試檢核", "Retry Validation") : state.step === "running" ? t("檢核中…", "Validating…") : t("執行規則檢核", "Run Rule Validation")}
          </Btn>
          {state.runError && <span className="ec-warn-note">{t("檢核失敗（可重試）：", "Validation failed (retryable): ")}{state.error}</span>}
        </div>
      </Panel>

      {state.run && (
        <Panel title={t("結果記分板", "Result Scoreboard")} sub={t("真實 rule-run summary；點規則列展開命中構件（GUID/名稱/樓層）", "Real rule-run summary; click a rule row to expand matched elements (GUID/name/storey)")} prov="asbuilt">
          <div className="ec-grid" data-testid="a1-rulerun-scoreboard">
            {/* 記分板色碼：
                - total / passed：不加 tone，沿用 ec-metric base class（預設綠），passed=全綠語意正確
                - failed>0：tone="bad"（紅），提醒注意問題構件
                - score：<100 用 tone="warn"（琥珀），==100 用預設綠；絕不寫 tone="good"（Prov 聯集無此值，TS2322） */}
            <Metric value={state.run.summary?.total ?? "—"} label={t("規則評估次數", "Rule Evaluations")} />
            <Metric value={state.run.summary?.unique_elements ?? "—"} label={t("唯一構件", "Unique Elements")} />
            <Metric value={state.run.summary?.passed ?? "—"} label="passed" />
            <Metric
              value={state.run.summary?.failed ?? "—"}
              label="failed"
              tone={(state.run.summary?.failed ?? 0) > 0 ? "bad" : undefined}
            />
            <Metric
              value={state.run.score ?? "—"}
              label="score"
              tone={typeof state.run.score === "number" && state.run.score < 100 ? "warn" : undefined}
            />
          </div>
          {runId && state.failed.length > 0 && <FailureScoreboard runId={runId} failed={state.failed} />}
        </Panel>
      )}

      <Panel title={t("review session（3D 連動目標）", "review session (3D handoff target)")} sub={t("A1 rule-run 直接對已選 IFC 檔案執行；review session 只供 Review Room 手動 attach / highlight trace", "A1 rule-run runs directly on the selected IFC file; review session is only for manual Review Room attach / highlight trace")} prov="asbuilt">
        {sessions.length === 0 ? (
          <div data-testid="a1-no-session">
            <p className="ec-note">{t("無 active session。治理檢核仍可對已選 IFC 檔案執行；只有 3D Review Room / highlight 需要先建立 review session。", "No active session. Governance validation can still run on the selected IFC file; only 3D Review Room / highlight requires a review session.")}</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Btn primary data-testid="a1-trigger-convert" disabled={!selectedKey || convBusy}
                caption={selectedKey ? "POST /api/conversion/trigger {key}" : t("先選 MinIO 模型", "select a MinIO model first")}
                onClick={() => { void queueConversion(); }}>
                {convBusy ? t("排入中…", "queuing…") : t("排入 IFC→USD 轉檔排程", "Queue IFC to USD Conversion")}
              </Btn>
              {convJobId && <span className="ec-s" data-testid="a1-convert-job">job: {convJobId}</span>}
              <a className="ec-s" data-testid="a1-conv-link" href={buildHandoff("conv", { source: "a1", job_id: convJobId ?? undefined })}>{t("到 IFC→USD 轉檔排程查看詳情 →", "View details in the conversion schedule →")}</a>
            </div>
            {convStatus !== null && <p className="ec-note" data-testid="a1-convert-status">{t("轉檔狀態：", "conversion status: ")}{convStatus}</p>}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <label>review session</label>
              {/* 切換 session 必須同時重置 rule-run 結果（RESET → initialA1State）：
                  rule 結果是針對特定 session 的 mapping enrich 過的；切換 session 後必須重跑檢核，避免把舊 session 的
                  failed rows handoff 到新 session。 */}
              <select data-testid="a1-session-select" value={selectedSession} onChange={(e) => {
                const nextSession = e.target.value;
                if (nextSession === selectedSession) return;
                setSelectedSession(nextSession);
              }}>
                <option value="">{t("— 手動選擇 review session —", "— manually select a review session —")}</option>
                {sessions.map((s) => <option key={s.session_id} value={s.session_id}>{s.session_id}（{s.status}）</option>)}
              </select>
            </div>
            <div className="ec-grid" style={{ marginBottom: 8 }}>
              <Field k="selected session" v={selectedSession || t("not_selected（不阻擋治理檢核）", "not_selected (does not block governance validation)")} prov={selectedSession ? "asbuilt" : "p1"} />
              <Field k="3D handoff" v={t("Review Room owns viewer lease / first frame / stage match / highlight trace", "Review Room owns viewer lease / first frame / stage match / highlight trace")} prov="asbuilt" />
              <Field k="A1 auto attach" v={t("disabled by design", "disabled by design")} prov="asbuilt" />
            </div>
          </>
        )}
        {convErr && <p className="ec-warn-note" data-testid="a1-convert-error">{convErr}</p>}
      </Panel>

      <Panel title={t("交付", "Deliverables")} sub={t("開 Issue / 匯出 Excel / 匯出 BCF 2.1 走真實後端；BCF 需先建 Issue（step=issued/delivered）才 enable；3D 交給 Review Room 手動 attach / highlight", "Open Issue / Export Excel / Export BCF 2.1 go through the real backend; BCF is enabled only after Issues are created (step=issued/delivered); 3D is handed off to Review Room for manual attach / highlight")} prov="asbuilt">
        <Btn data-testid="a1-step-issues" disabled={state.step === "idle" || state.step === "picked" || state.step === "running"}
          caption="POST /api/governance/issues/from-rule-run/:id" onClick={makeIssues}>{t("失敗構件建 Issue", "Create Issues for Failed Elements")}</Btn>{" "}
        {/* export 與 a1-step-issues 共用 state-machine gating（step ∈ {scored,issued,delivered} 才 enable），
            不看 state.run 快照欄位：重跑 running 子態 RUN_PROGRESS 可能短暫帶 succeeded 快照（step 仍 running），
            舊式 disabled={!runId||run?.status!=="succeeded"} 會在該瞬間誤解除 disabled、允許 running 子態匯出。 */}
        <Btn data-testid="a1-step-export" disabled={state.step === "idle" || state.step === "picked" || state.step === "running" || excelBusy}
          caption="GET /api/governance/rule-runs/:id/export?fmt=excel" onClick={doExport}>{t("匯出 Excel", "Export Excel")}</Btn>{" "}
        {/* A1-W1 BCF 2.1 匯出鈕（#a1 canonical route；#issues 標 legacy）。
            gating：step ∈ {issued, delivered} 才 enable（需先建 Issue），scored/running/idle 時 disabled + caption 說明。
            重用 Issues 頁 bcfExportUrl() + 相同 fetch→blob→a.click→appendChild/removeChild→setTimeout revoke 下載慣例。
            後端 404（無正式 issue 或無 ifc_guid）走 actionErr 誠實顯示。prov=asbuilt。 */}
        {(() => {
          // F1：bcfEnabled 同時檢查 issuesCreated（獨立追蹤「曾真正建過 Issue」）與 step。
          // scored→EXPORT_OK→delivered 不經 CREATE_ISSUES_OK，issuesCreated 仍 false → BCF disabled。
          const bcfEnabled = state.issuesCreated && (state.step === "issued" || state.step === "delivered");
          return (
            <>
              <Btn
                data-testid="a1-step-bcf"
                prov="asbuilt"
                disabled={!bcfEnabled || bcfBusy}
                caption={bcfEnabled ? t("GET /api/governance/bcf/export（只含正式 issue）", "GET /api/governance/bcf/export (formal issues only)") : t("需先建 Issue（step=issued/delivered）", "Create Issues first (step=issued/delivered)")}
                onClick={async () => {
                  if (!bcfEnabled) return;
                  setActionErr(null);
                  setBcfBusy(true);
                  try {
                    const res = await fetch(governanceClient.bcfExportUrl());
                    if (!res.ok) { setActionErr(`${t("BCF 匯出 ", "BCF export ")}${res.status}${t("：需至少一個正式 issue（kind=issue 且有 ifc_guid）", ": at least one formal issue is required (kind=issue with ifc_guid)")}`); return; }
                    const blob = await res.blob();
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "governance-issues.bcfzip";
                    // 錨點須掛載於 document 才觸發下載：Gecko / 部分 Edge 對 detached <a> 下載不可靠。
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    // 延後釋放 object URL：同步 revoke 會在瀏覽器開始讀取 blob 前就釋放（對齊 doExport 延後模式）。
                    setTimeout(() => URL.revokeObjectURL(a.href), 0);
                    dispatch({ type: "BCF_EXPORT_OK" });
                  } catch (e) { setActionErr(`${t("BCF 匯出失敗：", "BCF export failed: ")}${String(e)}`); }
                  finally { setBcfBusy(false); }
                }}
              >
                {t("匯出 BCF 2.1", "Export BCF 2.1")}
              </Btn>
              {/* F4：BCF_EXPORT_OK 落地後才出現的可見信號（對齊 Excel EXPORT_OK → a1-exported-artifact）。 */}
              {state.bcfExported && <div data-testid="a1-bcf-exported-artifact"><Field k={t("已匯出（artifact）", "exported (artifact)")} v="bcf" prov="asbuilt" /></div>}
            </>
          );
        })()}{" "}
        {/* A1 不再直接送 viewer DataChannel。這裡只把 rule-run / session / 第一筆失敗構件交給 Review Room；
            lease、first frame、stage match、highlight result 由 Review Room 的專用畫面觀測與執行。 */}
        {(() => {
          const f0 = state.failed[0];
          const disabledReason = a1ReviewRoomHandoffReason(f0, selectedSession);
          const expectedStageUrl = sessions.find((s) => s.session_id === selectedSession)?.expected_stage_url ?? null;
          const href = selectedSession
            ? buildA1ReviewRoomHandoffHash({ sessionId: selectedSession, runId, row: f0, expectedStageUrl })
            : "#review?source=a1";
          return (
            <Btn data-testid="a1-open-review-room"
              disabled={Boolean(disabledReason)}
              caption={disabledReason || t("開啟 #review，Review Room 會手動 attach Kit/session 再執行 highlight", "Open #review; Review Room manually attaches Kit/session before highlight")}
              onClick={() => {
                if (!selectedSession || !f0?.ifc_guid) return;
                window.location.hash = href;
              }}>
              {t("開啟 Review Room（第一筆失敗）", "Open Review Room (first failure)")}
            </Btn>
          );
        })()}{" "}
        {/* 七軸 cross-link chips（§4.3）：回看 MinIO 來源物件、跳 Session 管理檢視此 session。
            證據型——目標 id 不存在時誠實 disabled，不製造無效跳轉。 */}
        <span className="ec-crosslinks" data-testid="a1-crosslinks" style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", marginLeft: 8 }}>
          <Btn
            data-testid="a1-link-minio"
            disabled={!selectedKey}
            caption={selectedKey ? t("回看 MinIO 來源物件", "View the source object in MinIO") : t("尚未選取 MinIO 物件", "No MinIO object selected")}
            onClick={() => { if (!selectedKey) return; window.location.hash = buildHandoff("minio", { source: "a1", minio_key: selectedKey }); }}
          >
            {t("MinIO 來源 →", "MinIO source →")}
          </Btn>
          <Btn
            data-testid="a1-link-sessions"
            disabled={!selectedSession}
            caption={selectedSession ? t("在 Session 管理檢視此 session", "View this session in Session Management") : t("尚未選取 review session", "No review session selected")}
            onClick={() => { if (!selectedSession) return; window.location.hash = buildHandoff("sessions", { source: "a1", session: selectedSession }); }}
          >
            {t("Session 管理 →", "Session Management →")}
          </Btn>
        </span>{" "}
        {actionErr && <p className="ec-warn-note" data-testid="a1-action-error" style={{ marginTop: 8 }}>{actionErr}</p>}
      </Panel>
    </>
  );
}

export function ViewerPresentationPage() {
  const [firstFrameEvidenceText, setFirstFrameEvidenceText] = useState(t("not_observed（尚無 active session 回報）", "not_observed (no active session reporting yet)"));
  useEffect(() => {
    let alive = true;
    coordinatorClient.runtimeStatus()
      .then((rt) => {
        if (!alive) return;
        const seen = rt.sessions.items.some((s) => Boolean(s.first_frame_at));
        setFirstFrameEvidenceText(seen ? t("已觀察到 first frame（至少一 session）", "first frame observed (at least one session)") : t("not_observed（無 session 回報真畫面）", "not_observed (no session reporting a real frame)"));
      })
      .catch(() => {
        if (alive) setFirstFrameEvidenceText(t("not_observed（coordinator 連不上）", "not_observed (coordinator unreachable)"));
      });
    return () => { alive = false; };
  }, []);

  const capabilities: [string, string, Prov][] = [
    ["openStage", t("載入 selected USD / USDC stage；success 還需要 loaded stage URL 證據", "Load the selected USD / USDC stage; success also requires loaded stage URL evidence"), "asbuilt"],
    ["focusPrim / selectPrims", t("點清單或 mapping table 可聚焦 / 選取 USD prim", "Click the list or mapping table to focus / select a USD prim"), "asbuilt"],
    ["clearHighlight", t("清除 viewer overlay / selection", "Clear viewer overlay / selection"), "asbuilt"],
    ["highlightPrimsRequest", t("A1/A2/A4 結果轉 3D highlight；需 browser DataChannel", "Turn A1/A2/A4 results into 3D highlights; requires the browser DataChannel"), "p15"],
    // 對抗驗證 P1-2：ViewerPresentationPage capabilities 為說明性矩陣。first_frame_at 在本頁以 any-session boolean
    // (rt.sessions.items.some) 呈現、非 scope-to-session 真值；stage matched 同為靜態描述。皆未到 asbuilt → p1
    // （真 live 證據在 A1 頁 firstFrameEvidenceText / stageMatchedText 與 #sessions，本頁不重渲染）。
    ["first_frame_at", t("viewer 是否真的看到畫面，不等於 port open", "Whether the viewer actually sees a frame; not the same as the port being open"), "p1"],
    ["stage matched", t("expected_stage_url == loaded stage URL 才算 stage truth", "stage truth requires expected_stage_url == loaded stage URL"), "p1"],
  ];
  return (
    <>
      <h1>{t("3D Viewer 呈現 · USD over WebRTC", "3D viewer presentation · USD over WebRTC")}</h1>
      <p className="ec-lead">{t("此頁說明打開 3D viewer 時 operator 應看到什麼：模型畫面、語意表、mapping table、selected prim、DataChannel ready、first frame、stage truth。真正 viewport 仍在既有 viewer，不在 console 內重渲染 WebRTC。", "This page explains what the operator should see when opening the 3D viewer: the model frame, semantic table, mapping table, selected prim, DataChannel ready, first frame and stage truth. The real viewport still lives in the existing viewer; WebRTC is not re-rendered inside the console.")}</p>
      <Panel title={t("Viewport 狀態", "Viewport status")} sub={t("Kit-side evidence + Browser-side evidence 必須分開", "Kit-side evidence and browser-side evidence must be kept separate")} prov="asbuilt">
        <div className="ec-grid">
          <Field k="Stage URL" v="expected stage from review session / ifc-ready job" prov="asbuilt" />
          <Field k="DataChannel" v={t("ready 才能送 openStage / focusPrim / highlight", "must be ready before sending openStage / focusPrim / highlight")} prov="asbuilt" />
          <Field k="WebRTC first frame" v={firstFrameEvidenceText} prov="asbuilt" />
          {/* 對抗驗證 P1-1：v 為靜態字串、本頁無 live expected==loaded 比對（真比對在 A1 頁 stageMatchedText），asbuilt 過度宣告 → p1。 */}
          <Field k="Stage truth" v={t("expected == loaded 才能宣稱 matched", "matched can only be claimed when expected == loaded")} prov="p1" />
        </div>
      </Panel>
      <Panel title="Viewer command matrix" sub={t("對齊 existing Window.tsx / DataChannel 邊界", "Aligned with the existing Window.tsx / DataChannel boundary")} prov="asbuilt">
        <table className="ec-table">
          <thead><tr><th>command / evidence</th><th>{t("operator 看到的功能", "operator-visible capability")}</th><th>status</th></tr></thead>
          <tbody>{capabilities.map(([cmd, desc, prov]) => (
            <tr key={cmd}><td>{cmd}</td><td>{desc}</td><td><ProvTag prov={prov} /></td></tr>
          ))}</tbody>
        </table>
      </Panel>
      <Panel title={t("A1-A10 在 3D Viewer 的呈現用途", "How A1-A10 are presented in the 3D viewer")} prov="demo">
        <div className="ec-grid">
          <MiniCard code="A1/A2/A4" title={t("可選 overlay", "Optional overlay")} desc={t("規則失敗、版本差異、語意搜尋結果都可轉成 highlight，但需 mapping + first frame。", "Rule failures, version diffs and semantic search results can all become highlights, but require mapping + first frame.")} prov="p1" />
          <MiniCard code="A3/A5/A6/A7/A10" title={t("核心 3D 場景", "Core 3D scene")} desc={t("federation、IoT/FM、4D/5D、scan compare、robot route 都以 3D 場景為主。", "federation, IoT/FM, 4D/5D, scan compare and robot route are all driven primarily by the 3D scene.")} prov="p4" />
          <MiniCard code="A8" title="render capture" desc={t("Synthetic Data 需要 Replicator / camera / output writer，屬後期 runtime pipeline。", "Synthetic Data needs Replicator / camera / output writer; it belongs to a later runtime pipeline.")} prov="p4" />
        </div>
      </Panel>
    </>
  );
}

function pct(r?: number | null): string {
  if (typeof r !== "number" || !Number.isFinite(r)) return t("未取得", "not available");
  const p = r * 100;
  // 誠實鐵律「不得承諾 100% lossless」：ratio<1 卻四捨五入到 100.00 時下修顯 99.99%，
  // 不讓非滿覆蓋謊報成 100%（真實 ratio 仍由相鄰 mapped/unmapped 數與 coverage_status 揭露）。
  if (r < 1 && p.toFixed(2) === "100.00") return "99.99%";
  return `${p.toFixed(2)}%`;
}
function CoverageDrawer({ state }: { state: ConversionQualityMetricsResponse | { error: string } | "loading" | undefined }) {
  if (state === "loading" || state === undefined) return <p className="ec-note">{t("讀取 coverage…", "Loading coverage…")}</p>;
  if ("error" in state) return <p className="ec-warn-note">{state.error}</p>;
  const s = state.quality_metrics_summary;
  if (!s) return <p className="ec-note">{t("未取得品質遙測（後端未提供 quality_metrics）。", "Quality telemetry not available (backend did not provide quality_metrics).")}</p>;
  // 誠實鐵律：materialization_strategy=usd_stage_enumeration 下 coverage_ratio 為自我參照——
  // source_ifc_entity_count 與 mapped_count 同源於同一次 USD stage prim 枚舉（adapter 端
  // source_count = len(mapping_items) = mapped_count），數學上結構性恆等於 1.0，意義是「枚舉到的
  // 都對映上」，並非對 IFC 原始 entity 全量的 lossless 覆蓋率。標出此語意，避免 100% 被誤讀成零遺漏。
  const usdEnumSelfRef = s.materialization_strategy === "usd_stage_enumeration";
  return (
    <>
      <Field k="coverage" v={`${pct(s.coverage_ratio)}${s.coverage_status ? ` · ${s.coverage_status}` : ""}`} prov="artifact" />
      <Field k="mapped / unmapped" v={`${s.mapped_count ?? t("未取得", "not available")} / ${s.unmapped_count ?? t("未取得", "not available")}`} prov="artifact" />
      <Field k={usdEnumSelfRef ? t("source（USD 枚舉 prim 數）", "source (count of enumerated USD prims)") : "source IFC entity"} v={String(s.source_ifc_entity_count ?? t("未取得", "not available"))} prov="artifact" />
      <Field k="materialization" v={s.materialization_strategy ?? t("未取得", "not available")} prov="artifact" />
      {/* spec §4.4 line 76 明列必顯欄：轉檔耗時秒數（後端 quality_metrics 既有，review.ts:19 / types.ts:79
          已型別化、buildQualityMetricsSummary 已萃取）。缺值誠實顯「未取得」，不捏值。 */}
      <Field k={t("conversion 耗時(s)", "conversion duration (s)")} v={typeof s.conversion_duration_seconds === "number" ? String(s.conversion_duration_seconds) : t("未取得", "not available")} prov="artifact" />
      <Field k={t("usdc 輸出", "usdc output")} v={state.usdc_url ?? t("未取得", "not available")} prov="artifact" />
      <Field k="mapping_url" v={state.mapping_url ?? t("未取得", "not available")} prov="artifact" />
      <Field k={t("property / relationship / attribute 三項", "property / relationship / attribute (three breakdowns)")} v={t("後端未提供（以 coverage_ratio 為準；三項拆分為 follow-up）", "Not provided by the backend (coverage_ratio is authoritative; the three-way breakdown is a follow-up)")} prov="p1" />
      {usdEnumSelfRef && (
        <p className="ec-warn-note" data-testid="conv-coverage-selfref-note">
          {t("⚠ coverage 基準為 USD stage 枚舉：source 為枚舉 prim 數、與 mapped 同源，此 % 是「枚舉到的都對映上」的自我比對，非對 IFC 原始 entity 全量的 lossless 覆蓋率。真 IFC 分母為 follow-up（M2-b）。", "⚠ Coverage is based on USD stage enumeration: source is the count of enumerated prims and shares the same origin as mapped, so this % is a self-comparison of \"everything enumerated got mapped\", not lossless coverage over the full set of original IFC entities. A real IFC denominator is a follow-up (M2-b).")}
        </p>
      )}
    </>
  );
}

// 轉檔 Ledger status → 中文顯示（誠實鐵律：禁自造 Prov 值；用既有 prov 配色）
const LEDGER_STATUS_LABEL: Record<string, string> = {
  detected: "已偵測", queued: "排隊", converting: "轉檔中", ready: "完成", failed: "失敗",
};
const LEDGER_STATUS_PROV: Record<string, Prov> = {
  detected: "artifact", queued: "artifact", converting: "artifact", ready: "asbuilt", failed: "p1",
};

// ifc-ready-api-field-redesign：jobs 表 lifecycle chip 中文標籤。重用既有 LEDGER_STATUS_LABEL
// （同一 lifecycle→中文 字典，避免第二份漂移）；null/undefined/未知值誠實退 "—"。
function lifecycleLabel(s: ConversionLifecycleStatus | null | undefined): string {
  return s ? (LEDGER_STATUS_LABEL[s] ?? "—") : "—";
}

export function ConversionSchedulingPage() {
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  // Task 6：持久 ConversionLedger 資料（getConversionRecords），獨立於 ifc-ready jobs。
  const [records, setRecords] = useState<ConversionRecord[]>([]);
  const [recErr, setRecErr] = useState<string | null>(null);
  const [mw, setMw] = useState<MinioWatchStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mwErr, setMwErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [cov, setCov] = useState<Record<string, ConversionQualityMetricsResponse | { error: string } | "loading">>({});
  // conv-prioritize-retry:列控制（插隊／重試）intent→confirm 狀態。pendingAction 非 null 時開 IntentDialog；
  // actionBusy 鎖住 confirm/cancel 期間的重複觸發。非樂觀：POST 成功後 load() 重抓真佇列狀態。
  const [pendingAction, setPendingAction] = useState<
    | { jobId: string; kind: "prioritize" | "retry" }
    | { kind: "watch-toggle"; enabled: boolean }
    | null
  >(null);
  const [actionBusy, setActionBusy] = useState(false);
  // finding #1：同步 busy guard。setActionBusy(true) 是非同步 state，confirm 鈕的 disabled={busy}
  // 要等下一次 render 才生效；同一事件循環連點兩次會送出兩個 POST。ref 在 React state 更新前
  // 同步攔截第二次呼叫。
  const actionBusyRef = useRef(false);
  // finding #2：action 錯誤獨立 state，顯示在 dialog 內、與 dialog 綁定，不與 load 錯誤（err）共用。
  // load() 開頭的 setErr(null) 因此不會把「控制動作失敗」清掉。
  const [actionErr, setActionErr] = useState<string | null>(null);
  // Task 8（AC6(b)）：ledger 列「未轉/failed」一鍵觸發鈕的 intent→confirm 狀態。與 pendingAction
  // （插隊/重試/watch-toggle）獨立——觸發走 POST /api/conversion/trigger（非 ifc-ready），帶原始
  // object_key；pendingTriggerKey 非 null 時開觸發專屬 IntentDialog。沿用 MinioDataPage 的 confirmTrigger
  // pattern（成功 patch + 重抓、失敗顯 inline error 不關 dialog）。
  const [pendingTriggerKey, setPendingTriggerKey] = useState<string | null>(null);
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [triggerErr, setTriggerErr] = useState<string | null>(null);
  // quality finding Important #1：與 runAction 的 actionBusyRef 同步防重入 pattern 對齊。
  // setTriggerBusy(true) 是非同步 state，confirm 鈕 disabled={triggerBusy} 要等下一次 render 才生效；
  // 同一事件循環雙擊 confirm 會送出兩個 POST /api/conversion/trigger（失敗路徑下第二次 catch 會覆蓋
  // 第一次 triggerErr、loadRecords 也可能被競爭觸發兩次）。ref 在 React state 更新前同步攔截第二次呼叫。
  const triggerBusyRef = useRef(false);
  // 回傳兩端點各自抓取成功與否（jobsOk / mwOk）：runAction 用它判斷控制動作後的證據型刷新是否
  // 真的取得新狀態。load() 自身對兩端點 allSettled 不 throw（避免 mount/Refresh 未捕捉），
  // 故以回傳值（非 throw）讓呼叫端可辨「POST 成功但重抓失敗」這條分支。
  // important #1：watch-toggle 成功後若 minioWatchStatus 此輪失敗，jobsOk 仍 true 會誤導 runAction
  // 靜默關 dialog（mw 未更新、琥珀條與 Panel 停舊值、操作者看不到錯誤）。故回傳 mwOk 讓呼叫端可辨此分支。
  const load = useCallback(async (): Promise<{ jobsOk: boolean; mwOk: boolean }> => {
    setBusy(true); setErr(null); setMwErr(null);
    // 兩個端點獨立 settle：minio-watch/status 失敗不污染 ifc-ready；各自有獨立錯誤 state。
    const [jobsRes, mwRes] = await Promise.allSettled([
      coordinatorClient.listIfcReady(50),
      coordinatorClient.minioWatchStatus(),
    ]);
    const jobsOk = jobsRes.status === "fulfilled";
    const mwOk = mwRes.status === "fulfilled";
    if (jobsRes.status === "fulfilled") setJobs(jobsRes.value.items);
    else setErr(`${t("未連線 coordinator /api/external/ifc-ready：", "Not connected to coordinator /api/external/ifc-ready: ")}${String(jobsRes.reason)}`);
    if (mwRes.status === "fulfilled") setMw(mwRes.value);
    else setMwErr(`${t("未連線 coordinator /api/external/minio-watch/status：", "Not connected to coordinator /api/external/minio-watch/status: ")}${String(mwRes.reason)}`);
    setBusy(false);
    return { jobsOk, mwOk };
  }, []);
  // Task 6：獨立抓取 ConversionLedger，不阻塞既有 load() 流程（避免影響現有測試計時）。
  // setRecErr(null) 在本 callback 開頭清；不與 setErr（ifc-ready 錯誤）共用，誤差各自獨立。
  const loadRecords = useCallback(async (): Promise<void> => {
    setRecErr(null);
    try {
      const res = await coordinatorClient.getConversionRecords(50);
      setRecords(res.items);
    } catch (e) {
      setRecErr(`未連線 coordinator /api/conversion/records：${String(e)}`);
    }
  }, []);
  // Task 6：mount 時同時觸發 load()（ifc-ready + watcher）與 loadRecords()（ledger），獨立並行。
  useEffect(() => { void load(); void loadRecords(); }, [load, loadRecords]);
  // Task 7（七軸和諧 §11 OQ2）：轉檔歷史 panel 資料源，獨立於 ledger/ifc-ready，讀既有
  // GET /api/dev/conversions（conversion service 側 job 歷史 pass-through，非 coordinator ledger）。
  // historyErr 與 recErr/err 各自獨立：失敗只影響本 panel 誠實顯示「未取得」，不污染其他 Panel。
  const [history, setHistory] = useState<DevConversionRecord[] | null>(null);
  const [historyErr, setHistoryErr] = useState(false);
  useEffect(() => {
    let alive = true;
    coordinatorClient.getConversionsHistory()
      .then((r) => { if (alive) { setHistory(r.items); setHistoryErr(false); } })
      .catch(() => { if (alive) { setHistory(null); setHistoryErr(true); } });
    return () => { alive = false; };
  }, []);
  const toggleCoverage = useCallback(async (job: IfcReadyListItem) => {
    if (!job.conversion_job_id) return;
    const id = job.ifc_ready_job_id;
    // 開關語意：同一 job 已展開 → 收合（不重打）。重試 / 重用都走「收合後重新展開」這條兩步路徑。
    if (openJob === id) { setOpenJob(null); return; }
    setOpenJob(id);
    // 去重 / 載入鎖（spec §5「重複展開同 job → 去重 / 載入鎖，避免重打」）。
    // 注意：上面的 openJob===id early-return 會先收合，所以下列守門只在「目前未展開、現在要展開」時生效，
    // 亦即收合後重新展開的第二步（並非展開狀態下原地點一次）：
    //   - 已成功取得（cov[id] 是 response 物件）→ 直接重用快取，不重打。
    //   - 正在載入（"loading"）→ 不重打。
    //   - 曾失敗（{ error }）→ **刻意不擋，落到下方重新 fetch**（收合後再展開錯誤態 job＝使用者重試，
    //     符合誠實鐵律：錯誤不黏住，給重試機會）。故守門只擋「成功快取」與「載入中」，不擋 error 態。
    const cached = cov[id];
    // 先把 string 態（"loading"）擋掉，讓 TS narrowing 接管：之後 cached 已縮窄為
    // ConversionQualityMetricsResponse | { error: string } | undefined，"error" in cached 不再需要 cast，
    // 後續守門順序的正確性由型別系統保護（消除「依賴守門順序」的可維護性風險）。
    if (cached === "loading") return; // 載入中 → 不重打
    if (cached && !("error" in cached)) return; // 已成功（response 物件，無 error 鍵）→ 重用
    setCov((p) => ({ ...p, [id]: "loading" }));
    try {
      const r = await coordinatorClient.conversionQualityMetrics(job.conversion_job_id);
      setCov((p) => ({ ...p, [id]: r }));
    } catch (e) {
      setCov((p) => ({ ...p, [id]: { error: `${t("未取得 coverage：", "Coverage not available: ")}${String(e)}` } }));
    }
  }, [openJob, cov]);
  const runAction = useCallback(async (reason: string) => {
    if (!pendingAction) return;
    if (actionBusyRef.current) return; // finding #1：同步攔截重入（React state 尚未更新前）
    actionBusyRef.current = true;
    setActionBusy(true);
    setActionErr(null);             // 開新一輪動作：清掉上一次的誠實錯誤
    try {
      if (pendingAction.kind === "prioritize") await coordinatorClient.conversionPrioritize(pendingAction.jobId, reason);
      else if (pendingAction.kind === "retry") await coordinatorClient.conversionRetry(pendingAction.jobId, reason);
      else if (pendingAction.kind === "watch-toggle") await coordinatorClient.conversionWatchToggle(pendingAction.enabled, reason);
      // 證據型更新：重抓真佇列狀態（非樂觀）。load() 自吞錯不 throw，故以回傳值辨識
      // 「POST 成功但重抓佇列失敗」——此時不可靜默關 dialog（佇列仍顯舊狀態、背景 err
      // 操作者不易察覺），改保持 dialog 開啟並在 dialog 內顯誠實錯誤。
      const { jobsOk, mwOk } = await load();
      if (!jobsOk) {
        setActionErr(t("動作已送出，但重新抓取佇列失敗；佇列可能仍顯示舊狀態，請關閉後按「Refresh queue」確認最新狀態（後端動作為冪等，重按確認不會重複生效）。", "The action was submitted, but re-fetching the queue failed; the queue may still show the old state. Please close this and click \"Refresh queue\" to confirm the latest state (the backend action is idempotent, so confirming again has no duplicate effect)."));
        return;                     // 不關 dialog、不視為完成
      }
      // important #1：watch-toggle 成功但 watcher 狀態重抓失敗時，jobsOk 仍 true，但 mw 未更新，
      // 琥珀條與 Panel 停在舊值。不可靜默關 dialog（操作者會誤以為開關已生效），改顯誠實錯誤要求重按 Refresh。
      if (pendingAction.kind === "watch-toggle" && !mwOk) {
        setActionErr(t("動作已送出，但重新抓取 watcher 狀態失敗；自動偵測狀態與頁頂提示可能仍顯示舊值，請關閉後按「Refresh queue」確認最新狀態（後端動作為冪等，重按確認不會重複生效）。", "The action was submitted, but re-fetching the watcher status failed; the auto-detection status and the top-of-page banner may still show old values. Please close this and click \"Refresh queue\" to confirm the latest state (the backend action is idempotent, so confirming again has no duplicate effect)."));
        return;                     // 不關 dialog、不視為完成
      }
      setPendingAction(null);       // 動作成功且狀態已刷新才關 dialog
    } catch (e) {
      setActionErr(`${t("控制動作失敗：", "Control action failed: ")}${String(e)}`); // finding #2：寫獨立 actionErr（顯示在 dialog 內），不關 dialog、不改狀態
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  }, [pendingAction, load]);
  // Task 8（AC6(b)）：ledger 列「觸發轉檔」鈕的 confirm handler。方向1：改走 main 已合併的
  // triggerConversion（POST /api/conversion/trigger，IP allowlist 守門、server-side presigned）。main 回
  // {ifc_ready_job_id, status?, trigger_source?}（無 idempotency_key、status 為 lifecycle 值非
  // ConversionLedgerStatus），故不做「按 idempotency_key 樂觀 patch」；觸發成功後 loadRecords() 由 ledger
  // 真值對齊 chip（ledger 為狀態真相來源，誠實鐵律）。失敗顯 inline error、不關 dialog、ledger 不變。
  const confirmTrigger = useCallback(async (_reason: string) => {
    if (!pendingTriggerKey) return;
    if (triggerBusyRef.current) return; // finding #1：同步攔截重入（React state 尚未更新前）
    triggerBusyRef.current = true;
    setTriggerErr(null);
    setTriggerBusy(true);
    try {
      await coordinatorClient.triggerConversion(pendingTriggerKey);
      void loadRecords();           // ledger 真值對齊：重抓 ledger（main trigger 已 server-side 落帳）
      setPendingTriggerKey(null);   // 成功才關 dialog
    } catch (e) {
      setTriggerErr(`${t("觸發轉檔失敗：", "Trigger conversion failed: ")}${String(e)}`); // 失敗顯 inline error、ledger 不變、不關 dialog
    } finally {
      triggerBusyRef.current = false;
      setTriggerBusy(false);
    }
  }, [pendingTriggerKey, loadRecords]);
  return (
    <>
      <h1>{t("IFC→USD 轉檔排程", "IFC→USD conversion scheduling")}</h1>
      <p className="ec-lead">{t("從 MinIO / storage 發現 source IFC，排進 conversion authority，由 `bim-streaming-server` 產出 `model.usdc`、mapping summary，再通知 Kit / Review Session。", "Discover source IFC from MinIO / storage, queue it into the conversion authority, let `bim-streaming-server` produce `model.usdc` and a mapping summary, then notify Kit / Review Session.")}</p>
      {mw?.enabled === false && (
        <p className="ec-warn-note" data-testid="conv-watch-off-banner">
          {t("⚠ 自動偵測已關閉——新 model.ifc 不會自動進件，需手動進件", "⚠ Auto-detection is off — new model.ifc will not be intaken automatically; manual intake is required")}
        </p>
      )}
      <Panel title="Pipeline" sub="MinIO source → queue → IFC→USD → writeback → notify Kit" prov="asbuilt" actions={<Btn caption="GET /api/external/ifc-ready" disabled={busy} onClick={() => { void load(); void loadRecords(); }}>{busy ? t("讀取中…", "Loading…") : "Refresh queue"}</Btn>}>
        <LifecycleStrip steps={[t("讀 MinIO / storage", "Read MinIO / storage"), t("排隊", "Queue"), "IFC→USD", t("寫回 model.usdc", "Write back model.usdc"), t("通知 Kit", "Notify Kit")]} />
        {err && <p className="ec-warn-note">{err}</p>}
        <Field k="conversion authority" v="bim-streaming-server owns heavy conversion" prov="asbuilt" />
        <Field k={t("插隊 / 重試", "Prioritize / retry")} v={t("可於下方 ifc-ready job 列依狀態操作（intent→confirm→audited）", "Available on the ifc-ready job rows below, depending on status (intent→confirm→audited)")} prov="asbuilt" />
        <Field k={t("concurrency 控制", "concurrency control")} v={t("NOT BUILT：獨立 follow-up 卡", "NOT BUILT: tracked as a separate follow-up card")} prov="p1" />
      </Panel>
      <Panel
        title={t("MinIO 自動偵測（O4）", "MinIO auto-detection (O4)")}
        sub={t("watcher 輪詢 ListObjectsV2 → 新 */model.ifc → 自動 intake；來源 /api/external/minio-watch/status", "watcher polls ListObjectsV2 → new */model.ifc → auto intake; source /api/external/minio-watch/status")}
        prov="asbuilt"
      >
        <div data-testid="minio-watch-panel">
          {mwErr ? (
            <p className="ec-warn-note" data-testid="minio-watch-error">{mwErr}</p>
          ) : mw == null ? (
            <p className="ec-note">{t("尚未取得 watcher 狀態；按上方 Refresh queue 後顯示。", "Watcher status not retrieved yet; click Refresh queue above to display it.")}</p>
          ) : mw.enabled === false ? (
            <>
              <Field k={t("狀態", "Status")} v={t("未啟用 — 需設定 env MINIO_WATCH_ENABLED opt-in", "Not enabled — requires env MINIO_WATCH_ENABLED opt-in")} prov="asbuilt" />
              <p className="ec-note">{mw.note ?? t("watcher 預設關閉；狀態 API 為真，未偽稱功能在跑。", "The watcher is off by default; the status API is real and does not falsely claim the feature is running.")}</p>
              <Btn
                data-testid="conv-watch-enable"
                onClick={() => { setTriggerErr(null); setPendingTriggerKey(null); setActionErr(null); setPendingAction({ kind: "watch-toggle", enabled: true }); }}
              >{t("開啟自動偵測", "Enable auto-detection")}</Btn>
            </>
          ) : (
            <>
              {mw.note && <p className="ec-note">{mw.note}</p>}
              <Field k={t("狀態", "Status")} v={t("啟用中（env opt-in）", "Enabled (env opt-in)")} prov="asbuilt" />
              <Field k="bucket" v={mw.bucket ?? "—"} prov="asbuilt" />
              <Field k="prefix" v={mw.prefix || t("（無）", "(none)")} prov="asbuilt" />
              <Field k={t("最近一輪", "Last poll")} v={mw.last_poll_at ?? t("尚未完成首輪", "first poll not completed yet")} prov="asbuilt" />
              <Field k={t("輪詢次數", "Poll count")} v={String(mw.poll_count ?? "—")} prov="asbuilt" />
              {/* Task 8（AC5）：把原擠在單一 Field 的 baseline/seen/觸發/跳過拆成獨立 Field，
                  並對 baseline 標 by-design 說明 + 一致性基準文案，避免 triggered_total=0 被誤讀成故障。 */}
              <Field
                k={t("baseline（首輪 list 到的規約檔數）", "baseline (convention files seen on first poll)")}
                v={<span data-testid="conv-baseline-count">{mw.baseline_count ?? "—"}</span>}
                prov="asbuilt"
              />
              <Field
                k={t("triggered（baseline 後真正新觸發）", "triggered (new since baseline)")}
                v={<span data-testid="conv-triggered-total">{mw.triggered_total ?? 0}</span>}
                prov="asbuilt"
              />
              <Field
                k={t("seen / 跳過", "seen / skipped")}
                v={`${mw.seen_count ?? 0} / ${mw.skipped_malformed_total ?? 0}`}
                prov="asbuilt"
              />
              {/* baseline 說明（spec §3.4 auto-enroll，supersede 舊 §3.1 baseline 吸收）：baseline_count＝
                  watcher 首輪 list 到的規約檔（可解析 model.ifc）數，**純診斷**——§3.4 已移除「首輪 baseline
                  不觸發」特例，首輪即對 ledger 無紀錄的既有 model.ifc 自動觸發轉檔（auto-enroll 補轉），
                  baseline_count 不再代表「不轉檔」。 */}
              <p className="ec-note" data-testid="conv-baseline-explain">
                {t(
                  "baseline＝watcher 首輪 list 到的規約檔（可解析 model.ifc）數，純診斷。§3.4 全自動 auto-enroll：首輪即對 ledger 無紀錄的既有 model.ifc 自動觸發轉檔（既有未轉檔自動補轉；重啟命中持久 ledger 不重觸發，不風暴）。triggered＝累計真正觸發數（含首輪 auto-enroll）——triggered=0 僅代表尚無 ledger 無紀錄的可解析檔，非故障。",
                  "baseline = number of convention files (parseable model.ifc) the watcher listed in its first round; diagnostic only. §3.4 full auto-enroll: the first round auto-triggers conversion for existing model.ifc with no ledger record (back-fills existing un-converted files; a restart hits the persistent ledger and does not re-trigger, no storm). triggered = cumulative genuinely-triggered count (including first-round auto-enroll) — triggered=0 only means there is no parseable file lacking a ledger record yet, not a fault.",
                )}
              </p>
              {/* 三視圖一致性基準（spec AC5）：明示「可解析 IFC 數」非「物件總數」，避免使用者把
                  「#minio 527 物件 vs watcher 只認 3 個 vs ledger=0」誤讀成 watcher 漏看 524 物件。 */}
              <p className="ec-note" data-testid="conv-consistency-basis">
                {t(
                  "一致性基準＝可解析 IFC 數（*/model.ifc），非 bucket 物件總數：#minio 全量物件（含幾何 .json）與 watcher 只認的 model.ifc 數本就不同口徑，watcher 並未漏看其餘物件。",
                  "Consistency basis = count of parseable IFC (*/model.ifc), NOT total bucket object count: the full #minio object set (incl. geometry .json) and the model.ifc count the watcher recognizes are different denominators by design; the watcher is not missing the other objects.",
                )}
              </p>
              {/* AC6(a)：保留說明文案列兩條 spec 認可補救（純文字，不做成 UI 觸發鈕——UI 觸發走
                  下方 ledger 列的「觸發轉檔」鈕＝POST /api/conversion/trigger，非此處 webhook）。 */}
              <p className="ec-note" data-testid="conv-remediation-note">
                {t(
                  "補救既有未轉檔的兩條 spec 認可路徑：(i) 重新上傳該 model.ifc（改變 etag）→ watcher 下一輪自動觸發；(ii) 手動 webhook intake，直打 POST /api/external/ifc-ready（帶 webhook secret + presigned GET URL）。此兩條為文字說明；若要直接於本頁觸發，請用下方 Ledger 列的「觸發轉檔」鈕（走 POST /api/conversion/trigger）。",
                  "Two spec-approved remediations for existing un-converted files: (i) re-upload the model.ifc (changes its etag) → the watcher auto-triggers on the next round; (ii) manual webhook intake by calling POST /api/external/ifc-ready directly (with webhook secret + presigned GET URL). These two are textual guidance; to trigger directly from this page, use the \"Trigger\" button on the Ledger rows below (which calls POST /api/conversion/trigger).",
                )}
              </p>
              {mw.last_error && <Field k={t("最近錯誤", "Last error")} v={mw.last_error} prov="asbuilt" />}
              {mw.last_triggered && mw.last_triggered.length > 0 && (
                <table className="ec-table" data-testid="minio-watch-triggered">
                  <thead><tr><th>key</th><th>job</th><th>error</th><th>at</th></tr></thead>
                  <tbody>{mw.last_triggered.map((t, i) => (
                    <tr key={`${t.key}-${i}`}>
                      <td>{t.key}</td>
                      <td>{t.job_id ?? "—"}</td>
                      <td>{t.error ?? "—"}</td>
                      <td>{t.at}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              <Btn
                data-testid="conv-watch-disable"
                onClick={() => { setTriggerErr(null); setPendingTriggerKey(null); setActionErr(null); setPendingAction({ kind: "watch-toggle", enabled: false }); }}
              >{t("關閉自動偵測", "Disable auto-detection")}</Btn>
            </>
          )}
        </div>
      </Panel>
      {/* Task 6：持久 ConversionLedger 視圖（GET /api/conversion/records）——watcher 偵測即落帳，跨重啟不遺失。
          欄：專案 / 種類 / 版本 / status / job_id / 偵測時間。誠實鐵律：
          usdc_key==null 標 p1「待產生」；coverage_report==null 標「未取得」；
          不顯假 ready / 假 coverage（Phase 2 回填後才會有真值）。 */}
      <Panel title={t("轉檔 Ledger（持久紀錄）", "Conversion ledger (persistent records)")} sub={t("GET /api/conversion/records；watcher 偵測即落帳，跨重啟不遺失", "GET /api/conversion/records; recorded on watcher detection, persists across restarts")} prov="asbuilt">
        <div data-testid="conv-ledger-panel">
        {recErr && <p className="ec-warn-note">{recErr}</p>}
        {!recErr && records.length === 0 && (
          <p className="ec-note">{t("尚無 ledger 紀錄；watcher 偵測到新 model.ifc 後自動落帳。", "No ledger records yet; recorded automatically after the watcher detects a new model.ifc.")}</p>
        )}
        {!recErr && records.length > 0 && (
          <table className="ec-table">
            <thead>
              <tr>
                <th>key</th>
                <th>{t("專案", "Project")}</th>
                <th>{t("種類", "Category")}</th>
                <th>{t("版本", "Version")}</th>
                <th>status</th>
                <th>job_id</th>
                <th>usdc</th>
                <th>coverage</th>
                <th>{t("偵測時間", "Detected at")}</th>
                <th>{t("控制", "Control")}</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 50).map((r) => {
                const statusLabel = LEDGER_STATUS_LABEL[r.status] ?? r.status;
                const statusProv = LEDGER_STATUS_PROV[r.status] ?? "artifact";
                return (
                  <tr key={r.idempotency_key}>
                    <td><code data-testid={`conv-ledger-idem-${r.idempotency_key}`}>{r.idempotency_key}</code></td>
                    <td>{r.project_display_name || r.project_id}</td>
                    <td>{r.category || "—"}</td>
                    <td>{r.external_model_version_id}</td>
                    <td><span className={`ec-prov ${PROV_CLASS[statusProv]}`}>{statusLabel}</span></td>
                    <td><span className="ec-note">{r.conversion_job_id ?? "—"}</span></td>
                    <td>
                      {r.usdc_key != null
                        ? <span>{r.usdc_key}</span>
                        : <span className="ec-prov ec-p1">{t("待產生", "pending")}</span>}
                    </td>
                    <td>
                      {r.coverage_report != null
                        ? <span>{typeof r.coverage_report === "object" ? JSON.stringify(r.coverage_report) : String(r.coverage_report)}</span>
                        : <span className="ec-note">{t("未取得", "not available")}</span>}
                    </td>
                    <td><span className="ec-note">{r.detected_at}</span></td>
                    {/* Task 8（AC6(b)）：對「未轉/failed」列掛一鍵觸發鈕（走 POST /api/conversion/trigger）。
                        ledger 列必有紀錄，故「未轉」在此即 status==='failed'（converter 失敗、可重試/強制重轉）；
                        object_key 為 null（Phase 1 watcher 落帳可能無 key）時無從觸發 → 不掛鈕。 */}
                    <td>
                      {r.status === "failed" && r.object_key ? (
                        <Btn
                          data-testid={`conv-ledger-trigger-${r.idempotency_key}`}
                          caption="POST /api/conversion/trigger"
                          onClick={() => { setActionErr(null); setPendingAction(null); setTriggerErr(null); setPendingTriggerKey(r.object_key); }}
                        >{t("觸發轉檔", "Trigger")}</Btn>
                      ) : <span className="ec-note">—</span>}
                      {/* Task 7（§4.3 CV → M）：evidence-typed cross-link chip——只有 object_key 存在才掛，
                          不因列狀態（failed/ready/…）而隱藏；與上方「觸發轉檔」鈕互不排斥、可同列並存。 */}
                      {r.object_key ? (
                        <Btn
                          data-testid={`conv-ledger-minio-${r.idempotency_key}`}
                          caption={t("回看 MinIO 來源物件", "View source object in MinIO")}
                          onClick={() => { window.location.hash = buildHandoff("minio", { source: "conv", minio_key: r.object_key as string, conversion_id: r.conversion_job_id ?? undefined }); }}
                        >{t("來源 →", "Source →")}</Btn>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        </div>
      </Panel>
      <Panel title="Ifc-ready jobs" sub={t("/api/external/ifc-ready truth；沒有資料時顯示空，不補假 job", "/api/external/ifc-ready truth; shows empty when there is no data, with no fake jobs filled in")} prov="asbuilt">
        {jobs.length ? (
          <table className="ec-table"><thead><tr><th>job</th><th>key</th><th>lifecycle</th><th>project</th><th>usdc</th><th>conversion</th><th>dispatch</th><th>session</th><th>stage</th><th>coverage</th><th>{t("控制", "Control")}</th></tr></thead>
            <tbody>{jobs.slice(0, 20).map((j) => (
              <Fragment key={j.ifc_ready_job_id}>
                <tr>
                  <td>{j.ifc_ready_job_id}</td>
                  <td>
                    {/* key 欄三段訊號間顯式補空白分隔：JSX 多行排列經編譯會去除元素間空白，
                        .ec-note 又無水平 margin（edge-console.css:136 margin:8px 0），不補則三段黏成
                        「mw_...新建易失·重啟即清」，操作員無法辨識 idem／replay／volatility 三個獨立訊號。 */}
                    <code data-testid={`conv-job-idem-${j.ifc_ready_job_id}`}>{j.idempotency_key ?? "—"}</code>{" "}
                    {/* idempotent_replay 誠實標記：false=新建、true=命中既有去重 */}
                    <span data-testid={`conv-job-replay-${j.ifc_ready_job_id}`} className="ec-note">{j.idempotent_replay ? t("命中既有", "replay") : t("新建", "new")}</span>{" "}
                    {/* data_volatility 易失性標記：job 端 in-memory，重啟即清 */}
                    <span data-testid={`conv-job-volatility-${j.ifc_ready_job_id}`} className="ec-note">{j.data_volatility === "persisted" ? t("持久", "persisted") : t("易失·重啟即清", "volatile")}</span>
                  </td>
                  <td>
                    {/* lifecycle chip 重用 ledger 表（L1178）同一套 provenance chip 樣式：
                        .ec-prov（padding/border/圓點，edge-console.css:77-90）+ PROV_CLASS
                        以 LEDGER_STATUS_PROV 上色（queued/detected/converting→cyan、ready→green、
                        failed→red），使 job↔ledger↔minio 三視圖狀態徽章視覺對齊。 */}
                    <span
                      data-testid={`conv-job-lifecycle-${j.ifc_ready_job_id}`}
                      className={`ec-prov ${PROV_CLASS[LEDGER_STATUS_PROV[j.conversion_lifecycle_status ?? ""] ?? "artifact"]}`}
                    >{lifecycleLabel(j.conversion_lifecycle_status)}</span>
                  </td>
                  <td data-testid={`conv-job-project-${j.ifc_ready_job_id}`}>
                    {j.project_display_name || j.project_id}{j.category ? ` · ${j.category}` : ""}
                  </td>
                  <td>
                    <span data-testid={`conv-job-usdc-${j.ifc_ready_job_id}`} className="ec-note">
                      {j.usdc_role === "parsed_usdc" ? t("已產生 USDC", "USDC ready") : t("待產生", "pending")}
                    </span>
                  </td>
                  <td>{j.conversion_status ?? "—"}</td>
                  <td>
                    {(j.failure_reason ?? j.dispatch_error) ? (
                      <span
                        className="ec-warn-note"
                        data-testid={`conv-job-failure-${j.ifc_ready_job_id}`}
                        title={`${j.failure_stage ? `[${j.failure_stage}] ` : ""}${j.failure_reason ?? j.dispatch_error}`}
                      >
                        {j.failure_stage ? `[${j.failure_stage}] ` : ""}
                        {(() => {
                          // 誠實鐵律：超過 80 字才截斷並補「…」提示，不可靜默硬切誤導操作員（完整訊息見 title tooltip）。
                          const msg = (j.failure_reason ?? j.dispatch_error) as string;
                          return msg.length > 80 ? `${msg.slice(0, 80)}…` : msg;
                        })()}
                      </span>
                    ) : "—"}
                  </td>
                  <td>
                    {/* Task 7（§4.3 CV → SS / Review Room）：evidence-typed cross-link chips——只有
                        review_session_id 存在才掛，接收端（SS/Review Room）依 §4.2 重驗 session id。 */}
                    {j.review_session_id ?? "—"}
                    {j.review_session_id ? (
                      <>
                        {" "}
                        <Btn data-testid={`conv-job-session-${j.ifc_ready_job_id}`} caption={t("在 Session 管理檢視", "View in Session Management")}
                          onClick={() => { window.location.hash = buildHandoff("sessions", { source: "conv", session: j.review_session_id as string }); }}>SS →</Btn>
                        {" "}
                        <Btn data-testid={`conv-job-review-${j.ifc_ready_job_id}`} caption={t("在 Review Room 開此 session", "Open this session in Review Room")}
                          onClick={() => { window.location.hash = buildHandoff("review", { source: "conv", session: j.review_session_id as string }); }}>Review →</Btn>
                      </>
                    ) : null}
                  </td>
                  <td>{j.expected_stage_url ?? "—"}</td>
                  <td>{j.conversion_job_id
                    ? <Btn data-testid={`conv-coverage-toggle-${j.ifc_ready_job_id}`} onClick={() => void toggleCoverage(j)}>{openJob === j.ifc_ready_job_id ? t("收合", "Collapse") : "coverage"}</Btn>
                    : <span className="ec-note">{t("尚未派工", "Not dispatched yet")}</span>}</td>
                  <td>
                    {j.status === "queued_for_conversion" && (
                      <Btn
                        data-testid={`conv-prioritize-${j.ifc_ready_job_id}`}
                        disabled={j.queue_position == null || j.queue_position <= 1}
                        title={
                          j.queue_position == null ? t("佇列位置未知，暫不可插隊", "Queue position unknown; cannot prioritize for now")
                          : j.queue_position === 0 ? t("正在派工中（in-flight），不可插隊", "Currently dispatching (in-flight); cannot prioritize")
                          : j.queue_position <= 1 ? t("已在隊首（position 1），無需插隊", "Already at the head of the queue (position 1); no need to prioritize")
                          : undefined
                        }
                        onClick={() => { setTriggerErr(null); setPendingTriggerKey(null); setActionErr(null); setPendingAction({ jobId: j.ifc_ready_job_id, kind: "prioritize" }); }}
                      >{t("插隊", "Prioritize")}</Btn>
                    )}
                    {(j.status === "dispatch_failed" || j.status === "dropped_on_restart") && (
                      <Btn
                        data-testid={`conv-retry-${j.ifc_ready_job_id}`}
                        onClick={() => { setTriggerErr(null); setPendingTriggerKey(null); setActionErr(null); setPendingAction({ jobId: j.ifc_ready_job_id, kind: "retry" }); }}
                      >{t("重試", "Retry")}</Btn>
                    )}
                  </td>
                </tr>
                {openJob === j.ifc_ready_job_id && (
                  <tr><td colSpan={11}>
                    <div data-testid={`conv-coverage-${j.ifc_ready_job_id}`}>
                      <CoverageDrawer state={cov[j.ifc_ready_job_id]} />
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}</tbody></table>
        ) : <p className="ec-note">{t("尚未取得 ifc-ready job；可由真實 IFC 進件頁註冊 fixture 後再回來看排程。", "No ifc-ready jobs retrieved yet; register a fixture from the real IFC intake page and come back to view the schedule.")}</p>}
      </Panel>
      {/* Task 7（七軸和諧整合 §11 OQ2）：轉檔歷史 panel——純前端補洞，讀既有 GET /api/dev/conversions
          （conversion service 側 job 歷史 pass-through，與上方 coordinator ledger 不同源）。誠實鐵律：
          回應形狀非本專案定義（DevConversionRecord 為寬鬆 pass-through 型別），故 prov="artifact"；
          載入失敗顯「未取得」而非假空表；不改後端（N2/N4）。OQ2 預設：落在 #conv 頁內的一個 Panel，
          不新增 hash route。 */}
      <Panel title={t("轉檔歷史（conversion service pass-through）", "Conversion history (conversion-service pass-through)")} sub="GET /api/dev/conversions" prov="artifact">
        <div data-testid="conv-history-panel">
          {historyErr ? (
            <p className="ec-note">{t("未取得（GET /api/dev/conversions 無法讀取或此環境未啟用）", "not available (GET /api/dev/conversions is unavailable or disabled in this environment)")}</p>
          ) : history == null ? (
            <p className="ec-note">{t("載入中…", "Loading…")}</p>
          ) : history.length === 0 ? (
            <p className="ec-note">{t("目前無轉檔歷史紀錄（非錯誤）。", "No conversion history at the moment (not an error).")}</p>
          ) : (
            <table className="ec-table">
              <thead><tr><th>conversion_job_id</th><th>status</th><th>source_ifc_filename</th></tr></thead>
              <tbody>
                {history.slice(0, 50).map((h, i) => (
                  <tr key={h.conversion_job_id ?? `h-${i}`} data-testid={`conv-history-row-${h.conversion_job_id ?? i}`}>
                    <td>{h.conversion_job_id ?? "—"}</td>
                    <td>{h.status ?? "—"}</td>
                    <td>{h.source_ifc_filename ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
      <IntentDialog
        open={pendingAction != null}
        title={
          pendingAction?.kind === "watch-toggle"
            ? (pendingAction.enabled ? t("開啟 MinIO 自動偵測", "Enable MinIO auto-detection") : t("關閉 MinIO 自動偵測", "Disable MinIO auto-detection"))
            : pendingAction?.kind === "prioritize" ? t("插隊到佇列最前", "Move to the front of the queue") : t("重新派工此 job", "Re-dispatch this job")
        }
        cost={
          pendingAction?.kind === "watch-toggle"
            ? (pendingAction.enabled
                ? t("恢復輪詢 MinIO；偵測到新 model.ifc 會自動進件並派工。", "Resume polling MinIO; when a new model.ifc is detected it will be intaken and dispatched automatically.")
                : t("停止輪詢 MinIO；新上傳的 model.ifc 將不再自動進件，需手動觸發。", "Stop polling MinIO; newly uploaded model.ifc will no longer be intaken automatically and must be triggered manually."))
            : pendingAction?.kind === "prioritize"
                ? t("此 job 將排到佇列最前、較早派工；其他排隊中 job 順位後移。", "This job will move to the front of the queue and be dispatched sooner; other queued jobs shift back.")
                : t("將重新派工此 job 至轉檔 authority；可能再次失敗。", "This job will be re-dispatched to the conversion authority; it may fail again.")
        }
        busy={actionBusy}
        actionErr={actionErr}
        onConfirm={runAction}
        onCancel={() => { if (!actionBusy) { setActionErr(null); setPendingAction(null); } }}
      />
      {/* Task 8（AC6(b)）：ledger 列「觸發轉檔」專屬 intent→confirm（與上方 pendingAction dialog 互斥開啟）。
          走 POST /api/conversion/trigger（非 ifc-ready）；IntentDialog 真實 props：open/title/cost/onConfirm/onCancel/busy/actionErr。 */}
      <IntentDialog
        open={pendingTriggerKey != null && pendingAction == null}
        title={t("確認觸發轉檔", "Confirm trigger conversion")}
        cost={t("對此 model.ifc 觸發轉檔 intake（POST /api/conversion/trigger，帶 x-dev-token；同 key 重觸發冪等）：", "Trigger conversion intake for this model.ifc (POST /api/conversion/trigger with x-dev-token; same-key re-trigger is idempotent): ") + (pendingTriggerKey ?? "")}
        busy={triggerBusy}
        actionErr={triggerErr}
        onConfirm={(reason) => void confirmTrigger(reason)}
        onCancel={() => { if (!triggerBusy) { setTriggerErr(null); setPendingTriggerKey(null); } }}
      />
    </>
  );
}

export function SessionManagementPage() {
  const [rt, setRt] = useState<RuntimeStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // IX-SS-04 per-row「結束 session」controlled-action（模式 3 intent→confirm）。照抄
  // ConversionSchedulingPage 的 actionBusyRef 同步防重入 pattern；terminate 專屬狀態：
  // pendingTerminate（開 IntentDialog）、terminatingIds（灰列）、timersRef（60s timer 收集）。
  const [pendingTerminate, setPendingTerminate] = useState<{ sessionId: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const actionBusyRef = useRef(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [terminatingIds, setTerminatingIds] = useState<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const load = useCallback(async () => {
    setErr(null);
    try { setRt(await coordinatorClient.runtimeStatus()); }
    catch (e) { setErr(`${t("未連線 coordinator /api/runtime/status：", "Not connected to coordinator /api/runtime/status: ")}${String(e)}`); }
  }, []);
  const markTerminating = useCallback((id: string) => {
    setTerminatingIds((prev) => new Set(prev).add(id));
    const t = setTimeout(() => {
      setTerminatingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      timersRef.current.delete(id);
    }, 60_000);
    timersRef.current.set(id, t);
  }, []);
  // unmount 清除所有 60s timer，避免 setState-after-unmount / leak（spec §7）。
  useEffect(() => () => { for (const t of timersRef.current.values()) clearTimeout(t); timersRef.current.clear(); }, []);
  const runTerminate = useCallback(async (reason: string) => {
    if (!pendingTerminate) return;
    if (actionBusyRef.current) return;            // 同步防重入（state 尚未更新前）
    actionBusyRef.current = true;
    setActionBusy(true);
    setActionErr(null);
    const sessionId = pendingTerminate.sessionId;
    try {
      await coordinatorClient.sessionClose(sessionId, reason);   // 真 POST，body 只帶 reason
      markTerminating(sessionId);                                // 該列轉灰，60s 後移除（看見因果）
      setPendingTerminate(null);
      await load();                                              // 非樂觀：重抓 runtime/status 真狀態
    } catch (e) {
      setActionErr(`${t("結束 session 失敗：", "Failed to terminate session: ")}${String(e)}`);          // 誠實錯誤、不關 dialog、不改狀態
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  }, [pendingTerminate, load, markTerminating]);
  useEffect(() => { void load(); }, [load]);
  const sessions = rt?.sessions.items ?? [];
  return (
    <>
      <h1>{t("Session 管理 · Primary / Spectator ATC", "Session Management · Primary / Spectator ATC")}</h1>
      <p className="ec-lead">{t("每個 endpoint 像 runway，每個 primary / spectator viewer 像飛機。Open URL 不等於 occupied；occupied 必須有 browser first frame / heartbeat / stage match evidence。", "Each endpoint is like a runway, each primary / spectator viewer like a plane. Open URL does not equal occupied; occupied requires browser first frame / heartbeat / stage match evidence.")}</p>
      <Panel title="Endpoint readiness rules" sub="port listening != has frame" prov="asbuilt" actions={<Btn data-testid="sessions-refresh" caption="GET /api/runtime/status" onClick={load}>{t("重新整理", "Refresh")}</Btn>}>
        {err && <p className="ec-warn-note">{err}</p>}
        <div className="ec-grid">
          <Field k="Open primary URL" v={t("只代表 browser 被導向，不代表 endpoint occupied", "Only means the browser was redirected, not that the endpoint is occupied")} prov="asbuilt" />
          <Field k="Open spectator URL" v={t("只代表 spectator link 已產生，不代表 first frame", "Only means a spectator link was generated, not that there is a first frame")} prov="asbuilt" />
          <Field k="occupied" v={t("必須等 browser first_frame_at + heartbeat", "Requires browser first_frame_at + heartbeat")} prov="p1" />
          <Field k="stage matched" v="expected_stage_url == loaded stage URL" prov="p1" />
        </div>
      </Panel>
      <Panel title="Active sessions" sub="coordinator-owned session summary" prov="asbuilt">
        {sessions.length ? (
          <table className="ec-table"><thead><tr><th>session</th><th>status</th><th>participants</th><th>conversion</th><th>stage</th><th>動作</th></tr></thead>
            {/* terminating 中的列「不過濾」：spec §4.3 的 60s 移除靠 markTerminating 的 timer
                從 terminatingIds 移除 id（解灰列），最終離開可見列則靠 load() 重抓 runtime/status。
                故此處直接 .map() 全列渲染；terminating 列只轉灰並顯「結束中…」，不可在這裡 filter 掉，
                否則灰列會立刻消失、60s UX 失效。 */}
            <tbody>{sessions.map((s) => {
              const terminating = terminatingIds.has(s.session_id);
              const ended = s.status === "closing" || s.status === "closed";
              const greyed = terminating || ended;
              return (
                <tr key={s.session_id} className={greyed ? "ec-row-muted" : undefined} data-testid={`session-row-${s.session_id}`} data-terminating={terminating ? "true" : undefined}>
                  <td>{s.session_id}</td><td>{s.status}</td><td>{s.participant_count}</td><td>{s.conversion_status ?? "—"}</td><td>{s.expected_stage_url ?? "—"}</td>
                  <td>{s.status === "active" && !terminating ? (
                    <Btn data-testid={`session-terminate-${s.session_id}`} onClick={() => { setActionErr(null); setPendingTerminate({ sessionId: s.session_id }); }}>{t("結束 session", "Terminate session")}</Btn>
                  ) : <span className="ec-note">{terminating ? t("結束中…", "Terminating…") : "—"}</span>}</td>
                </tr>
              );
            })}</tbody></table>
        ) : <p className="ec-note">{t("目前 runtime status 無 active session；下面 endpoint pool 為治理規則示意。", "Runtime status currently has no active session; the endpoint pool below illustrates governance rules.")}</p>}
      </Panel>
      <Panel title="Controlled actions" sub={t("per-row「結束 session」已落地（IX-SS-04，見上表）；Reclaim stale spectator / Force release 待 IX-SS-02 心跳遙測，維持 disabled（不提供假按鈕）", "Per-row \"Terminate session\" is implemented (IX-SS-04, see table above); Reclaim stale spectator / Force release await IX-SS-02 heartbeat telemetry and stay disabled (no fake buttons)")} prov="p1">
        <Btn disabled caption="Phase 1 read-only：browser-visible URL only" prov="p1">Open primary URL</Btn>{" "}
        <Btn disabled caption="Phase 1 read-only：browser-visible URL only" prov="p1">Open spectator URL</Btn>{" "}
        <Btn disabled caption={t("Phase 1 read-only：stale spectator reclaim 待接", "Phase 1 read-only: stale spectator reclaim not built")} prov="p1">Reclaim stale spectator</Btn>{" "}
        <Btn disabled caption="requires explicit reason + audited intent to Kit Manager" prov="p1">Force release / restart primary</Btn>
      </Panel>
      <IntentDialog
        open={pendingTerminate != null}
        title={t("結束 session", "Terminate session")}
        cost={t("將結束此 session 並釋放其 Kit 座位，座位可被新 viewer 取用。這不會強制關閉 GPU 上的 Kit 行程（Kit 行程 lifecycle 屬 kit-manager-api）。結束＝協作式 close 的 operator 觸發。", "This will terminate the session and release its Kit seat, which can then be taken by a new viewer. It does not force-kill the Kit process on the GPU (Kit process lifecycle belongs to kit-manager-api). Terminate = operator-triggered cooperative close.")}
        busy={actionBusy}
        actionErr={actionErr}
        onConfirm={runTerminate}
        onCancel={() => { if (!actionBusy) { setActionErr(null); setPendingTerminate(null); } }}
      />
    </>
  );
}

export function KitGpuFleetPage() {
  return (
    <>
      <h1>{t("Kit / GPU 機隊", "Kit / GPU Fleet")}</h1>
      <p className="ec-lead">{t("此頁是 runtime operator 的機隊視角：哪台 GPU 在服務哪個 Kit stream，哪台可接新 session，哪些節點 drain，哪些 restart/release 必須由 Kit Manager 執行。", "This page is the runtime operator's fleet view: which GPU serves which Kit stream, which can accept a new session, which nodes are draining, and which restart/release must be executed by the Kit Manager.")}</p>
      <Panel title="Fleet model" sub={t("Coordinator 顯示治理狀態，不直接管理 GPU process", "Coordinator shows governance state and does not directly manage the GPU process")} prov="asbuilt">
        <div className="ec-grid">
          <MiniCard code="1 GPU" title="1 GPU = 1 Kit stream" desc={t("primary 使用獨立 Kit stream；spectator 預設共享同一 stream，除非未來需求是獨立視角。", "Primary uses a dedicated Kit stream; spectators share the same stream by default unless a future requirement needs independent views.")} prov="asbuilt" />
          <MiniCard code="drain" title={t("排空不接新 session", "Drain accepts no new session")} desc={t("drain 後 existing session 可跑完；新 session 不再派到該節點。", "After drain, existing sessions can finish; new sessions are no longer assigned to that node.")} prov="p1" />
          <MiniCard code="move" title={t("搬移不是無縫遷移", "Move is not seamless migration")} desc={t("拖 session 到另一台 GPU 表示 terminate + recreate，約 30-40s 並重載 stage。", "Dragging a session to another GPU means terminate + recreate, about 30-40s and reloading the stage.")} prov="p1" />
        </div>
      </Panel>
      <Panel title="Node snapshot" sub={t("實際 GPU/VRAM 遙測仍需 kit-manager-api / runtime manager 提供", "Actual GPU/VRAM telemetry still needs to be provided by kit-manager-api / runtime manager")} prov="demo">
        <table className="ec-table"><thead><tr><th>node</th><th>GPU</th><th>state</th><th>operation</th></tr></thead><tbody>
          <tr><td>edge-gpu-01</td><td>L40 · 48GB</td><td>running · S-270</td><td>drain / restart intent</td></tr>
          <tr><td>edge-gpu-02</td><td>L40 · 48GB</td><td>running · S-899</td><td>drain / restart intent</td></tr>
          <tr><td>edge-gpu-03</td><td>RTX 6000 · 48GB</td><td>idle</td><td>assign pending session</td></tr>
        </tbody></table>
        <p className="ec-note">{t("此表為 prototype fleet model 的 UI evidence；真實 restart/release 必須送 audited intent 給 Kit Manager，不能由 coordinator/browser 直接做。", "This table is UI evidence of the prototype fleet model; real restart/release must send an audited intent to the Kit Manager and cannot be done directly by coordinator/browser.")}</p>
      </Panel>
    </>
  );
}

// Task 7（minio-folderview）：#minio 改真 MinIO 逐層資料夾導覽（S3 Delimiter）。
// buildMinioTree 三層攤平樹已退役；改 useState(prefix) 點資料夾換 prefix 重打 getMinioFolder。
// .ifc 旁掛 ledger 衍生狀態 chip（讀 getConversionRecords）＋ 一鍵觸發鈕（intent→confirm）。
// 誠實鐵律：folders/objects 皆真實 list；無 ledger 紀錄誠實顯『未轉』不臆測；不洩漏 presigned URL。

// ledger chip 狀態映射（與後端 ledgerChipStatus.ts 同義；前端內聯避免跨 monorepo tsconfig boundary）。
// records 來自 getConversionRecords()；無紀錄 → 'untracked'（顯「未轉（無 ledger 紀錄）」），不臆測。
// §3.4 auto-enroll 後既有檔多已自動觸發落 ledger queued，untracked 僅剩真正無紀錄者（首輪前/watcher 關）。
// 命中 → 後端 ConversionRecord.status 是寬 wire string（enum 演進 / 資料遷移殘留可能送非預期值），
// 故與 confirmTrigger 同樣先過 narrowConversionStatus()：非法值退 'unknown'（MINIO_CHIP_LABEL 有對應
// 標籤），不讓原始 wire 字串經 chip render 的 `?? st` fallback 外洩（誠實鐵律：不洩漏 wire 字串）。
//
// quality finding Important #1：getConversionRecords 有 limit（後端 parseListLimit 上限 100）。當 ledger
// 紀錄數超出回傳窗（count > items.length，截斷）或 records 載入失敗（coordinator 離線/502/timeout）時，
// 超窗/未載入的物件在 records 中查無 key——這是「可能有紀錄但前端看不到」，不可靜默當『未轉』（違反
// AC-chip『無紀錄才標未轉、不臆測』；誠實鐵律：records 載入失敗不得誤顯未轉）。故 miss 且 recordsIncomplete
// 時退 'indeterminate'（顯『狀態未明』），誠實揭露不確定來源。
function ledgerChipStatus(
  idempotencyKey: string,
  records: ReadonlyArray<{ idempotency_key: string; status: string }>,
  recordsIncomplete: boolean, // 截斷（超查詢上限）或載入失敗——兩者皆「可能有紀錄但看不到」
): string {
  const hit = records.find((r) => r.idempotency_key === idempotencyKey);
  if (hit) return narrowConversionStatus(hit.status) ?? "unknown";
  // 查無紀錄：records 不完整（截斷／載入失敗）時誠實顯『狀態未明』；完整載入且查無才是真『未轉』。
  return recordsIncomplete ? "indeterminate" : "untracked";
}

// chip 狀態本地化標籤（無紀錄＝untracked → 未轉；其餘對應 ledger status enum）。
// 鍵集合對齊 spec AC-chip（design line 168）列舉的 7 個 chip 狀態，確保後端送任一列舉值都有本地化
// 標籤、不會 fallback 顯原始 wire 字串（誠實鐵律）。
const MINIO_CHIP_LABEL: Record<string, string> = {
  detected: t("已偵測", "detected"),
  queued: t("排隊", "queued"),
  converting: t("轉檔中", "converting"),
  ready: t("完成", "ready"),
  failed: t("失敗", "failed"),
  untracked: t("未轉（無 ledger 紀錄）", "not converted (no ledger record)"),
  // not_queued＝spec AC-chip『未進佇列』。誠實註記：現行後端 ConversionLedgerStatus 只 5 值
  // （detected/queued/converting/ready/failed，conversionLedger.ts:11），不產生 not_queued——
  // 「偵測到未進佇列」目前由 detected 涵蓋；此 key 為 spec AC-chip 完整性保留。若後端日後細分出
  // not_queued，narrowConversionStatus 的 CONVERSION_LEDGER_STATUSES 須同步加入；未加入時 ledgerChipStatus
  // 的 `?? "unknown"` 仍誠實退 unknown（顯下方『未知狀態』、不洩漏 wire 字串）。
  not_queued: t("未進佇列", "not queued"),
  unknown: t("未知狀態", "unknown"), // narrowConversionStatus 退回值：後端送非預期 status 時誠實顯未知
  // records 不完整（截斷超查詢上限／載入失敗）且查無 key 時的誠實退路（≠『未轉』，避免靜默誤報）。
  indeterminate: t("狀態未明（紀錄不完整或載入失敗）", "indeterminate (records incomplete or unavailable)"),
};

function roleLabel(role: import("./coordinatorClient").MinioObject["role"]): string {
  if (role === "source_ifc") return t("來源 IFC", "Source IFC");
  if (role === "parsed_usdc") return t("已轉 USDC", "Converted USDC");
  return t("其他", "Other");
}

function roleClass(role: import("./coordinatorClient").MinioObject["role"]): string {
  if (role === "source_ifc") return "ec-prov artifact"; // cyan/artifact
  if (role === "parsed_usdc") return "ec-prov asbuilt"; // built
  return "ec-prov";
}

export function MinioDataPage() {
  const [folder, setFolder] = useState<import("./coordinatorClient").MinioFolderListing | null>(null);
  const [records, setRecords] = useState<ConversionRecord[]>([]);
  // quality finding Important #1：records 是否被回傳上限截斷（count > items.length）。截斷時查無 key
  // 的物件不可當『未轉』，須顯『狀態未明』（chip 經 ledgerChipStatus 退 'indeterminate'）。
  const [recordsTruncated, setRecordsTruncated] = useState(false);
  // honesty：records 載入失敗（coordinator 離線/502/timeout）也是「可能有紀錄但看不到」，與截斷同樣
  // 須退 'indeterminate' 而非靜默誤顯『未轉』。catch 設 true、成功設 false（避免暫態失敗永久鎖死）。
  const [loadRecordsErr, setLoadRecordsErr] = useState(false);
  const [prefix, setPrefix] = useState(""); // 當前層 prefix（spec §2.5：點資料夾換 prefix）
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null); // intent→confirm
  const [triggerErr, setTriggerErr] = useState<string | null>(null);
  const [triggerBusy, setTriggerBusy] = useState(false); // confirm 進行中（IntentDialog busy）
  const folderCacheRef = useRef(new Map<string, import("./coordinatorClient").MinioFolderListing>());
  const [stalePrefixes, setStalePrefixes] = useState<Set<string>>(() => new Set());

  const load = useCallback(async (p: string, options?: { refresh?: boolean }) => {
    if (!options?.refresh) {
      const cached = folderCacheRef.current.get(p);
      if (cached) {
        setFolder(cached);
        setErr(null);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setErr(null);
    try {
      const res = options?.refresh
        ? await coordinatorClient.getMinioFolder(p, { refresh: true })
        : await coordinatorClient.getMinioFolder(p);
      folderCacheRef.current.set(p, res);
      setFolder(res);
      setStalePrefixes((prev) => {
        if (!prev.has(p)) return prev;
        const next = new Set(prev);
        next.delete(p);
        return next;
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;
    const source = new EventSource(coordinatorClient.minioEventsUrl());
    const onChanged = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as import("./coordinatorClient").MinioChangeEvent;
        if (!Array.isArray(payload.prefixes)) return;
        const prefixes = payload.prefixes.filter((p): p is string => typeof p === "string");
        for (const p of prefixes) folderCacheRef.current.delete(p);
        if (prefixes.length === 0) return;
        setStalePrefixes((prev) => {
          const next = new Set(prev);
          for (const p of prefixes) next.add(p);
          return next;
        });
      } catch {
        // SSE dirty signal 是 best-effort；payload 壞掉時保留現有畫面，手動 refresh 仍可取真實 list。
      }
    };
    source.addEventListener("minio.changed", onChanged);
    return () => {
      source.removeEventListener("minio.changed", onChanged);
      source.close();
    };
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      // quality finding Important #1：取後端 parseListLimit 允許的上限（100；請求更大值會被夾到 100）。
      // r.count 是 slice 前的總筆數，r.items.length 是回傳窗大小；count > items.length 即被截斷。
      const r = await coordinatorClient.getConversionRecords(100);
      setRecords(r.items);
      setRecordsTruncated(r.count > r.items.length);
      setLoadRecordsErr(false); // 成功載入 → 清除前次失敗旗標
    } catch {
      // honesty fix：records 載入失敗不可靜默讓 chip 顯『未轉』（誤把「看不到」當「沒轉」）。
      // 標 loadRecordsErr → ledgerChipStatus 退 'indeterminate'（狀態未明）。
      setLoadRecordsErr(true);
    }
  }, []);
  useEffect(() => {
    void load(prefix);
  }, [load, prefix]);
  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const enterFolder = (f: string) => setPrefix(f); // CommonPrefix 為絕對 prefix
  const goUp = () => {
    if (!prefix) return;
    const trimmed = prefix.replace(/\/$/, "");
    const idx = trimmed.lastIndexOf("/");
    setPrefix(idx >= 0 ? trimmed.slice(0, idx + 1) : "");
  };
  const refreshCurrent = () => {
    folderCacheRef.current.delete(prefix);
    void load(prefix, { refresh: true });
  };
  // folders 為 Array<{ prefix; has_source_ifc }>；對中文使用者以 localeCompare('zh-TW') 重排（spec §2.1 中文排序）。
  const sortedFolders = folder ? [...folder.folders].sort((a, b) => a.prefix.localeCompare(b.prefix, "zh-TW")) : [];
  // empty 態 (b)：已設定但當前層無物件（無 note）。empty 態 (a)＝後端回 note（未設定）。
  const showFolderEmpty = !!folder && folder.folders.length === 0 && folder.objects.length === 0;
  // folder 回應的 note（後端未設定時回 200 + note；MinioFolderListing.note? 已對齊 wire shape）。
  const folderNote = folder?.note;
  const currentPrefixStale = stalePrefixes.has(prefix);

  // IntentDialog onConfirm 帶使用者填的 reason；dialog 不自關、不顯錯誤，由本 caller 負責：
  // 成功才 setPendingKey(null) 關 dialog，失敗 setTriggerErr 經 actionErr 顯示、解除 busy
  //（與既有 ConversionSchedulingPage 用法、spec §6.1 IntentDialog 契約一致）。
  const confirmTrigger = async (_reason: string) => {
    if (!pendingKey) return;
    setTriggerErr(null);
    setTriggerBusy(true);
    try {
      // 方向1：改走 main 已合併的 triggerConversion（POST /api/conversion/trigger，IP allowlist 守門、
      // server-side presigned）。main 回 {ifc_ready_job_id, status?}（無 idempotency_key），故不做樂觀
      // chip patch；觸發成功後 loadRecords() 重抓 ledger，chip 由 ledgerChipStatus(idk, records) 依真值
      // 更新（誠實鐵律：狀態真相來源＝ledger，不靠前端臆測）。
      await coordinatorClient.triggerConversion(pendingKey);
      void loadRecords();
      setPendingKey(null); // 成功才關 dialog
    } catch (e) {
      setTriggerErr(String(e)); // 失敗顯 inline error（actionErr）、chip 不變、dialog 不關
    } finally {
      setTriggerBusy(false);
    }
  };

  return (
    <>
      <h1>{t("MinIO 資料", "MinIO Data")}</h1>
      <p className="ec-lead">
        {t("唯讀 intake 來源視圖，非 metadata 權威。 此頁讀 ", "Read-only intake source view, not the metadata authority. This page reads ")}<code>GET /api/minio/objects</code>{t("（真實 S3 list proxy，帶 Delimiter='/'）； 像 MinIO 網頁一樣逐層資料夾導覽（point-and-list），導到 model.ifc 才掛專案 / 種類 / 版本語意 badge。 metadata 權威在外部 ", " (real S3 list proxy with Delimiter='/'); browses the bucket level-by-level like the MinIO web UI (point-and-list); project / category / version semantic badges are attached only when reaching model.ifc. The metadata authority is the external ")}<code>bim-control · MySQL</code>{t("，不由本頁決定。", "; this page does not decide it.")}
      </p>

      <Panel
        title={t("MinIO Bucket 逐層資料夾（真實 list）", "MinIO bucket folder navigation (real list)")}
        sub={folder?.bucket ? `bucket=${folder.bucket} · GET /api/minio/objects?delimiter=/` : t("GET /api/minio/objects?delimiter=/（MinIO watch 未設定時回 count=0）", "GET /api/minio/objects?delimiter=/ (returns count=0 when MinIO watch is not configured)")}
        prov="asbuilt"
      >
        {/* 麵包屑：目前層 prefix（空＝bucket 根）＋ 上一層鈕（prefix 非空才顯） */}
        <div className="ec-row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          {prefix ? (
            <Btn data-testid="minio-go-up" caption="prefix --" onClick={() => goUp()}>{t("⬑ 上一層", "⬑ Up")}</Btn>
          ) : null}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.7 }}>{prefix || "/"}</span>
          <Btn data-testid="minio-refresh" caption="GET /api/minio/objects?refresh=1" onClick={refreshCurrent}>
            {t("重新整理", "Refresh")}
          </Btn>
          {folder?.cache ? (
            <span data-testid="minio-cache-state" className="ec-note">
              {folder.cache.hit ? t("cache hit", "cache hit") : t("live list", "live list")}
            </span>
          ) : null}
        </div>

        {currentPrefixStale ? (
          <div
            data-testid="minio-stale-note"
            className="ec-warn-note"
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}
          >
            <span>{t("MinIO 監控偵測到此層可能有新變更。", "MinIO watcher detected possible changes in this level.")}</span>
            <Btn data-testid="minio-stale-refresh" caption="GET /api/minio/objects?refresh=1" onClick={refreshCurrent}>
              {t("重新整理", "Refresh")}
            </Btn>
          </div>
        ) : null}

        {loading ? (
          <p className="ec-note">{t("載入中…（GET /api/minio/objects）", "Loading… (GET /api/minio/objects)")}</p>
        ) : err ? (
          // error 態：誠實顯原因 + 可重試（不假裝有資料）。
          <div className="ec-warn-note" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>{t("讀取 MinIO 失敗：", "Failed to read MinIO: ")}{err}</span>
            <Btn data-testid="minio-tree-retry" caption="GET /api/minio/objects" onClick={() => { void load(prefix, { refresh: true }); }}>
              {t("重試", "Retry")}
            </Btn>
          </div>
        ) : folderNote ? (
          // empty 態 (a)：MinIO 未設定（後端回 note，200）。
          <p className="ec-note">{t("MinIO 未設定（", "MinIO not configured (")}{folderNote}{")"}</p>
        ) : showFolderEmpty ? (
          // empty 態 (b)：已設定但當前 prefix 無物件——不可誤用「未設定」文案。
          <p className="ec-note">{t("此層無物件（資料夾為空）。", "This level has no objects (empty folder).")}</p>
        ) : (
          // populated：資料夾鈕（含 source IFC badge）＋ 當層直屬物件列。
          <div>
            {sortedFolders.length > 0 ? (
              <div className="ec-tree">
                {sortedFolders.map((f) => (
                  <div key={f.prefix} className="ec-row" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <Btn data-testid={`minio-folder-open-${f.prefix}`} caption={t("點入此資料夾", "open folder")} onClick={() => enterFolder(f.prefix)}>{f.prefix}</Btn>
                    {f.has_source_ifc ? (
                      <span data-testid={`minio-folder-badge-${f.prefix}`} className="ec-prov artifact">
                        {t("含 source IFC", "has source IFC")}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {folder && folder.objects.length > 0 ? (
              <ul className="ec-tree" style={{ listStyle: "none", paddingLeft: 0 }}>
                {folder.objects.map((obj) => {
                  const idk = obj.idempotency_key;
                  const st = ledgerChipStatus(idk, records, recordsTruncated || loadRecordsErr);
                  return (
                    <li key={obj.key} className="ec-row" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {/* role label（與 intake 三段脫鉤，純副檔名） */}
                      <span className={roleClass(obj.role)}>{roleLabel(obj.role)}</span>
                      <span className="ec-tree-file" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{obj.key}</span>
                      {/* 三段語意 badge：有才顯（≥3 段才有，malformed 不掛）。各掛 data-testid 供 AC-badge
                          精準定位（避免 textContent 子字串誤判：如 category=main 撞 prefix 路徑字串）。 */}
                      {obj.project_display_name ? <span data-testid={`minio-badge-project-${idk}`} className="ec-prov">{obj.project_display_name}</span> : null}
                      {obj.category ? <span data-testid={`minio-badge-category-${idk}`} className="ec-prov">{obj.category}</span> : null}
                      {obj.version ? <span data-testid={`minio-badge-version-${idk}`} className="ec-prov">{obj.version}</span> : null}
                      {/* 僅 source_ifc 物件掛 ledger 狀態 chip（7b）＋ 一鍵觸發鈕（7c） */}
                      {obj.role === "source_ifc" ? (
                        <>
                          {/* 7b：ledger 衍生狀態 chip（無紀錄＝未轉，不臆測） */}
                          <span data-testid={`minio-chip-${idk}`} className="ec-prov">
                            {MINIO_CHIP_LABEL[st] ?? st}
                          </span>
                          {/* 7c：一鍵觸發鈕（未轉/failed 可按；ready/進行中 disabled）。
                              finding #1：'indeterminate'（records 截斷查無 key）也可按——觸發冪等（後端
                              mw_<hash16> 去重），讓使用者在狀態未明時仍能主動觸發/重轉，不被靜默鎖死。 */}
                          <Btn
                            data-testid={`minio-trigger-${idk}`}
                            caption="POST /api/conversion/trigger"
                            disabled={!["untracked", "failed", "indeterminate"].includes(st)}
                            onClick={() => { setTriggerErr(null); setPendingKey(obj.key); }}
                          >
                            {t("觸發轉檔", "Trigger")}
                          </Btn>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        )}
      </Panel>

      {/* 7c：intent→confirm 對話框（IntentDialog 真實 props：open/title/cost/onConfirm(reason)/onCancel/busy/actionErr）。 */}
      <IntentDialog
        open={!!pendingKey}
        title={t("確認觸發轉檔", "Confirm trigger conversion")}
        cost={t("對此物件觸發轉檔 intake：", "Trigger conversion intake for this object: ") + (pendingKey ?? "")}
        busy={triggerBusy}
        actionErr={triggerErr}
        onConfirm={(reason) => void confirmTrigger(reason)}
        onCancel={() => { setPendingKey(null); setTriggerErr(null); }}
      />

      <Panel title={t("Bucket layout（規約說明 — 示意，非實況）", "Bucket layout (convention — illustration, not live)")} sub={t("bim-control private bucket · 三層 key 規約示意（DEMO，非真實資料）", "bim-control private bucket · three-level key convention illustration (DEMO, not real data)")} prov="demo">
        <p className="ec-note">
          <strong>[DEMO]</strong> {t("此 Panel 為 MinIO bucket key 規約示意，非真實 list 資料。 真實物件由上方 Panel 顯示。", "This panel illustrates the MinIO bucket key convention, not real list data. Real objects are shown in the panel above.")}
        </p>
        <div className="ec-tree">
          <div>bim-control/</div>
          <div className="indent">{"{project_display_name}"}/</div>
          <div className="indent two">{"{root}"}/{"{category}"}/{"{version}"}/</div>
          <div className="indent three"><span className="ec-tree-file">model.ifc</span> <span className="ec-prov artifact">{t("來源 IFC", "Source IFC")}</span></div>
          <div className="indent three"><span className="ec-tree-file">model.usdc</span> <span className="ec-note">{t("轉檔產物（Phase 2 回填）", "Conversion output (backfilled in Phase 2)")}</span> <ProvTag prov="p1" /></div>
        </div>
      </Panel>

      <Panel title={t("與功能頁的關係", "Relationship to feature pages")} prov="asbuilt">
        <Field k="A1" v={t("rule-run 讀檔案庫選定的 IFC（version.path → ifc_source_path）", "rule-run reads the IFC selected from the file library (version.path → ifc_source_path)")} prov="asbuilt" />
        <Field k="A2" v={t("versions / diff compare 需要版本路徑與 model_version_id", "versions / diff compare need the version path and model_version_id")} prov="asbuilt" />
        <Field k="A3" v={t("federation 需要多專業 USD layer / stage paths", "federation needs multi-discipline USD layer / stage paths")} prov="asbuilt" />
        <Field k="3D Viewer" v={t("openStage 使用 generated model.usdc / model.usd URL", "openStage uses the generated model.usdc / model.usd URL")} prov="asbuilt" />
      </Panel>
    </>
  );
}

export function ReportsPage() {
  return (
    <StubPage
      title={t("報表中心", "Report Center")}
      note={t("把治理檢核、版本差異、mapping coverage、FM / clash summary 收成可交付文件。", "Collect governance validation, version diff, mapping coverage and FM / clash summary into deliverable documents.")}
      items={[
        ["Governance report", "A1 rule-run / Issue / BCF / Excel", "asbuilt"],
        ["Version diff summary", "A2 diff impact report", "asbuilt"],
        ["Mapping coverage", "conversion mapping summary report", "p1"],
        ["Review package", "session + evidence + screenshots", "p1"],
      ]}
    />
  );
}

export function AdminPage() {
  return (
    <StubPage
      title={t("系統管理", "System Administration")}
      note={t("RBAC、ruleset、runtime policy 的管理面。此頁不直接刪資料、不改機密、不直接 restart GPU process。", "Management surface for RBAC, ruleset and runtime policy. This page does not directly delete data, change secrets, or restart the GPU process.")}
      items={[
        ["RBAC / members", t("待接 control-plane identity", "control-plane identity not built"), "p1"],
        ["Rulesets", t("A1 IDS / YAML ruleset 管理", "A1 IDS / YAML ruleset management"), "p1"],
        ["Runtime policy", t("restart / release 必須 reason + audit", "restart / release require reason + audit"), "p1"],
      ]}
    />
  );
}

export function SpecPage() {
  return (
    <>
      <h1>{t("設計規格說明", "Design Specification")}</h1>
      <p className="ec-lead">{t("此頁保留 prototype 到 repo 的落地對照：完整操作台是 frontend product shell；conversion / Kit / WebRTC 權威仍在各自 sub-repo 邊界；MinIO 為 coordinator 外連 S3 來源，非獨立 repo。", "This page keeps the prototype-to-repo mapping: the full console is the frontend product shell; conversion / Kit / WebRTC authority still lives within their respective sub-repo boundaries; MinIO is an outbound S3 source for coordinator, not a separate repo.")}</p>
      <Panel title="Repo boundary contract" prov="asbuilt">
        <Field k="bim-review-coordinator" v={t("session / lifecycle / lease / audit / policy 權威；發 audited intent", "session / lifecycle / lease / audit / policy authority; issues audited intent")} prov="asbuilt" />
        <Field k="bim-streaming-server" v="IFC→USDC conversion authority + Kit/WebRTC/USD runtime" prov="asbuilt" />
        <Field k="web-viewer-sample" v="browser client / primary + spectator evidence source" prov="asbuilt" />
        <Field k="kit-manager-api" v="Kit process / endpoint pool / restart / release executor" prov="p1" />
      </Panel>
    </>
  );
}

export function GpuReviewRoomPage() {
  return (
    <>
      <ReviewRoomPage />
      <Panel title={t("GPU 審查室補充", "GPU Review Room Notes")} sub={t("prototype 的 GPU review room 是 viewer + runtime evidence，不是另開一個 renderer", "The prototype's GPU review room is viewer + runtime evidence, not a separate renderer")} prov="asbuilt">
        <Field k="Mock Viewport" v={t("沒有真實 WebRTC first frame 時顯示 deterministic no-GPU，不宣稱 live 3D", "Shows deterministic no-GPU when there is no real WebRTC first frame, without claiming live 3D")} prov="asbuilt" />
        <Field k="Primary / Spectator" v={t("viewer role 與 first frame evidence 由 browser 回報", "viewer role and first frame evidence are reported by the browser")} prov="p1" />
      </Panel>
    </>
  );
}

// A1 §4.2 失敗構件抽屜：把扁平表換成「按規則分組 + 可展開 + 懶載入分頁 + 樓層 + GUID 複製」。
// 失敗計數來自既有 getResults(id,"failed")；展開某規則才懶載入 getFailures（分頁、補 storey）。
const FAILURES_PAGE = 50;

function CopyGuidBtn({ guid }: { guid: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ec-btn"
      style={{ padding: "1px 6px", fontSize: 11 }}
      title={t("複製 ifc_guid", "Copy ifc_guid")}
      onClick={() => {
        // navigator.clipboard 在非安全內容（http LAN）可能不存在 → 誠實降級，不假裝已複製。
        const clip = (navigator as { clipboard?: { writeText: (t: string) => Promise<void> } }).clipboard;
        if (!clip) return;
        void clip.writeText(guid).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? t("已複製", "Copied") : t("複製", "Copy")}
    </button>
  );
}

// export 供單元測試直接掛載驗收「同 tick 雙擊載入更多不得並行 fetch」（去重/鎖 spec §5）；
// 非頁面公開 API，僅 FailureScoreboard 內部使用。
export function FailureRuleRow({ runId, ruleCode, count }: { runId: string; ruleCode: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FailureRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 去重/鎖(spec §5)同步守門：setLoading(true) 在同一 event handler 內非同步可見(須等下一 render)，
  // 同 tick 雙擊「載入更多」時 loading 閉包值未刷新 → 兩個 loadPage(rows.length) 並行各自 append，
  // 產生重複行。loadingRef 為 mutable ref，set/clear 同步生效，能在第二次呼叫頂部立即攔截 in-flight 請求。
  const loadingRef = useRef(false);

  const loadPage = useCallback(async (offset: number) => {
    if (loadingRef.current) return; // 已有 in-flight loadPage → 同步擋掉並行的第二次呼叫(避免重複行)
    loadingRef.current = true;
    setLoading(true); setErr(null);
    try {
      const res = await governanceClient.getFailures(runId, ruleCode, FAILURES_PAGE, offset);
      setTotal(res.total);
      setRows((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
    } catch (e) {
      setErr(String(e));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [runId, ruleCode]);

  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      // 去重/鎖(spec §5):loading 中再次 toggle(快速 close→open)時 rows 仍為 0、total 仍 null,
      // 沒有 !loading 會再觸發一次 loadPage(0),兩個並行 fetch 競速 setRows 造成閃爍/重複更新。
      if (next && rows.length === 0 && total === null && !loading) void loadPage(0);
      return next;
    });
  }, [rows.length, total, loading, loadPage]);

  const canLoadMore = total !== null && rows.length < total;

  return (
    <div className="ec-card" data-testid={`a1-fail-rule-${ruleCode}`} style={{ marginTop: 8 }}>
      <button
        type="button"
        className="ec-btn"
        data-testid={`a1-fail-toggle-${ruleCode}`}
        style={{ width: "100%", justifyContent: "space-between", display: "flex" }}
        onClick={toggle}
      >
        <span><strong>{ruleCode}</strong> · {count} {t("筆失敗", "failures")}</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {err && <p className="ec-warn-note">{t("載入失敗構件失敗：", "Failed to load failed elements: ")}{err}</p>}
          {rows.length > 0 && (
            <table className="ec-table">
              <thead><tr><th>ifc_guid</th><th>ifc_name</th><th>ifc_type</th><th>storey</th><th></th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.ifc_guid ?? "null"}-${i}`}>
                    <td><code>{r.ifc_guid ?? <span className="ec-warn-note">null</span>}</code></td>
                    <td>{r.ifc_name ?? "—"}</td>
                    <td>{r.ifc_type ?? "—"}</td>
                    <td>{r.storey ?? "—"}</td>
                    <td>{r.ifc_guid ? <CopyGuidBtn guid={r.ifc_guid} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {loading && <span className="ec-s">{t("載入中…（GET /api/governance/rule-runs/:id/failures）", "Loading… (GET /api/governance/rule-runs/:id/failures)")}</span>}
          {!loading && canLoadMore && (
            <Btn data-testid={`a1-fail-more-${ruleCode}`} caption={`${t("已載 ", "loaded ")}${rows.length}/${total}`} onClick={() => { void loadPage(rows.length); }}>
              {t("載入更多", "Load more")}
            </Btn>
          )}
        </div>
      )}
    </div>
  );
}

// 把 getResults(id,"failed") 的扁平列依 rule_code 聚合成「規則 → 失敗數」；全過規則不在此列（不可展開）。
function FailureScoreboard({ runId, failed }: { runId: string; failed: RuleResultRow[] }) {
  const counts = new Map<string, number>();
  for (const r of failed) counts.set(r.rule_code, (counts.get(r.rule_code) ?? 0) + 1);
  const rules = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (rules.length === 0) return null;
  return (
    <div data-testid="a1-failures-by-rule" style={{ marginTop: 12 }}>
      <p className="ec-note" style={{ marginBottom: 4 }}>
        {t("失敗規則（點擊展開命中構件，懶載入分頁，補樓層、GUID 可複製）：", "Failed rules (click to expand matched elements; lazy-loaded paging, storey backfill, copyable GUID):")}
      </p>
      {rules.map(([code, count]) => (
        // key 含 runId:重跑同一規則 code 但換 runId 時,React 須建新 instance,
        // 否則沿用舊 instance 的 local state(已載入的 rows/total)會殘留上一輪的 GUID/storey。
        <FailureRuleRow key={`${runId}:${code}`} runId={runId} ruleCode={code} count={count} />
      ))}
    </div>
  );
}

export function IssuesRuleCenterPage() {
  const [ifcPath, setIfcPath] = useState(defaultA1IfcPath);
  const [idsPath, setIdsPath] = useState("");
  const [run, setRun] = useState<RuleRunStatus | null>(null);
  const [failed, setFailed] = useState<RuleResultRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [issues, setIssues] = useState<IssueRow[]>([]);

  // A1 檔案庫選擇器：project → model → version 三層；選定填入 ifcPath（手動輸入保留）。
  const [fsTree, setFsTree] = useState<FileProjectRow[] | null>(null);
  const [fsErr, setFsErr] = useState<string | null>(null);
  const [selProject, setSelProject] = useState("");
  const [selModel, setSelModel] = useState("");
  // 受控 version 選擇（值=version.path）：沒有 state 時 <select value=""> 會把使用者
  // 的選擇立刻打回 placeholder（選了像沒選）。換 project/model 時一併重置。
  const [selVersion, setSelVersion] = useState("");

  // 抽成可重跑的 loader：初載與「重試載入檔案庫」共用（暫時離線不必整頁 reload）。
  const loadFsTree = useCallback(async () => {
    setFsErr(null);
    try {
      const t = await governanceClient.filesTree();
      setFsTree(t.projects);
    } catch (e) {
      setFsErr(String(e));
    }
  }, []);

  useEffect(() => {
    void loadFsTree();
  }, [loadFsTree]);

  // 換 project/model 後，先前由選擇器填入的 ifcPath 已不代表當前選擇 → 清空它
  //（避免使用者沒注意文字框殘留舊選擇就送出檢核）；手動輸入的路徑不受影響
  //（僅當 ifcPath 仍等於上次選擇器填入值才清）。
  const resetVersionPick = useCallback(() => {
    if (selVersion) {
      setIfcPath((cur) => (cur === selVersion ? "" : cur));
    }
    setSelVersion("");
  }, [selVersion]);

  const fsModels = fsTree?.find((p) => p.project_id === selProject)?.models ?? [];
  const fsVersions = fsModels.find((m) => m.model_id === selModel)?.versions ?? [];

  const loadIssues = useCallback(async () => {
    try { setIssues(await governanceClient.listIssues()); } catch { /* 後端離線：誠實留空 */ }
  }, []);
  const makeIssuesFromRun = useCallback(async () => {
    if (!runId) return;
    try { await governanceClient.issuesFromRuleRun(runId); await loadIssues(); } catch (e) { setErr(String(e)); }
  }, [runId, loadIssues]);

  const doRun = useCallback(async () => {
    setBusy(true); setErr(null); setRun(null); setFailed([]);
    try {
      const { rule_run_id } = await governanceClient.createRuleRun({ ifc_source_path: ifcPath, ids_path: idsPath || undefined });
      setRunId(rule_run_id);
      let st: RuleRunStatus | null = null;
      for (let i = 0; i < 60; i++) {
        st = await governanceClient.getRuleRun(rule_run_id);
        if (st.status === "succeeded" || st.status === "failed") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      setRun(st);
      if (st && st.status === "succeeded") setFailed(await governanceClient.getResults(rule_run_id, "failed"));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [ifcPath, idsPath]);

  return (
    <>
      <h1>{t("問題與語意驗收 · Issues & Rule Center（A1）", "Issues & Semantic Validation · Issues & Rule Center (A1)")}</h1>
      <p className="ec-lead">
        {t("A1 治理與模型檢核：對真實 IFC 跑宣告式規則集，產出 governance score 與帶真實 ifc_guid 的失敗構件。規則引擎為純 CPU host-native ifcopenshell；可選用 buildingSMART IDS（ifctester）規則。", "A1 governance & model validation: run a declarative rule set against a real IFC to produce a governance score and failed elements carrying real ifc_guid. The rule engine is pure CPU host-native ifcopenshell; buildingSMART IDS (ifctester) rules are optional.")}
      </p>

      <Panel title="A1 rule-run authority" sub={t("governance-service :49102（經 coordinator proxy）", "governance-service :49102 (via coordinator proxy)")} prov="asbuilt">
        <p className="ec-note">{t("後端已實作並以真實 IFC 驗證（見下方 artifact）。本頁經 coordinator ", "Backend is implemented and verified with a real IFC (see artifact below). This page triggers a live rule-run via the coordinator ")}<code>/api/governance/*</code>{t(" proxy 觸發實時 rule-run。", " proxy.")}</p>
        <div className="ec-grid" style={{ marginBottom: 10 }}>
          <Field k="rule_run_id" v={runId ?? "—"} prov="asbuilt" />
          <Field k="rule_run_status" v={busy ? "running" : run?.status ?? "idle"} prov="asbuilt" />
        </div>
        <div className="ec-field" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, marginBottom: 8 }}>
          <span className="ec-k">{t("從檔案庫選擇", "Select from file library")} <ProvTag prov="asbuilt" /></span>
          {fsErr && (
            <span className="ec-warn-note" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>{t("檔案庫不可用（", "File library not available (")}{fsErr}{t("）；可改用下方手動輸入路徑。", "); you can manually enter a path below instead.")}</span>
              <Btn data-testid="a1-fs-retry" caption="GET /api/governance/files/tree" onClick={() => { void loadFsTree(); }}>
                {t("重試載入檔案庫", "Retry loading file library")}
              </Btn>
            </span>
          )}
          {!fsErr && !fsTree && <span className="ec-s">{t("載入檔案庫中…（GET /api/governance/files/tree）", "Loading file library… (GET /api/governance/files/tree)")}</span>}
          {/* 三層 select 恆渲染（含 SSR 首幀）；未載入前 disabled 且只有 placeholder option —
              誠實標示「還沒有可選項」，手動輸入照常可用，檔案庫不可用時 graceful degrade。 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              data-testid="a1-fs-project"
              className="ec-btn"
              value={selProject}
              disabled={!fsTree}
              onChange={(e) => { setSelProject(e.target.value); setSelModel(""); resetVersionPick(); }}
            >
              <option value="">{t("專案…", "Project…")}</option>
              {(fsTree ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
            </select>
            <select
              data-testid="a1-fs-model"
              className="ec-btn"
              value={selModel}
              disabled={!selProject}
              onChange={(e) => { setSelModel(e.target.value); resetVersionPick(); }}
            >
              <option value="">{t("模型…", "Model…")}</option>
              {fsModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
            </select>
            <select
              data-testid="a1-fs-version"
              className="ec-btn"
              disabled={!selModel}
              value={selVersion}
              onChange={(e) => {
                const picked = e.target.value;
                if (picked) {
                  setSelVersion(picked);
                  setIfcPath(picked);
                } else {
                  // 清回 placeholder 也要清「由選擇器填入的」ifcPath（殘留舊選擇
                  // 會被誤送出檢核）；手動輸入值同樣不受波及。
                  resetVersionPick();
                }
              }}
            >
              <option value="">{t("版本…（選定填入路徑）", "Version… (selecting fills in the path)")}</option>
              {fsVersions.map((v) => <option key={v.name} value={v.path}>{v.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" style={{ minWidth: 420 }} value={ifcPath} onChange={(e) => setIfcPath(e.target.value)} />
          <Btn primary disabled={busy} caption="POST /api/governance/rule-runs" onClick={doRun}>
            {busy ? t("執行中…", "Running…") : t("執行規則檢核", "Run Rule Validation")}
          </Btn>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <input className="ec-btn" style={{ minWidth: 420 }} placeholder={t("（選填）buildingSMART IDS .ids 路徑 — 改用 ifctester 跑", "(optional) buildingSMART IDS .ids path — runs via ifctester instead")} value={idsPath} onChange={(e) => setIdsPath(e.target.value)} />
          <span className="ec-s">{t("填 IDS 則以 IDS 規則跑（否則用內建 YAML 規則集）", "If an IDS is provided, IDS rules are used (otherwise the built-in YAML rule set)")}</span>
        </div>
        {err && <p className="ec-warn-note">{t("未連線後端（proxy / governance-service 需啟動）：", "Backend not connected (proxy / governance-service must be running): ")}{err}</p>}
        {run && (
          <div className="ec-grid" data-testid="a1-rulerun-scoreboard" style={{ marginTop: 12 }}>
            <Metric value={run.summary?.total ?? "—"} label={t("規則評估次數", "Rule Evaluations")} />
            <Metric value={run.summary?.unique_elements ?? "—"} label={t("唯一構件", "Unique Elements")} />
            <Metric value={run.summary?.passed ?? "—"} label="passed" />
            <Metric value={run.summary?.failed ?? "—"} label="failed" tone="warn" />
            <Metric value={run.score ?? "—"} label="score" />
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          {/* [匯出 Excel]：client exportUrl 直連 coordinator proxy → governance-service openpyxl，真實下載（asbuilt）。
              成功 run 前 disabled（沒有 runId 不可匯出）——真實 gating，非假按鈕。 */}
          <Btn prov="asbuilt" caption="GET /api/governance/rule-runs/:id/export?fmt=excel" disabled={!runId || run?.status !== "succeeded"} onClick={async () => {
            if (!runId) return;
            setErr(null);
            try {
              const res = await fetch(governanceClient.exportUrl(runId));
              if (!res.ok) { setErr(`${t("Excel 匯出 ", "Excel export ")}${res.status}：${res.statusText}`); return; }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `rule-run-${runId}.xlsx`;
              // 錨點須掛載於 document 才觸發下載：Gecko / 部分 Edge 對 detached <a> 下載不可靠（靜默失敗）。
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              // 延後釋放 object URL：同步 revoke 會在瀏覽器開始讀取 blob 前就釋放，導致（尤其較大檔）下載被中止（CodeRabbit）。
              setTimeout(() => URL.revokeObjectURL(url), 0);
            } catch (e) { setErr(String(e)); }
          }}>{t("匯出 Excel", "Export Excel")}</Btn>
          {/* [在 3D 中標示]：console 為 /console 獨立殼層，與 viewer <App/> 互斥掛載，無 WebRTC
              DataChannel；highlightPrimsRequest 需 viewer DataChannel（Window 內），此鏈未接 →
              誠實標 p1（後續整合），永遠 disabled，不做點了沒反應的假按鈕。 */}
          <Btn prov="p1" disabled caption={t("需 viewer DataChannel（highlightPrimsRequest）— 後續整合", "Requires the viewer DataChannel (highlightPrimsRequest) — later integration")}>{t("在 3D 中標示", "Highlight in 3D")}</Btn>
        </div>
        {/* A1 §4.2 失敗構件抽屜：取代舊扁平表（failed.slice(0,30)）。按規則分組、可展開、
            懶載入分頁 getFailures、補樓層、GUID 一鍵複製；全過規則不在此列。 */}
        {runId && failed.length > 0 && <FailureScoreboard runId={runId} failed={failed} />}
        <p className="ec-note" style={{ marginTop: 8 }}>
          {t("[匯出 Excel] 為真實下載（openpyxl，asbuilt）。[在 3D 中標示] 需 viewer 的 WebRTC DataChannel（", "[Export Excel] is a real download (openpyxl, asbuilt). [Highlight in 3D] requires the viewer's WebRTC DataChannel (")}<code>highlightPrimsRequest</code>{t("）；Edge Console 為 ", "); the Edge Console is the ")}<code>/console</code>{t(" 獨立殼層，與 viewer 互斥掛載、目前無 DataChannel，故誠實標 ", " standalone shell, mutually exclusive with the viewer and currently without a DataChannel, so it is honestly marked ")}<code>p1</code>{t("（後續整合），未對映 ", " (later integration); elements not mapped to ")}<code>usd_prim_path=null</code>{t(" 本就無法標示。", " cannot be highlighted anyway.")}
        </p>
      </Panel>

      <Panel title={t("語意驗收訊號 · 真實 IFC 實測", "Semantic validation signal · measured on a real IFC")} sub={`${A1_EVIDENCE.file} · ${A1_EVIDENCE.schema} · ${A1_EVIDENCE.date}`} prov="artifact">
        <div className="ec-grid">
          <Metric value={A1_EVIDENCE.total} label={t("規則評估次數", "Rule Evaluations")} />
          <Metric value={A1_EVIDENCE.uniqueElements} label={t("唯一構件", "Unique Elements")} />
          <Metric value={A1_EVIDENCE.passed} label="passed" />
          <Metric value={A1_EVIDENCE.failed} label="failed" tone="warn" />
          <Metric value={A1_EVIDENCE.score} label="score" />
        </div>
        <p className="ec-note">{t("實測值來自 commit 進 repo 的 evidence（CPU ~6s，無 GPU）；非示範、非捏造。", "Measured values come from evidence committed into the repo (CPU ~6s, no GPU); not a demo, not fabricated.")}</p>
      </Panel>

      <Panel title={t("規則集 · rule set", "Rule set · rule set")} prov="asbuilt">
        <Field k="DOOR-FIRERATING-REQUIRED" v="IfcDoor · Pset_DoorCommon.FireRating" prov="asbuilt" />
        <Field k="ELEMENT-NAME-REQUIRED" v="IfcBuildingElement/IfcBuiltElement · Name" prov="asbuilt" />
        <Field k="WALL-STOREY-ASSIGNED" v={t("IfcWall · 空間指派", "IfcWall · spatial assignment")} prov="asbuilt" />
        <Field k={t("IDS-XML 匯入（buildingSMART IDS）", "IDS-XML import (buildingSMART IDS)")} v={t("已實作（ifctester 0.8.5；填 IDS 路徑即用 IDS 規則跑）", "Implemented (ifctester 0.8.5; provide an IDS path to run with IDS rules)")} prov="asbuilt" />
        <Field k={t("Excel 匯出", "Excel export")} v="openpyxl" prov="asbuilt" />
        <Field k={t("BCF 匯出（issue→.bcfzip）", "BCF export (issue→.bcfzip)")} v={t("已實作（純 stdlib zipfile/ElementTree，不依賴 GPLv3）", "Implemented (pure stdlib zipfile/ElementTree, no GPLv3 dependency)")} prov="asbuilt" />
        <Field k={t("Issue 生命週期資料庫", "Issue lifecycle database")} v="open→assigned→resolved/rejected→reopened + audit" prov="asbuilt" />
      </Panel>

      <Panel
        title="Issue Center"
        sub={t("rule-run 失敗構件 → issue（綁 ifc_guid，BCF rule 3/10：無 guid 僅視覺標註）", "rule-run failed elements → issue (bound to ifc_guid; BCF rule 3/10: without a guid, only a visual annotation)")}
        prov="asbuilt"
        actions={<Btn caption="POST from-rule-run" disabled={!runId} onClick={makeIssuesFromRun}>{t("失敗構件建 issue", "Create issues for failed elements")}</Btn>}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn caption="GET /api/governance/issues" onClick={loadIssues}>{t("載入 issues", "Load issues")}</Btn>
          <Btn caption={t("GET /api/governance/bcf/export（只含正式 issue）", "GET /api/governance/bcf/export (formal issues only)")} onClick={async () => {
            setErr(null);
            try {
              const res = await fetch(governanceClient.bcfExportUrl());
              if (!res.ok) { setErr(`${t("BCF 匯出 ", "BCF export ")}${res.status}${t("：需至少一個正式 issue（kind=issue 且有 ifc_guid）", ": at least one formal issue is required (kind=issue with ifc_guid)")}`); return; }
              const blob = await res.blob();
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "governance-issues.bcfzip";
              // 錨點須掛載於 document 才觸發下載：Gecko / 部分 Edge 對 detached <a> 下載不可靠（靜默失敗）。
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              // 延後釋放 object URL:同步 revoke 會在瀏覽器開始讀取 blob 前就釋放,導致大 bcfzip 在慢機/Firefox 下載被中止(對齊 Excel/doExport 的延後模式)。
              setTimeout(() => URL.revokeObjectURL(a.href), 0);
            } catch (e) { setErr(String(e)); }
          }}>{t("匯出 BCF 2.1", "Export BCF 2.1")}</Btn>
        </div>
        {issues.length > 0 && (
          <table className="ec-table" style={{ marginTop: 10 }}>
            <thead><tr><th>kind</th><th>severity</th><th>status</th><th>ifc_guid</th><th>title</th><th /></tr></thead>
            <tbody>
              {issues.slice(0, 30).map((it) => (
                <tr key={it.id}>
                  <td>{it.kind}</td><td>{it.severity}</td><td>{it.status}</td><td>{it.ifc_guid}</td><td>{it.title}</td>
                  <td>{it.status !== "resolved" && it.status !== "rejected" && (
                    <Btn caption="transition" onClick={async () => { await governanceClient.transitionIssue(it.id, "resolved"); loadIssues(); }}>resolve</Btn>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

export function AppsPage({ onOpen }: { onOpen: (route: string) => void }) {
  const focus = A1A10.filter((a) => a.tier === "focus");
  const roadmap = A1A10.filter((a) => a.tier === "roadmap");
  const Card = (a: AppCardDef) => (
    <div
      key={a.code}
      className={`ec-appcard ${a.tier === "roadmap" ? "roadmap" : ""} ${a.route ? "clickable" : "disabled"}`}
      onClick={() => a.route && onOpen(a.route)}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span className="ec-code">{a.code}</span>
        <ProvTag prov={a.prov} />
      </div>
      <div>{a.title}</div>
      <div className="ec-s">{a.en} · {a.dep} · Phase {a.phase}</div>
    </div>
  );
  return (
    <>
      <h1>{t("應用導引 · Applications A1–A10", "Application guide · Applications A1–A10")}</h1>
      <p className="ec-lead">
        {t("十個應用模組入口。近期重點 A1–A3 為聚焦項（後端已實作、可真實驗證）；A4–A10 為 ROADMAP，標真實 Phase，點卡片開「願景詳頁」（schema/api/ui/mvp/risks），**後端未建、整段標願景**。", "Entry points to ten application modules. Near-term focus A1–A3 are focus items (backend implemented and really verifiable); A4–A10 are ROADMAP, marked with their real Phase; click a card to open the \"vision detail page\" (schema/api/ui/mvp/risks) — **backend not built, the whole section is marked vision**.")}
      </p>
      <Panel title={t("近期重點 · Focus", "Near-term focus · Focus")} sub={t("A1–A3（後端已實作）", "A1–A3 (backend implemented)")}>
        <div className="ec-grid">{focus.map(Card)}</div>
      </Panel>
      <Panel title={t("後期願景 · Roadmap", "Later vision · Roadmap")} sub={t("A4–A10 · Phase 3–4（後端未建，點卡看願景詳頁）", "A4–A10 · Phase 3–4 (backend not built; click a card to see the vision detail page)")}>
        <div className="ec-grid">{roadmap.map(Card)}</div>
      </Panel>
    </>
  );
}

// ── P3-1 A4–A10 vision 詳頁（泛用，吃 A1A10_DETAIL）──
// 誠實鐵律：整頁標願景（p3/p4）；明確標「後端未建」；scenario 為範例情境（願景敘事），
// api 為願景 API 設計（非已實作 route）。禁當真實實測 / 禁捏造數字。
export function AppVisionPage({ slug, onOpen }: { slug: string; onOpen: (route: string) => void }) {
  const d: AppVisionDetail | undefined = A1A10_DETAIL[slug];
  if (!d) {
    return (
      <>
        <h1>{t("未知應用", "Unknown application")}</h1>
        <p className="ec-lead">{t("找不到 slug=", "Could not find the vision detail page for slug=")}<code>{slug}</code>{t(" 的願景詳頁。", ".")}</p>
        <Btn caption={t("回 Applications", "Back to Applications")} onClick={() => onOpen("apps")}>{t("← 回應用導引", "← Back to application guide")}</Btn>
      </>
    );
  }
  return (
    <>
      <h1>{d.code} · {d.title}<span style={{ marginLeft: 10 }}><ProvTag prov={d.prov} /></span></h1>
      <p className="ec-lead">{d.en} · Phase {d.phase} · {d.pitch}</p>
      <Btn caption={t("回 Applications", "Back to Applications")} onClick={() => onOpen("apps")}>{t("← 回應用導引", "← Back to application guide")}</Btn>

      <Panel title={t("目標 · Goal", "Goal · Goal")} sub={t("此應用後端未建；以下為願景規格（roadmap）", "This application's backend is not built; the following is a vision spec (roadmap)")} prov={d.prov}>
        <p className="ec-note" style={{ color: "var(--ec-fg-2)" }}>{d.goal}</p>
        <p className="ec-warn-note">{t("後端未建（vision）：本頁所有 schema / api / 數字皆為願景設計，非本系統真實實測。", "Backend not built (vision): all schema / api / numbers on this page are vision designs, not real measurements of this system.")}</p>
      </Panel>

      <Panel title={t("範例情境 · Example scenario", "Example scenario · Example scenario")} sub={t("願景敘事（非真實 run），具體數字為原型情境", "Vision narrative (not a real run); concrete numbers are prototype scenarios")} prov={d.prov}>
        <Field k={t("情境", "Scenario")} v={d.scenarioHead} prov={d.prov} />
        <Field k={t("範例輸出", "Example output")} v={d.scenarioResult} prov={d.prov} />
      </Panel>

      <Panel title={t("DB schema（願景設計）", "DB schema (vision design)")} prov={d.prov}>
        {d.schema.map((s) => <Field key={s.t} k={s.t} v={s.f} prov={d.prov} />)}
      </Panel>

      <Panel title={t("REST API（願景設計，非已實作 route）", "REST API (vision design, not implemented routes)")} prov={d.prov}>
        <div>
          {d.api.map((a) => (
            <div className="ec-ep" key={a.u}>
              <span className={`ec-ep-m ec-ep-${a.m.toLowerCase()}`}>{a.m}</span>
              <span className="ec-ep-p">{a.u}</span>
              <span className="ec-ep-note">· {a.d}</span>
            </div>
          ))}
        </div>
        <p className="ec-warn-note">{t("以上為 roadmap 願景 API 設計；後端尚未實作這些 route（不可當真實端點呼叫）。", "The above is a roadmap vision API design; the backend has not implemented these routes (do not call them as real endpoints).")}</p>
      </Panel>

      <Panel title={t("UI 面板（願景）", "UI panels (vision)")} prov={d.prov}>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ec-fg-2)" }}>{d.ui.map((x) => <li key={x}>{x}</li>)}</ul>
      </Panel>

      <Panel title={t("MVP 驗收條件（願景）", "MVP acceptance criteria (vision)")} prov={d.prov}>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ec-fg-2)" }}>{d.mvp.map((x) => <li key={x}>{x}</li>)}</ul>
      </Panel>

      <Panel title={t("Sprint steps（願景）", "Sprint steps (vision)")} prov={d.prov}>
        {d.steps.map((s) => <Field key={s.sp} k={`${s.sp} · ${s.t}`} v={s.d} prov={d.prov} />)}
      </Panel>

      <Panel title={t("風險 · Risks（願景）", "Risks · Risks (vision)")} prov={d.prov}>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ec-amb)" }}>{d.risks.map((x) => <li key={x}>{x}</li>)}</ul>
      </Panel>
    </>
  );
}

export function VersionDiffPage() {
  const [base, setBase] = useState("C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\許良宇圖書館建築_2026.ifc");
  const [target, setTarget] = useState("C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\許良宇圖書館建築_2026 - 轉檔測試2.ifc");
  const [diff, setDiff] = useState<DiffStatus | null>(null);
  const [diffId, setDiffId] = useState<string | null>(null);
  const [items, setItems] = useState<DiffItemRow[]>([]);
  const [impact, setImpact] = useState<DiffIssueImpact | null>(null);
  const [includeGeo, setIncludeGeo] = useState(false);
  const [overlay, setOverlay] = useState<DiffOverlayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A2 檔案庫選擇器（複用 A1 IssuesRuleCenterPage 模式）：base / target 各一組
  // project→model→version 三層；選定填入對應路徑 input + 帶出 model_version_id。
  const [fsTree, setFsTree] = useState<FileProjectRow[] | null>(null);
  const [fsErr, setFsErr] = useState<string | null>(null);
  // model_version_id = "{project_id}/{model_id}/{version.name}"（供 /issue-impact 版本綁定）；
  // 手動覆寫路徑 input 後清空（誠實：手填路徑無版本綁定語意）。
  const [baseVerId, setBaseVerId] = useState("");
  const [targetVerId, setTargetVerId] = useState("");
  // 受控版本選擇（值 = version.path）；base / target 各一套 project/model/version 與「選擇器填入值」追蹤。
  const [baseSel, setBaseSel] = useState({ project: "", model: "", version: "" });
  const [targetSel, setTargetSel] = useState({ project: "", model: "", version: "" });

  const loadFsTree = useCallback(async () => {
    setFsErr(null);
    try {
      const t = await governanceClient.filesTree();
      setFsTree(t.projects);
    } catch (e) {
      setFsErr(String(e));
    }
  }, []);
  useEffect(() => { void loadFsTree(); }, [loadFsTree]);

  // pickBaseVersion：選定一個版本 → 填 base input 路徑 + 記 model_version_id + setSel 全套。
  // 僅由 base-version select onChange（且確有對應版本）呼叫；「清空 / 換層」走 clearBaseSelection。
  const pickBaseVersion = useCallback((projectId: string, modelId: string, ver: FileVersionRow) => {
    setBase(ver.path);
    setBaseVerId(`${projectId}/${modelId}/${ver.name}`);
    setBaseSel({ project: projectId, model: modelId, version: ver.path });
  }, []);
  // clearBaseSelection：換 base project / model（或選回版本 placeholder）的單一清空入口。
  // 完整重設 selector state（project/model 由呼叫者指定、version 一律清）；只在「目前 base 路徑
  // 正是先前由 selector 填入的版本路徑」時才清路徑——手動輸入的路徑不被波及。model_version_id
  // 一律清（換層後版本綁定語意消失；手動路徑早已無 verId，再清無害）。
  // 三個 setter 各自獨立呼叫（React 18 自動 batch），不在 updater 內互相觸發 setState
  // （updater 須維持純函數契約）；以 render 快照 baseSel.version 判斷路徑是否為 selector 填入值。
  const clearBaseSelection = useCallback((projectId: string, modelId: string) => {
    const filledPath = baseSel.version;
    setBase((cur) => (cur === filledPath ? "" : cur));
    setBaseSel({ project: projectId, model: modelId, version: "" });
    setBaseVerId("");
  }, [baseSel.version]);
  // pickTargetVersion / clearTargetSelection：target 側對稱（同上語意，獨立追蹤值）。
  const pickTargetVersion = useCallback((projectId: string, modelId: string, ver: FileVersionRow) => {
    setTarget(ver.path);
    setTargetVerId(`${projectId}/${modelId}/${ver.name}`);
    setTargetSel({ project: projectId, model: modelId, version: ver.path });
  }, []);
  const clearTargetSelection = useCallback((projectId: string, modelId: string) => {
    const filledPath = targetSel.version;
    setTarget((cur) => (cur === filledPath ? "" : cur));
    setTargetSel({ project: projectId, model: modelId, version: "" });
    setTargetVerId("");
  }, [targetSel.version]);
  const baseModels = fsTree?.find((p) => p.project_id === baseSel.project)?.models ?? [];
  const baseVersions = baseModels.find((m) => m.model_id === baseSel.model)?.versions ?? [];
  const targetModels = fsTree?.find((p) => p.project_id === targetSel.project)?.models ?? [];
  const targetVersions = targetModels.find((m) => m.model_id === targetSel.model)?.versions ?? [];

  const run = useCallback(async () => {
    setBusy(true); setErr(null); setDiff(null); setItems([]); setImpact(null); setOverlay(null);
    try {
      const { diff_id } = await governanceClient.createDiff({
        base_ifc_path: base,
        target_ifc_path: target,
        base_model_version_id: baseVerId || undefined,
        target_model_version_id: targetVerId || undefined,
        include_geometry: includeGeo,
      });
      setDiffId(diff_id);
      let st: DiffStatus | null = null;
      for (let i = 0; i < 120; i++) {
        st = await governanceClient.getDiff(diff_id);
        if (st.status === "succeeded" || st.status === "failed") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      setDiff(st);
      if (st && st.status === "succeeded") {
        setItems(await governanceClient.getDiffItems(diff_id));
        try { setImpact(await governanceClient.diffIssueImpact(diff_id)); } catch { /* issue-impact 選配 */ }
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [base, target, includeGeo, baseVerId, targetVerId]);

  const counts = diff?.summary?.counts ?? {};
  return (
    <>
      <h1>{t("模型版本差異與責任追蹤 · A2", "Model version diff and responsibility tracking · A2")}</h1>
      <p className="ec-lead">
        {t("以 IFC GlobalId 多級對齊（GlobalId → Tag → type+name+location）比對兩個 model version，標記 added / removed / moved / property changed；差異計算在 CPU 完成。", "Aligns two model versions with multi-level IFC GlobalId matching (GlobalId → Tag → type+name+location), marking added / removed / moved / property changed; the diff is computed on the CPU.")}
      </p>
      <Panel title="Diff Builder" sub={t("POST /api/governance/diffs（經 coordinator proxy → governance-service）", "POST /api/governance/diffs (via coordinator proxy → governance-service)")} prov="asbuilt">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {fsErr && (
            <span className="ec-warn-note" data-testid="a2-fs-error" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>{t("檔案庫不可用", "File library unavailable")}（{fsErr}）；{t("可改用下方手動輸入路徑。", "you can manually enter a path below instead.")}</span>
              <Btn data-testid="a2-fs-retry" caption="GET /api/governance/files/tree" onClick={() => { void loadFsTree(); }}>{t("重試載入檔案庫", "Retry loading file library")}</Btn>
            </span>
          )}
          {!fsErr && !fsTree && <span className="ec-s">{t("載入檔案庫中…（GET /api/governance/files/tree）", "Loading file library… (GET /api/governance/files/tree)")}</span>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="ec-k" style={{ minWidth: 48 }}>base</span>
            <select data-testid="a2-base-project" className="ec-btn" value={baseSel.project} disabled={!fsTree}
              onChange={(e) => clearBaseSelection(e.target.value, "")}>
              <option value="">{t("專案…", "Project…")}</option>
              {(fsTree ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
            </select>
            <select data-testid="a2-base-model" className="ec-btn" value={baseSel.model} disabled={!baseSel.project}
              onChange={(e) => clearBaseSelection(baseSel.project, e.target.value)}>
              <option value="">{t("模型…", "Model…")}</option>
              {baseModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
            </select>
            <select data-testid="a2-base-version" className="ec-btn" value={baseSel.version} disabled={!baseSel.model}
              onChange={(e) => { const v = baseVersions.find((x) => x.path === e.target.value); if (v) pickBaseVersion(baseSel.project, baseSel.model, v); else clearBaseSelection(baseSel.project, baseSel.model); }}>
              <option value="">{t("版本…（選定填入路徑）", "Version… (selecting fills the path)")}</option>
              {baseVersions.map((v) => <option key={v.name} value={v.path}>{v.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="ec-k" style={{ minWidth: 48 }}>target</span>
            <select data-testid="a2-target-project" className="ec-btn" value={targetSel.project} disabled={!fsTree}
              onChange={(e) => clearTargetSelection(e.target.value, "")}>
              <option value="">{t("專案…", "Project…")}</option>
              {(fsTree ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
            </select>
            <select data-testid="a2-target-model" className="ec-btn" value={targetSel.model} disabled={!targetSel.project}
              onChange={(e) => clearTargetSelection(targetSel.project, e.target.value)}>
              <option value="">{t("模型…", "Model…")}</option>
              {targetModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
            </select>
            <select data-testid="a2-target-version" className="ec-btn" value={targetSel.version} disabled={!targetSel.model}
              onChange={(e) => { const v = targetVersions.find((x) => x.path === e.target.value); if (v) pickTargetVersion(targetSel.project, targetSel.model, v); else clearTargetSelection(targetSel.project, targetSel.model); }}>
              <option value="">{t("版本…（選定填入路徑）", "Version… (selecting fills the path)")}</option>
              {targetVersions.map((v) => <option key={v.name} value={v.path}>{v.name}</option>)}
            </select>
          </div>
          <input data-testid="a2-base-input" className="ec-btn" style={{ width: "100%" }} value={base} onChange={(e) => { setBase(e.target.value); setBaseVerId(""); setBaseSel((s) => ({ ...s, version: "" })); }} />
          <input data-testid="a2-target-input" className="ec-btn" style={{ width: "100%" }} value={target} onChange={(e) => { setTarget(e.target.value); setTargetVerId(""); setTargetSel((s) => ({ ...s, version: "" })); }} />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Btn primary disabled={busy} caption={t("GlobalId 多級對齊", "GlobalId multi-level matching")} onClick={run}>{busy ? t("比對中…", "Comparing…") : "Run Diff"}</Btn>
            <label className="ec-s" style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={includeGeo} onChange={(e) => setIncludeGeo(e.target.checked)} /> {t("含幾何比對（tessellation，較重）", "Include geometry comparison (tessellation, heavier)")}
            </label>
          </div>
        </div>
        {err && <p className="ec-warn-note">{t("未連線後端（proxy / governance-service 需啟動）", "Backend not connected (proxy / governance-service must be running)")}：{err}</p>}
        {diff && (
          <div className="ec-grid" style={{ marginTop: 12 }}>
            <Metric value={diff.summary?.matched ?? "—"} label="matched" />
            <Metric value={counts.added ?? 0} label="added" />
            <Metric value={counts.removed ?? 0} label="removed" tone="bad" />
            <Metric value={counts.moved ?? 0} label="moved" tone="warn" />
            <Metric value={counts.property_changed ?? 0} label="property changed" tone="warn" />
            <Metric value={counts.geometry_changed ?? 0} label="geometry changed" tone="warn" />
          </div>
        )}
        {items.length > 0 && (() => {
          // A2-W1：三色碼 map（集中單一定義，色盲可及 — 色點旁保留文字）
          const CHANGE_TONE: Record<string, string> = {
            added: "ec-diff-add",
            removed: "ec-diff-del",
            moved: "ec-diff-mod",
            property_changed: "ec-diff-mod",
            geometry_changed: "ec-diff-mod",
          };
          const shown = items.slice(0, 40);
          return (
            <>
              {items.length > 40 && (
                <p className="ec-s" style={{ marginTop: 8, color: "var(--ec-fg-3)" }}>
                  {t("顯示前 40 筆，共", "Showing first 40 of")} {items.length} {t("筆", "rows")}
                </p>
              )}
              <table className="ec-table" style={{ marginTop: 8 }}>
                <thead><tr><th>change</th><th>ifc_type</th><th>ifc_guid</th><th>summary</th></tr></thead>
                <tbody>
                  {shown.map((it, i) => (
                    <tr key={i} className={CHANGE_TONE[it.change_type] ?? ""}>
                      <td>{it.change_type}</td><td>{it.ifc_type ?? "—"}</td><td>{it.ifc_guid}</td><td>{it.change_summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          );
        })()}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <Btn caption={t("POST from-diff（綁 ifc_guid）", "POST from-diff (bound to ifc_guid)")} disabled={!diffId || items.length === 0} onClick={async () => { if (!diffId) return; try { await governanceClient.issuesFromDiff(diffId); } catch (e) { setErr(String(e)); } }}>{t("變更構件建 issue", "Create issue from changed elements")}</Btn>
          {/* [套用 3D Overlay]：呼叫真實端點 POST …/apply-overlay。後端誠實回 501（p15）——
              3D 著色走 client highlightPrimsRequest（需 viewer DataChannel），非後端 server-push。
              此處顯示後端誠實訊息（含 501），SHALL NOT 假裝成功。
              真實 gating：須 diff 真的成功（status==="succeeded"）才 enable；失敗 / 無結果保持 disabled，
              不做點了無意義的假按鈕。applyDiffOverlay 對 HTTP 錯誤回 {ok,status,detail}，但 coordinator
              不可達時 fetch 會 reject → 此處 catch 後設 err（誠實顯示無法連線），不靜默無反應。 */}
          <Btn prov="p15" disabled={busy || diff?.status !== "succeeded"} caption={t("POST /api/governance/diffs/:id/apply-overlay（後端誠實回 501）", "POST /api/governance/diffs/:id/apply-overlay (backend honestly returns 501)")} onClick={async () => {
            if (!diffId) return;
            setBusy(true); setErr(null);
            try { setOverlay(await governanceClient.applyDiffOverlay(diffId)); }
            catch (e) { setOverlay(null); setErr(`${t("無法套用 3D Overlay（無法連線 coordinator / 套用失敗）", "Cannot apply 3D Overlay (cannot reach coordinator / apply failed)")}：${String(e)}`); }
            finally { setBusy(false); }
          }}>{t("套用 3D Overlay", "Apply 3D Overlay")}</Btn>
        </div>
        {overlay && (
          <p className={overlay.ok ? "ec-note" : "ec-warn-note"} style={{ marginTop: 8 }}>
            apply-overlay → {overlay.status}：{overlay.detail}
            {!overlay.ok && overlay.status === 501 && t("（p15：3D 著色走 client highlightPrimsRequest，需 viewer DataChannel；後端不做 server-push）", "(p15: 3D coloring uses client highlightPrimsRequest, requiring a viewer DataChannel; the backend does not server-push)")}
          </p>
        )}
        {impact && (
          <div className="ec-grid" style={{ marginTop: 12 }}>
            <Metric value={impact.possibly_addressed.count} label="issue possibly addressed" />
            <Metric value={impact.still_open.count} label="issue still open" tone="warn" />
            <Metric value={impact.new.count} label="new changes (no issue)" />
          </div>
        )}
        {impact && <p className="ec-note">{impact.note}</p>}
      </Panel>
      <Panel title={t("範圍與誠實標示", "Scope and honest labeling")} prov="asbuilt">
        <Field k="geometry_changed" v={t("opt-in 已實作（include_geometry：ifcopenshell.geom bbox/vertex/volume hash，較重）", "opt-in implemented (include_geometry: ifcopenshell.geom bbox/vertex/volume hash, heavier)")} prov="asbuilt" />
        <Field k={t("3D overlay 顏色（綠/紅/橘/藍）", "3D overlay colors (green/red/orange/blue)")} v={t("apply-overlay 端點誠實回 501；著色走 client highlightPrimsRequest（需 viewer DataChannel），非 server-push", "the apply-overlay endpoint honestly returns 501; coloring uses client highlightPrimsRequest (requires a viewer DataChannel), not server-push")} prov="p15" />
        <Field k="Issue impact" v={t("已實作（possibly_addressed 啟發式 / still_open / new，連動 Issue DB）", "implemented (possibly_addressed heuristic / still_open / new, linked to the Issue DB)")} prov="asbuilt" />
      </Panel>
    </>
  );
}

export function FederationPage() {
  const [members, setMembers] = useState([
    { discipline: "ARC", usd_path: "", layer_order: 1, model_version_id: "arc_v1", tx: 0, ty: 0, tz: 0, visible: true },
    { discipline: "STR", usd_path: "", layer_order: 2, model_version_id: "str_v1", tx: 0, ty: 0, tz: 0, visible: true },
  ]);
  const [setId, setSetId] = useState<string | null>(null);
  const [coord, setCoord] = useState<CoordReport | null>(null);
  const [build, setBuild] = useState<FederatedBuildResult | null>(null);
  const [room, setRoom] = useState<ReviewRoomDescriptor | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false); // 成員在 prepare 後被改動 → 已建 set 失效，須重新準備

  // prepare 會把每個 member 的 visibility_default / transform_json 烘進後端 set；之後任一欄位（含 visible）
  // 變動，build 仍會沿用烘進去的舊值 → UI 勾選與實際 build 結果分歧。誠實作法：作廢 set_id（Build 自動 disable）
  // 並標記 dirty，提示須重新「準備 + 驗證坐標系」，不捏造「改了就立即生效」的假象。
  const setMember = (i: number, k: string, v: string | number | boolean) => {
    setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
    if (setId) { setSetId(null); setCoord(null); setBuild(null); setRoom(null); setDirty(true); }
  };

  const prepare = useCallback(async () => {
    setBusy(true); setErr(null); setCoord(null); setBuild(null); setRoom(null); setDirty(false);
    try {
      const { set_id } = await governanceClient.createFederatedSet("coord-meeting");
      for (const m of members) {
        const t = [Number(m.tx) || 0, Number(m.ty) || 0, Number(m.tz) || 0];
        await governanceClient.addFederatedMember(set_id, {
          model_version_id: m.model_version_id, discipline: m.discipline, usd_path: m.usd_path,
          layer_order: m.layer_order, root_prim: `/World/${m.discipline}`,
          visibility_default: m.visible,
          transform_json: (t[0] || t[1] || t[2]) ? JSON.stringify({ translate: t }) : undefined,
        });
      }
      setSetId(set_id);
      setCoord(await governanceClient.validateCoords(set_id));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [members]);

  const doBuild = useCallback(async () => {
    if (!setId) return;
    setBusy(true); setErr(null); setRoom(null);
    try {
      setBuild(await governanceClient.buildFederatedSet(setId));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [setId]);

  const openRoom = useCallback(async () => {
    if (!setId) return;
    setBusy(true); setErr(null);
    try {
      setRoom(await governanceClient.reviewRoom(setId));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [setId]);

  return (
    <>
      <h1>{t("跨專業模型 Federation · A3", "Cross-discipline model federation · A3")}</h1>
      <p className="ec-lead">
        {t("用 OpenUSD sublayer 把多個 discipline 模型疊在同一 stage，不破壞原始 model.usdc。純 CPU pxr authoring（USD 26.5），對齊 NVIDIA Kit USD 指南。", "Stacks multiple discipline models onto one stage with OpenUSD sublayers, without modifying the original model.usdc. Pure CPU pxr authoring (USD 26.5), aligned with the NVIDIA Kit USD guide.")}
      </p>
      <Panel title="Federation Builder" sub={t("POST /api/governance/federated-sets（經 coordinator proxy → governance-service）", "POST /api/governance/federated-sets (via coordinator proxy → governance-service)")} prov="asbuilt">
        {members.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}>
            <input className="ec-btn" style={{ width: 80 }} value={m.discipline} onChange={(e) => setMember(i, "discipline", e.target.value)} />
            <input className="ec-btn" style={{ flex: 1 }} placeholder={t("member .usd / .usdc 路徑（conversion 產出）", "member .usd / .usdc path (conversion output)")} value={m.usd_path} onChange={(e) => setMember(i, "usd_path", e.target.value)} />
            <input className="ec-btn" style={{ width: 52 }} type="number" title={t("layer_order（小=強）", "layer_order (smaller = stronger)")} value={m.layer_order} onChange={(e) => setMember(i, "layer_order", Number(e.target.value))} />
            {/* visibility：唯一真實後端能力是 build 時的 visibility_default（隱藏 member 寫成 invisible token）。
                無「不重建即時切換」端點 → 誠實作法：勾選後須重新 Build 才生效（見下方標示），不捏造即時能力。 */}
            <label className="ec-s" title={t("visible（build 時帶入 visibility_default；改動需重新 Build）", "visible (build applies visibility_default; changes require a rebuild)")} style={{ display: "flex", gap: 3, alignItems: "center" }}>
              <input type="checkbox" checked={m.visible} onChange={(e) => setMember(i, "visible", e.target.checked)} /> visible
            </label>
            <span className="ec-note" style={{ opacity: 0.7 }}>{t("位移", "Offset")}</span>
            <input className="ec-btn" style={{ width: 46 }} type="number" title={t("位移 X", "Offset X")} value={m.tx} onChange={(e) => setMember(i, "tx", Number(e.target.value))} />
            <input className="ec-btn" style={{ width: 46 }} type="number" title={t("位移 Y", "Offset Y")} value={m.ty} onChange={(e) => setMember(i, "ty", Number(e.target.value))} />
            <input className="ec-btn" style={{ width: 46 }} type="number" title={t("位移 Z", "Offset Z")} value={m.tz} onChange={(e) => setMember(i, "tz", Number(e.target.value))} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Btn disabled={busy} caption="create set + members + validate-coords" onClick={prepare}>{t("準備 + 驗證坐標系", "Prepare + validate coordinate system")}</Btn>
          <Btn primary disabled={busy || !setId} caption="POST …/build → federated_review.usda" onClick={doBuild}>Build Federated USD</Btn>
        </div>
        {dirty && !setId && (
          <p className="ec-warn-note" style={{ marginTop: 6 }}>
            {t("成員設定已變更，先前的「準備 + 驗證坐標系」結果已作廢；請重新準備後再 Build（避免畫面勾選與實際 build 結果不一致）。", "Member settings changed, so the previous \"Prepare + validate coordinate system\" result is voided; prepare again before Build (to avoid the on-screen selections diverging from the actual build result).")}
          </p>
        )}
        {err && <p className="ec-warn-note">{t("未連線後端 / member USD 不存在", "Backend not connected / member USD does not exist")}：{err}</p>}
        {coord && <Field k={t("共享坐標系驗證", "Shared coordinate system validation")} v={coord.consistent ? t("一致 ✓", "consistent ✓") : `${t("不一致", "inconsistent")}：${coord.issues.join("; ")}`} prov="asbuilt" />}
        {build && (
          <div style={{ marginTop: 8 }}>
            <Field k="federated_review.usda" v={build.usda_path} prov="asbuilt" />
            <Field k={t("subLayer order（強→弱）", "subLayer order (strong→weak)")} v={build.sublayer_order.join("  →  ")} prov="asbuilt" />
            <Field k={t("member 數", "member count")} v={build.member_count} prov="asbuilt" />
            <Field
              k={t("hidden members（visibility=false）", "hidden members (visibility=false)")}
              v={build.hidden.length > 0 ? build.hidden.join("  ·  ") : t("（無，全部 visible）", "(none, all visible)")}
              prov="asbuilt"
            />
            {build.transformed && build.transformed.length > 0 && (
              <Field k="per-member transform" v={build.transformed.map((t) => `${t.root_prim}:[${t.ops.join("+")}]`).join("   ")} prov="asbuilt" />
            )}
            <div style={{ marginTop: 6 }}>
              <Btn caption={t("GET …/review-room（stage_composition handoff）", "GET …/review-room (stage_composition handoff)")} onClick={openRoom}>Open in Review Room</Btn>
            </div>
          </div>
        )}
        {room && (
          <div style={{ marginTop: 8 }}>
            {room.ready && room.stage_composition ? (
              <>
                <Field k="stage_composition.primary" v={room.stage_composition.primary.url} prov="asbuilt" />
                <Field k={t("交給 host-native Kit review session", "Handed off to host-native Kit review session")} v={room.note} prov="demo" />
              </>
            ) : (
              <p className="ec-warn-note">{room.note}</p>
            )}
          </div>
        )}
      </Panel>
      <Panel title={t("範圍與誠實標示", "Scope and honest labeling")} prov="asbuilt">
        <Field k={t("疊合機制", "Compositing mechanism")} v={t("sublayer 非破壞疊合；opinion 於 LIVERPS Local（最強）步驟解析，subLayerPaths[0] 最強；sessionLayer 僅暫態不作持久層", "non-destructive sublayer compositing; opinions resolve at the LIVERPS Local (strongest) step, subLayerPaths[0] is strongest; sessionLayer is transient only and not a persistent layer")} prov="asbuilt" />
        <Field k="member model.usdc" v={t("immutable（federation 只寫具名 root layer）", "immutable (federation only writes a named root layer)")} prov="asbuilt" />
        <Field k="member usd_path" v={t("指向 conversion authority 產出的 USD（本服務唯讀）", "points to the USD produced by the conversion authority (this service is read-only)")} prov="asbuilt" />
        <Field k="per-member transform" v={t("已實作：root layer over xformOp（member immutable）；順序 scale→rotateXYZ→translate，translate 最外層", "implemented: root layer over xformOp (member immutable); order scale→rotateXYZ→translate, translate outermost")} prov="asbuilt" />
        <Field k="member visibility" v={t("build 時帶入 visibility_default（隱藏 member 寫成 invisible，回傳 hidden[]）；無「不重建即時切換」端點，改 visible 須重新 Build 才生效（不捏造即時能力）", "build applies visibility_default (hidden members are written as invisible, returned in hidden[]); there is no \"toggle live without rebuild\" endpoint, so changing visible requires a rebuild to take effect (no faked live capability)")} prov="asbuilt" />
        <Field k="Open in Review Room" v={t("產出 viewer 消費的 stage_composition handoff；GPU 串流由 host-native Kit + coordinator session 負責，本服務 CPU loopback 不開串流", "produces the stage_composition handoff consumed by the viewer; GPU streaming is handled by host-native Kit + coordinator session, this service runs CPU loopback only and does not open streaming")} prov="asbuilt" />
      </Panel>
    </>
  );
}

// ── P2-2 Semantic Viewer（H）：載入真實 element_mapping.json，嚴守 fake-vs-real 隔離 ──
// mapping URL 來源：帶轉換產出的真實 ifc-ready job（/api/external/ifc-ready）定位，或操作員貼入。
// 凡 mock / allow_fake_mapping / fake_mapping_count>0 / mapping_method=fake_for_smoke_test 一律標
// demo 並「拒絕當正式 mapping 驗證」，禁覆蓋 / 禁冒充真 mapping。點構件 highlight 需 viewer
// DataChannel（console 殼層無此鏈）→ 誠實標 p1，不做假按鈕。
export function SemanticViewerPage() {
  const [mapUrl, setMapUrl] = useState("");
  const [doc, setDoc] = useState<ElementMappingDocument | null>(null);
  const [candidates, setCandidates] = useState<IfcReadyListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 列出帶轉換產出（expected_stage_url）的真實 ifc-ready job，方便操作員定位真實 mapping artifact。
  // 真實端點：GET /api/external/ifc-ready（IfcReadyListItem 帶 expected_stage_url；coordinator 不持有
  // mapping_url 欄位，故只列「有 stage 產出」的 job 作候選，mapping URL 仍由操作員貼入）。
  // 誠實：有資料就填真實候選；佇列為空時誠實顯示為空，不留永遠空白的假列表。
  const loadCandidates = useCallback(async () => {
    setErr(null);
    try {
      const { items } = await coordinatorClient.listIfcReady(50);
      const withMap = items.filter((j) => j.expected_mapping_url);
      setCandidates(withMap);
      if (withMap.length === 0) {
        setErr(t("無帶 mapping 產出（expected_mapping_url）的 ifc-ready job（可直接貼 mapping URL 載入）", "No ifc-ready job with mapping output (expected_mapping_url) (you can paste a mapping URL directly to load)"));
      }
    } catch (e) {
      setErr(`${t("未連線 coordinator /api/external/ifc-ready：", "Not connected to coordinator /api/external/ifc-ready: ")}${String(e)}`);
    }
  }, []);

  const loadMapping = useCallback(async () => {
    if (!mapUrl.trim()) return;
    setBusy(true); setErr(null); setDoc(null);
    try {
      const res = await fetch(mapUrl.trim(), { headers: { Accept: "application/json" } });
      if (!res.ok) { setErr(`${t("載入 mapping ", "Loading mapping ")}${res.status} ${res.statusText}`); return; }
      const json = (await res.json()) as ElementMappingDocument;
      setDoc(json);
    } catch (e) {
      setErr(`${t("無法載入 / 解析 mapping JSON：", "Cannot load / parse mapping JSON: ")}${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [mapUrl]);

  const fake = doc ? isFakeMappingDocument(doc) : false;
  const blockReason = doc ? mappingVerificationBlockReason(doc) : null;
  const items = doc?.items ?? [];

  return (
    <>
      <h1>{t("Semantic Viewer · IFC→USD 語意檢核（H）", "Semantic Viewer · IFC→USD semantic validation (H)")}</h1>
      <p className="ec-lead">
        {t("載入轉換產出的", "Load the converted")} <code>element_mapping.json</code>{t("（IFC GUID ⇔ USD Prim Path），檢視語意對照。 嚴守 fake-vs-real 隔離：mock / fake mapping 一律標示為示範資料，不冒充真實對映。", " (IFC GUID ⇔ USD Prim Path) and review the semantic correspondence. Strict fake-vs-real isolation: mock / fake mapping is always labeled as DEMO DATA and never impersonates a real mapping.")}
      </p>

      <Panel title={t("載入 mapping artifact", "Load mapping artifact")} sub={t("mapping URL（conversion artifact）；可從 ifc-ready job（帶轉換產出）定位，或直接貼入", "mapping URL (conversion artifact); locate it from an ifc-ready job (with conversion output), or paste it directly")} prov="artifact">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" style={{ minWidth: 420 }} placeholder={t("element_mapping.json 的 URL（artifact 來源）", "URL of element_mapping.json (artifact source)")} value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} />
          <Btn primary disabled={busy || !mapUrl.trim()} caption="fetch mapping JSON" onClick={loadMapping}>{busy ? t("載入中…", "Loading…") : t("載入 mapping", "Load mapping")}</Btn>
          <Btn caption={t("GET /api/external/ifc-ready（找帶 mapping 產出的 job）", "GET /api/external/ifc-ready (find jobs with mapping output)")} onClick={loadCandidates}>{t("列出真實 job", "List real jobs")}</Btn>
        </div>
        {err && <p className="ec-warn-note">{err}</p>}
        {candidates.length > 0 && (
          <div className="ec-note" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span>{t("真實 job 候選（帶 mapping 產出，點選自動填入 mapping URL）：", "Real job candidates (with mapping output; click to auto-fill the mapping URL): ")}</span>
            {candidates.map((c) => (
              <button
                key={c.ifc_ready_job_id}
                type="button"
                className="ec-btn ec-s"
                title={c.expected_mapping_url ?? ""}
                onClick={() => { if (c.expected_mapping_url) setMapUrl(c.expected_mapping_url); }}
              >
                {c.ifc_ready_job_id}{c.review_session_id ? `（session ${c.review_session_id}）` : ""}
              </button>
            ))}
          </div>
        )}
        <p className="ec-note">{t("mapping 為 conversion artifact（權威在 streaming-server / artifact store）；本頁唯讀檢視，不寫回、不覆蓋真實 mapping。", "mapping is a conversion artifact (authority lives in streaming-server / artifact store); this page is read-only and never writes back or overwrites a real mapping.")}</p>
      </Panel>

      {doc && (
        <>
          {fake && (
            <div className="ec-fake-banner">
              {t("偵測到 fake / mock mapping（", "Detected fake / mock mapping (")}{blockReason}{t("）。此資料", "). This data is ")}<strong>{t("僅可做 smoke test", "for smoke test only")}</strong>{t("，已標示為示範資料， 不列入正式 mapping 驗證、不冒充真實對映。", ", labeled as DEMO DATA; it is excluded from formal mapping validation and does not impersonate a real mapping.")}
            </div>
          )}
          <Panel
            title={t("mapping 摘要", "mapping summary")}
            sub={fake ? t("此 mapping 為示範資料（fake / mock）", "This mapping is DEMO DATA (fake / mock)") : t("真實 mapping artifact", "real mapping artifact")}
            prov={fake ? "demo" : "artifact"}
          >
            <div className="ec-grid">
              <Metric value={doc.summary?.mapped_count ?? items.length} label="mapped" />
              <Metric value={doc.summary?.unmapped_ifc_count ?? (doc.unmapped_ifc_guids?.length ?? "—")} label="unmapped IFC" tone="warn" />
              <Metric value={doc.summary?.unmapped_usd_count ?? (doc.unmapped_usd_prims?.length ?? "—")} label="unmapped USD" tone="warn" />
              <Metric value={doc.summary?.fake_mapping_count ?? (fake ? "≥1" : 0)} label="fake mapping" tone={fake ? "bad" : undefined} />
            </div>
            <Field k="mapping_version" v={doc.mapping_version ?? "—"} prov={fake ? "demo" : "artifact"} />
            <Field k="model_version_id" v={doc.model_version_id ?? "—"} prov={fake ? "demo" : "artifact"} />
          </Panel>

          {items.length > 0 && (
            <Panel title={t("元件對照 · IFC GUID ⇔ USD Prim Path", "Element correspondence · IFC GUID ⇔ USD Prim Path")} sub={t("逐筆標示是否為 fake item（不混淆真假）", "Each row is marked whether it is a fake item (no mixing of real and fake)")} prov={fake ? "demo" : "artifact"}>
              <table className="ec-table">
                <thead><tr><th>ifc_class</th><th>name</th><th>ifc_guid</th><th>usd_prim_path</th><th>method</th><th /></tr></thead>
                <tbody>
                  {items.slice(0, 40).map((it, i) => {
                    const itemFake = isFakeMappingItem(it);
                    return (
                      <tr key={i}>
                        <td>{it.ifc_class ?? ""}</td>
                        <td>{it.name ?? ""}</td>
                        <td>{it.ifc_guid ?? <span className="ec-warn-note">null</span>}</td>
                        <td>{it.usd_prim_path ?? <span className="ec-warn-note">{t("null（未對映）", "null (unmapped)")}</span>}</td>
                        <td>{it.mapping_method ?? ""}{itemFake && <span className="ec-prov ec-demo" style={{ marginLeft: 6 }}>fake</span>}</td>
                        <td>
                          <Btn prov="p1" disabled caption={t("需 viewer DataChannel（focusPrim / highlightPrims）", "Requires viewer DataChannel (focusPrim / highlightPrims)")}>{t("在 3D 標示", "Mark in 3D")}</Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}
        </>
      )}

      <Panel title={t("範圍與誠實標示", "Scope & honesty labeling")} prov="asbuilt">
        <Field k={t("mapping fake-vs-real 隔離", "mapping fake-vs-real isolation")} v={t("mock / allow_fake_mapping / fake_mapping_count>0 / mapping_method=fake_for_smoke_test 一律當 fake（重用既有 isFakeMappingDocument）", "mock / allow_fake_mapping / fake_mapping_count>0 / mapping_method=fake_for_smoke_test are always treated as fake (reusing the existing isFakeMappingDocument)")} prov="asbuilt" />
        <Field k={t("點構件 → 3D highlight", "click element → 3D highlight")} v={t("需 viewer 的 WebRTC DataChannel（focusPrim / highlightPrims）；console 殼層與 viewer 互斥掛載、無 DataChannel → 標 p1，不做假按鈕", "Requires the viewer's WebRTC DataChannel (focusPrim / highlightPrims); the console shell and viewer mount mutually exclusively, with no DataChannel → marked p1, no fake button")} prov="p1" />
        <Field k={t("mapping 權威", "mapping authority")} v={t("conversion artifact（streaming-server / artifact store 唯讀）；本頁不覆蓋、不冒充", "conversion artifact (streaming-server / artifact store, read-only); this page does not overwrite or impersonate")} prov="asbuilt" />
      </Panel>
    </>
  );
}

// ── P2-3 Coordinator Console（B）：接 coordinator 自有 REST（只打 :8004）──
// 真實端點：GET /api/runtime/status（sessions / kit bindings / ifc_ready jobs / observations）。
// callback-outbox 直查需 internal token（瀏覽器不可達）→ 改由 ifc_ready job 的 callback_outbox_id
// 觀察，不捏造 outbox 三態互動。GPU / 首幀無遙測 → 標未取得，禁畫 fail。
export function CoordinatorPage() {
  const [rt, setRt] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setRt(await coordinatorClient.runtimeStatus()); }
    catch (e) { setErr(`${t("未連線 coordinator /api/runtime/status：", "Not connected to coordinator /api/runtime/status: ")}${String(e)}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1>Coordinator Console · C / Hybrid Runtime Orchestrator</h1>
      <p className="ec-lead">
        {t("會議生命週期 / Kit 綁定 / IFC-ready 派工 / callback outbox，全經 coordinator :8004。 本頁讀", "Session lifecycle / Kit binding / IFC-ready dispatch / callback outbox all go through coordinator :8004. This page reads")} <code>/api/runtime/status</code>{t("（coordinator-visible read-only summary）；瀏覽器不直連 49100/49101/49102。 誠實標示：Kit 首幀 / GPU 無統一遙測（port listening ≠ has frame）→ 不畫成 fail、不捏造秒數。", " (coordinator-visible read-only summary); the browser does not directly reach 49100/49101/49102. Honesty labeling: Kit first frame / GPU have no unified telemetry (port listening ≠ has frame) → not rendered as fail and no fabricated seconds.")}
      </p>
      <ProvLegend />
      <CoordinatorGovernanceTabs rt={rt} busy={busy} err={err} onRefresh={load} />
    </>
  );
}

// ── P2-3 Model Intake（C）：IFC-ready intake 佇列 + conversion quality（誠實）──
// 真實端點：GET /api/external/ifc-ready[?limit]。conversion quality / mapping fidelity 為 artifact；
// 無真實遙測的數值（GPU / 秒數）一律標未取得，不捏造、不承諾精準 GUID。
export function IntakePage() {
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setJobs((await coordinatorClient.listIfcReady(50)).items); }
    catch (e) { setErr(`${t("未連線 coordinator /api/external/ifc-ready：", "Not connected to coordinator /api/external/ifc-ready: ")}${String(e)}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1>{t("Model Intake · 接收與轉換（C）", "Model Intake · Ingest & Conversion (C)")}</h1>
      <p className="ec-lead">
        {t("外部 IFC Worker → coordinator", "External IFC Worker → coordinator")} <code>/api/external/ifc-ready</code> {t("→ 內部轉換 authority（bim-streaming-server）。 本頁讀 intake 佇列；轉換品質 / mapping 可信度為 artifact，不承諾精準 GUID。", "→ internal conversion authority (bim-streaming-server). This page reads the intake queue; conversion quality / mapping fidelity are artifacts, with no promise of exact GUIDs.")}
      </p>
      <Panel
        title={t("IFC-ready intake 佇列", "IFC-ready intake queue")}
        sub={t("GET /api/external/ifc-ready?limit=1..100 · status / download_status 為 as-built", "GET /api/external/ifc-ready?limit=1..100 · status / download_status are as-built")}
        prov="asbuilt"
        actions={<Btn disabled={busy} caption="GET /api/external/ifc-ready" onClick={load}>{busy ? t("讀取中…", "Loading…") : t("重新整理", "Refresh")}</Btn>}
      >
        {err && <p className="ec-warn-note">{err}</p>}
        {jobs.length > 0 ? (
          <table className="ec-table">
            <thead><tr><th>ifc_ready_job_id</th><th>status</th><th>download</th><th>conversion</th><th>authority</th><th>session</th></tr></thead>
            <tbody>
              {jobs.slice(0, 40).map((j) => (
                <tr key={j.ifc_ready_job_id}>
                  <td>{j.ifc_ready_job_id}</td><td>{j.status}</td>
                  <td>{j.download_status ?? "—"}</td><td>{j.conversion_status ?? "—"}</td>
                  <td>{j.conversion_authority ?? "—"}</td><td>{j.review_session_id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="ec-note">{err ? "" : t("目前無 intake job（coordinator 已連線，佇列為空——非錯誤）。", "No intake job at the moment (coordinator connected, queue empty — not an error).")}</p>}
      </Panel>

      <Panel title={t("轉換品質與 mapping 可信度 · 誠實標示", "Conversion quality & mapping fidelity · honesty labeling")} sub={t("coordinator 不計算，只轉發 conversion authority 值；無遙測欄位標未取得", "coordinator does not compute, only forwards conversion authority values; fields without telemetry are marked not available")} prov="artifact">
        <Field k="quality_metrics_summary" v={t("coverage_status / unmapped_count / coverage_ratio（pass-through artifact，隨 conversion result 提供）", "coverage_status / unmapped_count / coverage_ratio (pass-through artifact, provided with the conversion result)")} prov="artifact" />
        <Field k="semantic_mapping_fidelity" v={t("guid_exact / ifc_class_grouped_with_name（缺欄位時 fallback null）", "guid_exact / ifc_class_grouped_with_name (falls back to null when the field is missing)")} prov="artifact" />
        <Field k={t("精準 GUID 對映", "exact GUID mapping")} v={t("MVP 不承諾精準 GUID；需 streaming adapter force IfcOpenShell USD 模式（PoC），允許人工校正", "MVP does not promise exact GUIDs; requires the streaming adapter to force IfcOpenShell USD mode (PoC), with manual correction allowed")} prov="demo" />
        <Field k={t("conversion 秒數 / GPU", "conversion seconds / GPU")} v={t("未取得（無統一遙測來源）", "not available (no unified telemetry source)")} prov="demo" />
        <Field k="manual mapping correction UI" v={t("待建", "not built")} prov="p15" />
      </Panel>
    </>
  );
}

// ── P2-3 Runtime Dashboard（F）：Kit 綁定 / stream-config（coordinator read-only）──
// 真實端點：GET /api/runtime/status（host_native_plane / kit bindings）+
// GET /api/review-sessions/:id/stream-config。GPU / conversion 無遙測 → 標未取得，禁畫 fail。
export function RuntimePage() {
  const [rt, setRt] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setRt(await coordinatorClient.runtimeStatus()); }
    catch (e) { setErr(`${t("未連線 coordinator /api/runtime/status：", "Not connected to coordinator /api/runtime/status: ")}${String(e)}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1>{t("Runtime Dashboard · 串流執行狀態（F）", "Runtime Dashboard · Streaming runtime status (F)")}</h1>
      <p className="ec-lead">
        {t("Kit 實例綁定 / stream-config，由 coordinator", "Kit instance binding / stream-config, forwarded by the coordinator")} <strong>read-only proxy</strong>{t("轉發；瀏覽器永不直連 49100/49101。 GPU / 轉換秒數無統一遙測 → 標未取得（idle，非 fail）。", "; the browser never directly reaches 49100/49101. GPU / conversion seconds have no unified telemetry → marked not available (idle, not fail).")}
      </p>
      <Panel
        title={t("Host-native plane 觀測", "Host-native plane observation")}
        sub={t("GET /api/runtime/status · observations（read-only；Kit 內部 stage state 仍需 DataChannel / log 佐證）", "GET /api/runtime/status · observations (read-only; Kit internal stage state still needs DataChannel / log evidence)")}
        prov="asbuilt"
        actions={<Btn disabled={busy} caption="GET /api/runtime/status" onClick={load}>{busy ? t("讀取中…", "Loading…") : t("重新整理", "Refresh")}</Btn>}
      >
        {err && <p className="ec-warn-note">{err}</p>}
        {rt && (
          <>
            <Field k="conversion authority" v={`${rt.configured_endpoints.conversion_authority.authority} · ${rt.configured_endpoints.conversion_authority.base_url}`} prov="asbuilt" />
            <Field k="Kit signal ports" v={rt.observations.host_native_plane.kit_signal_ports.join(", ") || "—"} prov="asbuilt" />
            <Field k="Kit media ports" v={rt.observations.host_native_plane.kit_media_ports.join(", ") || "—"} prov="asbuilt" />
            <Field k="GPU / VRAM / util" v={t("未取得（streaming 未提供統一 GPU 遙測）", "not available (streaming provides no unified GPU telemetry)")} prov="demo" />
            <Field k={t("觀測分類", "observation category")} v={rt.observations.note} prov="asbuilt" />
          </>
        )}
      </Panel>

      {rt && (
        <Panel title={t("Kit 實例綁定 · kit_instance_bindings", "Kit instance binding · kit_instance_bindings")} sub={t("provider local_fixed；state = KitInstance.status 權威 enum", "provider local_fixed; state = the authoritative KitInstance.status enum")} prov="asbuilt">
          {rt.kit_instance_bindings.length > 0 ? (
            <table className="ec-table">
              <thead><tr><th>kit_instance_id</th><th>session</th><th>state</th><th>started_at</th></tr></thead>
              <tbody>
                {rt.kit_instance_bindings.slice(0, 20).map((b, i) => (
                  <tr key={i}><td>{b.kit_instance_id}</td><td>{b.session_id}</td><td>{b.status}</td><td>{b.started_at ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="ec-note">{t("無 Kit 綁定（無 active session 時為空；routing_policy=dedicated_instance 超出 endpoint 數會停在 queued_for_instance）。", "No Kit binding (empty when there is no active session; with routing_policy=dedicated_instance exceeding the endpoint count, it stays at queued_for_instance).")}</p>}
        </Panel>
      )}

      <StreamConfigReader />

      <Panel title={t("治理規則執行綁定（A1）", "Governance rule-run binding (A1)")} sub={t("governance-service :49102 為內部服務（經 coordinator proxy）", "governance-service :49102 is an internal service (via coordinator proxy)")} prov="asbuilt">
        <Field k="rule-run authority" v={t("A1 後端已實作（見 Issues · Rule Center 頁可真實觸發）", "A1 backend implemented (see the Issues · Rule Center page to trigger it for real)")} prov="asbuilt" />
      </Panel>
    </>
  );
}

// ── P4 Review Room（G）：A1 handoff 的專用 3D session attach 畫面 ──
// A1 不再內嵌 viewer 或 claim lease；Review Room 才能由操作員明確按鈕 claim primary lease、
// 掛載 viewer、接收 first_frame / stage truth，並送 highlight command trace。
export function ReviewRoomPage() {
  return (
    <>
      <h1>{t("Review Room · 審查室（G）", "Review Room (G)")}</h1>
      <p className="ec-lead">
        {t("A1 只把 governance 結果交給本畫面；Kit / WebRTC / viewer lease 必須在 Review Room 手動啟動。highlight 由本畫面送到 viewer DataChannel，並保留 command trace。", "A1 only hands governance results to this screen; Kit / WebRTC / viewer lease must be started manually in Review Room. Highlight is sent from this screen to the viewer DataChannel with a command trace.")}
      </p>

      <ReviewSessionViewerPane />

      <Panel title={t("工具列 · Tool Rail（既有 viewer 內）", "Tool rail · Tool Rail (inside the existing viewer)")} sub={t("每顆工具標來源：viewer DataChannel as-built 指令 vs 待建", "Each tool labels its provenance: viewer DataChannel as-built command vs not built")} prov="asbuilt">
        <table className="ec-table">
          <thead><tr><th>{t("工具", "Tool")}</th><th>command</th><th>provenance</th></tr></thead>
          <tbody>
            {([
              [t("載入 USD", "Load USD"), "openStage", "asbuilt"],
              [t("聚焦元件", "Focus element"), "focusPrim", "asbuilt"],
              [t("選取元件", "Select element"), "selectPrims", "asbuilt"],
              [t("清除高亮", "Clear highlight"), "clearHighlight", "asbuilt"],
              [t("高亮元件", "Highlight element"), t("highlightPrims（client 主動拉，非 server-push）", "highlightPrims (client-pull, not server-push)"), "p15"],
              [t("剖面", "Section"), "sectionRequest", "p15"],
              [t("截圖", "Snapshot"), "snapshot", "p15"],
            ] as [string, string, Prov][]).map(([l, cmd, p]) => (
              <tr key={cmd}><td>{l}</td><td>{cmd}</td><td><ProvTag prov={p} /></td></tr>
            ))}
          </tbody>
        </table>
        <p className="ec-note">{t("Load / Focus / Select / Clear 為 viewer DataChannel as-built 指令；Highlight 走 Review Room 主動拉 prim_paths（不復活 server-push · P1.5）；Section / Snapshot 後端未實作。", "Load / Focus / Select / Clear are viewer DataChannel as-built commands; Highlight uses Review Room client-pull prim_paths (without reviving server-push · P1.5); Section / Snapshot are not implemented on the backend.")}</p>
      </Panel>

      <Panel title={t("範圍與誠實標示", "Scope & honesty labeling")} prov="asbuilt">
        <Field k="3D viewport" v={t("在 Review Room route 手動 attach；A1 不掛 viewer、不 claim lease", "Manually attached in the Review Room route; A1 does not mount viewer or claim lease")} prov="asbuilt" />
        <Field k={t("server→viewer push highlight / 多人廣播", "server→viewer push highlight / multi-user broadcast")} v={t("2026-05-21 已退役（remove-conflict-review-from-fast-mvp）；加回需另開 OpenSpec", "retired on 2026-05-21 (remove-conflict-review-from-fast-mvp); re-adding requires a new OpenSpec")} prov="p15" />
        <Field k="section / snapshot" v={t("待建", "not built")} prov="p15" />
        <Field k={t("viewer 主體", "viewer body")} v={t("重用既有 EmbeddedViewer / Window.tsx postMessage bridge；不修改 viewer runtime", "Reuses the existing EmbeddedViewer / Window.tsx postMessage bridge; viewer runtime is unchanged")} prov="asbuilt" />
      </Panel>
    </>
  );
}

export function StubPage({ title, note, items }: { title: string; note: string; items: [string, string, Prov][] }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="ec-lead">{note}</p>
      <Panel title={t("狀態", "Status")}>
        {items.map(([k, v, p], i) => (
          <Field key={i} k={k} v={v} prov={p} />
        ))}
      </Panel>
    </>
  );
}

export const PAGE_TITLE: Record<string, string> = Object.fromEntries(PAGES.map((p) => [p.key, p.label]));
