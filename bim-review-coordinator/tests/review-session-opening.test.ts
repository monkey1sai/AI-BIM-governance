// Review Session Opening interface tests (docs/architecture/review-session-opening-adr.md): closed-session recreation, the
// rebuildability projection, the ready-model open (legacy, create_new, open_existing) and the conversion-terminal open,
// through the module's own interface. Artifact health and the conversion authority are in-memory ports; the session store,
// the event log and the conversion ledger are the real in-process implementations. Wire mapping stays in the supertest
// suites (sessions.test.ts, ready-model-session.test.ts, host-native-conversion-ingest.test.ts).
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { ArtifactHealthProbeInput } from "../src/services/artifactHealthProbe.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import { EventLog } from "../src/services/eventLog.js";
import * as kitPool from "../src/services/kitPool.js";
import { fingerprintReadyReviewSource, readyReviewSourceSnapshot, type ReadyReviewIntent } from "../src/services/readyReviewIntent.js";
import {
  ReviewSessionOpening,
  type ArtifactHealthPort,
  type ConversionResultPort,
  type ReadyModelOutcome,
  type TerminalOpenCommand,
} from "../src/services/reviewSessionOpening/index.js";
import { isCanonicalReadyReviewSourceCarrier, reviewRequestCarrierIntegrity, SessionStore, type CreateSessionInput } from "../src/services/sessionStore.js";
import type { StreamingConversionResult } from "../src/services/streamingConversionClient.js";
import type { ArtifactBinding, ArtifactHealthSnapshot, ConversionQualityMetricsSummary, KitInstance, ReviewSession } from "../src/types.js";

const API = "http://127.0.0.1:49101";
const PUBLIC_ORIGIN = "http://bim-edge.example:49101";
const KIT: KitInstance = {
  instance_id: "kit_local_001", provider: "local_fixed", status: "ready",
  stream_server: "127.0.0.1", signaling_port: 49100, media_server: "127.0.0.1",
};

// The ready model the conversion ledger knows, and what the conversion authority publishes for it.
const READY_ID = "mw_0123456789abcdef";
const JOB = "stream_conv_fixture";
const TENANT = "tenant-test";
const CORRELATION = "minio-watch-test";
const ROOT_TRACE = "ifcready_fixture";
const MODEL_URL = `${PUBLIC_ORIGIN}/artifacts/${JOB}/model.usdc`;
const MAPPING_URL = `${PUBLIC_ORIGIN}/artifacts/${JOB}/element_mapping.json`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

class FakeArtifactHealth implements ArtifactHealthPort {
  readonly probes: ArtifactHealthProbeInput[] = [];
  /** Snapshot fields to answer with, or an error to throw. */
  answer: Partial<ArtifactHealthSnapshot> | Error = {};
  /** probe waits for this before answering (keeps a recreation in flight). */
  gate: Promise<void> | null = null;

  async probe(input: ArtifactHealthProbeInput): Promise<ArtifactHealthSnapshot> {
    this.probes.push(input);
    if (this.gate) await this.gate;
    if (this.answer instanceof Error) throw this.answer;
    return {
      source_ifc_exists: null, model_usdc_reachable: true, mapping_reachable: true, metadata_reachable: null, all_required_ready: true,
      checked_at: "2026-09-23T10:00:00.000Z", stale_reason: null, failure_details: null, source: "edge_health_probe", ...this.answer,
    };
  }
}

/** The conversion authority, answering like `StreamingConversionClient.fetchConversionResult` for a succeeded job. */
class FakeConversionResults implements ConversionResultPort {
  readonly fetched: string[] = [];
  /** Raw result fields to change, or an error to throw. */
  answer: Record<string, unknown> | Error = {};

  async fetchConversionResult(jobId: string): Promise<StreamingConversionResult> {
    this.fetched.push(jobId);
    if (this.answer instanceof Error) throw this.answer;
    const model = `${PUBLIC_ORIGIN}/artifacts/${jobId}/model.usdc`;
    const mapping = `${PUBLIC_ORIGIN}/artifacts/${jobId}/element_mapping.json`;
    const raw: Record<string, unknown> = {
      conversion_job_id: jobId, authority: "bim-streaming-server", ready: true, status: "succeeded",
      tenant_id: TENANT, project_id: "project-test", model_version_id: "v1", correlation_id: CORRELATION, trace_id: ROOT_TRACE,
      usdc_url: model, mapping_url: mapping, model: { status: "ready", format: "usdc", url: model },
      artifacts: { model_usdc: { url: model, checksum_sha256: "a".repeat(64) }, element_mapping: { url: mapping, checksum_sha256: "b".repeat(64) } },
      quality_metrics: { coverage_status: "pass", semantic_mapping_fidelity: "guid_exact", mapping_has_ifc_type: true },
      ...this.answer,
    };
    return { conversion_job_id: jobId, status: "succeeded", ready: true, correlation_id: CORRELATION, model_status: "ready",
      usdc_ref: model, element_mapping_ref: mapping, manifest_ref: null, reason: null, raw };
  }
}

