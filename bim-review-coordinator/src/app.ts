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
import { AuthError, createAuthProvider } from "./services/authProvider.js";
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
    callback_url: z.string().nullish(),
  })
  .passthrough();

// B-scheme T5 §6.1：本地轉檔結果回報（coordinator 輪詢 streaming /result 或
// 內部 result loop 餵入），coordinator 據此組 metadata-only 雲端 callback 並
// 入 outbox。callback 投遞狀態與 conversion 成功分離。
const conversionResultReportSchema = z
  .object({
    correlation_id: z.string().min(1),
    conversion_job_id: z.string().min(1).nullish(),
    status: z.enum(["ready", "failed"]),
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

export interface CoordinatorApp {
  app: express.Express;
  server: http.Server;
  io: Server;
  config: CoordinatorConfig;
  store: SessionStore;
  eventLog: EventLog;
}

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
  const streamingConversionClient = new StreamingConversionClient(config.streamingConversionApiBase);
  // T5：轉檔結果回拋公司雲端（metadata-only outbox / retry / dead-letter）。
  const callbackOutbox = new CallbackOutbox(config.callbackOutboxMaxAttempts);

  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: "1mb" }));
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
      const event = ifcReadyPayloadSchema.parse(request.body);
      const headerMap: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        headerMap[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
      }
      const auth = authProvider.authenticate({
        clientIp: request.ip || request.socket.remoteAddress || "",
        headers: headerMap,
        rawBody: JSON.stringify(request.body ?? {}),
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

  // B-scheme T5：本地轉檔結果 → 組 metadata-only 雲端 callback 並入 outbox。
  // 內部端點（coordinator 自身輪詢/result loop 餵入）。callback 投遞狀態與
  // conversion 成功分離；conversion 在本地 ready 即可查，callback 由 outbox 追蹤。
  app.post("/api/internal/conversion-result", (request, response, next) => {
    try {
      const report = conversionResultReportSchema.parse(request.body);
      const job = externalIfcReadyStore.getByCorrelation(report.correlation_id);
      if (!job) {
        response.status(404).json({ detail: "No IFC-ready job for correlation_id." });
        return;
      }
      const conversionJobId = report.conversion_job_id || job.conversion_job_id || null;
      const targetUrl = job.callback_url || config.cloudCallbackBaseUrl || null;

      let payload: Record<string, unknown>;
      let event: "conversion_result_ready" | "conversion_failed";
      if (report.status === "ready") {
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
        report.status,
        entry.outbox_id,
        report.artifacts?.manifest_ref ?? null,
      );
      // conversion 在本地的成功/失敗，與 callback 投遞狀態（outbox）分離回報。
      response.status(202).json({ ifc_ready_job: updatedJob, callback: entry });
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

  app.post("/api/dev/conversions", async (request, response) => {
    await proxyConversionService(response, config.conversionApiBase, "POST", "/api/conversions", request.body);
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
      detail: "Worker API unavailable.",
      upstream: conversionApiBase,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
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

function buildStreamConfig(session: ReviewSession, artifacts: Artifact[], config: CoordinatorConfig): StreamConfigResponse {
  const artifactBindings =
    session.artifact_bindings.length > 0
      ? session.artifact_bindings
      : buildArtifactBindings(session.model_version_id, artifacts, [], "same_instance");
  const readyBinding = chooseReadyBinding(artifactBindings);
  const statusBinding = readyBinding ?? chooseStreamingStatusBinding(artifactBindings);
  const readyUsdc = chooseReadyUsdc(artifacts);
  const primaryKitBinding = session.kit_instance_bindings[0];
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
    kit_instance_bindings: session.kit_instance_bindings,
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
      shared_state: session.mode === "single_kit_shared_state" || session.kit_instance_bindings.length <= 1,
      spectator_ready: session.kit_instance_bindings.some((binding) => binding.stream_config.signalingPort !== primaryKitBinding?.stream_config.signalingPort),
    },
  };
}
