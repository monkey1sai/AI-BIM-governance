// Edge Console 頁面。誠實原則：AS-BUILT 才標已實作；待建一律標 p1/p15 並說明；
// 任何數字非真即標 artifact / demo，絕不捏造。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "./i18n";
import { Btn, Field, Metric, Panel, ProvTag, ProvLegend } from "./components";
import { A1A10, A1A10_DETAIL, AppCardDef, AppVisionDetail, DEPENDENCIES, ENDPOINTS, PAGES, Prov, SERVICES } from "./data";
import { CoordReport, FederatedBuildResult, FileProjectRow, governanceClient, IssueRow, ReviewRoomDescriptor, RuleResultRow, RuleRunStatus } from "./governanceClient";
import { coordinatorClient, CreateReviewSessionResponse, IfcReadyListItem, KitInstanceState, RuntimeSessionSummary, RuntimeStatus } from "./coordinatorClient";
// [Task 9 MD 三頁合一] CV/M/IN 三頁移除後，conversionShared 其餘符號（CoverageDrawer/chip/role…）改由
// modelData/ 內的 pane 消費；本檔僅剩 LifecycleStrip（A1GovernanceWorkbenchPage stepper 仍用）。
import { CoordinatorGovernanceTabs } from "./coordinator/RuntimeGovernanceTabs";
import { ClosedSessionRecovery } from "./ClosedSessionRecovery";
import { ReviewSessionViewerPane } from "./ReviewSessionViewerPane";
import { WorkspaceViewerMount } from "./unified/WorkspaceViewerMount";
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
import { FailureScoreboard } from "./FailureScoreboard";
export { A1GovernanceWorkbenchPage } from "./A1GovernanceWorkbenchPage";
export { FailureRuleRow } from "./FailureScoreboard";


// A1 真實 IFC 驗證 artifact（committed evidence，PR #151；非捏造，為實測值）。
const A1_EVIDENCE = { schema: "IFC4X3", file: "fixture-bytes.ifc", total: 7126, uniqueElements: 6715, passed: 7055, failed: 71, score: 99.0, date: "2026-06-02" };

