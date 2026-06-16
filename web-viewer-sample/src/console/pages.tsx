// Edge Console 頁面。誠實原則：AS-BUILT 才標已實作；待建一律標 p1/p15 並說明；
// 任何數字非真即標 artifact / demo，絕不捏造。
import { Fragment, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Btn, Field, Metric, Panel, ProvTag, ProvLegend } from "./components";
import { a1Reducer, initialA1State, uiSteps } from "./a1Machine";
import { A1A10, A1A10_DETAIL, AppCardDef, AppVisionDetail, DEPENDENCIES, ENDPOINTS, PAGES, Prov, SERVICES } from "./data";
import { CoordReport, DiffIssueImpact, DiffItemRow, DiffOverlayResult, DiffStatus, FailureRow, FederatedBuildResult, FileProjectRow, FilesTreeResponse, FileVersionRow, governanceClient, IssueRow, ReviewRoomDescriptor, RuleResultRow, RuleRunStatus } from "./governanceClient";
import { coordinatorClient, ConversionQualityMetricsResponse, IfcReadyListItem, MinioWatchStatus, RuntimeStatus } from "./coordinatorClient";
import { CoordinatorGovernanceTabs } from "./coordinator/RuntimeGovernanceTabs";
import { RealIfcConsolePage } from "./RealIfcConsolePage";
// 重用既有 viewer 的 mapping fake-vs-real 隔離工具（已有測試）：mock / allow_fake_mapping /
// fake_mapping_count>0 / mapping_method=fake_for_smoke_test 一律當 fake，不重造輪子。
import { ElementMappingDocument, isFakeMappingDocument, isFakeMappingItem, mappingVerificationBlockReason } from "../types/mapping";

// A1 真實 IFC 驗證 artifact（committed evidence，PR #151；非捏造，為實測值）。
const A1_EVIDENCE = { schema: "IFC4X3", file: "fixture-bytes.ifc", total: 7126, passed: 7055, failed: 71, score: 99.0, date: "2026-06-02" };

// A1 規則檢核的預設 IFC 路徑：部署可用 VITE_A1_DEFAULT_IFC_PATH 覆寫成該機 storage 的真實路徑。
// 開發機 fallback 指向 repo 內 storage/fixture-bytes.ifc（dev/E2E 用）;部署區未設此 env 時操作員仍可手動改輸入框。
// （#/a1 移除內嵌 file-library 選擇器後若仍寫死開發機絕對路徑,別機部署會在第一步 rule-run 即 ifc_source_path not found。）
function defaultA1IfcPath(): string {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return meta?.VITE_A1_DEFAULT_IFC_PATH || "C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\fixture-bytes.ifc";
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
      {col("web", "WEB-PLANE · 瀏覽器可達", "web")}
      <div className="ec-bd-link"><span className="ec-bd-arrow">→</span><span>僅此一條<br />HTTPS / WSS</span></div>
      {col("boundary", "CONTROL-PLANE BOUNDARY", "boundary")}
      <div className="ec-bd-link"><span className="ec-bd-arrow">→</span><span>internal<br />loopback</span></div>
      <div className="ec-bd-col internal">
        <div className="ec-bd-cap">INTERNAL · 瀏覽器永不直連</div>
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
    ["A1", "跑一次治理檢核", "上傳或選取模型，自動檢查命名、分類、防火、LOD 是否合規。", "a1"],
    ["A2", "比較兩個版本", "看 v06 / v07 新增、修改、刪除與 issue 影響。", "a2"],
    ["A3", "打開跨專業疊合", "把建築、結構、機電模型組成 federation review room。", "a3"],
    ["BC", "整理 Issue / BCF", "把 A1/A2/A3/A5 的問題輸出成 BCF / Excel / 報表。", "issues"],
    ["CV", "查看轉檔排程", "確認 IFC-ready、conversion job、mapping coverage、stage writeback。", "conv"],
    ["SS", "檢查 Session / Viewer", "看 primary/spectator 是否真的收到 first frame。", "sessions"],
  ] as const;
  return (
    <>
      <h1>今天要做什麼 · AI-BIM Governance 工作台</h1>
      <p className="ec-lead">這是 operator 的第一屏：先看哪件事能交付、哪件事卡住、哪個 runtime 只是宣稱 ready。所有能力都保留 provenance，不把 roadmap 說成已完成。</p>
      <Panel title="Smart Todo" sub="從 prototype 收斂出的常用入口；按鈕只導向已存在頁面，不做隱藏副作用" prov="asbuilt">
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
      <Panel title="Recent Risk" sub="用業務語言呈現，不把技術 ID 放第一層" prov="demo">
        <Field k="黃 · 有 viewer 等待第一幀" v="到 Session 管理看 first_frame_at / heartbeat" prov="demo" />
        <Field k="黃 · 有 IFC 已轉檔但 mapping coverage 待確認" v="到 IFC→USD 轉檔排程看 coverage" prov="demo" />
        <Field k="綠 · A1 rule-run 可用" v="governance-service :49102 經 coordinator proxy" prov="asbuilt" />
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
      <h1>系統總覽 · Edge Console Overview</h1>
      <p className="ec-lead">
        落地端重量伺服器（AI-BIM-governance）的操作頁。每塊資料都標來源：已實作 / 實測 artifact /
        示範 / 後端待建。畫面無任何願景假數字。
      </p>
      <Panel title="落地端健康狀態 · Edge Health" sub="coordinator / kit 為 as-built；conversion / gpu 無遙測標未取得，不畫成 fail" prov="asbuilt">
        <div className="ec-grid">
          {/* /health 探活結果（up / down / 探活中）皆為真實觀測 → 一律標 asbuilt（真實探活）；
              down 是「真的探到不可達」，不是示範資料。demo 只保留給完全沒有真實遙測來源的值。 */}
          <Field
            k="COORD Coordinator :8004"
            v={health === "ok" ? "control plane · /health ok" : health === "down" ? "未連線（/health 不可達）" : "control plane（探活中…）"}
            prov="asbuilt"
          />
          <Field k="KIT Runtime 49100/47998" v="local_fixed" prov="asbuilt" />
          <Field k="CONV Conversion :49101" v="未取得" prov="demo" />
          <Field k="GPU" v="未取得" prov="demo" />
          <Field k="GOV governance-service :49102" v="rule-run authority" prov="asbuilt" />
        </div>
        <p className="ec-note">COORD /health 為真實探活；conversion / gpu 無統一遙測來源 → 標「未取得」（idle，非 fail），不捏造數值。</p>
      </Panel>

      <Panel title="服務邊界 · Web-plane → Coordinator → Internal" sub="瀏覽器只與 coordinator :8004 對話；49100/49101/49102 為內部，永不直連" prov="asbuilt">
        <BoundaryDiagram />
      </Panel>

      <Panel title={`已實作面 · Coordinator HTTP 介面（${builtCount} 個路由）`} sub="權威：bim-review-coordinator/src/app.ts（逐一查證）" prov="asbuilt">
        <div>
          {ENDPOINTS.map((e) => (
            <div className="ec-ep" key={e.m + e.path}>
              <span className={`ec-ep-m ec-ep-${e.m.toLowerCase()}`}>{e.m}</span>
              <span className="ec-ep-p">{e.path}</span>
              {e.note && <span className="ec-ep-note">· {e.note}</span>}
            </div>
          ))}
        </div>
        <p className="ec-note">另有 A1/A2/A3 governance proxy（<code>/api/governance/*</code>）由 governanceClient 走，透傳至 governance-service :49102。</p>
      </Panel>

      <Panel
        title="相依與授權風險 · License posture"
        sub="A1 core 的規則檢核在 governance-service（CPU）完成，仍依賴下列元件；LGPL / copyleft 商用前須法務確認（不得宣稱無授權風險）"
        prov="asbuilt"
      >
        <table className="ec-table">
          <thead><tr><th>元件</th><th>授權</th><th>用途</th><th>風險</th></tr></thead>
          <tbody>
            {DEPENDENCIES.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td>{d.license}</td>
                <td>{d.use}{d.note ? ` · ${d.note}` : ""}</td>
                <td><span className={`ec-risk ec-risk-${d.risk}`}>{d.risk === "copyleft" ? "copyleft（須法務）" : d.risk === "permissive" ? "permissive" : "待定"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Phase Backlog" sub="近期重點 A1–A3；A4–A10 為 ROADMAP">
        <Field k="A1 治理與模型檢核（rule-run authority）" v="backend 已實作" prov="asbuilt" />
        <Field k="A2 版本差異 · A3 Federation" v="已實作（GlobalId diff + USD sublayer federation）" prov="asbuilt" />
        <Field k="Issue 資料庫（lifecycle + audit + 來源綁定）· IDS 匯入" v="已實作" prov="asbuilt" />
        <Field k="BCF 匯出（issue→.bcfzip）" v="已實作（純 stdlib，不依賴 GPLv3）" prov="asbuilt" />
      </Panel>
    </>
  );
}

export function A1GovernanceWorkbenchPage() {
  const [state, dispatch] = useReducer(a1Reducer, initialA1State);
  const [pathInput, setPathInput] = useState(defaultA1IfcPath);
  const [idsPath, setIdsPath] = useState("");
  // 交付動作（建 Issue / 匯出）失敗的誠實 UI 回饋：後端離線時操作員必須看得到失敗
  // （對齊 doRun 的 runError；component-local，不污染 reducer 語意）。下次成功動作清除。
  const [actionErr, setActionErr] = useState<string | null>(null);
  const ui = uiSteps(state);
  const runId = state.run?.rule_run_id ?? null;

  // doRun 輪詢守門：pollGen 在 (a) 元件 unmount、(b) step 離開 running（PICK_FILE/RESET 重置）
  // 時遞增，讓 in-flight 輪詢迴圈以「自己的 generation 已失效」中斷，避免 unmount 後仍每秒
  // 發 getRuleRun 的資源洩漏（最多 60 次）。reducer 守門已防髒資料寫入，此處再防無謂請求。
  const pollGenRef = useRef(0);
  useEffect(() => () => { pollGenRef.current += 1; }, []);
  useEffect(() => { if (state.step !== "running") pollGenRef.current += 1; }, [state.step]);

  const doRun = useCallback(async () => {
    if (!state.ifcPath) return;
    // running-error 子態（RUN_FAIL 後 step 仍 running、runError=true）的重試走 RUN_RETRY；
    // 否則 plain RUN 在 running 是 no-op（防雙擊污染），「可重試」按鈕會點了沒反應（spec §5）。
    dispatch({ type: state.step === "running" && state.runError ? "RUN_RETRY" : "RUN" });
    // 開跑前捕捉 generation；不可在 await createRuleRun 之後重新捕捉，否則 await 視窗內
    // dispatch PICK_FILE 遞增的新 gen 會被抓回來，守門永遠通過、舊輪詢繼續打（資源洩漏）。
    const myGen = pollGenRef.current;
    try {
      const { rule_run_id } = await governanceClient.createRuleRun({ ifc_source_path: state.ifcPath, ids_path: idsPath || undefined });
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
        const failed = await governanceClient.getResults(rule_run_id, "failed");
        if (pollGenRef.current !== myGen) return;
        dispatch({ type: "RUN_DONE", run: st, failed });
      } else {
        dispatch({ type: "RUN_FAIL", error: st ? `rule-run ${st.status}` : "no status" });
      }
    } catch (e) {
      if (pollGenRef.current !== myGen) return; // unmount / 重置後吞掉殘餘錯誤，不寫回已卸載 UI
      dispatch({ type: "RUN_FAIL", error: String(e) });
    }
  }, [state.ifcPath, state.step, state.runError, idsPath]);

  const makeIssues = useCallback(async () => {
    if (!runId) return;
    setActionErr(null); // 重試前清掉上次錯誤
    try {
      const { created } = await governanceClient.issuesFromRuleRun(runId);
      dispatch({ type: "CREATE_ISSUES_OK", issueCount: created });
    } catch (e) {
      // 後端離線：誠實不前進（不偽造 issued），但顯示失敗讓操作員知道（誠實鐵律）。
      setActionErr(`建 Issue 失敗：${String(e)}`);
    }
  }, [runId]);

  const doExport = useCallback(async () => {
    if (!runId) return;
    setActionErr(null); // 重試前清掉上次錯誤
    try {
      const res = await fetch(governanceClient.exportUrl(runId));
      if (!res.ok) { setActionErr(`匯出失敗：HTTP ${res.status}`); return; }
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
      setActionErr(`匯出失敗：${String(e)}`); // 誠實顯示失敗，不靜默
    }
  }, [runId]);

  return (
    <>
      <h1>A1 · 治理與模型檢核</h1>
      <p className="ec-lead">上傳/選取 IFC，跑自動規則檢核，直接產生 Issue 與 Excel 匯出。規則檢核在 governance-service（CPU）完成；BCF 匯出請至 Issues 頁（本頁尚未接入）；3D 高亮需 GPU viewport（依 review session 派發，待建）。</p>

      <Panel title="A1 五步引導式流程" sub="整頁狀態機驅動；步驟依當前 state 亮燈（證據型更新，禁樂觀）" prov="asbuilt">
        <LifecycleStrip steps={["上傳模型", "自動檢核", "結果記分板", "開 Issue", "匯出 Excel"]} statuses={ui} />
        <div className="ec-grid" style={{ marginBottom: 8 }}>
          <Field k="rule_run_id" v={runId ?? "—"} prov="asbuilt" />
          <Field k="step" v={state.step} prov="asbuilt" />
          {state.issueCount !== null && <Field k="已開 issue（artifact）" v={String(state.issueCount)} prov="asbuilt" />}
          {/* EXPORT_OK 落地後才出現的可見信號：供 E2E 直接驗「exported=true（artifact）」而非靠 RUN 清 run 的旁證 disabled。
              比照 issueCount Field，僅在 state.exported 為 true 顯示；重跑保留（a1Machine：RUN 不清 exported）。 */}
          {state.exported && <div data-testid="a1-exported-artifact"><Field k="已匯出（artifact）" v="excel" prov="asbuilt" /></div>}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" data-testid="a1-step-path" style={{ minWidth: 420 }} value={pathInput}
            onChange={(e) => setPathInput(e.target.value)} />
          <Btn data-testid="a1-step-pick" caption="鎖定此模型路徑（進入步驟2）" onClick={() => dispatch({ type: "PICK_FILE", ifcPath: pathInput })}>選取模型</Btn>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <input className="ec-btn" style={{ minWidth: 420 }} placeholder="（選填）buildingSMART IDS .ids 路徑" value={idsPath} onChange={(e) => setIdsPath(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          {/* running-error 子態（runError=true）解除 disabled，讓「可重試」真的點得到（spec §5）；
              健康 running（輪詢中、runError=false）仍 disabled 防雙擊。 */}
          <Btn primary data-testid="a1-step-run" disabled={state.step === "idle" || (state.step === "running" && !state.runError)}
            caption="POST /api/governance/rule-runs" onClick={doRun}>
            {state.runError ? "重試檢核" : state.step === "running" ? "檢核中…" : "執行規則檢核"}
          </Btn>
          {state.runError && <span className="ec-warn-note">檢核失敗（可重試）：{state.error}</span>}
        </div>
      </Panel>

      {state.run && (
        <Panel title="結果記分板" sub="真實 rule-run summary；點規則列展開命中構件（GUID/名稱/樓層）" prov="asbuilt">
          <div className="ec-grid" data-testid="a1-rulerun-scoreboard">
            <Metric value={state.run.summary?.total ?? "—"} label="評估構件" />
            <Metric value={state.run.summary?.passed ?? "—"} label="passed" />
            <Metric value={state.run.summary?.failed ?? "—"} label="failed" tone="warn" />
            <Metric value={state.run.score ?? "—"} label="score" />
          </div>
          {runId && state.failed.length > 0 && <FailureScoreboard runId={runId} failed={state.failed} />}
        </Panel>
      )}

      <Panel title="交付" sub="開 Issue / 匯出 Excel 走真實後端；BCF 匯出在 Issues 頁；3D 高亮待建（不提供假按鈕）" prov="asbuilt">
        <Btn data-testid="a1-step-issues" disabled={state.step === "idle" || state.step === "picked" || state.step === "running"}
          caption="POST /api/governance/issues/from-rule-run/:id" onClick={makeIssues}>失敗構件建 Issue</Btn>{" "}
        {/* export 與 a1-step-issues 共用 state-machine gating（step ∈ {scored,issued,delivered} 才 enable），
            不看 state.run 快照欄位：重跑 running 子態 RUN_PROGRESS 可能短暫帶 succeeded 快照（step 仍 running），
            舊式 disabled={!runId||run?.status!=="succeeded"} 會在該瞬間誤解除 disabled、允許 running 子態匯出。 */}
        <Btn data-testid="a1-step-export" disabled={state.step === "idle" || state.step === "picked" || state.step === "running"}
          caption="GET /api/governance/rule-runs/:id/export?fmt=excel" onClick={doExport}>匯出 Excel</Btn>{" "}
        <Btn prov="p1" disabled caption="需 viewer DataChannel（highlightPrimsRequest）— 後續整合（M3/M4）">在 3D 高亮</Btn>
        {actionErr && <p className="ec-warn-note" data-testid="a1-action-error" style={{ marginTop: 8 }}>{actionErr}</p>}
      </Panel>

      <section data-testid="a1-real-ifc-slice" className="ec-a1-inline-slice">
        <RealIfcConsolePage />
      </section>
    </>
  );
}

