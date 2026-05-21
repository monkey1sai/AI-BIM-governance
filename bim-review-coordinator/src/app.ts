import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { z } from "zod";
import type { CoordinatorConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { AuthError, createAuthProvider, createUserAuthProvider } from "./services/authProvider.js";
import { CallbackOutbox, MetadataOnlyViolation } from "./services/callbackOutbox.js";
import { BimControlClient } from "./services/bimControlClient.js";
import { EventLog } from "./services/eventLog.js";
import { ExternalIfcReadyStore } from "./services/externalIfcReadyStore.js";
import { StreamingConversionClient } from "./services/streamingConversionClient.js";
import {
  allocateKitInstanceBindings,
  allocateLocalKitInstance,
  legacyKitInstanceFromBinding,
  markKitBindingsDraining,
  releaseKitBindings,
} from "./services/kitPool.js";
import { isSafeSessionId, isSessionMutable, SessionStore } from "./services/sessionStore.js";
import { registerReviewNamespace } from "./socket/reviewNamespace.js";
import type {
  Artifact,
  ArtifactBinding,
  ConversionQualityMetricsSummary,
  ExternalIfcReadyEvent,
  IfcReadyIntakeJob,
  KitInstanceBinding,
  ReviewSession,
  RoutingPolicy,
  StreamConfigResponse,
} from "./types.js";

const createSessionSchema = z.object({
  review_request_id: z.string().min(1).optional(),
  tenant_id: z.string().min(1).default("tenant_demo_001"),
  project_id: z.string().min(1),
  model_version_id: z.string().min(1),
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
    })
    .passthrough()
    .nullish(),
});

const participantSchema = z.object({
  user_id: z.string().min(1),
  display_name: z.string().optional(),
});

const appendEventSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();

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
  eventLog: EventLog;
}

type RawBodyRequest = express.Request & { rawBody?: string };

