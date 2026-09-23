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
      send(200, { conversion_job_id: CONVERSION_ID, status: "succeeded", ready: true, model: { status: "ready" }, artifacts: { model_usdc: { url: "http://127.0.0.1:49101/artifacts/x/model.usdc", checksum_sha256: MODEL_SHA } } });
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
      if (!doc) { send(404, { detail: "CFD run not found." }); return; }
      if (!runMatch[2]) { send(200, doc); return; }
      if (runMatch[2] === "result") {
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
      uref_m_s: (REQUEST_EXAMPLE.wind as { uref_m_s: number }).uref_m_s, end_time: 900, n_procs: 4, background_cell_m: 6,
      // S8 additions: terrain / true-north as submitted and the preset match reported by streaming (6 m cells = custom).
      zref_m: 10, z0_m: 0.5, true_north_source: "geo_reference", true_north_degrees_manual: null, preset_match: null });
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

  it("S8: create records terrain/true-north settings and the preset match; a 422 compute cap passes through without a ledger record", async () => {
    const { base, state } = await startStreamingStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const manual = await request(app.app).post("/api/cfd/runs").send(createBody({
      idempotency_key: "cfdreq_s8_manual_01", mesh: {},
      wind: { ...(REQUEST_EXAMPLE.wind as object), zref_m: 12, z0_m: 0.3, true_north_source: "manual", true_north_degrees_manual: -12.5 },
    }));
    expect(manual.status, manual.text).toBe(202);
    const detail = await request(app.app).get(`/api/cfd/runs/${manual.body.run_id}`);
    expect(detail.body.ledger.origin).toMatchObject({ zref_m: 12, z0_m: 0.3, true_north_source: "manual", true_north_degrees_manual: -12.5, preset_match: "standard" });
    expect(detail.body.status.settings_profile.preset_match).toBe("standard");

    const geo = await request(app.app).post("/api/cfd/runs").send(createBody({
      idempotency_key: "cfdreq_s8_geo_0001", wind: { ...(REQUEST_EXAMPLE.wind as object), true_north_degrees_manual: 30 },
    }));
    expect(geo.status, geo.text).toBe(202);
    // A manual angle sent with the geo_reference source is ignored by the runner, so it is not recorded as used.
    expect((await request(app.app).get(`/api/cfd/runs/${geo.body.run_id}`)).body.ledger.origin).toMatchObject({ true_north_source: "geo_reference", true_north_degrees_manual: null, preset_match: null });

    state.createReply = { status: 422, body: { error_code: "compute_cap_exceeded", detail: "estimated 9000000 cells for wind from 0 degrees exceeds CFD_MAX_CELLS_PER_DIRECTION=8000000" } };
    const capped = await request(app.app).post("/api/cfd/runs").send(createBody({ idempotency_key: "cfdreq_s8_capped01", mesh: { background_cell_m: 0.5 } }));
    expect(capped.status, capped.text).toBe(422);
    expect(capped.body.error_code).toBe("compute_cap_exceeded");
    expect((await request(app.app).get("/api/cfd/runs")).body.count).toBe(2);
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

  it("S6: opens one governance annotation per exceeding ready direction via the existing /api/issues, idempotently, with screening text", async () => {
    const { base, state } = await startStreamingStub();
    const governance = await startGovernanceStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const created = await request(app.app).post("/api/cfd/runs").send(createBody({ origin: { session_id: "review_session_abc123" } }));
    const runId = created.body.run_id as string;
    state.runs.set(runId, { ...(state.runs.get(runId) as Record<string, unknown>), status: "ready" });

    // Result example: 0° → 3.58 m/s, 45° → 3.28 m/s, 22.5° (stub copy of 45°) → 3.28 m/s. Threshold 3.4 → only 0° exceeds.
    const first = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 3.4, model_version_id: "version_cfd_001" });
    expect(first.status, first.text).toBe(201);
    expect(first.body.created_count).toBe(1);
    expect(first.body.validation_level).toBe("screening");
    expect(first.body.purpose).toBe("design_comparison_only");
    const byDeg = new Map((first.body.evaluated as Array<Record<string, unknown>>).map((item) => [item.wind_from_degrees, item]));
    expect((byDeg.get(0) as Record<string, unknown>).exceeds).toBe(true);
    expect((byDeg.get(45) as Record<string, unknown>).skipped_reason).toBe("below_threshold");
    expect(governance.issues).toHaveLength(1);
    const payload = governance.issues[0];
    expect(payload.title).toContain("0°");
    expect(payload.title).toContain("3.58");
    expect(payload.title).toContain("screening");
    expect(payload.description).toContain("design_comparison_only");
    expect(payload.description).toContain("validation_level=screening");
    expect(payload.description).toContain("true_north_default_direction");
    expect(payload.description).toContain(`run_id=${runId}`);
    expect(payload.description).toContain("相對 project north");
    expect(payload.description).toContain("opened_by=");
    expect(payload.severity).toBe("medium");
    expect(payload.model_version_id).toBe("version_cfd_001");
    // The overlay layer names its run prim <run_id>_<wNNN> (streaming postprocess); 0° is w000.
    expect(payload.usd_prim_path).toBe(`/World/Overlays/Cfd/${runId}_w000/PedestrianWind_1p5m`);
    expect(payload).not.toHaveProperty("ifc_guid");
    // Ledger keeps the finding; the detail route shows it.
    const detail = await request(app.app).get(`/api/cfd/runs/${runId}`);
    expect(() => cfdRunLedgerRecord.parse(detail.body.ledger)).not.toThrow();
    expect(detail.body.ledger.findings).toHaveLength(1);
    expect(detail.body.ledger.findings[0].issue_id).toBe("iss_stub_0001");
    expect(detail.body.ledger.findings[0].issue_kind).toBe("annotation");
    expect(typeof detail.body.ledger.findings[0].opened_by).toBe("string");

    // Same (run, direction, threshold, model binding) again → replay, no second governance call.
    const replay = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 3.4, model_version_id: "version_cfd_001" });
    expect(replay.status).toBe(200);
    expect(replay.body.created_count).toBe(0);
    expect((replay.body.evaluated as Array<Record<string, unknown>>).find((item) => item.wind_from_degrees === 0)?.idempotent_replay).toBe(true);
    expect(governance.issues).toHaveLength(1);

    // A lower threshold is a different finding: 45° and 22.5° now exceed too, 0° stays a replay; high severity above 1.5×.
    const lower = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 2 });
    expect(lower.status).toBe(201);
    expect(lower.body.created_count).toBe(3);
    // 22.5° is tagged w022 by the streaming (Python rounding); the prim path takes the tag verbatim from the artifact id.
    const halfDegree = governance.issues.find((item) => String(item.title).includes("22.5°")) as Record<string, unknown>;
    expect(halfDegree.usd_prim_path).toBe(`/World/Overlays/Cfd/${runId}_w022/PedestrianWind_1p5m`);
    expect(governance.issues.slice(1).every((item) => item.severity === "high")).toBe(true);
    const status = await request(app.app).get(`/api/cfd/runs/${runId}`);
    expect(status.body.ledger.findings).toHaveLength(4);

    // A different model binding is a different finding; a requested angle the run does not have is reported, not dropped.
    const rebound = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 3.4, model_version_id: "version_cfd_002", wind_from_degrees: [0, 90] });
    expect(rebound.status).toBe(201);
    expect(rebound.body.created_count).toBe(1);
    expect((rebound.body.evaluated as Array<Record<string, unknown>>).find((item) => item.wind_from_degrees === 90)?.skipped_reason).toBe("not_in_run");
  });

  it("S6: a lost ledger recovers the issue from governance instead of opening a duplicate; concurrent requests open each finding once", async () => {
    const { base, state } = await startStreamingStub();
    const governance = await startGovernanceStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    state.runs.set(runId, { ...(state.runs.get(runId) as Record<string, unknown>), status: "ready" });
    // Two requests in flight at once for the same (run, threshold): the per-run lock serialises them.
    const [a, b] = await Promise.all([
      request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 3.4 }),
      request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 3.4 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(governance.issues).toHaveLength(1);
    // Ledger wiped (a second coordinator with an empty ledger against the same streaming store) → the pre-check finds
    // the governance annotation by prim path + title → replay, no second POST.
    await app.dispose();
    app.io.close();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    const fresh = makeApp({ streamingConversionApiBase: base });
    const recovered = await request(fresh.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 3.4 });
    expect(recovered.status, recovered.text).toBe(200);
    expect(recovered.body.created_count).toBe(0);
    const row = (recovered.body.evaluated as Array<Record<string, unknown>>).find((item) => item.wind_from_degrees === 0) as Record<string, unknown>;
    expect(row.idempotent_replay).toBe(true);
    expect((row.finding as Record<string, unknown>).issue_id).toBe("iss_stub_0001");
    expect(governance.issues).toHaveLength(1);
    const detail = await request(fresh.app).get(`/api/cfd/runs/${runId}`);
    expect(detail.body.ledger.requested_by_principal).not.toBe("unknown");
    expect(detail.body.ledger.findings).toHaveLength(1);
  });

  it("S6: when the second direction fails at governance, the first finding stays recorded and the 502 reports it", async () => {
    const { base, state } = await startStreamingStub();
    const governance = await startGovernanceStub({ failOnPost: 2 });
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    state.runs.set(runId, { ...(state.runs.get(runId) as Record<string, unknown>), status: "ready" });
    const partial = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 2 });
    expect(partial.status).toBe(502);
    expect(partial.body.error_code).toBe("governance_unavailable");
    expect(partial.body.created_count).toBe(1);
    expect((partial.body.evaluated as Array<Record<string, unknown>>).filter((item) => item.finding)).toHaveLength(1);
    const detail = await request(app.app).get(`/api/cfd/runs/${runId}`);
    expect(detail.body.ledger.findings).toHaveLength(1);
    // Retry: the recorded one replays, the failed one is opened now.
    const retry = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 2 });
    expect(retry.status).toBe(201);
    expect(retry.body.created_count).toBe(2);
    expect(governance.issues).toHaveLength(4);
  });

  it("S6: an exceeding ready direction without an overlay artifact of this run is reported (exceeds, overlay_missing) but opens no issue", async () => {
    const { base, state } = await startStreamingStub();
    const governance = await startGovernanceStub();
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    state.runs.set(runId, { ...(state.runs.get(runId) as Record<string, unknown>), status: "ready" });
    state.resultPatch = (result) => {
      const directions = result.directions as Array<Record<string, unknown>>;
      directions[0].overlay_layer = null; // 0°: ready, 3.58 m/s, no overlay layer
      (directions[1].overlay_layer as Record<string, unknown>).artifact_id = "cfd:cfd_20260101T000000Z_other1:w045"; // 45°: another run's layer
    };
    const reply = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 2 });
    expect(reply.status, reply.text).toBe(201);
    const rows = new Map((reply.body.evaluated as Array<Record<string, unknown>>).map((row) => [row.wind_from_degrees, row]));
    for (const deg of [0, 45]) {
      expect(rows.get(deg)).toMatchObject({ exceeds: true, finding: null, skipped_reason: "overlay_missing" });
    }
    // Only 22.5° (valid overlay of this run) opens an issue.
    expect(reply.body.created_count).toBe(1);
    expect(governance.issues).toHaveLength(1);
    expect(governance.issues[0].usd_prim_path).toBe(`/World/Overlays/Cfd/${runId}_w022/PedestrianWind_1p5m`);
  });

  it("S6: refuses findings on a run that is not ready (409) and reports governance failure as 502 without recording a finding", async () => {
    const { base, state } = await startStreamingStub();
    const governance = await startGovernanceStub({ status: 500 });
    const app = makeApp({ streamingConversionApiBase: base });
    const runId = (await request(app.app).post("/api/cfd/runs").send(createBody())).body.run_id as string;
    state.runs.set(runId, { ...(state.runs.get(runId) as Record<string, unknown>), status: "solving" });
    const notReady = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({});
    expect(notReady.status, notReady.text).toBe(409);
    expect(notReady.body.error_code).toBe("run_not_ready");

    state.runs.set(runId, { ...(state.runs.get(runId) as Record<string, unknown>), status: "ready" });
    const failed = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 1 });
    expect(failed.status).toBe(502);
    expect(failed.body.error_code).toBe("governance_unavailable");
    expect(governance.issues).toHaveLength(1);
    const detail = await request(app.app).get(`/api/cfd/runs/${runId}`);
    expect(detail.body.ledger.findings).toBeUndefined();
    const bad = await request(app.app).post(`/api/cfd/runs/${runId}/findings`).send({ threshold_u_m_s: 99 });
    expect(bad.status).toBe(400);
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
    // S8: estimating walks the run history on the streaming host, so it takes the same guard as submitting.
    expect((await request(app.app).post("/api/cfd/estimates").send({ ...ESTIMATE_REQUEST_EXAMPLE, source: { conversion_job_id: CONVERSION_ID } })).status).toBe(403);
    expect((await request(app.app).get("/api/cfd/options")).status).toBe(200);
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