export function ViewerPresentationPage() {
  const capabilities: [string, string, Prov][] = [
    ["openStage", "載入 selected USD / USDC stage；success 還需要 loaded stage URL 證據", "asbuilt"],
    ["focusPrim / selectPrims", "點清單或 mapping table 可聚焦 / 選取 USD prim", "asbuilt"],
    ["clearHighlight", "清除 viewer overlay / selection", "asbuilt"],
    ["highlightPrimsRequest", "A1/A2/A4 結果轉 3D highlight；需 browser DataChannel", "p15"],
    ["first_frame_at", "viewer 是否真的看到畫面，不等於 port open", "p1"],
    ["stage matched", "expected_stage_url == loaded stage URL 才算 stage truth", "p1"],
  ];
  return (
    <>
      <h1>3D Viewer 呈現 · USD over WebRTC</h1>
      <p className="ec-lead">此頁說明打開 3D viewer 時 operator 應看到什麼：模型畫面、語意表、mapping table、selected prim、DataChannel ready、first frame、stage truth。真正 viewport 仍在既有 viewer，不在 console 內重渲染 WebRTC。</p>
      <Panel title="Viewport 狀態" sub="Kit-side evidence + Browser-side evidence 必須分開" prov="asbuilt">
        <div className="ec-grid">
          <Field k="Stage URL" v="expected stage from review session / ifc-ready job" prov="asbuilt" />
          <Field k="DataChannel" v="ready 才能送 openStage / focusPrim / highlight" prov="asbuilt" />
          <Field k="WebRTC first frame" v="尚需 browser 回報 first_frame_at" prov="p1" />
          <Field k="Stage truth" v="expected == loaded 才能宣稱 matched" prov="p1" />
        </div>
      </Panel>
      <Panel title="Viewer command matrix" sub="對齊 existing Window.tsx / DataChannel 邊界" prov="asbuilt">
        <table className="ec-table">
          <thead><tr><th>command / evidence</th><th>operator 看到的功能</th><th>status</th></tr></thead>
          <tbody>{capabilities.map(([cmd, desc, prov]) => (
            <tr key={cmd}><td>{cmd}</td><td>{desc}</td><td><ProvTag prov={prov} /></td></tr>
          ))}</tbody>
        </table>
      </Panel>
      <Panel title="A1-A10 在 3D Viewer 的呈現用途" prov="demo">
        <div className="ec-grid">
          <MiniCard code="A1/A2/A4" title="可選 overlay" desc="規則失敗、版本差異、語意搜尋結果都可轉成 highlight，但需 mapping + first frame。" prov="p1" />
          <MiniCard code="A3/A5/A6/A7/A10" title="核心 3D 場景" desc="federation、IoT/FM、4D/5D、scan compare、robot route 都以 3D 場景為主。" prov="p4" />
          <MiniCard code="A8" title="render capture" desc="Synthetic Data 需要 Replicator / camera / output writer，屬後期 runtime pipeline。" prov="p4" />
        </div>
      </Panel>
    </>
  );
}

