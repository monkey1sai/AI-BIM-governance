// In-memory adapters for the CFD Run Workflow (docs/architecture/cfd-run-workflow-adr.md §3): the streaming CFD job
// service as a run store serving contract-shaped documents, governance `/api/issues` as an annotation list, a
// recording logger, and review-session fixtures on the real SessionStore.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CfdUpstreamUnavailable, type CfdUpstreamReply } from "../../src/services/cfdRunClient.js";
import type { CfdFindingIssuePayload, CfdRunPort, GovernanceIssuePort, GovernanceIssueRef } from "../../src/services/cfdRunWorkflow/index.js";
import { fingerprintReadyReviewSource, readyReviewSourceSnapshot } from "../../src/services/readyReviewIntent.js";
import type { SessionStore } from "../../src/services/sessionStore.js";
import type { ArtifactBinding, KitInstance } from "../../src/types.js";

const CONTRACTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "contracts");
const RESULT_EXAMPLE = (JSON.parse(fs.readFileSync(path.join(CONTRACTS, "cfd-run-result-v1.schema.json"), "utf-8")) as { examples: Record<string, unknown>[] }).examples[0];

export const CONVERSION_ID = "stream_conv_20260915094906_54813240";
export const MODEL_SHA = "c29af95f494349290000000000000000000000000000000000000000000000ab";
export const LOOPBACK_ARTIFACTS = "http://127.0.0.1:49101/cfd-artifacts";

/** Python `round()` (banker's) as the streaming `wNNN` tag uses it: 22.5 → 22, where JS Math.round gives 23. */
export function pythonDirectionTag(deg: number): string {
  const rounded = deg % 1 === 0.5 ? 2 * Math.round(deg / 2) : Math.round(deg);
  return `w${String(rounded % 360).padStart(3, "0")}`;
}

/**
 * `cfd-run-result/v1` from the contract example (0° → 3.58 m/s, 45° → 3.28 m/s) plus a copy of 45° at 22.5°, with
 * overlay artifact ids and filenames tagged the way the streaming service tags them.
 */
export function resultDocument(runId: string, status: string, conversionJobId: string): Record<string, unknown> {
  const result = structuredClone(RESULT_EXAMPLE);
  result.run_id = runId;
  result.status = status;
  result.source = { conversion_job_id: conversionJobId, model_usdc_sha256: MODEL_SHA };
  const directions = result.directions as Array<Record<string, unknown>>;
  const half = structuredClone(directions[1]);
  half.wind_from_degrees = 22.5;
  directions.push(half);
  for (const direction of directions) {
    const layer = direction.overlay_layer as Record<string, unknown>;
    const tag = pythonDirectionTag(Number(direction.wind_from_degrees));
    layer.artifact_id = `cfd:${runId}:${tag}`;
    layer.filename = `${runId}_${tag}.usdc`;
    layer.url = `${LOOPBACK_ARTIFACTS}/${runId}/${layer.filename}`;
  }
  return result;
}

type RunMethod = "getRun" | "getRunResult";

/** The streaming CFD job store. Unknown runs answer 404 like the real service. */
export class InMemoryCfdRunPort implements CfdRunPort {
  /** Status documents by run id. */
  readonly runs = new Map<string, Record<string, unknown>>();
  /** Every call as `<method> <run id>`. */
  readonly calls: string[] = [];
  /** Canned reply per method (e.g. 401 token rejected, 404 for the status document only). */
  readonly replies: Partial<Record<RunMethod, CfdUpstreamReply>> = {};
  /** Error thrown per method (a `CfdUpstreamUnavailable` is what `CfdRunClient` throws when streaming is down). */
  readonly failures: Partial<Record<RunMethod, Error>> = {};
  /** Per-test edit of the served result document. */
  resultPatch: ((result: Record<string, unknown>) => void) | null = null;
  /** Runs while the result is being fetched, before it is answered (lets a test interleave a session change). */
  onResultFetch: (() => void) | null = null;

