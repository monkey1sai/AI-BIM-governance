import { z } from "zod/v4";
import { named } from "../primitives.js";
import { groundSelectionId } from "./groundSurfaces.js";
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const xy = z.array(z.number().finite()).length(2), xyz = z.array(z.number().finite()).length(3);
export const groundSampleRequest = named("GroundSampleRequest", z.strictObject({
  bounds_m: z.array(z.number().finite()).length(4), spacing_m: z.number().finite().positive(),
}).refine(value => {
  const [xmin, ymin, xmax, ymax] = value.bounds_m;
  const nx = Math.floor((xmax - xmin) / value.spacing_m) + 1, ny = Math.floor((ymax - ymin) / value.spacing_m) + 1;
  return xmax >= xmin && ymax >= ymin && Number.isFinite(nx * ny) && nx > 0 && ny > 0 && nx * ny <= 10_000;
}, "invalid or excessive grid"));
const base = { query_index: z.number().int().min(0).max(9999), xy_m: xy };
const row = z.discriminatedUnion("status", [
  z.strictObject({ ...base, status: z.literal("point_generated"), face_id: sha, ground_z_m: z.number().finite(), target_m: xyz }),
  z.strictObject({ ...base, status: z.literal("uncovered") }),
  z.strictObject({ ...base, status: z.literal("precision_unsupported") }),
  z.strictObject({ ...base, status: z.literal("ambiguous"), candidate_count: z.number().int().min(2).max(100), candidate_face_ids: z.array(sha).length(2) }),
]);
export const groundSamplePlan = named("GroundSamplePlan", z.strictObject({
  schema: z.literal("cfd-ground-sample-points/v1"), algorithm: z.literal("authored-triangle-vertical/v1"),
  coordinate_frame: z.literal("model_world_Z_up_metres"), model_usdc_sha256: sha,
  selection_id: groundSelectionId, selection_sha256: sha, conversion_job_id: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/),
  bounds_m: z.array(z.number().finite()).length(4), spacing_m: z.number().finite().positive(),
  source_faces: z.array(z.strictObject({ face_id: sha, geometry_sha256: sha })).min(1).max(100),
  height_above_surface_m: z.literal(1.5), display_lift_m: z.literal(0), actual_ground_verified: z.literal(false),
  fluid_region_verified: z.literal(false), velocity_sampled: z.literal(false),
  query_count: z.number().int().min(1).max(10_000), generated_count: z.number().int().min(0).max(10_000),
  rejected_by_reason: z.partialRecord(z.enum(["uncovered", "ambiguous", "precision_unsupported"]), z.number().int().min(0).max(10_000)),
  points: z.array(row).min(1).max(10_000),
}).superRefine((value, context) => {
  const fail = () => context.addIssue({ code: "custom", message: "inconsistent sample report" });
  const known = new Set(value.source_faces.map(face => face.face_id));
  if (known.size !== value.source_faces.length || value.query_count !== value.points.length) fail();
  const counts = { uncovered: 0, ambiguous: 0, precision_unsupported: 0 }; let generated = 0;
  value.points.forEach((point, index) => {
    if (point.query_index !== index) fail();
    if (point.status === "point_generated") {
      generated++;
      if (!known.has(point.face_id) || point.target_m[0] !== point.xy_m[0] || point.target_m[1] !== point.xy_m[1]
          || Math.abs(point.target_m[2] - point.ground_z_m - 1.5) > 1e-9) fail();
    } else {
      counts[point.status]++;
      if (point.status === "ambiguous" && (point.candidate_count > known.size || new Set(point.candidate_face_ids).size !== 2
          || point.candidate_face_ids.some(face => !known.has(face)))) fail();
    }
  });
  if (generated !== value.generated_count || Object.entries(counts).some(([reason, count]) => (value.rejected_by_reason[reason as keyof typeof counts] ?? 0) !== count)) fail();
}));
