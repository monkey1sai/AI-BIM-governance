// bim-review-coordinator/src/services/conversionLedger.ts
//
// 持久 ConversionLedger：shadow 紀錄 minio-watch 偵測到的 IFC 轉檔事件。
// 設計精神：零新 production dependency，照 callbackOutbox.ts 的
// 「單一 JSON 檔 + `.tmp` atomic swap + schema_version」pattern。
// `now`（ISO 字串）一律由呼叫端傳入，service 內不取時鐘（方便測試）。
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createConversionValidationRecord, parseConversionValidationRecord, type ConversionValidationRecord } from "./conversionValidationRecord.js";
import type { ReadyRenderBundle } from "../types.js";

/** 轉檔紀錄狀態（誠實鐵律：非 converter 落地不得出現 ready） */
export type ConversionLedgerStatus = "detected" | "queued" | "converting" | "ready" | "failed";

/** 持久 ledger 單筆紀錄 */
export interface ConversionLedgerRecord {
  /** Internal-only validated descriptor; excluded from the public ledger projection. */
  ready_render_bundle?: ReadyRenderBundle;
  /** Internal immutable history; never part of the public ledger projection. */
  validation_records?: ConversionValidationRecord[];
  idempotency_key: string;            // mw_<hash16>（唯一鍵）
  correlation_id: string | null;      // minio-watch-<hash8>
  project_id: string;                 // safe id
  project_display_name: string;       // 中文原名
  category: string;                   // 種類（倒數二段）
  external_model_version_id: string;  // 版本（末段）
  object_key: string | null;          // Phase 1 可為 null（由 #minio list proxy 補視圖）
  bucket: string | null;
  conversion_job_id: string | null;
  status: ConversionLedgerStatus;
  coverage_report: unknown | null;    // Phase 2 回填
  usdc_key: string | null;            // Phase 2 回填
  detected_at: string;                // ISO
  updated_at: string;                 // ISO
}

/**
 * upsert 輸入型別：必填識別欄位 + 可選物件欄位。
 * 已存在時只更新 status/conversion_job_id/updated_at，保留 detected_at。
 */
export type ConversionLedgerUpsert = Pick<ConversionLedgerRecord,
  | "idempotency_key"
  | "correlation_id"
  | "project_id"
  | "project_display_name"
  | "category"
  | "external_model_version_id"
  | "conversion_job_id"
  | "status"
> & Partial<Pick<ConversionLedgerRecord, "object_key" | "bucket">>;

/** v1 可讀；未知版本或壞檔禁止寫入，保留原檔供復原。 */
const SCHEMA_VERSION = "conversion-ledger/v2";

/** 持久 ConversionLedger（coordinator-local shadow；非 metadata 權威） */
export class ConversionLedger {
  private readonly records = new Map<string, ConversionLedgerRecord>();
  private available = true;

  /**
   * @param persistencePath JSON 持久化路徑；null 表示純記憶體（測試 / 降級）
   */
  constructor(private readonly persistencePath: string | null = null) {
    this.load();
  }

  // ── 持久化 ────────────────────────────────────────────────────────────────

  /** 從磁碟載入；壞檔不 crash（照 callbackOutbox 精神） */
  private load(): void {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return;
    try {
      const raw = fs.readFileSync(this.persistencePath, "utf-8");
      const parsed = JSON.parse(raw) as { schema_version?: string; records?: unknown };
      if (!["conversion-ledger/v1", SCHEMA_VERSION].includes(parsed.schema_version ?? "") || !Array.isArray(parsed.records)) {
        throw new Error("Unsupported conversion ledger schema.");
      }
      for (const item of parsed.records) {
        const r = item as ConversionLedgerRecord;
        if (!r || typeof r.idempotency_key !== "string" || this.records.has(r.idempotency_key)) throw new Error("Invalid conversion ledger record.");
        // v1 never grants a ready-descriptor provenance field.
        if (parsed.schema_version === "conversion-ledger/v1") {
          delete r.ready_render_bundle;
          delete r.validation_records;
        } else if (r.validation_records !== undefined) {
          if (!Array.isArray(r.validation_records)) throw new Error("Invalid validation history.");
          r.validation_records = r.validation_records.map(parseConversionValidationRecord);
          const ids = new Set<string>();
          for (const record of r.validation_records) {
            if (record.readyModelId !== r.idempotency_key || ids.has(record.recordId)) {
              throw new Error("Invalid validation history identity.");
            }
            ids.add(record.recordId);
          }
        }
        this.records.set(r.idempotency_key, r);
      }
    } catch {
      // 啟動不 crash，但所有 ledger 存取消費皆 fail closed，不能覆寫原檔。
      this.records.clear();
      this.available = false;
    }
  }

