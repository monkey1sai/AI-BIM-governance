import { useCallback, useEffect, useRef, useState } from "react";
import { Btn } from "./components";
import { coordinatorClient, type ConversionRecord, type ReadyReviewSessionResponse, type RuntimeSessionSummary } from "./coordinatorClient";
import { t } from "./i18n";

const PENDING_KEY = "ai-bim.ready-review-request.v1";
type PendingCreate = { readyModelId: string; requestId: string };
function readPending(): PendingCreate | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as PendingCreate | null;
    return value && /^mw_[a-f0-9]{16}$/.test(value.readyModelId)
      && /^[A-Za-z0-9._:-]{1,128}$/.test(value.requestId) ? value : null;
  } catch { return null; }
}

export function ReadyReviewSessions({ sessions, onSelected }: {
  sessions: RuntimeSessionSummary[];
  onSelected: (session: RuntimeSessionSummary) => void;
}) {
  const [records, setRecords] = useState<ConversionRecord[]>([]);
  const [modelId, setModelId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCreate | null>(readPending);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stoppedRequest, setStoppedRequest] = useState<PendingCreate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReadyReviewSessionResponse | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await coordinatorClient.getConversionRecords(200);
      if (alive.current) setRecords(response.items.filter(record => record.status === "ready"));
    } catch (failure) {
      if (alive.current) setLoadError(String(failure));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const model = records.find(record => record.idempotency_key === modelId);
  const available = model ? sessions.filter(session =>
    (session.status === "created" || session.status === "active")
    && session.project_id === model.project_id
    && session.model_version_id === model.external_model_version_id) : [];

  const submit = async (target: PendingCreate | { readyModelId: string; sessionId: string }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await coordinatorClient.readyReviewSession(target.readyModelId,
        "requestId" in target
          ? { mode: "create_new", request_id: target.requestId }
          : { mode: "open_existing", session_id: target.sessionId });
      if (response.session_status === "created" || response.session_status === "active") {
        const runtime = await coordinatorClient.runtimeStatus();
        const selected = runtime.sessions.items.find(session => session.session_id === response.review_session_id);
        if (!selected || !["created", "active"].includes(selected.status)) {
          throw new Error(t("審查狀態已變更，請重試以重新確認。", "The review state changed. Retry to verify it."));
        }
        if (!alive.current) return;
        onSelected(selected);
      }
      if (!alive.current) return;
      if ("requestId" in target) {
        sessionStorage.removeItem(PENDING_KEY);
        setPending(null);
      }
      setResult(response);
    } catch (failure) {
      if (alive.current) setError(String(failure));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const create = () => {
    if (!model || pending || inFlight.current) return;
    try {
      const next = { readyModelId: modelId, requestId: "review-" + crypto.randomUUID() };
      // Persist before sending: after a lost response or page reload, retry this request.
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(next));
      setPending(next);
      void submit(next);
    } catch {
      setError(t("無法保存建立請求；請允許此頁使用瀏覽器儲存空間後重試。", "The request could not be saved. Allow browser storage and retry."));
    }
  };

  return <section data-testid="ready-review-sessions" aria-label={t("建立與開啟審查", "Create or open a review")}>
    <h3>{t("建立與開啟審查", "Create or open a review")}</h3>
    <p className="ec-note">{t("選擇已完成轉檔的模型。建立審查後，再由您明確啟動 3D。", "Choose a converted model. Start 3D separately after creating the review.")}</p>
    {loading && <p role="status">{t("讀取可審查模型…", "Loading available models…")}</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {!loading && !loadError && records.length === 0 && <p>{t("尚無可審查模型；請先完成轉檔。", "No models are ready for review. Complete conversion first.")} <a href="#pipeline">{t("前往轉檔", "Open pipeline")}</a></p>}
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label htmlFor="ready-review-model">{t("審查模型", "Review model")}</label>
      <select id="ready-review-model" data-testid="ready-review-model" value={modelId}
        disabled={busy || loading || Boolean(loadError)}
        onChange={event => { setModelId(event.target.value); setSelectedId(""); setResult(null); setError(null); }}>
        <option value="">{t("— 選擇模型與版本 —", "— Choose a model and version —")}</option>
        {records.map(record => <option key={record.idempotency_key} value={record.idempotency_key}>
          {record.project_display_name || record.project_id} / {record.external_model_version_id} / {record.object_key?.split("/").pop() || record.idempotency_key}
        </option>)}
      </select>
      <Btn data-testid="ready-review-create" disabled={!model || busy || loading || Boolean(pending) || Boolean(loadError)} onClick={create}>
        {t("建立新的審查", "Create a new review")}
      </Btn>
      <Btn disabled={busy || loading} onClick={() => { void load(); }}>{t("重新整理模型", "Refresh models")}</Btn>
    </div>
    {model && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
      <label htmlFor="ready-review-existing">{t("既有審查", "Existing review")}</label>
      <select id="ready-review-existing" data-testid="ready-review-existing" value={selectedId} disabled={busy}
        onChange={event => { setSelectedId(event.target.value); setResult(null); }}>
        <option value="">{t("— 選擇既有審查 —", "— Choose an existing review —")}</option>
        {available.map(session => <option key={session.session_id} value={session.session_id}>{session.session_id}</option>)}
      </select>
      <Btn data-testid="ready-review-open" disabled={busy || loading || Boolean(loadError) || !available.some(session => session.session_id === selectedId)}
        onClick={() => { void submit({ readyModelId: modelId, sessionId: selectedId }); }}>
        {t("開啟所選審查", "Open selected review")}
      </Btn>
    </div>}
    {pending && <div className="ec-note" data-testid="ready-review-pending">
      {t("上次建立請求尚待確認；重試會取回同一筆審查。", "The previous creation is awaiting confirmation. Retrying retrieves the same review.")}
      <Btn data-testid="ready-review-retry" disabled={busy} onClick={() => { void submit(pending); }}>{t("重試建立請求", "Retry creation")}</Btn>
      <Btn data-testid="ready-review-stop" disabled={busy} onClick={() => setConfirmStop(true)}>{t("停止追蹤此請求", "Stop tracking this request")}</Btn>
      {confirmStop && <div role="group" aria-label={t("確認停止追蹤", "Confirm stopping tracking")}>
        <p>{t("前次請求可能已建立審查。停止追蹤不會刪除它；請先查看既有審查，再決定是否另建。", "The previous request may have created a review. Stopping tracking does not delete it. Check existing reviews before creating another.")}</p>
        <p>{pending.readyModelId} / {pending.requestId}</p>
        <Btn disabled={busy} onClick={() => setConfirmStop(false)}>{t("繼續追蹤", "Keep tracking")}</Btn>
        <Btn data-testid="ready-review-confirm-stop" disabled={busy} onClick={() => {
          try {
            sessionStorage.removeItem(PENDING_KEY);
            setStoppedRequest(pending); setPending(null); setConfirmStop(false); setError(null);
          } catch { setError(t("無法移除待確認請求；請保留原請求重試。", "Cannot clear the pending request. Keep the original request and retry.")); }
        }}>{t("確認停止追蹤", "Confirm stopping tracking")}</Btn>
      </div>}
    </div>}
    {stoppedRequest && <p className="ec-note" data-testid="ready-review-stopped">{t("已停止追蹤，前次結果仍未確認：", "Tracking stopped; the previous result is still unconfirmed: ")}{stoppedRequest.readyModelId} / {stoppedRequest.requestId}</p>}
    {busy && <p role="status">{t("正在確認審查…", "Confirming review…")}</p>}
    {error && <p role="alert" data-testid="ready-review-error">{error}</p>}
    {result && <p role="status" data-testid="ready-review-success">
      {["created", "active"].includes(result.session_status)
        ? t("審查已選取：", "Review selected: ")
        : t("此請求對應的審查已結束，請從封存清單重建：", "This request belongs to a closed review. Recreate it from the archive: ")}
      <strong>{result.review_session_id}</strong>
    </p>}
  </section>;
}
