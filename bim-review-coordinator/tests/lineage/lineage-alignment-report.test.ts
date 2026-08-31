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

  it("拒絕 JSON string 內的非法 UTF-8 bytes，不以 replacement character 靜默改寫 identifier", () => {
    const bytes = Buffer.from(
      fixtureBytes("valid", "alignment-report-json-all-difference-sets.json"),
    );
    const document = JSON.parse(bytes.toString("utf-8")) as {
      body: { difference_sets: { csv_only: Array<{ rvt_element_id: string }> } };
    };
    const marker = Buffer.from(`"${document.body.difference_sets.csv_only[0]!.rvt_element_id}"`, "utf-8");
    const markerOffset = bytes.indexOf(marker);
    expect(markerOffset).toBeGreaterThanOrEqual(0);
    bytes[markerOffset + 1] = 0xc3;
    bytes[markerOffset + 2] = 0x28;

    expect(parseLineageAlignmentReport(bytes)).toBeNull();
  });

  it("接受 class segment 與 advisory ifc_class 不同、但 GlobalId stable token 正確的 IFC-only root", () => {
    const document = JSON.parse(
      fixtureBytes("valid", "alignment-report-json-all-difference-sets.json").toString("utf-8"),
    ) as {
      body: {
        difference_sets: {
          ifc_only: Array<{ ifc_class: string; usd_prim_path?: string }>;
        };
      };
    };
    const row = document.body.difference_sets.ifc_only.find((item) => item.usd_prim_path);
    expect(row).toBeDefined();
    row!.ifc_class = row!.ifc_class === "IfcWall" ? "IfcDoor" : "IfcWall";

    expect(parseLineageAlignmentReport(Buffer.from(JSON.stringify(document), "utf-8"))).not.toBeNull();
  });
});