  /** atomic swap（寫 .tmp 再 rename，防寫到一半 crash 損毀） */
  private persist(): void {
    this.assertAvailable();
    if (!this.persistencePath) return;
    fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
    const tmpPath = `${this.persistencePath}.tmp`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify({ schema_version: SCHEMA_VERSION, records: [...this.records.values()] }, null, 2),
      "utf-8",
    );
    fs.renameSync(tmpPath, this.persistencePath);
  }

  // ── 公開 API ──────────────────────────────────────────────────────────────

  /**
   * 新增或更新 ledger 紀錄。
   * - 首次：建立完整紀錄，detected_at = now。
   * - 已存在（同 idempotency_key）：只更新 status / conversion_job_id / updated_at，
   *   保留 detected_at；未提供 artifacts 時保留 coverage_report、usdc_key。
   * - artifacts 與狀態同次保存；undefined 保留既有欄位，null 明確清除。
   *   conversion_job_id 採 ?? 語意：input 為 null 時保留既有（null 不清除），
   *   僅 undefined（未傳）時回落 existing，兩者皆無時才落 null。
   *
   * @param input   upsert 輸入（識別欄位 + 可選物件欄位）
   * @param now     ISO 時間字串（由呼叫端傳入，service 不取時鐘）
   */
  upsert(
    input: ConversionLedgerUpsert,
    now: string,
    artifacts?: Partial<Pick<ConversionLedgerRecord, "usdc_key" | "coverage_report">>,
  ): ConversionLedgerRecord {
    this.assertAvailable();
    const existing = this.records.get(input.idempotency_key);
    const record: ConversionLedgerRecord = {
      idempotency_key: input.idempotency_key,
      correlation_id: input.correlation_id,
      project_id: input.project_id,
      project_display_name: input.project_display_name,
      category: input.category,
      external_model_version_id: input.external_model_version_id,
      // object_key / bucket：優先取 input 顯式值，其次保留既有，否則 null
      object_key: input.object_key ?? existing?.object_key ?? null,
      bucket: input.bucket ?? existing?.bucket ?? null,
      // conversion_job_id：?? 語意 — input 為 null 時保留既有（null 不清除）
      conversion_job_id: input.conversion_job_id ?? existing?.conversion_job_id ?? null,
      status: input.status,
      // Terminal artifacts 與 status 一起發布；一般 upsert 不覆蓋既有資料。
      coverage_report: artifacts?.coverage_report !== undefined ? artifacts.coverage_report : existing?.coverage_report ?? null,
      usdc_key: artifacts?.usdc_key !== undefined ? artifacts.usdc_key : existing?.usdc_key ?? null,
      // detected_at：首次建立時定格，後續 upsert 保留
      detected_at: existing?.detected_at ?? now,
      updated_at: now,
      validation_records: existing?.validation_records,
      ready_render_bundle: existing?.conversion_job_id === (input.conversion_job_id ?? existing?.conversion_job_id)
        && existing?.project_id === input.project_id
        && existing?.external_model_version_id === input.external_model_version_id
        && existing?.correlation_id === input.correlation_id
        ? existing.ready_render_bundle : undefined,
    };
    return this.commitRecord(record);
  }

  /**
   * Phase 2 callback 回填（converter 完成/失敗後更新 usdc_key / coverage / status）。
   * 找不到 idempotencyKey 時回 null（非 crash）。
   *
   * @param idempotencyKey  唯一鍵
   * @param outcome         回填欄位（status 必填；其餘可選）
   * @param now             ISO 時間字串
   */
  recordCallbackOutcome(
    idempotencyKey: string,
    outcome: { status: ConversionLedgerStatus; usdc_key?: string | null; coverage_report?: unknown },
    now: string,
  ): ConversionLedgerRecord | null {
    this.assertAvailable();
    const existing = this.records.get(idempotencyKey);
    if (!existing) return null;
    const next: ConversionLedgerRecord = {
      ...existing,
      status: outcome.status,
      usdc_key: outcome.usdc_key !== undefined ? outcome.usdc_key : existing.usdc_key,
      coverage_report: outcome.coverage_report !== undefined ? outcome.coverage_report : existing.coverage_report,
      updated_at: now,
    };
    return this.commitRecord(next);
  }

  /**
   * 取單筆紀錄；找不到回 null。
   */
  get(idempotencyKey: string): ConversionLedgerRecord | null {
    this.assertAvailable();
    const record = this.records.get(idempotencyKey);
    return record ? structuredClone(record) : null;
  }

  /**
   * 列出所有紀錄，依 detected_at 降冪排序（最新在前）。
   */
  list(): ConversionLedgerRecord[] {
    this.assertAvailable();
    return structuredClone([...this.records.values()]).sort(
      (a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at),
    );
  }

  rememberRenderBundle(bundle: ReadyRenderBundle): void {
    this.assertAvailable();
    const existing = this.records.get(bundle.readyModelId);
    if (!existing || existing.status !== "ready" || existing.conversion_job_id !== bundle.conversionJobId
      || existing.correlation_id !== bundle.correlationId
      || existing.project_id !== bundle.projectId || existing.external_model_version_id !== bundle.modelVersionId) {
      throw new Error("Ready model identity changed.");
    }
    this.commitRecord({ ...existing, ready_render_bundle: bundle });
  }

  appendValidationRecord(idempotencyKey: string, value: unknown): ConversionValidationRecord {
    this.assertAvailable();
    const existing = this.records.get(idempotencyKey);
    if (!existing) throw new Error("Conversion record not found.");
    const record = createConversionValidationRecord(value);
    const history = existing.validation_records ?? [];
    const previous = history.find((entry) => entry.recordId === record.recordId);
    if (previous) {
      if (!isDeepStrictEqual(previous, record)) throw new Error("Validation record identity conflict.");
      return structuredClone(previous);
    }
    if (record.readyModelId !== idempotencyKey || record.projectId !== existing.project_id ||
        record.modelVersionId !== existing.external_model_version_id ||
        record.conversionJobId !== existing.conversion_job_id) throw new Error("Validation source identity changed.");
    this.commitRecord({ ...existing, validation_records: [...history, record] });
    return structuredClone(record);
  }

  listValidationRecords(idempotencyKey: string): ConversionValidationRecord[] {
    this.assertAvailable();
    return structuredClone(this.records.get(idempotencyKey)?.validation_records ?? []);
  }

  private commitRecord(record: ConversionLedgerRecord): ConversionLedgerRecord {
    const next = structuredClone(record);
    const previous = this.records.get(next.idempotency_key);
    this.records.set(next.idempotency_key, next);
    try {
      this.persist();
    } catch (error) {
      if (previous) this.records.set(next.idempotency_key, previous);
      else this.records.delete(next.idempotency_key);
      throw error;
    }
    return structuredClone(next);
  }

  private assertAvailable(): void {
    if (!this.available) throw new Error("Conversion ledger unavailable; preserve the original file for recovery.");
  }
}

export function publicConversionRecord(record: ConversionLedgerRecord): Omit<ConversionLedgerRecord, "ready_render_bundle" | "validation_records"> {
  return {
    idempotency_key: record.idempotency_key, correlation_id: record.correlation_id,
    project_id: record.project_id, project_display_name: record.project_display_name,
    category: record.category, external_model_version_id: record.external_model_version_id,
    object_key: record.object_key, bucket: record.bucket, conversion_job_id: record.conversion_job_id,
    status: record.status, coverage_report: record.coverage_report, usdc_key: record.usdc_key,
    detected_at: record.detected_at, updated_at: record.updated_at,
  };
}
