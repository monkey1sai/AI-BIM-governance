// CFD Run Workflow interface tests (docs/architecture/cfd-run-workflow-adr.md, tracer bullet 1): the finding workflow and
// overlay registration / removal, through the workflow's own interface. The streaming CFD job service and governance
// `/api/issues` are in-memory adapters; the session store and the run ledger are the real in-process implementations.
// Wire mapping (status codes, error_code values, body envelopes) stays in cfd-run-routes.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cfdFindingEvaluation, cfdRunCreateRequest, cfdRunLedgerRecord, cfdRunResult } from "../src/contract/schemas/cfd.js";
import { CfdRunLedger } from "../src/services/cfdRunLedger.js";
import { CfdRunWorkflow, type BindOverlayCommand, type CreateRunCommand, type EvaluateFindingsCommand } from "../src/services/cfdRunWorkflow/index.js";
import { isCanonicalReadyReviewSourceCarrier, SessionStore } from "../src/services/sessionStore.js";
import type { ArtifactBinding } from "../src/types.js";
import {
  CONVERSION_ID,
  createCanonicalSession,
  createSession,
  InMemoryCfdRunPort,
  InMemoryConversionResultPort,
  InMemoryGovernanceIssuePort,
  MODEL_SHA,
  modelBinding,
  RecordingLog,
  RUN_NOT_FOUND,
  runRequest,
  streamingDown,
} from "./helpers/fakeCfdRunWorkflowDeps.js";

