import json
import sys
from pathlib import Path

import pytest


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

import runtime_authority  # noqa: E402
from runtime_authority import (  # noqa: E402
    HARNESS_ONLY_EVENTS,
    MUTATING_EVENTS,
    READONLY_EVENTS,
    REJECTION_REASONS,
    STAGE_LOAD_EVENTS,
    RuntimeAuthorityClient,
    command_rejected_payload,
)


def runtime_payload(**overrides):
    payload = {
        "request_id": "req-runtime-1",
        "session_id": "review_session_x",
        "source_client_id": "viewer_lease_primary",
        "viewer_lease_token": "viewer-secret-sentinel",
        "mode": "replace",
        "items": [{"prim_path": "/World/Wall_001"}],
        "focus_first": True,
    }
    payload.update(overrides)
    return payload


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, url, headers, body, timeout):
        self.calls.append((url, dict(headers), body, timeout))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        status, payload = response
        raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        return status, raw


def client(transport, **overrides):
    return RuntimeAuthorityClient(
        base_url=overrides.pop("base_url", "http://127.0.0.1:8004"),
        internal_token=overrides.pop("internal_token", "internal-secret-sentinel"),
        transport=transport,
        **overrides,
    )


def test_runtime_command_catalogs_are_explicit():
    assert "highlightPrimsRequest" in MUTATING_EVENTS
    assert "focusPrimRequest" in MUTATING_EVENTS
    assert "openStageRequest" in MUTATING_EVENTS
    assert "composeStageRequest" in MUTATING_EVENTS
    assert "loadingStateQuery" in READONLY_EVENTS
    assert "getChildrenRequest" in READONLY_EVENTS


