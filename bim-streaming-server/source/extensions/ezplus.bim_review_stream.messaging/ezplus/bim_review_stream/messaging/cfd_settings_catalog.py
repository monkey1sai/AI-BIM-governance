# GENERATED FILE - DO NOT EDIT.
# CFD Settings Catalog，由 tests/contracts/cfd-run-request-v1.schema.json 的 x-cfd-setting 生成。
# 再生成：cd web-viewer-sample && npm run generate:cfd-settings-catalog
# source-sha256: 90156a3ac3ba4f53499dd09e98e0c521763873ae2751b85c7b3ca99a5a67c502
"""CFD Settings Catalog data; see docs/architecture/cfd-settings-catalog-adr.md."""

SECTIONS = ("general", "advanced")

# Contract bounds of every setting, in request order.
REQUEST_FIELD_BOUNDS = {
    "preprocess.voxel_pitch_m": {"type": "number", "minimum": 0.1, "maximum": 2.0},
    "preprocess.closing_radius_voxels": {"type": "integer", "minimum": 0, "maximum": 16},
    "preprocess.leak_fraction_limit": {"type": "number", "minimum": 0.0, "maximum": 1.0},
    "wind.uref_m_s": {"type": "number", "exclusive_minimum": 0.0, "maximum": 40.0},
    "wind.zref_m": {"type": "number", "exclusive_minimum": 0.0, "maximum": 200.0},
    "wind.z0_m": {"type": "number", "exclusive_minimum": 0.0, "maximum": 5.0},
    "wind.true_north_source": {"type": "enum", "enum": ["geo_reference", "manual"]},
    "wind.true_north_degrees_manual": {"type": "number", "minimum": -180.0, "maximum": 180.0, "nullable": True},
    "mesh.background_cell_m": {"type": "number", "minimum": 0.5, "maximum": 20.0, "nullable": True},
    "mesh.surface_refinement_level": {"type": "integer", "minimum": 0, "maximum": 4},
    "mesh.region_refinement_level": {"type": "integer", "minimum": 0, "maximum": 3},
    "mesh.domain_upstream_h": {"type": "number", "minimum": 2.0, "maximum": 10.0},
    "mesh.domain_downstream_h": {"type": "number", "minimum": 5.0, "maximum": 25.0},
    "mesh.domain_lateral_h": {"type": "number", "minimum": 2.0, "maximum": 10.0},
    "mesh.domain_top_h": {"type": "number", "minimum": 2.0, "maximum": 10.0},
    "mesh.max_blockage_ratio": {"type": "number", "minimum": 0.01, "maximum": 0.1},
    "mesh.refinement_box_scale": {"type": "number", "minimum": 0.5, "maximum": 2.0},
    "mesh.outer_coarsening_levels": {"type": "integer", "minimum": 0, "maximum": 2},
    "mesh.coarsening_shell_h": {"type": "number", "minimum": 0.5, "maximum": 5.0},
    "mesh.ground_band_height_h": {"type": "number", "minimum": 0.05, "maximum": 1.0, "nullable": True},
    "solver.end_time": {"type": "integer", "minimum": 50, "maximum": 5000},
    "solver.n_procs": {"type": "integer", "minimum": 1, "maximum": 64},
}

# Settings a preset controls; every preset in cfd_options.json sets exactly these.
PRESET_KEYS = ("preprocess.voxel_pitch_m", "preprocess.closing_radius_voxels", "preprocess.leak_fraction_limit", "wind.zref_m", "wind.z0_m", "wind.true_north_source", "wind.true_north_degrees_manual", "mesh.background_cell_m", "mesh.surface_refinement_level", "mesh.region_refinement_level", "mesh.domain_upstream_h", "mesh.domain_downstream_h", "mesh.domain_lateral_h", "mesh.domain_top_h", "mesh.max_blockage_ratio", "mesh.refinement_box_scale", "mesh.outer_coarsening_levels", "mesh.coarsening_shell_h", "mesh.ground_band_height_h", "solver.end_time")

