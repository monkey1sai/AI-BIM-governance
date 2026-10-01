// Coordinator Browser Contract — CFD wind-run routes (building-energy-cfd-p2-contract.md §3.2, slice S2).
//
// These zod schemas mirror the frozen JSON Schemas in tests/contracts/cfd-run-*-v1.schema.json.
// The browser never supplies source.model_usdc_sha256 or requested_by: the coordinator fills
// both before forwarding to the streaming job service, so the browser-facing create request is
// the request schema minus those two fields. Status / failure-code vocabularies are shared.
import { z } from "zod/v4";
import { CFD_SECTION_SETTINGS, CFD_SETTING_KEYS } from "../../generated/cfd-settings-catalog.js";
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

// ── Request settings sections, built from the CFD Settings Catalog ────────────
//
// docs/architecture/cfd-settings-catalog-adr.md: every setting's bounds, requiredness and nullability are declared
// once (x-cfd-setting in tests/contracts/cfd-run-request-v1.schema.json) and arrive here as generated data. The
// validators are built from that data in this module; the field types are mapped from the same literals, so
// `z.output` of a section stays as precise as the hand-written object it replaces. Anything the catalog does not
// describe (the preprocess profile, the wind directions) stays hand-written in `extras`.

interface SettingDeclaration {
  readonly required: boolean;
  readonly bounds: {
    readonly type: "number" | "integer" | "enum";
    readonly minimum?: number;
    readonly exclusive_minimum?: number;
    readonly maximum?: number;
    readonly nullable?: true;
    readonly enum?: readonly string[];
  };
}
type SettingValue<D extends SettingDeclaration> =
  | (D["bounds"] extends { readonly enum: readonly (infer E)[] } ? E : number)
  | (D["bounds"] extends { readonly nullable: true } ? null : never);
type SectionOutput<S extends Record<string, SettingDeclaration>> =
  { [K in keyof S as S[K]["required"] extends true ? K : never]: SettingValue<S[K]> }
  & { [K in keyof S as S[K]["required"] extends true ? never : K]?: SettingValue<S[K]> };

function settingSchema(declaration: SettingDeclaration): z.ZodType {
  const { bounds } = declaration;
  let schema: z.ZodType;
  if (bounds.type === "enum") {
    if (!bounds.enum || bounds.enum.length === 0) throw new Error("cfd settings catalog: enum setting without members");
    schema = z.enum(bounds.enum as readonly [string, ...string[]]);
  } else {
    if (bounds.maximum === undefined) throw new Error("cfd settings catalog: numeric setting without a maximum");
    let number = z.number();
    if (bounds.type === "integer") number = number.int();
    if (bounds.minimum !== undefined) number = number.min(bounds.minimum);
    if (bounds.exclusive_minimum !== undefined) number = number.gt(bounds.exclusive_minimum);
    schema = number.max(bounds.maximum);
  }
  if (bounds.nullable) schema = schema.nullable();
  return declaration.required ? schema : schema.optional();
}

/** A strict object of `extras` (hand-written, first) followed by the section's catalog settings in request order. */
function settingsSection<S extends Record<string, SettingDeclaration>, X extends z.ZodRawShape>(
  declarations: S, extras: X,
): z.ZodType<z.output<z.ZodObject<X>> & SectionOutput<S>> {
  const shape: Record<string, z.core.$ZodType> = { ...extras };
  for (const [name, declaration] of Object.entries(declarations)) shape[name] = settingSchema(declaration);
  return z.strictObject(shape) as unknown as z.ZodType<z.output<z.ZodObject<X>> & SectionOutput<S>>;
}

// Request sections shared by the create request and the S8 estimate request (tests/contracts/cfd-estimate-request-v1
// reuses the run-request definitions verbatim; the root contract test pins that equality).
const cfdPreprocessSettings = settingsSection(CFD_SECTION_SETTINGS.preprocess, {
  profile: z.literal("exterior-wind/v1"),
});
const cfdWindSettings = settingsSection(CFD_SECTION_SETTINGS.wind, {
  wind_from_degrees: z.array(z.number().min(0).lt(360)).min(1).max(16),
});
const cfdMeshSettings = settingsSection(CFD_SECTION_SETTINGS.mesh, {});
const cfdSolverSettings = settingsSection(CFD_SECTION_SETTINGS.solver, {});