// A1/Issue legacy manual path fallback is env-only. Do not bake host absolute
// paths into browser code; normal A1 uses file-tree / ifc-ready server resolvers.
function defaultA1IfcPath(): string {
  return import.meta.env.VITE_A1_DEFAULT_IFC_PATH || "";
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

      <Panel title="Phase Backlog" sub={t("近期重點 A1–A4；A5–A10 為 ROADMAP", "Near-term focus A1–A4; A5–A10 are ROADMAP")}>
        <Field k={t("A1 治理與模型檢核（rule-run authority）", "A1 Governance & model validation (rule-run authority)")} v={t("backend 已實作", "backend implemented")} prov="asbuilt" />
        <Field k={t("A2 版本差異 · A3 Federation", "A2 Version diff · A3 Federation")} v={t("已實作（GlobalId diff + USD sublayer federation）", "Implemented (GlobalId diff + USD sublayer federation)")} prov="asbuilt" />
        <Field k={t("Issue 資料庫（lifecycle + audit + 來源綁定）· IDS 匯入", "Issue database (lifecycle + audit + source binding) · IDS import")} v={t("已實作", "Implemented")} prov="asbuilt" />
        <Field k={t("BCF 匯出（issue→.bcfzip）", "BCF export (issue→.bcfzip)")} v={t("已實作（純 stdlib，不依賴 GPLv3）", "Implemented (pure stdlib, no GPLv3 dependency)")} prov="asbuilt" />
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
  const sessions = useMemo(() => rt?.sessions.items ?? [], [rt]);
  const liveSessions = sessions.filter((session) => session.status === "active" || session.status === "created");
  const delegatedCloseHandledRef = useRef(false);
  useEffect(() => {
    if (delegatedCloseHandledRef.current || rt === null) return;
    const query = window.location.hash.split("?", 2)[1] ?? "";
    const params = new URLSearchParams(query);
    const delegatedSessionId = params.get("session");
    if (
      params.get("intent") === "close"
      && delegatedSessionId
      && sessions.some((session) => session.session_id === delegatedSessionId && session.status === "active")
    ) {
      delegatedCloseHandledRef.current = true;
      setPendingTerminate({ sessionId: delegatedSessionId });
      setActionErr(null);
    }
  }, [rt, sessions]);
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
        {liveSessions.length ? (
          <table className="ec-table"><thead><tr><th>session</th><th>status</th><th>participants</th><th>conversion</th><th>stage</th><th>首幀</th><th>心跳</th><th>stage 符合</th><th>動作</th></tr></thead>
            {/* terminating 中的列「不過濾」：spec §4.3 的 60s 移除靠 markTerminating 的 timer
                從 terminatingIds 移除 id（解灰列），最終離開可見列則靠 load() 重抓 runtime/status。
                故此處直接 .map() 全列渲染；terminating 列只轉灰並顯「結束中…」，不可在這裡 filter 掉，
                否則灰列會立刻消失、60s UX 失效。 */}
            <tbody>{liveSessions.map((s) => {
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
                      <Btn data-testid={`session-terminate-${s.session_id}`} onClick={() => { setActionErr(null); setPendingTerminate({ sessionId: s.session_id }); }}>{t("結束 Review Session", "Close Review Session")}</Btn>
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
                    {/* IA v2：#a1 已讓位給 unified workspace（fixture 語意）；真 A1 工作台在 #a1-workbench，
                        target 改指之（接收端 useIncomingHandoff("a1") 以 startsWith("#a1") 判定，兩形皆命中）。 */}
                    <Btn data-testid={`session-link-a1-${s.session_id}`} caption={t("回 A1 治理檢核", "Back to A1 governance")}
                      onClick={() => { window.location.hash = buildHandoff("a1-workbench", { source: "sessions", session: s.session_id }); }}>A1 →</Btn>
                  </td>
                </tr>
              );
            })}</tbody></table>
        ) : <p className="ec-note">{t("目前 runtime status 無 active session；下面 endpoint pool 為治理規則示意。", "Runtime status currently has no active session; the endpoint pool below illustrates governance rules.")}</p>}
      </Panel>
      <Panel title={t("已封存 Session", "Archived Sessions")} sub={t("分頁讀取 closed Session；只有 USDC 與 mapping 仍可由 coordinator 驗證時才可重建。", "Paginated closed Sessions; recreation is enabled only when coordinator can still verify the USDC and mapping.")} prov="asbuilt">
        <ClosedSessionRecovery compact />
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
      {pendingTerminate && (
        <div className="ec-modal-backdrop" data-testid="intent-dialog">
          <div className="ec-modal" role="dialog" aria-modal="true" aria-labelledby="close-session-title">
            <h3 id="close-session-title">{t("永久結束 Session", "Permanently close Session")}</h3>
            <p className="ec-warn-note">{t("此動作不可逆。原 Session 將永久維持 closed；若成果仍可用，只能另建新的 Session ID。", "This action is irreversible. The original Session remains permanently closed; if artifacts remain usable, only a different new Session ID can be created.")}</p>
            <label className="ec-field-k" htmlFor="intent-reason">{t("原因（可空）", "Reason (optional)")}</label>
            <textarea id="intent-reason" className="ec-input" disabled={actionBusy} rows={2} />
            <div className="ec-modal-actions">
              <Btn data-testid="intent-cancel" disabled={actionBusy} onClick={() => { setActionErr(null); setPendingTerminate(null); }}>{t("取消", "Cancel")}</Btn>
              <Btn data-testid="intent-confirm" disabled={actionBusy} onClick={() => {
                const reason = (document.getElementById("intent-reason") as HTMLTextAreaElement | null)?.value ?? "";
                void runTerminate(reason);
              }}>{actionBusy ? t("結束中…", "Closing...") : t("永久結束 Session", "Permanently close Session")}</Btn>
            </div>
            {actionErr && <p className="ec-warn-note" data-testid="intent-action-error">{actionErr}</p>}
          </div>
        </div>
      )}
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

