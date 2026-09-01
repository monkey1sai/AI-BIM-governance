import fs from "node:fs";
import { randomBytes } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { z } from "zod";
import type { CoordinatorConfig } from "./config.js";
import { loadConfig } from "./config.js";
import {
  AuthError,
  createAuthProvider,
  createUserAuthProvider,
  isIpAllowed,
  opaqueLocalDevSubject,
} from "./services/authProvider.js";
import {
  createConversionControlGuard,
  isOperatorTokenPathEnabled,
  OPERATOR_TOKEN_RATE_LIMIT,
  OPERATOR_TOKEN_RATE_WINDOW_MS,
  SlidingWindowRateLimiter,
} from "./services/conversionControlAuthorization.js";
import { CallbackOutbox, MetadataOnlyViolation } from "./services/callbackOutbox.js";
import { EventLog } from "./services/eventLog.js";
import { GovernanceLibraryHttpAdapter } from "./services/governanceLibraryHttpAdapter.js";
import { GovernanceLibraryWorkflow } from "./services/governanceLibraryWorkflow.js";
import {
  createLogger,
  persistRecordsToServicePaths,
  validateLogRecordBasic,
  type LogRecord,
  type StructLogger,
} from "./lib/structLog.js";
import { ExternalIfcReadyStore } from "./services/externalIfcReadyStore.js";
import {
  createMinioWatchSurface,
  type MinioWatchSurface,
} from "./services/minioWatchSurface.js";
import { type ObjectStorePort } from "./services/minioObjectStore.js";
import { ConversionDispatchQueue } from "./services/conversionDispatchQueue.js";
import { ConversionLedger } from "./services/conversionLedger.js";
import {
  IfcReadyConversionPipeline,
  type ConversionTerminalEvent,
} from "./services/ifcReadyConversionPipeline.js";
import {
  ArtifactHealthLedger,
  toCloudProjection,
  type EdgeArtifactKind,
  type EdgeArtifactRecord,
  type EdgeArtifactStatus,
} from "./services/artifactHealthLedger.js";
import { checkSourceIfcPath, probeArtifactHealth } from "./services/artifactHealthProbe.js";
import { deriveLifecycleStatus } from "./services/lifecycleStatus.js";
import { deriveFailure } from "./services/failureReason.js";
import { deriveConversionRecoveryAction } from "./services/conversionRecoveryAction.js";
import { maskPresignedRef } from "./services/presignedRef.js";
import {
  registerGovernanceProxy,
  type RuleRunSessionResolution,
  type RuleRunSourceMetadata,
} from "./routes/governanceProxy.js";
import {
  registerA4SearchRoutes,
  type A4SearchIfcReadyResolution,
  type A4SearchPrincipal,
  type A4SearchPrincipalResolution,
  type A4SearchSessionResolution as A4SearchRouteSessionResolution,
} from "./routes/a4SearchRoutes.js";
import { registerA4IssueRoutes } from "./routes/a4IssueRoutes.js";
import {
  registerA4HandoffRoutes,
  type A4SearchSessionResolution,
} from "./routes/a4HandoffRoutes.js";
// R8＋加性慣例（手冊 §1.13）：devMeta 為 routes/*.ts 模組，app.ts 僅此 import＋單行 mount。
import { registerDevMetaRoutes } from "./routes/devMeta.js";
import { registerHealthProbeRoutes } from "./routes/healthProbeRoutes.js";
import { registerStreamConfigRoutes } from "./routes/streamConfigRoutes.js";
// rvt-ifc-usdc-lineage task 3.1：governed source-bundle intake／讀取面。同一加性慣例——
// app.ts 只有 import ＋ 一段 mount，路由本體在 routes/lineageSourceBundleRoutes.ts。
import { registerLineageSourceBundleRoutes } from "./routes/lineageSourceBundleRoutes.js";
import { registerLineageArtifactDownloadRoutes } from "./routes/lineageArtifactDownloadRoutes.js";
import { registerLineageGovernanceMetadataRoutes } from "./routes/lineageGovernanceMetadataRoutes.js";
import { registerLineageResultRoutes } from "./routes/lineageResultRoutes.js";
import {
  SourceBundleStore,
  type SourceBundleRecord,
} from "./services/lineage/sourceBundleStore.js";
import { validateSourceBundle } from "./services/lineage/sourceBundleValidator.js";
import {
  createS3SourceBundleObjectPort,
  type SourceBundleObjectPort,
} from "./services/lineage/sourceBundleObjectPort.js";
// rvt-ifc-usdc-lineage task 3.2：durable stable pipeline job ＋ idempotent auto-enqueue
// ＋ 撿漏用的 polling reconciliation（預設關閉）。
import { PipelineJobStore } from "./services/lineage/pipelineJobStore.js";
import { PipelineResultStore } from "./services/lineage/pipelineResultStore.js";
// rvt-ifc-usdc-lineage task 3.3 收尾刀：result manifest 的生產 registration／detail 面。
// 兩者共用 `pipelineResultManifest.ts` 的同一條讀取＋驗證管道（不會長出兩套 parse）。
import {
  createPipelineResultRegistrationService,
  type PipelineResultRegistrationService,
} from "./services/lineage/pipelineResultRegistration.js";
import {
  createS3LineageArtifactDownloadSigner,
  parseLineageArtifactDownloadTargetPolicies,
  type LineageArtifactDownloadSignerPort,
  type LineageArtifactDownloadTargetPolicy,
} from "./services/lineage/lineageArtifactDownloadSigner.js";
import {
  createS3PipelineResultArtifactReader,
  type PipelineResultArtifactReaderPort,
} from "./services/lineage/pipelineResultArtifactReader.js";
import {
  createS3LineageMetadataProjectionReader,
  type LineageMetadataProjectionReaderPort,
} from "./services/lineage/lineageMetadataProjections.js";
import {
  createS3PipelineResultDetailReader,
  type PipelineResultDetailReaderPort,
} from "./services/lineage/pipelineResultDetailReader.js";
import {
  autoEnqueueGovernedBundle,
  newReadyEventId,
} from "./services/lineage/pipelineJobEnqueue.js";
import {
  createSourceBundleReconciler,
  type SourceBundleReconciler,
} from "./services/lineage/sourceBundleReconciler.js";
import { ViewerLeaseStore, publicLease } from "./services/viewerLeaseStore.js";
import {
  RuntimeMutationAuthority,
  type RuntimeStageComposition,
} from "./services/runtimeMutationAuthority/runtimeMutationAuthority.js";
import {
  StreamingConversionClient,
  buildQualityMetricsSummary,
} from "./services/streamingConversionClient.js";
import {
  allocateKitInstanceBindings,
  allocateLocalKitInstance,
  legacyKitInstanceFromBinding,
  markKitBindingsDraining,
  releaseKitBindings,
} from "./services/kitPool.js";
import {
  isCanonicalSessionTraceId,
  isSafeSessionId,
  isSessionMutable,
  SessionStore,
} from "./services/sessionStore.js";
import { SessionTraceResolver, type SessionTracePlan } from "./services/sessionTraceResolver.js";
import { SessionIdleReclaimService } from "./services/sessionIdleReclaimService.js";
import { registerReviewNamespace } from "./socket/reviewNamespace.js";
import { registerConsoleRoutes } from "./routes/consoleRoutes.js";
import { buildRuntimeStatus, expectedStageBinding, summarizeIfcReadyJob } from "./runtimeStatus.js";
import {
  buildArtifactBindings,
  buildStreamConfig,
  chooseReadyUsdc,
  runtimeKitInstanceBindings,
} from "./streamConfig.js";
import { nowIso } from "./utils/time.js";
import type {
  Artifact,
  ArtifactBinding,
  ArtifactHealthSnapshot,
  ConversionQualityMetricsSummary,
  ExternalIfcReadyEvent,
  IfcReadyIntakeJob,
  ReviewSession,
} from "./types.js";

// m2a-coverage-report:conversion job id safe-id（比照後端 _safe_id 的 ^[A-Za-z0-9_.-]+$）。
// 不可複用 isSafeSessionId —— 其 pattern 只認 ^review_session_,擋掉 stream_conv_*。
const conversionJobIdPattern = /^[A-Za-z0-9_.-]+$/;
export function isSafeConversionJobId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && conversionJobIdPattern.test(value);
}

// conv-prioritize-retry:ifc_ready_job_id 形狀 ifcready_<ts>_<hex>，落在同一通用字元集。
// 為語意清楚另命名；實作共用 isSafeConversionJobId 的 regex。
export function isSafeIfcReadyJobId(value: string): boolean {
  return isSafeConversionJobId(value);
}

const createSessionSchema = z.object({
  review_request_id: z.string().min(1).optional(),
  tenant_id: z.string().min(1).default("tenant_demo_001"),
  project_id: z.string().min(1),
  model_version_id: z.string().min(1),
  // A3 federation → session 一鍵鏈：governance proxy 對瀏覽器遮蔽絕對路徑（"[server-path]"），
  // 瀏覽器只送 set id，coordinator server-side 向 governance 解析真 federated_review.usda。
  federated_set_id: z.string().min(1).max(200).optional(),
  source_artifact_id: z.string().min(1).optional(),
  usdc_artifact_id: z.string().min(1).optional(),
  created_by: z.string().min(1).default("dev_user_001"),
  mode: z.string().min(1).default("single_kit_shared_state"),
  routing_policy: z.enum(["same_instance", "dedicated_instance", "shared_state"]).default("same_instance"),
  artifact_bindings: z
    .array(
      z
        .object({
          binding_id: z.string().optional(),
          artifact_group_id: z.string().min(1),
          model_version_id: z.string().min(1).optional(),
          artifact_id: z.string().min(1),
          display_name: z.string().nullable().optional(),
          source_ifc_filename: z.string().nullable().optional(),
          artifact_role: z.enum(["source", "derived", "overlay", "mapping"]).default("derived"),
          url: z.string().nullable().optional(),
          mapping_url: z.string().nullable().optional(),
          load_order: z.number().int().nonnegative().default(0),
          routing_policy: z.enum(["same_instance", "dedicated_instance", "shared_state"]).optional(),
          ready_status: z
            .enum(["ready", "missing_model", "missing_mapping", "blocked_conversion", "converting", "failed"])
            .default("ready"),
          conversion_authority: z.string().nullable().optional(),
          conversion_job_id: z.string().nullable().optional(),
          conversion_status: z.string().nullable().optional(),
          failure_code: z.string().nullable().optional(),
          diagnostic: z.string().nullable().optional(),
        })
        .passthrough(),
    )
    .default([]),
  kit_profile: z.record(z.unknown()).default({}),
  options: z
    .object({
      auto_allocate_kit: z.boolean().optional(),
    })
    .optional(),
  // Additive pass-through; coordinator does not compute, cache, or modify these values.
  // Strictly optional — viewer falls back to dev-only worker fetch when omitted.
  quality_metrics_summary: z
    .object({
      fixture_name: z.string().nullish(),
      conversion_job_id: z.string().nullish(),
      artifact_group_id: z.string().nullish(),
      source_ifc_entity_count: z.number().nullish(),
      sidecar_carrier_count: z.number().nullish(),
      materialization_strategy: z.string().nullish(),
      coverage_ratio: z.number().nullish(),
      coverage_status: z.string().nullish(),
      conversion_duration_seconds: z.number().nullish(),
      // coordinator-forward-quality-metrics-summary:C1 三個 semantic 欄位
      semantic_mapping_fidelity: z.string().nullish(),
      mapping_has_ifc_type: z.boolean().nullish(),
      mapping_has_ifc_name: z.boolean().nullish(),
    })
    .passthrough()
    .nullish(),
});

const participantSchema = z.object({
  user_id: z.string().min(1),
  display_name: z.string().optional(),
});

const claimViewerLeaseSchema = z.object({
  viewer_id: z.string().trim().min(1).max(200),
  user_id: z.string().trim().min(1).max(200).optional(),
  display_name: z.string().trim().max(200).nullish(),
  requested_role: z.enum(["auto", "primary", "spectator"]).default("auto"),
  client_nonce: z.string().trim().max(200).nullish(),
  preferred_kit_instance_id: z.string().trim().max(200).nullish(),
});

const safeCommandIdSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const stageArtifactSelectionSchema = z.object({
  artifact_id: z.string().trim().min(1).max(200),
  role: z.enum(["primary", "secondary"]),
  load_order: z.number().int().nonnegative().max(10_000),
}).strict();
const stageBindingPreauthorizationSchema = z.object({
  source_client_id: z.string().trim().min(1).max(200),
  role: z.literal("primary"),
  client_request_id: safeCommandIdSchema.optional(),
  artifacts: z.array(stageArtifactSelectionSchema).min(1).max(64),
}).strict();
const stageBindingPreauthorizationCancellationSchema = z.object({
  source_client_id: z.string().trim().min(1).max(200),
  client_request_id: safeCommandIdSchema,
}).strict();
const stageCompositionArtifactSchema = z.object({
  artifact_id: z.string().trim().min(1).max(200),
  role: z.enum(["primary", "secondary"]),
  load_order: z.number().int().nonnegative().max(10_000),
  usdc_url: z.string().trim().min(1).max(4096),
}).strict();
const stageCompositionSchema = z.object({
  primary: stageCompositionArtifactSchema.refine((artifact) => artifact.role === "primary"),
  secondary_layers: z.array(
    stageCompositionArtifactSchema.refine((artifact) => artifact.role === "secondary"),
  ).max(63),
}).strict();
const dataChannelTraceCandidateSchema = z.string().min(1).max(200);
const runtimeCommandAuthorizationSchema = z.object({
  trace_id: dataChannelTraceCandidateSchema,
  source_client_id: z.string().trim().min(1).max(200),
  requested_event_type: z.string().trim().min(1).max(100),
  request_id: safeCommandIdSchema,
  command_context: z.record(z.unknown()),
  stage_binding_authorization_id: z.string().trim().min(1).max(200).optional(),
  binding_revision_id: z.string().trim().min(1).max(200).optional(),
  stage_composition: stageCompositionSchema.optional(),
}).strict();
const dataChannelTraceVerificationSchema = z.object({
  trace_id: dataChannelTraceCandidateSchema,
}).strict();
const stageBindingConfirmationSchema = z.object({
  trace_id: dataChannelTraceCandidateSchema,
  stage_binding_authorization_id: z.string().trim().min(1).max(200),
  binding_revision_id: z.string().trim().min(1).max(200),
  request_id: safeCommandIdSchema,
  outcome: z.enum(["success", "failed"]),
}).strict();

type WireStageComposition = z.infer<typeof stageCompositionSchema>;

function toRuntimeStageComposition(composition: WireStageComposition): RuntimeStageComposition {
  return {
    primary: {
      artifactId: composition.primary.artifact_id,
      role: "primary",
      loadOrder: composition.primary.load_order,
      usdcUrl: composition.primary.usdc_url,
    },
    secondaryLayers: composition.secondary_layers.map((artifact) => ({
      artifactId: artifact.artifact_id,
      role: "secondary",
      loadOrder: artifact.load_order,
      usdcUrl: artifact.usdc_url,
    })),
  };
}

function toWireStageComposition(composition: RuntimeStageComposition): WireStageComposition {
  return {
    primary: {
      artifact_id: composition.primary.artifactId,
      role: "primary",
      load_order: composition.primary.loadOrder,
      usdc_url: composition.primary.usdcUrl,
    },
    secondary_layers: composition.secondaryLayers.map((artifact) => ({
      artifact_id: artifact.artifactId,
      role: "secondary",
      load_order: artifact.loadOrder,
      usdc_url: artifact.usdcUrl,
    })),
  };
}

function isRuntimeCommandRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toRuntimeCommandContext(
  requestedEventType: string,
  commandContext: Record<string, unknown>,
): Record<string, unknown> {
  if (requestedEventType === "highlightPrimsRequest") {
    const runtimeContext = { ...commandContext };
    const hasWireAlias = Object.prototype.hasOwnProperty.call(commandContext, "focusFirst");
    delete runtimeContext.focus_first;
    delete runtimeContext.focusFirst;
    runtimeContext.focusFirst = commandContext.focus_first;
    if (hasWireAlias) runtimeContext.__wireAliasCollision = true;
    runtimeContext.items = Array.isArray(commandContext.items)
      ? commandContext.items.map((item) => {
          if (!isRuntimeCommandRecord(item)) return item;
          const runtimeItem = { ...item };
          delete runtimeItem.prim_path;
          delete runtimeItem.primPath;
          runtimeItem.primPath = item.prim_path;
          return runtimeItem;
        })
      : commandContext.items;
    return runtimeContext;
  }

  if (requestedEventType === "focusPrimRequest") {
    const runtimeContext = { ...commandContext };
    const hasWireAlias = Object.prototype.hasOwnProperty.call(commandContext, "primPath");
    delete runtimeContext.prim_path;
    delete runtimeContext.primPath;
    runtimeContext.primPath = commandContext.prim_path;
    if (hasWireAlias) runtimeContext.__wireAliasCollision = true;
    return runtimeContext;
  }

  return { ...commandContext };
}

const heartbeatViewerLeaseSchema = z.object({
  first_frame: z.boolean().optional(),
  loaded_stage_url: z.string().trim().max(2048).nullable().optional(),
  datachannel_ready: z.boolean().optional(),
});

const sessionActivitySchema = z.object({
  lease_id: z.string().trim().min(1).max(200),
}).strict();

const releaseViewerLeaseSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// `type` is an open string (no enum) and the body is `.passthrough()` on
// purpose: retired collaboration event types (`highlightRequest` /
// `selectionUpdate` / `annotationCreate`, removed 2026-05-21 in
// `remove-conflict-review-from-fast-mvp`) are still accepted into the raw
// event log for archive compatibility. The lifecycle view filters them out
// via EventLog.listLifecycle()'s allowlist; the full EventLog.list() keeps
// them so historical logs replay intact.
const appendEventSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();

// F2 步驟⑩（AI-BIM 前後端設計文件）：Coordinator → 雲端 Outbox 摘要回拋
// （issue/檢核統計，metadata-only）。瀏覽器只持 session_id + rule_run_id/
// model_version_id 等識別碼，統計由 coordinator server-side 向 governance 查詢。
const issueSnapshotSchema = z.object({
  rule_run_id: z.string().trim().min(1).max(200),
  model_version_id: z.string().trim().min(1).max(200).optional(),
});

// A1/A2 governance file-library 邏輯識別（unified-console local_fs 修復）：
// governance proxy 對瀏覽器遮蔽絕對路徑（governanceProxy.ts redactServerPaths →
// "[server-path]"），瀏覽器不可能回送真 IFC path。瀏覽器改送 {project_id, model_id,
// version_name} 邏輯三段，coordinator server-side 直打 governance /api/files/tree
// 解析真路徑後轉發 rule-run / diff（與 issue-snapshot / federated_set_id 同構）。
const libraryVersionRefSchema = z.object({
  project_id: z.string().min(1).max(300),
  model_id: z.string().min(1).max(300),
  version_name: z.string().min(1).max(300),
});

const libraryRuleRunSchema = libraryVersionRefSchema.extend({
  ids_path: z.string().max(300).optional(),
  model_version_id: z.string().min(1).max(300).optional(),
});

const libraryDiffSchema = z.object({
  base: libraryVersionRefSchema,
  target: libraryVersionRefSchema,
  include_geometry: z.boolean().optional(),
  base_model_version_id: z.string().min(1).max(300).optional(),
  target_model_version_id: z.string().min(1).max(300).optional(),
});

// B-scheme（local-coordinator-ifc-ready-intake-boundary T3 §4.1）。
// 契約權威：tests/contracts/ifc_ready_payload.json。correlation_id /
// idempotency_key 的權威來源是 AuthProvider（X-Correlation-Id /
// X-Idempotency-Key header）；body 內同名欄位僅為可選回顯。
const ifcReadyPayloadSchema = z
  .object({
    event: z.literal("ifc_ready"),
    event_id: z.string().min(1).optional(),
    correlation_id: z.string().min(1).optional(),
    idempotency_key: z.string().min(1).optional(),
    tenant_id: z.string().min(1),
    project_id: z.string().min(1),
    external_model_version_id: z.string().min(1),
    // minio-watch key 結構：watcher 帶入種類(倒數二)與專案原名(中文如實顯示)；additive/optional，
    // schema 已 .passthrough()、舊 consumer 不受影響（種類/原名只隨 payload 傳遞、不入 store）。
    project_display_name: z.string().min(1).nullish(),
    model_category: z.string().min(1).nullish(),
    external_conversion_task_id: z.string().min(1).nullish(),
    source_ifc: z.object({
      ref: z.string().min(1),
      etag: z.string().min(1),
      filename: z.string().nullish(),
      format: z.string().nullish(),
    }),
    requested_outputs: z.array(z.string()).optional(),
    callback_url: z.string().url().nullish(),
  })
  .passthrough();

// backfill-coordinator-webhook-and-auto-session §1：worker compatibility payload。
// 規格權威：openspec/specs/local-coordinator-ifc-ready-intake-boundary/spec.md
// §"Coordinator accepts worker ifc-ready compatibility payload"。
// 落地端 IFC Worker 送的較簡化形狀；coordinator 在 intake boundary 正規化為
// canonical ExternalIfcReadyEvent，不洩漏進 streaming internal contract。
const workerCompatPayloadSchema = z
  .object({
    status: z.literal("ifc_ready"),
    ifc_path: z.string().min(1),
    project_id: z.string().min(1),
    version: z.string().min(1),
    task_id: z.string().min(1),
  })
  .passthrough();

interface NormalizeResult {
  event: ExternalIfcReadyEvent;
  isWorkerCompat: boolean;
  // worker compat 缺 explicit X-Correlation-Id / X-Idempotency-Key 時的派生值
  // （`worker:project_id::version::task_id`）；explicit headers 仍優先（D11）。
  derivedCorrelationId?: string;
  derivedIdempotencyKey?: string;
}

function normalizeIntakePayload(rawBody: unknown): NormalizeResult {
  const body = rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
  // D9：以 `event` 欄位作為 canonical 判別；worker compat 用 `status`。
  if ("event" in body) {
    const event = ifcReadyPayloadSchema.parse(body) as ExternalIfcReadyEvent;
    return { event, isWorkerCompat: false };
  }
  const worker = workerCompatPayloadSchema.parse(body);
  const derivedKey = `worker:${worker.project_id}::${worker.version}::${worker.task_id}`;
  const tenantId = typeof body.tenant_id === "string" && body.tenant_id.trim().length > 0
    ? body.tenant_id.trim()
    : "tenant_demo_001";
  const event: ExternalIfcReadyEvent = {
    event: "ifc_ready",
    correlation_id: derivedKey,
    idempotency_key: derivedKey,
    tenant_id: tenantId,
    project_id: worker.project_id,
    external_model_version_id: worker.version,
    external_conversion_task_id: worker.task_id,
    source_ifc: {
      ref: worker.ifc_path,
      // worker 未提供 checksum；以 fallback marker 替代，**不**宣告為真實 etag。
      etag: `worker:unknown:${worker.task_id}`,
      filename: null,
      format: "ifc",
    },
    requested_outputs: ["usdc", "element_mapping", "entity_index", "metadata"],
    callback_url: typeof body.callback_url === "string" ? body.callback_url : null,
  };
  return {
    event,
    isWorkerCompat: true,
    derivedCorrelationId: derivedKey,
    derivedIdempotencyKey: derivedKey,
  };
}

// B-scheme T5 §6.1：本地轉檔結果回報（coordinator 輪詢 streaming /result 或
// 內部 result loop 餵入），coordinator 據此組 metadata-only 雲端 callback 並
// 入 outbox。callback 投遞狀態與 conversion 成功分離。
const conversionResultReportSchema = z
  .object({
    correlation_id: z.string().min(1),
    conversion_job_id: z.string().min(1).nullish(),
    status: z.enum(["ready", "succeeded", "failed"]),
    artifacts: z
      .object({
        usdc_ref: z.string().nullish(),
        element_mapping_ref: z.string().nullish(),
        manifest_ref: z.string().nullish(),
      })
      .passthrough()
      .optional(),
    artifact_summary: z.record(z.unknown()).optional(),
    reason: z.string().nullish(),
    retryable: z.boolean().optional(),
  })
  .passthrough();

// B-scheme T7 §8.1：local web view session 建立輸入（ifc_ready_job_id 或
// external_model_version_id 擇一）。使用者 auth 由可替換 provider 處理。
const localWebViewSessionSchema = z
  .object({
    ifc_ready_job_id: z.string().min(1).optional(),
    external_model_version_id: z.string().min(1).optional(),
  })
  .passthrough()
  .refine((v) => Boolean(v.ifc_ready_job_id || v.external_model_version_id), {
    message: "ifc_ready_job_id or external_model_version_id is required",
  });

