import asyncio
import json
import os
import sys
import types
from pathlib import Path

import pytest

_ALLOWED_STAGE_HOSTS_ENV = "BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS"


def install_stage_loading_stubs() -> dict:
    class DummyItem:
        def get_dict(self):
            return {}

    carb = types.ModuleType("carb")
    carb_dictionary = types.ModuleType("carb.dictionary")
    carb_dictionary.Item = DummyItem
    carb.dictionary = carb_dictionary
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

    return {
        "carb": carb,
        "carb.dictionary": carb_dictionary,
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


_MISSING = object()


def _install_kit_stubs(stubs):
    saved = {name: sys.modules.get(name, _MISSING) for name in stubs}
    sys.modules.update(stubs)
    return saved


def _restore_kit_stubs(saved):
    # Give the real modules (e.g. usd-core's pxr) back to every other test module;
    # the module under test keeps the stub references it bound at import time.
    for name, original in saved.items():
        if original is _MISSING:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = original


@pytest.fixture(autouse=True)
def _kit_stub_modules(monkeypatch):
    saved = _install_kit_stubs(_KIT_STUBS)
    # Real USD shadow opinions are tested separately; this suite isolates Kit composition.
    monkeypatch.setattr(stage_loading, "suppress_flow_shadows", lambda stage: 0)
    monkeypatch.setattr(stage_loading, "clear_flow_shadow_overrides", lambda stage: 0)
    try:
        yield
    finally:
        _restore_kit_stubs(saved)


_KIT_STUBS = install_stage_loading_stubs()
_saved_kit_stubs = _install_kit_stubs(_KIT_STUBS)

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

try:
    import stage_loading  # noqa: E402
    from mutation_gate import MutationGate  # noqa: E402
    from runtime_authority import DataChannelTraceContext, RuntimeAuthorityClient  # noqa: E402
    from stage_loading import LoadingManager, _http_stage_allowed_hosts  # noqa: E402
finally:
    _restore_kit_stubs(_saved_kit_stubs)

from runtime_authority_service_fake import AUTHORIZE, UNREACHABLE, VERIFY, FakeAuthorityService  # noqa: E402


def authority_gate(service):
    """A real Mutation Gate over a real RuntimeAuthorityClient whose transport is the in-memory authority service."""
    return MutationGate(RuntimeAuthorityClient(
        base_url="http://127.0.0.1:8004",
        internal_token="internal-test-token",
        transport=service,
    ))


def make_manager(authority=None) -> LoadingManager:
    manager = LoadingManager.__new__(LoadingManager)
    manager._subscriptions = []
    manager._gate = authority_gate(authority or FakeAuthorityService())
    manager._trace_context = DataChannelTraceContext()
    manager._active_stage_attempt = None
    manager._active_terminal_started = False
    manager._active_stage_runtime_url = ""
    manager._managed_secondary_layer_ids = set()
    manager._managed_secondary_layer_owner = None
    manager._framed_cfd_layer_ids = frozenset()
    manager._cfd_framing_task = None
    manager._pending_tasks = set()
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


@pytest.mark.asyncio
async def test_background_tasks_are_retained_until_completion():
    manager = make_manager()
    release = asyncio.Event()

    async def pending_work():
        await release.wait()

    task = manager._schedule_background_task(pending_work())
    assert task in manager._pending_tasks

    release.set()
    await task
    await asyncio.sleep(0)
    assert task not in manager._pending_tasks


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


@pytest.mark.parametrize(
    "handler_name,event_type",
    [
        ("_on_open_stage", "openStageRequest"),
        ("_on_load_artifact_group", "loadArtifactGroupRequest"),
        ("_on_load_state_query", "loadingStateQuery"),
    ],
)
@pytest.mark.parametrize("trace_id", [None, "rev_review_session_other"])
def test_all_loading_inbound_handlers_drop_unverified_trace_before_read_or_mutation(
    monkeypatch,
    handler_name,
    event_type,
    trace_id,
):
    class ReadBomb:
        def __bool__(self):
            raise AssertionError("loading state read before trace verification")

    authority = FakeAuthorityService()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    manager._public_opened_stage_url = ReadBomb()
    monkeypatch.setattr(
        manager,
        "_resolve_stage_request",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("stage request resolved before trace verification")
        ),
    )
    payload = stage_payload()
    if trace_id is None:
        payload.pop("trace_id")
    else:
        payload["trace_id"] = trace_id

    getattr(manager, handler_name)(types.SimpleNamespace(payload=payload))

    # A missing trace is refused before the coordinator is asked; a foreign one is asked about once and refused.
    assert len(authority.bodies(VERIFY)) == (0 if trace_id is None else 1)
    assert authority.bodies(AUTHORIZE) == []
    assert authority.confirmed_outcomes == []
    assert dispatched == []


def test_loading_state_query_answers_an_unreachable_authority_with_its_own_event_type(monkeypatch):
    authority = FakeAuthorityService(verify=UNREACHABLE)
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)

    manager._on_load_state_query(types.SimpleNamespace(payload=stage_payload()))

    assert [name for name, _payload in dispatched] == ["commandRejected"]
    assert dispatched[0][1]["rejected_event_type"] == "loadingStateQuery"
    assert (dispatched[0][1]["detail_code"], dispatched[0][1]["retryable"]) == ("authority_unavailable", True)
    assert authority.bodies(AUTHORIZE) == []


