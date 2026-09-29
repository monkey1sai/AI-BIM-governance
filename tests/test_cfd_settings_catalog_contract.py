"""CFD Settings Catalog 的 schema 層契約（決策見 docs/architecture/cfd-settings-catalog-adr.md）。

每個 CFD 計算設定只在 cfd-run-request-v1.schema.json 的 x-cfd-setting 宣告一次；各 runtime 讀生成物。
這裡只守「生成物是從這份 schema 生成的」與「宣告本身自洽」；行為由各 runtime 的測試守。
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "tests" / "contracts" / "cfd-run-request-v1.schema.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
SETTING_SECTIONS = ("preprocess", "wind", "mesh", "solver")
NOT_SETTINGS = {"preprocess.profile", "wind.wind_from_degrees"}
GENERATED_OUTPUTS = (
    ROOT / "bim-streaming-server" / "source" / "extensions" / "ezplus.bim_review_stream.messaging"
    / "ezplus" / "bim_review_stream" / "messaging" / "cfd_settings_catalog.py",
)
REGENERATE = "run: cd web-viewer-sample && npm run generate:cfd-settings-catalog"


def _settings() -> dict[str, dict]:
    out = {}
    for section in SETTING_SECTIONS:
        for name, spec in SCHEMA["properties"][section]["properties"].items():
            out[f"{section}.{name}"] = spec
    return out


def _lf_text(path: Path) -> str:
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n")


def test_every_setting_is_annotated_and_nothing_else_is():
    for key, spec in _settings().items():
        assert ("x-cfd-setting" in spec) == (key not in NOT_SETTINGS), key
    for section in ("source", "requested_by"):
        for name, spec in SCHEMA["properties"][section]["properties"].items():
            assert "x-cfd-setting" not in spec, f"{section}.{name}"


def test_annotations_are_closed_shapes():
    for key, spec in _settings().items():
        if key in NOT_SETTINGS:
            continue
        annotation = spec["x-cfd-setting"]
        assert set(annotation) <= {"preset", "engine", "panel"}, key
        assert isinstance(annotation["preset"], bool), key
        assert annotation["engine"] is None or isinstance(annotation["engine"], str), key


def test_preset_keys_match_the_options_example_and_the_streaming_config():
    """The catalog says which keys a preset controls; every preset (example and shipped) sets exactly those."""
    preset_keys = {key for key, spec in _settings().items() if key not in NOT_SETTINGS and spec["x-cfd-setting"]["preset"]}
    options_example = json.loads((ROOT / "tests" / "contracts" / "cfd-options-v1.schema.json").read_text(encoding="utf-8"))["examples"][0]
    for preset in options_example["presets"]:
        assert set(preset["values"]) == preset_keys, preset["preset_id"]
    config = json.loads((GENERATED_OUTPUTS[0].parent / "cfd_options.json").read_text(encoding="utf-8"))
    assert "panel_fields" not in config, "the panel is declared in the catalog, not in cfd_options.json"
    for preset in config["presets"]:
        assert set(preset["values"]) == preset_keys, preset["preset_id"]


def test_panel_fields_match_the_options_example():
    """Until settings phase bullet 3 lets the generator write the example, it is pinned to the catalog by hand."""
    panel = [key for key, spec in _settings().items() if key not in NOT_SETTINGS and "panel" in spec["x-cfd-setting"]]
    options_example = json.loads((ROOT / "tests" / "contracts" / "cfd-options-v1.schema.json").read_text(encoding="utf-8"))["examples"][0]
    assert [field["key"] for field in options_example["fields"]] == panel


def test_generated_catalogs_were_generated_from_this_schema():
    # 只改 schema 的 PR 在 root 測試就會紅，不必等到各 runtime 的測試。
    expected = hashlib.sha256(_lf_text(SCHEMA_PATH).encode("utf-8")).hexdigest()
    for path in GENERATED_OUTPUTS:
        header = [line for line in _lf_text(path).split("\n")[:8] if "source-sha256: " in line]
        assert header, f"{path.relative_to(ROOT)} has no source-sha256 header; {REGENERATE}"
        assert header[0].split("source-sha256: ", 1)[1] == expected, f"{path.relative_to(ROOT)} is stale; {REGENERATE}"