// A6 消歧義（2026-07-10）：roadmap 願景 tier 的 phase 是「規劃優先序」非實作進度——
// 裸印「Phase 2」會與同卡 ProvTag「願景 · Phase 4（後端未建）」讀成兩套矛盾進度。
// p3/p4 顯示「規劃序 P{n}」；focus tier（asbuilt）維持 Phase 標示。狀態一律以 prov 為準（README §4）。
function roadmapPhaseText(p: { phase: number; prov: Prov }): string {
  return p.prov === "p3" || p.prov === "p4" ? `${t("規劃序 P", "Priority P")}${p.phase}` : `Phase ${p.phase}`;
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
      <div className="ec-s">{a.en} · {a.dep} · {roadmapPhaseText(a)}</div>
    </div>
  );
  return (
    <>
      <h1>{t("應用導引 · Applications A1–A10", "Application guide · Applications A1–A10")}</h1>
      <p className="ec-lead">
        {t("十個應用模組入口。Focus＝A1–A4（A4＝deterministic 語意查詢 live／PARTIAL）；A5–A10 為 ROADMAP 願景詳頁（**後端未建**）。", "Ten application modules. Focus = A1–A4 (A4 = deterministic semantic search live / PARTIAL); A5–A10 are ROADMAP vision pages (**backend not built**).")}
      </p>
      <Panel title={t("近期重點 · Focus", "Near-term focus · Focus")} sub={t("A1–A4（A4 live partial · #a4）", "A1–A4 (A4 live partial · #a4)")}>
        <div className="ec-grid">{focus.map(Card)}</div>
      </Panel>
      <Panel title={t("後期願景 · Roadmap", "Later vision · Roadmap")} sub={t("A5–A10 · Phase 3–4（後端未建，點卡看願景詳頁）", "A5–A10 · Phase 3–4 (backend not built; click a card to see the vision detail page)")}>
        <div className="ec-grid">{roadmap.map(Card)}</div>
      </Panel>
    </>
  );
}

// ── P3-1 A5–A10 vision 詳頁（A4 live #a4；本元件只服務 A1A10_DETAIL）──
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
      <p className="ec-lead">{d.en} · {roadmapPhaseText(d)} · {d.pitch}</p>
      <Btn caption={t("回 Applications", "Back to Applications")} onClick={() => onOpen("apps")}>{t("← 回應用導引", "← Back to application guide")}</Btn>

      <Panel title={t("目標 · Goal", "Goal · Goal")} sub={t("此應用後端未建；以下為願景規格（roadmap）", "This application's backend is not built; the following is a vision spec (roadmap)")} prov={d.prov}>
        <p className="ec-note" style={{ color: "var(--ab-text-2)" }}>{d.goal}</p>
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
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ab-text-2)" }}>{d.ui.map((x) => <li key={x}>{x}</li>)}</ul>
      </Panel>

      <Panel title={t("MVP 驗收條件（願景）", "MVP acceptance criteria (vision)")} prov={d.prov}>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ab-text-2)" }}>{d.mvp.map((x) => <li key={x}>{x}</li>)}</ul>
      </Panel>

      <Panel title={t("Sprint steps（願景）", "Sprint steps (vision)")} prov={d.prov}>
        {d.steps.map((s) => <Field key={s.sp} k={`${s.sp} · ${s.t}`} v={s.d} prov={d.prov} />)}
      </Panel>

      <Panel title={t("風險 · Risks（願景）", "Risks · Risks (vision)")} prov={d.prov}>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ab-warn)" }}>{d.risks.map((x) => <li key={x}>{x}</li>)}</ul>
      </Panel>
    </>
  );
}