def test_loading_state_and_progress_events_use_verified_or_active_stage_trace(monkeypatch):
    authority = FakeAuthorityService()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)

    manager._on_load_state_query(types.SimpleNamespace(payload={
        "session_id": "review_session_x",
        "trace_id": "rev_review_session_x",
    }))
    assert dispatched == [(
        "loadingStateResponse",
        {"loading_state": "idle", "url": "", "trace_id": "rev_review_session_x"},
    )]

    dispatched.clear()
    manager._persisted_stage = True
    manager._on_progress(types.SimpleNamespace(payload={"progress": 0.5}))
    manager._on_activity(types.SimpleNamespace(payload={"activity": "loading"}))
    assert dispatched == []

    assert manager._trace_context.bind_active_stage(
        "review_session_x",
        "rev_review_session_x",
    )
    manager._on_progress(types.SimpleNamespace(payload={"progress": 0.5}))
    manager._on_activity(types.SimpleNamespace(payload={"activity": "loading"}))
    assert [name for name, _payload in dispatched] == [
        "updateProgressAmount",
        "updateProgressActivity",
    ]
    assert all(
        payload["trace_id"] == "rev_review_session_x"
        for _name, payload in dispatched
    )


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
        "trace_id": "rev_review_session_x",
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
    authority = FakeAuthorityService()
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

    assert len(authority.bodies(AUTHORIZE)) == 1
    assert authority.authorized_events[0] == "loadArtifactGroupRequest"
    assert len(mutation_calls) == 1
    assert [name for name, _ in dispatched] == [
        "loadArtifactGroupResult",
        "openedStageResult",
    ]
    assert dispatched[0][1]["result"] == "accepted"
    assert dispatched[0][1]["request_id"] == "request_stage_001"
    assert dispatched[0][1]["trace_id"] == "rev_review_session_x"
    assert dispatched[1][1]["result"] == "success"
    assert dispatched[1][1]["request_id"] == "request_stage_001"
    assert dispatched[1][1]["trace_id"] == "rev_review_session_x"
    assert len(authority.confirmed_outcomes) == 1
    assert authority.confirmed_outcomes[0] == "success"
    assert "lease_secret_must_not_echo" not in repr(dispatched)


@pytest.mark.parametrize("handler_name", ["_on_load_artifact_group", "_on_open_stage"])
def test_stage_authority_denial_emits_only_command_rejected(
    monkeypatch,
    handler_name,
):
    authority = FakeAuthorityService(
        authorize={"reason": "spectator_readonly", "retryable": False, "detail_code": "primary_lease_required"},
    )
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    monkeypatch.setattr(
        manager,
        "_open_authorized_stage",
        lambda *args: pytest.fail("denied request reached the stage primitive"),
    )

    getattr(manager, handler_name)(types.SimpleNamespace(payload=stage_payload()))

    assert len(authority.bodies(AUTHORIZE)) == 1
    assert len(authority.confirmed_outcomes) == 0
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
            "trace_id": "rev_review_session_x",
            "detail_code": "primary_lease_required",
    }


@pytest.mark.parametrize("handler_name", ["_on_load_artifact_group", "_on_open_stage"])
def test_unloadable_authorized_stage_with_unconfirmed_failure_is_rejected(
    monkeypatch,
    handler_name,
):
    authority = FakeAuthorityService(confirm=UNREACHABLE)
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    payload = stage_payload()
    payload["url"] = ""
    payload["stage_composition"]["primary"]["url"] = ""

    getattr(manager, handler_name)(types.SimpleNamespace(payload=payload))

    assert len(authority.bodies(AUTHORIZE)) == 1
    assert len(authority.confirmed_outcomes) == 1
    assert authority.confirmed_outcomes[0] == "failed"
    assert [name for name, _ in dispatched] == ["commandRejected"]
    assert dispatched[0][1]["runtime_state"] == "unchanged"
    assert dispatched[0][1]["retryable"] is True
    assert dispatched[0][1]["detail_code"] == "authority_unavailable"


def test_artifact_group_uses_private_immutable_attempt_snapshot(monkeypatch):
    authority = FakeAuthorityService()
    manager = make_manager(authority)
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
    assert len(authority.bodies(AUTHORIZE)) == 1
    assert attempt.binding_revision_id == "rev_binding_001"
    assert attempt.stage_context()["applied_primary"]["url"].endswith("primary.usdc")
    assert active_context["applied_primary"]["url"].endswith("primary.usdc")
    assert dispatched[0][0] == "loadArtifactGroupResult"
    assert dispatched[0][1]["result"] == "accepted"


def test_interleaved_stage_request_is_rejected_without_second_authority_call(monkeypatch):
    authority = FakeAuthorityService()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    monkeypatch.setattr(manager, "_open_authorized_stage", lambda *args: None)

    manager._on_load_artifact_group(types.SimpleNamespace(payload=stage_payload()))
    manager._on_open_stage(
        types.SimpleNamespace(payload=stage_payload(request_id="request_stage_002"))
    )

    assert len(authority.bodies(AUTHORIZE)) == 1
    assert [name for name, _ in dispatched] == [
        "loadArtifactGroupResult",
        "commandRejected",
    ]
    assert dispatched[1][1]["request_id"] == "request_stage_002"
    assert dispatched[1][1]["runtime_state"] == "unchanged"


def test_confirmation_failure_is_single_changed_unconfirmed_terminal(monkeypatch):
    authority = FakeAuthorityService(confirm=UNREACHABLE)
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

    assert len(authority.bodies(AUTHORIZE)) == 1
    assert len(authority.confirmed_outcomes) == 1
    assert len(dispatched) == 1
    assert dispatched[0][0] == "commandRejected"
    assert dispatched[0][1]["runtime_state"] == "changed_unconfirmed"
    assert dispatched[0][1]["retryable"] is True
    assert manager._active_stage_attempt is None


def test_partial_secondary_composition_confirms_failed_and_never_reports_active(monkeypatch):
    authority = FakeAuthorityService()
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

    assert len(authority.confirmed_outcomes) == 1
    assert authority.confirmed_outcomes[0] == "failed"
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "error"
    assert dispatched[0][1]["partial_load"] is True
    assert dispatched[0][1]["failed_bindings"] == [{"artifact_id": "artifact_secondary"}]
    assert manager._active_stage_attempt is None


def test_partial_secondary_failure_with_unconfirmed_completion_is_changed_unconfirmed(monkeypatch):
    authority = FakeAuthorityService(confirm=UNREACHABLE)
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

    assert len(authority.confirmed_outcomes) == 1
    assert authority.confirmed_outcomes[0] == "failed"
    assert [name for name, _ in dispatched] == ["commandRejected"]
    assert dispatched[0][1]["runtime_state"] == "changed_unconfirmed"
    assert dispatched[0][1]["detail_code"] == "authority_unavailable"
    assert manager._active_stage_attempt is None