export const cfdRunCreateRequest = named("CfdRunCreateRequest", z.strictObject({
  schema: z.literal("cfd-run-request/v1"),
  idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  source: z.strictObject({ conversion_job_id: conversionJobId }),
  preprocess: cfdPreprocessSettings,
  wind: cfdWindSettings,
  mesh: cfdMeshSettings,
  solver: cfdSolverSettings,
  /** S7 (model-first wind panel): where the browser submitted from; recorded in the ledger only, never forwarded to streaming. */
  origin: z.strictObject({
    session_id: z.string().regex(/^review_session_[A-Za-z0-9_-]+$/).nullable().optional(),
  }).optional(),
}), "cfd-run-request/v1 minus source.model_usdc_sha256 and requested_by, which the coordinator fills; plus the optional browser origin kept in the ledger.");

// ── Ledger origin, built from the CFD Settings Catalog ────────────────────────
//
// S7 submission context (session, directions) plus every catalog setting as the request carried it: null when the
// request omitted it and the standard preset applied, absent on ledger rows recorded before the key existed.
// So each setting is nullable and optional here whatever its request-side requiredness, with the request bounds.
type AllSettings = typeof CFD_SECTION_SETTINGS.preprocess & typeof CFD_SECTION_SETTINGS.wind
  & typeof CFD_SECTION_SETTINGS.mesh & typeof CFD_SECTION_SETTINGS.solver;
type OriginSettings = { -readonly [K in keyof AllSettings]?: SettingValue<AllSettings[K]> | null };
interface OriginContext {
  session_id: string | null;
  wind_from_degrees: number[];
  /** S8: "standard" when the streaming service found the effective settings equal to the verified standard preset. */
  preset_match?: string | null;
}

function originSchema(): z.ZodType<OriginContext & OriginSettings> {
  const shape: Record<string, z.core.$ZodType> = {
    session_id: z.string().regex(/^review_session_[A-Za-z0-9_-]+$/).nullable(),
    wind_from_degrees: z.array(z.number().min(0).lt(360)).min(1).max(16),
  };
  for (const section of Object.values(CFD_SECTION_SETTINGS)) {
    for (const [name, declaration] of Object.entries(section)) {
      shape[name] = settingSchema({ ...declaration, required: true }).nullable().optional();
    }
  }
  shape.preset_match = z.string().nullable().optional();
  return z.strictObject(shape) as unknown as z.ZodType<OriginContext & OriginSettings>;
}

/** S7: submission context and the submitted settings, so a run stays legible after its session is gone. */
export const cfdRunOrigin = named("CfdRunOrigin", originSchema());
export type CfdRunOrigin = z.output<typeof cfdRunOrigin>;

// ── S8 settings phase A: options + estimate (tests/contracts/cfd-options-v1, cfd-estimate-request-v1, cfd-estimate-v1) ──

/** Every setting key of the CFD Settings Catalog, sorted (the `fieldKey` enumeration of cfd-options-v1 / cfd-estimate-v1). */
const cfdSettingsFieldKey = z.enum(CFD_SETTING_KEYS);
const localizedText = z.strictObject({ zh: z.string().min(1), en: z.string().min(1) });
const settingsValue = z.union([z.number(), z.string(), z.null()]);

/** Preset-controlled fields that differ from the verified standard preset once defaults are applied. */
export const cfdSettingsProfile = named("CfdSettingsProfile", z.strictObject({
  options_config_version: z.string().min(1),
  preset_match: z.string().nullable(),
  custom_fields: z.array(cfdSettingsFieldKey),
}));

export const cfdOptionsField = named("CfdOptionsField", z.strictObject({
  key: cfdSettingsFieldKey,
  section: z.enum(["general", "advanced"]),
  type: z.enum(["number", "integer", "enum"]),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  exclusive_minimum: z.number().optional(),
  /** null is meaningful (e.g. mesh.background_cell_m null = automatic cell rule). */
  nullable: z.boolean().optional(),
  enum: z.array(z.string()).min(1).optional(),
  enum_labels: z.record(z.string(), localizedText).optional(),
  default: settingsValue,
  step: z.number().positive().optional(),
  unit: z.string().optional(),
  label: localizedText,
  help: localizedText,
  visible_when: z.strictObject({ key: cfdSettingsFieldKey, equals: settingsValue }).optional(),
}));

