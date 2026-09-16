import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LineageAlignmentReportBody } from "../lineage/lineageAlignmentReport.js";

/**
 * 轉檔對齊報表（legacy MinIO watch 流程）的本地紀錄。
 *
 * 一次轉檔一筆，以 conversion_job_id 為鍵；報表檔另存於 `reports/<轉檔編號>/`。
 * 紀錄只含可公開的中繼資料（沒有本機路徑、簽章 URL 或憑證）。
 * index 檔損壞時整個 store 失效，讀取一律拋錯，不假裝「沒有報表」。
 */
export const LINEAGE_REPORT_FILES = ["alignment_report.json", "alignment_report.csv"] as const;
export type LineageReportFileName = (typeof LINEAGE_REPORT_FILES)[number];

export type LineageReportStatus = "generated" | "failed" | "not_produced" | "invalid";
export type LineageReportUploadStatus = "uploaded" | "exists" | "denied" | "failed" | "skipped";
export type LineageReportMetrics = LineageAlignmentReportBody["metrics"];
export type LineageReportCounts = LineageAlignmentReportBody["counts"];
export type LineageReportFileFacts = { sha256: string; size_bytes: number };

export type LineageReportRecord = {
  conversion_job_id: string;
  ifc_ready_job_id: string;
  source_model_id: string;
  project_id: string;
  external_model_version_id: string;
  source_ifc: { bucket: string | null; key: string | null; etag: string | null };
  schedule: { key: string | null; etag: string | null; sha256: string | null; size_bytes: number | null; used: boolean };
  status: LineageReportStatus;
  error_code: string | null;
  report_generated_at: string | null;
  conversion_created_at: string;
  recorded_at: string;
  metrics: LineageReportMetrics | null;
  counts: LineageReportCounts | null;
  warning_codes: string[];
  files: Record<LineageReportFileName, LineageReportFileFacts | null>;
  minio_upload: {
    status: LineageReportUploadStatus;
    bucket: string | null;
    keys: Record<LineageReportFileName, string | null>;
    reason: string | null;
    attempted_at: string | null;
  };
};

type IndexDocument = { schema_version: "lineage-conversion-report-index/v1"; records: LineageReportRecord[] };

export class LineageReportStoreUnavailableError extends Error {
  constructor() {
    super("lineage report store is unavailable");
    this.name = "LineageReportStoreUnavailableError";
  }
}

const CONVERSION_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isConversionJobId(value: unknown): value is string {
  return typeof value === "string" && CONVERSION_JOB_ID.test(value);
}

function writeAtomic(target: string, bytes: Buffer | string): void {
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, target);
}

export class LineageReportStore {
  private readonly indexPath: string;
  private readonly records = new Map<string, LineageReportRecord>();
  private readonly loaded: boolean;

  constructor(private readonly dir: string) {
    this.indexPath = path.join(dir, "index.json");
    this.loaded = this.load();
  }

  get available(): boolean {
    return this.loaded;
  }

  get(conversionJobId: string): LineageReportRecord | null {
    this.assertAvailable();
    const record = this.records.get(conversionJobId);
    return record ? structuredClone(record) : null;
  }

  /** 最新的在前（依轉檔建立時間，其次紀錄時間）。 */
  list(): LineageReportRecord[] {
    this.assertAvailable();
    return [...this.records.values()]
      .sort(
        (left, right) =>
          right.conversion_created_at.localeCompare(left.conversion_created_at) ||
          right.recorded_at.localeCompare(left.recorded_at),
      )
      .map((record) => structuredClone(record));
  }

  /** 先寫報表檔再寫 index，index 永遠不會指向不存在的檔案。 */
  save(record: LineageReportRecord, files: Partial<Record<LineageReportFileName, Buffer>> = {}): void {
    this.assertAvailable();
    if (!isConversionJobId(record.conversion_job_id)) throw new Error("invalid conversion_job_id");
    const entries = Object.entries(files) as Array<[LineageReportFileName, Buffer]>;
    if (entries.length > 0) {
      const reportDir = this.reportDir(record.conversion_job_id);
      mkdirSync(reportDir, { recursive: true });
      for (const [name, bytes] of entries) writeAtomic(path.join(reportDir, name), bytes);
    }
    const next = new Map(this.records);
    next.set(record.conversion_job_id, structuredClone(record));
    const document: IndexDocument = {
      schema_version: "lineage-conversion-report-index/v1",
      records: [...next.values()],
    };
    mkdirSync(this.dir, { recursive: true });
    writeAtomic(this.indexPath, `${JSON.stringify(document)}\n`);
    this.records.set(record.conversion_job_id, structuredClone(record));
  }

  readFile(conversionJobId: string, name: LineageReportFileName): Buffer | null {
    this.assertAvailable();
    const record = this.records.get(conversionJobId);
    if (!record || !record.files[name] || !LINEAGE_REPORT_FILES.includes(name)) return null;
    try {
      return readFileSync(path.join(this.reportDir(conversionJobId), name));
    } catch {
      return null;
    }
  }

  private reportDir(conversionJobId: string): string {
    if (!isConversionJobId(conversionJobId)) throw new Error("invalid conversion_job_id");
    return path.join(this.dir, "reports", conversionJobId);
  }

  private assertAvailable(): void {
    if (!this.loaded) throw new LineageReportStoreUnavailableError();
  }

  private load(): boolean {
    if (!existsSync(this.indexPath)) return true;
    try {
      const document = JSON.parse(readFileSync(this.indexPath, "utf-8")) as Partial<IndexDocument>;
      if (document.schema_version !== "lineage-conversion-report-index/v1" || !Array.isArray(document.records)) {
        return false;
      }
      for (const record of document.records) {
        if (!record || !isConversionJobId(record.conversion_job_id)) return false;
        this.records.set(record.conversion_job_id, record);
      }
      return true;
    } catch {
      return false;
    }
  }
}