/** Record (or re-record) the ready model's conversion; a new job id drops the remembered render bundle, as re-conversion does. */
function recordReadyModel(ledger: ConversionLedger, conversionJobId = JOB): void {
  ledger.upsert({ idempotency_key: READY_ID, correlation_id: CORRELATION, project_id: "project-test", project_display_name: "test",
    category: "architecture", external_model_version_id: "v1", conversion_job_id: conversionJobId, status: "ready" }, "2026-01-01T00:00:00Z");
}

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-session-opening-"));
  roots.push(root);
  const sessionsDir = path.join(root, "sessions");
  const store = new SessionStore(sessionsDir);
  const eventLog = new EventLog(path.join(root, "events"));
  const health = new FakeArtifactHealth();
  const results = new FakeConversionResults();
  const ledger = new ConversionLedger(null);
  recordReadyModel(ledger);
  const coordinator = loadConfig({ streamingConversionApiBase: API, edgeRuntimeDataRoot: root, sessionStoreDir: sessionsDir, eventLogDir: path.join(root, "events"),
    minioWatchTenantId: TENANT,
    kitInstanceEndpoints: [{ id: "kit_fixture", signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 47998 }] });
  const opening = new ReviewSessionOpening({ store, eventLog, conversionLedger: ledger, artifactHealth: health, conversionResults: results,
    config: { coordinator, conversionPublicArtifactOrigin: PUBLIC_ORIGIN } });
  return { root, sessionsDir, store, eventLog, health, results, ledger, coordinator, opening };
}

type Harness = ReturnType<typeof harness>;

function derived(suffix: string, loadOrder = 0, overrides: Partial<ArtifactBinding> = {}): ArtifactBinding {
  return {
    binding_id: `binding_${suffix}_${loadOrder}`, artifact_group_id: `group_${suffix}`, model_version_id: `version_${suffix}`,
    artifact_id: `artifact_${suffix}_${loadOrder}`, artifact_role: "derived", url: `${API}/artifacts/${suffix}_${loadOrder}/model.usdc`,
    mapping_url: `${API}/artifacts/${suffix}_${loadOrder}/element_mapping.json`, load_order: loadOrder, routing_policy: "same_instance",
    ready_status: "ready", conversion_authority: "bim-streaming-server", conversion_job_id: `stream_conv_${suffix}`, conversion_status: "ready",
    ...overrides,
  };
}

function closedSession(h: Harness, suffix: string, bindings: ArtifactBinding[] = [derived(suffix)], extra: Partial<CreateSessionInput> = {}): string {
  const session = h.store.create({
    project_id: `project_${suffix}`, model_version_id: `version_${suffix}`, created_by: "fixture", kit_instance: KIT, artifact_bindings: bindings, ...extra,
  });
  h.store.setStatus(session.session_id, "closed");
  return session.session_id;
}

