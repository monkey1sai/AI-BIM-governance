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
import { BimControlClient } from "./services/bimControlClient.js";
import { EventLog } from "./services/eventLog.js";
import {
  allocateKitInstanceBindings,
  allocateLocalKitInstance,
  legacyKitInstanceFromBinding,
  markKitBindingsDraining,
  releaseKitBindings,
} from "./services/kitPool.js";
import { isSafeSessionId, isSessionMutable, SessionStore } from "./services/sessionStore.js";
import { registerReviewNamespace } from "./socket/reviewNamespace.js";
import type { Artifact, ArtifactBinding, ReviewSession, RoutingPolicy, StreamConfigResponse } from "./types.js";

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
          ready_status: z.enum(["ready", "missing_model", "missing_mapping", "blocked_conversion"]).default("ready"),
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
      }));
  }

  return artifacts
    .filter((artifact) => artifact.status === "ready" && artifact.url)
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
      ready_status: artifact.artifact_type === "usdc" && !artifact.mapping_url ? "missing_mapping" : "ready",
    }));
}

function chooseReadyBinding(bindings: ArtifactBinding[]): ArtifactBinding | undefined {
  return bindings.find((binding) => binding.artifact_role === "derived" && binding.ready_status === "ready" && binding.url);
}

function buildStreamConfig(session: ReviewSession, artifacts: Artifact[], config: CoordinatorConfig): StreamConfigResponse {
  const artifactBindings =
    session.artifact_bindings.length > 0
      ? session.artifact_bindings
      : buildArtifactBindings(session.model_version_id, artifacts, [], "same_instance");
  const readyBinding = chooseReadyBinding(artifactBindings);
  const readyUsdc = chooseReadyUsdc(artifacts);
  const primaryKitBinding = session.kit_instance_bindings[0];
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
      status: readyBinding || readyUsdc ? "ready" : "missing",
      artifact_id: readyBinding?.artifact_id || readyUsdc?.artifact_id || null,
      url: readyBinding?.url || readyUsdc?.url || null,
      mapping_url: readyBinding?.mapping_url || readyUsdc?.mapping_url || null,
    },
    artifacts,
    artifact_bindings: artifactBindings,
    kit_instance_bindings: session.kit_instance_bindings,
  };
}
