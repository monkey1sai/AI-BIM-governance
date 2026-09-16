import { createHash } from "node:crypto";
import type { IfcReadyIntakeJob } from "../../types.js";
import { parseLineageAlignmentReport } from "../lineage/lineageAlignmentReport.js";
import { minioObjectKeyFromSourceRef } from "../minioSourceObjectKey.js";
import type { StreamingConversionResult } from "../streamingConversionClient.js";
import { ifcFolderOf, readCompanionScheduleSource } from "./companionSchedule.js";
import type { LineageReportObjectPort } from "./lineageReportObjectStore.js";
import {
  LINEAGE_REPORT_FILES,
  isConversionJobId,
  type LineageReportFileName,
  type LineageReportRecord,
  type LineageReportStore,
  type LineageReportUploadStatus,
} from "./lineageReportStore.js";

/**
 * 轉檔完成後收集 schedule.csv ↔ IFC ↔ USDC 對齊報表：
 * 從轉檔服務取回兩份報表 → 核對 checksum 與契約 → 存到本地紀錄 →
 * 以 conditional create 上傳到 IFC 所在的 MinIO 資料夾（沒有權限就記 denied）。
 *
 * 報表是附加資訊：任何失敗只寫進紀錄，不影響轉檔、session 或 callback。
 */
export const LINEAGE_REPORT_MAX_BYTES = 64 * 1024 * 1024;
export const ALIGNMENT_CSV_HEADER =
  "row_number,rvt_element_id,ifc_uuid36_raw,ifc_uuid36,ifc_global_id22,usd_prim_path,alignment_class,reason_code";
const FETCH_TIMEOUT_MS = 30_000;
const CONTENT_TYPES: Record<LineageReportFileName, string> = {
  "alignment_report.json": "application/json",
  "alignment_report.csv": "text/csv; charset=utf-8",
};
const ARTIFACT_ROLES: Record<LineageReportFileName, string> = {
  "alignment_report.json": "alignment_report_json",
  "alignment_report.csv": "alignment_report_csv",
};
/** 這些狀態下再收一次可能得到不同結果（轉檔服務暫時連不上）。 */
const RETRYABLE_ERRORS = new Set(["report_unavailable"]);

export type LineageReportCollectorDeps = {
  store: LineageReportStore;
  objects: LineageReportObjectPort | null;
  bucket: string;
  conversionOrigin: string;
  publicArtifactOrigin: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  onError?: (conversionJobId: string, reason: string) => void;
};

class ReportRejected extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function originOf(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new ReportRejected("report_artifact_invalid");
  }
  return url.origin;
}

