import { z } from "zod/v4";
import { named } from "../primitives.js";
import { groundSelectionId } from "./groundSurfaces.js";
import { cfdRunId } from "./cfd.js";

const sha = z.string().regex(/^[0-9a-f]{64}$/), number = z.number().finite();
const range = z.array(number).length(2).refine(value => value[0] <= value[1]);
const link = z.enum(["verified", "unknown"]);
const checks = z.strictObject({ fresh_source_verified: z.literal(true), fresh_faces_verified: z.literal(true),
  selection_ledger_verified: z.literal(true), run_record_link: link, case_metadata_link: link, exclusions_link: link });
const codes = ["selection_ledger_not_checked", "scenario_ground_geometry_link_unverified", "case_mesh_time_link_unverified",
  "inlet_boundary_files_not_checked", "actual_ground_not_verified", "fluid_region_not_verified", "selected_surface_elevation_varies",
  "result_source_mismatch_or_unknown", "result_run_id_unknown", "result_schema_or_state_unverified", "case_schema_unknown",
  "ground_z_m_unknown", "pedestrian_plane_height_m_unknown", "pedestrian_plane_z_m_unknown", "zmin_unknown",
  "uref_m_s_unknown", "zref_m_unknown", "z0_m_unknown", "inlet_parameters_nonpositive", "pedestrian_height_not_1p5m",
  "domain_ground_mismatch", "pedestrian_plane_metadata_mismatch", "flat_ground_differs_from_selected_surface",
  "solver_rotation_alpha_rad_unknown", "wind_vector_model_xy_unknown", "model_solver_rotation_inconsistent",
  "exclusion_schema_unknown", "exclusion_source_mismatch_or_unknown", "exclusion_capture_hash_mismatch_or_unknown",
  "selected_component_excluded_from_preprocess", "run_record_link_unknown", "case_metadata_link_unknown", "exclusions_link_unknown"] as const;
export const groundAssessmentRequest = named("GroundAssessmentRequest", z.strictObject({
  source_run_id: cfdRunId, wind_from_degrees: number.min(0).lt(360),
}));
const shape = {
  schema: z.literal("cfd-ground-service-assessment/v1"), status: z.literal("HELD"), authority: z.literal("source_bound_metadata_only"),
  selection_id: groundSelectionId, selection_sha256: sha, conversion_job_id: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/),
  model_usdc_sha256: sha, source_run_id: cfdRunId, wind_from_degrees: number.min(0).lt(360), direction_tag: z.string().regex(/^w(?:[0-2][0-9]{2}|3[0-5][0-9])$/),
  metadata_sha256: z.strictObject({ run_status: sha, result: sha, run_record: sha.nullable(), case_metadata: sha.nullable(), exclusions: sha.nullable() }),
  reasons: z.array(z.enum(codes)).max(100), selected_source_faces: z.array(z.strictObject({ face_id: sha, geometry_sha256: sha })).min(1).max(100),
  selected_surface_z_range_m: range, relative_target_z_range_m: range, old_plane_minus_relative_target_range_m: range.nullable(),
  case_declared: z.strictObject({ ground_z_m: number.nullable(), sampling_plane_z_m: number.nullable(), pedestrian_height_m: number.nullable(),
    domain_zmin_m: number.nullable(), uref_m_s: number.nullable(), zref_m: number.nullable(), z0_m: number.nullable(),
    model_to_solver: z.strictObject({ kind: z.literal("rotation_about_z"), alpha_rad: number.nullable(), wind_vector_model_xy: z.array(number).length(2).nullable() }) }),
  excluded_selected_guids: z.array(z.string().regex(/^[0-3][0-9A-Za-z_$]{21}$/)).max(100),
  inlet_boundary_files_checked: z.literal(false), actual_ground_verified: z.literal(false), fluid_region_verified: z.literal(false),
  velocity_sampled: z.literal(false), solver_started: z.literal(false),
};
function consistent(value: { selection_id: string; selection_sha256: string; selected_surface_z_range_m: number[]; relative_target_z_range_m: number[];
  wind_from_degrees: number; direction_tag: string; reasons: readonly string[]; old_plane_minus_relative_target_range_m: number[] | null;
  case_declared: { sampling_plane_z_m: number | null }; selected_source_faces: { face_id: string }[];
  checks: { run_record_link: string; case_metadata_link: string; exclusions_link: string }; metadata_sha256: { run_record: string | null; case_metadata: string | null; exclusions: string | null } }) {
  // Native direction_tag uses Python round: ties to even, then modulo 360.
  // Keep parity explicit; Math.round would map 22.5 to the wrong case folder.
  const floor = Math.floor(value.wind_from_degrees), fraction = value.wind_from_degrees - floor;
  const rounded = fraction < .5 ? floor : fraction > .5 ? floor + 1 : floor + floor % 2;
  const tag = `w${String(rounded % 360).padStart(3, "0")}`;
  const plane = value.case_declared.sampling_plane_z_m, gap = value.old_plane_minus_relative_target_range_m;
  return value.selection_id === `ground_${value.selection_sha256}`
    && value.direction_tag === tag && new Set(value.selected_source_faces.map(face => face.face_id)).size === value.selected_source_faces.length
    && value.relative_target_z_range_m.every((n, i) => Math.abs(n - value.selected_surface_z_range_m[i] - 1.5) <= 1e-9)
    && (plane === null ? gap === null : gap !== null && gap.every((n, i) => Math.abs(n - (plane - value.relative_target_z_range_m[1 - i])) <= 1e-9))
    && (value.checks.case_metadata_link !== "verified" || value.checks.run_record_link === "verified")
    && (["run_record", "case_metadata", "exclusions"] as const).every(key =>
      (value.checks[`${key}_link`] === "verified") === (value.metadata_sha256[key] !== null)
      && (value.checks[`${key}_link`] === "unknown") === value.reasons.includes(`${key}_link_unknown`));
}
export const groundAssessmentUpstream = z.strictObject({ ...shape, checks: checks.extend({ selection_ledger_verified: z.literal(false) }) }).refine(consistent);
export const groundAssessmentReport = named("GroundAssessmentReport", z.strictObject({ ...shape, checks }).refine(consistent));
