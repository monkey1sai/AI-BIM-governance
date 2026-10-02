import { z } from "zod/v4";
import { named } from "../primitives.js";

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const id = z.string().regex(/^ground_[0-9a-f]{64}$/);
const job = z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);
const point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const meshPath = z.string().min(1).max(1024).startsWith("/World/Elements/");
export const groundFaceIdentity = z.strictObject({
  ifc_guid: z.string().regex(/^[0-3][0-9A-Za-z_$]{21}$/), mesh_prim_path: meshPath,
  polygon_face_index: z.number().int().nonnegative(), face_id: sha,
});
export const groundFace = groundFaceIdentity.extend({
  model_usdc_sha256: sha, ifc_type: z.string().min(1), point_indices: z.tuple([
    z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()]),
  vertices_m: z.tuple([point, point, point]), normal: point, area_m2: z.number().finite().positive(),
  geometry_sha256: sha, subdivision_scheme: z.string().min(1),
  geometry_representation: z.literal("authored_triangle"), actual_ground_verified: z.literal(false),
});
export const groundCatalogRequest = named("GroundCatalogRequest", z.strictObject({
  component_path: meshPath, cursor: z.string().max(80).nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
}));
export const groundCatalog = named("GroundFaceCatalog", z.strictObject({
  schema: z.literal("ground-face-catalog/v1"), conversion_job_id: job, model_usdc_sha256: sha,
  component_path: meshPath, stage_meters_per_unit: z.number().finite().positive(), faces: z.array(groundFace).max(100),
  rejected_faces: z.record(z.string(), z.number().int().nonnegative()),
  rejected_meshes: z.array(z.strictObject({ mesh_prim_path: meshPath, reason: z.string() })).max(256),
  inspected_faces: z.number().int().min(0).max(5000), complete: z.boolean(), next_cursor: z.string().nullable(),
  actual_ground_verified: z.literal(false),
}));
export const groundPreviewRequest = named("GroundPreviewRequest", z.strictObject({
  region_name: z.string().min(1).max(80).refine(value => Boolean(value.trim()) && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value), "invalid region name"),
  model_usdc_sha256: sha, faces: z.array(groundFaceIdentity).min(1).max(100),
}));
const previewFields = {
  selection_id: id, selection_sha256: sha, conversion_job_id: job, model_usdc_sha256: sha,
  region_name: z.string().min(1).max(80), faces: z.array(groundFace).min(1).max(100),
  stage_meters_per_unit: z.number().finite().positive(), display_lift_m: z.literal(0.01),
  actual_ground_verified: z.literal(false), artifact_id: z.string().regex(/^artifact_ground_[0-9a-f]{64}$/), preview_sha256: sha,
};
export const groundPreview = named("GroundSelectionPreview", z.strictObject({ schema: z.literal("ground-selection-preview/v1"), ...previewFields }));
export const groundPreviewRegistration = named("GroundPreviewRegistration", z.strictObject({
  session_id: z.string(), primary_artifact_id: z.string(), preview: groundPreview,
}));
export const groundConfirmRequest = named("GroundConfirmRequest", z.strictObject({ binding_revision_id: z.string().min(1).max(200) }));
export const groundVersion = named("GroundSelectionVersion", z.strictObject({
  schema: z.literal("ground-selection-version/v1"), ...previewFields,
  selection_confirmed_by_user: z.literal(true),
  confirmation: z.strictObject({ principal: z.string().min(1).max(200), session_id: z.string().min(1).max(200),
    binding_revision_id: z.string().min(1).max(200) }),
}));
export const groundSelectionId = id;
