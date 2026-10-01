// GENERATED FILE - DO NOT EDIT.
// CFD Settings Catalog，由 tests/contracts/cfd-run-request-v1.schema.json 的 x-cfd-setting 生成。
// 再生成：cd web-viewer-sample && npm run generate:cfd-settings-catalog
// source-sha256: 6fdd8a102031286a9cf08a5e54eba6c68cdb5b0f80e2ad308c517e18b285e3bb

export type CfdSettingSection = "preprocess" | "wind" | "mesh" | "solver";
export type CfdSettingBounds =
  | { readonly type: "number" | "integer"; readonly minimum?: number; readonly exclusive_minimum?: number; readonly maximum: number; readonly nullable?: true }
  | { readonly type: "enum"; readonly enum: readonly string[] };
export interface CfdLocalizedText { readonly zh: string; readonly en: string }
export interface CfdPanelField {
  readonly key: CfdSettingKey;
  readonly section: "general" | "advanced";
  readonly label: CfdLocalizedText;
  readonly help: CfdLocalizedText;
  readonly ui_default?: number | string | null;
  readonly step?: number;
  readonly unit?: string;
  readonly enum_labels?: Readonly<Record<string, CfdLocalizedText>>;
  readonly visible_when?: { readonly key: CfdSettingKey; readonly equals: number | string | null };
}
export interface CfdSettingDeclaration {
  readonly key: CfdSettingKey;
  readonly section: CfdSettingSection;
  /** The request section lists the setting in `required`; otherwise a request may omit it and the service applies the standard preset. */
  readonly required: boolean;
  readonly bounds: CfdSettingBounds;
  /** A preset controls the value; the presets themselves live in the streaming cfd_options.json. */
  readonly preset: boolean;
  /** The cfd_pipeline CaseParams field the setting drives; null for preprocess settings. */
  readonly engine: string | null;
  readonly panel: CfdPanelField | null;
}

/** Every setting key, sorted: the `fieldKey` enumeration of cfd-options-v1 and cfd-estimate-v1. */
export const CFD_SETTING_KEYS = ["mesh.background_cell_m", "mesh.coarsening_shell_h", "mesh.domain_downstream_h", "mesh.domain_lateral_h", "mesh.domain_top_h", "mesh.domain_upstream_h", "mesh.ground_band_height_h", "mesh.max_blockage_ratio", "mesh.outer_coarsening_levels", "mesh.refinement_box_scale", "mesh.region_refinement_level", "mesh.surface_refinement_level", "preprocess.closing_radius_voxels", "preprocess.leak_fraction_limit", "preprocess.voxel_pitch_m", "solver.end_time", "solver.n_procs", "wind.true_north_degrees_manual", "wind.true_north_source", "wind.uref_m_s", "wind.z0_m", "wind.zref_m"] as const;
export type CfdSettingKey = (typeof CFD_SETTING_KEYS)[number];

