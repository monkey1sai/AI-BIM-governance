// 3D 工作區「模型檔案」清單（契約 §5.1）：以檔案為中心，一列一個 IFC；動作依狀態出現，缺條件停用並說明。
import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, ProvTag } from "../components";
import { coordinatorClient, lifecycleConflict, type ConversionRecord, type RuntimeSessionSummary } from "../coordinatorClient";
import { t } from "../i18n";
import { IntentDialog } from "../IntentDialog";
import { lifecycleLabel } from "../modelData/conversionShared";
import { SessionIdentity } from "../SessionIdentityCard";
import { activeSessions, closedSessionCount, isMinioKey, modelFileLabel, preferredOpenTarget, removalState, unregisteredSources } from "./modelFileView";
import { useIfcIntakeRegistration, type IntakeProgress } from "./useIfcIntakeRegistration";
import { useReadyReviewRequest } from "./useReadyReviewRequest";

function progressText(progress: IntakeProgress | undefined): string {
  if (!progress) return "";
  switch (progress.kind) {
    case "registering": return t("註冊中…", "Registering…");
    case "converting": return t(`轉檔中（${progress.status}）`, `Converting (${progress.status})`);
    case "ready": return t("轉檔完成，審查已建立", "Converted; review created");
    case "download_failed": return t("下載失敗", "Download failed");
    case "conversion_failed": return t("轉檔失敗", "Conversion failed");
    case "blocked": return t("runtime 受阻", "Runtime blocked");
    case "timeout": return t(`逾時（仍為 ${progress.status}）`, `Timed out (still ${progress.status})`);
    case "error": return t(`錯誤：${progress.message}`, `Error: ${progress.message}`);
  }
}

/** 使用者選過的審查仍在進行中才採用；已關閉就退回預設目標，避免開到失效的審查。 */
function openTargetFor(record: ConversionRecord, chosen: string | undefined): string | undefined {
  return chosen && activeSessions(record).some((session) => session.session_id === chosen) ? chosen : preferredOpenTarget(record)?.session_id;
}

