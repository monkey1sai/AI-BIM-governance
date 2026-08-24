// R8（2026-07-10 裁決）＋加性慣例（手冊 §1 第 13 條）：新 coordinator 端點進 routes/*.ts，
// 不 append app.ts 巨石（app.ts 已 4,243 行）。app.ts 只有 import ＋ 單行 mount，
// 比照 `routes/devMeta.ts` 的 `registerDevMetaRoutes` 先例。
//
// 範圍：`rvt-ifc-usdc-lineage` task 3.1 的 governed source-bundle intake 與讀取面。
//
// 邊界鐵律（design.md §11.2 規則 3／5、`local-coordinator-ifc-ready-intake-boundary`
// 的 governed 段）：
//   - governed intake 與 legacy `POST /api/external/ifc-ready` 是**兩個分離的 contract**，
//     MUST NOT 互相冒充；本檔完全不碰 legacy store／watcher／ledger／pipeline。
//   - `mw_<hash16>`（watcher 去重空間）與 `source_bundle_id`（governed 去重空間）
//     MUST NOT 互相取代、抑制或推導 —— 本檔只認 `source_bundle_id`。
//   - producer 的 ready claim **非權威**：route 只做 transport auth ＋ wire 形狀驗證，
//     `READY` 一律由 `validateSourceBundle` 對 MinIO 實讀重驗後決定。
import type express from "express";
import type { CoordinatorConfig } from "../config.js";
import { AuthError, type AuthProvider } from "../services/authProvider.js";
import {
  EXTERNAL_LINEAGE_DECISION_HEADER,
  LineageAuthorizationDeniedError,
  LineageAuthorizationUnavailableError,
  readSingleExternalLineageHeader,
  resolveExternalLineagePrincipal,
  verifyExternalLineageDecision,
  type ExternalLineageAuthorizationPort,
  type ExternalLineageRequestContext,
} from "../services/lineage/externalLineageAuthorization.js";
import type { StructLogger } from "../lib/structLog.js";
import { maskPresignedRef } from "../services/presignedRef.js";
import { nowIso } from "../utils/time.js";
import { validateSourceBundleReadyPayload } from "../services/lineage/sourceBundleReadyPayload.js";
import type { SourceBundleObjectPort } from "../services/lineage/sourceBundleObjectPort.js";
import {
  finalizeAdmissionOutcome,
  type BundleValidationResult,
  type validateSourceBundle,
} from "../services/lineage/sourceBundleValidator.js";
import type {
  SourceBundleRecord,
  SourceBundleStore,
} from "../services/lineage/sourceBundleStore.js";
import {
  confirmLegacyEnrollment,
  previewLegacyGrouping,
} from "../services/lineage/legacyEnrollment.js";
// rvt-ifc-usdc-lineage task 3.2：governed pipeline job 的唯讀投影。
import {
  toPipelineJobDocument,
  type PipelineJobStore,
} from "../services/lineage/pipelineJobStore.js";
import type { GovernedShadowMetadata } from "../types.js";

/** L1 `model_version_bundle_manifest.json` 的 envelope `schema_version`。 */
const MANIFEST_DOCUMENT_SCHEMA_VERSION = "model-version-bundle-manifest/v1";

/** L1 `source_bundle_ready.json` 的 `source_bundle_id.pattern`（route 端 id 守門同一把尺）。 */
const SOURCE_BUNDLE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * `pipeline_job_id` 的 route 端守門（task 3.2）。
 *
 * L1 的 `$defs/identifier` 只約束長度 1..200，沒有 charset；route param 收得比契約嚴
 * 是刻意的——實際產生的 id 是 `pj_<32 hex>`，把 path 參數限制在同一族字元可以讓
 * 「奇怪的 path 值」在打到 store 之前就 400，而不是變成一次無意義的查表。
 */
const PIPELINE_JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;

/** L1 `legacyUnmanagedPreview.requires_capability` / `legacyEnrollmentConfirmation.capability`。 */
const GOVERNED_ENROLLMENT_CAPABILITY = "bundle.publish";

const GROUPING_KEY_MAX_LENGTH = 512;

/** legacy `parseListLimit`（app.ts:4080）的同語意本地版本（module-private，未 export）。 */
function parseLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(100, Math.max(1, parsed));
}

