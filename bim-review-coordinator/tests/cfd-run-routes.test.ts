import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import { cfdRunLedgerRecord, cfdRunResult } from "../src/contract/schemas/cfd.js";
import { derivePublicCfdArtifactsUrl } from "../src/routes/cfdRunRoutes.js";
import { isCanonicalReadyReviewSourceCarrier } from "../src/services/sessionStore.js";
import { fingerprintReadyReviewSource, readyReviewSourceSnapshot } from "../src/services/readyReviewIntent.js";
import type { KitInstance } from "../src/types.js";

// building-energy-cfd-p2-contract.md S2: browser-facing /api/cfd/* + session cfd-overlays.
// The streaming CFD job service (:49101) is replaced by an in-process HTTP stub that answers
// /api/conversions/{id}/result (sha binding) and /api/cfd-runs* with contract-shaped bodies
// taken from tests/contracts/cfd-run-*-v1.schema.json examples.

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS = path.resolve(TEST_DIR, "..", "..", "tests", "contracts");
const REQUEST_EXAMPLE = (JSON.parse(fs.readFileSync(path.join(CONTRACTS, "cfd-run-request-v1.schema.json"), "utf-8")) as { examples: Record<string, unknown>[] }).examples[0];
const RESULT_EXAMPLE = (JSON.parse(fs.readFileSync(path.join(CONTRACTS, "cfd-run-result-v1.schema.json"), "utf-8")) as { examples: Record<string, unknown>[] }).examples[0];
const MODEL_SHA = "c29af95f494349290000000000000000000000000000000000000000000000ab";
const CONVERSION_ID = "stream_conv_20260915094906_54813240";

let active: CoordinatorApp | null = null;
let stub: http.Server | null = null;

