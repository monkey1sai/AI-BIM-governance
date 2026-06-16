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
  });

  it("無 quality_metrics 整體回 null（backward compatible）", () => {
    expect(buildQualityMetricsSummary(resultWith(undefined))).toBeNull();
  });
});
