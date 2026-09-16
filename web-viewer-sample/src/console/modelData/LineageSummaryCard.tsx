import { useCallback, useEffect, useRef, useState } from "react";
import { coordinatorClient, type MinioObject, type SourceBundleLookupResponse } from "../coordinatorClient";
import { Btn, Field, Panel } from "../components";
import { t } from "../i18n";

type BundleState = SourceBundleLookupResponse["items"][number]["bundle_state"];
type Lookup =
  | { state: "loading" }
  | { state: "error" }
  | { state: "loaded"; result: SourceBundleLookupResponse };

const stateLabel = (state: BundleState) => ({
  READY: t("已驗證並收案（READY）", "Verified and admitted (READY)"),
  NON_READY: t("驗證未通過（NON_READY）", "Failed verification (NON_READY)"),
  LEGACY_UNMANAGED: t("尚未收編（LEGACY_UNMANAGED）", "Not enrolled (LEGACY_UNMANAGED)"),
}[state]);

/**
 * Governed lineage 的模型入口：以此 IFC 反查已收案的 source bundle。
 * 比率由受外部授權保護的 overview 提供，完整報表頁尚未建置，這張卡都不讀取。
 */
export function LineageSummaryCard({ object, bucket }: { object: MinioObject; bucket: string | null }): JSX.Element {
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });
  const generation = useRef(0);
  const load = useCallback(async () => {
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
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  return (
    <Panel
      title={t("Lineage 報表", "Lineage report")}
      sub={t("RVT → IFC → USDC 對齊；以此 IFC 反查已收案的 governed bundle", "RVT → IFC → USDC alignment; governed bundles that reference this IFC")}
      prov="asbuilt"
    >
      {!bucket ? (
        <p data-testid="lineage-summary-bucket-unknown">
          {t("無法確認此 IFC 所在的 bucket，暫時無法查詢 lineage。", "The bucket of this IFC is unknown, so lineage cannot be looked up.")}
        </p>
      ) : lookup.state === "loading" ? (
        <p role="status" data-testid="lineage-summary-loading">{t("查詢 lineage 中…", "Looking up lineage…")}</p>
      ) : lookup.state === "error" ? (
        <>
          <p role="alert" data-testid="lineage-summary-error">
            {t("無法取得 lineage 狀態，請重試。", "Lineage status is unavailable. Retry.")}
          </p>
          <Btn data-testid="lineage-summary-retry" onClick={() => { void load(); }}>{t("重試", "Retry")}</Btn>
        </>
      ) : (
        <LookupResult result={lookup.result} />
      )}
    </Panel>
  );
}

function LookupResult({ result }: { result: SourceBundleLookupResponse }): JSX.Element {
  const { items, unindexed_bundle_count: unindexed } = result;
  return (
    <>
      {items.length === 0 && unindexed === 0 && (
        <p data-testid="lineage-summary-none">
          {t(
            "此 IFC 沒有已收案的 governed bundle，因此沒有 lineage 報表。lineage 報表需要同一版本的 RVT、schedule.csv 與 manifest.json 經 coordinator 驗證收案。",
            "No admitted governed bundle references this IFC, so there is no lineage report. A report requires the RVT, schedule.csv and manifest.json of the same version to be verified by the coordinator.",
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
        <>
          <p data-testid="lineage-summary-ratios" className="ec-note">
            {t(
              "三個對齊比率受外部授權保護，瀏覽器目前沒有取得授權的方式，此卡不讀取比率。",
              "The three alignment ratios require external authorization, which the browser cannot obtain yet, so this card does not read them.",
            )}
          </p>
          <p data-testid="lineage-summary-report" className="ec-note">
            {t("完整 lineage 報表頁尚未建置。", "The full lineage report page is not built yet.")}
          </p>
        </>
      )}
    </>
  );
}
