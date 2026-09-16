import { describe, expect, it } from "vitest";
import { formatRatioPercent } from "./lineageFormat";

describe("formatRatioPercent", () => {
  it("以整數運算截斷到小數第二位，不受浮點誤差影響", () => {
    expect(formatRatioPercent({ numerator: 1001, denominator: 2000 })).toBe("50.05%");
    expect(formatRatioPercent({ numerator: 6045, denominator: 6134 })).toBe("98.54%");
    expect(formatRatioPercent({ numerator: 2, denominator: 3 })).toBe("66.66%");
    expect(formatRatioPercent({ numerator: 10, denominator: 10 })).toBe("100.00%");
    expect(formatRatioPercent({ numerator: 0, denominator: 7 })).toBe("0.00%");
  });

  it("分母為 0 時無法評估", () => {
    expect(formatRatioPercent({ numerator: 0, denominator: 0 })).toBe("—");
  });
});
