// bim-review-coordinator/src/services/lineage/pipelineJobStore.ts
//
// Durable **stable** pipeline-job store（task 3.2 的核心）。
//
// 契約正本：`tests/contracts/pipeline_job_attempt.json` 的 `$defs/pipelineJob`
// （envelope `{schema_version:"pipeline-job-attempt/v1", document_type:"pipeline_job", body}`）。
// Spec：`specs/conversion-attempt-publication/spec.md`「Pipeline job SHALL 保持穩定」
// ＋ `specs/local-coordinator-ifc-ready-intake-boundary/spec.md`
// 「governed job 在 coordinator restart 後可恢復」。
//
// 三條 runtime 不變式（L1 `semantic_validators.validate_job_scenario` 的 job 半邊）：
//   1. `restart_created_second_logical_job` —— `streaming_restart`／`coordinator_restart`
//      事件在**任何** ledger 位置都不得 `created_new_logical_job=true`。
//   2. `duplicate_logical_job_for_source_bundle` —— 其餘 kind 只有 ledger **第一筆**
//      可以建立 logical job。
//   3. `semantic_invalid_source_retried_same_job` —— 進入 terminal
//      `manual_correction_required` 後不得再有 in-flight attempt 或 `retry` entry。
//
// 持久化 pattern **逐字沿用** `services/conversionLedger.ts:63-92`（也就是
// `sourceBundleStore.ts` 用的同一份）：單一 JSON ＋ 自有 `schema_version` ＋
// `.tmp` 寫入後 `renameSync` ＋ 壞檔不 crash ＋ `now` 由呼叫端傳入（service 內不取時鐘、
// 不取亂數）。刻意**不**抽共用基底類別：抽出來會反過來改到 `ConversionLedger`
// （GitNexus upstream impact MEDIUM／14），把本 store 的 blast radius 從 0 拉高。
//
// **不重用 `ConversionLedger`** 的理由（藍圖 C-4）：`mw_<hash16>` 與 `source_bundle_id`
// 是兩個 MUST NOT 互相取代／抑制／推導的去重空間（design.md §11.2 規則 3），且
// governed 的三正交軸 MUST NOT 被壓縮成 legacy 的 `conversion_lifecycle_status`。
//
// **3.2 邊界**：本檔只到 `PENDING_ADMISSION`。`admission_record` 文件屬 task 5.1、
// attempt 配置屬 4.1（streaming 側）、`active_result_id` 屬 3.3——本檔一律留 null／0，
// 不偽造沒有上游支撐的 evidence。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { StructLogger } from "../../lib/structLog.js";

/** 本地持久檔的 schema 版本（**不是** L1 envelope 的 `schema_version`）。 */
const STORE_SCHEMA_VERSION = "pipeline-job/v1";

/** L1 envelope 的 `schema_version` const。 */
export const PIPELINE_JOB_DOCUMENT_SCHEMA_VERSION = "pipeline-job-attempt/v1";

/** L1 `$defs/pipelineJob.properties.owner` 的 const。 */
export const PIPELINE_JOB_OWNER = "bim-review-coordinator";

/** L1 `$defs/pipelineJob.properties.job_state` 的 enum（拼寫逐字：只有這一個是小寫）。 */
export type JobState =
  | "PENDING_ADMISSION"
  | "WAITING_CAPACITY"
  | "RUNNING"
  | "manual_correction_required"
  | "TERMINAL";

/** L1 `$defs/readyEventLedgerEntry.properties.event_kind` 的 enum。 */
export type ReadyEventKind =
  | "source_bundle_ready"
  | "ready_replay"
  | "streaming_restart"
  | "coordinator_restart"
  | "retry";

/** 不得宣稱建立 logical job 的事件種類（不變式 1）。 */
export const RESTART_EVENT_KINDS: ReadonlySet<ReadyEventKind> = new Set<ReadyEventKind>([
  "streaming_restart",
  "coordinator_restart",
]);

export interface ReadyEventLedgerEntry {
  event_id: string;
  event_kind: ReadyEventKind;
  received_at: string;
  created_new_logical_job: boolean;
}

export interface ManualCorrectionBlocker {
  blocker_code: string;
  detail: string;
  /** L1 const：修正 semantic-invalid source SHALL 開新 bundle／新 job。 */
  requires_new_source_bundle: true;
}

