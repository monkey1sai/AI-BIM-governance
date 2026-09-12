import { z } from "zod";
import type { Purpose, PurposeCheck } from "./purposeEvaluation.js";
import { sanitizeArtifactIdPart } from "./streamingConversionClient.js";
const id = z.string().regex(/^[A-Za-z0-9_$.-]{1,128}$/);
// External intake identifiers are opaque; preserve Unicode, punctuation and bytes.
const externalId = z.string().min(1);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(256);
const check = z.union([
  z.object({ id, state: z.enum(["pass", "fail", "unknown", "not_run", "execution_failed"]), reasonCodes: z.array(id).max(100) }).strict(),
  z.object({ id, state: z.literal("pass_with_limits"), reasonCodes: z.array(id).max(100), limitations: z.array(text).min(1).max(100) }).strict(),
]);
export const conversionFactsSchema = z.object({
  schemaVersion: z.literal("conversion-validation-facts/v1"),
  validatorVersion: z.enum(["conversion-facts-validator/v1", "conversion-facts-validator/v2"]), validatedAt: z.string().datetime({ offset: true }),
  sourceSha256: sha, modelVersionId: id, sourceName: text,
  artifacts: z.object({ usdcSha256: sha, mappingSha256: sha }).strict(),
  inventory: z.object({
    observation: z.enum(["observed", "not_run"]), expectedRenderable: count.nullable(), convertedRenderable: count.nullable(),
    missing: z.array(z.object({ guid: id, reasonCodes: z.array(id).min(1).max(100) }).strict()).max(100000),
    excluded: z.array(z.object({ guid: id, reason: z.literal("non_renderable") }).strict()).max(100000),
  }).strict(),
  byClass: z.array(z.object({ ifcType: id, expected: count, converted: count.nullable() }).strict()).max(10000),
  expectedElements: z.array(z.object({ guid: id, ifcType: id }).strict()).max(100000).nullable(),
  correspondence: z.array(z.object({ guid: id, primPaths: z.array(z.string().startsWith("/").min(2).max(2048)).min(1).max(1000) }).strict()).max(100000).nullable(),
  units: z.object({ ifcLengthScaleM: z.number().finite().positive().nullable(), usdMetersPerUnit: z.number().finite().positive().nullable(), upAxis: z.enum(["Y", "Z"]).nullable() }).strict(),
  coordinateEvidence: z.object({
    method: z.literal("ifc-usd-world-aabb/v1"), toleranceM: z.literal(0.001),
    mappedCount: count, checkedCount: count, maxDeltaM: z.number().finite().nonnegative().nullable(),
    mismatchedGuids: z.array(id).max(100000), unavailableGuids: z.array(id).max(100000),
  }).strict().nullable().optional(),
  checks: z.array(check).max(100),
}).strict().superRefine((facts, context) => {
  const bad = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  const unique = (values: string[]) => new Set(values).size === values.length;
  const { inventory: i, correspondence: c, byClass } = facts;
  const expected = facts.expectedElements;
  const bounds = facts.coordinateEvidence;
  if (!bounds &&
      facts.checks.some(x => x.id === "coordinates" && ["pass", "pass_with_limits"].includes(x.state))) bad("Coordinate success requires evidence.");
  if (bounds) {
    const mapped = new Set(c?.map(x => x.guid));
    const ids = [...bounds.mismatchedGuids, ...bounds.unavailableGuids];
    const coordinate = facts.checks.find(x => x.id === "coordinates");
    const state = bounds.mismatchedGuids.length ? "fail" : bounds.unavailableGuids.length || !bounds.checkedCount ? "unknown" : "pass_with_limits";
    if (bounds.mappedCount !== c?.length || bounds.checkedCount + bounds.unavailableGuids.length !== bounds.mappedCount ||
        bounds.mismatchedGuids.length > bounds.checkedCount || !unique(ids) || ids.some(g => !mapped.has(g)) ||
        (bounds.checkedCount === 0) !== (bounds.maxDeltaM === null) ||
        (bounds.maxDeltaM !== null && (bounds.maxDeltaM > bounds.toleranceM) !== (bounds.mismatchedGuids.length > 0)) ||
        coordinate?.state !== state) bad("World bounds evidence mismatch.");
  }
  if (i.observation === "observed") {
    if (expected === null || expected.length !== i.expectedRenderable || !unique(expected.map(x => x.guid))) bad("Expected source identities mismatch.");
    else {
      const ids = new Set(expected.map(x => x.guid));
      if (i.missing.some(x => !ids.has(x.guid)) || i.excluded.some(x => ids.has(x.guid)) ||
          (c !== null && c.some(x => !ids.has(x.guid))) ||
          byClass.some(row => expected.filter(x => x.ifcType === row.ifcType).length !== row.expected)) bad("Source inventory membership mismatch.");
    }
  } else if (expected !== null) bad("Unknown inventory has expected identities.");
  if (!unique(facts.checks.map(x => x.id)) || !unique(byClass.map(x => x.ifcType))) bad("Duplicate facts.");
  if (!unique([...i.missing, ...i.excluded].map(x => x.guid))) bad("Duplicate inventory identity.");
  if (i.observation === "not_run" && (i.expectedRenderable !== null || i.convertedRenderable !== null || i.missing.length || i.excluded.length || byClass.length || c !== null)) bad("Unobserved inventory has results.");
  if (i.observation === "observed" && (i.expectedRenderable === null || byClass.reduce((n, x) => n + x.expected, 0) !== i.expectedRenderable)) bad("Independent class totals mismatch.");
  if (c !== null) {
    const absent = new Set([...i.missing, ...i.excluded].map(x => x.guid));
    if (!unique(c.map(x => x.guid)) || !unique(c.flatMap(x => x.primPaths)) || c.some(x => absent.has(x.guid)) || c.length !== i.convertedRenderable || i.expectedRenderable !== c.length + i.missing.length) bad("Correspondence inventory mismatch.");
    if (byClass.some(x => x.converted === null || x.converted > x.expected) || byClass.reduce((n, x) => n + (x.converted ?? 0), 0) !== c.length) bad("Converted class totals mismatch.");
  } else if (i.convertedRenderable !== null || i.missing.length || byClass.some(x => x.converted !== null)) bad("Unknown mapping has results.");
});
export type ConversionValidationFacts = z.infer<typeof conversionFactsSchema>;
const purposeNames = ["view_3d", "locate_highlight", "distance_measurement", "ifc_rules"] as const;
// Frozen semantics for conversion-validation-record/v1. New technical policy
// semantics require a new record schema/implementation; owner scope versions are
// independent and must never select the technical evaluator.
const recordV1Requirements: Readonly<Record<Purpose, readonly string[]>> = Object.freeze({
  view_3d: ["source_inventory", "usd_artifact", "mesh_geometry", "coordinates", "inventory_completeness", "required_components"],
  locate_highlight: ["source_inventory", "usd_artifact", "mesh_geometry", "coordinates", "mapping", "required_components"],
  distance_measurement: ["source_inventory", "usd_artifact", "mesh_geometry", "coordinates", "units", "reference_measurement", "required_components"],
  ifc_rules: ["source_inventory", "ifc_rules", "required_components"],
});
for (const required of Object.values(recordV1Requirements)) Object.freeze(required);
/** Trusted server configuration only, never conversion metadata or HTTP input. */
export const approvedScopeSchema = z.object({
  id, version: text, purpose: z.enum(purposeNames), sourceSha256: sha, modelVersionId: externalId,
  tenantId: externalId, projectId: externalId,
  requiredGuids: z.array(id).min(1).max(100000),
}).strict().refine(scope => new Set(scope.requiredGuids).size === scope.requiredGuids.length, "Duplicate required GUID.");
export type ApprovedPurposeScope = z.infer<typeof approvedScopeSchema>;
export function purposeFactsV1(facts: ConversionValidationFacts, approvedScopes: readonly ApprovedPurposeScope[] = [],
  context?: { tenantId: string; projectId: string; modelVersionId?: string }) {
  const scopes = approvedScopes.map(scope => approvedScopeSchema.parse(scope));
  if (new Set(scopes.map(scope => scope.purpose)).size !== scopes.length) throw new Error("Duplicate purpose scope.");
  return purposeNames.map(purpose => {
    const scope = scopes.find(item => item.purpose === purpose);
    let required: PurposeCheck = { id: "required_components", state: "not_run", reasonCodes: ["approved_scope_unavailable"] };
    if (scope) {
      const externalModel = context?.modelVersionId ?? facts.modelVersionId;
      if (scope.sourceSha256 !== facts.sourceSha256 || scope.modelVersionId !== externalModel ||
          facts.modelVersionId !== sanitizeArtifactIdPart(externalModel) ||
          scope.tenantId !== context?.tenantId || scope.projectId !== context?.projectId) {
        required = { id: "required_components", state: "unknown", reasonCodes: ["approved_scope_binding_mismatch"] };
      } else if (facts.inventory.observation !== "observed" ||
          (purpose !== "ifc_rules" && facts.correspondence === null)) {
        required = { id: "required_components", state: "unknown", reasonCodes: ["required_components_unverifiable"] };
      } else {
        const mapped = new Set(purpose === "ifc_rules"
          ? [...(facts.expectedElements ?? []), ...facts.inventory.excluded].map(item => item.guid)
          : (facts.correspondence ?? []).map(item => item.guid));
        const missing = scope.requiredGuids.some(guid => !mapped.has(guid));
        required = { id: "required_components", state: missing ? "fail" : "pass", reasonCodes: missing ? ["required_components_missing"] : [] };
      }
    }
    return { purpose, policy: { id: scope?.id ?? "conversion-technical-baseline", version: scope?.version ?? "1",
      purpose, requiredCheckIds: [...recordV1Requirements[purpose]] },
    checks: [...facts.checks.filter(check => recordV1Requirements[purpose].includes(check.id)), required] };
  });
}

/** Current publication entrypoint. Historical record parsing imports V1 explicitly. */
export const purposeFacts = purposeFactsV1;
