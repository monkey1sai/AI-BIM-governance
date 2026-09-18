"""Kit Command Vocabulary 的 schema 層契約（決策見 docs/architecture/kit-command-vocabulary-adr.md）。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "tests" / "contracts" / "kit-datachannel-v1.schema.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
DEFS = SCHEMA["$defs"]
EVENTS = [entry["$ref"].removeprefix("#/$defs/") for entry in SCHEMA["oneOf"]]
COMMANDS = [name for name in EVENTS if "x-kit-command" in DEFS[name]]
EXPECTED_COMMANDS = {
    "openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest",
    "focusPrimRequest", "clearHighlightRequest", "clipPlaneRequest", "measurementRequest",
    "selectPrimsRequest", "makePrimsPickable", "resetStage", "loadingStateQuery",
    "getChildrenRequest", "cameraViewRequest", "cameraStateRequest", "flyNavigationRequest",
}
GENERATED_OUTPUTS = (
    ROOT / "web-viewer-sample" / "src" / "generated" / "kit-command-vocabulary.ts",
    ROOT / "bim-review-coordinator" / "src" / "generated" / "kit-command-vocabulary.ts",
    ROOT / "bim-streaming-server" / "source" / "extensions" / "ezplus.bim_review_stream.messaging"
    / "ezplus" / "bim_review_stream" / "messaging" / "kit_command_vocabulary.py",
)
REGENERATE = "run: cd web-viewer-sample && npm run generate:kit-command-vocabulary"


def _lf_text(path: Path) -> str:
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n")


def test_every_viewer_command_is_annotated():
    assert set(COMMANDS) == EXPECTED_COMMANDS
    assert len(COMMANDS) == len(EXPECTED_COMMANDS)


def test_command_rejected_names_every_command():
    enum = DEFS["commandRejected"]["properties"]["payload"]["properties"]["rejected_event_type"]["enum"]
    assert sorted(enum) == sorted(COMMANDS)


def test_command_results_are_kit_events():
    kit_events = {name for name in EVENTS if name not in COMMANDS}
    for name in COMMANDS:
        results = DEFS[name]["x-kit-command"]["results"]
        assert results, name
        assert set(results) <= kit_events, name


def test_camera_commands_are_classified():
    assert DEFS["cameraViewRequest"]["x-kit-command"]["mutates"] is True
    assert DEFS["flyNavigationRequest"]["x-kit-command"]["mutates"] is True
    assert DEFS["cameraStateRequest"]["x-kit-command"]["mutates"] is False
    assert DEFS["cameraStateRequest"]["x-kit-command"]["results"] == ["cameraStateResult"]


def test_generated_vocabularies_were_generated_from_this_schema():
    # 只改 schema 的 PR 在 root 測試就會紅，不必等到各 runtime 的測試。
    expected = hashlib.sha256(_lf_text(SCHEMA_PATH).encode("utf-8")).hexdigest()
    for path in GENERATED_OUTPUTS:
        header = [line for line in _lf_text(path).split("\n")[:8] if "source-sha256: " in line]
        assert header, f"{path.relative_to(ROOT)} has no source-sha256 header; {REGENERATE}"
        assert header[0].split("source-sha256: ", 1)[1] == expected, f"{path.relative_to(ROOT)} is stale; {REGENERATE}"