/** 逐欄對齊 L1 `$defs/pipelineJob` 的 body（`additionalProperties:false`）。 */
export interface PipelineJobRecord {
  owner: typeof PIPELINE_JOB_OWNER;
  pipeline_job_id: string;
  source_bundle_id: string;
  external_model_version_id: string;
  /** L1 為 optional；未知時**不宣告此鍵**（`additionalProperties:false` ＋ 誠實優先）。 */
  tenant_id?: string;
  project_id?: string;
  job_state: JobState;
  attempt_count: number;
  in_flight_attempt_id: string | null;
  active_result_id: string | null;
  manual_correction_blocker: ManualCorrectionBlocker | null;
  ready_event_ledger: ReadyEventLedgerEntry[];
  created_at: string;
  updated_at: string;
}

/** L1 envelope。 */
export interface PipelineJobDocument {
  schema_version: typeof PIPELINE_JOB_DOCUMENT_SCHEMA_VERSION;
  document_type: "pipeline_job";
  body: PipelineJobRecord;
}

/**
 * 同一個 `source_bundle_id` 被觀察到兩個不同的 `external_model_version_id`。
 *
 * READY bundle 不可變（`SourceBundleStore.admit` 已在上游擋掉異 digest 覆寫），
 * 所以走到這裡代表上游不變式被破壞。**fail-closed 拋錯**，不靜默沿用其一：
 * 靜默會讓一個 job 的 identity 與它宣稱的 source 不符，而那正是本檔要保證的事。
 */
export class PipelineJobIdentityConflictError extends Error {
  readonly code = "pipeline_job_identity_conflict";

  constructor(
    readonly pipelineJobId: string,
    readonly sourceBundleId: string,
    readonly existingExternalModelVersionId: string,
    readonly incomingExternalModelVersionId: string,
  ) {
    super(
      `pipeline job ${pipelineJobId} for source bundle ${sourceBundleId} is bound to external model version ` +
        `${existingExternalModelVersionId}; refusing to rebind it to ${incomingExternalModelVersionId}`,
    );
    this.name = "PipelineJobIdentityConflictError";
  }
}

/** 目標 job 文件會違反 L1 的 `allOf` 或語意層不變式。 */
export class PipelineJobInvariantError extends Error {
  readonly code = "pipeline_job_invariant_violation";

  constructor(detail: string) {
    super(detail);
    this.name = "PipelineJobInvariantError";
  }
}

/**
 * `pipeline_job_id` 的**決定性**推導。
 *
 * 為什麼不用隨機 UUID ＋ 持久化：本檔沿用「壞檔不 crash 當空 store 起手」的既有
 * pattern，隨機 id 在持久檔遺失／損毀後會讓**同一個 source bundle 拿到第二個
 * logical job**——正是 spec 明文禁止的事。決定性推導讓 stability 不依賴檔案存活。
 *
 * 方向性：`source_bundle_id → pipeline_job_id` 是單向 hash，反推不可行；這與
 * design.md §11.2 規則 3 禁止的「`mw_<hash16>` ↔ `source_bundle_id` 互相推導」
 * 是**不同的兩件事**（那條規則約束的是 legacy watcher 去重空間與 governed 去重空間，
 * 不是 governed 內部 bundle→job 的 1:1 命名）。
 */
