// Edge Console 頁面。誠實原則：AS-BUILT 才標已實作；待建一律標 p1/p15 並說明；
// 任何數字非真即標 artifact / demo，絕不捏造。
import { useCallback, useEffect, useState } from "react";
import { Btn, Field, Metric, Panel, ProvTag } from "./components";
import { A1A10, A1A10_DETAIL, AppCardDef, AppVisionDetail, DEPENDENCIES, ENDPOINTS, PAGES, Prov, SERVICES } from "./data";
import { CoordReport, DiffIssueImpact, DiffItemRow, DiffOverlayResult, DiffStatus, FederatedBuildResult, governanceClient, IssueRow, ReviewRoomDescriptor, RuleResultRow, RuleRunStatus } from "./governanceClient";
import { coordinatorClient, IfcReadyListItem, RuntimeStatus } from "./coordinatorClient";
// 重用既有 viewer 的 mapping fake-vs-real 隔離工具（已有測試）：mock / allow_fake_mapping /
// fake_mapping_count>0 / mapping_method=fake_for_smoke_test 一律當 fake，不重造輪子。
import { ElementMappingDocument, isFakeMappingDocument, isFakeMappingItem, mappingVerificationBlockReason } from "../types/mapping";

// A1 真實 IFC 驗證 artifact（committed evidence，PR #151；非捏造，為實測值）。
const A1_EVIDENCE = { schema: "IFC4X3", file: "fixture-bytes.ifc", total: 7126, passed: 7055, failed: 71, score: 99.0, date: "2026-06-02" };

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
          <Field
            k="COORD Coordinator :8004"
            v={health === "ok" ? "control plane · /health ok" : health === "down" ? "未連線（/health 不可達）" : "control plane（探活中…）"}
            prov={health === "down" ? "demo" : "asbuilt"}
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
        sub="A1 core 雖零 GPU / 零 NVIDIA runtime，仍依賴下列元件；LGPL / copyleft 商用前須法務確認（不得宣稱無授權風險）"
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