afterEach(async () => {
  if (active) await active.dispose();
  if (stub) {
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    stub = null;
  }
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

interface StubState {
  posts: Array<Record<string, unknown>>;
  runs: Map<string, Record<string, unknown>>;
  conversionReady: boolean;
  headers: Array<Record<string, string | string[] | undefined>>;
  workerUnavailable: boolean;
  rejectToken: boolean;
}

function statusDoc(runId: string, requestBody: Record<string, unknown>, status = "ready"): Record<string, unknown> {
  const wind = (requestBody.wind as { wind_from_degrees: number[] }).wind_from_degrees;
  return {
    schema: "cfd-run-status/v1",
    run_id: runId,
    status,
    failure_code: null,
    error: null,
    progress: { directions_total: wind.length, directions_done: status === "ready" ? wind.length : 0 },
    sealing_suspect: status === "ready" ? false : null,
    converged_count: status === "ready" ? wind.length : 0,
    purpose: "design_comparison_only",
    created_at: "2026-09-21T06:25:00Z",
    updated_at: "2026-09-21T06:31:12Z",
    source: requestBody.source,
    requested_by: requestBody.requested_by,
    request: requestBody,
  };
}

async function startStreamingStub(): Promise<{ base: string; state: StubState }> {
  const state: StubState = { posts: [], runs: new Map(), conversionReady: true, headers: [], workerUnavailable: false, rejectToken: false };
  let counter = 0;
  stub = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === `/api/conversions/${CONVERSION_ID}/result`) {
      if (!state.conversionReady) { send(200, { conversion_job_id: CONVERSION_ID, status: "running", model: { status: "converting" } }); return; }
      send(200, { conversion_job_id: CONVERSION_ID, status: "succeeded", ready: true, model: { status: "ready" }, artifacts: { model_usdc: { url: "http://127.0.0.1:49101/artifacts/x/model.usdc", checksum_sha256: MODEL_SHA } } });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/conversions/")) { send(404, { detail: "Conversion job not found." }); return; }
    if (state.rejectToken && req.method === "POST") { send(401, { error_code: "missing_token", detail: "X-Internal-Conversion-Token required" }); return; }
    if (req.method === "POST" && url.pathname === "/api/cfd-runs") {
      let body = "";
      req.on("data", (chunk) => { body += chunk.toString("utf8"); });
      req.on("end", () => {
        state.headers.push(req.headers);
        const parsed = JSON.parse(body) as Record<string, unknown>;
        state.posts.push(parsed);
        if (state.workerUnavailable) { send(503, { error_code: "worker_unavailable", detail: "docker missing (stub)" }); return; }
        const existing = Array.from(state.runs.values()).find((run) => (run.request as Record<string, unknown>).idempotency_key === parsed.idempotency_key);
        if (existing) { send(200, { ...existing, idempotent_replay: true }); return; }
        counter += 1;
        const runId = `cfd_20260921T070000Z_stub${counter}`;
        const doc = statusDoc(runId, parsed);
        state.runs.set(runId, doc);
        send(202, { ...doc, idempotent_replay: false });
      });
      return;
    }
    const runMatch = url.pathname.match(/^\/api\/cfd-runs\/([^/]+)(?:\/(result|exclusions|cancel))?$/);
    if (req.method === "GET" && url.pathname === "/api/cfd-runs") {
      send(200, { items: Array.from(state.runs.values()), count: state.runs.size, enabled: true });
      return;
    }
    if (runMatch) {
      const doc = state.runs.get(runMatch[1]);
      if (!doc) { send(404, { detail: "CFD run not found." }); return; }
      if (!runMatch[2]) { send(200, doc); return; }
      if (runMatch[2] === "result") {
        const result = JSON.parse(JSON.stringify(RESULT_EXAMPLE)) as Record<string, unknown>;
        result.run_id = runMatch[1];
        // Third direction 22.5°: the streaming tag uses Python round() (banker's) → w022, not JS w023.
        const directions = result.directions as Array<Record<string, unknown>>;
        const half = JSON.parse(JSON.stringify(directions[1])) as Record<string, unknown>;
        half.wind_from_degrees = 22.5;
        directions.push(half);
        const pythonTag = (deg: number) => String(deg % 1 === 0.5 ? 2 * Math.round(deg / 2) : Math.round(deg)).padStart(3, "0");
        for (const direction of directions) {
          const layer = direction.overlay_layer as Record<string, unknown>;
          const tag = `w${pythonTag(Number(direction.wind_from_degrees))}`;
          layer.artifact_id = `cfd:${runMatch[1]}:${tag}`;
          layer.filename = `${runMatch[1]}_${tag}.usdc`;
          layer.url = `http://127.0.0.1:49101/cfd-artifacts/${runMatch[1]}/${layer.filename}`;
        }
        send(200, result);
        return;
      }
      if (runMatch[2] === "exclusions") { send(200, { schema: "cfd-exclusion-list/v1", counts: { class_excluded: 454, outlier: 39 }, items: [] }); return; }
      if (runMatch[2] === "cancel" && req.method === "POST") {
        if (doc.status === "cancelled" || doc.status === "failed") { send(409, { error_code: "not_ready", detail: `run is ${doc.status}` }); return; }
        const cancelled = { ...doc, status: "cancelled", failure_code: "cancelled" };
        state.runs.set(runMatch[1], cancelled);
        send(200, cancelled);
        return;
      }
    }
    send(404, { detail: "not found" });
  });
  await new Promise<void>((resolve) => stub?.listen(0, "127.0.0.1", () => resolve()));
  const address = stub.address();
  if (!address || typeof address === "string") throw new Error("stub address");
  return { base: `http://127.0.0.1:${address.port}`, state };
}

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-cfd-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    cfdRunLedgerStorePath: path.join(root, "cfd-run-ledger.json"),
    edgeRuntimeDataRoot: root,
    artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    streamingConversionPublicArtifactsUrl: "http://public.example:49101/artifacts",
    streamingConversionInternalToken: "cfd-test-token",
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    cfdEnabled: true,
    ...overrides,
  });
  return active;
}

function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body = JSON.parse(JSON.stringify(REQUEST_EXAMPLE)) as Record<string, unknown>;
  body.source = { conversion_job_id: CONVERSION_ID };
  delete body.requested_by;
  return { ...body, ...overrides };
}

