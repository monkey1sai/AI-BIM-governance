// bim-review-coordinator/src/services/lineage/sourceBundleStore.ts
//
// Durable governed source-bundle store。
//
// 持久化 pattern **逐字沿用** `services/conversionLedger.ts:63-92`：單一 JSON 檔 ＋
// `schema_version` ＋ `.tmp` 寫入後 `renameSync` ＋ 壞檔不 crash 當空 store 起手 ＋
// `now` 由呼叫端傳入（service 內不取時鐘）。
//
// 刻意**不**抽共用基底類別：抽出來會反過來改到 `ConversionLedger`
// （GitNexus upstream impact MEDIUM／14），把這個新 store 的 blast radius 從 0 拉高。
//
// 去重空間獨立：legacy 的 `mw_<hash16>` 與 governed 的 `source_bundle_id`
// MUST NOT 互相取代、抑制或推導（design.md §11.2 規則 3），所以 governed 走這張新表，
// 不重用 `ConversionLedger`。
import fs from "node:fs";
import path from "node:path";
import type { IntegrityDiagnostic } from "./integrityDiagnostics.js";
import type { BundleState } from "./sourceBundleValidator.js";

/** JSON 持久檔 schema 版本（讀版本不符／壞檔時安全降級當空 store）。 */
const SCHEMA_VERSION = "source-bundle/v1";

/**
 * Governed source bundle 的 durable 紀錄。
 *
 * 只保存 identity／digest／locator／state——依 `local-artifact-shadow-metadata`
 * 的 governed 邊界，MUST NOT 保存逐 element mapping rows、alignment body、
 * artifact bytes、MinIO credentials 或 cloud MySQL 的複本。
 */
export interface SourceBundleRecord {
  source_bundle_id: string;
  external_model_version_id: string;
  tenant_id: string;
  project_id: string;
  project_display_name: string | null;
  model_category: string | null;
  manifest_ref: string;
  manifest_sha256: string;
  bundle_state: BundleState;
  integrity_diagnostics: IntegrityDiagnostic[];
  producer_id: string;
  producer_kind: string;
  claimed_at: string;
  validated_at: string;
  /** 由 3.2 的 `PipelineJobStore` 回填；3.1 一律 null。 */
  pipeline_job_id: string | null;
  created_at: string;
  updated_at: string;
}

export type AdmitOutcome = "created" | "replay_same_digest" | "conflict_different_digest";

export interface AdmitResult {
  outcome: AdmitOutcome;
  record: SourceBundleRecord;
}

/** Durable governed source-bundle store（coordinator-local；非 control-plane authority）。 */
export class SourceBundleStore {
  private readonly records = new Map<string, SourceBundleRecord>();

  /**
   * @param persistencePath JSON 持久化路徑；null 表示純記憶體（測試／降級）
   */
  constructor(private readonly persistencePath: string | null = null) {
    this.load();
  }

  // ── 持久化 ────────────────────────────────────────────────────────────────

  /** 從磁碟載入；壞檔不 crash（照 conversionLedger 精神）。 */
  private load(): void {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return;
    try {
      const raw = fs.readFileSync(this.persistencePath, "utf-8");
      const parsed = JSON.parse(raw) as { schema_version?: string; records?: unknown };
      if (!Array.isArray(parsed.records)) return;
      for (const item of parsed.records) {
        const record = item as SourceBundleRecord;
        if (record && typeof record.source_bundle_id === "string") {
          this.records.set(record.source_bundle_id, record);
        }
      }
    } catch {
      // 壞檔不 crash，當空 store 起手；下次 admit 覆寫。
      this.records.clear();
    }
  }

  /** atomic swap（寫 .tmp 再 rename，防寫到一半 crash 損毀）。 */
  private persist(): void {
    if (!this.persistencePath) return;
    fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
    const tmpPath = `${this.persistencePath}.tmp`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify(
        { schema_version: SCHEMA_VERSION, records: [...this.records.values()] },
        null,
        2,
      ),
      "utf-8",
    );
    fs.renameSync(tmpPath, this.persistencePath);
  }

  // ── 公開 API ──────────────────────────────────────────────────────────────

  /** 取單筆紀錄；找不到回 null。 */
  get(sourceBundleId: string): SourceBundleRecord | null {
    return this.records.get(sourceBundleId) ?? null;
  }

  /** 列出全部紀錄，依 `created_at` 降冪（最新在前），與 `ConversionLedger.list()` 同慣例。 */
  list(): SourceBundleRecord[] {
    return [...this.records.values()].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  }

  /**
   * 冪等 create-once 收案。
   *
   * - 首見 `source_bundle_id` → `created`。
   * - 同 id 同 `manifest_sha256` → `replay_same_digest`：identity 欄位一律沿用既有紀錄
   *   （READY bundle 不可變），只刷新觀測欄位（`bundle_state`／`integrity_diagnostics`／
   *   `validated_at`／`updated_at`）。`pipeline_job_id` 保留既有值，replay 不得把
   *   已綁定的 stable job 洗掉。
   * - 同 id 異 digest → `conflict_different_digest`：**完全不寫入**，原樣回傳既有紀錄。
   *   這是「READY source version SHALL 不可變」的落點：改 bytes 必須開新的
   *   `source_bundle_id`，不得原地覆寫。
   */
  admit(record: SourceBundleRecord): AdmitResult {
    const existing = this.records.get(record.source_bundle_id);
    if (!existing) {
      this.records.set(record.source_bundle_id, record);
      this.persist();
      return { outcome: "created", record };
    }
    if (existing.manifest_sha256 !== record.manifest_sha256) {
      return { outcome: "conflict_different_digest", record: existing };
    }
    const refreshed: SourceBundleRecord = {
      ...existing,
      bundle_state: record.bundle_state,
      integrity_diagnostics: record.integrity_diagnostics,
      validated_at: record.validated_at,
      pipeline_job_id: existing.pipeline_job_id ?? record.pipeline_job_id,
      updated_at: record.updated_at,
    };
    this.records.set(refreshed.source_bundle_id, refreshed);
    this.persist();
    return { outcome: "replay_same_digest", record: refreshed };
  }

  /**
   * 綁定 3.2 的 stable `pipeline_job_id`。找不到 bundle 回 null（非 crash）。
   *
   * @param now 可選 ISO 時間字串。有給才動 `updated_at`——service 內不取時鐘，
   *            沿用 `ConversionLedger` 的「`now` 由呼叫端傳入」慣例。
   */
  bindPipelineJob(
    sourceBundleId: string,
    pipelineJobId: string,
    now?: string,
  ): SourceBundleRecord | null {
    const existing = this.records.get(sourceBundleId);
    if (!existing) return null;
    const next: SourceBundleRecord = {
      ...existing,
      pipeline_job_id: pipelineJobId,
      updated_at: now ?? existing.updated_at,
    };
    this.records.set(sourceBundleId, next);
    this.persist();
    return next;
  }
}
