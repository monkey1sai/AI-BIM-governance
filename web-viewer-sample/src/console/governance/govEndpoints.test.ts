// web-viewer-sample/src/console/governance/govEndpoints.test.ts
import { describe, expect, it } from "vitest";
import { MVP_IDENTITY_PROFILE, MVP_MIN_COVERAGE, evaluateCoverageGate } from "./govEndpoints";

describe("MVP identity profile + coverage gate（誠實降級，零新引擎）", () => {
  it("MVP 常量：強制 guid_exact、minimum_coverage_ratio=1.0、denominator=source_ifc_entity_count", () => {
    expect(MVP_IDENTITY_PROFILE).toBe("guid_exact");
    expect(MVP_MIN_COVERAGE).toBe(1.0);
  });

  it("coverage 1.0 → pass，不降級", () => {
    const g = evaluateCoverageGate({ coverageRatio: 1.0, isFake: false });
    expect(g.coverageOk).toBe(true);
    expect(g.degraded).toBe(false);
  });

  it("coverage 0.95（0.9≤r<1.0，warn band）→ 不達標但不降級（warnOnly）", () => {
    // measure-first：低於 locked 1.0 即 warn（coverageOk=false, warnOnly=true），但未跌破 fallback
    // 觸發閾值 0.9，故不進降級路徑（degraded=false）。
    const g = evaluateCoverageGate({ coverageRatio: 0.95, isFake: false });
    expect(g.coverageOk).toBe(false);
    expect(g.degraded).toBe(false);
    expect(g.warnOnly).toBe(true);
  });

  it("coverage 0.85（<0.9）→ degraded（warn 不 fail，measure-first）", () => {
    const g = evaluateCoverageGate({ coverageRatio: 0.85, isFake: false });
    expect(g.coverageOk).toBe(false);
    expect(g.degraded).toBe(true);
    expect(g.warnOnly).toBe(true); // runtime-verification-evidence：低覆蓋 warn 不 fail
  });

  it("fake mapping → 不算覆蓋率（degraded，coverageRatio 視為不可信）", () => {
    const g = evaluateCoverageGate({ coverageRatio: null, isFake: true });
    expect(g.coverageOk).toBe(false);
    expect(g.degraded).toBe(true);
  });

  it("coverage 未知（null，非 fake）→ degraded（不假裝 1.0）", () => {
    const g = evaluateCoverageGate({ coverageRatio: null, isFake: false });
    expect(g.coverageOk).toBe(false);
    expect(g.degraded).toBe(true);
  });
});
