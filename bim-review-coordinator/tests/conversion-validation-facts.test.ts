import { describe, expect, it } from "vitest";
import { conversionFactsSchema, purposeFacts, type ConversionValidationFacts, type ApprovedPurposeScope } from "../src/services/conversionValidationFacts.js";
import { createConversionValidationRecord, parseConversionValidationRecord } from "../src/services/conversionValidationRecord.js";
import { evaluatePurpose } from "../src/services/purposeEvaluation.js";

const context = { tenantId: "tenant_1", projectId: "project_1" };
function facts(): ConversionValidationFacts {
  return {
    schemaVersion: "conversion-validation-facts/v1", validatorVersion: "conversion-facts-validator/v1",
    validatedAt: "2026-09-12T00:00:00Z", sourceSha256: "a".repeat(64), sourceName: "fixture.ifc",
    modelVersionId: "version_1", artifacts: { usdcSha256: "b".repeat(64), mappingSha256: "c".repeat(64) },
    inventory: { observation: "observed", expectedRenderable: 2, convertedRenderable: 1,
      missing: [{ guid: "g2", reasonCodes: ["renderable_not_corresponded"] }], excluded: [] },
    expectedElements: [{ guid: "g1", ifcType: "IfcWall" }, { guid: "g2", ifcType: "IfcWall" }],
    byClass: [{ ifcType: "IfcWall", expected: 2, converted: 1 }],
    correspondence: [{ guid: "g1", primPaths: ["/World/Wall"] }],
    units: { ifcLengthScaleM: 1, usdMetersPerUnit: 1, upAxis: "Z" },
    checks: [
      ...["source_inventory", "usd_artifact", "mesh_geometry", "mapping", "units"].map(id => ({ id, state: "pass" as const, reasonCodes: [] })),
      { id: "inventory_completeness", state: "pass_with_limits", reasonCodes: ["source_components_missing"], limitations: ["One component is missing."] },
      { id: "coordinates", state: "unknown", reasonCodes: ["alignment_not_validated"] },
      { id: "reference_measurement", state: "not_run", reasonCodes: ["reference_unavailable"] },
      { id: "ifc_rules", state: "not_run", reasonCodes: ["rule_authority_not_run"] },
    ],
  };
}
function scope(requiredGuids = ["g1"]): ApprovedPurposeScope {
  return { id: "owner-scope", version: "1", purpose: "view_3d",
    sourceSha256: "a".repeat(64), modelVersionId: "version_1", ...context, requiredGuids };
}
function outcome(value: ConversionValidationFacts, scopes: ApprovedPurposeScope[], purpose = "view_3d") {
  const item = purposeFacts(value, scopes, context).find(x => x.purpose === purpose)!;
  return evaluatePurpose(item.purpose, item.policy, item.checks);
}
function input(value: ConversionValidationFacts, scopes: ApprovedPurposeScope[] = []) {
  return { recordId: "validation_fixture", readyModelId: "mw_fixture", conversionJobId: "job_1", ...context,
    modelVersionId: value.modelVersionId, source: { name: value.sourceName, sha256: value.sourceSha256 },
    artifacts: value.artifacts, converterVersion: "converter/v1", validatorVersion: value.validatorVersion,
    validatedAt: value.validatedAt, inventory: value.inventory, correspondence: value.correspondence,
    evidence: value, approvedScopes: scopes, purposes: purposeFacts(value, scopes, context) };
}
describe("streaming conversion facts and trusted purpose scope", () => {
  it.each(["conversion-facts-validator/v3", "conversion-facts-validatr/v2"])("rejects unsupported validator %s", validatorVersion => {
    const value = { ...facts(), validatorVersion };
    value.checks.find(x => x.id === "coordinates")!.state = "pass";
    expect(conversionFactsSchema.safeParse(value).success).toBe(false);
  });
  function boundedFacts(): ConversionValidationFacts {
    const value = facts();
    value.validatorVersion = "conversion-facts-validator/v2";
    value.coordinateEvidence = { method: "ifc-usd-world-aabb/v1", toleranceM: 0.001,
      mappedCount: 1, checkedCount: 1, maxDeltaM: 0.000001, mismatchedGuids: [], unavailableGuids: [] };
    value.checks = value.checks.filter(x => x.id !== "coordinates");
    value.checks.push({ id: "coordinates", state: "pass_with_limits", reasonCodes: ["world_bounds_only"], limitations: ["Bounds only; no measurement claim."] });
    return value;
  }
  it("retains bounded coordinate evidence and limitations in a durable record", () => {
    const value = conversionFactsSchema.parse(boundedFacts());
    const record = createConversionValidationRecord(input(value, [scope()]));
    expect(record.evaluations[0].outcome).toBe("usable_with_limits");
    expect(parseConversionValidationRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });
  it.each(["missing", "denominator", "foreign", "delta", "state", "duplicate"])("rejects inconsistent bounds %s", change => {
    const value = boundedFacts();
    if (change === "missing") value.coordinateEvidence = null;
    if (change === "denominator") value.coordinateEvidence!.checkedCount = 0;
    if (change === "foreign") value.coordinateEvidence!.mismatchedGuids = ["foreign"];
    if (change === "delta") value.coordinateEvidence!.maxDeltaM = 5;
    if (change === "state") value.checks.find(x => x.id === "coordinates")!.state = "pass";
    if (change === "duplicate") value.coordinateEvidence!.unavailableGuids = ["g1", "g1"];
    expect(conversionFactsSchema.safeParse(value).success).toBe(false);
  });
  it("keeps actual evidence and unknown outcomes through historical parsing", () => {
    const value = conversionFactsSchema.parse(facts());
    const record = createConversionValidationRecord(input(value));
    expect(record.evaluations.every(x => x.outcome === "not_validated")).toBe(true);
    expect(parseConversionValidationRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(record.evidence?.inventory.expectedRenderable).toBe(2);
  });
  it("does not allow partial viewing until coordinate and required scope checks pass", () => {
    const value = facts();
    expect(outcome(value, [scope()]).outcome).toBe("not_validated");
    expect(outcome(boundedFacts(), []).outcome).toBe("not_validated");
    expect(outcome(boundedFacts(), [scope()]).outcome).toBe("usable_with_limits");
  });
  it("required missing component blocks despite unknown coordinates and high aggregate success", () => {
    const result = outcome(facts(), [scope(["g2"])]);
    expect(result.outcome).toBe("not_usable");
    expect(result.reasonCodes).toContain("required_components_missing");
  });
  it.each(["sourceSha256", "modelVersionId", "tenantId", "projectId"] as const)(
    "does not reuse scope across a changed %s", field => {
      const approval = scope(); approval[field] = field === "sourceSha256" ? "e".repeat(64) : "other";
      const value = boundedFacts();
      expect(outcome(value, [approval]).outcome).toBe("not_validated");
    });
  it("IFC rule purpose uses source membership and is independent of USD failure", () => {
    const value = facts();
    value.correspondence = null; value.inventory.convertedRenderable = null;
    value.inventory.missing = []; value.byClass[0].converted = null;
    value.checks.find(x => x.id === "usd_artifact")!.state = "fail";
    value.checks.find(x => x.id === "ifc_rules")!.state = "pass"; // Synthetic authority result only.
    const approval = { ...scope(["g2"]), purpose: "ifc_rules" as const };
    expect(outcome(conversionFactsSchema.parse(value), [approval], "ifc_rules").outcome).toBe("usable");
    expect(outcome(value, []).outcome).toBe("not_usable");
  });
  it.each(["denominator", "membership", "class_total", "duplicate_guid", "duplicate_check", "unknown_has_counts"])(
    "rejects inconsistent %s from the metadata producer", change => {
      const value = facts();
      if (change === "denominator") value.inventory.expectedRenderable = 1;
      if (change === "membership") value.correspondence![0].guid = "foreign";
      if (change === "class_total") value.byClass[0].expected = 3;
      if (change === "duplicate_guid") value.expectedElements![1].guid = "g1";
      if (change === "duplicate_check") value.checks.push(value.checks[0]);
      if (change === "unknown_has_counts") value.inventory.observation = "not_run";
      expect(conversionFactsSchema.safeParse(value).success).toBe(false);
    });
  it("record rejects edited policy checks even when a matching outcome is supplied", () => {
    const record = input(facts(), [scope()]);
    record.purposes[0].checks.find(x => x.id === "required_components")!.state = "pass";
    record.purposes[0].policy.requiredCheckIds = ["required_components"];
    expect(() => createConversionValidationRecord(record)).toThrow("evidence binding");
  });
  it("versioned scope is retained and a changed version cannot overwrite the stored input", () => {
    const old = createConversionValidationRecord(input(facts(), [scope()]));
    const revised = { ...scope(), version: "2", requiredGuids: ["g2"] };
    const next = createConversionValidationRecord({ ...input(facts(), [revised]), recordId: "validation_next" });
    expect(old.evaluations[0].policyVersion).toBe("1");
    expect(next.evaluations[0].policyVersion).toBe("2");
    expect(next.evaluations[0].outcome).toBe("not_usable");
    expect(old.evaluations[0].outcome).toBe("not_validated");
  });
});
