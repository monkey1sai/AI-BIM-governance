import ast
import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "tests" / "contracts"
MESSAGING_SOURCE = (
    ROOT
    / "bim-streaming-server"
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)
TRACE_ID = "ifcready_runtime_command_contract"


def test_material_highlight_and_focus_observation_contract():
    validator = load_validator("kit-datachannel-v1.schema.json")
    payload = {"trace_id": TRACE_ID, "request_id": "material-test", "result": "success",
               "applied_mode": "material_overlay", "applied_paths": ["/A", "/B"],
               "missing_paths": [], "unsupported_paths": [], "renderer_mode": "RaytracedLighting"}
    validator.validate({"event_type": "highlightPrimsResult", "payload": payload})
    for field in ("applied_paths", "missing_paths", "unsupported_paths"):
        bad = {key: value for key, value in payload.items() if key != field}
        assert list(validator.iter_errors({"event_type": "highlightPrimsResult", "payload": bad}))
    validator.validate({"event_type": "clearHighlightResult", "payload": {
        "trace_id": TRACE_ID, "request_id": "clear-test", "result": "error",
        "applied_mode": "material_overlay", "error": "layer removal failed"}})
    validator.validate({"event_type": "focusPrimResult", "payload": {
        "trace_id": TRACE_ID, "request_id": "focus-test", "result": "success",
        "prim_path": "/A", "applied_mode": "selection", "framed": True}})
SESSION_ID = "review_session_001"