function pct(r?: number | null): string {
  if (typeof r !== "number" || !Number.isFinite(r)) return "未取得";
  const p = r * 100;
  // 誠實鐵律「不得承諾 100% lossless」：ratio<1 卻四捨五入到 100.00 時下修顯 99.99%，
  // 不讓非滿覆蓋謊報成 100%（真實 ratio 仍由相鄰 mapped/unmapped 數與 coverage_status 揭露）。
  if (r < 1 && p.toFixed(2) === "100.00") return "99.99%";
  return `${p.toFixed(2)}%`;
}
function CoverageDrawer({ state }: { state: ConversionQualityMetricsResponse | { error: string } | "loading" | undefined }) {
  if (state === "loading" || state === undefined) return <p className="ec-note">讀取 coverage…</p>;
  if ("error" in state) return <p className="ec-warn-note">{state.error}</p>;
  const s = state.quality_metrics_summary;
  if (!s) return <p className="ec-note">未取得品質遙測（後端未提供 quality_metrics）。</p>;
  return (
    <>
      <Field k="coverage" v={`${pct(s.coverage_ratio)}${s.coverage_status ? ` · ${s.coverage_status}` : ""}`} prov="artifact" />
      <Field k="mapped / unmapped" v={`${s.mapped_count ?? "未取得"} / ${s.unmapped_count ?? "未取得"}`} prov="artifact" />
      <Field k="source IFC entity" v={String(s.source_ifc_entity_count ?? "未取得")} prov="artifact" />
      <Field k="materialization" v={s.materialization_strategy ?? "未取得"} prov="artifact" />
      {/* spec §4.4 line 76 明列必顯欄：轉檔耗時秒數（後端 quality_metrics 既有，review.ts:19 / types.ts:79
          已型別化、buildQualityMetricsSummary 已萃取）。缺值誠實顯「未取得」，不捏值。 */}
      <Field k="conversion 耗時(s)" v={typeof s.conversion_duration_seconds === "number" ? String(s.conversion_duration_seconds) : "未取得"} prov="artifact" />
      <Field k="usdc 輸出" v={state.usdc_url ?? "未取得"} prov="artifact" />
      <Field k="mapping_url" v={state.mapping_url ?? "未取得"} prov="artifact" />
      <Field k="property / relationship / attribute 三項" v="後端未提供（以 coverage_ratio 為準；三項拆分為 follow-up）" prov="p1" />
    </>
  );
}