def test_exact_composition_replaces_only_manager_owned_secondary_layers(monkeypatch):
    manager = make_manager()
    session_layer = types.SimpleNamespace(subLayerPaths=["unrelated-session-layer.usda"])
    stage = types.SimpleNamespace(GetSessionLayer=lambda: session_layer)
    cleared_on = []
    monkeypatch.setattr(stage_loading, "clear_overlay_style_overrides", lambda s: cleared_on.append(s) or 1)
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
    # S5a: every recomposition drops stale overlay-style opinions before the layers change.
    assert cleared_on == [stage]

    manager._compose_secondary_artifact_bindings(stage, second)
    assert cleared_on == [stage, stage]

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
    authority = FakeAuthorityService()
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

    assert len(authority.confirmed_outcomes) == 1
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "success"
    assert dispatched[0][1]["trace_id"] == "rev_review_session_x"
    assert manager._trace_context.active_stage() == (
        "review_session_x",
        "rev_review_session_x",
    )


@pytest.mark.asyncio
async def test_async_open_stage_confirms_before_success(monkeypatch):
    authority = FakeAuthorityService()
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

    assert len(authority.confirmed_outcomes) == 1
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "success"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_point", ["next_update", "lighting"])
async def test_async_post_open_failure_reports_runtime_changed(monkeypatch, failure_point):
    authority = FakeAuthorityService()
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

    assert len(authority.confirmed_outcomes) == 1
    assert authority.confirmed_outcomes[0] == "failed"
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "error"
    assert dispatched[0][1]["runtime_state"] == "changed_failed"


@pytest.mark.asyncio
async def test_load_status_success_confirms_once_and_ignores_stale_callback(monkeypatch):
    authority = FakeAuthorityService()
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

    assert len(authority.confirmed_outcomes) == 1
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "success"


@pytest.mark.asyncio
async def test_stale_assets_loaded_event_cannot_confirm_new_attempt(monkeypatch):
    authority = FakeAuthorityService()
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
    assert authority.confirmed_outcomes == []
    assert manager._stage_is_opening is True

    current_identifier["value"] = payload["url"]
    manager._on_stage_event_assets_loaded(types.SimpleNamespace())
    await scheduled[0]

    assert len(authority.confirmed_outcomes) == 1
    assert [name for name, _ in dispatched] == ["openedStageResult"]


def loading_state_answer(manager, dispatched):
    dispatched.clear()
    manager._on_load_state_query(types.SimpleNamespace(payload={
        "session_id": "review_session_x",
        "trace_id": "rev_review_session_x",
    }))
    assert [name for name, _ in dispatched] == ["loadingStateResponse"]
    answer = dispatched[0][1]
    dispatched.clear()
    return answer["loading_state"], answer["url"]


# Kit opens a stage of its own at startup (`content.emptyStageOnStart`, or `--/app/auto_load_usd`).
# The event order is the one a real Kit emits: OPENING -> OPENED -> ASSETS_LOADED.
@pytest.mark.parametrize("runtime_url", ["", "C:/kit-host/private/auto-load.usd"])
def test_stage_opened_outside_an_authorized_attempt_reports_idle_once_loaded(monkeypatch, runtime_url):
    manager = make_manager()
    dispatched = capture_dispatch(monkeypatch)

    manager._on_stage_event_opening(types.SimpleNamespace(payload={"val": runtime_url}))
    assert loading_state_answer(manager, dispatched) == ("busy", "")

    manager._on_stage_event_assets_loaded(types.SimpleNamespace())

    # No authorized stage is open, so there is no public URL to report; the runtime path stays private.
    assert loading_state_answer(manager, dispatched) == ("idle", "")


def test_stage_open_that_fails_outside_an_authorized_attempt_reports_idle(monkeypatch):
    manager = make_manager()
    dispatched = capture_dispatch(monkeypatch)

    # A real Kit emits OPENING -> OPEN_FAILED and no ASSETS_LOADED for a stage that cannot be opened.
    manager._on_stage_event_opening(types.SimpleNamespace(payload={"val": "C:/kit-host/private/missing.usd"}))
    manager._on_stage_event_open_failed(types.SimpleNamespace(payload={"val": ""}))

    assert loading_state_answer(manager, dispatched) == ("idle", "")


def test_loading_manager_observes_every_stage_event_that_ends_a_stage_open(monkeypatch):
    observed = {}
    monkeypatch.setattr(stage_loading, "register_client_send", lambda _event_type: object())
    monkeypatch.setattr(
        stage_loading,
        "get_eventdispatcher",
        lambda: types.SimpleNamespace(
            observe_event=lambda **kwargs: observed.setdefault(kwargs["event_name"], kwargs["on_event"])
        ),
    )
    monkeypatch.setattr(
        stage_loading.omni.usd,
        "StageEventType",
        types.SimpleNamespace(OPENING="opening", ASSETS_LOADED="assets_loaded", OPEN_FAILED="open_failed"),
    )

    manager = LoadingManager(authority_gate(FakeAuthorityService()), DataChannelTraceContext())

    assert observed["stage_event_opening"] == manager._on_stage_event_opening
    assert observed["stage_event_assets_loaded"] == manager._on_stage_event_assets_loaded
    assert observed["stage_event_open_failed"] == manager._on_stage_event_open_failed


