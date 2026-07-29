import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import { createLogger } from "../src/lib/structLog.js";

let active: CoordinatorApp | null = null;
let activeRoot: string | null = null;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    await active.dispose();
    active = null;
  }
  if (activeRoot) {
    fs.rmSync(activeRoot, { recursive: true, force: true });
    activeRoot = null;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-lease-principal-"));
  activeRoot = root;
  const config = {
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
    logRoot: path.join(root, "logs"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    devAuthToken: "test-dev-auth-token",
    internalApiAuthToken: "test-internal-api-token",
    externalIntakeWebhookSecret: "test-external-webhook-secret",
    kitInstanceEndpoints: [
      {
        id: "kit_local_001",
        signalingServer: "127.0.0.1",
        signalingPort: 49100,
        mediaServer: "127.0.0.1",
        mediaPort: 47998,
      },
    ],
    ...overrides,
  };
  active = createCoordinatorApp(config, {
    structLog: createLogger("coordinator", {
      logRoot: config.logRoot,
      runId: "run_20260721_lease_principal",
      skipEnvSnapshot: true,
    }),
  });
  return active;
}

async function createSession(app: CoordinatorApp): Promise<string> {
  const created = await request(app.app)
    .post("/api/review-sessions")
    .send({
      project_id: "project_principal_test",
      model_version_id: "version_principal_test",
      created_by: "fixture_creator",
      artifact_bindings: [
        {
          artifact_group_id: "ag_principal_test",
          artifact_id: "artifact_principal_test",
          artifact_role: "derived",
          url: "http://127.0.0.1:49101/artifacts/principal/model.usdc",
          load_order: 0,
          ready_status: "ready",
        },
      ],
    });
  expect(created.status).toBe(200);
  return created.body.session_id as string;
}

function claimBody(userId: string) {
  return {
    viewer_id: "viewer_principal_test",
    user_id: userId,
    requested_role: "primary",
    client_nonce: "principal-test-nonce",
  };
}

function readTextFiles(root: string): string {
  const chunks: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(target);
      else chunks.push(fs.readFileSync(target, "utf8"));
    }
  };
  visit(root);
  return chunks.join("\n");
}

