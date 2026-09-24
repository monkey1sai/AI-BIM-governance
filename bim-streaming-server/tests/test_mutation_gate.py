"""Mutation Gate interface tests (docs/architecture/mutation-gate-adr.md): admission, read-only trace verification and stage
confirmation, through a real RuntimeAuthorityClient whose transport is the in-memory coordinator authority service."""

import sys
import types
from pathlib import Path

import pytest

from runtime_authority_service_fake import (
    AUTHORIZE,
    LEASE_RELEASED,
    ROLLBACK,
    SESSION_ID,
    TRACE_ID,
    UNREACHABLE,
    VERIFY,
    FakeAuthorityService,
)

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

# The gate logs through carb; outside Kit a no-op stand-in is installed only while the module is first imported.
_MISSING = object()
_saved_carb = sys.modules.get("carb", _MISSING)
if "mutation_gate" not in sys.modules:
    _carb = types.ModuleType("carb")
    _carb.log_info = lambda *_args, **_kwargs: None
    _carb.log_warn = lambda *_args, **_kwargs: None
    sys.modules["carb"] = _carb
try:
    from mutation_gate import Admitted, MutationGate, Refused  # noqa: E402
    from runtime_authority import AuthorityDecision, RuntimeAuthorityClient, local_denial  # noqa: E402
finally:
    if _saved_carb is _MISSING:
        sys.modules.pop("carb", None)
    else:
        sys.modules["carb"] = _saved_carb


def gate(service):
    return MutationGate(RuntimeAuthorityClient(
        base_url="http://127.0.0.1:8004",
        internal_token="internal-test-token",
        transport=service,
    ))


def command(request_id="req-1", **fields):
    return {
        "request_id": request_id,
        "session_id": SESSION_ID,
        "trace_id": TRACE_ID,
        "source_client_id": "viewer_lease_x",
        "viewer_lease_token": "viewer-secret-sentinel",
        **fields,
    }


def stage_load(request_id="request_stage_001"):
    return command(
        request_id,
        stage_binding_authorization_id="stage_auth_001",
        binding_revision_id="rev_binding_001",
        url="http://127.0.0.1:49101/objects/primary.usdc",
    )


def routes(service):
    return [route for route, _body in service.requests]


def test_admits_a_verified_authorized_command_with_the_authority_data():
    service = FakeAuthorityService(data={"measurement_context": {"policy_id": "primary-lease-distance-v1"}})
    admission = gate(service).admit("focusPrimRequest", command(prim_path="/World/Wall_001"))
    assert isinstance(admission, Admitted)
    assert admission.trace_id == TRACE_ID
    assert admission.decision.authorized and admission.decision.request_id == "req-1"
    assert admission.decision.data["measurement_context"] == {"policy_id": "primary-lease-distance-v1"}
    assert routes(service) == [VERIFY, AUTHORIZE]
    assert service.bodies(AUTHORIZE)[0]["command_context"] == {"prim_path": "/World/Wall_001"}


@pytest.mark.parametrize("trace_id", [None, "rev_review_session_other"])
def test_drops_an_unverified_trace_silently_and_never_asks_for_authorization(trace_id):
    service = FakeAuthorityService()
    payload = command()
    if trace_id is None:
        payload.pop("trace_id")
    else:
        payload["trace_id"] = trace_id
    refused = gate(service).admit("focusPrimRequest", payload)
    assert isinstance(refused, Refused) and refused.rejection is None
    assert refused.decision.detail_code == ("datachannel_trace_missing" if trace_id is None else "datachannel_trace_unverified")
    # A missing trace is refused before the coordinator is asked; a foreign one is asked about once.
    assert routes(service) == ([] if trace_id is None else [VERIFY])


def test_answers_an_unreachable_authority_retryably_and_never_authorizes():
    service = FakeAuthorityService(verify=UNREACHABLE)
    refused = gate(service).admit("focusPrimRequest", command("req-outage"))
    assert isinstance(refused, Refused)
    assert refused.rejection == {
        "rejected_event_type": "focusPrimRequest",
        "reason": "lease_invalid",
        "retryable": True,
        "runtime_state": "unchanged",
        "request_id": "req-outage",
        "session_id": SESSION_ID,
        "trace_id": TRACE_ID,
        "detail_code": "authority_unavailable",
    }
    assert routes(service) == [VERIFY]


def test_refuses_an_authorization_denial_with_the_authority_reason_and_never_the_lease_token():
    service = FakeAuthorityService(authorize={"reason": "spectator_readonly", "retryable": False, "detail_code": "primary_lease_required"})
    refused = gate(service).admit("cameraViewRequest", command("req-denied", action="preset", view="top", scope="all"))
    assert isinstance(refused, Refused)
    assert refused.rejection == {
        "rejected_event_type": "cameraViewRequest",
        "reason": "spectator_readonly",
        "retryable": False,
        "runtime_state": "unchanged",
        "request_id": "req-denied",
        "session_id": SESSION_ID,
        "trace_id": TRACE_ID,
        "detail_code": "primary_lease_required",
    }
    assert "viewer-secret-sentinel" not in str(refused)


