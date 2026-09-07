import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";

// Synthetic HTTP contract fixture only: these tests do not claim Kit/GPU evidence.
const id = "mw_0123456789abcdef";
const job = "stream_conv_fixture";
const route = `/api/conversion/records/${id}/review-session`;
let root: string;
let upstream: http.Server | undefined;
let active: CoordinatorApp | undefined;
let reads = 0;
let healthy = true;
let wrongIdentity = false;
// Root trace the fixture authority echoes back; the watcher-ingest test rebinds it to the real ifc-ready job id.
let traceId = "ifcready_fixture";

async function stopApp() {
  if (!active) return;
  await active.dispose();
  active.io.close();
  await new Promise<void>(resolve => active!.server.close(() => resolve()));
  active = undefined;
}
afterEach(async () => {
  await stopApp();
  if (upstream) await new Promise<void>(resolve => upstream!.close(() => resolve()));
  upstream = undefined;
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(overrides: Partial<CoordinatorConfig> = {}) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ready-model-session-"));
  reads = 0; healthy = true; wrongIdentity = false; traceId = "ifcready_fixture";
  let origin = "";
  upstream = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
      res.statusCode = 202; res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ conversion_job_id: job, status: "queued", authority: "bim-streaming-server", correlation_id: "minio-watch-test" }));
    } else if (req.url === `/api/conversions/${job}/result`) {
      reads++;
      const model = `${origin}/artifacts/${job}/model.usdc`;
      const mapping = `${origin}/artifacts/${job}/element_mapping.json`;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        conversion_job_id: job, authority: "bim-streaming-server", ready: true, status: "succeeded",
        tenant_id: wrongIdentity ? "other" : "tenant-test", project_id: "project-test", model_version_id: "v1",
        correlation_id: "minio-watch-test", trace_id: traceId, usdc_url: model, mapping_url: mapping,
        model: { status: "ready", format: "usdc", url: model },
        artifacts: { model_usdc: { url: model, checksum_sha256: "a".repeat(64) },
          element_mapping: { url: mapping, checksum_sha256: "b".repeat(64) } },
        quality_metrics: { coverage_status: "pass", semantic_mapping_fidelity: "guid_exact", mapping_has_ifc_type: true },
      }));
    } else if (req.url?.startsWith(`/artifacts/${job}/`)) {
      res.statusCode = healthy ? 200 : 404;
      res.end();
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(resolve => upstream!.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  origin = `http://127.0.0.1:${address.port}`;
  const ledgerPath = path.join(root, "ledger.json");
  const ledger = new ConversionLedger(ledgerPath);
  ledger.upsert({ idempotency_key: id, correlation_id: "minio-watch-test", project_id: "project-test",
    project_display_name: "test", category: "architecture", external_model_version_id: "v1",
    conversion_job_id: job, status: "ready" }, "2026-01-01T00:00:00Z");
  const config: Partial<CoordinatorConfig> = {
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "outbox.json"), conversionLedgerStorePath: ledgerPath,
    minioWatchEnabled: false, minioWatchTenantId: "tenant-test", conversionPollEnabled: false,
    streamingConversionApiBase: origin, streamingConversionPublicArtifactsUrl: `${origin}/artifacts`,
    externalIntakeIpAllowlist: ["127.0.0.1", "::1"],
    kitInstanceEndpoints: [{ id: "kit_fixture", signalingServer: "127.0.0.1", signalingPort: 49100,
      mediaServer: "127.0.0.1", mediaPort: 47998 }], ...overrides,
  };
  active = createCoordinatorApp(config);
  return { app: active, config };
}