@pytest.mark.asyncio
async def test_authorized_open_reports_busy_with_its_url_then_idle_with_the_confirmed_url(monkeypatch):
    authority = FakeAuthorityService()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    scheduled = []
    manager._public_opened_stage_url = "http://127.0.0.1:49101/objects/previous.usdc"
    payload = stage_payload()
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        payload["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    context = manager._reserve_stage_attempt(attempt)
    stage = types.SimpleNamespace(GetRootLayer=lambda: types.SimpleNamespace(identifier="C:/kit-host/cache/previous.usdc"))
    # The attempt is accepted: Kit is busy with it before omni.usd announces the stage.
    in_flight = [loading_state_answer(manager, dispatched)]

    async def open_stage_async(url, load_set):
        manager._on_stage_event_opening(types.SimpleNamespace(payload={"val": url}))
        in_flight.append(loading_state_answer(manager, dispatched))
        return True, ""

    usd_context = types.SimpleNamespace(get_stage=lambda: stage, open_stage_async=open_stage_async)
    monkeypatch.setattr(stage_loading.omni.usd, "get_context", lambda: usd_context)
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: "C:/kit-host/cache/next.usdc")
    monkeypatch.setattr(manager, "_compose_secondary_artifact_bindings", lambda *args: None)
    monkeypatch.setattr(stage_loading, "_ensure_default_lighting", lambda stage: None)
    monkeypatch.setattr(stage_loading.asyncio, "ensure_future", lambda coroutine: scheduled.append(coroutine))

    manager._open_authorized_stage(attempt, context)
    await scheduled[0]

    assert in_flight == [("busy", payload["url"]), ("busy", payload["url"])]
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "success"
    assert loading_state_answer(manager, dispatched) == ("idle", payload["url"])


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["open_failed", "composition_failed"])
async def test_failed_authorized_open_reports_idle_and_forgets_the_stage_it_replaced(monkeypatch, failure):
    authority = FakeAuthorityService()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    scheduled = []
    manager._public_opened_stage_url = "http://127.0.0.1:49101/objects/previous.usdc"
    payload = stage_payload()
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        payload["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    context = manager._reserve_stage_attempt(attempt)
    current: dict[str, str | None] = {"identifier": "C:/kit-host/cache/previous.usdc"}
    in_flight = []

    def get_stage():
        if current["identifier"] is None:
            return None
        return types.SimpleNamespace(GetRootLayer=lambda: types.SimpleNamespace(identifier=current["identifier"]))

    async def open_stage_async(url, load_set):
        # omni.usd closes the previous stage before it announces the new one.
        manager._on_stage_event_opening(types.SimpleNamespace(payload={"val": url}))
        if failure == "open_failed":
            current["identifier"] = None
            manager._on_stage_event_open_failed(types.SimpleNamespace(payload={"val": ""}))
            # The open has failed but the attempt has not reported its terminal yet.
            in_flight.append(loading_state_answer(manager, dispatched))
            return False, "Failed to open"
        current["identifier"] = url
        return True, ""

    def compose_secondary_artifact_bindings(*_args):
        raise RuntimeError("secondary layer failed")

    usd_context = types.SimpleNamespace(get_stage=get_stage, open_stage_async=open_stage_async)
    monkeypatch.setattr(stage_loading.omni.usd, "get_context", lambda: usd_context)
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: "C:/kit-host/cache/next.usdc")
    monkeypatch.setattr(manager, "_compose_secondary_artifact_bindings", compose_secondary_artifact_bindings)
    monkeypatch.setattr(stage_loading, "_ensure_default_lighting", lambda stage: None)
    monkeypatch.setattr(stage_loading.asyncio, "ensure_future", lambda coroutine: scheduled.append(coroutine))

    manager._open_authorized_stage(attempt, context)
    await scheduled[0]

    assert in_flight == ([("busy", payload["url"])] if failure == "open_failed" else [])
    assert authority.confirmed_outcomes == ["failed"]
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "error"
    # The previously confirmed stage is no longer the open stage, and the one that replaced it was never confirmed.
    assert loading_state_answer(manager, dispatched) == ("idle", "")
    assert manager._active_stage_attempt is None


@pytest.mark.asyncio
async def test_attempt_that_ends_without_a_stage_open_of_its_own_does_not_leave_kit_busy(monkeypatch):
    authority = FakeAuthorityService()
    manager = make_manager(authority)
    dispatched = capture_dispatch(monkeypatch)
    scheduled = []
    startup_stage = types.SimpleNamespace(GetRootLayer=lambda: types.SimpleNamespace(identifier="anon:startup.usd"))

    async def open_stage_async(url, load_set):
        # omni.usd refuses the open without announcing a stage of its own.
        return False, "Stage opening or closing already in progress"

    usd_context = types.SimpleNamespace(get_stage=lambda: startup_stage, open_stage_async=open_stage_async)
    monkeypatch.setattr(stage_loading.omni.usd, "get_context", lambda: usd_context)
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: "C:/kit-host/cache/next.usdc")
    monkeypatch.setattr(stage_loading.asyncio, "ensure_future", lambda coroutine: scheduled.append(coroutine))

    # Kit's startup stage is still opening when the first request arrives.
    manager._on_stage_event_opening(types.SimpleNamespace(payload={"val": ""}))
    payload = stage_payload()
    attempt = manager._create_stage_attempt(
        "openStageRequest",
        payload,
        payload["url"],
        {"binding_revision_id": "rev_binding_001"},
    )
    context = manager._reserve_stage_attempt(attempt)
    manager._open_authorized_stage(attempt, context)
    # The startup stage finishes while the attempt is active: not the attempt's stage, so nothing is confirmed.
    manager._on_stage_event_assets_loaded(types.SimpleNamespace())
    assert authority.confirmed_outcomes == []
    await scheduled[0]

    assert authority.confirmed_outcomes == ["failed"]
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["result"] == "error"
    assert loading_state_answer(manager, dispatched) == ("idle", "")


def test_synchronous_stage_preparation_exception_confirms_failure_and_cleans_up(monkeypatch):
    authority = FakeAuthorityService()
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

    assert len(authority.confirmed_outcomes) == 1
    assert authority.confirmed_outcomes[0] == "failed"
    assert [name for name, _ in dispatched] == ["openedStageResult"]
    assert dispatched[0][1]["error"] == "Stage open failed."
    assert "host path secret" not in repr(dispatched)
    assert manager._active_stage_attempt is None


