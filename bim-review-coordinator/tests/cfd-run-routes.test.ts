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
  const state: StubState = { posts: [], runs: new Map(), conversionReady: true, headers: [], workerUnavailable: false };
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
        for (const direction of result.directions as Array<Record<string, unknown>>) {
          const layer = direction.overlay_layer as Record<string, unknown>;
          layer.artifact_id = `cfd:${runMatch[1]}:w${String(Math.round(Number(direction.wind_from_degrees))).padStart(3, "0")}`;
          layer.url = `http://127.0.0.1:49101/cfd-artifacts/${runMatch[1]}/${layer.filename}`;
        }
        send(200, result);
        return;
      }
      if (runMatch[2] === "exclusions") { send(200, { schema: "cfd-exclusion-list/v1", counts: { class_excluded: 454, outlier: 39 }, items: [] }); return; }
      if (runMatch[2] === "cancel" && req.method === "POST") {
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

async function createSession(app: CoordinatorApp, suffix: string): Promise<string> {
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
      conversion_job_id: CONVERSION_ID,
      conversion_status: "ready",
    }],
  });
  expect([200, 201], response.text).toContain(response.status);
  return (response.body as { session_id: string }).session_id;
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
    expect(registered.body.url).toBe(`http://public.example:49101/cfd-artifacts/${runId}/cfd_20260921T062500Z_a1b2c3_w000.usdc`);

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
});
