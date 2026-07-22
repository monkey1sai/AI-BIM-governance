import json
import os
import sys
import types
from pathlib import Path

import pytest

_ALLOWED_STAGE_HOSTS_ENV = "BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS"


def install_stage_loading_stubs() -> None:
    class DummyItem:
        def get_dict(self):
            return {}

    carb = types.ModuleType("carb")
    carb.dictionary = types.SimpleNamespace(Item=DummyItem)
    carb.log_error = lambda *args, **kwargs: None
    carb.log_info = lambda *args, **kwargs: None
    carb.log_warn = lambda *args, **kwargs: None

    carb_events = types.ModuleType("carb.events")
    carb_events.IEvent = object
    carb_events.type_from_string = lambda value: value
    carb.events = carb_events

    carb_tokens = types.ModuleType("carb.tokens")
    carb.tokens = carb_tokens

    carb_eventdispatcher = types.ModuleType("carb.eventdispatcher")
    carb_eventdispatcher.get_eventdispatcher = lambda: types.SimpleNamespace(
        observe_event=lambda **kwargs: object()
    )

    omni = types.ModuleType("omni")
    omni_client = types.ModuleType("omni.client")
    omni_client.utils = types.SimpleNamespace(equal_urls=lambda left, right: left == right)
    omni_kit = types.ModuleType("omni.kit")
    omni_kit_app = types.ModuleType("omni.kit.app")
    omni_kit_app.register_event_alias = lambda *args, **kwargs: None

    async def next_update_async():
        return None

    omni_kit_app.get_app = lambda: types.SimpleNamespace(
        next_update_async=next_update_async
    )
    omni_kit.app = omni_kit_app

    omni_kit_livestream = types.ModuleType("omni.kit.livestream")
    omni_kit_livestream_messaging = types.ModuleType("omni.kit.livestream.messaging")
    omni_kit_livestream_messaging.register_event_type_to_send = lambda *args, **kwargs: None
    omni_kit_livestream.messaging = omni_kit_livestream_messaging
    omni_kit.livestream = omni_kit_livestream

    omni_usd = types.ModuleType("omni.usd")
    omni_usd.StageEventType = types.SimpleNamespace(OPENING=1, ASSETS_LOADED=2)
    omni_usd.UsdContextInitialLoadSet = types.SimpleNamespace(LOAD_ALL="load_all")
    default_context = types.SimpleNamespace(
        stage_event_name=lambda event_type: f"stage_event_{event_type}",
        get_stage=lambda: None,
    )
    omni_usd.get_context = lambda: default_context
    omni.usd = omni_usd
    omni.kit = omni_kit
    omni.client = omni_client

    pxr = types.ModuleType("pxr")
    for name in ("Gf", "Sdf", "Usd", "UsdGeom", "UsdLux"):
        setattr(pxr, name, types.ModuleType(f"pxr.{name}"))

    sys.modules.update(
        {
            "carb": carb,
            "carb.events": carb_events,
            "carb.tokens": carb_tokens,
            "carb.eventdispatcher": carb_eventdispatcher,
            "omni": omni,
            "omni.client": omni_client,
            "omni.kit": omni_kit,
            "omni.kit.app": omni_kit_app,
            "omni.kit.livestream": omni_kit_livestream,
            "omni.kit.livestream.messaging": omni_kit_livestream_messaging,
            "omni.usd": omni_usd,
            "pxr": pxr,
        }
    )


install_stage_loading_stubs()

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

import stage_loading  # noqa: E402
from runtime_authority import AuthorityDecision  # noqa: E402
from stage_loading import LoadingManager, _http_stage_allowed_hosts  # noqa: E402


class FakeAuthority:
    def __init__(self, *, authorize=None, confirm=None):
        self.authorize_decision = authorize or AuthorityDecision(
            True,
            request_id="request_stage_001",
        )
        self.confirm_decision = confirm or AuthorityDecision(
            True,
            request_id="request_stage_001",
        )
        self.authorize_calls = []
        self.confirm_calls = []

    def authorize(self, event_type, payload):
        self.authorize_calls.append((event_type, payload))
        return self.authorize_decision

    def confirm_stage(self, payload, outcome):
        self.confirm_calls.append((payload, outcome))
        return self.confirm_decision


