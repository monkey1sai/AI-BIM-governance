// Coordinator Browser Contract — CFD wind-run routes (building-energy-cfd-p2-contract.md §3.2, slice S2).
//
// These zod schemas mirror the frozen JSON Schemas in tests/contracts/cfd-run-*-v1.schema.json.
// The browser never supplies source.model_usdc_sha256 or requested_by: the coordinator fills
// both before forwarding to the streaming job service, so the browser-facing create request is
// the request schema minus those two fields. Status / failure-code vocabularies are shared.
import { z } from "zod/v4";
import { named } from "../primitives.js";

export const cfdRunId = z.string().regex(/^cfd_[A-Za-z0-9_]{6,120}$/);
const conversionJobId = z.string().regex(/^[A-Za-z0-9._-]{1,200}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const cfdRunStatus = z.enum([
  "queued", "preprocessing", "meshing", "solving", "postprocessing", "ready", "failed", "cancelled",
]);
export const cfdFailureCode = z.enum([
  "source_mismatch", "preprocess_failed", "mesh_failed", "solver_failed", "postprocess_failed",
  "cancelled", "worker_unavailable", "cfd_disabled",
]);

// ── POST /api/cfd/runs ────────────────────────────────────────────────────────

export const cfdRunCreateRequest = named("CfdRunCreateRequest", z.strictObject({
  schema: z.literal("cfd-run-request/v1"),
  idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  source: z.strictObject({ conversion_job_id: conversionJobId }),
  preprocess: z.strictObject({
    profile: z.literal("exterior-wind/v1"),
    voxel_pitch_m: z.number().min(0.1).max(2).optional(),
    closing_radius_voxels: z.number().int().min(0).max(16).optional(),
    leak_fraction_limit: z.number().min(0).max(1).optional(),
  }),
  wind: z.strictObject({
    wind_from_degrees: z.array(z.number().min(0).lt(360)).min(1).max(16),
    uref_m_s: z.number().gt(0).max(40),
    zref_m: z.number().gt(0).max(200),
    z0_m: z.number().gt(0).max(5),
    true_north_source: z.enum(["geo_reference", "manual"]),
    true_north_degrees_manual: z.number().min(-180).max(180).nullable().optional(),
  }),
  mesh: z.strictObject({
    background_cell_m: z.number().min(0.5).max(20).nullable().optional(),
    surface_refinement_level: z.number().int().min(0).max(4).optional(),
    region_refinement_level: z.number().int().min(0).max(3).optional(),
  }),
  solver: z.strictObject({
    end_time: z.number().int().min(50).max(5000).optional(),
    n_procs: z.number().int().min(1).max(64).optional(),
  }),
  /** S7 (model-first wind panel): where the browser submitted from; recorded in the ledger only, never forwarded to streaming. */
  origin: z.strictObject({
    session_id: z.string().regex(/^review_session_[A-Za-z0-9_-]+$/).nullable().optional(),
  }).optional(),
}), "cfd-run-request/v1 minus source.model_usdc_sha256 and requested_by, which the coordinator fills; plus the optional browser origin kept in the ledger.");

/** S7: submission context and a parameter digest, so a run stays legible after its session is gone. */
export const cfdRunOrigin = named("CfdRunOrigin", z.strictObject({
  session_id: z.string().regex(/^review_session_[A-Za-z0-9_-]+$/).nullable(),
  wind_from_degrees: z.array(z.number().min(0).lt(360)).min(1).max(16),
  uref_m_s: z.number().gt(0).max(40),
  end_time: z.number().int().nullable(),
  n_procs: z.number().int().nullable(),
  background_cell_m: z.number().nullable(),
}));

/** Streaming `cfd-run-status/v1` document passed through (plus ledger markers). */
export const cfdRunStatusDocument = named("CfdRunStatusDocument", z.looseObject({
  schema: z.literal("cfd-run-status/v1"),
  run_id: cfdRunId,
  status: cfdRunStatus,
  failure_code: cfdFailureCode.nullable(),
  error: z.string().nullable().optional(),
  progress: z.strictObject({ directions_total: z.number().int(), directions_done: z.number().int() }),
  sealing_suspect: z.boolean().nullable(),
  converged_count: z.number().int(),
  purpose: z.literal("design_comparison_only"),
  created_at: z.string(),
  updated_at: z.string(),
  idempotent_replay: z.boolean().optional(),
}));

// ── Ledger (GET /api/cfd/runs, GET /api/cfd/runs/{runId}) ─────────────────────

export const cfdRunLedgerRecord = named("CfdRunLedgerRecord", z.strictObject({
  schema: z.literal("cfd-run-ledger-record/v1"),
  run_id: cfdRunId,
  conversion_job_id: conversionJobId,
  status: cfdRunStatus,
  directions_total: z.number().int().min(1).max(16),
  directions_done: z.number().int().min(0).max(16),
  converged_count: z.number().int().min(0).max(16),
  sealing_suspect: z.boolean().nullable(),
  failure_code: cfdFailureCode.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  requested_by_principal: z.string().min(1).max(200),
  /** S7: absent for runs created before the field existed. */
  origin: cfdRunOrigin.nullable().optional(),
  /** S7: 1-based position among queued runs, estimated by the coordinator from ledger created_at (the streaming FIFO is the authority); null unless queued. */
  queue_position: z.number().int().min(1).nullable().optional(),
  /** S6 A1 finding: issues the coordinator opened from this run through the existing governance `/api/issues`; absent for runs without findings. */
  findings: z.array(z.lazy(() => cfdFinding)).optional(),
}));

// ── S6 A1 finding: pedestrian-wind exceedance → governance issue (building-energy-cfd-p2-contract.md S6) ──
export const cfdFindingThreshold = z.number().min(0.5).max(30);
export const cfdFindingSeverity = z.enum(["medium", "high"]);
export const cfdValidationLevel = z.enum(["screening", "mesh_convergence_checked", "benchmark_compared"]);

export const cfdFindingRequest = named("CfdFindingRequest", z.strictObject({
  /** Pedestrian-plane |U|max above this opens an issue; screening default 5 m/s (top of the authored legend scale). */
  threshold_u_m_s: cfdFindingThreshold.default(5),
  /** Governance model_version_id the issue binds to (from the review session); null/absent = unbound annotation. */
  model_version_id: z.string().min(1).max(200).nullable().optional(),
  /** Subset of directions to evaluate; absent = every ready direction of the run. */
  wind_from_degrees: z.array(z.number().min(0).lt(360)).min(1).max(16).optional(),
}));

export const cfdFinding = named("CfdFinding", z.strictObject({
  wind_from_degrees: z.number().min(0).lt(360),
  threshold_u_m_s: cfdFindingThreshold,
  u_max_m_s: z.number(),
  severity: cfdFindingSeverity,
  issue_id: z.string().min(1).max(200),
  /** governance kind: `annotation` because a CFD finding is not bound to one IFC element. */
  issue_kind: z.enum(["issue", "annotation"]),
  model_version_id: z.string().nullable(),
  validation_level: cfdValidationLevel,
  /** Operator principal that opened the issue. */
  opened_by: z.string().min(1).max(200).optional(),
  created_at: z.string(),
}));

export const cfdFindingEvaluation = named("CfdFindingEvaluation", z.strictObject({
  wind_from_degrees: z.number().min(0).lt(360),
  u_max_m_s: z.number().nullable(),
  exceeds: z.boolean(),
  finding: cfdFinding.nullable(),
  idempotent_replay: z.boolean(),
  skipped_reason: z.enum(["direction_not_ready", "below_threshold", "not_in_run"]).nullable(),
}));

export const cfdFindingResponse = named("CfdFindingResponse", z.strictObject({
  run_id: cfdRunId,
  threshold_u_m_s: cfdFindingThreshold,
  validation_level: cfdValidationLevel,
  purpose: z.literal("design_comparison_only"),
  created_count: z.number().int().min(0),
  evaluated: z.array(cfdFindingEvaluation),
}));

export const cfdRunListResponse = named("CfdRunListResponse", z.strictObject({
  items: z.array(cfdRunLedgerRecord),
  count: z.number().int(),
  enabled: z.boolean(),
  /** true when the streaming job service could not be reached and the ledger cache was returned. */
  stale: z.boolean(),
}));

export const cfdRunDetailResponse = named("CfdRunDetailResponse", z.strictObject({
  ledger: cfdRunLedgerRecord,
  /** null (with stale:true) when the streaming job service was unreachable and only the ledger cache is known. */
  status: cfdRunStatusDocument.nullable(),
  stale: z.boolean().optional(),
}));

// ── Result (GET /api/cfd/runs/{runId}/result) ─────────────────────────────────

// Frozen schema: `unevaluatedProperties: false` -> strict here as well.
const fileRef = z.strictObject({
  filename: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/),
  sha256,
  url: z.string().optional(),
});

