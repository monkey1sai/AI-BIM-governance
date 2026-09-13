import { useEffect, useState } from "react";
import { coordinatorClient, type CallbackOutboxSummaryEntry } from "./coordinatorClient";
import { t } from "./i18n";

/** Summary 是有限的只讀投影；找不到指定事件不能推導遞送成功或失敗。 */
export function A1OutboxStatus({ outboxId, sessionId }: { outboxId: string; sessionId: string }) {
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    outboxId: string; sessionId: string; refresh: number;
    entry: CallbackOutboxSummaryEntry | null; error: boolean;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    coordinatorClient.getCallbackOutboxSummary(200).then(summary => {
      const entry = summary.entries.find(item => item.outbox_id === outboxId
        && item.event === "issue_snapshot" && item.correlation_id === sessionId) ?? null;
      if (alive) setResult({ outboxId, sessionId, refresh, entry, error: false });
    }).catch(() => {
      if (alive) setResult({ outboxId, sessionId, refresh, entry: null, error: true });
    });
    return () => { alive = false; };
  }, [outboxId, sessionId, refresh]);
  const current = result?.outboxId === outboxId && result.sessionId === sessionId && result.refresh === refresh ? result : null;
  const entry = current?.entry;
  const delivered = entry?.status === "delivered" && !!entry.delivered_at && Number.isFinite(Date.parse(entry.delivered_at));
  const label = !current ? t("查詢遞送狀態中…", "Checking delivery…")
    : current.error ? t("無法取得遞送狀態，請重試查詢。", "Delivery status unavailable; retry the query.")
    : !entry ? t("最近 200 筆摘要中未確認此回拋紀錄，遞送結果未知。", "This snapshot is not confirmed in the latest 200 entries; delivery is unknown.")
    : delivered ? t("接收端已回應成功（HTTP 2xx）；尚不代表雲端業務處理完成。", "Receiver returned HTTP 2xx; cloud business processing is not confirmed.")
    : entry.status === "pending" ? t("已入列，等待投遞或重試；尚未確認送達。", "Queued for delivery or retry; delivery is not confirmed.")
    : entry.status === "dead_letter" ? t("投遞次數已耗盡，請由管理者處理；查詢不會重新投遞。", "Delivery attempts exhausted; contact an operator. Refreshing does not redeliver.")
    : t("遞送紀錄不完整，結果未知。", "Incomplete delivery record; outcome unknown.");
  return <div data-testid="a1-outbox-status" role="status" aria-live="polite">
    <p>{label}</p>
    {entry && <p>{t("投遞次數", "Attempts")}: {entry.attempts}/{entry.max_attempts}
      {delivered && <> · {t("送達時間", "Delivery time")}: <time dateTime={entry.delivered_at!}>{entry.delivered_at}</time></>}
    </p>}
    <button type="button" disabled={!current} onClick={() => setRefresh(value => value + 1)}>
      {t("重新查詢遞送狀態", "Refresh delivery status")}
    </button>
  </div>;
}
