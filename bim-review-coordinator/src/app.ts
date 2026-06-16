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
import { AuthError, createAuthProvider, createUserAuthProvider, isIpAllowed } from "./services/authProvider.js";
import { CallbackOutbox, MetadataOnlyViolation } from "./services/callbackOutbox.js";
import { EventLog } from "./services/eventLog.js";
import {
  createLogger,
  persistRecordsToServicePaths,
  validateLogRecordBasic,
  type LogRecord,
  type StructLogger,
} from "./lib/structLog.js";
import { ExternalIfcReadyStore } from "./services/externalIfcReadyStore.js";
import { startMinioWatcher, type MinioWatcherHandle, type MinioWatcherStatus } from "./services/minioWatcher.js";
import { ConversionDispatchQueue } from "./services/conversionDispatchQueue.js";
import { downloadIfcToSharedVolume } from "./services/ifcDownloader.js";
import { registerGovernanceProxy } from "./routes/governanceProxy.js";
import {
  StreamingConversionClient,
  buildQualityMetricsSummary,
  isTerminalConversionResult,
  type PollerHandle,
  type StreamingConversionResult,
} from "./services/streamingConversionClient.js";
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

// m2a-coverage-report:conversion job id safe-id（比照後端 _safe_id 的 ^[A-Za-z0-9_.-]+$）。
// 不可複用 isSafeSessionId —— 其 pattern 只認 ^review_session_,擋掉 stream_conv_*。
const conversionJobIdPattern = /^[A-Za-z0-9_.-]+$/;
export function isSafeConversionJobId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && conversionJobIdPattern.test(value);
}

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
  structLog: StructLogger;
  // coordinator-auto-poll-streaming-conversion §6:cancel 全部 in-process auto-poll
  // timer。process shutdown / 測試 teardown 必呼叫,避免 timer keep-alive 阻 exit。
  // async（回 Promise）:minioWatcher.dispose() 需 await 其 in-flight tick settle 後才
  // 銷毀 S3 client（避免 unhandled rejection）;shutdown.ts 已 await，fire-and-forget 的
  // 測試 teardown 仍因 watcher 內部 promise 鏈得到保護。
  dispose: () => Promise<void>;
}

export interface CreateCoordinatorAppOptions {
  /**
   * Pre-built structured logger. Tests use this to write into a tmp dir and
   * assert on records. Omit to let the app build one against $LOG_ROOT or the
   * default `./logs`. Whether or not the default logger emits an env_snapshot
   * is controlled by NODE_ENV (suppressed under `test`).
   */
  structLog?: StructLogger;
}

type RawBodyRequest = express.Request & { rawBody?: string };