export const cfdOptionsPreset = named("CfdOptionsPreset", z.strictObject({
  preset_id: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  verified: z.boolean(),
  label: localizedText,
  description: localizedText,
  values: z.partialRecord(cfdSettingsFieldKey, settingsValue),
}));

export const cfdOptionsDocument = named("CfdOptionsDocument", z.strictObject({
  schema: z.literal("cfd-options/v1"),
  enabled: z.boolean(),
  config_version: z.string().min(1),
  limits: z.strictObject({
    max_directions: z.number().int().min(1).max(16),
    n_procs: z.number().int().min(1).max(64),
    /** Compute hard cap per wind direction (CFD_MAX_CELLS_PER_DIRECTION, never above snappyHexMesh maxGlobalCells 12,000,000): a submission whose estimate exceeds it is rejected with 422 compute_cap_exceeded. */
    max_cells_per_direction: z.number().int().min(100000),
  }),
  fields: z.array(cfdOptionsField).min(1),
  presets: z.array(cfdOptionsPreset).min(1),
  /** Soft thresholds: above them the browser asks for a second confirmation. */
  confirm: z.strictObject({ cells_per_direction: z.number().positive(), total_hours: z.number().positive() }),
}), "cfd-options/v1 from the streaming CFD job service (bounds = cfd-run-request/v1, defaults/presets = versioned cfd_options.json, limits = host configuration).");

export const cfdEstimateRequest = named("CfdEstimateRequest", z.strictObject({
  schema: z.literal("cfd-estimate-request/v1"),
  source: z.strictObject({ conversion_job_id: conversionJobId }),
  preprocess: cfdPreprocessSettings,
  wind: cfdWindSettings,
  mesh: cfdMeshSettings.optional(),
  solver: cfdSolverSettings.optional(),
}), "cfd-run-request/v1 without idempotency key, model hash and requester; validated by the streaming service exactly like a submission. Nothing is stored.");

export const cfdEstimate = named("CfdEstimate", z.strictObject({
  schema: z.literal("cfd-estimate/v1"),
  available: z.boolean(),
  is_estimate: z.literal(true),
  /** layout_not_feasible (settings phase B): the requested mesh layout cannot be written, e.g. a ground band with no upstream fetch. */
  reason: z.enum(["no_geometry_source", "geometry_below_ground", "estimate_failed", "layout_not_feasible"]).nullable(),
  geometry_source: z.enum(["previous_run_shell", "bbox_index_profile_filter"]).nullable(),
  geometry_basis_run_id: cfdRunId.nullable(),
  building_height_m: z.number().positive().optional(),
  background_cell_m: z.number().positive().optional(),
  background_cell_rule: z.enum(["auto", "request"]).optional(),
  near_building_cell_m: z.number().positive().optional(),
  refinement_box_cell_m: z.number().positive().optional(),
  directions: z.array(z.strictObject({
    wind_from_degrees: z.number().min(0).lt(360),
    domain_m: z.array(z.number().positive()).length(3),
    background_cells: z.number().int().min(64),
    estimated_cells: z.number().int().min(0),
    estimated_seconds: z.number().min(0),
  })).max(16),
  totals: z.strictObject({
    estimated_cells: z.number().int().min(0),
    estimated_seconds: z.number().min(0),
    preprocess_seconds: z.number().min(0),
  }).nullable(),
  basis: z.strictObject({
    /** Mesh cells / background cells; below 1 when refinement is off and the building interior is removed. */
    refine_factor: z.number().positive(),
    refine_factor_source: z.enum(["history_same_model", "history_any_model", "config_default"]),
    refine_factor_samples: z.number().int().min(0),
    seconds_per_cell: z.number().positive(),
    seconds_per_cell_source: z.enum(["history_same_n_procs", "config_default_scaled_by_n_procs"]),
    seconds_per_cell_samples: z.number().int().min(0),
    n_procs: z.number().int().min(1).max(64),
    typical_iterations: z.number().positive(),
    end_time: z.number().int().min(50).max(5000),
    notes: z.array(z.string()),
  }).nullable(),
  limits: z.strictObject({
    max_cells_per_direction: z.number().int().min(100000),
    confirm_cells_per_direction: z.number().positive(),
    confirm_total_hours: z.number().positive(),
    exceeds_hard_cap: z.boolean(),
    confirm_required: z.boolean(),
    confirm_reasons: z.array(z.enum(["cells_per_direction", "total_hours"])),
  }),
  settings_profile: cfdSettingsProfile.optional(),
}), "cfd-estimate/v1: always an estimate; background cells follow the engine rules for the geometry used, refined cells and time scale from host history or documented defaults.");