def make_manager(authority=None) -> LoadingManager:
    manager = LoadingManager.__new__(LoadingManager)
    manager._subscriptions = []
    manager._runtime_authority = authority or FakeAuthority()
    manager._active_stage_attempt = None
    manager._active_terminal_started = False
    manager._active_stage_runtime_url = ""
    manager._managed_secondary_layer_ids = set()
    manager._managed_secondary_layer_owner = None
    manager._requested_stage_url = ""
    manager._requested_stage_context = {}
    manager._stage_is_opening = False
    manager._opened_stage_url = ""
    manager._public_opened_stage_url = ""
    manager._stage_has_opened = False
    manager._streaming_manager_is_busy = False
    manager._persisted_stage = False
    manager._is_evaluating_loading_status = False
    return manager


def capture_dispatch(monkeypatch):
    dispatched = []
    monkeypatch.setattr(
        stage_loading,
        "get_eventdispatcher",
        lambda: types.SimpleNamespace(
            dispatch_event=lambda name, payload: dispatched.append((name, payload))
        ),
    )
    return dispatched


def stage_payload(*, request_id="request_stage_001"):
    primary = {
        "artifact_id": "artifact_primary",
        "role": "primary",
        "url": "http://127.0.0.1:49101/objects/primary.usdc",
        "load_order": 0,
    }
    return {
        "request_id": request_id,
        "role": "primary",
        "source_client_id": "viewer_primary",
        "viewer_lease_token": "lease_secret_must_not_echo",
        "session_id": "review_session_x",
        "stage_binding_authorization_id": "stage_auth_001",
        "binding_revision_id": "rev_binding_001",
        "url": primary["url"],
        "stage_composition": {
            "primary": primary,
            "secondary_layers": [],
        },
    }


def test_stage_composition_takes_precedence_over_legacy_url():
    manager = make_manager()
    request = stage_payload()
    request["url"] = "http://127.0.0.1:49101/objects/legacy.usdc"

    url, context = manager._resolve_stage_request(request)

    assert url == request["stage_composition"]["primary"]["url"]
    assert context["applied_mode"] == "stage_composition"
    assert context["applied_primary"]["artifact_id"] == "artifact_primary"


def test_public_stage_context_allowlists_nested_binding_fields():
    manager = make_manager()
    context = {
        "applied_mode": "stage_composition",
        "primary_binding": {
            "artifact_id": "artifact_primary",
            "role": "primary",
            "load_order": 0,
            "url": "http://127.0.0.1:49101/objects/primary.usdc",
            "composition_strategy": "primary_stage",
            "viewer_lease_token": "nested-secret",
        },
        "loaded_bindings": [
            {
                "artifact_id": "artifact_secondary",
                "role": "secondary",
                "load_order": 10,
                "url": "http://127.0.0.1:49101/objects/secondary.usdc",
                "composition_strategy": "session_sublayer",
                "internal_token": "nested-secret",
            }
        ],
        "failed_bindings": [],
        "partial_load": False,
        "missing_paths": [],
        "fallback_paths": [
            {
                "requested_path": "/World/Wall/Face",
                "selected_path": "/World/Wall",
                "reason": "stage_root_fallback",
                "authorization": "nested-secret",
            }
        ],
        "secondary_bindings": [{"viewer_lease_token": "private-context"}],
        "viewer_lease_token": "top-level-secret",
        "internal_token": "top-level-secret",
        "authorization": "top-level-secret",
        "raw_response": "top-level-secret",
    }

    public = manager._public_stage_context(context)

    assert public["primary_binding"] == {
        "artifact_id": "artifact_primary",
        "role": "primary",
        "load_order": 0,
        "url": "http://127.0.0.1:49101/objects/primary.usdc",
        "composition_strategy": "primary_stage",
    }
    assert public["loaded_bindings"] == [
        {
            "artifact_id": "artifact_secondary",
            "role": "secondary",
            "load_order": 10,
            "url": "http://127.0.0.1:49101/objects/secondary.usdc",
            "composition_strategy": "session_sublayer",
        }
    ]
    assert public["fallback_paths"] == [
        {
            "requested_path": "/World/Wall/Face",
            "selected_path": "/World/Wall",
            "reason": "stage_root_fallback",
        }
    ]
    serialized = json.dumps(public, sort_keys=True)
    assert "secret" not in serialized
    assert "secondary_bindings" not in public


