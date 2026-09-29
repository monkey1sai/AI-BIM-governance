import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_RELATIVE_PATH, buildCatalog, lf, renderAll, renderPython, renderTypeScript } from "./generate-cfd-settings-catalog.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const loadSchema = () => JSON.parse(readFileSync(path.join(repoRoot, SCHEMA_RELATIVE_PATH), "utf8"));
const setting = (schema, key) => {
  const [section, name] = key.split(".");
  return schema.properties[section].properties[name];
};

describe("CFD Settings Catalog generator", () => {
  // The hand-kept tables of cfd_options.py (main b37e22f) are the oracle: the derived values must be the same.
  it("reproduces the hand-maintained bounds, preset keys and panel it replaces", () => {
    const catalog = buildCatalog(loadSchema());
    const bounds = Object.fromEntries(catalog.settings.map((entry) => [entry.key, entry.bounds]));
    expect(bounds).toEqual({
      "preprocess.voxel_pitch_m": { type: "number", minimum: 0.1, maximum: 2.0 },
      "preprocess.closing_radius_voxels": { type: "integer", minimum: 0, maximum: 16 },
      "preprocess.leak_fraction_limit": { type: "number", minimum: 0, maximum: 1 },
      "wind.uref_m_s": { type: "number", exclusive_minimum: 0, maximum: 40 },
      "wind.zref_m": { type: "number", exclusive_minimum: 0, maximum: 200 },
      "wind.z0_m": { type: "number", exclusive_minimum: 0, maximum: 5 },
      "wind.true_north_source": { type: "enum", enum: ["geo_reference", "manual"] },
      "wind.true_north_degrees_manual": { type: "number", minimum: -180, maximum: 180, nullable: true },
      "mesh.background_cell_m": { type: "number", minimum: 0.5, maximum: 20, nullable: true },
      "mesh.surface_refinement_level": { type: "integer", minimum: 0, maximum: 4 },
      "mesh.region_refinement_level": { type: "integer", minimum: 0, maximum: 3 },
      "mesh.domain_upstream_h": { type: "number", minimum: 2, maximum: 10 },
      "mesh.domain_downstream_h": { type: "number", minimum: 5, maximum: 25 },
      "mesh.domain_lateral_h": { type: "number", minimum: 2, maximum: 10 },
      "mesh.domain_top_h": { type: "number", minimum: 2, maximum: 10 },
      "mesh.max_blockage_ratio": { type: "number", minimum: 0.01, maximum: 0.1 },
      "mesh.refinement_box_scale": { type: "number", minimum: 0.5, maximum: 2 },
      "mesh.outer_coarsening_levels": { type: "integer", minimum: 0, maximum: 2 },
      "mesh.coarsening_shell_h": { type: "number", minimum: 0.5, maximum: 5 },
      "mesh.ground_band_height_h": { type: "number", minimum: 0.05, maximum: 1, nullable: true },
      "solver.end_time": { type: "integer", minimum: 50, maximum: 5000 },
      "solver.n_procs": { type: "integer", minimum: 1, maximum: 64 },
    });
    expect(catalog.settings.filter((entry) => entry.preset).map((entry) => entry.key)).toEqual([
      "preprocess.voxel_pitch_m", "preprocess.closing_radius_voxels", "preprocess.leak_fraction_limit",
      "wind.zref_m", "wind.z0_m", "wind.true_north_source", "wind.true_north_degrees_manual",
      "mesh.background_cell_m", "mesh.surface_refinement_level", "mesh.region_refinement_level",
      "mesh.domain_upstream_h", "mesh.domain_downstream_h", "mesh.domain_lateral_h", "mesh.domain_top_h",
      "mesh.max_blockage_ratio", "mesh.refinement_box_scale", "mesh.outer_coarsening_levels",
      "mesh.coarsening_shell_h", "mesh.ground_band_height_h", "solver.end_time",
    ]);
    // cfd_job_service builds CaseParams from exactly these (preprocess settings drive run_preprocess).
    const engines = Object.fromEntries(catalog.settings.filter((entry) => entry.engine).map((entry) => [entry.key, entry.engine]));
    expect(engines).toEqual({
      "wind.uref_m_s": "uref_m_s", "wind.zref_m": "zref_m", "wind.z0_m": "z0_m",
      "mesh.background_cell_m": "background_cell_m", "mesh.surface_refinement_level": "surface_refinement_level",
      "mesh.region_refinement_level": "region_refinement_level", "mesh.domain_upstream_h": "domain_upstream_h",
      "mesh.domain_downstream_h": "domain_downstream_h", "mesh.domain_lateral_h": "domain_lateral_h",
      "mesh.domain_top_h": "domain_top_h", "mesh.max_blockage_ratio": "max_blockage_ratio",
      "mesh.refinement_box_scale": "refinement_box_scale", "mesh.outer_coarsening_levels": "outer_coarsening_levels",
      "mesh.coarsening_shell_h": "coarsening_shell_h", "mesh.ground_band_height_h": "ground_band_height_h",
      "solver.end_time": "end_time", "solver.n_procs": "n_procs",
    });
    // The panel of cfd_options.json at main b37e22f, in its order, with the parser's key order.
    const panel = catalog.settings.filter((entry) => entry.panel).map((entry) => entry.panel);
    expect(panel.map((field) => field.key)).toEqual([
      "wind.uref_m_s", "wind.zref_m", "wind.z0_m", "wind.true_north_source", "wind.true_north_degrees_manual",
      "mesh.background_cell_m", "solver.end_time",
    ]);
    expect(Object.keys(panel[0])).toEqual(["key", "section", "label", "help", "ui_default", "step", "unit"]);
    expect(panel[0]).toMatchObject({ section: "general", ui_default: 5, step: 0.5, unit: "m/s" });
    expect(panel[3]).toMatchObject({ enum_labels: { geo_reference: { zh: "IFC 定位資料", en: "IFC geo reference" }, manual: { zh: "手動輸入", en: "Manual" } } });
    expect(panel[4].visible_when).toEqual({ key: "wind.true_north_source", equals: "manual" });
    expect(panel.map((field) => field.section)).toEqual(["general", "general", "general", "general", "general", "advanced", "advanced"]);
  });

  it("reads whether a request must carry each setting from the section's required list", () => {
    const required = buildCatalog(loadSchema()).settings.filter((entry) => entry.required).map((entry) => entry.key);
    expect(required).toEqual(["wind.uref_m_s", "wind.zref_m", "wind.z0_m", "wind.true_north_source"]);
  });

  it("renders the TypeScript catalog with sorted keys, request-order declarations and per-section literals", () => {
    const ts = renderTypeScript(buildCatalog(loadSchema()), "0".repeat(64));
    expect(ts).toContain('export const CFD_SETTING_KEYS = ["mesh.background_cell_m", "mesh.coarsening_shell_h",');
    expect(ts).toMatch(/^  \{"key":"preprocess\.voxel_pitch_m","section":"preprocess","required":false,"bounds":\{"type":"number","minimum":0\.1,"maximum":2\},"preset":true,"engine":null,"panel":null\},$/m);
    expect(ts).toMatch(/^    uref_m_s: \{"required":true,"bounds":\{"type":"number","exclusive_minimum":0,"maximum":40\},"preset":false\},$/m);
    expect(ts).toMatch(/^    true_north_source: \{"required":true,"bounds":\{"type":"enum","enum":\["geo_reference","manual"\]\},"preset":true\},$/m);
    expect(ts).toMatch(/^    ground_band_height_h: \{"required":false,"bounds":\{"type":"number","minimum":0\.05,"maximum":1,"nullable":true\},"preset":true\},$/m);
    expect(ts).toContain("export const CFD_PANEL_SECTIONS = [\"general\", \"advanced\"] as const;");
  });

  it("renders number bounds as floats, integer bounds as ints and panel values as they were written", () => {
    const python = renderPython(buildCatalog(loadSchema()), "0".repeat(64));
    expect(python).toContain('"preprocess.voxel_pitch_m": {"type": "number", "minimum": 0.1, "maximum": 2.0},');
    expect(python).toContain('"wind.uref_m_s": {"type": "number", "exclusive_minimum": 0.0, "maximum": 40.0},');
    expect(python).toContain('"mesh.ground_band_height_h": {"type": "number", "minimum": 0.05, "maximum": 1.0, "nullable": True},');
    expect(python).toContain('"solver.end_time": {"type": "integer", "minimum": 50, "maximum": 5000},');
    expect(python).toContain('"wind.true_north_source": {"type": "enum", "enum": ["geo_reference", "manual"]},');
    expect(python).toContain('"ui_default": 5, "step": 0.5, "unit": "m/s"');
    expect(python).toContain('"visible_when": {"key": "wind.true_north_source", "equals": "manual"}');
    expect(python).toMatch(/^ORIGIN_FIELDS = \("preprocess\.voxel_pitch_m", .*"solver\.n_procs"\)$/m);
  });

  it("refuses a scalar setting that is not annotated, and an annotation on a non-setting", () => {
    const missing = loadSchema();
    delete setting(missing, "solver.n_procs")["x-cfd-setting"];
    expect(() => buildCatalog(missing)).toThrow("solver.n_procs has no x-cfd-setting");
    const extra = loadSchema();
    setting(extra, "wind.wind_from_degrees")["x-cfd-setting"] = { preset: false, engine: null };
    expect(() => buildCatalog(extra)).toThrow("wind.wind_from_degrees is not a setting");
  });

  it("refuses annotation shapes it does not derive", () => {
    const withAnnotation = (key, mutate) => {
      const schema = loadSchema();
      mutate(setting(schema, key));
      return () => buildCatalog(schema);
    };
    expect(withAnnotation("solver.end_time", (spec) => { spec["x-cfd-setting"].origin = true; })).toThrow("unknown key origin");
    expect(withAnnotation("solver.end_time", (spec) => { spec["x-cfd-setting"].preset = "yes"; })).toThrow("preset must be a boolean");
    expect(withAnnotation("solver.end_time", (spec) => { spec["x-cfd-setting"].engine = "End-Time"; })).toThrow("engine must be a CaseParams field name or null");
    expect(withAnnotation("solver.end_time", (spec) => { spec.exclusiveMaximum = 6000; })).toThrow("uses schema keyword exclusiveMaximum");
    expect(withAnnotation("solver.end_time", (spec) => { delete spec.maximum; })).toThrow("needs a maximum");
    expect(withAnnotation("solver.end_time", (spec) => { spec["x-cfd-setting"].panel.ui_default = 600; })).toThrow("preset-controlled");
    expect(withAnnotation("wind.uref_m_s", (spec) => { delete spec["x-cfd-setting"].panel.ui_default; })).toThrow("needs panel.ui_default");
    expect(withAnnotation("wind.uref_m_s", (spec) => { spec["x-cfd-setting"].panel.ui_default = 41; })).toThrow("ui_default is outside the bounds");
    expect(withAnnotation("wind.uref_m_s", (spec) => { spec["x-cfd-setting"].panel.section = "experimental"; })).toThrow("panel.section must be one of general, advanced");
    expect(withAnnotation("wind.true_north_source", (spec) => { delete spec["x-cfd-setting"].panel.enum_labels.manual; })).toThrow("enum_labels must label exactly");
    expect(withAnnotation("wind.true_north_degrees_manual", (spec) => { spec["x-cfd-setting"].panel.visible_when.equals = "compass"; })).toThrow("is not a valid value of wind.true_north_source");
    expect(withAnnotation("wind.true_north_degrees_manual", (spec) => { spec["x-cfd-setting"].panel.visible_when.key = "wind.compass"; })).toThrow("wind.compass is not a setting");
    expect(withAnnotation("mesh.domain_top_h", (spec) => { spec["x-cfd-setting"].engine = "domain_upstream_h"; })).toThrow("two settings drive the same engine field");
  });

  it("keeps every committed output equal to a fresh render", () => {
    for (const output of renderAll()) {
      const committed = lf(readFileSync(path.join(repoRoot, output.relativePath), "utf8"));
      expect(committed, `${output.relativePath} is stale; run: cd web-viewer-sample && npm run generate:cfd-settings-catalog`)
        .toBe(output.content);
    }
  });
});
