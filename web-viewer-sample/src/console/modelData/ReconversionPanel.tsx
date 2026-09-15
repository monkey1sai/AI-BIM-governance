import { useCallback, useEffect, useRef, useState } from "react";
import { coordinatorClient, type ConversionRecord, type MinioObject } from "../coordinatorClient";
import { Btn, Field, Panel } from "../components";
import { IntentDialog } from "../IntentDialog";
import { buildHandoff } from "../handoff";
import { t } from "../i18n";

type Pending = { requestId: string; etag: string };
const requestId = () => `reconvert-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const statusLabel = (status: string) => ({ detected: "待確認／提交中", queued: "排隊中", converting: "轉檔中", ready: "轉檔成功", failed: "失敗" }[status] ?? status);
const failureLabel = (code: string | null | undefined) => ({
  source_changed: "來源 IFC 已變更；請重新整理來源後再確認轉檔。",
  source_download_failed: "來源 IFC 下載失敗；請確認來源可讀取後重試。",
  conversion_failed: "轉檔服務回報失敗；舊成功結果未被覆寫。",
  dispatch_unconfirmed: "派工結果尚未確認；不可另建重複工作，請至進件佇列檢查／重派原工作。",
}[code ?? ""] ?? "失敗原因未記錄；請查看轉檔服務紀錄。");

/** Result selection is separate from the live Viewer. Only an explicit handoff changes the review target. */
export function ReconversionPanel({ object, onHistoryChange }: { object: MinioObject; onHistoryChange?: () => Promise<void> }): JSX.Element {
  const storageKey = `aibim:reconversion:${object.idempotency_key}:${object.key}`;
  const [records, setRecords] = useState<ConversionRecord[]>([]);
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const alive = useRef(true);
  const loading = useRef(false);
  const acting = useRef(false);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const result = await coordinatorClient.getObjectConversionHistory(object.key, object.idempotency_key);
      if (alive.current) { setRecords(result.items); setCount(result.count); setLoadError(null); setLoaded(true); }
      await onHistoryChange?.();
    } catch {
      if (alive.current) setLoadError(t("未取得最新結果；保留上次資料，請重新整理。", "Latest results unavailable. Previous data is retained; refresh to retry."));
    } finally { loading.current = false; }
  }, [object.key, object.idempotency_key, onHistoryChange]);
  useEffect(() => {
    alive.current = true;
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Pending | null;
      if (value && /^[A-Za-z0-9_-]{16,128}$/.test(value.requestId) && /^[A-Za-z0-9_-]{1,256}$/.test(value.etag)) setPending(value);
    } catch { setError(t("無法讀取先前操作紀錄；請先恢復瀏覽器儲存功能。", "Unable to read the previous intent; restore browser storage first.")); }
    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, [load, storageKey]);

  const confirm = async () => {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const intent = pending ?? { requestId: requestId(), etag: object.etag };
      // Save before POST: reload or uncertain response must not mint another intent.
      sessionStorage.setItem(storageKey, JSON.stringify(intent));
      setPending(intent);
      const result = await coordinatorClient.reconvertIfc(object.key, intent.requestId, intent.etag);
      sessionStorage.removeItem(storageKey);
      if (!alive.current) return;
      setPending(null); setDialog(false);
      setNotice(result.status === "failed"
        ? t("這次操作已失敗；舊結果不受影響。可重新整理來源後再建立新操作。", "This attempt failed; previous results are unchanged. Refresh the source before a new attempt.")
        : t("已收到轉檔操作回覆；以結果列表為準，尚未切換 3D。", "Conversion request acknowledged. Follow the result list; 3D has not switched."));
      await load();
    } catch (failure) {
      if (!alive.current) return;
      const detail = String(failure);
      // Definitive rejection did not accept a new job. Transport/5xx remains uncertain.
      if (/\b(400|403|409)\b/.test(detail)) { sessionStorage.removeItem(storageKey); setPending(null); }
      setError(/\b403\b/.test(detail)
        ? t("目前沒有轉檔操作權限。請由管理者確認既有操作員授權；不要輸入服務 token。", "Conversion permission denied. Ask an administrator to verify operator authorization; do not enter a service token.")
        : `${t("未完成；請核對結果後重試。同一操作會沿用原請求。", "Not completed. Check the results before retrying the same intent.")} ${detail}`);
      await load();
    } finally { acting.current = false; if (alive.current) setBusy(false); }
  };

  const openResult = async (record: ConversionRecord) => {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError(null);
    const reviewKey = `aibim:reconversion-review:${record.idempotency_key}`;
    try {
      const intentId = sessionStorage.getItem(reviewKey) ?? requestId();
      sessionStorage.setItem(reviewKey, intentId);
      const result = await coordinatorClient.readyReviewSession(record.idempotency_key, { mode: "create_new", request_id: intentId });
      const runtime = await coordinatorClient.runtimeStatus();
      const session = runtime.sessions.items.find(item => item.session_id === result.review_session_id);
      if (!session || !["created", "active"].includes(session.status) || session.ready_model_id !== record.idempotency_key
        || session.project_id !== record.project_id || session.model_version_id !== record.external_model_version_id) {
        throw new Error(t("審查與所選轉檔結果尚未對應，請重試確認。", "The review is not yet bound to the selected conversion; retry to verify."));
      }
      if (!alive.current) return;
      sessionStorage.removeItem(reviewKey);
      window.location.hash = buildHandoff("a1", { source: "minio", session: session.session_id,
        conversion_id: record.conversion_job_id ?? undefined });
    } catch (failure) { if (alive.current) setError(String(failure)); }
    finally { acting.current = false; if (alive.current) setBusy(false); }
  };

  const active = records.some(row => ["detected", "queued", "converting"].includes(row.status));
  return <Panel title={t("重新轉檔與結果歷史", "Reconversion & result history")} prov="asbuilt">
    <p className="ec-note">{t("使用同一份 IFC 建立新結果，不需重新上傳。舊 USDC 與審查會保留。", "Create a new result from the same IFC without uploading again. Existing USDCs and reviews are retained.")}</p>
    <Field k={t("目前轉檔服務版本", "Current converter version")} v={t("版本未知（服務尚未提供 build 身分）", "Unknown (the service does not publish build identity)")} />
    <div className="ec-row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Btn data-testid="reconversion-start" disabled={busy || !loaded || Boolean(loadError) || !object.etag || (active && !pending)}
        onClick={() => { setDialog(true); setError(null); }}>
        {pending ? t("重試確認同一操作", "Retry the same intent") : t("使用目前部署版本重新轉檔", "Reconvert with the deployed converter")}
      </Btn>
      <Btn data-testid="reconversion-refresh" disabled={busy} onClick={() => { void load(); }}>{t("重新整理結果", "Refresh results")}</Btn>
    </div>
    {!loaded && !loadError && <p role="status">{t("讀取此 IFC 的轉檔紀錄…", "Loading conversion history…")}</p>}
    {active && <p role="status">{t("此 IFC 有尚未結束的操作；先查看進度，不重複排入。", "This IFC has an unfinished attempt; check its progress before submitting another.")}</p>}
    {notice && <p role="status" data-testid="reconversion-notice">{notice}</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {error && !dialog && <p role="alert">{error}</p>}
    {loaded && !records.length && <p>{t("尚無可追溯的結果。", "No traceable results yet.")}</p>}
    {count > records.length && <p>{t("僅顯示最近 100 次；尚有更早紀錄。", "Showing the latest 100 attempts; older history exists.")}</p>}
    <div data-testid="reconversion-history">
      {records.map(record => <article className="op-model-identity" key={record.idempotency_key} data-testid="reconversion-result">
        <strong>{record.status === "queued" && record.dispatch_state === "dispatched" ? "已送交轉檔服務，等待結果" : statusLabel(record.status)} · {record.detected_at}</strong>
        <div>{record.conversion_job_id ?? t("尚未取得 conversion ID", "Conversion ID not available yet")}</div>
        {(record.status === "failed" || record.failure_code) && <p role="alert">{failureLabel(record.failure_code)}</p>}
        {record.failure_code === "dispatch_unconfirmed" && <Btn onClick={() => { window.location.hash = buildHandoff("conv", { source: "minio", conversion_id: record.conversion_job_id ?? undefined }); }}>{t("查看進件佇列", "View intake queue")}</Btn>}
        <div>{t("產物轉檔版本：", "Artifact converter: ")}{record.converter_version ?? t("版本未知", "Unknown")}</div>
        <div>{record.source_etag ? (record.source_etag === object.etag ? t("來源與目前 IFC 一致", "Source matches the current IFC") : t("來源版本不同於目前 IFC", "Source differs from the current IFC")) : t("歷史來源 ETag 未記錄", "Historical source ETag not recorded")}</div>
        <details><summary>{t("來源與產物識別", "Source and artifact identity")}</summary>
          <Field k="result ID" v={record.idempotency_key} /><Field k="USDC" v={record.usdc_key ?? "—"} />
          <Field k="IFC SHA-256" v={record.source_sha256 ?? t("未知", "Unknown")} />
        </details>
        {record.status === "ready" && <Btn data-testid="reconversion-open" disabled={busy || Boolean(loadError)} onClick={() => { void openResult(record); }}>
          {t("以此結果建立並開啟審查", "Create and open a review of this result")}
        </Btn>}
      </article>)}
    </div>
    <p className="ec-note">{t("開啟審查後，仍需在 3D 工作區按「啟動 3D」。收到新 Stage 與畫面前，不代表 Viewer 已切換。", "After opening a review, start 3D in the workspace. The Viewer has not switched until the new Stage and frame are received.")}</p>
    <IntentDialog open={dialog} title={t("確認使用目前部署版本重新轉檔", "Confirm reconversion with the deployed converter")}
      cost={t("將使用此 IFC 的已確認版本建立獨立結果，保留舊產物、舊審查與目前 3D。轉檔服務版本尚未提供，無法保證與舊產物的程式版本不同。", "Create an independent result from the confirmed IFC, preserving old artifacts, reviews and current 3D. The converter build is unknown; a newer version cannot be guaranteed.")}
      showReason={false} busy={busy} actionErr={error} onConfirm={confirm} onCancel={() => { if (!busy) setDialog(false); }} />
  </Panel>;
}