def test_artifact_group_authorizes_once_mutates_once_and_has_one_terminal(monkeypatch):
    authority = FakeAuthority()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    mutation_calls = []

    def open_authorized(attempt, context):
        mutation_calls.append((attempt, context))
        manager._finish_observed_stage_success(
            attempt,
            context,
            attempt.requested_stage_url,
        )

    monkeypatch.setattr(manager, "_open_authorized_stage", open_authorized)
    manager._on_load_artifact_group(types.SimpleNamespace(payload=stage_payload()))

    assert len(authority.authorize_calls) == 1
    assert authority.authorize_calls[0][0] == "loadArtifactGroupRequest"
    assert len(mutation_calls) == 1
    assert [name for name, _ in dispatched] == [
        "loadArtifactGroupResult",
        "openedStageResult",
    ]
    assert dispatched[0][1]["result"] == "accepted"
    assert dispatched[0][1]["request_id"] == "request_stage_001"
    assert dispatched[1][1]["result"] == "success"
    assert dispatched[1][1]["request_id"] == "request_stage_001"
    assert len(authority.confirm_calls) == 1
    assert authority.confirm_calls[0][1] == "success"
    assert "lease_secret_must_not_echo" not in repr(dispatched)


@pytest.mark.parametrize("handler_name", ["_on_load_artifact_group", "_on_open_stage"])
def test_stage_authority_denial_emits_only_command_rejected(
    monkeypatch,
    handler_name,
):
    authority = FakeAuthority(
        authorize=AuthorityDecision(
            False,
            reason="spectator_readonly",
            request_id="request_stage_001",
            retryable=False,
            detail_code="primary_lease_required",
        )
    )
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    monkeypatch.setattr(
        manager,
        "_open_authorized_stage",
        lambda *args: pytest.fail("denied request reached the stage primitive"),
    )

    getattr(manager, handler_name)(types.SimpleNamespace(payload=stage_payload()))

    assert len(authority.authorize_calls) == 1
    assert len(authority.confirm_calls) == 0
    assert len(dispatched) == 1
    assert dispatched[0][0] == "commandRejected"
    assert dispatched[0][1] == {
        "rejected_event_type": (
            "loadArtifactGroupRequest"
            if handler_name == "_on_load_artifact_group"
            else "openStageRequest"
        ),
        "reason": "spectator_readonly",
        "retryable": False,
        "runtime_state": "unchanged",
        "request_id": "request_stage_001",
        "session_id": "review_session_x",
        "detail_code": "primary_lease_required",
    }


@pytest.mark.parametrize("handler_name", ["_on_load_artifact_group", "_on_open_stage"])
def test_unloadable_authorized_stage_with_unconfirmed_failure_is_rejected(
    monkeypatch,
    handler_name,
):
    authority = FakeAuthority(
        confirm=AuthorityDecision(
            False,
            reason="lease_invalid",
            request_id="request_stage_001",
            retryable=True,
            detail_code="authority_unavailable",
        )
    )
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    payload = stage_payload()
    payload["url"] = ""
    payload["stage_composition"]["primary"]["url"] = ""

    getattr(manager, handler_name)(types.SimpleNamespace(payload=payload))

    assert len(authority.authorize_calls) == 1
    assert len(authority.confirm_calls) == 1
    assert authority.confirm_calls[0][1] == "failed"
    assert [name for name, _ in dispatched] == ["commandRejected"]
    assert dispatched[0][1]["runtime_state"] == "unchanged"
    assert dispatched[0][1]["retryable"] is True
    assert dispatched[0][1]["detail_code"] == "authority_unavailable"


def test_artifact_group_uses_private_immutable_attempt_snapshot(monkeypatch):
    manager = make_manager()
    dispatched = capture_dispatch(monkeypatch)
    captured = []
    monkeypatch.setattr(
        manager,
        "_open_authorized_stage",
        lambda attempt, context: captured.append((attempt, context)),
    )
    request = stage_payload()

    manager._on_load_artifact_group(types.SimpleNamespace(payload=request))
    request["stage_composition"]["primary"]["url"] = "http://attacker.invalid/tampered.usdc"
    request["binding_revision_id"] = "tampered_revision"

    attempt, active_context = captured[0]
    assert len(manager._runtime_authority.authorize_calls) == 1
    assert attempt.binding_revision_id == "rev_binding_001"
    assert attempt.stage_context()["applied_primary"]["url"].endswith("primary.usdc")
    assert active_context["applied_primary"]["url"].endswith("primary.usdc")
    assert dispatched[0][0] == "loadArtifactGroupResult"
    assert dispatched[0][1]["result"] == "accepted"


