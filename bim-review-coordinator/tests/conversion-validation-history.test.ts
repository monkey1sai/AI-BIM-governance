import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseConversionValidationRecord } from "../src/services/conversionValidationRecord.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";

// Simulate a future publication policy/algorithm. Record V1 must not call either
// moving entrypoint, or replace its stored facts with a newer policy conclusion.
vi.mock("../src/services/conversionValidationFacts.js", async original => ({
  ...await original<typeof import("../src/services/conversionValidationFacts.js")>(),
  purposeFacts: () => { throw new Error("future publication policy"); },
}));
vi.mock("../src/services/purposeEvaluation.js", async original => ({
  ...await original<typeof import("../src/services/purposeEvaluation.js")>(),
  evaluatePurpose: () => { throw new Error("future outcome semantics"); },
}));
const fixture = () => JSON.parse(fs.readFileSync(new URL("./fixtures/conversion-validation-record-v1.json", import.meta.url), "utf8"));
describe("frozen record V1 history", () => {
  it("retains the checked-in historical policy and conclusion after current policy changes", () => {
    const saved = fixture();
    expect(parseConversionValidationRecord(saved)).toEqual(saved);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "validation-history-"));
    try {
      const file = path.join(root, "ledger.json");
      fs.writeFileSync(file, JSON.stringify({ schema_version: "conversion-ledger/v2", records: [
        { idempotency_key: saved.readyModelId, validation_records: [saved] },
      ] }));
      expect(new ConversionLedger(file).listValidationRecords(saved.readyModelId)).toEqual([saved]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it.each(["requirements", "checks", "outcome"])("still rejects historical %s tampering", change => {
    const saved = fixture();
    if (change === "requirements") saved.purposes[0].policy.requiredCheckIds = ["required_components"];
    if (change === "checks") saved.purposes[0].checks[0].state = "pass";
    if (change === "outcome") saved.evaluations[0].outcome = "usable";
    expect(() => parseConversionValidationRecord(saved)).toThrow();
  });
});
