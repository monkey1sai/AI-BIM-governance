import { describe, expect, it } from "vitest";
import type { CfdOptionsDocument, CfdRunOrigin } from "./cfdClient";
import {
  applyPreset, buildSettings, checkField, CUSTOM_PRESET, estimateRequest, formatCells, formatDuration, initialSettings, matchPreset, settingsFromOrigin, settingsKey,
} from "./cfdSettings";
// The contract example is generated from the real streaming options builder (S8), so these tests exercise real bounds.
import optionsSchema from "../../../../tests/contracts/cfd-options-v1.schema.json";

const OPTIONS = optionsSchema.examples[0] as unknown as CfdOptionsDocument;
const fieldOf = (key: string) => OPTIONS.fields.find((item) => item.key === key)!;

describe("cfdSettings (S8)", () => {
  it("initial values are the option defaults as input strings; null means automatic", () => {
    const values = initialSettings(OPTIONS);
    expect(values["wind.uref_m_s"]).toBe("5");
    expect(values["wind.zref_m"]).toBe("10");
    expect(values["mesh.background_cell_m"]).toBe("");
    expect(values["wind.true_north_source"]).toBe("geo_reference");
    expect(matchPreset(OPTIONS, values)).toBe("standard");
  });

  it("checks each field against the bounds the options report (exclusive minimum, maximum, integer, enum, nullable)", () => {
    const uref = fieldOf("wind.uref_m_s");
    expect(checkField(uref, "0").error?.[0]).toContain("須大於 0");
    expect(checkField(uref, "40").error).toBeNull();
    expect(checkField(uref, "40.5").error?.[0]).toContain("不超過 40");
    expect(checkField(uref, "abc").error?.[0]).toBe("須為數字");
    expect(checkField(uref, "").error?.[0]).toBe("必填");
    const endTime = fieldOf("solver.end_time");
    expect(checkField(endTime, "600.5").error?.[0]).toBe("須為整數");
    expect(checkField(endTime, "40").error?.[0]).toContain("介於 50 到 5000");
    const cell = fieldOf("mesh.background_cell_m");
    expect(checkField(cell, "")).toEqual({ value: null, error: null });
    expect(checkField(cell, "0.4").error).not.toBeNull();
    expect(checkField(fieldOf("wind.true_north_source"), "compass").error?.[0]).toBe("請選擇一個選項");
  });

  it("a hidden field does not make the settings custom and is not sent", () => {
    const values = { ...initialSettings(OPTIONS), "wind.true_north_degrees_manual": "33" };
    expect(matchPreset(OPTIONS, values)).toBe("standard");
    const built = buildSettings(OPTIONS, values);
    expect(built.sections.wind).not.toHaveProperty("true_north_degrees_manual");
    const manual = { ...values, "wind.true_north_source": "manual" };
    expect(matchPreset(OPTIONS, manual)).toBe(CUSTOM_PRESET);
    expect(buildSettings(OPTIONS, manual).sections.wind.true_north_degrees_manual).toBe(33);
  });

  it("numbers compare by value, and applying the standard preset restores every preset field shown in the form", () => {
    const values = { ...initialSettings(OPTIONS), "wind.zref_m": "10.0" };
    expect(matchPreset(OPTIONS, values)).toBe("standard");
    const changed = { ...values, "wind.zref_m": "12", "solver.end_time": "900", "wind.uref_m_s": "7" };
    expect(matchPreset(OPTIONS, changed)).toBe(CUSTOM_PRESET);
    const restored = applyPreset(OPTIONS, changed, "standard");
    expect(restored["wind.zref_m"]).toBe("10");
    expect(restored["solver.end_time"]).toBe("600");
    expect(restored["wind.uref_m_s"]).toBe("7"); // U_ref is the scenario, not part of any preset
  });

  it("builds request sections from the form plus the preset fields the form does not show; errors block", () => {
    const built = buildSettings(OPTIONS, initialSettings(OPTIONS));
    expect(built.ok).toBe(true);
    expect(built.sections).toEqual({
      preprocess: { profile: "exterior-wind/v1", voxel_pitch_m: 0.5, closing_radius_voxels: 4, leak_fraction_limit: 0.15 },
      wind: { uref_m_s: 5, zref_m: 10, z0_m: 0.5, true_north_source: "geo_reference" },
      mesh: { background_cell_m: null, surface_refinement_level: 2, region_refinement_level: 1 },
      solver: { end_time: 600 },
    });
    const request = estimateRequest("stream_conv_x", [0, 90], built);
    expect(request.schema).toBe("cfd-estimate-request/v1");
    expect(request.wind.wind_from_degrees).toEqual([0, 90]);
    expect(settingsKey("stream_conv_x", [0, 90], built)).not.toBe(settingsKey("stream_conv_x", [0], built));
    const broken = buildSettings(OPTIONS, { ...initialSettings(OPTIONS), "wind.z0_m": "9" });
    expect(broken.ok).toBe(false);
    expect(Object.keys(broken.errors)).toEqual(["wind.z0_m"]);
  });

  it("an origin recorded before S8 falls back to the field defaults; a recorded one is restored verbatim", () => {
    const before: CfdRunOrigin = { session_id: null, wind_from_degrees: [0], uref_m_s: 6, end_time: null, n_procs: null, background_cell_m: null };
    const current = { ...initialSettings(OPTIONS), "wind.zref_m": "30" };
    const restored = settingsFromOrigin(OPTIONS, before, current);
    expect(restored["wind.zref_m"]).toBe("10");
    expect(restored["wind.uref_m_s"]).toBe("6");
    expect(restored["solver.end_time"]).toBe("600");
    expect(restored["mesh.background_cell_m"]).toBe("");
    const recorded: CfdRunOrigin = { ...before, zref_m: 12, z0_m: 0.3, true_north_source: "manual", true_north_degrees_manual: -5, background_cell_m: 4, end_time: 900, preset_match: null };
    const again = settingsFromOrigin(OPTIONS, recorded, current);
    expect([again["wind.zref_m"], again["wind.z0_m"], again["wind.true_north_source"], again["wind.true_north_degrees_manual"], again["mesh.background_cell_m"], again["solver.end_time"]])
      .toEqual(["12", "0.3", "manual", "-5", "4", "900"]);
  });

  it("formats cells and durations for the estimate", () => {
    expect(formatCells(3_048_141)).toBe("3.05 M");
    expect(formatCells(841_680)).toBe("841,680");
    expect(formatDuration(45)[0]).toBe("約 45 秒");
    expect(formatDuration(1_715)[0]).toBe("約 29 分鐘");
    expect(formatDuration(25_416)[0]).toBe("約 7.1 小時");
  });
});
