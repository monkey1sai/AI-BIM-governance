import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import type { ReadyRenderBundle } from "../src/types.js";

let directory: string | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});
const now = "2026-09-09T00:00:00Z";
const later = "2026-09-09T00:01:00Z";
const initial = {
  idempotency_key: "mw_test", correlation_id: "trace", project_id: "p",
  project_display_name: "Project", category: "M", external_model_version_id: "v1",
  conversion_job_id: "job1", status: "ready" as const,
};
function setup() {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-atomic-"));
  const file = path.join(directory, "ledger.json");
  const ledger = new ConversionLedger(file);
  ledger.upsert(initial, now);
  return { file, ledger };
}
function bundle(): ReadyRenderBundle {
  return {
    readyModelId: initial.idempotency_key, conversionJobId: initial.conversion_job_id,
    correlationId: initial.correlation_id, tenantId: "tenant", projectId: initial.project_id,
    modelVersionId: initial.external_model_version_id, rootTraceId: "trace",
    model: { url: "http://127.0.0.1/model.usdc", sha256: "a".repeat(64) },
    mapping: { url: "http://127.0.0.1/mapping.json", sha256: "b".repeat(64) },
  };
}
const writers = {
  upsert: (ledger: ConversionLedger) => ledger.upsert({ ...initial, status: "failed" }, later),
  callback: (ledger: ConversionLedger) => ledger.recordCallbackOutcome(initial.idempotency_key,
    { status: "failed", coverage_report: { count: 4 } }, later),
  bundle: (ledger: ConversionLedger) => ledger.rememberRenderBundle(bundle()),
};

describe("ConversionLedger single-operation persistence and snapshot isolation", () => {

  it("publishes optional terminal artifacts and preserves omitted fields but clears explicit null", () => {
    const { file, ledger } = setup();
    const report = { counts: { expected: 4 } };
    const published = ledger.upsert(initial, later, { usdc_key: "artifact.usdc", coverage_report: report });
    expect(new ConversionLedger(file).get(initial.idempotency_key)).toMatchObject({
      status: "ready", usdc_key: "artifact.usdc", coverage_report: { counts: { expected: 4 } },
    });
    report.counts.expected = 99;
    expect(ledger.get(initial.idempotency_key)?.coverage_report).toEqual({ counts: { expected: 4 } });
    published.usdc_key = "mutated";
    ledger.upsert(initial, later);
    ledger.upsert({ ...initial, status: "failed" }, later, { usdc_key: undefined, coverage_report: undefined });
    expect(ledger.get(initial.idempotency_key)).toMatchObject({
      status: "failed", usdc_key: "artifact.usdc", coverage_report: { counts: { expected: 4 } },
    });
    ledger.upsert(initial, later, { usdc_key: null, coverage_report: null });
    expect(new ConversionLedger(file).get(initial.idempotency_key)).toMatchObject({
      usdc_key: null, coverage_report: null,
    });
  });

  it("rolls back terminal status and artifacts together on persistence failure", () => {
    const { file, ledger } = setup();
    const before = ledger.list();
    const bytes = fs.readFileSync(file, "utf8");
    const fault = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("injected"); });
    expect(() => ledger.upsert({ ...initial, status: "failed" }, later,
      { usdc_key: "new.usdc", coverage_report: { expected: 4 } })).toThrow("injected");
    expect(ledger.list()).toEqual(before);
    expect(fs.readFileSync(file, "utf8")).toBe(bytes);
    expect(new ConversionLedger(file).list()).toEqual(before);
    fault.mockRestore();
    ledger.upsert({ ...initial, status: "failed" }, later,
      { usdc_key: "new.usdc", coverage_report: { expected: 4 } });
    expect(new ConversionLedger(file).get(initial.idempotency_key)).toMatchObject({
      status: "failed", usdc_key: "new.usdc", coverage_report: { expected: 4 },
    });
  });
  for (const stage of ["mkdirSync", "writeFileSync", "renameSync"] as const) {
    for (const [name, write] of Object.entries(writers)) {
      it(`${name} rolls back memory when ${stage} fails, then retries durably`, () => {
        const { file, ledger } = setup();
        const before = ledger.list();
        const bytes = fs.readFileSync(file, "utf8");
        const fault = vi.spyOn(fs, stage).mockImplementationOnce(() => { throw new Error("injected"); });
        expect(() => write(ledger)).toThrow("injected");
        expect(ledger.list()).toEqual(before);
        expect(fs.readFileSync(file, "utf8")).toBe(bytes);
        expect(new ConversionLedger(file).list()).toEqual(before);
        fault.mockRestore();
        write(ledger);
        expect(ledger.list()).not.toEqual(before);
        expect(new ConversionLedger(file).list()).toEqual(ledger.list());
      });
    }
  }

  it("does not retain a new ghost key after rename failure", () => {
    const { file, ledger } = setup();
    const before = ledger.list();
    const bytes = fs.readFileSync(file, "utf8");
    const fault = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("injected"); });
    expect(() => ledger.upsert({ ...initial, idempotency_key: "new" }, later)).toThrow("injected");
    expect(ledger.get("new")).toBeNull();
    expect(ledger.list()).toEqual(before);
    expect(fs.readFileSync(file, "utf8")).toBe(bytes);
    expect(new ConversionLedger(file).list()).toEqual(before);
    fault.mockRestore();
    ledger.upsert({ ...initial, idempotency_key: "new" }, later);
    expect(new ConversionLedger(file).list()).toEqual(ledger.list());
  });

  it("upsert returns a detached snapshot", () => {
    const { file, ledger } = setup();
    const returned = ledger.upsert(initial, later);
    const before = ledger.list();
    returned.status = "failed";
    expect(ledger.list()).toEqual(before);
    expect(new ConversionLedger(file).list()).toEqual(before);
  });

  it("callback input and output cannot mutate the stored nested report", () => {
    const { file, ledger } = setup();
    const report = { counts: { expected: 4 } };
    const returned = ledger.recordCallbackOutcome(initial.idempotency_key,
      { status: "ready", coverage_report: report }, later)!;
    const before = ledger.list();
    report.counts.expected = 99;
    (returned.coverage_report as typeof report).counts.expected = 77;
    returned.status = "failed";
    expect(ledger.list()).toEqual(before);
    expect(new ConversionLedger(file).list()).toEqual(before);
  });

  it("memory-only mode also isolates caller input and output", () => {
    const ledger = new ConversionLedger();
    const returned = ledger.upsert(initial, now);
    returned.status = "failed";
    expect(ledger.get(initial.idempotency_key)?.status).toBe("ready");
    const report = { nested: { value: 4 } };
    const outcome = ledger.recordCallbackOutcome(initial.idempotency_key,
      { status: "ready", coverage_report: report }, later)!;
    const before = ledger.list();
    report.nested.value = 9;
    (outcome.coverage_report as typeof report).nested.value = 10;
    expect(ledger.list()).toEqual(before);
    expect(ledger.get(initial.idempotency_key)?.status).toBe("ready");
  });
});
