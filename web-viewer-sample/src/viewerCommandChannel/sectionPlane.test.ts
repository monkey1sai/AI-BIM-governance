import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSectionInput, sectionReadbackMatches } from "./sectionPlane";

const input = { enabled: true, axis: "z" as const, direction: 1 as const, position: 2 };
afterEach(() => vi.useRealTimers());
describe("section plane contract", () => {
  it.each([null, {}, { ...input, position: "" }, { ...input, position: NaN }, { ...input, position: Infinity }, { ...input, axis: "a" }, { ...input, direction: 0 }, { ...input, role: "primary" }])("rejects malformed or authority-bearing input %j", value => {
    expect(parseSectionInput(value)).toBeNull();
  });
  it("accepts a finite model coordinate without converting units", () => {
    expect(parseSectionInput({ ...input, position: -3.25 })).toEqual({ ...input, position: -3.25 });
  });
  it("requires effective readback, tolerating float32 but not wrong planes", () => {
    expect(sectionReadbackMatches(input, { result: "success", enabled: true, planes: [[0, 0, 1, -2.0000001]] })).toBe(true);
    expect(sectionReadbackMatches(input, { result: "success", enabled: true, planes: [[0, 0, 1, -3]] })).toBe(false);
    expect(sectionReadbackMatches(input, { result: "success", enabled: true })).toBe(false);
    expect(sectionReadbackMatches(input, { result: "success", enabled: true, planes: [[0, 0, 1, NaN]] })).toBe(false);
  });
  it.each([{ planes: [] }, { planes: [[0, 0, 1, -2], [1, 0, 0, -8]] }])("off accepts preserved planes %j", ({ planes }) => {
    expect(sectionReadbackMatches({ ...input, enabled: false }, { result: "success", enabled: false, planes })).toBe(true);
  });
});
