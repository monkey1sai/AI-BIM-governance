import express from "express";
import type { StructLogger } from "../../src/lib/structLog.js";
import { AuthError } from "../../src/services/authProvider.js";
import type { SourceBundleObjectPort } from "../../src/services/lineage/sourceBundleObjectPort.js";
import type {
  SourceBundleRecord,
  SourceBundleStore,
} from "../../src/services/lineage/sourceBundleStore.js";
import type {
  BundleValidationResult,
  validateSourceBundle,
} from "../../src/services/lineage/sourceBundleValidator.js";
import type { LegacyUnmanagedPreview } from "../../src/services/lineage/legacyEnrollment.js";
import {
  registerLineageSourceBundleRoutes,
  type LineageSourceBundleRouteDeps,
} from "../../src/routes/lineageSourceBundleRoutes.js";

/**
 * governed source-bundle **route 層**測試替身（worker J 自有，不依賴 worker I 的實作）。
 *
 * 為什麼是 in-memory 替身而不是真 service：3.1 的 route 契約（狀態碼映射、冪等語意、
 * fail-closed 守衛、envelope 形狀）必須能在 service 尚未落地時獨立被證明；service 本身的
 * 正確性由 worker I 的 `tests/lineage/source-bundle-validator.test.ts` 等檔覆蓋。
 *
 * 沿用 repo 既有慣例：以 **seam 注入**替換依賴，不 `vi.mock` 整個模組
 * （見 `tests/helpers/fakeObjectStore.ts` 的同一段理由）。
 */

// ── struct log ───────────────────────────────────────────────────────────────

export interface RecordedLog {
  level: "debug" | "info" | "warn" | "error" | "fatal";
  component: string;
  msg: string;
  data?: Record<string, unknown>;
}

export interface FakeStructLogger {
  records: RecordedLog[];
  logger: StructLogger;
}

/** 不落磁碟的 StructLogger 替身；只記錄呼叫，供斷言「拒絕有被結構化記錄」。 */
export function createFakeStructLogger(): FakeStructLogger {
  const records: RecordedLog[] = [];
  const push = (level: RecordedLog["level"]) =>
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
      records.push({ level: "fatal", component, msg, data });
    },
    network: (component: string, msg: string, data: Record<string, unknown>) => {
      records.push({ level: "info", component, msg, data });
    },
  };
  // StructLogger 另有 service/runId/currentFile/... 等唯讀成員，route 層完全不碰；
  // 這裡只實作被呼叫到的方法，其餘以 cast 表明「刻意不實作」。
  return { records, logger: logger as unknown as StructLogger };
}

// ── source bundle store ──────────────────────────────────────────────────────

export interface FakeSourceBundleStore {
  /** 每次 admit 傳入的 record（含被拒絕的），供斷言 route 寫進去的欄位來源。 */
  admitInputs: SourceBundleRecord[];
  bindCalls: Array<{ sourceBundleId: string; pipelineJobId: string }>;
  seed(record: SourceBundleRecord): void;
  asStore(): SourceBundleStore;
}

/**
 * 真實 admit 語意的 in-memory 版本：同 id 同 digest → replay；同 id 異 digest → conflict。
 * （`SourceBundleStore` 是 class，結構型別不保證相容 private 成員，故以 cast 供給 deps；
 * route 只使用其公開方法。）
 */
export function createFakeSourceBundleStore(): FakeSourceBundleStore {
  const records = new Map<string, SourceBundleRecord>();
  const admitInputs: SourceBundleRecord[] = [];
  const bindCalls: Array<{ sourceBundleId: string; pipelineJobId: string }> = [];

  const store = {
    get(sourceBundleId: string): SourceBundleRecord | null {
      const hit = records.get(sourceBundleId);
      return hit ? { ...hit } : null;
    },
    list(): SourceBundleRecord[] {
      return Array.from(records.values()).map((record) => ({ ...record }));
    },
    admit(record: SourceBundleRecord): {
      outcome: "created" | "replay_same_digest" | "conflict_different_digest";
      record: SourceBundleRecord;
    } {
      admitInputs.push({ ...record });
      const existing = records.get(record.source_bundle_id);
      if (!existing) {
        records.set(record.source_bundle_id, { ...record });
        return { outcome: "created", record: { ...record } };
      }
      if (existing.manifest_sha256 !== record.manifest_sha256) {
        // 衝突時回傳「被保留的既有 record」——route 以它的 digest 當 diagnostic 的 expected。
        return { outcome: "conflict_different_digest", record: { ...existing } };
      }
      return { outcome: "replay_same_digest", record: { ...existing } };
    },
    bindPipelineJob(sourceBundleId: string, pipelineJobId: string): SourceBundleRecord | null {
      bindCalls.push({ sourceBundleId, pipelineJobId });
      const existing = records.get(sourceBundleId);
      if (!existing) return null;
      existing.pipeline_job_id = pipelineJobId;
      return { ...existing };
    },
  };

  return {
    admitInputs,
    bindCalls,
    seed(record: SourceBundleRecord): void {
      records.set(record.source_bundle_id, { ...record });
    },
    asStore(): SourceBundleStore {
      return store as unknown as SourceBundleStore;
    },
  };
}

