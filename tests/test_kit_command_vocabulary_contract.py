"""Kit Command Vocabulary 的 schema 層契約（決策見 docs/architecture/kit-command-vocabulary-adr.md）。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "tests" / "contracts" / "kit-datachannel-v1.schema.json").read_text(encoding="utf-8"))
DEFS = SCHEMA["$defs"]
EVENTS = [entry["$ref"].removeprefix("#/$defs/") for entry in SCHEMA["oneOf"]]
COMMANDS = [name for name in EVENTS if "x-kit-command" in DEFS[name]]
EXPECTED_COMMANDS = {
    "openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest",
    "focusPrimRequest", "clearHighlightRequest", "clipPlaneRequest", "measurementRequest",
    "selectPrimsRequest", "makePrimsPickable", "resetStage", "loadingStateQuery",
    "getChildrenRequest", "cameraViewRequest", "cameraStateRequest", "flyNavigationRequest",
}


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
