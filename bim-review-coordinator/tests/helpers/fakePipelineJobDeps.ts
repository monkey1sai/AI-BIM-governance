import type { StructLogger } from "../../src/lib/structLog.js";
import type { SourceBundleRecord } from "../../src/services/lineage/sourceBundleStore.js";

/**
 * task 3.2 的測試替身。
 *
 * 與 `tests/helpers/fakeSourceBundleDeps.ts` 分檔：那一支是 **route 層**的 in-memory
 * 替身（3.1 worker J 擁有），本檔服務的是 **job／reconciler 層**——需要一個會記錄
 * `anomaly()` 的 logger（reconciler 用它報 tick 失敗），以及 governed READY record 的
 * 建構器。合檔會讓兩個 slice 的替身互相牽動。
 */

export interface RecordedJobLog {
  level: "debug" | "info" | "warn" | "error" | "anomaly";
  component: string;
  msg: string;
  data?: Record<string, unknown>;
}

export interface FakeJobStructLogger {
  records: RecordedJobLog[];
  logger: StructLogger;
  /** 依 msg 子字串挑出紀錄，供斷言「這件事有被結構化記錄」。 */
  find(fragment: string): RecordedJobLog[];
}

/**
 * 不落磁碟的 StructLogger 替身（含 `anomaly`）。
 *
 * `fakeSourceBundleDeps.createFakeStructLogger` 沒有實作 `anomaly`，而 reconciler 的
 * tick 失敗路徑會呼叫它——沿用那一支會在「list 失敗」測試裡炸在替身而不是被測程式碼上。
 */
export function createFakeJobStructLogger(): FakeJobStructLogger {
  const records: RecordedJobLog[] = [];
  const push =
    (level: RecordedJobLog["level"]) =>
    (component: string, msg: string, data?: Record<string, unknown>): void => {
      records.push({ level, component, msg, data });
    };
  const logger = {
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: (component: string, msg: string, _err: unknown, data?: Record<string, unknown>) => {
      records.push({ level: "error", component, msg, data });
    },
    fatal: (component: string, msg: string, _err: unknown, data?: Record<string, unknown>) => {
      records.push({ level: "error", component, msg, data });
    },
    anomaly: (component: string, msg: string, data: Record<string, unknown>) => {
      records.push({ level: "anomaly", component, msg, data });
    },
    network: push("info"),
    audit: push("info"),
    lifecycle: push("info"),
  };
  return {
    records,
    // StructLogger 另有 service/runId/... 等唯讀成員，本層完全不碰；
    // 只實作被呼叫到的方法，其餘以 cast 表明「刻意不實作」。
    logger: logger as unknown as StructLogger,
    find(fragment: string): RecordedJobLog[] {
      return records.filter((item) => item.msg.includes(fragment));
    },
  };
}

/** 一筆語意完整的 governed READY record（欄位取自 3.1 route 實際會寫入的形狀）。 */
export function readyBundleRecord(
  overrides: Partial<SourceBundleRecord> = {},
): SourceBundleRecord {
  const observedAt = "2026-07-16T08:00:00.000Z";
  return {
    source_bundle_id: "source-bundle-test-0001",
    external_model_version_id: "model-version-test-0001",
    tenant_id: "tenant-test",
    project_id: "project-test",
    project_display_name: null,
    model_category: null,
    manifest_ref:
      "minio://edge-test-01/source-bundles-test/source-bundles/tenant-test/project-test/model-version-test/manifest.json?versionId=v-manifest-0001",
    manifest_sha256: "a".repeat(64),
    bundle_state: "READY",
    integrity_diagnostics: [],
    producer_id: "ifc-worker-test-01",
    producer_kind: "external_ifc_worker",
    claimed_at: "2026-07-16T07:58:12.500Z",
    validated_at: observedAt,
    pipeline_job_id: null,
    created_at: observedAt,
    updated_at: observedAt,
    ...overrides,
  };
}

/** 決定性 event id 產生器（測試不要亂數：ledger 斷言必須逐字可重現）。 */
export function sequentialEventIds(prefix = "evt"): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(4, "0")}`;
  };
}