def test_preparation_failure_with_unconfirmed_completion_is_unchanged_rejection(monkeypatch):
    authority = FakeAuthorityService(confirm=UNREACHABLE)
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

    assert len(authority.confirmed_outcomes) == 1
    assert authority.confirmed_outcomes[0] == "failed"
    assert [name for name, _ in dispatched] == ["commandRejected"]
    assert dispatched[0][1]["runtime_state"] == "unchanged"
    assert dispatched[0][1]["retryable"] is True
    assert dispatched[0][1]["detail_code"] == "authority_unavailable"
    assert "host path secret" not in repr(dispatched)
    assert manager._active_stage_attempt is None


@pytest.mark.asyncio
async def test_async_runtime_failure_confirms_failed_and_emits_one_safe_error(monkeypatch):
    authority = FakeAuthorityService()
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

    assert len(authority.confirmed_outcomes) == 1
    assert authority.confirmed_outcomes[0] == "failed"
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


# --------------------------------------------------------------------------- S3.1 CFD animation playback


class _FakeTimeline:
    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        def record(*args):
            self.calls.append((name, args))
        return record


def _install_fake_timeline(monkeypatch):
    timeline = _FakeTimeline()
    module = types.ModuleType("omni.timeline")
    module.get_timeline_interface = lambda: timeline
    monkeypatch.setitem(sys.modules, "omni.timeline", module)
    return timeline


def test_cfd_overlay_layer_starts_looping_timeline(monkeypatch):
    manager = make_manager()
    timeline = _install_fake_timeline(monkeypatch)
    layer = types.SimpleNamespace(customLayerData={"cfd:animation": {"fps": 24, "frames": 240, "loop": True}})
    monkeypatch.setattr(stage_loading.Sdf, "Layer", types.SimpleNamespace(Find=lambda identifier: layer if identifier == "cfd_w000.usdc" else None), raising=False)
    # Framing is scheduled by the composition (after viewport frames), never inline with playback.
    monkeypatch.setattr(manager, "_frame_building_not_overlay", lambda *args: pytest.fail("framed inline"))

    result = manager._sync_cfd_animation_playback(("model-sidecar.usda", "cfd_w000.usdc"))

    assert result == {"fps": 24, "frames": 240, "loop": True, "layer": "cfd_w000.usdc", "playback": "playing"}
    names = [name for name, _ in timeline.calls]
    assert names == ["set_time_codes_per_second", "set_start_time", "set_end_time", "set_looping", "set_current_time", "play"]
    assert dict(timeline.calls)["set_end_time"] == (239 / 24,)
    assert dict(timeline.calls)["set_looping"] == (True,)
    assert manager._cfd_animation_active is True

    # Overlay removed on the next composition → playback stops once, then stays idle.
    timeline.calls.clear()
    assert manager._sync_cfd_animation_playback(()) is None
    assert [name for name, _ in timeline.calls] == ["stop"]
    assert manager._cfd_animation_active is False
    timeline.calls.clear()
    assert manager._sync_cfd_animation_playback(("model-sidecar.usda",)) is None
    assert timeline.calls == []


def test_non_cfd_secondary_layers_never_touch_the_timeline(monkeypatch):
    manager = make_manager()
    timeline = _install_fake_timeline(monkeypatch)
    monkeypatch.setattr(stage_loading.Sdf, "Layer", types.SimpleNamespace(Find=lambda identifier: types.SimpleNamespace(customLayerData={})), raising=False)
    assert manager._sync_cfd_animation_playback(("levels.usdc",)) is None
    assert timeline.calls == []


def test_timeline_unavailable_is_reported_not_raised(monkeypatch):
    manager = make_manager()
    layer = types.SimpleNamespace(customLayerData={"cfd:animation": {"fps": 24, "frames": 48}})
    monkeypatch.setattr(stage_loading.Sdf, "Layer", types.SimpleNamespace(Find=lambda identifier: layer), raising=False)
    monkeypatch.setitem(sys.modules, "omni.timeline", None)  # import raises ImportError
    result = manager._sync_cfd_animation_playback(("cfd_w000.usdc",))
    assert result["playback"] == "unavailable"
    assert result["frames"] == 48


def test_compose_secondary_bindings_records_cfd_animation_in_stage_context(monkeypatch):
    manager = make_manager()
    timeline = _install_fake_timeline(monkeypatch)
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    stage = types.SimpleNamespace(GetSessionLayer=lambda: session_layer)
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: value)
    cfd_layer = types.SimpleNamespace(identifier="cfd_w000.usdc", customLayerData={"cfd:animation": {"fps": 24, "frames": 240}})
    monkeypatch.setattr(
        stage_loading.Sdf, "Layer",
        types.SimpleNamespace(FindOrOpen=lambda identifier: cfd_layer, Find=lambda identifier: cfd_layer if identifier == "cfd_w000.usdc" else None),
        raising=False,
    )
    scheduled = _capture_scheduled(monkeypatch, manager)
    context = {
        "loaded_bindings": [{"artifact_id": "primary"}],
        "secondary_bindings": [{"artifact_id": "cfd:run:w000", "url": "cfd_w000.usdc", "load_order": 1}],
        "applied_secondary_layers": [],
        "skipped_secondary_layers": [],
    }
    manager._compose_secondary_artifact_bindings(stage, context)
    assert context["cfd_animation"]["playback"] == "playing"
    assert [name for name, _ in timeline.calls][-1] == "play"
    assert [item["artifact_id"] for item in context["applied_secondary_layers"]] == ["cfd:run:w000"]
    # Truthful bookkeeping: the reply leaves before the building is framed.
    assert context["cfd_animation"]["framed"] is False
    assert context["cfd_animation"]["framing"] == "scheduled"
    assert context["cfd_framing"] is context["cfd_animation"]
    assert len(scheduled) == 1
    scheduled[0].coro.close()


# --------------------------------------------------------------------------- CFD overlay building framing


_SHELL_PATH = "/World/Overlays/Cfd/run_w000/BuildingSurfacePressure"


class _FakeSdfLayer:
    def __init__(self, identifier, *, animation=None, cfd_root=True):
        self.identifier = identifier
        self.customLayerData = {"cfd:animation": animation} if animation else {}
        self._cfd_root = cfd_root

    def GetPrimAtPath(self, path):
        return object() if self._cfd_root and str(path) == "/World/Overlays/Cfd" else None


