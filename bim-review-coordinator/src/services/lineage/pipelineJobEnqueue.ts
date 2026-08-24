// bim-review-coordinator/src/services/lineage/pipelineJobEnqueue.ts
//
// Governed READY bundle → stable pipeline job 的 **idempotent auto-enqueue**（task 3.2）。
//
// 這一層刻意很薄：冪等性住在 `PipelineJobStore.ensureJobForSourceBundle`
// （決定性 `pipeline_job_id` ＋ 單一寫入點），本檔只負責
//   1. 守住「只有 READY 可以持有 job」（L1 `bundleValidationResult` 的 allOf）；
//   2. 決定這一次觀測要記成哪一種 ready event；
//   3. 把 job id 回填 `SourceBundleStore`（read model 用）。
//
// **3.2 邊界（D-9）**：enqueue 只把 job 留在 `PENDING_ADMISSION`。
// 這裡**不**建立 `admission_record`（task 5.1）、**不**配置 `attempt_id`（task 4.1）、
// **不**動 `active_result_id`（task 3.3）。沒有那三個上游支撐的 evidence 一律不捏造。
//
// 為什麼 enqueue 不是「派工」：governed 的容量等待表達為
// `conversion-runtime-admission` 的 `WAITING_CAPACITY`，MUST NOT 借用 legacy 的
// in-memory FIFO（`local-coordinator-ifc-ready-intake-boundary` 的 governed 邊界段）。
// 本檔因此完全不碰 `ConversionDispatchQueue`／`IfcReadyConversionPipeline`。
import crypto from "node:crypto";
import type { StructLogger } from "../../lib/structLog.js";
import type { SourceBundleRecord, SourceBundleStore } from "./sourceBundleStore.js";
import {
  RESTART_EVENT_KINDS,
  type PipelineJobRecord,
  type PipelineJobStore,
  type ReadyEventKind,
} from "./pipelineJobStore.js";

const LOG_COMPONENT = "pipeline-job-enqueue";

/** 非 READY 的 bundle 不得取得 pipeline job（fail-closed，不靜默略過）。 */
export class PipelineJobEnqueueRefusedError extends Error {
  readonly code = "pipeline_job_enqueue_refused";

  constructor(
    readonly sourceBundleId: string,
    readonly bundleState: string,
  ) {
    super(
      `source bundle ${sourceBundleId} is ${bundleState}; only a READY bundle may hold an enqueued pipeline job`,
    );
    this.name = "PipelineJobEnqueueRefusedError";
  }
}

export interface AutoEnqueueDeps {
  jobs: PipelineJobStore;
  bundles: SourceBundleStore;
  /** service 內不取時鐘（沿用 `ConversionLedger` 慣例）。 */
  now: () => string;
  /** service 內不取亂數（同上）。 */
  newEventId: () => string;
  structLog?: StructLogger;
}

export interface AutoEnqueueOptions {
  /**
   * 覆寫這一次觀測的事件種類。省略＝首見記 `source_bundle_ready`、既存記 `ready_replay`。
   * `streaming_restart` 由 task 4.1 的 streaming 側呼叫端傳入。
   */
  eventKind?: ReadyEventKind;
  /** 覆寫事件 id（route 可傳 correlation／idempotency 派生值，讓 HTTP 重送不長 ledger）。 */
  eventId?: string;
}

export interface AutoEnqueueResult {
  pipeline_job_id: string;
  /** 這一次是否建立了 logical job。replay／restart／reconcile 撿漏一律 false。 */
  created: boolean;
  job: PipelineJobRecord;
}

/** ready-event id 產生器（呼叫端注入 store 之外的亂數來源）。 */
export function newReadyEventId(): string {
  return `ready-evt-${crypto.randomUUID()}`;
}

/**
 * 冪等 auto-enqueue：同一個 `source_bundle_id` 永遠回同一個 `pipeline_job_id`。
 *
 * replay（同 digest 再 claim）走的是與首見**完全相同**的呼叫，差別只在
 * `ensureJobForSourceBundle` 觀察到 job 已存在 → `created:false` ＋ append 一筆
 * `ready_replay`。因此「不建第二個 logical job」不依賴呼叫端先查再寫的自律。
 */
export function autoEnqueueGovernedBundle(
  record: SourceBundleRecord,
  deps: AutoEnqueueDeps,
  options: AutoEnqueueOptions = {},
): AutoEnqueueResult {
  if (record.bundle_state !== "READY") {
    throw new PipelineJobEnqueueRefusedError(record.source_bundle_id, record.bundle_state);
  }

  const existing = deps.jobs.getBySourceBundle(record.source_bundle_id);
  // 事件種類：呼叫端指定優先；否則首見＝ready、既存＝replay。restart 種類即使
  // 在首見情境也不會宣稱建立 logical job（守門在 store 內，不在此處）。
  const eventKind: ReadyEventKind =
    options.eventKind ?? (existing === null ? "source_bundle_ready" : "ready_replay");
  const now = deps.now();

  const ensured = deps.jobs.ensureJobForSourceBundle({
    sourceBundleId: record.source_bundle_id,
    externalModelVersionId: record.external_model_version_id,
    tenantId: record.tenant_id,
    projectId: record.project_id,
    eventId: options.eventId ?? deps.newEventId(),
    eventKind,
    now,
  });

  // read model 回填：`SourceBundleRecord.pipeline_job_id` 是 3.1 就預留好的欄位。
  // 已綁同一個 id 時仍呼叫一次是無害的（bindPipelineJob 冪等），但避免無謂寫檔。
  if (record.pipeline_job_id !== ensured.job.pipeline_job_id) {
    deps.bundles.bindPipelineJob(record.source_bundle_id, ensured.job.pipeline_job_id, now);
  }

  deps.structLog?.info(LOG_COMPONENT, "governed bundle auto-enqueued", {
    source_bundle_id: record.source_bundle_id,
    pipeline_job_id: ensured.job.pipeline_job_id,
    created_new_logical_job: ensured.created,
    event_kind: eventKind,
    job_state: ensured.job.job_state,
    // restart 種類永遠不建 logical job——把它一併記進 log，讓「restart 沒有偷偷建第二個」
    // 在 runtime 觀測面也留得下證據，而不只在 ledger 裡。
    restart_event: RESTART_EVENT_KINDS.has(eventKind),
  });

  return {
    pipeline_job_id: ensured.job.pipeline_job_id,
    created: ensured.created,
    job: ensured.job,
  };
}
