import { useCallback, useEffect, useRef, useState } from "react";
import {
  coordinatorClient,
  type LineageConversionReport,
  type LineageConversionReportList,
  type MinioObject,
  type SourceBundleLookupResponse,
} from "../coordinatorClient";
import { Btn, Field, Panel } from "../components";
import { t } from "../i18n";

type BundleState = SourceBundleLookupResponse["items"][number]["bundle_state"];
type Load<T> = { state: "loading" } | { state: "error" } | { state: "loaded"; result: T };

const stateLabel = (state: BundleState) => ({
  READY: t("已驗證並收案（READY）", "Verified and admitted (READY)"),
  NON_READY: t("驗證未通過（NON_READY）", "Failed verification (NON_READY)"),
  LEGACY_UNMANAGED: t("尚未收編（LEGACY_UNMANAGED）", "Not enrolled (LEGACY_UNMANAGED)"),
}[state]);

const reportStatus = (report: LineageConversionReport) => ({
  generated: t("已產出", "Generated"),
  failed: t("轉檔服務產生報表失敗", "The conversion service failed to build it"),
  not_produced: t("這次轉檔沒有產出報表", "This conversion produced no report"),
  invalid: t("報表未通過驗證", "The report failed verification"),
}[report.status]);

const uploadStatus = (report: LineageConversionReport) => ({
  uploaded: t("已上傳到 MinIO", "Uploaded to MinIO"),
  exists: t("MinIO 已有同名報表", "Already in MinIO"),
  denied: t("沒有 MinIO 寫入權限，只保存在 coordinator", "No MinIO write permission; kept on the coordinator"),
  failed: t("上傳 MinIO 失敗", "MinIO upload failed"),
  skipped: t("未上傳到 MinIO", "Not uploaded to MinIO"),
}[report.minio_upload.status]);

const percent = (ratio: number | null) => ratio === null ? "—" : `${(Math.floor(ratio * 10_000) / 100).toFixed(2)}%`;
const bareEtag = (etag: string | null | undefined) => (etag ?? "").replace(/^"+|"+$/g, "");

/** 取值；key 變動或重試時丟棄過期回應。fetcher 為 null 時不發請求。 */
function useLoad<T>(fetcher: (() => Promise<T>) | null): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const generation = useRef(0);
  const run = useCallback(async () => {
    if (!fetcher) return;
    const current = ++generation.current;
    setLoad({ state: "loading" });
    try {
      const result = await fetcher();
      if (current === generation.current) setLoad({ state: "loaded", result });
    } catch {
      if (current === generation.current) setLoad({ state: "error" });
    }
  }, [fetcher]);
  useEffect(() => {
    void run();
    return () => { generation.current += 1; };
  }, [run]);
  return [load, () => { void run(); }];
}

/**
 * 模型詳情的 lineage 入口。
 * 上半部：此 IFC 每次轉檔產出的 schedule.csv ↔ IFC ↔ USDC 對齊報表（最新一次），可開啟完整報表頁。
 * 下半部：以此 IFC 反查 governed source bundle；governed 的比率受外部授權保護，這張卡不讀取。
 */
export function LineageSummaryCard({ object, bucket }: { object: MinioObject; bucket: string | null }): JSX.Element {
  const reportFetcher = useCallback(
    () => coordinatorClient.listLineageConversionReports({ sourceIfcKey: object.key, limit: 1 }),
    [object.key],
  );
  const bundleFetcher = useCallback(
    () => coordinatorClient.lookupLineageSourceBundles(bucket ?? "", object.key, object.etag),
    [bucket, object.key, object.etag],
  );
  const [reports, retryReports] = useLoad<LineageConversionReportList>(reportFetcher);
  const [lookup, retryLookup] = useLoad<SourceBundleLookupResponse>(bucket ? bundleFetcher : null);

  return (
    <Panel
      title={t("Lineage 報表", "Lineage report")}
      sub={t("RVT（schedule.csv）→ IFC → USDC 對齊；每次轉檔自動產生", "RVT (schedule.csv) → IFC → USDC alignment, produced by every conversion")}
      prov="asbuilt"
    >
      {reports.state === "loading" ? (
        <p role="status" data-testid="lineage-conversion-loading">{t("讀取轉檔報表中…", "Loading conversion reports…")}</p>
      ) : reports.state === "error" ? (
        <>
          <p role="alert" data-testid="lineage-conversion-error">{t("無法取得轉檔報表，請重試。", "Conversion reports are unavailable. Retry.")}</p>
          <Btn data-testid="lineage-conversion-retry" onClick={retryReports}>{t("重試", "Retry")}</Btn>
        </>
      ) : (
        <ConversionReport list={reports.result} objectEtag={object.etag} />
      )}

      <p className="ec-k">{t("Governed bundle", "Governed bundle")}</p>
      {!bucket ? (
        <p data-testid="lineage-summary-bucket-unknown">
          {t("無法確認此 IFC 所在的 bucket，暫時無法查詢 governed bundle。", "The bucket of this IFC is unknown, so governed bundles cannot be looked up.")}
        </p>
      ) : lookup.state === "loading" ? (
        <p role="status" data-testid="lineage-summary-loading">{t("查詢 lineage 中…", "Looking up lineage…")}</p>
      ) : lookup.state === "error" ? (
        <>
          <p role="alert" data-testid="lineage-summary-error">
            {t("無法取得 lineage 狀態，請重試。", "Lineage status is unavailable. Retry.")}
          </p>
          <Btn data-testid="lineage-summary-retry" onClick={retryLookup}>{t("重試", "Retry")}</Btn>
        </>
      ) : (
        <LookupResult result={lookup.result} />
      )}
    </Panel>
  );
}

