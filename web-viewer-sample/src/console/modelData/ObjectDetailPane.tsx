// web-viewer-sample/src/console/modelData/ObjectDetailPane.tsx
// MD 三頁合一 Task 5：右欄「已選檔」單檔詳情視圖（spec §3.3）。純呈現＋本地 coverage state＋動作經
// useConversionActions（不重寫 action 邏輯）。資料一律由 props.data（useConversionData）進來，本元件不自抓。
// 三源串接（spec §3.3）：以 idempotency_key 為主鍵串 records（ledger 真值）與 jobs（易失 ifc-ready）；
// conversion_job_id 僅輔助（queued/detected 階段為 null，故不可當串接主鍵）。
// 由上而下：頂列（返回/回資料夾）→ 來源資訊 → 生命週期 → 狀態區 → 動作區 → coverage/品質 → 跳轉區
// ＋ 兩個 IntentDialog（prioritize/retry ＋ ledger trigger，比照 GlobalConversionPane 契約，共用 hook）。
import { useCallback, useState } from "react";
import { t } from "../i18n";
import { Btn, Field, Panel } from "../components";
import { coordinatorClient, type ConversionQualityMetricsResponse, type IfcReadyListItem, type MinioObject } from "../coordinatorClient";
import { CoverageDrawer, LifecycleStrip, ledgerChipStatus, MINIO_CHIP_LABEL } from "./conversionShared";
import { buildHandoff } from "../handoff";
import { IntentDialog } from "../IntentDialog";
import type { ConversionData } from "./useConversionData";
import { useConversionActions } from "./useConversionActions";

// 生命週期 5 步（偵測 → 佇列 → 轉檔 → USDC → 審查）statuses 由 ledger record.status 導出（spec §3.3）。
// detected→step1 current；queued→1 done 2 current；converting→1-2 done 3 current；
// ready→1-4 done、review_session_id 有值時 5 done（否則 future）；failed→1-2 done 3 current（配紅色 chip 說明）；
// record 為 null（無 ledger 紀錄）→ 全 future（尚未偵測/未進 ledger）。
function lifecycleStatuses(
  status: string | null | undefined,
  reviewSessionId: string | null | undefined,
): ("done" | "current" | "future")[] {
  switch (status) {
    case "detected": return ["current", "future", "future", "future", "future"];
    case "queued": return ["done", "current", "future", "future", "future"];
    case "converting": return ["done", "done", "current", "future", "future"];
    case "ready": return ["done", "done", "done", "done", reviewSessionId ? "done" : "future"];
    case "failed": return ["done", "done", "current", "future", "future"];
    default: return ["future", "future", "future", "future", "future"];
  }
}

type LedgerCoverageReport = {
  coverage_ratio?: number;
  coverage_status?: string;
  mapped_count?: number;
  unmapped_count?: number;
  materialization_strategy?: string;
};

function ledgerCoverageReport(value: unknown): LedgerCoverageReport | null {
  return value && typeof value === "object" ? value as LedgerCoverageReport : null;
}

function ledgerCoverageText(value: unknown): JSX.Element {
  const cr = ledgerCoverageReport(value);
  if (!cr || typeof cr.coverage_ratio !== "number") {
    return <span data-testid="md-ledger-coverage">{t("未取得", "not observed")}</span>;
  }
  const percent = cr.coverage_ratio * 100;
  const roundedPercent = Math.round(percent * 100) / 100;
  const honestPercent = cr.coverage_ratio < 1 && roundedPercent >= 100
    ? Math.floor(percent * 100) / 100
    : roundedPercent;
  const pct = `${honestPercent}%`;
  const selfRef =
    cr.materialization_strategy === "usd_stage_enumeration"
      ? t("（USD stage 枚舉自我參照，非 IFC 全量 lossless 覆蓋率）", "(USD stage enumeration self-reference, not lossless IFC-wide coverage)")
      : "";
  return (
    <span data-testid="md-ledger-coverage">
      {pct}
      {cr.coverage_status ? ` · ${cr.coverage_status}` : ""}
      {` · mapped ${cr.mapped_count ?? t("未取得", "not observed")} / unmapped ${cr.unmapped_count ?? t("未取得", "not observed")}`}
      {selfRef ? ` · ${selfRef}` : ""}
    </span>
  );
}

