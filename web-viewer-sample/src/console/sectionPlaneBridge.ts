export interface SectionInput { enabled: boolean; axis: "x" | "y" | "z"; direction: 1 | -1; position: number }
export type SectionReason = "invalid" | "busy" | "unavailable" | "rejected" | "transport" | "timeout" | "readback";
export interface SectionReply {
  status: "applied" | "off" | "unconfirmed" | "error";
  clientRequestId?: string;
  requestId?: string;
  reason?: SectionReason;
  effective?: SectionInput;
}
export type SectionState = { status: "idle" | "pending" } | SectionReply;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const sectionCorrelationId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
export function parseSectionInput(value: unknown): SectionInput | null {
  if (!record(value) || Object.keys(value).some(key => !["enabled", "axis", "direction", "position"].includes(key))) return null;
  if (typeof value.enabled !== "boolean" || !["x", "y", "z"].includes(value.axis as string)
    || (value.direction !== 1 && value.direction !== -1) || typeof value.position !== "number"
    || !Number.isFinite(value.position) || Math.abs(value.position) > 3.4028234663852886e38) return null;
  return { enabled: value.enabled, axis: value.axis as SectionInput["axis"], direction: value.direction, position: value.position };
}
export function sectionReadbackMatches(input: SectionInput, payload: unknown): boolean {
  if (!record(payload) || payload.result !== "success" || payload.enabled !== input.enabled || !Array.isArray(payload.planes)
    || payload.planes.length > 256 || !payload.planes.every(plane => Array.isArray(plane) && plane.length === 4
      && plane.every(value => typeof value === "number" && Number.isFinite(value)))) return false;
  if (!input.enabled) return true; // Off preserves the renderer's preexisting zero/multiple planes.
  if (payload.planes.length !== 1) return false;
  const expected = [0, 0, 0, -input.position * input.direction];
  expected[{ x: 0, y: 1, z: 2 }[input.axis]] = input.direction;
  return (payload.planes[0] as number[]).every((value, index) =>
    Math.abs(value - expected[index]) <= 1e-6 * Math.max(1, Math.abs(expected[index])));
}
export function parseSectionReply(value: unknown): SectionReply | null {
  if (!record(value) || !["applied", "off", "unconfirmed", "error"].includes(value.status as string)) return null;
  if (value.clientRequestId !== undefined && !sectionCorrelationId(value.clientRequestId)) return null;
  if (value.requestId !== undefined && !sectionCorrelationId(value.requestId)) return null;
  if ((value.status === "applied" || value.status === "off") && (!value.clientRequestId || !value.requestId)) return null;
  const reasons: SectionReason[] = ["invalid", "busy", "unavailable", "rejected", "transport", "timeout", "readback"];
  if (value.reason !== undefined && !reasons.includes(value.reason as SectionReason)) return null;
  const effective = value.effective === undefined ? undefined : parseSectionInput(value.effective);
  if (effective === null) return null;
  return { status: value.status as SectionReply["status"],
    ...(effective ? { effective } : {}),
    ...(value.clientRequestId ? { clientRequestId: value.clientRequestId as string } : {}),
    ...(value.requestId ? { requestId: value.requestId as string } : {}),
    ...(value.reason ? { reason: value.reason as SectionReason } : {}) };
}
