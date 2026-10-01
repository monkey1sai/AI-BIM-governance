import type { GeoReferenceSummary } from "../contract/coordinatorApi";

export interface NorthReference { degrees: number; source: "IFC" | "manual" }
export function isNorthReference(value: unknown): value is NorthReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.degrees === "number" && Number.isFinite(v.degrees) && v.degrees >= 0 && v.degrees < 360
    && (v.source === "IFC" || v.source === "manual");
}
export function northFromGeo(summary: GeoReferenceSummary, jobId: string): NorthReference | null {
  const n = summary?.true_north;
  const ref = { degrees: n?.degrees, source: "IFC" };
  return summary?.conversion_job_id === jobId && n?.status === "reliable"
    && n.source === "IfcGeometricRepresentationContext.TrueNorth" && isNorthReference(ref) ? ref : null;
}
/** IFC angle is anti-clockwise from project +Y; camera heading is clockwise. */
export const referencedHeading = (heading: number, north: NorthReference | null | undefined): number =>
  north ? ((heading + north.degrees) % 360 + 360) % 360 : heading;
export const northCaption = (north: NorthReference | null | undefined): string =>
  north ? `真北（${north.source === "manual" ? "手動" : "IFC"}）` : "專案北（真北未知）";
