import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import {
  cfdFindingResponse,
  cfdOverlayRegistrationResponse,
  cfdOverlayRemovalResponse,
  cfdRunLedgerRecord,
  cfdRunResult,
} from "../src/contract/schemas/cfd.js";
import { derivePublicCfdArtifactsUrl } from "../src/routes/cfdRunRoutes.js";
import { createCanonicalSession } from "./helpers/fakeCfdRunWorkflowDeps.js";
import type { KitInstance } from "../src/types.js";

// building-energy-cfd-p2-contract.md S2: browser-facing /api/cfd/* + session cfd-overlays.
// Every route: this suite checks the wire mapping (one case per workflow outcome) through the whole app; the policy
// (source binding, ledger projection, public URLs, findings, overlays) is tested at the CFD Run Workflow interface in
// cfd-run-workflow.test.ts (cfd-run-workflow-adr.md).
// The streaming CFD job service (:49101) is replaced by an in-process HTTP stub that answers
// /api/conversions/{id}/result (sha binding) and /api/cfd-runs* with contract-shaped bodies
// taken from tests/contracts/cfd-run-*-v1.schema.json examples.

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS = path.resolve(TEST_DIR, "..", "..", "tests", "contracts");
const REQUEST_EXAMPLE = (JSON.parse(fs.readFileSync(path.join(CONTRACTS, "cfd-run-request-v1.schema.json"), "utf-8")) as { examples: Record<string, unknown>[] }).examples[0];
const RESULT_EXAMPLE = (JSON.parse(fs.readFileSync(path.join(CONTRACTS, "cfd-run-result-v1.schema.json"), "utf-8")) as { examples: Record<string, unknown>[] }).examples[0];
// S8: the streaming stub answers options/estimates with the contract examples (generated from the real streaming code).
const OPTIONS_EXAMPLE = (JSON.parse(fs.readFileSync(path.join(CONTRACTS, "cfd-options-v1.schema.json"), "utf-8")) as { examples: Record<string, unknown>[] }).examples[0];
const ESTIMATE_EXAMPLES = (JSON.parse(fs.readFileSync(path.join(CONTRACTS, "cfd-estimate-v1.schema.json"), "utf-8")) as { examples: Record<string, unknown>[] }).examples;
const ESTIMATE_REQUEST_EXAMPLE = (JSON.parse(fs.readFileSync(path.join(CONTRACTS, "cfd-estimate-request-v1.schema.json"), "utf-8")) as { examples: Record<string, unknown>[] }).examples[0];
const MODEL_SHA = "c29af95f494349290000000000000000000000000000000000000000000000ab";
const CONVERSION_ID = "stream_conv_20260915094906_54813240";

let active: CoordinatorApp | null = null;
let stub: http.Server | null = null;
let governanceStub: http.Server | null = null;

afterEach(async () => {
  if (active) await active.dispose();
  if (stub) {
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    stub = null;
  }
  if (governanceStub) {
    await new Promise<void>((resolve) => governanceStub?.close(() => resolve()));
    governanceStub = null;
  }
  delete process.env.GOVERNANCE_API_BASE;
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
  /** Optional per-test edit of the result document served by the stub (e.g. drop one direction's overlay layer). */
  resultPatch?: (result: Record<string, unknown>) => void;
  /** S8: bodies the coordinator forwarded to POST /api/cfd-estimates, and optional canned replies. */
  estimatePosts: Array<Record<string, unknown>>;
  estimateReply?: { status: number; body: Record<string, unknown> };
  optionsReply?: { status: number; body: Record<string, unknown> };
  createReply?: { status: number; body: Record<string, unknown> };
  /** GET /api/cfd-runs/{id} answers 404 while the result stays served (a run this coordinator's ledger never saw). */
  hideStatus?: boolean;
  /** The conversion result carries no model.usdc checksum. */
  dropChecksum?: boolean;
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
    // S8: the streaming service reports whether the effective settings are the verified standard preset.
    settings_profile: {
      options_config_version: "2026-09-23.1",
      preset_match: (requestBody.mesh as { background_cell_m?: unknown } | undefined)?.background_cell_m == null ? "standard" : null,
      custom_fields: (requestBody.mesh as { background_cell_m?: unknown } | undefined)?.background_cell_m == null ? [] : ["mesh.background_cell_m"],
    },
    estimate_at_submission: { available: false, reason: "no_geometry_source" },
  };
}