export { VersionDiffPage } from "./VersionDiffPage";

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

  // A3-G1：federation review-room descriptor → coordinator review session 一鍵鏈。
  // createSessionSchema 必填 project_id / model_version_id（session metadata，descriptor 不帶）→
  // 提供可編輯欄位；model_version_id 空白時以 federated_<set_id>（真實對應後端 set）為預設。
  const [sessProject, setSessProject] = useState("federation-demo");
  const [sessModelVersion, setSessModelVersion] = useState("");
  const [sessBusy, setSessBusy] = useState(false);
  const [sessErr, setSessErr] = useState<string | null>(null);
  const [sessRes, setSessRes] = useState<CreateReviewSessionResponse | null>(null);
  const [spectatorCopied, setSpectatorCopied] = useState(false);
  const resetSessionChain = () => { setSessRes(null); setSessErr(null); setSpectatorCopied(false); };

  // prepare 會把每個 member 的 visibility_default / transform_json 烘進後端 set；之後任一欄位（含 visible）
  // 變動，build 仍會沿用烘進去的舊值 → UI 勾選與實際 build 結果分歧。誠實作法：作廢 set_id（Build 自動 disable）
  // 並標記 dirty，提示須重新「準備 + 驗證坐標系」，不捏造「改了就立即生效」的假象。
  const setMember = (i: number, k: string, v: string | number | boolean) => {
    setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
    if (setId) { setSetId(null); setCoord(null); setBuild(null); setRoom(null); setDirty(true); resetSessionChain(); }
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
    setSessRes(null); setSessErr(null); setSpectatorCopied(false); // 換 descriptor → 舊 session 結果不再對應
    try {
      setRoom(await governanceClient.reviewRoom(setId));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [setId]);

  // A3-G1 建立 Review Session：瀏覽器只送 federated_set_id——governance proxy 對瀏覽器遮蔽
  // 絕對路徑（review-room 的 primary.url 在前端是字面 "[server-path]"，組進 binding 會讓 Kit
  // 載不到真 stage），coordinator 收到 set id 後 server-side 向 governance 解析真
  // federated_review.usda 並自建 derived+ready binding（load_order 0 ⇒ stream-config primary）。
  // ready/primaryUrl 仍作為前端 gate（descriptor 未 ready 不送）。
  const primaryUrl = room?.ready ? room.stage_composition?.primary?.url ?? "" : "";
  const effectiveModelVersion = sessModelVersion.trim() || (setId ? `federated_${setId}` : "");
  const createSessionDisabledReason = !setId || !build
    ? t("先完成「準備 + 驗證坐標系」與 Build", "run Prepare + validate and Build first")
    : !room
      ? t("先 Open in Review Room 取得 stage_composition descriptor", "open the Review Room descriptor first")
      : !room.ready || !primaryUrl
        ? t("review-room descriptor 未 ready（缺 stage_composition.primary.url）", "review-room descriptor is not ready (missing stage_composition.primary.url)")
        : !sessProject.trim()
          ? t("缺 project_id（coordinator createSessionSchema 必填）", "project_id is required by the coordinator createSessionSchema")
          : !effectiveModelVersion
            ? t("缺 model_version_id（coordinator createSessionSchema 必填）", "model_version_id is required by the coordinator createSessionSchema")
            : "";
  const createFederatedSession = useCallback(async () => {
    if (!setId || !primaryUrl || !sessProject.trim() || !effectiveModelVersion) return;
    setSessBusy(true); setSessErr(null); setSessRes(null); setSpectatorCopied(false);
    try {
      const res = await coordinatorClient.createReviewSession({
        project_id: sessProject.trim(),
        model_version_id: effectiveModelVersion,
        review_request_id: `federated_${setId}`,
        federated_set_id: setId,
      });
      setSessRes(res);
    } catch (e) {
      setSessErr(String(e)); // 400（schema）/ 409（No Kit capacity）detail 已由 client 萃取，誠實顯示
    } finally {
      setSessBusy(false);
    }
  }, [setId, primaryUrl, sessProject, effectiveModelVersion, room]);
  const spectatorUrl = sessRes ? `${coordinatorClient.openInViewerUrl(sessRes.session_id)}&streamRole=spectator` : "";

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
            {/* A3-G1：review-room descriptor → 一鍵建立 coordinator review session（federated stage）。
                descriptor 未 ready 時按鈕誠實 disabled + 理由（不藏區塊、不留死按鈕）。 */}
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(128,128,128,.25)" }}>
                  <div className="ec-s" style={{ marginBottom: 6 }}>
                    {t("建立 Review Session（federated stage）", "Create review session (federated stage)")}
                    ｜{t("POST /api/review-sessions：必填 project_id / model_version_id；federated primary 以 artifact_binding（derived+ready+url）帶入，coordinator 據此推導 stream-config 的 stage_composition.primary", "POST /api/review-sessions: project_id / model_version_id required; the federated primary is carried as an artifact_binding (derived+ready+url), from which the coordinator derives stream-config stage_composition.primary")}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                    <span className="ec-k">project_id</span>
                    <input className="ec-btn" style={{ width: 160 }} value={sessProject} onChange={(e) => { setSessProject(e.target.value); resetSessionChain(); }} />
                    <span className="ec-k">model_version_id</span>
                    <input className="ec-btn" style={{ width: 220 }} placeholder={setId ? `federated_${setId}` : t("（先 Build）", "(build first)")} value={sessModelVersion} onChange={(e) => { setSessModelVersion(e.target.value); resetSessionChain(); }} />
                    <Btn
                      primary
                      data-testid="a3-create-session"
                      disabled={busy || sessBusy || createSessionDisabledReason !== ""}
                      caption={createSessionDisabledReason || t("POST /api/review-sessions（artifact_bindings 帶 federated primary；成功回 session JSON，409=無 Kit 容量誠實顯示）", "POST /api/review-sessions (artifact_bindings carry the federated primary; success returns the session JSON, 409 = no Kit capacity shown honestly)")}
                      onClick={() => { void createFederatedSession(); }}
                    >
                      {sessBusy ? t("建立中…", "Creating…") : t("建立 Review Session", "Create review session")}
                    </Btn>
                  </div>
                  <div data-testid="a3-session-result">
                    {sessErr && <p className="ec-warn-note">{t("建立失敗（後端誠實回應）", "creation failed (honest backend response)")}：{sessErr}</p>}
                    {sessRes && (
                      <>
                        <Field k="session_id" v={sessRes.session_id} prov="asbuilt" />
                        <Field k="status" v={sessRes.status} prov="asbuilt" />
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                          <a data-testid="a3-open-viewer" className="ec-btn" href={coordinatorClient.openInViewerUrl(sessRes.session_id)} target="_blank" rel="noreferrer">
                            {t("開啟 viewer（/ui/open）", "Open viewer (/ui/open)")}
                          </a>
                          <Btn
                            data-testid="a3-invite-spectator"
                            caption={spectatorUrl}
                            onClick={() => {
                              try {
                                void navigator.clipboard?.writeText(spectatorUrl)
                                  .then(() => setSpectatorCopied(true))
                                  .catch(() => setSpectatorCopied(false));
                              } catch { setSpectatorCopied(false); }
                            }}
                          >
                            {spectatorCopied ? t("已複製 ✓", "Copied ✓") : t("複製 Spectator 連結", "Copy spectator link")}
                          </Btn>
                          <Btn
                            caption={t("到 Session 管理檢視（接收端會向 runtime/status 重驗）", "View in Session Management (receiver re-verifies against runtime/status)")}
                            onClick={() => { window.location.hash = buildHandoff("sessions", { source: "a3", session: sessRes.session_id }); }}
                          >SS →</Btn>
                        </div>
                        {/* clipboard 可能不可用（權限 / 非 secure context）→ URL 同步以文字顯示，永不變死按鈕。 */}
                        <p className="ec-note" style={{ wordBreak: "break-all" }}>spectator：<code>{spectatorUrl}</code></p>
                      </>
                    )}
                  </div>
            </div>
          </div>
        )}
      </Panel>
      {sessRes && (
        <>
          <WorkspaceViewerMount
            mode="a3-inline"
            showHandoffActions={false}
            handoff={{
              source: "a3",
              sessionId: sessRes.session_id,
              ruleRunId: null,
              ifcGuid: null,
              usdPrimPath: null,
              ruleCode: null,
              severity: null,
              label: setId ? `Federation ${setId}` : "Federation",
              // runtime/status is the stage authority after coordinator resolves
              // the federated_set_id; do not trust the browser-masked descriptor URL.
              expectedStageUrl: null,
              mappingInformationStatus: "unsupported",
              mappingIssueCode: "a3_element_mapping_contract_unavailable",
              mappingIssueCount: null,
            }}
          />
          <Panel title={t("A3 構件選取與 clash", "A3 element selection and clash")} prov="asbuilt">
            <p className="ec-warn-note" data-testid="a3-element-selection-unsupported">
              {t(
                "Unsupported：目前 federation API 未回傳 discipline/clash element mapping；可驗證 federated stage 與 Kit 串流，但不建立假選取、高亮或 ACK。",
                "Unsupported: the federation API currently returns no discipline/clash element mapping. The federated stage and Kit stream can be verified, but no fake selection, highlight, or ACK is created.",
              )}
            </p>
          </Panel>
        </>
      )}
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

// ── P4 Review Room（G）：獨立 3D session attach / fallback 畫面 ──
// A1 inline viewer 是治理檢核的主要入口；Review Room 保留為跨頁 session 檢視與手動 fallback。
export function ReviewRoomPage() {
  return (
    <>
      <h1>{t("Review Room · 審查室（G）", "Review Room (G)")}</h1>
      <p className="ec-lead">
        {t("此頁可接收 A1 governance handoff 作為獨立 fallback；A1 頁面本身也能直接啟動 Kit / WebRTC viewer lease 並送出高亮。Review Room 只保留跨頁追蹤與手動操作。", "This page can receive A1 governance handoff as a standalone fallback; the A1 page can also start the Kit / WebRTC viewer lease directly and send highlights. Review Room remains for cross-page tracing and manual operation.")}
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
        <Field k="3D viewport" v={t("A1 可 inline attach；Review Room 也可手動 attach 作為 fallback", "A1 can attach inline; Review Room can also attach manually as a fallback")} prov="asbuilt" />
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