describe("ready model session consumption", () => {
  it("creates and reuses a session with an empty volatile intake, including after restart", async () => {
    const { app, config } = await fixture();
    expect((await request(app.app).get("/api/external/ifc-ready")).body.count).toBe(0);
    const responses = await Promise.all([request(app.app).post(route).send({}), request(app.app).post(route).send({})]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const sessionId = responses[0].body.review_session_id;
    expect(responses[1].body.review_session_id).toBe(sessionId);
    expect(app.store.list()).toHaveLength(1);
    expect(reads).toBe(1);
    expect(app.store.get(sessionId)).toMatchObject({ ready_model_id: id, trace_id: "ifcready_fixture", status: "active" });
    const publicLedger = await request(app.app).get("/api/conversion/records");
    expect(publicLedger.body.items[0]).not.toHaveProperty("ready_render_bundle");
    await stopApp();
    active = createCoordinatorApp(config);
    const replay = await request(active.app).post(route).send({});
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ review_session_id: sessionId, session_replay: true });
    expect(reads).toBe(1);
    expect((await request(active.app).get("/api/external/ifc-ready")).body.count).toBe(0);
  });
  it("never reactivates a closed session", async () => {
    const { app } = await fixture();
    const first = await request(app.app).post(route).send({});
    expect(first.status).toBe(200);
    app.store.setStatus(first.body.review_session_id, "closed");
    const next = await request(app.app).post(route).send({});
    expect(next.status).toBe(200);
    expect(next.body.review_session_id).not.toBe(first.body.review_session_id);
    expect(app.store.get(first.body.review_session_id)?.status).toBe("closed");
    expect(app.store.get(next.body.review_session_id)?.recreated_from_session_id).toBe(first.body.review_session_id);
    // #809：recreation 走 cached descriptor（reads 仍為 1），quality summary 必須跟著 descriptor 回來。
    expect(reads).toBe(1);
    expect(app.store.get(next.body.review_session_id)?.quality_metrics_summary).toMatchObject({
      coverage_status: "pass", semantic_mapping_fidelity: "guid_exact", mapping_has_ifc_type: true });
  });
  it("reuses the session the watcher terminal-ingestion path already created for the same ready model", async () => {
    const { app } = await fixture();
    const intake = await request(app.app).post("/api/external/ifc-ready")
      .set({ "X-Webhook-Secret": "dev-webhook-secret", "X-Correlation-Id": "minio-watch-test", "X-Idempotency-Key": id })
      .send({ event: "ifc_ready", event_id: "evt_809", tenant_id: "tenant-test", project_id: "project-test",
        external_model_version_id: "v1", project_display_name: "test", model_category: "architecture",
        external_conversion_task_id: "task_809",
        source_ifc: { ref: "minio://bucket/tenant-test/project-test/v1/model.ifc", etag: `sha256:${"0".repeat(64)}`, filename: "model.ifc", format: "ifc" },
        requested_outputs: ["usdc", "element_mapping"], callback_url: "https://cloud.example/callbacks" });
    expect(intake.status).toBe(202);
    traceId = intake.body.ifc_ready_job_id;
    const ingest = await request(app.app).post(`/api/internal/conversions/${job}/ingest`)
      .set({ "X-Internal-Token": "dev-internal-token" }).send({});
    expect(ingest.status).toBe(202);
    const autoSessionId = ingest.body.session?.session_id as string;
    expect(autoSessionId).toMatch(/^review_session_/);
    expect(app.store.get(autoSessionId)).toMatchObject({ ready_model_id: id, status: "active" });
    const viaRoute = await request(app.app).post(route).send({});
    expect(viaRoute.status).toBe(200);
    expect(viaRoute.body).toMatchObject({ review_session_id: autoSessionId, session_replay: true });
    expect(app.store.list()).toHaveLength(1);
  });
  it("backfills a missing quality summary when the ready-record route reuses the watcher session", async () => {
    const { app } = await fixture();
    const intake = await request(app.app).post("/api/external/ifc-ready")
      .set({ "X-Webhook-Secret": "dev-webhook-secret", "X-Correlation-Id": "minio-watch-test", "X-Idempotency-Key": id })
      .send({ event: "ifc_ready", event_id: "evt_810", tenant_id: "tenant-test", project_id: "project-test",
        external_model_version_id: "v1", project_display_name: "test", model_category: "architecture",
        external_conversion_task_id: "task_810",
        source_ifc: { ref: "minio://bucket/tenant-test/project-test/v1/model.ifc", etag: `sha256:${"0".repeat(64)}`, filename: "model.ifc", format: "ifc" },
        requested_outputs: ["usdc", "element_mapping"], callback_url: "https://cloud.example/callbacks" });
    expect(intake.status).toBe(202);
    traceId = intake.body.ifc_ready_job_id;
    const ingest = await request(app.app).post(`/api/internal/conversions/${job}/ingest`)
      .set({ "X-Internal-Token": "dev-internal-token" }).send({});
    expect(ingest.status).toBe(202);
    const autoSessionId = ingest.body.session.session_id as string;
    // 模擬建立當下沒有 quality summary 的 terminal notification（report 不帶 quality_metrics）。
    app.store.update(autoSessionId, { quality_metrics_summary: null });
    const viaRoute = await request(app.app).post(route).send({});
    expect(viaRoute.body).toMatchObject({ review_session_id: autoSessionId, session_replay: true });
    expect(app.store.get(autoSessionId)?.quality_metrics_summary).toMatchObject({ coverage_status: "pass", semantic_mapping_fidelity: "guid_exact" });
    const sc = await request(app.app).get(`/api/review-sessions/${autoSessionId}/stream-config`);
    expect(sc.body.quality_metrics_summary).toMatchObject({ coverage_status: "pass" });
  });
  it("does not stamp a ready_model_id on non-watcher intake sessions", async () => {
    const { app } = await fixture();
    const intake = await request(app.app).post("/api/external/ifc-ready")
      .set({ "X-Webhook-Secret": "dev-webhook-secret", "X-Correlation-Id": "minio-watch-test", "X-Idempotency-Key": "idem_external_809" })
      .send({ event: "ifc_ready", event_id: "evt_809b", tenant_id: "tenant-test", project_id: "project-test",
        external_model_version_id: "v1", project_display_name: "test", model_category: "architecture",
        external_conversion_task_id: "task_809b",
        source_ifc: { ref: "minio://bucket/tenant-test/project-test/v1/model.ifc", etag: `sha256:${"0".repeat(64)}`, filename: "model.ifc", format: "ifc" },
        requested_outputs: ["usdc", "element_mapping"], callback_url: "https://cloud.example/callbacks" });
    expect(intake.status).toBe(202);
    traceId = intake.body.ifc_ready_job_id;
    const ingest = await request(app.app).post(`/api/internal/conversions/${job}/ingest`)
      .set({ "X-Internal-Token": "dev-internal-token" }).send({});
    expect(ingest.status).toBe(202);
    expect(app.store.get(ingest.body.session.session_id)?.ready_model_id).toBeUndefined();
  });
  it("replacing a closed session emits the paired recreation lineage events", async () => {
    const { app } = await fixture();
    const first = await request(app.app).post(route).send({});
    expect(first.status).toBe(200);
    app.store.setStatus(first.body.review_session_id, "closed");
    const next = await request(app.app).post(route).send({});
    expect(next.status).toBe(200);
    expect(next.body.review_session_id).not.toBe(first.body.review_session_id);
    const sourceEvents = await request(app.app).get(`/api/review-sessions/${first.body.review_session_id}/events`);
    expect(sourceEvents.body.items.filter((event: { type: string }) => event.type === "sessionRecreated")).toHaveLength(1);
    const targetEvents = await request(app.app).get(`/api/review-sessions/${next.body.review_session_id}/events`);
    const created = targetEvents.body.items.filter((event: { type: string }) => event.type === "sessionCreated");
    expect(created).toHaveLength(1);
    expect(created[0].payload).toMatchObject({ recreated_from_session_id: first.body.review_session_id });
    // recreation 的 sessionActive 只由 ensureRecreationEvents 發一次，不再被 auto-create 尾端重複 append。
    expect(targetEvents.body.items.filter((event: { type: string }) => event.type === "sessionActive")).toHaveLength(1);
  });
  it("refuses to replace a session that is still closing", async () => {
    const { app } = await fixture();
    const first = await request(app.app).post(route).send({});
    expect(first.status).toBe(200);
    app.store.setStatus(first.body.review_session_id, "closing");
    const next = await request(app.app).post(route).send({});
    expect(next.status).toBe(409);
    expect(next.body.error_code).toBe("ready_model_session_closing");
    expect(app.store.list()).toHaveLength(1);
  });
  it("rejects unauthorized callers before upstream I/O", async () => {
    const { app } = await fixture({ externalIntakeIpAllowlist: ["10.0.0.0/8"], devAuthToken: "dev-token" });
    expect((await request(app.app).post(route).send({})).status).toBe(403);
    expect(reads).toBe(0);
    expect(app.store.list()).toHaveLength(0);
  });
  it("explicit recreation preserves the ready-model identity for subsequent reuse", async () => {
    const { app } = await fixture();
    const first = await request(app.app).post(route).send({});
    expect(first.status).toBe(200);
    app.store.setStatus(first.body.review_session_id, "closed");
    const recreated = await request(app.app)
      .post(`/api/review-sessions/${first.body.review_session_id}/recreate`)
      .set("Idempotency-Key", "ready-model-recreate-fixture").send({});
    expect(recreated.status).toBe(201);
    expect(app.store.get(recreated.body.session_id)).toMatchObject({ ready_model_id: id, trace_id: "ifcready_fixture" });
    const replay = await request(app.app).post(route).send({});
    expect(replay.status).toBe(200);
    expect(replay.body.review_session_id).toBe(recreated.body.session_id);
    expect(app.store.list()).toHaveLength(2);
  });
  it("rejects browser-supplied paths and identity", async () => {
    const { app } = await fixture();
    expect((await request(app.app).post(route).send({ model_url: "http://other.invalid/model", tenant_id: "other" })).status).toBe(400);
    expect(reads).toBe(0);
  });
  it.each(["identity", "artifact"])("%s failure cannot create a session", async failure => {
    const { app } = await fixture();
    wrongIdentity = failure === "identity";
    healthy = failure !== "artifact";
    expect((await request(app.app).post(route).send({})).status).toBe(409);
    expect(app.store.list()).toHaveLength(0);
  });
});
