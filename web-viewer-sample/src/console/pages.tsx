// Edge Console 頁面。誠實原則：AS-BUILT 才標已實作；待建一律標 p1/p15 並說明；
// 任何數字非真即標 artifact / demo，絕不捏造。
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { t } from "./i18n";
import { Btn, Field, Metric, Panel, ProvTag, ProvLegend } from "./components";
import { a1Reducer, initialA1State, uiSteps } from "./a1Machine";
import { A1A10, A1A10_DETAIL, AppCardDef, AppVisionDetail, DEPENDENCIES, ENDPOINTS, PAGES, Prov, SERVICES } from "./data";
import { CoordReport, DiffIssueImpact, DiffItemRow, DiffOverlayResult, DiffStatus, FailureRow, FederatedBuildResult, FileProjectRow, FileVersionRow, governanceClient, IssueRow, ReviewRoomDescriptor, RuleResultRow, RuleRunHistoryFilters, RuleRunHistoryItem, RuleRunStatus } from "./governanceClient";
import { coordinatorClient, IfcReadyListItem, KitInstanceState, RuntimeSessionSummary, RuntimeStatus } from "./coordinatorClient";
// [Task 9 MD 三頁合一] CV/M/IN 三頁移除後，conversionShared 其餘符號（CoverageDrawer/chip/role…）改由
// modelData/ 內的 pane 消費；本檔僅剩 LifecycleStrip（A1GovernanceWorkbenchPage stepper 仍用）。
import { LifecycleStrip } from "./modelData/conversionShared";
import { CoordinatorGovernanceTabs } from "./coordinator/RuntimeGovernanceTabs";
import { IntentDialog } from "./IntentDialog";
import { ReviewSessionViewerPane } from "./ReviewSessionViewerPane";
// 重用既有 viewer 的 mapping fake-vs-real 隔離工具（已有測試）：mock / allow_fake_mapping /
// fake_mapping_count>0 / mapping_method=fake_for_smoke_test 一律當 fake，不重造輪子。
import { ElementMappingDocument, isFakeMappingDocument, isFakeMappingItem, mappingVerificationBlockReason } from "../types/mapping";
// 七軸通用 cross-page handoff util（§4）：URL hash 帶非機密關聯 ID，接收端重驗，不帶 lease token。
import { buildHandoff } from "./handoff";
// 七軸和諧整合 §5：共享狀態列同一份 Context 快照（GET /api/runtime/status 單一輪詢）。
// KG 頁用它讀「真 session 聚合」，另讀 kit-manager current instance；GPU per-node 數值仍誠實標未取得。
import { useSharedStatus } from "./useSharedStatus";
// Task 14（§4.2 接收端重驗鐵律）：接收端向已抓取的權威資料重驗 incoming handoff，誠實 verified/not_found。
import { useIncomingHandoff, IncomingHandoffBanner } from "./incomingHandoff";

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

type A1SourceKind = "local_fs" | "minio";
type A1LocalVersionOption = {
  projectId: string;
  modelId: string;
  version: FileVersionRow;
  modelVersionId: string;
};

