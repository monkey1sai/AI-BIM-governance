// Edge Console 頁面。誠實原則：AS-BUILT 才標已實作；待建一律標 p1/p15 並說明；
// 任何數字非真即標 artifact / demo，絕不捏造。
import { useCallback, useState } from "react";
import { Btn, Field, Metric, Panel, ProvTag } from "./components";
import { A1A10, AppCardDef, PAGES, Prov } from "./data";
import { CoordReport, DiffIssueImpact, DiffItemRow, DiffOverlayResult, DiffStatus, FederatedBuildResult, governanceClient, IssueRow, ReviewRoomDescriptor, RuleResultRow, RuleRunStatus } from "./governanceClient";

// A1 真實 IFC 驗證 artifact（committed evidence，PR #151；非捏造，為實測值）。
const A1_EVIDENCE = { schema: "IFC4X3", file: "fixture-bytes.ifc", total: 7126, passed: 7055, failed: 71, score: 99.0, date: "2026-06-02" };

export function OverviewPage() {
  return (
    <>
      <h1>系統總覽 · Edge Console Overview</h1>
      <p className="ec-lead">
        落地端重量伺服器（AI-BIM-governance）的操作頁。每塊資料都標來源：已實作 / 實測 artifact /
        示範 / 後端待建。畫面無任何願景假數字。
      </p>
      <Panel title="落地端健康狀態 · Edge Health" sub="coordinator / kit 為 as-built；conversion / gpu 無遙測標未取得，不畫成 fail" prov="asbuilt">
        <div className="ec-grid">
          <Field k="COORD Coordinator :8004" v="control plane" prov="asbuilt" />
          <Field k="KIT Runtime 49100/47998" v="local_fixed" prov="asbuilt" />
          <Field k="CONV Conversion :49101" v="未取得" prov="demo" />
          <Field k="GPU" v="未取得" prov="demo" />
          <Field k="GOV governance-service :49102" v="rule-run authority" prov="asbuilt" />
        </div>
      </Panel>
      <Panel title="邊界 · Boundary" prov="asbuilt">
        <p className="ec-note">瀏覽器 → Coordinator :8004 only。streaming 49100/47998、conversion 49101、governance 49102 為內部 loopback，瀏覽器不直連。</p>
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
      className={`ec-appcard ${a.tier === "roadmap" ? "roadmap" : ""} ${a.route ? "" : "disabled"}`}
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
      <p className="ec-lead">十個應用模組入口。近期重點 A1–A3 為聚焦項；A4–A10 為 ROADMAP，標真實 Phase，後端未上線者灰掉不可點。</p>
      <Panel title="近期重點 · Focus" sub="A1–A3">
        <div className="ec-grid">{focus.map(Card)}</div>
      </Panel>
      <Panel title="後期願景 · Roadmap" sub="A4–A10 · Phase 3–4">
        <div className="ec-grid">{roadmap.map(Card)}</div>
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
