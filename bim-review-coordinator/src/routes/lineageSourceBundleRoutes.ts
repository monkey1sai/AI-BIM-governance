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
import type { StructLogger } from "../lib/structLog.js";
import { maskPresignedRef } from "../services/presignedRef.js";
import { nowIso } from "../utils/time.js";
import { validateSourceBundleReadyPayload } from "../services/lineage/sourceBundleReadyPayload.js";
import type { SourceBundleObjectPort } from "../services/lineage/sourceBundleObjectPort.js";
import type {
  BundleValidationResult,
  validateSourceBundle,
} from "../services/lineage/sourceBundleValidator.js";
import type {
  SourceBundleRecord,
  SourceBundleStore,
} from "../services/lineage/sourceBundleStore.js";
import { previewLegacyGrouping } from "../services/lineage/legacyEnrollment.js";
import type { GovernedShadowMetadata } from "../types.js";

/** L1 `model_version_bundle_manifest.json` 的 envelope `schema_version`。 */
const MANIFEST_DOCUMENT_SCHEMA_VERSION = "model-version-bundle-manifest/v1";

/** L1 `source_bundle_ready.json` 的 `source_bundle_id.pattern`（route 端 id 守門同一把尺）。 */
const SOURCE_BUNDLE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

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
  rejectIfIpNotAllowed: (request: express.Request, response: express.Response) => boolean;
  structLog: StructLogger;
  /**
   * @internal additive 測試 seam：legacy preview 的推導函式。省略＝用 module 預設
   * （production 路徑），故 app.ts 的 mount 不需傳此欄。與 `validator` 同一注入風格，
   * 讓 route 層測試不必 `vi.mock` 整個模組（沿用 `minioWatchObjectStoreFactory` 的
   * seam-not-mock 慣例）。
   */
  previewLegacy?: typeof previewLegacyGrouping;
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
    if (
      result.conditional_create.outcome !== "created" &&
      result.conditional_create.outcome !== "already_exists_same_digest"
    ) {
      // 同上：L1 READY 分支只允許這兩個 outcome。producer 路徑（manifest 由 producer
      // 建立、coordinator 只觀察）的誠實值是 `{attempted:false, outcome:"already_exists_same_digest"}`。
      next(
        new Error(
          `sourceBundleValidator returned bundle_state=READY with conditional_create.outcome="${result.conditional_create.outcome}" (L1 READY branch allows only created / already_exists_same_digest).`,
        ),
      );
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
    if (admitted.outcome === "conflict_different_digest") {
      // READY 後不可變（`minio-model-version-bundle`：同 id 異 bytes 必須開新 version）。
      // 送出的文件必須自洽：降為 NON_READY ＋ 診斷，否則違反 L1「READY 不得帶診斷」。
      structLog.warn("sourceBundleReady", "governed bundle overwrite rejected", {
        correlation_id: auth.correlationId,
        source_bundle_id: payload.source_bundle_id,
      });
      response.status(409).json(
        manifestDocument("source_bundle_validation_result", {
          ...result,
          bundle_state: "NON_READY",
          replay: false,
          enqueued_pipeline_job_id: null,
          conditional_create: {
            attempted: result.conditional_create.attempted,
            outcome: "conflict_different_digest",
          },
          integrity_diagnostics: [
            ...result.integrity_diagnostics,
            {
              code: "immutable_bundle_overwrite_rejected" as const,
              role: null,
              expected: admitted.record.manifest_sha256,
              observed: result.manifest_sha256,
              detail:
                "same source_bundle_id already admitted with a different manifest digest; a new governed version is required",
            },
          ],
        }),
      );
      return;
    }

    const replay = admitted.outcome === "replay_same_digest";
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
        ...result,
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
  // coordinator 裁決 D-4（preview-only）＋ D-5（capability 最小 gate）：
  //   - 端點存在且 fail-closed 可測，不靜默 404，也不假裝成功；
  //   - 缺 `authorization_decision_ref` 或 capability 不符 → 403（先於 501，讓授權面可被證明）；
  //   - 通過最小 gate 後回 501 `awaiting_owner_carveout`：coordinator 對 MinIO 的
  //     **寫入權責**（conditional-create `manifest.json`）尚未取得 owner carve-out
  //     （`bim-review-coordinator/AGENTS.md` 目前只有 IFC 下載的讀取 carve-out）。
  //   - 本端點在此裁決下 **不呼叫** `confirmLegacyEnrollment`，也不回傳
  //     `legacy_enrollment_confirmation` 文件（沒發生的事不得產出契約文件）。
  app.post("/api/lineage/legacy-unmanaged/confirm", (request, response) => {
    if (deps.rejectIfIpNotAllowed(request, response)) return;
    const body = isPlainObject(request.body) ? request.body : {};
    const groupingKey = typeof body.grouping_key === "string" ? body.grouping_key.trim() : "";
    const confirmedBySubject =
      typeof body.confirmed_by_subject === "string" ? body.confirmed_by_subject.trim() : "";
    const capability = typeof body.capability === "string" ? body.capability.trim() : "";
    const authorizationDecisionRef =
      typeof body.authorization_decision_ref === "string"
        ? body.authorization_decision_ref.trim()
        : "";

    if (groupingKey.length === 0 || groupingKey.length > GROUPING_KEY_MAX_LENGTH) {
      response.status(400).json({ error: "invalid_grouping_key" });
      return;
    }
    if (confirmedBySubject.length === 0 || confirmedBySubject.length > 200) {
      response.status(400).json({ error: "invalid_confirmed_by_subject" });
      return;
    }
    if (capability !== GOVERNED_ENROLLMENT_CAPABILITY || authorizationDecisionRef.length === 0) {
      structLog.warn("legacyEnrollment", "confirm rejected: missing capability decision", {
        grouping_key_present: true,
        capability_matched: capability === GOVERNED_ENROLLMENT_CAPABILITY,
        authorization_decision_ref_present: authorizationDecisionRef.length > 0,
      });
      response.status(403).json({
        error: "authorization_decision_required",
        detail:
          "legacy enrollment 需要 capability `bundle.publish` 與非空 `authorization_decision_ref`",
        required_capability: GOVERNED_ENROLLMENT_CAPABILITY,
        // 誠實標記：真正的 external control-plane decision 驗證（issuer／signature／
        // expiry／不可達 fail closed）屬 `lineage-governance-console`（task 3.3/3.4）。
        authorization_verification: "minimal_gate_only",
      });
      return;
    }

    response.status(501).json({
      error: "awaiting_owner_carveout",
      detail:
        "legacy enrollment confirm 需要 coordinator 對 MinIO 的 manifest.json 寫入權責 carve-out；本 slice 只提供唯讀 preview",
      required_capability: GOVERNED_ENROLLMENT_CAPABILITY,
      authorization_verification: "minimal_gate_only",
      mutates_store: false,
    });
  });
}