export function createCoordinatorApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const config = loadConfig(overrides);
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: config.corsOrigins,
      credentials: false,
    },
  });
  const store = new SessionStore(config.sessionStoreDir);
  const eventLog = new EventLog(config.eventLogDir);
  const bimControlClient = new BimControlClient(config.bimControlApiBase);
  // B-scheme（local-coordinator-ifc-ready-intake-boundary T3）：對外 IFC-ready intake。
  const authProvider = createAuthProvider(config);
  const externalIfcReadyStore = new ExternalIfcReadyStore();
  const streamingConversionClient = new StreamingConversionClient(
    config.streamingConversionApiBase,
    undefined,
    config.streamingConversionInternalToken || undefined,
  );
  // T5：轉檔結果回拋公司雲端（metadata-only outbox / retry / dead-letter）。
  const callbackOutbox = new CallbackOutbox(
    config.callbackOutboxMaxAttempts,
    undefined,
    config.callbackOutboxStorePath,
  );
  // T7：使用者（local web view）auth，可替換；不做死 EZPLUS SSO（OQ5 pending）。
  const userAuthProvider = createUserAuthProvider(config);

  app.use(cors({ origin: config.corsOrigins }));
  app.use(
    express.json({
      limit: "1mb",
      verify: (request, _response, buffer) => {
        (request as RawBodyRequest).rawBody = buffer.toString("utf8");
      },
    }),
  );
  mountDevConsole(app);

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "bim-review-coordinator",
      kit_signaling_port: config.kitSignalingPort,
    });
  });

  app.post("/api/review-sessions", async (request, response, next) => {
    try {
      const input = createSessionSchema.parse(request.body);
      const artifacts = await safeArtifacts(bimControlClient, input.model_version_id);
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

  app.get("/api/review-sessions/:sessionId/stream-config", async (request, response, next) => {
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
      const artifacts = await safeArtifacts(bimControlClient, session.model_version_id);
      response.json(buildStreamConfig(session, artifacts, config));
    } catch (error) {
      next(error);
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

  app.post("/api/review-sessions/:sessionId/close", (request, response) => {
    if (!isSafeSessionId(request.params.sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    const session = store.get(request.params.sessionId);
    if (!session) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    if (session.status === "closed") {
      response.json(session);
      return;
    }

    const finalEvents = Array.isArray(request.body?.final_events) ? request.body.final_events : [];
    const closing = store.update(session.session_id, {
      status: "closing",
      kit_instance_bindings: markKitBindingsDraining(session.kit_instance_bindings),
    });
    eventLog.append(session.session_id, "sessionClosing", { final_events: finalEvents.length });
    for (const event of finalEvents) {
      eventLog.append(session.session_id, "finalReviewEvent", event);
    }
    const closed = store.update(session.session_id, {
      status: "closed",
      participants: [],
      kit_instance_bindings: releaseKitBindings(closing?.kit_instance_bindings || session.kit_instance_bindings),
    });
    eventLog.append(session.session_id, "sessionClosed", {});
    eventLog.append(session.session_id, "kitInstanceReleased", {
      kit_instance_bindings: closed?.kit_instance_bindings.map((binding) => binding.kit_instance_id) || [],
    });
    response.json(closed);
  });

  app.get("/api/model-versions/:modelVersionId/review-bootstrap", async (request, response, next) => {
    try {
      const [artifacts, issues] = await Promise.all([
        safeArtifacts(bimControlClient, request.params.modelVersionId),
        safeIssues(bimControlClient, request.params.modelVersionId),
      ]);
      response.json({
        model_version_id: request.params.modelVersionId,
        artifacts,
        issues,
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

      const existing = externalIfcReadyStore.findExisting(auth.idempotencyKey, auth.correlationId);
      if (existing) {
        response.status(200).json({ ...existing, idempotent_replay: true });
        return;
      }

      const job = externalIfcReadyStore.create(event, {
        correlationId: auth.correlationId,
        idempotencyKey: auth.idempotencyKey,
        tenantId: auth.tenantId,
        projectId: auth.projectId,
        externalModelVersionId: auth.externalModelVersionId,
      });

      // ifc-ready 已被接受並落地（local job + external_model_version_id binding）。
      // 內部轉檔派工失敗為可重試狀態，不否定 intake 本身（重試/補派 + 雲端
      // callback outbox 屬 T4/T5）。
      try {
        const dispatch = await streamingConversionClient.createConversionJob(event, {
          correlationId: auth.correlationId,
          externalModelVersionId: auth.externalModelVersionId,
        });
        externalIfcReadyStore.markDispatched(job.ifc_ready_job_id, dispatch.conversion_job_id, dispatch.status);
      } catch (dispatchError) {
        externalIfcReadyStore.markDispatchFailed(
          job.ifc_ready_job_id,
          dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
        );
      }

      response.status(202).json(externalIfcReadyStore.get(job.ifc_ready_job_id));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/external/ifc-ready/:jobId", (request, response) => {
    const job = externalIfcReadyStore.get(request.params.jobId);
    if (!job) {
      response.status(404).json({ detail: "IFC-ready job not found." });
      return;
    }
    response.json(job);
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
    if (!isInternalRequestAuthorized(headersToMap(request.headers), config.internalApiAuthToken)) {
      response.status(401).json({ detail: "missing or invalid internal API token" });
      return;
    }
    next();
  });

  // B-scheme T5：本地轉檔結果 → 組 metadata-only 雲端 callback 並入 outbox。
  // 行為保持式 helper：`/api/internal/conversion-result`（外部/輪詢餵入）與
  // `/api/internal/conversions/:id/ingest`（coordinator 主動拉 host-native
  // `GET /result`）共用同一條 ingestion 路徑，不重複邏輯。
  //
  // backfill-coordinator-webhook-and-auto-session §2 (D10/D11)：terminal `ready`
  // 分支於 callback outbox enqueue 之後並行呼叫 autoCreateOrActivateSession，
  // 把退役 `_bim-control` 孤立的 session 觸發責任 re-home 進本路徑；outbox 與
  // session 狀態獨立分類（pending callback 不阻塞 session handoff，反之亦然）。
  type ConversionIngestOutcome =
    | {
        ok: true;
        ifc_ready_job: ReturnType<typeof externalIfcReadyStore.recordConversionOutcome>;
        callback: ReturnType<typeof callbackOutbox.enqueue>;
        session: ReviewSession | null;
        session_replay: boolean;
        session_reason?: string;
      }
    | { ok: false; status: number; detail: string };

  // backfill-coordinator-webhook-and-auto-session §2 (D10)：抽出共用 helper，
  // 與既有 `POST /api/review-sessions` route handler 走同一份 SessionStore /
  // kitPool / eventLog 權威；不複製 binding 規則。傳入 conversion-ready 的
  // streaming-owned artifact refs，構建最小 ArtifactBinding 後重用既有 Kit
  // binding 分配。
  function autoCreateOrActivateSession(
    job: IfcReadyIntakeJob,
    artifacts: { usdc_ref?: string | null; element_mapping_ref?: string | null; manifest_ref?: string | null },
    conversionJobId: string | null,
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
      quality_metrics_summary: null,
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

  function ingestConversionReport(
    report: z.infer<typeof conversionResultReportSchema>,
  ): ConversionIngestOutcome {
    const normalizedStatus = normalizeConversionReportStatus(report.status);
    const job = externalIfcReadyStore.getByCorrelation(report.correlation_id);
    if (!job) {
      return { ok: false, status: 404, detail: "No IFC-ready job for correlation_id." };
    }
    const conversionJobId = report.conversion_job_id || job.conversion_job_id || null;
    const targetUrl = job.callback_url || config.cloudCallbackBaseUrl || null;

    let payload: Record<string, unknown>;
    let event: "conversion_result_ready" | "conversion_failed";
    if (normalizedStatus === "ready") {
      event = "conversion_result_ready";
      payload = {
        event,
        tenant_id: job.tenant_id,
        project_id: job.project_id,
        external_model_version_id: job.external_model_version_id,
        external_conversion_task_id: job.external_conversion_task_id ?? null,
        conversion_job_id: conversionJobId,
        correlation_id: job.correlation_id,
        status: "ready",
        source_ifc: { ref: job.source_ifc_ref, etag: job.source_ifc_etag },
        artifacts: {
          usdc_ref: report.artifacts?.usdc_ref ?? null,
          element_mapping_ref: report.artifacts?.element_mapping_ref ?? null,
          manifest_ref: report.artifacts?.manifest_ref ?? null,
        },
        artifact_summary: report.artifact_summary ?? {},
      };
    } else {
      event = "conversion_failed";
      payload = {
        event,
        tenant_id: job.tenant_id,
        project_id: job.project_id,
        external_model_version_id: job.external_model_version_id,
        conversion_job_id: conversionJobId,
        correlation_id: job.correlation_id,
        status: "failed",
        reason: report.reason || "conversion_failed",
        retryable: report.retryable ?? false,
      };
    }

    const entry = callbackOutbox.enqueue({
      event,
      targetUrl,
      correlationId: job.correlation_id,
      externalModelVersionId: job.external_model_version_id,
      conversionJobId,
      payload,
    });
    const updatedJob = externalIfcReadyStore.recordConversionOutcome(
      job.ifc_ready_job_id,
      normalizedStatus,
      entry.outbox_id,
      report.artifacts?.manifest_ref ?? null,
    );

    // backfill §2：terminal `ready` 才觸發本地 session handoff；`failed` 不建
    // 可串流 session。auto-session 與 callback outbox **狀態獨立**——任一狀態
    // 不阻塞他者，pending / dead-letter callback 不影響 session handoff，反之
    // 亦然。
    let session: ReviewSession | null = null;
    let session_replay = false;
    let session_reason: string | undefined;
    if (normalizedStatus === "ready") {
      // 使用 updatedJob 取得包含 review_session_id 的最新 job 狀態。
      const sessionJob = updatedJob ?? job;
      const result = autoCreateOrActivateSession(
        sessionJob,
        {
          usdc_ref: report.artifacts?.usdc_ref ?? null,
          element_mapping_ref: report.artifacts?.element_mapping_ref ?? null,
          manifest_ref: report.artifacts?.manifest_ref ?? null,
        },
        conversionJobId,
      );
      if (result.session) {
        session = result.session;
        session_replay = result.replay;
      } else {
        session_reason = result.reason;
      }
    }

    return { ok: true, ifc_ready_job: updatedJob, callback: entry, session, session_replay, session_reason };
  }

  // 內部端點（外部/輪詢直接餵 report）。callback 投遞狀態與 conversion 成功
  // 分離；conversion 在本地 ready 即可查，callback 由 outbox 追蹤。
  app.post("/api/internal/conversion-result", (request, response, next) => {
    try {
      const report = conversionResultReportSchema.parse(request.body);
      const outcome = ingestConversionReport(report);
      if (!outcome.ok) {
        response.status(outcome.status).json({ detail: outcome.detail });
        return;
      }
      response.status(202).json({
        ifc_ready_job: outcome.ifc_ready_job,
        callback: outcome.callback,
        session: outcome.session,
        session_replay: outcome.session_replay,
        session_reason: outcome.session_reason ?? null,
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
      const result = await streamingConversionClient.fetchConversionResult(conversionJobId);
      const correlationId = result.correlation_id;
      if (!correlationId) {
        response.status(422).json({
          detail: "streaming conversion result has no correlation_id",
          conversion_job_id: conversionJobId,
        });
        return;
      }
      // 只有 terminal 結果才入 callback outbox。非終結（queued/running）不得
      // 被誤判為 failed，否則會提前送 conversion_failed 並持久化失敗結果。
      const failed =
        result.model_status === "failed" ||
        result.status === "failed" ||
        result.status === "cancelled";
      const ready =
        !failed &&
        (result.ready === true ||
          result.model_status === "ready" ||
          result.status === "succeeded" ||
          result.status === "succeeded_with_warnings");
      if (!failed && !ready) {
        response.status(409).json({
          detail: "conversion result is not terminal yet",
          conversion_job_id: conversionJobId,
          conversion_status: result.model_status ?? result.status ?? "unknown",
        });
        return;
      }
      const report = conversionResultReportSchema.parse({
        correlation_id: correlationId,
        conversion_job_id: result.conversion_job_id,
        status: failed ? "failed" : "ready",
        artifacts: {
          usdc_ref: result.usdc_ref ?? null,
          element_mapping_ref: result.element_mapping_ref ?? null,
          manifest_ref: result.manifest_ref ?? null,
        },
        reason: failed ? result.reason || "conversion_failed" : undefined,
        retryable: false,
      });
      const outcome = ingestConversionReport(report);
      if (!outcome.ok) {
        response.status(outcome.status).json({ detail: outcome.detail });
        return;
      }
      response.status(202).json({
        ifc_ready_job: outcome.ifc_ready_job,
        callback: outcome.callback,
        conversion_status: failed ? "failed" : "ready",
        session: outcome.session,
        session_replay: outcome.session_replay,
        session_reason: outcome.session_reason ?? null,
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
          source_ifc_ref: job.source_ifc_ref,
          artifact_manifest_ref: job.artifact_manifest_ref ?? null,
          conversion_job_id: job.conversion_job_id,
          conversion_status: job.conversion_status,
          conversion_authority: job.conversion_authority,
          viewer_open_ready: job.conversion_status === "ready",
        },
        created_at: new Date().toISOString(),
      };
      response.status(201).json(session);
    } catch (error) {
      next(error);
    }
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
    response.status(500).json({ detail: error instanceof Error ? error.message : String(error) });
  });

  registerReviewNamespace(io, store, eventLog, bimControlClient);

  return { app, server, io, config, store, eventLog };
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

function normalizeConversionReportStatus(status: "ready" | "succeeded" | "failed"): "ready" | "failed" {
  return status === "failed" ? "failed" : "ready";
}

function latestIfcReadyJobForExternalModelVersion(
  jobs: IfcReadyIntakeJob[],
  externalModelVersionId: string,
): IfcReadyIntakeJob | undefined {
  return jobs
    .filter((job) => job.external_model_version_id === externalModelVersionId)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
}

function mountDevConsole(app: express.Express): void {
  const publicDir = resolvePublicDir();
  app.use("/dev-console-assets", express.static(publicDir));
  app.get(["/ui", "/dev-console"], (_request, response) => {
    response.sendFile(path.join(publicDir, "dev-console.html"));
  });
}

function resolvePublicDir(): string {
  const fromCwd = path.resolve(process.cwd(), "src", "public");
  if (fs.existsSync(path.join(fromCwd, "dev-console.html"))) {
    return fromCwd;
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(moduleDir, "public");
}

async function safeArtifacts(client: BimControlClient, modelVersionId: string): Promise<Artifact[]> {
  try {
    return await client.getArtifacts(modelVersionId);
  } catch {
    return [];
  }
}

async function safeIssues(client: BimControlClient, modelVersionId: string) {
  try {
    return await client.getReviewIssues(modelVersionId);
  } catch {
    return [];
  }
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

function chooseReadyUsdc(artifacts: Artifact[]): Artifact | undefined {
  return artifacts.find((artifact) => artifact.artifact_type === "usdc" && artifact.status === "ready" && artifact.url);
}

function artifactReadyStatus(artifact: Artifact): ArtifactBinding["ready_status"] {
  if (artifact.conversion_authority === "bim-streaming-server") {
    const status = artifact.conversion_status || artifact.status;
    if (status === "queued" || status === "running" || status === "converting") return "converting";
    if (status === "failed") return "failed";
    if (status === "blocked") return "blocked_conversion";
  }
  if (artifact.artifact_type === "usdc" && artifact.status === "ready" && !artifact.mapping_url) return "missing_mapping";
  return artifact.status === "ready" ? "ready" : "missing_model";
}

function buildArtifactBindings(
  modelVersionId: string,
  artifacts: Artifact[],
  inputBindings: Array<z.infer<typeof createSessionSchema>["artifact_bindings"][number]>,
  routingPolicy: RoutingPolicy,
): ArtifactBinding[] {
  if (inputBindings.length > 0) {
    return inputBindings
      .slice()
      .sort((left, right) => left.load_order - right.load_order)
      .map((binding, index) => ({
        binding_id: binding.binding_id || `binding_${index + 1}`,
        artifact_group_id: binding.artifact_group_id,
        model_version_id: binding.model_version_id || modelVersionId,
        artifact_id: binding.artifact_id,
        display_name: binding.display_name || null,
        source_ifc_filename: binding.source_ifc_filename || null,
        artifact_role: binding.artifact_role,
        url: binding.url || null,
        mapping_url: binding.mapping_url || null,
        load_order: binding.load_order,
        routing_policy: binding.routing_policy || routingPolicy,
        ready_status: binding.ready_status,
        conversion_authority: binding.conversion_authority || null,
        conversion_job_id: binding.conversion_job_id || null,
        conversion_status: binding.conversion_status || null,
        failure_code: binding.failure_code || null,
        diagnostic: binding.diagnostic || null,
      }));
  }

  return artifacts
    .filter((artifact) => (artifact.status === "ready" && artifact.url) || artifact.conversion_authority === "bim-streaming-server")
    .map((artifact, index) => ({
      binding_id: `binding_${index + 1}`,
      artifact_group_id: `ag_${modelVersionId}`,
      model_version_id: modelVersionId,
      artifact_id: artifact.artifact_id,
      artifact_role: artifact.artifact_type === "usdc" ? "derived" : "source",
      url: artifact.url || null,
      mapping_url: artifact.mapping_url || null,
      load_order: index,
      routing_policy: routingPolicy,
      ready_status: artifactReadyStatus(artifact),
      conversion_authority: artifact.conversion_authority || null,
      conversion_job_id: artifact.conversion_job_id || null,
      conversion_status: artifact.conversion_status || artifact.status || null,
      failure_code: artifact.failure_code || null,
      diagnostic: artifact.diagnostic || null,
    }));
}

function chooseReadyBinding(bindings: ArtifactBinding[]): ArtifactBinding | undefined {
  return bindings.find((binding) => binding.artifact_role === "derived" && binding.ready_status === "ready" && binding.url);
}

function orderedLoadableDerivedBindings(bindings: ArtifactBinding[]): ArtifactBinding[] {
  return bindings
    .filter((binding) => binding.artifact_role === "derived" && binding.ready_status === "ready" && Boolean(binding.url))
    .slice()
    .sort((left, right) => left.load_order - right.load_order);
}

function chooseStreamingStatusBinding(bindings: ArtifactBinding[]): ArtifactBinding | undefined {
  return bindings.find(
    (binding) =>
      binding.artifact_role === "derived" &&
      binding.conversion_authority === "bim-streaming-server" &&
      ["converting", "failed", "blocked_conversion"].includes(binding.ready_status),
  );
}

function modelStatusFromBinding(binding: ArtifactBinding | undefined, readyUsdc: Artifact | undefined): StreamConfigResponse["model"]["status"] {
  if (!binding) return readyUsdc ? "ready" : "missing";
  if (binding.ready_status === "ready") return "ready";
  if (binding.ready_status === "converting") return "converting";
  if (binding.ready_status === "failed") return "failed";
  if (binding.ready_status === "blocked_conversion") return "blocked";
  return readyUsdc ? "ready" : "missing";
}

function isLoopbackHost(host: string | null | undefined): boolean {
  const normalized = (host || "").trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function streamConfigWithRuntimeOverride(
  stored: KitInstanceBinding["stream_config"] | undefined,
  config: CoordinatorConfig,
): KitInstanceBinding["stream_config"] {
  const signalingServer =
    stored?.signalingServer && !(isLoopbackHost(stored.signalingServer) && !isLoopbackHost(config.kitStreamServer))
      ? stored.signalingServer
      : config.kitStreamServer;
  const mediaServer =
    stored?.mediaServer && !(isLoopbackHost(stored.mediaServer) && !isLoopbackHost(config.kitMediaServer))
      ? stored.mediaServer
      : config.kitMediaServer;

  return {
    signalingServer,
    signalingPort: stored?.signalingPort || config.kitSignalingPort,
    mediaServer,
    mediaPort: stored?.mediaPort ?? config.kitMediaPort,
  };
}

function buildStreamConfig(session: ReviewSession, artifacts: Artifact[], config: CoordinatorConfig): StreamConfigResponse {
  const artifactBindings =
    session.artifact_bindings.length > 0
      ? session.artifact_bindings
      : buildArtifactBindings(session.model_version_id, artifacts, [], "same_instance");
  const readyBinding = chooseReadyBinding(artifactBindings);
  const statusBinding = readyBinding ?? chooseStreamingStatusBinding(artifactBindings);
  const readyUsdc = chooseReadyUsdc(artifacts);
  const kitInstanceBindings = session.kit_instance_bindings.map((binding) => ({
    ...binding,
    stream_config: streamConfigWithRuntimeOverride(binding.stream_config, config),
  }));
  const primaryKitBinding = kitInstanceBindings[0];
  const modelBinding = statusBinding;
  const loadableDerivedBindings = orderedLoadableDerivedBindings(artifactBindings);
  const primaryStageBinding = loadableDerivedBindings[0] ?? readyBinding ?? null;
  const secondaryStageBindings = loadableDerivedBindings.slice(1);
  return {
    session_id: session.session_id,
    lifecycle_status: session.status,
    source: "local_fixed",
    webrtc: {
      signalingServer: primaryKitBinding?.stream_config.signalingServer || config.kitStreamServer,
      signalingPort: primaryKitBinding?.stream_config.signalingPort || config.kitSignalingPort,
      mediaServer: primaryKitBinding?.stream_config.mediaServer || config.kitMediaServer,
      mediaPort: primaryKitBinding?.stream_config.mediaPort ?? config.kitMediaPort,
    },
    model: {
      status: modelStatusFromBinding(modelBinding, readyUsdc),
      artifact_id: modelBinding?.artifact_id || readyUsdc?.artifact_id || null,
      url: modelBinding?.url || readyUsdc?.url || null,
      mapping_url: modelBinding?.mapping_url || readyUsdc?.mapping_url || null,
      conversion_authority: modelBinding?.conversion_authority || readyUsdc?.conversion_authority || null,
      conversion_job_id: modelBinding?.conversion_job_id || readyUsdc?.conversion_job_id || null,
      conversion_status: modelBinding?.conversion_status || readyUsdc?.conversion_status || null,
      failure_code: modelBinding?.failure_code || readyUsdc?.failure_code || null,
      diagnostic: modelBinding?.diagnostic || readyUsdc?.diagnostic || null,
    },
    artifacts,
    artifact_bindings: artifactBindings,
    kit_instance_bindings: kitInstanceBindings,
    quality_metrics_summary: session.quality_metrics_summary ?? null,
    stage_composition: {
      applied_policy: "coordinator_load_order",
      primary_artifact_id: primaryStageBinding?.artifact_id || null,
      secondary_artifact_ids: secondaryStageBindings.map((binding) => binding.artifact_id),
      primary: primaryStageBinding,
      secondary_layers: secondaryStageBindings,
    },
    viewport_sharing: {
      mode: session.mode,
      primary_kit_instance_id: primaryKitBinding?.kit_instance_id || null,
      shared_state: session.mode === "single_kit_shared_state" || kitInstanceBindings.length <= 1,
      spectator_ready: kitInstanceBindings.some((binding) => binding.stream_config.signalingPort !== primaryKitBinding?.stream_config.signalingPort),
    },
  };
}
