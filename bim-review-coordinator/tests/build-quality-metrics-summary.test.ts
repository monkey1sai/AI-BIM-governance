import { describe, expect, it } from "vitest";
import { buildQualityMetricsSummary } from "../src/services/streamingConversionClient.js";
import type { StreamingConversionResult } from "../src/services/streamingConversionClient.js";

function resultWith(quality: Record<string, unknown> | undefined): StreamingConversionResult {
  return {
    conversion_job_id: "stream_conv_20260616_abcd1234",
    status: "succeeded",
    ready: true,
    usdc_ref: "http://x/model.usdc",
    element_mapping_ref: "http://x/element_mapping.json",
    manifest_ref: null,
    reason: null,
    raw: quality === undefined ? {} : { quality_metrics: quality },
  } as StreamingConversionResult;
}

describe("buildQualityMetricsSummary additive mapped/unmapped", () => {
  it("萃取 mapped_count / unmapped_count（後端正規化欄位）", () => {
    const s = buildQualityMetricsSummary(resultWith({
      source_ifc_entity_count: 100, mapped_count: 90, unmapped_count: 10,
      coverage_ratio: 0.9, coverage_status: "warn",
    }));
    expect(s).not.toBeNull();
    expect(s!.mapped_count).toBe(90);
    expect(s!.unmapped_count).toBe(10);
    expect(s!.coverage_ratio).toBe(0.9); // 既有欄位不退化
  });

  it("缺值回 null 不是 undefined（schema-stable 約定）", () => {
    const s = buildQualityMetricsSummary(resultWith({ coverage_ratio: 0.5 }));
    expect(s!.mapped_count).toBeNull();
    expect(s!.unmapped_count).toBeNull();
    expect(s!.mapping_information_status).toBeNull();
    expect(s!.mapping_issue_code).toBeNull();
    expect(s!.mapping_issue_count).toBeNull();
    expect(s!.mapping_issues).toBeNull();
  });

  it("轉送 mapping diagnostic fields（不在 coordinator 重算）", () => {
    const s = buildQualityMetricsSummary(resultWith({
      mapping_information_status: "incomplete",
      mapping_issue_code: "ifc_usdc_mapping_information_incomplete",
      mapping_issue_count: 1,
      mapping_issues: [{
        code: "ifc_usdc_mapping_information_incomplete",
        message: "element_mapping has no stable IFC GUID join key",
        severity: "warn",
        required_join_keys: ["ifc_guid", "usd_prim_path"],
        affected_ifc_count: 12,
        affected_usd_count: 12,
      }],
    }));

    expect(s!.mapping_information_status).toBe("incomplete");
    expect(s!.mapping_issue_code).toBe("ifc_usdc_mapping_information_incomplete");
    expect(s!.mapping_issue_count).toBe(1);
    expect(s!.mapping_issues).toEqual([{
      code: "ifc_usdc_mapping_information_incomplete",
      message: "element_mapping has no stable IFC GUID join key",
      severity: "warn",
      required_join_keys: ["ifc_guid", "usd_prim_path"],
      affected_ifc_count: 12,
      affected_usd_count: 12,
    }]);
  });

  it("無 quality_metrics 整體回 null（backward compatible）", () => {
    expect(buildQualityMetricsSummary(resultWith(undefined))).toBeNull();
  });
});
