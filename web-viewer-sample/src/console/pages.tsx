// Edge Console 頁面。誠實原則：AS-BUILT 才標已實作；待建一律標 p1/p15 並說明；
// 任何數字非真即標 artifact / demo，絕不捏造。
import React, { useCallback, useState } from "react";
import { Btn, Field, Metric, Panel, ProvTag } from "./components";
import { A1A10, AppCardDef, PAGES } from "./data";
import { DiffItemRow, DiffStatus, governanceClient, RuleResultRow, RuleRunStatus } from "./governanceClient";

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
        <Field k="A2 版本差異 · A3 Federation" v="前端骨架 + spec" prov="p1" />
        <Field k="Issue 資料庫 / BCF 匯出 / IDS 匯入" v="待建" prov="p1" />
      </Panel>
    </>
  );
}

export function IssuesRuleCenterPage() {
  const [ifcPath, setIfcPath] = useState("C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\fixture-bytes.ifc");
  const [run, setRun] = useState<RuleRunStatus | null>(null);
  const [failed, setFailed] = useState<RuleResultRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doRun = useCallback(async () => {
    setBusy(true); setErr(null); setRun(null); setFailed([]);
    try {
      const { rule_run_id } = await governanceClient.createRuleRun({ ifc_source_path: ifcPath });
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
  }, [ifcPath]);

  return (
    <>
      <h1>問題與語意驗收 · Issues & Rule Center（A1）</h1>
      <p className="ec-lead">
        A1 治理與模型檢核：對真實 IFC 跑宣告式規則集，產出 governance score 與帶真實 ifc_guid 的失敗構件。
        規則引擎為純 CPU host-native ifcopenshell（不依賴 ifctester）。
      </p>

      <Panel title="A1 rule-run authority" sub="governance-service :49102（經 coordinator proxy）" prov="asbuilt">
        <p className="ec-note">後端已實作並以真實 IFC 驗證（見下方 artifact）。本頁經 coordinator <code>/api/governance/*</code> proxy 觸發實時 rule-run。</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" style={{ minWidth: 420 }} value={ifcPath} onChange={(e) => setIfcPath(e.target.value)} />
          <Btn primary disabled={busy} caption="POST /api/governance/rule-runs" onClick={doRun}>
            {busy ? "執行中…" : "執行規則檢核"}
          </Btn>
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
        <Field k="IDS-XML 匯入" v="待建（需 pip install ifctester + smoke）" prov="p1" />
        <Field k="Excel 匯出" v="openpyxl" prov="asbuilt" />
        <Field k="BCF 匯出（issue→.bcfzip）" v="待建（bcf 模組 + LGPL 閘門）" prov="p15" />
        <Field k="Issue 生命週期資料庫" v="待建" prov="p1" />
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
  const [items, setItems] = useState<DiffItemRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null); setDiff(null); setItems([]);
    try {
      const { diff_id } = await governanceClient.createDiff({ base_ifc_path: base, target_ifc_path: target });
      let st: DiffStatus | null = null;
      for (let i = 0; i < 120; i++) {
        st = await governanceClient.getDiff(diff_id);
        if (st.status === "succeeded" || st.status === "failed") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      setDiff(st);
      if (st && st.status === "succeeded") setItems(await governanceClient.getDiffItems(diff_id));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [base, target]);

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
          <div>
            <Btn primary disabled={busy} caption="GlobalId 多級對齊" onClick={run}>{busy ? "比對中…" : "Run Diff"}</Btn>
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
      </Panel>
      <Panel title="範圍與誠實標示" prov="asbuilt">
        <Field k="geometry_changed" v="MVP 未做幾何 tessellation 比對（僅 placement/pset）" prov="p1" />
        <Field k="3D overlay 顏色（綠/紅/橘/藍）" v="走 client highlightPrimsRequest，非 server-push" prov="p15" />
        <Field k="Issue impact（resolved/reopened/new）" v="待 Issue DB" prov="p1" />
      </Panel>
    </>
  );
}

export function FederationPage() {
  return (
    <>
      <h1>跨專業模型 Federation · A3</h1>
      <p className="ec-lead">用 OpenUSD sublayer 把多個 discipline 模型疊在同一 stage，不破壞原始 model.usdc。前端骨架 + OpenSpec spec 已就緒；後端待建。</p>
      <Panel title="Federation Builder（骨架）" prov="p1">
        <Field k="疊合機制" v="sublayer（最弱 LIVERPS 弧）+ reference；sessionLayer 僅暫態" prov="p1" />
        <Field k="schema" v="federated_model_sets / federated_model_members" prov="p1" />
        <Field k="API" v="POST /api/federated-sets · /members · /build · /validate-coords" prov="p1" />
        <Field k="不變式" v="member model.usdc byte 不變（immutable）" prov="p1" />
      </Panel>
      <p className="ec-warn-note">A3 後端為 change 4（usd-federation-sublayer-sets）；座標系驗證為 #1 風險，先 validate-coords 再 build。</p>
    </>
  );
}

export function StubPage({ title, note, items }: { title: string; note: string; items: [string, string, "asbuilt" | "demo" | "p1" | "p15"][] }) {
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
