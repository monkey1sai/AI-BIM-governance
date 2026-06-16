// m2a-coverage-report:本檔目前只含 Task 2 的 isSafeConversionJobId helper 單元測試。
// route-level 測試（GET /api/conversions/:id/quality-metrics 的 400/404/502/503/null 守門）
// 由 Task 3 append 進本檔（見 docs/superpowers/plans/2026-06-16-conv-coverage-report.md Task 3）；
// 在 Task 3 落地前，本檔不涵蓋 production 路由行為。
import { describe, expect, it } from "vitest";
import { isSafeConversionJobId } from "../src/app.js";

describe("isSafeConversionJobId", () => {
  it("接受真實 conversion job id", () => {
    expect(isSafeConversionJobId("stream_conv_20260616_abcd1234")).toBe(true);
  });
  it("擋路徑穿越 / 空值 / 斜線", () => {
    expect(isSafeConversionJobId("../etc/passwd")).toBe(false);
    expect(isSafeConversionJobId("a/b")).toBe(false);
    expect(isSafeConversionJobId("")).toBe(false);
  });
  it("不誤用 session pattern（review_session_ 非必要）", () => {
    expect(isSafeConversionJobId("stream_conv_x")).toBe(true);
  });
  it("擋非 string 執行期值（鎖 typeof 守門，防日後被當多餘清掉）", () => {
    // TypeScript 簽名是 string,但 route param 等執行期路徑可能流入 null/undefined;
    // 這兩條鎖住 line 58 的 `typeof value === "string"` 守門,移除它本測試即失敗。
    expect(isSafeConversionJobId(null as unknown as string)).toBe(false);
    expect(isSafeConversionJobId(undefined as unknown as string)).toBe(false);
  });
});