def test_interleaved_stage_request_is_rejected_without_second_authority_call(monkeypatch):
    authority = FakeAuthority()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    monkeypatch.setattr(manager, "_open_authorized_stage", lambda *args: None)

    manager._on_load_artifact_group(types.SimpleNamespace(payload=stage_payload()))
    manager._on_open_stage(
        types.SimpleNamespace(payload=stage_payload(request_id="request_stage_002"))
    )

    assert len(authority.authorize_calls) == 1
    assert [name for name, _ in dispatched] == [
        "loadArtifactGroupResult",
        "commandRejected",
    ]
    assert dispatched[1][1]["request_id"] == "request_stage_002"
    assert dispatched[1][1]["runtime_state"] == "unchanged"


def test_confirmation_failure_is_single_changed_unconfirmed_terminal(monkeypatch):
    authority = FakeAuthority(
        confirm=AuthorityDecision(
            False,
            reason="lease_invalid",
            request_id="request_stage_001",
            retryable=True,
            detail_code="authority_unavailable",
        )
    )
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    captured = []
    monkeypatch.setattr(
        manager,
        "_open_authorized_stage",
        lambda attempt, context: captured.append((attempt, context)),
    )

    manager._on_open_stage(types.SimpleNamespace(payload=stage_payload()))
    attempt, context = captured[0]
    manager._finish_observed_stage_success(attempt, context, attempt.requested_stage_url)
    manager._finish_observed_stage_success(attempt, context, attempt.requested_stage_url)

    assert len(authority.authorize_calls) == 1
    assert len(authority.confirm_calls) == 1
    assert len(dispatched) == 1
    assert dispatched[0][0] == "commandRejected"
    assert dispatched[0][1]["runtime_state"] == "changed_unconfirmed"
    assert dispatched[0][1]["retryable"] is True
    assert manager._active_stage_attempt is None


def test_partial_secondary_composition_confirms_failed_and_never_reports_active(monkeypatch):
    authority = FakeAuthority()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    payload = stage_payload()
    payload["stage_composition"]["secondary_layers"] = [
        {
            "artifact_id": "artifact_secondary",
            "role": "secondary",
            "url": "http://127.0.0.1:49101/objects/secondary.usdc",
            "load_order": 10,
        }
    ]
    requested_url, stage_context = manager._resolve_stage_request(payload)
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        requested_url,
        stage_context,
    )
    active_context = manager._reserve_stage_attempt(attempt)
    monkeypatch.setattr(
        stage_loading.omni.usd,
        "get_context",
        lambda: types.SimpleNamespace(get_stage=lambda: object()),
    )

    def compose_partial(stage, context):
        context["failed_bindings"] = [{"artifact_id": "artifact_secondary"}]
        context["partial_load"] = True

    monkeypatch.setattr(manager, "_compose_secondary_artifact_bindings", compose_partial)

    manager._finish_observed_stage_success(attempt, active_context, requested_url)

    assert len(authority.confirm_calls) == 1
    assert authority.confirm_calls[0][1] == "failed"
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "error"
    assert dispatched[0][1]["partial_load"] is True
    assert dispatched[0][1]["failed_bindings"] == [{"artifact_id": "artifact_secondary"}]
    assert manager._active_stage_attempt is None


def test_partial_secondary_failure_with_unconfirmed_completion_is_changed_unconfirmed(monkeypatch):
    authority = FakeAuthority(
        confirm=AuthorityDecision(
            False,
            reason="lease_invalid",
            request_id="request_stage_001",
            retryable=True,
            detail_code="authority_unavailable",
        )
    )
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    payload = stage_payload()
    requested_url, stage_context = manager._resolve_stage_request(payload)
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        requested_url,
        stage_context,
    )
    active_context = manager._reserve_stage_attempt(attempt)
    monkeypatch.setattr(
        stage_loading.omni.usd,
        "get_context",
        lambda: types.SimpleNamespace(get_stage=lambda: object()),
    )

    def compose_partial(stage, context):
        context["failed_bindings"] = [{"artifact_id": "artifact_secondary"}]
        context["partial_load"] = True

    monkeypatch.setattr(manager, "_compose_secondary_artifact_bindings", compose_partial)

    manager._finish_observed_stage_success(attempt, active_context, requested_url)

    assert len(authority.confirm_calls) == 1
    assert authority.confirm_calls[0][1] == "failed"
    assert [name for name, _ in dispatched] == ["commandRejected"]
    assert dispatched[0][1]["runtime_state"] == "changed_unconfirmed"
    assert dispatched[0][1]["detail_code"] == "authority_unavailable"
    assert manager._active_stage_attempt is None


