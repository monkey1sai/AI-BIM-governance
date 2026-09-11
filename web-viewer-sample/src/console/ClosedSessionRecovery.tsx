import { useCallback, useEffect, useRef, useState } from "react";
import {
  coordinatorClient,
  type ClosedReviewSessionItem,
  type RecreateReviewSessionResponse,
} from "./coordinatorClient";
import { Btn } from "./components";
import { t } from "./i18n";

const PENDING_RECREATION_KEY = "ai-bim.closed-review-request.v1";
type PendingRecreation = { source: ClosedReviewSessionItem; key: string };
function readPendingRecreation(): PendingRecreation | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_RECREATION_KEY) ?? "null") as PendingRecreation | null;
    return value && /^review_session_[A-Za-z0-9_-]+$/.test(value.source?.session_id)
      && value.source.status === "closed" && typeof value.source.project_id === "string"
      && typeof value.source.model_version_id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value.key)
      ? value : null;
  } catch { return null; }
}

export function ClosedSessionRecovery({
  onRecreated,
  compact = false,
}: {
  onRecreated?: (result: RecreateReviewSessionResponse, source: ClosedReviewSessionItem) => void;
  compact?: boolean;
}) {
  const [items, setItems] = useState<ClosedReviewSessionItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRecreation | null>(readPendingRecreation);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<RecreateReviewSessionResponse | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setLoadErr(null);
    try {
      const page = await coordinatorClient.listClosedReviewSessions(20, cursor);
      if (!aliveRef.current) return;
      setItems((current) => cursor
        ? [...current, ...page.items.filter((item) => !current.some((old) => old.session_id === item.session_id))]
        : page.items);
      setNextCursor(page.next_cursor);
    } catch (error) {
      if (aliveRef.current) setLoadErr(String(error));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const beginRecreate = (source: ClosedReviewSessionItem) => {
    const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const next = { source, key: `closed-recreate-${randomPart}` };
      sessionStorage.setItem(PENDING_RECREATION_KEY, JSON.stringify(next));
      setPending(next);
      setActionErr(null);
    } catch {
      setActionErr(t("無法保存重建請求；請允許瀏覽器儲存空間後重試。", "The recreation request could not be saved. Allow browser storage and retry."));
    }
  };

  const confirmRecreate = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setActionErr(null);
    try {
      const result = await coordinatorClient.recreateReviewSession(pending.source.session_id, pending.key);
      if (!aliveRef.current) return;
      sessionStorage.removeItem(PENDING_RECREATION_KEY);
      setSuccess(result);
      setPending(null);
      onRecreated?.(result, pending.source);
    } catch (error) {
      if (aliveRef.current) setActionErr(String(error));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  return (
    <div data-testid="closed-session-recovery">
      {!compact && <h3>{t("已封存 Session", "Archived Sessions")}</h3>}
      <p className="ec-note">{t("只會重用 coordinator 已驗證仍可讀的 USDC 與 mapping；每次成功都建立新的 Session ID。", "Only coordinator-verified readable USDC and mapping artifacts are reused; every success creates a new Session ID.")}</p>
      {loadErr && (
        <p className="ec-warn-note" data-testid="closed-session-load-error">
          {t("封存 Session 載入失敗：", "Failed to load archived sessions: ")}{loadErr}{" "}
          <Btn data-testid="closed-session-retry-load" onClick={() => { void load(); }}>{t("重試", "Retry")}</Btn>
        </p>
      )}
      {!loadErr && loading && items.length === 0 && <p className="ec-note" data-testid="closed-session-loading">{t("讀取封存 Session…", "Loading archived sessions...")}</p>}
      {!loadErr && !loading && items.length === 0 && <p className="ec-note" data-testid="closed-session-empty">{t("目前沒有已封存 Session。", "There are no archived sessions.")}</p>}
      {items.length > 0 && (
        <table className="ec-table" data-testid="closed-session-table">
          <thead><tr><th>session</th><th>{t("專案 / 模型", "project / model")}</th><th>{t("可重建性", "rebuildability")}</th><th>{t("動作", "action")}</th></tr></thead>
          <tbody>{items.map((item) => {
            const ready = item.rebuildability.state === "ready";
            return (
              <tr key={item.session_id} data-testid={`closed-session-row-${item.session_id}`}>
                <td>{item.session_id}</td>
                <td>{item.project_id} / {item.model_version_id}</td>
                <td>
                  <span className={`ec-prov ${ready ? "ec-asbuilt" : "ec-p1"}`}>{item.rebuildability.state}</span>
                  {item.rebuildability.reason && <div className="ec-note">{item.rebuildability.reason}</div>}
                </td>
                <td>
                  <Btn data-testid={`closed-session-recreate-${item.session_id}`} disabled={!ready} onClick={() => beginRecreate(item)}>
                    {t("重建新的 Review Session", "Recreate a new Review Session")}
                  </Btn>{" "}
                  {!ready && <a href="#pipeline">{t("前往重新轉檔", "Go to reconvert")}</a>}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      {nextCursor && <Btn data-testid="closed-session-load-more" disabled={loading} onClick={() => { void load(nextCursor); }}>{loading ? t("讀取中…", "Loading...") : t("載入更多", "Load more")}</Btn>}
      {success && (
        <p className="ec-note" data-testid="closed-session-success">
          {t("已建立新 Session：", "New Session created: ")}<strong>{success.session_id}</strong>
          {success.activation_state === "not_requested"
            ? ` · ${t("尚未啟動 3D，審查已保留", "3D has not been started; the review is preserved")}`
            : success.kit_availability === "unavailable" && ` · ${t("Kit 尚不可用，Session 已保留", "Kit is unavailable; the Session is preserved")}`}
        </p>
      )}
      {!pending && actionErr && <p role="alert">{actionErr}</p>}
      {pending && (
        <div className="ec-modal-backdrop" data-testid="closed-session-confirm">
          <div className="ec-modal" role="dialog" aria-modal="true" aria-labelledby="closed-session-confirm-title">
            <h3 id="closed-session-confirm-title">{t("重建新的 Review Session", "Recreate a new Review Session")}</h3>
            <p>{t("原 Session 保持 closed 且不可逆；系統會從已驗證的既有成果建立不同的新 Session ID。", "The original Session remains irreversibly closed; a different new Session ID is created from verified artifacts.")}</p>
            <p className="ec-note">{pending.source.session_id}</p>
            <div className="ec-modal-actions">
              <Btn data-testid="closed-session-cancel" disabled={busy} onClick={() => { sessionStorage.removeItem(PENDING_RECREATION_KEY); setPending(null); setActionErr(null); }}>{t("取消", "Cancel")}</Btn>
              <Btn data-testid="closed-session-confirm-action" disabled={busy} onClick={() => { void confirmRecreate(); }}>{busy ? t("建立中…", "Creating...") : t("確認建立新 Session", "Create new Session")}</Btn>
            </div>
            {actionErr && <p className="ec-warn-note" data-testid="closed-session-action-error">{actionErr}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
