import { describe, expect, it, vi } from "vitest";
import cases from "../../../tests/contracts/wind-bearing-cases-v1.json";
import example from "../../../tests/contracts/cfd-run-result-v1.schema.json";
import type { CfdRunResult } from "../console/unified/cfdClient";
import { buildCfdHud, drawCfdHud, modelWindBearing, parseCfdHud } from "./cfdHud";

const result = example.examples[0] as unknown as CfdRunResult;
function make() {
  return buildCfdHud({ ...result, assumptions: ["true_north_unknown_assumed_project_north"] },
    { ...result.directions[0], legend: { U: { min: 1, max: 9, unit: "m/s" }, p: { available: true, min: -3, max: 7, unit: "m²/s²" } } }, "revision_1", false);
}
describe("CFD HUD result and coordinate contract", () => {
  it.each(cases.cases)("matches shared wind-to-model case $wind_from / $true_north", value => {
    expect(modelWindBearing(value.wind_from, value.true_north)).toBeCloseTo(value.model_from);
    const radians = modelWindBearing(value.wind_from, value.true_north) * Math.PI / 180;
    expect(Math.sin(radians)).toBeCloseTo(-value.flow[0]);
    expect(Math.cos(radians)).toBeCloseTo(-value.flow[1]);
  });
  it("uses the result scale verbatim and never infers pressure visibility", () => {
    const hud = make();
    expect(hud.velocity).toMatchObject({ min: 1, max: 9, unit: "m/s" });
    expect(hud.pressure).toBeNull();
    expect(hud.northLabel).toBe("相對 project north");
    expect(parseCfdHud(hud)).toEqual(hud);
  });
  it("does not invent a legacy manual north angle", () => {
    const hud = buildCfdHud({ ...result, assumptions: ["true_north_manual"] }, result.directions[0], "rev", true);
    expect(hud.modelBearing).toBeNull();
    expect(hud.northLabel).toContain("未記錄");
    const manual = buildCfdHud({ ...result, wind_frame: { directions_relative_to: "true_north", true_north_degrees_used: 30, true_north_source: "manual" } },
      { ...result.directions[0], wind_from_degrees: 90 }, "rev", true);
    expect(manual.modelBearing).toBe(60);
    expect(manual.northLabel).toContain("true north");
  });
  it("rejects malformed/nonfinite/unbounded payloads", () => {
    for (const patch of [{ windFrom: NaN }, { modelBearing: 360 }, { runId: "private/path" }, { purpose: "certification" },
      { velocity: { min: 0, max: Infinity, unit: "m/s", label: "U" } }, { revisionId: "x".repeat(241) }]) {
      expect(parseCfdHud({ ...make(), ...patch })).toBeNull();
    }
  });
  it("paints result ranges, five writer colour stops, wind, honest footer and UTC with one renderer", () => {
    const text = vi.fn(), stop = vi.fn();
    const ctx = { save: vi.fn(), restore: vi.fn(), scale: vi.fn(), fillRect: vi.fn(), fillText: text,
      createLinearGradient: () => ({ addColorStop: stop }), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn() } as unknown as CanvasRenderingContext2D;
    drawCfdHud(ctx, 1000, 700, make(), 90, "2026-10-01T00:00:00Z");
    expect(stop.mock.calls).toEqual([[0,"#0000ff"],[.25,"#00ffff"],[.5,"#00ff00"],[.75,"#ffff00"],[1,"#ff0000"]]);
    const labels = text.mock.calls.map(c => c[0]).join("\n");
    expect(labels).toContain("1.00"); expect(labels).toContain("9.00");
    expect(labels).toContain("設計比較用"); expect(labels).toContain("非瞬態模擬"); expect(labels).toContain("2026-10-01T00:00:00Z");
    expect(labels).not.toContain("壓力");
  });
});
