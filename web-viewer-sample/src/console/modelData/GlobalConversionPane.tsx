// web-viewer-sample/src/console/modelData/GlobalConversionPane.tsx
// MD 三頁合一 Task 4：右欄「未選檔」全域轉檔視圖（spec §3.2）。純呈現＋dialog 驅動——資料一律由
// props.data（useConversionData）進來，動作一律由 useConversionActions 驅動；本元件不自抓資料。
// 由上而下組成（spec §3.2A/B/C）：
//   1. watcher 關閉琥珀警示（右欄頂）＋摘要卡（watcher 開關＋統計，統計標「口徑」易失/持久）。
//   2. 「展開細節」<details>：watcher 診斷欄位全文（§3.4 auto-enroll 說明／一致性基準／補救文案）＋
//      Pipeline Panel 內容全文（頁級 LifecycleStrip＋conversion authority／插隊重試／concurrency NOT BUILT）。
//   3. 轉檔佇列表（ifc-ready 全欄位表）：補 download／authority 兩欄（§4 #17 IN 零損失）、overflow-x 版面、
//      每列「檔案 →」定位（有 object_key）／「非 MinIO 來源」（無）、handoff 命中列高亮、source 一律 "minio"。
//   4. 轉檔歷史 <details>（GET /api/dev/conversions pass-through）。
//   5. 兩個 IntentDialog（watch-toggle/prioritize/retry ＋ ledger trigger），由 useConversionActions 驅動。
// 去重化（spec §3.2 line 70）：原 CV 獨立「轉檔 Ledger 表」不再呈現為表；ledger 資料改驅動左欄 chip／
// 單檔詳情／摘要統計三處。ledger 列「觸發轉檔」鈕移入單檔詳情（Task 5）與佇列表；本元件保留 trigger
// dialog＋confirmTrigger（共用 hook），opener 由單檔詳情／殼層 wiring（見報告 concern）。
import { Fragment, useCallback, useState } from "react";
import { t } from "../i18n";
import { Btn, Field, Panel } from "../components";
import { PROV_CLASS } from "../data";
import { coordinatorClient, type ConversionQualityMetricsResponse, type IfcReadyListItem } from "../coordinatorClient";
import { CoverageDrawer, LEDGER_STATUS_PROV, LifecycleStrip, lifecycleLabel } from "./conversionShared";
import { buildHandoff } from "../handoff";
import { IntentDialog } from "../IntentDialog";
import type { ConversionData } from "./useConversionData";
import { useConversionActions } from "./useConversionActions";