const RUN = "cfd_20260921T070000Z_mem001";
const OTHER_RUN = "cfd_20260101T000000Z_nope01";
const ORIGIN = { session_id: "review_session_abc123", wind_from_degrees: [0, 45, 22.5], uref_m_s: 5, end_time: 600, n_procs: 8, background_cell_m: null };
const TOKEN_REJECTED = "streaming CFD job service rejected the coordinator internal token";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function harness(options: {
  client?: InMemoryCfdRunPort; governance?: InMemoryGovernanceIssuePort; conversions?: InMemoryConversionResultPort;
  makeStore?: (dir: string) => SessionStore; makeLedger?: (file: string) => CfdRunLedger;
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cfd-run-workflow-"));
  roots.push(root);
  const client = options.client ?? new InMemoryCfdRunPort();
  const governance = options.governance ?? new InMemoryGovernanceIssuePort();
  const sessionsDir = path.join(root, "sessions");
  const store = options.makeStore ? options.makeStore(sessionsDir) : new SessionStore(sessionsDir);
  const ledgerFile = path.join(root, "cfd-run-ledger.json");
  const ledger = options.makeLedger ? options.makeLedger(ledgerFile) : new CfdRunLedger(ledgerFile);
  const log = new RecordingLog();
  const conversions = options.conversions ?? new InMemoryConversionResultPort();
  const workflow = new CfdRunWorkflow({
    client, conversionResults: conversions, governanceIssues: governance, store, ledger, publicCfdArtifactsUrl: "http://public.example:49101/cfd-artifacts/", log,
  });
  return { sessionsDir, client, conversions, governance, store, ledger, log, workflow };
}

type Harness = ReturnType<typeof harness>;

/** A ready run the coordinator created: the ledger row carries the browser origin. */
function readyRun(h: Harness, runId = RUN): string {
  const status = h.client.addRun(runId);
  h.ledger.upsertFromStatus(status, { principal: "operator_a", conversion_job_id: CONVERSION_ID, origin: ORIGIN });
  return runId;
}

function findings(overrides: Partial<EvaluateFindingsCommand> = {}): EvaluateFindingsCommand {
  return { runId: RUN, thresholdUMs: 3.4, modelVersionId: null, windFromDegrees: null, principal: "operator_a", ...overrides };
}

function bind(sessionId: string, windFromDegrees = 0, runId = RUN): BindOverlayCommand {
  return { sessionId, runId, windFromDegrees };
}

function expectKind<T extends { kind: string }, K extends T["kind"]>(outcome: T, kind: K): Extract<T, { kind: K }> {
  expect(outcome.kind, JSON.stringify(outcome)).toBe(kind);
  return outcome as Extract<T, { kind: K }>;
}

function patchDirections(h: Harness, edit: (directions: Array<Record<string, unknown>>) => void): void {
  h.client.resultPatch = (result) => edit(result.directions as Array<Record<string, unknown>>);
}

// Contract example directions: 0° → 3.58 m/s, 45° → 3.28 m/s, and the fixture's 22.5° copy of 45° (tag w022).

describe("CfdRunWorkflow.evaluateFindings", () => {
  it("opens one annotation per exceeding ready direction with screening text and records it in the ledger", async () => {
    const h = harness();
    readyRun(h);
    const outcome = expectKind(await h.workflow.evaluateFindings(findings({ modelVersionId: "version_cfd_001" })), "evaluated");
    expect(outcome).toMatchObject({ runId: RUN, thresholdUMs: 3.4, validationLevel: "screening", createdCount: 1 });
    expect(() => cfdFindingEvaluation.array().parse(outcome.evaluated)).not.toThrow();
    const byDeg = new Map(outcome.evaluated.map((row) => [row.wind_from_degrees, row]));
    expect(byDeg.get(0)).toMatchObject({ u_max_m_s: 3.58, exceeds: true, idempotent_replay: false, skipped_reason: null });
    expect(byDeg.get(45)).toMatchObject({ exceeds: false, finding: null, skipped_reason: "below_threshold" });
    expect(byDeg.get(22.5)?.skipped_reason).toBe("below_threshold");

    expect(h.governance.attempts).toHaveLength(1);
    const payload = h.governance.attempts[0];
    expect(payload.title).toContain("0°");
    expect(payload.title).toContain("3.58");
    expect(payload.title).toContain("screening");
    for (const text of ["validation_level=screening", "design_comparison_only", "true_north_default_direction", "相對 project north",
      `run_id=${RUN}`, "opened_by=operator_a", "本 run 共 3 個風向"]) {
      expect(payload.description).toContain(text);
    }
    expect(payload.severity).toBe("medium");
    expect(payload.model_version_id).toBe("version_cfd_001");
    expect(payload.usd_prim_path).toBe(`/World/Overlays/Cfd/${RUN}_w000/PedestrianWind_1p5m`);
    expect(payload).not.toHaveProperty("ifc_guid");

    const recorded = h.ledger.get(RUN)?.findings;
    expect(recorded).toHaveLength(1);
    expect(recorded?.[0]).toMatchObject({
      wind_from_degrees: 0, threshold_u_m_s: 3.4, u_max_m_s: 3.58, severity: "medium", issue_id: "iss_mem_0001", issue_kind: "annotation",
      model_version_id: "version_cfd_001", validation_level: "screening", opened_by: "operator_a",
    });
    expect(byDeg.get(0)?.finding).toEqual(recorded?.[0]);
  });

  it("replays a finding of the same run, direction, threshold and model binding without calling governance", async () => {
    const h = harness();
    readyRun(h);
    await h.workflow.evaluateFindings(findings());
    const findCalls = h.governance.findCalls;
    const replay = expectKind(await h.workflow.evaluateFindings(findings()), "evaluated");
    expect(replay.createdCount).toBe(0);
    expect(replay.evaluated.find((row) => row.wind_from_degrees === 0)).toMatchObject({ exceeds: true, idempotent_replay: true, skipped_reason: null });
    expect(h.governance.attempts).toHaveLength(1);
    expect(h.governance.findCalls).toBe(findCalls);

    // Another model binding is another finding; a requested angle the run does not have is reported first, not dropped.
    const rebound = expectKind(await h.workflow.evaluateFindings(findings({ modelVersionId: "version_cfd_002", windFromDegrees: [90, 0] })), "evaluated");
    expect(rebound.createdCount).toBe(1);
    expect(rebound.evaluated.map((row) => [row.wind_from_degrees, row.skipped_reason])).toEqual([[90, "not_in_run"], [0, null]]);
    expect(h.ledger.get(RUN)?.findings).toHaveLength(2);
  });

  it("treats a lower threshold as new findings; severity is high only above 1.5 × threshold; 22.5° keeps the upstream w022 tag", async () => {
    const h = harness();
    readyRun(h);
    await h.workflow.evaluateFindings(findings());
    const lower = expectKind(await h.workflow.evaluateFindings(findings({ thresholdUMs: 2 })), "evaluated");
    expect(lower.createdCount).toBe(3);
    expect(h.governance.attempts.slice(1).map((payload) => payload.severity)).toEqual(["high", "high", "high"]);
    expect(h.governance.attempts.find((payload) => payload.title.includes("22.5°"))?.usd_prim_path).toBe(`/World/Overlays/Cfd/${RUN}_w022/PedestrianWind_1p5m`);

    // Exactly 1.5 × threshold is still medium.
    patchDirections(h, (directions) => { (directions[0].pedestrian_1p5m as Record<string, unknown>).U_magnitude_max = 4.5; });
    const boundary = expectKind(await h.workflow.evaluateFindings(findings({ thresholdUMs: 3, windFromDegrees: [0] })), "evaluated");
    expect(boundary.evaluated[0].finding?.severity).toBe("medium");
  });

  it("takes the validation level from the result into the outcome, the issue text and the finding", async () => {
    const h = harness();
    readyRun(h);
    h.client.resultPatch = (result) => { result.validation_level = "mesh_convergence_checked"; };
    const outcome = expectKind(await h.workflow.evaluateFindings(findings()), "evaluated");
    expect(outcome.validationLevel).toBe("mesh_convergence_checked");
    expect(h.governance.attempts[0].description).toContain("validation_level=mesh_convergence_checked");
    expect(h.ledger.get(RUN)?.findings?.[0].validation_level).toBe("mesh_convergence_checked");
  });

  it("with a lost ledger, projects the run's status document and recovers the governance annotation instead of opening a duplicate", async () => {
    const first = harness();
    readyRun(first);
    await first.workflow.evaluateFindings(findings());
    // A second coordinator against the same streaming store and governance, with an empty ledger.
    const second = harness({ client: first.client, governance: first.governance });
    const recovered = expectKind(await second.workflow.evaluateFindings(findings()), "evaluated");
    expect(recovered.createdCount).toBe(0);
    expect(recovered.evaluated.find((row) => row.wind_from_degrees === 0)).toMatchObject({ idempotent_replay: true, finding: { issue_id: "iss_mem_0001" } });
    expect(first.governance.attempts).toHaveLength(1);
    expect(first.client.calls).toContain(`getRun ${RUN}`);
    const record = second.ledger.get(RUN);
    expect(record?.requested_by_principal).toBe("operator_a");
    expect(record?.findings).toHaveLength(1);
  });

  it("answers run_not_found when neither the ledger nor the streaming service knows the run, and unavailable when that lookup fails", async () => {
    const h = harness();
    h.client.addRun(RUN);
    h.client.replies.getRun = RUN_NOT_FOUND();
    expect(await h.workflow.evaluateFindings(findings())).toEqual({ kind: "run_not_found" });
    delete h.client.replies.getRun;
    h.client.failures.getRun = streamingDown();
    expect(await h.workflow.evaluateFindings(findings())).toEqual({ kind: "unavailable", detail: streamingDown().message });
    expect(h.governance.attempts).toHaveLength(0);
  });

  it("maps a ledger write failure while projecting a lost run to unavailable without surfacing the raw error", async () => {
    class FailingLedger extends CfdRunLedger {
      override upsertFromStatus(): never {
        throw new Error("EACCES: permission denied (fixture ledger path)");
      }
    }
    const h = harness({ makeLedger: (file) => new FailingLedger(file) });
    h.client.addRun(RUN);
    expect(await h.workflow.evaluateFindings(findings())).toEqual({ kind: "unavailable", detail: "streaming CFD job service error" });
    expect(h.governance.attempts).toHaveLength(0);
  });

  it("serializes concurrent evaluations of one run so each finding is opened once, and releases the run lock", async () => {
    const h = harness();
    readyRun(h);
    let open: () => void = () => {};
    h.governance.gate = new Promise<void>((resolve) => { open = resolve; });
    const both = Promise.all([h.workflow.evaluateFindings(findings()), h.workflow.evaluateFindings(findings())]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The second evaluation waits on the run lock instead of racing the first to governance.
    expect(h.governance.attempts).toHaveLength(1);
    open();
    const outcomes = await both;
    expect(outcomes.map((outcome) => (outcome.kind === "evaluated" ? outcome.createdCount : -1)).sort()).toEqual([0, 1]);
    expect(h.governance.attempts).toHaveLength(1);
    expect(h.workflow.pendingFindingLocks()).toBe(0);
  });

  it("keeps serving later evaluations in order when one fails inside the run lock, and releases the lock", async () => {
    class FlakyLedger extends CfdRunLedger {
      failNextFinding = true;
      override addFinding(runId: string, finding: Parameters<CfdRunLedger["addFinding"]>[1]) {
        if (this.failNextFinding) {
          this.failNextFinding = false;
          throw new Error("ledger write failed (fixture)");
        }
        return super.addFinding(runId, finding);
      }
    }
    const h = harness({ makeLedger: (file) => new FlakyLedger(file) });
    readyRun(h);
    const settled = await Promise.allSettled([1, 2, 3].map(() => h.workflow.evaluateFindings(findings())));
    // The first opens the issue, then fails to record it; the second recovers it from governance; the third replays the ledger.
    expect(settled[0]).toMatchObject({ status: "rejected", reason: new Error("ledger write failed (fixture)") });
    const [second, third] = settled.slice(1).map((item) => (item.status === "fulfilled" ? item.value : null));
    expect(second).toMatchObject({ kind: "evaluated", createdCount: 0 });
    expect(third).toMatchObject({ kind: "evaluated", createdCount: 0 });
    expect(h.governance.attempts).toHaveLength(1);
    expect(h.governance.findCalls).toBe(2); // the first and the second asked governance; the third found the ledger row
    expect(h.ledger.get(RUN)?.findings).toHaveLength(1);
    expect(h.workflow.pendingFindingLocks()).toBe(0);
  });

  it("keeps findings recorded before a governance failure, reports them, and opens the rest on retry", async () => {
    const h = harness();
    readyRun(h);
    h.governance.failOnAttempt = 2;
    const partial = expectKind(await h.workflow.evaluateFindings(findings({ thresholdUMs: 2 })), "governance_unavailable");
    expect(partial.detail).toBe("governance POST /api/issues HTTP 500: stub failure");
    expect(partial.createdCount).toBe(1);
    expect(partial.evaluated.filter((row) => row.finding)).toHaveLength(1);
    expect(h.ledger.get(RUN)?.findings).toHaveLength(1);

    h.governance.failOnAttempt = null;
    const retry = expectKind(await h.workflow.evaluateFindings(findings({ thresholdUMs: 2 })), "evaluated");
    expect(retry.createdCount).toBe(2);
    expect(retry.evaluated.find((row) => row.wind_from_degrees === 0)?.idempotent_replay).toBe(true);
    expect(h.governance.attempts).toHaveLength(4);
  });

  it("reports a governance lookup failure without opening or recording anything", async () => {
    const h = harness();
    readyRun(h);
    h.governance.failFind = true;
    const failed = expectKind(await h.workflow.evaluateFindings(findings({ thresholdUMs: 1 })), "governance_unavailable");
    expect(failed).toMatchObject({ detail: "governance GET /api/issues HTTP 503", createdCount: 0 });
    expect(h.governance.attempts).toHaveLength(0);
    expect(h.ledger.get(RUN)?.findings).toBeUndefined();
  });

  it("reports an exceedance without an overlay artifact of this run (overlay_missing) and a direction that is not ready, opening no issue for either", async () => {
    const h = harness();
    readyRun(h);
    patchDirections(h, (directions) => {
      directions[0].overlay_layer = null; // 0°: ready, 3.58 m/s, no overlay layer
      (directions[1].overlay_layer as Record<string, unknown>).artifact_id = "cfd:cfd_20260101T000000Z_other1:w045"; // 45°: another run's layer
    });
    const outcome = expectKind(await h.workflow.evaluateFindings(findings({ thresholdUMs: 2 })), "evaluated");
    const rows = new Map(outcome.evaluated.map((row) => [row.wind_from_degrees, row]));
    for (const deg of [0, 45]) expect(rows.get(deg)).toMatchObject({ exceeds: true, finding: null, skipped_reason: "overlay_missing" });
    expect(outcome.createdCount).toBe(1);
    expect(h.governance.attempts.map((payload) => payload.usd_prim_path)).toEqual([`/World/Overlays/Cfd/${RUN}_w022/PedestrianWind_1p5m`]);

    patchDirections(h, (directions) => {
      directions[1].status = "failed";
      directions[2].pedestrian_1p5m = null;
    });
    const skipped = expectKind(await h.workflow.evaluateFindings(findings({ thresholdUMs: 1, windFromDegrees: [45, 22.5] })), "evaluated");
    expect(skipped.evaluated).toEqual([
      { wind_from_degrees: 45, u_max_m_s: 3.28, exceeds: false, finding: null, idempotent_replay: false, skipped_reason: "direction_not_ready" },
      { wind_from_degrees: 22.5, u_max_m_s: null, exceeds: false, finding: null, idempotent_replay: false, skipped_reason: "direction_not_ready" },
    ]);
    expect(skipped.createdCount).toBe(0);
  });

  it("forwards the streaming service's refusals (409 not ready, 404 unknown run) and maps 401/403 and failures to unavailable", async () => {
    const h = harness();
    readyRun(h);
    h.client.setStatus(RUN, "solving");
    expect(await h.workflow.evaluateFindings(findings())).toEqual({ kind: "forwarded", status: 409, body: { error_code: "not_ready", detail: "run is solving" } });
    // Defensive: a 200 result whose run is not ready (the real service answers 409 first) is still refused.
    h.client.replies.getRunResult = { status: 200, body: { run_id: RUN, status: "postprocessing", directions: [] } };
    expect(await h.workflow.evaluateFindings(findings())).toEqual({ kind: "run_not_ready", runStatus: "postprocessing" });
    delete h.client.replies.getRunResult;
    h.client.setStatus(RUN, "ready");
    expect(await h.workflow.evaluateFindings(findings({ runId: OTHER_RUN }))).toEqual({ kind: "forwarded", ...RUN_NOT_FOUND() });
    h.client.replies.getRunResult = { status: 401, body: { error_code: "missing_token" } };
    expect(await h.workflow.evaluateFindings(findings())).toEqual({ kind: "unavailable", detail: TOKEN_REJECTED });
    h.client.replies.getRunResult = { status: 403, body: {} };
    expect(await h.workflow.evaluateFindings(findings())).toEqual({ kind: "unavailable", detail: TOKEN_REJECTED });
    delete h.client.replies.getRunResult;
    h.client.failures.getRunResult = streamingDown();
    expect(await h.workflow.evaluateFindings(findings())).toEqual({ kind: "unavailable", detail: streamingDown().message });
    h.client.failures.getRunResult = new Error("socket hang up");
    expect(await h.workflow.evaluateFindings(findings())).toEqual({ kind: "unavailable", detail: "streaming CFD job service error" });
    expect(h.governance.attempts).toHaveLength(0);
  });
});

describe("CfdRunWorkflow overlays", () => {
  it("binds a ready direction's overlay layer onto the session's model, replays it, and stacks the next direction on top", async () => {
    const h = harness();
    h.client.addRun(RUN);
    const sessionId = createSession(h.store, "ov1");
    const bound = expectKind(await h.workflow.bindOverlay(bind(sessionId)), "bound");
    expect(bound).toMatchObject({ sessionId, runId: RUN, windFromDegrees: 0 });
    expect(bound.binding).toEqual({
      binding_id: `binding_cfd_${RUN}_w000`, artifact_group_id: "group_ov1", model_version_id: "version_cfd_ov1",
      artifact_id: `cfd:${RUN}:w000`, display_name: "CFD 0° (design comparison only)", artifact_role: "overlay",
      url: `http://public.example:49101/cfd-artifacts/${RUN}/${RUN}_w000.usdc`, mapping_url: null, load_order: 1,
      routing_policy: "same_instance", ready_status: "ready", conversion_authority: "bim-streaming-server",
      conversion_job_id: CONVERSION_ID, conversion_status: "ready", failure_code: null, diagnostic: null,
    });
    expect(h.store.get(sessionId)?.artifact_bindings.map((binding) => binding.artifact_id)).toEqual(["artifact_ov1", `cfd:${RUN}:w000`]);

    const replay = expectKind(await h.workflow.bindOverlay(bind(sessionId)), "replayed");
    expect(replay.binding).toEqual(bound.binding);
    expect(h.store.get(sessionId)?.artifact_bindings).toHaveLength(2);

    const next = expectKind(await h.workflow.bindOverlay(bind(sessionId, 45)), "bound");
    expect(next.binding.load_order).toBe(2);
  });

  it("takes the overlay identity verbatim from upstream: 22.5° is w022, and 23° is not a computed direction", async () => {
    const h = harness();
    h.client.addRun(RUN);
    const sessionId = createSession(h.store, "half");
    const half = expectKind(await h.workflow.bindOverlay(bind(sessionId, 22.5)), "bound");
    expect(half.binding.artifact_id).toBe(`cfd:${RUN}:w022`);
    expect(half.binding.url).toBe(`http://public.example:49101/cfd-artifacts/${RUN}/${RUN}_w022.usdc`);
    expect(await h.workflow.bindOverlay(bind(sessionId, 23))).toEqual({ kind: "direction_not_ready" });
  });

  it("refuses directions without a ready overlay layer, and treats a malformed upstream artifact id as unavailable", async () => {
    const h = harness();
    h.client.addRun(RUN);
    const sessionId = createSession(h.store, "dnr");
    expect(await h.workflow.bindOverlay(bind(sessionId, 90))).toEqual({ kind: "direction_not_ready" });
    patchDirections(h, (directions) => {
      directions[0].status = "failed";
      directions[1].overlay_layer = null;
      delete (directions[2].overlay_layer as Record<string, unknown>).filename;
    });
    for (const deg of [0, 45, 22.5]) expect(await h.workflow.bindOverlay(bind(sessionId, deg))).toEqual({ kind: "direction_not_ready" });
    patchDirections(h, (directions) => { (directions[0].overlay_layer as Record<string, unknown>).artifact_id = "cfd:not a run id:w000"; });
    expect(await h.workflow.bindOverlay(bind(sessionId))).toEqual({ kind: "unavailable", detail: "upstream overlay artifact_id is malformed" });
    expect(h.store.get(sessionId)?.artifact_bindings).toHaveLength(1);
  });

  it("refuses a run of another model and a session without a model binding; a model binding without a conversion id is not compared", async () => {
    const h = harness();
    h.client.addRun(RUN);
    const other = createSession(h.store, "other", { conversionJobId: "stream_conv_20260920000000_0ther001" });
    expect(await h.workflow.bindOverlay(bind(other))).toEqual({ kind: "model_mismatch" });
    expect(h.store.get(other)?.artifact_bindings).toHaveLength(1);
    const empty = createSession(h.store, "empty", { bindings: [] });
    expect(await h.workflow.bindOverlay(bind(empty))).toEqual({ kind: "session_without_model" });
    const legacy = createSession(h.store, "legacy", { conversionJobId: null });
    expect(expectKind(await h.workflow.bindOverlay(bind(legacy)), "bound").binding.conversion_job_id).toBe(CONVERSION_ID);
  });

  it("accepts overlays only on created and active sessions, without asking the streaming service otherwise", async () => {
    const h = harness();
    h.client.addRun(RUN);
    expect(await h.workflow.bindOverlay(bind("review_session_nope00000000"))).toEqual({ kind: "session_not_found" });
    for (const status of ["closing", "closed", "failed"] as const) {
      const sessionId = createSession(h.store, status);
      h.store.setStatus(sessionId, status);
      expect(await h.workflow.bindOverlay(bind(sessionId))).toEqual({ kind: "session_not_active", sessionStatus: status });
    }
    const active = createSession(h.store, "active");
    h.store.setStatus(active, "active");
    expect((await h.workflow.bindOverlay(bind(active))).kind).toBe("bound");
    expect(h.client.calls.filter((call) => call.startsWith("getRunResult"))).toHaveLength(1);
  });

  it("re-reads the session after fetching the result: removed meanwhile is session_not_found, registered meanwhile is a replay", async () => {
    const h = harness();
    h.client.addRun(RUN);
    const gone = createSession(h.store, "gone");
    h.client.onResultFetch = () => { fs.rmSync(path.join(h.sessionsDir, `${gone}.json`)); };
    expect(await h.workflow.bindOverlay(bind(gone))).toEqual({ kind: "session_not_found" });

    const raced = createSession(h.store, "raced");
    const concurrent: ArtifactBinding = { ...modelBinding("raced"), binding_id: "binding_concurrent", artifact_id: `cfd:${RUN}:w000`, artifact_role: "overlay", load_order: 1 };
    h.client.onResultFetch = () => {
      const session = h.store.get(raced);
      h.store.update(raced, { artifact_bindings: [...(session?.artifact_bindings ?? []), concurrent] });
    };
    const replay = expectKind(await h.workflow.bindOverlay(bind(raced)), "replayed");
    expect(replay.binding.binding_id).toBe("binding_concurrent");
    expect(h.store.get(raced)?.artifact_bindings).toHaveLength(2);
  });

  it("a canonical ready-review session accepts the overlay and keeps its source projection valid through removal", async () => {
    const h = harness();
    h.client.addRun(RUN);
    const sessionId = createCanonicalSession(h.store, "3");
    const bound = expectKind(await h.workflow.bindOverlay(bind(sessionId, 45)), "bound");
    expect(h.store.get(sessionId)?.artifact_bindings.map((binding) => binding.artifact_role)).toEqual(["derived", "overlay"]);
    expect(isCanonicalReadyReviewSourceCarrier(h.store.get(sessionId))).toBe(true);
    // The overlay exception is narrow: the store still refuses a second model binding on the same session.
    const session = h.store.get(sessionId);
    if (!session) throw new Error("canonical session missing");
    const secondModel = { ...session.artifact_bindings[0], binding_id: "binding_dup", artifact_id: "auto_usdc_other" };
    expect(() => h.store.update(sessionId, { artifact_bindings: [...session.artifact_bindings, secondModel] })).toThrow(/Invalid ready review source projection/);
    expect(await h.workflow.unbindOverlay(sessionId, bound.binding.binding_id)).toEqual({ kind: "removed", sessionId, bindingId: bound.binding.binding_id });
    expect(isCanonicalReadyReviewSourceCarrier(h.store.get(sessionId))).toBe(true);
  });

  it("answers session_not_overlayable when the session store refuses the write, and changes nothing", async () => {
    class RefusingStore extends SessionStore {
      override update(): never {
        throw new Error("Invalid ready review source projection: refused by fixture");
      }
    }
    const h = harness({ makeStore: (dir) => new RefusingStore(dir) });
    h.client.addRun(RUN);
    const sessionId = createSession(h.store, "refuse");
    expect(await h.workflow.bindOverlay(bind(sessionId))).toEqual({ kind: "session_not_overlayable", detail: "Invalid ready review source projection: refused by fixture" });
    expect(h.store.get(sessionId)?.artifact_bindings).toHaveLength(1);
  });

  it("maps upstream replies on registration: other statuses forwarded, 401/403 and failures unavailable", async () => {
    const h = harness();
    h.client.addRun(RUN);
    const sessionId = createSession(h.store, "up");
    expect(await h.workflow.bindOverlay(bind(sessionId, 0, OTHER_RUN))).toEqual({ kind: "forwarded", ...RUN_NOT_FOUND() });
    h.client.addRun("cfd_20260921T070000Z_mem002", { status: "cancelled" });
    expect(await h.workflow.bindOverlay(bind(sessionId, 0, "cfd_20260921T070000Z_mem002"))).toEqual({ kind: "forwarded", status: 409, body: { error_code: "not_ready", detail: "run is cancelled" } });
    h.client.replies.getRunResult = { status: 403, body: {} };
    expect(await h.workflow.bindOverlay(bind(sessionId))).toEqual({ kind: "unavailable", detail: TOKEN_REJECTED });
    delete h.client.replies.getRunResult;
    h.client.failures.getRunResult = streamingDown();
    expect(await h.workflow.bindOverlay(bind(sessionId))).toEqual({ kind: "unavailable", detail: streamingDown().message });
    expect(h.store.get(sessionId)?.artifact_bindings).toHaveLength(1);
  });

  it("removes only overlay bindings", async () => {
    const h = harness();
    h.client.addRun(RUN);
    const sessionId = createSession(h.store, "rm");
    const bound = expectKind(await h.workflow.bindOverlay(bind(sessionId)), "bound");
    expect(await h.workflow.unbindOverlay(sessionId, "binding_model_rm")).toEqual({ kind: "binding_not_found" });
    expect(await h.workflow.unbindOverlay(sessionId, "binding_nope")).toEqual({ kind: "binding_not_found" });
    expect(await h.workflow.unbindOverlay("review_session_nope00000000", bound.binding.binding_id)).toEqual({ kind: "session_not_found" });
    expect(await h.workflow.unbindOverlay(sessionId, bound.binding.binding_id)).toEqual({ kind: "removed", sessionId, bindingId: bound.binding.binding_id });
    expect(h.store.get(sessionId)?.artifact_bindings.map((binding) => binding.binding_id)).toEqual(["binding_model_rm"]);
    expect(h.log.warnings).toEqual([]);
  });

  it("logs a session that vanishes during removal and still answers removed", async () => {
    class VanishingStore extends SessionStore {
      override update(): null {
        return null;
      }
    }
    const h = harness({ makeStore: (dir) => new VanishingStore(dir) });
    const overlay: ArtifactBinding = { ...modelBinding("van"), binding_id: "binding_overlay_van", artifact_id: `cfd:${RUN}:w000`, artifact_role: "overlay", load_order: 1 };
    const sessionId = createSession(h.store, "van", { bindings: [modelBinding("van"), overlay] });
    expect(await h.workflow.unbindOverlay(sessionId, "binding_overlay_van")).toEqual({ kind: "removed", sessionId, bindingId: "binding_overlay_van" });
    expect(h.log.warnings).toEqual([{
      component: "cfd-overlays", msg: "review session vanished while its CFD overlay binding was being removed",
      data: { session_id: sessionId, binding_id: "binding_overlay_van" },
    }]);
  });
});

describe("CfdRunWorkflow runs", () => {
  const WIND = runRequest().wind as { wind_from_degrees: number[]; uref_m_s: number };

  function create(overrides: Record<string, unknown> = {}, traceId = "trace_cfd_fixture_create"): CreateRunCommand {
    return { request: cfdRunCreateRequest.parse(runRequest(overrides)), principal: "operator_a", traceId };
  }

  function created(outcome: Awaited<ReturnType<CfdRunWorkflow["createRun"]>>): string {
    const forwarded = expectKind(outcome, "forwarded");
    return forwarded.body.run_id as string;
  }

  class SwitchableLedger extends CfdRunLedger {
    failWrites = false;
    override upsertFromStatus(...args: Parameters<CfdRunLedger["upsertFromStatus"]>) {
      if (this.failWrites) throw new Error("EACCES: permission denied (fixture ledger path)");
      return super.upsertFromStatus(...args);
    }
  }

  it("binds the run to the conversion's model.usdc, fills requested_by, keeps origin out of the request and records it on 202", async () => {
    const h = harness();
    const outcome = await h.workflow.createRun(create({ origin: { session_id: "review_session_abc123" }, solver: { end_time: 900, n_procs: 4 } }));
    expect(outcome).toMatchObject({ kind: "forwarded", status: 202, body: { status: "queued", idempotent_replay: false } });
    const runId = created(outcome);
    expect(h.conversions.calls).toEqual([CONVERSION_ID]);
    const posted = h.client.posts[0];
    expect(posted.source).toEqual({ conversion_job_id: CONVERSION_ID, model_usdc_sha256: MODEL_SHA });
    expect(posted.requested_by).toEqual({ principal: "operator_a", trace_id: "trace_cfd_fixture_create" });
    expect(posted).not.toHaveProperty("origin");
    const record = h.ledger.get(runId);
    expect(() => cfdRunLedgerRecord.parse(record)).not.toThrow();
    expect(record).toMatchObject({ conversion_job_id: CONVERSION_ID, requested_by_principal: "operator_a", status: "queued", queue_position: 1 });
    expect(record?.origin).toEqual({
      session_id: "review_session_abc123", wind_from_degrees: WIND.wind_from_degrees, uref_m_s: WIND.uref_m_s, end_time: 900, n_procs: 4,
      background_cell_m: 6, zref_m: 10, z0_m: 0.5, true_north_source: "geo_reference", true_north_degrees_manual: null, preset_match: null,
    });
  });

  it("keeps the recorded origin on a 200 replay, whose body the streaming service ignored", async () => {
    const h = harness();
    const runId = created(await h.workflow.createRun(create({ idempotency_key: "cfdreq_origin_000001", origin: { session_id: "review_session_abc123" } })));
    const replay = await h.workflow.createRun(create({
      idempotency_key: "cfdreq_origin_000001", origin: { session_id: "review_session_other999" }, wind: { ...WIND, wind_from_degrees: [90] },
    }));
    expect(replay).toMatchObject({ kind: "forwarded", status: 200, body: { run_id: runId, idempotent_replay: true } });
    expect(h.ledger.get(runId)?.origin).toMatchObject({ session_id: "review_session_abc123", wind_from_degrees: WIND.wind_from_degrees });
  });

  it("records the terrain and true-north settings; a manual angle counts only with the manual source; the preset match comes from streaming", async () => {
    const h = harness();
    const manual = created(await h.workflow.createRun(create({
      idempotency_key: "cfdreq_s8_manual_01", mesh: {},
      wind: { ...WIND, zref_m: 12, z0_m: 0.3, true_north_source: "manual", true_north_degrees_manual: -12.5 },
    })));
    expect(h.ledger.get(manual)?.origin).toMatchObject({ zref_m: 12, z0_m: 0.3, true_north_source: "manual", true_north_degrees_manual: -12.5, preset_match: "standard" });
    const geo = created(await h.workflow.createRun(create({ idempotency_key: "cfdreq_s8_geo_0001", wind: { ...WIND, true_north_degrees_manual: 30 } })));
    expect(h.ledger.get(geo)?.origin).toMatchObject({ true_north_source: "geo_reference", true_north_degrees_manual: null, preset_match: null });
  });

  it("passes refusals through without a ledger record, and maps a refused token, an unreachable service or a ledger write failure to unavailable", async () => {
    const h = harness({ makeLedger: (file) => new SwitchableLedger(file) });
    h.client.replies.createRun = { status: 422, body: { error_code: "compute_cap_exceeded", detail: "estimated cells exceed the cap (fixture)" } };
    expect(await h.workflow.createRun(create())).toEqual({ kind: "forwarded", status: 422, body: { error_code: "compute_cap_exceeded", detail: "estimated cells exceed the cap (fixture)" } });
    h.client.replies.createRun = { status: 503, body: { error_code: "worker_unavailable", detail: "docker missing (fixture)" } };
    expect((await h.workflow.createRun(create())).kind).toBe("forwarded");
    expect(h.ledger.list()).toEqual([]);
    h.client.replies.createRun = { status: 401, body: { error_code: "missing_token" } };
    expect(await h.workflow.createRun(create())).toEqual({ kind: "unavailable", detail: TOKEN_REJECTED });
    delete h.client.replies.createRun;
    h.client.failures.createRun = streamingDown();
    expect(await h.workflow.createRun(create())).toEqual({ kind: "unavailable", detail: streamingDown().message });
    delete h.client.failures.createRun;
    (h.ledger as SwitchableLedger).failWrites = true;
    expect(await h.workflow.createRun(create())).toEqual({ kind: "unavailable", detail: "streaming CFD job service error" });
  });

  it("refuses to create without an exact model, and never asks the streaming service then", async () => {
    const h = harness();
    expect(await h.workflow.createRun(create({ source: { conversion_job_id: "stream_conv_nope" } }))).toEqual({ kind: "conversion_not_found" });
    h.conversions.conversions.set(CONVERSION_ID, { ready: false, status: "running", checksum: MODEL_SHA });
    expect(await h.workflow.createRun(create())).toEqual({ kind: "source_not_ready", conversionStatus: "running" });
    h.conversions.conversions.set(CONVERSION_ID, { ready: true, status: "succeeded" });
    expect(await h.workflow.createRun(create())).toEqual({ kind: "source_mismatch" });
    h.conversions.conversions.set(CONVERSION_ID, { ready: true, status: "succeeded", checksum: "not-a-sha256" });
    expect(await h.workflow.createRun(create())).toEqual({ kind: "source_mismatch" });
    h.conversions.unavailable = true;
    expect(await h.workflow.createRun(create())).toEqual({ kind: "unavailable", detail: "streaming CFD job service error" });
    expect(h.client.posts).toEqual([]);
  });

  it("lists the ledger projection: refreshed when enabled, stale when streaming cannot be read, as-is when CFD is disabled", async () => {
    const h = harness();
    const first = created(await h.workflow.createRun(create({ idempotency_key: "cfdreq_list_000001" })));
    const second = created(await h.workflow.createRun(create({ idempotency_key: "cfdreq_list_000002" })));
    h.client.runs.set(first, { ...(h.client.runs.get(first) as Record<string, unknown>), created_at: "2026-09-21T06:25:00Z" });
    h.client.runs.set(second, { ...(h.client.runs.get(second) as Record<string, unknown>), created_at: "2026-09-21T06:26:00Z" });
    const listed = await h.workflow.listRuns({}, { enabled: true });
    expect(listed).toMatchObject({ kind: "records", enabled: true, stale: false });
    // FIFO rank among queued runs by created_at (the later submission ranks second); newest first in the list.
    expect(listed.items.map((item) => [item.run_id, item.queue_position])).toEqual([[second, 2], [first, 1]]);

    // A filtered refresh only projects the runs it returns: the detail read brings the finished run up to date first.
    h.client.setStatus(second, "ready");
    expect(expectKind(await h.workflow.getRun(second), "detail").ledger?.queue_position).toBeNull();
    const queued = await h.workflow.listRuns({ status: "queued" }, { enabled: true });
    expect(queued.items.map((item) => [item.run_id, item.queue_position])).toEqual([[first, 1]]);
    expect((await h.workflow.listRuns({ limit: 1 }, { enabled: true })).items).toHaveLength(1);
    // A run created elsewhere appears once the streaming list includes it.
    h.client.addRun("cfd_20260921T070000Z_elsewhere", { principal: "operator_b" });
    expect((await h.workflow.listRuns({}, { enabled: true })).items.map((item) => item.run_id)).toContain("cfd_20260921T070000Z_elsewhere");

    h.client.replies.listRuns = { status: 503, body: { error_code: "worker_unavailable" } };
    expect(await h.workflow.listRuns({}, { enabled: true })).toMatchObject({ enabled: true, stale: true, items: expect.arrayContaining([expect.objectContaining({ run_id: first })]) });
    delete h.client.replies.listRuns;
    h.client.failures.listRuns = streamingDown();
    expect((await h.workflow.listRuns({}, { enabled: true })).stale).toBe(true);
    const calls = h.client.calls.length;
    const disabled = await h.workflow.listRuns({}, { enabled: false });
    expect(disabled).toMatchObject({ enabled: false, stale: false });
    expect(disabled.items).toHaveLength(3);
    expect(h.client.calls).toHaveLength(calls);
  });

  it("reads a run's detail through the ledger, and falls back to the ledger alone when streaming cannot be read", async () => {
    const h = harness({ makeLedger: (file) => new SwitchableLedger(file) });
    const runId = created(await h.workflow.createRun(create()));
    h.client.setStatus(runId, "ready");
    const detail = expectKind(await h.workflow.getRun(runId), "detail");
    expect(detail.status.status).toBe("ready");
    expect(detail.ledger).toMatchObject({ run_id: runId, status: "ready", queue_position: null });

    expect(await h.workflow.getRun(OTHER_RUN)).toEqual({ kind: "forwarded", ...RUN_NOT_FOUND() });
    h.client.replies.getRun = { status: 403, body: {} };
    expect(await h.workflow.getRun(runId)).toEqual({ kind: "unavailable", detail: TOKEN_REJECTED });
    delete h.client.replies.getRun;

    h.client.failures.getRun = streamingDown();
    expect(await h.workflow.getRun(runId)).toMatchObject({ kind: "stale_record", ledger: { run_id: runId, status: "ready" } });
    expect(await h.workflow.getRun(OTHER_RUN)).toEqual({ kind: "unavailable", detail: streamingDown().message });
    delete h.client.failures.getRun;
    // A ledger that cannot be written behaves like an unreadable streaming service: the cached record is served.
    (h.ledger as SwitchableLedger).failWrites = true;
    expect((await h.workflow.getRun(runId)).kind).toBe("stale_record");
  });

  it("rewrites every artifact URL of a result to the public origin, and passes refusals through", async () => {
    const h = harness();
    const runId = created(await h.workflow.createRun(create()));
    expect(await h.workflow.getRunResult(runId)).toEqual({ kind: "forwarded", status: 409, body: { error_code: "not_ready", detail: "run is queued" } });
    h.client.setStatus(runId, "ready");
    const result = expectKind(await h.workflow.getRunResult(runId), "result");
    const parsed = cfdRunResult.parse(result.body);
    const base = `http://public.example:49101/cfd-artifacts/${runId}`;
    for (const direction of parsed.directions) expect(direction.overlay_layer?.url).toBe(`${base}/${direction.overlay_layer?.filename}`);
    expect(parsed.run_record.url).toBe(`${base}/run_record.json`);
    expect(parsed.exclusions.url).toBe(`${base}/exclusions.json`);
    h.client.failures.getRunResult = streamingDown();
    expect(await h.workflow.getRunResult(runId)).toEqual({ kind: "unavailable", detail: streamingDown().message });
  });

  it("passes exclusions, options and estimates through, forwarding the estimate body unchanged", async () => {
    const h = harness();
    const runId = created(await h.workflow.createRun(create()));
    expect(await h.workflow.getRunExclusions(runId)).toEqual({ kind: "forwarded", status: 409, body: { error_code: "not_ready", detail: "exclusion list not produced yet" } });
    h.client.setStatus(runId, "ready");
    expect(await h.workflow.getRunExclusions(runId)).toMatchObject({ kind: "forwarded", status: 200, body: { counts: { class_excluded: 454, outlier: 39 } } });
    expect(await h.workflow.getOptions()).toEqual({ kind: "forwarded", status: 200, body: { schema: "cfd-options/v1", presets: [] } });
    const estimateBody = { source: { conversion_job_id: CONVERSION_ID }, wind: { wind_from_degrees: [0] } };
    expect(await h.workflow.estimate(estimateBody)).toEqual({ kind: "forwarded", status: 200, body: { schema: "cfd-estimate/v1", available: true } });
    expect(h.client.estimatePosts).toEqual([estimateBody]);
    h.client.replies.getOptions = { status: 401, body: {} };
    expect(await h.workflow.getOptions()).toEqual({ kind: "unavailable", detail: TOKEN_REJECTED });
    h.client.failures.estimate = streamingDown();
    expect(await h.workflow.estimate(estimateBody)).toEqual({ kind: "unavailable", detail: streamingDown().message });
    h.client.failures.getRunExclusions = new Error("socket hang up");
    expect(await h.workflow.getRunExclusions(runId)).toEqual({ kind: "unavailable", detail: "streaming CFD job service error" });
  });

  it("cancels through the streaming service and projects the cancelled status; a run that already ended is refused as the service says", async () => {
    const h = harness();
    const runId = created(await h.workflow.createRun(create()));
    const cancelled = await h.workflow.cancelRun(runId);
    expect(cancelled).toMatchObject({ kind: "forwarded", status: 200, body: { status: "cancelled" } });
    expect(h.ledger.get(runId)).toMatchObject({ status: "cancelled", failure_code: "cancelled" });
    expect(await h.workflow.cancelRun(runId)).toEqual({ kind: "forwarded", status: 409, body: { error_code: "not_ready", detail: `run ${runId} is cancelled` } });
    h.client.failures.cancelRun = streamingDown();
    expect(await h.workflow.cancelRun(runId)).toEqual({ kind: "unavailable", detail: streamingDown().message });
    expect(h.ledger.get(runId)?.status).toBe("cancelled");
  });
});