  addRun(runId: string, options: { status?: string; conversionJobId?: string; principal?: string } = {}): Record<string, unknown> {
    const doc: Record<string, unknown> = {
      schema: "cfd-run-status/v1", run_id: runId, status: options.status ?? "ready", failure_code: null, error: null,
      progress: { directions_total: 3, directions_done: 3 }, sealing_suspect: false, converged_count: 3, purpose: "design_comparison_only",
      created_at: "2026-09-21T06:25:00Z", updated_at: "2026-09-21T06:31:12Z",
      source: { conversion_job_id: options.conversionJobId ?? CONVERSION_ID, model_usdc_sha256: MODEL_SHA },
      requested_by: { principal: options.principal ?? "operator_a", trace_id: "trace_cfd_fixture" },
    };
    this.runs.set(runId, doc);
    return doc;
  }

  setStatus(runId: string, status: string): void {
    const doc = this.runs.get(runId);
    if (!doc) throw new Error(`no run ${runId}`);
    doc.status = status;
  }

  async getRun(runId: string): Promise<CfdUpstreamReply> {
    this.answerFirst("getRun", runId);
    const canned = this.replies.getRun;
    if (canned) return structuredClone(canned);
    const doc = this.runs.get(runId);
    return doc ? { status: 200, body: structuredClone(doc) } : { status: 404, body: { detail: "CFD run not found." } };
  }

  async getRunResult(runId: string): Promise<CfdUpstreamReply> {
    this.answerFirst("getRunResult", runId);
    this.onResultFetch?.();
    const canned = this.replies.getRunResult;
    if (canned) return structuredClone(canned);
    const doc = this.runs.get(runId);
    if (!doc) return { status: 404, body: { detail: "CFD run not found." } };
    const result = resultDocument(runId, String(doc.status), String((doc.source as { conversion_job_id: string }).conversion_job_id));
    this.resultPatch?.(result);
    return { status: 200, body: result };
  }

  private answerFirst(method: RunMethod, runId: string): void {
    this.calls.push(`${method} ${runId}`);
    const failure = this.failures[method];
    if (failure) throw failure;
  }
}

export function streamingDown(): CfdUpstreamUnavailable {
  return new CfdUpstreamUnavailable("streaming CFD job service unreachable: connect ECONNREFUSED 127.0.0.1:49101");
}

interface StoredAnnotation {
  id: string;
  kind: string;
  title: string;
  usd_prim_path: string;
  model_version_id: string | null;
}

/** governance `/api/issues`: records every create attempt, stores the successful ones as annotations. */
export class InMemoryGovernanceIssuePort implements GovernanceIssuePort {
  /** Every createIssue payload in call order, including attempts that failed. */
  readonly attempts: CfdFindingIssuePayload[] = [];
  readonly stored: StoredAnnotation[] = [];
  findCalls = 0;
  /** 1-based createIssue attempt that rejects (governance 5xx); null = none. */
  failOnAttempt: number | null = null;
  /** Every findAnnotation call rejects. */
  failFind = false;
  /** createIssue waits for this before answering (lets a test hold one evaluation mid-way). */
  gate: Promise<void> | null = null;

  async findAnnotation(query: { title: string; usdPrimPath: string; modelVersionId: string | null }): Promise<GovernanceIssueRef | null> {
    this.findCalls += 1;
    if (this.failFind) throw new Error("governance GET /api/issues HTTP 503");
    const match = this.stored.find((item) => item.usd_prim_path === query.usdPrimPath && item.title === query.title && item.model_version_id === query.modelVersionId);
    return match ? { id: match.id, kind: match.kind } : null;
  }

  async createIssue(payload: CfdFindingIssuePayload): Promise<GovernanceIssueRef> {
    this.attempts.push(payload);
    const attempt = this.attempts.length;
    if (this.gate) await this.gate;
    if (this.failOnAttempt === attempt) throw new Error("governance POST /api/issues HTTP 500: stub failure");
    const row: StoredAnnotation = {
      id: `iss_mem_${String(this.stored.length + 1).padStart(4, "0")}`, kind: "annotation", title: payload.title,
      usd_prim_path: payload.usd_prim_path, model_version_id: payload.model_version_id,
    };
    this.stored.push(row);
    return { id: row.id, kind: row.kind };
  }
}