// ── object port ──────────────────────────────────────────────────────────────

export interface FakeSourceBundleObjectPort extends SourceBundleObjectPort {
  /** 任何寫入嘗試的計數（preview-only 斷言的關鍵：必須恆為 0）。 */
  writeAttempts: number;
  destroyCalls: number;
}

export function createFakeSourceBundleObjectPort(): FakeSourceBundleObjectPort {
  const port: FakeSourceBundleObjectPort = {
    writeAttempts: 0,
    destroyCalls: 0,
    async headVersioned() {
      return null;
    },
    async listObjectsUnder() {
      return [];
    },
    async sha256Versioned() {
      return "0".repeat(64);
    },
    async getBytesVersioned() {
      return Buffer.alloc(0);
    },
    async putIfAbsent() {
      port.writeAttempts += 1;
      return { outcome: "conflict_existing_manifest" };
    },
    async listVersionPrefixes() {
      return [];
    },
    destroy() {
      port.destroyCalls += 1;
    },
  };
  return port;
}

// ── validator ────────────────────────────────────────────────────────────────

export type ValidatorClaim = Parameters<typeof validateSourceBundle>[0];

/** L1 READY 分支自洽的最小結果：零診斷、manifest_present、conditional_create 合法。 */
export function readyResultFor(
  claim: ValidatorClaim,
  overrides: Partial<BundleValidationResult> = {},
): BundleValidationResult {
  return {
    source_bundle_id: claim.source_bundle_id,
    external_model_version_id: "model-version-20260715-001",
    manifest_sha256: claim.manifest_sha256,
    manifest_present: true,
    bundle_state: "READY",
    // producer 路徑：manifest 由 producer 建立，coordinator 只觀察到「已存在且 digest 相同」。
    conditional_create: { attempted: false, outcome: "already_exists_same_digest" },
    replay: false,
    enqueued_pipeline_job_id: null,
    integrity_diagnostics: [],
    observed_at: "2026-07-16T08:00:00.000Z",
    ...overrides,
  };
}

export function createStubValidator(
  respond: (claim: ValidatorClaim) => BundleValidationResult | Promise<BundleValidationResult>,
): typeof validateSourceBundle {
  return async (claim) => respond(claim);
}

// ── legacy preview ───────────────────────────────────────────────────────────

export function legacyPreviewFor(
  groupingKey: string,
  overrides: Partial<LegacyUnmanagedPreview> = {},
): LegacyUnmanagedPreview {
  return {
    grouping_key: groupingKey,
    state: "LEGACY_UNMANAGED",
    candidate_metadata: {
      external_model_version_id: null,
      tenant_id: "tenant-a",
      project_id: "project-library",
      project_display_name: null,
      model_category: null,
      candidate_artifacts: [
        { role: "source_ifc", ref: "minio://edge-tpe-01/legacy/tenant-a/model.ifc" },
      ],
    },
    differences: [
      {
        field: "manifest",
        difference_kind: "missing_manifest",
        candidate_value: null,
        governed_value: null,
      },
    ],
    mutates_store: false,
    requires_capability: "bundle.publish",
    observed_at: "2026-07-16T08:00:00.000Z",
    ...overrides,
  };
}

// ── bare express app ─────────────────────────────────────────────────────────

type RawBodyRequest = express.Request & { rawBody?: string };

/**
 * 只掛 registrar 的最小 express app：middleware 與 error handler 逐字對齊 app.ts
 * （`express.json({limit:"1mb", verify})` 的 rawBody seam ＋ AuthError → statusCode），
 * 讓 route 契約可以在不啟動整個 coordinator 的情況下被證明。
 */
export function createLineageTestApp(deps: LineageSourceBundleRouteDeps): express.Express {
  const app = express();
  app.use(
    express.json({
      limit: "1mb",
      verify: (request, _response, buffer) => {
        (request as RawBodyRequest).rawBody = buffer.toString("utf8");
      },
    }),
  );
  registerLineageSourceBundleRoutes(app, deps);
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof AuthError) {
        response.status(error.statusCode).json({ detail: error.message });
        return;
      }
      response.status(500).json({ detail: error instanceof Error ? error.message : String(error) });
    },
  );
  return app;
}
