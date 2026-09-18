import { useCallback, useEffect, useRef, useState } from "react";
import { Btn } from "./components";
import { coordinatorClient, type ConversionRecord, type ReadyReviewSessionResponse, type RuntimeSessionSummary } from "./coordinatorClient";
import { t } from "./i18n";
import { SessionIdentity } from "./SessionIdentityCard";
import { modelOptionLabel, sessionOptionLabel, sortByCreatedDesc } from "./sessionIdentity";

const PENDING_KEY = "ai-bim.ready-review-request.v1";
type PendingCreate = { readyModelId: string; requestId: string };
function readPending(): PendingCreate | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as PendingCreate | null;
    return value && /^mw_[a-f0-9]{16}$/.test(value.readyModelId)
      && /^[A-Za-z0-9._:-]{1,128}$/.test(value.requestId) ? value : null;
  } catch { return null; }
}

// 預設審查：優先 MinIO 自動審查（規則檢核的 for-session 只認得它），否則取最新建立的一筆。
function preferredReviewId(reviews: RuntimeSessionSummary[]): string {
  const auto = reviews.filter(session => session.origin?.kind === "auto_conversion_ready");
  return (sortByCreatedDesc(auto)[0] ?? sortByCreatedDesc(reviews)[0])?.session_id ?? "";
}