export function ConversionSchedulingPage() {
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  const [mw, setMw] = useState<MinioWatchStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mwErr, setMwErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [cov, setCov] = useState<Record<string, ConversionQualityMetricsResponse | { error: string } | "loading">>({});
  const load = useCallback(async () => {
    setBusy(true); setErr(null); setMwErr(null);
    // 兩個端點獨立 settle：minio-watch/status 失敗（route 不存在、coordinator 局部故障、
    // 端點尚未部署）不得污染 ifc-ready 的錯誤訊息，也不得讓 watcher Panel 靜默停在
    // placeholder（誤導操作者以為「沒按 Refresh」）。各自有獨立錯誤 state。
    const [jobsRes, mwRes] = await Promise.allSettled([
      coordinatorClient.listIfcReady(50),
      coordinatorClient.minioWatchStatus(),
    ]);
    if (jobsRes.status === "fulfilled") setJobs(jobsRes.value.items);
    else setErr(`未連線 coordinator /api/external/ifc-ready：${String(jobsRes.reason)}`);
    if (mwRes.status === "fulfilled") setMw(mwRes.value);
    else setMwErr(`未連線 coordinator /api/external/minio-watch/status：${String(mwRes.reason)}`);
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
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
      setCov((p) => ({ ...p, [id]: { error: `未取得 coverage：${String(e)}` } }));
    }
  }, [openJob, cov]);
  return (
    <>
      <h1>IFC→USD 轉檔排程</h1>
      <p className="ec-lead">從 MinIO / storage 發現 source IFC，排進 conversion authority，由 `bim-streaming-server` 產出 `model.usdc`、mapping summary，再通知 Kit / Review Session。</p>
      <Panel title="Pipeline" sub="MinIO source → queue → IFC→USD → writeback → notify Kit" prov="asbuilt" actions={<Btn caption="GET /api/external/ifc-ready" disabled={busy} onClick={load}>{busy ? "讀取中…" : "Refresh queue"}</Btn>}>
        <LifecycleStrip steps={["讀 MinIO / storage", "排隊", "IFC→USD", "寫回 model.usdc", "通知 Kit"]} />
        {err && <p className="ec-warn-note">{err}</p>}
        <Field k="conversion authority" v="bim-streaming-server owns heavy conversion" prov="asbuilt" />
        <Field k="插隊 / 重試 / concurrency" v="UI rule 已定義，controlled action endpoint 待建" prov="p1" />
      </Panel>
      <Panel
        title="MinIO 自動偵測（O4）"
        sub="watcher 輪詢 ListObjectsV2 → 新 */model.ifc → 自動 intake；來源 /api/external/minio-watch/status"
        prov="asbuilt"
      >
        <div data-testid="minio-watch-panel">
          {mwErr ? (
            <p className="ec-warn-note" data-testid="minio-watch-error">{mwErr}</p>
          ) : mw == null ? (
            <p className="ec-note">尚未取得 watcher 狀態；按上方 Refresh queue 後顯示。</p>
          ) : mw.enabled === false ? (
            <>
              <Field k="狀態" v="未啟用 — 需設定 env MINIO_WATCH_ENABLED opt-in" prov="asbuilt" />
              <p className="ec-note">{mw.note ?? "watcher 預設關閉；狀態 API 為真，未偽稱功能在跑。"}</p>
            </>
          ) : (
            <>
              {mw.note && <p className="ec-note">{mw.note}</p>}
              <Field k="狀態" v="啟用中（env opt-in）" prov="asbuilt" />
              <Field k="bucket" v={mw.bucket ?? "—"} prov="asbuilt" />
              <Field k="prefix" v={mw.prefix || "（無）"} prov="asbuilt" />
              <Field k="最近一輪" v={mw.last_poll_at ?? "尚未完成首輪"} prov="asbuilt" />
              <Field k="輪詢次數" v={String(mw.poll_count ?? "—")} prov="asbuilt" />
              <Field k="baseline / seen / 觸發 / 跳過" v={`${mw.baseline_count ?? "—"} / ${mw.seen_count ?? 0} / ${mw.triggered_total ?? 0} / ${mw.skipped_malformed_total ?? 0}`} prov="asbuilt" />
              {mw.last_error && <Field k="最近錯誤" v={mw.last_error} prov="asbuilt" />}
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
            </>
          )}
        </div>
      </Panel>
      <Panel title="Ifc-ready jobs" sub="/api/external/ifc-ready truth；沒有資料時顯示空，不補假 job" prov="asbuilt">
        {jobs.length ? (
          <table className="ec-table"><thead><tr><th>job</th><th>project</th><th>conversion</th><th>dispatch</th><th>session</th><th>stage</th><th>coverage</th></tr></thead>
            <tbody>{jobs.slice(0, 20).map((j) => (
              <Fragment key={j.ifc_ready_job_id}>
                <tr>
                  <td>{j.ifc_ready_job_id}</td>
                  <td>{j.project_id}</td>
                  <td>{j.conversion_status ?? "—"}</td>
                  <td>
                    {j.dispatch_error ? (
                      <span
                        className="ec-warn-note"
                        data-testid={`conv-dispatch-error-${j.ifc_ready_job_id}`}
                        title={j.dispatch_error}
                      >
                        {j.dispatch_error.length > 80 ? `${j.dispatch_error.slice(0, 80)}…` : j.dispatch_error}
                      </span>
                    ) : "—"}
                  </td>
                  <td>{j.review_session_id ?? "—"}</td>
                  <td>{j.expected_stage_url ?? "—"}</td>
                  <td>{j.conversion_job_id
                    ? <Btn data-testid={`conv-coverage-toggle-${j.ifc_ready_job_id}`} onClick={() => void toggleCoverage(j)}>{openJob === j.ifc_ready_job_id ? "收合" : "coverage"}</Btn>
                    : <span className="ec-note">尚未派工</span>}</td>
                </tr>
                {openJob === j.ifc_ready_job_id && (
                  <tr><td colSpan={7}>
                    <div data-testid={`conv-coverage-${j.ifc_ready_job_id}`}>
                      <CoverageDrawer state={cov[j.ifc_ready_job_id]} />
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}</tbody></table>
        ) : <p className="ec-note">尚未取得 ifc-ready job；可由真實 IFC 進件頁註冊 fixture 後再回來看排程。</p>}
      </Panel>
    </>
  );
}

export function SessionManagementPage() {
  const [rt, setRt] = useState<RuntimeStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setErr(null);
    try { setRt(await coordinatorClient.runtimeStatus()); }
    catch (e) { setErr(`未連線 coordinator /api/runtime/status：${String(e)}`); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const sessions = rt?.sessions.items ?? [];
  return (
    <>
      <h1>Session 管理 · Primary / Spectator ATC</h1>
      <p className="ec-lead">每個 endpoint 像 runway，每個 primary / spectator viewer 像飛機。Open URL 不等於 occupied；occupied 必須有 browser first frame / heartbeat / stage match evidence。</p>
      <Panel title="Endpoint readiness rules" sub="port listening != has frame" prov="asbuilt" actions={<Btn caption="GET /api/runtime/status" onClick={load}>重新整理</Btn>}>
        {err && <p className="ec-warn-note">{err}</p>}
        <div className="ec-grid">
          <Field k="Open primary URL" v="只代表 browser 被導向，不代表 endpoint occupied" prov="asbuilt" />
          <Field k="Open spectator URL" v="只代表 spectator link 已產生，不代表 first frame" prov="asbuilt" />
          <Field k="occupied" v="必須等 browser first_frame_at + heartbeat" prov="p1" />
          <Field k="stage matched" v="expected_stage_url == loaded stage URL" prov="p1" />
        </div>
      </Panel>
      <Panel title="Active sessions" sub="coordinator-owned session summary" prov="asbuilt">
        {sessions.length ? (
          <table className="ec-table"><thead><tr><th>session</th><th>status</th><th>participants</th><th>conversion</th><th>stage</th></tr></thead>
            <tbody>{sessions.map((s) => (
              <tr key={s.session_id}><td>{s.session_id}</td><td>{s.status}</td><td>{s.participant_count}</td><td>{s.conversion_status ?? "—"}</td><td>{s.expected_stage_url ?? "—"}</td></tr>
            ))}</tbody></table>
        ) : <p className="ec-note">目前 runtime status 無 active session；下面 endpoint pool 為治理規則示意。</p>}
      </Panel>
      <Panel title="Controlled actions" sub="Phase 1 read-only；會改狀態的動作須 reason + audit log，控制端點尚未接（不提供假按鈕）" prov="p1">
        <Btn disabled caption="Phase 1 read-only：browser-visible URL only" prov="p1">Open primary URL</Btn>{" "}
        <Btn disabled caption="Phase 1 read-only：browser-visible URL only" prov="p1">Open spectator URL</Btn>{" "}
        <Btn disabled caption="Phase 1 read-only：stale spectator reclaim 待接" prov="p1">Reclaim stale spectator</Btn>{" "}
        <Btn disabled caption="requires explicit reason + audited intent to Kit Manager" prov="p1">Force release / restart primary</Btn>
      </Panel>
    </>
  );
}

export function KitGpuFleetPage() {
  return (
    <>
      <h1>Kit / GPU 機隊</h1>
      <p className="ec-lead">此頁是 runtime operator 的機隊視角：哪台 GPU 在服務哪個 Kit stream，哪台可接新 session，哪些節點 drain，哪些 restart/release 必須由 Kit Manager 執行。</p>
      <Panel title="Fleet model" sub="Coordinator 顯示治理狀態，不直接管理 GPU process" prov="asbuilt">
        <div className="ec-grid">
          <MiniCard code="1 GPU" title="1 GPU = 1 Kit stream" desc="primary 使用獨立 Kit stream；spectator 預設共享同一 stream，除非未來需求是獨立視角。" prov="asbuilt" />
          <MiniCard code="drain" title="排空不接新 session" desc="drain 後 existing session 可跑完；新 session 不再派到該節點。" prov="p1" />
          <MiniCard code="move" title="搬移不是無縫遷移" desc="拖 session 到另一台 GPU 表示 terminate + recreate，約 30-40s 並重載 stage。" prov="p1" />
        </div>
      </Panel>
      <Panel title="Node snapshot" sub="實際 GPU/VRAM 遙測仍需 kit-manager-api / runtime manager 提供" prov="demo">
        <table className="ec-table"><thead><tr><th>node</th><th>GPU</th><th>state</th><th>operation</th></tr></thead><tbody>
          <tr><td>edge-gpu-01</td><td>L40 · 48GB</td><td>running · S-270</td><td>drain / restart intent</td></tr>
          <tr><td>edge-gpu-02</td><td>L40 · 48GB</td><td>running · S-899</td><td>drain / restart intent</td></tr>
          <tr><td>edge-gpu-03</td><td>RTX 6000 · 48GB</td><td>idle</td><td>assign pending session</td></tr>
        </tbody></table>
        <p className="ec-note">此表為 prototype fleet model 的 UI evidence；真實 restart/release 必須送 audited intent 給 Kit Manager，不能由 coordinator/browser 直接做。</p>
      </Panel>
    </>
  );
}

export function MinioDataPage() {
  const [tree, setTree] = useState<FilesTreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // 抽成可重跑的 loader：初載與 error 態「重試」共用同一條真實 fetch 路徑
  //（coordinator/governance 暫時離線時不必整頁 reload）。React 18 unmount 後
  // setState 為 no-op，毋須 alive flag。
  const loadTree = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setTree(await governanceClient.filesTree());
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const projectCount = tree?.projects.length ?? 0;

  return (
    <>
      <h1>MinIO 資料</h1>
      <p className="ec-lead">
        資料頁讓 operator 看懂 project / model / version / files 關係；它不是完整 S3 browser。
        目前為 local file-server 來源（比照 <code>bim-control/{"{projectId}"}/{"{modelId}"}</code> 規約）；真 S3/MinIO 待接。
      </p>

      <Panel
        title="檔案庫 · file library（真實樹）"
        sub={tree ? `source_kind=${tree.source_kind} · root=${tree.root}` : "local file-server 來源（比照 bim-control 規約）；真 S3/MinIO 待接"}
        prov="asbuilt"
      >
        {loading && <p className="ec-note">載入中…（GET /api/governance/files/tree）</p>}
        {err && (
          <div className="ec-warn-note" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>未連線後端（coordinator / governance-service 需啟動）：{err}</span>
            <Btn data-testid="minio-tree-retry" caption="GET /api/governance/files/tree" onClick={() => { void loadTree(); }}>
              重試
            </Btn>
          </div>
        )}
        {!loading && !err && projectCount === 0 && (
          <p className="ec-note">檔案庫為空：未在 root 下找到 <code>{"{projectId}"}/{"{modelId}"}/*.ifc</code> 兩層結構（檢查 BIM_FILE_LIBRARY_ROOT）。</p>
        )}
        {tree && projectCount > 0 && (
          <div className="ec-tree">
            {tree.projects.map((p) => (
              <div key={p.project_id}>
                <div><span className="ec-tree-file">{p.project_id}/</span> <ProvTag prov="asbuilt" /></div>
                {p.models.map((m) => (
                  <div className="indent" key={m.model_id}>
                    <div>{m.model_id}/</div>
                    {m.versions.map((v) => (
                      <div className="indent two" key={v.name}>
                        <span className="ec-tree-file">{v.name}</span>{" "}
                        <span className="ec-note">{(v.size_bytes / 1024).toFixed(1)} KB · {v.mtime}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Bucket layout（規約示意）" sub="bim-control private bucket · project/model/version/files（示意，非實況）" prov="demo">
        <div className="ec-tree">
          <div>bim-control/</div>
          <div className="indent">{"{projectId}"}/</div>
          <div className="indent two">{"{modelId}"}/version/files/</div>
          <div className="indent three"><span className="ec-tree-file">model.usdc</span> <span className="ec-note">expected generated output after conversion</span> <ProvTag prov="p1" /></div>
        </div>
        <p className="ec-note">此 Panel 為 MinIO bucket 規約示意（示範資料）；<code>model.usdc</code> 為轉檔產物，後端待建（p1），不因本頁翻綠。</p>
      </Panel>

      <Panel title="與功能頁的關係" prov="asbuilt">
        <Field k="A1" v="rule-run 讀檔案庫選定的 IFC（version.path → ifc_source_path）" prov="asbuilt" />
        <Field k="A2" v="versions / diff compare 需要版本路徑與 model_version_id" prov="asbuilt" />
        <Field k="A3" v="federation 需要多專業 USD layer / stage paths" prov="asbuilt" />
        <Field k="3D Viewer" v="openStage 使用 generated model.usdc / model.usd URL" prov="asbuilt" />
      </Panel>
    </>
  );
}

export function ReportsPage() {
  return (
    <StubPage
      title="報表中心"
      note="把治理檢核、版本差異、mapping coverage、FM / clash summary 收成可交付文件。"
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
      title="系統管理"
      note="RBAC、ruleset、runtime policy 的管理面。此頁不直接刪資料、不改機密、不直接 restart GPU process。"
      items={[
        ["RBAC / members", "待接 control-plane identity", "p1"],
        ["Rulesets", "A1 IDS / YAML ruleset 管理", "p1"],
        ["Runtime policy", "restart / release 必須 reason + audit", "p1"],
      ]}
    />
  );
}

export function SpecPage() {
  return (
    <>
      <h1>設計規格說明</h1>
      <p className="ec-lead">此頁保留 prototype 到 repo 的落地對照：完整操作台是 frontend product shell；conversion / Kit / WebRTC / MinIO 權威仍在各自 repo 邊界。</p>
      <Panel title="Repo boundary contract" prov="asbuilt">
        <Field k="bim-review-coordinator" v="session / lifecycle / lease / audit / policy 權威；發 audited intent" prov="asbuilt" />
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
      <Panel title="GPU 審查室補充" sub="prototype 的 GPU review room 是 viewer + runtime evidence，不是另開一個 renderer" prov="asbuilt">
        <Field k="Mock Viewport" v="沒有真實 WebRTC first frame 時顯示 deterministic no-GPU，不宣稱 live 3D" prov="asbuilt" />
        <Field k="Primary / Spectator" v="viewer role 與 first frame evidence 由 browser 回報" prov="p1" />
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
      title="複製 ifc_guid"
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
      {copied ? "已複製" : "複製"}
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
        <span><strong>{ruleCode}</strong> · {count} 筆失敗</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {err && <p className="ec-warn-note">載入失敗構件失敗：{err}</p>}
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
          {loading && <span className="ec-s">載入中…（GET /api/governance/rule-runs/:id/failures）</span>}
          {!loading && canLoadMore && (
            <Btn data-testid={`a1-fail-more-${ruleCode}`} caption={`已載 ${rows.length}/${total}`} onClick={() => { void loadPage(rows.length); }}>
              載入更多
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
        失敗規則（點擊展開命中構件，懶載入分頁，補樓層、GUID 可複製）：
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
      <h1>問題與語意驗收 · Issues & Rule Center（A1）</h1>
      <p className="ec-lead">
        A1 治理與模型檢核：對真實 IFC 跑宣告式規則集，產出 governance score 與帶真實 ifc_guid 的失敗構件。
        規則引擎為純 CPU host-native ifcopenshell；可選用 buildingSMART IDS（ifctester）規則。
      </p>

      <Panel title="A1 rule-run authority" sub="governance-service :49102（經 coordinator proxy）" prov="asbuilt">
        <p className="ec-note">後端已實作並以真實 IFC 驗證（見下方 artifact）。本頁經 coordinator <code>/api/governance/*</code> proxy 觸發實時 rule-run。</p>
        <div className="ec-grid" style={{ marginBottom: 10 }}>
          <Field k="rule_run_id" v={runId ?? "—"} prov="asbuilt" />
          <Field k="rule_run_status" v={busy ? "running" : run?.status ?? "idle"} prov="asbuilt" />
        </div>
        <div className="ec-field" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, marginBottom: 8 }}>
          <span className="ec-k">從檔案庫選擇 <ProvTag prov="asbuilt" /></span>
          {fsErr && (
            <span className="ec-warn-note" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>檔案庫不可用（{fsErr}）；可改用下方手動輸入路徑。</span>
              <Btn data-testid="a1-fs-retry" caption="GET /api/governance/files/tree" onClick={() => { void loadFsTree(); }}>
                重試載入檔案庫
              </Btn>
            </span>
          )}
          {!fsErr && !fsTree && <span className="ec-s">載入檔案庫中…（GET /api/governance/files/tree）</span>}
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
              <option value="">專案…</option>
              {(fsTree ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
            </select>
            <select
              data-testid="a1-fs-model"
              className="ec-btn"
              value={selModel}
              disabled={!selProject}
              onChange={(e) => { setSelModel(e.target.value); resetVersionPick(); }}
            >
              <option value="">模型…</option>
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
              <option value="">版本…（選定填入路徑）</option>
              {fsVersions.map((v) => <option key={v.name} value={v.path}>{v.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" style={{ minWidth: 420 }} value={ifcPath} onChange={(e) => setIfcPath(e.target.value)} />
          <Btn primary disabled={busy} caption="POST /api/governance/rule-runs" onClick={doRun}>
            {busy ? "執行中…" : "執行規則檢核"}
          </Btn>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <input className="ec-btn" style={{ minWidth: 420 }} placeholder="（選填）buildingSMART IDS .ids 路徑 — 改用 ifctester 跑" value={idsPath} onChange={(e) => setIdsPath(e.target.value)} />
          <span className="ec-s">填 IDS 則以 IDS 規則跑（否則用內建 YAML 規則集）</span>
        </div>
        {err && <p className="ec-warn-note">未連線後端（proxy / governance-service 需啟動）：{err}</p>}
        {run && (
          <div className="ec-grid" data-testid="a1-rulerun-scoreboard" style={{ marginTop: 12 }}>
            <Metric value={run.summary?.total ?? "—"} label="評估構件" />
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
              if (!res.ok) { setErr(`Excel 匯出 ${res.status}：${res.statusText}`); return; }
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
          }}>匯出 Excel</Btn>
          {/* [在 3D 中標示]：console 為 /console 獨立殼層，與 viewer <App/> 互斥掛載，無 WebRTC
              DataChannel；highlightPrimsRequest 需 viewer DataChannel（Window 內），此鏈未接 →
              誠實標 p1（後續整合），永遠 disabled，不做點了沒反應的假按鈕。 */}
          <Btn prov="p1" disabled caption="需 viewer DataChannel（highlightPrimsRequest）— 後續整合">在 3D 中標示</Btn>
        </div>
        {/* A1 §4.2 失敗構件抽屜：取代舊扁平表（failed.slice(0,30)）。按規則分組、可展開、
            懶載入分頁 getFailures、補樓層、GUID 一鍵複製；全過規則不在此列。 */}
        {runId && failed.length > 0 && <FailureScoreboard runId={runId} failed={failed} />}
        <p className="ec-note" style={{ marginTop: 8 }}>
          [匯出 Excel] 為真實下載（openpyxl，asbuilt）。[在 3D 中標示] 需 viewer 的 WebRTC DataChannel
          （<code>highlightPrimsRequest</code>）；Edge Console 為 <code>/console</code> 獨立殼層，與 viewer 互斥掛載、
          目前無 DataChannel，故誠實標 <code>p1</code>（後續整合），未對映 <code>usd_prim_path=null</code> 本就無法標示。
        </p>
      </Panel>

      <Panel title="語意驗收訊號 · 真實 IFC 實測" sub={`${A1_EVIDENCE.file} · ${A1_EVIDENCE.schema} · ${A1_EVIDENCE.date}`} prov="artifact">
        <div className="ec-grid">
          <Metric value={A1_EVIDENCE.total} label="評估構件" />
          <Metric value={A1_EVIDENCE.passed} label="passed" />
          <Metric value={A1_EVIDENCE.failed} label="failed" tone="warn" />
          <Metric value={A1_EVIDENCE.score} label="score" />
        </div>
        <p className="ec-note">實測值來自 commit 進 repo 的 evidence（CPU ~6s，無 GPU）；非示範、非捏造。</p>
      </Panel>

      <Panel title="規則集 · rule set" prov="asbuilt">
        <Field k="DOOR-FIRERATING-REQUIRED" v="IfcDoor · Pset_DoorCommon.FireRating" prov="asbuilt" />
        <Field k="ELEMENT-NAME-REQUIRED" v="IfcBuildingElement/IfcBuiltElement · Name" prov="asbuilt" />
        <Field k="WALL-STOREY-ASSIGNED" v="IfcWall · 空間指派" prov="asbuilt" />
        <Field k="IDS-XML 匯入（buildingSMART IDS）" v="已實作（ifctester 0.8.5；填 IDS 路徑即用 IDS 規則跑）" prov="asbuilt" />
        <Field k="Excel 匯出" v="openpyxl" prov="asbuilt" />
        <Field k="BCF 匯出（issue→.bcfzip）" v="已實作（純 stdlib zipfile/ElementTree，不依賴 GPLv3）" prov="asbuilt" />
        <Field k="Issue 生命週期資料庫" v="open→assigned→resolved/rejected→reopened + audit" prov="asbuilt" />
      </Panel>

      <Panel
        title="Issue Center"
        sub="rule-run 失敗構件 → issue（綁 ifc_guid，BCF rule 3/10：無 guid 僅視覺標註）"
        prov="asbuilt"
        actions={<Btn caption="POST from-rule-run" disabled={!runId} onClick={makeIssuesFromRun}>失敗構件建 issue</Btn>}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn caption="GET /api/governance/issues" onClick={loadIssues}>載入 issues</Btn>
          <Btn caption="GET /api/governance/bcf/export（只含正式 issue）" onClick={async () => {
            setErr(null);
            try {
              const res = await fetch(governanceClient.bcfExportUrl());
              if (!res.ok) { setErr(`BCF 匯出 ${res.status}：需至少一個正式 issue（kind=issue 且有 ifc_guid）`); return; }
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
          }}>匯出 BCF 2.1</Btn>
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
      <h1>應用導引 · Applications A1–A10</h1>
      <p className="ec-lead">
        十個應用模組入口。近期重點 A1–A3 為聚焦項（後端已實作、可真實驗證）；A4–A10 為 ROADMAP，
        標真實 Phase，點卡片開「願景詳頁」（schema/api/ui/mvp/risks），**後端未建、整段標願景**。
      </p>
      <Panel title="近期重點 · Focus" sub="A1–A3（後端已實作）">
        <div className="ec-grid">{focus.map(Card)}</div>
      </Panel>
      <Panel title="後期願景 · Roadmap" sub="A4–A10 · Phase 3–4（後端未建，點卡看願景詳頁）">
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
        <h1>未知應用</h1>
        <p className="ec-lead">找不到 slug=<code>{slug}</code> 的願景詳頁。</p>
        <Btn caption="回 Applications" onClick={() => onOpen("apps")}>← 回應用導引</Btn>
      </>
    );
  }
  return (
    <>
      <h1>{d.code} · {d.title}<span style={{ marginLeft: 10 }}><ProvTag prov={d.prov} /></span></h1>
      <p className="ec-lead">{d.en} · Phase {d.phase} · {d.pitch}</p>
      <Btn caption="回 Applications" onClick={() => onOpen("apps")}>← 回應用導引</Btn>

      <Panel title="目標 · Goal" sub="此應用後端未建；以下為願景規格（roadmap）" prov={d.prov}>
        <p className="ec-note" style={{ color: "var(--ec-fg-2)" }}>{d.goal}</p>
        <p className="ec-warn-note">後端未建（vision）：本頁所有 schema / api / 數字皆為願景設計，非本系統真實實測。</p>
      </Panel>

      <Panel title="範例情境 · Example scenario" sub="願景敘事（非真實 run），具體數字為原型情境" prov={d.prov}>
        <Field k="情境" v={d.scenarioHead} prov={d.prov} />
        <Field k="範例輸出" v={d.scenarioResult} prov={d.prov} />
      </Panel>

      <Panel title="DB schema（願景設計）" prov={d.prov}>
        {d.schema.map((s) => <Field key={s.t} k={s.t} v={s.f} prov={d.prov} />)}
      </Panel>

      <Panel title="REST API（願景設計，非已實作 route）" prov={d.prov}>
        <div>
          {d.api.map((a) => (
            <div className="ec-ep" key={a.u}>
              <span className={`ec-ep-m ec-ep-${a.m.toLowerCase()}`}>{a.m}</span>
              <span className="ec-ep-p">{a.u}</span>
              <span className="ec-ep-note">· {a.d}</span>
            </div>
          ))}
        </div>
        <p className="ec-warn-note">以上為 roadmap 願景 API 設計；後端尚未實作這些 route（不可當真實端點呼叫）。</p>
      </Panel>

      <Panel title="UI 面板（願景）" prov={d.prov}>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ec-fg-2)" }}>{d.ui.map((x) => <li key={x}>{x}</li>)}</ul>
      </Panel>

      <Panel title="MVP 驗收條件（願景）" prov={d.prov}>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ec-fg-2)" }}>{d.mvp.map((x) => <li key={x}>{x}</li>)}</ul>
      </Panel>

      <Panel title="Sprint steps（願景）" prov={d.prov}>
        {d.steps.map((s) => <Field key={s.sp} k={`${s.sp} · ${s.t}`} v={s.d} prov={d.prov} />)}
      </Panel>

      <Panel title="風險 · Risks（願景）" prov={d.prov}>
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
      <h1>模型版本差異與責任追蹤 · A2</h1>
      <p className="ec-lead">
        以 IFC GlobalId 多級對齊（GlobalId → Tag → type+name+location）比對兩個 model version，
        標記 added / removed / moved / property changed；差異計算在 CPU 完成。
      </p>
      <Panel title="Diff Builder" sub="POST /api/governance/diffs（經 coordinator proxy → governance-service）" prov="asbuilt">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {fsErr && (
            <span className="ec-warn-note" data-testid="a2-fs-error" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>檔案庫不可用（{fsErr}）；可改用下方手動輸入路徑。</span>
              <Btn data-testid="a2-fs-retry" caption="GET /api/governance/files/tree" onClick={() => { void loadFsTree(); }}>重試載入檔案庫</Btn>
            </span>
          )}
          {!fsErr && !fsTree && <span className="ec-s">載入檔案庫中…（GET /api/governance/files/tree）</span>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="ec-k" style={{ minWidth: 48 }}>base</span>
            <select data-testid="a2-base-project" className="ec-btn" value={baseSel.project} disabled={!fsTree}
              onChange={(e) => clearBaseSelection(e.target.value, "")}>
              <option value="">專案…</option>
              {(fsTree ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
            </select>
            <select data-testid="a2-base-model" className="ec-btn" value={baseSel.model} disabled={!baseSel.project}
              onChange={(e) => clearBaseSelection(baseSel.project, e.target.value)}>
              <option value="">模型…</option>
              {baseModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
            </select>
            <select data-testid="a2-base-version" className="ec-btn" value={baseSel.version} disabled={!baseSel.model}
              onChange={(e) => { const v = baseVersions.find((x) => x.path === e.target.value); if (v) pickBaseVersion(baseSel.project, baseSel.model, v); else clearBaseSelection(baseSel.project, baseSel.model); }}>
              <option value="">版本…（選定填入路徑）</option>
              {baseVersions.map((v) => <option key={v.name} value={v.path}>{v.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="ec-k" style={{ minWidth: 48 }}>target</span>
            <select data-testid="a2-target-project" className="ec-btn" value={targetSel.project} disabled={!fsTree}
              onChange={(e) => clearTargetSelection(e.target.value, "")}>
              <option value="">專案…</option>
              {(fsTree ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
            </select>
            <select data-testid="a2-target-model" className="ec-btn" value={targetSel.model} disabled={!targetSel.project}
              onChange={(e) => clearTargetSelection(targetSel.project, e.target.value)}>
              <option value="">模型…</option>
              {targetModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
            </select>
            <select data-testid="a2-target-version" className="ec-btn" value={targetSel.version} disabled={!targetSel.model}
              onChange={(e) => { const v = targetVersions.find((x) => x.path === e.target.value); if (v) pickTargetVersion(targetSel.project, targetSel.model, v); else clearTargetSelection(targetSel.project, targetSel.model); }}>
              <option value="">版本…（選定填入路徑）</option>
              {targetVersions.map((v) => <option key={v.name} value={v.path}>{v.name}</option>)}
            </select>
          </div>
          <input data-testid="a2-base-input" className="ec-btn" style={{ width: "100%" }} value={base} onChange={(e) => { setBase(e.target.value); setBaseVerId(""); setBaseSel((s) => ({ ...s, version: "" })); }} />
          <input data-testid="a2-target-input" className="ec-btn" style={{ width: "100%" }} value={target} onChange={(e) => { setTarget(e.target.value); setTargetVerId(""); setTargetSel((s) => ({ ...s, version: "" })); }} />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Btn primary disabled={busy} caption="GlobalId 多級對齊" onClick={run}>{busy ? "比對中…" : "Run Diff"}</Btn>
            <label className="ec-s" style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={includeGeo} onChange={(e) => setIncludeGeo(e.target.checked)} /> 含幾何比對（tessellation，較重）
            </label>
          </div>
        </div>
        {err && <p className="ec-warn-note">未連線後端（proxy / governance-service 需啟動）：{err}</p>}
        {diff && (
          <div className="ec-grid" style={{ marginTop: 12 }}>
            <Metric value={diff.summary?.matched ?? "—"} label="matched" />
            <Metric value={counts.added ?? 0} label="added" />
            <Metric value={counts.removed ?? 0} label="removed" tone="bad" />
            <Metric value={counts.moved ?? 0} label="moved" tone="warn" />
            <Metric value={counts.property_changed ?? 0} label="property changed" />
            <Metric value={counts.geometry_changed ?? 0} label="geometry changed" />
          </div>
        )}
        {items.length > 0 && (
          <table className="ec-table" style={{ marginTop: 12 }}>
            <thead><tr><th>change</th><th>ifc_type</th><th>ifc_guid</th><th>summary</th></tr></thead>
            <tbody>
              {items.slice(0, 40).map((it, i) => (
                <tr key={i}><td>{it.change_type}</td><td>{it.ifc_type}</td><td>{it.ifc_guid}</td><td>{it.change_summary}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <Btn caption="POST from-diff（綁 ifc_guid）" disabled={!diffId || items.length === 0} onClick={async () => { if (!diffId) return; try { await governanceClient.issuesFromDiff(diffId); } catch (e) { setErr(String(e)); } }}>變更構件建 issue</Btn>
          {/* [套用 3D Overlay]：呼叫真實端點 POST …/apply-overlay。後端誠實回 501（p15）——
              3D 著色走 client highlightPrimsRequest（需 viewer DataChannel），非後端 server-push。
              此處顯示後端誠實訊息（含 501），SHALL NOT 假裝成功。
              真實 gating：須 diff 真的成功（status==="succeeded"）才 enable；失敗 / 無結果保持 disabled，
              不做點了無意義的假按鈕。applyDiffOverlay 對 HTTP 錯誤回 {ok,status,detail}，但 coordinator
              不可達時 fetch 會 reject → 此處 catch 後設 err（誠實顯示無法連線），不靜默無反應。 */}
          <Btn prov="p15" disabled={busy || diff?.status !== "succeeded"} caption="POST /api/governance/diffs/:id/apply-overlay（後端誠實回 501）" onClick={async () => {
            if (!diffId) return;
            setBusy(true); setErr(null);
            try { setOverlay(await governanceClient.applyDiffOverlay(diffId)); }
            catch (e) { setOverlay(null); setErr(`無法套用 3D Overlay（無法連線 coordinator / 套用失敗）：${String(e)}`); }
            finally { setBusy(false); }
          }}>套用 3D Overlay</Btn>
        </div>
        {overlay && (
          <p className={overlay.ok ? "ec-note" : "ec-warn-note"} style={{ marginTop: 8 }}>
            apply-overlay → {overlay.status}：{overlay.detail}
            {!overlay.ok && overlay.status === 501 && "（p15：3D 著色走 client highlightPrimsRequest，需 viewer DataChannel；後端不做 server-push）"}
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
      <Panel title="範圍與誠實標示" prov="asbuilt">
        <Field k="geometry_changed" v="opt-in 已實作（include_geometry：ifcopenshell.geom bbox/vertex/volume hash，較重）" prov="asbuilt" />
        <Field k="3D overlay 顏色（綠/紅/橘/藍）" v="apply-overlay 端點誠實回 501；著色走 client highlightPrimsRequest（需 viewer DataChannel），非 server-push" prov="p15" />
        <Field k="Issue impact" v="已實作（possibly_addressed 啟發式 / still_open / new，連動 Issue DB）" prov="asbuilt" />
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
      <h1>跨專業模型 Federation · A3</h1>
      <p className="ec-lead">
        用 OpenUSD sublayer 把多個 discipline 模型疊在同一 stage，不破壞原始 model.usdc。
        純 CPU pxr authoring（USD 26.5），對齊 NVIDIA Kit USD 指南。
      </p>
      <Panel title="Federation Builder" sub="POST /api/governance/federated-sets（經 coordinator proxy → governance-service）" prov="asbuilt">
        {members.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}>
            <input className="ec-btn" style={{ width: 80 }} value={m.discipline} onChange={(e) => setMember(i, "discipline", e.target.value)} />
            <input className="ec-btn" style={{ flex: 1 }} placeholder="member .usd / .usdc 路徑（conversion 產出）" value={m.usd_path} onChange={(e) => setMember(i, "usd_path", e.target.value)} />
            <input className="ec-btn" style={{ width: 52 }} type="number" title="layer_order（小=強）" value={m.layer_order} onChange={(e) => setMember(i, "layer_order", Number(e.target.value))} />
            {/* visibility：唯一真實後端能力是 build 時的 visibility_default（隱藏 member 寫成 invisible token）。
                無「不重建即時切換」端點 → 誠實作法：勾選後須重新 Build 才生效（見下方標示），不捏造即時能力。 */}
            <label className="ec-s" title="visible（build 時帶入 visibility_default；改動需重新 Build）" style={{ display: "flex", gap: 3, alignItems: "center" }}>
              <input type="checkbox" checked={m.visible} onChange={(e) => setMember(i, "visible", e.target.checked)} /> visible
            </label>
            <span className="ec-note" style={{ opacity: 0.7 }}>位移</span>
            <input className="ec-btn" style={{ width: 46 }} type="number" title="位移 X" value={m.tx} onChange={(e) => setMember(i, "tx", Number(e.target.value))} />
            <input className="ec-btn" style={{ width: 46 }} type="number" title="位移 Y" value={m.ty} onChange={(e) => setMember(i, "ty", Number(e.target.value))} />
            <input className="ec-btn" style={{ width: 46 }} type="number" title="位移 Z" value={m.tz} onChange={(e) => setMember(i, "tz", Number(e.target.value))} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Btn disabled={busy} caption="create set + members + validate-coords" onClick={prepare}>準備 + 驗證坐標系</Btn>
          <Btn primary disabled={busy || !setId} caption="POST …/build → federated_review.usda" onClick={doBuild}>Build Federated USD</Btn>
        </div>
        {dirty && !setId && (
          <p className="ec-warn-note" style={{ marginTop: 6 }}>
            成員設定已變更，先前的「準備 + 驗證坐標系」結果已作廢；請重新準備後再 Build（避免畫面勾選與實際 build 結果不一致）。
          </p>
        )}
        {err && <p className="ec-warn-note">未連線後端 / member USD 不存在：{err}</p>}
        {coord && <Field k="共享坐標系驗證" v={coord.consistent ? "一致 ✓" : `不一致：${coord.issues.join("; ")}`} prov="asbuilt" />}
        {build && (
          <div style={{ marginTop: 8 }}>
            <Field k="federated_review.usda" v={build.usda_path} prov="asbuilt" />
            <Field k="subLayer order（強→弱）" v={build.sublayer_order.join("  →  ")} prov="asbuilt" />
            <Field k="member 數" v={build.member_count} prov="asbuilt" />
            <Field
              k="hidden members（visibility=false）"
              v={build.hidden.length > 0 ? build.hidden.join("  ·  ") : "（無，全部 visible）"}
              prov="asbuilt"
            />
            {build.transformed && build.transformed.length > 0 && (
              <Field k="per-member transform" v={build.transformed.map((t) => `${t.root_prim}:[${t.ops.join("+")}]`).join("   ")} prov="asbuilt" />
            )}
            <div style={{ marginTop: 6 }}>
              <Btn caption="GET …/review-room（stage_composition handoff）" onClick={openRoom}>Open in Review Room</Btn>
            </div>
          </div>
        )}
        {room && (
          <div style={{ marginTop: 8 }}>
            {room.ready && room.stage_composition ? (
              <>
                <Field k="stage_composition.primary" v={room.stage_composition.primary.url} prov="asbuilt" />
                <Field k="交給 host-native Kit review session" v={room.note} prov="demo" />
              </>
            ) : (
              <p className="ec-warn-note">{room.note}</p>
            )}
          </div>
        )}
      </Panel>
      <Panel title="範圍與誠實標示" prov="asbuilt">
        <Field k="疊合機制" v="sublayer 非破壞疊合；opinion 於 LIVERPS Local（最強）步驟解析，subLayerPaths[0] 最強；sessionLayer 僅暫態不作持久層" prov="asbuilt" />
        <Field k="member model.usdc" v="immutable（federation 只寫具名 root layer）" prov="asbuilt" />
        <Field k="member usd_path" v="指向 conversion authority 產出的 USD（本服務唯讀）" prov="asbuilt" />
        <Field k="per-member transform" v="已實作：root layer over xformOp（member immutable）；順序 scale→rotateXYZ→translate，translate 最外層" prov="asbuilt" />
        <Field k="member visibility" v="build 時帶入 visibility_default（隱藏 member 寫成 invisible，回傳 hidden[]）；無「不重建即時切換」端點，改 visible 須重新 Build 才生效（不捏造即時能力）" prov="asbuilt" />
        <Field k="Open in Review Room" v="產出 viewer 消費的 stage_composition handoff；GPU 串流由 host-native Kit + coordinator session 負責，本服務 CPU loopback 不開串流" prov="asbuilt" />
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
        setErr("無帶 mapping 產出（expected_mapping_url）的 ifc-ready job（可直接貼 mapping URL 載入）");
      }
    } catch (e) {
      setErr(`未連線 coordinator /api/external/ifc-ready：${String(e)}`);
    }
  }, []);

  const loadMapping = useCallback(async () => {
    if (!mapUrl.trim()) return;
    setBusy(true); setErr(null); setDoc(null);
    try {
      const res = await fetch(mapUrl.trim(), { headers: { Accept: "application/json" } });
      if (!res.ok) { setErr(`載入 mapping ${res.status} ${res.statusText}`); return; }
      const json = (await res.json()) as ElementMappingDocument;
      setDoc(json);
    } catch (e) {
      setErr(`無法載入 / 解析 mapping JSON：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [mapUrl]);

  const fake = doc ? isFakeMappingDocument(doc) : false;
  const blockReason = doc ? mappingVerificationBlockReason(doc) : null;
  const items = doc?.items ?? [];

  return (
    <>
      <h1>Semantic Viewer · IFC→USD 語意檢核（H）</h1>
      <p className="ec-lead">
        載入轉換產出的 <code>element_mapping.json</code>（IFC GUID ⇔ USD Prim Path），檢視語意對照。
        嚴守 fake-vs-real 隔離：mock / fake mapping 一律標示為示範資料，不冒充真實對映。
      </p>

      <Panel title="載入 mapping artifact" sub="mapping URL（conversion artifact）；可從 ifc-ready job（帶轉換產出）定位，或直接貼入" prov="artifact">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" style={{ minWidth: 420 }} placeholder="element_mapping.json 的 URL（artifact 來源）" value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} />
          <Btn primary disabled={busy || !mapUrl.trim()} caption="fetch mapping JSON" onClick={loadMapping}>{busy ? "載入中…" : "載入 mapping"}</Btn>
          <Btn caption="GET /api/external/ifc-ready（找帶 mapping 產出的 job）" onClick={loadCandidates}>列出真實 job</Btn>
        </div>
        {err && <p className="ec-warn-note">{err}</p>}
        {candidates.length > 0 && (
          <div className="ec-note" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span>真實 job 候選（帶 mapping 產出，點選自動填入 mapping URL）：</span>
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
        <p className="ec-note">mapping 為 conversion artifact（權威在 streaming-server / artifact store）；本頁唯讀檢視，不寫回、不覆蓋真實 mapping。</p>
      </Panel>

      {doc && (
        <>
          {fake && (
            <div className="ec-fake-banner">
              偵測到 fake / mock mapping（{blockReason}）。此資料<strong>僅可做 smoke test</strong>，已標示為示範資料，
              不列入正式 mapping 驗證、不冒充真實對映。
            </div>
          )}
          <Panel
            title="mapping 摘要"
            sub={fake ? "此 mapping 為示範資料（fake / mock）" : "真實 mapping artifact"}
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
            <Panel title="元件對照 · IFC GUID ⇔ USD Prim Path" sub="逐筆標示是否為 fake item（不混淆真假）" prov={fake ? "demo" : "artifact"}>
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
                        <td>{it.usd_prim_path ?? <span className="ec-warn-note">null（未對映）</span>}</td>
                        <td>{it.mapping_method ?? ""}{itemFake && <span className="ec-prov ec-demo" style={{ marginLeft: 6 }}>fake</span>}</td>
                        <td>
                          <Btn prov="p1" disabled caption="需 viewer DataChannel（focusPrim / highlightPrims）">在 3D 標示</Btn>
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

      <Panel title="範圍與誠實標示" prov="asbuilt">
        <Field k="mapping fake-vs-real 隔離" v="mock / allow_fake_mapping / fake_mapping_count>0 / mapping_method=fake_for_smoke_test 一律當 fake（重用既有 isFakeMappingDocument）" prov="asbuilt" />
        <Field k="點構件 → 3D highlight" v="需 viewer 的 WebRTC DataChannel（focusPrim / highlightPrims）；console 殼層與 viewer 互斥掛載、無 DataChannel → 標 p1，不做假按鈕" prov="p1" />
        <Field k="mapping 權威" v="conversion artifact（streaming-server / artifact store 唯讀）；本頁不覆蓋、不冒充" prov="asbuilt" />
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
    catch (e) { setErr(`未連線 coordinator /api/runtime/status：${String(e)}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1>Coordinator Console · C / Hybrid Runtime Orchestrator</h1>
      <p className="ec-lead">
        會議生命週期 / Kit 綁定 / IFC-ready 派工 / callback outbox，全經 coordinator :8004。
        本頁讀 <code>/api/runtime/status</code>（coordinator-visible read-only summary）；瀏覽器不直連 49100/49101/49102。
        誠實標示：Kit 首幀 / GPU 無統一遙測（port listening ≠ has frame）→ 不畫成 fail、不捏造秒數。
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
    catch (e) { setErr(`未連線 coordinator /api/external/ifc-ready：${String(e)}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1>Model Intake · 接收與轉換（C）</h1>
      <p className="ec-lead">
        外部 IFC Worker → coordinator <code>/api/external/ifc-ready</code> → 內部轉換 authority（bim-streaming-server）。
        本頁讀 intake 佇列；轉換品質 / mapping 可信度為 artifact，不承諾精準 GUID。
      </p>
      <Panel
        title="IFC-ready intake 佇列"
        sub="GET /api/external/ifc-ready?limit=1..100 · status / download_status 為 as-built"
        prov="asbuilt"
        actions={<Btn disabled={busy} caption="GET /api/external/ifc-ready" onClick={load}>{busy ? "讀取中…" : "重新整理"}</Btn>}
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
        ) : <p className="ec-note">{err ? "" : "目前無 intake job（coordinator 已連線，佇列為空——非錯誤）。"}</p>}
      </Panel>

      <Panel title="轉換品質與 mapping 可信度 · 誠實標示" sub="coordinator 不計算，只轉發 conversion authority 值；無遙測欄位標未取得" prov="artifact">
        <Field k="quality_metrics_summary" v="coverage_status / unmapped_count / coverage_ratio（pass-through artifact，隨 conversion result 提供）" prov="artifact" />
        <Field k="semantic_mapping_fidelity" v="guid_exact / ifc_class_grouped_with_name（缺欄位時 fallback null）" prov="artifact" />
        <Field k="精準 GUID 對映" v="MVP 不承諾精準 GUID；需 streaming adapter force IfcOpenShell USD 模式（PoC），允許人工校正" prov="demo" />
        <Field k="conversion 秒數 / GPU" v="未取得（無統一遙測來源）" prov="demo" />
        <Field k="manual mapping correction UI" v="待建" prov="p15" />
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
  const [scSession, setScSession] = useState("");
  const [sc, setSc] = useState<string | null>(null);
  const [scErr, setScErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setRt(await coordinatorClient.runtimeStatus()); }
    catch (e) { setErr(`未連線 coordinator /api/runtime/status：${String(e)}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const fetchStreamConfig = useCallback(async () => {
    if (!scSession.trim()) return;
    setScErr(null); setSc(null);
    try { setSc(JSON.stringify(await coordinatorClient.streamConfig(scSession.trim()), null, 2)); }
    catch (e) { setScErr(`stream-config 讀取失敗：${String(e)}`); }
  }, [scSession]);

  return (
    <>
      <h1>Runtime Dashboard · 串流執行狀態（F）</h1>
      <p className="ec-lead">
        Kit 實例綁定 / stream-config，由 coordinator <strong>read-only proxy</strong> 轉發；瀏覽器永不直連 49100/49101。
        GPU / 轉換秒數無統一遙測 → 標未取得（idle，非 fail）。
      </p>
      <Panel
        title="Host-native plane 觀測"
        sub="GET /api/runtime/status · observations（read-only；Kit 內部 stage state 仍需 DataChannel / log 佐證）"
        prov="asbuilt"
        actions={<Btn disabled={busy} caption="GET /api/runtime/status" onClick={load}>{busy ? "讀取中…" : "重新整理"}</Btn>}
      >
        {err && <p className="ec-warn-note">{err}</p>}
        {rt && (
          <>
            <Field k="conversion authority" v={`${rt.configured_endpoints.conversion_authority.authority} · ${rt.configured_endpoints.conversion_authority.base_url}`} prov="asbuilt" />
            <Field k="Kit signal ports" v={rt.observations.host_native_plane.kit_signal_ports.join(", ") || "—"} prov="asbuilt" />
            <Field k="Kit media ports" v={rt.observations.host_native_plane.kit_media_ports.join(", ") || "—"} prov="asbuilt" />
            <Field k="GPU / VRAM / util" v="未取得（streaming 未提供統一 GPU 遙測）" prov="demo" />
            <Field k="觀測分類" v={rt.observations.note} prov="asbuilt" />
          </>
        )}
      </Panel>

      {rt && (
        <Panel title="Kit 實例綁定 · kit_instance_bindings" sub="provider local_fixed；state = KitInstance.status 權威 enum" prov="asbuilt">
          {rt.kit_instance_bindings.length > 0 ? (
            <table className="ec-table">
              <thead><tr><th>kit_instance_id</th><th>session</th><th>state</th><th>started_at</th></tr></thead>
              <tbody>
                {rt.kit_instance_bindings.slice(0, 20).map((b, i) => (
                  <tr key={i}><td>{b.kit_instance_id}</td><td>{b.session_id}</td><td>{b.status}</td><td>{b.started_at ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="ec-note">無 Kit 綁定（無 active session 時為空；routing_policy=dedicated_instance 超出 endpoint 數會停在 queued_for_instance）。</p>}
        </Panel>
      )}

      <Panel title="stream-config · 給 viewer 的連線資訊" sub="GET /api/review-sessions/:id/stream-config（coordinator owner）" prov="asbuilt">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" style={{ minWidth: 320 }} placeholder="review_session_id" value={scSession} onChange={(e) => setScSession(e.target.value)} />
          <Btn disabled={!scSession.trim()} caption="GET …/stream-config" onClick={fetchStreamConfig}>讀取 stream-config</Btn>
        </div>
        {scErr && <p className="ec-warn-note">{scErr}</p>}
        {sc && <pre className="ec-note" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{sc}</pre>}
        <p className="ec-note">stream-config 為 coordinator owner 的真實端點；GPU 串流由 host-native Kit 負責，本面板僅唯讀轉發連線資訊，不開串流、不捏造遙測。</p>
      </Panel>

      <Panel title="治理規則執行綁定（A1）" sub="governance-service :49102 為內部服務（經 coordinator proxy）" prov="asbuilt">
        <Field k="rule-run authority" v="A1 後端已實作（見 Issues · Rule Center 頁可真實觸發）" prov="asbuilt" />
      </Panel>
    </>
  );
}

// ── P4 Review Room（G）v1：維持殼層狀態 + 加「在既有 viewer 開啟」連結 ──
// 真實 3D viewport 在既有 <App/> viewer（非 console）。本頁不動 App.tsx / Window.tsx，
// 只提供連到既有 viewer 入口的連結：coordinator /ui/open?session=（server-side redirect，
// 查證自 app.ts:1587）或本地 viewer /?session=（main.tsx 解析 ?session= attach）。
// 工具列誠實標來源：openStage/focusPrim/selectPrims/clearHighlight 為 viewer DataChannel
// as-built；highlight 走 client 主動拉（不復活 server-push）；section/snapshot 待建。
export function ReviewRoomPage() {
  const [sessionId, setSessionId] = useState("");
  const sid = sessionId.trim();
  // session id 必須符合 viewer attach（main.tsx）與 coordinator /ui/open（app.ts:1590）共用的權威格式
  // /^(lwv_|review_session_)[A-Za-z0-9_]+$/。不符者 viewer 無法 attach、coordinator /ui/open 直接回 400，
  // 故拒絕產生連結（不產生會被後端打回的壞連結，不發明「attach 預檢」幻覺端點）。
  const valid = /^(lwv_|review_session_)[A-Za-z0-9_]+$/.test(sid);
  // invalid 時連結為 undefined（不渲染成可互動 anchor），避免 href="#" 被鍵盤 / 螢幕閱讀器啟用後跳到 #。
  const viewerLocalUrl = valid ? `/?session=${encodeURIComponent(sid)}` : undefined;
  const viewerOpenUrl = valid ? coordinatorClient.openInViewerUrl(sid) : undefined;

  return (
    <>
      <h1>Review Room · 審查室（G）</h1>
      <p className="ec-lead">
        USD over WebRTC live viewport 在<strong>既有 viewer（web-viewer-sample &lt;App/&gt;）</strong>，非 console 殼層內。
        本頁 v1：提供連到既有 viewer 入口的連結（不在 console 內嵌 3D）；highlight 走 Review-Room 主動拉 → client DataChannel，不復活 server-push。
      </p>

      <Panel title="在既有 viewer 開啟 · Open in viewer" sub="輸入 review_session_id（lwv_ / review_session_ 前綴）；連到既有 viewer，不動 App.tsx / Window.tsx" prov="asbuilt">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" style={{ minWidth: 360 }} placeholder="review_session_xxx 或 lwv_xxx" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          {/* 真實 gating：session id 格式不合（viewer / coordinator 都會拒）則不渲染 href、不可聚焦
              （tabIndex=-1）、aria-disabled，鍵盤與螢幕閱讀器都無法啟用，不是只靠 pointerEvents 的假禁用。 */}
          <a className={`ec-btn ${valid ? "primary" : ""}`} {...(valid ? { href: viewerOpenUrl, target: "_blank", rel: "noreferrer" } : { tabIndex: -1 })}
             style={valid ? undefined : { pointerEvents: "none", opacity: 0.45 }} aria-disabled={!valid}>
            coordinator /ui/open（redirect）
          </a>
          <a className="ec-btn" {...(valid ? { href: viewerLocalUrl, target: "_blank", rel: "noreferrer" } : { tabIndex: -1 })}
             style={valid ? undefined : { pointerEvents: "none", opacity: 0.45 }} aria-disabled={!valid}>
            本地 viewer /?session=
          </a>
        </div>
        {!valid && sessionId.length > 0 && <p className="ec-warn-note">此 session id 不符 viewer attach 格式（需 lwv_ 或 review_session_ 前綴 + 英數底線）；viewer 無法 attach、coordinator /ui/open 會回 400 → 連結停用，不產生壞連結。</p>}
        <p className="ec-note">
          coordinator <code>/ui/open?session=</code> 為 server-side redirect 至 browser-visible viewer（as-built，app.ts）；
          本地 <code>/?session=</code> 由既有 main.tsx 解析 attach。本頁僅導引，不在 console 殼層內掛載 WebRTC。
        </p>
      </Panel>

      <Panel title="工具列 · Tool Rail（既有 viewer 內）" sub="每顆工具標來源：viewer DataChannel as-built 指令 vs 待建" prov="asbuilt">
        <table className="ec-table">
          <thead><tr><th>工具</th><th>command</th><th>provenance</th></tr></thead>
          <tbody>
            {([
              ["載入 USD", "openStage", "asbuilt"],
              ["聚焦元件", "focusPrim", "asbuilt"],
              ["選取元件", "selectPrims", "asbuilt"],
              ["清除高亮", "clearHighlight", "asbuilt"],
              ["高亮元件", "highlightPrims（client 主動拉，非 server-push）", "p15"],
              ["剖面", "sectionRequest", "p15"],
              ["截圖", "snapshot", "p15"],
            ] as [string, string, Prov][]).map(([l, cmd, p]) => (
              <tr key={cmd}><td>{l}</td><td>{cmd}</td><td><ProvTag prov={p} /></td></tr>
            ))}
          </tbody>
        </table>
        <p className="ec-note">Load / Focus / Select / Clear 為 viewer DataChannel as-built 指令；Highlight 走 Review Room 主動拉 prim_paths（不復活 server-push · P1.5）；Section / Snapshot 後端未實作。</p>
      </Panel>

      <Panel title="範圍與誠實標示" prov="asbuilt">
        <Field k="3D viewport" v="在既有 viewer（<App/>），非 console 殼層；本頁僅連結導引" prov="asbuilt" />
        <Field k="server→viewer push highlight / 多人廣播" v="2026-05-21 已退役（remove-conflict-review-from-fast-mvp）；加回需另開 OpenSpec" prov="p15" />
        <Field k="section / snapshot" v="待建" prov="p15" />
        <Field k="不動 App.tsx / Window.tsx" v="本頁僅提供連結，不改 viewer 主體（守 console 邊界）" prov="asbuilt" />
      </Panel>
    </>
  );
}

export function StubPage({ title, note, items }: { title: string; note: string; items: [string, string, Prov][] }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="ec-lead">{note}</p>
      <Panel title="狀態">
        {items.map(([k, v, p], i) => (
          <Field key={i} k={k} v={v} prov={p} />
        ))}
      </Panel>
    </>
  );
}

export const PAGE_TITLE: Record<string, string> = Object.fromEntries(PAGES.map((p) => [p.key, p.label]));
