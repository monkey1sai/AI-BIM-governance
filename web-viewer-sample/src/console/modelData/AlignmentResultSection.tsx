import { useCallback, useEffect, useRef, useState } from "react";
import { coordinatorClient, type LineageConversionReportList, type MinioObject } from "../coordinatorClient";
import { Btn } from "../components";
import { t } from "../i18n";
import { formatRatioPercent } from "../reports/lineageFormat";
import { LineageResultView } from "../reports/LineageResultView";
import { formatWhen, REPORT_STATUS } from "../reports/lineageReportShared";
import { GovernedBundleLookup } from "./GovernedBundleLookup";

export type ResultProgress = "loading" | "none" | "pending" | "generated" | "problem" | "error";
export type ResultProgressChange = { progress: ResultProgress; label?: string };

const REPORT_LIMIT = 50;
const PENDING_POLL_MS = 5000;

const bareEtag = (etag: string | null | undefined) => (etag ?? "").replace(/^"+|"+$/g, "");

/**
 * 模型庫第③步：此 IFC 每次轉檔產出的 schedule.csv ↔ IFC ↔ USDC 對齊結果。
 * 預設顯示最新一次（或連結指定的那一次）；最新一次轉檔完成但報表尚未收進來時，每 5 秒重讀。
 */
export function AlignmentResultSection({
  object,
  bucket,
  preferredConversionId = null,
  latestReadyConversionId = null,
  onProgress,
}: {
  object: MinioObject;
  bucket: string | null;
  /** 從舊報表連結帶來、要優先顯示的轉檔編號。 */
  preferredConversionId?: string | null;
  /** 第②步最新一次成功轉檔的編號；報表清單還沒有它時顯示「整理中」並自動重讀。 */
  latestReadyConversionId?: string | null;
  onProgress?: (change: ResultProgressChange) => void;
}): JSX.Element {
  const [list, setList] = useState<LineageConversionReportList | null>(null);
  const [failed, setFailed] = useState(false);
  // 每次讀取結束（成功或失敗）都加一，讓「整理中」的輪詢在重讀失敗後也會再排下一次。
  const [attempts, setAttempts] = useState(0);
  const [chosenId, setChosenId] = useState<string | null>(preferredConversionId);
  const generation = useRef(0);

  useEffect(() => { setChosenId(preferredConversionId); }, [preferredConversionId]);

  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await coordinatorClient.listLineageConversionReports({ sourceIfcKey: object.key, limit: REPORT_LIMIT });
      if (current !== generation.current) return;
      setList(result);
      setFailed(false);
    } catch {
      // 重讀失敗時保留上次的清單；從未讀到時才顯示錯誤。
      if (current === generation.current) setFailed(true);
    } finally {
      if (current === generation.current) setAttempts((count) => count + 1);
    }
  }, [object.key]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const items = list?.items ?? [];
  const pending = list !== null && latestReadyConversionId !== null
    && !items.some((item) => item.conversion_job_id === latestReadyConversionId);

  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setTimeout(() => { void load(); }, PENDING_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [pending, attempts, load]);

  const chosen = chosenId === null ? undefined : items.find((item) => item.conversion_job_id === chosenId);
  const preferredMissing = list !== null && chosenId !== null && chosen === undefined;
  const report = chosen ?? items[0] ?? null;

  const progress: ResultProgress = list === null
    ? (failed ? "error" : "loading")
    : pending ? "pending"
      : report === null ? "none"
        : report.status === "generated" ? "generated" : "problem";
  const label = progress === "problem" && report ? REPORT_STATUS[report.status] : undefined;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  useEffect(() => {
    onProgressRef.current?.(label === undefined ? { progress } : { progress, label });
  }, [progress, label]);

  const stale = report !== null && report.source_ifc.etag !== null
    && bareEtag(report.source_ifc.etag) !== bareEtag(object.etag);

  return (
    <section className="md-step-section" data-testid="md-step-result" aria-labelledby="md-step-result-title">
      <header className="md-step-head">
        <h2 id="md-step-result-title"><span className="md-step-n" aria-hidden="true">③</span> {t("檢查對齊結果", "Check the alignment")}</h2>
        <p>{t("比對 Revit 元件清單（schedule.csv）、IFC 與 USDC 是否對得上；每次轉檔都會自動產生。",
          "Compares the Revit element list (schedule.csv), the IFC and the USDC; every conversion produces one.")}</p>
      </header>

      {list === null && !failed && (
        <p role="status" data-testid="lineage-conversion-loading">{t("讀取對齊結果中…", "Loading alignment results…")}</p>
      )}
      {list === null && failed && (
        <>
          <p role="alert" data-testid="lineage-conversion-error">{t("無法取得對齊結果，請重試。", "Alignment results are unavailable. Retry.")}</p>
          <Btn data-testid="lineage-conversion-retry" onClick={() => { void load(); }}>{t("重試", "Retry")}</Btn>
        </>
      )}
      {pending && (
        <p role="status" data-testid="lineage-result-pending" className="md-step-note">
          {t("最新一次轉檔已完成，對齊報表整理中，稍候會自動出現。", "The latest conversion finished; its report is being collected and will appear shortly.")}
        </p>
      )}
      {preferredMissing && (
        <p className="ec-note" data-testid="lineage-preferred-missing">
          {t(`最近 ${REPORT_LIMIT} 次轉檔中找不到 ${chosenId} 的報表，先顯示最新一次。`,
            `No report for ${chosenId} among the latest ${REPORT_LIMIT} conversions; showing the latest one.`)}
        </p>
      )}
      {list !== null && report === null && !pending && (
        <p data-testid="lineage-conversion-none">
          {t("還沒有對齊結果；完成第②步轉檔後會自動產生。", "No alignment result yet; finishing step ② produces one.")}
        </p>
      )}
      {report !== null && (
        <>
          <div className="md-result-attempt">
            <p data-testid="lineage-result-attempt">
              {t("顯示", "Showing")} {formatWhen(report.conversion_created_at)} {t("的轉檔", "conversion")} · {REPORT_STATUS[report.status]}
            </p>
            {items.length > 1 && (
              <label>
                {t("切換到其他次轉檔", "Switch conversion")}{" "}
                <select
                  data-testid="lineage-attempt-select"
                  value={report.conversion_job_id}
                  onChange={(event) => setChosenId(event.target.value)}
                >
                  {items.map((item) => (
                    <option key={item.conversion_job_id} value={item.conversion_job_id}>
                      {formatWhen(item.conversion_created_at)} · {REPORT_STATUS[item.status]}
                      {item.metrics ? ` · ${formatRatioPercent(item.metrics.rvt_ifc_usdc_lineage_ratio)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {stale && (
            <p className="ec-note" data-testid="lineage-conversion-stale">
              {t("這份結果對應較早版本的 IFC（ETag 不同）；重新轉檔後會產生目前版本的結果。",
                "This result belongs to an earlier IFC version (different ETag); reconverting produces one for the current version.")}
            </p>
          )}
          {list !== null && list.count > items.length && (
            <p className="ec-note">{t(`只列出最近 ${items.length} 次轉檔。`, `Only the latest ${items.length} conversions are listed.`)}</p>
          )}
          <div className="lineage-report lineage-report--embedded">
            <LineageResultView key={report.conversion_job_id} report={report} />
          </div>
        </>
      )}

      <details className="op-inline-help" data-testid="lineage-governed">
        <summary>{t("進階：governed bundle 收案狀態", "Advanced: governed bundle admission")}</summary>
        <GovernedBundleLookup object={object} bucket={bucket} />
      </details>
    </section>
  );
}