async function startStreamingStub(): Promise<{ base: string; state: StubState }> {
  const state: StubState = { posts: [], runs: new Map(), conversionReady: true, headers: [], workerUnavailable: false, rejectToken: false, estimatePosts: [] };
  let counter = 0;
  stub = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === `/api/conversions/${CONVERSION_ID}/result`) {
      if (!state.conversionReady) { send(200, { conversion_job_id: CONVERSION_ID, status: "running", model: { status: "converting" } }); return; }
      const modelUsdc = state.dropChecksum ? { url: "http://127.0.0.1:49101/artifacts/x/model.usdc" } : { url: "http://127.0.0.1:49101/artifacts/x/model.usdc", checksum_sha256: MODEL_SHA };
      send(200, { conversion_job_id: CONVERSION_ID, status: "succeeded", ready: true, model: { status: "ready" }, artifacts: { model_usdc: modelUsdc } });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/conversions/")) { send(404, { detail: "Conversion job not found." }); return; }
    if (req.method === "GET" && url.pathname === "/api/cfd-options") {
      send(state.optionsReply?.status ?? 200, state.optionsReply?.body ?? OPTIONS_EXAMPLE);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cfd-estimates") {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk.toString("utf8"); });
      req.on("end", () => {
        state.estimatePosts.push(JSON.parse(raw) as Record<string, unknown>);
        send(state.estimateReply?.status ?? 200, state.estimateReply?.body ?? ESTIMATE_EXAMPLES[0]);
      });
      return;
    }
    if (state.rejectToken && req.method === "POST") { send(401, { error_code: "missing_token", detail: "X-Internal-Conversion-Token required" }); return; }
    if (req.method === "POST" && url.pathname === "/api/cfd-runs") {
      let body = "";
      req.on("data", (chunk) => { body += chunk.toString("utf8"); });
      req.on("end", () => {
        state.headers.push(req.headers);
        const parsed = JSON.parse(body) as Record<string, unknown>;
        state.posts.push(parsed);
        if (state.workerUnavailable) { send(503, { error_code: "worker_unavailable", detail: "docker missing (stub)" }); return; }
        if (state.createReply) { send(state.createReply.status, state.createReply.body); return; }
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
      // Same replies as cfd_job_service.py: unknown run 404 run_not_found, result of a run that is not ready 409.
      if (!doc) { send(404, { error_code: "run_not_found", detail: "CFD run not found." }); return; }
      if (!runMatch[2]) {
        if (state.hideStatus) { send(404, { detail: "CFD run not found." }); return; }
        send(200, doc);
        return;
      }
      if (runMatch[2] === "result") {
        if (doc.status !== "ready") {
          const terminal = doc.status === "failed" || doc.status === "cancelled";
          send(409, { error_code: terminal && typeof doc.failure_code === "string" ? doc.failure_code : "not_ready", detail: `run is ${String(doc.status)}` });
          return;
        }
        const result = JSON.parse(JSON.stringify(RESULT_EXAMPLE)) as Record<string, unknown>;
        result.run_id = runMatch[1];
        // The result document mirrors the run status (the real service only serves a result once the run is ready).
        result.status = doc.status;
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
        state.resultPatch?.(result);
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

/** Minimal governance `/api/issues` stand-in: records payloads, answers 201 with an id (annotation when no ifc_guid). */
async function startGovernanceStub(behaviour: { status?: number; failOnPost?: number } = {}): Promise<{ base: string; issues: Array<Record<string, unknown>>; stored: Array<Record<string, unknown>> }> {
  const issues: Array<Record<string, unknown>> = [];
  const stored: Array<Record<string, unknown>> = [];
  let counter = 0;
  governanceStub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/issues") {
        const kind = url.searchParams.get("kind");
        const modelVersionId = url.searchParams.get("model_version_id");
        const listed = stored.filter((item) => (!kind || item.kind === kind) && (!modelVersionId || item.model_version_id === modelVersionId));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ issues: listed }));
        return;
      }
      if (req.method !== "POST" || url.pathname !== "/api/issues") { res.writeHead(404); res.end(); return; }
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      issues.push(body);
      if ((behaviour.status && behaviour.status !== 201) || behaviour.failOnPost === issues.length) {
        res.writeHead(behaviour.status ?? 500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ detail: "stub failure" })); return;
      }
      counter += 1;
      const row = { id: `iss_stub_${String(counter).padStart(4, "0")}`, kind: body.ifc_guid ? "issue" : "annotation", title: body.title, status: "open", severity: body.severity ?? "medium",
        model_version_id: body.model_version_id ?? null, usd_prim_path: body.usd_prim_path ?? null };
      stored.push(row);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));
    });
  });
  await new Promise<void>((resolve) => governanceStub?.listen(0, "127.0.0.1", () => resolve()));
  const address = governanceStub.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  process.env.GOVERNANCE_API_BASE = base;
  return { base, issues, stored };
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

