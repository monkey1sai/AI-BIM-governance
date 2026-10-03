import { useEffect, useRef, useState } from "react";
import type { GroundAssessmentReport, GroundSurfaceClient, GroundVersion } from "./groundSurfaceClient";
import { controlField } from "./controlStyles";

export interface GroundAssessmentPanelProps {
  sessionId: string; sourceKey: string; saved: GroundVersion | null; ready: boolean; client?: GroundSurfaceClient;
}
const failureMessages: Record<string, string> = {
  ground_version_not_found: "找不到保存版本，請重新讀回地面選取。",
  ground_run_not_found: "找不到此 CFD 算例，請核對算例 ID。",
  ground_version_source_mismatch: "地面或算例不屬於目前模型，請核對來源。",
  ground_source_changed: "來源或連線權限已變更，請重新讀回保存版本。",
  ground_upstream_rejected: "服務拒絕核對；請核對算例來源與完成狀態。服務忙碌時可稍後重試。",
  ground_primary_lease_required: "目前沒有可用的 Viewer 主控連線，請重新連接原審查。",
  ground_assessment_source_mismatch: "回覆與目前保存版本或指定算例不符，未採用此報告。",
};

/** Source-bound preparation only. A successful request never means CFD engineering passed. */
export function GroundAssessmentPanel({ sessionId, sourceKey, saved, ready, client }: GroundAssessmentPanelProps) {
  const [runId, setRunId] = useState(""), [wind, setWind] = useState("0");
  const [report, setReport] = useState<GroundAssessmentReport | null>(null);
  const [message, setMessage] = useState("讀回保存版本，再指定既有 CFD 算例與風向。");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0), pending = useRef<object | null>(null), readyRef = useRef(ready);
  readyRef.current = ready;
  const invalidate = () => { epoch.current++; setReport(null); };
  useEffect(() => {
    invalidate(); pending.current = null; setBusy(false); setRunId(""); setWind("0");
    setMessage("讀回保存版本，再指定既有 CFD 算例與風向。");
    return () => { epoch.current++; pending.current = null; };
  }, [sessionId, sourceKey, saved?.selection_id, saved?.selection_sha256, saved?.model_usdc_sha256]);
  useEffect(() => {
    if (!ready) { invalidate(); setMessage("Viewer 尚未就緒；來源核對報告已清除。"); }
    else if (!pending.current) setMessage("請指定既有 CFD 算例與風向，再核對已保存來源。");
  }, [ready]);
  const direction = Number(wind);
  const validInput = /^cfd_[A-Za-z0-9_]{6,120}$/.test(runId.trim()) && wind.trim() !== ""
    && Number.isFinite(direction) && direction >= 0 && direction < 360;
  const assess = async () => {
    if (!readyRef.current || !client || !saved || !validInput || pending.current) return;
    invalidate(); const current = epoch.current, operation = {}; pending.current = operation; setBusy(true);
    const valid = () => current === epoch.current && readyRef.current;
    setMessage("核對保存原面、模型來源與算例資料…");
    try {
      const result = await client.assessment(sessionId, saved.selection_id, { source_run_id: runId.trim(), wind_from_degrees: direction });
      if (!valid()) return;
      const pair = (value: unknown): value is number[] => Array.isArray(value) && value.length === 2 && value.every(n => typeof n === "number" && Number.isFinite(n));
      if (result.schema !== "cfd-ground-service-assessment/v1" || result.status !== "HELD" || result.authority !== "source_bound_metadata_only"
          || result.selection_id !== saved.selection_id || result.selection_sha256 !== saved.selection_sha256
          || result.conversion_job_id !== saved.conversion_job_id || result.model_usdc_sha256 !== saved.model_usdc_sha256
          || result.source_run_id !== runId.trim() || result.wind_from_degrees !== direction
          || result.checks?.fresh_source_verified !== true || result.checks.fresh_faces_verified !== true || result.checks.selection_ledger_verified !== true
          || !pair(result.selected_surface_z_range_m) || !pair(result.relative_target_z_range_m)
          || result.old_plane_minus_relative_target_range_m !== null && !pair(result.old_plane_minus_relative_target_range_m)
          || !Array.isArray(result.reasons) || !result.reasons.every(reason => typeof reason === "string")
          || !result.case_declared || result.case_declared.sampling_plane_z_m !== null && !Number.isFinite(result.case_declared.sampling_plane_z_m)
          || result.actual_ground_verified !== false || result.fluid_region_verified !== false || result.velocity_sampled !== false
          || result.solver_started !== false || result.inlet_boundary_files_checked !== false) throw new Error("ground_assessment_source_mismatch");
      setReport(result); setMessage("來源核對報告已讀回；工程驗證待完成（HELD）。");
    } catch (error) {
      if (valid()) { setReport(null); setMessage(`來源核對未完成：${failureMessages[error instanceof Error ? error.message : ""] ?? "服務未能完成核對，請稍後再試；沒有產生有效報告。"}`); }
    } finally {
      if (pending.current === operation) { pending.current = null; setBusy(false); }
    }
  };
  const edit = (work: () => void) => { invalidate(); work(); setMessage("設定已變更，請重新核對；舊報告已清除。"); };
  const range = (values: number[] | null) => values === null ? "未知" : `${values[0].toFixed(6)}–${values[1].toFixed(6)} m`;
  const link = (status: string) => status === "verified" ? "已核對" : "未知（歷史連結不足）";
  return <section data-testid="ground-assessment-panel" style={{ display: "grid", gap: 8 }} aria-label="地面與算例來源核對">
    <div>地面與算例來源核對：不啟動新計算，不變更既有 CFD。</div>
    <label>來源 CFD 算例 ID<input data-testid="ground-assessment-run" style={controlField} maxLength={124} value={runId}
      disabled={busy || !ready || !saved} onChange={event => edit(() => setRunId(event.target.value))} /></label>
    <label>來源風向（來向，度）<input data-testid="ground-assessment-wind" style={controlField} type="number" min="0" max="359.999999" step="any" value={wind}
      disabled={busy || !ready || !saved} onChange={event => edit(() => setWind(event.target.value))} /></label>
    <button data-testid="ground-assessment-submit" disabled={!ready || !saved || !client || busy || !validInput} onClick={() => void assess()}>核對地面與算例來源</button>
    <div data-testid="ground-assessment-status" role="status" style={{ height: 64, overflow: "auto", overflowWrap: "anywhere" }}>{message}</div>
    <div data-testid="ground-assessment-report" style={{ height: 260, overflow: "auto", overflowWrap: "anywhere" }}>
      {report ? <><div>工程驗證待完成（HELD）</div><div>算例 {report.source_run_id}；來向 {report.wind_from_degrees}°</div>
        <div>模型、保存版本與原面來源：已核對</div>
        <div>算例紀錄：{link(report.checks.run_record_link)}；方向 metadata：{link(report.checks.case_metadata_link)}；排除清單：{link(report.checks.exclusions_link)}</div>
        <div>原面 Z：{range(report.selected_surface_z_range_m)}</div><div>相對原面 1.5 m 目標 Z：{range(report.relative_target_z_range_m)}</div>
        <div>舊取樣平面 Z：{report.case_declared.sampling_plane_z_m === null ? "未知" : `${report.case_declared.sampling_plane_z_m.toFixed(6)} m`}</div>
        <div>舊平面與相對目標的高度差：{range(report.old_plane_minus_relative_target_range_m)}</div>
        {report.reasons.includes("selected_component_excluded_from_preprocess") && <div>注意：所選地形構件未納入原 CFD 前處理。</div>}
        {report.reasons.includes("flat_ground_differs_from_selected_surface") && <div>原算例的平坦地面基準與選面高程不同。</div>}
        {report.reasons.includes("selected_surface_elevation_varies") && <div>選面有高程變化，不能以單一地面高度取代。</div>}
      </> : <div>尚無有效來源核對報告。</div>}
      <div>尚未驗證實際計算地面、有效流體與入流，未讀取風速。位置或 metadata 核對通過不代表風場已修正。</div>
    </div>
  </section>;
}