def _install_fake_layers(monkeypatch, *layers):
    by_id = {layer.identifier: layer for layer in layers}
    monkeypatch.setattr(
        stage_loading.Sdf,
        "Layer",
        types.SimpleNamespace(FindOrOpen=lambda identifier: by_id[identifier], Find=lambda identifier: by_id.get(identifier)),
        raising=False,
    )


class _FakeTask:
    def __init__(self, coro):
        self.coro = coro
        self.cancelled = False

    def done(self):
        return self.cancelled

    def cancel(self):
        self.cancelled = True
        self.coro.close()


def _capture_scheduled(monkeypatch, manager):
    scheduled = []

    def schedule(coroutine):
        task = _FakeTask(coroutine)
        scheduled.append(task)
        return task

    monkeypatch.setattr(manager, "_schedule_background_task", schedule)
    return scheduled


class _FakePrim:
    def __init__(self, path, children=()):
        self._path = path
        self._children = list(children)

    def GetPath(self):
        return self._path

    def GetName(self):
        return self._path.rsplit("/", 1)[-1]

    def IsValid(self):
        return True

    def GetChildren(self):
        return self._children

    def __bool__(self):
        return True


class _InvalidPrim:
    def IsValid(self):
        return False


class _FakeStage:
    def __init__(self, session_layer, prims=(), default_prim=None):
        self._session_layer = session_layer
        self._prims = {}
        pending = list(prims)
        while pending:
            prim = pending.pop()
            self._prims[prim.GetPath()] = prim
            pending.extend(prim.GetChildren())
        self._default_prim = default_prim

    def GetSessionLayer(self):
        return self._session_layer

    def Traverse(self):
        raise AssertionError("the frame target search must not traverse the whole stage")

    def GetPrimAtPath(self, path):
        return self._prims.get(path, _InvalidPrim())

    def GetDefaultPrim(self):
        return self._default_prim


def _cfd_context(*urls):
    return {
        "loaded_bindings": [{"artifact_id": "primary"}],
        "secondary_bindings": [
            {"artifact_id": f"cfd:run:{index}", "url": url, "load_order": index + 1}
            for index, url in enumerate(urls)
        ],
        "applied_secondary_layers": [],
        "skipped_secondary_layers": [],
    }


def _cfd_manager(monkeypatch, *layers):
    manager = make_manager()
    monkeypatch.setattr(manager, "_process_stage_url", lambda value: value)
    monkeypatch.setattr(stage_loading, "clear_overlay_style_overrides", lambda stage: 0)
    _install_fake_layers(monkeypatch, *layers)
    return manager, _capture_scheduled(monkeypatch, manager)


def _cfd_tree():
    """/World/Overlays/Cfd with one run and its building shell, as cfd_pipeline.usd_results writes it."""
    return _FakePrim("/World/Overlays/Cfd", children=[
        _FakePrim("/World/Overlays/Cfd/run_w000", children=[
            _FakePrim("/World/Overlays/Cfd/run_w000/PedestrianWind_1p5m"),
            _FakePrim(_SHELL_PATH),
        ]),
    ])


def _fake_prim_range(root):
    """Pre-order walk of one prim subtree, like Usd.PrimRange(root)."""
    pending = [root]
    while pending:
        prim = pending.pop(0)
        yield prim
        pending[0:0] = list(prim.GetChildren())


@pytest.fixture(autouse=True)
def _usd_prim_range(monkeypatch):
    monkeypatch.setattr(stage_loading.Usd, "PrimRange", _fake_prim_range, raising=False)


def _capture_info_logs(monkeypatch):
    lines = []
    monkeypatch.setattr(stage_loading.carb, "log_info", lambda message, *args, **kwargs: lines.append(message))
    return lines


def _install_fake_viewport(monkeypatch, stage, *, viewport_available=True, frame_wait_error=None, frame_result=True):
    """omni.kit.viewport.utility + Usd.EditContext fakes that record the edit target at framing time."""
    events = []
    current = {"target": None}
    viewport = types.SimpleNamespace(stage=stage)

    async def next_viewport_frame_async(vp, n_frames=1):
        assert vp is viewport
        events.append(("frames", n_frames))
        if frame_wait_error is not None:
            raise frame_wait_error

    def frame_viewport_prims(vp=None, prims=None):
        assert vp is viewport
        events.append(("frame", tuple(prims), current["target"]))
        return frame_result

    class EditContext:
        def __init__(self, edit_stage, target):
            assert edit_stage is stage
            self._target = target

        def __enter__(self):
            self._saved = current["target"]
            current["target"] = self._target
            return self

        def __exit__(self, *exc):
            current["target"] = self._saved
            return False

    utility = types.ModuleType("omni.kit.viewport.utility")
    utility.get_active_viewport = lambda: viewport if viewport_available else None
    utility.next_viewport_frame_async = next_viewport_frame_async
    utility.frame_viewport_prims = frame_viewport_prims
    monkeypatch.setitem(sys.modules, "omni.kit.viewport", types.ModuleType("omni.kit.viewport"))
    monkeypatch.setitem(sys.modules, "omni.kit.viewport.utility", utility)
    monkeypatch.setattr(stage_loading.Usd, "EditTarget", lambda layer: ("edit_target", layer), raising=False)
    monkeypatch.setattr(stage_loading.Usd, "EditContext", EditContext, raising=False)
    monkeypatch.setattr(stage_loading.omni.usd, "get_context", lambda: types.SimpleNamespace(get_stage=lambda: stage))
    return events


def test_cfd_overlay_without_animation_schedules_building_framing(monkeypatch):
    manager, scheduled = _cfd_manager(monkeypatch, _FakeSdfLayer("cfd_static.usdc"))
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    stage = types.SimpleNamespace(GetSessionLayer=lambda: session_layer)
    context = _cfd_context("cfd_static.usdc")

    manager._compose_secondary_artifact_bindings(stage, context)

    assert session_layer.subLayerPaths == ["cfd_static.usdc"]
    assert context["cfd_animation"] is None
    assert len(scheduled) == 1
    assert context["cfd_framing"] == {"framed": False, "framing": "scheduled"}
    scheduled[0].coro.close()