export function ModelFileList({ sessions, onSelected, onSessionsRefreshed, onModelsReloaded, currentSessionId = "" }: {
  sessions: RuntimeSessionSummary[];
  onSelected: (session: RuntimeSessionSummary) => void;
  onSessionsRefreshed: (sessions: RuntimeSessionSummary[]) => void;
  onModelsReloaded?: () => void;
  currentSessionId?: string;
}) {
  const [records, setRecords] = useState<ConversionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosenSession, setChosenSession] = useState<Record<string, string>>({});
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [response, runtime] = await Promise.all([coordinatorClient.getConversionRecords(100), coordinatorClient.runtimeStatus()]);
      if (!alive.current) return;
      setRecords(response.items);
      onSessionsRefreshed(runtime.sessions.items.filter((session) => session.status === "created" || session.status === "active"));
    } catch (failure) {
      if (alive.current) setLoadError(String(failure));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [onSessionsRefreshed]);
  useEffect(() => { void load(); }, [load]);

  const review = useReadyReviewRequest(onSelected);
  const intake = useIfcIntakeRegistration(() => { void load(); });

  // 目前審查換了才對齊一次並捲到該列；之後使用者自行瀏覽不被輪詢拉回。
  const reflected = useRef("");
  useEffect(() => {
    if (!currentSessionId || reflected.current === currentSessionId) return;
    const row = document.querySelector<HTMLElement>(`[data-testid="model-file-list"] [data-current="true"]`);
    if (row) { reflected.current = currentSessionId; row.scrollIntoView?.({ block: "nearest" }); }
  }, [currentSessionId, records]);

  const openRow = async (record: ConversionRecord) => {
    setOpenError(null);
    review.clearFeedback(); // 前一筆的成功／錯誤訊息不能留著指向別的審查
    const target = openTargetFor(record, chosenSession[record.idempotency_key]);
    if (!target) return;
    if (isMinioKey(record.idempotency_key)) { await review.openExisting(record.idempotency_key, target); return; }
    // 非 MinIO 紀錄沒有 ready-model 身分：直接選取既有進行中審查（不偽造 mw_ id）。
    const summary = sessions.find((session) => session.session_id === target);
    if (!summary) { setOpenError(t("該審查目前不在進行中清單，請重新整理。", "That review is not in the active list; refresh and retry.")); return; }
    onSelected(summary);
  };

  const confirmRemove = async () => {
    if (!removeKey || removeBusy) return;
    setRemoveBusy(true); setRemoveError(null);
    try {
      await coordinatorClient.removeConversionRecord(removeKey);
      if (!alive.current) return;
      setRemoveKey(null);
      await load();
    } catch (failure) {
      if (!alive.current) return;
      const conflict = lifecycleConflict(failure);
      setRemoveError(conflict
        ? `${conflict.code}${conflict.intakeStatus ? ` · intake ${conflict.intakeStatus}` : ""}${conflict.sessions?.length ? ` · ${conflict.sessions.join("、")}` : ""}`
        : String(failure));
    } finally {
      if (alive.current) setRemoveBusy(false);
    }
  };

  const localSources = unregisteredSources(intake.sources, records);
  const current = currentSessionId ? sessions.find((session) => session.session_id === currentSessionId) ?? null : null;

  return <section data-testid="model-file-list" aria-label={t("模型檔案", "Model files")}>
    <p className="ec-note">{t("每列是一個 IFC 檔。開啟審查後再按左側「啟動 A1 3D Session」；這裡的選取不代表 3D 畫面已切換。", "Each row is one IFC file. Open a review, then press Start A1 3D Session on the left; selecting here does not switch the 3D view.")}</p>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Btn data-testid="model-file-refresh" disabled={loading || review.busy} onClick={() => { void load(); void intake.loadSources(); onModelsReloaded?.(); }}>{t("重新整理", "Refresh")}</Btn>
      {loading && <span role="status">{t("讀取模型檔案…", "Loading model files…")}</span>}
    </div>
    {loadError && <p role="alert" data-testid="model-file-error">{loadError}</p>}
    {!loading && !loadError && records.length === 0 && localSources.length === 0 && (
      <p data-testid="model-file-empty">{t("尚無可審查模型；請先完成轉檔。", "No models are ready for review. Complete conversion first.")} <a href="#pipeline">{t("前往轉檔", "Open pipeline")}</a></p>
    )}

    {intake.devRoutes === "disabled" && (
      <p className="ec-note" data-testid="model-file-local-disabled"><ProvTag prov="p1" /> {t("本機 IFC 轉檔入口已關閉（ENABLE_DEV_ROUTES=false）；MinIO 進件不受影響。", "Local IFC conversion is disabled (ENABLE_DEV_ROUTES=false); MinIO intake is unaffected.")}</p>
    )}
    {intake.devRoutes === "enabled" && localSources.length > 0 && (
      <div data-testid="model-file-local-section" style={{ marginTop: 8 }}>
        <strong>{t("本機未轉檔 IFC", "Local IFC files not converted yet")}</strong>
        <table className="ec-table"><tbody>{localSources.map((source) => {
          const progress = intake.progress[source.source_id];
          const running = progress?.kind === "registering" || progress?.kind === "converting";
          return <tr key={source.source_id} data-testid={`model-file-local-${source.source_id}`}>
            <td>{source.filename}</td>
            <td><span className="ec-note" data-testid={`model-file-convert-status-${source.source_id}`}>{progressText(progress)}</span></td>
            <td><Btn data-testid={`model-file-convert-${source.source_id}`} disabled={running} caption="POST /api/dev/ifc-sources/{id}/register" onClick={() => { void intake.register(source); }}>{t("轉檔", "Convert")}</Btn></td>
          </tr>;
        })}</tbody></table>
      </div>
    )}
    {intake.loadError && <p className="ec-warn-note">{t("本機 IFC 清單載入失敗：", "Local IFC list failed: ")}{intake.loadError}</p>}

    {records.length > 0 && (
      <table className="ec-table" style={{ marginTop: 8 }}>
        <thead><tr><th>{t("檔案", "File")}</th><th>{t("轉檔", "Conversion")}</th><th>{t("審查", "Reviews")}</th><th>{t("動作", "Actions")}</th></tr></thead>
        <tbody>{records.map((record) => {
          const key = record.idempotency_key;
          const label = modelFileLabel(record);
          const active = activeSessions(record);
          const isCurrent = Boolean(currentSessionId) && record.sessions.some((session) => session.session_id === currentSessionId);
          const minio = isMinioKey(key);
          const ready = record.status === "ready";
          const removal = removalState(record);
          const openTarget = openTargetFor(record, chosenSession[key]) ?? "";
          return <tr key={key} data-testid={`model-file-row-${key}`} data-current={isCurrent ? "true" : undefined}>
            <td><div style={{ fontWeight: 600 }}>{label.title}</div><div className="ec-note">{label.subtitle}</div></td>
            <td><span className="ec-prov ec-artifact">{lifecycleLabel(record.status)}</span></td>
            <td>
              <div className="ec-note">{t(`進行中 ${active.length} · 已關閉 ${closedSessionCount(record)}`, `active ${active.length} · closed ${closedSessionCount(record)}`)}</div>
              {active.length > 1 && <select data-testid={`model-file-session-${key}`} value={openTarget} onChange={(event) => setChosenSession((cur) => ({ ...cur, [key]: event.target.value }))}>
                {active.map((session) => <option key={session.session_id} value={session.session_id}>{session.session_id}（{session.status}）</option>)}
              </select>}
            </td>
            <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Btn primary data-testid={`model-file-open-${key}`} disabled={!ready || active.length === 0 || review.busy || loading}
                caption={active.length === 0 ? t("此檔尚無進行中審查", "No active review for this file") : undefined}
                onClick={() => { void openRow(record); }}>{t("開啟審查", "Open review")}</Btn>
              <Btn data-testid={`model-file-create-${key}`} disabled={!minio || !ready || review.busy || loading || Boolean(review.pending)}
                caption={!minio ? t("僅 MinIO 進件可建立新審查；本機 IFC 請重新轉檔", "Only MinIO intake can create a new review; reconvert local IFC files") : !ready ? t("轉檔尚未完成", "Conversion not finished") : undefined}
                onClick={() => review.create(key)}>{t("建立新的審查", "Create a new review")}</Btn>
              <Btn data-testid={`model-file-remove-${key}`} disabled={!removal.allowed || loading} caption={removal.allowed ? "DELETE /api/conversion/records/{key}" : removal.reason}
                onClick={() => { setRemoveError(null); setRemoveKey(key); }}>{t("移除", "Remove")}</Btn>
            </td>
          </tr>;
        })}</tbody>
      </table>
    )}

    {current && <div className="ec-note" data-testid="model-file-current">{t("目前審查：", "Current review: ")}<SessionIdentity session={current} compact /></div>}
    {openError && <p role="alert">{openError}</p>}
    {review.pending && <div className="ec-note" data-testid="model-file-pending">
      {t("上次建立請求尚待確認；重試會取回同一筆審查。", "The previous creation is awaiting confirmation. Retrying retrieves the same review.")}
      <Btn data-testid="model-file-retry" disabled={review.busy} onClick={review.retry}>{t("重試建立請求", "Retry creation")}</Btn>
      <Btn data-testid="model-file-stop" disabled={review.busy} onClick={review.requestStop}>{t("停止追蹤此請求", "Stop tracking this request")}</Btn>
      {review.confirmStop && <div role="group" aria-label={t("確認停止追蹤", "Confirm stopping tracking")}>
        <p>{t("前次請求可能已建立審查。停止追蹤不會刪除它；請先查看既有審查，再決定是否另建。", "The previous request may have created a review. Stopping tracking does not delete it. Check existing reviews before creating another.")}</p>
        <p>{review.pending.readyModelId} / {review.pending.requestId}</p>
        <Btn disabled={review.busy} onClick={review.cancelStop}>{t("繼續追蹤", "Keep tracking")}</Btn>
        <Btn data-testid="model-file-confirm-stop" disabled={review.busy} onClick={review.confirmStopTracking}>{t("確認停止追蹤", "Confirm stopping tracking")}</Btn>
      </div>}
    </div>}
    {review.stoppedRequest && <p className="ec-note" data-testid="model-file-stopped">{t("已停止追蹤，前次結果仍未確認：", "Tracking stopped; the previous result is still unconfirmed: ")}{review.stoppedRequest.readyModelId} / {review.stoppedRequest.requestId}</p>}
    {review.busy && <p role="status">{t("正在確認審查…", "Confirming review…")}</p>}
    {review.error && <p role="alert" data-testid="model-file-error">{review.error}</p>}
    {review.result && <p role="status" data-testid="model-file-result">
      {["created", "active"].includes(review.result.session_status) ? t("審查已選取：", "Review selected: ") : t("此請求對應的審查已結束，請從封存清單重建：", "This request belongs to a closed review. Recreate it from the archive: ")}
      <strong>{review.result.review_session_id}</strong>
    </p>}

    <IntentDialog open={removeKey !== null} showReason={false} busy={removeBusy} actionErr={removeError}
      title={t("移除轉檔紀錄", "Remove conversion record")}
      cost={t("紀錄會變成墓碑並隱藏；同鍵的進件工作一併刪除；同鍵再送進件會被拒絕。streaming 的轉檔 artifact 不在此清理範圍。", "The record becomes a hidden tombstone; its intake jobs are deleted; re-sent intake with the same key is refused. Streaming artifacts are not cleaned here.")}
      onConfirm={confirmRemove} onCancel={() => { setRemoveKey(null); setRemoveError(null); }} />
    {removeError && <p role="alert" data-testid="model-file-remove-error">{removeError}</p>}
  </section>;
}
