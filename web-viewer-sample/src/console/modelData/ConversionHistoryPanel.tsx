import { Fragment, useCallback, useState } from "react";
import { coordinatorClient, type DevConversionRecord, type DevConversionResult } from "../coordinatorClient";
import { t } from "../i18n";

type ResultState =
  | { status: "loading" }
  | { status: "ready"; value: DevConversionResult }
  | { status: "error"; message: string };

function textField(record: DevConversionRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function ConversionHistoryPanel({
  history,
  historyErr,
}: {
  history: DevConversionRecord[] | null;
  historyErr: boolean;
}): JSX.Element {
  const [results, setResults] = useState<Record<string, ResultState>>({});

  const loadResult = useCallback(async (jobId: string) => {
    setResults((current) => ({ ...current, [jobId]: { status: "loading" } }));
    try {
      const value = await coordinatorClient.getConversionResult(jobId);
      setResults((current) => ({ ...current, [jobId]: { status: "ready", value } }));
    } catch (error) {
      setResults((current) => ({
        ...current,
        [jobId]: { status: "error", message: String(error) },
      }));
    }
  }, []);

  if (history == null) {
    return historyErr
      ? <p className="ec-warn-note" data-testid="conv-history-error">{t("轉檔歷史未取得；請重試頁面更新。", "Conversion history is unavailable; retry the page refresh.")}</p>
      : <p className="ec-note" data-testid="conv-history-loading">{t("轉檔歷史載入中…", "Loading conversion history…")}</p>;
  }
  if (history.length === 0) {
    return <>
      {historyErr && <p className="ec-warn-note" data-testid="conv-history-error">{t("轉檔歷史更新失敗；保留上一份結果。", "Conversion history refresh failed; keeping the previous result.")}</p>}
      <p className="ec-note" data-testid="conv-history-empty">{t("目前沒有轉檔歷史（非錯誤）。", "No conversion history at the moment (not an error).")}</p>
    </>;
  }

  return (
    <div data-testid="conv-history-panel" style={{ overflowX: "auto" }}>
      {historyErr && <p className="ec-warn-note" data-testid="conv-history-error">{t("轉檔歷史更新失敗；保留上一份結果。", "Conversion history refresh failed; keeping the previous result.")}</p>}
      <table className="ec-table">
        <thead><tr><th>conversion_job_id</th><th>status</th><th>source</th><th>time</th><th>{t("結果", "Result")}</th></tr></thead>
        <tbody>
          {history.slice(0, 50).map((record, index) => {
            const jobId = record.conversion_job_id ?? `unknown-${index}`;
            const sourceKey = textField(record, "object_key") ?? textField(record, "source_key");
            const sourceFilename = record.source_ifc_filename ?? null;
            const observedAt = textField(record, "created_at") ?? textField(record, "updated_at");
            const resultState = results[jobId];
            const result = resultState?.status === "ready" ? resultState.value : null;
            const artifacts = result?.artifacts ? Object.entries(result.artifacts) : [];
            return (
              <Fragment key={jobId}>
                <tr data-testid={`conv-history-row-${jobId}`}>
                  <td><code>{jobId}</code></td>
                  <td>{record.status ?? "—"}</td>
                  <td>
                    {sourceKey ?? sourceFilename ?? "—"}
                    {!sourceKey && sourceFilename && <span className="ec-note"> · {t("filename，source key 未提供", "filename; source key not provided")}</span>}
                  </td>
                  <td>{observedAt ?? t("時間未提供", "time not provided")}</td>
                  <td>
                    {record.conversion_job_id ? (
                      <button
                        type="button"
                        className="ec-btn"
                        data-testid={`conv-history-result-${jobId}`}
                        disabled={resultState?.status === "loading"}
                        onClick={() => void loadResult(jobId)}
                      >
                        {resultState?.status === "loading"
                          ? t("載入中…", "Loading…")
                          : resultState?.status === "error"
                            ? t("重試結果", "Retry result")
                            : resultState?.status === "ready"
                              ? t("重新載入", "Reload")
                              : t("查看結果", "View result")}
                      </button>
                    ) : <span className="ec-note">job id {t("未提供", "not provided")}</span>}
                  </td>
                </tr>
                {resultState?.status === "error" && (
                  <tr><td colSpan={5}><p className="ec-warn-note">{t("結果未取得：", "Result unavailable: ")}{resultState.message}</p></td></tr>
                )}
                {resultState?.status === "ready" && (
                  <tr data-testid={`conv-history-result-row-${jobId}`}><td colSpan={5}>
                    <div className="ec-note">status={result?.status ?? "—"} · ready={String(result?.ready ?? false)}</div>
                    {artifacts.length > 0 ? (
                      <ul>
                        {artifacts.map(([role, artifact]) => (
                          <li key={role}><code>{role}</code> · {artifact.url ?? t("URL 未提供", "URL not provided")}</li>
                        ))}
                      </ul>
                    ) : <p className="ec-note">{t("此結果未提供 artifact。", "This result did not provide artifacts.")}</p>}
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