function ConversionReport({ list, objectEtag }: { list: LineageConversionReportList; objectEtag: string }): JSX.Element {
  const latest = list.items[0];
  if (!latest) {
    return (
      <p data-testid="lineage-conversion-none">
        {t("此 IFC 還沒有轉檔對齊報表；下次轉檔完成後會自動產生。",
          "This IFC has no conversion alignment report yet; the next conversion produces one.")}
      </p>
    );
  }
  const metrics = latest.metrics;
  return (
    <div data-testid="lineage-conversion-latest" className="op-model-identity">
      <Field k={t("最新報表", "Latest report")} v={reportStatus(latest)} />
      {metrics && (
        <>
          <Field
            k={t("完整追溯（RVT→IFC→USDC）", "Lineage (RVT→IFC→USDC)")}
            v={`${percent(metrics.rvt_ifc_usdc_lineage_ratio.ratio)}（${metrics.rvt_ifc_usdc_lineage_ratio.numerator} / ${metrics.rvt_ifc_usdc_lineage_ratio.denominator}）`}
          />
          <Field k={t("RVT→IFC 對齊", "RVT→IFC alignment")} v={percent(metrics.rvt_ifc_alignment_ratio.ratio)} />
          <Field k={t("IFC→USDC 覆蓋", "IFC→USDC coverage")} v={percent(metrics.ifc_usdc_coverage_ratio.ratio)} />
        </>
      )}
      <Field k="MinIO" v={uploadStatus(latest)} />
      {bareEtag(latest.source_ifc.etag) !== bareEtag(objectEtag) && (
        <p data-testid="lineage-conversion-stale" className="ec-note">
          {t("這份報表對應較早版本的 IFC（ETag 不同）；目前版本轉檔後會產生新報表。",
            "This report belongs to an earlier IFC version (different ETag); converting the current version produces a new one.")}
        </p>
      )}
      <p>
        <a data-testid="lineage-conversion-open" href={`#lineage?conversion_job_id=${encodeURIComponent(latest.conversion_job_id)}`}>
          {t("開啟報表", "Open report")}
        </a>
        {list.count > 1 && (
          <span data-testid="lineage-conversion-count" className="ec-note">
            {" "}{t(`（共 ${list.count} 次轉檔報表，可在報表頁的「轉檔歷史」切換）`, `(${list.count} conversion reports; switch under Attempts)`)}
          </span>
        )}
      </p>
    </div>
  );
}

function LookupResult({ result }: { result: SourceBundleLookupResponse }): JSX.Element {
  const { items, unindexed_bundle_count: unindexed } = result;
  return (
    <>
      {items.length === 0 && unindexed === 0 && (
        <p data-testid="lineage-summary-none">
          {t(
            "此 IFC 沒有已收案的 governed bundle。governed 收案需要同一版本的 RVT、schedule.csv 與 manifest.json 經 coordinator 驗證。",
            "No admitted governed bundle references this IFC. Governed admission requires the RVT, schedule.csv and manifest.json of the same version to be verified by the coordinator.",
          )}
        </p>
      )}
      {items.length > 1 && (
        <p className="ec-note">
          {t(`此 IFC 被 ${items.length} 個 bundle 引用，依收案時間由新到舊排列。`, `${items.length} bundles reference this IFC, newest first.`)}
        </p>
      )}
      {items.map((item) => (
        <div key={item.source_bundle_id} data-testid="lineage-summary-bundle" className="op-model-identity">
          <Field k="Source bundle" v={<code>{item.source_bundle_id}</code>} />
          <Field k={t("狀態", "State")} v={stateLabel(item.bundle_state)} />
          <Field k="Pipeline job" v={item.pipeline_job_id ? <code>{item.pipeline_job_id}</code> : t("尚未建立", "Not created yet")} />
        </div>
      ))}
      {unindexed > 0 && (
        <p data-testid="lineage-summary-indeterminate" className="ec-note">
          {items.length === 0
            ? t(
              `查無已建立索引的 bundle；另有 ${unindexed} 筆較早收案的 bundle 尚未建立 IFC 索引，無法確認是否對應此 IFC。`,
              `No indexed bundle matches. ${unindexed} older bundles have no IFC index, so a match cannot be ruled out.`,
            )
            : t(
              `另有 ${unindexed} 筆較早收案的 bundle 尚未建立 IFC 索引，無法確認它們是否也引用此 IFC。`,
              `${unindexed} older bundles have no IFC index and may also reference this IFC.`,
            )}
        </p>
      )}
      {items.length > 0 && (
        <p data-testid="lineage-summary-ratios" className="ec-note">
          {t(
            "governed bundle 的對齊比率受外部授權保護，瀏覽器目前沒有取得授權的方式，此卡不讀取；上方的轉檔報表不受影響。",
            "Governed alignment ratios require external authorization, which the browser cannot obtain yet, so this card does not read them; the conversion report above is unaffected.",
          )}
        </p>
      )}
    </>
  );
}