/** Streaming `cfd-run-status/v1` document passed through (plus ledger markers). */
export const cfdRunStatusDocument = named("CfdRunStatusDocument", z.looseObject({
  schema: z.literal("cfd-run-status/v1"),
  run_id: cfdRunId,
  status: cfdRunStatus,
  failure_code: cfdFailureCode.nullable(),
  error: z.string().nullable().optional(),
  progress: z.strictObject({
    directions_total: z.number().int(),
    directions_done: z.number().int(),
    /** Solve progress of the direction the solver is on (present only while `status` is `solving` and the solver has
     *  written a step): the last `Time = N` of its log out of the case's `endTime`, read by the streaming service at
     *  request time. `extended` once the automatic endTime extension pass is running. */
    solver: z.strictObject({
      tag: z.string().regex(/^w[0-9]{3}$/),
      wind_from_degrees: z.number().min(0).lt(360).nullable(),
      iteration: z.number().int().min(0),
      end_time: z.number().int().min(1).nullable(),
      extended: z.boolean(),
    }).optional(),
  }),
  sealing_suspect: z.boolean().nullable(),
  converged_count: z.number().int(),
  purpose: z.literal("design_comparison_only"),
  created_at: z.string(),
  updated_at: z.string(),
  idempotent_replay: z.boolean().optional(),
  /** S8: preset match computed by the streaming service at submission (absent on runs submitted before S8). */
  settings_profile: cfdSettingsProfile.optional(),
  /** S8: what the estimate said at submission (traceability of the number the operator saw). */
  estimate_at_submission: z.looseObject({ available: z.boolean() }).optional(),
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
  /** Pedestrian Wind Field: an element-level finding names the element its zones belong to (absent on a direction-level finding). */
  ifc_guid: z.string().min(1).max(200).optional(),
  ifc_type: z.string().min(1).max(100).optional(),
  /** Pedestrian Wind Field: every direction aggregated into an element-level finding; `wind_from_degrees` is the worst one. */
  directions: z.array(z.number().min(0).lt(360)).min(1).max(16).optional(),
  zone_area_m2: z.number().min(0).optional(),
}));

/** Pedestrian Wind Field: one element a direction's exceedance zones belong to, with the element-level finding it produced. */
export const cfdFindingElementEvaluation = named("CfdFindingElementEvaluation", z.strictObject({
  ifc_guid: z.string().min(1).max(200),
  ifc_type: z.string().min(1).max(100),
  distance_m: z.number().min(0),
  zone_area_m2: z.number().min(0),
  finding: cfdFinding.nullable(),
  idempotent_replay: z.boolean(),
}));

export const cfdFindingEvaluation = named("CfdFindingEvaluation", z.strictObject({
  wind_from_degrees: z.number().min(0).lt(360),
  u_max_m_s: z.number().nullable(),
  exceeds: z.boolean(),
  /** The direction-level finding (S6 shape): opened when the direction's zones belong to no element or the field query gave none. */
  finding: cfdFinding.nullable(),
  idempotent_replay: z.boolean(),
  /** `overlay_missing`: the direction exceeds the threshold but the result has no overlay artifact of this run,
   *  so no issue is opened (its prim path would not resolve). */
  skipped_reason: z.enum(["direction_not_ready", "below_threshold", "not_in_run", "overlay_missing"]).nullable(),
  /** Pedestrian Wind Field: the elements this direction's zones belong to and their element-level findings (absent before). */
  elements: z.array(cfdFindingElementEvaluation).optional(),
}));

// ── Pedestrian Wind Field exceedance query (tests/contracts/cfd-exceedance-v1) ──

