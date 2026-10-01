import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { cfdRunResult } from "../src/contract/schemas/cfd.js";

describe("CFD presentation result", () => {
  it("keeps real transient mode and physical provenance paired, refusing a steady/missing mixture", () => {
    const schema = JSON.parse(fs.readFileSync(new URL("../../tests/contracts/cfd-run-result-v1.schema.json", import.meta.url), "utf8"));
    const result = structuredClone(schema.examples[0]);
    const temporal = { mode:"urans_sampled",solver:"pimpleFoam",fixed_geometry:true,interpolation:"sample_hold",
      sample_times_s:[.5,1,1.5],output_interval_s:.5,source_run_id:"cfd_source_test",manifest_sha256:"a".repeat(64),
      requested_duration_s:10,complete_requested_duration:false };
    result.directions[0].presentation = { version:2,prims:[],sections:[],building_footprint_xy:[],temporal,
      animation:{mode:"urans_sampled",fps:24,frames:37,note:"paired URANS"} };
    expect(cfdRunResult.safeParse(result).success).toBe(true);
    delete result.directions[0].presentation.temporal;
    expect(cfdRunResult.safeParse(result).success).toBe(false);
    result.directions[0].presentation.temporal=temporal;
    result.directions[0].presentation.animation={fps:24,frames:240,growth_seconds:6,note:"steady"};
    expect(cfdRunResult.safeParse(result).success).toBe(false);
  });
  it("preserves visual ROI provenance and rejects unsupported bounds", () => {
    const schema = JSON.parse(fs.readFileSync(new URL("../../tests/contracts/cfd-run-result-v1.schema.json", import.meta.url), "utf8"));
    const result = structuredClone(schema.examples[0]);
    const visual_roi = { source: "ifc_envelope", extent_m: [50, 60, 20], horizontal_margin_h: 1, top_margin_h: 0.25 };
    result.directions[0].presentation = { version: 2, prims: [],
      animation: { fps: 24, frames: 240, growth_seconds: 6, note: "steady" }, sections: [], building_footprint_xy: [], visual_roi };
    expect(cfdRunResult.parse(result).directions[0].presentation?.visual_roi).toEqual(visual_roi);
    for (const bad of [0, -1, Infinity, NaN]) {
      visual_roi.extent_m[0] = bad;
      expect(cfdRunResult.safeParse(result).success).toBe(false);
    }
  });
  it("preserves shell-relative near-wall sampling and rejects invalid distances", () => {
    const schema = JSON.parse(fs.readFileSync(new URL("../../tests/contracts/cfd-run-result-v1.schema.json", import.meta.url), "utf8"));
    const result = structuredClone(schema.examples[0]);
    const near_wall = { distance_m: 2, surface_cell_m: 1, reference: "computation_shell", interpolation: "cellPoint" };
    result.directions[0].presentation = { version: 2,
      prims: [{ name: "NearWallWindSpeed", role: "near_wall_speed", default_visible: false, quantity: "U" }],
      animation: { fps: 24, frames: 240, growth_seconds: 6, note: "steady illustrative animation" },
      sections: [], building_footprint_xy: [], near_wall };
    expect(cfdRunResult.parse(result).directions[0].presentation?.near_wall).toEqual(near_wall);
    for (const bad of [0, -1, Infinity, NaN]) {
      near_wall.distance_m = bad;
      expect(cfdRunResult.safeParse(result).success).toBe(false);
    }
  });
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