async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw new ReportRejected("report_too_large");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new ReportRejected("report_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export class LineageReportCollector {
  private readonly inFlight = new Map<string, Promise<LineageReportRecord | null>>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly deps: LineageReportCollectorDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
  }

  /** 同一個轉檔同時只收一次；已完成的紀錄直接回傳（上傳失敗時只重試上傳）。 */
  collect(job: IfcReadyIntakeJob, result: StreamingConversionResult): Promise<LineageReportRecord | null> {
    const conversionJobId = job.conversion_job_id;
    if (!isConversionJobId(conversionJobId) || result.conversion_job_id !== conversionJobId) {
      return Promise.resolve(null);
    }
    const pending = this.inFlight.get(conversionJobId);
    if (pending) return pending;
    const run = this.collectOnce(job, result)
      .catch((err: unknown) => {
        this.deps.onError?.(conversionJobId, err instanceof Error ? err.name : "unexpected");
        return null;
      })
      .finally(() => this.inFlight.delete(conversionJobId));
    this.inFlight.set(conversionJobId, run);
    return run;
  }

  /** 啟動時補收：已完成轉檔但沒有（或暫時失敗的）報表紀錄。依序處理，不併發打轉檔服務。 */
  async resume(
    jobs: IfcReadyIntakeJob[],
    fetchResult: (conversionJobId: string) => Promise<StreamingConversionResult>,
  ): Promise<string[]> {
    const collected: string[] = [];
    for (const job of jobs) {
      if (job.conversion_status !== "ready" || job.conversion_authority !== "bim-streaming-server") continue;
      if (!isConversionJobId(job.conversion_job_id) || !this.needsWork(this.deps.store.get(job.conversion_job_id))) {
        continue;
      }
      let result: StreamingConversionResult;
      try {
        result = await fetchResult(job.conversion_job_id);
      } catch {
        continue;
      }
      if (await this.collect(job, result)) collected.push(job.conversion_job_id);
    }
    return collected;
  }

  private needsWork(record: LineageReportRecord | null): boolean {
    if (!record) return true;
    if (record.status === "invalid") return RETRYABLE_ERRORS.has(record.error_code ?? "");
    return record.status === "generated" && record.minio_upload.status === "failed";
  }

  private async collectOnce(job: IfcReadyIntakeJob, result: StreamingConversionResult): Promise<LineageReportRecord> {
    const conversionJobId = job.conversion_job_id!;
    const existing = this.deps.store.get(conversionJobId);
    if (existing && !this.needsWork(existing)) return existing;
    if (existing && existing.status === "generated") return this.upload(existing);

    const base = this.baseRecord(job);
    const summary = object(object(result.raw)?.lineage_alignment);
    if (!summary) return this.finish({ ...base, status: "not_produced", error_code: "report_not_produced" });
    if (summary.status === "failed") {
      const code = typeof summary.error_code === "string" && /^[a-z0-9_]{1,64}$/.test(summary.error_code)
        ? summary.error_code
        : "alignment_failed";
      return this.finish({ ...base, status: "failed", error_code: code });
    }
    try {
      if (summary.status !== "generated") throw new ReportRejected("report_summary_invalid");
      const files = await this.fetchReports(conversionJobId, result);
      const body = parseLineageAlignmentReport(files["alignment_report.json"]);
      if (!body) throw new ReportRejected("report_schema_invalid");
      if (body.attempt_id !== conversionJobId || body.result_id !== conversionJobId) {
        throw new ReportRejected("report_identity_mismatch");
      }
      const header = files["alignment_report.csv"].toString("utf-8").replace(/^﻿/, "").split(/\r?\n/, 1)[0];
      if (header !== ALIGNMENT_CSV_HEADER) throw new ReportRejected("report_csv_invalid");
      const record: LineageReportRecord = {
        ...base,
        status: "generated",
        report_generated_at: body.generated_at,
        metrics: body.metrics,
        counts: body.counts,
        warning_codes: [...body.warning_codes],
        schedule: { ...base.schedule, used: object(summary.schedule_csv)?.present === true },
        files: {
          "alignment_report.json": this.facts(files["alignment_report.json"]),
          "alignment_report.csv": this.facts(files["alignment_report.csv"]),
        },
      };
      this.deps.store.save(record, files);
      return this.upload(record);
    } catch (err) {
      if (!(err instanceof ReportRejected)) throw err;
      this.deps.onError?.(conversionJobId, err.code);
      return this.finish({ ...base, status: "invalid", error_code: err.code });
    }
  }

  private baseRecord(job: IfcReadyIntakeJob): LineageReportRecord {
    const key = minioObjectKeyFromSourceRef(job.source_ifc_ref, this.deps.bucket);
    const schedule = job.local_path ? readCompanionScheduleSource(job.local_path) : null;
    return {
      conversion_job_id: job.conversion_job_id!,
      ifc_ready_job_id: job.ifc_ready_job_id,
      source_model_id: job.idempotency_key,
      project_id: job.project_id,
      external_model_version_id: job.external_model_version_id,
      source_ifc: {
        bucket: key ? this.deps.bucket : null,
        key,
        etag: key ? job.source_ifc_etag.replace(/^"+|"+$/g, "") || null : null,
      },
      schedule: {
        key: schedule?.key ?? null,
        etag: schedule?.etag ?? null,
        sha256: schedule?.sha256 ?? null,
        size_bytes: schedule?.size_bytes ?? null,
        used: false,
      },
      status: "invalid",
      error_code: null,
      report_generated_at: null,
      conversion_created_at: job.created_at,
      recorded_at: this.now().toISOString(),
      metrics: null,
      counts: null,
      warning_codes: [],
      files: { "alignment_report.json": null, "alignment_report.csv": null },
      minio_upload: {
        status: "skipped",
        bucket: null,
        keys: { "alignment_report.json": null, "alignment_report.csv": null },
        reason: "report_not_generated",
        attempted_at: null,
      },
    };
  }

  private finish(record: LineageReportRecord): LineageReportRecord {
    this.deps.store.save(record);
    return record;
  }

  private facts(bytes: Buffer): { sha256: string; size_bytes: number } {
    return { sha256: createHash("sha256").update(bytes).digest("hex"), size_bytes: bytes.length };
  }

  private async fetchReports(
    conversionJobId: string,
    result: StreamingConversionResult,
  ): Promise<Record<LineageReportFileName, Buffer>> {
    const internal = originOf(this.deps.conversionOrigin);
    const publisher = originOf(this.deps.publicArtifactOrigin);
    const artifacts = object(object(result.raw)?.artifacts);
    const out = {} as Record<LineageReportFileName, Buffer>;
    for (const name of LINEAGE_REPORT_FILES) {
      const descriptor = object(artifacts?.[ARTIFACT_ROLES[name]]);
      const checksum = typeof descriptor?.checksum_sha256 === "string" ? descriptor.checksum_sha256.toLowerCase() : "";
      const path = `/artifacts/${conversionJobId}/${name}`;
      if (descriptor?.url !== publisher + path || !/^[a-f0-9]{64}$/.test(checksum)) {
        throw new ReportRejected("report_artifact_invalid");
      }
      let bytes: Buffer;
      try {
        const response = await this.fetchImpl(internal + path, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          throw new ReportRejected("report_unavailable");
        }
        bytes = await readBounded(response, LINEAGE_REPORT_MAX_BYTES);
      } catch (err) {
        if (err instanceof ReportRejected) throw err;
        throw new ReportRejected("report_unavailable");
      }
      if (createHash("sha256").update(bytes).digest("hex") !== checksum) {
        throw new ReportRejected("report_checksum_mismatch");
      }
      out[name] = bytes;
    }
    return out;
  }

  private async upload(record: LineageReportRecord): Promise<LineageReportRecord> {
    const key = record.source_ifc.key;
    const attemptedAt = this.now().toISOString();
    const skip = (reason: string): LineageReportRecord =>
      this.finish({ ...record, minio_upload: { ...record.minio_upload, status: "skipped", reason, attempted_at: attemptedAt } });
    if (!this.deps.objects) return skip("minio_not_configured");
    if (!key) return skip("source_key_unknown");
    const prefix = `${ifcFolderOf(key)}lineage-reports/${record.conversion_job_id}/`;
    const keys = {
      "alignment_report.json": prefix + "alignment_report.json",
      "alignment_report.csv": prefix + "alignment_report.csv",
    };
    const outcomes: Array<"created" | "exists" | "denied"> = [];
    let status: LineageReportUploadStatus;
    let reason: string | null = null;
    try {
      for (const name of LINEAGE_REPORT_FILES) {
        const bytes = this.deps.store.readFile(record.conversion_job_id, name);
        if (!bytes) throw new ReportRejected("local_report_missing");
        const outcome = await this.deps.objects.putObjectIfAbsent(keys[name], bytes, CONTENT_TYPES[name]);
        outcomes.push(outcome);
        if (outcome === "denied") break;
      }
      status = outcomes.includes("denied")
        ? "denied"
        : outcomes.every((outcome) => outcome === "exists")
          ? "exists"
          : "uploaded";
      if (status === "denied") reason = "minio_write_denied";
    } catch (err) {
      status = "failed";
      reason = err instanceof ReportRejected ? err.code : "upload_error";
      this.deps.onError?.(record.conversion_job_id, reason);
    }
    return this.finish({
      ...record,
      minio_upload: { status, bucket: this.deps.bucket, keys, reason, attempted_at: attemptedAt },
    });
  }
}