export function pipelineJobIdFor(sourceBundleId: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${STORE_SCHEMA_VERSION}|${sourceBundleId}`, "utf-8")
    .digest("hex");
  return `pj_${digest.slice(0, 32)}`;
}

/**
 * `ready_event_ledger` 的長度上限。
 *
 * L1 沒有 `maxItems`，但這是一份每次寫入都整份重新序列化的 JSON：無上限的 append
 * 會被反覆 replay 的 producer 拖成 O(n²)。滿載時**只**丟棄
 * `created_new_logical_job=false` 的中段 entry，並且永不丟 index 0——語意層的兩條
 * 規則只取決於「第一筆是誰」與「有沒有 restart entry 宣稱建立 job」，丟棄非建立型的
 * 中段 entry 不可能翻轉任何一條。若找不到可丟的 entry（代表 ledger 裡有多筆宣稱
 * 建立 job 的違規 entry），一律保留全部——違規證據不得被垃圾回收掩蓋。
 */
export const READY_EVENT_LEDGER_MAX_ENTRIES = 500;

const LOG_COMPONENT = "pipeline-job-store";

function isReadyEventKind(value: unknown): value is ReadyEventKind {
  return (
    value === "source_bundle_ready" ||
    value === "ready_replay" ||
    value === "streaming_restart" ||
    value === "coordinator_restart" ||
    value === "retry"
  );
}

function isJobState(value: unknown): value is JobState {
  return (
    value === "PENDING_ADMISSION" ||
    value === "WAITING_CAPACITY" ||
    value === "RUNNING" ||
    value === "manual_correction_required" ||
    value === "TERMINAL"
  );
}

function isLedgerEntry(value: unknown): value is ReadyEventLedgerEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.event_id === "string" &&
    entry.event_id.length > 0 &&
    isReadyEventKind(entry.event_kind) &&
    typeof entry.received_at === "string" &&
    typeof entry.created_new_logical_job === "boolean"
  );
}

/**
 * 持久檔載入時的形狀守門。
 *
 * 不合形狀的列一律丟棄而不是硬塞回記憶體：一筆殘缺的 job 會在下游變成一份
 * contract-invalid 的 `pipeline_job` 文件。丟棄是安全的，因為 `pipeline_job_id`
 * 是決定性推導——同一個 bundle 的下一個 ready event 會把它以同一個 id 重建。
 */
function isPipelineJobRecord(value: unknown): value is PipelineJobRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.owner !== PIPELINE_JOB_OWNER) return false;
  if (typeof record.pipeline_job_id !== "string" || record.pipeline_job_id.length === 0) return false;
  if (typeof record.source_bundle_id !== "string" || record.source_bundle_id.length === 0) return false;
  if (
    typeof record.external_model_version_id !== "string" ||
    record.external_model_version_id.length === 0
  ) {
    return false;
  }
  if (!isJobState(record.job_state)) return false;
  if (typeof record.attempt_count !== "number" || !Number.isInteger(record.attempt_count)) return false;
  if (record.attempt_count < 0) return false;
  if (record.in_flight_attempt_id !== null && typeof record.in_flight_attempt_id !== "string") return false;
  if (record.active_result_id !== null && typeof record.active_result_id !== "string") return false;
  if (record.manual_correction_blocker !== null && typeof record.manual_correction_blocker !== "object") {
    return false;
  }
  if (!Array.isArray(record.ready_event_ledger) || record.ready_event_ledger.length === 0) return false;
  if (!record.ready_event_ledger.every(isLedgerEntry)) return false;
  if (typeof record.created_at !== "string" || typeof record.updated_at !== "string") return false;
  return true;
}

/** 只在有值時宣告 optional identity 鍵（L1 `additionalProperties:false` 下 undefined 不得成鍵）。 */
function withOptionalIdentity(
  record: PipelineJobRecord,
  tenantId: string | null | undefined,
  projectId: string | null | undefined,
): PipelineJobRecord {
  const next: PipelineJobRecord = { ...record };
  if (typeof tenantId === "string" && tenantId.length > 0) next.tenant_id = tenantId;
  if (typeof projectId === "string" && projectId.length > 0) next.project_id = projectId;
  return next;
}

export interface EnsureJobInput {
  sourceBundleId: string;
  externalModelVersionId: string;
  tenantId?: string | null;
  projectId?: string | null;
  /** 這一次 ready 觀測的事件 id（呼叫端提供；同 id 重送不重複 append）。 */
  eventId: string;
  /** 省略＝首見記 `source_bundle_ready`、既存記 `ready_replay`。 */
  eventKind?: ReadyEventKind;
  now: string;
}

export interface EnsureJobResult {
  job: PipelineJobRecord;
  /** 這一次呼叫是否**建立**了 logical job。replay／restart 一律 false。 */
  created: boolean;
}

/** `transition()` 的目標狀態（attempt 欄位由 task 4.1 的呼叫端提供）。 */
export interface JobTransition {
  job_state: JobState;
  in_flight_attempt_id?: string | null;
  manual_correction_blocker?: ManualCorrectionBlocker | null;
}

export interface PipelineJobStoreOptions {
  structLog?: StructLogger;
}

/**
 * Durable stable pipeline-job store（coordinator-local；非 control-plane authority）。
 */
export class PipelineJobStore {
  private readonly records = new Map<string, PipelineJobRecord>();
  private readonly bySourceBundle = new Map<string, string>();
  private readonly structLog?: StructLogger;

  /**
   * @param persistencePath JSON 持久化路徑；null 表示純記憶體（測試／降級）
   */
  constructor(
    private readonly persistencePath: string | null = null,
    options: PipelineJobStoreOptions = {},
  ) {
    this.structLog = options.structLog;
    this.load();
  }

  // ── 持久化（逐字沿用 conversionLedger 的形狀）────────────────────────────────

  private load(): void {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return;
    try {
      const raw = fs.readFileSync(this.persistencePath, "utf-8");
      const parsed = JSON.parse(raw) as { schema_version?: string; records?: unknown };
      if (!Array.isArray(parsed.records)) return;
      for (const item of parsed.records) {
        if (!isPipelineJobRecord(item)) continue;
        this.index(item);
      }
    } catch {
      // 壞檔不 crash，當空 store 起手。`pipeline_job_id` 是決定性推導，
      // 下一個 ready event 會以同一個 id 重建同一個 logical job。
      this.records.clear();
      this.bySourceBundle.clear();
    }
  }

  private persist(): void {
    if (!this.persistencePath) return;
    fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
    const tmpPath = `${this.persistencePath}.tmp`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify(
        { schema_version: STORE_SCHEMA_VERSION, records: [...this.records.values()] },
        null,
        2,
      ),
      "utf-8",
    );
    fs.renameSync(tmpPath, this.persistencePath);
  }

  private index(record: PipelineJobRecord): void {
    this.records.set(record.pipeline_job_id, record);
    this.bySourceBundle.set(record.source_bundle_id, record.pipeline_job_id);
  }

  // ── 讀取面 ────────────────────────────────────────────────────────────────

  get(pipelineJobId: string): PipelineJobRecord | null {
    return this.records.get(pipelineJobId) ?? null;
  }

  getBySourceBundle(sourceBundleId: string): PipelineJobRecord | null {
    const id = this.bySourceBundle.get(sourceBundleId);
    return id ? (this.records.get(id) ?? null) : null;
  }

  /** 依 `created_at` 降冪（最新在前），與 `SourceBundleStore.list()` 同慣例。 */
  list(): PipelineJobRecord[] {
    return [...this.records.values()].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  }

  // ── 冪等核心 ──────────────────────────────────────────────────────────────

  /**
   * 冪等取得／建立一個 source bundle 的 stable logical job。
   *
   * - 首見 → 建立，ledger 第一筆 `created_new_logical_job` 依事件種類決定
   *   （restart 種類恆 false，見不變式 1；正常 ready 為 true）。
   * - 既存 → **一律回同一個 job**，append 一筆 `created_new_logical_job:false` 的
   *   ledger entry（同 `event_id` 重送不重複 append），`attempt_count`／`job_state`
   *   一律不動。replay、reconciler 撿漏、streaming restart、coordinator restart
   *   走的都是這一條路徑，所以「不建第二個 logical job」不是靠呼叫端自律。
   */
  ensureJobForSourceBundle(input: EnsureJobInput): EnsureJobResult {
    const pipelineJobId = pipelineJobIdFor(input.sourceBundleId);
    const existing = this.records.get(pipelineJobId);

    if (existing) {
      if (existing.external_model_version_id !== input.externalModelVersionId) {
        throw new PipelineJobIdentityConflictError(
          pipelineJobId,
          input.sourceBundleId,
          existing.external_model_version_id,
          input.externalModelVersionId,
        );
      }
      const kind: ReadyEventKind = input.eventKind ?? "ready_replay";
      const job = this.appendReadyEventTo(existing, {
        event_id: input.eventId,
        event_kind: kind,
        received_at: input.now,
        created_new_logical_job: false,
      });
      return { job, created: false };
    }

    const kind: ReadyEventKind = input.eventKind ?? "source_bundle_ready";
    // 不變式 1 在建立點就成立：restart 種類即使是 ledger 第一筆也不得宣稱建立
    // logical job（L1 `validate_job_scenario` 對任何位置的 restart entry 都開槍）。
    const createdNewLogicalJob = !RESTART_EVENT_KINDS.has(kind);
    const base: PipelineJobRecord = {
      owner: PIPELINE_JOB_OWNER,
      pipeline_job_id: pipelineJobId,
      source_bundle_id: input.sourceBundleId,
      external_model_version_id: input.externalModelVersionId,
      job_state: "PENDING_ADMISSION",
      attempt_count: 0,
      in_flight_attempt_id: null,
      active_result_id: null,
      manual_correction_blocker: null,
      ready_event_ledger: [
        {
          event_id: input.eventId,
          event_kind: kind,
          received_at: input.now,
          created_new_logical_job: createdNewLogicalJob,
        },
      ],
      created_at: input.now,
      updated_at: input.now,
    };
    const job = withOptionalIdentity(base, input.tenantId, input.projectId);
    this.index(job);
    this.persist();
    this.structLog?.info(LOG_COMPONENT, "stable pipeline job created", {
      pipeline_job_id: job.pipeline_job_id,
      source_bundle_id: job.source_bundle_id,
      job_state: job.job_state,
      event_kind: kind,
    });
    return { job, created: true };
  }

  /**
   * Append 一筆 ready-event ledger entry（append-only；同 `event_id` 冪等）。
   *
   * fail-closed 守門：
   * - restart 種類不得 `created_new_logical_job=true`（不變式 1）；
   * - 非第一筆不得 `created_new_logical_job=true`（不變式 2）；
   * - `manual_correction_required` 的 job 不得再收 `retry`（不變式 3）。
   */
  appendReadyEvent(
    pipelineJobId: string,
    entry: ReadyEventLedgerEntry,
  ): PipelineJobRecord | null {
    const existing = this.records.get(pipelineJobId);
    if (!existing) return null;
    return this.appendReadyEventTo(existing, entry);
  }

  private appendReadyEventTo(
    existing: PipelineJobRecord,
    entry: ReadyEventLedgerEntry,
  ): PipelineJobRecord {
    if (entry.created_new_logical_job) {
      if (RESTART_EVENT_KINDS.has(entry.event_kind)) {
        throw new PipelineJobInvariantError(
          `restart event ${entry.event_kind} may never create a logical job (restart_created_second_logical_job)`,
        );
      }
      throw new PipelineJobInvariantError(
        `pipeline job ${existing.pipeline_job_id} already exists; a later ledger entry may not create a second logical job (duplicate_logical_job_for_source_bundle)`,
      );
    }
    if (entry.event_kind === "retry" && existing.job_state === "manual_correction_required") {
      throw new PipelineJobInvariantError(
        `pipeline job ${existing.pipeline_job_id} is in manual_correction_required; a retry needs a new source bundle and a new job (semantic_invalid_source_retried_same_job)`,
      );
    }
    // 同一個事件重送（HTTP retry、同一 tick 重入）不得讓 ledger 長第二筆。
    if (existing.ready_event_ledger.some((item) => item.event_id === entry.event_id)) {
      return existing;
    }
    const ledger = this.capLedger(
      [...existing.ready_event_ledger, entry],
      existing.pipeline_job_id,
    );
    const next: PipelineJobRecord = {
      ...existing,
      ready_event_ledger: ledger,
      updated_at: entry.received_at,
    };
    this.index(next);
    this.persist();
    return next;
  }

  private capLedger(ledger: ReadyEventLedgerEntry[], pipelineJobId: string): ReadyEventLedgerEntry[] {
    if (ledger.length <= READY_EVENT_LEDGER_MAX_ENTRIES) return ledger;
    const kept = [...ledger];
    let dropped = 0;
    while (kept.length > READY_EVENT_LEDGER_MAX_ENTRIES) {
      const index = kept.findIndex((entry, i) => i > 0 && !entry.created_new_logical_job);
      // 找不到可丟的 entry ＝ 除了 index 0 之外全是「宣稱建立 job」的違規 entry。
      // 那是必須被看見的證據，寧可讓 ledger 超長也不掩蓋。
      if (index < 0) break;
      kept.splice(index, 1);
      dropped += 1;
    }
    if (dropped > 0) {
      this.structLog?.warn(LOG_COMPONENT, "ready event ledger truncated", {
        pipeline_job_id: pipelineJobId,
        dropped_entries: dropped,
        max_entries: READY_EVENT_LEDGER_MAX_ENTRIES,
      });
    }
    return kept;
  }

  // ── 狀態轉移（fail-closed 守 L1 的三條 allOf）────────────────────────────────

  /**
   * 單一狀態轉移入口。違反 L1 `allOf` 的目標狀態一律拋 `PipelineJobInvariantError`，
   * 不寫入——寧可讓呼叫端紅，也不把 contract-invalid 的 job 文件寫進持久檔。
   *
   * **3.2 邊界**：本片沒有任何呼叫端會走到 `RUNNING`／`manual_correction_required`
   * ——attempt 配置屬 task 4.1、admission 屬 5.1。這裡先把不變式釘死，讓後續 slice
   * 只能以合法形狀落地；`attempt_count` 的增量同樣屬 4.1，本檔不提供 incrementer。
   */
  transition(pipelineJobId: string, next: JobTransition, now: string): PipelineJobRecord | null {
    const existing = this.records.get(pipelineJobId);
    if (!existing) return null;

    const inFlight =
      next.in_flight_attempt_id === undefined
        ? existing.in_flight_attempt_id
        : next.in_flight_attempt_id;
    const blocker =
      next.manual_correction_blocker === undefined
        ? existing.manual_correction_blocker
        : next.manual_correction_blocker;

    if (next.job_state === "WAITING_CAPACITY" && inFlight !== null) {
      throw new PipelineJobInvariantError(
        "WAITING_CAPACITY SHALL NOT allocate an attempt (in_flight_attempt_id must be null)",
      );
    }
    if (next.job_state === "RUNNING" && typeof inFlight !== "string") {
      throw new PipelineJobInvariantError(
        "a RUNNING job is executing exactly one streaming-owned attempt (in_flight_attempt_id must be a string)",
      );
    }
    if (next.job_state === "manual_correction_required" && blocker === null) {
      throw new PipelineJobInvariantError(
        "manual_correction_required SHALL carry its blocker (manual_correction_blocker must not be null)",
      );
    }
    if (
      next.job_state === "manual_correction_required" &&
      existing.ready_event_ledger.some((entry) => entry.event_kind === "retry")
    ) {
      throw new PipelineJobInvariantError(
        "a job whose ledger already contains a retry may not enter manual_correction_required (semantic_invalid_source_retried_same_job)",
      );
    }

    const updated: PipelineJobRecord = {
      ...existing,
      job_state: next.job_state,
      in_flight_attempt_id: inFlight,
      manual_correction_blocker: blocker,
      updated_at: now,
    };
    this.index(updated);
    this.persist();
    return updated;
  }

  // ── restart recovery ──────────────────────────────────────────────────────

  /**
   * coordinator 開機恢復。
   *
   * `RUNNING`／`WAITING_CAPACITY` 的 job 一律回到 `PENDING_ADMISSION` 並重新進入
   * admission，同時 append 一筆 `coordinator_restart`（`created_new_logical_job:false`）。
   *
   * 明確**不做**的三件事（`local-coordinator-ifc-ready-intake-boundary` 的 governed 段）：
   *   - MUST NOT 標 `dropped_on_restart`（那是 legacy in-memory 佇列的語意，逐字不動）；
   *   - MUST NOT 增加 `attempt_count`（restart 不燒掉一次 attempt）；
   *   - MUST NOT 要求 operator 重送 intake（durable state 自己恢復）。
   *
   * `PENDING_ADMISSION`／`TERMINAL`／`manual_correction_required` 不動也不 append：
   * 它們的狀態靠持久化本身就已恢復，每次開機都替全部 job append 一筆會把 ledger
   * 撐成與重啟次數等長的雜訊。
   *
   * @param nextEventId 事件 id 產生器（service 內不取亂數，與不取時鐘同一理由）
   */
  recoverOnStart(now: string, nextEventId: () => string): PipelineJobRecord[] {
    const recovered: PipelineJobRecord[] = [];
    for (const job of [...this.records.values()]) {
      if (job.job_state !== "RUNNING" && job.job_state !== "WAITING_CAPACITY") continue;
      const next: PipelineJobRecord = {
        ...job,
        job_state: "PENDING_ADMISSION",
        // in-flight attempt 隨 streaming 側的 process 一起消失；job 回到 admission
        // 時不得繼續宣稱持有它。attempt_count 刻意不動（那一次 attempt 已經算過）。
        in_flight_attempt_id: null,
        ready_event_ledger: [
          ...job.ready_event_ledger,
          {
            event_id: nextEventId(),
            event_kind: "coordinator_restart" as const,
            received_at: now,
            created_new_logical_job: false,
          },
        ],
        updated_at: now,
      };
      this.index(next);
      recovered.push(next);
    }
    if (recovered.length > 0) {
      this.persist();
      this.structLog?.info(LOG_COMPONENT, "governed pipeline jobs recovered after restart", {
        recovered_count: recovered.length,
        pipeline_job_ids: recovered.map((job) => job.pipeline_job_id),
      });
    }
    return recovered;
  }
}

/** 把 job 包成 L1 envelope，供 API 回應／契約對拍使用。 */
export function toPipelineJobDocument(record: PipelineJobRecord): PipelineJobDocument {
  return {
    schema_version: PIPELINE_JOB_DOCUMENT_SCHEMA_VERSION,
    document_type: "pipeline_job",
    body: record,
  };
}
