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
});
