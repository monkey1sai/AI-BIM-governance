import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import * as kitPool from "../src/services/kitPool.js";
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
let modelChecksum = "a".repeat(64);
let wrongIdentity = false;
// Root trace the fixture authority echoes back; the watcher-ingest test rebinds it to the real ifc-ready job id.
let traceId = "ifcready_fixture";
// #809 第 6 項：讓 authority 結果改發 internal-only origin 的 artifact URL。
let foreignArtifacts = false;

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
  vi.restoreAllMocks();
});

async function fixture(overrides: Partial<CoordinatorConfig> = {}) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ready-model-session-"));
  modelChecksum = "a".repeat(64);
  reads = 0; healthy = true; wrongIdentity = false; traceId = "ifcready_fixture"; foreignArtifacts = false;
  let origin = "";
  upstream = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
      res.statusCode = 202; res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ conversion_job_id: job, status: "queued", authority: "bim-streaming-server", correlation_id: "minio-watch-test" }));
    } else if (req.url === `/api/conversions/${job}/result`) {
      reads++;
      const publisher = foreignArtifacts ? "http://host.docker.internal:49101" : origin;
      const model = `${publisher}/artifacts/${job}/model.usdc`;
      const mapping = `${publisher}/artifacts/${job}/element_mapping.json`;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        conversion_job_id: job, authority: "bim-streaming-server", ready: true, status: "succeeded",
        tenant_id: wrongIdentity ? "other" : "tenant-test", project_id: "project-test", model_version_id: "v1",
        correlation_id: "minio-watch-test", trace_id: traceId, usdc_url: model, mapping_url: mapping,
        model: { status: "ready", format: "usdc", url: model },
        artifacts: { model_usdc: { url: model, checksum_sha256: modelChecksum },
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
  it.each([undefined, "not-a-digest", "f".repeat(64)])("rejects opening a request with corrupt namespace identity %s", async scope => {
    const { app } = await fixture();
    const sessionId = await createdReview(app, "open-corrupt-namespace");
    const file = path.join(root, "sessions", `${sessionId}.json`);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.review_request_id = scope;
    fs.writeFileSync(file, JSON.stringify(saved), "utf8");
    const opened = await request(app.app).post(route).send({ mode: "open_existing", session_id: sessionId });
    expect(opened.status).toBe(409);
    expect(opened.body.error_code).toBe("review_request_state_corrupt");
  });
  it("projects ready-model identity and opens a valid recreated source without a request digest", async () => {
    const { app } = await fixture();
    const sourceId = await createdReview(app, "runtime-ready-identity");
    const originalScope = app.store.get(sourceId)?.review_request_id;
    app.store.setStatus(sourceId, "closed");
    const recreated = await request(app.app).post(`/api/review-sessions/${sourceId}/recreate`)
      .set("Idempotency-Key", "runtime-identity-recreate").send({});
    expect(recreated.status).toBe(201);
    expect(app.store.get(recreated.body.session_id)?.review_request_id).toBeUndefined();
    expect(app.store.get(sourceId)?.review_request_id).toBe(originalScope);
    const opened = await request(app.app).post(route).send({ mode: "open_existing", session_id: recreated.body.session_id });
    expect(opened.status).toBe(200);
    const runtime = await request(app.app).get("/api/runtime/status");
    expect(runtime.body.sessions.items.find((item: {session_id: string}) => item.session_id === recreated.body.session_id))
      .toMatchObject({ ready_model_id: id, project_id: "project-test", model_version_id: "v1" });
  });
  it("rejects injected scope on a recreated source", async () => {
    const {app} = await fixture();
    const sourceId = await createdReview(app, "recreated-source-scope");
    app.store.setStatus(sourceId, "closed");
    const first = await request(app.app).post(`/api/review-sessions/${sourceId}/recreate`)
      .set("Idempotency-Key", "first-recreation").send({});
    expect(first.status).toBe(201);
    const targetId = first.body.session_id;
    app.store.setStatus(targetId, "closed");
    const file = path.join(root, "sessions", `${targetId}.json`);
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    stored.review_request_id = "a".repeat(64);
    fs.writeFileSync(file, JSON.stringify(stored), "utf8");
    const denied = await request(app.app).post(`/api/review-sessions/${targetId}/recreate`)
      .set("Idempotency-Key", "second-recreation").send({});
    expect(denied.status).toBe(409);
    expect(denied.body.detail).toBe("review_request_state_corrupt");
    expect(app.store.list()).toHaveLength(2);
  });
  it.each([false, true])("rejects a request-namespace replay target receiptMissing=%s", async receiptMissing => {
    const {app} = await fixture();
    const sourceId = await createdReview(app, "recreated-target-namespace");
    app.store.setStatus(sourceId, "closed");
    const receipt = vi.spyOn(app.store, "recordRecreationReceipt");
    if (receiptMissing) receipt.mockImplementationOnce(() => { throw new Error("receipt write failure"); });
    const recreate = () => request(app.app).post(`/api/review-sessions/${sourceId}/recreate`)
      .set("Idempotency-Key", "target-namespace").send({});
    expect((await recreate()).status).toBe(receiptMissing ? 500 : 201);
    receipt.mockRestore();
    const target = app.store.list().find(session => session.recreated_from_session_id === sourceId)!;
    const file = path.join(root, "sessions", `${target.session_id}.json`);
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    stored.session_id = `review_session_request_${"b".repeat(64)}`;
    fs.writeFileSync(file, JSON.stringify(stored), "utf8");
    const denied = await recreate();
    expect(denied.status).toBe(409);
    expect(denied.body.detail).toBe("review_request_state_corrupt");
  });
  it.each([
    [false, "source", "not-a-digest"], [true, "source", "not-a-digest"],
    [false, "source", "a".repeat(64)], [true, "source", "a".repeat(64)],
    [false, "target", "not-a-digest"], [true, "target", "not-a-digest"],
    [false, "target", "a".repeat(64)], [true, "target", "a".repeat(64)],
  ] as const)("rejects request-scope tamper receiptMissing=%s side=%s scope=%s", async (receiptMissing, side, scope) => {
    const {app} = await fixture();
    const sourceId = await createdReview(app, "recreate-scope-tamper");
    app.store.setStatus(sourceId, "closed");
    const receipt = vi.spyOn(app.store, "recordRecreationReceipt");
    if (receiptMissing) receipt.mockImplementationOnce(() => { throw new Error("receipt write failure"); });
    const recreate = () => request(app.app).post(`/api/review-sessions/${sourceId}/recreate`)
      .set("Idempotency-Key", "recreate-scope-tamper-key").send({});
    expect((await recreate()).status).toBe(receiptMissing ? 500 : 201);
    receipt.mockRestore();
    const target = app.store.list().find(session => session.recreated_from_session_id === sourceId)!;
    const file = path.join(root, "sessions", `${side === "source" ? sourceId : target.session_id}.json`);
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    stored.review_request_id = scope;
    fs.writeFileSync(file, JSON.stringify(stored), "utf8");
    const before = app.eventLog.list(target.session_id);
    const denied = await recreate();
    expect(denied.status).toBe(409);
    expect(denied.body.detail).toBe("review_request_state_corrupt");
    expect(app.eventLog.list(target.session_id)).toEqual(before);
  });
  it.each([
    [false, "source"], [false, "target"], [true, "source"], [true, "target"],
  ] as const)("rejects tampered recreation replay receiptMissing=%s side=%s", async (receiptMissing, side) => {
    const {app} = await fixture();
    const sourceId = await createdReview(app, "recreate-tamper");
    app.store.setStatus(sourceId, "closed");
    const receipt = vi.spyOn(app.store, "recordRecreationReceipt");
    if (receiptMissing) receipt.mockImplementationOnce(() => { throw new Error("receipt write failure"); });
    const recreate = () => request(app.app).post(`/api/review-sessions/${sourceId}/recreate`)
      .set("Idempotency-Key", "recreate-tamper-key").send({});
    const first = await recreate();
    expect(first.status).toBe(receiptMissing ? 500 : 201);
    receipt.mockRestore();
    const target = app.store.list().find(session => session.recreated_from_session_id === sourceId);
    expect(target).toBeDefined();
    const file = path.join(root, "sessions", `${side === "source" ? sourceId : target!.session_id}.json`);
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    record.artifact_bindings[0].url += "?tampered";
    fs.writeFileSync(file, JSON.stringify(record), "utf8");
    const beforeEvents = app.eventLog.list(target!.session_id);
    const denied = await recreate();
    expect(denied.status).toBe(409);
    expect(denied.body.detail).toBe("review_request_state_corrupt");
    expect(app.eventLog.list(target!.session_id)).toEqual(beforeEvents);
  });
  it("rejects a malformed stored request scope before claim", async () => {
    const {app} = await fixture();
    const sessionId = await createdReview(app, "malformed-stored-scope");
    const file = path.join(root, "sessions", `${sessionId}.json`);
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    stored.review_request_id = "not-a-digest";
    fs.writeFileSync(file, JSON.stringify(stored), "utf8");
    const allocator = vi.spyOn(kitPool, "allocateKitInstanceBindings");
    const denied = await claimReady(app, sessionId);
    expect(denied.status).toBe(409);
    expect(denied.body.detail).toBe("review_request_state_corrupt");
    expect(allocator).not.toHaveBeenCalled();
    expect(app.store.get(sessionId)?.status).toBe("created");
  });
  async function createdReview(app: CoordinatorApp, key: string): Promise<string> {
    const response = await request(app.app).post(route).send({mode: "create_new", request_id: key});
    expect(response.status).toBe(200);
    expect(response.body.session_status).toBe("created");
    return response.body.review_session_id as string;
  }
  function claimReady(app: CoordinatorApp, sessionId: string, preferred?: string) {
    return request(app.app).post("/api/review-sessions/" + sessionId + "/viewer-leases/claim")
      .set("X-User-Token", "user_ready_review")
      .send({viewer_id: "viewer_ready_review", requested_role: "primary",
        client_nonce: sessionId + ":primary", preferred_kit_instance_id: preferred});
  }
  it("rejects invalid preference without publishing activation", async () => {
    const {app} = await fixture();
    const sessionId = await createdReview(app, "invalid-preference");
    const before = app.store.get(sessionId);
    const denied = await claimReady(app, sessionId, "kit_does_not_exist");
    expect(denied.status).toBe(409);
    expect(app.store.get(sessionId)).toEqual(before);
    expect(app.eventLog.list(sessionId).some(e => ["sessionActive", "viewerLeaseClaimed"].includes(e.type))).toBe(false);
    const valid = await claimReady(app, sessionId);
    expect(valid.status).toBe(200);
    expect(valid.body.idempotent_replay).toBe(false);
  });
  it("keeps created when allocator returns no candidate binding", async () => {
    const {app} = await fixture();
    const sessionId = await createdReview(app, "empty-candidate");
    const allocator = vi.spyOn(kitPool, "allocateKitInstanceBindings").mockReturnValueOnce([]);
    const denied = await claimReady(app, sessionId);
    expect(allocator).toHaveBeenCalledOnce();
    expect(denied.status).toBe(409);
    expect(denied.body.detail).toBe("viewer_runtime_unavailable");
    expect(app.store.get(sessionId)).toMatchObject({status: "created", kit_instance_bindings: []});
    expect(app.eventLog.list(sessionId).some(e => ["sessionActive", "viewerLeaseClaimed"].includes(e.type))).toBe(false);
    allocator.mockRestore();
    expect((await claimReady(app, sessionId)).status).toBe(200);
  });
  it("releases only a newly acquired lease when session persistence fails", async () => {
    const {app} = await fixture();
    const sessionId = await createdReview(app, "persist-failure");
    const update = vi.spyOn(app.store, "update").mockImplementationOnce(() => { throw new Error("test write failure"); });
    expect((await claimReady(app, sessionId)).status).toBe(500);
    expect(app.store.get(sessionId)).toMatchObject({status: "created", kit_instance_bindings: []});
    expect(app.eventLog.list(sessionId).some(e => ["sessionActive", "viewerLeaseClaimed"].includes(e.type))).toBe(false);
    update.mockRestore();
    const retry = await claimReady(app, sessionId);
    expect(retry.status).toBe(200);
    expect(retry.body.idempotent_replay).toBe(false);
  });
  it("preserves the admitted lease if persistence throws after completing the write", async () => {
    const {app} = await fixture();
    const sessionId = await createdReview(app, "after-write-failure");
    const original = app.store.update.bind(app.store);
    const update = vi.spyOn(app.store, "update").mockImplementationOnce((...args) => {
      original(...args);
      throw new Error("after-write failure");
    });
    expect((await claimReady(app, sessionId)).status).toBe(500);
    expect(app.store.get(sessionId)?.status).toBe("active");
    update.mockRestore();
    const replay = await claimReady(app, sessionId);
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent_replay).toBe(true);
    expect((await claimReady(app, sessionId)).body.lease_id).toBe(replay.body.lease_id);
    for (const type of ["sessionActive", "viewerLeaseClaimed"]) {
      expect(app.eventLog.list(sessionId).filter(e => e.type === type)).toHaveLength(1);
    }
  });
  it.each(["sessionActive", "viewerLeaseClaimed"])("repairs %s without replacing the admitted lease", async (failedType) => {
    const {app} = await fixture();
    const sessionId = await createdReview(app, "event-failure-" + failedType);
    const original = app.eventLog.appendServerOwned.bind(app.eventLog);
    let fail = true;
    const append = vi.spyOn(app.eventLog, "appendServerOwned").mockImplementation((...args) => {
      if (args[1] === failedType && fail) { fail = false; throw new Error("test event failure"); }
      return original(...args);
    });
    const failed = await claimReady(app, sessionId);
    expect(failed.status).toBe(500);
    expect(failed.body).not.toHaveProperty("lease_token");
    expect(app.store.get(sessionId)?.status).toBe("active");
    const retry = await claimReady(app, sessionId);
    expect(retry.status).toBe(200);
    expect(retry.body.idempotent_replay).toBe(true);
    const again = await claimReady(app, sessionId);
    expect(again.body.lease_id).toBe(retry.body.lease_id);
    for (const type of ["sessionActive", "viewerLeaseClaimed"]) {
      expect(app.eventLog.list(sessionId).filter(e => e.type === type && e.server_owned === true)).toHaveLength(1);
    }
    append.mockRestore();
  });
  it("denies unauthenticated claim before allocation", async () => {
    const {app} = await fixture();
    const sessionId = await createdReview(app, "no-auth");
    const allocator = vi.spyOn(kitPool, "allocateKitInstanceBindings");
    const response = await request(app.app).post("/api/review-sessions/" + sessionId + "/viewer-leases/claim")
      .send({viewer_id: "viewer_no_auth", requested_role: "primary"});
    expect(response.status).toBe(401);
    expect(allocator).not.toHaveBeenCalled();
    expect(app.store.get(sessionId)).toMatchObject({status: "created", kit_instance_bindings: []});
  });
  it("rejects client-forged viewer lease claims", async () => {
    const {app} = await fixture();
    const sessionId = await createdReview(app, "forged-claim-event");
    const response = await request(app.app).post("/api/review-sessions/" + sessionId + "/events")
      .send({type: "viewerLeaseClaimed", lease_id: "forged", server_owned: true});
    expect(response.status).toBe(400);
    expect(response.body.detail).toBe("Server-owned event type cannot be appended by a client.");
    expect(app.eventLog.list(sessionId).some(e => e.type === "viewerLeaseClaimed")).toBe(false);
  });
  it("rejects invalid preference even when the nonce already has a lease", async () => {
    const {app} = await fixture();
    const sessionId = await createdReview(app, "invalid-replay-preference");
    const first = await claimReady(app, sessionId);
    expect(first.status).toBe(200);
    const before = app.store.get(sessionId);
    const eventsBefore = app.eventLog.list(sessionId);
    const denied = await claimReady(app, sessionId, "kit_does_not_exist");
    expect(denied.status).toBe(409);
    expect(denied.body.detail).toBe("viewer_preferred_instance_unavailable");
    expect(app.store.get(sessionId)).toEqual(before);
    expect(app.eventLog.list(sessionId)).toEqual(eventsBefore);
    expect((await claimReady(app, sessionId)).body.lease_id).toBe(first.body.lease_id);
  });
  it("creates independent explicit sessions without Kit activation", async () => {
    const {app} = await fixture();
    const pair = await Promise.all([
      request(app.app).post(route).send({mode: "create_new", request_id: "request-a"}),
      request(app.app).post(route).send({mode: "create_new", request_id: "request-a"}),
    ]);
    expect(pair.map(r => r.status)).toEqual([200, 200]);
    expect(new Set(pair.map(r => r.body.review_session_id)).size).toBe(1);
    expect(pair.map(r => r.body.session_replay).sort()).toEqual([false, true]);
    const firstId = pair[0].body.review_session_id as string;
    expect(firstId).toMatch(/^review_session_request_[a-f0-9]{64}$/);
    expect(app.store.get(firstId)).toMatchObject({ready_model_id: id, status: "created", kit_instance_bindings: []});
    expect(app.eventLog.list(firstId).filter(e => e.type === "sessionActive")).toHaveLength(0);
    const second = await request(app.app).post(route).send({mode: "create_new", request_id: "request-b"});
    expect(second.status).toBe(200);
    expect(second.body.review_session_id).not.toBe(firstId);
    expect(second.body).toMatchObject({session_status: "created", session_replay: false});
    expect(app.store.list()).toHaveLength(2);
  });
  it("recovers session-written event-failed across restart", async () => {
    const {app, config} = await fixture();
    const original = app.eventLog.appendServerOwned.bind(app.eventLog);
    const append = vi.spyOn(app.eventLog, "appendServerOwned")
      .mockImplementationOnce(() => { throw new Error("simulated event append failure"); })
      .mockImplementation(original);
    const failed = await request(app.app).post(route).send({mode: "create_new", request_id: "lost-response"});
    expect(failed.status).toBe(500);
    const persisted = app.store.list().find(s => s.review_request_id !== undefined);
    expect(persisted?.session_id).toMatch(/^review_session_request_[a-f0-9]{64}$/);
    append.mockRestore();
    await stopApp(); active = createCoordinatorApp(config);
    const replay = await request(active.app).post(route).send({mode: "create_new", request_id: "lost-response"});
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({review_session_id: persisted?.session_id, session_status: "created", session_replay: true});
    expect(active.store.list()).toHaveLength(1);
    expect(active.eventLog.list(replay.body.review_session_id)
      .filter(e => e.type === "sessionCreated" && e.server_owned === true)).toHaveLength(1);
  });
  it("opens only the named mutable session and replays closed create without revival", async () => {
    const {app} = await fixture();
    const created = await request(app.app).post(route).send({mode: "create_new", request_id: "request-open"});
    expect(created.status).toBe(200);
    const sessionId = created.body.review_session_id as string;
    const opened = await request(app.app).post(route).send({mode: "open_existing", session_id: sessionId});
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({review_session_id: sessionId, session_status: "created", session_replay: true});
    app.store.setStatus(sessionId, "closed");
    const rejected = await request(app.app).post(route).send({mode: "open_existing", session_id: sessionId});
    expect(rejected.status).toBe(409);
    expect(rejected.body.error_code).toBe("review_session_not_mutable");
    const replay = await request(app.app).post(route).send({mode: "create_new", request_id: "request-open"});
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({review_session_id: sessionId, session_status: "closed", session_replay: true});
    expect(app.store.get(sessionId)?.status).toBe("closed");
  });
  it("opens a matching legacy session without inventing a source snapshot", async () => {
    const {app} = await fixture();
    const legacy = await request(app.app).post(route).send({});
    expect(legacy.status).toBe(200);
    const sessionId = legacy.body.review_session_id as string;
    const before = app.store.get(sessionId);
    const opened = await request(app.app).post(route).send({mode: "open_existing", session_id: sessionId});
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({review_session_id: sessionId, session_replay: true});
    expect(app.store.get(sessionId)).toEqual(before);
    expect(before).not.toHaveProperty("ready_review_source");
  });
  it("does not fall back to legacy when new provenance is incomplete", async () => {
    const {app} = await fixture();
    const legacy = await request(app.app).post(route).send({});
    const sessionId = legacy.body.review_session_id as string;
    const file = path.join(root, "sessions", sessionId + ".json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.review_request_fingerprint = "a".repeat(64);
    fs.writeFileSync(file, JSON.stringify(saved), "utf8");
    const rejected = await request(app.app).post(route).send({mode: "open_existing", session_id: sessionId});
    expect(rejected.status).toBe(409);
    expect(app.store.get(sessionId)?.ready_review_source).toBeUndefined();
  });
  it("does not borrow a legacy active session", async () => {
    const {app} = await fixture();
    const legacy = await request(app.app).post(route).send({});
    expect(legacy.status).toBe(200); expect(legacy.body.session_status).toBe("active");
    const explicit = await request(app.app).post(route).send({mode: "create_new", request_id: "independent"});
    expect(explicit.status).toBe(200);
    expect(explicit.body).toMatchObject({session_status: "created", session_replay: false});
    expect(explicit.body.review_session_id).not.toBe(legacy.body.review_session_id);
    expect(app.store.list()).toHaveLength(2);
  });
  it("maps store conflict to HTTP 409", async () => {
    const {app} = await fixture();
    const conflict = vi.spyOn(app.store, "createOrGetReviewRequest").mockReturnValueOnce({kind: "conflict"});
    try {
      const r = await request(app.app).post(route).send({mode: "create_new", request_id: "conflict"});
      expect(r.status).toBe(409); expect(r.body.error_code).toBe("review_request_idempotency_conflict");
    } finally { conflict.mockRestore(); }
  });
  it("rejects a corrupt persisted request", async () => {
    const {app} = await fixture();
    const created = await request(app.app).post(route).send({mode: "create_new", request_id: "corrupt"});
    const sessionId = created.body.review_session_id as string;
    const directory = path.join(root, "sessions");
    fs.writeFileSync(path.join(directory, `${sessionId}.json`), "{", "utf8");
    const r = await request(app.app).post(route).send({mode: "create_new", request_id: "corrupt"});
    expect(r.status).toBe(409); expect(r.body.error_code).toBe("review_request_state_corrupt");
    expect(fs.readdirSync(directory).some(n => n.startsWith(`${sessionId}.json.corrupt-`))).toBe(true);
  });
  it("rejects unauthorized explicit intent before upstream I/O", async () => {
    const {app} = await fixture({externalIntakeIpAllowlist: ["10.0.0.0/8"], devAuthToken: "dev-token"});
    const r = await request(app.app).post(route).send({mode: "create_new", request_id: "denied"});
    expect(r.status).toBe(403); expect(reads).toBe(0); expect(app.store.list()).toHaveLength(0);
  });

  it("returns not-found for a selected missing session", async () => {
    const {app} = await fixture();
    const response = await request(app.app).post(route)
      .send({mode: "open_existing", session_id: "review_session_missing"});
    expect(response.status).toBe(404);
    expect(response.body.error_code).toBe("review_session_not_found");
  });
  it.each(["create_new", "open_existing"])("rejects tampered binding through %s HTTP", async mode => {
    const {app} = await fixture();
    const first = await request(app.app).post(route).send({mode: "create_new", request_id: "tamper"});
    expect(first.status).toBe(200);
    const file = path.join(root, "sessions", first.body.review_session_id + ".json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.artifact_bindings[0].url += "?tampered";
    fs.writeFileSync(file, JSON.stringify(saved), "utf8");
    const body = mode === "create_new" ? {mode, request_id: "tamper"} : {mode, session_id: first.body.review_session_id};
    const rejected = await request(app.app).post(route).send(body);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error_code).toBe("review_request_state_corrupt");
  });
  it.each(["create_new", "open_existing"])("rejects a changed upstream checksum through %s", async mode => {
    const {app, config} = await fixture();
    const first = await request(app.app).post(route).send({mode: "create_new", request_id: "checksum"});
    expect(first.status).toBe(200);
    const sourceBefore = app.store.get(first.body.review_session_id);
    await stopApp();
    const ledgerPath = path.join(root, "ledger.json");
    const disk = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    for (const record of disk.records) delete record.ready_render_bundle;
    fs.writeFileSync(ledgerPath, JSON.stringify(disk), "utf8");
    modelChecksum = "c".repeat(64);
    const readsBefore = reads;
    active = createCoordinatorApp(config);
    const body = mode === "create_new" ? {mode, request_id: "checksum"} : {mode, session_id: first.body.review_session_id};
    const rejected = await request(active.app).post(route).send(body);
    expect(reads).toBe(readsBefore + 1);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error_code).toBe(mode === "create_new"
      ? "review_request_idempotency_conflict" : "review_session_source_mismatch");
    expect(active.store.get(first.body.review_session_id)).toEqual(sourceBefore);
  });

  it("does not let legacy borrow an explicit session", async () => {
    const {app} = await fixture();
    const explicit = await request(app.app).post(route).send({mode: "create_new", request_id: "explicit-first"});
    expect(explicit.status).toBe(200);
    const legacy = await request(app.app).post(route).send({});
    expect(legacy.status).toBe(200);
    expect(legacy.body.session_status).toBe("active");
    expect(legacy.body.review_session_id).not.toBe(explicit.body.review_session_id);
    expect(app.store.get(explicit.body.review_session_id)).toMatchObject({status: "created", kit_instance_bindings: []});
  });
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
    // coordinator 內 watcher 在 self-POST 前登記 provenance（WatcherIntakeRegistry）。
    app.watcherIntakeRegistry.expect(id, "minio-watch-test");
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
    // coordinator 內 watcher 在 self-POST 前登記 provenance（WatcherIntakeRegistry）。
    app.watcherIntakeRegistry.expect(id, "minio-watch-test");
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
  it("does not stamp a ready_model_id on an external intake even when it supplies an mw_-shaped key", async () => {
    const { app } = await fixture();
    // 沒有 in-process 登記：外部 worker 即使選用 mw_ 形狀的 key，也不是 watcher provenance。
    const intake = await request(app.app).post("/api/external/ifc-ready")
      .set({ "X-Webhook-Secret": "dev-webhook-secret", "X-Correlation-Id": "minio-watch-test", "X-Idempotency-Key": id })
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
    expect(app.externalIfcReadyStore.get(intake.body.ifc_ready_job_id)?.intake_source).toBe("external");
    expect(app.store.get(ingest.body.session.session_id)?.ready_model_id).toBeUndefined();
    // ready-record route 因此看不到這顆 session，會另建一顆綁定 ready_model_id 的 session。
    const viaRoute = await request(app.app).post(route).send({});
    expect(viaRoute.status).toBe(200);
    expect(viaRoute.body.review_session_id).not.toBe(ingest.body.session.session_id);
  });
  it("refuses to auto-create a session when the authority publishes artifacts under an internal-only origin", async () => {
    const { app } = await fixture();
    foreignArtifacts = true;
    app.watcherIntakeRegistry.expect(id, "minio-watch-test");
    const intake = await request(app.app).post("/api/external/ifc-ready")
      .set({ "X-Webhook-Secret": "dev-webhook-secret", "X-Correlation-Id": "minio-watch-test", "X-Idempotency-Key": id })
      .send({ event: "ifc_ready", event_id: "evt_809f", tenant_id: "tenant-test", project_id: "project-test",
        external_model_version_id: "v1", project_display_name: "test", model_category: "architecture",
        external_conversion_task_id: "task_809f",
        source_ifc: { ref: "minio://bucket/tenant-test/project-test/v1/model.ifc", etag: `sha256:${"0".repeat(64)}`, filename: "model.ifc", format: "ifc" },
        requested_outputs: ["usdc", "element_mapping"], callback_url: "https://cloud.example/callbacks" });
    expect(intake.status).toBe(202);
    traceId = intake.body.ifc_ready_job_id;
    const ingest = await request(app.app).post(`/api/internal/conversions/${job}/ingest`)
      .set({ "X-Internal-Token": "dev-internal-token" }).send({});
    expect(ingest.status).toBe(202);
    expect(ingest.body.session).toBeNull();
    expect(ingest.body.session_reason).toBe("artifact_origin_untrusted");
    expect(app.store.list()).toHaveLength(0);
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