export const cfdExceedanceElement = named("CfdExceedanceElement", z.strictObject({
  ifc_guid: z.string().min(1).max(200),
  ifc_type: z.string().min(1).max(100),
  usd_prim_path: z.string().regex(/^\/World\/Elements\//),
  distance_m: z.number().min(0).max(2),
}));

export const cfdExceedanceZone = named("CfdExceedanceZone", z.strictObject({
  area_m2: z.number().min(1),
  centroid_xy: z.array(z.number()).length(2),
  u_max: z.number().min(0),
  polygons: z.number().int().min(1),
  /** Nearest elements of the pedestrian band within 2 m of the zone, by distance; empty for open ground. */
  elements: z.array(cfdExceedanceElement).max(3),
}));

export const cfdExceedance = named("CfdExceedance", z.strictObject({
  schema: z.literal("cfd-exceedance/v1"),
  run_id: cfdRunId,
  wind_from_degrees: z.number().min(0).lt(360),
  tag: z.string().regex(/^w[0-9]{3}$/),
  threshold_u_m_s: cfdFindingThreshold,
  purpose: z.literal("design_comparison_only"),
  frame: z.strictObject({
    directions_relative_to: z.enum(["project_north", "true_north"]),
    assumptions: z.array(z.string()),
    units: z.literal("m"),
  }),
  stats: z.strictObject({
    U_max: z.number().min(0), U_mean: z.number().min(0), U_p95: z.number().min(0), U_min: z.number().min(0),
    polygons: z.number().int().min(0), area_m2: z.number().min(0).nullable(), weighting: z.enum(["area", "points"]),
  }),
  zones: z.array(cfdExceedanceZone),
}), "cfd-exceedance/v1 from the streaming Pedestrian Wind Field: zones of the sampled pedestrian plane above the threshold, attributed to the model's nearest elements; model-frame metres.");

/** Query of the exceedance pass-through: the finding threshold. */
export const cfdExceedanceQuery = z.strictObject({ threshold_u_m_s: z.coerce.number().min(0.5).max(30) });
/** Path parameter: the direction in degrees as the result lists it; the coordinator never recomputes the `wNNN` tag. */
export const cfdDirectionParam = z.coerce.number().min(0).lt(360);

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

const cfdPresentation = z.strictObject({
  version: z.literal(2),
  prims: z.array(z.strictObject({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    role: z.enum(["plane", "surface_pressure", "streamlines", "streamline_growth", "particles", "vectors", "wind_arrow", "section", "section_vectors", "context"]),
    default_visible: z.boolean(),
    quantity: z.enum(["U", "p", "none"]),
  })).max(64),
  animation: z.strictObject({ fps: z.literal(24), frames: z.literal(240), growth_seconds: z.number().gt(0).lt(10), note: z.string() }),
  sections: z.array(z.strictObject({
    id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), axis: z.enum(["x", "y", "z"]), position_m: z.number(),
    label: z.string(), source: z.enum(["standard", "requested"]), polygons: z.number().int().min(0),
  })).max(13),
  building_footprint_xy: z.array(z.array(z.number()).length(2)).max(64),
});

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
  /** Pedestrian Wind Field: U_mean and U_p95 are area-weighted over the plane polygons (absent on results written before the field statistics). */
  pedestrian_1p5m: z.strictObject({
    U_magnitude_max: z.number(), polygons: z.number().int(),
    U_mean: z.number().min(0).optional(), U_p95: z.number().min(0).optional(), U_min: z.number().min(0).optional(),
  }).nullable(),
  /** Pedestrian Wind Field: the colour scale and units authored into the overlay layer (customData cfd:legend), so the viewer reads them instead of copying constants. */
  legend: z.strictObject({
    U: z.strictObject({ min: z.number(), max: z.number(), unit: z.string(), prims: z.array(z.string()).optional() }),
    p: z.strictObject({
      unit: z.string(), quantity: z.string().optional(), prims: z.array(z.string()).optional(), available: z.boolean(),
      min: z.number().optional(), max: z.number().optional(),
    }),
  }).optional(),
  /** Kinematic pressure p/ρ in m²/s² (incompressible simpleFoam), gauge to the outlet; not Pa. */
  building_pressure: z.strictObject({ p_min: z.number(), p_max: z.number() }).nullable(),
  presentation: cfdPresentation.optional(),
}));

export const cfdRunResult = named("CfdRunResult", z.strictObject({
  schema: z.literal("cfd-run-result/v1"),
  run_id: cfdRunId,
  status: cfdRunStatus,
  purpose: z.literal("design_comparison_only"),
  wind_frame: z.strictObject({
    directions_relative_to: z.enum(["project_north", "true_north"]),
    true_north_degrees_used: z.number().finite(),
    true_north_source: z.enum(["geo_reference", "manual", "unknown"]),
  }).optional(),
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