export interface CoordinatorApp {
  app: express.Express;
  server: http.Server;
  io: Server;
  config: CoordinatorConfig;
  store: SessionStore;
  /** @internal exposed for deterministic contract tests; not a public route API. */
  externalIfcReadyStore: ExternalIfcReadyStore;
  /**
   * @internal rvt-ifc-usdc-lineage task 3.1 的 governed source-bundle store。
   * 與 `externalIfcReadyStore` 同性質的 test-only read accessor；**不是** production
   * 介面（production 只經 `/api/external/source-bundles/*` route）。兩個 store 的去重
   * 空間互相獨立（design.md §11.2 規則 3），不得互相推導。
   */
  sourceBundleStore: SourceBundleStore;
  /**
   * @internal rvt-ifc-usdc-lineage task 3.2 的 durable stable pipeline-job store。
   * 與 `sourceBundleStore` 同性質的 test-only read accessor；**不是** production 介面
   * （production 只經 `/api/lineage/pipeline-jobs/*` route）。restart recovery 已在
   * `createCoordinatorApp` 內執行完畢，測試讀到的即為恢復後的狀態。
   */
  pipelineJobStore: PipelineJobStore;
  /**
   * @internal deterministic 測試驅動：`await sourceBundleReconciler.pollNow()` 取代
   * 對輪詢計數器的 waitFor。**不是 production 介面**——production 只由
   * `SOURCE_BUNDLE_RECONCILE_ENABLED` 的 auto tick 驅動（預設關閉）。
   */
  sourceBundleReconciler: SourceBundleReconciler;
  /**
   * @internal rvt-ifc-usdc-lineage task 3.3 的 active-result／activation audit sidecar。
   * 與 `pipelineJobStore` 同性質的 test-only read accessor；**不是** production 介面
   * （production 只經 `/api/lineage/pipeline-jobs/:id/result-...` route 與 registration service）。
   * 建構時已做過 sidecar commitment 驗證，測試讀到的即為可用狀態。
   */
  pipelineResultStore: PipelineResultStore;
  /**
   * @internal task 3.3 收尾刀的 result registration application service。
   * **不是** production 介面：正式 caller 屬 task 4.1／4.5 的 attempt 完成路徑，
   * 此 accessor 只讓整合測試在不開新 HTTP route 的前提下驅動同一條 composition。
   * governed object port 未設定時為 null（與 `details` 同一個 fail-closed 條件）。
   */
  pipelineResultRegistration: PipelineResultRegistrationService | null;
  /**
   * @internal task 3.3 收尾刀的 result-manifest detail reader（compare 面的生產 adapter）。
   * **不是** production 介面：production 只經 compare route 使用它。
   *
   * 為什麼需要這個 accessor：HTTP 面的 compare 綠路徑被 fail-closed 的 external
   * authorization（`authorization: null`）擋在前面，所以「details 真的被接上」在
   * route 層無法被 falsify——沒有它，一個把 `details` 接回 null 的迴歸不會讓任何
   * 測試變紅。
   */
  pipelineResultDetails: PipelineResultDetailReaderPort | null;
  /**
   * @internal task 3.4 的生產讀取／簽章面。**不是** production 介面：production 只經
   * `/api/lineage/**` routes 使用它們。
   *
   * 之所以群組成一個欄位而不是攤成四個 accessor：四者共用**同一個** fail-closed 條件
   * （governed object port 是否存在），分開暴露只會讓「它們必須同生同滅」這件事變得不明顯。
   *
   * 為什麼需要 accessor：download／metadata 兩條 HTTP 路徑都在 external authorization
   * （`authorization: null`）之後才碰到 reader／signer，所以「它們真的被接上」在 route 層
   * 無法被 falsify——沒有這個 accessor，一個把 reader 接回 null 的迴歸不會讓任何測試變紅。
   */
  lineageArtifactSurfaces: {
    reader: PipelineResultArtifactReaderPort | null;
    signer: LineageArtifactDownloadSignerPort | null;
    projections: LineageMetadataProjectionReaderPort | null;
    target_policies: readonly LineageArtifactDownloadTargetPolicy[];
  };
  eventLog: EventLog;
  structLog: StructLogger;
  idleReclaimService: SessionIdleReclaimService;
  // coordinator-auto-poll-streaming-conversion §6:cancel 全部 in-process auto-poll
  // timer。process shutdown / 測試 teardown 必呼叫,避免 timer keep-alive 阻 exit。
  // async（回 Promise）:minioWatchSurface.dispose() 需 await 其 in-flight tick settle 後才
  // 銷毀 object store（避免 unhandled rejection）;shutdown.ts 已 await，fire-and-forget 的
  // 測試 teardown 仍因 surface 內部 promise 鏈得到保護。
  dispose: () => Promise<void>;
  /**
   * @internal deterministic 測試驅動：`await minioWatchSurface.pollNow()` 取代對
   * watcher 計數器的輪詢（waitFor），resolve 時該輪 list／intake／counters 已全部落定。
   * **不是 production 介面**——production 只經 routes（PUT watch / GET status）與
   * auto tick 使用 surface；此 accessor 只為整合測試消除觀測競態。
   */
  minioWatchSurface: MinioWatchSurface;
  /**
   * @internal test-only read accessor：回報某 jobId 是否仍持有 enqueue 階段暫存的
   * dispatch 脈絡。**不是 production 介面**——production route 經 pipeline 內部判定；
   * 此 getter 只為測試斷言 delete-on-success 失敗路徑「保留 pending」的行為可被 falsify。
   *
   * `@internal` tag 讓 API extractor / consumer 在型別層看見 test-only 合約；只暴露
   * boolean —— map 本體不外洩到公開介面。
   */
  hasPendingDispatch: (jobId: string) => boolean;
}

export interface CreateCoordinatorAppOptions {
  /**
   * Pre-built structured logger. Tests use this to write into a tmp dir and
   * assert on records. Omit to let the app build one against $LOG_ROOT or the
   * default `./logs`. Whether or not the default logger emits an env_snapshot
   * is controlled by NODE_ENV (suppressed under `test`).
   */
  structLog?: StructLogger;
  /**
   * MinIO Watch Surface 的 object store seam（測試注入 in-memory fake；省略 =
   * production 真 S3 adapter）。取代舊 conversion-watch-toggle.test.ts 對整個
   * minioWatcher 模組的 vi.mock——啟停編排經真 surface 走，只替換 S3 存取。
   */
  minioWatchObjectStoreFactory?: (cfg: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  }) => ObjectStorePort;
  /**
   * rvt-ifc-usdc-lineage task 3.1：governed source bundle 的 object port seam
   * （測試注入 in-memory fake；省略＝依 config 決定真 S3 adapter 或 null）。
   *
   * 刻意**不重用** `minioWatchObjectStoreFactory`：governed port 是另一個介面
   * （versioned HEAD／streaming SHA-256／conditional create／authority＋bucket allowlist），
   * 且兩條路徑的 credentials 與去重空間必須保持分離（design.md §11.2 規則 3／5）。
   * 提供 factory 時視為「governed 端已設定」，讓測試不必湊齊全部 GOVERNED_SOURCE_* env。
   */
  sourceBundleObjectStoreFactory?: (cfg: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    allowedAuthorities: string[];
    allowedBuckets: string[];
  }) => SourceBundleObjectPort;
}

type RawBodyRequest = express.Request & { rawBody?: string };