def test_exact_composition_replaces_only_manager_owned_secondary_layers(monkeypatch):
    manager = make_manager()
    session_layer = types.SimpleNamespace(subLayerPaths=["unrelated-session-layer.usda"])
    stage = types.SimpleNamespace(GetSessionLayer=lambda: session_layer)
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: value)
    monkeypatch.setattr(
        stage_loading.Sdf,
        "Layer",
        types.SimpleNamespace(
            FindOrOpen=lambda identifier: types.SimpleNamespace(identifier=identifier)
        ),
        raising=False,
    )
    first = {
        "loaded_bindings": [{"artifact_id": "primary"}],
        "secondary_bindings": [
            {"artifact_id": "secondary_a", "url": "secondary-a.usda", "load_order": 10}
        ],
        "applied_secondary_layers": [],
        "skipped_secondary_layers": [],
    }
    second = {
        "loaded_bindings": [{"artifact_id": "primary"}],
        "secondary_bindings": [
            {"artifact_id": "secondary_b", "url": "secondary-b.usda", "load_order": 10}
        ],
        "applied_secondary_layers": [],
        "skipped_secondary_layers": [],
    }

    manager._compose_secondary_artifact_bindings(stage, first)
    assert session_layer.subLayerPaths == ["unrelated-session-layer.usda", "secondary-a.usda"]

    manager._compose_secondary_artifact_bindings(stage, second)

    assert session_layer.subLayerPaths == ["unrelated-session-layer.usda", "secondary-b.usda"]
    assert manager._managed_secondary_layer_ids == {"secondary-b.usda"}
    assert [item["artifact_id"] for item in second["loaded_bindings"]] == [
        "primary",
        "secondary_b",
    ]

    next_session_layer = types.SimpleNamespace(
        subLayerPaths=["secondary-b.usda", "new-stage-unrelated.usda"]
    )
    next_stage = types.SimpleNamespace(GetSessionLayer=lambda: next_session_layer)
    manager._compose_secondary_artifact_bindings(
        next_stage,
        {"secondary_bindings": []},
    )
    assert next_session_layer.subLayerPaths == [
        "secondary-b.usda",
        "new-stage-unrelated.usda",
    ]
    assert manager._managed_secondary_layer_ids == set()


def test_already_open_stage_confirms_before_success(monkeypatch):
    authority = FakeAuthority()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        stage_payload(),
        stage_payload()["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    context = manager._reserve_stage_attempt(attempt)
    stage = types.SimpleNamespace(
        GetRootLayer=lambda: types.SimpleNamespace(identifier=attempt.requested_stage_url)
    )
    monkeypatch.setattr(
        stage_loading.omni.usd,
        "get_context",
        lambda: types.SimpleNamespace(get_stage=lambda: stage),
    )
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: value)

    manager._open_authorized_stage(attempt, context)

    assert len(authority.confirm_calls) == 1
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "success"