describe("viewer lease server principal", () => {
  it("authenticates before session lookup and does not disclose session existence", async () => {
    const app = makeApp();

    const response = await request(app.app)
      .post("/api/review-sessions/review_session_missing/viewer-leases/claim")
      .send(claimBody("lab-user"));

    expect(response.status).toBe(401);
  });

  it("requires user auth for claim even when the session exists", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);

    const response = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .send(claimBody("lab-user"));

    expect(response.status).toBe(401);
  });

  it("rejects a legacy body identity that differs from the authenticated carrier", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);

    const response = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "lab-user-a")
      .send(claimBody("lab-user-b"));

    expect(response.status).toBe(403);
  });

  it("fails production claim closed while the only provider is pending local-dev identity", async () => {
    process.env.NODE_ENV = "production";
    const app = makeApp();
    const sessionId = await createSession(app);

    const response = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "lab-production-user")
      .send(claimBody("lab-production-user"));

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ detail: "production_identity_unavailable" });
  });

  it("fails production heartbeat and release closed without mutating the existing lease", async () => {
    const carrier = "lab-production-mutation-user";
    const app = makeApp();
    const sessionId = await createSession(app);
    const claimed = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", carrier)
      .send(claimBody(carrier));
    expect(claimed.status).toBe(200);

    process.env.NODE_ENV = "production";
    const heartbeat = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/${claimed.body.lease_id}/heartbeat`)
      .set("X-Viewer-Lease-Token", claimed.body.lease_token)
      .send({ datachannel_ready: true });
    const released = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/${claimed.body.lease_id}/release`)
      .set("X-Viewer-Lease-Token", claimed.body.lease_token)
      .send({});

    expect(heartbeat.status).toBe(503);
    expect(heartbeat.body).toEqual({ detail: "production_identity_unavailable" });
    expect(released.status).toBe(503);
    expect(released.body).toEqual({ detail: "production_identity_unavailable" });
    const persistedText = readTextFiles(activeRoot!);
    expect(persistedText).not.toContain("viewerLeaseHeartbeat");
    expect(persistedText).not.toContain("viewerLeaseReleased");
  });

  it("never persists or returns raw local-dev carrier bytes across claim, status, and stage preauthorization", async () => {
    const sentinel = `lab-sentinel-${randomUUID()}`;
    const internalSentinel = `internal-sentinel-${randomUUID()}`;
    const app = makeApp({ internalApiAuthToken: internalSentinel });
    const sessionId = await createSession(app);
    const traceId = `rev_${sessionId}`;

    const response = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", sentinel)
      .send(claimBody(sentinel));

    expect(response.status).toBe(200);
    expect(response.body.user_id).toMatch(/^lab_[a-f0-9]{32}$/);
    expect(response.body.auth_scope).toBe("local_dev_lab");
    expect(JSON.stringify(response.body)).not.toContain(sentinel);

    const status = await request(app.app)
      .get(`/api/review-sessions/${sessionId}/viewer-leases/status`)
      .set("X-User-Token", sentinel);
    expect(status.status).toBe(200);
    expect(JSON.stringify(status.body)).not.toContain(sentinel);

    const pending = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/stage-binding`)
      .set("X-User-Token", sentinel)
      .set("X-Viewer-Lease-Token", response.body.lease_token)
      .send({
        source_client_id: response.body.lease_id,
        role: "primary",
        artifacts: [{
          artifact_id: "artifact_principal_test",
          role: "primary",
          load_order: 0,
        }],
      });
    expect(pending.status).toBe(200);
    expect(JSON.stringify(pending.body)).not.toContain(sentinel);

    const runtimeDecision = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set("X-Internal-Token", internalSentinel)
      .set("X-Viewer-Lease-Token", response.body.lease_token)
      .set("X-Trace-Id", traceId)
      .send({
        trace_id: traceId,
        source_client_id: response.body.lease_id,
        requested_event_type: "focusPrimRequest",
        request_id: "dynamic-redaction-check",
        command_context: { prim_path: "/World" },
      });
    expect(runtimeDecision.status).toBe(200);
    expect(runtimeDecision.body).toMatchObject({
      authorized: true,
      request_id: "dynamic-redaction-check",
      trace_id: traceId,
    });
    expect(JSON.stringify(runtimeDecision.body)).not.toContain(internalSentinel);
    expect(JSON.stringify(runtimeDecision.body)).not.toContain(response.body.lease_token);

    const persistedText = readTextFiles(activeRoot!);
    expect(persistedText).not.toContain(sentinel);
    expect(persistedText).not.toContain(response.body.lease_token);
    expect(persistedText).not.toContain(internalSentinel);
  });

  it("accepts a claim without legacy body identity and binds it to the authenticated principal", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);

    const response = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "header-only-lab-user")
      .send({
        viewer_id: "header_only_viewer",
        requested_role: "primary",
        client_nonce: "header-only-nonce",
      });

    expect(response.status).toBe(200);
    expect(response.body.user_id).toMatch(/^lab_[a-f0-9]{32}$/);
    expect(response.body.auth_scope).toBe("local_dev_lab");
  });

  it("does not replay or disclose another principal's lease for the same viewer and nonce", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const first = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "principal-a")
      .send({
        viewer_id: "shared_viewer",
        requested_role: "primary",
        client_nonce: "shared-nonce",
      });
    expect(first.status).toBe(200);

    const second = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "principal-b")
      .send({
        viewer_id: "shared_viewer",
        requested_role: "primary",
        client_nonce: "shared-nonce",
      });

    expect(second.status).toBe(409);
    expect(second.body).toEqual({ detail: "primary_already_claimed" });
    expect(JSON.stringify(second.body)).not.toContain(first.body.lease_id);
    expect(JSON.stringify(second.body)).not.toContain(first.body.lease_token);
  });

  it("authenticates lease status and only returns leases owned by the caller", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const primary = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "status-owner")
      .send({ viewer_id: "owner_viewer", requested_role: "primary", client_nonce: "owner-nonce" });
    const spectator = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "status-spectator")
      .send({ viewer_id: "spectator_viewer", requested_role: "spectator", client_nonce: "spectator-nonce" });
    expect(primary.status).toBe(200);
    expect(spectator.status).toBe(200);

    const missingAuth = await request(app.app)
      .get(`/api/review-sessions/${sessionId}/viewer-leases/status`);
    expect(missingAuth.status).toBe(401);

    const ownerStatus = await request(app.app)
      .get(`/api/review-sessions/${sessionId}/viewer-leases/status`)
      .set("X-User-Token", "status-owner");
    expect(ownerStatus.status).toBe(200);
    expect(ownerStatus.body.auth_scope).toBe("local_dev_lab");
    expect(ownerStatus.body.primary).toEqual({ available: false, owned_by_caller: true });
    expect(ownerStatus.body.leases).toHaveLength(1);
    expect(ownerStatus.body.leases[0].lease_id).toBe(primary.body.lease_id);
    expect(JSON.stringify(ownerStatus.body)).not.toContain(spectator.body.lease_id);
    expect(JSON.stringify(ownerStatus.body)).not.toContain(spectator.body.user_id);
  });
});