export function GlobalConversionPane(props: {
  data: ConversionData;
  onLocateObject(objectKey: string): void; // 佇列列「檔案 →」→ 殼層導覽左欄＋選檔
  highlightJobId?: string | null;          // handoff job_id 命中列高亮（data-highlight="true"）
}): JSX.Element {
  const { data, onLocateObject, highlightJobId } = props;
  const { jobs, jobsErr: err, jobsTruncated, records, recErr, recordsTruncated, mw, mwErr, history, historyErr, busy, load, loadRecords } = data;
  const actions = useConversionActions(load, loadRecords);
  const {
    pendingAction, setPendingAction, actionBusy, actionErr, setActionErr, runAction,
    pendingTriggerKey, setPendingTriggerKey, triggerBusy, triggerErr, setTriggerErr, confirmTrigger,
  } = actions;

  // coverage 展開本地狀態（純呈現、非 action：搬自 CV toggleCoverage 原文，含去重／載入鎖／錯誤可重試）。
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [cov, setCov] = useState<Record<string, ConversionQualityMetricsResponse | { error: string } | "loading">>({});
  const toggleCoverage = useCallback(async (job: IfcReadyListItem) => {
    if (!job.conversion_job_id) return;
    const id = job.ifc_ready_job_id;
    // 開關語意：同一 job 已展開 → 收合（不重打）。重試 / 重用都走「收合後重新展開」這條兩步路徑。
    if (openJob === id) { setOpenJob(null); return; }
    setOpenJob(id);
    const cached = cov[id];
    if (cached === "loading") return; // 載入中 → 不重打
    if (cached && !("error" in cached)) return; // 已成功（response 物件，無 error 鍵）→ 重用
    setCov((p) => ({ ...p, [id]: "loading" }));
    try {
      const r = await coordinatorClient.conversionQualityMetrics(job.conversion_job_id);
      setCov((p) => ({ ...p, [id]: r }));
    } catch (e) {
      setCov((p) => ({ ...p, [id]: { error: `${t("未取得 coverage：", "Coverage not available: ")}${String(e)}` } }));
    }
  }, [openJob, cov]);

  // 摘要統計（spec §3.2A）：queued/converting 讀易失 ifc-ready jobs；failed/ready 讀持久 ledger records。
  const stats = {
    queued: jobs.filter((j) => j.status === "queued_for_conversion").length,
    converting: jobs.filter((j) => j.conversion_lifecycle_status === "converting").length,
    failed: records.filter((r) => r.status === "failed").length,
    ready: records.filter((r) => r.status === "ready").length,
  };
  // (jobsTruncated || recordsTruncated) → 整卡加註「（回傳窗內，非全量）」（誠實鐵律：不把「看不到」當「全量」）。
  const windowed = jobsTruncated || recordsTruncated;
  const CALIBER_VOLATILE = t("口徑：ifc-ready（易失、重啟即清）", "Source: ifc-ready (volatile, cleared on restart)");
  const CALIBER_LEDGER = t("口徑：ledger（持久、跨重啟）", "Source: ledger (persistent, survives restart)");

  return (
    <>
      {/* 1. watcher 關閉琥珀警示（右欄頂，spec §3.2 line 68） */}
      {mw?.enabled === false && (
        <p className="ec-warn-note" data-testid="conv-watch-off-banner">
          {t("⚠ 自動偵測已關閉——新 model.ifc 不會自動進件，需手動進件", "⚠ Auto-detection is off — new model.ifc will not be intaken automatically; manual intake is required")}
        </p>
      )}
      {/* 1b. 摘要卡（watcher 開關＋統計，spec §3.2A） */}
      <Panel
        title={t("轉檔摘要 · MinIO 自動偵測（O4）", "Conversion summary · MinIO auto-detection (O4)")}
        sub={t("統計＝易失 ifc-ready 佇列＋持久 ledger；watcher 來源 /api/external/minio-watch/status", "Stats = volatile ifc-ready queue + persistent ledger; watcher source /api/external/minio-watch/status")}
        prov="asbuilt"
        actions={<Btn caption="GET /api/external/ifc-ready" disabled={busy} onClick={() => { void load(); void loadRecords(); }}>{busy ? t("讀取中…", "Loading…") : "Refresh queue"}</Btn>}
      >
        {/* watcher 狀態＋開關（enable/disable 鈕邏輯搬自 CV；pendingAction 機制由 useConversionActions 提供） */}
        <div data-testid="minio-watch-panel">
          {mwErr ? (
            <p className="ec-warn-note" data-testid="minio-watch-error">{mwErr}</p>
          ) : mw == null ? (
            <p className="ec-note">{t("尚未取得 watcher 狀態；按上方 Refresh queue 後顯示。", "Watcher status not retrieved yet; click Refresh queue above to display it.")}</p>
          ) : mw.enabled === false ? (
            <>
              <Field k={t("狀態", "Status")} v={t("未啟用 — 需設定 env MINIO_WATCH_ENABLED opt-in", "Not enabled — requires env MINIO_WATCH_ENABLED opt-in")} prov="asbuilt" />
              <p className="ec-note">{mw.note ?? t("watcher 預設關閉；狀態 API 為真，未偽稱功能在跑。", "The watcher is off by default; the status API is real and does not falsely claim the feature is running.")}</p>
              <Btn
                data-testid="conv-watch-enable"
                onClick={() => { setTriggerErr(null); setPendingTriggerKey(null); setActionErr(null); setPendingAction({ kind: "watch-toggle", enabled: true }); }}
              >{t("開啟自動偵測", "Enable auto-detection")}</Btn>
            </>
          ) : (
            <>
              {mw.note && <p className="ec-note">{mw.note}</p>}
              <Field k={t("狀態", "Status")} v={t("啟用中（env opt-in）", "Enabled (env opt-in)")} prov="asbuilt" />
              <Btn
                data-testid="conv-watch-disable"
                onClick={() => { setTriggerErr(null); setPendingTriggerKey(null); setActionErr(null); setPendingAction({ kind: "watch-toggle", enabled: false }); }}
              >{t("關閉自動偵測", "Disable auto-detection")}</Btn>
            </>
          )}
        </div>
        {err && <p className="ec-warn-note">{err}</p>}
        {recErr && <p className="ec-warn-note">{recErr}</p>}
        {/* 統計列（口徑標示：ifc-ready 易失 vs ledger 持久，spec §3.2A） */}
        <div className="ec-grid" data-testid="md-conversion-stats">
          <div data-testid="md-stat-block-queued">
            <div className="ec-metric" data-testid="md-stat-queued">{stats.queued}</div>
            <div className="ec-s">{t("佇列中", "Queued")}</div>
            <div className="ec-note">{CALIBER_VOLATILE}</div>
          </div>
          <div data-testid="md-stat-block-converting">
            <div className="ec-metric" data-testid="md-stat-converting">{stats.converting}</div>
            <div className="ec-s">{t("轉換中", "Converting")}</div>
            <div className="ec-note">{CALIBER_VOLATILE}</div>
          </div>
          <div data-testid="md-stat-block-failed">
            <div className="ec-metric" data-testid="md-stat-failed">{stats.failed}</div>
            <div className="ec-s">{t("失敗", "Failed")}</div>
            <div className="ec-note">{CALIBER_LEDGER}</div>
          </div>
          <div data-testid="md-stat-block-ready">
            <div className="ec-metric" data-testid="md-stat-ready">{stats.ready}</div>
            <div className="ec-s">{t("完成", "Ready")}</div>
            <div className="ec-note">{CALIBER_LEDGER}</div>
          </div>
        </div>
        {windowed && (
          <p className="ec-note" data-testid="md-stats-windowed">
            {t("（回傳窗內，非全量）", "(within the returned window, not the full set)")}
          </p>
        )}
        {/* 2. 展開細節：watcher 診斷欄位全文＋Pipeline Panel 內容全文（spec §3.2A、§4 #8/#21） */}
        <details data-testid="md-pipeline-details">
          <summary>{t("展開細節 · Pipeline / 系統細節", "Details · Pipeline / system internals")}</summary>
          {/* watcher 診斷欄位（enabled 時；搬 CV watcher Panel 全文） */}
          {mw?.enabled && (
            <div data-testid="md-watch-diagnostics">
              <Field k="bucket" v={mw.bucket ?? "—"} prov="asbuilt" />
              <Field k="prefix" v={mw.prefix || t("（無）", "(none)")} prov="asbuilt" />
              <Field k={t("最近一輪", "Last poll")} v={mw.last_poll_at ?? t("尚未完成首輪", "first poll not completed yet")} prov="asbuilt" />
              <Field k={t("輪詢次數", "Poll count")} v={String(mw.poll_count ?? "—")} prov="asbuilt" />
              <Field
                k={t("baseline（首輪 list 到的規約檔數）", "baseline (convention files seen on first poll)")}
                v={<span data-testid="conv-baseline-count">{mw.baseline_count ?? "—"}</span>}
                prov="asbuilt"
              />
              <Field
                k={t("triggered（baseline 後真正新觸發）", "triggered (new since baseline)")}
                v={<span data-testid="conv-triggered-total">{mw.triggered_total ?? 0}</span>}
                prov="asbuilt"
              />
              <Field
                k={t("seen / 跳過", "seen / skipped")}
                v={`${mw.seen_count ?? 0} / ${mw.skipped_malformed_total ?? 0}`}
                prov="asbuilt"
              />
              {/* baseline 說明（spec §3.4 auto-enroll）：baseline_count 純診斷，首輪即對 ledger 無紀錄的既有
                  model.ifc 自動觸發轉檔（auto-enroll 補轉），baseline_count 不再代表「不轉檔」。 */}
              <p className="ec-note" data-testid="conv-baseline-explain">
                {t(
                  "baseline＝watcher 首輪 list 到的規約檔（可解析 model.ifc）數，純診斷。§3.4 全自動 auto-enroll：首輪即對 ledger 無紀錄的既有 model.ifc 自動觸發轉檔（既有未轉檔自動補轉；重啟命中持久 ledger 不重觸發，不風暴）。triggered＝累計真正觸發數（含首輪 auto-enroll）——triggered=0 僅代表尚無 ledger 無紀錄的可解析檔，非故障。",
                  "baseline = number of convention files (parseable model.ifc) the watcher listed in its first round; diagnostic only. §3.4 full auto-enroll: the first round auto-triggers conversion for existing model.ifc with no ledger record (back-fills existing un-converted files; a restart hits the persistent ledger and does not re-trigger, no storm). triggered = cumulative genuinely-triggered count (including first-round auto-enroll) — triggered=0 only means there is no parseable file lacking a ledger record yet, not a fault.",
                )}
              </p>
              {/* 三視圖一致性基準（spec AC5）：明示「可解析 IFC 數」非「物件總數」。 */}
              <p className="ec-note" data-testid="conv-consistency-basis">
                {t(
                  "一致性基準＝可解析 IFC 數（*/model.ifc），非 bucket 物件總數：#minio 全量物件（含幾何 .json）與 watcher 只認的 model.ifc 數本就不同口徑，watcher 並未漏看其餘物件。",
                  "Consistency basis = count of parseable IFC (*/model.ifc), NOT total bucket object count: the full #minio object set (incl. geometry .json) and the model.ifc count the watcher recognizes are different denominators by design; the watcher is not missing the other objects.",
                )}
              </p>
              {/* AC6(a)：兩條 spec 認可補救說明（純文字，UI 觸發走單檔詳情/佇列表的 POST /api/conversion/trigger）。 */}
              <p className="ec-note" data-testid="conv-remediation-note">
                {t(
                  "補救既有未轉檔的兩條 spec 認可路徑：(i) 重新上傳該 model.ifc（改變 etag）→ watcher 下一輪自動觸發；(ii) 手動 webhook intake，直打 POST /api/external/ifc-ready（帶 webhook secret + presigned GET URL）。此兩條為文字說明；若要直接觸發，請用左欄選檔後的單檔詳情「觸發轉檔」鈕（走 POST /api/conversion/trigger）。",
                  "Two spec-approved remediations for existing un-converted files: (i) re-upload the model.ifc (changes its etag) → the watcher auto-triggers on the next round; (ii) manual webhook intake by calling POST /api/external/ifc-ready directly (with webhook secret + presigned GET URL). These two are textual guidance; to trigger directly, select a file in the left tree and use the \"Trigger\" button in the single-file detail (which calls POST /api/conversion/trigger).",
                )}
              </p>
              {mw.last_error && <Field k={t("最近錯誤", "Last error")} v={mw.last_error} prov="asbuilt" />}
              {mw.last_triggered && mw.last_triggered.length > 0 && (
                <table className="ec-table" data-testid="minio-watch-triggered">
                  <thead><tr><th>key</th><th>job</th><th>error</th><th>at</th></tr></thead>
                  <tbody>{mw.last_triggered.map((evt, i) => (
                    <tr key={`${evt.key}-${i}`}>
                      <td>{evt.key}</td>
                      <td>{evt.job_id ?? "—"}</td>
                      <td>{evt.error ?? "—"}</td>
                      <td>{evt.at}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}
          {/* Pipeline Panel 內容（頁級，永遠顯示；spec §4 #21 NOT BUILT 揭露不得遺失） */}
          <LifecycleStrip steps={[t("讀 MinIO / storage", "Read MinIO / storage"), t("排隊", "Queue"), "IFC→USD", t("寫回 model.usdc", "Write back model.usdc"), t("通知 Kit", "Notify Kit")]} />
          <Field k="conversion authority" v="bim-streaming-server owns heavy conversion" prov="asbuilt" />
          <Field k={t("插隊 / 重試", "Prioritize / retry")} v={t("可於下方 ifc-ready job 列依狀態操作（intent→confirm→audited）", "Available on the ifc-ready job rows below, depending on status (intent→confirm→audited)")} prov="asbuilt" />
          <Field k={t("concurrency 控制", "concurrency control")} v={t("NOT BUILT：獨立 follow-up 卡", "NOT BUILT: tracked as a separate follow-up card")} prov="p1" />
        </details>
      </Panel>
      {/* 3. 轉檔佇列表（ifc-ready 全欄位表，spec §3.2B）——含非 MinIO 來源 job（demo-control fixture、外部 webhook）。 */}
      <Panel title="Ifc-ready jobs" sub={t("/api/external/ifc-ready truth；沒有資料時顯示空，不補假 job", "/api/external/ifc-ready truth; shows empty when there is no data, with no fake jobs filled in")} prov="asbuilt">
        {jobs.length ? (
          // (a) overflow-x 包住 table（右欄實際寬度下佇列表捲動可讀，spec §3.2B 版面）。
          <div style={{ overflowX: "auto" }} data-testid="md-queue-scroll">
            <table className="ec-table">
              <thead><tr>
                <th>job</th><th>key</th><th>lifecycle</th><th>project</th><th>usdc</th><th>conversion</th><th>dispatch</th>
                {/* (b) session 前插 download / authority（§4 #17 IN 零損失） */}
                <th>download</th><th>authority</th>
                <th>session</th><th>stage</th><th>coverage</th><th>{t("控制", "Control")}</th>
                {/* (c) 每列尾端「檔案 →」定位欄 */}
                <th>{t("檔案", "File")}</th>
              </tr></thead>
              <tbody>{jobs.slice(0, 20).map((j) => {
                // (c) 依 idempotency_key 對帳到 ledger 紀錄，取 object_key 供「檔案 →」定位（無值＝非 MinIO 來源）。
                const rec = records.find((r) => r.idempotency_key === j.idempotency_key);
                const objectKey = rec?.object_key ?? null;
                return (
                <Fragment key={j.ifc_ready_job_id}>
                  {/* (d) handoff job_id 命中列高亮（ifc_ready_job_id 或 conversion_job_id 命中） */}
                  <tr data-highlight={highlightJobId != null && (j.ifc_ready_job_id === highlightJobId || j.conversion_job_id === highlightJobId)}>
                    <td>{j.ifc_ready_job_id}</td>
                    <td>
                      {/* key 欄三段訊號間顯式補空白分隔（idem／replay／volatility 各為獨立訊號，不得黏字）。 */}
                      <code data-testid={`conv-job-idem-${j.ifc_ready_job_id}`}>{j.idempotency_key ?? "—"}</code>{" "}
                      <span data-testid={`conv-job-replay-${j.ifc_ready_job_id}`} className="ec-note">{j.idempotent_replay ? t("命中既有", "replay") : t("新建", "new")}</span>{" "}
                      <span data-testid={`conv-job-volatility-${j.ifc_ready_job_id}`} className="ec-note">{j.data_volatility === "persisted" ? t("持久", "persisted") : t("易失·重啟即清", "volatile")}</span>
                    </td>
                    <td>
                      <span
                        data-testid={`conv-job-lifecycle-${j.ifc_ready_job_id}`}
                        className={`ec-prov ${PROV_CLASS[LEDGER_STATUS_PROV[j.conversion_lifecycle_status ?? ""] ?? "artifact"]}`}
                      >{lifecycleLabel(j.conversion_lifecycle_status)}</span>
                    </td>
                    <td data-testid={`conv-job-project-${j.ifc_ready_job_id}`}>
                      {j.project_display_name || j.project_id}{j.category ? ` · ${j.category}` : ""}
                    </td>
                    <td>
                      <span data-testid={`conv-job-usdc-${j.ifc_ready_job_id}`} className="ec-note">
                        {j.usdc_role === "parsed_usdc" ? t("已產生 USDC", "USDC ready") : t("待產生", "pending")}
                      </span>
                    </td>
                    <td>{j.conversion_status ?? "—"}</td>
                    <td>
                      {(j.failure_reason ?? j.dispatch_error) ? (
                        <span
                          className="ec-warn-note"
                          data-testid={`conv-job-failure-${j.ifc_ready_job_id}`}
                          title={`${j.failure_stage ? `[${j.failure_stage}] ` : ""}${j.failure_reason ?? j.dispatch_error}`}
                        >
                          {j.failure_stage ? `[${j.failure_stage}] ` : ""}
                          {(() => {
                            // 誠實鐵律：超過 80 字才截斷並補「…」提示，不可靜默硬切誤導操作員（完整訊息見 title tooltip）。
                            const msg = (j.failure_reason ?? j.dispatch_error) as string;
                            return msg.length > 80 ? `${msg.slice(0, 80)}…` : msg;
                          })()}
                        </span>
                      ) : "—"}
                    </td>
                    {/* (b) download / authority 兩欄（CV 現無此二欄；IN 唯讀表獨有，合併須補達零損失，§4 #17） */}
                    <td data-testid={`conv-job-download-${j.ifc_ready_job_id}`}>{j.download_status ?? "—"}</td>
                    <td data-testid={`conv-job-authority-${j.ifc_ready_job_id}`}>{j.conversion_authority ?? "—"}</td>
                    <td>
                      {/* (f) cross-link source 一律 "minio"（spec §5：左欄即來源，發送端 source 統一 minio）。 */}
                      {j.review_session_id ?? "—"}
                      {j.review_session_id ? (
                        <>
                          {" "}
                          <Btn data-testid={`conv-job-session-${j.ifc_ready_job_id}`} caption={t("在 Session 管理檢視", "View in Session Management")}
                            onClick={() => { window.location.hash = buildHandoff("sessions", { source: "minio", session: j.review_session_id as string }); }}>SS →</Btn>
                          {" "}
                          <Btn data-testid={`conv-job-review-${j.ifc_ready_job_id}`} caption={t("在 Review Room 開此 session", "Open this session in Review Room")}
                            onClick={() => { window.location.hash = buildHandoff("review", { source: "minio", session: j.review_session_id as string }); }}>Review →</Btn>
                        </>
                      ) : null}
                    </td>
                    <td>{j.expected_stage_url ?? "—"}</td>
                    <td>{j.conversion_job_id
                      ? <Btn data-testid={`conv-coverage-toggle-${j.ifc_ready_job_id}`} onClick={() => void toggleCoverage(j)}>{openJob === j.ifc_ready_job_id ? t("收合", "Collapse") : "coverage"}</Btn>
                      : <span className="ec-note">{t("尚未派工", "Not dispatched yet")}</span>}</td>
                    <td>
                      {j.status === "queued_for_conversion" && (
                        <Btn
                          data-testid={`conv-prioritize-${j.ifc_ready_job_id}`}
                          disabled={j.queue_position == null || j.queue_position <= 1}
                          title={
                            j.queue_position == null ? t("佇列位置未知，暫不可插隊", "Queue position unknown; cannot prioritize for now")
                            : j.queue_position === 0 ? t("正在派工中（in-flight），不可插隊", "Currently dispatching (in-flight); cannot prioritize")
                            : j.queue_position <= 1 ? t("已在隊首（position 1），無需插隊", "Already at the head of the queue (position 1); no need to prioritize")
                            : undefined
                          }
                          onClick={() => { setTriggerErr(null); setPendingTriggerKey(null); setActionErr(null); setPendingAction({ jobId: j.ifc_ready_job_id, kind: "prioritize" }); }}
                        >{t("插隊", "Prioritize")}</Btn>
                      )}
                      {(j.status === "dispatch_failed" || j.status === "dropped_on_restart") && (
                        <Btn
                          data-testid={`conv-retry-${j.ifc_ready_job_id}`}
                          onClick={() => { setTriggerErr(null); setPendingTriggerKey(null); setActionErr(null); setPendingAction({ jobId: j.ifc_ready_job_id, kind: "retry" }); }}
                        >{t("重試", "Retry")}</Btn>
                      )}
                    </td>
                    {/* (c) 檔案 →：有 object_key → 定位左欄檔案樹；無 → 非 MinIO 來源中性文案（spec §10）。 */}
                    <td>
                      {objectKey ? (
                        <Btn
                          data-testid={`md-queue-locate-${j.idempotency_key}`}
                          caption={t("在左欄檔案樹定位此來源", "Locate this source in the left file tree")}
                          onClick={() => onLocateObject(objectKey)}
                        >{t("檔案 →", "File →")}</Btn>
                      ) : (
                        <span className="ec-note">{t("非 MinIO 來源", "non-MinIO source")}</span>
                      )}
                    </td>
                  </tr>
                  {openJob === j.ifc_ready_job_id && (
                    <tr><td colSpan={14}>
                      <div data-testid={`conv-coverage-${j.ifc_ready_job_id}`}>
                        <CoverageDrawer state={cov[j.ifc_ready_job_id]} />
                      </div>
                    </td></tr>
                  )}
                </Fragment>
                );
              })}</tbody>
            </table>
            {/* (e) 表尾：>20 筆時誠實揭露只顯前 20（spec §3.2B）。 */}
            {jobs.length > 20 && (
              <p className="ec-note" data-testid="md-queue-overflow">
                {t(`顯示前 20／回傳 ${jobs.length} 筆`, `Showing first 20 / ${jobs.length} returned`)}
              </p>
            )}
          </div>
        ) : <p className="ec-note">{t("尚未取得 ifc-ready job；可由真實 IFC 進件頁註冊 fixture 後再回來看排程。", "No ifc-ready jobs retrieved yet; register a fixture from the real IFC intake page and come back to view the schedule.")}</p>}
      </Panel>
      {/* 4. 轉檔歷史（GET /api/dev/conversions pass-through，spec §3.2C 折疊區塊）。 */}
      <details data-testid="md-history-details">
        <summary>{t("轉檔歷史（conversion service pass-through）", "Conversion history (conversion-service pass-through)")} · GET /api/dev/conversions</summary>
        <div data-testid="conv-history-panel">
          {historyErr ? (
            <p className="ec-note">{t("未取得（GET /api/dev/conversions 無法讀取或此環境未啟用）", "not available (GET /api/dev/conversions is unavailable or disabled in this environment)")}</p>
          ) : history == null ? (
            <p className="ec-note">{t("載入中…", "Loading…")}</p>
          ) : history.length === 0 ? (
            <p className="ec-note">{t("目前無轉檔歷史紀錄（非錯誤）。", "No conversion history at the moment (not an error).")}</p>
          ) : (
            <table className="ec-table">
              <thead><tr><th>conversion_job_id</th><th>status</th><th>source_ifc_filename</th></tr></thead>
              <tbody>
                {history.slice(0, 50).map((h, i) => (
                  <tr key={h.conversion_job_id ?? `h-${i}`} data-testid={`conv-history-row-${h.conversion_job_id ?? i}`}>
                    <td>{h.conversion_job_id ?? "—"}</td>
                    <td>{h.status ?? "—"}</td>
                    <td>{h.source_ifc_filename ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>
      {/* 5a. watch-toggle / prioritize / retry dialog（搬自 CV，由 useConversionActions 驅動）。 */}
      <IntentDialog
        open={pendingAction != null}
        title={
          pendingAction?.kind === "watch-toggle"
            ? (pendingAction.enabled ? t("開啟 MinIO 自動偵測", "Enable MinIO auto-detection") : t("關閉 MinIO 自動偵測", "Disable MinIO auto-detection"))
            : pendingAction?.kind === "prioritize" ? t("插隊到佇列最前", "Move to the front of the queue") : t("重新派工此 job", "Re-dispatch this job")
        }
        cost={
          pendingAction?.kind === "watch-toggle"
            ? (pendingAction.enabled
                ? t("恢復輪詢 MinIO；偵測到新 model.ifc 會自動進件並派工。", "Resume polling MinIO; when a new model.ifc is detected it will be intaken and dispatched automatically.")
                : t("停止輪詢 MinIO；新上傳的 model.ifc 將不再自動進件，需手動觸發。", "Stop polling MinIO; newly uploaded model.ifc will no longer be intaken automatically and must be triggered manually."))
            : pendingAction?.kind === "prioritize"
                ? t("此 job 將排到佇列最前、較早派工；其他排隊中 job 順位後移。", "This job will move to the front of the queue and be dispatched sooner; other queued jobs shift back.")
                : t("將重新派工此 job 至轉檔 authority；可能再次失敗。", "This job will be re-dispatched to the conversion authority; it may fail again.")
        }
        busy={actionBusy}
        actionErr={actionErr}
        onConfirm={runAction}
        onCancel={() => { if (!actionBusy) { setActionErr(null); setPendingAction(null); } }}
      />
      {/* 5b. ledger trigger dialog（搬自 CV，走 POST /api/conversion/trigger；與上方 dialog 互斥開啟）。
          opener（觸發鈕）移入單檔詳情（Task 5）／佇列表；本元件保留 dialog＋confirmTrigger 供共用 hook 驅動。 */}
      <IntentDialog
        open={pendingTriggerKey != null && pendingAction == null}
        title={t("確認觸發轉檔", "Confirm trigger conversion")}
        cost={t("對此 model.ifc 送出新的轉檔 attempt（POST /api/conversion/trigger，force_retrigger=true；用於終局 failed recovery）：", "Submit a new conversion attempt for this model.ifc (POST /api/conversion/trigger, force_retrigger=true; for terminal failed recovery): ") + (pendingTriggerKey ?? "")}
        busy={triggerBusy}
        actionErr={triggerErr}
        onConfirm={(reason) => void confirmTrigger(reason)}
        onCancel={() => { if (!triggerBusy) { setTriggerErr(null); setPendingTriggerKey(null); } }}
      />
    </>
  );
}