@pytest.mark.asyncio
async def test_async_open_stage_confirms_before_success(monkeypatch):
    authority = FakeAuthority()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    scheduled = []
    payload = stage_payload()
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        payload["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    context = manager._reserve_stage_attempt(attempt)
    stage = types.SimpleNamespace(GetRootLayer=lambda: types.SimpleNamespace(identifier=""))

    async def open_stage_async(url, load_set):
        return True, ""

    usd_context = types.SimpleNamespace(
        get_stage=lambda: stage,
        open_stage_async=open_stage_async,
    )
    monkeypatch.setattr(stage_loading.omni.usd, "get_context", lambda: usd_context)
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: value)
    monkeypatch.setattr(manager, "_compose_secondary_artifact_bindings", lambda *args: None)
    monkeypatch.setattr(stage_loading, "_ensure_default_lighting", lambda stage: None)
    monkeypatch.setattr(
        stage_loading.asyncio,
        "ensure_future",
        lambda coroutine: scheduled.append(coroutine),
    )

    manager._open_authorized_stage(attempt, context)
    await scheduled[0]

    assert len(authority.confirm_calls) == 1
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "success"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_point", ["next_update", "lighting"])
async def test_async_post_open_failure_reports_runtime_changed(monkeypatch, failure_point):
    authority = FakeAuthority()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    scheduled = []
    payload = stage_payload()
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        payload["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    context = manager._reserve_stage_attempt(attempt)
    stage = types.SimpleNamespace(GetRootLayer=lambda: types.SimpleNamespace(identifier=""))

    async def open_stage_async(url, load_set):
        return True, ""

    async def next_update_async():
        if failure_point == "next_update":
            raise RuntimeError("post-open update failed")

    def ensure_default_lighting(stage):
        if failure_point == "lighting":
            raise RuntimeError("post-open lighting failed")

    usd_context = types.SimpleNamespace(
        get_stage=lambda: stage,
        open_stage_async=open_stage_async,
    )
    monkeypatch.setattr(stage_loading.omni.usd, "get_context", lambda: usd_context)
    monkeypatch.setattr(
        stage_loading.omni.kit.app,
        "get_app",
        lambda: types.SimpleNamespace(next_update_async=next_update_async),
    )
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: value)
    monkeypatch.setattr(stage_loading, "_ensure_default_lighting", ensure_default_lighting)
    monkeypatch.setattr(
        stage_loading.asyncio,
        "ensure_future",
        lambda coroutine: scheduled.append(coroutine),
    )

    manager._open_authorized_stage(attempt, context)
    await scheduled[0]

    assert len(authority.confirm_calls) == 1
    assert authority.confirm_calls[0][1] == "failed"
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "error"
    assert dispatched[0][1]["runtime_state"] == "changed_failed"