def test_non_cfd_secondary_layer_never_schedules_framing(monkeypatch):
    manager, scheduled = _cfd_manager(monkeypatch, _FakeSdfLayer("levels.usdc", cfd_root=False))
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    stage = types.SimpleNamespace(GetSessionLayer=lambda: session_layer)
    context = _cfd_context("levels.usdc")

    manager._compose_secondary_artifact_bindings(stage, context)

    assert session_layer.subLayerPaths == ["levels.usdc"]
    assert scheduled == []
    assert "cfd_framing" not in context


@pytest.mark.asyncio
async def test_scheduled_framing_waits_for_frames_and_frames_the_shell_on_the_session_layer(monkeypatch):
    manager, scheduled = _cfd_manager(monkeypatch, _FakeSdfLayer("cfd_static.usdc"))
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    stage = _FakeStage(session_layer, prims=[_FakePrim("/World/Elements"), _cfd_tree()])
    events = _install_fake_viewport(monkeypatch, stage)
    logs = _capture_info_logs(monkeypatch)
    context = _cfd_context("cfd_static.usdc")

    manager._compose_secondary_artifact_bindings(stage, context)
    # Nothing moves the camera inside the DataChannel handler.
    assert events == []

    await scheduled[0].coro

    assert events == [
        ("frames", 2),
        ("frame", (_SHELL_PATH,), ("edit_target", session_layer)),
    ]
    assert context["cfd_framing"] == {"framed": True, "framing": "framed"}
    assert [line for line in logs if "framing" in line or "framed" in line] == [
        "LoadingManager: framed the building after CFD overlay composition."
    ]


@pytest.mark.asyncio
async def test_scheduled_framing_is_skipped_when_the_stage_changed_meanwhile(monkeypatch):
    manager, scheduled = _cfd_manager(monkeypatch, _FakeSdfLayer("cfd_static.usdc"))
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    stage = _FakeStage(session_layer, prims=[_cfd_tree()])
    events = _install_fake_viewport(monkeypatch, stage)
    logs = _capture_info_logs(monkeypatch)
    context = _cfd_context("cfd_static.usdc")
    manager._compose_secondary_artifact_bindings(stage, context)

    other_stage = _FakeStage(types.SimpleNamespace(subLayerPaths=[]))
    monkeypatch.setattr(stage_loading.omni.usd, "get_context", lambda: types.SimpleNamespace(get_stage=lambda: other_stage))
    await scheduled[0].coro

    assert events == [("frames", 2)]
    assert context["cfd_framing"] == {"framed": False, "framing": "stale"}
    assert "LoadingManager: CFD overlay building framing skipped (stage, viewport or overlay set changed)." in logs
    # A stale framing belongs to a newer composition; it does not re-arm the overlay set.
    assert manager._framed_cfd_layer_ids == frozenset({"cfd_static.usdc"})


@pytest.mark.asyncio
async def test_scheduled_framing_is_skipped_when_the_overlay_was_removed_meanwhile(monkeypatch):
    manager, scheduled = _cfd_manager(monkeypatch, _FakeSdfLayer("cfd_static.usdc"))
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    stage = _FakeStage(session_layer, prims=[_cfd_tree()])
    events = _install_fake_viewport(monkeypatch, stage)
    context = _cfd_context("cfd_static.usdc")
    manager._compose_secondary_artifact_bindings(stage, context)
    coroutine = scheduled[0].coro
    # Keep the coroutine alive past the cancel so the in-task guard itself is exercised.
    scheduled[0].cancel = lambda: setattr(scheduled[0], "cancelled", True)

    manager._compose_secondary_artifact_bindings(stage, {"secondary_bindings": []})
    await coroutine

    assert scheduled[0].cancelled is True
    assert events == [("frames", 2)]
    assert context["cfd_framing"] == {"framed": False, "framing": "stale"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "outcome,viewport_kwargs,expected_framing,log_line",
    [
        ("no viewport", {"viewport_available": False}, "unavailable",
         "LoadingManager: CFD overlay building framing unavailable (no active viewport)."),
        ("frame wait timed out", {"frame_wait_error": asyncio.TimeoutError()}, "failed", None),
        ("nothing framed", {"frame_result": False}, "failed",
         "LoadingManager: CFD overlay building framing not applied (framed=False: no building target or the viewport did not frame)."),
        ("framed", {}, "framed", "LoadingManager: framed the building after CFD overlay composition."),
    ],
)
async def test_reapplying_the_same_overlay_frames_again_only_after_a_framing_that_could_not_run(
    monkeypatch, outcome, viewport_kwargs, expected_framing, log_line,
):
    manager, scheduled = _cfd_manager(monkeypatch, _FakeSdfLayer("cfd_w000.usdc"))
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    stage = _FakeStage(session_layer, prims=[_FakePrim("/World/Elements"), _cfd_tree()])
    _install_fake_viewport(monkeypatch, stage, **viewport_kwargs)
    logs = _capture_info_logs(monkeypatch)
    first = _cfd_context("cfd_w000.usdc")
    manager._compose_secondary_artifact_bindings(stage, first)

    await scheduled[0].coro

    assert first["cfd_framing"]["framing"] == expected_framing
    if log_line is not None:
        assert log_line in logs
    again = _cfd_context("cfd_w000.usdc")
    manager._compose_secondary_artifact_bindings(stage, again)
    if expected_framing == "framed":
        assert len(scheduled) == 1
        assert again["cfd_framing"] == {"framed": False, "framing": "unchanged"}
    else:
        assert len(scheduled) == 2
        assert again["cfd_framing"] == {"framed": False, "framing": "scheduled"}
        scheduled[1].coro.close()


