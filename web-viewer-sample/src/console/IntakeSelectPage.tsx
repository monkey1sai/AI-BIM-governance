// web-viewer-sample/src/console/IntakeSelectPage.tsx
// /console/intake A1 進件：從 coordinator 既有 /api/external/ifc-ready 列現成模型 job 供「選取」，
// 不要求操作員手填模型檔案路徑（誠實鐵律 + spec：A1 進件於現成清單選取）。只打 coordinator :8004。
import { useCallback, useEffect, useState } from "react";
import { Btn, Panel } from "./components";
import { coordinatorClient, type IfcReadyListItem } from "./coordinatorClient";
import { t } from "./i18n";

// R3（安全）：viewer_url 即使由 coordinator 提供仍需驗證，否則 open-redirect / javascript: / data: 風險。
// 僅允許 http(s) 絕對 URL 或同源相對路徑（以 window.location.origin 為 base 解析後 protocol 必為 http/https）；
// javascript: / data: / 其他 scheme 一律拒絕。匯出為純函式以便直接單元測試。
export function isSafeViewerUrl(u?: string | null): boolean {
  if (!u) return false;
  try {
    const parsed = new URL(u, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    // R6（安全強化）：只查 protocol 仍放行 https://attacker.example（open-redirect / phishing）。
    // viewer_url 由 coordinator 提供，正當來源即同源（viewer app）或 coordinator origin → 限這兩者。
    const coordinatorOrigin = new URL(coordinatorClient.base, window.location.origin).origin;
    return parsed.origin === window.location.origin || parsed.origin === coordinatorOrigin;
  } catch {
    return false;
  }
}

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
      setErr(`${t("未連線 coordinator /api/external/ifc-ready：", "Not connected to coordinator /api/external/ifc-ready: ")}${String(e)}`); // 後端離線誠實顯示
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // W6：選取後可「開啟審查 viewer」。viewer_url 由 coordinator 提供（前端不捏造路徑）；
  // 缺 viewer_url 的 job 不可開（按鈕 disabled + 誠實說明），不做假導航。
  // R3（安全）：viewer_url 需先過 isSafeViewerUrl（拒 open-redirect / javascript: / data:）才導航。
  const selectedJob = jobs.find((j) => j.ifc_ready_job_id === selected) ?? null;
  const hasViewerUrl = Boolean(selectedJob?.viewer_url);
  const viewerUrlSafe = isSafeViewerUrl(selectedJob?.viewer_url);
  const canOpen = viewerUrlSafe;
  const openViewer = () => {
    const raw = selectedJob?.viewer_url;
    if (!raw || !isSafeViewerUrl(raw)) return;
    window.location.assign(new URL(raw, window.location.origin).toString());
  };

  return (
    <>
      <h1>{t("模型進件 · A1（選取現成模型）", "Model Intake · A1 (Select Existing Model)")}</h1>
      <p className="ec-lead">
        {t("從 coordinator ", "Lists converted, reviewable existing models from coordinator ")}<code>/api/external/ifc-ready</code>{t(" 列出已轉換、可審查的現成模型，直接", "; ")}<strong>{t("選取", "select")}</strong>{t("進件 —— 不需手動輸入模型檔案路徑。", " to intake — no manual model file path entry required.")}
      </p>
      <Panel
        title={t("選取現成模型 · IFC-ready（已轉換）", "Select Existing Model · IFC-ready (Converted)")}
        sub={t("GET /api/external/ifc-ready?limit=1..100 · 只列有 expected_stage_url 的 job", "GET /api/external/ifc-ready?limit=1..100 · only lists jobs with expected_stage_url")}
        prov="asbuilt"
        actions={
          <>
            <Btn disabled={busy} data-testid="intake-refresh" caption="GET /api/external/ifc-ready" onClick={load}>{busy ? t("讀取中…", "Loading…") : t("重新整理", "Refresh")}</Btn>
            <Btn
              primary
              data-testid="intake-open"
              caption={t("window.location.assign(job.viewer_url)（coordinator 提供）", "window.location.assign(job.viewer_url) (provided by coordinator)")}
              disabled={!canOpen}
              onClick={openViewer}
            >
              {t("開啟審查 viewer", "Open review viewer")}
            </Btn>
          </>
        }
      >
        {err && <p className="ec-warn-note" data-testid="intake-error">{err}</p>}
        {jobs.length === 0 && !err ? (
          <p className="ec-note" data-testid="intake-empty">{t("目前無可選現成模型（coordinator 已連線，佇列為空——非錯誤）。", "No existing models available to select (coordinator connected, queue empty — not an error).")}</p>
        ) : (
          <table className="ec-table" data-testid="intake-table">
            <thead><tr><th>{t("選取", "Select")}</th><th>ifc_ready_job_id</th><th>conversion</th><th>session</th></tr></thead>
            <tbody>
              {jobs.slice(0, 50).map((j) => (
                <tr key={j.ifc_ready_job_id}>
                  <td>
                    <input
                      type="radio"
                      name="intake-model"
                      data-testid="intake-radio"
                      aria-label={`${t("選取 ", "Select ")}${j.ifc_ready_job_id}`}
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
        {selectedJob && !canOpen && (
          <p className="ec-warn-note" data-testid="intake-open-blocked">
            {hasViewerUrl
              ? t("viewer_url 非安全 http(s)/同源路徑，拒絕導航", "viewer_url is not a safe http(s)/same-origin path; navigation refused")
              : t("此 job 尚無 viewer_url（coordinator 未提供可開啟的 viewer 入口）→「開啟審查 viewer」停用，不做假導航。", "This job has no viewer_url yet (coordinator has not provided an openable viewer entry) → \"Open review viewer\" disabled, no fake navigation.")}
          </p>
        )}
        <p className="ec-note">{t("進件來源為現成清單選取；模型路徑由 coordinator / conversion authority 持有，前端不手填、不直連內部埠。", "Intake source is selection from the existing list; model paths are held by the coordinator / conversion authority — the frontend does not enter them manually nor connect directly to internal ports.")}</p>
      </Panel>
    </>
  );
}