type WireReply = { status: number; body: Record<string, unknown> };

/** Await a request and check its status and error_code together; returns the reply for further checks. */
async function expectError(reply: PromiseLike<WireReply>, status: number, errorCode: string): Promise<WireReply> {
  const answered = await reply;
  expect([answered.status, answered.body.error_code], JSON.stringify(answered.body)).toEqual([status, errorCode]);
  return answered;
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
    // Findings and overlay registration answer 503 as well; removing an earlier overlay stays available (cleanup).
    expect((await request(app.app).post("/api/cfd/runs/cfd_20260921T070000Z_stub1/findings").send({})).status).toBe(503);
    const sessionId = await createSession(app, "off");
    const registration = await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: "cfd_20260921T070000Z_stub1", wind_from_degrees: 0 });
    expect(registration.status).toBe(503);
    const session = app.store.get(sessionId);
    if (!session) throw new Error("fixture session missing");
    const earlier = { ...session.artifact_bindings[0], binding_id: "binding_cfd_earlier", artifact_id: "cfd:cfd_20260921T070000Z_stub1:w000", artifact_role: "overlay" as const, load_order: 1 };
    app.store.update(sessionId, { artifact_bindings: [...session.artifact_bindings, earlier] });
    const removed = await request(app.app).delete(`/api/review-sessions/${sessionId}/cfd-overlays/binding_cfd_earlier`);
    expect(removed.status).toBe(200);
    expect(cfdOverlayRemovalResponse.parse(removed.body)).toEqual({ session_id: sessionId, binding_id: "binding_cfd_earlier", removed: true });
  });

  it("create route: 202, then 200 on replay; the model sha, requested_by and the internal token are added on the way to streaming", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const created = await request(app.app).post("/api/cfd/runs").set("x-trace-id", "trace_test_0001").send(createBody({ origin: { session_id: "review_session_abc123" } }));
    expect(created.status, created.text).toBe(202);
    expect(created.body.run_id).toMatch(/^cfd_/);
    expect(created.body.idempotent_replay).toBe(false);
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0].source).toEqual({ conversion_job_id: CONVERSION_ID, model_usdc_sha256: MODEL_SHA });
    expect(state.posts[0].requested_by).toEqual({ principal: "coordinator-browser", trace_id: "trace_test_0001" });
    expect(state.posts[0]).not.toHaveProperty("origin");
    expect(state.headers[0]["x-internal-conversion-token"]).toBe("cfd-test-token");
    const replay = await request(app.app).post("/api/cfd/runs").send(createBody());
    expect([replay.status, replay.body.run_id, replay.body.idempotent_replay]).toEqual([200, created.body.run_id, true]);
  });

  it("create route maps every other outcome to its status and error_code", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const create = (body: Record<string, unknown>) => request(app.app).post("/api/cfd/runs").send(body);

    await expectError(create(createBody({ wind: { ...(createBody().wind as object), wind_from_degrees: [0, 360] } })), 400, "invalid_request");
    const withSha = createBody();
    (withSha.source as Record<string, unknown>).model_usdc_sha256 = MODEL_SHA;
    await expectError(create(withSha), 400, "invalid_request"); // the browser never supplies the sha
    await expectError(create(createBody({ idempotency_key: "cfdreq_origin_000003", origin: { session_id: "not-a-session" } })), 400, "invalid_request");
    await expectError(create(createBody({ source: { conversion_job_id: "stream_conv_nope" } })), 404, "conversion_not_found");
    state.conversionReady = false;
    const notReady = await expectError(create(createBody()), 409, "source_not_ready");
    expect(notReady.body.detail).toBe(`conversion ${CONVERSION_ID} is running`);
    state.conversionReady = true;
    state.dropChecksum = true;
    await expectError(create(createBody()), 409, "source_mismatch");
    state.dropChecksum = false;
    // Streaming refusals are forwarded as streaming answered them; nothing reaches the ledger.
    state.workerUnavailable = true;
    await expectError(create(createBody({ idempotency_key: "cfdreq_demo_20260921_0002" })), 503, "worker_unavailable");
    state.workerUnavailable = false;
    state.createReply = { status: 422, body: { error_code: "compute_cap_exceeded", detail: "estimated cells exceed the cap (stub)" } };
    await expectError(create(createBody({ idempotency_key: "cfdreq_demo_20260921_0003" })), 422, "compute_cap_exceeded");
    state.createReply = undefined;
    state.rejectToken = true;
    await expectError(create(createBody({ idempotency_key: "cfdreq_demo_20260921_tok" })), 502, "cfd_upstream_unavailable");
    state.rejectToken = false;
    expect((await request(app.app).get("/api/cfd/runs")).body.count).toBe(0);

    const down = makeApp({ streamingConversionApiBase: "http://127.0.0.1:1" });
    await expectError(request(down.app).post("/api/cfd/runs").send(createBody()), 502, "cfd_upstream_unavailable");
  });

  it("S8: GET /api/cfd/options passes cfd-options/v1 through, 502 when streaming is down, 503 when CFD is disabled", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const options = await request(app.app).get("/api/cfd/options");
    expect(options.status, options.text).toBe(200);
    expect(options.body).toEqual(OPTIONS_EXAMPLE);
    expect(options.headers["cache-control"]).toBe("no-store");
    state.optionsReply = { status: 503, body: { error_code: "cfd_options_invalid", detail: "cfd_options.json is invalid (stub)" } };
    const invalid = await request(app.app).get("/api/cfd/options");
    expect(invalid.status).toBe(503);
    expect(invalid.body.error_code).toBe("cfd_options_invalid");

    const down = await request(makeApp({ streamingConversionApiBase: "http://127.0.0.1:1" }).app).get("/api/cfd/options");
    expect(down.status).toBe(502);
    expect(down.body.error_code).toBe("cfd_upstream_unavailable");
    const disabled = await request(makeApp({ cfdEnabled: false }).app).get("/api/cfd/options");
    expect(disabled.status).toBe(503);
    expect(disabled.body.error_code).toBe("cfd_disabled");
  });

  it("S8: POST /api/cfd/estimates validates the body, forwards it unchanged and passes cfd-estimate/v1 through", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const body: Record<string, unknown> = { ...ESTIMATE_REQUEST_EXAMPLE, source: { conversion_job_id: CONVERSION_ID } };
    const estimate = await request(app.app).post("/api/cfd/estimates").send(body);
    expect(estimate.status, estimate.text).toBe(200);
    expect(estimate.body).toEqual(ESTIMATE_EXAMPLES[0]);
    expect(state.estimatePosts).toEqual([body]);
    // Reads need no operator scope and never touch the run ledger.
    expect((await request(app.app).get("/api/cfd/runs")).body.count).toBe(0);

    state.estimateReply = { status: 200, body: ESTIMATE_EXAMPLES[1] };
    const unavailable = await request(app.app).post("/api/cfd/estimates").send(body);
    expect(unavailable.status, unavailable.text).toBe(200);
    expect(unavailable.body.available).toBe(false);

    state.estimateReply = { status: 404, body: { error_code: "conversion_not_found", detail: "Conversion job not found." } };
    expect((await request(app.app).post("/api/cfd/estimates").send(body)).status).toBe(404);

    for (const bad of [
      { ...body, schema: "cfd-run-request/v1" },
      { ...body, idempotency_key: "cfdreq_estimate_01" },
      { ...body, mesh: { background_cell_m: 0.1 } },
      { ...body, wind: { ...(body.wind as object), uref_m_s: 41 } },
    ]) {
      const rejected = await request(app.app).post("/api/cfd/estimates").send(bad);
      expect(rejected.status, JSON.stringify(bad)).toBe(400);
      expect(rejected.body.error_code).toBe("invalid_request");
    }
    expect(state.estimatePosts).toHaveLength(3);
  });

  it("read routes: list, detail, result, exclusions and cancel answer with their wire bodies", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;

    const listed = await request(app.app).get("/api/cfd/runs").query({ conversion_job_id: CONVERSION_ID });
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ count: 1, enabled: true, stale: false });
    expect(() => cfdRunLedgerRecord.parse(listed.body.items[0])).not.toThrow();

    const detail = await request(app.app).get(`/api/cfd/runs/${runId}`);
    expect(detail.status).toBe(200);
    expect(Object.keys(detail.body).sort()).toEqual(["ledger", "status"]);
    expect(() => cfdRunLedgerRecord.parse(detail.body.ledger)).not.toThrow();
    expect(detail.body.status.run_id).toBe(runId);

    const result = await request(app.app).get(`/api/cfd/runs/${runId}/result`);
    expect(result.status).toBe(200);
    const parsed = cfdRunResult.parse(result.body);
    for (const direction of parsed.directions) {
      expect(direction.overlay_layer?.url).toBe(`http://public.example:49101/cfd-artifacts/${runId}/${direction.overlay_layer?.filename}`);
    }
    expect(parsed.run_record.url).toBe(`http://public.example:49101/cfd-artifacts/${runId}/run_record.json`);
    expect(parsed.exclusions.url).toBe(`http://public.example:49101/cfd-artifacts/${runId}/exclusions.json`);

    const exclusions = await request(app.app).get(`/api/cfd/runs/${runId}/exclusions`);
    expect([exclusions.status, exclusions.body.counts]).toEqual([200, { class_excluded: 454, outlier: 39 }]);

    const cancelled = await request(app.app).post(`/api/cfd/runs/${runId}/cancel`).send({});
    expect([cancelled.status, cancelled.body.status]).toEqual([200, "cancelled"]);
    expect((await request(app.app).get("/api/cfd/runs").query({ status: "cancelled" })).body.count).toBe(1);
  });

  it("read routes map failures: unknown runs forwarded, a finished run's cancel refused, 502 for a refused token or an unreachable service, the ledger served stale", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    await request(app.app).post("/api/cfd/runs").send(createBody({ idempotency_key: "cfdreq_demo_20260921_limit2" }));

    const unknown = await request(app.app).get("/api/cfd/runs/cfd_20260101T000000Z_nope01");
    expect([unknown.status, unknown.body]).toEqual([404, { error_code: "run_not_found", detail: "CFD run not found." }]);
    await expectError(request(app.app).get("/api/cfd/runs/not-a-run"), 404, "run_not_found");
    expect((await request(app.app).get("/api/cfd/runs").query({ limit: 1 })).body).toMatchObject({ count: 1 });

    expect((await request(app.app).post(`/api/cfd/runs/${runId}/cancel`).send({})).status).toBe(200);
    await expectError(request(app.app).post(`/api/cfd/runs/${runId}/cancel`).send({}), 409, "not_ready");
    state.rejectToken = true;
    const refused = await expectError(request(app.app).post(`/api/cfd/runs/${runId}/cancel`).send({}), 502, "cfd_upstream_unavailable");
    expect(refused.body.detail).toBe("streaming CFD job service rejected the coordinator internal token");
    state.rejectToken = false;

    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    stub = null;
    const stale = await request(app.app).get(`/api/cfd/runs/${runId}`);
    expect([stale.status, stale.body.status, stale.body.stale, stale.body.ledger.run_id]).toEqual([200, null, true, runId]);
    expect((await request(app.app).get("/api/cfd/runs")).body).toMatchObject({ count: 2, enabled: true, stale: true });
    await expectError(request(app.app).get(`/api/cfd/runs/${runId}/result`), 502, "cfd_upstream_unavailable");
    await expectError(request(app.app).get("/api/cfd/runs/cfd_20260101T000000Z_nope01"), 502, "cfd_upstream_unavailable");
  });

  it("findings route: 201 when it opens issues and 200 on replay, with the CfdFindingResponse body; issues reach governance over HTTP", async () => {
    const { base, state } = await startStreamingStub();
    const governance = await startGovernanceStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody({ origin: { session_id: "review_session_abc123" } }))).body.run_id as string;
    state.runs.set(runId, { ...(state.runs.get(runId) as Record<string, unknown>), status: "ready" });

    const first = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 3.4, model_version_id: "version_cfd_001" });
    expect(first.status, first.text).toBe(201);
    expect(() => cfdFindingResponse.parse(first.body)).not.toThrow();
    expect(first.body).toMatchObject({ run_id: runId, threshold_u_m_s: 3.4, validation_level: "screening", purpose: "design_comparison_only", created_count: 1 });
    expect(governance.issues).toHaveLength(1);
    expect(governance.issues[0]).toMatchObject({ severity: "medium", model_version_id: "version_cfd_001", usd_prim_path: `/World/Overlays/Cfd/${runId}_w000/PedestrianWind_1p5m` });
    const detail = await request(app.app).get(`/api/cfd/runs/${runId}`);
    expect(() => cfdRunLedgerRecord.parse(detail.body.ledger)).not.toThrow();
    expect(detail.body.ledger.findings).toHaveLength(1);

    const replay = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 3.4, model_version_id: "version_cfd_001" });
    expect(replay.status).toBe(200);
    expect(() => cfdFindingResponse.parse(replay.body)).not.toThrow();
    expect(replay.body.created_count).toBe(0);
    expect(governance.issues).toHaveLength(1);
  });

  it("findings route maps every other outcome to its status and error_code", async () => {
    const { base, state } = await startStreamingStub();
    const governance = await startGovernanceStub({ status: 500 });
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    const findings = (id: string, body: Record<string, unknown> = {}) => request(app.app).post(`/api/cfd/runs/${id}/findings`).send(body);

    state.runs.set(runId, { ...(state.runs.get(runId) as Record<string, unknown>), status: "solving" });
    const solving = await findings(runId);
    expect([solving.status, solving.body], "the streaming service's 409 is forwarded").toEqual([409, { error_code: "not_ready", detail: "run is solving" }]);

    state.runs.set(runId, { ...(state.runs.get(runId) as Record<string, unknown>), status: "ready" });
    // Defensive branch: a 200 result for a run that is not ready.
    state.resultPatch = (result) => { result.status = "postprocessing"; };
    const notReady = await findings(runId);
    expect([notReady.status, notReady.body]).toEqual([409, { error_code: "run_not_ready", detail: "run is postprocessing" }]);
    state.resultPatch = undefined;
    const refused = await findings(runId, { threshold_u_m_s: 1 });
    expect(refused.status).toBe(502);
    expect(refused.body).toMatchObject({ error_code: "governance_unavailable", created_count: 0 });
    expect(refused.body.detail).toMatch(/^governance POST \/api\/issues HTTP 500/);
    expect(Array.isArray(refused.body.evaluated)).toBe(true);
    expect(governance.issues).toHaveLength(1);

    // Upstream non-200 is forwarded as the streaming service answered it.
    const unknown = await findings("cfd_20260101T000000Z_nope01");
    expect([unknown.status, unknown.body]).toEqual([404, { error_code: "run_not_found", detail: "CFD run not found." }]);

    // A run this coordinator never recorded, whose status document the streaming service no longer serves.
    const direct = "cfd_20260921T070000Z_direct1";
    state.runs.set(direct, statusDoc(direct, { ...createBody(), requested_by: { principal: "operator_b", trace_id: "trace_direct" } }));
    state.hideStatus = true;
    const notFound = await findings(direct);
    expect([notFound.status, notFound.body]).toEqual([404, { error_code: "run_not_found", detail: "CFD run not found." }]);
    state.hideStatus = false;

    expect((await findings(runId, { threshold_u_m_s: 99 })).body.error_code).toBe("invalid_request");
    expect([(await findings("not-a-run")).status, (await findings("not-a-run")).body.error_code]).toEqual([404, "run_not_found"]);

    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    stub = null;
    const down = await findings(runId);
    expect(down.status).toBe(502);
    expect(down.body.error_code).toBe("cfd_upstream_unavailable");
    expect(down.body.detail).toMatch(/^streaming CFD job service unreachable/);
  });

  it("overlay routes: 201 on registration and 200 on replay with the registration body, a binding stream-config exposes, and DELETE removes it", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    const sessionId = await createSession(app, "ov1");

    const registered = await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: runId, wind_from_degrees: 0 });
    expect(registered.status, registered.text).toBe(201);
    expect(cfdOverlayRegistrationResponse.parse(registered.body)).toEqual({
      session_id: sessionId, binding_id: `binding_cfd_${runId}_w000`, artifact_id: `cfd:${runId}:w000`, artifact_role: "overlay", load_order: 1,
      url: `http://public.example:49101/cfd-artifacts/${runId}/${runId}_w000.usdc`, run_id: runId, wind_from_degrees: 0, idempotent_replay: false,
    });
    // Stream config exposes the binding; the runtime authority sees it as a ready artifact.
    const streamConfig = await request(app.app).get(`/api/review-sessions/${sessionId}/stream-config`);
    expect(streamConfig.status).toBe(200);
    expect((streamConfig.body.artifact_bindings as Array<{ artifact_id: string }>).map((item) => item.artifact_id)).toContain(`cfd:${runId}:w000`);

    const replay = await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: runId, wind_from_degrees: 0 });
    expect(replay.status).toBe(200);
    expect(cfdOverlayRegistrationResponse.parse(replay.body)).toMatchObject({ binding_id: registered.body.binding_id, idempotent_replay: true });

    const removed = await request(app.app).delete(`/api/review-sessions/${sessionId}/cfd-overlays/${registered.body.binding_id}`);
    expect(removed.status).toBe(200);
    expect(cfdOverlayRemovalResponse.parse(removed.body)).toEqual({ session_id: sessionId, binding_id: registered.body.binding_id, removed: true });
    expect(app.store.get(sessionId)?.artifact_bindings).toHaveLength(1);
  });

  it("overlay routes map every other outcome to its status and error_code", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    const register = (sessionId: string, body: Record<string, unknown>) => request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send(body);
    const sessionId = await createSession(app, "map");

    await expectError(register("session_nope", { run_id: runId, wind_from_degrees: 0 }), 404, "session_not_found");
    await expectError(register(sessionId, { run_id: runId, wind_from_degrees: 90 }), 409, "direction_not_ready");
    await expectError(register(await createSession(app, "mm", "stream_conv_20260920000000_0ther001"), { run_id: runId, wind_from_degrees: 0 }), 409, "model_mismatch");
    const bare = app.store.create({ project_id: "project_cfd_bare", model_version_id: "version_cfd_bare", created_by: "cfd_fixture", kit_instance: KIT_INSTANCE, artifact_bindings: [] });
    await expectError(register(bare.session_id, { run_id: runId, wind_from_degrees: 0 }), 409, "session_without_model");
    const closed = await createSession(app, "closed");
    app.store.setStatus(closed, "closed");
    const inactive = await expectError(register(closed, { run_id: runId, wind_from_degrees: 0 }), 409, "session_not_active");
    expect(inactive.body.detail).toBe("session is closed");
    // Upstream non-200 is forwarded as the streaming service answered it.
    const unknown = await register(sessionId, { run_id: "cfd_20260101T000000Z_nope01", wind_from_degrees: 0 });
    expect([unknown.status, unknown.body]).toEqual([404, { error_code: "run_not_found", detail: "CFD run not found." }]);
    state.resultPatch = (result) => { ((result.directions as Array<Record<string, unknown>>)[0].overlay_layer as Record<string, unknown>).artifact_id = "cfd:not a run:w000"; };
    const malformed = await expectError(register(sessionId, { run_id: runId, wind_from_degrees: 0 }), 502, "cfd_upstream_unavailable");
    expect(malformed.body.detail).toBe("upstream overlay artifact_id is malformed");
    await expectError(register(sessionId, { run_id: runId }), 400, "invalid_request");
    state.resultPatch = undefined;
    // A canonical ready-review session whose file already carries a second model binding: the store refuses the write.
    const canonical = createCanonicalSession(app.store, "4");
    const canonicalFile = path.join(app.config.sessionStoreDir, `${canonical}.json`);
    const onDisk = JSON.parse(fs.readFileSync(canonicalFile, "utf8")) as { artifact_bindings: Array<Record<string, unknown>> };
    onDisk.artifact_bindings.push({ ...onDisk.artifact_bindings[0], binding_id: "binding_dup", artifact_id: "auto_usdc_other" });
    fs.writeFileSync(canonicalFile, JSON.stringify(onDisk, null, 2), "utf8");
    const refused = await expectError(register(canonical, { run_id: runId, wind_from_degrees: 0 }), 409, "session_not_overlayable");
    expect(refused.body.detail).toMatch(/ready review source/i);

    const primary = app.store.get(sessionId)?.artifact_bindings[0].binding_id as string;
    await expectError(request(app.app).delete(`/api/review-sessions/${sessionId}/cfd-overlays/${primary}`), 404, "binding_not_found");
    await expectError(request(app.app).delete(`/api/review-sessions/${sessionId}/cfd-overlays/bad%20id`), 404, "binding_not_found");
    await expectError(request(app.app).delete("/api/review-sessions/session_nope/cfd-overlays/binding_x"), 404, "session_not_found");
    expect(app.store.get(sessionId)?.artifact_bindings).toHaveLength(1);
  });

  it("write routes are behind the conversion control guard; reads are not", async () => {
    const { base } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base, conversionTriggerIpAllowlist: ["10.99.0.1"] });
    const sessionId = await createSession(app, "guard");
    expect((await request(app.app).post("/api/cfd/runs").send(createBody())).status).toBe(403);
    expect((await request(app.app).post("/api/cfd/runs/cfd_20260921T070000Z_stub1/cancel").send({})).status).toBe(403);
    expect((await request(app.app).post(`/api/review-sessions/${sessionId}/cfd-overlays`).send({ run_id: "cfd_20260921T070000Z_stub1", wind_from_degrees: 0 })).status).toBe(403);
    expect((await request(app.app).delete(`/api/review-sessions/${sessionId}/cfd-overlays/binding_x`)).status).toBe(403);
    // S8: estimating walks the run history on the streaming host, so it takes the same guard as submitting.
    expect((await request(app.app).post("/api/cfd/estimates").send({ ...ESTIMATE_REQUEST_EXAMPLE, source: { conversion_job_id: CONVERSION_ID } })).status).toBe(403);
    expect((await request(app.app).get("/api/cfd/options")).status).toBe(200);
    expect((await request(app.app).get("/api/cfd/runs")).status).toBe(200);
    expect((await request(app.app).get("/api/cfd/runs/cfd_20260921T070000Z_stub1")).status).toBe(404);
  });
});
