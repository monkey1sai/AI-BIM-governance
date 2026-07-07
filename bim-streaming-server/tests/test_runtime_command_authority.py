import sys
from pathlib import Path


MODULE_DIR = (
    Path(__file__).resolve().parents[1]
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)
sys.path.insert(0, str(MODULE_DIR))

from runtime_authority import (  # noqa: E402
    MUTATING_EVENTS,
    READONLY_EVENTS,
    is_authorized_mutator,
    unauthorized_result_payload,
)


def test_runtime_command_allowlists_are_explicit():
    assert "highlightPrimsRequest" in MUTATING_EVENTS
    assert "focusPrimRequest" in MUTATING_EVENTS
    assert "openStageRequest" in MUTATING_EVENTS
    assert "loadingStateQuery" in READONLY_EVENTS
    assert "getChildrenRequest" in READONLY_EVENTS
    assert "composeStageRequest" not in MUTATING_EVENTS


def test_primary_payload_requires_session_and_lease_token():
    assert is_authorized_mutator({
        "role": "primary",
        "source_client_id": "viewer_lease_primary",
        "viewer_lease_token": "secret",
        "session_id": "review_session_x",
    })
    assert is_authorized_mutator({
        "role": "primary",
        "lease_token": "secret",
        "session_id": "review_session_x",
    })
    assert not is_authorized_mutator({"role": "primary", "source_client_id": "viewer_lease_primary"})
    assert not is_authorized_mutator({"role": "primary", "viewer_lease_token": "secret"})
    assert not is_authorized_mutator({"role": "primary", "session_id": "review_session_x"})


def test_missing_or_spectator_payload_is_rejected():
    assert not is_authorized_mutator({})
    assert not is_authorized_mutator({"role": "spectator", "source_client_id": "viewer_lease_spectator"})
    assert not is_authorized_mutator({"role": "primary"})


def test_unauthorized_result_preserves_request_id():
    payload = unauthorized_result_payload({"request_id": "req-1", "binding_revision_id": "rev-1"}, selected_paths=[])
    assert payload == {
        "result": "error",
        "error": "unauthorized_mutating_command",
        "reason": "primary lease required",
        "selected_paths": [],
        "request_id": "req-1",
        "binding_revision_id": "rev-1",
    }
