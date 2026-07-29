import fs from "node:fs";
import http from "node:http";
import { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// B-scheme（local-coordinator-ifc-ready-intake-boundary T7 §8.1-8.3）。
// 使用者 auth 用可替換 provider；不做死 EZPLUS SSO，sso_binding=pending_oq5（OQ5）。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const IFC_CONTRACT = JSON.parse(
  fs.readFileSync(path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "ifc_ready_payload.json"), "utf-8"),
) as { example: Record<string, unknown> };

let active: CoordinatorApp | null = null;
const activeServers: http.Server[] = [];

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
  for (const server of activeServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-lwv-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    ...overrides,
  });
  return active;
}

function svcAuth(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Webhook-Secret": "dev-webhook-secret",
    "X-Correlation-Id": "corr_lwv_001",
    "X-Idempotency-Key": "idem_lwv_001",
    ...overrides,
  };
}

function internalHeaders(): Record<string, string> {
  return { "X-Internal-Token": "dev-internal-token" };
}

async function startMissingArtifactServer(): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "artifact not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function seedJob(
  app: CoordinatorApp,
  headers: Record<string, string> = svcAuth(),
): Promise<{ jobId: string; emv: string }> {
  const res = await request(app.app)
    .post("/api/external/ifc-ready")
    .set(headers)
    .send({ ...structuredClone(IFC_CONTRACT.example) });
  expect(res.status).toBe(202);
  return { jobId: res.body.ifc_ready_job_id, emv: res.body.external_model_version_id };
}

