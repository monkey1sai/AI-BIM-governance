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
 * 報表不知道來源 IFC 時沒有模型可以開，改在原地顯示結果。
 */
function hashParams(): URLSearchParams {
  const raw = window.location.hash;
  const index = raw.indexOf("?");
  return new URLSearchParams(index === -1 ? "" : raw.slice(index + 1));
}

/** 導向後網址已不是 `#lineage`；此時不再反應，避免在路由切換前又把網址改掉。 */
const onLineageRoute = () => /^#\/?lineage(?:\?|$)/.test(window.location.hash);

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

function ReportRedirect({ conversionJobId }: { conversionJobId: string }): JSX.Element {
  const fetcher = useCallback(() => coordinatorClient.getLineageConversionReport(conversionJobId), [conversionJobId]);
  const [load, retry] = useLoad(fetcher);
  const sourceKey = load.state === "loaded" ? load.value.source_ifc.key : null;
  useEffect(() => {
    if (!sourceKey) return;
    // replace：舊連結不留在瀏覽紀錄，返回鍵不會又被導回來。
    window.location.replace(buildHandoff("minio", { source: "minio", minio_key: sourceKey, conversion_id: conversionJobId }));
  }, [sourceKey, conversionJobId]);

  if (load.state === "loading" || sourceKey) {
    return <p role="status">{t("正在前往這份報表所屬的模型…", "Opening the model this report belongs to…")}</p>;
  }
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
  return (
    <>
      <header className="lineage-report-head">
        <div>
          <p className="lineage-report-kicker">LINEAGE · {conversionJobId}</p>
          <h1>{t("RVT → IFC → USDC 對齊結果", "RVT → IFC → USDC alignment")}</h1>
          <p data-testid="lineage-report-unknown-source">
            {t("這份報表沒有記錄來源 IFC，無法在模型庫開啟，因此直接顯示在這裡。",
              "This report does not record its source IFC, so it cannot open in the model library and is shown here.")}
          </p>
        </div>
        <a href="#minio">{t("回模型庫", "Back to models")}</a>
      </header>
      <LineageResultView report={load.value} />
    </>
  );
}
