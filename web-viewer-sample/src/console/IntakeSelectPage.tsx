// web-viewer-sample/src/console/IntakeSelectPage.tsx
// /console/intake A1 進件：從 coordinator 既有 /api/external/ifc-ready 列現成模型 job 供「選取」，
// 不要求操作員手填模型檔案路徑（誠實鐵律 + spec：A1 進件於現成清單選取）。只打 coordinator :8004。
import { useCallback, useEffect, useState } from "react";
import { Btn, Panel } from "./components";
import { coordinatorClient, type IfcReadyListItem } from "./coordinatorClient";

export function IntakeSelectPage() {
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      // 只列「有轉換產出 expected_stage_url」的 job 作可選現成模型（誠實：可審查者才可選）。
      const { items } = await coordinatorClient.listIfcReady(50);
      setJobs(items.filter((j) => j.expected_stage_url));
    } catch (e) {
      setErr(`未連線 coordinator /api/external/ifc-ready：${String(e)}`); // 後端離線誠實顯示
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1>模型進件 · A1（選取現成模型）</h1>
      <p className="ec-lead">
        從 coordinator <code>/api/external/ifc-ready</code> 列出已轉換、可審查的現成模型，
        直接<strong>選取</strong>進件 —— 不需手動輸入模型檔案路徑。
      </p>
      <Panel
        title="選取現成模型 · IFC-ready（已轉換）"
        sub="GET /api/external/ifc-ready?limit=1..100 · 只列有 expected_stage_url 的 job"
        prov="asbuilt"
        actions={<Btn disabled={busy} caption="GET /api/external/ifc-ready" onClick={load}>{busy ? "讀取中…" : "重新整理"}</Btn>}
      >
        {err && <p className="ec-warn-note">{err}</p>}
        {jobs.length === 0 && !err ? (
          <p className="ec-note">目前無可選現成模型（coordinator 已連線，佇列為空——非錯誤）。</p>
        ) : (
          <table className="ec-table">
            <thead><tr><th>選取</th><th>ifc_ready_job_id</th><th>conversion</th><th>session</th></tr></thead>
            <tbody>
              {jobs.slice(0, 50).map((j) => (
                <tr key={j.ifc_ready_job_id}>
                  <td>
                    <input
                      type="radio"
                      name="intake-model"
                      checked={selected === j.ifc_ready_job_id}
                      onChange={() => setSelected(j.ifc_ready_job_id)}
                    />
                  </td>
                  <td>{j.ifc_ready_job_id}</td>
                  <td>{j.conversion_status ?? "—"}</td>
                  <td>{j.review_session_id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="ec-note">進件來源為現成清單選取；模型路徑由 coordinator / conversion authority 持有，前端不手填、不直連內部埠。</p>
      </Panel>
    </>
  );
}