/** Every setting in request order, with its bounds, preset membership, engine field and panel metadata. */
export const CFD_SETTINGS: readonly CfdSettingDeclaration[] = [
  {"key":"preprocess.voxel_pitch_m","section":"preprocess","required":false,"bounds":{"type":"number","minimum":0.1,"maximum":2},"preset":true,"engine":null,"panel":null},
  {"key":"preprocess.closing_radius_voxels","section":"preprocess","required":false,"bounds":{"type":"integer","minimum":0,"maximum":16},"preset":true,"engine":null,"panel":null},
  {"key":"preprocess.leak_fraction_limit","section":"preprocess","required":false,"bounds":{"type":"number","minimum":0,"maximum":1},"preset":true,"engine":null,"panel":null},
  {"key":"wind.uref_m_s","section":"wind","required":true,"bounds":{"type":"number","exclusive_minimum":0,"maximum":40},"preset":false,"engine":"uref_m_s","panel":{"key":"wind.uref_m_s","section":"general","label":{"zh":"參考風速 U_ref","en":"Reference wind speed U_ref"},"help":{"zh":"參考高度處的風速。","en":"Wind speed at the reference height."},"ui_default":5,"step":0.5,"unit":"m/s"}},
  {"key":"wind.zref_m","section":"wind","required":true,"bounds":{"type":"number","exclusive_minimum":0,"maximum":200},"preset":true,"engine":"zref_m","panel":{"key":"wind.zref_m","section":"general","label":{"zh":"參考高度 z_ref","en":"Reference height z_ref"},"help":{"zh":"U_ref 所在的高度，用來建立入流的大氣邊界層剖面。","en":"Height of U_ref; sets the atmospheric boundary-layer inlet profile."},"step":1,"unit":"m"}},
  {"key":"wind.z0_m","section":"wind","required":true,"bounds":{"type":"number","exclusive_minimum":0,"maximum":5},"preset":true,"engine":"z0_m","panel":{"key":"wind.z0_m","section":"general","label":{"zh":"地表粗糙度 z0","en":"Surface roughness z0"},"help":{"zh":"0.5 m 約為市郊到都市地況；同時影響入流剖面與地面壁函數。","en":"0.5 m is roughly suburban to urban terrain; drives both the inlet profile and the ground wall function."},"step":0.01,"unit":"m"}},
  {"key":"wind.true_north_source","section":"wind","required":true,"bounds":{"type":"enum","enum":["geo_reference","manual"]},"preset":true,"engine":null,"panel":{"key":"wind.true_north_source","section":"general","label":{"zh":"真北來源","en":"True north source"},"help":{"zh":"IFC 沒有可靠真北時，風向會相對 project north。","en":"Without a reliable IFC true north, wind directions are relative to project north."},"enum_labels":{"geo_reference":{"zh":"IFC 定位資料","en":"IFC geo reference"},"manual":{"zh":"手動輸入","en":"Manual"}}}},
  {"key":"wind.true_north_degrees_manual","section":"wind","required":false,"bounds":{"type":"number","minimum":-180,"maximum":180,"nullable":true},"preset":true,"engine":null,"panel":{"key":"wind.true_north_degrees_manual","section":"general","label":{"zh":"真北角度","en":"True north angle"},"help":{"zh":"由 project north 逆時針轉到真北的角度。","en":"Angle from project north anticlockwise to true north."},"step":0.1,"unit":"°","visible_when":{"key":"wind.true_north_source","equals":"manual"}}},
  {"key":"mesh.background_cell_m","section":"mesh","required":false,"bounds":{"type":"number","minimum":0.5,"maximum":20,"nullable":true},"preset":true,"engine":"background_cell_m","panel":{"key":"mesh.background_cell_m","section":"advanced","label":{"zh":"背景格大小","en":"Background cell size"},"help":{"zh":"留空為自動：樓高 ÷ 6，限制在 1.5 到 6 m。近建物格是背景格 ÷ 4，加細盒格是背景格 ÷ 2；面板上比例固定，外圍放粗還沒開放到面板。","en":"Empty means automatic: building height / 6, clamped to 1.5-6 m. Near-building cells are background / 4 and refinement-box cells background / 2; on this panel the ratio is fixed, since far-field coarsening is not offered here yet."},"step":0.25,"unit":"m"}},
  {"key":"mesh.surface_refinement_level","section":"mesh","required":false,"bounds":{"type":"integer","minimum":0,"maximum":4},"preset":true,"engine":"surface_refinement_level","panel":null},
  {"key":"mesh.region_refinement_level","section":"mesh","required":false,"bounds":{"type":"integer","minimum":0,"maximum":3},"preset":true,"engine":"region_refinement_level","panel":null},
  {"key":"mesh.domain_upstream_h","section":"mesh","required":false,"bounds":{"type":"number","minimum":2,"maximum":10},"preset":true,"engine":"domain_upstream_h","panel":null},
  {"key":"mesh.domain_downstream_h","section":"mesh","required":false,"bounds":{"type":"number","minimum":5,"maximum":25},"preset":true,"engine":"domain_downstream_h","panel":null},
  {"key":"mesh.domain_lateral_h","section":"mesh","required":false,"bounds":{"type":"number","minimum":2,"maximum":10},"preset":true,"engine":"domain_lateral_h","panel":null},
  {"key":"mesh.domain_top_h","section":"mesh","required":false,"bounds":{"type":"number","minimum":2,"maximum":10},"preset":true,"engine":"domain_top_h","panel":null},
  {"key":"mesh.max_blockage_ratio","section":"mesh","required":false,"bounds":{"type":"number","minimum":0.01,"maximum":0.1},"preset":true,"engine":"max_blockage_ratio","panel":null},
  {"key":"mesh.refinement_box_scale","section":"mesh","required":false,"bounds":{"type":"number","minimum":0.5,"maximum":2},"preset":true,"engine":"refinement_box_scale","panel":null},
  {"key":"mesh.outer_coarsening_levels","section":"mesh","required":false,"bounds":{"type":"integer","minimum":0,"maximum":2},"preset":true,"engine":"outer_coarsening_levels","panel":null},
  {"key":"mesh.coarsening_shell_h","section":"mesh","required":false,"bounds":{"type":"number","minimum":0.5,"maximum":5},"preset":true,"engine":"coarsening_shell_h","panel":null},
  {"key":"mesh.ground_band_height_h","section":"mesh","required":false,"bounds":{"type":"number","minimum":0.05,"maximum":1,"nullable":true},"preset":true,"engine":"ground_band_height_h","panel":null},
  {"key":"solver.end_time","section":"solver","required":false,"bounds":{"type":"integer","minimum":50,"maximum":5000},"preset":true,"engine":"end_time","panel":{"key":"solver.end_time","section":"advanced","label":{"zh":"最大迭代步數 endTime","en":"Maximum iterations (endTime)"},"help":{"zh":"未達收斂時會自動延長一次到 2 倍。","en":"Extended once to twice the value when residual control is not reached."},"step":50,"unit":""}},
  {"key":"solver.n_procs","section":"solver","required":false,"bounds":{"type":"integer","minimum":1,"maximum":64},"preset":false,"engine":"n_procs","panel":null},
];

