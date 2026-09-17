import { useCallback, useEffect, useRef, useState } from "react";
import {
  coordinatorClient,
  type MinioObject,
  type SourceBundleLookupResponse,
} from "../coordinatorClient";
import { Btn, Field } from "../components";
import { t } from "../i18n";

type BundleState = SourceBundleLookupResponse["items"][number]["bundle_state"];
type Load<T> = { state: "loading" } | { state: "error" } | { state: "loaded"; result: T };

const stateLabel = (state: BundleState) => ({
  READY: t("已驗證並收案（READY）", "Verified and admitted (READY)"),
  NON_READY: t("驗證未通過（NON_READY）", "Failed verification (NON_READY)"),
  LEGACY_UNMANAGED: t("尚未收編（LEGACY_UNMANAGED）", "Not enrolled (LEGACY_UNMANAGED)"),
}[state]);

/**
 * 以此 IFC 反查 governed source bundle（進階資訊）。
 * governed 的比率受外部授權保護，這裡不讀取；每次轉檔的對齊報表由第③步顯示。
 */
export function GovernedBundleLookup({ object, bucket }: { object: MinioObject; bucket: string | null }): JSX.Element {
  const [lookup, setLookup] = useState<Load<SourceBundleLookupResponse>>({ state: "loading" });
  const generation = useRef(0);
  const run = useCallback(async () => {
    if (!bucket) return;
    const current = ++generation.current;
    setLookup({ state: "loading" });
    try {
      const result = await coordinatorClient.lookupLineageSourceBundles(bucket, object.key, object.etag);
      if (current === generation.current) setLookup({ state: "loaded", result });
    } catch {
      if (current === generation.current) setLookup({ state: "error" });
    }
  }, [bucket, object.key, object.etag]);
  useEffect(() => {
    void run();
    return () => { generation.current += 1; };
  }, [run]);

  if (!bucket) {
    return (
      <p data-testid="lineage-summary-bucket-unknown">
        {t("無法確認此 IFC 所在的 bucket，暫時無法查詢 governed bundle。", "The bucket of this IFC is unknown, so governed bundles cannot be looked up.")}
      </p>
    );
  }
  if (lookup.state === "loading") {
    return <p role="status" data-testid="lineage-summary-loading">{t("查詢 governed bundle 中…", "Looking up governed bundles…")}</p>;
  }
  if (lookup.state === "error") {
    return (
      <>
        <p role="alert" data-testid="lineage-summary-error">
          {t("無法取得 governed bundle 狀態，請重試。", "Governed bundle status is unavailable. Retry.")}
        </p>
        <Btn data-testid="lineage-summary-retry" onClick={() => { void run(); }}>{t("重試", "Retry")}</Btn>
      </>
    );
  }
  return <LookupResult result={lookup.result} />;
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
            "governed bundle 的對齊比率受外部授權保護，瀏覽器目前沒有取得授權的方式，這裡不讀取；每次轉檔的對齊結果不受影響。",
            "Governed alignment ratios require external authorization, which the browser cannot obtain yet, so they are not read here; per-conversion alignment results are unaffected.",
          )}
        </p>
      )}
    </>
  );
}
