import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversionLedger, publicConversionRecord } from "../src/services/conversionLedger.js";

let directory: string | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});
const key = "mw_abc123def4567890";
const now = "2026-09-09T00:00:00Z";
const initial = {
  idempotency_key: key, correlation_id: "trace", project_id: "project_1",
  project_display_name: "Project", category: "M", external_model_version_id: "version_1",
  conversion_job_id: "job_1", status: "ready" as const,
};
const input = () => ({
  recordId: "validation_1", readyModelId: key, conversionJobId: "job_1",
  tenantId: "tenant_1", projectId: "project_1", modelVersionId: "version_1",
  source: { name: "source.ifc", sha256: "a".repeat(64) },
  artifacts: { usdcSha256: "b".repeat(64), mappingSha256: "c".repeat(64) },
  correspondence: [{ guid: "converted_1", primPaths: ["/World/converted_1"] }],
  converterVersion: "1", validatorVersion: "1", validatedAt: now,
  inventory: { expectedRenderable: null, convertedRenderable: null, missing: [], excluded: [] },
  purposes: [],
});
function setup() {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "validation-ledger-"));
  const file = path.join(directory, "ledger.json");
  const ledger = new ConversionLedger(file);
  ledger.upsert(initial, now);
  return { file, ledger };
}

describe("validation history persistence", () => {
  it("persists detached records across reload and replays without another disk write", () => {
    const { file, ledger } = setup();
    const facts = input();
    const first = ledger.appendValidationRecord(key, facts);
    expect(first.recordId).toBe("validation_1");
    expect(first.evaluations.map((entry) => entry.outcome)).toEqual(Array(4).fill("not_validated"));
    expect(new ConversionLedger(file).listValidationRecords(key)).toEqual([first]);
    const before = fs.readFileSync(file, "utf8");
    const spy = vi.spyOn(fs, "renameSync");
    expect(ledger.appendValidationRecord(key, facts)).toEqual(first);
    expect(spy).not.toHaveBeenCalled();
    facts.source.name = "mutated";
    first.source.name = "mutated";
    ledger.listValidationRecords(key)[0].source.name = "mutated";
    expect(ledger.listValidationRecords(key)[0].source.name).toBe("source.ifc");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("rejects conflicting reuse without changing memory or disk", () => {
    const { file, ledger } = setup();
    ledger.appendValidationRecord(key, input());
    const before = fs.readFileSync(file, "utf8");
    expect(() => ledger.appendValidationRecord(key, { ...input(), validatorVersion: "2" })).toThrow();
    expect(ledger.listValidationRecords(key)[0].validatorVersion).toBe("1");
    expect(new ConversionLedger(file).listValidationRecords(key)[0].validatorVersion).toBe("1");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it.each(["readyModelId", "projectId", "modelVersionId", "conversionJobId"] as const)(
    "rejects mismatched %s without persisting", (field) => {
      const { file, ledger } = setup();
      const before = fs.readFileSync(file, "utf8");
      expect(() => ledger.appendValidationRecord(key, { ...input(), [field]: "other" })).toThrow();
      expect(ledger.listValidationRecords(key)).toEqual([]);
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    },
  );
  it("rejects missing source rows", () => {
    const { ledger } = setup();
    expect(() => ledger.appendValidationRecord("missing", input())).toThrow("not found");
  });

  it("preserves old history through callback, bundle and version changes", () => {
    const { file, ledger } = setup();
    const first = ledger.appendValidationRecord(key, input());
    ledger.recordCallbackOutcome(key, { status: "ready", usdc_key: "model.usdc" }, now);
    ledger.rememberRenderBundle({
      readyModelId: key, conversionJobId: "job_1", correlationId: "trace", rootTraceId: "trace",
      tenantId: "tenant_1", projectId: "project_1", modelVersionId: "version_1",
      model: { url: "http://127.0.0.1/model.usdc", sha256: "b".repeat(64) },
      mapping: { url: "http://127.0.0.1/mapping.json", sha256: "c".repeat(64) },
    });
    ledger.upsert({ ...initial, external_model_version_id: "version_2", conversion_job_id: "job_2" }, now);
    expect(ledger.appendValidationRecord(key, input())).toEqual(first);
    expect(() => ledger.appendValidationRecord(key, { ...input(), recordId: "validation_2" })).toThrow();
    ledger.appendValidationRecord(key, {
      ...input(), recordId: "validation_2", modelVersionId: "version_2", conversionJobId: "job_2",
    });
    expect(new ConversionLedger(file).listValidationRecords(key).map((entry) => entry.modelVersionId))
      .toEqual(["version_1", "version_2"]);
    expect(new ConversionLedger(file).listValidationRecords(key)[0].correspondence)
      .toEqual([{ guid: "converted_1", primPaths: ["/World/converted_1"] }]);
    expect(ledger.get(key)?.ready_render_bundle).toBeUndefined();
  });

  it("rolls back a failed atomic replace and permits a durable retry", () => {
    const { file, ledger } = setup();
    const before = fs.readFileSync(file, "utf8");
    const fault = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("injected"); });
    expect(() => ledger.appendValidationRecord(key, input())).toThrow("injected");
    expect(ledger.listValidationRecords(key)).toEqual([]);
    expect(new ConversionLedger(file).listValidationRecords(key)).toEqual([]);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    fault.mockRestore();
    ledger.appendValidationRecord(key, input());
    expect(new ConversionLedger(file).listValidationRecords(key)[0].recordId).toBe("validation_1");
  });

  it("keeps validation history out of public projections and strips it from v1", () => {
    const { file, ledger } = setup();
    ledger.appendValidationRecord(key, input());
    expect(publicConversionRecord(ledger.get(key)!)).not.toHaveProperty("validation_records");
    const disk = JSON.parse(fs.readFileSync(file, "utf8"));
    disk.schema_version = "conversion-ledger/v1";
    fs.writeFileSync(file, JSON.stringify(disk));
    expect(new ConversionLedger(file).listValidationRecords(key)).toEqual([]);
  });

  it.each(["schema", "outcome", "duplicate", "not-array", "wrong-key"])(
    "fails closed on persisted %s corruption without overwriting evidence", (kind) => {
      const { file, ledger } = setup();
      ledger.appendValidationRecord(key, input());
      const disk = JSON.parse(fs.readFileSync(file, "utf8"));
      const records = disk.records[0].validation_records;
      if (kind === "schema") records[0].schemaVersion = "future";
      if (kind === "outcome") records[0].evaluations[0].outcome = "usable";
      if (kind === "duplicate") records.push(records[0]);
      if (kind === "not-array") disk.records[0].validation_records = {};
      if (kind === "wrong-key") records[0].readyModelId = "other";
      fs.writeFileSync(file, JSON.stringify(disk));
      const before = fs.readFileSync(file, "utf8");
      const reloaded = new ConversionLedger(file);
      expect(() => reloaded.listValidationRecords(key)).toThrow("unavailable");
      expect(() => reloaded.upsert(initial, now)).toThrow("unavailable");
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    },
  );
});