function flattenA1LocalVersions(projects: FileProjectRow[]): A1LocalVersionOption[] {
  return projects.flatMap((project) =>
    project.models.flatMap((model) =>
      model.versions.map((version) => ({
        projectId: project.project_id,
        modelId: model.model_id,
        version,
        modelVersionId: `${project.project_id}/${model.model_id}/${version.name}`,
      })),
    ),
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface LeaseEvidence {
  firstFrameAt: string | null;
  lastHeartbeatAt: string | null;
  heartbeatStale: boolean | null;
  stageMatch: boolean | null;
  datachannelReady: boolean | null;
}

export function leaseEvidence(s: RuntimeSessionSummary, nowMs: number): LeaseEvidence {
  const leases = s.viewer_leases ?? [];
  const lease = leases.find((l) => l.lease_id === s.primary_viewer_lease_id)
    ?? leases.find((l) => l.status === "active")
    ?? null;
  const lastHb = lease?.last_heartbeat_at ?? null;
  return {
    firstFrameAt: s.first_frame_at ?? lease?.first_frame_at ?? null,
    lastHeartbeatAt: lastHb,
    heartbeatStale: lastHb ? nowMs - Date.parse(lastHb) > 15_000 : null,
    stageMatch: lease?.stage_match ?? null,
    datachannelReady: lease?.datachannel_ready ?? null,
  };
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
  sessionId?: string;
  runId: string | null;
  row: RuleResultRow | null | undefined;
  expectedStageUrl?: string | null;
}): string {
  const q = new URLSearchParams({ source: "a1" });
  if (args.sessionId) q.set("session", args.sessionId);
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

function a1ReviewRoomHandoffReason(row: RuleResultRow | null | undefined): string {
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
  const [sourceKind, setSourceKind] = useState<A1SourceKind>("local_fs");
  const [fsTree, setFsTree] = useState<FileProjectRow[] | null>(null);
  const [fsErr, setFsErr] = useState<string | null>(null);
  const [selectedLocalPath, setSelectedLocalPath] = useState<string>("");
  // A1 step①：MinIO source_ifc 物件清單只作來源物件 / handoff。CPU rule-run 需要
  // governance-service 可讀的 server-local path，不能把 object key 當 ifc_source_path 送出。
  const [minioObjects, setMinioObjects] = useState<import("./coordinatorClient").MinioObject[] | null>(null);
  const [minioErr, setMinioErr] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [ifcReadyJobs, setIfcReadyJobs] = useState<IfcReadyListItem[] | null>(null);
  const [ifcReadyErr, setIfcReadyErr] = useState<string | null>(null);
  // 交付動作（建 Issue / 匯出）失敗的誠實 UI 回饋：後端離線時操作員必須看得到失敗
  // （對齊 doRun 的 runError；component-local，不污染 reducer 語意）。下次成功動作清除。
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [a1Issues, setA1Issues] = useState<IssueRow[]>([]);
  const bcfIssues = useMemo(() => a1Issues.filter((issue) => issue.kind === "issue" && Boolean(issue.ifc_guid)), [a1Issues]);
  // F4：fetch 期間 disable 兩鈕（Excel 與 BCF 同等 loading 保護，防重送）。
  const [excelBusy, setExcelBusy] = useState(false);
  const [bcfBusy, setBcfBusy] = useState(false);
  // Review session 只作為 3D/Review Room handoff 與 mapping enrichment 的 optional target。
  // A1 v2 的治理 rule-run 直接對已選 IFC 檔案執行；A1 mount 不得自動選第一個 session 或 claim viewer lease。
  const [sessions, setSessions] = useState<RuntimeStatus["sessions"]["items"]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [runHistory, setRunHistory] = useState<RuleRunHistoryItem[] | null>(null);
  const [runHistoryTotal, setRunHistoryTotal] = useState<number | null>(null);
  const [runHistoryErr, setRunHistoryErr] = useState<string | null>(null);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [runHistoryRefreshTick, setRunHistoryRefreshTick] = useState(0);
  const idsFileInputRef = useRef<HTMLInputElement>(null);
  const ui = uiSteps(state);
  const runId = state.run?.rule_run_id ?? null;
  const issueGenRef = useRef(0);
  const issueGuardRef = useRef({ runId: null as string | null, modelVersionId: "" });
  useEffect(() => {
    issueGuardRef.current = { runId, modelVersionId: state.modelVersionId };
    issueGenRef.current += 1;
  }, [runId, state.modelVersionId, state.ifcPath]);
  // Task 14（M→A1 接收端重驗）：向已抓取的 minioObjects 重驗 incoming minio_key；查無 → 誠實 not_found。
  // Task14 Important #1：minioObjects===null=尚未載入（見上方 state 註解）。載入中不得壓成 not_found（掛載後
  // 第一個 fetch resolve 前的同步 render 會誤閃假警示），回中性 indeterminate；已載入（[] 或有值）才判 not_found。
  const incoming = useIncomingHandoff("a1", (h) => {
    // 本軸只重驗 minio_key；SS→A1 chip 只帶 session（A1 不重驗 session）→ 無欄位可查＝not_applicable，
    // 不得誤成 not_found（否則對真實 active session 假報「查無」；p5-critic honesty regression）。
    if (!h.minio_key) return "not_applicable";
    if (minioObjects === null) return "indeterminate";
    // reviewer P2（Codex，已核實）：getMinioObjects() 失敗時 catch 分支把 minioObjects 落成 []（非 null），
    // 上面的 null 守門不再成立，未查即誤報 not_found（MinIO 斷線/憑證缺失時對真實 handoff 假警示紅字）。
    // minioErr 非 null＝本來就沒查成功，比照 null 分支同樣退 indeterminate，不假裝已查無。
    if (minioErr !== null) return "indeterminate";
    return minioObjects.some((o) => o.key === h.minio_key);
  });
  // reviewer P2（Codex，已核實）：上面 incoming 只顯示「已重驗」banner，過去從未把 handoff 帶來的 minio_key
  // 真的帶進 selectedKey——operator 看到「已重驗」卻仍要手動從下拉重找同一份檔案。verified 時把
  // minio_key 種進 selectedKey 並切到 MinIO source（不自動 claim session、不自動跑 rule-run；MinIO
  // key 仍不得直接當 ifc_source_path）；用 ref 記住已種過的 key，避免使用者事後手動改選又被這裡打回去。
  const seededHandoffKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = incoming.handoff?.minio_key;
    if (incoming.status === "verified" && key && seededHandoffKeyRef.current !== key) {
      seededHandoffKeyRef.current = key;
      if (sourceKind !== "minio" || selectedKey !== key) {
        dispatch({ type: "RESET" });
        setActionErr(null);
        setA1Issues([]);
      }
      setSourceKind("minio");
      setSelectedKey(key);
    }
  }, [incoming.status, incoming.handoff?.minio_key, sourceKind, selectedKey]);

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

  const loadA1FsTree = useCallback(async () => {
    setFsErr(null);
    setFsTree(null);
    try {
      const tree = await governanceClient.filesTree();
      setFsTree(tree.projects);
    } catch (e) {
      setFsTree([]);
      setFsErr(String(e));
    }
  }, []);

  useEffect(() => {
    void loadA1FsTree();
  }, [loadA1FsTree]);

  // A1（B2）step①：列 MinIO source_ifc 物件供下拉選模型。誠實：失敗顯錯、空就空，不偽造。
  useEffect(() => {
    let alive = true;
    coordinatorClient.getMinioObjects()
      .then((res) => { if (alive) { setMinioObjects(res.objects.filter((o) => o.role === "source_ifc")); setMinioErr(null); } })
      .catch((e) => { if (alive) { setMinioObjects([]); setMinioErr(String(e)); } });
    return () => { alive = false; };
  }, []);

  // A1 MinIO resolution：以 idempotency_key 對 ifc-ready jobs，只有 downloaded + review_session_id
  // 可進入檢核；server-local path 仍由 coordinator for-session resolver 解析，不由 browser 傳入。
  const refreshIfcReadyJobs = useCallback(async (): Promise<IfcReadyListItem[]> => {
    setIfcReadyErr(null);
    try {
      const res = await coordinatorClient.listIfcReady(100);
      setIfcReadyJobs(res.items);
      return res.items;
    } catch (e) {
      setIfcReadyJobs([]);
      setIfcReadyErr(String(e));
      throw e;
    }
  }, []);
  useEffect(() => {
    let alive = true;
    coordinatorClient.listIfcReady(100)
      .then((res) => { if (alive) { setIfcReadyJobs(res.items); setIfcReadyErr(null); } })
      .catch((e) => { if (alive) { setIfcReadyJobs([]); setIfcReadyErr(String(e)); } });
    return () => { alive = false; };
  }, []);

  const selectedMinioObject = sourceKind === "minio"
    ? (minioObjects ?? []).find((o) => o.key === selectedKey) ?? null
    : null;

  const doRun = useCallback(async () => {
    // A1 v2 gating：須先選定 IFC 檔案；review session 只影響後續 3D handoff / mapping enrichment。
    if (state.step === "idle" || !state.ifcPath || (state.ifcPath.startsWith("session://") && !selectedSession)) return;
    setActionErr(null);
    setA1Issues([]);
    // running-error 子態（RUN_FAIL 後 step 仍 running、runError=true）的重試走 RUN_RETRY；
    // 否則 plain RUN 在 running 是 no-op（防雙擊污染），「可重試」按鈕會點了沒反應（spec §5）。
    dispatch({ type: state.step === "running" && state.runError ? "RUN_RETRY" : "RUN" });
    // 開跑前捕捉 generation；不可在 await createRuleRun 之後重新捕捉，否則 await 視窗內
    // dispatch PICK_FILE 遞增的新 gen 會被抓回來，守門永遠通過、舊輪詢繼續打（資源洩漏）。
    const myGen = pollGenRef.current;
    try {
      if (state.ifcPath.startsWith("session://") || state.ifcPath.startsWith("ifc-ready://")) {
        const refreshedJobs = await refreshIfcReadyJobs();
        if (pollGenRef.current !== myGen) return;
        const expectedIfcReadyJobId = state.ifcPath.startsWith("ifc-ready://")
          ? state.ifcPath.slice("ifc-ready://".length)
          : "";
        const refreshedJob = selectedMinioObject?.idempotency_key
          ? refreshedJobs.find((job) => job.idempotency_key === selectedMinioObject.idempotency_key) ?? null
          : expectedIfcReadyJobId
            ? refreshedJobs.find((job) => job.ifc_ready_job_id === expectedIfcReadyJobId) ?? null
            : refreshedJobs.find((job) => job.review_session_id === selectedSession) ?? null;
        const refreshedSourceIfcReady =
          refreshedJob?.download_status === "downloaded"
          && (!state.ifcPath.startsWith("session://") || refreshedJob.review_session_id === selectedSession)
          && (!expectedIfcReadyJobId || refreshedJob.ifc_ready_job_id === expectedIfcReadyJobId)
          && refreshedJob.artifact_health?.source_ifc_exists === true;
        if (!refreshedSourceIfcReady) {
          const staleReason = refreshedJob?.artifact_health?.stale_reason
            ?? (refreshedJob?.artifact_health?.source_ifc_exists === false ? "source_ifc_exists=false" : "source_ifc_exists=unknown");
          dispatch({ type: "RUN_FAIL", error: `source IFC artifact stale before rule-run: ${staleReason}` });
          return;
        }
      }
      const runRequest = {
        ifc_source_path: state.ifcPath,
        ids_path: idsPath || undefined,
      } as { ifc_source_path: string; ids_path?: string; model_version_id?: string };
      if (state.modelVersionId) runRequest.model_version_id = state.modelVersionId;
      const ifcReadyJobId = state.ifcPath.startsWith("ifc-ready://")
        ? state.ifcPath.slice("ifc-ready://".length)
        : "";
      const { rule_run_id } = ifcReadyJobId
        ? await governanceClient.createRuleRunForIfcReady(ifcReadyJobId, { ids_path: idsPath || undefined })
        : selectedSession
          ? await governanceClient.createRuleRunForSession(selectedSession, { ids_path: idsPath || undefined })
          : await governanceClient.createRuleRun(runRequest);
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
        if (sourceKind === "minio") setRunHistoryRefreshTick((value) => value + 1);
      } else {
        dispatch({ type: "RUN_FAIL", error: st ? `rule-run ${st.status}` : "no status" });
        if (sourceKind === "minio" && st) setRunHistoryRefreshTick((value) => value + 1);
      }
    } catch (e) {
      if (pollGenRef.current !== myGen) return; // unmount / 重置後吞掉殘餘錯誤，不寫回已卸載 UI
      dispatch({ type: "RUN_FAIL", error: String(e) });
    }
  }, [state.step, state.runError, state.ifcPath, state.modelVersionId, idsPath, selectedSession, sessions, selectedMinioObject, sourceKind, refreshIfcReadyJobs]);

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
    const guardedRunId = runId;
    const guardedModelVersionId = state.modelVersionId;
    const guardedIssueGen = issueGenRef.current;
    const isCurrentIssueRequest = () =>
      issueGenRef.current === guardedIssueGen &&
      issueGuardRef.current.runId === guardedRunId &&
      issueGuardRef.current.modelVersionId === guardedModelVersionId;
    setActionErr(null); // 重試前清掉上次錯誤
    try {
      const { created, issue_ids } = await governanceClient.issuesFromRuleRun(runId);
      try {
        if (issue_ids.length > 0) {
          const rows = await Promise.all(issue_ids.map((id) => governanceClient.getIssue(id)));
          if (!isCurrentIssueRequest()) return;
          setA1Issues(rows);
        } else {
          if (guardedModelVersionId) {
            const existingRows = await governanceClient.listIssues(undefined, {
              model_version_id: guardedModelVersionId,
              kind: "issue",
            });
            if (!isCurrentIssueRequest()) return;
            const ruleIssues = existingRows.filter((issue) => issue.source_type === "rule_result" && issue.ifc_guid);
            if (ruleIssues.length > 0) {
              setA1Issues(ruleIssues);
            } else {
              setActionErr(t("未找到此模型版本既有 rule-run Issue；請重新建立或檢查後端 issue store。", "No existing rule-run issues were found for this model version; recreate them or check the backend issue store."));
            }
          } else {
            if (!isCurrentIssueRequest()) return;
            setActionErr(t("後端未回傳 issue_ids，且本次 rule-run 未綁定 model_version_id，無法安全重載既有 Issue。", "The backend returned no issue_ids and this rule-run has no model_version_id, so existing Issues cannot be safely reloaded."));
          }
        }
      } catch (e) {
        if (!isCurrentIssueRequest()) return;
        setActionErr(`${t("載入 Issue 詳情失敗：", "Failed to load Issue details: ")}${String(e)}`);
      }
      if (!isCurrentIssueRequest()) return;
      dispatch({ type: "CREATE_ISSUES_OK", issueCount: created });
    } catch (e) {
      // 後端離線：誠實不前進（不偽造 issued），但顯示失敗讓操作員知道（誠實鐵律）。
      setActionErr(`${t("建 Issue 失敗：", "Failed to create Issue: ")}${String(e)}`);
    }
  }, [runId, state.modelVersionId]);

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

  const transitionA1Issue = useCallback(async (issue: IssueRow) => {
    const next = issue.status === "open" ? "in_progress" : issue.status === "in_progress" ? "resolved" : null;
    if (!next) return;
    setActionErr(null);
    try {
      const updated = await governanceClient.transitionIssue(issue.id, next, "A1 BCF review panel transition");
      setA1Issues((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (e) {
      setActionErr(`${t("Issue 狀態更新失敗：", "Issue transition failed: ")}${String(e)}`);
    }
  }, []);

  // A1（B2）下拉項 label：專案·種類·版本·檔名（缺值以「?」誠實標示，不臆造）。
  const minioLabel = (o: import("./coordinatorClient").MinioObject) =>
    `${o.project_display_name ?? o.project_id ?? "?"} · ${o.category ?? "?"} · ${o.version ?? "?"} · ${o.key.split("/").pop() ?? o.key}`;

  const localOptions = flattenA1LocalVersions(fsTree ?? []);
  const selectedLocalOption = localOptions.find((option) => option.version.path === selectedLocalPath) ?? null;
  const canPickLocal = sourceKind === "local_fs" && Boolean(selectedLocalOption);
  const selectedMinioJob = selectedMinioObject && ifcReadyJobs
    ? ifcReadyJobs.find((job) => job.idempotency_key === selectedMinioObject.idempotency_key) ?? null
    : null;
  const selectedMinioSessionId = selectedMinioJob?.review_session_id ?? "";
  const selectedMinioDownloaded = selectedMinioJob?.download_status === "downloaded";
  const selectedMinioSourceIfcReady = selectedMinioJob?.artifact_health?.source_ifc_exists === true;
  const selectedMinioJobId = selectedMinioJob?.ifc_ready_job_id ?? "";
  const selectedMinioSourceIfcStaleReason =
    selectedMinioJob?.artifact_health?.stale_reason
    ?? (selectedMinioJob?.artifact_health?.source_ifc_exists === false ? "source_ifc_exists=false" : "source_ifc_exists=unknown");
  const canPickMinioDownloaded = sourceKind === "minio" && Boolean(
    selectedMinioObject && selectedMinioDownloaded && selectedMinioJobId && selectedMinioSourceIfcReady,
  );
  const selectedMinioResolutionNote = !selectedKey
    ? t("請先選擇 MinIO source_ifc 物件。", "Select a MinIO source_ifc object first.")
    : ifcReadyErr
      ? `${t("ifc-ready job 清單不可用：", "ifc-ready job list unavailable: ")}${ifcReadyErr}`
      : ifcReadyJobs === null
        ? t("正在載入 watcher downloaded ifc-ready jobs…", "Loading watcher downloaded ifc-ready jobs...")
        : !selectedMinioJob
          ? `${t("尚未找到 watcher 下載紀錄；A1 不會直接檢核 MinIO key。請用 MinIO/IFC->USD 排程頁觸發 POST /api/conversion/trigger。idempotency_key=", "No watcher download record found; A1 will not validate a MinIO key directly. Use the MinIO/IFC->USD schedule page to trigger POST /api/conversion/trigger. idempotency_key=")}${selectedMinioObject?.idempotency_key ?? "unknown"}`
          : !selectedMinioDownloaded
            ? `${t("watcher job 尚未下載完成，A1 等待 downloaded 狀態。download_status=", "Watcher job is not downloaded yet; A1 waits for downloaded status. download_status=")}${selectedMinioJob.download_status ?? "unknown"}${selectedMinioJob.download_failure ? ` (${selectedMinioJob.download_failure})` : ""}`
            : !selectedMinioSourceIfcReady
              ? `${t("watcher job 已下載，但 source IFC artifact stale；A1 不啟動 rule-run：", "Watcher job is downloaded, but the source IFC artifact is stale; A1 will not start a rule-run: ")}${selectedMinioSourceIfcStaleReason}`
              : selectedMinioSessionId
                ? `${t("已對到 watcher downloaded job 與 review session；rule-run 將走 coordinator for-session proxy：", "Matched watcher downloaded job and review session; rule-run will use coordinator for-session proxy: ")}${selectedMinioJob.ifc_ready_job_id} / ${selectedMinioSessionId}`
                : `${t("已對到 watcher downloaded job；coordinator ifc-ready proxy（POST /api/governance/rule-runs/for-ifc-ready）只排入 A1 governance rule-run queue：", "Matched watcher downloaded job; coordinator ifc-ready proxy (POST /api/governance/rule-runs/for-ifc-ready) queues only the A1 governance rule-run: ")}${selectedMinioJob.ifc_ready_job_id}`;
  const selectedMinioPickLabel = canPickMinioDownloaded
    ? t("選取已下載模型", "Select Downloaded Model")
    : !selectedKey
      ? t("等待選擇 MinIO 模型", "Waiting for MinIO model")
      : ifcReadyJobs === null
        ? t("載入 downloaded jobs", "Loading downloaded jobs")
        : !selectedMinioJob
          ? t("等待 watcher/轉檔排程", "Waiting for watcher/conversion schedule")
          : !selectedMinioDownloaded
            ? t("等待 downloaded session", "Waiting for downloaded session")
            : !selectedMinioSourceIfcReady
              ? t("source IFC artifact stale", "source IFC artifact stale")
              : t("選取已下載模型", "Select Downloaded Model");
  const selectedSessionSummary = sessions.find((s) => s.session_id === selectedSession) ?? null;
  const selectedStageEvidence = selectedSessionSummary?.stage_open_evidence ?? null;
  const canRunA1 = state.step !== "idle"
    && Boolean(state.ifcPath)
    && !(state.ifcPath.startsWith("session://") && !selectedSession)
    && !(state.ifcPath.startsWith("session://") && !selectedMinioSourceIfcReady)
    && !(state.ifcPath.startsWith("ifc-ready://") && !selectedMinioSourceIfcReady)
    && !(state.step === "running" && !state.runError);
  const stageMatched = Boolean(
    selectedStageEvidence?.expected_stage_url &&
    selectedStageEvidence.loaded_stage_url &&
    selectedStageEvidence.expected_stage_url === selectedStageEvidence.loaded_stage_url,
  );
  const selectedMinioHistoryFilters = useMemo<RuleRunHistoryFilters | null>(() => {
    if (sourceKind !== "minio" || !selectedMinioObject) return null;
    const filters: RuleRunHistoryFilters = { limit: 5 };
    const put = (
      key: "project_id" | "model_category" | "model_version_id" | "ifc_ready_job_id" | "idempotency_key" | "review_session_id",
      value: string | null | undefined,
    ) => {
      if (value && value.trim().length > 0) {
        filters[key] = value;
      }
    };
    put("project_id", selectedMinioJob?.project_id ?? selectedMinioObject.project_id);
    put("model_category", selectedMinioJob?.category ?? selectedMinioObject.category);
    put("model_version_id", selectedMinioJob?.external_model_version_id ?? selectedMinioObject.version);
    put("ifc_ready_job_id", selectedMinioJob?.ifc_ready_job_id);
    put("idempotency_key", selectedMinioJob?.idempotency_key ?? selectedMinioObject.idempotency_key);
    return filters;
  }, [sourceKind, selectedMinioObject, selectedMinioJob]);

  useEffect(() => {
    if (!selectedMinioHistoryFilters) {
      setRunHistory(null);
      setRunHistoryTotal(null);
      setRunHistoryErr(null);
      setRunHistoryLoading(false);
      return;
    }
    let alive = true;
    setRunHistoryLoading(true);
    setRunHistoryErr(null);
    governanceClient.listRuleRuns(selectedMinioHistoryFilters)
      .then((res) => {
        if (!alive) return;
        setRunHistory(res.items);
        setRunHistoryTotal(res.total);
      })
      .catch((e) => {
        if (!alive) return;
        setRunHistory([]);
        setRunHistoryTotal(null);
        setRunHistoryErr(String(e));
      })
      .finally(() => {
        if (alive) setRunHistoryLoading(false);
      });
    return () => { alive = false; };
  }, [selectedMinioHistoryFilters, runHistoryRefreshTick]);

  return (
    <>
      <h1>{t("A1 · 治理與模型檢核", "A1 · Governance & Model Validation")}</h1>
      <IncomingHandoffBanner testId="a1-incoming-handoff" handoff={incoming.handoff} status={incoming.status} />
      <p className="ec-lead">{t("選取 MinIO 偵測到的 IFC，先讓 coordinator 綁定 server-local IFC path，再跑 governance-service CPU 規則檢核；3D 檢視與高亮由 Review Room 開啟，不在 A1 自動嵌入 viewer 或 claim lease。", "Select a MinIO-detected IFC, let the coordinator bind the server-local IFC path, then run governance-service CPU validation; 3D review and highlighting open in Review Room, not by auto-embedding or auto-claiming a viewer in A1.")}</p>

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

        <div data-testid="a1-source-picker" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Btn data-testid="a1-source-local" prov={sourceKind === "local_fs" ? "asbuilt" : undefined}
            caption={t("local_fs：governance-service 可讀的 server-local IFC path", "local_fs: server-local IFC path readable by governance-service")}
            onClick={() => {
              if (sourceKind !== "local_fs") {
                dispatch({ type: "RESET" });
                setActionErr(null);
                setA1Issues([]);
                setSelectedSession("");
              }
              setSelectedKey("");
              setSourceKind("local_fs");
            }}>local_fs</Btn>
          <Btn data-testid="a1-source-minio" prov={sourceKind === "minio" ? "asbuilt" : undefined}
            caption={t("MinIO：只作來源物件重驗與回看；不可直接當 ifc_source_path", "MinIO: source-object verification and backlink only; cannot be used directly as ifc_source_path")}
            onClick={() => {
              if (sourceKind !== "minio") {
                dispatch({ type: "RESET" });
                setActionErr(null);
                setA1Issues([]);
              }
              setSourceKind("minio");
            }}>MinIO</Btn>
          {sourceKind === "local_fs" ? (
            <>
              <select data-testid="a1-localfs-select" className="ec-btn" style={{ minWidth: 520 }}
                disabled={fsTree === null || Boolean(fsErr)}
                value={selectedLocalPath}
                onChange={(e) => {
                  const nextPath = e.target.value;
                  setSelectedLocalPath(nextPath);
                  if (state.ifcPath && state.ifcPath !== nextPath) {
                    dispatch({ type: "RESET" });
                    setActionErr(null);
                    setA1Issues([]);
                  }
                }}>
                <option value="">
                  {fsErr ? t("（local_fs 檔案庫不可用）", "(local_fs file library unavailable)") : fsTree === null ? t("載入中…（GET /api/governance/files/tree）", "Loading… (GET /api/governance/files/tree)") : localOptions.length === 0 ? t("（無 local_fs IFC 檔案）", "(no local_fs IFC files)") : t("— 選擇 local_fs IFC —", "— select a local_fs IFC —")}
                </option>
                {localOptions.map((option) => (
                  <option key={option.version.path} value={option.version.path}>
                    {option.projectId} · {option.modelId} · {option.version.name} · {formatBytes(option.version.size_bytes)}
                  </option>
                ))}
              </select>
              <Btn data-testid="a1-step-pick" disabled={!canPickLocal}
                caption={canPickLocal ? t("鎖定 server-local IFC path；只跑 CPU rule-run，不觸發轉檔", "Lock server-local IFC path; run CPU rule-run only, without triggering conversion") : t("先選 local_fs IFC；MinIO object key 不能直接檢核", "Select a local_fs IFC first; a MinIO object key cannot be validated directly")}
                onClick={() => {
                  if (!selectedLocalOption) return;
                  setActionErr(null);
                  setA1Issues([]);
                  dispatch({
                    type: "PICK_FILE",
                    ifcPath: selectedLocalOption.version.path,
                    modelVersionId: selectedLocalOption.modelVersionId,
                  });
                }}>{t("選取模型", "Select Model")}</Btn>
            </>
          ) : (
            <>
              <select data-testid="a1-minio-select" className="ec-btn" style={{ minWidth: 520 }}
                value={selectedKey} onChange={(e) => {
                  const nextKey = e.target.value;
                  setSelectedKey(nextKey);
                  if (state.ifcPath && selectedKey !== nextKey) {
                    dispatch({ type: "RESET" });
                    setSelectedSession("");
                    setActionErr(null);
                    setA1Issues([]);
                  }
                }}>
                <option value="">{minioErr ? t("（MinIO 物件不可用）", "(MinIO objects unavailable)") : minioObjects === null ? t("載入中…", "Loading…") : minioObjects.length === 0 ? t("（無 source_ifc 物件）", "(no source_ifc objects)") : t("— 選擇 MinIO 模型 —", "— select a MinIO model —")}</option>
                {(minioObjects ?? []).map((o) => <option key={o.key} value={o.key}>{minioLabel(o)}</option>)}
              </select>
              <Btn data-testid="a1-step-pick" disabled={!canPickMinioDownloaded}
                caption={canPickMinioDownloaded ? t("鎖定 downloaded IFC job；coordinator 會解析 server-local IFC path", "Lock the downloaded IFC job; the coordinator resolves the server-local IFC path") : selectedMinioResolutionNote}
                onClick={() => {
                  if (!canPickMinioDownloaded || !selectedMinioObject || !selectedMinioJob) return;
                  setActionErr(null);
                  setA1Issues([]);
                  setSelectedSession(selectedMinioSessionId);
                  dispatch({
                    type: "PICK_FILE",
                    ifcPath: selectedMinioSessionId ? `session://${selectedMinioSessionId}` : `ifc-ready://${selectedMinioJob.ifc_ready_job_id}`,
                    modelVersionId: selectedMinioJob.external_model_version_id || selectedMinioObject.version || selectedMinioObject.key,
                  });
                }}>
                {selectedMinioPickLabel}
              </Btn>
            </>
          )}
        </div>
        {fsErr && sourceKind === "local_fs" && <p className="ec-warn-note" data-testid="a1-fs-error" style={{ marginTop: 4 }}>{t("local_fs 檔案庫不可用：", "local_fs file library unavailable: ")}{fsErr}{" "}<Btn data-testid="a1-fs-retry" caption="GET /api/governance/files/tree" onClick={() => { void loadA1FsTree(); }}>{t("重試載入檔案庫", "Retry loading file library")}</Btn></p>}
        {sourceKind === "minio" && <p className="ec-note" data-testid="a1-minio-source-note" style={{ marginTop: 4 }}>{t("A1 CPU 檢核需要 coordinator-resolved server-local IFC path；MinIO key 不會送 POST /api/governance/rule-runs。未被 watcher 偵測到的 MinIO 物件請先由轉檔排程頁觸發 POST /api/conversion/trigger。", "A1 CPU validation needs a coordinator-resolved server-local IFC path; the MinIO key is not sent to POST /api/governance/rule-runs. If the watcher missed a MinIO object, trigger POST /api/conversion/trigger from the conversion schedule page first.")}</p>}
        {sourceKind === "minio" && selectedKey && <p className={canPickMinioDownloaded ? "ec-note" : "ec-warn-note"} data-testid="a1-minio-resolution-note" style={{ marginTop: 4 }}>{selectedMinioResolutionNote}</p>}
        {minioErr && sourceKind === "minio" && <p className="ec-warn-note" data-testid="a1-minio-error" style={{ marginTop: 4 }}>{t("MinIO 物件清單不可用：", "MinIO object list unavailable: ")}{minioErr}</p>}
        {selectedLocalOption && sourceKind === "local_fs" && <p className="ec-note" data-testid="a1-localfs-selected" style={{ marginTop: 4 }}>{t("已選 local_fs：", "Selected local_fs: ")}{selectedLocalOption.version.path}</p>}
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
          <Btn primary data-testid="a1-step-run" disabled={!canRunA1}
            caption={state.ifcPath ? (state.ifcPath.startsWith("ifc-ready://") ? "POST /api/governance/rule-runs/for-ifc-ready/:jobId" : selectedSession ? "POST /api/governance/rule-runs/for-session/:sessionId" : "POST /api/governance/rule-runs") : t("先選定 IFC 模型", "Select an IFC model first")} onClick={doRun}>
            {state.runError ? t("重試檢核", "Retry Validation") : state.step === "running" ? t("檢核中…", "Validating…") : t("執行規則檢核", "Run Rule Validation")}
          </Btn>
          {state.runError && <span className="ec-warn-note">{t("檢核失敗（可重試）：", "Validation failed (retryable): ")}{state.error}</span>}
        </div>
      </Panel>

      {sourceKind === "minio" && selectedKey && (
        <Panel title={t("MinIO IFC 檢核歷史", "MinIO IFC Validation History")} sub={t("依目前選取的 MinIO IFC lineage 查詢 governance rule-runs", "Queries governance rule-runs by the selected MinIO IFC lineage")} prov="asbuilt">
          <div className="ec-grid" data-testid="a1-minio-history-scope" style={{ marginBottom: 10 }}>
            <Field k={t("來源專案", "Source project")} v={selectedMinioObject?.project_display_name || selectedMinioObject?.project_id || "—"} prov="asbuilt" />
            <Field k={t("種類", "Category")} v={selectedMinioObject?.category || selectedMinioJob?.category || "—"} prov="asbuilt" />
            <Field k={t("版本", "Version")} v={selectedMinioJob?.external_model_version_id || selectedMinioObject?.version || "—"} prov="asbuilt" />
            <Field k="ifc_ready_job_id" v={selectedMinioJobId || "—"} prov={selectedMinioJobId ? "asbuilt" : "p1"} />
            <Field k="history_total" v={runHistoryTotal === null ? "—" : String(runHistoryTotal)} prov="asbuilt" />
            <Field k="rollback" v={t("not built（需版本權威 contract）", "not built (requires version authority contract)")} prov="p1" />
          </div>
          {runHistoryLoading && <p className="ec-note" data-testid="a1-minio-history-loading">{t("載入檢核歷史…", "Loading validation history...")}</p>}
          {runHistoryErr && <p className="ec-warn-note" data-testid="a1-minio-history-error">{t("檢核歷史不可用：", "Validation history unavailable: ")}{runHistoryErr}</p>}
          {!runHistoryLoading && !runHistoryErr && runHistory?.length === 0 && (
            <p className="ec-note" data-testid="a1-minio-history-empty">{t("尚無此 MinIO IFC 的檢核歷史。", "No validation history for this MinIO IFC yet.")}</p>
          )}
          {!runHistoryLoading && !runHistoryErr && runHistory && runHistory.length > 0 && (
            <table className="ec-table" data-testid="a1-minio-run-history">
              <thead><tr><th>rule_run_id</th><th>status</th><th>project</th><th>category</th><th>version</th><th>score</th><th>started_at</th></tr></thead>
              <tbody>
                {runHistory.map((row) => {
                  const meta = row.source_metadata ?? {};
                  return (
                    <tr key={row.rule_run_id}>
                      <td>{row.rule_run_id}</td>
                      <td>{row.status}</td>
                      <td>{meta.project_display_name || meta.project_id || "—"}</td>
                      <td>{meta.model_category || "—"}</td>
                      <td>{meta.model_version_id || row.model_version_id || "—"}</td>
                      <td>{row.score ?? "—"}</td>
                      <td>{row.started_at ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      )}

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
          {state.run.source_metadata && (
            <div className="ec-grid" data-testid="a1-run-lineage" style={{ marginTop: 12 }}>
              <Field
                k={t("來源專案", "Source project")}
                v={state.run.source_metadata.project_display_name || state.run.source_metadata.project_id || "—"}
                prov="asbuilt"
              />
              <Field
                k={t("種類", "Category")}
                v={state.run.source_metadata.model_category || "—"}
                prov="asbuilt"
              />
              <Field
                k={t("版本", "Version")}
                v={state.run.source_metadata.model_version_id || state.run.model_version_id || "—"}
                prov="asbuilt"
              />
              <Field
                k="ifc_ready_job_id"
                v={state.run.source_metadata.ifc_ready_job_id || "—"}
                prov="asbuilt"
              />
              <Field
                k="idempotency_key"
                v={state.run.source_metadata.idempotency_key || "—"}
                prov="asbuilt"
              />
              <Field
                k="source_ifc_etag"
                v={state.run.source_metadata.source_ifc_etag || "—"}
                prov="asbuilt"
              />
            </div>
          )}
          {runId && state.failed.length > 0 && <FailureScoreboard runId={runId} failed={state.failed} />}
        </Panel>
      )}

      <Panel title={t("review session（3D 連動目標）", "review session (3D handoff target)")} sub={t("MinIO 來源的 rule-run 優先走 review session，由 coordinator 解析 server-local IFC path；Review Room 負責 attach / highlight trace。", "MinIO-backed rule-runs prefer a review session so the coordinator can resolve the server-local IFC path; Review Room owns attach / highlight trace.")} prov="asbuilt">
        {sessions.length === 0 ? (
          <div data-testid="a1-no-session">
            <p className="ec-note">{t("無 active session。若已有 downloaded IFC-ready job，A1 會直接用 POST /api/governance/rule-runs/for-ifc-ready 排入 governance rule-run；若尚未被 watcher 偵測或未排入下載/轉檔，請到 MinIO/IFC→USD 排程頁觸發 POST /api/conversion/trigger。", "No active session. If a downloaded IFC-ready job exists, A1 uses POST /api/governance/rule-runs/for-ifc-ready to queue the governance rule-run directly; if the object was not detected by the watcher or not scheduled for download/conversion, use the MinIO/IFC→USD schedule page to trigger POST /api/conversion/trigger.")}</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Btn data-testid="a1-trigger-convert" disabled
                caption={t("A1 v2 不觸發 conversion；請到 IFC→USD 轉檔排程頁操作", "A1 v2 does not trigger conversion; use the IFC→USD schedule page")}>
                {t("A1 不排入轉檔", "A1 does not queue conversion")}
              </Btn>
              <a className="ec-s" data-testid="a1-conv-link" href={buildHandoff("minio", { source: "a1", minio_key: sourceKind === "minio" ? selectedKey || undefined : undefined })}>{t("到 MinIO / IFC→USD 排程頁觸發 POST /api/conversion/trigger →", "Trigger POST /api/conversion/trigger in the MinIO / IFC→USD schedule page →")}</a>
            </div>
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
              <Field k="selected session" v={selectedSession || t("not_selected（未綁定 server-local IFC path）", "not_selected (server-local IFC path not bound)")} prov={selectedSession ? "asbuilt" : "p1"} />
              <Field k="3D handoff" v={t("Review Room owns viewer lease / first frame / stage match / highlight trace", "Review Room owns viewer lease / first frame / stage match / highlight trace")} prov="asbuilt" />
              <Field k="A1 auto attach" v={t("disabled by design", "disabled by design")} prov="asbuilt" />
            </div>
          </>
        )}
      </Panel>

      <Panel title={t("A1 bridge rail", "A1 bridge rail")} sub={t("只顯示 Review Room / Viewer 證據；A1 不自動 attach、不 claim lease、不直接送 highlight", "Shows Review Room / Viewer evidence only; A1 does not auto-attach, claim lease, or send highlight directly")} prov="asbuilt">
        <div className="ec-grid" data-testid="a1-bridge-rail">
          <Field k="review_session" v={selectedSession || t("not_selected", "not_selected")} prov={selectedSession ? "asbuilt" : "p1"} />
          <Field k="viewer_lease" v={selectedSessionSummary?.primary_viewer_lease_id ?? t("not_observed", "not_observed")} prov={selectedSessionSummary?.primary_viewer_lease_id ? "asbuilt" : "p1"} />
          <Field k="first_frame_at" v={selectedStageEvidence?.first_frame_at ?? selectedSessionSummary?.first_frame_at ?? t("not_observed", "not_observed")} prov={(selectedStageEvidence?.first_frame_at ?? selectedSessionSummary?.first_frame_at) ? "asbuilt" : "p1"} />
          <Field k="datachannel_ready" v={String(selectedStageEvidence?.datachannel_ready ?? false)} prov={selectedStageEvidence?.datachannel_ready ? "asbuilt" : "p15"} />
          <Field k="stage_match" v={stageMatched ? "matched" : t("not_observed", "not_observed")} prov={stageMatched ? "asbuilt" : "p15"} />
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Btn data-testid="a1-bridge-highlight" disabled
            caption={t("P1.5 disabled：需 Review Room first_frame_at + DataChannel + stage_match 全部為真", "P1.5 disabled: requires Review Room first_frame_at + DataChannel + stage_match all true")}>
            {t("在 3D 中標示", "Highlight in 3D")}
          </Btn>
          <a className="ec-s" href={selectedSession ? buildHandoff("review", { source: "a1", session: selectedSession, rule_run_id: runId ?? undefined }) : "#review?source=a1"}>{t("開啟 Review Room →", "Open Review Room →")}</a>
        </div>
      </Panel>

      <Panel title={t("交付", "Deliverables")} sub={t("開 Issue / 匯出 Excel / 匯出 BCF 2.1 走真實後端；BCF 需先建 Issue（step=issued/delivered）才 enable；3D 交給 Review Room 手動 attach / highlight", "Open Issue / Export Excel / Export BCF 2.1 go through the real backend; BCF is enabled only after Issues are created (step=issued/delivered); 3D is handed off to Review Room for manual attach / highlight")} prov="asbuilt">
        <div data-testid="a1-bcf-review-panel" style={{ marginBottom: 10 }}>
          <div className="ec-grid" style={{ marginBottom: 8 }}>
            <Field k="BCF topics" v={bcfIssues.length > 0 ? String(bcfIssues.length) : t("尚未建立可匯出的正式 Issue", "no exportable formal issues created yet")} prov={bcfIssues.length > 0 ? "asbuilt" : "p1"} />
            <Field k="scope" v={t("只列 kind=issue 且含 ifc_guid 的 BCF topics；annotation 不計入", "only kind=issue rows with ifc_guid are listed as BCF topics; annotations are excluded")} prov="asbuilt" />
          </div>
          {bcfIssues.length === 0 ? (
            <p className="ec-note">{t("先按「失敗構件建 Issue」後，這裡才會列出可追蹤的 BCF topics；未建 Issue 前 BCF 匯出保持 disabled。", "Create Issues for Failed Elements first; this panel then lists trackable BCF topics. BCF export stays disabled before issues exist.")}</p>
          ) : (
            <table className="ec-table">
              <thead><tr><th>topic</th><th>severity</th><th>status</th><th>ifc_guid</th><th>action</th></tr></thead>
              <tbody>
                {bcfIssues.map((issue) => {
                  const next = issue.status === "open" ? "in_progress" : issue.status === "in_progress" ? "resolved" : null;
                  return (
                    <tr key={issue.id}>
                      <td>{issue.title}</td>
                      <td>{issue.severity}</td>
                      <td>{issue.status}</td>
                      <td>{issue.ifc_guid ?? "—"}</td>
                      <td>
                        <Btn data-testid={`a1-issue-transition-${issue.id}`} disabled={!next}
                          caption={next ? `POST /api/governance/issues/${issue.id}/transition -> ${next}` : t("已是終態或不支援轉移", "terminal or unsupported transition")}
                          onClick={() => { void transitionA1Issue(issue); }}>
                          {next ?? t("無下一步", "No next step")}
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
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
          const bcfEnabled = state.issuesCreated && bcfIssues.length > 0 && (state.step === "issued" || state.step === "delivered");
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
          const disabledReason = a1ReviewRoomHandoffReason(f0);
          const expectedStageUrl = sessions.find((s) => s.session_id === selectedSession)?.expected_stage_url ?? null;
          const href = buildA1ReviewRoomHandoffHash({ sessionId: selectedSession || undefined, runId, row: f0, expectedStageUrl });
          return (
            <Btn data-testid="a1-open-review-room"
              disabled={Boolean(disabledReason)}
              caption={disabledReason || (selectedSession
                ? t("開啟 #review 並帶入目前 review session / 第一筆失敗構件", "Open #review with the selected review session and first failed element")
                : t("開啟 #review；可在 Review Room 內選 session / attach Kit 再高亮", "Open #review; choose a session and attach Kit inside Review Room before highlighting"))}
              onClick={() => {
                if (!f0?.ifc_guid) return;
                window.location.hash = href;
              }}>
              {t("開啟 3D Review Room", "Open 3D Review Room")}
            </Btn>
          );
        })()}{" "}
        {/* 七軸 cross-link chips（§4.3）：回看 MinIO 來源物件、跳 Session 管理檢視此 session。
            證據型——目標 id 不存在時誠實 disabled，不製造無效跳轉。 */}
        <span className="ec-crosslinks" data-testid="a1-crosslinks" style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", marginLeft: 8 }}>
          <Btn
            data-testid="a1-link-minio"
            disabled={sourceKind !== "minio" || !selectedKey}
            caption={sourceKind === "minio" && selectedKey ? t("回看 MinIO 來源物件", "View the source object in MinIO") : t("尚未選取 MinIO 物件", "No MinIO object selected")}
            // as-built（既知差異，spec §4.3 A1→M 表下註）：spec 範例寫 prefix，本 chip 刻意送 minio_key（更精確，
            // 指向確切檔案；M 端做 key-level 重驗）。minio_key 本就列於 §4.3「帶的 ID」欄，屬合規選擇。M 的 prefix
            // 收件分支保留供未來「純資料夾回看」按鈕，目前無真實按鈕發送 prefix。
            onClick={() => { if (sourceKind !== "minio" || !selectedKey) return; window.location.hash = buildHandoff("minio", { source: "a1", minio_key: selectedKey }); }}
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
  const loadSeqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setErr(null);
    try {
      const next = await coordinatorClient.runtimeStatus();
      if (seq === loadSeqRef.current) setRt(next);
    }
    catch (e) {
      if (seq === loadSeqRef.current) {
        setErr(`${t("未連線 coordinator /api/runtime/status：", "Not connected to coordinator /api/runtime/status: ")}${String(e)}`);
      }
    }
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
  useEffect(() => {
    void load();
    const id = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(id);
  }, [load]);
  const sessions = rt?.sessions.items ?? [];
  // Task 14（A1/CV/RT→SS 接收端重驗）：向已抓取的 rt.sessions.items 重驗 incoming session；
  // 查無 → 誠實 not_found，不靜默改選其他 active session。
  // Task14 Important #1：rt===null=runtime status 尚未載入。載入中回中性 indeterminate，不誤閃 not_found；
  // rt 已載入（sessions 可能為 []）才判 not_found。
  const incoming = useIncomingHandoff("sessions", (h) => {
    // 無 session（例：KG demo-row chip 送 #sessions?source=instances 不帶 id）＝無欄位可查＝not_applicable，
    // 不得誤成假 not_found（p5-critic honesty regression）。
    if (!h.session) return "not_applicable";
    if (rt === null) return "indeterminate";
    return sessions.some((s) => s.session_id === h.session);
  });
  return (
    <>
      <h1>{t("Session 管理 · Primary / Spectator ATC", "Session Management · Primary / Spectator ATC")}</h1>
      <IncomingHandoffBanner testId="sessions-incoming-handoff" handoff={incoming.handoff} status={incoming.status} />
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
          <table className="ec-table"><thead><tr><th>session</th><th>status</th><th>participants</th><th>conversion</th><th>stage</th><th>首幀</th><th>心跳</th><th>stage 符合</th><th>動作</th></tr></thead>
            {/* terminating 中的列「不過濾」：spec §4.3 的 60s 移除靠 markTerminating 的 timer
                從 terminatingIds 移除 id（解灰列），最終離開可見列則靠 load() 重抓 runtime/status。
                故此處直接 .map() 全列渲染；terminating 列只轉灰並顯「結束中…」，不可在這裡 filter 掉，
                否則灰列會立刻消失、60s UX 失效。 */}
            <tbody>{sessions.map((s) => {
              const terminating = terminatingIds.has(s.session_id);
              const ended = s.status === "closing" || s.status === "closed";
              const greyed = terminating || ended;
              // reviewer P2（CodeRabbit + Codex 兩位獨立命中同一發現，已核實）：KG/Review 跨頁連結原本不分
              // session 狀態一律可點，與 CoordinatorPage 對等 Panel（rt-crosslinks）已落實的 gating 不一致。
              // Review Room / KG 機隊只把 active/created session 當即時可觀察/可 attach（比照後端
              // isSessionMutable、ReviewSessionViewerPane 的篩選條件——created 尚未綁 Kit 但已可 attach，
              // 不是「結束」）；對 closing/closed/failed 給滿血按鈕會導向「點了但打不開」的死路，違反 N5 誠實鐵律。
              const live = s.status === "active" || s.status === "created";
              return (
                <tr key={s.session_id} className={greyed ? "ec-row-muted" : undefined} data-testid={`session-row-${s.session_id}`} data-terminating={terminating ? "true" : undefined}>
                  <td>{s.session_id}</td><td>{s.status}</td><td>{s.participant_count}</td><td>{s.conversion_status ?? "—"}</td><td>{s.expected_stage_url ?? "—"}</td>
                  {(() => {
                    const ev = leaseEvidence(s, Date.now());
                    const na = t("未取得", "not observed");
                    return (<>
                      <td data-testid="ev-first-frame">{ev.firstFrameAt ? new Date(ev.firstFrameAt).toLocaleTimeString() : na}</td>
                      <td data-testid="ev-heartbeat">{ev.lastHeartbeatAt
                        ? <>{new Date(ev.lastHeartbeatAt).toLocaleTimeString()}{ev.heartbeatStale ? <span className="ec-prov ec-p1" style={{ marginLeft: 4 }}>stale</span> : null}</>
                        : na}</td>
                      <td data-testid="ev-stage">{ev.stageMatch === true ? "matched" : ev.stageMatch === false ? t("不符", "mismatch") : na}</td>
                    </>);
                  })()}
                  <td>
                    {s.status === "active" && !terminating ? (
                      <Btn data-testid={`session-terminate-${s.session_id}`} onClick={() => { setActionErr(null); setPendingTerminate({ sessionId: s.session_id }); }}>{t("結束 session", "Terminate session")}</Btn>
                    ) : <span className="ec-note">{terminating ? t("結束中…", "Terminating…") : "—"}</span>}
                    {" "}
                    <Btn data-testid={`session-link-instances-${s.session_id}`} disabled={!live}
                      title={live ? undefined : t("session 已結束，KG 機隊僅即時 active/created session 可導覽", "Session ended; KG Fleet only navigates live active/created sessions")}
                      caption={live ? t("此 session 落在哪個 GPU node（KG 遙測未取得）", "Which GPU node hosts this session (KG telemetry not available)") : t("session 已結束", "session ended")}
                      onClick={() => { window.location.hash = buildHandoff("instances", { source: "sessions", session: s.session_id }); }}>KG →</Btn>
                    {" "}
                    <Btn data-testid={`session-link-review-${s.session_id}`} disabled={!live}
                      title={live ? undefined : t("session 已結束，Review Room 僅即時 active/created session 可開", "Session ended; Review Room only opens live active/created sessions")}
                      caption={live ? t("在 Review Room 開此 session", "Open this session in Review Room") : t("session 已結束", "session ended")}
                      onClick={() => { window.location.hash = buildHandoff("review", { source: "sessions", session: s.session_id }); }}>Review →</Btn>
                    {" "}
                    <Btn data-testid={`session-link-a1-${s.session_id}`} caption={t("回 A1 治理檢核", "Back to A1 governance")}
                      onClick={() => { window.location.hash = buildHandoff("a1", { source: "sessions", session: s.session_id }); }}>A1 →</Btn>
                  </td>
                </tr>
              );
            })}</tbody></table>
        ) : <p className="ec-note">{t("目前 runtime status 無 active session；下面 endpoint pool 為治理規則示意。", "Runtime status currently has no active session; the endpoint pool below illustrates governance rules.")}</p>}
      </Panel>
      <Panel title={t("A1 連動橋供應端", "A1 bridge supply")} prov="asbuilt"
        sub={t("單一證據來源＝本頁 /api/runtime/status（IX-SS-05）；highlight ack 權威＝Review Room command trace，本面板不推定", "Single evidence source = this page /api/runtime/status (IX-SS-05); highlight ack authority = Review Room command trace, this panel does not infer it")}>
        <div data-testid="a1-bridge-supply">
          {sessions.filter((s) => s.status === "active" || s.status === "created").map((s) => {
            const ev = leaseEvidence(s, Date.now());
            const na = t("未取得", "not observed");
            return (
              <div key={s.session_id} data-testid={`supply-${s.session_id}`} className="ec-s" style={{ marginBottom: 4 }}>
                <code>{s.session_id}</code>
                {" ⇢ lease "}{s.primary_viewer_lease_id ?? na}
                {" ⇢ "}{ev.datachannelReady ? "DataChannel ✓" : `DataChannel ${na}`}
                {" ⇢ "}{ev.stageMatch === true ? "stage matched" : `stage ${na}`}
                {" ⇢ 首幀 "}{ev.firstFrameAt ? new Date(ev.firstFrameAt).toLocaleTimeString() : na}
                {" · "}<a href={buildHandoff("review", { source: "sessions", session: s.session_id })}>{t("Review Room（ack trace）→", "Review Room (ack trace) →")}</a>
              </div>
            );
          })}
          {sessions.every((s) => s.status !== "active" && s.status !== "created") && (
            <p className="ec-note">{t("無 active session；A1 連動橋在 #a1 端維持 idle。", "No active session; the A1 bridge stays idle on #a1.")}</p>
          )}
        </div>
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

// 七軸和諧整合 §7 KG（`#instances`）：呈現「真 session 聚合」（asbuilt，來自 GET /api/runtime/status）
// 與 kit-manager current instance（asbuilt，來自 coordinator proxy）。多節點 fleet / GPU 數值遙測仍未取得（OQ3）。
export function KitGpuFleetPage() {
  const shared = useSharedStatus();
  const [kit, setKit] = useState<KitInstanceState | null>(null);
  const [kitErr, setKitErr] = useState<string | null>(null);
  const kitLoadSeqRef = useRef(0);
  const kitMountedRef = useRef(false);
  // sessionsById 依 spec §5.2 是全量表（不分狀態，供跨頁 ID 查找重用），且 coordinator 從不刪除 session
  // （只 active→closing→closed）。此「即時 session 聚合（真實）」區塊只能把 status==='active' 當即時可點連結，
  // 才與相鄰的「使用中 session 數」（activeSessions，亦只算 active）一致；否則會把 closed/closing 的過期
  // session 假裝成真實可操作（違反 N5 誠實鐵律）。
  const liveIds = Object.values(shared.sessionsById).filter((s) => s.status === "active").map((s) => s.session_id);
  // Task 14（SS/RT→KG 接收端重驗）：向已讀的 shared.sessionsById 全量表重驗 incoming session；
  // 查無 → 誠實 not_found，不靜默假裝該 session 存在。
  // quality CRITICAL #1（物件注入防護）：sessionsById 是 plain {} 字面量，直接 bracket 存在性判斷會讓
  // 繼承自 Object.prototype 的名字（constructor/toString/__proto__/hasOwnProperty…）查到真實成員而恆真，
  // 對從未存在的 session 假報 verified（違反 §4.2「持有 ID ≠ 已授權」）。改用 own-property 檢查只認真正的 key。
  // Task14 Important #1：shared.stale=true 代表 SharedStatusProvider 尚未輪詢過（等同 EMPTY_SHARED_STATUS）。
  // 尚未輪詢時 sessionsById 恆為空 {}，任何 session 都會誤判 not_found；故載入中回中性 indeterminate。
  const incoming = useIncomingHandoff("instances", (h) => {
    // 無 session＝無欄位可查＝not_applicable（與其他軸一致，避免同類假 not_found；p5-critic honesty regression）。
    if (!h.session) return "not_applicable";
    if (shared.stale) return "indeterminate";
    return Object.prototype.hasOwnProperty.call(shared.sessionsById, h.session);
  });
  const loadKit = useCallback(async () => {
    const seq = ++kitLoadSeqRef.current;
    try {
      const state = await coordinatorClient.kitInstanceCurrent();
      if (kitMountedRef.current && seq === kitLoadSeqRef.current) {
        setKit(state);
        setKitErr(null);
      }
    } catch (e) {
      if (kitMountedRef.current && seq === kitLoadSeqRef.current) setKitErr(String(e));
    }
  }, []);
  useEffect(() => {
    kitMountedRef.current = true;
    void loadKit();
    const id = window.setInterval(() => { void loadKit(); }, 5000);
    return () => { kitMountedRef.current = false; window.clearInterval(id); };
  }, [loadKit]);
  return (
    <>
      <h1>{t("Kit / GPU 機隊", "Kit / GPU Fleet")}</h1>
      <IncomingHandoffBanner testId="kg-incoming-handoff" handoff={incoming.handoff} status={incoming.status} />
      <p className="ec-lead">{t("此頁是 runtime operator 的機隊視角：哪台 GPU 在服務哪個 Kit stream，哪台可接新 session，哪些節點 drain，哪些 restart/release 必須由 Kit Manager 執行。", "This page is the runtime operator's fleet view: which GPU serves which Kit stream, which can accept a new session, which nodes are draining, and which restart/release must be executed by the Kit Manager.")}</p>
      <Panel title={t("即時 session 聚合（真實）", "Live session aggregate (real)")} sub={t("讀共享狀態列（GET /api/runtime/status）；GPU per-node 遙測未取得，故只呈現 session 聚合，不假裝映射到節點", "Reads the shared status rail (GET /api/runtime/status); GPU per-node telemetry is not available, so only the session aggregate is shown, not a fake node mapping")} prov="asbuilt">
        <div className="ec-grid" data-testid="kg-live-aggregate">
          <Field k={t("使用中 session 數", "active sessions")} v={String(shared.activeSessions)} prov="asbuilt" />
          <Field k="GPU busy / total" v={t("未取得（kit-manager 遙測待建）", "not available (kit-manager telemetry not built)")} prov="demo" />
        </div>
        {liveIds.length > 0 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {liveIds.map((id) => (
              <Btn key={id} data-testid={`kg-session-link-${id}`} caption={t("在 Session 管理檢視", "View in Session Management")}
                onClick={() => { window.location.hash = buildHandoff("sessions", { source: "instances", session: id }); }}>{id} →</Btn>
            ))}
          </div>
        ) : <p className="ec-note">{t("目前無使用中 session（來自共享狀態列）。", "No active session at the moment (from the shared status rail).")}</p>}
      </Panel>
      <Panel title="Fleet model" sub={t("Coordinator 顯示治理狀態，不直接管理 GPU process", "Coordinator shows governance state and does not directly manage the GPU process")} prov="asbuilt">
        <div className="ec-grid">
          <MiniCard code="1 GPU" title="1 GPU = 1 Kit stream" desc={t("primary 使用獨立 Kit stream；spectator 預設共享同一 stream，除非未來需求是獨立視角。", "Primary uses a dedicated Kit stream; spectators share the same stream by default unless a future requirement needs independent views.")} prov="asbuilt" />
          <MiniCard code="drain" title={t("排空不接新 session", "Drain accepts no new session")} desc={t("drain 後 existing session 可跑完；新 session 不再派到該節點。", "After drain, existing sessions can finish; new sessions are no longer assigned to that node.")} prov="p1" />
          <MiniCard code="move" title={t("搬移不是無縫遷移", "Move is not seamless migration")} desc={t("拖 session 到另一台 GPU 表示 terminate + recreate，約 30-40s 並重載 stage。", "Dragging a session to another GPU means terminate + recreate, about 30-40s and reloading the stage.")} prov="p1" />
        </div>
      </Panel>
      <Panel title={t("Kit instance（真遙測）", "Kit instance (live)")} prov="asbuilt"
        sub={t("來源：coordinator /api/kit/instances/current → kit-manager-api :8010；多節點 fleet 遙測 NOT BUILT（Spec-0 §4 backlog）", "Source: coordinator /api/kit/instances/current → kit-manager-api :8010; multi-node fleet telemetry is NOT BUILT (Spec-0 §4 backlog)")}>
        <div data-testid="kg-live-instance">
          {kitErr || !kit ? (
            <p className="ec-note">
              {t("未取得（kit-manager 未回應）", "not observed (kit-manager unavailable)")}
              {kitErr ? ` — ${kitErr}` : ""}
            </p>
          ) : (
            <div className="ec-grid">
              <Field k="instance_id" v={kit.instance_id} prov="asbuilt" />
              <Field k="status" v={kit.status} prov="asbuilt" />
              <Field k="control_status" v={kit.control_status} prov="asbuilt" />
              <Field k="opened_runtime_uris" v={kit.opened_runtime_uris.join(", ") || "—"} prov="asbuilt" />
              <Field k="GPU busy / total" v={t("未取得（kit-manager 遙測待建）", "not available (kit-manager telemetry not built)")} prov="demo" />
            </div>
          )}
        </div>
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
  const [kit, setKit] = useState<KitInstanceState | null>(null);
  const [kitErr, setKitErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null); setKitErr(null);
    try {
      const [runtimeResult, kitResult] = await Promise.allSettled([
        coordinatorClient.runtimeStatus(),
        coordinatorClient.kitInstanceCurrent(),
      ]);
      if (runtimeResult.status === "fulfilled") {
        setRt(runtimeResult.value);
      } else {
        setErr(`${t("未連線 coordinator /api/runtime/status：", "Not connected to coordinator /api/runtime/status: ")}${String(runtimeResult.reason)}`);
      }
      if (kitResult.status === "fulfilled") {
        setKit(kitResult.value);
      } else {
        setKit(null);
        setKitErr(String(kitResult.reason));
      }
    }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const sessions = rt?.sessions?.items ?? null;
  const observedSessions = sessions ?? [];
  const sessionsSummary = sessions === null
    ? t("未取得", "not observed")
    : `active ${sessions.filter((s) => s.status === "active").length} · created ${sessions.filter((s) => s.status === "created").length}`;
  const evidenceGreen = sessions === null
    ? t("未取得", "not observed")
    : String(sessions.filter((s) => {
      const ev = leaseEvidence(s, Date.now());
      return Boolean(ev.firstFrameAt && ev.datachannelReady && ev.stageMatch === true && ev.heartbeatStale === false);
    }).length);

  return (
    <>
      <h1>Coordinator Console · C / Hybrid Runtime Orchestrator</h1>
      <p className="ec-lead">
        {t("會議生命週期 / Kit 綁定 / IFC-ready 派工 / callback outbox，全經 coordinator :8004。 本頁讀", "Session lifecycle / Kit binding / IFC-ready dispatch / callback outbox all go through coordinator :8004. This page reads")} <code>/api/runtime/status</code>{t("（coordinator-visible read-only summary）；瀏覽器不直連 49100/49101/49102。 誠實標示：Kit 首幀 / GPU 無統一遙測（port listening ≠ has frame）→ 不畫成 fail、不捏造秒數。", " (coordinator-visible read-only summary); the browser does not directly reach 49100/49101/49102. Honesty labeling: Kit first frame / GPU have no unified telemetry (port listening ≠ has frame) → not rendered as fail and no fabricated seconds.")}
      </p>
      <ProvLegend />
      <Panel title={t("監控彙總", "Monitoring summary")} prov="asbuilt"
        sub={t("session 證據與 Kit 狀態彙總；無統一 GPU 遙測，不畫 fail、不捏造秒數", "Session evidence and Kit status summary; no unified GPU telemetry, so no fail state or fabricated seconds")}>
        <div className="ec-grid" data-testid="rt-monitor-summary">
          <Field k="sessions" v={sessionsSummary} prov={sessions === null ? "demo" : "asbuilt"} />
          <Field
            k={t("證據齊備 session", "evidence-green sessions")}
            v={evidenceGreen}
            prov={sessions === null ? "demo" : "asbuilt"}
          />
          <Field k="kit" v={kit ? `${kit.instance_id} · ${kit.status}` : t("未取得", "not observed")} prov={kit ? "asbuilt" : "demo"} />
          <Field k="GPU / VRAM" v={t("未取得", "not observed")} prov="demo" />
          {kitErr ? <Field k="kit error" v={kitErr} prov="demo" /> : null}
        </div>
      </Panel>
      <CoordinatorGovernanceTabs rt={rt} busy={busy} err={err} onRefresh={load} />
      <Panel title={t("跨頁 session 連結", "Cross-page session links")} sub={t("值班視圖：把 runtime session 帶到 Session 管理 / Review Room / Kit 機隊（同一份 runtime 真相）", "Duty view: take a runtime session to Session Management / Review Room / Kit Fleet (one runtime truth)")} prov="asbuilt">
        <div data-testid="rt-crosslinks">
          {/* N5 誠實鐵律：err（載入/Refresh 失敗）先浮出，且與「確實無 session」分流——rt===null 代表尚未取得
              runtime 真相（載入中或初載失敗），不得渲染成 confirmed-empty。Refresh 失敗時 load() 只 setErr、
              不重置 rt，rt 會停在 0-session 舊真相，故 confirmed-empty 文案亦需 err 守門（比照原 IntakePage 模式，該頁已併入 ModelDataPage），
              有 err 時讓位給上方紅字，避免「連不上」與「確實無 session（非錯誤）」自相矛盾並存。 */}
          {err && <p className="ec-warn-note">{err}</p>}
          {rt === null ? (
            err ? null : <p className="ec-note">{t("讀取 runtime status 中…", "Loading runtime status…")}</p>
          ) : rt.sessions.items.length === 0 ? (
            <p className="ec-note">{err ? "" : t("目前 runtime status 無 session（coordinator 已連線，非錯誤）。", "No session in runtime status (coordinator connected — not an error).")}</p>
          ) : (
            <table className="ec-table"><thead><tr><th>session</th><th>status</th><th>{t("跨頁", "Links")}</th></tr></thead>
              <tbody>{observedSessions.map((s) => {
                // N5 誠實鐵律：coordinator 從不刪除 session（只 active→closing→closed，永遠保留），此全量表隨時間無界成長。
                // 「在 Review Room 開此 session」「Kit / GPU 機隊」是即時可操作語意，只有 status==='active'/'created' 成立；對 closed/closing
                // 的過期 session 給滿血按鈕＝把過期 session 假裝成真實可操作（比照同分支 0860a54）。「Session 管理」是 lifecycle 全量
                // 治理視圖，對已結束 session 給連結語意合理，保留 enabled。
                // reviewer P2（Codex，已核實）：session 剛建立、尚未綁 Kit 時 status 是 "created"（非 "active"，
                // bim-review-coordinator/src/services/sessionStore.ts:48）；後端 isSessionMutable 與前端
                // ReviewSessionViewerPane 都把 created 當可 attach，只判 active 會把全新 session 誤標成「已結束」。
                const live = s.status === "active" || s.status === "created";
                return (
                <tr key={s.session_id}>
                  <td>{s.session_id}</td><td>{s.status}</td>
                  <td>
                    <Btn data-testid={`rt-link-sessions-${s.session_id}`} caption={t("Session 管理", "Session Management")}
                      onClick={() => { window.location.hash = buildHandoff("sessions", { source: "runtime", session: s.session_id }); }}>SS →</Btn>{" "}
                    <Btn data-testid={`rt-link-review-${s.session_id}`} disabled={!live}
                      title={live ? undefined : t("session 已結束，Review Room 僅即時 active/created session 可開", "Session ended; Review Room only opens live active/created sessions")}
                      caption={live ? t("在 Review Room 開此 session", "Open in Review Room") : t("session 已結束", "session ended")}
                      onClick={() => { window.location.hash = buildHandoff("review", { source: "runtime", session: s.session_id }); }}>Review →</Btn>{" "}
                    <Btn data-testid={`rt-link-instances-${s.session_id}`} disabled={!live}
                      title={live ? undefined : t("session 已結束，Kit / GPU 機隊僅即時 active/created session 可導覽", "Session ended; Kit / GPU Fleet only navigates live active/created sessions")}
                      caption={live ? t("Kit / GPU 機隊", "Kit / GPU Fleet") : t("session 已結束", "session ended")}
                      onClick={() => { window.location.hash = buildHandoff("instances", { source: "runtime", session: s.session_id }); }}>KG →</Btn>
                  </td>
                </tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
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