/** The same declarations grouped by request section, as literals: a validator built from them keeps the
 *  field types (required, nullable, enum members) without a hand-written copy. */
export const CFD_SECTION_SETTINGS = {
  preprocess: {
    voxel_pitch_m: {"required":false,"bounds":{"type":"number","minimum":0.1,"maximum":2},"preset":true},
    closing_radius_voxels: {"required":false,"bounds":{"type":"integer","minimum":0,"maximum":16},"preset":true},
    leak_fraction_limit: {"required":false,"bounds":{"type":"number","minimum":0,"maximum":1},"preset":true},
  },
  wind: {
    uref_m_s: {"required":true,"bounds":{"type":"number","exclusive_minimum":0,"maximum":40},"preset":false},
    zref_m: {"required":true,"bounds":{"type":"number","exclusive_minimum":0,"maximum":200},"preset":true},
    z0_m: {"required":true,"bounds":{"type":"number","exclusive_minimum":0,"maximum":5},"preset":true},
    true_north_source: {"required":true,"bounds":{"type":"enum","enum":["geo_reference","manual"]},"preset":true},
    true_north_degrees_manual: {"required":false,"bounds":{"type":"number","minimum":-180,"maximum":180,"nullable":true},"preset":true},
  },
  mesh: {
    background_cell_m: {"required":false,"bounds":{"type":"number","minimum":0.5,"maximum":20,"nullable":true},"preset":true},
    surface_refinement_level: {"required":false,"bounds":{"type":"integer","minimum":0,"maximum":4},"preset":true},
    region_refinement_level: {"required":false,"bounds":{"type":"integer","minimum":0,"maximum":3},"preset":true},
    domain_upstream_h: {"required":false,"bounds":{"type":"number","minimum":2,"maximum":10},"preset":true},
    domain_downstream_h: {"required":false,"bounds":{"type":"number","minimum":5,"maximum":25},"preset":true},
    domain_lateral_h: {"required":false,"bounds":{"type":"number","minimum":2,"maximum":10},"preset":true},
    domain_top_h: {"required":false,"bounds":{"type":"number","minimum":2,"maximum":10},"preset":true},
    max_blockage_ratio: {"required":false,"bounds":{"type":"number","minimum":0.01,"maximum":0.1},"preset":true},
    refinement_box_scale: {"required":false,"bounds":{"type":"number","minimum":0.5,"maximum":2},"preset":true},
    outer_coarsening_levels: {"required":false,"bounds":{"type":"integer","minimum":0,"maximum":2},"preset":true},
    coarsening_shell_h: {"required":false,"bounds":{"type":"number","minimum":0.5,"maximum":5},"preset":true},
    ground_band_height_h: {"required":false,"bounds":{"type":"number","minimum":0.05,"maximum":1,"nullable":true},"preset":true},
  },
  solver: {
    end_time: {"required":false,"bounds":{"type":"integer","minimum":50,"maximum":5000},"preset":true},
    n_procs: {"required":false,"bounds":{"type":"integer","minimum":1,"maximum":64},"preset":false},
  },
} as const;

export const CFD_PRESET_KEYS: readonly CfdSettingKey[] = ["preprocess.voxel_pitch_m", "preprocess.closing_radius_voxels", "preprocess.leak_fraction_limit", "wind.zref_m", "wind.z0_m", "wind.true_north_source", "wind.true_north_degrees_manual", "mesh.background_cell_m", "mesh.surface_refinement_level", "mesh.region_refinement_level", "mesh.domain_upstream_h", "mesh.domain_downstream_h", "mesh.domain_lateral_h", "mesh.domain_top_h", "mesh.max_blockage_ratio", "mesh.refinement_box_scale", "mesh.outer_coarsening_levels", "mesh.coarsening_shell_h", "mesh.ground_band_height_h", "solver.end_time"] as const;
export const CFD_ORIGIN_FIELDS: readonly CfdSettingKey[] = ["preprocess.voxel_pitch_m", "preprocess.closing_radius_voxels", "preprocess.leak_fraction_limit", "wind.uref_m_s", "wind.zref_m", "wind.z0_m", "wind.true_north_source", "wind.true_north_degrees_manual", "mesh.background_cell_m", "mesh.surface_refinement_level", "mesh.region_refinement_level", "mesh.domain_upstream_h", "mesh.domain_downstream_h", "mesh.domain_lateral_h", "mesh.domain_top_h", "mesh.max_blockage_ratio", "mesh.refinement_box_scale", "mesh.outer_coarsening_levels", "mesh.coarsening_shell_h", "mesh.ground_band_height_h", "solver.end_time", "solver.n_procs"] as const;
export const CFD_PANEL_SECTIONS = ["general", "advanced"] as const;