export class RecordingLog {
  readonly warnings: Array<{ component: string; msg: string; data?: Record<string, unknown> }> = [];

  warn(component: string, msg: string, data?: Record<string, unknown>): void {
    this.warnings.push({ component, msg, data });
  }
}

export const KIT_INSTANCE: KitInstance = {
  instance_id: "kit_local_001", provider: "local_fixed", status: "ready",
  stream_server: "127.0.0.1", signaling_port: 49100, media_server: "127.0.0.1",
};

export function modelBinding(suffix: string, conversionJobId: string | null = CONVERSION_ID): ArtifactBinding {
  return {
    binding_id: `binding_model_${suffix}`, artifact_group_id: `group_${suffix}`, model_version_id: `version_cfd_${suffix}`,
    artifact_id: `artifact_${suffix}`, artifact_role: "derived", url: `http://127.0.0.1:49101/artifacts/${suffix}/model.usdc`,
    mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready",
    conversion_authority: "bim-streaming-server", conversion_job_id: conversionJobId, conversion_status: "ready",
  };
}

/** A review session (status `created`) whose only binding is the model; `bindings: []` makes one without a model. */
export function createSession(store: SessionStore, suffix: string, options: { conversionJobId?: string | null; bindings?: ArtifactBinding[] } = {}): string {
  return store.create({
    project_id: `project_cfd_${suffix}`, model_version_id: `version_cfd_${suffix}`, created_by: "cfd_fixture", kit_instance: KIT_INSTANCE,
    artifact_bindings: options.bindings ?? [modelBinding(suffix, options.conversionJobId === undefined ? CONVERSION_ID : options.conversionJobId)],
  }).session_id;
}

/** A session created the way `/api/ready-models/{id}/session create_new` does (ready_review_source carrier). */
export function createCanonicalSession(store: SessionStore, scopeDigit: string): string {
  const source = readyReviewSourceSnapshot({
    readyModelId: "mw_0123456789abcdef", conversionJobId: CONVERSION_ID,
    correlationId: "fixture", rootTraceId: "ifcready_request_fixture",
    tenantId: "tenant_001", projectId: "project_001", modelVersionId: "version_001",
    model: { url: "http://127.0.0.1:49101/artifacts/x/model.usdc", sha256: MODEL_SHA },
    mapping: { url: "http://127.0.0.1:49101/artifacts/x/element_mapping.json", sha256: "b".repeat(64) },
  });
  const result = store.createOrGetReviewRequest({
    ready_model_id: "mw_0123456789abcdef", trace_id: "ifcready_request_fixture",
    review_request_id: scopeDigit.repeat(64), review_request_fingerprint: fingerprintReadyReviewSource(source), ready_review_source: source,
    tenant_id: "tenant_001", project_id: "project_001", model_version_id: "version_001",
    usdc_artifact_id: `auto_usdc_${CONVERSION_ID}`, created_by: "coordinator-ready-review-request",
    mode: "single_kit_shared_state", kit_instance: KIT_INSTANCE,
    artifact_bindings: [{
      binding_id: "binding_auto_usdc", artifact_group_id: "ag_version_001", model_version_id: "version_001", artifact_id: `auto_usdc_${CONVERSION_ID}`,
      artifact_role: "derived", url: source.model.url, mapping_url: source.mapping.url, load_order: 0, routing_policy: "same_instance",
      ready_status: "ready", conversion_authority: "bim-streaming-server", conversion_job_id: CONVERSION_ID, conversion_status: "ready",
    }],
    kit_instance_bindings: [], quality_metrics_summary: null,
  });
  if (result.kind !== "created") throw new Error(`canonical session fixture: ${result.kind}`);
  return result.session.session_id;
}