async function createSession(app: CoordinatorApp, suffix: string, conversionJobId: string = CONVERSION_ID): Promise<string> {
  const response = await request(app.app).post("/api/review-sessions").send({
    project_id: `project_cfd_${suffix}`,
    model_version_id: `version_cfd_${suffix}`,
    created_by: "cfd_fixture",
    artifact_bindings: [{
      artifact_group_id: `group_${suffix}`,
      artifact_id: `artifact_${suffix}`,
      artifact_role: "derived",
      url: `http://127.0.0.1:49101/artifacts/${suffix}/model.usdc`,
      mapping_url: null,
      load_order: 0,
      ready_status: "ready",
      conversion_authority: "bim-streaming-server",
      conversion_job_id: conversionJobId,
      conversion_status: "ready",
    }],
  });
  expect([200, 201], response.text).toContain(response.status);
  return (response.body as { session_id: string }).session_id;
}

const KIT_INSTANCE: KitInstance = {
  instance_id: "kit_local_001", provider: "local_fixed", status: "ready",
  stream_server: "127.0.0.1", signaling_port: 49100, media_server: "127.0.0.1",
};

/** Session created the way `/api/ready-models/{id}/session create_new` does (ready_review_source carrier). */
function createCanonicalSession(app: CoordinatorApp, scopeDigit: string): string {
  const source = readyReviewSourceSnapshot({
    readyModelId: "mw_0123456789abcdef", conversionJobId: CONVERSION_ID,
    correlationId: "fixture", rootTraceId: "ifcready_request_fixture",
    tenantId: "tenant_001", projectId: "project_001", modelVersionId: "version_001",
    model: { url: "http://127.0.0.1:49101/artifacts/x/model.usdc", sha256: MODEL_SHA },
    mapping: { url: "http://127.0.0.1:49101/artifacts/x/element_mapping.json", sha256: "b".repeat(64) },
  });
  const result = app.store.createOrGetReviewRequest({
    ready_model_id: "mw_0123456789abcdef", trace_id: "ifcready_request_fixture",
    review_request_id: scopeDigit.repeat(64), review_request_fingerprint: fingerprintReadyReviewSource(source), ready_review_source: source,
    tenant_id: "tenant_001", project_id: "project_001", model_version_id: "version_001",
    usdc_artifact_id: `auto_usdc_${CONVERSION_ID}`, created_by: "coordinator-ready-review-request",
    mode: "single_kit_shared_state", kit_instance: KIT_INSTANCE,
    artifact_bindings: [{ binding_id: "binding_auto_usdc", artifact_group_id: "ag_version_001",
      model_version_id: "version_001", artifact_id: `auto_usdc_${CONVERSION_ID}`,
      artifact_role: "derived", url: source.model.url, mapping_url: source.mapping.url,
      load_order: 0, routing_policy: "same_instance", ready_status: "ready",
      conversion_authority: "bim-streaming-server", conversion_job_id: CONVERSION_ID,
      conversion_status: "ready" }], kit_instance_bindings: [], quality_metrics_summary: null,
  });
  if (result.kind !== "created") throw new Error(`canonical session fixture: ${result.kind}`);
  return result.session.session_id;
}

describe("derivePublicCfdArtifactsUrl", () => {
  it("swaps the trailing /artifacts segment", () => {
    expect(derivePublicCfdArtifactsUrl("http://h:49101/artifacts")).toBe("http://h:49101/cfd-artifacts");
    expect(derivePublicCfdArtifactsUrl("http://h:49101/artifacts/")).toBe("http://h:49101/cfd-artifacts");
    expect(derivePublicCfdArtifactsUrl("http://h:49101")).toBe("http://h:49101/cfd-artifacts");
  });
});

