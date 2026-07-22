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


def load_validator(name: str) -> Draft202012Validator:
    schema = json.loads((CONTRACTS / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def authority_envelope() -> dict:
    return {
        "request_id": "request_001",
        "role": "primary",
        "source_client_id": "viewer_lease_001",
        "session_id": "review_session_001",
        "viewer_lease_token": "ephemeral-test-token",
    }


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


def kit_event_catalog() -> set[str]:
    schema = json.loads((CONTRACTS / "kit-datachannel-v1.schema.json").read_text(encoding="utf-8"))
    catalog = set()
    for entry in schema["oneOf"]:
        definition_name = entry["$ref"].rsplit("/", 1)[-1]
        catalog.add(schema["$defs"][definition_name]["properties"]["event_type"]["const"])
    return catalog


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
    message = {"event_type": event_type, "payload": payload}
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
        {"event_type": event_type, "payload": payload}
    )


def test_partial_exact_stage_failure_exposes_closed_changed_failed_state() -> None:
    validator = load_validator("kit-datachannel-v1.schema.json")
    message = {
        "event_type": "openedStageResult",
        "payload": {
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


def test_vg01_bridge_carries_ephemeral_user_token_and_stage_proof_status() -> None:
    validator = load_validator("vg01-postmessage-v1.schema.json")
    validator.validate(
        {
            "protocol": "vg01",
            "type": "viewer_lease_token",
            "token": "lease-token",
            "user_token": "lab-user-carrier",
        }
    )
    validator.validate(
        {
            "protocol": "vg01",
            "type": "stage_loaded",
            "stageUrl": None,
            "status": "unproven",
            "binding_revision_id": "binding_rev_001",
        }
    )

    missing_status = {
        "protocol": "vg01",
        "type": "stage_loaded",
        "stageUrl": "stage://model.usdc",
    }
    assert list(validator.iter_errors(missing_status))

    invalid_status = {**missing_status, "status": "loaded"}
    assert list(validator.iter_errors(invalid_status))

    token_in_stage_event = {
        "protocol": "vg01",
        "type": "stage_loaded",
        "stageUrl": None,
        "status": "unproven",
        "token": "must-not-serialize",
    }
    assert list(validator.iter_errors(token_in_stage_event))