/** A closed session created the way `/api/ready-models/{id}/session create_new` creates one (ready_review_source carrier). */
function closedCanonicalSession(h: Harness, scopeDigit: string): string {
  const source = readyReviewSourceSnapshot({
    readyModelId: "mw_0123456789abcdef", conversionJobId: "stream_conv_canonical",
    correlationId: "fixture", rootTraceId: "ifcready_request_fixture",
    tenantId: "tenant_001", projectId: "project_001", modelVersionId: "version_001",
    model: { url: `${API}/artifacts/x/model.usdc`, sha256: "a".repeat(64) },
    mapping: { url: `${API}/artifacts/x/element_mapping.json`, sha256: "b".repeat(64) },
  });
  const result = h.store.createOrGetReviewRequest({
    ready_model_id: "mw_0123456789abcdef", trace_id: "ifcready_request_fixture",
    review_request_id: scopeDigit.repeat(64), review_request_fingerprint: fingerprintReadyReviewSource(source), ready_review_source: source,
    tenant_id: "tenant_001", project_id: "project_001", model_version_id: "version_001",
    usdc_artifact_id: "auto_usdc_stream_conv_canonical", created_by: "coordinator-ready-review-request",
    mode: "single_kit_shared_state", kit_instance: KIT,
    artifact_bindings: [{
      binding_id: "binding_auto_usdc", artifact_group_id: "ag_version_001", model_version_id: "version_001", artifact_id: "auto_usdc_stream_conv_canonical",
      artifact_role: "derived", url: source.model.url, mapping_url: source.mapping.url, load_order: 0, routing_policy: "same_instance",
      ready_status: "ready", conversion_authority: "bim-streaming-server", conversion_job_id: "stream_conv_canonical", conversion_status: "ready",
    }],
    kit_instance_bindings: [], quality_metrics_summary: null,
  });
  if (result.kind !== "created") throw new Error(`canonical session fixture: ${result.kind}`);
  h.store.setStatus(result.session.session_id, "closed");
  return result.session.session_id;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicId(sourceSessionId: string, idempotencyKey: string): string {
  return `review_session_${sha256(`${sourceSessionId}:${sha256(idempotencyKey)}`).slice(0, 24)}`;
}

/** Edit a session file directly (the store refuses to write some of these states itself). */
function tamper(h: Harness, sessionId: string, edit: (session: Record<string, unknown>) => void): void {
  const file = path.join(h.sessionsDir, `${sessionId}.json`);
  const session = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  edit(session);
  fs.writeFileSync(file, JSON.stringify(session), "utf8");
}

function expectKind<T extends { kind: string }, K extends T["kind"]>(outcome: T, kind: K): Extract<T, { kind: K }> {
  expect(outcome.kind, JSON.stringify(outcome)).toBe(kind);
  return outcome as Extract<T, { kind: K }>;
}

function openReady(h: Harness, intent: ReadyReviewIntent): Promise<ReadyModelOutcome> {
  return h.opening.openForReadyModel({ readyModelId: READY_ID, intent });
}

/** Holds every artifact-health probe until `release` is called. */
function gateProbes(h: Harness): () => void {
  let release: () => void = () => {};
  h.health.gate = new Promise<void>((resolve) => { release = resolve; });
  return release;
}

/** Lets requests started in the same tick reach the gated probe. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function events(h: Harness, sessionId: string): Array<{ type: string; payload: unknown }> {
  return h.eventLog.list(sessionId).map((event) => ({ type: event.type, payload: event.payload }));
}

describe("ReviewSessionOpening.recreate", () => {
  it("recreates a closed session over its ready derived bindings with fresh binding ids, a deterministic id, a receipt and the lineage events", async () => {
    const h = harness();
    const sourceId = closedSession(h, "ready", [
      derived("ready", 1), derived("ready", 0), derived("ready", 2, { ready_status: "converting" }),
      { ...derived("ready", 3), artifact_role: "overlay", artifact_id: "cfd:cfd_20260921T070000Z_x:w000" },
    ]);
    const outcome = expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-ready-0001" }), "created");
    const recreated = outcome.session;
    expect(outcome.sourceSessionId).toBe(sourceId);
    expect(recreated.session_id).toBe(deterministicId(sourceId, "recreate-ready-0001"));
    expect(recreated).toMatchObject({ status: "created", recreated_from_session_id: sourceId, kit_instance_bindings: [], project_id: "project_ready",
      usdc_artifact_id: "artifact_ready_0" });
    expect(recreated.kit_instance.instance_id).toBe("kit_fixture");
    // Only the ready derived bindings, in load order, under new binding ids.
    expect(recreated.artifact_bindings.map((binding) => binding.artifact_id)).toEqual(["artifact_ready_0", "artifact_ready_1"]);
    expect(recreated.artifact_bindings.every((binding) => /^binding_[0-9a-f]{12}$/.test(binding.binding_id))).toBe(true);
    expect(h.store.getRecreationReceipt(sourceId, sha256("recreate-ready-0001"))).toBe(recreated.session_id);
    expect(h.store.get(sourceId)?.status).toBe("closed");
    expect(events(h, recreated.session_id)).toEqual([
      { type: "sessionCreated", payload: { project_id: "project_ready", model_version_id: "version_ready", recreated_from_session_id: sourceId } },
    ]);
    expect(events(h, sourceId).filter((event) => event.type === "sessionRecreated")).toEqual([
      { type: "sessionRecreated", payload: { recreated_session_id: recreated.session_id } },
    ]);
    expect(h.health.probes).toHaveLength(2);
    expect(h.health.probes[0]).toMatchObject({ host_local_path: null, edge_runtime_data_root: h.root, configured_conversion_api_origin: API,
      trusted_public_artifact_origin: PUBLIC_ORIGIN, model_artifact_url: `${API}/artifacts/ready_0/model.usdc` });
  });

  it("replays the same key from its receipt without new events; another key recreates again", async () => {
    const h = harness();
    const sourceId = closedSession(h, "replay");
    const first = expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-replay-0001" }), "created");
    const eventCount = h.eventLog.list(first.session.session_id).length + h.eventLog.list(sourceId).length;
    const replay = expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-replay-0001" }), "replayed");
    expect(replay.session.session_id).toBe(first.session.session_id);
    expect(h.eventLog.list(first.session.session_id).length + h.eventLog.list(sourceId).length).toBe(eventCount);
    const other = expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-replay-0002" }), "created");
    expect(other.session.session_id).not.toBe(first.session.session_id);
  });

  it("replays from the deterministic id when the receipt was lost, writing the receipt and the missing lineage", async () => {
    const h = harness();
    const sourceId = closedSession(h, "lost");
    const targetId = deterministicId(sourceId, "recreate-lost-00001");
    h.store.create({ session_id: targetId, recreated_from_session_id: sourceId, project_id: "project_lost", model_version_id: "version_lost",
      created_by: "fixture", kit_instance: KIT, artifact_bindings: [derived("lost")] });
    const replay = expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-lost-00001" }), "replayed");
    expect(replay.session.session_id).toBe(targetId);
    expect(h.store.getRecreationReceipt(sourceId, sha256("recreate-lost-00001"))).toBe(targetId);
    expect(events(h, targetId).map((event) => event.type)).toEqual(["sessionCreated"]);
    expect(events(h, sourceId).map((event) => event.type)).toContain("sessionRecreated");
    expect(h.health.probes).toHaveLength(0);
  });

  it("joins concurrent requests for the same key: one creates the session, the others replay it", async () => {
    const h = harness();
    const sourceId = closedSession(h, "join");
    let open: () => void = () => {};
    h.health.gate = new Promise<void>((resolve) => { open = resolve; });
    const all = Promise.all([1, 2, 3].map(() => h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-join-0001" })));
    await settle();
    expect(h.health.probes).toHaveLength(1); // the later requests wait on the first instead of probing again
    open();
    const outcomes = await all;
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["created", "replayed", "replayed"]);
    const ids = new Set(outcomes.map((outcome) => (outcome.kind === "created" || outcome.kind === "replayed" ? outcome.session.session_id : "")));
    expect(ids.size).toBe(1);
    expect(h.store.list()).toHaveLength(2);
  });

  it("hands a joined request the first request's refusal unchanged; the same key is evaluated afresh afterwards", async () => {
    const h = harness();
    const sourceId = closedSession(h, "refuse");
    let open: () => void = () => {};
    h.health.gate = new Promise<void>((resolve) => { open = resolve; });
    h.health.answer = { model_usdc_reachable: false, stale_reason: "model.usdc returned 404" };
    const both = Promise.all([1, 2].map(() => h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-refuse-01" })));
    await settle();
    expect(h.health.probes).toHaveLength(1);
    open();
    const refused = { kind: "not_rebuildable", rebuildability: { state: "stale", reason: "model.usdc returned 404", checked_at: "2026-09-23T10:00:00.000Z" } };
    expect(await both).toEqual([refused, refused]);
    // Nothing stays registered: the same key probes again and, with the model reachable now, recreates.
    h.health.gate = null;
    h.health.answer = {};
    expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-refuse-01" }), "created");
    expect(h.health.probes).toHaveLength(2);
  });

  it("fails a joined request with the first request's error; the same key is free again afterwards", async () => {
    const h = harness();
    const sourceId = closedSession(h, "fail");
    let open: () => void = () => {};
    h.health.gate = new Promise<void>((resolve) => { open = resolve; });
    const create = vi.spyOn(h.store, "create").mockImplementationOnce(() => { throw new Error("session store write failed"); });
    const both = Promise.allSettled([1, 2].map(() => h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-fail-0001" })));
    await settle();
    open();
    expect((await both).map((result) => (result.status === "rejected" ? (result.reason as Error).message : result.status)))
      .toEqual(["session store write failed", "session store write failed"]);
    h.health.gate = null;
    expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-fail-0001" }), "created");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("repairs the sessionActive event once when it replays a recreated session that became active", async () => {
    const h = harness();
    const sourceId = closedSession(h, "active");
    const first = expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-active-01" }), "created");
    h.store.setStatus(first.session.session_id, "active");
    expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-active-01" }), "replayed");
    expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-active-01" }), "replayed");
    expect(events(h, first.session.session_id)).toEqual([
      { type: "sessionCreated", payload: { project_id: "project_active", model_version_id: "version_active", recreated_from_session_id: sourceId } },
      { type: "sessionActive", payload: { kit_instance_bindings: [] } },
    ]);
  });

  it("refuses a missing source and a source that is not closed", async () => {
    const h = harness();
    expect(await h.opening.recreate({ closedSessionId: "review_session_nope00000000", idempotencyKey: "recreate-nope-0001" })).toEqual({ kind: "not_found" });
    const open = h.store.create({ project_id: "p", model_version_id: "v", created_by: "fixture", kit_instance: KIT, artifact_bindings: [derived("open")] });
    expect(await h.opening.recreate({ closedSessionId: open.session_id, idempotencyKey: "recreate-open-0001" })).toEqual({ kind: "not_closed" });
  });

  it("recreates a canonical ready-review session with its carrier, outside the request namespace", async () => {
    const h = harness();
    const sourceId = closedCanonicalSession(h, "3");
    const source = h.store.get(sourceId) as ReviewSession;
    const recreated = expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-canon-0001" }), "created").session;
    expect(recreated.session_id.startsWith("review_session_request_")).toBe(false);
    expect(recreated.review_request_id).toBeUndefined();
    expect(recreated.ready_review_source).toEqual(source.ready_review_source);
    expect(recreated.review_request_fingerprint).toBe(source.review_request_fingerprint);
    expect(recreated.ready_model_id).toBe(source.ready_model_id);
    expect(recreated.trace_id).toBe(source.trace_id);
    expect(isCanonicalReadyReviewSourceCarrier(recreated)).toBe(true);
    expect(reviewRequestCarrierIntegrity(recreated)).toBe("canonical");
  });

  it("refuses a corrupt carrier on the source, and a replayed session whose review-request identity changed", async () => {
    const h = harness();
    const canonical = closedCanonicalSession(h, "4");
    tamper(h, canonical, (session) => { session.review_request_id = "c".repeat(64); });
    expect(await h.opening.recreate({ closedSessionId: canonical, idempotencyKey: "recreate-corrupt-01" })).toEqual({ kind: "carrier_corrupt" });

    const legacy = closedSession(h, "legacy", [derived("legacy")], { review_request_id: "external-review-123" });
    const first = expectKind(await h.opening.recreate({ closedSessionId: legacy, idempotencyKey: "recreate-legacy-01" }), "created");
    expect(first.session.review_request_id).toBe("external-review-123");
    tamper(h, first.session.session_id, (session) => { session.review_request_id = "other-external-review"; });
    expect(await h.opening.recreate({ closedSessionId: legacy, idempotencyKey: "recreate-legacy-01" })).toEqual({ kind: "carrier_corrupt" });

    // The deterministic-id replay checks the carrier too, and records no receipt for a session it refuses.
    const lost = closedSession(h, "lostcarrier", [derived("lostcarrier")], { review_request_id: "external-review-456" });
    h.store.create({ session_id: deterministicId(lost, "recreate-lostcar-01"), recreated_from_session_id: lost, review_request_id: "another-external-review",
      project_id: "project_lostcarrier", model_version_id: "version_lostcarrier", created_by: "fixture", kit_instance: KIT, artifact_bindings: [derived("lostcarrier")] });
    expect(await h.opening.recreate({ closedSessionId: lost, idempotencyKey: "recreate-lostcar-01" })).toEqual({ kind: "carrier_corrupt" });
    expect(h.store.getRecreationReceipt(lost, sha256("recreate-lostcar-01"))).toBeNull();
  });

  it("treats a receipt or a deterministic id of another lineage as a store inconsistency", async () => {
    const h = harness();
    const sourceId = closedSession(h, "lineage");
    const first = expectKind(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-lineage-01" }), "created");
    tamper(h, first.session.session_id, (session) => { session.recreated_from_session_id = "review_session_elsewhere000"; });
    await expect(h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-lineage-01" })).rejects.toThrow("Recreation idempotency receipt lineage mismatch.");

    const other = closedSession(h, "collide");
    h.store.create({ session_id: deterministicId(other, "recreate-collide-01"), recreated_from_session_id: "review_session_elsewhere000",
      project_id: "p", model_version_id: "v", created_by: "fixture", kit_instance: KIT, artifact_bindings: [derived("collide")] });
    await expect(h.opening.recreate({ closedSessionId: other, idempotencyKey: "recreate-collide-01" })).rejects.toThrow("Deterministic recreation session id collision.");
  });
});

describe("ReviewSessionOpening.rebuildability", () => {
  it("is ready when every ready derived binding is trusted and reachable, with the probe's check time", async () => {
    const h = harness();
    const session = h.store.get(closedSession(h, "rb", [derived("rb", 0), derived("rb", 1)])) as ReviewSession;
    expect(await h.opening.rebuildability(session)).toEqual({ state: "ready", reason: null, checked_at: "2026-09-23T10:00:00.000Z" });
  });

  it.each([
    ["no derived binding", () => [], {}, { state: "unavailable", reason: "ready USDC / mapping binding is unavailable", checked_at: null }],
    ["a derived binding that is not ready", () => [derived("s", 0, { ready_status: "converting" })], {},
      { state: "stale", reason: "artifact binding status is converting", checked_at: null }],
    ["a missing mapping", () => [derived("s", 0, { mapping_url: null })], {},
      { state: "unavailable", reason: "mapping binding is unavailable for artifact_s_0", checked_at: null }],
    ["an artifact of another origin", () => [derived("s", 0, { url: "http://elsewhere.example:8080/artifacts/s_0/model.usdc" })], {},
      { state: "unavailable", reason: "artifact binding is not owned by the configured conversion authority", checked_at: null }],
    ["an unreachable model", () => [derived("s")], { model_usdc_reachable: false, stale_reason: "model.usdc returned 404" },
      { state: "stale", reason: "model.usdc returned 404", checked_at: "2026-09-23T10:00:00.000Z" }],
    ["an unverifiable probe", () => [derived("s")], { mapping_reachable: null },
      { state: "unavailable", reason: "artifact health could not be verified", checked_at: "2026-09-23T10:00:00.000Z" }],
    ["a probe that fails", () => [derived("s")], new Error("probe crashed"),
      { state: "unavailable", reason: "artifact health could not be verified", checked_at: null }],
  ] as const)("explains %s, and recreation refuses without creating anything", async (_label, bindings, answer, expected) => {
    const h = harness();
    h.health.answer = answer as Partial<ArtifactHealthSnapshot> | Error;
    const sourceId = closedSession(h, "s", [...bindings()] as ArtifactBinding[]);
    expect(await h.opening.rebuildability(h.store.get(sourceId) as ReviewSession)).toEqual(expected);
    expect(await h.opening.recreate({ closedSessionId: sourceId, idempotencyKey: "recreate-stale-0001" })).toEqual({ kind: "not_rebuildable", rebuildability: expected });
    expect(h.store.list()).toHaveLength(1);
  });
});

describe("reviewRequestCarrierIntegrity", () => {
  it("accepts a session without a carrier, legacy request ids included, and exact carriers inside and outside the request namespace", () => {
    const h = harness();
    const legacy = h.store.get(closedSession(h, "plain", [derived("plain")], { review_request_id: "external-review-123" })) as ReviewSession;
    expect(reviewRequestCarrierIntegrity(legacy)).toBe("canonical");
    const namespaced = h.store.get(closedCanonicalSession(h, "5")) as ReviewSession;
    expect(namespaced.session_id.startsWith("review_session_request_")).toBe(true);
    expect(reviewRequestCarrierIntegrity(namespaced)).toBe("canonical");
  });

  it("refuses a request-namespace id that does not match its digest, a carrier with a review_request_id outside the namespace, and an inexact carrier", () => {
    const h = harness();
    const namespaced = h.store.get(closedCanonicalSession(h, "6")) as ReviewSession;
    expect(reviewRequestCarrierIntegrity({ ...namespaced, review_request_id: "d".repeat(64) })).toBe("corrupt");
    // An id that is no digest is refused before the scope id is derived from it (deriving it would throw).
    expect(reviewRequestCarrierIntegrity({ ...namespaced, review_request_id: undefined })).toBe("corrupt");
    expect(reviewRequestCarrierIntegrity({ ...namespaced, review_request_id: "not-a-digest" })).toBe("corrupt");
    const outside = { ...namespaced, session_id: "review_session_0123456789ab", review_request_id: undefined };
    expect(reviewRequestCarrierIntegrity(outside)).toBe("canonical");
    expect(reviewRequestCarrierIntegrity({ ...outside, review_request_id: "e".repeat(64) })).toBe("corrupt");
    expect(reviewRequestCarrierIntegrity({ ...namespaced, review_request_fingerprint: "f".repeat(64) })).toBe("corrupt");
  });
});

describe("ReviewSessionOpening.openForReadyModel", () => {
  const legacy = { mode: "legacy" } as const;

  it("legacy: opens an active session over the ready bundle, remembers the bundle, and reuses the session afterwards", async () => {
    const h = harness();
    const opened = expectKind(await openReady(h, legacy), "opened");
    expect(opened.replay).toBe(false);
    expect(opened.session).toMatchObject({
      status: "active", ready_model_id: READY_ID, trace_id: ROOT_TRACE, tenant_id: TENANT, project_id: "project-test", model_version_id: "v1",
      usdc_artifact_id: `auto_usdc_${JOB}`, created_by: "coordinator-auto-conversion-ready",
    });
    expect(opened.session.artifact_bindings).toEqual([expect.objectContaining({
      binding_id: "binding_auto_usdc", artifact_group_id: "ag_v1", url: MODEL_URL, mapping_url: MAPPING_URL, conversion_job_id: JOB, ready_status: "ready",
    })]);
    expect(opened.session.kit_instance_bindings.map((binding) => binding.kit_instance_id)).toEqual(["kit_fixture"]);
    expect(opened.session.quality_metrics_summary).toMatchObject({ coverage_status: "pass", semantic_mapping_fidelity: "guid_exact" });
    expect(events(h, opened.session.session_id)).toEqual([
      { type: "sessionCreated", payload: { project_id: "project-test", model_version_id: "v1" } },
      { type: "sessionActive", payload: { kit_instance_bindings: ["kit_fixture"] } },
    ]);
    expect(h.ledger.get(READY_ID)?.ready_render_bundle).toMatchObject({ readyModelId: READY_ID, conversionJobId: JOB });
    expect(h.health.probes[0]).toMatchObject({ model_artifact_url: MODEL_URL, mapping_url: MAPPING_URL, trusted_public_artifact_origin: PUBLIC_ORIGIN,
      configured_conversion_api_origin: API });

    const again = expectKind(await openReady(h, legacy), "opened");
    expect([again.session.session_id, again.replay]).toEqual([opened.session.session_id, true]);
    expect(h.results.fetched, "the second request resolves from the remembered bundle").toEqual([JOB]);
    expect(h.store.list()).toHaveLength(1);
  });

  it("legacy: refuses while the model's session is closing, and replaces a closed one as a recreation", async () => {
    const h = harness();
    const first = expectKind(await openReady(h, legacy), "opened").session;
    h.store.setStatus(first.session_id, "closing");
    expect(await openReady(h, legacy)).toEqual({ kind: "session_closing" });
    h.store.setStatus(first.session_id, "closed");
    const replacement = expectKind(await openReady(h, legacy), "opened");
    expect(replacement.replay).toBe(false);
    expect(replacement.session.recreated_from_session_id).toBe(first.session_id);
    expect(events(h, replacement.session.session_id)).toEqual([
      { type: "sessionCreated", payload: { project_id: "project-test", model_version_id: "v1", recreated_from_session_id: first.session_id } },
      { type: "sessionActive", payload: { kit_instance_bindings: ["kit_fixture"] } },
    ]);
    expect(events(h, first.session_id).filter((event) => event.type === "sessionRecreated")).toEqual([
      { type: "sessionRecreated", payload: { recreated_session_id: replacement.session.session_id } },
    ]);
  });

  it("legacy: concurrent requests for the model join the one that opens the session", async () => {
    const h = harness();
    const release = gateProbes(h);
    const both = Promise.all([1, 2].map(() => openReady(h, legacy)));
    await settle();
    expect(h.health.probes).toHaveLength(1);
    release();
    const [leader, joined] = (await both).map((outcome) => expectKind(outcome, "opened"));
    expect(joined.session.session_id).toBe(leader.session.session_id);
    expect([leader.replay, joined.replay], "a joined legacy request answers what the first one did").toEqual([false, false]);
    expect(h.store.list()).toHaveLength(1);
  });

  it("legacy: opens nothing without Kit capacity", async () => {
    const h = harness();
    vi.spyOn(kitPool, "allocateKitInstanceBindings").mockReturnValueOnce([]);
    expect(await openReady(h, legacy)).toEqual({ kind: "queued_for_instance" });
    expect(h.store.list()).toHaveLength(0);
  });

  it("create_new: creates the request's session with its carrier and event, replays it, joins a concurrent request, and stays out of legacy's reach", async () => {
    const h = harness();
    const intent = { mode: "create_new", request_id: "req-0001" } as const;
    const created = expectKind(await openReady(h, intent), "opened");
    expect(created.replay).toBe(false);
    expect(created.session.session_id.startsWith("review_session_request_")).toBe(true);
    expect(created.session).toMatchObject({ status: "created", kit_instance_bindings: [], created_by: "coordinator-ready-review-request",
      ready_model_id: READY_ID, trace_id: ROOT_TRACE });
    expect(reviewRequestCarrierIntegrity(created.session)).toBe("canonical");
    expect(events(h, created.session.session_id)).toEqual([{ type: "sessionCreated", payload: {
      project_id: "project-test", model_version_id: "v1",
      review_request_id: created.session.review_request_id, review_request_fingerprint: created.session.review_request_fingerprint,
    } }]);
    const replay = expectKind(await openReady(h, intent), "opened");
    expect([replay.session.session_id, replay.replay]).toEqual([created.session.session_id, true]);
    expect(h.eventLog.list(created.session.session_id)).toHaveLength(1);

    const release = gateProbes(h);
    const both = Promise.all([1, 2].map(() => openReady(h, { mode: "create_new", request_id: "req-0002" })));
    await settle();
    expect(h.health.probes).toHaveLength(3);
    release();
    const [leader, joined] = (await both).map((outcome) => expectKind(outcome, "opened"));
    expect(joined.session.session_id).toBe(leader.session.session_id);
    expect([leader.replay, joined.replay], "a joined create_new request answers as a replay").toEqual([false, true]);

    h.health.gate = null;
    const legacyOpened = expectKind(await openReady(h, legacy), "opened");
    expect(legacyOpened.replay).toBe(false);
    expect(legacyOpened.session.session_id.startsWith("review_session_request_")).toBe(false);
  });

  it("create_new: refuses a stored request session that was altered, and a request id reused after the model was re-converted", async () => {
    const h = harness();
    const altered = expectKind(await openReady(h, { mode: "create_new", request_id: "req-altered" }), "opened").session;
    tamper(h, altered.session_id, (session) => { session.review_request_fingerprint = "f".repeat(64); });
    expect(await openReady(h, { mode: "create_new", request_id: "req-altered" })).toEqual({ kind: "carrier_corrupt" });

    const reused = expectKind(await openReady(h, { mode: "create_new", request_id: "req-reused" }), "opened").session;
    recordReadyModel(h.ledger, "stream_conv_second");
    expect(await openReady(h, { mode: "create_new", request_id: "req-reused" })).toEqual({ kind: "idempotency_conflict" });
    // The session of the earlier conversion no longer matches the model's ready source.
    expect(await openReady(h, { mode: "open_existing", session_id: reused.session_id })).toEqual({ kind: "source_mismatch" });
  });

  it("open_existing: answers a matching open session as a replay, and refuses a missing, mismatched, closed or corrupt one", async () => {
    const h = harness();
    const requested = expectKind(await openReady(h, { mode: "create_new", request_id: "req-open" }), "opened").session;
    const legacySession = expectKind(await openReady(h, legacy), "opened").session;
    for (const session of [requested, legacySession]) {
      const opened = expectKind(await openReady(h, { mode: "open_existing", session_id: session.session_id }), "opened");
      expect([opened.session.session_id, opened.replay]).toEqual([session.session_id, true]);
    }
    expect(await openReady(h, { mode: "open_existing", session_id: "review_session_missing000000" })).toEqual({ kind: "review_session_not_found" });
    const unrelated = h.store.create({ project_id: "project-test", model_version_id: "v1", created_by: "fixture", kit_instance: KIT, artifact_bindings: [derived("x")] });
    expect(await openReady(h, { mode: "open_existing", session_id: unrelated.session_id })).toEqual({ kind: "source_mismatch" });
    h.store.setStatus(legacySession.session_id, "closed");
    expect(await openReady(h, { mode: "open_existing", session_id: legacySession.session_id })).toEqual({ kind: "not_mutable" });

    // Until bullet 3 of the ADR, open_existing does not refuse a review_request_id outside the request namespace; recreate does.
    h.store.setStatus(requested.session_id, "closed");
    const recreated = expectKind(await h.opening.recreate({ closedSessionId: requested.session_id, idempotencyKey: "recreate-open-0001" }), "created").session;
    tamper(h, recreated.session_id, (session) => { session.review_request_id = "e".repeat(64); });
    expectKind(await openReady(h, { mode: "open_existing", session_id: recreated.session_id }), "opened");
    expect(reviewRequestCarrierIntegrity(h.store.get(recreated.session_id) as ReviewSession)).toBe("corrupt");
    tamper(h, requested.session_id, (session) => { session.review_request_id = "c".repeat(64); });
    expect(await openReady(h, { mode: "open_existing", session_id: requested.session_id })).toEqual({ kind: "carrier_corrupt" });
  });

  it("refuses without opening a session when the ready model is unknown, unresolvable, unreachable, or changed while it was checked", async () => {
    const h = harness();
    expect(await h.opening.openForReadyModel({ readyModelId: "mw_ffffffffffffffff", intent: legacy })).toEqual({ kind: "ready_model_not_found" });
    h.results.answer = new Error("streaming conversion result API 503: busy");
    expect(await openReady(h, legacy)).toEqual({ kind: "resolver", reason: "result_unavailable" });
    h.results.answer = { tenant_id: "other-tenant" };
    expect(await openReady(h, legacy)).toEqual({ kind: "resolver", reason: "result_identity_mismatch" });
    h.results.answer = {};
    h.health.answer = { model_usdc_reachable: false };
    expect(await openReady(h, legacy)).toEqual({ kind: "ready_artifacts_unavailable" });
    h.health.answer = {};
    const release = gateProbes(h);
    const pending = openReady(h, legacy);
    await settle();
    recordReadyModel(h.ledger, "stream_conv_moved");
    release();
    expect(await pending).toEqual({ kind: "ready_model_changed" });
    expect(h.ledger.get(READY_ID)?.ready_render_bundle).toBeUndefined();
    expect(h.store.list()).toHaveLength(0);
  });
});

describe("ReviewSessionOpening.openForConversionTerminal", () => {
  function terminal(job: Partial<TerminalOpenCommand["job"]> = {}, command: Partial<Omit<TerminalOpenCommand, "job">> = {}): TerminalOpenCommand {
    return {
      job: { ifc_ready_job_id: "ifcready_job_0001", tenant_id: TENANT, project_id: "project-test", external_model_version_id: "v1",
        correlation_id: CORRELATION, review_session_id: null, intake_source: "minio_watch", idempotency_key: READY_ID, ...job },
      conversionJobId: JOB, usdcRef: MODEL_URL, elementMappingRef: MAPPING_URL, qualitySummary: null, ...command,
    };
  }

  it("opens an active session; only a watcher job is bound to its ready model; the artifact id falls back to the correlation id", () => {
    const h = harness();
    const watcher = expectKind(h.opening.openForConversionTerminal(terminal()), "opened");
    expect(watcher.replay).toBe(false);
    expect(watcher.session).toMatchObject({ status: "active", ready_model_id: READY_ID, trace_id: "ifcready_job_0001", usdc_artifact_id: `auto_usdc_${JOB}`,
      created_by: "coordinator-auto-conversion-ready" });
    expect(events(h, watcher.session.session_id).map((event) => event.type)).toEqual(["sessionCreated", "sessionActive"]);
    const external = expectKind(h.opening.openForConversionTerminal(terminal({ ifc_ready_job_id: "ifcready_job_0002", intake_source: "external" })), "opened");
    expect(external.session.ready_model_id).toBeUndefined();
    const withoutJob = expectKind(h.opening.openForConversionTerminal(terminal({ ifc_ready_job_id: "ifcready_job_0003" }, { conversionJobId: null })), "opened");
    expect(withoutJob.session.usdc_artifact_id).toBe(`auto_usdc_${CORRELATION}`);
  });

  it("binds the watcher session to its ready model, so the ready-model legacy open reuses it and fills its quality summary", async () => {
    const h = harness();
    const watcher = expectKind(h.opening.openForConversionTerminal(terminal({ ifc_ready_job_id: ROOT_TRACE })), "opened").session;
    expect(watcher.quality_metrics_summary).toBeNull();
    const legacyOpened = expectKind(await openReady(h, { mode: "legacy" }), "opened");
    expect([legacyOpened.session.session_id, legacyOpened.replay]).toEqual([watcher.session_id, true]);
    expect(legacyOpened.session.quality_metrics_summary).toMatchObject({ coverage_status: "pass" });
  });

  it("reuses the session the job recorded, filling a missing quality summary but never replacing one; a recorded session that is gone is opened anew", () => {
    const h = harness();
    const first = expectKind(h.opening.openForConversionTerminal(terminal()), "opened").session;
    const summary: ConversionQualityMetricsSummary = { coverage_status: "pass", coverage_ratio: 1 };
    const filled = expectKind(h.opening.openForConversionTerminal(terminal({ review_session_id: first.session_id }, { qualitySummary: summary })), "opened");
    expect([filled.session.session_id, filled.replay, filled.session.quality_metrics_summary]).toEqual([first.session_id, true, summary]);
    const kept = expectKind(h.opening.openForConversionTerminal(terminal({ review_session_id: first.session_id }, { qualitySummary: { coverage_status: "fail" } })), "opened");
    expect(kept.session.quality_metrics_summary).toEqual(summary);
    fs.rmSync(path.join(h.sessionsDir, `${first.session_id}.json`));
    const reopened = expectKind(h.opening.openForConversionTerminal(terminal({ review_session_id: first.session_id })), "opened");
    expect(reopened.replay).toBe(false);
    expect(reopened.session.session_id).not.toBe(first.session_id);
  });

  it("opens nothing for a conversion without a model, or without Kit capacity", () => {
    const h = harness();
    expect(h.opening.openForConversionTerminal(terminal({}, { usdcRef: null }))).toEqual({ kind: "no_usdc_ref" });
    vi.spyOn(kitPool, "allocateKitInstanceBindings").mockReturnValueOnce([]);
    expect(h.opening.openForConversionTerminal(terminal())).toEqual({ kind: "queued_for_instance" });
    expect(h.store.list()).toHaveLength(0);
  });
});