describe("CFD run routes", () => {
  it("CFD_ENABLED=false → POST 503 cfd_disabled, list reports enabled:false", async () => {
    const app = makeApp({ cfdEnabled: false });
    const created = await request(app.app).post("/api/cfd/runs").send(createBody());
    expect(created.status).toBe(503);
    expect(created.body.error_code).toBe("cfd_disabled");
    const listed = await request(app.app).get("/api/cfd/runs");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ items: [], count: 0, enabled: false, stale: false });
    const one = await request(app.app).get("/api/cfd/runs/cfd_20260921T070000Z_stub1");
    expect(one.status).toBe(503);
  });

  it("create binds the model sha from the conversion result, fills requested_by and forwards the token", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const created = await request(app.app).post("/api/cfd/runs").set("x-trace-id", "trace_test_0001").send(createBody());
    expect(created.status, created.text).toBe(202);
    expect(created.body.run_id).toMatch(/^cfd_/);
    expect(created.body.idempotent_replay).toBe(false);
    expect(state.posts).toHaveLength(1);
    const forwarded = state.posts[0];
    expect(forwarded.source).toEqual({ conversion_job_id: CONVERSION_ID, model_usdc_sha256: MODEL_SHA });
    expect(forwarded.requested_by).toEqual({ principal: "coordinator-browser", trace_id: "trace_test_0001" });
    expect(state.headers[0]["x-internal-conversion-token"]).toBe("cfd-test-token");

    // Ledger projection + list/detail read through.
    const listed = await request(app.app).get("/api/cfd/runs").query({ conversion_job_id: CONVERSION_ID });
    expect(listed.status).toBe(200);
    expect(listed.body.enabled).toBe(true);
    expect(listed.body.stale).toBe(false);
    expect(listed.body.count).toBe(1);
    expect(() => cfdRunLedgerRecord.parse(listed.body.items[0])).not.toThrow();
    expect(listed.body.items[0].requested_by_principal).toBe("coordinator-browser");

    const detail = await request(app.app).get(`/api/cfd/runs/${created.body.run_id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.ledger.run_id).toBe(created.body.run_id);
    expect(detail.body.status.status).toBe("ready");

    // Replay: same idempotency key → 200 with the same run.
    const replay = await request(app.app).post("/api/cfd/runs").send(createBody());
    expect(replay.status).toBe(200);
    expect(replay.body.run_id).toBe(created.body.run_id);
    expect(replay.body.idempotent_replay).toBe(true);
  });

  it("S7: keeps the browser origin in the ledger without forwarding it, estimates queue positions, lists across models", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const first = await request(app.app).post("/api/cfd/runs").send(createBody({
      idempotency_key: "cfdreq_origin_000001", origin: { session_id: "review_session_abc123" },
      solver: { end_time: 900, n_procs: 4 }, mesh: { background_cell_m: 6 },
    }));
    expect(first.status, first.text).toBe(202);
    expect(state.posts[0]).not.toHaveProperty("origin");
    const second = await request(app.app).post("/api/cfd/runs").send(createBody({ idempotency_key: "cfdreq_origin_000002" }));
    expect(second.status, second.text).toBe(202);
    // Both runs are still queued on the streaming side → FIFO rank by created_at (the later submission ranks second).
    for (const [runId, doc] of state.runs) {
      const createdAt = runId === first.body.run_id ? "2026-09-21T06:25:00Z" : "2026-09-21T06:26:00Z";
      state.runs.set(runId, { ...doc, status: "queued", created_at: createdAt, progress: { ...(doc.progress as object), directions_done: 0 } });
    }
    const listed = await request(app.app).get("/api/cfd/runs");
    expect(listed.status).toBe(200);
    expect(listed.body.count).toBe(2);
    const byId = new Map((listed.body.items as Array<Record<string, unknown>>).map((item) => [item.run_id, item]));
    const firstRow = byId.get(first.body.run_id) as Record<string, unknown>;
    const secondRow = byId.get(second.body.run_id) as Record<string, unknown>;
    expect(() => cfdRunLedgerRecord.parse(firstRow)).not.toThrow();
    expect(firstRow.origin).toEqual({ session_id: "review_session_abc123", wind_from_degrees: (REQUEST_EXAMPLE.wind as { wind_from_degrees: number[] }).wind_from_degrees,
      uref_m_s: (REQUEST_EXAMPLE.wind as { uref_m_s: number }).uref_m_s, end_time: 900, n_procs: 4, background_cell_m: 6 });
    expect((secondRow.origin as { session_id: unknown }).session_id).toBeNull();
    expect(firstRow.queue_position).toBe(1);
    expect(secondRow.queue_position).toBe(2);
    // A run that is no longer queued has no queue position; the detail route agrees with the list.
    const doneId = second.body.run_id as string;
    state.runs.set(doneId, { ...(state.runs.get(doneId) as Record<string, unknown>), status: "ready" });
    const detail = await request(app.app).get(`/api/cfd/runs/${doneId}`);
    expect(detail.body.ledger.queue_position).toBeNull();
    const again = await request(app.app).get("/api/cfd/runs").query({ status: "queued" });
    expect(again.body.count).toBe(1);
    expect(again.body.items[0].queue_position).toBe(1);
    expect(again.body.items[0].origin.session_id).toBe("review_session_abc123");
    // Idempotent replay (200) with a different body must not overwrite the recorded origin.
    const replay = await request(app.app).post("/api/cfd/runs").send(createBody({
      idempotency_key: "cfdreq_origin_000001", origin: { session_id: "review_session_other999" }, wind: { ...(REQUEST_EXAMPLE.wind as object), wind_from_degrees: [90] },
    }));
    expect(replay.status, replay.text).toBe(200);
    const afterReplay = await request(app.app).get(`/api/cfd/runs/${first.body.run_id}`);
    expect(afterReplay.body.ledger.origin.session_id).toBe("review_session_abc123");
    expect(afterReplay.body.ledger.origin.wind_from_degrees).toEqual((REQUEST_EXAMPLE.wind as { wind_from_degrees: number[] }).wind_from_degrees);
  });

  it("S7: refuses to register an overlay from a run of another model onto the session (409 model_mismatch)", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    const sessionId = await createSession(app, "mm1", "stream_conv_20260920000000_0ther001");
    const mismatch = await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: runId, wind_from_degrees: 0 });
    expect(mismatch.status, mismatch.text).toBe(409);
    expect(mismatch.body.error_code).toBe("model_mismatch");
    expect(app.store.get(sessionId)?.artifact_bindings).toHaveLength(1);
    const rejected = await request(app.app).post("/api/cfd/runs").send(createBody({ idempotency_key: "cfdreq_origin_000003", origin: { session_id: "not-a-session" } }));
    expect(rejected.status).toBe(400);
  });

  it("result rewrites artifact URLs to the public streaming origin and stays contract-valid", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    const result = await request(app.app).get(`/api/cfd/runs/${runId}/result`);
    expect(result.status).toBe(200);
    const parsed = cfdRunResult.parse(result.body);
    expect(parsed.run_id).toBe(runId);
    for (const direction of parsed.directions) {
      expect(direction.overlay_layer?.url).toBe(`http://public.example:49101/cfd-artifacts/${runId}/${direction.overlay_layer?.filename}`);
    }
    expect(parsed.run_record.url).toBe(`http://public.example:49101/cfd-artifacts/${runId}/run_record.json`);
    expect(parsed.exclusions.url).toBe(`http://public.example:49101/cfd-artifacts/${runId}/exclusions.json`);
    const exclusions = await request(app.app).get(`/api/cfd/runs/${runId}/exclusions`);
    expect(exclusions.status).toBe(200);
    expect(exclusions.body.counts).toEqual({ class_excluded: 454, outlier: 39 });
  });

  it("rejects invalid bodies, unknown conversions, not-ready conversions and passes upstream 503 through", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });

    const bad = await request(app.app).post("/api/cfd/runs").send(createBody({ wind: { ...(createBody().wind as object), wind_from_degrees: [0, 360] } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error_code).toBe("invalid_request");

    const withSha = createBody();
    (withSha.source as Record<string, unknown>).model_usdc_sha256 = MODEL_SHA;
    const strict = await request(app.app).post("/api/cfd/runs").send(withSha);
    expect(strict.status, "browser must not supply the sha").toBe(400);

    const unknown = await request(app.app).post("/api/cfd/runs").send(createBody({ source: { conversion_job_id: "stream_conv_nope" } }));
    expect(unknown.status).toBe(404);
    expect(unknown.body.error_code).toBe("conversion_not_found");

    state.conversionReady = false;
    const notReady = await request(app.app).post("/api/cfd/runs").send(createBody());
    expect(notReady.status).toBe(409);
    expect(notReady.body.error_code).toBe("source_not_ready");
    state.conversionReady = true;

    state.workerUnavailable = true;
    const unavailable = await request(app.app).post("/api/cfd/runs").send(createBody({ idempotency_key: "cfdreq_demo_20260921_0002" }));
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error_code).toBe("worker_unavailable");
    expect(state.posts).toHaveLength(1);
  });

  it("unreachable streaming → 502 cfd_upstream_unavailable on create, stale ledger on list", async () => {
    const app = makeApp({ streamingConversionApiBase: "http://127.0.0.1:1" });
    const created = await request(app.app).post("/api/cfd/runs").send(createBody());
    expect(created.status).toBe(502);
    expect(created.body.error_code).toBe("cfd_upstream_unavailable");
    const listed = await request(app.app).get("/api/cfd/runs");
    expect(listed.status).toBe(200);
    expect(listed.body.stale).toBe(true);
  });

  it("cancel passes through and updates the ledger", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    const cancelled = await request(app.app).post(`/api/cfd/runs/${runId}/cancel`).send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    const listed = await request(app.app).get("/api/cfd/runs").query({ status: "cancelled" });
    expect(listed.body.count).toBe(1);
    expect(await request(app.app).get("/api/cfd/runs/not-a-run").then((r) => r.status)).toBe(404);
  });

  it("registers a finished direction as an overlay ArtifactBinding usable by stage-binding, idempotently, and removes it", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    const sessionId = await createSession(app, "ov1");

    const registered = await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: runId, wind_from_degrees: 0 });
    expect(registered.status, registered.text).toBe(201);
    expect(registered.body.artifact_id).toBe(`cfd:${runId}:w000`);
    expect(registered.body.artifact_role).toBe("overlay");
    expect(registered.body.load_order).toBe(1);
    expect(registered.body.url).toBe(`http://public.example:49101/cfd-artifacts/${runId}/${runId}_w000.usdc`);

    const session = app.store.get(sessionId);
    const binding = session?.artifact_bindings.find((item) => item.artifact_id === `cfd:${runId}:w000`);
    expect(binding).toBeDefined();
    expect(binding?.artifact_role).toBe("overlay");
    expect(binding?.ready_status).toBe("ready");
    expect(binding?.artifact_group_id).toBe("group_ov1");
    expect(binding?.display_name).toContain("design comparison only");

    // Stream config exposes the binding; the runtime authority sees it as a ready artifact.
    const streamConfig = await request(app.app).get(`/api/review-sessions/${sessionId}/stream-config`);
    expect(streamConfig.status).toBe(200);
    expect((streamConfig.body.artifact_bindings as Array<{ artifact_id: string }>).map((item) => item.artifact_id)).toContain(`cfd:${runId}:w000`);

    const replay = await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: runId, wind_from_degrees: 0 });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent_replay).toBe(true);
    expect(app.store.get(sessionId)?.artifact_bindings).toHaveLength(2);

    const missing = await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: runId, wind_from_degrees: 90 });
    expect(missing.status).toBe(409);
    expect(missing.body.error_code).toBe("direction_not_ready");

    const removed = await request(app.app).delete(`/api/review-sessions/${sessionId}/cfd-overlays/${registered.body.binding_id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.removed).toBe(true);
    expect(app.store.get(sessionId)?.artifact_bindings).toHaveLength(1);
    const primaryRemoval = await request(app.app).delete(`/api/review-sessions/${sessionId}/cfd-overlays/binding_1`);
    expect(primaryRemoval.status, "only overlay bindings can be removed here").toBe(404);
    expect(await request(app.app).post(`/api/review-sessions/session_nope/cfd-overlays`).send({ run_id: runId, wind_from_degrees: 0 }).then((r) => r.status)).toBe(404);
  });

  // ── S2.1 regression guards (post-merge review of #888) ─────────────────────

  it("overlay on a canonical ready-review session keeps the source projection valid (was: throw → hang)", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    const sessionId = createCanonicalSession(app, "3");
    expect(isCanonicalReadyReviewSourceCarrier(app.store.get(sessionId))).toBe(true);

    const registered = await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: runId, wind_from_degrees: 45 });
    expect(registered.status, registered.text).toBe(201);
    const session = app.store.get(sessionId);
    expect(session?.artifact_bindings.map((binding) => binding.artifact_role)).toEqual(["derived", "overlay"]);
    // The invariant still holds with the overlay attached, and still rejects a second model binding.
    expect(isCanonicalReadyReviewSourceCarrier(session)).toBe(true);
    const primary = session!.artifact_bindings[0];
    expect(() => app.store.update(sessionId, { artifact_bindings: [...session!.artifact_bindings, { ...primary, binding_id: "binding_dup", artifact_id: "auto_usdc_other" }] }))
      .toThrow(/Invalid ready review source projection/);

    const removed = await request(app.app).delete(`/api/review-sessions/${sessionId}/cfd-overlays/${registered.body.binding_id}`);
    expect(removed.status).toBe(200);
    expect(isCanonicalReadyReviewSourceCarrier(app.store.get(sessionId))).toBe(true);
  });

  it("overlay identity is the upstream artifact_id verbatim (22.5° → w022, not JS w023) and matches the angle exactly", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    const sessionId = await createSession(app, "half");
    const half = await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: runId, wind_from_degrees: 22.5 });
    expect(half.status, half.text).toBe(201);
    expect(half.body.artifact_id).toBe(`cfd:${runId}:w022`);
    expect(half.body.url).toBe(`http://public.example:49101/cfd-artifacts/${runId}/${runId}_w022.usdc`);
    const result = await request(app.app).get(`/api/cfd/runs/${runId}/result`);
    const upstreamIds = (result.body.directions as Array<{ overlay_layer: { artifact_id: string } }>).map((item) => item.overlay_layer.artifact_id);
    expect(upstreamIds).toContain(half.body.artifact_id);
    // 23° is not a computed direction even though Math.round(22.5) === 23.
    const rounded = await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: runId, wind_from_degrees: 23 });
    expect(rounded.status).toBe(409);
    expect(rounded.body.error_code).toBe("direction_not_ready");
  });

  it("write routes are behind the conversion control guard; reads are not", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base, conversionTriggerIpAllowlist: ["10.99.0.1"] });
    const sessionId = await createSession(app, "guard");
    expect((await request(app.app).post("/api/cfd/runs").send(createBody())).status).toBe(403);
    expect((await request(app.app).post("/api/cfd/runs/cfd_20260921T070000Z_stub1/cancel").send({})).status).toBe(403);
    expect((await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: "cfd_20260921T070000Z_stub1", wind_from_degrees: 0 })).status).toBe(403);
    expect((await request(app.app).delete(`/api/review-sessions/${sessionId}/cfd-overlays/binding_x`)).status).toBe(403);
    expect((await request(app.app).get("/api/cfd/runs")).status).toBe(200);
    expect((await request(app.app).get("/api/cfd/runs/cfd_20260921T070000Z_stub1")).status).toBe(404);
  });

  it("detail falls back to the ledger with status:null, stale:true when streaming becomes unreachable", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    stub = null;
    const detail = await request(app.app).get(`/api/cfd/runs/${runId}`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.status).toBeNull();
    expect(detail.body.stale).toBe(true);
    expect(detail.body.ledger.run_id).toBe(runId);
  });

  it("list applies limit to the ledger projection; cancel of a terminal run is 409; upstream 401 becomes 502", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const first = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    await request(app.app).post("/api/cfd/runs").send(createBody({ idempotency_key: "cfdreq_demo_20260921_limit2" }));
    const limited = await request(app.app).get("/api/cfd/runs").query({ limit: 1 });
    expect(limited.status).toBe(200);
    expect(limited.body.count).toBe(1);
    expect(limited.body.items).toHaveLength(1);
    expect((await request(app.app).get("/api/cfd/runs")).body.count).toBe(2);

    expect((await request(app.app).post(`/api/cfd/runs/${first}/cancel`).send({})).status).toBe(200);
    const again = await request(app.app).post(`/api/cfd/runs/${first}/cancel`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error_code).toBe("not_ready");

    state.rejectToken = true;
    const rejected = await request(app.app).post("/api/cfd/runs").send(createBody({ idempotency_key: "cfdreq_demo_20260921_tok" }));
    expect(rejected.status).toBe(502);
    expect(rejected.body.error_code).toBe("cfd_upstream_unavailable");
  });
});
