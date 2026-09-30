// #sessions「清理舊紀錄」（契約 §5.3）：預覽三組候選 → 逐筆循序執行 → 逐列結果。不新增批次端點。
import { useCallback, useEffect, useRef, useState } from "react";
import { Btn } from "./components";
import { CoordinatorHttpError, coordinatorClient, lifecycleConflict, type ClosedReviewSessionItem, type RuntimeSessionSummary } from "./coordinatorClient";
import { t } from "./i18n";
import { cleanupCandidates, modelFileLabel, type CleanupCandidates } from "./modelFiles/modelFileView";

const CLOSED_PAGE_SIZE = 50;
const MAX_CLOSED_PAGES = 10;
type Result = { id: string; label: string; outcome: string };
/** What the preview could not see: records beyond the server's newest-first cap, closed sessions beyond the page cap. */
type Truncation = { recordsShown: number; recordsTotal: number; closedCapped: boolean };

async function loadAllClosed(): Promise<{ items: ClosedReviewSessionItem[]; capped: boolean }> {
  const items: ClosedReviewSessionItem[] = [];
  let cursor: string | undefined;
  let next: string | null | undefined;
  for (let page = 0; page < MAX_CLOSED_PAGES; page += 1) {
    const reply = await coordinatorClient.listClosedReviewSessions(CLOSED_PAGE_SIZE, cursor);
    items.push(...reply.items);
    next = reply.next_cursor;
    if (!next) break;
    cursor = next;
  }
  return { items, capped: Boolean(next) };
}

/** Live runtime sessions by id for the pre-run re-check; null when the read fails (nothing can be verified then). */
async function readLiveSessions(): Promise<Map<string, RuntimeSessionSummary> | null> {
  try { return new Map((await coordinatorClient.runtimeStatus()).sessions.items.map((s) => [s.session_id, s])); }
  catch { return null; }
}

const stillIdle = (s: RuntimeSessionSummary) => (s.status === "created" || s.status === "active") && s.viewer_leases.length === 0 && s.primary_viewer_lease_id === null;

function describeFailure(error: unknown): { text: string; stop: boolean } {
  if (error instanceof CoordinatorHttpError && error.status === 404) return { text: t("已不存在", "already gone"), stop: false };
  if (error instanceof CoordinatorHttpError && error.status === 403) return { text: t("403：未通過守門，請以 operator token 路徑執行", "403: guard rejected; use the operator token path"), stop: true };
  const conflict = lifecycleConflict(error);
  if (conflict) return { text: `${conflict.code}${conflict.intakeStatus ? ` · ${conflict.intakeStatus}` : ""}${conflict.sessions?.length ? ` · ${conflict.sessions.join("、")}` : ""}`, stop: false };
  return { text: String(error), stop: false };
}

