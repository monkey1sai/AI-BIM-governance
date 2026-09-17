import { useCallback, useEffect, useState } from "react";
import { coordinatorClient } from "../coordinatorClient";
import { buildHandoff } from "../handoff";
import { t } from "../i18n";
import { LineageResultView, Retry } from "./LineageResultView";
import { useLoad } from "./lineageReportShared";
import "./lineage-report.css";

/**
 * 舊的對齊報表連結（`#lineage`、`#lineage?conversion_job_id=<轉檔編號>`）。
 * 報表已併入模型庫第③步；這裡只負責把舊連結導到該模型，並帶上要看的那次轉檔。
 * 先確認模型庫裡真的有這個 IFC 才轉過去；報表沒記錄來源、來源已不在，或暫時無法確認時，改在原地顯示結果。
 */
function hashParams(): URLSearchParams {
  const raw = window.location.hash;
  const index = raw.indexOf("?");
  return new URLSearchParams(index === -1 ? "" : raw.slice(index + 1));
}

/** 導向後網址已不是 `#lineage`；此時不再反應，避免在路由切換前又把網址改掉。 */
const onLineageRoute = () => /^#\/?(?:console\/?)?lineage(?:\?|$)/.test(window.location.hash);

function useConversionJobId(): string | null {
  const [id, setId] = useState(() => hashParams().get("conversion_job_id"));
  useEffect(() => {
    const sync = () => { if (onLineageRoute()) setId(hashParams().get("conversion_job_id")); };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return id || null;
}

export function LineageReportPage(): JSX.Element {
  const id = useConversionJobId();
  return (
    <div className="lineage-report" data-testid="lineage-report-page">
      {id ? <ReportRedirect key={id} conversionJobId={id} /> : <ToModelLibrary />}
    </div>
  );
}

function ToModelLibrary(): JSX.Element {
  useEffect(() => {
    if (onLineageRoute()) window.location.replace("#minio");
  }, []);
  return <p role="status">{t("對齊報表已併入模型庫，正在前往…", "Alignment reports now live in the model library. Redirecting…")}</p>;
}

type Placement =
  | { state: "checking" }
  | { state: "in_place"; reason: "unknown_source" | "missing" | "unverified" };

const folderOf = (key: string) => key.slice(0, key.lastIndexOf("/") + 1);

function ReportRedirect({ conversionJobId }: { conversionJobId: string }): JSX.Element {
  const fetcher = useCallback(() => coordinatorClient.getLineageConversionReport(conversionJobId), [conversionJobId]);
  const [load, retry] = useLoad(fetcher);
  const report = load.state === "loaded" ? load.value : null;
  const [placement, setPlacement] = useState<Placement>({ state: "checking" });

  useEffect(() => {
    if (!report) return undefined;
    const key = report.source_ifc.key;
    if (!key) {
      setPlacement({ state: "in_place", reason: "unknown_source" });
      return undefined;
    }
    let active = true;
    setPlacement({ state: "checking" });
    coordinatorClient.getMinioFolder(folderOf(key)).then(
      (listing) => {
        if (!active) return;
        const sameBucket = !report.source_ifc.bucket || listing.bucket === report.source_ifc.bucket;
        if (!sameBucket || !listing.objects.some((object) => object.key === key)) {
          setPlacement({ state: "in_place", reason: "missing" });
          return;
        }
        // 讀取期間使用者可能已經離開；只有還停在舊連結時才改網址。
        // replace：舊連結不留在瀏覽紀錄，返回鍵不會又被導回來。
        if (onLineageRoute()) {
          window.location.replace(buildHandoff("minio", { source: "minio", minio_key: key, conversion_id: conversionJobId }));
        }
      },
      () => { if (active) setPlacement({ state: "in_place", reason: "unverified" }); },
    );
    return () => { active = false; };
  }, [report, conversionJobId]);

  if (load.state === "not_found") {
    return (
      <div className="lineage-report-callout" data-testid="lineage-report-not-found">
        <p>{t(`找不到轉檔 ${conversionJobId} 的報表。轉檔可能尚未完成，或早於報表功能。`,
          `No report for conversion ${conversionJobId}. The conversion may still be running or predate reports.`)}</p>
        <a href="#minio">{t("回模型庫", "Back to models")}</a>
      </div>
    );
  }
  if (load.state === "error") {
    return <Retry onRetry={retry} testId="lineage-report-error" message={t("無法取得報表，請重試。", "The report is unavailable. Retry.")} />;
  }
  if (report === null || placement.state === "checking") {
    return <p role="status">{t("正在前往這份報表所屬的模型…", "Opening the model this report belongs to…")}</p>;
  }
  const source = `${report.source_ifc.bucket ?? "—"}/${report.source_ifc.key ?? "—"}`;
  return (
    <>
      <header className="lineage-report-head">
        <div>
          <p className="lineage-report-kicker">LINEAGE · {conversionJobId}</p>
          <h1>{t("RVT → IFC → USDC 對齊結果", "RVT → IFC → USDC alignment")}</h1>
          {placement.reason === "unknown_source" && (
            <p data-testid="lineage-report-unknown-source">
              {t("這份報表沒有記錄來源 IFC，無法在模型庫開啟，因此直接顯示在這裡。",
                "This report does not record its source IFC, so it cannot open in the model library and is shown here.")}
            </p>
          )}
          {placement.reason === "missing" && (
            <p data-testid="lineage-report-source-missing">
              {t(`模型庫裡找不到來源 IFC ${source}（可能已刪除或改名），因此直接顯示在這裡。`,
                `The source IFC ${source} is no longer in the model library (deleted or renamed), so the result is shown here.`)}
            </p>
          )}
          {placement.reason === "unverified" && (
            <p data-testid="lineage-report-source-unverified">
              {t("暫時無法確認來源 IFC 是否還在模型庫，先直接顯示在這裡。", "The model library cannot be checked right now, so the result is shown here.")}{" "}
              <a href={buildHandoff("minio", { source: "minio", minio_key: report.source_ifc.key ?? undefined, conversion_id: conversionJobId })}>
                {t("到模型庫開啟這個模型", "Open this model in the model library")}
              </a>
            </p>
          )}
        </div>
        <a href="#minio">{t("回模型庫", "Back to models")}</a>
      </header>
      <LineageResultView report={report} />
    </>
  );
}