export function createCoordinatorApp(
  overrides: Partial<CoordinatorConfig> = {},
  options: CreateCoordinatorAppOptions = {},
): CoordinatorApp {
  const config = loadConfig(overrides);
  const app = express();
  const governanceLibraryWorkflow = new GovernanceLibraryWorkflow(
    new GovernanceLibraryHttpAdapter(),
  );
  const corsOrigins = Array.from(
    new Set([...config.corsOrigins, new URL(config.viewerPublicBaseUrl).origin]),
  );
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: corsOrigins,
      credentials: false,
    },
  });
  const structLog =
    options.structLog ??
    createLogger("coordinator", {
      // Skip the env snapshot under vitest / NODE_ENV=test to avoid filling the
      // gitignored `logs/` directory during the test suite. Tests that exercise
      // the env_snapshot path build their own logger via options.structLog.
      skipEnvSnapshot: process.env.NODE_ENV === "test",
    });
  const store = new SessionStore(config.sessionStoreDir);
  const externalIfcReadyStore = new ExternalIfcReadyStore();
  const sessionTraceResolver = new SessionTraceResolver(store, (sessionId) =>
    externalIfcReadyStore
      .list()
      .filter((job) => job.review_session_id === sessionId || job.web_view_session_id === sessionId)
      .map((job) => job.ifc_ready_job_id),
  );
  const eventLog = new EventLog(config.eventLogDir, {
    structLog,
    resolveTraceId: (sessionId) => {
      const resolved = sessionTraceResolver.resolveAndCommit(sessionId);
      return resolved.ok ? resolved.canonicalTraceId : null;
    },
  });
  const viewerLeaseStore = new ViewerLeaseStore();

  let idleReclaimService: SessionIdleReclaimService;

  const closeReviewSessionInternal = (
    sessionId: string,
    options: {
      reason?: string;
      actor?: string;
      finalEvents?: unknown[];
      resumeClosing?: boolean;
      resumeClosed?: boolean;
      retainIdleTracking?: boolean;
    } = {},
  ): ReviewSession | null => {
    if (!isSafeSessionId(sessionId)) return null;
    let session = store.get(sessionId);
    if (!session) return null;
    if (
      (session.status === "closed" && !options.resumeClosed)
      || (session.status === "closing" && !options.resumeClosing)
    ) {
      return session;
    }
    const finalEvents = Array.isArray(options.finalEvents) ? options.finalEvents : [];
    const reason = typeof options.reason === "string" ? (options.reason.trim().slice(0, 500) || undefined) : undefined;
    const actor = typeof options.actor === "string" ? (options.actor.trim().slice(0, 500) || undefined) : undefined;
    const auditFields = reason ? { reason, ...(actor ? { actor } : {}) } : {};
    const closeCheckpoint = session.close_checkpoint ?? {
      checkpoint_id: `close_${randomBytes(12).toString("hex")}`,
      expected_final_event_count: finalEvents.length,
    };
    if (!session.close_checkpoint) {
      session = store.update(session.session_id, { close_checkpoint: closeCheckpoint }) ?? session;
    }
    let closing = session;
    if (session.status !== "closed") {
      let closeEvents = eventLog.list(session.session_id);
      let closingEvent = closeEvents.find((event) => (
        event.type === "sessionClosing"
        && event.close_checkpoint_id === closeCheckpoint.checkpoint_id
      ));
      if (!closingEvent) {
        const releasedViewerLeases = viewerLeaseStore.releaseSession(session.session_id);
        closingEvent = eventLog.appendServerCloseCheckpoint(session.session_id, "sessionClosing", {
          final_events: finalEvents.length,
          released_viewer_leases: releasedViewerLeases.map((lease) => lease.lease_id),
          ...auditFields,
        }, closeCheckpoint.checkpoint_id);
        closeEvents = [...closeEvents, closingEvent];
      }
      if (session.status !== "closing") {
        closing = store.update(session.session_id, {
          status: "closing",
          kit_instance_bindings: markKitBindingsDraining(session.kit_instance_bindings),
        }) ?? session;
      }
      const expectedFinalEventCount = closeCheckpoint.expected_final_event_count;
      const existingFinalEventCount = closeEvents.filter((event) => (
        event.type === "finalReviewEvent"
        && event.close_checkpoint_id === closeCheckpoint.checkpoint_id
      )).length;
      if (existingFinalEventCount < expectedFinalEventCount) {
        if (finalEvents.length < expectedFinalEventCount) return closing;
        for (let index = existingFinalEventCount; index < expectedFinalEventCount; index += 1) {
          eventLog.appendServerCloseCheckpoint(
            session.session_id,
            "finalReviewEvent",
            finalEvents[index],
            closeCheckpoint.checkpoint_id,
          );
        }
      }
      const persistedFinalEventCount = eventLog
        .list(session.session_id)
        .filter((event) => (
          event.type === "finalReviewEvent"
          && event.close_checkpoint_id === closeCheckpoint.checkpoint_id
        )).length;
      if (persistedFinalEventCount < expectedFinalEventCount) return closing;
    }
    const closed = session.status === "closed"
      ? session
      : store.update(session.session_id, {
          status: "closed",
          participants: [],
          kit_instance_bindings: releaseKitBindings(closing?.kit_instance_bindings || session.kit_instance_bindings),
        });
    const existingCloseEventTypes = new Set(
      eventLog
        .list(session.session_id)
        .filter((event) => event.close_checkpoint_id === closeCheckpoint.checkpoint_id)
        .map((event) => event.type),
    );
    let appendedSessionClosed = false;
    let appendedKitInstanceReleased = false;
    if (!existingCloseEventTypes.has("sessionClosed")) {
      eventLog.appendServerCloseCheckpoint(
        session.session_id,
        "sessionClosed",
        { ...auditFields },
        closeCheckpoint.checkpoint_id,
      );
      appendedSessionClosed = true;
    }
    if (!existingCloseEventTypes.has("kitInstanceReleased")) {
      eventLog.appendServerCloseCheckpoint(session.session_id, "kitInstanceReleased", {
        kit_instance_bindings: closed?.kit_instance_bindings.map((binding) => binding.kit_instance_id) || [],
      }, closeCheckpoint.checkpoint_id);
      appendedKitInstanceReleased = true;
    }
    const traceAuthority = sessionTraceResolver.resolveAndCommit(session.session_id);
    if (
      (appendedSessionClosed || appendedKitInstanceReleased)
      && traceAuthority.ok
      && traceAuthority.canonicalTraceId.startsWith("ifcready_")
    ) {
      structLog
        .withTraceId(traceAuthority.canonicalTraceId)
        .lifecycle("ifcReadyReviewSession", "IFC-ready review session closed", {
          phase: "closed",
          subject_kind: "review_session",
          subject_id: session.session_id,
          ifc_ready_job_id: traceAuthority.canonicalTraceId,
        });
    }
    if (!options.retainIdleTracking) idleReclaimService?.removeSession(session.session_id);
    return closed;
  };

  idleReclaimService = new SessionIdleReclaimService(store, {
    idleTimeoutMs: config.sessionIdleTimeoutMs,
    onCountdown: (sessionId, remainingSeconds) => {
      const traceAuthority = sessionTraceResolver.resolveAndCommit(sessionId);
      if (!traceAuthority.ok) return;
      io.of("/review").to(sessionId).emit("session:idle_countdown", {
        session_id: sessionId,
        trace_id: traceAuthority.canonicalTraceId,
        remaining_seconds: remainingSeconds,
        reason: "inactivity",
      });
    },
    onCountdownCancelled: (sessionId) => {
      const traceAuthority = sessionTraceResolver.resolveAndCommit(sessionId);
      if (!traceAuthority.ok) return;
      io.of("/review").to(sessionId).emit("session:idle_countdown_cancelled", {
        session_id: sessionId,
        trace_id: traceAuthority.canonicalTraceId,
        cancelled_at: nowIso(),
      });
    },
    onReclaimTeardown: (sessionId) => {
      const traceAuthority = sessionTraceResolver.resolveAndCommit(sessionId);
      const closed = closeReviewSessionInternal(sessionId, {
        reason: "inactivity",
        actor: "system:idle_reclaimer",
        resumeClosing: true,
        resumeClosed: true,
        retainIdleTracking: true,
      });
      if (!closed || closed.status !== "closed") {
        throw new Error(`Idle reclaim did not close session ${sessionId}.`);
      }
      io.of("/review").to(sessionId).emit("session:closed", {
        session_id: sessionId,
        ...(traceAuthority.ok ? { trace_id: traceAuthority.canonicalTraceId } : {}),
        reason: "inactivity",
        closed_at: nowIso(),
      });
    },
  });
  idleReclaimService.start();

  const runtimeMutationAuthority = new RuntimeMutationAuthority({
    now: Date.now,
    generateId: (prefix) => `${prefix}_${randomBytes(12).toString("hex")}`,
    getSessionContext: (sessionId) => {
      const session = store.get(sessionId);
      return session
        ? {
            sessionId: session.session_id,
            status: session.status,
            artifacts: session.artifact_bindings.map((binding) => ({
              artifactId: binding.artifact_id,
              readyStatus: binding.ready_status,
              usdcUrl: binding.url ?? null,
            })),
          }
        : null;
    },
    inspectPrimaryLease: ({ sessionId, sourceClientId, credential }) => {
      const lease = viewerLeaseStore.authorizePrimary(sessionId, sourceClientId, credential);
      return lease
        ? {
            authorized: true,
            lease: { leaseId: lease.lease_id, principal: lease.user_id },
          }
        : { authorized: false };
    },
    inspectRuntimeLease: ({ sessionId, sourceClientId, credential }) => {
      const decision = viewerLeaseStore.inspectRuntimeAuthority(sessionId, sourceClientId, credential);
      return decision.authorized
        ? {
            authorized: true,
            lease: { leaseId: decision.lease.lease_id, principal: decision.lease.user_id },
          }
        : {
            authorized: false,
            reason: decision.reason,
            detailCode: decision.detail_code,
          };
    },
    appendStageBindingApplied: (event) => eventLog.append(event.sessionId, "stageBindingApplied", {
      stage_binding_authorization_id: event.stageBindingAuthorizationId,
      binding_revision_id: event.bindingRevisionId,
      request_id: event.requestId,
      source_client_id: event.sourceClientId,
      primary_artifact_id: event.primaryArtifactId,
      secondary_artifact_ids: event.secondaryArtifactIds,
    }),
  });
  // B-scheme（local-coordinator-ifc-ready-intake-boundary T3）：對外 IFC-ready intake。
  const authProvider = createAuthProvider(config);
  const streamingConversionClient = new StreamingConversionClient(
    config.streamingConversionApiBase,
    undefined,
    config.streamingConversionInternalToken || undefined,
  );
  const startedAt = Date.now();
  // conversionLedger（minio-closed-loop-phase1 Task 1/3：coordinator-local shadow 持久 ledger）：
  // 宣告即建構（const），讓 watch surface 的 isLedgered closure 在型別系統層面就靜態保證捕捉到
  // 已初始化的 ledger——不靠「賦值早於啟動路徑」的隱性順序假設，故日後在啟動路徑前插入新程式碼
  // 也不可能重新引入 TDZ。watcher 偵測即寫 queued（Task 2）、GET /api/conversion/records 讀取
  // （Task 3）；建構只讀持久 JSON 檔（無時序副作用），提早到宣告處安全。
  const conversionLedger = new ConversionLedger(config.conversionLedgerStorePath);
  const artifactHealthLedger = new ArtifactHealthLedger(config.artifactHealthLedgerStorePath);
  // rvt-ifc-usdc-lineage task 3.1：governed source bundle 的 durable store ＋ 唯讀 object port。
  // 與 legacy intake 完全分離（不同 store、不同 port、不同 credentials、不同去重空間）。
  // governed 端未設定時 port 為 null → route 誠實回 503；**MUST NOT** 用 legacy watcher 的
  // MINIO_WATCH_* credentials 頂替（design.md §11.2 規則 3／5）。
  const sourceBundleStore = new SourceBundleStore(config.sourceBundleStorePath);
  const governedSourceConfigured =
    config.governedSourceMinioEndpoint.length > 0 &&
    config.governedSourceMinioAccessKey.length > 0 &&
    config.governedSourceMinioSecretKey.length > 0 &&
    // allowlist 空＝未設定＝fail-closed（D-3），不是「全部 authority／bucket 放行」。
    config.governedSourceAuthorityAllowlist.length > 0 &&
    config.governedSourceBucketAllowlist.length > 0;
  let sourceBundleObjectPort: SourceBundleObjectPort | null = null;
  if (options.sourceBundleObjectStoreFactory) {
    sourceBundleObjectPort = options.sourceBundleObjectStoreFactory({
      endpoint: config.governedSourceMinioEndpoint,
      accessKey: config.governedSourceMinioAccessKey,
      secretKey: config.governedSourceMinioSecretKey,
      allowedAuthorities: config.governedSourceAuthorityAllowlist,
      allowedBuckets: config.governedSourceBucketAllowlist,
    });
  } else if (governedSourceConfigured) {
    sourceBundleObjectPort = createS3SourceBundleObjectPort({
      endpoint: config.governedSourceMinioEndpoint,
      accessKey: config.governedSourceMinioAccessKey,
      secretKey: config.governedSourceMinioSecretKey,
      allowedAuthorities: config.governedSourceAuthorityAllowlist,
      allowedBuckets: config.governedSourceBucketAllowlist,
    });
  }
  // rvt-ifc-usdc-lineage task 3.2：durable stable pipeline job。
  // 建構即從持久檔恢復，接著立刻做 restart recovery：`RUNNING`／`WAITING_CAPACITY`
  // 的 governed job 回到 `PENDING_ADMISSION` 並 append 一筆 `coordinator_restart`
  // （`created_new_logical_job:false`）。**MUST NOT** 標 `dropped_on_restart`
  // （那是 legacy in-memory 佇列的語意，逐字不動），**MUST NOT** 增 `attempt_count`，
  // 也 MUST NOT 要求 operator 重送 intake。
  const pipelineJobStore = new PipelineJobStore(config.pipelineJobStorePath, { structLog });
  // Task 3.3：active-result/promotion audit 是獨立於 3.2 stable job document 的 authority。
  // 使用 job store path 的專屬 sidecar，避免修改 CRITICAL CoordinatorConfig surface；兩份
  // 文件仍分開持久化，3.3 不回寫 pipeline_job.active_result_id 形成第二真相。
  const pipelineResultStore = new PipelineResultStore(
    pipelineJobStore,
    `${config.pipelineJobStorePath}.results`,
  );
  // Result sidecar commitment 必須先驗證；若已初始化 sidecar 遺失／digest 漂移，startup
  // fail closed，不得先由 3.2 recovery 改寫 job snapshot 後再發現 pointer/audit 已丟失。
  pipelineResultStore.assertAvailable();
  // Task 3.3 收尾刀：result manifest 的生產 composition。兩者都接在 governed object
  // port 上（與 3.1 同一組 credentials／allowlist）；port 未設定時一律維持 null——
  // compare route 誠實回 503，註冊面不存在。**MUST NOT** 用 legacy watcher 的
  // MINIO_WATCH_* credentials 頂替（design.md §11.2 規則 3／5）。
  const pipelineResultRegistration: PipelineResultRegistrationService | null =
    sourceBundleObjectPort
      ? createPipelineResultRegistrationService({
          objects: sourceBundleObjectPort,
          results: pipelineResultStore,
          structLog,
        })
      : null;
  const pipelineResultDetails = sourceBundleObjectPort
    ? createS3PipelineResultDetailReader({ objects: sourceBundleObjectPort })
    : null;
  // Task 3.4：artifact descriptor reader、metadata 投影 reader、presign signer。
  // 三者與 registration／details 共用同一個 fail-closed 條件（governed object port 存在），
  // 且共用同一組 GOVERNED_SOURCE_* credentials——**MUST NOT** 用 legacy watcher 的
  // MINIO_WATCH_* 頂替（design.md §11.2 規則 3／5）。
  const pipelineResultArtifactReader = sourceBundleObjectPort
    ? createS3PipelineResultArtifactReader({ objects: sourceBundleObjectPort })
    : null;
  const lineageMetadataProjections = sourceBundleObjectPort
    ? createS3LineageMetadataProjectionReader({ objects: sourceBundleObjectPort })
    : null;
  const lineageArtifactDownloadSigner = sourceBundleObjectPort
    ? createS3LineageArtifactDownloadSigner({
        accessKey: config.governedSourceMinioAccessKey,
        secretKey: config.governedSourceMinioSecretKey,
      })
    : null;
  // Public download target policy。**181 的誠實現狀：這個 env 沒有值。**
  // canonical Linux 測試區只有內網 http endpoint，沒有瀏覽器可見的 HTTPS public origin，
  // 因此 policy 清單為空、`resolveLineageArtifactDownloadTarget` 永遠找不到唯一命中、
  // download route 一律誠實 503。這不是待修的 bug，是「還沒有 HTTPS 對外入口」這件事
  // 在程式碼裡的忠實投影；有了 public origin 之後只要設這個 env，不必改任何程式碼。
  const lineageDownloadTargetPolicies = parseLineageArtifactDownloadTargetPolicies(
    config.lineageDownloadTargetPolicies,
  );
  if (lineageDownloadTargetPolicies.malformed) {
    // 設了卻解析不出來＝fail-closed 成空清單。這一定要吵，否則運維會以為下載面已開通。
    structLog.warn("lineage-artifact-download", "target policy env is malformed; download stays closed", {
      configured: true,
      policy_count: 0,
    });
  }
  pipelineJobStore.recoverOnStart(nowIso(), newReadyEventId);
  // READY governed bundle → stable job 的冪等 auto-enqueue。同一個 source_bundle_id
  // 永遠回同一個 job（決定性 job id ＋ 單一寫入點），replay 不建第二個 logical job。
  // 只到 `PENDING_ADMISSION`：admission_record 屬 task 5.1、attempt 屬 4.1。
  const enqueueGovernedBundle = async (record: SourceBundleRecord): Promise<string> =>
    autoEnqueueGovernedBundle(record, {
      jobs: pipelineJobStore,
      bundles: sourceBundleStore,
      now: nowIso,
      newEventId: newReadyEventId,
      structLog,
    }).pipeline_job_id;
  // 撿漏用的 polling reconciliation（預設關閉；env 與 MINIO_WATCH_* 完全分離，D-8）。
  // 走的是與 ready claim **同一條** validate＋enqueue 路徑，故不可能建第二個 logical job。
  const sourceBundleReconciler = createSourceBundleReconciler({
    objects: sourceBundleObjectPort,
    bundles: sourceBundleStore,
    jobs: pipelineJobStore,
    sha256Mode: config.sourceBundleSha256VerifyMode,
    now: nowIso,
    newEventId: newReadyEventId,
    structLog,
    config: {
      enabled: config.sourceBundleReconcileEnabled,
      intervalMs: config.sourceBundleReconcileIntervalMs,
      prefix: config.governedSourcePrefix,
    },
  });
  sourceBundleReconciler.start();
  // minio-watch-auto-intake（O4 B 案，env opt-in 預設關）：MinIO Watch Surface（deep
  // module，見 CONTEXT.md 詞條與 services/minioWatchSurface.ts）擁有 watcher loop 生命週期、
  // runtime toggle、status 投影與 pollNow 測試驅動。watcher 自打 loopback
  // POST /api/external/ifc-ready，既有 intake/去重/dispatch 鏈零變動。
  const minioWatchSurface = createMinioWatchSurface({
    config: {
      enabled: config.minioWatchEnabled,
      endpoint: config.minioWatchEndpoint,
      bucket: config.minioWatchBucket,
      prefix: config.minioWatchPrefix,
      accessKey: config.minioWatchAccessKey,
      secretKey: config.minioWatchSecretKey,
      keySuffix: config.minioWatchKeySuffix,
      intervalSeconds: config.minioWatchIntervalSeconds,
      selfBaseUrl: config.minioWatchSelfBaseUrl,
      tenantId: config.minioWatchTenantId,
    },
    webhookSecret: config.externalIntakeWebhookSecret,
    // §3.4 全自動 auto-enroll：以持久 ledger 當去重水印。無紀錄→觸發 intake、有紀錄→skip。
    // closure 捕捉的 conversionLedger 是上方宣告即建構的 const，型別系統靜態保證已初始化。
    // watcher tick 對 ledger 唯讀（落帳由 intake route 端負責）。
    isLedgered: (idkey) => conversionLedger.get(idkey) !== null,
    // production selfBase 預設 http://127.0.0.1:${實際 listen port}；測試以 config.minioWatchSelfBaseUrl 注入。
    resolveSelfBaseUrl: () => {
      const address = server.address();
      const boundPort = address && typeof address !== "string" ? address.port : config.port;
      return `http://127.0.0.1:${boundPort}`;
    },
    // 手動 trigger 的 self-POST loopback：複用 config.minioWatchSelfBaseUrl seam（測試以
    // listen(0) 的真實 port 於 app 建構後注入，故必須每次呼叫時讀），fallback 用 config.port
    // （production 預設 8004，process 已 listen 該 port）——與 watcher 的 bound-port 解析
    // 是兩個歷史語意，不可合併。
    resolveManualTriggerSelfBaseUrl: () => config.minioWatchSelfBaseUrl || `http://127.0.0.1:${config.port}`,
    // 上游 intake 含同步 IFC 下載，故逾時 = 下載逾時 + 5s 緩衝。
    manualTriggerTimeoutMs: config.ifcDownloadTimeoutSeconds * 1000 + 5_000,
    // minio-watch review P2 修復：watcher 的 loopback self-POST 同樣經過
    // /api/external/ifc-ready 的 IP allowlist（authProvider 在 secret 之前先檢查 IP）。
    // 硬化部署把 EXTERNAL_INTAKE_IP_ALLOWLIST 鎖成 edge CIDR 而漏掉 loopback 時，
    // watcher 每輪 intake 都 403（列得到物件、永遠建不了 job）→ 啟動 fail-fast，
    // 不靜默空轉。重用 authProvider 的 isIpAllowed 避免判定分歧。
    assertIntakeReachable: () => {
      if (
        config.externalIntakeIpAllowlist.length > 0 &&
        !isIpAllowed("127.0.0.1", config.externalIntakeIpAllowlist) &&
        !isIpAllowed("::1", config.externalIntakeIpAllowlist)
      ) {
        throw new Error(
          "MINIO_WATCH_ENABLED=true 但 EXTERNAL_INTAKE_IP_ALLOWLIST 不含 loopback（127.0.0.1/::1）：" +
            "watcher 的 loopback intake 會被 403 拒絕。請將 loopback 加入 allowlist，或關閉 MINIO_WATCH_ENABLED。",
        );
      }
    },
    objectStoreFactory: options.minioWatchObjectStoreFactory,
    structLog,
  });
  // 已在 listen 上的 server（生產 index.ts / E2E）：listening 後啟動以取得實際 port。
  server.on("listening", () => minioWatchSurface.startIfEnabled());
  // supertest 整合測試不呼叫 listen；用 selfBaseUrl override 時可立即啟動。
  if (config.minioWatchSelfBaseUrl) {
    minioWatchSurface.startIfEnabled();
  }
  // coordinator-serial-conversion-dispatch-queue:序列化對 streaming-server 的
  // dispatch。downloaded 後 enqueue;單一 in-flight slot;失敗不卡後續。
  const conversionDispatchQueue = new ConversionDispatchQueue();
  // T5：轉檔結果回拋公司雲端（metadata-only outbox / retry / dead-letter）。
  const callbackOutbox = new CallbackOutbox(
    config.callbackOutboxMaxAttempts,
    undefined,
    config.callbackOutboxStorePath,
  );
  // deepen-ifc-ready-conversion-pipeline：deep module 擁有 accept→terminal 編排。
  // observer 實作於 auto-session helper 定義後替換；每次回傳值由對應 ingest
  // result 攜回 HTTP adapter，不使用跨 request mutable slot。
  type TerminalSessionCapture = {
    session: ReviewSession | null;
    session_replay: boolean;
    session_reason?: string;
  };
  const emptyTerminalSessionCapture = (): TerminalSessionCapture => ({
    session: null,
    session_replay: false,
    session_reason: undefined,
  });
  let onConversionTerminalImpl: (
    event: ConversionTerminalEvent,
  ) => TerminalSessionCapture = emptyTerminalSessionCapture;
  const ifcReadyPipeline = new IfcReadyConversionPipeline<TerminalSessionCapture>({
    store: externalIfcReadyStore,
    streamingClient: streamingConversionClient,
    queue: conversionDispatchQueue,
    outbox: callbackOutbox,
    ledger: conversionLedger,
    config: {
      storageRoot: config.storageRoot,
      storageHostRoot: config.storageHostRoot,
      ifcDownloadTimeoutSeconds: config.ifcDownloadTimeoutSeconds,
      ifcDownloadStrict: config.ifcDownloadStrict,
      conversionPollEnabled: config.conversionPollEnabled,
      conversionPollIntervalSeconds: config.conversionPollIntervalSeconds,
      conversionPollMaxAttempts: config.conversionPollMaxAttempts,
      cloudCallbackBaseUrl: config.cloudCallbackBaseUrl,
    },
    onConversionTerminal: (event) => onConversionTerminalImpl(event),
    // artifact health first cut remains app-owned (not pipeline core).
    onAfterDownload: (job) => refreshArtifactHealthBestEffort(job),
    structLog,
  });
  // T7：使用者（local web view）auth，可替換；不做死 EZPLUS SSO（OQ5 pending）。
  const userAuthProvider = createUserAuthProvider(config);

  function edgeRelativePath(hostPath: string | null): string | null {
    if (!hostPath) return null;
    const root = path.resolve(config.edgeRuntimeDataRoot);
    const target = path.resolve(hostPath);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative;
  }

  function fileSizeIfAvailable(hostPath: string | null): number | null {
    try {
      if (!hostPath || !fs.existsSync(hostPath)) return null;
      const stat = fs.statSync(hostPath);
      return stat.isFile() ? stat.size : null;
    } catch {
      return null;
    }
  }

  function statusFromProbe(kind: EdgeArtifactKind, value: boolean | null): EdgeArtifactStatus {
    if (value === true) return kind === "source_ifc" ? "present" : "reachable";
    if (value === false) return kind === "source_ifc" ? "missing" : "unreachable";
    return "unknown";
  }

  function snapshotFailure(snapshot: ArtifactHealthSnapshot, kind: EdgeArtifactKind): string | null {
    if (kind === "source_ifc") return snapshot.failure_details?.source_ifc ?? null;
    if (kind === "model_usdc") return snapshot.failure_details?.model_usdc ?? null;
    if (kind === "element_mapping") return snapshot.failure_details?.mapping ?? null;
    if (kind === "metadata") return snapshot.failure_details?.metadata ?? null;
    return null;
  }

  function recordProbeSnapshot(
    job: IfcReadyIntakeJob,
    snapshot: ArtifactHealthSnapshot,
    artifacts: { modelArtifactUrl?: string | null; mappingUrl?: string | null } = {},
  ): void {
    const now = snapshot.checked_at;
    const base = {
      site_id: config.edgeSiteId,
      tenant_id: job.tenant_id,
      project_id: job.project_id,
      external_model_version_id: job.external_model_version_id,
      ifc_ready_job_id: job.ifc_ready_job_id,
      conversion_job_id: job.conversion_job_id ?? null,
      review_session_id: job.review_session_id ?? null,
    };

    const upsert = (record: Omit<EdgeArtifactRecord, "created_at" | "updated_at">): void => {
      artifactHealthLedger.upsert({ ...record, created_at: now, updated_at: now }, now);
    };

    if (job.host_local_path || snapshot.source_ifc_exists !== null) {
      upsert({
        ...base,
        artifact_kind: "source_ifc",
        edge_artifact_id: job.ifc_ready_job_id,
        host_local_path: job.host_local_path ?? null,
        edge_relative_path: edgeRelativePath(job.host_local_path ?? null),
        public_url: null,
        status: statusFromProbe("source_ifc", snapshot.source_ifc_exists),
        size_bytes: snapshot.source_ifc_exists === true ? fileSizeIfAvailable(job.host_local_path ?? null) : null,
        sha256: null,
        etag: job.source_ifc_etag ?? null,
        last_checked_at: now,
        failure_code: snapshotFailure(snapshot, "source_ifc"),
      });
    }

    if (artifacts.modelArtifactUrl || snapshot.model_usdc_reachable !== null) {
      upsert({
        ...base,
        artifact_kind: "model_usdc",
        edge_artifact_id: job.conversion_job_id ?? job.ifc_ready_job_id,
        host_local_path: null,
        edge_relative_path: null,
        public_url: artifacts.modelArtifactUrl ?? null,
        status: statusFromProbe("model_usdc", snapshot.model_usdc_reachable),
        size_bytes: null,
        sha256: null,
        etag: null,
        last_checked_at: now,
        failure_code: snapshotFailure(snapshot, "model_usdc"),
      });
    }

    if (artifacts.mappingUrl || snapshot.mapping_reachable !== null) {
      upsert({
        ...base,
        artifact_kind: "element_mapping",
        edge_artifact_id: job.conversion_job_id ?? job.ifc_ready_job_id,
        host_local_path: null,
        edge_relative_path: null,
        public_url: artifacts.mappingUrl ?? null,
        status: statusFromProbe("element_mapping", snapshot.mapping_reachable),
        size_bytes: null,
        sha256: null,
        etag: null,
        last_checked_at: now,
        failure_code: snapshotFailure(snapshot, "element_mapping"),
      });
    }
  }

  function artifactUrlsForJob(job: IfcReadyIntakeJob): { modelArtifactUrl: string | null; mappingUrl: string | null } {
    const session = job.review_session_id ? store.get(job.review_session_id) : null;
    const binding = session ? expectedStageBinding(session) : null;
    return {
      modelArtifactUrl: binding?.url ?? null,
      mappingUrl: binding?.mapping_url ?? null,
    };
  }

  function snapshotFromArtifactLedger(job: IfcReadyIntakeJob): ArtifactHealthSnapshot | null {
    const source = artifactHealthLedger.get(config.edgeSiteId, job.ifc_ready_job_id, "source_ifc");
    const model = artifactHealthLedger.get(config.edgeSiteId, job.conversion_job_id ?? job.ifc_ready_job_id, "model_usdc");
    const mapping = artifactHealthLedger.get(config.edgeSiteId, job.conversion_job_id ?? job.ifc_ready_job_id, "element_mapping");
    const records = [source, model, mapping].filter((record): record is EdgeArtifactRecord => Boolean(record));
    if (records.length === 0) return null;

    const sourceProjection = source ? toCloudProjection(source) : null;
    const modelProjection = model ? toCloudProjection(model) : null;
    const mappingProjection = mapping ? toCloudProjection(mapping) : null;
    const checkedAt = records
      .map((record) => record.last_checked_at ?? record.updated_at)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    const staleReason =
      sourceProjection?.source_ifc_exists === false
        ? source?.failure_code ?? sourceProjection.stale_reason
        : modelProjection?.model_usdc_reachable === false
          ? model?.failure_code ?? modelProjection.stale_reason
          : mappingProjection?.mapping_reachable === false
            ? mapping?.failure_code ?? mappingProjection.stale_reason
            : null;
    const failureDetails = {
      source_ifc: source?.failure_code ?? null,
      model_usdc: model?.failure_code ?? null,
      mapping: mapping?.failure_code ?? null,
      metadata: null,
    };
    const hasFailureDetails = Object.values(failureDetails).some(Boolean);
    const snapshot: ArtifactHealthSnapshot = {
      source_ifc_exists: sourceProjection?.source_ifc_exists ?? null,
      model_usdc_reachable: modelProjection?.model_usdc_reachable ?? null,
      mapping_reachable: mappingProjection?.mapping_reachable ?? null,
      metadata_reachable: null,
      all_required_ready:
        sourceProjection?.source_ifc_exists === true
        && modelProjection?.model_usdc_reachable === true
        && mappingProjection?.mapping_reachable === true,
      checked_at: checkedAt,
      stale_reason: staleReason,
      failure_details: hasFailureDetails ? failureDetails : null,
      source: "edge_health_probe",
    };
    return snapshot;
  }

  function publicArtifactHealthForJob(job: IfcReadyIntakeJob, session: ReviewSession | null = null): ArtifactHealthSnapshot | null {
    return snapshotFromArtifactLedger(job) ?? job.artifact_health ?? session?.artifact_health ?? null;
  }

  function markSourceIfcUnavailable(
    job: IfcReadyIntakeJob,
    session: ReviewSession | null,
    failureCode = "source_ifc_missing",
  ): ArtifactHealthSnapshot {
    const previous = publicArtifactHealthForJob(job, session);
    const snapshot: ArtifactHealthSnapshot = {
      source_ifc_exists: false,
      model_usdc_reachable: previous?.model_usdc_reachable ?? null,
      mapping_reachable: previous?.mapping_reachable ?? null,
      metadata_reachable: previous?.metadata_reachable ?? null,
      all_required_ready: false,
      checked_at: nowIso(),
      stale_reason: failureCode,
      failure_details: {
        source_ifc: failureCode,
        model_usdc: previous?.failure_details?.model_usdc ?? null,
        mapping: previous?.failure_details?.mapping ?? null,
        metadata: previous?.failure_details?.metadata ?? null,
      },
      source: "edge_health_probe",
    };
    job.artifact_health = snapshot;
    if (session) {
      session.artifact_health = snapshot;
      store.save(session);
    }
    recordProbeSnapshot(job, snapshot, artifactUrlsForJob(job));
    return snapshot;
  }

  function sourceHealthProbePathForJob(job: IfcReadyIntakeJob): { sourcePath: string | null; storageRoot: string } {
    // Dockerized coordinator cannot stat a Windows host path such as D:/...,
    // but it can stat the same file through the mounted container path.
    if (job.local_path && job.host_local_path && job.local_path !== job.host_local_path) {
      return { sourcePath: job.local_path, storageRoot: config.storageRoot };
    }
    return { sourcePath: job.host_local_path || job.local_path || null, storageRoot: config.storageHostRoot };
  }

  async function refreshArtifactHealthForJob(
    job: IfcReadyIntakeJob,
    artifacts: { modelArtifactUrl?: string | null; mappingUrl?: string | null } = artifactUrlsForJob(job),
  ): Promise<ArtifactHealthSnapshot> {
    const sourceProbe = sourceHealthProbePathForJob(job);
    const snapshot = await probeArtifactHealth({
      host_local_path: sourceProbe.sourcePath,
      model_artifact_url: artifacts.modelArtifactUrl ?? null,
      mapping_url: artifacts.mappingUrl ?? null,
      edge_runtime_data_root: config.edgeRuntimeDataRoot,
      storage_root: sourceProbe.storageRoot,
      configured_conversion_api_origin: config.streamingConversionApiBase,
      checked_at: nowIso(),
    });
    job.artifact_health = snapshot;
    recordProbeSnapshot(job, snapshot, artifacts);
    if (job.review_session_id) {
      const session = store.get(job.review_session_id);
      if (session) {
        session.artifact_health = snapshot;
        store.save(session);
      }
    }
    return snapshot;
  }

  async function refreshArtifactHealthBestEffort(
    job: IfcReadyIntakeJob,
    artifacts: { modelArtifactUrl?: string | null; mappingUrl?: string | null } = artifactUrlsForJob(job),
  ): Promise<ArtifactHealthSnapshot | null> {
    try {
      return await refreshArtifactHealthForJob(job, artifacts);
    } catch {
      return publicArtifactHealthForJob(job);
    }
  }

  function latestIfcReadyJobForSession(sessionId: string): IfcReadyIntakeJob | null {
    return externalIfcReadyStore
      .list()
      .filter((candidate) => candidate.review_session_id === sessionId)
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0] ?? null;
  }

  async function refreshArtifactHealthForSessionBestEffort(session: ReviewSession): Promise<ArtifactHealthSnapshot | null> {
    const linkedJob = latestIfcReadyJobForSession(session.session_id);
    if (linkedJob) {
      return refreshArtifactHealthBestEffort(linkedJob);
    }
    const binding = expectedStageBinding(session);
    if (!binding?.url && !binding?.mapping_url) {
      return session.artifact_health ?? null;
    }
    if (!isTrustedDirectSessionProbeBinding(binding, config.streamingConversionApiBase)) {
      return session.artifact_health ?? null;
    }
    try {
      const snapshot = await probeArtifactHealth({
        host_local_path: null,
        model_artifact_url: binding.url ?? null,
        mapping_url: binding.mapping_url ?? null,
        edge_runtime_data_root: config.edgeRuntimeDataRoot,
        storage_root: config.storageHostRoot,
        configured_conversion_api_origin: config.streamingConversionApiBase,
        checked_at: nowIso(),
      });
      session.artifact_health = snapshot;
      store.save(session);
      return snapshot;
    } catch {
      return session.artifact_health ?? null;
    }
  }

  function logIfcReadyReviewSessionActive(
    job: IfcReadyIntakeJob,
    session: ReviewSession,
    sessionReplay: boolean,
  ): void {
    structLog
      .withTraceId(job.ifc_ready_job_id)
      .lifecycle("ifcReadyReviewSession", "IFC-ready review session opened", {
        phase: "active",
        subject_kind: "review_session",
        subject_id: session.session_id,
        ifc_ready_job_id: job.ifc_ready_job_id,
        session_replay: sessionReplay,
      });
  }

  app.use(cors({ origin: corsOrigins }));
  const globalJsonParser = express.json({
    limit: "1mb",
    verify: (request, _response, buffer) => {
      (request as RawBodyRequest).rawBody = buffer.toString("utf8");
    },
  });
  app.use((request, response, next) => {
    response.locals.viewerLogIntakeRequest = request.method === "POST"
      && /^\/api\/internal\/viewer-log\/?$/i.test(request.path);
    if (response.locals.viewerLogIntakeRequest === true) {
      next();
      return;
    }
    globalJsonParser(request, response, next);
  });
  registerConsoleRoutes(app, config, resolvePublicDir(), (sessionId) => {
    const resolved = sessionTraceResolver.resolveAndCommit(sessionId);
    return resolved.ok ? resolved.canonicalTraceId : null;
  });

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "bim-review-coordinator",
      kit_signaling_port: config.kitSignalingPort,
    });
  });

  app.get("/api/runtime/status", (_request, response) => {
    const ifcReadyJobs = externalIfcReadyStore.list().map((job) => ({
      ...job,
      artifact_health: publicArtifactHealthForJob(job, store.get(job.review_session_id || "")),
    }));
    response.json(buildRuntimeStatus({
      config,
      startedAt,
      sessions: store.list(),
      ifcReadyJobs,
      viewerLeasesBySession: (sessionId) => viewerLeaseStore.list(sessionId).map((lease) => publicLease(lease)),
    }));
  });

  app.post("/api/review-sessions", async (request, response, next) => {
    try {
      const input = createSessionSchema.parse(request.body);
      // A3 一鍵鏈：federated_set_id → server-side 向 governance 解析 review-room 真 stage 路徑，
      // 生成一筆 derived+ready binding（load_order 0 ⇒ stream-config stage_composition.primary）。
      // 失敗語意：governance 不可達=502（不偽造）、set 未 build/未 ready=409。
      if (input.federated_set_id) {
        const setId = input.federated_set_id;
        let room: { ready?: boolean; stage_url?: string | null } | null = null;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          try {
            const res = await fetch(
              `${governanceApiBaseForSnapshot()}/api/federated-sets/${encodeURIComponent(setId)}/review-room`,
              { signal: controller.signal },
            );
            if (!res.ok) {
              response.status(409).json({ error: "federated_set_not_ready", detail: `governance review-room HTTP ${res.status}` });
              return;
            }
            room = (await res.json()) as { ready?: boolean; stage_url?: string | null };
          } finally {
            clearTimeout(timer);
          }
        } catch {
          response.status(502).json({ error: "governance_unreachable" });
          return;
        }
        if (room?.ready !== true || !room.stage_url) {
          response.status(409).json({ error: "federated_set_not_ready", detail: "review-room ready!=true（先 build federated set）" });
          return;
        }
        // 與既有 conversion 流的 binding 同語意（url=server-local stage 路徑，Kit 端消費）；
        // 放前端 bindings 之前，load_order 0 保證 primary 落在 federated stage。
        input.artifact_bindings = [
          {
            artifact_group_id: `fedset_${setId}`,
            artifact_id: `fed_${setId}_review`,
            display_name: `federated:${setId}`,
            artifact_role: "derived" as const,
            url: room.stage_url,
            load_order: 0,
            ready_status: "ready" as const,
          },
          ...input.artifact_bindings,
        ];
      }
      const artifacts: Artifact[] = [];
      const readyUsdc = chooseReadyUsdc(artifacts);
      const artifactBindings = buildArtifactBindings(input.model_version_id, artifacts, input.artifact_bindings, input.routing_policy);
      const kitInstanceBindings = allocateKitInstanceBindings(
        config,
        artifactBindings,
        input.routing_policy,
        input.tenant_id,
        input.kit_profile,
      );
      if (input.options?.auto_allocate_kit !== false && kitInstanceBindings.length === 0) {
        response.status(409).json({
          detail: "No Kit capacity available.",
          status: "queued_for_instance",
          artifact_bindings: artifactBindings,
        });
        return;
      }
      const session = store.create({
        review_request_id: input.review_request_id,
        tenant_id: input.tenant_id,
        project_id: input.project_id,
        model_version_id: input.model_version_id,
        source_artifact_id: input.source_artifact_id,
        usdc_artifact_id: input.usdc_artifact_id || readyUsdc?.artifact_id,
        created_by: input.created_by,
        mode: input.mode,
        kit_instance: legacyKitInstanceFromBinding(kitInstanceBindings[0], config),
        artifact_bindings: artifactBindings,
        kit_instance_bindings: kitInstanceBindings,
        quality_metrics_summary: (input.quality_metrics_summary ?? null) as ConversionQualityMetricsSummary | null,
      });
      eventLog.append(session.session_id, "sessionCreated", {
        project_id: session.project_id,
        model_version_id: session.model_version_id,
        review_request_id: session.review_request_id,
      });
      if (session.status === "active") {
        eventLog.append(session.session_id, "sessionActive", {
          kit_instance_bindings: session.kit_instance_bindings.map((binding) => binding.kit_instance_id),
        });
      }
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/review-sessions/:sessionId", (request, response) => {
    if (!isSafeSessionId(request.params.sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    const session = store.get(request.params.sessionId);
    if (!session) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    response.json(session);
  });

  app.post("/api/review-sessions/:sessionId/join", (request, response, next) => {
    try {
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const input = participantSchema.parse(request.body);
      const current = store.get(request.params.sessionId);
      if (current && !isSessionMutable(current)) {
        response.status(409).json({ detail: "Review session is not active." });
        return;
      }
      const session = store.join(request.params.sessionId, input);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/review-sessions/:sessionId/leave", (request, response, next) => {
    try {
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const input = participantSchema.parse(request.body);
      const session = store.leave(request.params.sessionId, input.user_id);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/review-sessions/:sessionId/stream-config", async (request, response) => {
    if (!isSafeSessionId(request.params.sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    const session = store.get(request.params.sessionId);
    if (!session) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    await refreshArtifactHealthForSessionBestEffort(session);
    const traceAuthority = sessionTraceResolver.resolveAndCommit(session.session_id);
    if (!traceAuthority.ok) {
      response.status(409).json({ detail: "Session trace authority unavailable." });
      return;
    }
    response.json(buildStreamConfig(
      store.get(session.session_id) ?? session,
      [],
      config,
      traceAuthority.canonicalTraceId,
    ));
  });

  // m2a-coverage-report:production 唯讀 passthrough。以 conversion_job_id 取後端品質摘要,
  // 不綁 review session。coordinator 零計算 —— 值全來自 buildQualityMetricsSummary（與
  // stream-config 同一真相源）。錯誤路徑一律不回捏造 coverage。
  app.get("/api/conversions/:conversionJobId/quality-metrics", async (request, response) => {
    const jobId = request.params.conversionJobId;
    if (!isSafeConversionJobId(jobId)) {
      response.status(400).json({ detail: "Invalid conversion job id." });
      return;
    }
    try {
      const result = await streamingConversionClient.fetchConversionResult(jobId);
      const summary = buildQualityMetricsSummary(result);
      response.json({
        conversion_job_id: result.conversion_job_id,
        quality_metrics_summary: summary, // 可能為 null（result 無 quality_metrics）—— 誠實「未取得」
        usdc_url: result.usdc_ref,
        mapping_url: result.element_mapping_ref,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/API 404\b/.test(msg)) {
        response.status(404).json({ detail: "Conversion job result not found." });
        return;
      }
      const name = err instanceof Error ? err.name : "";
      const code = name === "TimeoutError" || /timeout|aborted/i.test(msg) ? 503 : 502;
      // 不把內部 authority URL / upstream body 外溢給 client（spec §2/§7：錯誤不外溢內部欄位）；
      // 真實錯誤只記 server log 供診斷。
      console.error(`[quality-metrics] conversion authority error ${code} for ${jobId}: ${msg}`);
      response.status(code).json({ detail: "Conversion authority unreachable." });
    }
  });

  // conv-prioritize-retry (IX-CV-03):協調器自有 dispatch 佇列的 controlled action。
  // :id = ifc_ready_job_id。只動協調器 in-memory FIFO，不碰 bim-streaming-server。
  // 模式 3 ③ audit：成功寫一筆結構化 audit log（actor best-effort）。body optional { reason?: string }。
  function resolveActor(request: express.Request): string {
    const header = request.header("X-Operator") ?? request.header("X-Actor");
    // 與 parseReason 的 .slice(0, 500) 對稱:actor 也宣告 budget 上限(200),避免超大
    // header 讓每筆 audit record 的 actor 欄位膨脹、長期撐爆 audit JSONL。
    return typeof header === "string" && header.trim().length > 0 ? header.trim().slice(0, 200) : "local-operator";
  }
  function parseReason(request: express.Request): string {
    const body = request.body as { reason?: unknown } | undefined;
    return typeof body?.reason === "string" ? body.reason.slice(0, 500) : "";
  }
  // 控制路由的最小守門：沿用 /api/external/ifc-ready 的 IP allowlist（isIpAllowed +
  // externalIntakeIpAllowlist）阻擋非本地請求。這兩條路由是協調器 control-plane 的
  // mutation surface；AGENTS.md MUST NOT 禁止「外部公司雲端 control-plane 取代」，
  // 故 LAN/CORS 任意 origin 不得匿名寫入。回 true 表示已寫 403 並終止。
  function rejectIfIpNotAllowed(request: express.Request, response: express.Response): boolean {
    const clientIp = request.ip || request.socket.remoteAddress || "";
    // 與 IntranetDevAuthProvider.authenticate 的 `length > 0 && !isIpAllowed(...)` 語意對稱:
    // 空 allowlist 代表「未啟用 IP 守門」→ bypass 全部放行,而非 `![].some()` = true 造成全 403。
    if (
      config.externalIntakeIpAllowlist.length > 0 &&
      !isIpAllowed(clientIp, config.externalIntakeIpAllowlist)
    ) {
      response.status(403).json({ detail: "caller ip not in allowlist" });
      return true;
    }
    return false;
  }

  // unified-console-runtime-truth slice 2（owner D2 裁決 T4，2026-08-25）：四條 conversion 控制路由的
  // per-route wrapper——「IP allowlist 通過 **或** operator token 通過」。rejectIfIpNotAllowed 本體不改
  //（lineage source-bundle 路由仍經 deps 注入使用它，授權逐字不變；釘樁見 tests/lineage/conversion-control-auth-pins）。
  // allowlist 路徑（含 loopback 的 minio-watcher self-POST）行為逐字不變且不計速率；token 路徑沿用
  // isKitMutationAuthorized 同型比對，config.devAuthToken 仍為預設 "dev-token" 時 token 路徑視為未啟用
  //（fail-closed，只剩 allowlist）；token 路徑每來源 IP 每分鐘 10 次（in-memory 滑動視窗），超額 429＋Retry-After。
  const rejectIfConversionControlUnauthorized = createConversionControlGuard({
    isCallerIpAllowed: (clientIp) =>
      !(config.externalIntakeIpAllowlist.length > 0 && !isIpAllowed(clientIp, config.externalIntakeIpAllowlist)),
    operatorTokenPathEnabled: () => isOperatorTokenPathEnabled(config.devAuthToken),
    isOperatorTokenValid: (request) => isKitMutationAuthorized(request, config.devAuthToken),
    rateLimiter: new SlidingWindowRateLimiter(OPERATOR_TOKEN_RATE_LIMIT, OPERATOR_TOKEN_RATE_WINDOW_MS),
  });

  app.post("/api/conversion/jobs/:id/prioritize", (request, response) => {
    if (rejectIfConversionControlUnauthorized(request, response)) return;
    const id = request.params.id;
    if (!isSafeIfcReadyJobId(id)) {
      response.status(400).json({ detail: "Invalid ifc-ready job id." });
      return;
    }
    const result = ifcReadyPipeline.prioritize(id);
    if (!result.ok) {
      response.status(result.status).json({ detail: result.detail });
      return;
    }
    const reason = parseReason(request);
    const actor = resolveActor(request);
    structLog.withTraceId(id).audit("conversion-control", "conversion.prioritize", {
      action: "conversion.prioritize", actor, target: id, reason,
    }, "info");
    response.json({
      ifc_ready_job_id: id,
      status: result.status,
      queue_position: result.queue_position,
      queued_order: result.queued_order,
      reason,
    });
  });

  app.post("/api/conversion/jobs/:id/retry", (request, response) => {
    if (rejectIfConversionControlUnauthorized(request, response)) return;
    const id = request.params.id;
    if (!isSafeIfcReadyJobId(id)) {
      response.status(400).json({ detail: "Invalid ifc-ready job id." });
      return;
    }
    const result = ifcReadyPipeline.retryDispatch(id);
    if (!result.ok) {
      if (result.code === "not_retryable" && result.job) {
        response.status(409).json({
          detail: result.detail,
          recovery_action: deriveConversionRecoveryAction(result.job),
        });
        return;
      }
      response.status(result.status).json({ detail: result.detail });
      return;
    }
    const reason = parseReason(request);
    const actor = resolveActor(request);
    structLog.withTraceId(id).audit("conversion-control", "conversion.retry", {
      action: "conversion.retry", actor, target: id, reason,
    }, "info");
    response.json({
      ifc_ready_job_id: id,
      status: "queued_for_conversion",
      queue_position: result.queue_position,
      reason,
    });
  });

  // conv-watch-toggle (IX-CV-04)：協調器自有 MinIO watcher 生命週期的 controlled action。
  // 只動協調器 in-process watcher handle（start/dispose），不碰 MinIO server / bim-streaming-server。
  // 模式 3 危險動作：① IP allowlist 守門（CR-A）② busy 鎖防競態（CR-B）③ 未配置誠實 422（CR-C）
  // ④ audit 一筆。body { enabled: boolean; reason?: string }。
  app.put("/api/conversion/watch", async (request, response) => {
    if (rejectIfConversionControlUnauthorized(request, response)) return; // CR-A：IP allowlist 或 operator token（slice 2 T4）
    const body = request.body as { enabled?: unknown } | undefined;
    if (typeof body?.enabled !== "boolean") {
      response.status(400).json({ detail: "Body must include boolean 'enabled'." });
      return;
    }
    const reason = parseReason(request);
    const actor = resolveActor(request);
    // toggle 語意（busy 鎖 / 未配置 422 / 啟動失敗回滾 / 冷啟 vs no-op 區分）由 surface 擁有；
    // route 只做 HTTP 映射與 audit（audit 需 request 的 actor/reason，屬 HTTP 層關注）。
    const outcome = await minioWatchSurface.setEnabled(body.enabled);
    if (!outcome.ok) {
      switch (outcome.code) {
        case "busy": // CR-B：toggle 進行中
          response.status(409).json({ detail: "Watcher toggle in progress; retry shortly." });
          return;
        case "not_configured": // CR-C：未配置誠實拒絕
          // 失敗嘗試也須留 audit trail（review Important #1）：未配置仍嘗試啟動是 security-sensitive
          // 操作面的誤操作/探測訊號，level 降 warn 以與成功 info 區分；outcome 編進 target。
          structLog.withTraceId("minio-watch").audit("conversion-control", "conversion.watch.toggle", {
            action: "conversion.watch.toggle", actor, target: "watch:enable:rejected-not-configured", reason,
          }, "warn");
          response.status(422).json({ detail: "MinIO watch not configured (endpoint/bucket/credentials missing); cannot enable." });
          return;
        case "start_failed":
          // watcher 啟動失敗同樣留 audit（review Important #1），保留失敗訊息至 reason 供事後追查。
          // runtime flag 回滾（不留半開狀態）由 surface 內部保證。
          structLog.withTraceId("minio-watch").audit("conversion-control", "conversion.watch.toggle", {
            action: "conversion.watch.toggle", actor, target: "watch:enable:failed-start",
            reason: `${reason ? `${reason} | ` : ""}error: ${outcome.message}`,
          }, "warn");
          response.status(500).json({ detail: `Failed to start watcher: ${outcome.message}` });
          return;
      }
    }
    // spec §4.1：成功 toggle audit 須含獨立 `enabled` 布林（供以 enabled 查 audit 的工具命中）；
    // 同時保留 target 方向編碼。double-enable no-op（P5 對抗複驗 task1-important2）須與真冷啟
    // 區分（target=watch:enable:noop），否則稽核者無法分辨「真啟動」vs「冗餘 no-op」。
    structLog.withTraceId("minio-watch").audit("conversion-control", "conversion.watch.toggle", {
      action: "conversion.watch.toggle", actor,
      target: body.enabled ? (outcome.noop ? "watch:enable:noop" : "watch:enable") : "watch:disable",
      enabled: body.enabled, reason,
    }, "info");
    response.json(minioWatchSurface.status());                          // 與 GET status 同一投影
  });

  // A1 手動觸發：前端只送 MinIO object key，coordinator server-side presign + 重用 watcher
  // intake 邏輯 self-POST /api/external/ifc-ready。冪等鍵 mw_<hash16>，同 key 回既有 job。
  // 守門比照其他 /api/conversion/* 控制路由（rejectIfIpNotAllowed）。
  app.post("/api/conversion/trigger", async (request, response) => {
    if (rejectIfConversionControlUnauthorized(request, response)) return;
    // 連線參數須齊全（endpoint/bucket/accessKey/secretKey）。僅檢 endpoint/bucket 會放行空憑證，
    // presign 仍以空憑證簽出 URL、self-POST 過關，IFC 下載卻在 MinIO 認證靜默失敗（job failed）。
    // 複用 surface.configured()（四欄全檢，與 PUT /api/conversion/watch 422 判斷同一把尺）。
    if (!minioWatchSurface.configured()) {
      response.status(503).json({ detail: "MinIO 未設定（endpoint/bucket/credentials 不齊全）" });
      return;
    }
    const key = typeof request.body?.key === "string" ? request.body.key : "";
    if (!key) {
      response.status(400).json({ detail: "缺 key" });
      return;
    }
    // idempotencyKeyFor/correlationIdFor（minioWatcher.ts:29/39）文件化前置條件：key 不得含 `|`，
    // 因為 hash input 以 `|` 分隔 bucket|key|etag。deriveIntakeFromKey 只擋空段/`.`/`..`，不擋 `|`，
    // 故在計算冪等鍵前先擋下，避免不同 (bucket, key, etag) 撞同一 hash（違反不變式）。
    if (key.includes("|")) {
      response.status(400).json({ detail: "key 不合法：不得含 `|`（與 idempotency hash 分隔符衝突）" });
      return;
    }
    // S3/MinIO object key 上限 1024 bytes（AWS S3 規範）；超長 key 只會無謂往返 MinIO + 灌大 hash 輸入，
    // 與 deriveIntakeFromKey 的其他輸入驗證（防穿越/空段）同精神，提前擋下。
    if (key.length > 1024) {
      response.status(400).json({ detail: "key 過長（S3 object key 上限 1024 bytes）" });
      return;
    }
    const forceRetrigger = request.body?.force_retrigger === true;
    // terminal converter failure 的 operator recovery 需要一個明確的新 attempt；attempt salt
    // 由 route 生成（時鐘/亂數屬 HTTP 層），surface 只做確定性 presign/idempotency/self-POST。
    const attemptSalt = forceRetrigger ? `retrigger_${Date.now()}_${randomWebViewSuffix()}` : "";
    const outcome = await minioWatchSurface.manualTrigger(key, { forceRetrigger, attemptSalt });
    switch (outcome.kind) {
      case "invalid_key":
        response.status(400).json({ detail: outcome.detail });
        return;
      case "presign_failed":
        response.status(502).json({ detail: `presign 失敗：${outcome.message}` });
        return;
      case "fetch_failed":
        response.status(502).json({ detail: `trigger 失敗：${outcome.message}` });
        return;
      case "upstream":
        // 誠實：回應不夾帶 presigned ref（即使上游回了也遮蔽；source_ifc_ref 由上游 summarize 已遮蔽）
        response.status(outcome.status).json({
          ...outcome.body,
          trigger_source: "manual",
          force_retrigger: forceRetrigger,
          recovery_action: forceRetrigger ? "retrigger_submitted" : undefined,
        });
        return;
    }
  });

  app.get("/api/review-sessions/:sessionId/events", (request, response) => {
    if (!isSafeSessionId(request.params.sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    if (!store.get(request.params.sessionId)) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    response.json({ items: eventLog.list(request.params.sessionId) });
  });

  app.get("/api/review-sessions/:sessionId/lifecycle-events", (request, response) => {
    if (!isSafeSessionId(request.params.sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    if (!store.get(request.params.sessionId)) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    response.json({ items: eventLog.listLifecycle(request.params.sessionId) });
  });

  app.post("/api/review-sessions/:sessionId/events", (request, response, next) => {
    try {
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      if (!isSessionMutable(session)) {
        response.status(409).json({ detail: "Review session is not active." });
        return;
      }
      const input = appendEventSchema.parse(request.body);
      const event = eventLog.append(request.params.sessionId, input.type, input);
      response.json(event);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/review-sessions/:sessionId/first-frame", (request, response, next) => {
    try {
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      // 與 sibling mutation 路由（append-event app.ts:866 等）一致的可變性守門：closed/closing
      // session 不可再 store.update + append firstFrameObserved 進 append-only audit ledger。
      // race（browser close 與 viewer 首幀同時抵達）可產生不一致狀態，故在冪等檢查前先回 409。
      if (!isSessionMutable(session)) {
        response.status(409).json({ detail: "Review session is not active." });
        return;
      }
      // 冪等：已記過 → 回原時戳，不重複 append（N2 最小一筆）。
      if (session.first_frame_at) {
        response.json({ session_id: session.session_id, first_frame_at: session.first_frame_at });
        return;
      }
      // endpoint_id 來自 iframe postMessage 的 client 回報（LAN 無 RBAC，任何頁面可偽造），與
      // resolveActor(.slice(0, 200))/parseReason(.slice(0, 500)) 的 budget 截斷對齊（上限 100），
      // 避免超長字串撐爆 / 污染 append-only audit JSONL（log injection 同根防護）。
      const endpointId = typeof request.body?.endpoint_id === "string" ? request.body.endpoint_id.slice(0, 100) : undefined;
      const actor = resolveActor(request); // best-effort（LAN 無 RBAC，沿用既有）
      const at = nowIso(); // N3：coordinator 權威時戳，忽略 body.observed_at（iframe/coordinator 時鐘無同步保障）
      // store.update 在 store.get（上方守門）與此處之間 session 檔被外部刪除時回 null（與 sibling
      // /close app.ts:951-962 對 store.update null 的防禦一致）。若忽略回傳值會 (1) 仍 append 一筆
      // 孤兒 firstFrameObserved（對應不到任何 store 記錄，違反 append-only audit ledger 不變式），
      // (2) 回 200 + 未實際持久化的時戳給呼叫端。故 update 失敗時回 500、不 append。
      const updated = store.update(session.session_id, { first_frame_at: at });
      if (!updated) {
        response.status(500).json({ detail: "Session update failed." });
        return;
      }
      eventLog.append(session.session_id, "firstFrameObserved", { endpoint_id: endpointId, actor });
      response.json({ session_id: session.session_id, first_frame_at: at });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/review-sessions/:sessionId/viewer-leases/claim", (request, response, next) => {
    try {
      const user = userAuthProvider.authenticate({ headers: headersToMap(request.headers) });
      if (process.env.NODE_ENV === "production" && user.ssoBinding === "pending_oq5") {
        response.status(503).json({ detail: "production_identity_unavailable" });
        return;
      }
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      if (!isSessionMutable(session)) {
        response.status(409).json({ detail: "Review session is not active." });
        return;
      }

      const input = claimViewerLeaseSchema.parse(request.body);
      if (input.user_id) {
        const legacyPrincipal = user.provider === "local-dev"
          ? opaqueLocalDevSubject(input.user_id)
          : input.user_id;
        if (legacyPrincipal !== user.userId) {
          throw new AuthError(403, "viewer lease identity mismatch");
        }
      }
      const result = viewerLeaseStore.claim({
        session_id: session.session_id,
        viewer_id: input.viewer_id,
        user_id: user.userId,
        display_name: input.display_name ?? null,
        requested_role: input.requested_role,
        client_nonce: input.client_nonce ?? null,
        preferred_kit_instance_id: input.preferred_kit_instance_id ?? null,
        bindings: runtimeKitInstanceBindings(session, config),
      });
      if (!result.ok || !result.lease) {
        if (result.detail === "primary_already_claimed") {
          response.status(409).json({ detail: "primary_already_claimed" });
          return;
        }
        response.status(409).json({ detail: result.detail ?? "viewer lease unavailable" });
        return;
      }
      if (!result.idempotent_replay) {
        eventLog.append(session.session_id, "viewerLeaseClaimed", {
          lease_id: result.lease.lease_id,
          viewer_id: result.lease.viewer_id,
          user_id: result.lease.user_id,
          role: result.lease.role,
          kit_instance_id: result.lease.kit_instance_id,
        });
      }
      response.json({
        ...publicLease(result.lease, { includeToken: true }),
        auth_scope: user.ssoBinding === "pending_oq5" ? "local_dev_lab" : "bound",
        primary: result.lease.role === "primary",
        heartbeat_after_ms: viewerLeaseStore.heartbeatAfterMs,
        idempotent_replay: Boolean(result.idempotent_replay),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/review-sessions/:sessionId/viewer-leases/:leaseId/heartbeat", (request, response, next) => {
    try {
      if (process.env.NODE_ENV === "production" && userAuthProvider.name === "local-dev") {
        response.status(503).json({ detail: "production_identity_unavailable" });
        return;
      }
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      if (!isSessionMutable(session)) {
        response.status(409).json({ detail: "Review session is not active." });
        return;
      }
      const leaseToken = request.header("X-Viewer-Lease-Token") ?? "";
      const input = heartbeatViewerLeaseSchema.parse(request.body);
      const lease = viewerLeaseStore.heartbeat(session.session_id, request.params.leaseId, leaseToken, {
        ...input,
        expected_stage_url: expectedStageBinding(session)?.url ?? null,
      });
      if (!lease) {
        response.status(404).json({ detail: "Viewer lease not found or token invalid." });
        return;
      }
      eventLog.append(session.session_id, "viewerLeaseHeartbeat", {
        lease_id: lease.lease_id,
        role: lease.role,
        first_frame: Boolean(input.first_frame),
        loaded_stage_url: input.loaded_stage_url ?? null,
        datachannel_ready: input.datachannel_ready ?? null,
        stage_match: lease.stage_match,
      });
      response.json({
        ...publicLease(lease),
        heartbeat_after_ms: viewerLeaseStore.heartbeatAfterMs,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/review-sessions/:sessionId/viewer-leases/:leaseId/release", (request, response, next) => {
    try {
      if (process.env.NODE_ENV === "production" && userAuthProvider.name === "local-dev") {
        response.status(503).json({ detail: "production_identity_unavailable" });
        return;
      }
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      releaseViewerLeaseSchema.parse(request.body);
      const leaseToken = request.header("X-Viewer-Lease-Token") ?? "";
      const lease = viewerLeaseStore.release(session.session_id, request.params.leaseId, leaseToken);
      if (!lease) {
        response.status(404).json({ detail: "Viewer lease not found or token invalid." });
        return;
      }
      eventLog.append(session.session_id, "viewerLeaseReleased", {
        lease_id: lease.lease_id,
        role: lease.role,
      });
      response.json(publicLease(lease));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/review-sessions/:sessionId/viewer-leases/status", (request, response, next) => {
    try {
      const user = userAuthProvider.authenticate({ headers: headersToMap(request.headers) });
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      const allLeases = viewerLeaseStore.list(session.session_id);
      const leases = allLeases.filter((lease) => lease.user_id === user.userId);
      const primaryLease = allLeases.find((lease) => lease.status === "active" && lease.role === "primary") ?? null;
      response.json({
        session_id: session.session_id,
        auth_scope: user.ssoBinding === "pending_oq5" ? "local_dev_lab" : "bound",
        primary: {
          available: primaryLease === null,
          owned_by_caller: primaryLease?.user_id === user.userId,
        },
        leases: leases.map((lease) => publicLease(lease)),
        stage_binding: (() => {
          const summary = runtimeMutationAuthority.getStageBindingSummary({
            sessionId: session.session_id,
            principal: user.userId,
          });
          return {
            transaction_status: summary.transactionStatus,
            binding_revision_id: summary.bindingRevisionId,
            active_binding_revision: summary.activeBindingRevision,
            last_good_binding_revision: summary.lastGoodBindingRevision,
          };
        })(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/review-sessions/:sessionId/close", (request, response) => {
    // IX-SS-04（使用者裁定 A，ref commit ce61993）：此路由【刻意不加 rejectIfIpNotAllowed IP allowlist 守門】，
    // 與 sibling controlled-action 路由（prioritize app.ts:684 / retry app.ts:722 / watch app.ts:767）不同。
    // 原因：close 同一端點同時服務兩種語意——(1) browser-originated cooperative close（帶 final_events）與
    // (2) operator terminate（帶 reason）。兩者沒有 header/body 欄位可在進入 handler 前可靠區分，故無法只對
    // operator 路徑加門控而不波及 cooperative 路徑：加 gate 會讓 IP 不在 allowlist 的 browser 協作式 close 吃 403，
    // 違反 spec §3 non-goal「不改既有 cooperative close 行為」。⇒ 此處 IP allowlist 的缺席是經設計裁定的取捨，
    // 非遺漏；維護者請勿補回 gate（會破壞 cooperative close），安全審查亦不應將此判為守門漏洞。
    if (!isSafeSessionId(request.params.sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    const session = store.get(request.params.sessionId);
    if (!session) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    // closed 已具完整終態 audit，直接冪等回傳；closing 則交由共用 close helper 依既有
    // server-owned close checkpoint 數量補寫缺少的 finalReviewEvent，未補齊前不得宣告 closed；
    // generic event type 永遠不是 close resumption authority。
    if (session.status === "closed") {
      response.json(session);
      return;
    }

    const finalEvents = Array.isArray(request.body?.final_events) ? request.body.final_events : [];
    // IX-SS-04 spec §2.1/§4.1：reason 缺省為 undefined（不沿用共用 parseReason 的 "" 缺省，
    // 那會讓 cooperative close payload 退化）。只有 operator terminate 真帶 reason 時才把
    // reason/actor additive 寫進事件流；無 reason 的既有 cooperative close 維持原 payload 形狀
    // （sessionClosing:{final_events}、sessionClosed:{}），符合 §3「不改既有 cooperative close 行為」。
    const rawReason = (request.body as { reason?: unknown } | undefined)?.reason;
    const reason = typeof rawReason === "string" ? (rawReason.trim().slice(0, 500) || undefined) : undefined;
    const closed = closeReviewSessionInternal(session.session_id, {
      reason,
      actor: resolveActor(request),
      finalEvents,
      resumeClosing: session.status === "closing",
    });
    response.json(closed);
  });

  app.post("/api/review-sessions/:sessionId/activity", (request, response, next) => {
    try {
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      const parsedActivity = sessionActivitySchema.safeParse(request.body);
      if (!parsedActivity.success) {
        response.status(401).json({ detail: "missing or invalid viewer lease" });
        return;
      }
      const input = parsedActivity.data;
      const leaseToken = request.header("X-Viewer-Lease-Token") ?? "";
      if (!viewerLeaseStore.authorizeActive(session.session_id, input.lease_id, leaseToken)) {
        response.status(401).json({ detail: "missing or invalid viewer lease" });
        return;
      }
      const recorded = idleReclaimService.recordActivity(request.params.sessionId);
      if (!recorded) {
        response.status(409).json({
          detail: "Session activity requires an enabled idle policy and a connected viewer.",
        });
        return;
      }
      response.json({
        ok: true,
        session_id: request.params.sessionId,
        recorded_at: nowIso(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/review-sessions/:sessionId/idle-status", (request, response) => {
    if (!isSafeSessionId(request.params.sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    const session = store.get(request.params.sessionId);
    if (!session) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    const state = idleReclaimService.getSessionState(request.params.sessionId);
    response.json({
      session_id: request.params.sessionId,
      enabled: config.sessionIdleTimeoutMs !== undefined,
      has_connected_viewer: state !== null,
      is_counting_down: state?.isCountingDown ?? false,
      remaining_seconds: state?.countdownRemainingSec ?? null,
      last_activity_at: state?.lastActivityAt ? new Date(state.lastActivityAt).toISOString() : null,
    });
  });

  // Stage composition authority is a server-resolved, bounded transaction.
  // Browser input may select artifact IDs/order only; URL and revision authority
  // are generated here and remain pending until Kit confirms observed success.
  app.post("/api/review-sessions/:sessionId/stage-binding", (request, response, next) => {
    try {
      const user = userAuthProvider.authenticate({ headers: headersToMap(request.headers) });
      if (process.env.NODE_ENV === "production" && user.ssoBinding === "pending_oq5") {
        response.status(503).json({ detail: "production_identity_unavailable" });
        return;
      }
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      if (!isSessionMutable(session)) {
        response.status(409).json({ detail: "Review session is not active." });
        return;
      }

      const input = stageBindingPreauthorizationSchema.parse(request.body);
      const created = runtimeMutationAuthority.preauthorizeStageBinding({
        sessionId: session.session_id,
        principal: user.userId,
        sourceClientId: input.source_client_id,
        credential: request.header("X-Viewer-Lease-Token") ?? "",
        clientRequestId: input.client_request_id,
        artifacts: input.artifacts.map((artifact) => ({
          artifactId: artifact.artifact_id,
          role: artifact.role,
          loadOrder: artifact.load_order,
        })),
      });
      if (!created.ok) {
        switch (created.reason) {
          case "session_not_found":
            response.status(404).json({ detail: "Review session not found." });
            break;
          case "session_lifecycle_blocked":
            response.status(409).json({ detail: "Review session is not active." });
            break;
          case "primary_lease_required":
            response.status(403).json({ detail: "stage binding requires caller's active primary viewer lease" });
            break;
          case "artifact_selection_invalid":
            response.status(400).json({
              detail: "stage binding requires unique artifacts/order and exactly one primary",
            });
            break;
          case "artifact_unavailable":
            response.status(409).json({ detail: "selected stage artifact is not ready or not in the session" });
            break;
          case "capacity_exceeded":
            response.status(503).json({ detail: "stage_binding_capacity_exceeded" });
            break;
          case "transaction_executing":
            response.status(409).json({ detail: "stage_binding_transaction_executing" });
            break;
          case "request_cancelled":
            response.status(409).json({ detail: "stage_binding_request_cancelled" });
            break;
          default: {
            const unhandledReason: never = created.reason;
            throw new Error(`Unhandled stage-binding preauthorization outcome: ${unhandledReason}`);
          }
        }
        return;
      }

      response.json({
        status: "pending",
        session_id: session.session_id,
        auth_scope: user.ssoBinding === "pending_oq5" ? "local_dev_lab" : "bound",
        stage_binding_authorization_id: created.stageBindingAuthorizationId,
        binding_revision_id: created.bindingRevisionId,
        stage_composition: toWireStageComposition(created.composition),
        pending_expires_at: created.pendingExpiresAt,
      });
    } catch (error) {
      next(error);
    }
  });

  // A browser deadline must be able to fence an in-flight POST before it
  // creates a stale pending transaction. This route is lease-authenticated;
  // it cancels only the caller's opaque client intent and never touches Kit.
  app.post("/api/review-sessions/:sessionId/stage-binding-cancellations", (request, response, next) => {
    try {
      const user = userAuthProvider.authenticate({ headers: headersToMap(request.headers) });
      if (process.env.NODE_ENV === "production" && user.ssoBinding === "pending_oq5") {
        response.status(503).json({ detail: "production_identity_unavailable" });
        return;
      }
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      if (!isSessionMutable(session)) {
        response.status(409).json({ detail: "Review session is not active." });
        return;
      }

      const input = stageBindingPreauthorizationCancellationSchema.parse(request.body);
      const cancelled = runtimeMutationAuthority.cancelStageBindingPreauthorization({
        sessionId: session.session_id,
        principal: user.userId,
        sourceClientId: input.source_client_id,
        credential: request.header("X-Viewer-Lease-Token") ?? "",
        clientRequestId: input.client_request_id,
      });
      if (!cancelled.cancelled) {
        switch (cancelled.reason) {
          case "session_not_found":
            response.status(404).json({ detail: "Review session not found." });
            break;
          case "session_lifecycle_blocked":
            response.status(409).json({ detail: "Review session is not active." });
            break;
          case "primary_lease_required":
            response.status(403).json({ detail: "stage binding requires caller's active primary viewer lease" });
            break;
          case "transaction_not_abortable":
            response.status(409).json({
              cancelled: false,
              client_request_id: input.client_request_id,
              detail: "stage_binding_transaction_not_abortable",
            });
            break;
          default: {
            const unhandledReason: never = cancelled.reason;
            throw new Error(`Unhandled stage-binding cancellation outcome: ${unhandledReason}`);
          }
        }
        return;
      }
      response.json({
        cancelled: true,
        client_request_id: input.client_request_id,
        idempotent_replay: cancelled.idempotentReplay,
      });
    } catch (error) {
      next(error);
    }
  });

  // B-scheme（local-coordinator-ifc-ready-intake-boundary T3）：
  // 唯一對外 IFC-ready intake。caller = 客戶落地端 IFC Worker（落地端內網，
  // machine-to-machine）。streaming 為 internal-only 轉檔引擎（T4）。
  app.post("/api/external/ifc-ready", async (request, response, next) => {
    try {
      // backfill-coordinator-webhook-and-auto-session §1：normalize canonical
      // 與 worker compatibility payload 為同一 ExternalIfcReadyEvent，再走既有
      // auth / store / dispatch 路徑。worker compat 缺 X-Correlation-Id /
      // X-Idempotency-Key 時，從 project_id+version+task_id 派生作為 fallback
      // 注入 header map；explicit headers 仍優先（D11）。
      const normalized = normalizeIntakePayload(request.body);
      const event = { ...normalized.event };
      event.callback_url = resolveAllowedCallbackTarget(event.callback_url ?? null, config);
      const headerMap = headersToMap(request.headers);
      if (normalized.isWorkerCompat) {
        if (!headerMap["x-correlation-id"] && normalized.derivedCorrelationId) {
          headerMap["x-correlation-id"] = normalized.derivedCorrelationId;
        }
        if (!headerMap["x-idempotency-key"] && normalized.derivedIdempotencyKey) {
          headerMap["x-idempotency-key"] = normalized.derivedIdempotencyKey;
        }
      }
      const auth = authProvider.authenticate({
        clientIp: request.ip || request.socket.remoteAddress || "",
        headers: headerMap,
        rawBody: (request as RawBodyRequest).rawBody ?? JSON.stringify(request.body ?? {}),
        payloadIdentity: {
          tenant_id: event.tenant_id,
          project_id: event.project_id,
          external_model_version_id: event.external_model_version_id,
        },
      });

      // Route = auth + normalize → pipeline.accept → HTTP map（wire freeze）。
      const acceptResult = await ifcReadyPipeline.accept({
        event,
        correlationId: auth.correlationId,
        idempotencyKey: auth.idempotencyKey,
        tenantId: auth.tenantId,
        projectId: auth.projectId,
        externalModelVersionId: auth.externalModelVersionId,
      });
      if (acceptResult.kind === "replay") {
        // 誠實鐵律：source_ifc_ref 含 presigned 簽章 → sanitize 再外吐。
        response.status(200).json({
          ...sanitizeJobForExternal(acceptResult.job),
          idempotent_replay: true,
        });
        return;
      }
      if (acceptResult.kind === "download_failed") {
        response.status(502).json({
          detail: "IFC download failed",
          ifc_ready_job_id: acceptResult.ifc_ready_job_id,
          error: acceptResult.message,
          reason: acceptResult.reason,
          download_status: "failed",
        });
        return;
      }
      // accepted：同步下載完成 → 202 Accepted（dispatch 已入 in-memory queue）。
      response.status(202).json({
        ...sanitizeJobForExternal(acceptResult.job),
        message: "IFC 已下載至本地共享卷,轉檔已進入派工佇列",
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/external/ifc-ready", (request, response) => {
    const limit = parseListLimit(request.query.limit);
    const jobs = externalIfcReadyStore
      .list()
      .slice()
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
    response.json({
      count: jobs.length,
      items: jobs.slice(0, limit).map((job) => {
        const session = store.get(job.review_session_id || "");
        return summarizeIfcReadyJob(job, session, publicArtifactHealthForJob(job, session));
      }),
    });
  });

  // minio-closed-loop-phase1 Task 3：讀持久 ConversionLedger；唯讀 GET，無 auth（照既有
  // /api/external/ifc-ready 模式）。插在 /api/external/ifc-ready 之後、/:jobId 之前（避免 param 吃掉）。
  app.get("/api/conversion/records", (request, response) => {
    const limit = parseListLimit(request.query.limit);
    const items = conversionLedger.list();
    response.json({ count: items.length, items: items.slice(0, limit) });
  });

  // MinIO folder cache dirty stream：watcher 觀察到新/變更 object 時，通知前端把對應 prefix
  // 視為 stale。只送 prefix metadata，不送物件內容、presigned URL 或 credentials。
  // fan-out 與 cache 失效由 surface 擁有；route 只負責 SSE headers 與 ready 握手 frame。
  app.get("/api/minio/events", (request, response) => {
    response.status(200);
    response.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`event: minio.ready\ndata: ${JSON.stringify({ type: "minio.ready", at: nowIso() })}\n\n`);
    const unsubscribe = minioWatchSurface.subscribeEvents(response);
    request.on("close", unsubscribe);
  });

  // minio-closed-loop-phase1 Task 4：唯讀 S3 list proxy。
  // MinIO 未設定時誠實回 count=0（不 500）；list 失敗回 502；presigned URL 不入 log。
  // 插在 /api/external/ifc-ready 後、/:jobId 之前（避免 param 吃掉）。
  app.get("/api/minio/objects", async (request, response) => {
    if (!config.minioWatchEndpoint || !config.minioWatchBucket) {
      // 此 early-return 同時服務 flat list（getMinioObjects）與 delimiter=/ 資料夾視圖
      // （getMinioFolder）。前端 MinioFolderListing 型別 folders 為必填陣列，故未設定分支也須補
      // folders: []（與已設定分支 listMinioFolder 回傳 shape 對齊），否則 getMinioFolder 消費端
      // r.folders.map(...) 會 TypeError crash UI。空陣列比缺欄位更誠實。
      response.json({
        bucket: config.minioWatchBucket || null,
        prefix: "",
        folders: [],
        count: 0,
        objects: [],
        note: "MinIO watch 未設定（未取得）",
      });
      return;
    }
    const rawPrefix =
      typeof request.query.prefix === "string" ? request.query.prefix : config.minioWatchPrefix;
    // 空字串 delimiter（?delimiter=）回落舊路徑（truthy check，照 plan §Task2）：
    // 只有真正帶非空 delimiter（如 /）才走資料夾語意 list，避免前端收到空 folders[] 而非舊格式。
    const rawDelimiter =
      typeof request.query.delimiter === "string" ? request.query.delimiter : "";
    const forceRefresh = request.query.refresh === "1" || request.query.force === "1";
    // spec §2.1 只定義 delimiter='/' 為有效值。白名單擋在轉送 S3 SDK 前：拒絕多字元、
    // 控制字元、XML 特殊字元等任意 delimiter（否則部分值會讓 SDK 拋非預期錯誤並在 502
    // detail 洩漏內部訊息，且讓前端控制 delimiter 語意超出 spec 設計意圖）。
    if (rawDelimiter && rawDelimiter !== "/") {
      response.status(400).json({ error: "invalid_delimiter", detail: "只支援 delimiter=/" });
      return;
    }
    // rawPrefix 直接取自 HTTP query，未驗證即傳 listMinioFolder/listMinioObjects → S3 SDK。
    // S3 路徑模型中 `..` 為字面字元（非 filesystem 穿越），無 bucket escape 風險；但嵌入
    // CR/LF 的 prefix 可能在 SDK 的 HTTP 請求中造成 header injection（AWS SDK 未必全濾）。
    // 守門擋在轉送前：偵測到 CR/LF 直接 400，根本不建 S3 client（帶不帶 delimiter 都套用）。
    if (rawPrefix.includes("\r") || rawPrefix.includes("\n")) {
      response.status(400).json({ error: "invalid_prefix", detail: "prefix 不可含換行字元（CR/LF）" });
      return;
    }
    try {
      if (rawDelimiter) {
        // spec §2.1, AC-D2：帶 delimiter 走資料夾語意 list（folders[]=CommonPrefixes）。
        // cache（hit/stale/refresh）、has_source_ifc probe、q3-pipe-guard 皆在 surface 內。
        response.json(await minioWatchSurface.browseFolder(rawPrefix, { forceRefresh }));
      } else {
        response.json(await minioWatchSurface.browseFlat(rawPrefix));
      }
    } catch (err) {
      // q1-502-leak：AWS SDK 的 err.message 常含 endpoint host:port / bucket / 內部錯誤碼，
      // 直接回 detail 會把 infra 細節洩漏給瀏覽器。改回固定 sanitized 字串；完整 err.message
      // 只進 structLog 供運維追查。此 catch 同時服務 flat 與 folder 兩條路徑。
      structLog.error("minioObjects", "minio list failed", err, {
        bucket: config.minioWatchBucket,
        delimiter: rawDelimiter || null,
      });
      response.status(502).json({ error: "minio_list_failed", detail: "minio list failed" });
    }
  });

  // minio-watch-auto-intake：watcher 唯讀狀態（無 credentials 洩漏）。關閉時誠實
  // 回 enabled=false（env opt-in）。last_triggered 只含 key，不含 presigned URL。
  // 置於 /:jobId param route 之前，確保此靜態路徑優先匹配。
  // status 投影由 surface 擁有：GET status 與 PUT /api/conversion/watch 共用同一邏輯
  // （避免 GET 與 toggle 回應分歧），runtime flag／關閉原因 note 的分歧邏輯在 surface 內。
  app.get("/api/external/minio-watch/status", (_request, response) => {
    response.json(minioWatchSurface.status());
  });

  function resolveExactIfcReadySessionTrace(sessionId: string, candidateTraceId: string): string {
    const planned = sessionTraceResolver.plan(sessionId);
    if (!planned.ok || planned.plan.canonicalTraceId !== candidateTraceId) {
      throw new Error("Session trace authority unavailable.");
    }
    const committed = sessionTraceResolver.commit(planned.plan);
    if (!committed.ok) {
      throw new Error("Session trace authority unavailable.");
    }
    return committed.canonicalTraceId;
  }

  function resolveExactDataChannelTrace(sessionId: string, candidateTraceId: string): string | null {
    try {
      const planned = sessionTraceResolver.plan(sessionId);
      if (!planned.ok || planned.plan.canonicalTraceId !== candidateTraceId) {
        return null;
      }
      const committed = sessionTraceResolver.commit(planned.plan);
      if (!committed.ok || committed.canonicalTraceId !== candidateTraceId) {
        return null;
      }
      return committed.canonicalTraceId;
    } catch {
      return null;
    }
  }

  function resolveExactInternalTraceCarrier(
    sessionId: string,
    candidateTraceId: string,
    headerTraceId: string | undefined,
  ): string | null {
    if (!isSafeSessionId(sessionId) || headerTraceId === undefined) {
      return null;
    }
    const parsedHeader = dataChannelTraceCandidateSchema.safeParse(headerTraceId);
    if (!parsedHeader.success || parsedHeader.data !== candidateTraceId) {
      return null;
    }
    return resolveExactDataChannelTrace(sessionId, candidateTraceId);
  }

  function ifcReadyReviewSessionOpenPayload(
    job: IfcReadyIntakeJob,
    session: ReviewSession,
    sessionReplay: boolean,
  ): Record<string, unknown> {
    const canonicalTraceId = resolveExactIfcReadySessionTrace(
      session.session_id,
      job.ifc_ready_job_id,
    );
    const openUrl = buildCoordinatorOpenUrl(
      config,
      session.session_id,
      canonicalTraceId,
    );
    externalIfcReadyStore.recordReviewSession(job.ifc_ready_job_id, session.session_id);
    externalIfcReadyStore.setViewerLink(job.ifc_ready_job_id, session.session_id, openUrl);
    const linkedJob = externalIfcReadyStore.get(job.ifc_ready_job_id) ?? job;
    const binding = expectedStageBinding(session);
    if (sessionReplay) {
      logIfcReadyReviewSessionActive(linkedJob, session, true);
    }
    return {
      ifc_ready_job_id: linkedJob.ifc_ready_job_id,
      trace_id: canonicalTraceId,
      conversion_job_id: linkedJob.conversion_job_id ?? null,
      conversion_status: linkedJob.conversion_status ?? null,
      review_session_id: session.session_id,
      session_status: session.status,
      session_replay: sessionReplay,
      open_url: openUrl,
      viewer_url: openUrl,
      expected_stage_url: binding?.url ?? null,
      expected_mapping_url: binding?.mapping_url ?? null,
      artifact_health: publicArtifactHealthForJob(linkedJob, session),
    };
  }

  app.post("/api/external/ifc-ready/:jobId/review-session", async (request, response, next) => {
    try {
      const jobId = request.params.jobId;
      if (!isSafeIfcReadyJobId(jobId)) {
        response.status(400).json({ detail: "Invalid IFC-ready job id." });
        return;
      }
      const job = externalIfcReadyStore.get(jobId);
      if (!job) {
        response.status(404).json({ detail: "IFC-ready job not found." });
        return;
      }

      const existingSession = job.review_session_id ? store.get(job.review_session_id) : null;
      if (existingSession) {
        await refreshArtifactHealthForSessionBestEffort(existingSession);
        const freshSession = store.get(existingSession.session_id) ?? existingSession;
        response.json(ifcReadyReviewSessionOpenPayload(job, freshSession, true));
        return;
      }

      if (!job.conversion_job_id) {
        response.status(409).json({
          error_code: "conversion_not_dispatched",
          detail: "IFC-ready job has no conversion job yet.",
          ifc_ready_job_id: job.ifc_ready_job_id,
          conversion_status: job.conversion_status ?? null,
        });
        return;
      }

      const outcome = await ifcReadyPipeline.ingestStreamingResult(job.conversion_job_id, {
        source: "manual",
      });
      if (!outcome.ok) {
        response.status(outcome.status).json({
          error_code: "conversion_result_unavailable",
          detail: outcome.detail,
          ifc_ready_job_id: job.ifc_ready_job_id,
          conversion_job_id: job.conversion_job_id,
          conversion_status: job.conversion_status ?? null,
        });
        return;
      }

      const sessionInfo =
        outcome.outcome.terminal_observer_result ?? emptyTerminalSessionCapture();
      const openedSession = sessionInfo.session;
      if (outcome.failed || !openedSession) {
        response.status(409).json({
          error_code: sessionInfo.session_reason ?? (outcome.failed ? "conversion_failed" : "review_session_unavailable"),
          detail: "IFC-ready job is not ready for Review Room session.",
          ifc_ready_job_id: job.ifc_ready_job_id,
          conversion_job_id: job.conversion_job_id,
          conversion_status: outcome.conversion_status,
          session_reason: sessionInfo.session_reason ?? null,
        });
        return;
      }

      await refreshArtifactHealthForSessionBestEffort(openedSession);
      const freshJob =
        externalIfcReadyStore.get(job.ifc_ready_job_id) ??
        outcome.outcome.ifc_ready_job ??
        job;
      const freshSession = store.get(openedSession.session_id) ?? openedSession;
      response.json(
        ifcReadyReviewSessionOpenPayload(
          freshJob,
          freshSession,
          sessionInfo.session_replay,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/external/ifc-ready/:jobId", async (request, response, next) => {
    try {
      const job = externalIfcReadyStore.get(request.params.jobId);
      if (!job) {
        response.status(404).json({ detail: "IFC-ready job not found." });
        return;
      }
      const artifactHealth = await refreshArtifactHealthBestEffort(job);
      // 誠實鐵律：對外 response 不得含 presigned 簽章（與 list / shadow / session 出口一致）。
      // quality finding #1：detail 端點與列表端點（summarizeIfcReadyJob）對齊上 wire 單一權威
      // conversion_lifecycle_status，使前端 IfcReadyJobDetail.conversion_lifecycle_status 型別契約成立
      // （前端 getIfcReadyJob 輪詢主讀此欄）。additive：sanitizeJobForExternal 仍回原始 job 形狀。
      const lifecycle = deriveLifecycleStatus(job);
      response.json({
        ...sanitizeJobForExternal(job),
        artifact_health: artifactHealth,
        conversion_lifecycle_status: lifecycle,
        ...deriveFailure(job),
        recovery_action: deriveConversionRecoveryAction(job),
        usdc_role: "pending" as const, // 同 summarizeIfcReadyJob：job 端無 usdc_key,依 spec §4.6/§6.3 恆 pending（禁 lifecycle 假報 parsed）
        data_volatility: "in_memory_volatile" as const,
      });
    } catch (error) {
      next(error);
    }
  });

  // B-scheme T6 §7.1/7.3：本地最小 shadow metadata + data-plane 可答性。
  // 不 mirror 公司 MySQL；control-plane 權威（user/RBAC/license/version 歷史）
  // 不在此重新宣告，僅以 external_model_version_id 參照公司雲端。
  app.get("/api/external/ifc-ready/:jobId/shadow", (request, response) => {
    const job = externalIfcReadyStore.get(request.params.jobId);
    if (!job) {
      response.status(404).json({ detail: "IFC-ready job not found." });
      return;
    }
    let callback: { status: string; lastAttemptAt: string | null } | undefined;
    if (job.callback_outbox_id) {
      const entry = callbackOutbox.get(job.callback_outbox_id);
      if (entry) {
        const lastEvidence = entry.evidence[entry.evidence.length - 1];
        callback = { status: entry.status, lastAttemptAt: lastEvidence ? lastEvidence.at : null };
      }
    }
    const shadow = externalIfcReadyStore.toShadowMetadata(job, callback);
    response.json({
      shadow_metadata: shadow,
      // 本 repo（data-plane）可在本地回答的可用性，不需公司雲端
      data_plane_availability: {
        local_conversion_status: job.conversion_status,
        conversion_authority: job.conversion_authority,
        source_ifc_available: Boolean(job.source_ifc_ref),
        artifact_manifest_available: Boolean(job.artifact_manifest_ref),
      },
      // control-plane 權威歸屬說明：本地僅參照，不宣告權威
      control_plane_authority: {
        owner: "company-cloud-bim-control",
        referenced_by: "external_model_version_id",
        not_mirrored: true,
      },
    });
  });

  app.use("/api/internal", (request, response, next) => {
    if (response.locals.viewerLogIntakeRequest === true) {
      const lease = viewerLeaseStore.authorizeActive(
        request.header("X-Review-Session-Id") ?? "",
        request.header("X-Viewer-Lease-Id") ?? "",
        request.header("X-Viewer-Lease-Token") ?? "",
      );
      if (!lease) {
        response.status(401).json({ detail: "missing or invalid viewer lease" });
        return;
      }
      const traceResolution = sessionTraceResolver.plan(lease.session_id);
      if (!traceResolution.ok) {
        response.status(409).json({ detail: "viewer log trace authority unavailable" });
        return;
      }
      response.locals.viewerLogSessionId = lease.session_id;
      response.locals.viewerLogTraceId = traceResolution.plan.canonicalTraceId;
      response.locals.viewerLogTracePlan = traceResolution.plan;
      next();
      return;
    }
    if (!isInternalRequestAuthorized(headersToMap(request.headers), config.internalApiAuthToken)) {
      response.status(401).json({ detail: "missing or invalid internal API token" });
      return;
    }
    next();
  });

  app.post(
    "/api/internal/review-sessions/:sessionId/datachannel-trace-verifications",
    (request, response) => {
      const parsed = dataChannelTraceVerificationSchema.safeParse(request.body);
      if (!parsed.success || !isSafeSessionId(request.params.sessionId)) {
        response.json({
          verified: false,
          detail_code: "datachannel_trace_payload_invalid",
        });
        return;
      }

      const rawHeaderTraceId = request.header("X-Trace-Id");
      if (rawHeaderTraceId === undefined) {
        response.json({
          verified: false,
          detail_code: "datachannel_trace_header_missing",
        });
        return;
      }
      const headerTraceId = dataChannelTraceCandidateSchema.safeParse(rawHeaderTraceId);
      if (!headerTraceId.success) {
        response.json({
          verified: false,
          detail_code: "datachannel_trace_header_invalid",
        });
        return;
      }
      if (headerTraceId.data !== parsed.data.trace_id) {
        response.json({
          verified: false,
          detail_code: "datachannel_trace_header_body_mismatch",
        });
        return;
      }

      const canonicalTraceId = resolveExactDataChannelTrace(
        request.params.sessionId,
        parsed.data.trace_id,
      );
      if (canonicalTraceId === null) {
        response.json({
          verified: false,
          detail_code: "datachannel_trace_authority_unavailable",
        });
        return;
      }

      response.set("X-Trace-Id", canonicalTraceId).json({
        verified: true,
        session_id: request.params.sessionId,
        trace_id: canonicalTraceId,
      });
    },
  );

  app.post(
    "/api/internal/review-sessions/:sessionId/runtime-command-authorizations",
    (request, response) => {
      const parsed = runtimeCommandAuthorizationSchema.safeParse(request.body);
      const rawRequestId = safeCommandIdSchema.safeParse(request.body?.request_id);
      const correlation = rawRequestId.success
        ? { request_id: rawRequestId.data }
        : { rejection_id: `rejection_${randomWebViewSuffix()}` };
      const deny = (
        reason:
          | "spectator_readonly"
          | "lease_invalid"
          | "session_lifecycle_blocked"
          | "unauthorized_source_client"
          | "unsupported_command"
          | "invalid_payload",
        detailCode: string,
        canonicalTraceId?: string,
      ) => {
        if (canonicalTraceId !== undefined) {
          response.set("X-Trace-Id", canonicalTraceId);
        }
        return response.json({
          authorized: false,
          reason,
          ...correlation,
          retryable: false,
          detail_code: detailCode,
          ...(canonicalTraceId !== undefined ? { trace_id: canonicalTraceId } : {}),
        });
      };

      if (!parsed.success || !isSafeSessionId(request.params.sessionId)) {
        deny("invalid_payload", "runtime_authorization_payload_invalid");
        return;
      }
      const input = parsed.data;
      const rawHeaderTraceId = request.header("X-Trace-Id");
      if (rawHeaderTraceId === undefined) {
        deny("invalid_payload", "runtime_trace_missing");
        return;
      }
      const headerTraceId = dataChannelTraceCandidateSchema.safeParse(rawHeaderTraceId);
      if (!headerTraceId.success) {
        deny("invalid_payload", "runtime_trace_invalid");
        return;
      }
      if (headerTraceId.data !== input.trace_id) {
        deny("invalid_payload", "runtime_trace_mismatch");
        return;
      }
      const canonicalTraceId = resolveExactDataChannelTrace(
        request.params.sessionId,
        input.trace_id,
      );
      if (canonicalTraceId === null) {
        deny("invalid_payload", "runtime_trace_authority_unavailable");
        return;
      }
      const decision = runtimeMutationAuthority.authorizeRuntimeCommand({
        sessionId: request.params.sessionId,
        sourceClientId: input.source_client_id,
        credential: request.header("X-Viewer-Lease-Token") ?? "",
        requestId: input.request_id,
        requestedEventType: input.requested_event_type,
        commandContext: toRuntimeCommandContext(input.requested_event_type, input.command_context),
        stageBindingAuthorizationId: input.stage_binding_authorization_id,
        bindingRevisionId: input.binding_revision_id,
        stageComposition: input.stage_composition
          ? toRuntimeStageComposition(input.stage_composition)
          : undefined,
      });
      if (!decision.authorized) {
        deny(decision.reason, decision.detailCode, canonicalTraceId);
        return;
      }

      response.set("X-Trace-Id", canonicalTraceId).json({
        authorized: true,
        request_id: input.request_id,
        retryable: false,
        trace_id: canonicalTraceId,
      });
    },
  );

  app.post(
    "/api/internal/review-sessions/:sessionId/stage-binding-authorization-rollbacks",
    (request, response) => {
      const parsed = runtimeCommandAuthorizationSchema.safeParse(request.body);
      const rawRequestId = safeCommandIdSchema.safeParse(request.body?.request_id);
      const correlation = rawRequestId.success
        ? { request_id: rawRequestId.data }
        : { rejection_id: `rejection_${randomWebViewSuffix()}` };
      if (!parsed.success || !isSafeSessionId(request.params.sessionId)) {
        response.json({ rolled_back: false, ...correlation, detail_code: "rollback_payload_invalid" });
        return;
      }
      const input = parsed.data;
      const canonicalTraceId = resolveExactInternalTraceCarrier(
        request.params.sessionId,
        input.trace_id,
        request.header("X-Trace-Id"),
      );
      if (canonicalTraceId === null) {
        response.json({
          rolled_back: false,
          ...correlation,
          detail_code: "rollback_trace_authority_unavailable",
        });
        return;
      }
      const rolledBack = runtimeMutationAuthority.failStageBindingBeforeMutation({
        sessionId: request.params.sessionId,
        sourceClientId: input.source_client_id,
        credential: request.header("X-Viewer-Lease-Token") ?? "",
        requestId: input.request_id,
        requestedEventType: input.requested_event_type,
        commandContext: toRuntimeCommandContext(input.requested_event_type, input.command_context),
        stageBindingAuthorizationId: input.stage_binding_authorization_id,
        bindingRevisionId: input.binding_revision_id,
        stageComposition: input.stage_composition
          ? toRuntimeStageComposition(input.stage_composition)
          : undefined,
      });
      response.set("X-Trace-Id", canonicalTraceId).json(rolledBack.failed
        ? {
            rolled_back: true,
            request_id: rolledBack.requestId,
            transaction_status: "failed",
            idempotent_replay: rolledBack.idempotentReplay,
            trace_id: canonicalTraceId,
          }
        : {
            rolled_back: false,
            request_id: rolledBack.requestId,
            detail_code: rolledBack.detailCode,
            trace_id: canonicalTraceId,
          });
    },
  );

  app.post(
    "/api/internal/review-sessions/:sessionId/stage-binding-confirmations",
    (request, response) => {
      const parsed = stageBindingConfirmationSchema.safeParse(request.body);
      const rawRequestId = safeCommandIdSchema.safeParse(request.body?.request_id);
      const correlation = rawRequestId.success
        ? { request_id: rawRequestId.data }
        : { rejection_id: `rejection_${randomWebViewSuffix()}` };
      const deny = (
        reason: "lease_invalid" | "session_lifecycle_blocked" | "invalid_payload",
        detailCode: string,
        canonicalTraceId?: string,
      ) => {
        if (canonicalTraceId !== undefined) {
          response.set("X-Trace-Id", canonicalTraceId);
        }
        return response.json({
          confirmed: false,
          reason,
          ...correlation,
          retryable: false,
          detail_code: detailCode,
          ...(canonicalTraceId !== undefined ? { trace_id: canonicalTraceId } : {}),
        });
      };

      if (!parsed.success || !isSafeSessionId(request.params.sessionId)) {
        deny("invalid_payload", "stage_confirmation_payload_invalid");
        return;
      }
      const input = parsed.data;
      const canonicalTraceId = resolveExactInternalTraceCarrier(
        request.params.sessionId,
        input.trace_id,
        request.header("X-Trace-Id"),
      );
      if (canonicalTraceId === null) {
        deny("invalid_payload", "stage_confirmation_trace_authority_unavailable");
        return;
      }
      const completed = runtimeMutationAuthority.confirmStageBinding({
        sessionId: request.params.sessionId,
        credential: request.header("X-Viewer-Lease-Token") ?? "",
        stageBindingAuthorizationId: input.stage_binding_authorization_id,
        bindingRevisionId: input.binding_revision_id,
        requestId: input.request_id,
        outcome: input.outcome,
      });
      if (!completed.confirmed) {
        deny(completed.reason, completed.detailCode, canonicalTraceId);
        return;
      }

      response.set("X-Trace-Id", canonicalTraceId).json({
        confirmed: true,
        request_id: completed.requestId,
        binding_revision_id: completed.bindingRevisionId,
        transaction_status: completed.transactionStatus,
        active_binding_revision: completed.activeBindingRevision,
        last_good_binding_revision: completed.lastGoodBindingRevision,
        idempotent_replay: completed.idempotentReplay,
        trace_id: canonicalTraceId,
      });
    },
  );

  // B-scheme T5 + deepen-ifc-ready-conversion-pipeline：
  // conversion terminal（job/outbox/ledger）由 IfcReadyConversionPipeline.ingest；
  // auto Review Session 僅經 onConversionTerminal observer（失敗不回灌 ingest/outbox）。
  // backfill-coordinator-webhook-and-auto-session §2 (D10)：抽出共用 helper，
  // 與既有 `POST /api/review-sessions` route handler 走同一份 SessionStore /
  // kitPool / eventLog 權威；不複製 binding 規則。傳入 conversion-ready 的
  // streaming-owned artifact refs，構建最小 ArtifactBinding 後重用既有 Kit
  // binding 分配。
  function autoCreateOrActivateSession(
    job: IfcReadyIntakeJob,
    artifacts: { usdc_ref?: string | null; element_mapping_ref?: string | null; manifest_ref?: string | null },
    conversionJobId: string | null,
    qualitySummary: ConversionQualityMetricsSummary | null = null,
  ): { session: ReviewSession; replay: boolean } | { session: null; reason: string } {
    // D11：以 job.review_session_id 為 idempotency 主索引（job 已被 correlation_id /
    // external_model_version_id 唯一索引）。重入回既有 session。
    if (job.review_session_id) {
      const existing = store.get(job.review_session_id);
      if (existing) {
        return { session: existing, replay: true };
      }
      // 既有 session 檔被外部移除 → 視為無 session，重建（不丟 review intent）。
    }

    const modelVersionId = job.external_model_version_id;
    const usdcUrl = artifacts.usdc_ref ?? null;
    if (!usdcUrl) {
      // 沒有 usdc_ref 不建可串流 session（sustained `Non-ready conversion does
      // not create a streamable session` semantics 即使 status=ready 但無 artifact）。
      return { session: null, reason: "no_usdc_ref" };
    }

    const autoArtifactId = `auto_usdc_${conversionJobId ?? job.correlation_id}`;
    const artifactBindings: ArtifactBinding[] = [
      {
        binding_id: "binding_auto_usdc",
        artifact_group_id: `ag_${modelVersionId}`,
        model_version_id: modelVersionId,
        artifact_id: autoArtifactId,
        artifact_role: "derived",
        url: usdcUrl,
        mapping_url: artifacts.element_mapping_ref ?? null,
        load_order: 0,
        routing_policy: "same_instance",
        ready_status: "ready",
        conversion_authority: "bim-streaming-server",
        conversion_job_id: conversionJobId,
        conversion_status: "ready",
      },
    ];

    const kitInstanceBindings = allocateKitInstanceBindings(
      config,
      artifactBindings,
      "same_instance",
      job.tenant_id,
      {},
    );
    if (kitInstanceBindings.length === 0) {
      // GPU/Kit 無容量 → 不建 active session、不丟 review intent；spec
      // 「GPU capacity is unavailable」由顯式 caller 處理，自動接線僅記原因
      // 待後續輪詢/重入時再分配。
      return { session: null, reason: "queued_for_instance" };
    }

    const session = store.create({
      trace_id: job.ifc_ready_job_id,
      review_request_id: undefined,
      tenant_id: job.tenant_id,
      project_id: job.project_id,
      model_version_id: modelVersionId,
      source_artifact_id: undefined,
      usdc_artifact_id: autoArtifactId,
      created_by: "coordinator-auto-conversion-ready",
      mode: "single_kit_shared_state",
      kit_instance: legacyKitInstanceFromBinding(kitInstanceBindings[0], config),
      artifact_bindings: artifactBindings,
      kit_instance_bindings: kitInstanceBindings,
      // coordinator-forward-quality-metrics-summary:從 streaming conversion
      // result 萃取的 quality summary(含 C1 三個 semantic 欄位)由 pipeline
      // onConversionTerminal 傳入。null 時與舊邏輯等價,backward compatible。
      quality_metrics_summary: qualitySummary,
    });
    // lifecycle audit event parity（與 explicit /api/review-sessions caller
    // 路徑等價；Risk mitigation）。
    eventLog.append(session.session_id, "sessionCreated", {
      project_id: session.project_id,
      model_version_id: session.model_version_id,
      review_request_id: session.review_request_id,
    });
    if (session.status === "active") {
      eventLog.append(session.session_id, "sessionActive", {
        kit_instance_bindings: session.kit_instance_bindings.map((binding) => binding.kit_instance_id),
      });
    }
    externalIfcReadyStore.recordReviewSession(job.ifc_ready_job_id, session.session_id);
    return { session, replay: false };
  }

  // Wire terminal observer: auto-session (ready only) + artifact health. Sync;
  // failures are swallowed by pipeline and must not roll back outbox/ingest.
  onConversionTerminalImpl = (event: ConversionTerminalEvent): TerminalSessionCapture => {
    let sessionCapture = emptyTerminalSessionCapture();
    if (event.status === "ready") {
      const result = autoCreateOrActivateSession(
        event.job,
        {
          usdc_ref: event.artifacts.usdc_ref ?? null,
          element_mapping_ref: event.artifacts.element_mapping_ref ?? null,
          manifest_ref: event.artifacts.manifest_ref ?? null,
        },
        event.conversionJobId,
        event.qualitySummary,
      );
      if (result.session) {
        sessionCapture = {
          session: result.session,
          session_replay: result.replay,
        };
        const viewerUrl = buildCoordinatorOpenUrl(
          config,
          result.session.session_id,
          event.job.ifc_ready_job_id,
        );
        externalIfcReadyStore.setViewerLink(
          event.job.ifc_ready_job_id,
          result.session.session_id,
          viewerUrl,
        );
        if (!result.replay) {
          logIfcReadyReviewSessionActive(event.job, result.session, false);
        }
      } else {
        sessionCapture = {
          session: null,
          session_replay: false,
          session_reason: result.reason,
        };
      }
    }
    void refreshArtifactHealthBestEffort(
      externalIfcReadyStore.get(event.job.ifc_ready_job_id) ?? event.job,
      {
        modelArtifactUrl: event.artifacts.usdc_ref ?? null,
        mappingUrl: event.artifacts.element_mapping_ref ?? null,
      },
    );
    return sessionCapture;
  };

  // 內部端點（外部/輪詢直接餵 report）。callback 投遞狀態與 conversion 成功
  // 分離；conversion 在本地 ready 即可查，callback 由 outbox 追蹤。
  app.post("/api/internal/conversion-result", (request, response, next) => {
    try {
      const report = conversionResultReportSchema.parse(request.body);
      const outcome = ifcReadyPipeline.ingest(report);
      if (!outcome.ok) {
        response.status(outcome.status).json({ detail: outcome.detail });
        return;
      }
      const sessionInfo =
        outcome.terminal_observer_result ?? emptyTerminalSessionCapture();
      response.status(202).json({
        ifc_ready_job: outcome.ifc_ready_job,
        callback: outcome.callback,
        session: sessionInfo.session,
        session_replay: sessionInfo.session_replay,
        session_reason: sessionInfo.session_reason ?? null,
      });
    } catch (error) {
      next(error);
    }
  });

  // B-scheme：coordinator 主動向 host-native conversion service 拉
  // `GET /api/conversions/{id}/result`，把 streaming-owned result 映射成
  // 既有 report 形狀後走同一條 metadata-only callback outbox 路徑。
  app.post("/api/internal/conversions/:conversionJobId/ingest", async (request, response, next) => {
    try {
      const conversionJobId = request.params.conversionJobId;
      // m2a-coverage-report:即便 `/api/internal/*` 已過 internal-token，仍須跑
      // isSafeConversionJobId 守門，避免未驗證字串流入 poller / ingest。
      if (!isSafeConversionJobId(conversionJobId)) {
        response.status(400).json({ detail: "Invalid conversion job id." });
        return;
      }
      const outcome = await ifcReadyPipeline.ingestStreamingResult(conversionJobId, {
        source: "manual",
      });
      if (!outcome.ok) {
        const body: Record<string, unknown> = { detail: outcome.detail };
        if (outcome.conversion_job_id) body.conversion_job_id = outcome.conversion_job_id;
        if (outcome.conversion_status) body.conversion_status = outcome.conversion_status;
        response.status(outcome.status).json(body);
        return;
      }
      const sessionInfo =
        outcome.outcome.terminal_observer_result ?? emptyTerminalSessionCapture();
      response.status(202).json({
        ifc_ready_job: outcome.outcome.ifc_ready_job,
        callback: outcome.outcome.callback,
        conversion_status: outcome.conversion_status,
        session: sessionInfo.session,
        session_replay: sessionInfo.session_replay,
        session_reason: sessionInfo.session_reason ?? null,
      });
    } catch (error) {
      next(error);
    }
  });


  app.get("/api/internal/callback-outbox/:outboxId", (request, response) => {
    const entry = callbackOutbox.get(request.params.outboxId);
    if (!entry) {
      response.status(404).json({ detail: "Callback outbox entry not found." });
      return;
    }
    response.json(entry);
  });

  // runtime loop / 測試決定性驅動：對所有 pending entry 各嘗試投遞一次。
  app.post("/api/internal/callback-outbox/deliver", async (_request, response, next) => {
    try {
      const touched = await callbackOutbox.deliverPending();
      response.json({ delivered_pass: true, entries: touched });
    } catch (error) {
      next(error);
    }
  });

  // F2 步驟⑩觀測面：瀏覽器可達（無 token）的 callback outbox 摘要。
  // redacted 投影——明確排除 `payload` 與 `target_url`（完整 entry 僅在
  // `/api/internal/callback-outbox/*` token gate 之後可見）。newest-first；
  // limit 預設 50、上限 200、非法值 400。純加性唯讀 route，不動 outbox 狀態。
  app.get("/api/callback-outbox/summary", (request, response) => {
    const rawLimit = request.query.limit;
    let limit = 50;
    if (rawLimit !== undefined) {
      const parsed = typeof rawLimit === "string" && /^\d+$/.test(rawLimit.trim())
        ? Number.parseInt(rawLimit.trim(), 10)
        : Number.NaN;
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 200) {
        response.status(400).json({ detail: "limit must be an integer between 1 and 200." });
        return;
      }
      limit = parsed;
    }
    const all = callbackOutbox.list();
    const entries = [...all]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((entry) => ({
        outbox_id: entry.outbox_id,
        event: entry.event,
        status: entry.status,
        attempts: entry.attempts,
        max_attempts: entry.max_attempts,
        last_error: entry.last_error,
        created_at: entry.created_at,
        delivered_at: entry.delivered_at,
        correlation_id: entry.correlation_id,
        conversion_job_id: entry.conversion_job_id,
      }));
    response.json({ total: all.length, limit, entries });
  });

  // F2 步驟⑩：issue-snapshot 查 governance 的 base 與 routes/governanceProxy.ts
  // 同源（env `GOVERNANCE_API_BASE`，預設 governance-service loopback
  // 127.0.0.1:49102；每請求讀取讓 deploy / 測試能覆寫指向 stub）。此處只讀同一
  // 設定來源，不改 proxy 行為。
  const governanceApiBaseForSnapshot = (): string =>
    (process.env.GOVERNANCE_API_BASE ?? "http://127.0.0.1:49102").replace(/\/+$/, "");

  // F2 步驟⑩：Coordinator → 雲端 Outbox 摘要回拋（issue/檢核統計，metadata-only）。
  // 瀏覽器只持 session_id + rule_run_id（不知 governance 內部位址）；coordinator
  // server-side 查 governance 取 rule-run 狀態/failed 統計 +（可選）issue open/總數，
  // 成功才 enqueue `issue_snapshot`（assertMetadataOnly 鐵律照走；payload 零
  // secret / URL / bytes）。查詢失敗回 502 不入列——誠實，不偽造統計。
  app.post("/api/review-sessions/:sessionId/issue-snapshot", async (request, response, next) => {
    try {
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      const input = issueSnapshotSchema.parse(request.body);
      const govBase = governanceApiBaseForSnapshot();
      let ruleRunStatus: string | null = null;
      let failedCount: number | null = null;
      let issueTotal: number | null = null;
      let issueOpen: number | null = null;
      try {
        const runRes = await fetch(
          `${govBase}/api/rule-runs/${encodeURIComponent(input.rule_run_id)}`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(3000) },
        );
        if (!runRes.ok) throw new Error(`governance rule-run HTTP ${runRes.status}`);
        const run = (await runRes.json()) as Record<string, unknown>;
        ruleRunStatus = typeof run.status === "string" ? run.status : null;
        const summary = run.summary && typeof run.summary === "object" && !Array.isArray(run.summary)
          ? (run.summary as Record<string, unknown>)
          : null;
        failedCount = typeof summary?.failed === "number" && Number.isFinite(summary.failed)
          ? summary.failed
          : null;
        if (input.model_version_id) {
          const issuesRes = await fetch(
            `${govBase}/api/issues?model_version_id=${encodeURIComponent(input.model_version_id)}`,
            { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(3000) },
          );
          if (!issuesRes.ok) throw new Error(`governance issues HTTP ${issuesRes.status}`);
          const issuesBody = (await issuesRes.json()) as { issues?: unknown };
          const issues = Array.isArray(issuesBody.issues) ? issuesBody.issues : [];
          issueTotal = issues.length;
          // governance ISSUE_STATUSES=(open,assigned,in_progress,resolved,rejected,
          // reopened)：非終局（resolved/rejected 以外）一律計為 open（未結案）。
          issueOpen = issues.filter((issue) => {
            const status = issue && typeof issue === "object"
              ? (issue as Record<string, unknown>).status
              : undefined;
            return typeof status === "string" && status !== "resolved" && status !== "rejected";
          }).length;
        }
      } catch {
        // 誠實：governance 查不到就不 enqueue 假統計（含 timeout / 非 2xx）。
        response.status(502).json({ error: "governance_unreachable" });
        return;
      }
      const entry = callbackOutbox.enqueue({
        event: "issue_snapshot",
        // 與 conversion callback 同源（app.ts ingest 路徑）：issue snapshot 無
        // per-job callback_url，僅 config cloud base；未設定＝null → outbox 視為
        // 不可達，保留重試至 dead-letter，不靜默丟棄（OQ1 pending 行為一致）。
        targetUrl: config.cloudCallbackBaseUrl || null,
        correlationId: session.session_id,
        externalModelVersionId: session.model_version_id,
        conversionJobId: null,
        payload: {
          event: "issue_snapshot",
          session_id: session.session_id,
          rule_run_id: input.rule_run_id,
          model_version_id: input.model_version_id ?? session.model_version_id ?? null,
          rule_run_status: ruleRunStatus,
          failed_count: failedCount,
          issue_total: issueTotal,
          issue_open: issueOpen,
          snapshot_at: new Date().toISOString(),
        },
      });
      response.status(202).json({ outbox_id: entry.outbox_id });
    } catch (error) {
      next(error);
    }
  });

  // ---------------------------------------------------------------------------
  // A1/A2 governance file-library 邏輯識別路由（純加性）。
  // 根因：/api/governance/files/tree 對瀏覽器把每個 version.path 遮蔽成 "[server-path]"
  // （routes/governanceProxy.ts redactServerPaths），A1 local_fs rule-run 與 A2 diff 把它
  // 回送 → governance 400 "ifc_source_path not found: [server-path]"。修法與
  // issue-snapshot / federated_set_id 同構：瀏覽器只送 {project_id, model_id, version_name}
  // 邏輯三段，coordinator server-side 直打 governance（不經遮蔽）解析真路徑後轉發。
  // 誠實語意：version 解析不到=404 library_version_not_found、governance 不可達=502、
  // governance 回應原樣透傳 status/json（僅以與 proxy 同語意遮蔽絕對路徑）。
  // ---------------------------------------------------------------------------

  // A1 local_fs：邏輯三段 → server-side 解析真 IFC path → governance POST /api/rule-runs。
  app.post("/api/governance-library/rule-runs", async (request, response, next) => {
    try {
      const input = libraryRuleRunSchema.parse(request.body);
      const outcome = await governanceLibraryWorkflow.runLibraryRuleRun({
        version: {
          projectId: input.project_id,
          modelId: input.model_id,
          versionName: input.version_name,
        },
        idsPath: input.ids_path,
        modelVersionId: input.model_version_id,
      });
      switch (outcome.kind) {
        case "invalid_ids":
          response.status(400).json({
            error_code: "invalid_ids_path",
            detail: outcome.detail,
          });
          return;
        case "version_not_found":
          response.status(404).json({ error: "library_version_not_found" });
          return;
        case "unavailable":
          response.status(502).json({ error: "governance_unreachable" });
          return;
        case "forwarded":
          response.status(outcome.status);
          response.setHeader("Content-Type", outcome.contentType);
          response.send(outcome.bodyText);
          return;
      }
      outcome satisfies never;
    } catch (error) {
      next(error);
    }
  });

  // A2 diff：base/target 各自解析真路徑 → governance POST /api/diffs。
  app.post("/api/governance-library/diffs", async (request, response, next) => {
    try {
      const input = libraryDiffSchema.parse(request.body);
      const outcome = await governanceLibraryWorkflow.runLibraryDiff({
        base: {
          projectId: input.base.project_id,
          modelId: input.base.model_id,
          versionName: input.base.version_name,
        },
        target: {
          projectId: input.target.project_id,
          modelId: input.target.model_id,
          versionName: input.target.version_name,
        },
        includeGeometry: input.include_geometry,
        baseModelVersionId: input.base_model_version_id,
        targetModelVersionId: input.target_model_version_id,
      });
      switch (outcome.kind) {
        case "invalid_ids":
          response.status(400).json({
            error_code: "invalid_ids_path",
            detail: outcome.detail,
          });
          return;
        case "version_not_found":
          response.status(404).json({ error: "library_version_not_found" });
          return;
        case "unavailable":
          response.status(502).json({ error: "governance_unreachable" });
          return;
        case "forwarded":
          response.status(outcome.status);
          response.setHeader("Content-Type", outcome.contentType);
          response.send(outcome.bodyText);
          return;
      }
      outcome satisfies never;
    } catch (error) {
      next(error);
    }
  });

  // ---------------------------------------------------------------------------
  // Structured log baseline endpoints (capability:
  // cross-service-structured-log-baseline). Viewer intake requires a matching
  // active viewer lease; health uses the internal API token boundary.
  // ---------------------------------------------------------------------------

  const VIEWER_LOG_BYTE_LIMIT = 256 * 1024; // 256 KiB per spec §6
  const VIEWER_LOG_MAX_RECORDS = 500;

  const viewerLogIntakeStats = {
    records_received: 0,
    records_accepted: 0,
    records_dropped: 0,
    requests_rejected_oversized: 0,
    last_drop_reason: null as string | null,
  };

  app.post(
    "/api/internal/viewer-log",
    express.json({
      limit: VIEWER_LOG_BYTE_LIMIT,
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf.toString("utf8");
      },
    }),
    (request, response, next) => {
      try {
        // express.json with the limit returns 413 automatically on oversized body
        // (handled by the global error handler below). Aside from that, we just
        // need an array of records.
        const body = request.body as unknown;
        if (!Array.isArray(body)) {
          response.status(400).json({ detail: "expected JSON array of LogRecord", accepted: 0, dropped: 0 });
          return;
        }
        if (body.length > VIEWER_LOG_MAX_RECORDS) {
          response.status(413).json({
            detail: `batch exceeds ${VIEWER_LOG_MAX_RECORDS} records`,
            accepted: 0,
            dropped: body.length,
          });
          return;
        }
        const trustedSessionId = response.locals.viewerLogSessionId;
        const trustedTraceId = response.locals.viewerLogTraceId;
        const trustedTracePlan = response.locals.viewerLogTracePlan as SessionTracePlan | undefined;
        if (
          typeof trustedSessionId !== "string"
          || typeof trustedTraceId !== "string"
          || trustedTracePlan?.sessionId !== trustedSessionId
          || trustedTracePlan.canonicalTraceId !== trustedTraceId
        ) {
          response.status(401).json({ detail: "missing or invalid viewer lease" });
          return;
        }
        viewerLogIntakeStats.records_received += body.length;
        const validated: LogRecord[] = [];
        let droppedThisBatch = 0;
        let traceMismatch = false;
        for (const candidate of body) {
          const result = validateLogRecordBasic(candidate);
          if (result.valid && result.record.service === "viewer") {
            if (result.record.trace_id !== trustedTraceId) {
              traceMismatch = true;
              break;
            }
            validated.push(result.record);
          } else {
            droppedThisBatch += 1;
            viewerLogIntakeStats.last_drop_reason = result.valid
              ? "viewer_log_service_mismatch"
              : result.reason;
          }
        }
        if (traceMismatch) {
          viewerLogIntakeStats.records_dropped += body.length;
          viewerLogIntakeStats.last_drop_reason = "viewer_log_trace_mismatch";
          for (let i = 0; i < body.length; i += 1) {
            structLog.noteDropped("viewer_log_trace_mismatch");
          }
          response.status(409).json({
            detail: "viewer log trace does not match authenticated session",
            accepted: 0,
            dropped: body.length,
          });
          return;
        }
        if (validated.length > 0) {
          const committedTrace = sessionTraceResolver.commit(trustedTracePlan);
          if (!committedTrace.ok || committedTrace.canonicalTraceId !== trustedTraceId) {
            viewerLogIntakeStats.records_dropped += body.length;
            viewerLogIntakeStats.last_drop_reason = "viewer_log_trace_authority_changed";
            for (let i = 0; i < body.length; i += 1) {
              structLog.noteDropped("viewer_log_trace_authority_changed");
            }
            response.status(409).json({
              detail: "viewer log trace authority unavailable",
              accepted: 0,
              dropped: body.length,
            });
            return;
          }
        }
        const persisted = persistRecordsToServicePaths(validated, config.logRoot);
        const totalDropped = droppedThisBatch + persisted.dropped;
        viewerLogIntakeStats.records_accepted += persisted.written;
        viewerLogIntakeStats.records_dropped += totalDropped;
        for (let i = 0; i < totalDropped; i += 1) {
          structLog.noteDropped("viewer_intake_validation_or_sink");
        }
        response.json({
          accepted: persisted.written,
          dropped: totalDropped,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get("/api/internal/structLog/health", (_request, response) => {
    response.json({
      run_id: structLog.runId,
      current_file: structLog.currentFile(),
      records_written: structLog.recordsWritten(),
      records_dropped: structLog.recordsDropped(),
      last_failure: structLog.lastFailure(),
      viewer_intake: { ...viewerLogIntakeStats },
    });
  });

  // B-scheme T7 §8.1-8.3：local web view session / artifact resolution。
  // 使用者 auth 用可替換 provider（不做死 EZPLUS SSO；sso_binding 在 OQ5
  // 確認前恆 pending_oq5）。實際 USDC streaming 仍走既有 stream-config 路徑。
  app.post("/api/local-web-view/sessions", (request, response, next) => {
    try {
      const headerMap = headersToMap(request.headers);
      const user = userAuthProvider.authenticate({ headers: headerMap });
      const input = localWebViewSessionSchema.parse(request.body);

      let job = input.ifc_ready_job_id
        ? externalIfcReadyStore.get(input.ifc_ready_job_id)
        : undefined;
      if (!job && input.external_model_version_id) {
        job = latestIfcReadyJobForExternalModelVersion(
          externalIfcReadyStore.list(),
          input.external_model_version_id,
        );
      }
      if (!job) {
        response.status(404).json({ detail: "No IFC-ready job for local web view." });
        return;
      }

      const session = {
        web_view_session_id: `lwv_${Date.now()}_${randomWebViewSuffix()}`,
        user_id: user.userId,
        auth_provider: user.provider,
        sso_binding: user.ssoBinding,
        external_model_version_id: job.external_model_version_id,
        ifc_ready_job_id: job.ifc_ready_job_id,
        artifact_resolution: {
          source_ifc_ref: maskPresignedRef(job.source_ifc_ref),
          artifact_manifest_ref: job.artifact_manifest_ref ?? null,
          conversion_job_id: job.conversion_job_id,
          conversion_status: job.conversion_status,
          conversion_authority: job.conversion_authority,
          conversion_artifact_ready: job.conversion_status === "ready",
          viewer_open_ready: false,
          viewer_open_state: "not_observed",
        },
        created_at: new Date().toISOString(),
      };
      response.status(201).json(session);
    } catch (error) {
      next(error);
    }
  });

  // unified-console-runtime-truth slice 2 task 4.4(owner D3 裁決):/api/dev/* 整組 prefix gate——
  // ENABLE_DEV_ROUTES=false 時一律 404(含下方 conversions pass-through 與 routes/devMeta.ts 在後面 mount 的
  // test-data-projects;Express 依註冊順序執行,故本 middleware 必須排在所有 /api/dev/* 路由之前)。
  // 既有三條路由內的 devRoutesEnabled() 逐路由檢查保留(防禦縱深,行為等價)。/api/dev/* 不是產品路徑。
  app.use("/api/dev", (_request, response, next) => {
    if (!devRoutesEnabled()) {
      response.status(404).json({ detail: "dev routes disabled" });
      return;
    }
    next();
  });

  app.post("/api/dev/conversions", async (request, response) => {
    await proxyConversionService(response, config.conversionApiBase, "POST", "/api/conversions/ifc-to-usdc", request.body);
  });

  app.get("/api/dev/conversions", async (request, response) => {
    const upstreamPath = request.originalUrl.replace(/^\/api\/dev\/conversions/, "/api/conversions");
    await proxyConversionService(response, config.conversionApiBase, "GET", upstreamPath);
  });

  app.post("/api/dev/conversions/mock", async (request, response) => {
    await proxyConversionService(response, config.conversionApiBase, "POST", "/api/dev/mock-conversion-result", request.body);
  });

  app.get("/api/dev/conversions/:jobId/result", async (request, response) => {
    await proxyConversionService(
      response,
      config.conversionApiBase,
      "GET",
      `/api/conversions/${encodeURIComponent(request.params.jobId)}/result`,
    );
  });

  app.get("/api/dev/conversions/:jobId", async (request, response) => {
    await proxyConversionService(response, config.conversionApiBase, "GET", `/api/conversions/${encodeURIComponent(request.params.jobId)}`);
  });

  // real-ifc-fixture-intake：列出本機 ./storage 下的真實 IFC fixture 供前端選取。
  // 契約：docs/contracts/worker-api.md「Dev IFC Source Selection」。回應「絕不」洩漏絕對路徑，
  // 不回 source_ref（bytes 取得由 register 端在 loopback 內部完成）；僅 top-level *.ifc、忽略 symlink、
  // 穩定 source_id（base64url(filename)）。
  app.get("/api/dev/ifc-sources", (_request, response) => {
    if (!devRoutesEnabled()) {
      response.status(404).json({ detail: "dev routes disabled" });
      return;
    }
    const root = path.resolve(config.storageRoot);
    let exists = false;
    let readable = false;
    let entries: fs.Dirent[] = [];
    try {
      exists = fs.existsSync(root) && fs.statSync(root).isDirectory();
      if (exists) {
        entries = fs.readdirSync(root, { withFileTypes: true });
        readable = true;
      }
    } catch {
      readable = false;
    }
    const items = entries
      // isFile() 對 readdir(withFileTypes) 的 Dirent 不跟隨 symlink（symlink → isSymbolicLink()），故自動忽略 symlink。
      .filter((entry) => entry.isFile() && /\.ifc$/i.test(entry.name))
      .map((entry) => {
        let sizeBytes = 0;
        let modifiedAt = new Date(0).toISOString();
        try {
          const stat = fs.statSync(path.join(root, entry.name));
          sizeBytes = stat.size;
          modifiedAt = stat.mtime.toISOString();
        } catch {
          /* stat 失敗不阻擋列舉，size 留 0 */
        }
        return {
          source_id: sourceIdForFilename(entry.name),
          filename: entry.name,
          relative_path: entry.name, // top-level，相對 storageRoot
          size_bytes: sizeBytes,
          modified_at: modifiedAt,
        };
      })
      .sort((left, right) => left.filename.localeCompare(right.filename));
    response.json({ root: { exists, readable, item_count: items.length }, items });
  });

  // 服務單一 storage IFC fixture 的 bytes —— 僅供 coordinator「自身 loopback self-fetch」用（register 內部）。
  // 安全：loopback-only（擋 0.0.0.0 綁定下的 LAN client 暴露）+ dev gate + 僅 top-level *.ifc + 路徑 containment。
  // 瀏覽器永不需要也拿不到此路由（list 不回 source_ref；register 走內部 loopback）。
  app.get("/api/dev/ifc-file/:name", (request, response) => {
    if (!devRoutesEnabled()) {
      response.status(404).json({ detail: "dev routes disabled" });
      return;
    }
    if (!isLoopbackRequest(request)) {
      response.status(403).json({ detail: "ifc-file is loopback-only (coordinator self-fetch)" });
      return;
    }
    const name = request.params.name;
    if (!/^[^/\\]+\.ifc$/i.test(name)) {
      response.status(400).json({ detail: "invalid ifc fixture name" });
      return;
    }
    const root = path.resolve(config.storageRoot);
    const full = path.resolve(root, name);
    if (full !== path.join(root, name)) {
      response.status(400).json({ detail: "path traversal blocked" });
      return;
    }
    try {
      if (!fs.statSync(full).isFile()) {
        response.status(404).json({ detail: "ifc fixture not found" });
        return;
      }
    } catch {
      response.status(404).json({ detail: "ifc fixture not found" });
      return;
    }
    response.type("application/octet-stream").sendFile(full);
  });

  // 以 source_id 註冊真實 ./storage IFC 進審查流程：coordinator 內部 self-POST /api/external/ifc-ready
  // （source_ifc.ref 指向 loopback-only ifc-file，coordinator 自身真實下載 bytes → 序列派工轉檔）。
  // 瀏覽器只給 source_id，永不構造 URL、永不接觸 bytes。對映 worker-api 契約的 source→conversion 起點。
  app.post("/api/dev/ifc-sources/:sourceId/register", async (request, response) => {
    if (!devRoutesEnabled()) {
      response.status(404).json({ detail: "dev routes disabled" });
      return;
    }
    const filename = filenameForSourceId(request.params.sourceId, config.storageRoot);
    if (!filename) {
      response.status(404).json({ detail: "unknown or stale source_id" });
      return;
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const stamp = `${Date.now()}_${process.hrtime.bigint().toString(36)}`;
    const projectId = typeof body.project_id === "string" && body.project_id ? body.project_id : "project_real_ifc_demo";
    const modelVersionId =
      typeof body.model_version_id === "string" && body.model_version_id ? body.model_version_id : `mv_realifc_${stamp}`;
    const selfBase = `http://127.0.0.1:${config.port}`;
    const ref = `${selfBase}/api/dev/ifc-file/${encodeURIComponent(filename)}`;
    try {
      const upstream = await fetch(`${selfBase}/api/external/ifc-ready`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": config.externalIntakeWebhookSecret,
          "X-Correlation-Id": `corr_devreg_${stamp}`,
          "X-Idempotency-Key": `idem_devreg_${stamp}`,
        },
        body: JSON.stringify({
          event: "ifc_ready",
          tenant_id: "tenant_demo_001",
          project_id: projectId,
          external_model_version_id: modelVersionId,
          external_conversion_task_id: `task_devreg_${stamp}`,
          source_ifc: { ref, etag: `devstorage:${filename}`, filename },
        }),
      });
      const text = await upstream.text();
      const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
      // 補回前端要顯示的 lineage 起點（source_id / filename / relative_path），避免前端再持有檔名映射。
      response.status(upstream.status).type(contentType).send(
        text
          ? JSON.stringify({
              ...(JSON.parse(text) as Record<string, unknown>),
              source_id: request.params.sourceId,
              source_ifc_filename: filename,
              source_ifc_relative_path: filename,
            })
          : "{}",
      );
    } catch (error) {
      response.status(502).json({ detail: `register failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  // CH-D：/api/kit/* forward-only reverse-proxy → kit-manager（loopback :8010）。
  // RK1：Kit 控制權威留 kit-manager；coordinator 只轉發（沿用 proxyConversionService 的通用 forward 邏輯，
  // 保留 status/content-type），不解讀/不保存 Kit 狀態。瀏覽器一律打 :8004，禁直連 :8010。
  app.get("/api/kit/health", async (_request, response) => {
    await proxyConversionService(response, config.kitManagerApiBase, "GET", "/health");
  });
  app.get("/api/kit/usdc", async (_request, response) => {
    await proxyConversionService(response, config.kitManagerApiBase, "GET", "/api/usdc");
  });
  app.get("/api/kit/instances/current", async (_request, response) => {
    await proxyConversionService(response, config.kitManagerApiBase, "GET", "/api/kit/instances/current");
  });
  app.post("/api/kit/instances/current/open", async (request, response) => {
    if (!isKitMutationAuthorized(request, config.devAuthToken)) {
      response.status(403).json({ detail: "kit mutation requires operator/dev auth (x-dev-token); CH-C 之後改 session primary authority" });
      return;
    }
    await proxyConversionService(response, config.kitManagerApiBase, "POST", "/api/kit/instances/current/open", request.body ?? {});
  });
  app.post("/api/kit/instances/current/close", async (request, response) => {
    if (!isKitMutationAuthorized(request, config.devAuthToken)) {
      response.status(403).json({ detail: "kit mutation requires operator/dev auth (x-dev-token); CH-C 之後改 session primary authority" });
      return;
    }
    await proxyConversionService(response, config.kitManagerApiBase, "POST", "/api/kit/instances/current/close", request.body ?? {});
  });

  // console-mapping-proxy:element_mapping 經 coordinator proxy 給 viewer。
  // 邊界:viewer 只打 :8004（SHALL NOT HTTP 直連 :49101）；coordinator server-side 從
  // config.conversionApiBase（host 可達的 host.docker.internal:49101）抓 mapping，帶全域 CORS 回傳。
  // 誠實:sessionId 非法 → 400；session 不存在 / 無 mapping_url binding → 404；conversion
  // 不可達 → 502（由 proxyConversionService 處理）。coordinator 僅 resolve+forward，不解讀/不保存 mapping。
  app.get("/api/governance/element-mapping/for-session/:sessionId", async (request, response) => {
    if (!isSafeSessionId(request.params.sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    const session = store.get(request.params.sessionId);
    if (!session) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    // 把 mapping_url 正規化成 path+query；拒 protocol-relative（//host/..）與非絕對路徑，
    // 避免 server-side fetch 被導向 config.conversionApiBase 以外的 host（SSRF）。
    const toUpstreamPath = (raw: string): string | null => {
      let p: string;
      try {
        const parsed = new URL(raw);
        p = `${parsed.pathname}${parsed.search}`;
      } catch {
        p = raw;
      }
      return p.startsWith("/") && !p.startsWith("//") ? p : null;
    };
    // 只 proxy 屬於本 session binding 的 artifact path（白名單，防任意 URL SSRF）；對 host 差異穩健。
    const boundPaths = (session.artifact_bindings ?? [])
      .map((binding) => binding.mapping_url)
      .filter((url): url is string => typeof url === "string" && url.length > 0)
      .map(toUpstreamPath)
      .filter((path): path is string => path !== null);
    if (boundPaths.length === 0) {
      response.status(404).json({ detail: "No element_mapping bound to this review session." });
      return;
    }
    // 多 binding：viewer 以 ?url= 指定要哪個 binding 的 mapping（選對 asset）；未指定用第一個
    // （單 artifact MVP 行為不變）。指定值須屬於本 session binding，否則 404（不 proxy 任意 URL）。
    const requestedRaw = typeof request.query.url === "string" ? request.query.url : null;
    let upstreamPath: string | null;
    if (requestedRaw) {
      const requestedPath = toUpstreamPath(requestedRaw);
      upstreamPath = requestedPath && boundPaths.includes(requestedPath) ? requestedPath : null;
    } else {
      upstreamPath = boundPaths[0];
    }
    if (!upstreamPath) {
      response.status(404).json({ detail: "Requested mapping_url is not bound to this review session." });
      return;
    }
    await proxyConversionService(response, config.conversionApiBase, "GET", upstreamPath);
  });

  // A1 治理 rule-run proxy（瀏覽器 → :8004 → governance-service 127.0.0.1:49102 loopback）。
  // unified-console-mvp:注入 session→server-side IFC 路徑 resolver，讓
  // `POST /api/governance/rule-runs/for-session/:sessionId` 能用瀏覽器手上唯一
  // 的 session_id 解析出 host-side IFC 路徑後透傳。resolver 只讀 coordinator
  // 自己的 SessionStore + ExternalIfcReadyStore（不新增資料權威），失敗回誠實 reason。
  function ruleRunSourceMetadataForJob(
    job: IfcReadyIntakeJob,
    modelVersionId: string | null | undefined,
    session: ReviewSession | null = null,
  ): RuleRunSourceMetadata {
    return {
      source_kind: "minio_ifc_ready",
      ifc_ready_job_id: job.ifc_ready_job_id,
      idempotency_key: job.idempotency_key,
      project_id: job.project_id,
      project_display_name: job.project_display_name ?? null,
      model_category: job.category ?? null,
      model_version_id: modelVersionId ?? job.external_model_version_id ?? null,
      source_ifc_etag: job.source_ifc_etag ?? null,
      review_session_id: session?.session_id ?? job.review_session_id ?? null,
      conversion_job_id: job.conversion_job_id ?? null,
      conversion_status: job.conversion_status ?? null,
    };
  }

  function resolveDownloadedJobForRuleRun(
    job: IfcReadyIntakeJob | null | undefined,
    modelVersionId: string | null | undefined,
    session: ReviewSession | null = null,
  ): RuleRunSessionResolution {
    if (!job) {
      return { ok: false, reason: "IFC-ready job not found." };
    }
    if (job.download_status !== "downloaded") {
      return { ok: false, reason: "IFC-ready job has not been downloaded to a server-side path yet." };
    }
    // host_local_path = governance-service host 視角可讀的絕對路徑（markDownloaded
    // 於同步下載完成時寫入）。container 視角 local_path 只作為 legacy fallback。
    const ifcSourcePath = job.host_local_path || job.local_path || null;
    if (!ifcSourcePath) {
      return {
        ok: false,
        reason: "IFC for this job has not been downloaded to a server-side path yet.",
      };
    }
    const sourceProbe = sourceHealthProbePathForJob(job);
    const sourceCheck = checkSourceIfcPath(sourceProbe.sourcePath, sourceProbe.storageRoot, config.edgeRuntimeDataRoot);
    if (sourceCheck.value !== true) {
      return {
        ok: false,
        error_code: "stale_session_artifact",
        detail: "source_ifc_missing",
        artifact_health: markSourceIfcUnavailable(job, session, sourceCheck.failure ?? "source_ifc_missing"),
      };
    }
    return {
      ok: true,
      context: {
        ifc_source_path: ifcSourcePath,
        model_version_id: modelVersionId,
        ifc_ready_job_id: job.ifc_ready_job_id,
        source_metadata: ruleRunSourceMetadataForJob(job, modelVersionId, session),
      },
    };
  }

  function resolveA4HandoffSessionContext(
    _sessionId: string,
    headers: Record<string, string | undefined>,
  ): A4SearchSessionResolution {
    try {
      userAuthProvider.authenticate({ headers });
    } catch (error) {
      if (error instanceof AuthError) {
        return {
          ok: false,
          status: error.statusCode,
          error_code: "a4_authentication_required",
          detail: "A4 authentication failed.",
        };
      }
      return {
        ok: false,
        status: 503,
        error_code: "a4_authentication_unavailable",
        detail: "A4 authentication is unavailable.",
      };
    }

    // local-dev identity and the current browser lease token are lab seams, not
    // an authentic production capability. Keep the mounted mutation route
    // unavailable until the shared owner supplies verifiable principal/lease
    // authority; injected route tests cover the trusted resolver contract.
    return {
      ok: false,
      status: 503,
      error_code: "a4_authentic_lease_unavailable",
      detail: "Authentic viewer lease verification is unavailable.",
    };
  }

  function authenticateA4SearchPrincipal(
    headers: Record<string, string | undefined>,
  ): A4SearchPrincipalResolution {
    try {
      const user = userAuthProvider.authenticate({ headers });
      if (process.env.NODE_ENV === "production" && user.ssoBinding === "pending_oq5") {
        return {
          ok: false,
          status: 503,
          error_code: "a4_production_identity_unavailable",
          detail: "Production A4 identity is unavailable.",
        };
      }
      return {
        ok: true,
        principal: {
          principal_ref: user.userId,
          auth_scope: user.ssoBinding === "bound" ? "production" : "lab",
        },
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return {
          ok: false,
          status: error.statusCode === 403 ? 403 : 401,
          error_code: "a4_authentication_required",
          detail: "A4 authentication failed.",
        };
      }
      return {
        ok: false,
        status: 503,
        error_code: "a4_authentication_unavailable",
        detail: "A4 authentication is unavailable.",
      };
    }
  }

  function isExactConversionArtifactUrl(
    value: string | null | undefined,
    conversionJobId: string,
    filename: "model.usdc" | "element_mapping.json",
  ): boolean {
    if (!value || !isSafeConversionJobId(conversionJobId)) return false;
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "http:" || parsed.protocol === "https:")
        && parsed.username.length === 0
        && parsed.password.length === 0
        && parsed.search.length === 0
        && parsed.hash.length === 0
        && parsed.pathname === `/artifacts/${conversionJobId}/${filename}`;
    } catch {
      return false;
    }
  }

  function containedA4MappingPath(
    binding: ArtifactBinding,
    linkedConversionJobId: string | null | undefined,
  ): string | null {
    const conversionJobId = binding.conversion_job_id;
    if (
      binding.conversion_authority !== "bim-streaming-server"
      || binding.conversion_status !== "ready"
      || !conversionJobId
      || conversionJobId !== linkedConversionJobId
      || !isExactConversionArtifactUrl(binding.url, conversionJobId, "model.usdc")
      || !isExactConversionArtifactUrl(binding.mapping_url, conversionJobId, "element_mapping.json")
    ) return null;

    const artifactsRoot = path.resolve(config.a4ConversionArtifactsRoot);
    const candidate = path.resolve(artifactsRoot, conversionJobId, "element_mapping.json");
    const relative = path.relative(artifactsRoot, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    try {
      if (!fs.statSync(candidate).isFile()) return null;
      const realRoot = fs.realpathSync(artifactsRoot);
      const realCandidate = fs.realpathSync(candidate);
      const realRelative = path.relative(realRoot, realCandidate);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) return null;

      const hostRootValue = config.a4ConversionArtifactsHostRoot;
      const hostPath = /^[A-Za-z]:[\\/]|^\\\\/.test(hostRootValue) ? path.win32 : path.posix;
      if (!hostPath.isAbsolute(hostRootValue)) return null;
      const hostRoot = hostPath.resolve(hostRootValue);
      const hostCandidate = hostPath.resolve(hostRoot, conversionJobId, "element_mapping.json");
      const hostRelative = hostPath.relative(hostRoot, hostCandidate);
      if (!hostRelative || hostRelative.startsWith("..") || hostPath.isAbsolute(hostRelative)) return null;
      return hostCandidate;
    } catch {
      return null;
    }
  }

  function resolveA4SearchSessionContext(
    sessionId: string,
    principal: A4SearchPrincipal,
  ): A4SearchRouteSessionResolution {
    const session = store.get(sessionId);
    if (!session) {
      return {
        ok: false,
        status: 404,
        error_code: "a4_session_not_found",
        detail: "A4 review session was not found.",
      };
    }
    if (session.status !== "active") {
      return {
        ok: false,
        status: 409,
        error_code: "a4_session_inactive",
        detail: "A4 requires an active review session.",
      };
    }

    const primaryLease = viewerLeaseStore.primary(sessionId);
    if (!primaryLease || primaryLease.user_id !== principal.principal_ref) {
      return {
        ok: false,
        status: 403,
        error_code: "a4_primary_lease_required",
        detail: "A4 requires the caller's active primary viewer lease.",
      };
    }

    const modelVersionId = session.model_version_id?.trim();
    const activeBinding = runtimeMutationAuthority.getActiveStageBinding({
      sessionId,
      principal: principal.principal_ref,
    });
    if (!activeBinding || activeBinding.leaseId !== primaryLease.lease_id) {
      return {
        ok: false,
        status: 409,
        error_code: "a4_session_stage_unavailable",
        detail: "A4 session stage binding is not active.",
      };
    }
    const activePrimary = activeBinding.composition.primary;
    const primaryBinding = session.artifact_bindings.find((binding) =>
      binding.artifact_id === activePrimary.artifactId,
    );
    if (
      !modelVersionId
      || !primaryBinding
      || primaryBinding.model_version_id !== modelVersionId
      || !primaryBinding.artifact_id
      || primaryBinding.url !== activePrimary.usdcUrl
    ) {
      return {
        ok: false,
        status: 409,
        error_code: "a4_session_model_unavailable",
        detail: "A4 session model binding is incomplete.",
      };
    }

    const linkedJob = latestIfcReadyJobForSession(sessionId);
    if (!linkedJob || linkedJob.external_model_version_id !== modelVersionId) {
      return {
        ok: false,
        status: 409,
        error_code: "a4_session_model_unavailable",
        detail: "A4 session model binding is incomplete.",
      };
    }
    const source = resolveDownloadedJobForRuleRun(linkedJob, modelVersionId, session);
    if (!source.ok) {
      return {
        ok: false,
        status: 409,
        error_code: "a4_session_source_unavailable",
        detail: "A4 session source IFC is unavailable.",
      };
    }

    const mappingPath = linkedJob.conversion_authority === "bim-streaming-server"
      && linkedJob.conversion_status === "ready"
      ? containedA4MappingPath(primaryBinding, linkedJob.conversion_job_id)
      : null;
    if (!mappingPath) {
      return {
        ok: false,
        status: 409,
        error_code: "a4_session_mapping_unavailable",
        detail: "A4 session element mapping is unavailable.",
      };
    }

    return {
      ok: true,
      context: {
        ifc_source_path: source.context.ifc_source_path,
        element_mapping_path: mappingPath,
        model_version_id: modelVersionId,
        review_session_id: sessionId,
        primary_artifact_id: primaryBinding.artifact_id,
        active_binding_revision: activeBinding.bindingRevisionId,
        mapping_provenance: "server_resolved",
        // Current browser lease carriers are local runtime seams, not a
        // production-verifiable shared capability. Governance therefore keeps
        // this route table-only and cannot mint proof/Issue/3D authority.
        primary_lease_capability: "lab_unverified",
      },
    };
  }

  function resolveA4SearchIfcReadyContext(jobId: string): A4SearchIfcReadyResolution {
    const job = externalIfcReadyStore.get(jobId);
    if (!job) {
      return {
        ok: false,
        status: 404,
        error_code: "a4_ifc_ready_not_found",
        detail: "A4 IFC-ready job was not found.",
      };
    }
    const source = resolveDownloadedJobForRuleRun(job, job.external_model_version_id ?? null);
    if (!source.ok) {
      return {
        ok: false,
        status: 409,
        error_code: "a4_ifc_ready_source_unavailable",
        detail: "A4 IFC-ready source is unavailable.",
      };
    }
    return {
      ok: true,
      context: {
        ifc_source_path: source.context.ifc_source_path,
        model_version_id: source.context.model_version_id ?? null,
      },
    };
  }

  // Mount before the frozen generic governance proxy so Express's first-match
  // routing enforces the A4 browser boundary without editing that shared file.
  registerA4SearchRoutes(app, {
    isSafeSessionId,
    isSafeIfcReadyJobId,
    authenticatePrincipal: authenticateA4SearchPrincipal,
    resolveSessionContext: resolveA4SearchSessionContext,
    resolveIfcReadyContext: resolveA4SearchIfcReadyContext,
  });

  registerA4IssueRoutes(app, {
    isSafeSessionId,
    authenticatePrincipal: authenticateA4SearchPrincipal,
    resolveSessionContext: resolveA4SearchSessionContext,
  });

  registerGovernanceProxy(app, {
    isSafeSessionId,
    isSafeIfcReadyJobId,
    resolveRuleRunIfcReadyContext: (jobId) => {
      const job = externalIfcReadyStore.get(jobId);
      return resolveDownloadedJobForRuleRun(job, job?.external_model_version_id ?? null);
    },
    resolveRuleRunSessionContext: (sessionId) => {
      const session = store.get(sessionId);
      if (!session) {
        return { ok: false, reason: "Review session not found." };
      }
      // session → ifc-ready job：conversion-ready auto-session 時由
      // recordReviewSession 寫入 job.review_session_id 反向參照（app.ts ~905）。
      const job = latestIfcReadyJobForSession(sessionId);
      if (!job) {
        return {
          ok: false,
          reason:
            "No IFC-ready job linked to this session; rule-run requires an IFC ingested via /api/external/ifc-ready.",
        };
      }
      return resolveDownloadedJobForRuleRun(job, session.model_version_id, session);
    },
  });
  registerA4HandoffRoutes(app, {
    isSafeSessionId,
    resolveA4SearchSessionContext: resolveA4HandoffSessionContext,
  });

  registerDevMetaRoutes(app, config); // R8：唯讀 test-data-projects meta（routes/devMeta.ts，加性慣例單行 mount）
  registerHealthProbeRoutes(app, { artifactHealthLedger, structLog, startedAt });
  registerStreamConfigRoutes(app, { config, structLog });

  // rvt-ifc-usdc-lineage task 3.1：governed source-bundle intake／讀取（加性 mount）。
  // legacy `/api/external/ifc-ready*` 路由已在上方註冊且**逐字不動**；此處只新增
  // `/api/external/source-bundles*` 與 `/api/lineage/legacy-unmanaged/*`。
  // `enqueue` 由 task 3.2 注入；3.1 不注入＝`enqueued_pipeline_job_id` 誠實維持 null。
  registerLineageSourceBundleRoutes(app, {
    config,
    authProvider,
    store: sourceBundleStore,
    validator: validateSourceBundle,
    objects: sourceBundleObjectPort,
    // rvt-ifc-usdc-lineage task 3.2：接上 auto-enqueue ＋ job 讀取面。
    // 3.1 未注入時 `enqueued_pipeline_job_id` 誠實維持 null；接上後由 store 決定。
    enqueue: enqueueGovernedBundle,
    jobs: pipelineJobStore,
    // Protected legacy enrollment remains 503 until an external verifier is explicitly wired.
    authorization: null,
    rejectIfIpNotAllowed,
    structLog,
  });

  // rvt-ifc-usdc-lineage task 3.3：additive result compare / intent / confirm routes。
  // External decision wire/JWKS/principal adapter 尚無 owner contract，因此 authorization
  // 明確為 null，protected routes 回 authorization_unavailable，不沿用 LocalDevUserAuthProvider。
  registerLineageResultRoutes(app, {
    jobs: pipelineJobStore,
    results: pipelineResultStore,
    authorization: null,
    // detail reader 已接上生產 adapter：compare 的 metrics／counts 一律來自 MinIO 實讀、
    // digest 驗過的 result manifest；governed object port 未設定時仍為 null（誠實 503）。
    details: pipelineResultDetails,
    now: nowIso,
    newIntentId: () => `intent_${randomBytes(16).toString("hex")}`,
    newIntentNonce: () => randomBytes(32).toString("base64url"),
  });
  // Task 3.4 metadata surfaces share the same external authorization boundary. The production
  // adapter is intentionally not fabricated here; mounted routes therefore fail closed with 503
  // until the control-plane verifier contract is supplied.
  registerLineageGovernanceMetadataRoutes(app, {
    jobs: pipelineJobStore,
    bundles: sourceBundleStore,
    results: pipelineResultStore,
    authorization: null,
    // manifest 投影已接上：alignment_metrics／warnings／artifacts 由 MinIO 實讀的
    // manifest 供給；alignment report（逐 element 差異集合）尚未建讀取路徑，
    // summary／differences／difference_counts 誠實維持 NOT_BUILT。
    projections: lineageMetadataProjections,
    now: nowIso,
  });
  // Task 3.4 download endpoint is mounted so the public path fails closed instead of 404. The
  // external verifier, digest-verified manifest reader, and VersionId-aware signer remain HELD;
  // legacy ObjectStorePort.presign is intentionally not reused because it cannot pin VersionId.
  registerLineageArtifactDownloadRoutes(app, {
    jobs: pipelineJobStore,
    results: pipelineResultStore,
    authorization: null,
    reader: pipelineResultArtifactReader,
    signer: lineageArtifactDownloadSigner,
    target_policies: lineageDownloadTargetPolicies.policies,
    now: nowIso,
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ detail: error.flatten() });
      return;
    }
    if (error instanceof AuthError) {
      response.status(error.statusCode).json({ detail: error.message });
      return;
    }
    if (error instanceof MetadataOnlyViolation) {
      // 雲地分離鐵律：metadata-only callback 不得帶大型模型本體。
      response.status(422).json({ detail: error.message });
      return;
    }
    // express.json() with `limit` throws an error tagged `entity.too.large`.
    // Surface as 413 for cross-service-structured-log-baseline viewer-log intake.
    const tagged = error as { type?: string; status?: number };
    if (tagged && (tagged.type === "entity.too.large" || tagged.status === 413)) {
      response.status(413).json({ detail: "request body too large", accepted: 0, dropped: 0 });
      return;
    }
    response.status(500).json({ detail: error instanceof Error ? error.message : String(error) });
  });

  registerReviewNamespace(io, store, eventLog, sessionTraceResolver, idleReclaimService);

  // coordinator-auto-poll-streaming-conversion §6:dispose 清空所有 in-process auto
  // poller timer。process shutdown / 測試 teardown 必呼叫,避免 keep-alive 阻 exit。
  // coordinator-serial-conversion-dispatch-queue:dispose 同時 drain 未派工的
  // queue,把 jobs 標記 dropped_on_restart(in-memory queue 非 disk-persistent;
  // restart 後 operator 必須重新 POST,跟 spec scenario「Coordinator restart
  // drops queued jobs」對齊)。
  let disposed = false;
  const dispose = async (): Promise<void> => {
    // 冪等守門:測試的 explicit dispose() 之後 afterEach 會再 dispose() 一次;重跑 drain/
    // markDroppedOnRestart/clear 會造成重複 store 寫入,二次起一律 no-op。
    if (disposed) return;
    disposed = true;
    idleReclaimService.stop();
    // 先結束 SSE 訂閱端、停 intake 並 await in-flight tick settle（皆由 surface 擁有）；
    // 其最後一筆 enqueue 必須在 pipeline drain 前完成，否則 shutdown 後仍可能遺留 queued job。
    await minioWatchSurface.dispose();
    // conversion pollers + dispatch drain + pending clear（pipeline 擁有）。
    ifcReadyPipeline.dispose();
    // rvt-ifc-usdc-lineage 3.2：先停 reconciliation 排程並 await in-flight tick settle，
    // 否則它可能在 object port 被 destroy 之後才醒來（unhandled rejection）。
    // 順序與 minioWatchSurface → port destroy 的既有理由完全相同。
    await sourceBundleReconciler.stop();
    // rvt-ifc-usdc-lineage 3.1：governed object port 的 S3 client（未設定時為 null）。
    // destroy 可能回 void 或 Promise，await 兩者皆安全。
    await sourceBundleObjectPort?.destroy();
  };

  return {
    app,
    server,
    io,
    config,
    store,
    externalIfcReadyStore,
    sourceBundleStore,
    pipelineJobStore,
    sourceBundleReconciler,
    pipelineResultStore,
    pipelineResultRegistration,
    pipelineResultDetails,
    lineageArtifactSurfaces: {
      reader: pipelineResultArtifactReader,
      signer: lineageArtifactDownloadSigner,
      projections: lineageMetadataProjections,
      target_policies: lineageDownloadTargetPolicies.policies,
    },
    eventLog,
    structLog,
    idleReclaimService,
    dispose,
    minioWatchSurface,
    // test-only boolean getter：委派 pipeline.hasPendingDispatch（不外洩 pending map）。
    hasPendingDispatch: (jobId: string): boolean => ifcReadyPipeline.hasPendingDispatch(jobId),
  };
}
function sanitizeJobForExternal(job: IfcReadyIntakeJob): IfcReadyIntakeJob {
  // ifc-ready-api-field-redesign（list/detail 對稱）：conversion_failure 為 internal-only 欄位,
  // 對外一律由 deriveFailure(job) 投影 humanized failure_reason/failure_stage,不直接外吐 raw 欄位。
  // 否則本函式（detail / intake 202 / replay 200）full-spread 會外吐 conversion_failure,而列表端
  // summarizeIfcReadyJob 是 whitelist 不含此欄 → list/detail 形狀分歧（未文件化的非對稱曝露）。
  const rest = { ...job, source_ifc_ref: maskPresignedRef(job.source_ifc_ref) };
  delete (rest as { conversion_failure?: string | null }).conversion_failure;
  delete (rest as { local_path?: string | null }).local_path;
  delete (rest as { host_local_path?: string | null }).host_local_path;
  return rest;
}

function hasConfiguredConversionOrigin(urlValue: string | null, configuredConversionApiBase: string): boolean {
  if (!urlValue) return true;
  try {
    return new URL(urlValue).origin === new URL(configuredConversionApiBase).origin;
  } catch {
    return false;
  }
}

function isTrustedDirectSessionProbeBinding(binding: ArtifactBinding, configuredConversionApiBase: string): boolean {
  return binding.conversion_authority === "bim-streaming-server"
    && hasConfiguredConversionOrigin(binding.url, configuredConversionApiBase)
    && hasConfiguredConversionOrigin(binding.mapping_url, configuredConversionApiBase);
}

function parseListLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(100, Math.max(1, parsed));
}

function headersToMap(headers: express.Request["headers"]): Record<string, string | undefined> {
  const headerMap: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    headerMap[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return headerMap;
}

function isInternalRequestAuthorized(headers: Record<string, string | undefined>, token: string): boolean {
  const expected = token.trim();
  if (!expected) return false;
  const headerToken = headers["x-internal-token"]?.trim();
  const authorization = headers.authorization;
  const bearerToken =
    typeof authorization === "string" && authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "";
  return headerToken === expected || bearerToken === expected;
}

function resolveAllowedCallbackTarget(candidateUrl: string | null, config: CoordinatorConfig): string | null {
  const configuredBase = config.cloudCallbackBaseUrl.trim();
  if (!configuredBase) return null;
  const base = new URL(configuredBase);
  if (!candidateUrl) return configuredBase;
  const candidate = new URL(candidateUrl);
  if (candidate.origin !== base.origin) {
    throw new AuthError(403, `callback_url origin not allowed: ${candidate.origin}`);
  }
  return candidate.toString();
}

function latestIfcReadyJobForExternalModelVersion(
  jobs: IfcReadyIntakeJob[],
  externalModelVersionId: string,
): IfcReadyIntakeJob | undefined {
  return jobs
    .filter((job) => job.external_model_version_id === externalModelVersionId)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
}

const IFC_READY_TRACE_ID_PATTERN = /^ifcready_[A-Za-z0-9_-]+$/;
const TRACE_ID_MAX_LENGTH = 200;

function isSafeIfcReadyTraceId(value: string): boolean {
  return value.length <= TRACE_ID_MAX_LENGTH
    && IFC_READY_TRACE_ID_PATTERN.test(value)
    && !value.startsWith("ifcready_ifcready_");
}

function buildCoordinatorOpenUrl(
  config: CoordinatorConfig,
  session: string,
  traceId?: string,
): string {
  const url = new URL("ui/open", `${config.coordinatorPublicBaseUrl}/`);
  url.searchParams.set("session", session);
  if (traceId && isSafeIfcReadyTraceId(traceId)) {
    url.searchParams.set("trace_id", traceId);
  }
  return url.toString();
}

function resolvePublicDir(): string {
  const fromCwd = path.resolve(process.cwd(), "src", "public");
  if (fs.existsSync(path.join(fromCwd, "dev-console.html"))) {
    return fromCwd;
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(moduleDir, "public");
}

// ── real-ifc-fixture-intake 安全 helpers（PR #184 風險修正）─────────────────────
// 穩定、path-safe、可逆的 source_id（base64url(filename)）。對映 docs/contracts/worker-api.md
// 的 ifc-sources 契約：回應「絕不」洩漏絕對路徑，僅 top-level *.ifc，忽略 symlink，拒絕 stale/out-of-root id。
function sourceIdForFilename(filename: string): string {
  return "ifcsrc_" + Buffer.from(filename, "utf8").toString("base64url");
}

function filenameForSourceId(sourceId: string, storageRoot: string): string | null {
  if (typeof sourceId !== "string" || !sourceId.startsWith("ifcsrc_")) return null;
  let filename: string;
  try {
    filename = Buffer.from(sourceId.slice("ifcsrc_".length), "base64url").toString("utf8");
  } catch {
    return null;
  }
  // 僅允許 top-level *.ifc（無路徑分隔，擋穿越），且實際存在於 storageRoot（拒絕 stale / out-of-root）。
  if (!/^[^/\\]+\.ifc$/i.test(filename)) return null;
  const root = path.resolve(storageRoot);
  const full = path.resolve(root, filename);
  if (full !== path.join(root, filename)) return null;
  try {
    if (!fs.statSync(full).isFile()) return null;
  } catch {
    return null;
  }
  return filename;
}

// 僅 loopback（coordinator 自身 self-fetch）可取 IFC bytes；擋 0.0.0.0 綁定下的 LAN client 暴露。
function isLoopbackRequest(request: express.Request): boolean {
  const raw = (request.ip || request.socket?.remoteAddress || "").toString();
  const ip = raw.replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

// /api/dev/* demo 路由開關（production / 非 demo 應設 ENABLE_DEV_ROUTES=false → 404）。
function devRoutesEnabled(): boolean {
  return process.env.ENABLE_DEV_ROUTES !== "false";
}

// 變更型 /api/kit/* 需 operator/dev 授權（dev token header）。CH-C 之後改為 session primary authority。
// 前端 gate 僅 UX；此處為「轉發前」的後端授權邊界（coordinator 仍只轉發，Kit 權威留 kit-manager）。
function isKitMutationAuthorized(request: express.Request, devToken: string): boolean {
  const token = request.header("x-dev-token") || request.header("x-operator-token");
  return Boolean(token && devToken && token === devToken);
}

async function proxyConversionService(
  response: express.Response,
  conversionApiBase: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<void> {
  try {
    const upstreamUrl = new URL(path, ensureTrailingSlash(conversionApiBase)).toString();
    const headers: Record<string, string> = { Accept: "application/json" };
    const init: RequestInit = {
      method,
      headers,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const upstream = await fetch(upstreamUrl, init);
    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    response.status(upstream.status).type(contentType).send(text || "{}");
  } catch (error) {
    response.status(502).json({
      detail: "Conversion API unavailable.",
      upstream: conversionApiBase,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function randomWebViewSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
