import { describe, expect, it } from "vitest";
import { createConversionValidationRecord, parseConversionValidationRecord } from "../src/services/conversionValidationRecord.js";

export const validationInput = () => ({
  recordId: "validation_1", readyModelId: "mw_abc123def4567890", conversionJobId: "job_1",
  tenantId: "tenant_1", projectId: "project_1", modelVersionId: "version_1",
  source: { name: "source.ifc", sha256: "a".repeat(64) },
  artifacts: { usdcSha256: "b".repeat(64), mappingSha256: "c".repeat(64) },
  correspondence: [{ guid: "converted_1", primPaths: ["/World/converted_1"] }],
  converterVersion: "1", validatorVersion: "1", validatedAt: "2026-09-09T00:00:00Z",
  inventory: { expectedRenderable: 2, convertedRenderable: 1,
    missing: [{ guid: "component_$1", reasonCodes: ["unsupported_geometry"] }], excluded: [] },
  purposes: [{ purpose: "view_3d", policy: { id: "test-policy", version: "1",
    purpose: "view_3d", requiredCheckIds: ["artifact", "geometry"] },
    checks: [{ id: "artifact", state: "pass", reasonCodes: [] },
      { id: "geometry", state: "pass_with_limits", reasonCodes: ["partial"],
        limitations: ["One component is missing."] }] }],
});

describe("conversion validation records", () => {
  it("roundtrips unknown converter and unobserved inventory without inventing facts", () => {
    const record = createConversionValidationRecord({ ...validationInput(), converterVersion: null,
      correspondence: null, purposes: [], inventory: { observation: "not_run",
        expectedRenderable: null, convertedRenderable: null, missing: [], excluded: [] } });
    expect(record.converterVersion).toBeNull();
    expect(record.inventory).toEqual({ observation: "not_run", expectedRenderable: null,
      convertedRenderable: null, missing: [], excluded: [] });
    expect(parseConversionValidationRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(record.evaluations.map(entry => entry.outcome)).toEqual(Array(4).fill("not_validated"));
    const legacy = createConversionValidationRecord(validationInput());
    expect(parseConversionValidationRecord(legacy)).toEqual(legacy);
    expect(legacy.inventory).not.toHaveProperty("observation");
  });
  it.each([
    { expectedRenderable: 0 }, { convertedRenderable: 0 },
    { missing: [{ guid: "missing", reasonCodes: ["missing_geometry"] }] },
    { excluded: [{ guid: "excluded", reason: "non_renderable" }] },
  ])("rejects facts asserted on an unobserved inventory: %j", (change) => {
    expect(() => createConversionValidationRecord({ ...validationInput(), correspondence: null,
      inventory: { observation: "not_run", expectedRenderable: null, convertedRenderable: null,
        missing: [], excluded: [], ...change } })).toThrow();
  });
  it("snapshots facts and all four purpose conclusions without granting missing policies", () => {
    const input = validationInput();
    const record = createConversionValidationRecord(input);
    expect(record.evaluations.map((entry) => entry.outcome)).toEqual([
      "usable_with_limits", "not_validated", "not_validated", "not_validated",
    ]);
    input.source.name = "changed.ifc";
    expect(record.source.name).toBe("source.ifc");
    input.correspondence[0].primPaths[0] = "/Changed";
    expect(record.correspondence).toEqual([{ guid: "converted_1", primPaths: ["/World/converted_1"] }]);
    expect(parseConversionValidationRecord(record)).toEqual(record);
  });
  it("keeps unknown inventory unknown without deriving its denominator", () => {
    const input = { ...validationInput(), inventory: {
      expectedRenderable: null, convertedRenderable: null, missing: [], excluded: [],
    }, purposes: [], correspondence: null };
    expect(createConversionValidationRecord(input).correspondence).toBeNull();
    expect(createConversionValidationRecord(input).inventory.expectedRenderable).toBeNull();
    expect(createConversionValidationRecord(input).evaluations.every((entry) => entry.outcome === "not_validated")).toBe(true);
  });
  it.each([
    (input: any) => { input.correspondence.push({ guid: "other", primPaths: ["/World/converted_1"] }); },
    (input: any) => { input.correspondence[0].guid = "component_$1"; },
    (input: any) => { input.inventory.excluded.push({ guid: "converted_1", reason: "non_renderable" }); },
    (input: any) => { input.correspondence.push(input.correspondence[0]); },
    (input: any) => { input.correspondence[0].primPaths.push("/World/converted_1"); },
    (input: any) => { input.actor = "supervisor"; },
    (input: any) => { input.source.sha256 = "etag-not-sha256"; },
    (input: any) => { input.validatedAt = "invalid"; },
    (input: any) => { input.inventory.convertedRenderable = 3; },
    (input: any) => { input.inventory.excluded = [{ guid: "other", reason: "unsupported_geometry" }]; },
    (input: any) => { input.inventory.excluded = [{ guid: "component_$1", reason: "non_renderable" }]; },
    (input: any) => { input.purposes.push(input.purposes[0]); },
    (input: any) => { input.purposes[0].checks.push(input.purposes[0].checks[0]); },
  ])("rejects malformed facts rather than silently dropping them", (mutate) => {
    const input = validationInput();
    mutate(input);
    expect(() => createConversionValidationRecord(input)).toThrow();
  });
  it("rejects stored conclusion or schema tampering", () => {
    const record = createConversionValidationRecord(validationInput());
    record.evaluations[0].outcome = "usable";
    expect(() => parseConversionValidationRecord(record)).toThrow("conclusions");
    expect(() => parseConversionValidationRecord({ ...record, schemaVersion: "future" })).toThrow("schema");
  });
});