describe("T7 local web view session / artifact resolution", () => {
  it("allows the configured alternate viewer origin for viewer-log CORS only", async () => {
    const app = makeApp({
      coordinatorPublicBaseUrl: "http://127.0.0.1:8005",
      viewerPublicBaseUrl: "http://127.0.0.1:5175",
    });

    const allowed = await request(app.app)
      .options("/api/internal/viewer-log")
      .set("Origin", "http://127.0.0.1:5175")
      .set("Access-Control-Request-Method", "POST");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5175");

    const rejected = await request(app.app)
      .options("/api/internal/viewer-log")
      .set("Origin", "https://untrusted.example")
      .set("Access-Control-Request-Method", "POST");
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("resolves one server-owned standalone trace and rejects conflicting carriers before redirect", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_trace_redirect",
        model_version_id: "version_trace_redirect",
        created_by: "trace_redirect_fixture",
        artifact_bindings: [],
      });
    expect(created.status).toBe(200);
    const session = created.body.session_id as string;
    const standaloneTrace = created.body.trace_id as string;

    const missing = await request(app.app).get(`/ui/open?session=${session}`);
    expect(missing.status).toBe(302);
    expect(new URL(missing.headers.location).searchParams.get("trace_id")).toBe(standaloneTrace);

    const exact = await request(app.app).get(
      `/ui/open?session=${session}&trace_id=${standaloneTrace}`,
    );
    expect(exact.status).toBe(302);
    expect(new URL(exact.headers.location).searchParams.get("trace_id")).toBe(standaloneTrace);

    for (const conflictingTrace of [
      "rev_review_session_other",
      "ifcready_20260724120000_deadbeef",
      "ifcready_bad.value",
      "ifcready_ifcready_nested",
      "external_untrusted",
    ]) {
      const conflicting = await request(app.app).get(
        `/ui/open?session=${session}&trace_id=${encodeURIComponent(conflictingTrace)}`,
      );
      expect(conflicting.status).toBe(409);
      expect(conflicting.body).toEqual({ detail: "session trace authority mismatch" });
      expect(conflicting.headers.location).toBeUndefined();
    }

    const duplicate = await request(app.app).get(
      `/ui/open?session=${session}&trace_id=${standaloneTrace}&trace_id=${standaloneTrace}`,
    );
    expect(duplicate.status).toBe(400);
    expect(duplicate.body).toEqual({ detail: "invalid session trace carrier" });
    expect(duplicate.headers.location).toBeUndefined();
  });

  it("缺使用者 token → 401（不做死 SSO，可替換 provider）", async () => {
    const app = makeApp();
    const { jobId } = await seedJob(app);
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .send({ ifc_ready_job_id: jobId });
    expect(res.status).toBe(401);
  });

  it("帶 user token + ifc_ready_job_id → 201，sso_binding=pending_oq5、含 artifact_resolution", async () => {
    const app = makeApp();
    const { jobId, emv } = await seedJob(app);
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ Authorization: "Bearer dev_user_001" })
      .send({ ifc_ready_job_id: jobId });

    expect(res.status).toBe(201);
    expect(res.body.web_view_session_id).toMatch(/^lwv_/);
    expect(res.body.user_id).toMatch(/^lab_[a-f0-9]{32}$/);
    expect(JSON.stringify(res.body)).not.toContain("dev_user_001");
    expect(res.body.auth_provider).toBe("local-dev");
    expect(res.body.sso_binding).toBe("pending_oq5");
    expect(res.body.external_model_version_id).toBe(emv);
    expect(res.body.artifact_resolution.source_ifc_ref).toBe(
      (IFC_CONTRACT.example.source_ifc as { ref: string }).ref,
    );
    expect(res.body.artifact_resolution.conversion_artifact_ready).toBe(false);
    expect(res.body.artifact_resolution.viewer_open_state).toBe("not_observed");
    expect(res.body.artifact_resolution.viewer_open_ready).toBe(false);
  });

  it("stream-config refreshes derived artifact health and exposes model/mapping stale state", async () => {
    const base = await startMissingArtifactServer();
    const app = makeApp({ streamingConversionApiBase: base });
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        artifact_bindings: [
          {
            artifact_group_id: "ag_version_demo_001",
            artifact_id: "auto_usdc_stream_missing_artifacts",
            artifact_role: "derived",
            url: `${base}/artifacts/missing/model.usdc`,
            mapping_url: `${base}/artifacts/missing/element_mapping.json`,
            load_order: 0,
            ready_status: "ready",
            conversion_authority: "bim-streaming-server",
            conversion_job_id: "stream_missing_artifacts",
            conversion_status: "ready",
          },
        ],
      });
    expect(created.status).toBe(200);

    const config = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);

    expect(config.status).toBe(200);
    expect(config.body.model.status).toBe("ready");
    expect(config.body.artifact_health).toMatchObject({
      source_ifc_exists: null,
      model_usdc_reachable: false,
      mapping_reachable: false,
      stale_reason: "derived_artifact_unreachable",
      source: "edge_health_probe",
    });
    expect(config.body.artifact_health.failure_details).toMatchObject({
      model_usdc: "http_404",
      mapping: "http_404",
    });
    expect(JSON.stringify(config.body.artifact_health)).not.toMatch(/local_path|host_local_path|edge_relative_path|public_url/);

    const runtime = await request(app.app).get("/api/runtime/status");
    const runtimeSession = runtime.body.sessions.items.find(
      (item: { session_id: string }) => item.session_id === created.body.session_id,
    );
    expect(runtime.status).toBe(200);
    expect(runtimeSession.artifact_health).toMatchObject({
      model_usdc_reachable: false,
      mapping_reachable: false,
      stale_reason: "derived_artifact_unreachable",
    });
  });

  it("stream-config does not actively probe direct session URLs outside the configured conversion origin", async () => {
    const base = await startMissingArtifactServer();
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        artifact_bindings: [
          {
            artifact_group_id: "ag_version_demo_001",
            artifact_id: "auto_usdc_stream_untrusted_origin",
            artifact_role: "derived",
            url: `${base}/artifacts/missing/model.usdc`,
            mapping_url: `${base}/artifacts/missing/element_mapping.json`,
            load_order: 0,
            ready_status: "ready",
            conversion_authority: "bim-streaming-server",
            conversion_job_id: "stream_untrusted_origin",
            conversion_status: "ready",
          },
        ],
      });
    expect(created.status).toBe(200);

    const config = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);

    expect(config.status).toBe(200);
    expect(config.body.model.status).toBe("ready");
    expect(config.body.artifact_health).toBeNull();
  });

  it("以 external_model_version_id 解析；轉檔 ready 後只標 conversion_artifact_ready，不標 viewer_open_ready", async () => {
    const app = makeApp();
    const { emv } = await seedJob(app);
    await request(app.app).post("/api/internal/conversion-result").set(internalHeaders()).send({
      correlation_id: "corr_lwv_001",
      conversion_job_id: "cj_lwv_001",
      status: "ready",
      artifacts: { manifest_ref: "edge-local://m.json" },
    });
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ "X-User-Token": "dev_user_002" })
      .send({ external_model_version_id: emv });

    expect(res.status).toBe(201);
    expect(res.body.user_id).toMatch(/^lab_[a-f0-9]{32}$/);
    expect(JSON.stringify(res.body)).not.toContain("dev_user_002");
    expect(res.body.artifact_resolution.conversion_status).toBe("ready");
    expect(res.body.artifact_resolution.conversion_artifact_ready).toBe(true);
    expect(res.body.artifact_resolution.viewer_open_state).toBe("not_observed");
    expect(res.body.artifact_resolution.viewer_open_ready).toBe(false);
    expect(res.body.artifact_resolution.artifact_manifest_ref).toBe("edge-local://m.json");
  });

  it("以 external_model_version_id 解析時選最新 job", async () => {
    const app = makeApp();
    const first = await seedJob(app, svcAuth({ "X-Correlation-Id": "corr_lwv_old", "X-Idempotency-Key": "idem_lwv_old" }));
    const second = await seedJob(app, svcAuth({ "X-Correlation-Id": "corr_lwv_new", "X-Idempotency-Key": "idem_lwv_new" }));
    expect(first.emv).toBe(second.emv);
    await request(app.app).post("/api/internal/conversion-result").set(internalHeaders()).send({
      correlation_id: "corr_lwv_new",
      conversion_job_id: "cj_lwv_new",
      status: "ready",
      artifacts: { manifest_ref: "edge-local://new.json" },
    });

    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ "X-User-Token": "dev_user_latest" })
      .send({ external_model_version_id: second.emv });

    expect(res.status).toBe(201);
    expect(res.body.ifc_ready_job_id).toBe(second.jobId);
    expect(res.body.artifact_resolution.artifact_manifest_ref).toBe("edge-local://new.json");
  });

  it("缺 ifc_ready_job_id 與 external_model_version_id → 400", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ Authorization: "Bearer u" })
      .send({});
    expect(res.status).toBe(400);
  });

  it("無對應 job → 404", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ Authorization: "Bearer u" })
      .send({ ifc_ready_job_id: "ifcready_nope" });
    expect(res.status).toBe(404);
  });
});