# Request key -> the cfd_pipeline.openfoam_case.CaseParams field it drives (preprocess settings drive run_preprocess instead).
ENGINE_FIELDS = {
    "wind.uref_m_s": "uref_m_s",
    "wind.zref_m": "zref_m",
    "wind.z0_m": "z0_m",
    "mesh.background_cell_m": "background_cell_m",
    "mesh.surface_refinement_level": "surface_refinement_level",
    "mesh.region_refinement_level": "region_refinement_level",
    "mesh.domain_upstream_h": "domain_upstream_h",
    "mesh.domain_downstream_h": "domain_downstream_h",
    "mesh.domain_lateral_h": "domain_lateral_h",
    "mesh.domain_top_h": "domain_top_h",
    "mesh.max_blockage_ratio": "max_blockage_ratio",
    "mesh.refinement_box_scale": "refinement_box_scale",
    "mesh.outer_coarsening_levels": "outer_coarsening_levels",
    "mesh.coarsening_shell_h": "coarsening_shell_h",
    "mesh.ground_band_height_h": "ground_band_height_h",
    "solver.end_time": "end_time",
    "solver.n_procs": "n_procs",
}

# Every setting is recorded in the coordinator's ledger origin with the value the request carried (null when omitted).
ORIGIN_FIELDS = ("preprocess.voxel_pitch_m", "preprocess.closing_radius_voxels", "preprocess.leak_fraction_limit", "wind.uref_m_s", "wind.zref_m", "wind.z0_m", "wind.true_north_source", "wind.true_north_degrees_manual", "mesh.background_cell_m", "mesh.surface_refinement_level", "mesh.region_refinement_level", "mesh.domain_upstream_h", "mesh.domain_downstream_h", "mesh.domain_lateral_h", "mesh.domain_top_h", "mesh.max_blockage_ratio", "mesh.refinement_box_scale", "mesh.outer_coarsening_levels", "mesh.coarsening_shell_h", "mesh.ground_band_height_h", "solver.end_time", "solver.n_procs")

# Browser form fields in panel order; cfd_options.build_options_document adds the bounds and the default.
PANEL_FIELDS = (
    {"key": "wind.uref_m_s", "section": "general", "label": {"zh": "參考風速 U_ref", "en": "Reference wind speed U_ref"}, "help": {"zh": "參考高度處的風速。", "en": "Wind speed at the reference height."}, "ui_default": 5, "step": 0.5, "unit": "m/s"},
    {"key": "wind.zref_m", "section": "general", "label": {"zh": "參考高度 z_ref", "en": "Reference height z_ref"}, "help": {"zh": "U_ref 所在的高度，用來建立入流的大氣邊界層剖面。", "en": "Height of U_ref; sets the atmospheric boundary-layer inlet profile."}, "step": 1, "unit": "m"},
    {"key": "wind.z0_m", "section": "general", "label": {"zh": "地表粗糙度 z0", "en": "Surface roughness z0"}, "help": {"zh": "0.5 m 約為市郊到都市地況；同時影響入流剖面與地面壁函數。", "en": "0.5 m is roughly suburban to urban terrain; drives both the inlet profile and the ground wall function."}, "step": 0.01, "unit": "m"},
    {"key": "wind.true_north_source", "section": "general", "label": {"zh": "真北來源", "en": "True north source"}, "help": {"zh": "IFC 沒有可靠真北時，風向會相對 project north。", "en": "Without a reliable IFC true north, wind directions are relative to project north."}, "enum_labels": {"geo_reference": {"zh": "IFC 定位資料", "en": "IFC geo reference"}, "manual": {"zh": "手動輸入", "en": "Manual"}}},
    {"key": "wind.true_north_degrees_manual", "section": "general", "label": {"zh": "真北角度", "en": "True north angle"}, "help": {"zh": "由 project north 逆時針轉到真北的角度。", "en": "Angle from project north anticlockwise to true north."}, "step": 0.1, "unit": "°", "visible_when": {"key": "wind.true_north_source", "equals": "manual"}},
    {"key": "mesh.background_cell_m", "section": "advanced", "label": {"zh": "背景格大小", "en": "Background cell size"}, "help": {"zh": "留空為自動：樓高 ÷ 6，限制在 1.5 到 6 m。近建物格是背景格 ÷ 4，加細盒格是背景格 ÷ 2；面板上比例固定，外圍放粗還沒開放到面板。", "en": "Empty means automatic: building height / 6, clamped to 1.5-6 m. Near-building cells are background / 4 and refinement-box cells background / 2; on this panel the ratio is fixed, since far-field coarsening is not offered here yet."}, "step": 0.25, "unit": "m"},
    {"key": "solver.end_time", "section": "advanced", "label": {"zh": "最大迭代步數 endTime", "en": "Maximum iterations (endTime)"}, "help": {"zh": "未達收斂時會自動延長一次到 2 倍。", "en": "Extended once to twice the value when residual control is not reached."}, "step": 50, "unit": ""},
)