export const cfdOverlayArtifactId = z.string().regex(/^cfd:[A-Za-z0-9_]+:w[0-9]{3}$/);

export const cfdRunDirectionResult = named("CfdRunDirectionResult", z.strictObject({
  wind_from_degrees: z.number().min(0).lt(360),
  status: cfdRunStatus,
  converged_by_residual_control: z.boolean().nullable(),
  iterations: z.number().int().nullable(),
  /** S5: endTime after the one automatic extension (residualControl not reached on the first pass); null otherwise. */
  end_time_extended_to: z.number().int().min(1).nullable().optional(),
  mesh_cells: z.number().int().nullable().optional(),
  // No `failure_code` here: the frozen direction_result is additionalProperties:false; per-direction
  // failure reasons live in run_record.json (streaming S1.1).
  overlay_layer: fileRef.extend({ artifact_id: cfdOverlayArtifactId }).nullable(),
  pedestrian_1p5m: z.strictObject({ U_magnitude_max: z.number(), polygons: z.number().int() }).nullable(),
  building_pressure: z.strictObject({ p_min: z.number(), p_max: z.number() }).nullable(),
}));

export const cfdRunResult = named("CfdRunResult", z.strictObject({
  schema: z.literal("cfd-run-result/v1"),
  run_id: cfdRunId,
  status: cfdRunStatus,
  purpose: z.literal("design_comparison_only"),
  source: z.strictObject({ conversion_job_id: conversionJobId, model_usdc_sha256: sha256 }),
  preprocess: z.strictObject({
    profile: z.literal("exterior-wind/v1"),
    closing_radius_voxels: z.number().int(),
    leak_fraction: z.number().min(0).max(1),
    leak_fraction_limit: z.number().min(0).max(1),
    sealing_suspect: z.boolean(),
    appendage_policy: z.literal("included"),
  }),
  directions: z.array(cfdRunDirectionResult).min(1).max(16),
  /** S5: service runs are screening; the CLI studies raise the level with an evidence document. */
  validation_level: z.enum(["screening", "mesh_convergence_checked", "benchmark_compared"]).optional(),
  run_record: fileRef.extend({ schema: z.literal("cfd-run-record/v1") }),
  exclusions: fileRef.extend({ counts: z.record(z.string(), z.number().int()) }),
  assumptions: z.array(z.enum([
    "true_north_default_direction", "true_north_unknown_assumed_project_north", "true_north_manual", "sealing_suspect_accepted",
  ])),
  limitations: z.array(z.string()),
}));