def test_runtime_command_catalogs_match_cross_language_fixture():
    fixture_path = (
        Path(__file__).resolve().parents[2]
        / "tests"
        / "contracts"
        / "runtime-mutation-authority-v1.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))

    assert fixture["version"] == 1
    assert set(fixture["mutatingEventTypes"]) == MUTATING_EVENTS
    assert set(fixture["readonlyEventTypes"]) == READONLY_EVENTS
    assert set(fixture["stageLoadEventTypes"]) == STAGE_LOAD_EVENTS
    assert set(fixture["harnessOnlyEventTypes"]) == HARNESS_ONLY_EVENTS
    assert set(fixture["rejectionReasons"]) == REJECTION_REASONS


@pytest.mark.parametrize(
    "base_url, valid",
    [
        ("http://127.0.0.1:8004", True),
        ("http://localhost:8004", True),
        ("http://[::1]:8004", True),
        ("http://192.168.1.10:8004", False),
        ("https://example.com", False),
        ("http://127.0.0.1:8004/untrusted-prefix", False),
    ],
)
def test_runtime_authority_requires_explicit_loopback_base(base_url, valid):
    authority = client(FakeTransport([]), base_url=base_url)
    assert authority.configuration_valid is valid


def test_timeout_is_bounded_to_300_through_500_ms():
    assert client(FakeTransport([]), timeout_seconds=0.01).timeout_seconds == 0.3
    assert client(FakeTransport([]), timeout_seconds=9).timeout_seconds == 0.5


def test_default_transport_disables_environment_proxies(monkeypatch):
    handlers = []

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return b"{}"

    class FakeOpener:
        def open(self, _request, timeout):
            assert timeout == 0.3
            return FakeResponse()

    def fake_build_opener(*configured_handlers):
        handlers.extend(configured_handlers)
        return FakeOpener()

    monkeypatch.setattr(runtime_authority, "build_opener", fake_build_opener)

    status, raw = RuntimeAuthorityClient._default_transport(
        "http://127.0.0.1:8004/api/internal/test",
        {"X-Internal-Token": "internal-secret-sentinel"},
        b"{}",
        0.3,
    )

    assert status == 200
    assert raw == b"{}"
    assert any(
        type(handler).__name__ == "ProxyHandler" and handler.proxies == {}
        for handler in handlers
    )


def test_authorizes_each_attempt_without_positive_cache_and_strips_secrets_from_body():
    transport = FakeTransport([
        (200, {"authorized": True, "request_id": "req-runtime-1", "retryable": False}),
        (200, {"authorized": True, "request_id": "req-runtime-1", "retryable": False}),
    ])
    authority = client(transport)

    first = authority.authorize("highlightPrimsRequest", runtime_payload())
    second = authority.authorize("highlightPrimsRequest", runtime_payload())

    assert first.authorized is True
    assert second.authorized is True
    assert len(transport.calls) == 2
    url, headers, raw_body, timeout = transport.calls[0]
    body = json.loads(raw_body)
    assert url.endswith("/api/internal/review-sessions/review_session_x/runtime-command-authorizations")
    assert timeout == 0.4
    assert headers["X-Internal-Token"] == "internal-secret-sentinel"
    assert headers["X-Viewer-Lease-Token"] == "viewer-secret-sentinel"
    assert body == {
        "source_client_id": "viewer_lease_primary",
        "requested_event_type": "highlightPrimsRequest",
        "request_id": "req-runtime-1",
        "command_context": {
            "mode": "replace",
            "items": [{"prim_path": "/World/Wall_001"}],
            "focus_first": True,
        },
    }
    assert "viewer-secret-sentinel" not in raw_body.decode("utf-8")
    assert "internal-secret-sentinel" not in raw_body.decode("utf-8")


def test_maps_structured_business_denial_without_making_it_retryable():
    transport = FakeTransport([(
        200,
        {
            "authorized": False,
            "reason": "lease_invalid",
            "request_id": "req-runtime-1",
            "retryable": False,
            "detail_code": "lease_released",
        },
    )])
    authority = client(transport)
    decision = authority.authorize("highlightPrimsRequest", runtime_payload())
    rejection = command_rejected_payload("highlightPrimsRequest", runtime_payload(), decision)

    assert rejection == {
        "rejected_event_type": "highlightPrimsRequest",
        "reason": "lease_invalid",
        "request_id": "req-runtime-1",
        "session_id": "review_session_x",
        "retryable": False,
        "runtime_state": "unchanged",
        "detail_code": "lease_released",
    }
    serialized = json.dumps(rejection)
    assert "viewer-secret-sentinel" not in serialized
    assert "internal-secret-sentinel" not in serialized


@pytest.mark.parametrize(
    "response",
    [
        TimeoutError("timeout with secret viewer-secret-sentinel"),
        (302, {"authorized": True}),
        (500, {"authorized": False}),
        (200, b"not-json viewer-secret-sentinel"),
        (200, []),
        (200, {"authorized": "yes"}),
        (200, {"authorized": True, "request_id": "wrong-id", "retryable": False}),
        (200, {"authorized": False, "reason": "unknown", "request_id": "req-runtime-1", "retryable": False}),
    ],
)
def test_transport_or_malformed_response_is_classified_as_authority_unavailable(response):
    authority = client(FakeTransport([response]))
    decision = authority.authorize("highlightPrimsRequest", runtime_payload())
    rejection = command_rejected_payload("highlightPrimsRequest", runtime_payload(), decision)

    assert rejection["reason"] == "lease_invalid"
    assert rejection["retryable"] is True
    assert rejection["runtime_state"] == "unchanged"
    assert rejection["detail_code"] == "authority_unavailable"
    assert "viewer-secret-sentinel" not in json.dumps(rejection)


def test_missing_request_id_uses_rejection_id_without_network_call():
    transport = FakeTransport([])
    payload = runtime_payload(request_id=None)
    decision = client(transport).authorize("highlightPrimsRequest", payload)
    rejection = command_rejected_payload("highlightPrimsRequest", payload, decision)

    assert rejection["reason"] == "invalid_payload"
    assert "request_id" not in rejection
    assert rejection["rejection_id"].startswith("rejection_")
    assert transport.calls == []


def test_harness_only_compose_is_rejected_without_network_call():
    transport = FakeTransport([])
    decision = client(transport).authorize("composeStageRequest", runtime_payload())
    rejection = command_rejected_payload("composeStageRequest", runtime_payload(), decision)

    assert rejection["reason"] == "unsupported_command"
    assert rejection["detail_code"] == "harness_only_command"
    assert transport.calls == []


def test_stage_authorization_forwards_exact_transaction_but_not_tokens():
    transport = FakeTransport([(
        200,
        {"authorized": True, "request_id": "req-runtime-1", "retryable": False},
    )])
    payload = runtime_payload(
        stage_binding_authorization_id="stage_auth_1",
        binding_revision_id="binding_rev_1",
        stage_composition={
            "primary": {
                "artifact_id": "artifact_primary",
                "role": "primary",
                "load_order": 0,
                "usdc_url": "http://127.0.0.1:49101/model.usdc",
            },
            "secondary_layers": [],
        },
    )
    decision = client(transport).authorize("openStageRequest", payload)

    assert decision.authorized is True
    body = json.loads(transport.calls[0][2])
    assert body["stage_binding_authorization_id"] == "stage_auth_1"
    assert body["binding_revision_id"] == "binding_rev_1"
    assert body["stage_composition"] == payload["stage_composition"]
    assert body["command_context"] == {}
    assert "viewer_lease_token" not in body


def test_stage_authorization_timeout_triggers_exact_pre_mutation_rollback():
    transport = FakeTransport([
        TimeoutError("authorization response lost"),
        (200, {
            "rolled_back": True,
            "request_id": "req-runtime-1",
            "transaction_status": "failed",
            "idempotent_replay": False,
        }),
    ])
    authority = client(transport)
    payload = runtime_payload(
        stage_binding_authorization_id="stage_auth_001",
        binding_revision_id="binding_rev_001",
        stage_composition={
            "primary": {
                "artifact_id": "artifact_primary",
                "role": "primary",
                "load_order": 0,
                "usdc_url": "http://127.0.0.1:49101/model.usdc",
            },
            "secondary_layers": [],
        },
    )

    decision = authority.authorize("openStageRequest", payload)

    assert decision.authorized is False
    assert decision.detail_code == "authority_unavailable"
    assert len(transport.calls) == 2
    authorize_url, _, authorize_body, _ = transport.calls[0]
    rollback_url, rollback_headers, rollback_body, _ = transport.calls[1]
    assert authorize_url.endswith("/runtime-command-authorizations")
    assert rollback_url.endswith("/stage-binding-authorization-rollbacks")
    assert rollback_body == authorize_body
    assert rollback_headers["X-Viewer-Lease-Token"] == "viewer-secret-sentinel"
    assert "viewer-secret-sentinel" not in rollback_body.decode("utf-8")


def test_stage_confirmation_requires_structured_http_200_and_preserves_changed_unconfirmed_mapping():
    transport = FakeTransport([
        (200, {
            "confirmed": True,
            "request_id": "req-runtime-1",
            "binding_revision_id": "binding_rev_1",
            "transaction_status": "active",
            "active_binding_revision": "binding_rev_1",
            "last_good_binding_revision": "binding_rev_1",
            "idempotent_replay": False,
        }),
        (503, b"raw upstream secret viewer-secret-sentinel"),
    ])
    payload = runtime_payload(
        stage_binding_authorization_id="stage_auth_1",
        binding_revision_id="binding_rev_1",
    )
    authority = client(transport)

    assert authority.confirm_stage(payload, "success").authorized is True
    unavailable = authority.confirm_stage(payload, "success")
    rejection = command_rejected_payload(
        "openStageRequest",
        payload,
        unavailable,
        runtime_state="changed_unconfirmed",
    )
    assert rejection["runtime_state"] == "changed_unconfirmed"
    assert rejection["retryable"] is True
    assert rejection["detail_code"] == "authority_unavailable"
    assert "viewer-secret-sentinel" not in json.dumps(rejection)


@pytest.mark.parametrize(
    "response",
    [
        {
            "confirmed": True,
            "request_id": "req-runtime-1",
            "transaction_status": "active",
            "active_binding_revision": "binding_rev_1",
            "idempotent_replay": False,
        },
        {
            "confirmed": True,
            "request_id": "req-runtime-1",
            "binding_revision_id": "binding_rev_wrong",
            "transaction_status": "active",
            "active_binding_revision": "binding_rev_wrong",
            "idempotent_replay": False,
        },
        {
            "confirmed": True,
            "request_id": "req-runtime-1",
            "binding_revision_id": "binding_rev_1",
            "transaction_status": "failed",
            "active_binding_revision": "binding_rev_1",
            "idempotent_replay": False,
        },
        {
            "confirmed": True,
            "request_id": "req-runtime-1",
            "binding_revision_id": "binding_rev_1",
            "transaction_status": "active",
            "active_binding_revision": "binding_rev_1",
        },
    ],
)
def test_stage_confirmation_rejects_malformed_or_mismatched_success(response):
    payload = runtime_payload(
        stage_binding_authorization_id="stage_auth_1",
        binding_revision_id="binding_rev_1",
    )

    decision = client(FakeTransport([(200, response)])).confirm_stage(payload, "success")

    assert decision.authorized is False
    assert decision.reason == "lease_invalid"
    assert decision.retryable is True
    assert decision.detail_code == "authority_unavailable"


def test_failed_stage_confirmation_requires_matching_failed_status_and_revision():
    payload = runtime_payload(
        stage_binding_authorization_id="stage_auth_1",
        binding_revision_id="binding_rev_1",
    )
    response = {
        "confirmed": True,
        "request_id": "req-runtime-1",
        "binding_revision_id": "binding_rev_1",
        "transaction_status": "failed",
        "active_binding_revision": "binding_rev_previous",
        "last_good_binding_revision": "binding_rev_previous",
        "idempotent_replay": False,
    }

    decision = client(FakeTransport([(200, response)])).confirm_stage(payload, "failed")

    assert decision.authorized is True
