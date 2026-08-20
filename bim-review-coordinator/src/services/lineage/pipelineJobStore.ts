// bim-review-coordinator/src/services/lineage/pipelineJobStore.ts
//
// rvt-ifc-usdc-lineage task 3.2：coordinator-owned durable pipeline job。
//
// 持久化 pattern 與 `sourceBundleStore.ts` 相同（單一 JSON、schema_version、
// .tmp + renameSync、壞檔當空 store、now 由呼叫端傳入），刻意不抽共用基底。
//
// 不變量（tasks 3.2 / L1 pipelineJob）：
//   - 一個 immutable source_bundle_id 對應恰好一個 pipeline_job_id
//   - READY replay／coordinator restart／streaming restart 不得建立第二個 logical job
//   - 3.2 只建立 PENDING_ADMISSION 殼；admission／attempt／publication 由後續 tasks 推進
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SourceBundleRecord } from "./sourceBundleStore.js";

const SCHEMA_VERSION = "pipeline-job/v1";

export type PipelineJobState =
  | "PENDING_ADMISSION"
  | "WAITING_CAPACITY"
  | "RUNNING"
  | "manual_correction_required"
  | "TERMINAL";

export type ReadyEventKind =
  | "source_bundle_ready"
  | "ready_replay"
  | "streaming_restart"
  | "coordinator_restart"
  | "retry";

export interface ReadyEventLedgerEntry {
  event_id: string;
  event_kind: ReadyEventKind;
  received_at: string;
  created_new_logical_job: boolean;
}

export interface PipelineJobRecord {
  owner: "bim-review-coordinator";
  pipeline_job_id: string;
  source_bundle_id: string;
  external_model_version_id: string;
  tenant_id: string;
  project_id: string;
  job_state: PipelineJobState;
  attempt_count: number;
  in_flight_attempt_id: string | null;
  active_result_id: string | null;
  manual_correction_blocker: null;
  ready_event_ledger: ReadyEventLedgerEntry[];
  created_at: string;
  updated_at: string;
}

export interface EnsureJobResult {
  createdNew: boolean;
  job: PipelineJobRecord;
}

function pipelineJobIdFor(sourceBundleId: string): string {
  const digest = createHash("sha256").update(sourceBundleId, "utf8").digest("hex").slice(0, 16);
  return `pj_${digest}`;
}

function eventIdFor(kind: ReadyEventKind, now: string, sourceBundleId: string): string {
  const digest = createHash("sha256")
    .update(`${kind}\n${now}\n${sourceBundleId}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `ready-evt-${digest}`;
}

/** Coordinator-owned durable pipeline-job store。 */
export class PipelineJobStore {
  private readonly byBundleId = new Map<string, PipelineJobRecord>();

  constructor(private readonly persistencePath: string | null = null) {
    this.load();
  }

  private load(): void {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.persistencePath, "utf-8")) as {
        schema_version?: string;
        records?: unknown;
      };
      if (!Array.isArray(parsed.records)) return;
      for (const item of parsed.records) {
        const record = item as PipelineJobRecord;
        if (record && typeof record.source_bundle_id === "string" && typeof record.pipeline_job_id === "string") {
          this.byBundleId.set(record.source_bundle_id, record);
        }
      }
    } catch {
      this.byBundleId.clear();
    }
  }

  private persist(): void {
    if (!this.persistencePath) return;
    fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
    const tmpPath = `${this.persistencePath}.tmp`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify(
        { schema_version: SCHEMA_VERSION, records: [...this.byBundleId.values()] },
        null,
        2,
      ),
      "utf-8",
    );
    fs.renameSync(tmpPath, this.persistencePath);
  }

  getByBundleId(sourceBundleId: string): PipelineJobRecord | null {
    return this.byBundleId.get(sourceBundleId) ?? null;
  }

  getByJobId(pipelineJobId: string): PipelineJobRecord | null {
    for (const job of this.byBundleId.values()) {
      if (job.pipeline_job_id === pipelineJobId) return job;
    }
    return null;
  }

  list(): PipelineJobRecord[] {
    return [...this.byBundleId.values()].sort(
      (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
    );
  }

  /**
   * 對 READY bundle 保證恰好一個 logical job。
   *
   * - 首見 → PENDING_ADMISSION，ledger 第一筆 `source_bundle_ready`（created_new_logical_job=true）
   * - 已存在 → 追加 `ready_replay`（created_new_logical_job=false），id／state／attempt 不變
   */
  ensureFromReadyBundle(bundle: SourceBundleRecord, now: string): EnsureJobResult {
    const existing = this.byBundleId.get(bundle.source_bundle_id);
    if (existing) {
      const replay: ReadyEventLedgerEntry = {
        event_id: eventIdFor("ready_replay", now, bundle.source_bundle_id),
        event_kind: "ready_replay",
        received_at: now,
        created_new_logical_job: false,
      };
      const next: PipelineJobRecord = {
        ...existing,
        ready_event_ledger: [...existing.ready_event_ledger, replay],
        updated_at: now,
      };
      this.byBundleId.set(bundle.source_bundle_id, next);
      this.persist();
      return { createdNew: false, job: next };
    }

    const job: PipelineJobRecord = {
      owner: "bim-review-coordinator",
      pipeline_job_id: pipelineJobIdFor(bundle.source_bundle_id),
      source_bundle_id: bundle.source_bundle_id,
      external_model_version_id: bundle.external_model_version_id,
      tenant_id: bundle.tenant_id,
      project_id: bundle.project_id,
      job_state: "PENDING_ADMISSION",
      attempt_count: 0,
      in_flight_attempt_id: null,
      active_result_id: null,
      manual_correction_blocker: null,
      ready_event_ledger: [
        {
          event_id: eventIdFor("source_bundle_ready", now, bundle.source_bundle_id),
          event_kind: "source_bundle_ready",
          received_at: now,
          created_new_logical_job: true,
        },
      ],
      created_at: now,
      updated_at: now,
    };
    this.byBundleId.set(bundle.source_bundle_id, job);
    this.persist();
    return { createdNew: true, job };
  }
}
