import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { evaluatePurpose } from "./purposeEvaluation.js";
import { conversionFactsSchema, approvedScopeSchema, purposeFacts } from "./conversionValidationFacts.js";

// Bound disclosure at persistence, independently of the later report renderer.
const text = z.string().trim().min(1).max(256).refine(
  value => !/(?:[a-z]:[\\/]|\\\\|(?:https?|file):\/\/|\bbearer\s+\S|(?:^|\s)\/\S)/i.test(value),
  "Internal locations or credentials are not validation text.",
);
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const guid = z.string().regex(/^[A-Za-z0-9_$-]{1,128}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const purpose = z.enum(["view_3d", "locate_highlight", "distance_measurement", "ifc_rules"]);
const check = z.union([
  z.object({ id: identity, state: z.enum(["pass", "fail", "unknown", "not_run", "execution_failed"]),
    reasonCodes: z.array(identity).max(100) }).strict(),
  z.object({ id: identity, state: z.literal("pass_with_limits"),
    reasonCodes: z.array(identity).max(100), limitations: z.array(text).min(1).max(100) }).strict(),
]);
const policy = z.object({ id: identity, version: text, purpose,
  requiredCheckIds: z.array(identity).min(1).max(100) }).strict();
const inputSchema = z.object({
  recordId: identity, readyModelId: identity, conversionJobId: identity,
  tenantId: identity, projectId: identity, modelVersionId: identity,
  source: z.object({ name: text, sha256 }).strict(),
  artifacts: z.object({ usdcSha256: sha256.nullable(), mappingSha256: sha256.nullable() }).strict(),
  correspondence: z.array(z.object({ guid,
    primPaths: z.array(z.string().min(2).max(2048).startsWith("/")).min(1).max(1000),
  }).strict()).max(100000).nullable(),
  converterVersion: text.nullable(), validatorVersion: text, validatedAt: z.string().datetime({ offset: true }),
  evidence: conversionFactsSchema.optional(),
  approvedScopes: z.array(approvedScopeSchema).max(4).optional(),
  inventory: z.object({
    observation: z.enum(["not_run", "observed"]).optional(),
    expectedRenderable: count.nullable(), convertedRenderable: count.nullable(),
    missing: z.array(z.object({ guid, reasonCodes: z.array(identity).min(1).max(100) }).strict()).max(100000),
    excluded: z.array(z.object({ guid,
      reason: z.enum(["non_renderable", "outside_approved_scope"]) }).strict()).max(100000),
  }).strict(),
  purposes: z.array(z.object({ purpose, policy: policy.nullable(), checks: z.array(check).max(100) }).strict()).max(4),
}).strict();

export type ConversionValidationInput = z.infer<typeof inputSchema>;
export interface ConversionValidationRecord extends ConversionValidationInput {
  schemaVersion: "conversion-validation-record/v1";
  evaluations: ReturnType<typeof evaluatePurpose>[];
}

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

/** Internal producer facts only. Shape validation is not source authorization or proof of IFC/Kit truth. */
export function createConversionValidationRecord(value: unknown): ConversionValidationRecord {
  const input = inputSchema.parse(value);
  if (!unique(input.purposes.map((item) => item.purpose))) throw new Error("Duplicate purpose.");
  for (const item of input.purposes) {
    if (!unique(item.checks.map((entry) => entry.id))) throw new Error("Duplicate check.");
  }
  const inventory = input.inventory;
  if (input.evidence && (input.evidence.sourceSha256 !== input.source.sha256 ||
      input.evidence.modelVersionId !== input.modelVersionId ||
      input.evidence.sourceName !== input.source.name ||
      input.evidence.validatorVersion !== input.validatorVersion ||
      input.evidence.validatedAt !== input.validatedAt ||
      !isDeepStrictEqual(input.evidence.artifacts, input.artifacts) ||
      !isDeepStrictEqual(input.evidence.inventory, inventory) ||
      !isDeepStrictEqual(input.evidence.correspondence, input.correspondence) ||
      !isDeepStrictEqual(purposeFacts(input.evidence, input.approvedScopes, input), input.purposes))) {
    throw new Error("Validation evidence binding changed.");
  }
  if (inventory.observation === "not_run" &&
      (inventory.expectedRenderable !== null || inventory.convertedRenderable !== null ||
       inventory.missing.length > 0 || inventory.excluded.length > 0)) {
    throw new Error("Unobserved inventory cannot contain findings.");
  }
  if (input.correspondence !== null) {
    const unavailable = new Set([...inventory.missing, ...inventory.excluded].map((entry) => entry.guid));
    if (!unique(input.correspondence.map((entry) => entry.guid)) ||
        !unique(input.correspondence.flatMap((entry) => entry.primPaths)) ||
        input.correspondence.some((entry) => unavailable.has(entry.guid))) {
      throw new Error("Inconsistent correspondence.");
    }
  }
  if (!unique([...inventory.missing, ...inventory.excluded].map((item) => item.guid))) {
    throw new Error("Duplicate inventory component.");
  }
  if (inventory.expectedRenderable !== null && inventory.convertedRenderable !== null &&
      (inventory.convertedRenderable > inventory.expectedRenderable ||
       inventory.missing.length > inventory.expectedRenderable - inventory.convertedRenderable)) {
    throw new Error("Inconsistent source inventory.");
  }
  const evaluations = purpose.options.map((name) => {
    const item = input.purposes.find((entry) => entry.purpose === name);
    return evaluatePurpose(name, item?.policy ?? null, item?.checks ?? []);
  });
  return { schemaVersion: "conversion-validation-record/v1", ...input, evaluations };
}

/** Revalidate persisted facts and conclusions; a hand-edited outcome cannot silently become evidence. */
export function parseConversionValidationRecord(value: unknown): ConversionValidationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid validation record.");
  const { schemaVersion, evaluations, ...input } = value as Record<string, unknown>;
  if (schemaVersion !== "conversion-validation-record/v1") throw new Error("Unknown validation record schema.");
  const record = createConversionValidationRecord(input);
  if (!isDeepStrictEqual(evaluations, record.evaluations)) throw new Error("Validation conclusions changed.");
  return record;
}
