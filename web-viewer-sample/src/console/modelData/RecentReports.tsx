import { useCallback, useEffect, useRef, useState } from "react";
import { coordinatorClient, type LineageConversionReport } from "../coordinatorClient";
import { Btn } from "../components";
import { t } from "../i18n";
import { formatRatioPercent } from "../reports/lineageFormat";
import { formatWhen, REPORT_STATUS } from "../reports/lineageReportShared";

const RECENT_LIMIT = 10;

type State =
  | { state: "loading" }
  | { state: "error" }
  | { state: "loaded"; items: LineageConversionReport[] };

/**
 * 未選模型時的捷徑：最近有轉檔結果的模型，點一下就定位並開啟。
 * 同一個模型只列最新一次；沒有記錄來源 IFC 的報表無法在模型庫開啟，改用連結直接查看。
 */
export function RecentReports({ onOpen }: { onOpen: (objectKey: string, conversionJobId: string) => void }): JSX.Element | null {
  const [load, setLoad] = useState<State>({ state: "loading" });
  const generation = useRef(0);
  const run = useCallback(async () => {
    const current = ++generation.current;
    setLoad({ state: "loading" });
    try {
      const result = await coordinatorClient.listLineageConversionReports({ limit: RECENT_LIMIT });
      if (current !== generation.current) return;
      const seen = new Set<string>();
      const items = result.items.filter((item) => {
        const key = item.source_ifc.key;
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setLoad({ state: "loaded", items });
    } catch {
      if (current === generation.current) setLoad({ state: "error" });
    }
  }, []);
  useEffect(() => {
    void run();
    return () => { generation.current += 1; };
  }, [run]);

  if (load.state === "loading") {
    return <p role="status" className="ec-note">{t("讀取最近的轉檔結果中…", "Loading recent results…")}</p>;
  }
  if (load.state === "error") {
    return (
      <p className="ec-note" data-testid="md-recent-reports-error">
        {t("暫時無法列出最近的轉檔結果。", "Recent results are unavailable right now.")}{" "}
        <Btn onClick={() => { void run(); }}>{t("重試", "Retry")}</Btn>
      </p>
    );
  }
  if (load.items.length === 0) {
    return <p className="ec-note">{t("目前還沒有任何轉檔結果。", "No conversion results yet.")}</p>;
  }
  return (
    <div className="md-recent">
      <h3>{t("或從最近轉檔過的模型開始", "Or start from a recently converted model")}</h3>
      <ul data-testid="md-recent-reports">
        {load.items.map((item) => (
          <li key={item.conversion_job_id}>
            {item.source_ifc.key ? (
              <button type="button" data-testid="md-recent-report" onClick={() => onOpen(item.source_ifc.key!, item.conversion_job_id)}>
                <span className="md-recent-key">{item.source_ifc.key}</span>
                <RecentMeta item={item} />
              </button>
            ) : (
              <a data-testid="md-recent-report-link" href={`#lineage?conversion_job_id=${encodeURIComponent(item.conversion_job_id)}`}>
                <span className="md-recent-key">{t(`來源 IFC 未記錄 · ${item.conversion_job_id}`, `Source IFC not recorded · ${item.conversion_job_id}`)}</span>
                <RecentMeta item={item} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentMeta({ item }: { item: LineageConversionReport }): JSX.Element {
  return (
    <span className="md-recent-meta">
      {formatWhen(item.conversion_created_at)} · {REPORT_STATUS[item.status]}
      {item.metrics && <> · {t("完整追溯", "Lineage")} {formatRatioPercent(item.metrics.rvt_ifc_usdc_lineage_ratio)}</>}
    </span>
  );
}