export function createCoordinatorApp(
  overrides: Partial<CoordinatorConfig> = {},
  options: CreateCoordinatorAppOptions = {},
): CoordinatorApp {
  const config = loadConfig(overrides);
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: config.corsOrigins,
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
  const eventLog = new EventLog(config.eventLogDir, { structLog });
  // B-scheme（local-coordinator-ifc-ready-intake-boundary T3）：對外 IFC-ready intake。
  const authProvider = createAuthProvider(config);
  const externalIfcReadyStore = new ExternalIfcReadyStore();
  const streamingConversionClient = new StreamingConversionClient(
    config.streamingConversionApiBase,
    undefined,
    config.streamingConversionInternalToken || undefined,
  );
  const startedAt = Date.now();
  // minio-watch-auto-intake（O4 B 案，env opt-in 預設關）。watcher 自打 loopback
  // POST /api/external/ifc-ready，既有 intake/去重/dispatch 鏈零變動。selfBase 預設
  // http://127.0.0.1:${實際 listen port}；測試以 config.minioWatchSelfBaseUrl 注入。
  let minioWatcher: MinioWatcherHandle | null = null;
  function startMinioWatcherIfEnabled(): void {
    // 不變式：本函式 idempotent。兩條啟動路徑（下方 "listening" 事件、以及 selfBaseUrl
    // 已設時的立即啟動）共用 `minioWatcher` 這一個 guard 防重複啟動。即使兩條同時成立
    // ——minioWatchEnabled=true && selfBaseUrl 已設 && 呼叫端又 listen()——也安全：
    // 立即路徑會先把 minioWatcher 設好，listen callback 是非同步（Node 事件迴圈），
    // "listening" 事件到達時 minioWatcher != null，此 guard 直接 return，不會啟第二個。
    if (!config.minioWatchEnabled || minioWatcher) return;
    // minio-watch review P2 修復：watcher 的 loopback self-POST 同樣經過
    // /api/external/ifc-ready 的 IP allowlist（authProvider 在 secret 之前先檢查 IP）。
    // 硬化部署把 EXTERNAL_INTAKE_IP_ALLOWLIST 鎖成 edge CIDR 而漏掉 loopback 時，
    // watcher 每輪 intake 都 403（列得到物件、永遠建不了 job）。127.0.0.1 與 ::1
    // 雙雙不在 allowlist ⇒ 必然永久失敗 → 啟動 fail-fast（與 selfBaseUrl loopback
    // assert 同精神），不靜默空轉。重用 authProvider 的 isIpAllowed 避免判定分歧。
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
    const address = server.address();
    const boundPort =
      address && typeof address !== "string" ? address.port : config.port;
    const selfBaseUrl = config.minioWatchSelfBaseUrl || `http://127.0.0.1:${boundPort}`;
    minioWatcher = startMinioWatcher({
      endpoint: config.minioWatchEndpoint,
      bucket: config.minioWatchBucket,
      prefix: config.minioWatchPrefix,
      accessKey: config.minioWatchAccessKey,
      secretKey: config.minioWatchSecretKey,
      keySuffix: config.minioWatchKeySuffix,
      intervalSeconds: config.minioWatchIntervalSeconds,
      selfBaseUrl,
      webhookSecret: config.externalIntakeWebhookSecret,
      tenantId: config.minioWatchTenantId,
      structLog,
    });
  }
  // 已在 listen 上的 server（生產 index.ts / E2E）：listening 後啟動以取得實際 port。
  server.on("listening", () => startMinioWatcherIfEnabled());
  // supertest 整合測試不呼叫 listen；用 selfBaseUrl override 時可立即啟動。
  if (config.minioWatchEnabled && config.minioWatchSelfBaseUrl) {
    startMinioWatcherIfEnabled();
  }
  // coordinator-auto-poll-streaming-conversion §6:in-process auto-poll registry
  // (keyed by conversion_job_id),dispatch 後 schedule、manual ingest endpoint
  // 觸發前 cancel、shutdown(dispose())清空。
  const pollerRegistry = new Map<string, PollerHandle>();
  // coordinator-serial-conversion-dispatch-queue:序列化對 streaming-server 的
  // dispatch。downloaded 後 enqueue;單一 in-flight slot;失敗不卡後續。
  const conversionDispatchQueue = new ConversionDispatchQueue();
  // pendingDispatchEvents:enqueue 階段暫存 dispatch 所需 args,worker 取出用。
  // jobId → { event, correlationId, externalModelVersionId, localPath, hostLocalPath }
  const pendingDispatchEvents = new Map<
    string,
    {
      event: ExternalIfcReadyEvent;
      correlationId: string;
      externalModelVersionId: string;
      localPath: string;
      hostLocalPath: string;
    }
  >();
  // dispatcher closure 用 streamingConversionClient / externalIfcReadyStore /
  // pollerRegistry / schedulePollerForConversion(hoisted)。注意 enqueue 必須
  // 在 setDispatcher 之後才能正確處理 worker。
  conversionDispatchQueue.setDispatcher(async (jobId) => {
    const pending = pendingDispatchEvents.get(jobId);
    pendingDispatchEvents.delete(jobId);
    if (!pending) {
      externalIfcReadyStore.markDispatchFailed(
        jobId,
        "pending dispatch event lost before worker pickup",
      );
      return;
    }
    try {
      const dispatch = await streamingConversionClient.createConversionJob(pending.event, {
        correlationId: pending.correlationId,
        externalModelVersionId: pending.externalModelVersionId,
        localPath: pending.localPath,
        hostLocalPath: pending.hostLocalPath,
      });
      externalIfcReadyStore.markDispatched(
        jobId,
        dispatch.conversion_job_id,
        dispatch.status,
      );
      if (config.conversionPollEnabled && !pollerRegistry.has(dispatch.conversion_job_id)) {
        schedulePollerForConversion(dispatch.conversion_job_id);
      }
    } catch (dispatchError) {
      externalIfcReadyStore.markDispatchFailed(
        jobId,
        dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
      );
    }
  });
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
  mountDevConsole(app, config);

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "bim-review-coordinator",
      kit_signaling_port: config.kitSignalingPort,
    });
  });

  app.get("/api/runtime/status", (_request, response) => {
    response.json(buildRuntimeStatus({
      config,
      startedAt,
      sessions: store.list(),
      ifcReadyJobs: externalIfcReadyStore.list(),
    }));
  });

  app.post("/api/review-sessions", async (request, response, next) => {
    try {
      const input = createSessionSchema.parse(request.body);
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

  app.get("/api/review-sessions/:sessionId/stream-config", (request, response) => {
    if (!isSafeSessionId(request.params.sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    const session = store.get(request.params.sessionId);
    if (!session) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    response.json(buildStreamConfig(session, [], config));
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
      response.status(code).json({ detail: `Conversion authority unreachable: ${msg}` });
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

  // CH-C：Stage / Artifact Binding 後端角色權威（source_client_id / primary）。非 UI-only gate：
  // 變更型 binding 交易必須由 session 的 primary client 發起，否則 403（spectator / 非 primary / 非持有者一律拒絕）。
  // 每 session 僅一個 primary（first-wins，以 source_client_id 綁定）；記錄 active / last-good binding revision（交易）。
  // 邊界：Kit DataChannel select/focus/compose 的 source_client_id 強制屬 bim-streaming-server（host GPU runtime），
  // 此 coordinator 端權威為 binding 交易的後端授權邊界；Kit 端 per-message 強制標 GPU-pending（見 docs §11）。
  const stageBindingAuthority = new Map<string, { primaryClientId: string; revisions: string[] }>();
  app.post("/api/review-sessions/:sessionId/stage-binding", (request, response) => {
    if (!isSafeSessionId(request.params.sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    const session = store.get(request.params.sessionId);
    if (!session) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const sourceClientId = typeof body.source_client_id === "string" ? body.source_client_id.trim() : "";
    const role = typeof body.role === "string" ? body.role : "";
    const bindingRevisionId = typeof body.binding_revision_id === "string" ? body.binding_revision_id.trim() : "";
    const primaryArtifactId = typeof body.primary_artifact_id === "string" ? body.primary_artifact_id.trim() : "";
    if (!sourceClientId) {
      response.status(400).json({ detail: "source_client_id required" });
      return;
    }
    if (role !== "primary") {
      // 後端拒絕（非 UI-only）：spectator / 非 primary 不得套用 binding。
      response.status(403).json({ detail: "stage binding requires primary role authority", role: role || null });
      return;
    }
    const reg = stageBindingAuthority.get(session.session_id);
    if (reg && reg.primaryClientId !== sourceClientId) {
      response.status(403).json({ detail: "another client holds primary authority for this session", primary_client_id: reg.primaryClientId });
      return;
    }
    if (!primaryArtifactId) {
      response.status(400).json({ detail: "binding transaction requires exactly one primary_artifact_id" });
      return;
    }
    if (!bindingRevisionId) {
      response.status(400).json({ detail: "binding_revision_id required" });
      return;
    }
    const current = reg ?? { primaryClientId: sourceClientId, revisions: [] };
    const lastGood = current.revisions.length > 0 ? current.revisions[current.revisions.length - 1] : null;
    current.revisions.push(bindingRevisionId);
    stageBindingAuthority.set(session.session_id, current);
    eventLog.append(session.session_id, "stageBindingApplied", {
      binding_revision_id: bindingRevisionId,
      primary_artifact_id: primaryArtifactId,
      source_client_id: sourceClientId,
    });
    response.json({
      status: "applied",
      session_id: session.session_id,
      active_binding_revision: bindingRevisionId,
      last_good_binding_revision: lastGood,
      primary_client_id: sourceClientId,
      primary_artifact_id: primaryArtifactId,
    });
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
        // fast-ifc-link-demo-loop §2.6:idempotent replay 直接 200 reuse,不重下載也不重派工
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

      // fast-ifc-link-demo-loop §2.3:同步下載 IFC → shared volume,完成才 dispatch + 200。
      // 失敗 → 502,job 標 download_status:"failed",**不** dispatch streaming-server。
      externalIfcReadyStore.markDownloading(job.ifc_ready_job_id);
      const downloadResult = await downloadIfcToSharedVolume(event.source_ifc.ref, job.ifc_ready_job_id, {
        storageRoot: config.storageRoot,
        storageHostRoot: config.storageHostRoot,
        timeoutMs: config.ifcDownloadTimeoutSeconds * 1000,
        fallbackOnFetchError: !config.ifcDownloadStrict,
      });
      if (!downloadResult.ok) {
        externalIfcReadyStore.markDownloadFailed(job.ifc_ready_job_id, `${downloadResult.reason}: ${downloadResult.message}`);
        response.status(502).json({
          detail: "IFC download failed",
          ifc_ready_job_id: job.ifc_ready_job_id,
          error: downloadResult.message,
          reason: downloadResult.reason,
          download_status: "failed",
        });
        return;
      }
      externalIfcReadyStore.markDownloaded(job.ifc_ready_job_id, downloadResult.local_path, downloadResult.host_local_path);

      // coordinator-serial-conversion-dispatch-queue:downloaded 後不直接同步
      // dispatch,改 enqueue 進 in-memory FIFO。worker 單一 in-flight slot
      // 序列化呼叫 streaming-server,避免並發踩到同一 GPU/Kit pipeline。
      // 失敗或成功都由 dispatcher closure 直接 mark 進 store,worker 不卡。
      // INVARIANT: pendingDispatchEvents.set() MUST 同步先於 enqueue(),兩行之間嚴禁插入 await — Node 單執行緒下確保 worker 取用前 map 已就緒,否則引入真 race
      pendingDispatchEvents.set(job.ifc_ready_job_id, {
        event,
        correlationId: auth.correlationId,
        externalModelVersionId: auth.externalModelVersionId,
        localPath: downloadResult.local_path,
        hostLocalPath: downloadResult.host_local_path,
      });
      conversionDispatchQueue.enqueue(job.ifc_ready_job_id);
      // Review feedback(HIGH #1):queue_position 必須在 enqueue 之後讀,因為
      // worker 可能 sync 啟動把 job 立即推進 in-flight(此時 queue 內沒這個
      // jobId,getQueuePosition 回 0)。原本 enqueue 前計算 length+1 會在
      // single-job 場景錯誤標 queue_position=1,而 queue 內已沒這個 job。
      const queuePosition = conversionDispatchQueue.getQueuePosition(job.ifc_ready_job_id);
      externalIfcReadyStore.markQueuedForConversion(
        job.ifc_ready_job_id,
        queuePosition ?? 0,
      );

      // fast-ifc-link-demo-loop §2.3:同步下載完成 → 202 Accepted(下載完,
      // dispatch 改為 in-memory queue 序列化,viewer / dashboard 可 poll status
      // 觀察 queued_for_conversion → dispatched 變化)。
      const finalJob = externalIfcReadyStore.get(job.ifc_ready_job_id);
      response.status(202).json({
        ...finalJob,
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
      items: jobs.slice(0, limit).map((job) => summarizeIfcReadyJob(job, store.get(job.review_session_id || ""))),
    });
  });

  // minio-watch-auto-intake：watcher 唯讀狀態（無 credentials 洩漏）。關閉時誠實
  // 回 enabled=false（env opt-in）。last_triggered 只含 key，不含 presigned URL。
  // 置於 /:jobId param route 之前，確保此靜態路徑優先匹配。
  app.get("/api/external/minio-watch/status", (_request, response) => {
    if (!config.minioWatchEnabled) {
      response.json({
        enabled: false,
        bucket: config.minioWatchBucket || null,
        prefix: config.minioWatchPrefix || null,
        interval_seconds: config.minioWatchIntervalSeconds,
        note: "未啟用（env MINIO_WATCH_ENABLED opt-in）",
      });
      return;
    }
    const status: MinioWatcherStatus | { enabled: true; note: string } = minioWatcher
      ? minioWatcher.getStatus()
      : { enabled: true, note: "watcher enabled but not yet started (server not listening)" };
    response.json(status);
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

  // Internal API auth boundary (cross-service-structured-log-baseline).
  // The two paths below are an intentional, narrowly-scoped allowlist; every
  // other `/api/internal/*` route still requires a valid internal token:
  //   - `/viewer-log`     : log ingest must never drop records because of an
  //                         auth failure — data-plane availability for the log
  //                         pipeline takes priority over gating writes.
  //   - `/structLog/health`: a liveness/probe surface for monitoring; health
  //                         checks must stay reachable without credentials.
  // These endpoints are reached via the 127.0.0.1 binding, so the open paths
  // are not exposed beyond the local host.
  const STRUCT_LOG_UNAUTH_PATHS = new Set(["/viewer-log", "/structLog/health"]); // Intentionally unauth — see justification above

  app.use("/api/internal", (request, response, next) => {
    if (STRUCT_LOG_UNAUTH_PATHS.has(request.path)) {
      next();
      return;
    }
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
      // result 萃取的 quality summary(含 C1 三個 semantic 欄位)由 caller
      // (ingestStreamingConversionResult)透過 ingestConversionReport 傳入。
      // null 時與舊邏輯等價,backward compatible。
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

  // coordinator-auto-poll-streaming-conversion §4.1:把 manual endpoint 與 auto-poll
  // 共用的「fetch result → terminal 判定 → ingest」chain 抽成 helper。`result` 可選傳入
  // (auto-poll 已有 fetch 結果可直接給,manual endpoint 走 fetchConversionResult)。
  type StreamingResultIngestSuccess = Extract<ConversionIngestOutcome, { ok: true }>;
  type StreamingResultIngestOutcome =
    | { ok: true; outcome: StreamingResultIngestSuccess; conversion_status: "ready" | "failed"; failed: boolean }
    | { ok: false; status: number; detail: string; conversion_job_id?: string; conversion_status?: string };

  async function ingestStreamingConversionResult(
    conversionJobId: string,
    options: { result?: StreamingConversionResult; source: "manual" | "auto-poll" } = { source: "manual" },
  ): Promise<StreamingResultIngestOutcome> {
    const result = options.result ?? (await streamingConversionClient.fetchConversionResult(conversionJobId));
    const correlationId = result.correlation_id;
    if (!correlationId) {
      return { ok: false, status: 422, detail: "streaming conversion result has no correlation_id" };
    }
    const { terminal, failed } = isTerminalConversionResult(result);
    if (!terminal) {
      return {
        ok: false,
        status: 409,
        detail: "conversion result is not terminal yet",
        conversion_job_id: conversionJobId,
        conversion_status: result.model_status ?? result.status ?? "unknown",
      };
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
    // coordinator-forward-quality-metrics-summary:把 result 內 quality_metrics
    // 萃取成 summary 並透過 ingestConversionReport 帶進 autoCreateOrActivateSession,
    // 寫入 session.quality_metrics_summary,讓 viewer / `/ui` Semantic ready 有資料。
    const qualitySummary = buildQualityMetricsSummary(result);
    const outcome = ingestConversionReport(report, qualitySummary);
    if (!outcome.ok) {
      return { ok: false, status: outcome.status, detail: outcome.detail };
    }
    return { ok: true, outcome, conversion_status: failed ? "failed" : "ready", failed };
  }

  function schedulePollerForConversion(conversionJobId: string): void {
    const handle = streamingConversionClient.pollConversionResult(conversionJobId, {
      intervalMs: config.conversionPollIntervalSeconds * 1000,
      maxAttempts: config.conversionPollMaxAttempts,
      onTerminal: async (result) => {
        try {
          await ingestStreamingConversionResult(conversionJobId, { result, source: "auto-poll" });
        } catch (err) {
          structLog.withTraceId(`stream_conv_${conversionJobId}`).anomaly(
            "autoPoll",
            "auto-poll ingest failed",
            {
              anomaly_kind: "unexpected_state",
              reason: err instanceof Error ? err.message : String(err),
              conversion_job_id: conversionJobId,
            },
          );
        } finally {
          pollerRegistry.delete(conversionJobId);
        }
      },
      onError: (err, attempt) => {
        structLog.withTraceId(`stream_conv_${conversionJobId}`).anomaly(
          "autoPoll",
          "auto-poll fetch error",
          {
            anomaly_kind: "retry",
            reason: err instanceof Error ? err.message : String(err),
            conversion_job_id: conversionJobId,
            attempt,
          },
        );
      },
    });
    pollerRegistry.set(conversionJobId, handle);
  }

  function ingestConversionReport(
    report: z.infer<typeof conversionResultReportSchema>,
    qualitySummary: ConversionQualityMetricsSummary | null = null,
  ): ConversionIngestOutcome {
    const normalizedStatus = normalizeConversionReportStatus(report.status);
    // conversion-artifact-id-sanitize（PR #206 review P2）：correlation collision 時
    // 以 report.conversion_job_id 消歧，避免 unsafe job 的結果套到同字串 job 上。
    const job = externalIfcReadyStore.getByCorrelation(report.correlation_id, report.conversion_job_id ?? null);
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
        qualitySummary,
      );
      if (result.session) {
        session = result.session;
        session_replay = result.replay;
        // fast-ifc-link-demo-loop §3.2 + LAN handoff:轉檔 ready + session
        // 建好後,寫入 coordinator /ui/open URL。實際 viewer redirect 由
        // trusted VIEWER_PUBLIC_BASE_URL / PUBLIC_HOST 組合,避免 LAN client 被導到
        // 自己的 loopback。
        // 用 review session_id 當 web_view_session_id(fast MVP 簡化:不再分兩種 session)。
        const viewerUrl = buildCoordinatorOpenUrl(config, session.session_id);
        externalIfcReadyStore.setViewerLink(job.ifc_ready_job_id, session.session_id, viewerUrl);
      } else {
        session_reason = result.reason;
      }
    }

    return { ok: true, ifc_ready_job: externalIfcReadyStore.get(job.ifc_ready_job_id) ?? updatedJob, callback: entry, session, session_replay, session_reason };
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
      // m2a-coverage-report:即便 `/api/internal/*` 已過 internal-token，仍須跑
      // isSafeConversionJobId 守門，避免未驗證字串流入 pollerRegistry / ingest，
      // 與既有新路由維持一致的安全面（helper 存在即應在此 internal route 共用）。
      if (!isSafeConversionJobId(conversionJobId)) {
        response.status(400).json({ detail: "Invalid conversion job id." });
        return;
      }
      // coordinator-auto-poll-streaming-conversion §4.4:manual endpoint 觸發前 cancel
      // 對應 auto-poller,避免後續 onTerminal 觸發第二次 ingest(double callback)。
      const existing = pollerRegistry.get(conversionJobId);
      if (existing) {
        existing.cancel();
        pollerRegistry.delete(conversionJobId);
      }
      const outcome = await ingestStreamingConversionResult(conversionJobId, { source: "manual" });
      if (!outcome.ok) {
        const body: Record<string, unknown> = { detail: outcome.detail };
        if (outcome.conversion_job_id) body.conversion_job_id = outcome.conversion_job_id;
        if (outcome.conversion_status) body.conversion_status = outcome.conversion_status;
        response.status(outcome.status).json(body);
        return;
      }
      response.status(202).json({
        ifc_ready_job: outcome.outcome.ifc_ready_job,
        callback: outcome.outcome.callback,
        conversion_status: outcome.conversion_status,
        session: outcome.outcome.session,
        session_replay: outcome.outcome.session_replay,
        session_reason: outcome.outcome.session_reason ?? null,
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

  // ---------------------------------------------------------------------------
  // Structured log baseline endpoints (capability:
  // cross-service-structured-log-baseline). LOCAL-DEV-ONLY: these intentionally
  // do NOT require auth — they rely on the coordinator binding to 127.0.0.1.
  // Production hardening (token, IP allow-list) is a future change.
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
        viewerLogIntakeStats.records_received += body.length;
        const validated: LogRecord[] = [];
        let droppedThisBatch = 0;
        for (const candidate of body) {
          const result = validateLogRecordBasic(candidate);
          if (result.valid) {
            validated.push(result.record);
          } else {
            droppedThisBatch += 1;
            viewerLogIntakeStats.last_drop_reason = result.reason;
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
  registerGovernanceProxy(app, {
    isSafeSessionId,
    resolveRuleRunSessionContext: (sessionId) => {
      const session = store.get(sessionId);
      if (!session) {
        return { ok: false, reason: "Review session not found." };
      }
      // session → ifc-ready job：conversion-ready auto-session 時由
      // recordReviewSession 寫入 job.review_session_id 反向參照（app.ts ~905）。
      const job = externalIfcReadyStore
        .list()
        .filter((candidate) => candidate.review_session_id === sessionId)
        .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0];
      if (!job) {
        return {
          ok: false,
          reason:
            "No IFC-ready job linked to this session; rule-run requires an IFC ingested via /api/external/ifc-ready.",
        };
      }
      // host_local_path = governance-service host 視角可讀的絕對路徑（markDownloaded
      // 於同步下載完成時寫入，app.ts ~674）。container 視角 local_path 作為 fallback。
      const ifcSourcePath = job.host_local_path || job.local_path || null;
      if (!ifcSourcePath) {
        return {
          ok: false,
          reason: "IFC for this session has not been downloaded to a server-side path yet.",
        };
      }
      return {
        ok: true,
        context: {
          ifc_source_path: ifcSourcePath,
          model_version_id: session.model_version_id,
          ifc_ready_job_id: job.ifc_ready_job_id,
        },
      };
    },
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

  registerReviewNamespace(io, store, eventLog);

  // coordinator-auto-poll-streaming-conversion §6:dispose 清空所有 in-process auto
  // poller timer。process shutdown / 測試 teardown 必呼叫,避免 keep-alive 阻 exit。
  // coordinator-serial-conversion-dispatch-queue:dispose 同時 drain 未派工的
  // queue,把 jobs 標記 dropped_on_restart(in-memory queue 非 disk-persistent;
  // restart 後 operator 必須重新 POST,跟 spec scenario「Coordinator restart
  // drops queued jobs」對齊)。
  const dispose = async (): Promise<void> => {
    for (const handle of pollerRegistry.values()) {
      handle.cancel();
    }
    pollerRegistry.clear();
    if (minioWatcher) {
      // await：讓 in-flight tick settle 後再銷毀 S3 client（避免 unhandled rejection）。
      const w = minioWatcher;
      minioWatcher = null;
      await w.dispose();
    }
    const droppedJobIds = conversionDispatchQueue.drain();
    for (const jobId of droppedJobIds) {
      externalIfcReadyStore.markDroppedOnRestart(jobId);
      pendingDispatchEvents.delete(jobId);
    }
  };

  return { app, server, io, config, store, eventLog, structLog, dispose };
}

interface RuntimeStatusInput {
  config: CoordinatorConfig;
  startedAt: number;
  sessions: ReviewSession[];
  ifcReadyJobs: IfcReadyIntakeJob[];
}

function buildRuntimeStatus(input: RuntimeStatusInput): Record<string, unknown> {
  const activeSessions = input.sessions.filter((session) => session.status === "active");
  const participantCount = input.sessions.reduce((total, session) => total + session.participants.length, 0);
  return {
    service: {
      status: "ok",
      name: "bim-review-coordinator",
      uptime_seconds: Math.max(0, Math.floor((Date.now() - input.startedAt) / 1000)),
      generated_at: new Date().toISOString(),
    },
    configured_endpoints: {
      coordinator: {
        host: input.config.host,
        port: input.config.port,
        public_host: input.config.publicHost,
        public_base_url: input.config.coordinatorPublicBaseUrl,
      },
      viewer: {
        browser_url_base: input.config.viewerPublicBaseUrl,
        handoff_path: "/ui/open?session=<review_session_id>",
        coordinator_api_base: input.config.coordinatorPublicBaseUrl,
        coordinator_socket_url: input.config.coordinatorPublicBaseUrl,
      },
      conversion_authority: {
        base_url: input.config.streamingConversionApiBase,
        authority: "bim-streaming-server",
      },
      kit: input.config.kitInstanceEndpoints.map((endpoint) => ({
        id: endpoint.id,
        signalingServer: endpoint.signalingServer,
        signalingPort: endpoint.signalingPort,
        mediaServer: endpoint.mediaServer,
        mediaPort: endpoint.mediaPort,
      })),
    },
    sessions: {
      count: input.sessions.length,
      active_count: activeSessions.length,
      participant_count: participantCount,
      items: input.sessions.map(summarizeSessionForRuntime),
    },
    kit_instance_bindings: input.sessions.flatMap((session) =>
      session.kit_instance_bindings.map((binding) => ({
        session_id: session.session_id,
        kit_instance_id: binding.kit_instance_id,
        status: binding.status,
        assigned_artifact_ids: binding.assigned_artifact_ids,
        stream_config: binding.stream_config,
        started_at: binding.started_at,
        last_heartbeat_at: binding.last_heartbeat_at,
        released_at: binding.released_at,
      })),
    ),
    ifc_ready_jobs: {
      count: input.ifcReadyJobs.length,
      recent: input.ifcReadyJobs
        .slice()
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
        .slice(0, 10)
        .map((job) => summarizeIfcReadyJob(job, input.sessions.find((session) => session.session_id === job.review_session_id) ?? null)),
    },
    observations: {
      classification: "coordinator_visible_runtime_summary",
      note: "read-only coordinator observations; Kit internal stage state still requires DataChannel or Kit log evidence.",
      web_plane: {
        coordinator_port: input.config.port,
        viewer_port: 5173,
      },
      host_native_plane: {
        conversion_api_base: input.config.streamingConversionApiBase,
        kit_signal_ports: input.config.kitInstanceEndpoints.map((endpoint) => endpoint.signalingPort),
        kit_media_ports: input.config.kitInstanceEndpoints.map((endpoint) => endpoint.mediaPort).filter((port) => port !== null),
      },
    },
  };
}

function summarizeSessionForRuntime(session: ReviewSession): Record<string, unknown> {
  const expectedStage = expectedStageBinding(session);
  return {
    session_id: session.session_id,
    status: session.status,
    project_id: session.project_id,
    model_version_id: session.model_version_id,
    participant_count: session.participants.length,
    participants: session.participants.map((participant) => ({
      user_id: participant.user_id,
      display_name: participant.display_name ?? null,
      last_seen_at: participant.last_seen_at,
    })),
    expected_stage_url: expectedStage?.url ?? null,
    expected_mapping_url: expectedStage?.mapping_url ?? null,
    conversion_job_id: expectedStage?.conversion_job_id ?? null,
    conversion_status: expectedStage?.conversion_status ?? null,
    kit_instance_ids: session.kit_instance_bindings.map((binding) => binding.kit_instance_id),
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

function summarizeIfcReadyJob(job: IfcReadyIntakeJob, session: ReviewSession | null): Record<string, unknown> {
  const expectedStage = session ? expectedStageBinding(session) : null;
  return {
    ifc_ready_job_id: job.ifc_ready_job_id,
    status: job.status,
    tenant_id: job.tenant_id,
    project_id: job.project_id,
    external_model_version_id: job.external_model_version_id,
    external_conversion_task_id: job.external_conversion_task_id ?? null,
    correlation_id: job.correlation_id,
    source_ifc_ref: job.source_ifc_ref,
    source_ifc_etag: job.source_ifc_etag,
    download_status: job.download_status ?? null,
    download_failure: job.download_failure ?? null,
    local_path: job.local_path ?? null,
    host_local_path: job.host_local_path ?? null,
    conversion_job_id: job.conversion_job_id,
    conversion_status: job.conversion_status,
    conversion_authority: job.conversion_authority,
    dispatch_error: job.dispatch_error ?? null,
    callback_outbox_id: job.callback_outbox_id ?? null,
    artifact_manifest_ref: job.artifact_manifest_ref ?? null,
    review_session_id: job.review_session_id ?? null,
    web_view_session_id: job.web_view_session_id ?? null,
    viewer_url: job.viewer_url ?? null,
    expected_stage_url: expectedStage?.url ?? null,
    expected_mapping_url: expectedStage?.mapping_url ?? null,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function expectedStageBinding(session: ReviewSession): ArtifactBinding | null {
  return session.artifact_bindings
    .filter((binding) => binding.artifact_role === "derived" && binding.ready_status === "ready" && Boolean(binding.url))
    .slice()
    .sort((left, right) => left.load_order - right.load_order)[0] ?? null;
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

function mountDevConsole(app: express.Express, config: CoordinatorConfig): void {
  const publicDir = resolvePublicDir();
  app.use("/dev-console-assets", express.static(publicDir));

  // CH-E:設定 CONSOLE_DIST_DIR 且該目錄含 index.html → /ui 服務 React UnifiedConsole;
  // 否則(未設定 / 目錄不存在)回退既有 dev-console.html(zero-risk 預設,不影響既有部署)。
  const consoleDist =
    config.consoleDistDir && fs.existsSync(path.join(config.consoleDistDir, "index.html"))
      ? config.consoleDistDir
      : null;

  // CH-E/CH-G(RK6 CRITICAL):/ui/console(301→/ui)與 /ui/open(302 handoff)必須在任何 /ui static /
  // SPA fallback「之前」註冊為精確路徑;嚴禁讓 /ui/* 萬用吞掉凍結的 /ui/open handoff。
  app.get("/ui/console", (_request, response) => {
    response.redirect(301, "/ui");
  });

  // fast-ifc-link-demo-loop §3.4 + LAN handoff:server-side redirect to
  // browser-visible viewer URL。session id 驗證
  // `^(lwv_|review_session_)[A-Za-z0-9_]+$`(支援 lwv_ + review_session_ 兩種 prefix
  // 因為 fast MVP 簡化用 review session id 當 viewer attach key)。
  app.get("/ui/open", (request, response) => {
    const sessionRaw = request.query.session;
    const session = typeof sessionRaw === "string" ? sessionRaw : "";
    if (!/^(lwv_|review_session_)[A-Za-z0-9_]+$/.test(session)) {
      response.status(400).json({ detail: "invalid session id" });
      return;
    }
    response.redirect(302, buildViewerRedirectUrl(config, session, request.query));
  });

  if (consoleDist) {
    // /dev-console 仍保留 vanilla 後援面板(精確路徑,不影響 /ui)。
    app.get("/dev-console", (_request, response) => {
      response.sendFile(path.join(publicDir, "dev-console.html"));
    });
    // React console 靜態:assets 於 /ui/assets/*(vite base=/ui/)。index:false → 目錄請求不自動回 index,
    // 一律落到下方 SPA fallback(行為可預期);redirect:false → 不為缺斜線發 301。只服務真實檔案。
    app.use("/ui", express.static(consoleDist, { index: false, redirect: false }));
    // SPA fallback:/ui 與未命中靜態的 /ui/*(hash 路由 / 重新整理)皆回 index.html。
    // /ui/console、/ui/open 已於上方先行攔截,不落入此 fallback。
    app.get(["/ui", "/ui/*"], (_request, response) => {
      response.sendFile(path.join(consoleDist, "index.html"));
    });
  } else {
    // 未設定 CONSOLE_DIST_DIR:既有 zero-risk 行為,/ui 與 /dev-console 皆服務 vanilla dev-console.html。
    app.get(["/ui", "/dev-console"], (_request, response) => {
      response.sendFile(path.join(publicDir, "dev-console.html"));
    });
  }
}

function buildCoordinatorOpenUrl(config: CoordinatorConfig, session: string): string {
  const url = new URL("ui/open", `${config.coordinatorPublicBaseUrl}/`);
  url.searchParams.set("session", session);
  return url.toString();
}

const VIEWER_REDIRECT_QUERY_PARAMS = [
  "projectId",
  "modelVersionId",
  "userId",
  "displayName",
  "streamRole",
  "kitInstanceId",
  "kit_instance_id",
] as const;

function queryParamString(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed ? trimmed : null;
}

function buildViewerRedirectUrl(config: CoordinatorConfig, session: string, forwardedQuery: Record<string, unknown> = {}): string {
  const url = new URL("", `${config.viewerPublicBaseUrl}/`);
  url.searchParams.set("session", session);
  url.searchParams.set("coordinatorApiBase", config.coordinatorPublicBaseUrl);
  url.searchParams.set("coordinatorSocketUrl", config.coordinatorPublicBaseUrl);
  for (const param of VIEWER_REDIRECT_QUERY_PARAMS) {
    const value = queryParamString(forwardedQuery[param]);
    if (value) url.searchParams.set(param, value);
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

function sameStreamEndpoint(
  left: KitInstanceBinding["stream_config"],
  right: KitInstanceBinding["stream_config"],
): boolean {
  return left.signalingServer === right.signalingServer
    && left.signalingPort === right.signalingPort
    && left.mediaServer === right.mediaServer
    && (left.mediaPort ?? null) === (right.mediaPort ?? null);
}

function runtimeKitInstanceBindings(session: ReviewSession, config: CoordinatorConfig): KitInstanceBinding[] {
  const persisted = session.kit_instance_bindings.map((binding) => ({
    ...binding,
    stream_config: streamConfigWithRuntimeOverride(binding.stream_config, config),
  }));
  const primaryBinding = persisted[0];
  if (!primaryBinding || session.mode !== "single_kit_shared_state") {
    return persisted;
  }

  const existingEndpoints = new Set(persisted.map((binding) => {
    const stream = binding.stream_config;
    return `${stream.signalingServer}:${stream.signalingPort}:${stream.mediaServer}:${stream.mediaPort ?? ""}`;
  }));
  const spectatorEndpoints = config.kitInstanceEndpoints
    .filter((endpoint) => endpoint.id !== primaryBinding.kit_instance_id)
    .map((endpoint) => ({
      id: endpoint.id,
      stream_config: streamConfigWithRuntimeOverride({
        signalingServer: endpoint.signalingServer,
        signalingPort: endpoint.signalingPort,
        mediaServer: endpoint.mediaServer,
        mediaPort: endpoint.mediaPort,
      }, config),
    }))
    .filter((endpoint) => !sameStreamEndpoint(endpoint.stream_config, primaryBinding.stream_config))
    .filter((endpoint) => {
      const stream = endpoint.stream_config;
      const key = `${stream.signalingServer}:${stream.signalingPort}:${stream.mediaServer}:${stream.mediaPort ?? ""}`;
      if (existingEndpoints.has(key)) return false;
      existingEndpoints.add(key);
      return true;
    });

  return [
    ...persisted,
    ...spectatorEndpoints.map((endpoint, index) => ({
      ...primaryBinding,
      kit_instance_id: endpoint.id,
      stream_config: endpoint.stream_config,
      gpu_profile: {
        profile: primaryBinding.gpu_profile.profile,
        capacity_slot: `same-kit-spectator-${index + 1}`,
      },
    })),
  ];
}

function buildStreamConfig(session: ReviewSession, artifacts: Artifact[], config: CoordinatorConfig): StreamConfigResponse {
  const artifactBindings =
    session.artifact_bindings.length > 0
      ? session.artifact_bindings
      : buildArtifactBindings(session.model_version_id, artifacts, [], "same_instance");
  const readyBinding = chooseReadyBinding(artifactBindings);
  const statusBinding = readyBinding ?? chooseStreamingStatusBinding(artifactBindings);
  const readyUsdc = chooseReadyUsdc(artifacts);
  const kitInstanceBindings = runtimeKitInstanceBindings(session, config);
  const primaryKitBinding = kitInstanceBindings[0];
  const spectatorReady = primaryKitBinding
    ? kitInstanceBindings.some((binding) => !sameStreamEndpoint(binding.stream_config, primaryKitBinding.stream_config))
    : false;
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
      spectator_ready: spectatorReady,
    },
  };
}
