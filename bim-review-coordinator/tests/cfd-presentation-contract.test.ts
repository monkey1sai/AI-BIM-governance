import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { cfdRunResult } from "../src/contract/schemas/cfd.js";

describe("CFD presentation result", () => {
  it("preserves optional wind_frame and rejects a nonfinite angle or unknown source", () => {
    const schema = JSON.parse(fs.readFileSync(new URL("../../tests/contracts/cfd-run-result-v1.schema.json", import.meta.url), "utf8"));
    const result = schema.examples[0];
    expect(cfdRunResult.safeParse(result).success).toBe(true);
    result.wind_frame = { directions_relative_to: "true_north", true_north_degrees_used: 30, true_north_source: "manual" };
    expect(cfdRunResult.parse(result).wind_frame).toEqual(result.wind_frame);
    result.wind_frame.true_north_degrees_used = Infinity;
    expect(cfdRunResult.safeParse(result).success).toBe(false);
    result.wind_frame.true_north_degrees_used = 0;
    result.wind_frame.true_north_source = "guessed";
    expect(cfdRunResult.safeParse(result).success).toBe(false);
  });
  it("preserves optional presentation metadata while keeping old results valid", () => {
    const schema = JSON.parse(fs.readFileSync(new URL("../../tests/contracts/cfd-run-result-v1.schema.json", import.meta.url), "utf8"));
    const result = structuredClone(schema.examples[0]);
    expect(cfdRunResult.safeParse(result).success).toBe(true);
    const presentation = {
      version: 2, prims: [{ name: "StreamlineGrowth", role: "streamline_growth", default_visible: true, quantity: "U" }],
      animation: { fps: 24, frames: 240, growth_seconds: 6, note: "steady illustrative animation" },
      sections: [], building_footprint_xy: [[0, 0], [1, 0], [0, 1]],
    };
    result.directions[0].presentation = presentation;
    expect(cfdRunResult.parse(result).directions[0].presentation).toEqual(presentation);
    presentation.prims[0].name = "../Elements";
    expect(cfdRunResult.safeParse(result).success).toBe(false);
    presentation.prims[0].name = "StreamlineGrowth";
    presentation.prims = Array.from({ length: 64 }, (_, i) => ({ ...presentation.prims[0], name: `Layer_${i}` }));
    expect(cfdRunResult.safeParse(result).success).toBe(true);
    presentation.prims.push({ ...presentation.prims[0], name: "Layer_64" });
    expect(cfdRunResult.safeParse(result).success).toBe(false);
    presentation.prims.pop();
    presentation.animation.growth_seconds = 10;
    expect(cfdRunResult.safeParse(result).success).toBe(false);
  });
});
