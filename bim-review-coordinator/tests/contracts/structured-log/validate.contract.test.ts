import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import * as AjvNs from "ajv";
import type { ErrorObject } from "ajv";

type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: (schema: unknown) => (data: unknown) => boolean;
  errors: ErrorObject[] | null | undefined;
};

const Ajv = (AjvNs as unknown as { default: AjvCtor }).default;

/**
 * Cross-service structured log schema contract test (TS side).
 *
 * Reads the same `schema.json` and `fixtures/{valid,invalid}/*.jsonl` artifacts
 * shared with the Python contract test at
 * `tests/contracts/structured-log/test_validate.py`. Both validators MUST agree:
 * fixtures in `valid/` pass, fixtures in `invalid/` fail.
 *
 * Run via coordinator's `npm test` (= vitest run).
 */

const CONTRACT_ROOT = resolve(__dirname, "../../../../tests/contracts/structured-log");
const SCHEMA_PATH = join(CONTRACT_ROOT, "schema.json");
const FIXTURE_DIR = join(CONTRACT_ROOT, "fixtures");

const VALID_EVENT_TYPES = [
  "logic_error",
  "operation_anomaly",
  "env_snapshot",
  "lifecycle",
  "audit",
  "network",
  "general",
] as const;

const LIFECYCLE_SUBJECT_KINDS = [
  "review_session",
  "conversion_job",
  "kit_subprocess",
  "ifc_ready_job",
  "script_run",
  "outbox_delivery",
] as const;

function loadSchema(): Record<string, unknown> {
  const text = readFileSync(SCHEMA_PATH, "utf-8");
  return JSON.parse(text);
}

function listFixtures(subdir: "valid" | "invalid"): string[] {
  const base = join(FIXTURE_DIR, subdir);
  let stat;
  try {
    stat = statSync(base);
  } catch {
    throw new Error(`Missing fixture dir: ${base}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Expected directory at ${base}`);
  }
  return readdirSync(base)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => join(base, name));
}

function loadFixture(path: string): unknown {
  const text = readFileSync(path, "utf-8").trim();
  if (text.includes("\n")) {
    throw new Error(`Fixture ${path} has more than one line; one record per file.`);
  }
  return JSON.parse(text);
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "<none>";
  return errors
    .map((e) => `${e.instancePath || "<root>"}: ${e.message ?? "<no message>"}`)
    .join("; ");
}

describe("structured-log contract", () => {
  const schema = loadSchema();
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema) as ((data: unknown) => boolean) & {
    errors?: ErrorObject[] | null;
  };

  it("schema declares the seven documented event_type values", () => {
    const enumValues = new Set(
      ((schema.properties as Record<string, unknown>).event_type as { enum: string[] }).enum,
    );
    expect(enumValues).toEqual(new Set(VALID_EVENT_TYPES));
  });

  it("schema declares the six documented lifecycle subject_kind values", () => {
    const allOf = schema.allOf as Array<{
      if?: { properties?: { event_type?: { const?: string } } };
      then?: { properties?: { data?: { properties?: { subject_kind?: { enum?: string[] } } } } };
    }>;
    const lifecycleBranch = allOf.find(
      (branch) => branch.if?.properties?.event_type?.const === "lifecycle",
    );
    const subjectKinds = new Set(
      lifecycleBranch?.then?.properties?.data?.properties?.subject_kind?.enum ?? [],
    );
    expect(subjectKinds).toEqual(new Set(LIFECYCLE_SUBJECT_KINDS));
  });

  describe("valid fixtures", () => {
    const fixtures = listFixtures("valid");

    it("has at least 14 positive fixtures (design §6.1 / tasks 1.4)", () => {
      expect(fixtures.length).toBeGreaterThanOrEqual(14);
    });

    for (const fixturePath of fixtures) {
      it(`accepts ${fixturePath.split(/[\\/]/).pop()}`, () => {
        const record = loadFixture(fixturePath);
        const ok = validate(record);
        if (!ok) {
          throw new Error(
            `${fixturePath} expected to pass schema but failed: ${formatErrors(validate.errors)}`,
          );
        }
      });
    }
  });

  describe("invalid fixtures", () => {
    const fixtures = listFixtures("invalid");

    it("has at least 4 negative fixtures", () => {
      expect(fixtures.length).toBeGreaterThanOrEqual(4);
    });

    for (const fixturePath of fixtures) {
      it(`rejects ${fixturePath.split(/[\\/]/).pop()}`, () => {
        const record = loadFixture(fixturePath);
        const ok = validate(record);
        expect(
          ok,
          `${fixturePath} expected to fail schema but passed; ` +
            "either the fixture is no longer invalid or the schema is too lax.",
        ).toBe(false);
      });
    }
  });
});