export const cfdRunExclusions = named("CfdRunExclusions", z.looseObject({
  schema: z.literal("cfd-exclusion-list/v1"),
  counts: z.record(z.string(), z.number().int()),
}));

// ── Overlay registration (POST/DELETE /api/review-sessions/{sessionId}/cfd-overlays) ──

export const cfdOverlayRegistrationRequest = named("CfdOverlayRegistrationRequest", z.strictObject({
  run_id: cfdRunId,
  wind_from_degrees: z.number().min(0).lt(360),
}));

export const cfdOverlayRegistrationResponse = named("CfdOverlayRegistrationResponse", z.strictObject({
  session_id: z.string(),
  binding_id: z.string(),
  artifact_id: z.string(),
  artifact_role: z.literal("overlay"),
  load_order: z.number().int(),
  url: z.string(),
  run_id: cfdRunId,
  wind_from_degrees: z.number(),
  idempotent_replay: z.boolean(),
}));

export const cfdOverlayRemovalResponse = named("CfdOverlayRemovalResponse", z.strictObject({
  session_id: z.string(),
  binding_id: z.string(),
  removed: z.literal(true),
}));

// -- Route params / query shared by browserContract.ts and cfdRunRoutes.ts --------------------

export const cfdSessionIdParam = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);
export const cfdBindingIdParam = z.string().min(1).max(240).regex(/^[A-Za-z0-9._:-]+$/);
export const cfdRunListQuery = z.strictObject({
  conversion_job_id: conversionJobId.optional(),
  status: cfdRunStatus.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