export function SessionCleanupDialog({ open, onClose, onFinished }: { open: boolean; onClose: () => void; onFinished: () => void }) {
  const [days, setDays] = useState(14);
  const [candidates, setCandidates] = useState<CleanupCandidates | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [truncation, setTruncation] = useState<Truncation | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [stopped403, setStopped403] = useState(false);
  const [done, setDone] = useState(false);
  const busyRef = useRef(false);
  const previewSeqRef = useRef(0);
  // A preview belongs to the days value and the open dialog it was made for: any change to either drops it, and a preview
  // still in flight is discarded when it lands, so the confirm button can only run the list the operator is looking at.
  const clearPreview = useCallback(() => {
    previewSeqRef.current += 1;
    setCandidates(null); setTruncation(null); setPreviewErr(null); setResults([]); setDone(false); setStopped403(false);
  }, []);
  useEffect(() => { if (!open) clearPreview(); }, [open, clearPreview]);
  if (!open) return null;

  const preview = async () => {
    clearPreview();
    const seq = previewSeqRef.current;
    try {
      const [runtime, closed, records] = await Promise.all([coordinatorClient.runtimeStatus(), loadAllClosed(), coordinatorClient.getConversionRecords(100)]);
      if (seq !== previewSeqRef.current) return;
      setCandidates(cleanupCandidates({ now: Date.now(), days, live: runtime.sessions.items, closed: closed.items, records: records.items }));
      setTruncation({ recordsShown: records.items.length, recordsTotal: records.count, closedCapped: closed.capped });
    } catch (error) { if (seq === previewSeqRef.current) setPreviewErr(String(error)); }
  };

  const run = async () => {
    if (!candidates || busyRef.current) return;
    busyRef.current = true; setBusy(true); setResults([]); setStopped403(false);
    const push = (row: Result) => setResults((current) => [...current, row]);
    try {
      // The preview may be minutes old: a session that gained a viewer (or left created/active) since then is not ours to remove.
      const live = await readLiveSessions();
      // `act` resolves to a skip reason when it chose not to remove the row; undefined means it removed it.
      const steps: Array<{ id: string; label: string; act: () => Promise<string | undefined> }> = [
        ...candidates.staleActive.map((s) => ({ id: s.session_id, label: s.session_id, act: async () => {
          if (!live) return t("無法重新確認 session 狀態，略過", "could not re-check the session state; skipped");
          const current = live.get(s.session_id);
          if (!current || !stillIdle(current)) return t("已有人連線或狀態已變，略過", "viewer connected or state changed; skipped");
          await coordinatorClient.sessionClose(s.session_id, "stale_cleanup"); await coordinatorClient.purgeReviewSession(s.session_id, "stale_cleanup");
          return undefined;
        } })),
        ...candidates.closedSessions.map((s) => ({ id: s.session_id, label: `${s.session_id}${s.source_ifc_filename ? ` · ${s.source_ifc_filename}` : ""}`, act: async () => { await coordinatorClient.purgeReviewSession(s.session_id, "stale_cleanup"); return undefined; } })),
        ...candidates.records.map((r) => ({ id: r.idempotency_key, label: `${modelFileLabel(r).title} · ${r.idempotency_key}`, act: async () => { await coordinatorClient.removeConversionRecord(r.idempotency_key); return undefined; } })),
      ];
      for (const step of steps) {
        try { const skipped = await step.act(); push({ id: step.id, label: step.label, outcome: skipped ?? t("已移除", "removed") }); }
        catch (error) {
          const failure = describeFailure(error);
          push({ id: step.id, label: step.label, outcome: failure.text });
          if (failure.stop) { setStopped403(true); break; }
        }
      }
    } finally {
      busyRef.current = false; setBusy(false); setDone(true); onFinished();
    }
  };

  const total = candidates ? candidates.staleActive.length + candidates.closedSessions.length + candidates.records.length : 0;
  return (
    <div className="ec-modal-backdrop" data-testid="cleanup-dialog">
      <div className="ec-modal" role="dialog" aria-modal="true" aria-labelledby="cleanup-title">
        <h3 id="cleanup-title">{t("清理舊紀錄", "Clean up old records")}</h3>
        <p className="ec-warn-note">{t("移除不可逆：session 檔與事件檔會刪除並留下退役標記，轉檔紀錄會變成墓碑。streaming 的轉檔 artifact 不在此清理範圍。", "Removal is irreversible: session and event files are deleted with a retired marker, conversion records become tombstones. Streaming artifacts are not cleaned here.")}</p>
        <label className="ec-field-k" htmlFor="cleanup-days">{t("保留最近幾天", "Keep the last N days")}</label>
        <input id="cleanup-days" data-testid="cleanup-days" className="ec-input" type="number" min={1} value={days} disabled={busy}
          onChange={(event) => { clearPreview(); setDays(Math.max(1, Number.parseInt(event.target.value, 10) || 1)); }} />
        <div className="ec-modal-actions">
          <Btn data-testid="cleanup-cancel" disabled={busy} onClick={onClose}>{done ? t("關閉", "Close") : t("取消", "Cancel")}</Btn>
          <Btn data-testid="cleanup-preview" disabled={busy} onClick={() => { void preview(); }}>{t("預覽候選", "Preview")}</Btn>
          <Btn primary data-testid="cleanup-confirm" disabled={busy || !candidates || total === 0 || done} onClick={() => { void run(); }}>{busy ? t("執行中…", "Running…") : t(`確認移除 ${total} 項`, `Remove ${total} item(s)`)}</Btn>
        </div>
        {previewErr && <p className="ec-warn-note">{previewErr}</p>}
        {candidates && <div className="ec-note">
          <p>{t(`早於 ${candidates.cutoffIso.slice(0, 10)} 的紀錄：`, `Records older than ${candidates.cutoffIso.slice(0, 10)}:`)}</p>
          <div data-testid="cleanup-group-stale"><strong>{t("無人連線的舊 session（先結束再移除）", "Idle old sessions (close, then remove)")}</strong> {candidates.staleActive.length}<ul>{candidates.staleActive.map((s) => <li key={s.session_id}>{s.session_id}</li>)}</ul></div>
          <div data-testid="cleanup-group-closed"><strong>{t("已關閉或失敗的 session", "Closed or failed sessions")}</strong> {candidates.closedSessions.length}<ul>{candidates.closedSessions.map((s) => <li key={s.session_id}>{s.session_id}{s.source_ifc_filename ? ` · ${s.source_ifc_filename}` : ""}</li>)}</ul></div>
          {truncation && (truncation.recordsTotal > truncation.recordsShown || truncation.closedCapped) && <div className="ec-warn-note" data-testid="cleanup-truncation">
            {truncation.recordsTotal > truncation.recordsShown && <p>{t(`僅檢視最新 ${truncation.recordsShown} 筆轉檔紀錄／共 ${truncation.recordsTotal} 筆`, `Only the newest ${truncation.recordsShown} of ${truncation.recordsTotal} conversion records were reviewed`)}</p>}
            {truncation.closedCapped && <p>{t(`已封存清單達 ${MAX_CLOSED_PAGES * CLOSED_PAGE_SIZE} 筆上限，未載入更舊的紀錄`, `The archived list reached its ${MAX_CLOSED_PAGES * CLOSED_PAGE_SIZE}-item cap; older records were not loaded`)}</p>}
          </div>}
          <div data-testid="cleanup-group-records"><strong>{t("無進行中審查的轉檔紀錄", "Conversion records without active reviews")}</strong> {candidates.records.length}<ul>{candidates.records.map((r) => <li key={r.idempotency_key}>{modelFileLabel(r).title} · {r.idempotency_key}</li>)}</ul></div>
        </div>}
        {results.length > 0 && <table className="ec-table"><tbody>{results.map((row) => (
          <tr key={row.id} data-testid={`cleanup-result-row-${row.id}`}><td>{row.label}</td><td>{row.outcome}</td></tr>
        ))}</tbody></table>}
        {stopped403 && <p className="ec-warn-note" data-testid="cleanup-stopped-403">{t("遇到 403 已停止；其餘項目未處理。", "Stopped at a 403; remaining items were not processed.")}</p>}
        {done && <p className="ec-note" data-testid="cleanup-done">{t("清理結束；進行中與已封存清單已重新載入。若上方有截斷提示，請再執行一次。", "Cleanup finished; the active and archived lists were reloaded. If a truncation note is shown above, run again.")}</p>}
      </div>
    </div>
  );
}
