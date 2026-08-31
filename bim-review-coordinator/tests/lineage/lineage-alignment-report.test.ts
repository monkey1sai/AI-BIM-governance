import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLineageAlignmentReport } from "../../src/services/lineage/lineageAlignmentReport.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL(
    "../../../tests/contracts/lineage/fixtures/lineage_alignment_report/",
    import.meta.url,
  ),
);

function fixtureBytes(group: "valid" | "invalid" | "semantic", filename: string): Buffer {
  return readFileSync(`${FIXTURE_ROOT}/${group}/${filename}`);
}

describe("lineage alignment report runtime parser", () => {
  it("接受根契約全部 JSON-report valid fixtures（CSV contract 不屬這個 artifact reader）", () => {
    const filenames = readdirSync(`${FIXTURE_ROOT}/valid`).filter(
      (name) => name.endsWith(".json") && !name.includes("csv-contract"),
    );
    expect(filenames.length).toBeGreaterThan(0);
    for (const filename of filenames) {
      expect(parseLineageAlignmentReport(fixtureBytes("valid", filename)), filename).not.toBeNull();
    }
  });

  it("拒絕根契約全部 invalid fixtures", () => {
    const filenames = readdirSync(`${FIXTURE_ROOT}/invalid`).filter((name) => name.endsWith(".json"));
    expect(filenames.length).toBeGreaterThan(0);
    for (const filename of filenames) {
      expect(parseLineageAlignmentReport(fixtureBytes("invalid", filename)), filename).toBeNull();
    }
  });

  it("semantic corpus 的 clean JSON report 全收，其餘診斷案例全拒絕", () => {
    const filenames = readdirSync(`${FIXTURE_ROOT}/semantic`).filter((name) => name.endsWith(".json"));
    for (const filename of filenames) {
      const fixture = JSON.parse(fixtureBytes("semantic", filename).toString("utf-8")) as {
        payload: unknown;
      };
      const parsed = parseLineageAlignmentReport(Buffer.from(JSON.stringify(fixture.payload), "utf-8"));
      if (filename.startsWith("clean-") && !filename.includes("csv-contract")) {
        expect(parsed, filename).not.toBeNull();
      } else {
        expect(parsed, filename).toBeNull();
      }
    }
  });
});
