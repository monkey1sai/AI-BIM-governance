import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { named } from "../primitives.js";

const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,64}(?![\s\S])/);
const sha = z.string().regex(/^[0-9a-f]{64}(?![\s\S])/);
const finite = z.number().finite();
const whitespaceOnly = /^[ \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/u;
const note = z.string().min(1).refine((value) =>
  Array.from(value).length <= 500 && !whitespaceOnly.test(value) &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value) &&
  !Array.from(value).some((char) => char.codePointAt(0)! >= 0xd800 && char.codePointAt(0)! <= 0xdfff),
"source note must contain 1..500 Unicode scalars, no controls, and nonblank text").meta({ maxLength: 500 });

const fields = {
  schema: z.literal("cfd-context/v1"),
  scenario_id: identifier,
  revision: z.number().int().min(1).max(2147483647),
  source: z.strictObject({
    conversion_job_id: z.string().regex(/^[A-Za-z0-9._-]{1,200}(?![\s\S])/),
    model_usdc_sha256: sha,
  }),
  frame: z.strictObject({
    space: z.literal("model"), units: z.literal("m"), up_axis: z.enum(["Y", "Z"]),
    north_reference: z.literal("project_north"),
  }),
  masses: z.array(z.strictObject({
    id: identifier,
    position_m: z.array(finite.min(-1e9).max(1e9)).length(3),
    dimensions_m: z.array(finite.gt(0).max(1e6)).length(3),
    rotation_degrees: finite.min(0).lt(360),
    provenance: z.strictObject({ kind: z.enum(["measured", "drawing", "client_supplied", "estimated"]), note }),
  })).max(50).refine((masses) => new Set(masses.map((mass) => mass.id)).size === masses.length, "mass IDs must be unique"),
};

/** Draft validation never creates a run. A supplied hash must still match. */
export const cfdContextDraft = named("CfdContextDraft", z.strictObject({ ...fields, canonical_sha256: sha.optional() }));
export const cfdContext = named("CfdContext", z.strictObject({ ...fields, canonical_sha256: sha }));
export type CfdContextDraft = z.infer<typeof cfdContextDraft>;
export type CfdContext = z.infer<typeof cfdContext>;
export const cfdContextValidation = named("CfdContextValidation", z.strictObject({
  schema: z.literal("cfd-context-validation/v1"),
  validation_scope: z.literal("source_and_context_identity"),
  context: cfdContext,
}));

/** See cfd-context-contract.md: exact binary64 numbers, verbatim UTF-8 hex text, fixed array order. */
export function canonicalContext(draft: CfdContextDraft): CfdContext {
  const numberHex = (value: number): string => {
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleBE(value === 0 ? 0 : value);
    return bytes.toString("hex");
  };
  const masses = draft.masses.map((mass) => ({
    ...mass,
    position_m: mass.position_m.map((value) => value === 0 ? 0 : value) as [number, number, number],
    rotation_degrees: mass.rotation_degrees === 0 ? 0 : mass.rotation_degrees,
    provenance: { ...mass.provenance },
  })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const frame = draft.frame;
  const bytes = JSON.stringify([
    draft.schema, draft.scenario_id, String(draft.revision), draft.source.conversion_job_id, draft.source.model_usdc_sha256,
    [frame.space, frame.units, frame.up_axis, frame.north_reference],
    masses.map((mass) => [mass.id, mass.position_m.map(numberHex), mass.dimensions_m.map(numberHex),
      numberHex(mass.rotation_degrees), mass.provenance.kind, Buffer.from(mass.provenance.note, "utf8").toString("hex")]),
  ]);
  return { ...draft, masses, canonical_sha256: createHash("sha256").update(bytes, "utf8").digest("hex") };
}
