import { Fragment, useCallback, useEffect, useState } from "react";
import { Btn, Panel } from "./components";
import { coordinatorClient, type ConversionQualityMetricsResponse, type IfcReadyListItem } from "./coordinatorClient";
import { IncomingHandoffBanner, useIncomingHandoff } from "./incomingHandoff";
import { IntentDialog } from "./IntentDialog";
import { t } from "./i18n";
import { ConversionHistoryPanel } from "./modelData/ConversionHistoryPanel";
import { CoverageDrawer, lifecycleLabel } from "./modelData/conversionShared";
import { useConversionActions } from "./modelData/useConversionActions";
import { useConversionData } from "./modelData/useConversionData";
import { useSharedStatus } from "./useSharedStatus";

type CoverageState = ConversionQualityMetricsResponse | { error: string } | "loading";

export function ConversionPage(): JSX.Element {
  const data = useConversionData();
  const shared = useSharedStatus();
  const actions = useConversionActions(data.load, data.loadRecords);
  const [openCoverageJob, setOpenCoverageJob] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Record<string, CoverageState>>({});

  const refresh = useCallback(async () => {
    await Promise.all([data.load(), data.loadRecords(), data.loadHistory()]);
  }, [data.load, data.loadHistory, data.loadRecords]);

  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const incoming = useIncomingHandoff("conv", (handoff) => {
    if (handoff.job_id) {
      if (!data.jobsLoaded) return "indeterminate";
      if (data.jobs.some((job) => job.ifc_ready_job_id === handoff.job_id || job.conversion_job_id === handoff.job_id)) return true;
      return data.jobsTruncated ? "indeterminate" : false;
    }
    if (handoff.conversion_id) {
      if (!data.recordsLoaded) return "indeterminate";
      if (data.records.some((record) => record.conversion_job_id === handoff.conversion_id)) return true;
      return data.recordsTruncated ? "indeterminate" : false;
    }
    return "not_applicable";
  });

  const toggleCoverage = useCallback(async (job: IfcReadyListItem) => {
    if (!job.conversion_job_id) return;
    if (openCoverageJob === job.ifc_ready_job_id) {
      setOpenCoverageJob(null);
      return;
    }
    setOpenCoverageJob(job.ifc_ready_job_id);
    const current = coverage[job.ifc_ready_job_id];
    if (current === "loading" || (current && !("error" in current))) return;
    setCoverage((state) => ({ ...state, [job.ifc_ready_job_id]: "loading" }));
    try {
      const value = await coordinatorClient.conversionQualityMetrics(job.conversion_job_id);
      setCoverage((state) => ({ ...state, [job.ifc_ready_job_id]: value }));
    } catch (error) {
      setCoverage((state) => ({ ...state, [job.ifc_ready_job_id]: { error: String(error) } }));
    }
  }, [coverage, openCoverageJob]);

  const queueCount = data.jobs.filter((job) =>
    job.status === "queued_for_conversion" || job.conversion_lifecycle_status === "converting"
  ).length;
  const gpuLabel = shared.gpuNodesBusy == null || shared.gpuNodesTotal == null
    ? t("未取得", "not available")
    : `${shared.gpuNodesBusy}/${shared.gpuNodesTotal}`;
  const watchStatusKnown = data.mw != null && data.mwErr == null;

  return (
    <div data-testid="conv-page">
      <h1>{t("IFC→USD 轉檔歷史", "IFC→USD Conversion History")}</h1>
      <IncomingHandoffBanner testId="conv-incoming-handoff" handoff={incoming.handoff} status={incoming.status} />
      <p className="ec-lead">
        {t("獨立檢視既有轉檔 job、佇列控制與產物；瀏覽器只透過 coordinator API，不直接連線 conversion runtime。", "Inspect existing conversion jobs, queue controls, and artifacts. The browser only uses coordinator APIs and never connects directly to the conversion runtime.")}
      </p>

      <Panel
        title={t("轉檔執行概況", "Conversion execution overview")}
        sub={t("每 5 秒重抓 ifc-ready queue；失敗保留上一輪資料並顯示錯誤", "Refreshes the ifc-ready queue every 5 seconds; failures keep the previous snapshot and show the error")}
        prov="asbuilt"
        actions={<Btn data-testid="conv-refresh" disabled={data.busy} onClick={() => void refresh()}>{data.busy ? t("載入中…", "Loading…") : t("重新整理", "Refresh")}</Btn>}
      >
        {data.jobsErr && <p className="ec-warn-note" data-testid="conv-queue-error">{data.jobsErr}</p>}
        {data.recErr && <p className="ec-warn-note">{data.recErr}</p>}
        {data.mwErr && <p className="ec-warn-note" data-testid="conv-watch-error">{data.mwErr}</p>}
        <div className="ec-grid" data-testid="conv-metrics">
          <div><div className="ec-metric">{queueCount}</div><div className="ec-s">{t("佇列 / 轉換中", "Queued / converting")}</div></div>
          <div><div className="ec-metric">COVERAGE</div><div className="ec-s" data-testid="conv-coverage-selfref-note">usd_stage_enumeration · {t("自我參照；未觀測不宣稱通過", "self-reported; no pass claim when unobserved")}</div></div>
          <div><div className="ec-metric">{gpuLabel}</div><div className="ec-s">GPU runtime · {t("狀態未由 coordinator 提供；未觀測", "status not provided by coordinator; not observed")}</div></div>
        </div>
        {data.mw?.enabled === false && <p className="ec-warn-note" data-testid="conv-watch-off-banner">{t("自動偵測已關閉", "Automatic detection is off")}</p>}
        <div data-testid="conv-watch-controls">
          <span className="ec-note">MinIO watch: {data.mw == null ? t("未取得", "not available") : data.mw.enabled ? "enabled" : "disabled"}</span>{" "}
          <Btn
            data-testid={data.mw == null ? "conv-watch-unavailable" : data.mw.enabled ? "conv-watch-disable" : "conv-watch-enable"}
            disabled={!watchStatusKnown}
            onClick={() => {
              if (!watchStatusKnown || data.mw == null) return;
              actions.setActionErr(null);
              actions.setPendingAction({ kind: "watch-toggle", enabled: !data.mw.enabled });
            }}
          >{data.mw == null ? t("狀態未取得", "Status unavailable") : data.mw.enabled ? t("關閉自動偵測", "Disable automatic detection") : t("開啟自動偵測", "Enable automatic detection")}</Btn>
        </div>
      </Panel>

      <Panel title={t("既有轉檔佇列", "Existing conversion queue")} sub="GET /api/external/ifc-ready" prov="asbuilt">
        <p className="ec-note"><code>prioritize / retry</code> {t("只對既有 ifc-ready job 排序／重試，不觸發新轉檔", "only reorder or retry existing ifc-ready jobs; they do not trigger a new conversion")}</p>
        {data.jobs.length === 0 ? <p className="ec-note">{t("目前沒有 ifc-ready job。", "There are no ifc-ready jobs.")}</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="ec-table">
              <thead><tr><th>job</th><th>project</th><th>status</th><th>conversion</th><th>dispatch</th><th>session</th><th>stage URL</th><th>coverage</th><th>{t("控制", "Control")}</th></tr></thead>
              <tbody>{data.jobs.slice(0, 50).map((job) => (
                <Fragment key={job.ifc_ready_job_id}>
                  <tr data-highlight={incoming.handoff?.job_id === job.ifc_ready_job_id || incoming.handoff?.job_id === job.conversion_job_id}>
                    <td><code>{job.ifc_ready_job_id}</code></td>
                    <td>{job.project_display_name || job.project_id}</td>
                    <td>{lifecycleLabel(job.conversion_lifecycle_status)}</td>
                    <td>{job.conversion_job_id ?? t("尚未派工", "not dispatched")}</td>
                    <td><code>{job.status}</code>{job.dispatch_error ? <div className="ec-note">{job.dispatch_error}</div> : null}</td>
                    <td>{job.review_session_id ?? "—"}</td>
                    <td>{job.expected_stage_url ? <code>{job.expected_stage_url}</code> : "—"}</td>
                    <td>{job.conversion_job_id ? <Btn data-testid={`conv-coverage-toggle-${job.ifc_ready_job_id}`} onClick={() => void toggleCoverage(job)}>{openCoverageJob === job.ifc_ready_job_id ? t("收合", "Collapse") : "coverage"}</Btn> : "—"}</td>
                    <td>
                      {job.status === "queued_for_conversion" && <Btn data-testid={`conv-prioritize-${job.ifc_ready_job_id}`} disabled={job.queue_position == null || job.queue_position <= 1} onClick={() => actions.setPendingAction({ jobId: job.ifc_ready_job_id, kind: "prioritize" })}>{t("插隊", "Prioritize")}</Btn>}
                      {(job.status === "dispatch_failed" || job.status === "dropped_on_restart") && <Btn data-testid={`conv-retry-${job.ifc_ready_job_id}`} onClick={() => actions.setPendingAction({ jobId: job.ifc_ready_job_id, kind: "retry" })}>{t("重試", "Retry")}</Btn>}
                    </td>
                  </tr>
                  {openCoverageJob === job.ifc_ready_job_id && <tr><td colSpan={9}><CoverageDrawer state={coverage[job.ifc_ready_job_id]} /></td></tr>}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t("轉檔歷史與產物", "Conversion history and artifacts")} sub="GET /api/dev/conversions · GET /api/dev/conversions/:jobId/result" prov="asbuilt">
        <ConversionHistoryPanel history={data.history} historyErr={data.historyErr} />
      </Panel>

      <IntentDialog
        open={actions.pendingAction != null}
        title={actions.pendingAction?.kind === "watch-toggle" ? t("確認切換 MinIO 監看", "Confirm MinIO watch change") : actions.pendingAction?.kind === "prioritize" ? t("確認插隊", "Confirm prioritize") : t("確認重試", "Confirm retry")}
        cost={t("動作送出後會重新抓取真實佇列狀態；若重抓失敗，對話框保持開啟並顯示錯誤。", "After submission the real queue state is fetched again; if refresh fails, the dialog remains open and shows the error.")}
        busy={actions.actionBusy}
        actionErr={actions.actionErr}
        onConfirm={actions.runAction}
        onCancel={() => { if (!actions.actionBusy) { actions.setActionErr(null); actions.setPendingAction(null); } }}
      />
    </div>
  );
}
