import { geoReferenceSummary } from "../contract/schemas/conversion.js";

const IFC_SOURCE = "IfcGeometricRepresentationContext.TrueNorth";
export function buildGeoReferenceSummary(jobId: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid geo-reference response");
  const v = value as Record<string, unknown>;
  if (v.conversion_job_id !== jobId || typeof v.available !== "boolean" || !Array.isArray(v.warnings)) {
    throw new Error("Geo-reference identity or shape mismatch");
  }
  const degrees = typeof v.true_north_degrees === "number" && Number.isFinite(v.true_north_degrees)
    ? ((v.true_north_degrees % 360) + 360) % 360 : null;
  const source = v.true_north_source === IFC_SOURCE ? IFC_SOURCE : null;
  const status = degrees === null || source === null || v.warnings.includes("geo_lookup_failed")
    || v.warnings.includes("true_north_missing") ? "missing"
    : v.warnings.includes("true_north_default_direction") || degrees === 0 ? "default_direction" : "reliable";
  return geoReferenceSummary.parse({
    conversion_job_id: jobId, available: v.available,
    true_north: { degrees: status === "missing" ? null : degrees, source: status === "missing" ? null : source, status },
    grid_north_degrees: typeof v.grid_north_degrees === "number" && Number.isFinite(v.grid_north_degrees)
      ? ((v.grid_north_degrees % 360) + 360) % 360 : null,
  });
}