def test_refuses_a_harness_only_command_without_asking_the_coordinator():
    service = FakeAuthorityService()
    refused = gate(service).admit("composeStageRequest", command("req-compose"))
    assert isinstance(refused, Refused)
    assert (refused.rejection["reason"], refused.rejection["detail_code"]) == ("unsupported_command", "harness_only_command")
    assert routes(service) == [VERIFY]


def test_runs_the_precondition_after_verification_and_before_authorization():
    service = FakeAuthorityService()
    seen = []

    def stage_load_in_progress():
        seen.append(routes(service))
        return local_denial(stage_load(), "session_lifecycle_blocked", "stage_load_in_progress")

    refused = gate(service).admit("openStageRequest", stage_load(), precondition=stage_load_in_progress)
    assert seen == [[VERIFY]]
    assert isinstance(refused, Refused)
    assert (refused.rejection["reason"], refused.rejection["detail_code"]) == ("session_lifecycle_blocked", "stage_load_in_progress")
    assert routes(service) == [VERIFY]

    assert isinstance(gate(service).admit("openStageRequest", stage_load(), precondition=lambda: None), Admitted)
    never = []
    foreign = {**stage_load(), "trace_id": "rev_review_session_other"}
    assert gate(service).admit("openStageRequest", foreign, precondition=lambda: never.append(True)).rejection is None
    assert never == []


def test_rolls_back_a_stage_load_whose_authorization_went_unanswered():
    service = FakeAuthorityService(authorize=UNREACHABLE)
    refused = gate(service).admit("openStageRequest", stage_load())
    assert isinstance(refused, Refused)
    assert (refused.rejection["detail_code"], refused.rejection["retryable"]) == ("authority_unavailable", True)
    assert routes(service) == [VERIFY, AUTHORIZE, ROLLBACK]
    assert service.bodies(ROLLBACK) == service.bodies(AUTHORIZE)


def test_reauthorize_asks_the_authority_again_without_verifying_the_trace():
    service = FakeAuthorityService(data={"measurement_context": {"policy_id": "primary-lease-distance-v1"}})
    admitted = gate(service).reauthorize("measurementRequest", command("req-measure", action="start", measurement_id="m"))
    assert isinstance(admitted, Admitted)
    assert admitted.trace_id == TRACE_ID
    assert admitted.decision.data["measurement_context"] == {"policy_id": "primary-lease-distance-v1"}
    assert routes(service) == [AUTHORIZE]


def test_reauthorize_refuses_a_denial_with_the_authority_reason():
    service = FakeAuthorityService(authorize=LEASE_RELEASED)
    refused = gate(service).reauthorize("measurementRequest", command("req-measure", action="pick", measurement_id="m"))
    assert isinstance(refused, Refused)
    assert (refused.rejection["reason"], refused.rejection["detail_code"]) == ("lease_invalid", "lease_released")
    assert routes(service) == [AUTHORIZE]


def test_verify_readonly_answers_the_trace_or_the_refusal_and_never_authorizes():
    service = FakeAuthorityService()
    assert gate(service).verify_readonly("cameraStateRequest", command()) == TRACE_ID
    refused = gate(service).verify_readonly("cameraStateRequest", {**command(), "trace_id": "rev_review_session_other"})
    assert isinstance(refused, Refused) and refused.rejection is None
    assert service.bodies(AUTHORIZE) == []
    unreachable = gate(FakeAuthorityService(verify=UNREACHABLE)).verify_readonly("loadingStateQuery", command("req-query"))
    assert isinstance(unreachable, Refused)
    assert (unreachable.rejection["rejected_event_type"], unreachable.rejection["retryable"]) == ("loadingStateQuery", True)


def test_confirms_a_stage_result_through_the_authority():
    service = FakeAuthorityService()
    confirmed = gate(service).confirm_stage(stage_load(), "success")
    assert confirmed.authorized and confirmed.data["transaction_status"] == "active"
    assert service.confirmed_outcomes == ["success"]
    unanswered = gate(FakeAuthorityService(confirm=UNREACHABLE)).confirm_stage(stage_load(), "failed")
    assert not unanswered.authorized and unanswered.detail_code == "authority_unavailable"


def test_an_accepted_verification_without_a_trace_is_a_silent_refusal():
    class TracelessAuthority:
        def __init__(self):
            self.authorized = []

        def verify_datachannel_trace_decision(self, _event_type, _payload):
            return AuthorityDecision(True)

        def authorize(self, event_type, payload):
            self.authorized.append(event_type)

    authority = TracelessAuthority()
    refused = MutationGate(authority).admit("focusPrimRequest", command())
    assert isinstance(refused, Refused) and refused.rejection is None
    assert authority.authorized == []


def test_a_verification_that_raises_is_a_silent_refusal():
    class ExplodingAuthority:
        def __init__(self):
            self.authorized = []

        def verify_datachannel_trace_decision(self, _event_type, _payload):
            raise RuntimeError("transport bug")

        def authorize(self, event_type, payload):
            self.authorized.append(event_type)

    authority = ExplodingAuthority()
    refused = MutationGate(authority).admit("focusPrimRequest", command())
    assert isinstance(refused, Refused) and refused.rejection is None
    assert authority.authorized == []
