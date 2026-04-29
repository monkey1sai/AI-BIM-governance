import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { z } from "zod";
import type { CoordinatorConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { BimControlClient } from "./services/bimControlClient.js";
import { EventLog } from "./services/eventLog.js";
import { allocateLocalKitInstance } from "./services/kitPool.js";
import { SessionStore } from "./services/sessionStore.js";
import { registerReviewNamespace } from "./socket/reviewNamespace.js";
import type { Artifact, StreamConfigResponse } from "./types.js";

const createSessionSchema = z.object({
  project_id: z.string().min(1),
  model_version_id: z.string().min(1),
  source_artifact_id: z.string().min(1).optional(),
  usdc_artifact_id: z.string().min(1).optional(),
  created_by: z.string().min(1).default("dev_user_001"),
  mode: z.string().min(1).default("single_kit_shared_state"),
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
      const session = store.create({
        project_id: input.project_id,
        model_version_id: input.model_version_id,
        source_artifact_id: input.source_artifact_id,
        usdc_artifact_id: input.usdc_artifact_id || readyUsdc?.artifact_id,
        created_by: input.created_by,
        mode: input.mode,
        kit_instance: allocateLocalKitInstance(config),
      });
      eventLog.append(session.session_id, "sessionCreated", {
        project_id: session.project_id,
        model_version_id: session.model_version_id,
      });
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/review-sessions/:sessionId", (request, response) => {
    const session = store.get(request.params.sessionId);
    if (!session) {
      response.status(404).json({ detail: "Review session not found." });
      return;
    }
    response.json(session);
  });

  app.post("/api/review-sessions/:sessionId/join", (request, response, next) => {
    try {
      const input = participantSchema.parse(request.body);
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
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      const artifacts = await safeArtifacts(bimControlClient, session.model_version_id);
      response.json(buildStreamConfig(session.session_id, artifacts, config));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/review-sessions/:sessionId/events", (request, response) => {
    response.json({ items: eventLog.list(request.params.sessionId) });
  });

  app.post("/api/review-sessions/:sessionId/events", (request, response) => {
    const event = eventLog.append(request.params.sessionId, String(request.body?.type || "custom"), request.body);
    response.json(event);
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

function chooseReadyUsdc(artifacts: Artifact[]): Artifact | undefined {
  return artifacts.find((artifact) => artifact.artifact_type === "usdc" && artifact.status === "ready" && artifact.url);
}

function buildStreamConfig(sessionId: string, artifacts: Artifact[], config: CoordinatorConfig): StreamConfigResponse {
  const readyUsdc = chooseReadyUsdc(artifacts);
  return {
    session_id: sessionId,
    source: "local_fixed",
    webrtc: {
      signalingServer: config.kitStreamServer,
      signalingPort: config.kitSignalingPort,
      mediaServer: config.kitMediaServer,
    },
    model: {
      status: readyUsdc ? "ready" : "missing",
      artifact_id: readyUsdc?.artifact_id || null,
      url: readyUsdc?.url || null,
      mapping_url: readyUsdc?.mapping_url || null,
    },
    artifacts,
  };
}