export function ObjectDetailPane(props: {
  object: MinioObject;                 // 已選中的 source IFC
  data: ConversionData;
  onBack(): void;                      // 返回總覽
  onGoToFolder(prefix: string): void;  // 「回到檔案所在資料夾」（spec §3.1 定向捷徑）
}): JSX.Element {
  const { object, data, onBack, onGoToFolder } = props;
  const actions = useConversionActions(data.load, data.loadRecords);
  const {
    pendingAction, setPendingAction, actionBusy, actionErr, setActionErr, runAction,
    pendingTriggerKey, setPendingTriggerKey, triggerBusy, triggerErr, setTriggerErr, confirmTrigger,
  } = actions;

  // 三源串接（spec §3.3 串接邏輯 verbatim）：主鍵 idempotency_key；conversion_job_id 僅輔助。
  const record = data.records.find((r) => r.idempotency_key === object.idempotency_key) ?? null;
  const job =
    data.jobs.find((j) => j.idempotency_key === object.idempotency_key) ??
    (record?.conversion_job_id ? data.jobs.find((j) => j.conversion_job_id === record.conversion_job_id) : undefined) ??
    null;
  const chip = ledgerChipStatus(object.idempotency_key, data.records, data.recordsIncomplete);

  // 失敗原因：job 存在讀 failure_reason/dispatch_error；ledger failed 但 job 已回收（!job）誠實顯「未取得」。
  const failureText =
    record?.status === "failed" && !job
      ? t("未取得（job 已回收）", "not available (job recycled)")
      : (job?.failure_reason ?? job?.dispatch_error ?? null);
  const showFailure = record?.status === "failed" || failureText != null;

  // coverage 展開本地狀態（純呈現、非 action：搬自 CV toggleCoverage 原文，含去重／載入鎖／錯誤可重試）。
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [cov, setCov] = useState<Record<string, ConversionQualityMetricsResponse | { error: string } | "loading">>({});
  const toggleCoverage = useCallback(async (j: IfcReadyListItem) => {
    if (!j.conversion_job_id) return;
    const id = j.ifc_ready_job_id;
    if (openJob === id) { setOpenJob(null); return; } // 已展開 → 收合（不重打）
    setOpenJob(id);
    const cached = cov[id];
    if (cached === "loading") return;                  // 載入中 → 不重打
    if (cached && !("error" in cached)) return;        // 已成功 → 重用快取
    setCov((p) => ({ ...p, [id]: "loading" }));
    try {
      const r = await coordinatorClient.conversionQualityMetrics(j.conversion_job_id);
      setCov((p) => ({ ...p, [id]: r }));
    } catch (e) {
      setCov((p) => ({ ...p, [id]: { error: `${t("未取得 coverage：", "Coverage not available: ")}${String(e)}` } }));
    }
  }, [openJob, cov]);

  // 「回到檔案所在資料夾」前綴：object.key 去掉檔名段（spec §3.1 定向捷徑）。
  const folderPrefix = object.key.slice(0, object.key.lastIndexOf("/") + 1);

  return (
    <>
      {/* 頂列：返回總覽 ＋ 回到檔案所在資料夾（spec §3.1 定向捷徑） */}
      <div className="ec-row" data-testid="md-detail-topbar" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <Btn data-testid="md-detail-back" caption={t("返回全域轉檔總覽", "back to global conversion overview")} onClick={onBack}>{t("← 返回總覽", "← Back")}</Btn>
        <Btn data-testid="md-detail-gotofolder" caption={t("在左欄檔案樹定位此檔所在資料夾", "locate this file's folder in the left tree")} onClick={() => onGoToFolder(folderPrefix)}>{t("回到檔案所在資料夾", "Go to folder")}</Btn>
      </div>

      {/* 來源資訊：object key（mono）＋三段語意 badge（project/category/version）＋ ledger 偵測時間 */}
      <Panel title={t("來源檔案", "Source file")} sub={t("已選中的 source IFC（左欄檔案樹選檔）", "Selected source IFC (chosen from the left file tree)")} prov="asbuilt">
        <div data-testid="md-detail-key" style={{ fontFamily: "var(--font-mono)", fontSize: 12, wordBreak: "break-all" }}>{object.key}</div>
        <div className="ec-row" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
          {object.project_display_name ? <span data-testid="md-detail-badge-project" className="ec-prov">{object.project_display_name}</span> : null}
          {object.category ? <span data-testid="md-detail-badge-category" className="ec-prov">{object.category}</span> : null}
          {object.version ? <span data-testid="md-detail-badge-version" className="ec-prov">{object.version}</span> : null}
        </div>
        <Field k={t("偵測時間（ledger）", "detected at (ledger)")} v={record?.detected_at ?? t("未取得（無 ledger 紀錄）", "not available (no ledger record)")} prov="artifact" />
      </Panel>

      {/* 生命週期 ＋ 狀態區（spec §3.3） */}
      <Panel title={t("轉檔生命週期與狀態", "Conversion lifecycle & status")} sub={t("ledger 為狀態真相來源；ifc-ready job 為易失輔助", "ledger is the source of truth; the ifc-ready job is a volatile auxiliary")} prov="asbuilt">
        <LifecycleStrip
          steps={[t("偵測", "Detect"), t("佇列", "Queue"), t("轉檔", "Convert"), "USDC", t("審查", "Review")]}
          statuses={lifecycleStatuses(record?.status, job?.review_session_id)}
        />
        <Field
          k={t("狀態 chip", "status chip")}
          v={<span data-testid="md-detail-chip" className="ec-prov">{MINIO_CHIP_LABEL[chip] ?? chip}</span>}
          prov="artifact"
        />
        <Field
          k="conversion_job_id"
          v={<span data-testid="md-detail-job-id">{record?.conversion_job_id ?? "—"}</span>}
          prov="artifact"
        />
        <Field
          k="usdc_key"
          v={record?.usdc_key
            ? <span data-testid="md-detail-usdc" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{record.usdc_key}</span>
            : <span data-testid="md-detail-usdc" className="ec-prov ec-p1">{t("待產生", "pending")}</span>}
          prov="artifact"
        />
        <Field
          k={t("coverage（ledger 回填）", "coverage (ledger backfill)")}
          v={ledgerCoverageText(record?.coverage_report)}
          prov="artifact"
        />
        {showFailure && (
          <Field
            k={t("失敗原因", "failure reason")}
            v={<span data-testid="md-detail-failure" className="ec-warn-note">{failureText ?? t("未取得", "not available")}</span>}
            prov="p1"
          />
        )}
        {/* 同檔多次轉檔：ledger 只留最新一次；歷史嘗試見總覽的轉檔歷史（spec §3.3）。 */}
        <p className="ec-note" data-testid="md-detail-latest-note">
          {t("顯示最新一次嘗試；歷史嘗試見總覽的轉檔歷史。", "Showing the latest attempt; see the conversion history in the overview for previous attempts.")}
        </p>
      </Panel>

      {/* 動作區：觸發轉檔（chip gating）＋依 job.status 掛插隊/重試（動作走 useConversionActions） */}
      <Panel title={t("轉檔動作", "Conversion actions")} sub={t("intent→confirm→audited；ledger 真值對齊（非樂觀）", "intent→confirm→audited; aligned to ledger truth (not optimistic)")} prov="asbuilt">
        <div className="ec-row" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {/* 觸發轉檔：chip ∈ {untracked, failed, indeterminate} 才 enabled（ready/queued/converting 無需再觸發）。 */}
          <Btn
            data-testid="md-detail-trigger"
            caption="POST /api/conversion/trigger"
            disabled={!["untracked", "failed", "indeterminate"].includes(chip)}
            title={
              ["untracked", "failed", "indeterminate"].includes(chip)
                ? undefined
                : t("此狀態無需再觸發（已在佇列／轉檔中／已完成）", "No re-trigger needed in this state (queued / converting / done)")
            }
            onClick={() => { setActionErr(null); setPendingAction(null); setTriggerErr(null); setPendingTriggerKey(object.key); }}
          >{t("觸發轉檔", "Trigger")}</Btn>
          {/* 插隊：queued_for_conversion 且 queue_position>=2（gating 條件比照 Task 4 GlobalConversionPane）。 */}
          {job && job.status === "queued_for_conversion" && (
            <Btn
              data-testid="md-detail-prioritize"
              disabled={job.queue_position == null || job.queue_position <= 1}
              title={
                job.queue_position == null ? t("佇列位置未知，暫不可插隊", "Queue position unknown; cannot prioritize for now")
                : job.queue_position === 0 ? t("正在派工中（in-flight），不可插隊", "Currently dispatching (in-flight); cannot prioritize")
                : job.queue_position <= 1 ? t("已在隊首（position 1），無需插隊", "Already at the head of the queue (position 1); no need to prioritize")
                : undefined
              }
              onClick={() => { setTriggerErr(null); setPendingTriggerKey(null); setActionErr(null); setPendingAction({ jobId: job.ifc_ready_job_id, kind: "prioritize" }); }}
            >{t("插隊", "Prioritize")}</Btn>
          )}
          {/* 重試：dispatch_failed / dropped_on_restart（gating 條件比照 Task 4 GlobalConversionPane）。 */}
          {job && (job.status === "dispatch_failed" || job.status === "dropped_on_restart") && (
            <Btn
              data-testid="md-detail-retry"
              onClick={() => { setTriggerErr(null); setPendingTriggerKey(null); setActionErr(null); setPendingAction({ jobId: job.ifc_ready_job_id, kind: "retry" }); }}
            >{t("重試", "Retry")}</Btn>
          )}
        </div>
      </Panel>

      {/* coverage / 品質區：job 有 conversion_job_id → coverage 展開＋CoverageDrawer ＋ IN 品質誠實三行 */}
      {job?.conversion_job_id && (
        <Panel title={t("轉檔品質 · coverage", "Conversion quality · coverage")} sub={t("coordinator 不計算，只轉發 conversion authority 值；無遙測欄位標未取得", "coordinator does not compute, only forwards conversion authority values; fields without telemetry are marked not available")} prov="artifact">
          <Btn
            data-testid="md-detail-coverage-toggle"
            onClick={() => void toggleCoverage(job)}
          >{openJob === job.ifc_ready_job_id ? t("收合", "Collapse") : "coverage"}</Btn>
          {openJob === job.ifc_ready_job_id && (
            <div data-testid="md-detail-coverage">
              <CoverageDrawer state={cov[job.ifc_ready_job_id]} />
            </div>
          )}
          {/* IN 品質誠實文案精簡三行（自 pages.tsx IntakePage 誠實標示 Panel 取三行；誠實鐵律不承諾精準 GUID）。 */}
          <Field k="quality_metrics_summary" v={t("coverage_status / unmapped_count / coverage_ratio（pass-through artifact，隨 conversion result 提供）", "coverage_status / unmapped_count / coverage_ratio (pass-through artifact, provided with the conversion result)")} prov="artifact" />
          <Field k={t("精準 GUID 對映", "exact GUID mapping")} v={t("MVP 不承諾精準 GUID；需 streaming adapter force IfcOpenShell USD 模式（PoC），允許人工校正", "MVP does not promise exact GUIDs; requires the streaming adapter to force IfcOpenShell USD mode (PoC), with manual correction allowed")} prov="demo" />
          <Field k={t("conversion 秒數 / GPU", "conversion seconds / GPU")} v={t("未取得（無統一遙測來源）", "not available (no unified telemetry source)")} prov="demo" />
        </Panel>
      )}

      {/* 跳轉區：SS / Review（有 review_session_id 才顯）＋ A1 檢核（恆顯，帶 minio_key）；source 一律 "minio"。 */}
      <Panel title={t("跨頁跳轉", "Cross-page handoff")} sub={t("攜帶非機密關聯 ID；接收頁須各自重驗（spec §4.2）", "Carries non-secret correlation IDs; the receiving page re-verifies each (spec §4.2)")} prov="asbuilt">
        <div className="ec-row" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {job?.review_session_id ? (
            <>
              <Btn
                data-testid="md-detail-ss"
                caption={t("在 Session 管理檢視", "View in Session Management")}
                onClick={() => { window.location.hash = buildHandoff("sessions", { source: "minio", session: job.review_session_id as string }); }}
              >SS →</Btn>
              <Btn
                data-testid="md-detail-review"
                caption={t("在 Review Room 開此 session", "Open this session in Review Room")}
                onClick={() => { window.location.hash = buildHandoff("review", { source: "minio", session: job.review_session_id as string }); }}
              >Review →</Btn>
            </>
          ) : null}
          {/* IA v2：#a1 已讓位給 unified workspace（fixture 語意）；真 A1 工作台在 #a1-workbench，
              target 改指之（接收端 useIncomingHandoff("a1") 以 startsWith("#a1") 判定，兩形皆命中）。 */}
          <Btn
            data-testid="md-detail-a1"
            caption={t("到 A1 檢核（帶此 minio_key）", "Go to A1 governance (carries this minio_key)")}
            onClick={() => { window.location.hash = buildHandoff("a1-workbench", { source: "minio", minio_key: object.key }); }}
          >{t("A1 檢核 →", "A1 governance →")}</Btn>
        </div>
      </Panel>

      {/* prioritize / retry dialog（搬自 CV，由 useConversionActions 驅動；本 pane 不設 watch-toggle）。 */}
      <IntentDialog
        open={pendingAction != null}
        title={pendingAction?.kind === "prioritize" ? t("插隊到佇列最前", "Move to the front of the queue") : t("重新派工此 job", "Re-dispatch this job")}
        cost={
          pendingAction?.kind === "prioritize"
            ? t("此 job 將排到佇列最前、較早派工；其他排隊中 job 順位後移。", "This job will move to the front of the queue and be dispatched sooner; other queued jobs shift back.")
            : t("將重新派工此 job 至轉檔 authority；可能再次失敗。", "This job will be re-dispatched to the conversion authority; it may fail again.")
        }
        busy={actionBusy}
        actionErr={actionErr}
        onConfirm={runAction}
        onCancel={() => { if (!actionBusy) { setActionErr(null); setPendingAction(null); } }}
      />
      {/* ledger trigger dialog（走 POST /api/conversion/trigger；與上方 dialog 互斥開啟；共用 confirmTrigger hook）。 */}
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