export function IssuesRuleCenterPage() {
  const [ifcPath, setIfcPath] = useState("C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\fixture-bytes.ifc");
  const [idsPath, setIdsPath] = useState("");
  const [run, setRun] = useState<RuleRunStatus | null>(null);
  const [failed, setFailed] = useState<RuleResultRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [issues, setIssues] = useState<IssueRow[]>([]);

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
          <div className="ec-grid" style={{ marginTop: 12 }}>
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
              a.click();
              // 延後釋放 object URL：同步 revoke 會在瀏覽器開始讀取 blob 前就釋放，導致（尤其較大檔）下載被中止（CodeRabbit）。
              setTimeout(() => URL.revokeObjectURL(url), 0);
            } catch (e) { setErr(String(e)); }
          }}>匯出 Excel</Btn>
          {/* [在 3D 中標示]：console 為 /console 獨立殼層，與 viewer <App/> 互斥掛載，無 WebRTC
              DataChannel；highlightPrimsRequest 需 viewer DataChannel（Window 內），此鏈未接 →
              誠實標 p1（後續整合），永遠 disabled，不做點了沒反應的假按鈕。 */}
          <Btn prov="p1" disabled caption="需 viewer DataChannel（highlightPrimsRequest）— 後續整合">在 3D 中標示</Btn>
        </div>
        {failed.length > 0 && (
          <table className="ec-table" style={{ marginTop: 12 }}>
            <thead><tr><th>rule_code</th><th>severity</th><th>ifc_type</th><th>ifc_guid</th><th>usd_prim_path</th></tr></thead>
            <tbody>
              {failed.slice(0, 30).map((r, i) => (
                <tr key={i}>
                  <td>{r.rule_code}</td><td>{r.severity}</td><td>{(r as { ifc_type?: string }).ifc_type ?? ""}</td>
                  <td>{r.ifc_guid}</td><td>{r.usd_prim_path ?? <span className="ec-warn-note">null（未對映）</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
              a.click();
              URL.revokeObjectURL(a.href);
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

  const run = useCallback(async () => {
    setBusy(true); setErr(null); setDiff(null); setItems([]); setImpact(null); setOverlay(null);
    try {
      const { diff_id } = await governanceClient.createDiff({ base_ifc_path: base, target_ifc_path: target, include_geometry: includeGeo });
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
  }, [base, target, includeGeo]);

  const counts = diff?.summary?.counts ?? {};
  return (
    <>
      <h1>模型版本差異與責任追蹤 · A2</h1>
      <p className="ec-lead">
        以 IFC GlobalId 多級對齊（GlobalId → Tag → type+name+location）比對兩個 model version，
        標記 added / removed / moved / property changed。純 CPU，不需 GPU。
      </p>
      <Panel title="Diff Builder" sub="POST /api/governance/diffs（經 coordinator proxy → governance-service）" prov="asbuilt">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input className="ec-btn" style={{ width: "100%" }} value={base} onChange={(e) => setBase(e.target.value)} />
          <input className="ec-btn" style={{ width: "100%" }} value={target} onChange={(e) => setTarget(e.target.value)} />
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
// mapping URL 來源：真實 session 的 expected_mapping_url（runtime/status）或操作員貼入。
// 凡 mock / allow_fake_mapping / fake_mapping_count>0 / mapping_method=fake_for_smoke_test 一律標
// demo 並「拒絕當正式 mapping 驗證」，禁覆蓋 / 禁冒充真 mapping。點構件 highlight 需 viewer
// DataChannel（console 殼層無此鏈）→ 誠實標 p1，不做假按鈕。
export function SemanticViewerPage() {
  const [mapUrl, setMapUrl] = useState("");
  const [doc, setDoc] = useState<ElementMappingDocument | null>(null);
  const [candidates, setCandidates] = useState<IfcReadyListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 從 runtime/status 撈帶 expected_mapping_url 的真實 session，方便操作員選擇真實 artifact。
  const loadCandidates = useCallback(async () => {
    setErr(null);
    try {
      const rt = await coordinatorClient.runtimeStatus();
      const withMap = rt.sessions.items.filter((s) => s.expected_stage_url);
      // sessions.items 無 mapping_url，但 ifc_ready_jobs 可間接定位；這裡以 sessions 帶 stage 的為候選，
      // 真正 mapping_url 由 session detail / expected_mapping_url 提供（操作員亦可直接貼 URL）。
      setCandidates([]);
      if (withMap.length === 0) setErr("runtime/status 無帶 mapping 的 session（可直接貼 mapping URL 載入）");
    } catch (e) {
      setErr(`未連線 coordinator /api/runtime/status：${String(e)}`);
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

      <Panel title="載入 mapping artifact" sub="mapping URL（conversion artifact）；可從 runtime/status 的真實 session 取得，或直接貼入" prov="artifact">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" style={{ minWidth: 420 }} placeholder="element_mapping.json 的 URL（artifact 來源）" value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} />
          <Btn primary disabled={busy || !mapUrl.trim()} caption="fetch mapping JSON" onClick={loadMapping}>{busy ? "載入中…" : "載入 mapping"}</Btn>
          <Btn caption="GET /api/runtime/status（找帶 mapping 的 session）" onClick={loadCandidates}>列出真實 session</Btn>
        </div>
        {err && <p className="ec-warn-note">{err}</p>}
        {candidates.length > 0 && (
          <p className="ec-note">真實 session 候選：{candidates.map((c) => c.ifc_ready_job_id).join(" · ")}</p>
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
      <h1>Coordinator Console · 控制平面（B）</h1>
      <p className="ec-lead">
        會議生命週期 / Kit 綁定 / IFC-ready 派工 / callback outbox，全經 coordinator :8004。
        本頁讀 <code>/api/runtime/status</code>（coordinator-visible read-only summary）；瀏覽器不直連 49100/49101/49102。
        誠實標示：Kit 首幀 / GPU 無統一遙測（port listening ≠ has frame）→ 不畫成 fail、不捏造秒數。
      </p>
      <Panel
        title="Review sessions · 生命週期"
        sub="GET /api/runtime/status · status：created / active / closing / closed / failed（KitInstance 權威 enum）"
        prov="asbuilt"
        actions={<Btn disabled={busy} caption="GET /api/runtime/status" onClick={load}>{busy ? "讀取中…" : "重新整理"}</Btn>}
      >
        {err && <p className="ec-warn-note">{err}</p>}
        {rt && (
          <>
            <div className="ec-grid" style={{ marginBottom: 10 }}>
              <Metric value={rt.sessions.count} label="sessions" />
              <Metric value={rt.sessions.active_count} label="active" />
              <Metric value={rt.sessions.participant_count} label="participants" />
              <Metric value={rt.ifc_ready_jobs.count} label="ifc-ready jobs" />
            </div>
            {rt.sessions.items.length > 0 ? (
              <table className="ec-table">
                <thead><tr><th>session_id</th><th>status</th><th>model_version</th><th>participants</th><th>kit_instance</th></tr></thead>
                <tbody>
                  {rt.sessions.items.slice(0, 30).map((s) => (
                    <tr key={s.session_id}>
                      <td>{s.session_id}</td><td>{s.status}</td><td>{s.model_version_id}</td>
                      <td>{s.participant_count}</td><td>{s.kit_instance_ids.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="ec-note">目前無 session（coordinator 已連線，列表為空——非錯誤）。</p>}
          </>
        )}
      </Panel>

      {rt && (
        <Panel title="Kit Endpoint 綁定 · kit_instance_bindings" sub="state = KitInstance.status 權威 enum；last frame 無資料源 → 不顯示假秒數" prov="asbuilt">
          {rt.kit_instance_bindings.length > 0 ? (
            <table className="ec-table">
              <thead><tr><th>kit_instance_id</th><th>session</th><th>state</th><th>last_heartbeat</th></tr></thead>
              <tbody>
                {rt.kit_instance_bindings.slice(0, 20).map((b, i) => (
                  <tr key={i}>
                    <td>{b.kit_instance_id}</td><td>{b.session_id}</td><td>{b.status}</td>
                    <td>{b.last_heartbeat_at ?? <span className="ec-warn-note">未取得</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="ec-note">無 Kit 綁定（無 active session 時為空）。</p>}
          <p className="ec-note">「port listening ≠ has frame」：首幀 / GPU 無統一遙測來源 → 不畫成 fail、不捏造秒數。</p>
        </Panel>
      )}

      {rt && (
        <Panel title="Callback outbox · 回寫公司雲端" sub="僅 metadata，非雙向同步；直查 outbox 需 internal token（瀏覽器不可達）" prov="asbuilt">
          {rt.ifc_ready_jobs.recent.filter((j) => j.callback_outbox_id).length > 0 ? (
            <table className="ec-table">
              <thead><tr><th>ifc_ready_job</th><th>conversion_status</th><th>callback_outbox_id</th></tr></thead>
              <tbody>
                {rt.ifc_ready_jobs.recent.filter((j) => j.callback_outbox_id).slice(0, 20).map((j) => (
                  <tr key={j.ifc_ready_job_id}>
                    <td>{j.ifc_ready_job_id}</td><td>{j.conversion_status ?? "—"}</td><td>{j.callback_outbox_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="ec-note">目前無帶 callback_outbox_id 的 job。outbox 三態詳情（delivered/pending/dead_letter）需 internal-token 端點，瀏覽器不可達 → 此處僅顯示 coordinator 摘要可見的關聯，不捏造投遞數。</p>}
        </Panel>
      )}
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
  const valid = /^(lwv_|review_session_)[A-Za-z0-9_]+$/.test(sessionId.trim());
  const sid = sessionId.trim();
  const viewerLocalUrl = valid ? `/?session=${encodeURIComponent(sid)}` : "#";
  const viewerOpenUrl = valid ? coordinatorClient.openInViewerUrl(sid) : "#";

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
          {/* 真實 gating：session id 格式不合則 disabled（非可點假連結）。 */}
          <a className={`ec-btn ${valid ? "primary" : ""}`} href={viewerOpenUrl} target="_blank" rel="noreferrer"
             style={valid ? undefined : { pointerEvents: "none", opacity: 0.45 }} aria-disabled={!valid}>
            coordinator /ui/open（redirect）
          </a>
          <a className="ec-btn" href={viewerLocalUrl} target="_blank" rel="noreferrer"
             style={valid ? undefined : { pointerEvents: "none", opacity: 0.45 }} aria-disabled={!valid}>
            本地 viewer /?session=
          </a>
        </div>
        {!valid && sessionId.length > 0 && <p className="ec-warn-note">session id 格式不符（需 lwv_ 或 review_session_ 前綴 + 英數底線）；連結停用。</p>}
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