def load_validator(name: str) -> Draft202012Validator:
    schema = json.loads((CONTRACTS / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def authority_envelope() -> dict:
    return {
        "trace_id": TRACE_ID,
        "request_id": "request_001",
        "role": "primary",
        "source_client_id": "viewer_lease_001",
        "session_id": "review_session_001",
        "viewer_lease_token": "ephemeral-test-token",
    }


def test_camera_scope_and_correlated_completion_contract():
    validator = load_validator("kit-datachannel-v1.schema.json")
    for scope in ("building", "all"):
        validator.validate({"event_type": "resetStage", "payload": {**authority_envelope(), "scope": scope}})
    for scope in (None, "unknown", 1):
        assert list(validator.iter_errors({"event_type": "resetStage", "payload": {**authority_envelope(), "scope": scope}}))
    reply = {"trace_id": TRACE_ID, "request_id": "camera-test", "result": "success", "error": ""}
    validator.validate({"event_type": "cameraFrameResult", "payload": reply})
    for key in ("trace_id", "request_id"):
        assert list(validator.iter_errors({"event_type": "cameraFrameResult", "payload": {k: v for k, v in reply.items() if k != key}}))


@pytest.mark.parametrize("pulse", [True, False, None, "not-a-boolean"])
def test_focus_contract_accepts_steady_emphasis_and_rejects_removed_pulse(pulse):
    validator = load_validator("kit-datachannel-v1.schema.json")
    payload = {**authority_envelope(), "prim_path": "/World/Elements/Door", "emphasis": True}
    validator.validate({"event_type": "focusPrimRequest", "payload": payload})
    assert list(validator.iter_errors({"event_type": "focusPrimRequest", "payload": {**payload, "pulse": pulse}}))


@pytest.mark.parametrize("enabled,planes", [(True, [[1,0,0,-3]]), (False, []), (False, [[1,0,0,0],[0,1,0,0]])])
def test_clip_result_validates_enabled_and_disabled_readback_shapes(enabled, planes):
    validator = load_validator("kit-datachannel-v1.schema.json")
    payload = {"trace_id": TRACE_ID, "request_id": "clip-1", "result": "success", "enabled": enabled, "planes": planes}
    validator.validate({"event_type": "clipPlaneResult", "payload": payload})
    for invalid in ([[1,0,0]], [[1,0,0,0,0]], [[1,0,0,0]] * 257):
        assert list(validator.iter_errors({"event_type": "clipPlaneResult", "payload": {**payload, "planes": invalid}}))
    for invalid in ([], [[1,0,0,0],[0,1,0,0]]):
        assert list(validator.iter_errors({"event_type": "clipPlaneResult", "payload": {**payload, "enabled": True, "planes": invalid}}))


def test_clip_request_requires_authority_and_axis_aligned_normal():
    validator = load_validator("kit-datachannel-v1.schema.json")
    payload = {**authority_envelope(), "enabled": True, "axis": "x", "position": 3, "normal": [-1,0,0]}
    validator.validate({"event_type": "clipPlaneRequest", "payload": payload})
    for key in ("request_id", "trace_id", "viewer_lease_token"):
        bad = dict(payload)
        del bad[key]
        assert list(validator.iter_errors({"event_type": "clipPlaneRequest", "payload": bad}))
    for delta in ({"axis": "bad"}, {"normal": [0,1,0]}, {"position": True}, {"position": 1e39}):
        assert list(validator.iter_errors({"event_type": "clipPlaneRequest", "payload": {**payload, **delta}}))


def test_clip_error_cannot_claim_observed_state_or_include_credentials():
    validator = load_validator("kit-datachannel-v1.schema.json")
    payload = {"trace_id": TRACE_ID, "request_id": "clip-1", "result": "error", "error": "Section unavailable."}
    validator.validate({"event_type": "clipPlaneResult", "payload": payload})
    for delta in ({"enabled": False}, {"planes": []}, {"viewer_lease_token": "test-only"}):
        assert list(validator.iter_errors({"event_type": "clipPlaneResult", "payload": {**payload, **delta}}))


def stage_composition() -> dict:
    return {
        "primary": {
            "artifact_id": "artifact_primary",
            "role": "primary",
            "load_order": 0,
            "usdc_url": "http://127.0.0.1:49101/artifacts/primary/model.usdc",
        },
        "secondary_layers": [
            {
                "artifact_id": "artifact_secondary",
                "role": "secondary",
                "load_order": 10,
                "usdc_url": "http://127.0.0.1:49101/artifacts/secondary/model.usdc",
            }
        ],
    }


def camera_state_sample() -> dict:
    return {
        "projection": "perspective",
        "position": [10.0, -20.0, 1.6],
        "direction": [0.0, 1.0, 0.0],
        "up": [0.0, 0.0, 1.0],
        "target_distance": 12.5,
        "fov_deg": 45.0,
        "ortho_height": None,
    }


def kit_event_catalog() -> set[str]:
    schema = json.loads((CONTRACTS / "kit-datachannel-v1.schema.json").read_text(encoding="utf-8"))
    catalog = set()
    for entry in schema["oneOf"]:
        definition_name = entry["$ref"].rsplit("/", 1)[-1]
        catalog.add(schema["$defs"][definition_name]["properties"]["event_type"]["const"])
    return catalog


def datachannel_message_samples() -> dict[str, dict]:
    authority = authority_envelope()
    return {
        "openStageRequest": {
            **authority,
            "stage_binding_authorization_id": "stage_auth_001",
            "binding_revision_id": "binding_rev_001",
            "stage_composition": stage_composition(),
        },
        "loadArtifactGroupRequest": {
            **authority,
            "stage_binding_authorization_id": "stage_auth_001",
            "binding_revision_id": "binding_rev_001",
            "stage_composition": stage_composition(),
        },
        "composeStageRequest": {**authority, "binding_revision_id": "binding_rev_001", "artifacts": []},
        "highlightPrimsRequest": {
            **authority,
            "mode": "replace",
            "items": [{"prim_path": "/World"}],
            "focus_first": True,
        },
        "focusPrimRequest": {**authority, "prim_path": "/World"},
        "clearHighlightRequest": authority,
        "measurementRequest": {**authority, "action": "start", "measurement_id": "measure-1"},
        "measurementResult": {"trace_id": TRACE_ID, "request_id": "request_001", "measurement_id": "measure-1", "status": "started", "meters_per_unit": 1},
        "clipPlaneRequest": {**authority, "enabled": True, "axis": "x", "position": 3, "normal": [1, 0, 0]},
        "clipPlaneResult": {"trace_id": TRACE_ID, "request_id": "request_001", "result": "success", "enabled": True, "planes": [[1, 0, 0, -3]]},
        "selectPrimsRequest": {**authority, "paths": ["/World"]},
        "makePrimsPickable": {**authority, "paths": ["/World"]},
        "resetStage": authority,
        "cameraFrameResult": {"trace_id": TRACE_ID, "result": "success", "error": "", "request_id": "request_001"},
        "loadingStateQuery": {"trace_id": TRACE_ID, "session_id": SESSION_ID},
        "getChildrenRequest": {
            "trace_id": TRACE_ID,
            "session_id": SESSION_ID,
            "prim_path": "/World",
            "filters": [],
        },
        "openedStageResult": {"trace_id": TRACE_ID, "result": "success", "request_id": "request_001"},
        "loadArtifactGroupResult": {"trace_id": TRACE_ID, "result": "accepted", "request_id": "request_001"},
        "highlightPrimsResult": {"trace_id": TRACE_ID, "result": "success", "request_id": "request_001"},
        "focusPrimResult": {"trace_id": TRACE_ID, "result": "success", "request_id": "request_001"},
        "selectPrimsResult": {
            "trace_id": TRACE_ID,
            "result": "success",
            "error": "",
            "selected_paths": [],
            "request_id": "request_001",
        },
        "makePrimsPickableResponse": {
            "trace_id": TRACE_ID,
            "result": "success",
            "error": "",
            "request_id": "request_001",
        },
        "resetStageResponse": {
            "trace_id": TRACE_ID,
            "result": "success",
            "error": "",
            "request_id": "request_001",
        },
        "clearHighlightResult": {
            "trace_id": TRACE_ID,
            "result": "success",
            "applied_mode": "selection",
            "request_id": "request_001",
        },
        "loadingStateResponse": {"trace_id": TRACE_ID, "url": "", "loading_state": "idle"},
        "getChildrenResponse": {"trace_id": TRACE_ID, "prim_path": "/World", "children": []},
        "stageSelectionChanged": {"trace_id": TRACE_ID, "prims": []},
        "updateProgressAmount": {"trace_id": TRACE_ID},
        "updateProgressActivity": {"trace_id": TRACE_ID, "text": "Loading"},
        "bindingApplied": {"trace_id": TRACE_ID, "binding_revision_id": "binding_rev_001"},
        "cameraViewRequest": {**authority, "action": "preset", "view": "top", "scope": "building"},
        "cameraViewResult": {"trace_id": TRACE_ID, "request_id": "request_001", "result": "success",
                             "camera": camera_state_sample()},
        "cameraStateRequest": {"trace_id": TRACE_ID, "session_id": SESSION_ID, "request_id": "request_001"},
        "cameraStateResult": {"trace_id": TRACE_ID, "request_id": "request_001", "result": "success",
                              "camera": camera_state_sample()},
        "flyNavigationRequest": {**authority, "speed": 2.5},
        "flyNavigationResult": {"trace_id": TRACE_ID, "request_id": "request_001", "result": "success",
                                "speed": 2.5},
        "overlayStyleRequest": {**authority, "prim_path": "/World/Overlays/Cfd/run_001/PedestrianWind_1p5m", "display_opacity": 0.4},
        "overlayStyleResult": {"trace_id": TRACE_ID, "request_id": "request_001", "result": "success",
                               "prim_path": "/World/Overlays/Cfd/run_001/PedestrianWind_1p5m", "display_opacity": 0.4},
        "commandRejected": {
            "trace_id": TRACE_ID,
            "rejected_event_type": "highlightPrimsRequest",
            "reason": "lease_invalid",
            "request_id": "request_001",
            "session_id": SESSION_ID,
            "retryable": False,
            "runtime_state": "unchanged",
        },
    }


def effective_payload_contract(schema: dict, event_type: str) -> tuple[set[str], set[str]]:
    definition = schema["$defs"][event_type]
    payload = definition["properties"]["payload"]

    def collect(fragment: dict) -> tuple[set[str], set[str]]:
        if "$ref" in fragment:
            referenced = schema
            for segment in fragment["$ref"].removeprefix("#/").split("/"):
                referenced = referenced[segment.replace("~1", "/").replace("~0", "~")]
            return collect(referenced)
        required = set(fragment.get("required", []))
        properties = set(fragment.get("properties", {}))
        for child in fragment.get("allOf", []):
            child_required, child_properties = collect(child)
            required.update(child_required)
            properties.update(child_properties)
        return required, properties

    return collect(payload)


def test_all_39_datachannel_payload_contracts_require_and_validate_trace_id() -> None:
    schema = json.loads((CONTRACTS / "kit-datachannel-v1.schema.json").read_text(encoding="utf-8"))
    validator = load_validator("kit-datachannel-v1.schema.json")
    samples = datachannel_message_samples()
    assert kit_event_catalog() == set(samples)
    assert len(samples) == 39

    for event_type, payload in samples.items():
        required, properties = effective_payload_contract(schema, event_type)
        assert "trace_id" in required, event_type
        assert "trace_id" in properties, event_type
        validator.validate({"event_type": event_type, "payload": payload})

        missing = copy.deepcopy(payload)
        missing.pop("trace_id")
        assert list(validator.iter_errors({"event_type": event_type, "payload": missing})), event_type

        empty = copy.deepcopy(payload)
        empty["trace_id"] = ""
        assert list(validator.iter_errors({"event_type": event_type, "payload": empty})), event_type


@pytest.mark.parametrize(
    ("event_type", "extra"),
    [
        (
            "openStageRequest",
            {
                "stage_binding_authorization_id": "stage_auth_001",
                "binding_revision_id": "binding_rev_001",
                "stage_composition": stage_composition(),
            },
        ),
        (
            "loadArtifactGroupRequest",
            {
                "stage_binding_authorization_id": "stage_auth_001",
                "binding_revision_id": "binding_rev_001",
                "stage_composition": stage_composition(),
            },
        ),
        ("composeStageRequest", {"binding_revision_id": "binding_rev_001", "artifacts": []}),
        ("highlightPrimsRequest", {"mode": "replace", "items": [{"prim_path": "/World"}], "focus_first": True}),
        ("focusPrimRequest", {"prim_path": "/World"}),
        ("clearHighlightRequest", {}),
        ("selectPrimsRequest", {"paths": ["/World"]}),
        ("makePrimsPickable", {"paths": ["/World"]}),
        ("resetStage", {}),
        ("cameraViewRequest", {"action": "projection", "projection": "orthographic"}),
        ("flyNavigationRequest", {"speed": 1.0}),
        ("overlayStyleRequest", {"prim_path": "/World/Overlays/Cfd/run_001/PedestrianWind_1p5m", "display_opacity": 0.5}),
    ],
)
def test_every_runtime_mutator_requires_request_correlation(event_type: str, extra: dict) -> None:
    validator = load_validator("kit-datachannel-v1.schema.json")
    message = {
        "event_type": event_type,
        "payload": {**authority_envelope(), **extra},
    }
    validator.validate(message)

    missing_request_id = copy.deepcopy(message)
    del missing_request_id["payload"]["request_id"]
    assert list(validator.iter_errors(missing_request_id))


def test_stage_mutator_requires_exact_server_transaction_shape() -> None:
    validator = load_validator("kit-datachannel-v1.schema.json")
    message = {
        "event_type": "openStageRequest",
        "payload": {
            **authority_envelope(),
            "stage_binding_authorization_id": "stage_auth_001",
            "binding_revision_id": "binding_rev_001",
            "stage_composition": stage_composition(),
        },
    }
    validator.validate(message)

    for missing_field in (
        "stage_binding_authorization_id",
        "binding_revision_id",
        "stage_composition",
    ):
        invalid = copy.deepcopy(message)
        del invalid["payload"][missing_field]
        assert list(validator.iter_errors(invalid))

    wrong_role = copy.deepcopy(message)
    wrong_role["payload"]["stage_composition"]["primary"]["role"] = "secondary"
    assert list(validator.iter_errors(wrong_role))


def test_command_rejected_has_closed_machine_fields_and_no_secret_surface() -> None:
    validator = load_validator("kit-datachannel-v1.schema.json")
    rejection = {
        "event_type": "commandRejected",
        "payload": {
            "trace_id": TRACE_ID,
            "rejected_event_type": "highlightPrimsRequest",
            "reason": "lease_invalid",
            "request_id": "request_001",
            "session_id": "review_session_001",
            "retryable": True,
            "runtime_state": "unchanged",
            "detail_code": "authority_unavailable",
        },
    }
    validator.validate(rejection)

    malformed_rejection = copy.deepcopy(rejection)
    malformed_rejection["payload"].pop("request_id")
    malformed_rejection["payload"]["rejection_id"] = "rejection_001"
    validator.validate(malformed_rejection)

    for field, value in (
        ("reason", "unknown_reason"),
        ("runtime_state", "changed"),
        ("retryable", "yes"),
        ("viewer_lease_token", "must-not-serialize"),
        ("internal_token", "must-not-serialize"),
        ("authorization", "must-not-serialize"),
        ("raw_response", "must-not-serialize"),
    ):
        invalid = copy.deepcopy(rejection)
        invalid["payload"][field] = value
        assert list(validator.iter_errors(invalid)), field

    both_ids = copy.deepcopy(rejection)
    both_ids["payload"]["rejection_id"] = "rejection_001"
    assert list(validator.iter_errors(both_ids))


@pytest.mark.parametrize(
    ("event_type", "payload"),
    [
        (
            "openedStageResult",
            {
                "result": "success",
                "request_id": "request_001",
                "url": "http://127.0.0.1:49101/artifacts/primary/model.usdc",
                "error": "",
                "binding_revision_id": "binding_rev_001",
                "applied_mode": "stage_composition",
                "primary_binding": {
                    "artifact_id": "artifact_primary",
                    "role": "primary",
                    "load_order": 0,
                    "url": "http://127.0.0.1:49101/artifacts/primary/model.usdc",
                    "composition_strategy": "primary_stage",
                },
                "loaded_bindings": [],
                "failed_bindings": [],
                "partial_load": False,
                "missing_paths": [],
                "fallback_paths": [],
            },
        ),
        (
            "loadArtifactGroupResult",
            {
                "result": "accepted",
                "request_id": "request_001",
                "url": "http://127.0.0.1:49101/artifacts/primary/model.usdc",
                "binding_revision_id": "binding_rev_001",
            },
        ),
        (
            "highlightPrimsResult",
            {
                "result": "success",
                "request_id": "request_001",
                "applied_mode": "selection",
                "selected_paths": ["/World/Wall"],
                "missing_paths": [],
                "fallback_paths": [],
            },
        ),
        (
            "focusPrimResult",
            {
                "result": "success",
                "request_id": "request_001",
                "prim_path": "/World/Wall",
                "requested_prim_path": "/World/Wall/Face",
                "applied_mode": "selection",
                "fallback_path": "/World/Wall",
            },
        ),
    ],
)
def test_terminal_results_have_closed_public_payloads(event_type: str, payload: dict) -> None:
    validator = load_validator("kit-datachannel-v1.schema.json")
    message = {"event_type": event_type, "payload": {"trace_id": TRACE_ID, **payload}}
    validator.validate(message)

    for field in ("viewer_lease_token", "internal_token", "authorization", "raw_response"):
        invalid = copy.deepcopy(message)
        invalid["payload"][field] = "must-not-serialize"
        assert list(validator.iter_errors(invalid)), (event_type, field)


@pytest.mark.parametrize(
    ("event_type", "payload"),
    [
        (
            "selectPrimsResult",
            {
                "result": "success",
                "error": "",
                "selected_paths": ["/World"],
                "request_id": "request_001",
            },
        ),
        (
            "makePrimsPickableResponse",
            {"result": "success", "error": "", "request_id": "request_001"},
        ),
        (
            "resetStageResponse",
            {"result": "success", "error": "", "request_id": "request_001"},
        ),
        (
            "clearHighlightResult",
            {"result": "success", "applied_mode": "selection", "request_id": "request_001"},
        ),
    ],
)
def test_existing_mutator_success_events_are_catalogued(event_type: str, payload: dict) -> None:
    load_validator("kit-datachannel-v1.schema.json").validate(
        {"event_type": event_type, "payload": {"trace_id": TRACE_ID, **payload}}
    )


def test_partial_exact_stage_failure_exposes_closed_changed_failed_state() -> None:
    validator = load_validator("kit-datachannel-v1.schema.json")
    message = {
        "event_type": "openedStageResult",
        "payload": {
            "trace_id": TRACE_ID,
            "result": "error",
            "request_id": "request_001",
            "url": "stage://partially-applied.usdc",
            "error": "Stage open failed.",
            "binding_revision_id": "binding_rev_002",
            "runtime_state": "changed_failed",
            "partial_load": True,
            "failed_bindings": [{"artifact_id": "artifact_secondary"}],
        },
    }
    validator.validate(message)

    invalid = copy.deepcopy(message)
    invalid["payload"]["runtime_state"] = "changed_unconfirmed"
    assert list(validator.iter_errors(invalid))

    missing_revision = copy.deepcopy(message)
    missing_revision["payload"].pop("binding_revision_id")
    assert list(validator.iter_errors(missing_revision))

    missing_runtime_state = copy.deepcopy(message)
    missing_runtime_state["payload"].pop("runtime_state")
    assert list(validator.iter_errors(missing_runtime_state))


def test_production_kit_dispatches_only_catalogued_literal_events() -> None:
    emitted = set()
    for source_path in MESSAGING_SOURCE.glob("*.py"):
        tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "dispatch_event"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
            ):
                emitted.add(node.args[0].value)

    uncatalogued = emitted - kit_event_catalog()
    assert not uncatalogued, f"production Kit emits uncatalogued DataChannel events: {sorted(uncatalogued)}"


@pytest.mark.parametrize("extra", [
    {"action": "preset", "view": view, "scope": scope}
    for view in ("top", "front", "back", "left", "right", "iso") for scope in ("building", "all")
] + [{"action": "projection", "projection": p} for p in ("perspective", "orthographic")])
def test_camera_view_request_accepts_closed_actions(extra):
    validator = load_validator("kit-datachannel-v1.schema.json")
    validator.validate({"event_type": "cameraViewRequest", "payload": {**authority_envelope(), **extra}})


@pytest.mark.parametrize("extra", [
    {"action": "preset", "view": "bottom", "scope": "building"},
    {"action": "preset", "view": "top"},
    {"action": "preset", "view": "top", "scope": "building", "projection": "perspective"},
    {"action": "projection", "projection": "fisheye"},
    {"action": "projection"},
    {"action": "apply_state"},
    {"view": "top", "scope": "building"},
])
def test_camera_view_request_rejects_open_or_mixed_actions(extra):
    validator = load_validator("kit-datachannel-v1.schema.json")
    message = {"event_type": "cameraViewRequest", "payload": {**authority_envelope(), **extra}}
    assert list(validator.iter_errors(message))


@pytest.mark.parametrize("speed", [0, 0.009, 1000.1, "2", None, True])
def test_fly_navigation_request_rejects_out_of_range_speed(speed):
    validator = load_validator("kit-datachannel-v1.schema.json")
    message = {"event_type": "flyNavigationRequest", "payload": {**authority_envelope(), "speed": speed}}
    assert list(validator.iter_errors(message))


@pytest.mark.parametrize("event_type", ["cameraViewResult", "cameraStateResult"])
def test_camera_results_bind_camera_to_success_only(event_type):
    validator = load_validator("kit-datachannel-v1.schema.json")
    ok = {"trace_id": TRACE_ID, "request_id": "request_001", "result": "success", "camera": camera_state_sample()}
    validator.validate({"event_type": event_type, "payload": ok})
    missing = {key: value for key, value in ok.items() if key != "camera"}
    assert list(validator.iter_errors({"event_type": event_type, "payload": missing}))
    error = {"trace_id": TRACE_ID, "request_id": "request_001", "result": "error", "error": "Camera view could not be applied."}
    validator.validate({"event_type": event_type, "payload": error})
    assert list(validator.iter_errors({"event_type": event_type, "payload": {**error, "camera": camera_state_sample()}}))
    for field in ("viewer_lease_token", "internal_token", "raw_response"):
        assert list(validator.iter_errors({"event_type": event_type, "payload": {**ok, field: "x"}}))


@pytest.mark.parametrize("mutate", [
    lambda c: c.update(projection="fisheye"),
    lambda c: c.update(position=[0, 0]),
    lambda c: c.update(direction=[0, 0, "1"]),
    lambda c: c.update(target_distance=0),
    lambda c: c.update(fov_deg=180),
    lambda c: c.update(ortho_height=0),
    lambda c: c.pop("up"),
    lambda c: c.update(extra=True),
])
def test_camera_state_is_closed_and_bounded(mutate):
    validator = load_validator("kit-datachannel-v1.schema.json")
    camera = camera_state_sample()
    mutate(camera)
    message = {"event_type": "cameraStateResult", "payload": {
        "trace_id": TRACE_ID, "request_id": "request_001", "result": "success", "camera": camera}}
    assert list(validator.iter_errors(message))


@pytest.mark.parametrize("payload_extra", [
    {"display_opacity": -0.1}, {"display_opacity": 1.1}, {"display_opacity": "0.5"}, {"display_opacity": None},
    {"display_opacity": True}, {"prim_path": "/World/Elements/Wall_001"}, {"prim_path": "/World/Overlays/Cfd"},
    {"prim_path": "/World/Overlays/Cfd/run 1"}, {"prim_path": "/World/Overlays/Cfd/run_001/../x"},
    {"extra": 1},
])
def test_overlay_style_request_is_bounded_to_cfd_overlay_prims(payload_extra):
    validator = load_validator("kit-datachannel-v1.schema.json")
    good = {**authority_envelope(), "prim_path": "/World/Overlays/Cfd/run_001/PedestrianWind_1p5m", "display_opacity": 0.5}
    validator.validate({"event_type": "overlayStyleRequest", "payload": good})
    for edge in (0, 1):
        validator.validate({"event_type": "overlayStyleRequest", "payload": {**good, "display_opacity": edge}})
    assert list(validator.iter_errors({"event_type": "overlayStyleRequest", "payload": {**good, **payload_extra}}))


def test_overlay_style_result_binds_opacity_to_success_only():
    validator = load_validator("kit-datachannel-v1.schema.json")
    base = {"trace_id": TRACE_ID, "request_id": "request_001"}
    ok = {**base, "result": "success", "prim_path": "/World/Overlays/Cfd/run_001/PedestrianWind_1p5m", "display_opacity": 0.4}
    validator.validate({"event_type": "overlayStyleResult", "payload": ok})
    assert list(validator.iter_errors({"event_type": "overlayStyleResult", "payload": {**base, "result": "success"}}))
    assert list(validator.iter_errors({"event_type": "overlayStyleResult",
                                       "payload": {**base, "result": "success", "prim_path": "/World/Overlays/Cfd/run_001/PedestrianWind_1p5m"}}))
    validator.validate({"event_type": "overlayStyleResult",
                        "payload": {**base, "result": "error", "error": "Overlay style could not be applied."}})
    assert list(validator.iter_errors({"event_type": "overlayStyleResult",
                                       "payload": {**base, "result": "error", "display_opacity": 0.4}}))
    assert list(validator.iter_errors({"event_type": "overlayStyleResult", "payload": {**ok, "viewer_lease_token": "x"}}))


def test_fly_result_binds_speed_to_success_only():
    validator = load_validator("kit-datachannel-v1.schema.json")
    base = {"trace_id": TRACE_ID, "request_id": "request_001"}
    validator.validate({"event_type": "flyNavigationResult", "payload": {**base, "result": "success", "speed": 3.0}})
    assert list(validator.iter_errors({"event_type": "flyNavigationResult", "payload": {**base, "result": "success"}}))
    assert list(validator.iter_errors({"event_type": "flyNavigationResult",
                                       "payload": {**base, "result": "error", "speed": 3.0}}))