@pytest.mark.asyncio
async def test_load_status_success_confirms_once_and_ignores_stale_callback(monkeypatch):
    authority = FakeAuthority()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    payload = stage_payload()
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        payload["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    manager._reserve_stage_attempt(attempt)
    manager._active_stage_runtime_url = payload["url"]
    manager._persisted_stage = True
    manager._stage_has_opened = True
    stage = types.SimpleNamespace(
        GetRootLayer=lambda: types.SimpleNamespace(identifier=payload["url"])
    )
    monkeypatch.setattr(
        stage_loading.omni.usd,
        "get_context",
        lambda: types.SimpleNamespace(get_stage=lambda: stage),
    )
    monkeypatch.setattr(stage_loading, "_ensure_default_lighting", lambda stage: None)

    await manager._evaluate_load_status(attempt)
    await manager._evaluate_load_status(attempt)

    assert len(authority.confirm_calls) == 1
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "success"


@pytest.mark.asyncio
async def test_stale_assets_loaded_event_cannot_confirm_new_attempt(monkeypatch):
    authority = FakeAuthority()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    scheduled = []
    payload = stage_payload()
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        payload["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    manager._reserve_stage_attempt(attempt)
    manager._active_stage_runtime_url = payload["url"]
    manager._persisted_stage = True
    manager._stage_is_opening = True
    current_identifier = {"value": "http://127.0.0.1:49101/objects/stale.usdc"}
    stage = types.SimpleNamespace(
        GetRootLayer=lambda: types.SimpleNamespace(identifier=current_identifier["value"])
    )
    monkeypatch.setattr(
        stage_loading.omni.usd,
        "get_context",
        lambda: types.SimpleNamespace(get_stage=lambda: stage),
    )
    monkeypatch.setattr(stage_loading, "_ensure_default_lighting", lambda stage: None)
    monkeypatch.setattr(
        stage_loading.asyncio,
        "ensure_future",
        lambda coroutine: scheduled.append(coroutine),
    )

    manager._on_stage_event_assets_loaded(types.SimpleNamespace())
    assert scheduled == []
    assert authority.confirm_calls == []
    assert manager._stage_is_opening is True

    current_identifier["value"] = payload["url"]
    manager._on_stage_event_assets_loaded(types.SimpleNamespace())
    await scheduled[0]

    assert len(authority.confirm_calls) == 1
    assert [name for name, _ in dispatched] == ["openedStageResult"]


def test_synchronous_stage_preparation_exception_confirms_failure_and_cleans_up(monkeypatch):
    authority = FakeAuthority()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    payload = stage_payload()
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        payload["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    context = manager._reserve_stage_attempt(attempt)
    calls = {"count": 0}

    def get_context():
        calls["count"] += 1
        if calls["count"] == 1:
            return types.SimpleNamespace(
                get_stage=lambda: (_ for _ in ()).throw(RuntimeError("host path secret"))
            )
        return types.SimpleNamespace(get_stage=lambda: None)

    monkeypatch.setattr(stage_loading.omni.usd, "get_context", get_context)
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: value)

    manager._open_authorized_stage(attempt, context)

    assert len(authority.confirm_calls) == 1
    assert authority.confirm_calls[0][1] == "failed"
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["error"] == "Stage open failed."
    assert "host path secret" not in repr(dispatched)
    assert manager._active_stage_attempt is None


def test_preparation_failure_with_unconfirmed_completion_is_unchanged_rejection(monkeypatch):
    authority = FakeAuthority(
        confirm=AuthorityDecision(
            False,
            reason="lease_invalid",
            request_id="request_stage_001",
            retryable=True,
            detail_code="authority_unavailable",
        )
    )
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    payload = stage_payload()
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        payload["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    context = manager._reserve_stage_attempt(attempt)
    monkeypatch.setattr(
        stage_loading.omni.usd,
        "get_context",
        lambda: types.SimpleNamespace(
            get_stage=lambda: (_ for _ in ()).throw(RuntimeError("host path secret"))
        ),
    )
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: value)

    manager._open_authorized_stage(attempt, context)

    assert len(authority.confirm_calls) == 1
    assert authority.confirm_calls[0][1] == "failed"
    assert [name for name, _ in dispatched] == ["commandRejected"]
    assert dispatched[0][1]["runtime_state"] == "unchanged"
    assert dispatched[0][1]["retryable"] is True
    assert dispatched[0][1]["detail_code"] == "authority_unavailable"
    assert "host path secret" not in repr(dispatched)
    assert manager._active_stage_attempt is None


@pytest.mark.asyncio
async def test_async_runtime_failure_confirms_failed_and_emits_one_safe_error(monkeypatch):
    authority = FakeAuthority()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    scheduled = []
    payload = stage_payload()
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        payload["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    context = manager._reserve_stage_attempt(attempt)
    stage = types.SimpleNamespace(GetRootLayer=lambda: types.SimpleNamespace(identifier=""))

    async def open_stage_async(url, load_set):
        return False, "C:/secret/runtime/path/model.usdc"

    usd_context = types.SimpleNamespace(
        get_stage=lambda: stage,
        open_stage_async=open_stage_async,
    )
    monkeypatch.setattr(stage_loading.omni.usd, "get_context", lambda: usd_context)
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: value)
    monkeypatch.setattr(
        stage_loading.asyncio,
        "ensure_future",
        lambda coroutine: scheduled.append(coroutine),
    )

    manager._open_authorized_stage(attempt, context)
    await scheduled[0]

    assert len(authority.confirm_calls) == 1
    assert authority.confirm_calls[0][1] == "failed"
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "error"
    assert dispatched[0][1]["error"] == "Stage open failed."
    assert "C:/secret/runtime/path" not in repr(dispatched)


def test_allowed_hosts_uses_env_var():
    original = os.environ.get(_ALLOWED_STAGE_HOSTS_ENV)
    try:
        os.environ[_ALLOWED_STAGE_HOSTS_ENV] = "192.168.1.1:49101"
        assert _http_stage_allowed_hosts() == {"192.168.1.1:49101"}
    finally:
        if original is None:
            os.environ.pop(_ALLOWED_STAGE_HOSTS_ENV, None)
        else:
            os.environ[_ALLOWED_STAGE_HOSTS_ENV] = original


def test_allowed_hosts_empty_env_falls_back():
    original = os.environ.get(_ALLOWED_STAGE_HOSTS_ENV)
    try:
        os.environ[_ALLOWED_STAGE_HOSTS_ENV] = ""
        hosts = _http_stage_allowed_hosts()
        assert "127.0.0.1:49101" in hosts
        assert not any(":8005" in host for host in hosts)
    finally:
        if original is None:
            os.environ.pop(_ALLOWED_STAGE_HOSTS_ENV, None)
        else:
            os.environ[_ALLOWED_STAGE_HOSTS_ENV] = original