def test_idempotent_reapply_does_not_reframe_but_a_changed_overlay_set_does(monkeypatch):
    manager, scheduled = _cfd_manager(
        monkeypatch,
        _FakeSdfLayer("cfd_w000.usdc"),
        _FakeSdfLayer("cfd_w090.usdc"),
    )
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    stage = types.SimpleNamespace(GetSessionLayer=lambda: session_layer)

    manager._compose_secondary_artifact_bindings(stage, _cfd_context("cfd_w000.usdc"))
    again = _cfd_context("cfd_w000.usdc")
    manager._compose_secondary_artifact_bindings(stage, again)

    assert len(scheduled) == 1
    assert scheduled[0].cancelled is False
    assert again["cfd_framing"] == {"framed": False, "framing": "unchanged"}

    manager._compose_secondary_artifact_bindings(stage, _cfd_context("cfd_w090.usdc"))

    assert len(scheduled) == 2
    assert scheduled[0].cancelled is True
    scheduled[1].coro.close()


def test_removing_the_overlay_never_frames_and_reshowing_it_frames_again(monkeypatch):
    manager, scheduled = _cfd_manager(monkeypatch, _FakeSdfLayer("cfd_w000.usdc"))
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    stage = types.SimpleNamespace(GetSessionLayer=lambda: session_layer)
    shadow_calls = []
    monkeypatch.setattr(stage_loading, "clear_overlay_style_overrides", lambda stage: 0)
    monkeypatch.setattr(stage_loading, "clear_overlay_visibility_overrides", lambda stage: 0)
    monkeypatch.setattr(stage_loading, "clear_flow_shadow_overrides", lambda stage: shadow_calls.append("clear") or 1)
    monkeypatch.setattr(stage_loading, "suppress_flow_shadows", lambda stage: shadow_calls.append("apply") or 5)

    manager._compose_secondary_artifact_bindings(stage, _cfd_context("cfd_w000.usdc"))
    removed = {"secondary_bindings": []}
    manager._compose_secondary_artifact_bindings(stage, removed)

    assert session_layer.subLayerPaths == []
    assert len(scheduled) == 1
    assert scheduled[0].cancelled is True
    assert "cfd_framing" not in removed

    manager._compose_secondary_artifact_bindings(stage, _cfd_context("cfd_w000.usdc"))

    assert len(scheduled) == 2
    assert shadow_calls == ["clear", "apply", "clear", "clear", "apply"]
    scheduled[1].coro.close()


def test_same_overlay_on_a_new_stage_frames_again(monkeypatch):
    manager, scheduled = _cfd_manager(monkeypatch, _FakeSdfLayer("cfd_w000.usdc"))
    first_layer = types.SimpleNamespace(subLayerPaths=[])
    first_stage = types.SimpleNamespace(GetSessionLayer=lambda: first_layer)
    next_layer = types.SimpleNamespace(subLayerPaths=[])
    next_stage = types.SimpleNamespace(GetSessionLayer=lambda: next_layer)

    manager._compose_secondary_artifact_bindings(first_stage, _cfd_context("cfd_w000.usdc"))
    manager._compose_secondary_artifact_bindings(next_stage, _cfd_context("cfd_w000.usdc"))

    assert len(scheduled) == 2
    assert scheduled[0].cancelled is True
    scheduled[1].coro.close()


def test_building_frame_targets_prefer_the_model_envelope_over_the_cfd_shell(monkeypatch):
    # The CFD shell holds every meshed solid (site and terrain included), so it can be as wide as the site.
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    bounded = {"/World/Elements/IfcWall", "/World/Elements/IfcRoof", "/World/Elements/IfcColumn"}
    monkeypatch.setattr(stage_loading, "_has_geometry_bounds", lambda prim: prim.GetPath() in bounded)
    elements = _FakePrim("/World/Elements", children=[
        _FakePrim("/World/Elements/IfcWall"), _FakePrim("/World/Elements/IfcCurtainWall"),
        _FakePrim("/World/Elements/IfcRoof"), _FakePrim("/World/Elements/IfcColumn"),
        _FakePrim("/World/Elements/IfcSite"),
    ])
    stage = _FakeStage(session_layer, prims=[elements, _cfd_tree()])
    assert stage_loading._building_frame_targets(stage) == ["/World/Elements/IfcWall", "/World/Elements/IfcRoof"]

    # No wall or roof geometry: columns stand in for the envelope.
    bounded.difference_update({"/World/Elements/IfcWall", "/World/Elements/IfcRoof"})
    assert stage_loading._building_frame_targets(stage) == ["/World/Elements/IfcColumn"]

    # No envelope group has geometry: the CFD shell is the fallback, still never the whole overlay.
    bounded.clear()
    assert stage_loading._building_frame_targets(stage) == [_SHELL_PATH]


def test_building_frame_targets_fall_back_to_the_cfd_shell_then_elements_then_default_prim_children():
    session_layer = types.SimpleNamespace(subLayerPaths=[])
    # Only the overlay subtree is searched (the fake stage refuses Traverse); a shell elsewhere is ignored.
    shell_stage = _FakeStage(
        session_layer,
        prims=[_FakePrim("/World/Elements"), _cfd_tree(), _FakePrim("/Other/BuildingSurfacePressure")],
    )
    assert stage_loading._building_frame_targets(shell_stage) == [_SHELL_PATH]

    elements_stage = _FakeStage(session_layer, prims=[_FakePrim("/World/Elements")])
    assert stage_loading._building_frame_targets(elements_stage) == ["/World/Elements"]

    shell_less_overlay = _FakeStage(session_layer, prims=[_FakePrim("/World/Elements"), _FakePrim("/World/Overlays/Cfd")])
    assert stage_loading._building_frame_targets(shell_less_overlay) == ["/World/Elements"]

    world = _FakePrim("/World", children=[_FakePrim("/World/Site"), _FakePrim("/World/Overlays")])
    default_stage = _FakeStage(session_layer, prims=[world], default_prim=world)
    assert stage_loading._building_frame_targets(default_stage) == ["/World/Site"]

    assert stage_loading._building_frame_targets(_FakeStage(session_layer)) == []