export function ReadyReviewSessions({ sessions, onSelected, onSessionsRefreshed, onModelsReloaded, currentSessionId = "" }: {
  sessions: RuntimeSessionSummary[];
  onSelected: (session: RuntimeSessionSummary) => void;
  onSessionsRefreshed: (sessions: RuntimeSessionSummary[]) => void;
  /** 使用者按「重新整理模型」時通知呼叫端，讓依賴同一批模型的清單一起更新。 */
  onModelsReloaded?: () => void;
  /** A1 目前選定的審查；其他入口換了審查時，這裡的模型與審查選單跟著顯示同一筆。 */
  currentSessionId?: string;
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
      const [response, runtime] = await Promise.all([
        coordinatorClient.getConversionRecords(200), coordinatorClient.runtimeStatus(),
      ]);
      if (alive.current) {
        setRecords(response.items.filter(record => record.status === "ready"));
        onSessionsRefreshed(runtime.sessions.items.filter(session => session.status === "created" || session.status === "active"));
      }
    } catch (failure) {
      if (alive.current) setLoadError(String(failure));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [onSessionsRefreshed]);
  useEffect(() => { void load(); }, [load]);

  const reviewsFor = (record: ConversionRecord | undefined) => record ? sessions.filter(session =>
    (session.status === "created" || session.status === "active")
    && session.ready_model_id === record.idempotency_key
    && session.project_id === record.project_id
    && session.model_version_id === record.external_model_version_id) : [];
  const model = records.find(record => record.idempotency_key === modelId);
  // 此 endpoint 只接受 canonical ready-model；dev intake 的 ledger key 不是該身分。
  // 保留紀錄可觀測，不偽造 mw_ ID 或把「轉檔完成」視為已具備建立審查的資格。
  const supportsReadyReview = Boolean(model && /^mw_[a-f0-9]{16}$/.test(model.idempotency_key));
  const available = reviewsFor(model);
  const current = currentSessionId ? sessions.find(session => session.session_id === currentSessionId) ?? null : null;

  // 只在「目前審查」換了之後對齊一次；之後使用者自行瀏覽別的模型，不會被輪詢拉回來。
  const reflectedSessionId = useRef("");
  useEffect(() => {
    if (!currentSessionId) { reflectedSessionId.current = ""; return; }
    if (reflectedSessionId.current === currentSessionId || !current?.ready_model_id) return;
    if (!records.some(record => record.idempotency_key === current.ready_model_id)) return;
    reflectedSessionId.current = currentSessionId;
    setModelId(current.ready_model_id);
    setSelectedId(currentSessionId);
  }, [currentSessionId, current, records]);

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
    if (!supportsReadyReview || pending || inFlight.current) return;
    try {
      const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const next = { readyModelId: modelId, requestId: "review-" + randomPart };
      // Persist before sending: after a lost response or page reload, retry this request.
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(next));
      setPending(next);
      void submit(next);
    } catch {
      setError(t("無法保存建立請求；請允許此頁使用瀏覽器儲存空間後重試。", "The request could not be saved. Allow browser storage and retry."));
    }
  };

  return <section data-testid="ready-review-sessions" aria-label={t("建立與開啟審查", "Create or open a review")}>
    <p className="ec-note">{t("選模型後會預先選好此模型的審查（優先 MinIO 自動審查）。按「開啟所選審查」，再按左側「啟動 A1 3D Session」；此處選取不代表 3D 畫面已切換。需要另一筆獨立審查時才按「建立新的審查」。", "Choosing a model preselects its review (the MinIO auto review first). Press Open selected review, then Start A1 3D Session on the left; selection here does not mean the displayed model has switched. Create a new review only when you need a separate one.")}</p>
    {loading && <p role="status">{t("讀取可審查模型…", "Loading available models…")}</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {!loading && !loadError && records.length === 0 && <p>{t("尚無可審查模型；請先完成轉檔。", "No models are ready for review. Complete conversion first.")} <a href="#pipeline">{t("前往轉檔", "Open pipeline")}</a></p>}
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label htmlFor="ready-review-model">{t("審查模型", "Review model")}</label>
      <select id="ready-review-model" data-testid="ready-review-model" value={modelId}
        disabled={busy || loading || Boolean(loadError)}
        onChange={event => {
          const nextModelId = event.target.value;
          setModelId(nextModelId);
          setSelectedId(preferredReviewId(reviewsFor(records.find(record => record.idempotency_key === nextModelId))));
          setResult(null); setError(null);
        }}>
        <option value="">{t("— 選擇模型與版本 —", "— Choose a model and version —")}</option>
        {/* session-identity-display §2.3：依專案 optgroup 分組（轉檔新到舊），option 不再以「檔名未提供」開頭。 */}
        {(() => {
          // 以 project_id 分組（不同 project_id 即不同 ready-model 身分）；label 用顯示名，顯示名碰撞時附 project_id 以資區辨。
          const groups = new Map<string, ConversionRecord[]>();
          for (const record of records) groups.set(record.project_id, [...(groups.get(record.project_id) ?? []), record]);
          const labelCount = new Map<string, number>();
          for (const [projectId, items] of groups) { const l = items[0].project_display_name || projectId; labelCount.set(l, (labelCount.get(l) ?? 0) + 1); }
          return [...groups.entries()].map(([projectId, items]) => {
            const base = items[0].project_display_name || projectId;
            const label = (labelCount.get(base) ?? 0) > 1 && base !== projectId ? `${base}（${projectId}）` : base;
            return (
            <optgroup key={projectId} label={label}>
              {items.slice().sort((a, b) => (Date.parse(b.detected_at) || 0) - (Date.parse(a.detected_at) || 0)).map(record => (
                <option key={record.idempotency_key} value={record.idempotency_key}>{modelOptionLabel(record)}</option>
              ))}
            </optgroup>
            );
          });
        })()}
      </select>
      <Btn data-testid="ready-review-refresh" disabled={busy || loading} onClick={() => { void load(); onModelsReloaded?.(); }}>{t("重新整理模型", "Refresh models")}</Btn>
    </div>
    {model && <div className="op-model-identity" data-testid="ready-review-model-identity">
      <strong>{t("準備開啟的模型", "Model selected for review")}</strong>
      <div>{model.object_key || t("MinIO 路徑未持久化（舊轉檔紀錄）", "MinIO path not persisted (legacy conversion record)")}</div>
      <div>{t("專案：", "Project: ")}{model.project_display_name || model.project_id} · {t("版本：", "Version: ")}{model.external_model_version_id}</div>
      <p>{t(`此模型有 ${available.length} 筆可用審查。審查不是檔案；同一模型的不同審查可能顯示相同畫面。`, `This model has ${available.length} available reviews. Reviews are not files; reviews of the same model may display the same scene.`)}</p>
      <details><summary>{t("查看模型識別資訊", "Model identifiers")}</summary><div>{model.idempotency_key}</div><div>USDC: {model.usdc_key || t("路徑未提供", "Path unavailable")}</div></details>
    </div>}
    {model && !supportsReadyReview && <p role="status" data-testid="ready-review-source-unavailable">
      {t("此轉檔紀錄未具備正式 ready-model 身分，不能從這裡建立或開啟審查。本機進件請使用下方「進階：依審查紀錄選取」開啟已建立的審查；MinIO 模型請確認來源進件完成。", "This conversion record has no canonical ready-model identity. Use the advanced review-record selector for an existing local-intake review, or complete source intake for a MinIO model.")}
    </p>}
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
      <label htmlFor="ready-review-existing">{t("審查", "Review")}</label>
      <select id="ready-review-existing" data-testid="ready-review-existing" value={selectedId} disabled={busy || !model}
        onChange={event => { setSelectedId(event.target.value); setResult(null); }}>
        <option value="">{!model
          ? t("— 先選模型 —", "— Choose a model first —")
          : available.length === 0
            ? t("（此模型尚無審查，可建立新的審查）", "(No review yet; create a new one)")
            : t("— 選擇審查 —", "— Choose a review —")}</option>
        {sortByCreatedDesc(available).map(session => <option key={session.session_id} value={session.session_id}>{sessionOptionLabel(session)}</option>)}
      </select>
      <Btn primary data-testid="ready-review-open" disabled={!supportsReadyReview || busy || loading || Boolean(loadError) || !available.some(session => session.session_id === selectedId)}
        onClick={() => { void submit({ readyModelId: modelId, sessionId: selectedId }); }}>
        {t("開啟所選審查", "Open selected review")}
      </Btn>
      <Btn data-testid="ready-review-create" disabled={!supportsReadyReview || busy || loading || Boolean(pending) || Boolean(loadError)} onClick={create}>
        {t("建立新的審查", "Create a new review")}
      </Btn>
      {available.some(session => session.session_id === selectedId) && (
        <div data-testid="ready-review-selected-identity" style={{ flexBasis: "100%", marginTop: 4 }}>
          <SessionIdentity session={available.find(session => session.session_id === selectedId)!} compact />
        </div>
      )}
    </div>
    {current && <p className="ec-note" data-testid="ready-review-current">
      {t("目前審查：", "Current review: ")}{sessionOptionLabel(current)}{t("。下一步按左側「啟動 A1 3D Session」連線 3D。", ". Next, press Start A1 3D Session on the left to connect 3D.")}
    </p>}
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