/** app.ts 的 `headersToMap`（:4087）同語意本地版本；authProvider 只吃 lower-case map。 */
function headersToMap(headers: express.Request["headers"]): Record<string, string | undefined> {
  const headerMap: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    headerMap[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return headerMap;
}

/** app.ts 的 `RawBodyRequest`（:573）同語意本地宣告；HMAC 驗簽必須讀原始 bytes。 */
type RawBodyRequest = express.Request & { rawBody?: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function manifestDocument<T>(documentType: string, body: T): {
  schema_version: string;
  document_type: string;
  body: T;
} {
  return { schema_version: MANIFEST_DOCUMENT_SCHEMA_VERSION, document_type: documentType, body };
}

export interface LineageSourceBundleRouteDeps {
  config: CoordinatorConfig;
  authProvider: AuthProvider;
  store: SourceBundleStore;
  validator: typeof validateSourceBundle;
  /** MinIO governed 端未設定 → null → 一律 503（比照 `/api/conversion/trigger`）。 */
  objects: SourceBundleObjectPort | null;
  /** task 3.2 注入；未注入時 `enqueued_pipeline_job_id` 誠實維持 null（3.1 不偽造 job）。 */
  enqueue?: (record: SourceBundleRecord) => Promise<string>;
  /**
   * task 3.2 的 durable pipeline-job store（`/api/lineage/pipeline-jobs*` 的讀取面）。
   * 未注入＝job 面尚未接線 → 兩條讀取 route 一律 503（誠實停擺，不回空集合冒充「沒有 job」）。
   */
  jobs?: PipelineJobStore | null;
  rejectIfIpNotAllowed: (request: express.Request, response: express.Response) => boolean;
  structLog: StructLogger;
  /**
   * @internal additive 測試 seam：legacy preview 的推導函式。省略＝用 module 預設
   * （production 路徑），故 app.ts 的 mount 不需傳此欄。與 `validator` 同一注入風格，
   * 讓 route 層測試不必 `vi.mock` 整個模組（沿用 `minioWatchObjectStoreFactory` 的
   * seam-not-mock 慣例）。
   */
  previewLegacy?: typeof previewLegacyGrouping;
  /** @internal 同 `previewLegacy` 的 additive 測試 seam；省略＝用 module 預設。 */
  confirmLegacy?: typeof confirmLegacyEnrollment;
  /** External control-plane verifier. Omitted/null is an intentional 503 fail-closed seam. */
  authorization?: ExternalLineageAuthorizationPort | null;
}

/**
 * 把 service 層的 4xx 錯誤（帶 `httpStatus` ＋ `code`）映射成 wire 回應。
 *
 * 只認 4xx：allowlist 拒絕、port 回應異常、carve-out scope 違規這類**沒有** `httpStatus`
 * 或屬 5xx 的錯誤一律回 null，交給 error middleware 變 500。伺服器端的設定／程式錯誤
 * 不該被包裝成一個看起來像「請求有問題」的 4xx。
 */
function governedClientError(
  error: unknown,
): { status: number; code: string; detail: string } | null {
  if (typeof error !== "object" || error === null) return null;
  const { httpStatus, code } = error as { httpStatus?: unknown; code?: unknown };
  if (typeof httpStatus !== "number" || typeof code !== "string") return null;
  if (httpStatus < 400 || httpStatus > 499) return null;
  return {
    status: httpStatus,
    code,
    detail: error instanceof Error ? error.message : String(error),
  };
}

function externalLineageRequestContext(
  request: express.Request,
): ExternalLineageRequestContext {
  return {
    method: request.method.toUpperCase(),
    path: request.path,
    remote_address: request.ip || request.socket.remoteAddress || null,
    authorization: readSingleExternalLineageHeader({
      raw_headers: request.rawHeaders,
      header_name: "authorization",
      fallback: request.get("authorization") ?? null,
    }),
    dpop: readSingleExternalLineageHeader({
      raw_headers: request.rawHeaders,
      header_name: "dpop",
      fallback: request.get("dpop") ?? null,
    }),
  };
}

function toPublicRecord(record: SourceBundleRecord): SourceBundleRecord {
  // 契約已禁 presigned locator（wire validator 直接 400），此處仍過一次 mask：
  // 出口遮蔽是既有誠實鐵律，且對非 presigned ref 為 no-op（presignedRef.ts:18）。
  return { ...record, manifest_ref: maskPresignedRef(record.manifest_ref) };
}

/**
 * governed minimal shadow（`local-artifact-shadow-metadata` 的 governed 段）。
 *
 * D-6：**獨立於 legacy `ShadowMetadata`**。legacy 12 欄與
 * `GET /api/external/ifc-ready/:jobId/shadow` 逐字不動；governed 欄位不得塞進
 * `IfcReadyIntakeJob` / `ShadowMetadata`。3.1 只擁有 bundle 段的 identity／digest／
 * locator／state；`job_state`／`active_result_id` 等欄位屬 3.2／3.3，**不在此以 null 佔位**
 * （不存在的東西不宣告，誠實優先於欄位完整）。
 */
function toGovernedShadow(record: SourceBundleRecord): GovernedShadowMetadata {
  return {
    source_bundle_id: record.source_bundle_id,
    external_model_version_id: record.external_model_version_id,
    tenant_id: record.tenant_id,
    project_id: record.project_id,
    manifest_ref: maskPresignedRef(record.manifest_ref),
    manifest_sha256: record.manifest_sha256,
    bundle_state: record.bundle_state,
    pipeline_job_id: record.pipeline_job_id,
    claimed_at: record.claimed_at,
    validated_at: record.validated_at,
  };
}

export function registerLineageSourceBundleRoutes(
  app: express.Express,
  deps: LineageSourceBundleRouteDeps,
): void {
  const { config, structLog } = deps;

  // ── POST /api/external/source-bundles/ready ────────────────────────────────
  // governed ready claim（非權威）。順序：transport auth → wire 形狀 → MinIO 重驗 → 冪等 admit。
  //
  // auth 先於 payload（與 legacy `/api/external/ifc-ready` 的順序相反，刻意）：
  // 未通過 machine-to-machine 驗證的 caller 不應換到逐欄位的 schema 診斷。
  // authProvider 需要的三個 identity 直接從未驗證 body 讀（缺／非字串 → 401
  // `missing required identity`，與 legacy 對同三欄的行為逐字相同）。
  app.post("/api/external/source-bundles/ready", async (request, response, next) => {
    const rawBody = isPlainObject(request.body) ? request.body : {};
    let auth;
    try {
      auth = deps.authProvider.authenticate({
        clientIp: request.ip || request.socket.remoteAddress || "",
        headers: headersToMap(request.headers),
        // 驗簽讀原始 bytes，不由 parsed JSON 重組（與 app.ts:2062 同一 seam）。
        rawBody: (request as RawBodyRequest).rawBody ?? JSON.stringify(request.body ?? {}),
        payloadIdentity: {
          tenant_id: rawBody.tenant_id,
          project_id: rawBody.project_id,
          external_model_version_id: rawBody.external_model_version_id,
        },
      });
    } catch (error) {
      // registrar 自帶 AuthError 映射（不倚賴 app.ts 的 error middleware），
      // 使本檔在任何 express app 上掛載時行為一致、可被 route 層測試證明。
      if (error instanceof AuthError) {
        response.status(error.statusCode).json({ detail: error.message });
        return;
      }
      next(error);
      return;
    }

    const parsed = validateSourceBundleReadyPayload(request.body);
    if (!parsed.ok) {
      structLog.warn("sourceBundleReady", "governed ready claim rejected at wire validation", {
        correlation_id: auth.correlationId,
        reason: parsed.rejection.reason,
        pointer: parsed.rejection.pointer,
      });
      response.status(400).json({
        error: "invalid_payload",
        reason: parsed.rejection.reason,
        pointer: parsed.rejection.pointer,
      });
      return;
    }
    const payload = parsed.payload;

    if (!deps.objects) {
      // 誠實 fail-closed：沒有 governed MinIO 就無法重驗，claim 不得被當成 READY。
      response.status(503).json({
        error: "governed_source_store_unconfigured",
        detail:
          "governed MinIO 未設定（endpoint/credentials/authority allowlist/bucket allowlist 不齊全）",
      });
      return;
    }

    let result: BundleValidationResult;
    try {
      result = await deps.validator(
        {
          source_bundle_id: payload.source_bundle_id,
          manifest_ref: payload.manifest_ref,
          manifest_sha256: payload.manifest_sha256,
        },
        {
          objects: deps.objects,
          now: nowIso,
          sha256Mode: config.sourceBundleSha256VerifyMode,
          structLog,
        },
      );
    } catch (error) {
      next(error);
      return;
    }

    if (result.bundle_state !== "READY") {
      // NON_READY / LEGACY_UNMANAGED 一律不授予 governed identity、不落 store、不 enqueue。
      // `enqueued_pipeline_job_id` 在此強制為 null（L1 allOf：只有 READY 可持有 job）。
      structLog.info("sourceBundleReady", "governed ready claim is not ready", {
        correlation_id: auth.correlationId,
        source_bundle_id: payload.source_bundle_id,
        bundle_state: result.bundle_state,
        diagnostic_codes: result.integrity_diagnostics.map((diagnostic) => diagnostic.code),
      });
      response.status(422).json(
        manifestDocument("source_bundle_validation_result", {
          ...result,
          enqueued_pipeline_job_id: null,
        }),
      );
      return;
    }

    if (result.manifest_sha256 === null) {
      // L1：READY 分支的 manifest_sha256 必為字串。validator 自我矛盾時 fail-closed，
      // 不得把 contract-invalid 文件送上 wire。
      next(
        new Error(
          "sourceBundleValidator returned bundle_state=READY without a manifest digest (L1 bundleValidationResult READY branch requires manifest_sha256).",
        ),
      );
      return;
    }
    if (auth.externalModelVersionId !== result.external_model_version_id) {
      structLog.warn("sourceBundleReady", "authenticated ready identity mismatched manifest", {
        correlation_id: auth.correlationId,
        source_bundle_id: payload.source_bundle_id,
      });
      response.status(403).json({ error: "ready_identity_mismatch" });
      return;
    }

    const observedAt = result.observed_at;
    const candidate: SourceBundleRecord = {
      source_bundle_id: payload.source_bundle_id,
      // claim 非權威：identity 一律取 validator 由 manifest 實讀的值。
      external_model_version_id: result.external_model_version_id,
      tenant_id: auth.tenantId,
      project_id: auth.projectId,
      project_display_name: payload.project_display_name ?? null,
      model_category: payload.model_category ?? null,
      manifest_ref: payload.manifest_ref.ref,
      manifest_sha256: result.manifest_sha256,
      bundle_state: "READY",
      integrity_diagnostics: result.integrity_diagnostics,
      producer_id: payload.producer.producer_id,
      producer_kind: payload.producer.producer_kind,
      claimed_at: payload.claimed_at,
      validated_at: observedAt,
      pipeline_job_id: null,
      created_at: observedAt,
      updated_at: observedAt,
    };

    const admitted = deps.store.admit(candidate);
    const finalized = finalizeAdmissionOutcome(result, { outcome: admitted.outcome });
    if (finalized.bundle_state !== "READY") {
      // READY 後不可變（`minio-model-version-bundle`：同 id 異 bytes 必須開新 version）。
      // admission outcome 的唯一 wire mapping 由 validator helper 統一維護；route 不手抄
      // conditional_create/replay/diagnostics，避免 reconciler 與 claim 路徑漂移。
      structLog.warn("sourceBundleReady", "governed bundle overwrite rejected", {
        correlation_id: auth.correlationId,
        source_bundle_id: payload.source_bundle_id,
      });
      response.status(409).json(
        manifestDocument("source_bundle_validation_result", finalized),
      );
      return;
    }

    const replay = finalized.replay;
    let pipelineJobId = admitted.record.pipeline_job_id;
    if (deps.enqueue) {
      try {
        // 3.2 的 auto-enqueue 自身冪等（同 bundle 永遠同一 job）；3.1 只負責接線。
        pipelineJobId = await deps.enqueue(admitted.record);
        deps.store.bindPipelineJob(payload.source_bundle_id, pipelineJobId);
      } catch (error) {
        next(error);
        return;
      }
    }

    structLog.info("sourceBundleReady", "governed source bundle admitted", {
      correlation_id: auth.correlationId,
      source_bundle_id: payload.source_bundle_id,
      replay,
      pipeline_job_bound: pipelineJobId !== null,
    });
    response.status(replay ? 200 : 202).json(
      manifestDocument("source_bundle_validation_result", {
        ...finalized,
        replay,
        enqueued_pipeline_job_id: pipelineJobId,
      }),
    );
  });

  // ── GET /api/external/source-bundles ───────────────────────────────────────
  // 靜態路徑必須先於 `/:sourceBundleId` 註冊（同 app.ts:2122-2211 的既有註解）。
  // 唯讀、無 auth：比照 legacy `GET /api/external/ifc-ready` 的既有模式。
  app.get("/api/external/source-bundles", (request, response) => {
    const limit = parseLimit(request.query.limit);
    const records = deps.store
      .list()
      .slice()
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
    response.json({
      count: records.length,
      items: records.slice(0, limit).map(toPublicRecord),
    });
  });

  app.get("/api/external/source-bundles/:sourceBundleId", (request, response) => {
    const sourceBundleId = request.params.sourceBundleId;
    if (!SOURCE_BUNDLE_ID_PATTERN.test(sourceBundleId)) {
      response.status(400).json({ error: "invalid_source_bundle_id" });
      return;
    }
    const record = deps.store.get(sourceBundleId);
    if (!record) {
      response.status(404).json({ detail: "Governed source bundle not found." });
      return;
    }
    response.json({
      source_bundle: toPublicRecord(record),
      // 刻意**不**在 GET 重建 `source_bundle_validation_result` 文件：`replay` 與
      // `conditional_create` 是「單次 claim 當下的事實」，不是 store 狀態；重建等於捏造。
      // 這裡只投影 store 真的擁有的重驗結論。
      validation_summary: {
        bundle_state: record.bundle_state,
        manifest_present: true,
        manifest_sha256: record.manifest_sha256,
        integrity_diagnostics: record.integrity_diagnostics,
        enqueued_pipeline_job_id: record.pipeline_job_id,
        validated_at: record.validated_at,
      },
    });
  });

  app.get("/api/external/source-bundles/:sourceBundleId/shadow", (request, response) => {
    const sourceBundleId = request.params.sourceBundleId;
    if (!SOURCE_BUNDLE_ID_PATTERN.test(sourceBundleId)) {
      response.status(400).json({ error: "invalid_source_bundle_id" });
      return;
    }
    const record = deps.store.get(sourceBundleId);
    if (!record) {
      response.status(404).json({ detail: "Governed source bundle not found." });
      return;
    }
    response.json({
      governed_shadow_metadata: toGovernedShadow(record),
      data_plane_availability: {
        bundle_state: record.bundle_state,
        manifest_present: true,
        pipeline_job_bound: record.pipeline_job_id !== null,
      },
      // control-plane 權威歸屬說明：本地僅參照，不宣告權威（與 legacy shadow 同一段落）。
      control_plane_authority: {
        owner: "company-cloud-bim-control",
        referenced_by: "external_model_version_id",
        not_mirrored: true,
      },
    });
  });

  // ── GET /api/lineage/pipeline-jobs?source_bundle_id= ───────────────────────
  // rvt-ifc-usdc-lineage task 3.2 的 job 讀取面（唯讀，無 auth——比照本檔其他 GET
  // 與 legacy `GET /api/external/ifc-ready`）。
  //
  // 靜態路徑必須先於 `/:pipelineJobId` 註冊（同 app.ts:2122-2211 的既有坑）。
  //
  // 這條路由的存在意義是**讓 1:1 可被外部證明**：同一個 `source_bundle_id` 無論被
  // claim 幾次、經過幾次 restart，這裡永遠只會回同一個 `pipeline_job_id`。
  app.get("/api/lineage/pipeline-jobs", (request, response) => {
    if (!deps.jobs) {
      response.status(503).json({
        error: "pipeline_job_store_unavailable",
        detail: "governed pipeline job store 尚未接線",
      });
      return;
    }
    const raw = request.query.source_bundle_id;
    const sourceBundleId = typeof raw === "string" ? raw : "";
    // 刻意**不**提供「省略參數就列全部」的分支：job 讀取面只服務
    // 「這個 source bundle 的 job 是哪一個」這一個問題，不順手長出一個無界列表。
    if (!SOURCE_BUNDLE_ID_PATTERN.test(sourceBundleId)) {
      response.status(400).json({ error: "invalid_source_bundle_id" });
      return;
    }
    const record = deps.jobs.getBySourceBundle(sourceBundleId);
    if (!record) {
      response.status(404).json({ detail: "No governed pipeline job for this source bundle." });
      return;
    }
    response.json(toPipelineJobDocument(record));
  });

  // ── GET /api/lineage/pipeline-jobs/:pipelineJobId ──────────────────────────
  // 回 L1 `pipeline-job-attempt/v1` envelope，使 wire 可直接被 L1 schema 驗。
  // `ready_event_ledger` 原樣輸出（append-only evidence）：replay／restart 沒有建立
  // 第二個 logical job 這件事，必須看得見才算數。
  app.get("/api/lineage/pipeline-jobs/:pipelineJobId", (request, response) => {
    if (!deps.jobs) {
      response.status(503).json({
        error: "pipeline_job_store_unavailable",
        detail: "governed pipeline job store 尚未接線",
      });
      return;
    }
    const pipelineJobId = request.params.pipelineJobId;
    if (!PIPELINE_JOB_ID_PATTERN.test(pipelineJobId)) {
      response.status(400).json({ error: "invalid_pipeline_job_id" });
      return;
    }
    const record = deps.jobs.get(pipelineJobId);
    if (!record) {
      response.status(404).json({ detail: "Governed pipeline job not found." });
      return;
    }
    response.json(toPipelineJobDocument(record));
  });

  // ── GET /api/lineage/legacy-unmanaged/preview ──────────────────────────────
  // 唯讀 preview：`mutates_store` 恆 false（L1 const）。守門比照 `/api/conversion/*`
  // 控制路由（rejectIfIpNotAllowed）——它會打 MinIO，屬 control-plane 讀取面。
  app.get("/api/lineage/legacy-unmanaged/preview", async (request, response, next) => {
    if (deps.rejectIfIpNotAllowed(request, response)) return;
    const raw = request.query.grouping_key;
    const groupingKey = typeof raw === "string" ? raw.trim() : "";
    if (
      groupingKey.length === 0 ||
      groupingKey.length > GROUPING_KEY_MAX_LENGTH ||
      /[\r\n]/.test(groupingKey)
    ) {
      response.status(400).json({ error: "invalid_grouping_key" });
      return;
    }
    if (!deps.objects) {
      response.status(503).json({
        error: "governed_source_store_unconfigured",
        detail:
          "governed MinIO 未設定（endpoint/credentials/authority allowlist/bucket allowlist 不齊全）",
      });
      return;
    }
    try {
      const preview = await (deps.previewLegacy ?? previewLegacyGrouping)(groupingKey, {
        objects: deps.objects,
        legacyRootPrefix: config.governedSourcePrefix,
        now: nowIso,
      });
      if (preview.mutates_store !== false || preview.state !== "LEGACY_UNMANAGED") {
        // fail-closed：preview 宣稱寫入（或狀態不是 LEGACY_UNMANAGED）時，寧可 500 也不
        // 送出違反 L1 const 的文件。這條守衛讓「preview 不得改 MinIO」在 route 層可被 falsify。
        next(new Error("legacy preview violated its read-only contract (mutates_store/state)."));
        return;
      }
      response.json(manifestDocument("legacy_unmanaged_preview", preview));
    } catch (error) {
      next(error);
    }
  });

  // ── POST /api/lineage/legacy-unmanaged/confirm ─────────────────────────────
  // capability-gated 升格。**owner carve-out（2026-08-20 裁決）**：coordinator 取得對
  // governed source bundle `manifest.json` 這**單一 object key** 的 conditional create
  // 寫入權（`If-None-Match: *`），僅此一 key、僅本路徑；其餘 MinIO 寫入仍全面禁止
  // （正本：`bim-review-coordinator/AGENTS.md` Required Boundaries）。
  //
  // 順序：IP 守門 → grouping wire 形狀 → external principal/decision exact binding
  //      （adapter 未接 503、decision 缺失/過期 403，皆先於任何 MinIO 動作）
  //      → governed MinIO 未設定 503 → service。Body 中舊 subject/capability/ref 僅為
  //      相容輸入，不能取代 verified principal/decision，也不會進 service/audit。
  // 狀態碼：created → 200、conflict → 409，**兩者 body 都是** L1
  // `legacy_enrollment_confirmation` envelope（衝突是契約內的合法結果，不是錯誤格式）。
  app.post("/api/lineage/legacy-unmanaged/confirm", async (request, response, next) => {
    if (deps.rejectIfIpNotAllowed(request, response)) return;
    const body = isPlainObject(request.body) ? request.body : {};
    const groupingKey = typeof body.grouping_key === "string" ? body.grouping_key.trim() : "";

    if (
      groupingKey.length === 0 ||
      groupingKey.length > GROUPING_KEY_MAX_LENGTH ||
      /[\r\n]/.test(groupingKey)
    ) {
      response.status(400).json({ error: "invalid_grouping_key" });
      return;
    }
    const authorizationNow = nowIso();
    let confirmedBySubject: string;
    let authorizationDecisionRef: string;
    try {
      const context = externalLineageRequestContext(request);
      const principal = await resolveExternalLineagePrincipal({
        authorization: deps.authorization ?? null,
        request: context,
        now: authorizationNow,
      });
      const decision = await verifyExternalLineageDecision({
        authorization: deps.authorization ?? null,
        request: context,
        opaque_decision: readSingleExternalLineageHeader({
          raw_headers: request.rawHeaders,
          header_name: EXTERNAL_LINEAGE_DECISION_HEADER,
          fallback: request.get(EXTERNAL_LINEAGE_DECISION_HEADER) ?? null,
        }),
        expected: {
          capability: GOVERNED_ENROLLMENT_CAPABILITY,
          principal_subject: principal.subject,
          method: "POST",
          path: "/api/lineage/legacy-unmanaged/confirm",
          resource: { kind: "legacy_bundle_enrollment", grouping_key: groupingKey },
        },
        principal,
        now: authorizationNow,
      });
      confirmedBySubject = principal.subject;
      authorizationDecisionRef = decision.authorization_decision_ref;
    } catch (error) {
      if (error instanceof LineageAuthorizationUnavailableError) {
        response.status(503).json({ error: error.code });
        return;
      }
      if (error instanceof LineageAuthorizationDeniedError) {
        response.status(403).json({ error: error.code });
        return;
      }
      next(error);
      return;
    }
    if (!deps.objects) {
      response.status(503).json({
        error: "governed_source_store_unconfigured",
        detail:
          "governed MinIO 未設定（endpoint/credentials/authority allowlist/bucket allowlist 不齊全）",
      });
      return;
    }

    let confirmation;
    try {
      confirmation = await (deps.confirmLegacy ?? confirmLegacyEnrollment)(
        { groupingKey, confirmedBySubject, authorizationDecisionRef },
        {
          objects: deps.objects,
          legacyRootPrefix: config.governedSourcePrefix,
          now: nowIso,
          structLog,
          store: deps.store,
          validator: deps.validator,
          sha256Mode: config.sourceBundleSha256VerifyMode,
        },
      );
    } catch (error) {
      const mapped = governedClientError(error);
      if (mapped) {
        structLog.warn("legacyEnrollment", "confirm rejected", {
          reason: mapped.code,
          status: mapped.status,
        });
        response.status(mapped.status).json({ error: mapped.code, detail: mapped.detail });
        return;
      }
      next(error);
      return;
    }

    const created = confirmation.conditional_create.outcome === "created";
    if (
      confirmation.capability !== GOVERNED_ENROLLMENT_CAPABILITY ||
      (created && confirmation.created_source_bundle_id === null) ||
      (!created && (confirmation.created_source_bundle_id !== null || !confirmation.retryable))
    ) {
      // fail-closed：不送出違反 L1 `legacyEnrollmentConfirmation` allOf 的文件
      //（created ⇒ id 非 null；conflict ⇒ id null ∧ retryable true）。與 preview 的
      // `mutates_store` 守衛同一個理由：契約不變式要在 route 層可被 falsify。
      next(
        new Error(
          "legacy enrollment confirmation violated its L1 invariants (capability / created_source_bundle_id / retryable).",
        ),
      );
      return;
    }
    response
      .status(created ? 200 : 409)
      .json(manifestDocument("legacy_enrollment_confirmation", confirmation));
  });
}
