import sys
import types
from pathlib import Path

import pytest


def install_stage_management_stubs() -> None:
    class DummyItem:
        def get_dict(self):
            return {}

    class DummyEditContext:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    carb = types.ModuleType("carb")
    carb_dictionary = types.ModuleType("carb.dictionary")
    carb_dictionary.Item = DummyItem
    carb.dictionary = carb_dictionary
    carb.log_info = lambda *_args, **_kwargs: None
    carb.log_warn = lambda *_args, **_kwargs: None
    carb_events = types.ModuleType("carb.events")
    carb_events.IEvent = object
    carb_events.type_from_string = lambda value: value
    carb.events = carb_events
    carb_eventdispatcher = types.ModuleType("carb.eventdispatcher")
    carb_eventdispatcher.get_eventdispatcher = lambda: types.SimpleNamespace(
        observe_event=lambda **_kwargs: object(),
        dispatch_event=lambda *_args, **_kwargs: None,
    )

    omni = types.ModuleType("omni")
    omni_usd = types.ModuleType("omni.usd")
    omni_usd.StageEventType = types.SimpleNamespace(ASSETS_LOADED=1, SELECTION_CHANGED=2)
    omni_usd.get_context = lambda: None
    omni.usd = omni_usd
    omni_kit = types.ModuleType("omni.kit")
    omni_kit_app = types.ModuleType("omni.kit.app")
    omni_kit_app.register_event_alias = lambda *_args, **_kwargs: None
    omni_kit.app = omni_kit_app
    omni_kit_livestream = types.ModuleType("omni.kit.livestream")
    omni_kit_livestream_messaging = types.ModuleType("omni.kit.livestream.messaging")
    omni_kit_livestream_messaging.register_event_type_to_send = lambda *_args, **_kwargs: None
    omni_kit_livestream.messaging = omni_kit_livestream_messaging
    omni_kit.livestream = omni_kit_livestream
    omni_kit_viewport = types.ModuleType("omni.kit.viewport")
    omni_kit_viewport_utility = types.ModuleType("omni.kit.viewport.utility")
    omni_kit_viewport_utility.get_active_viewport_camera_string = lambda: "/OmniverseKit_Persp"
    omni_kit_viewport.utility = omni_kit_viewport_utility
    omni.kit = omni_kit

    pxr = types.ModuleType("pxr")
    pxr.UsdGeom = types.ModuleType("pxr.UsdGeom")
    pxr.Usd = types.SimpleNamespace(
        EditContext=lambda *_args: DummyEditContext(),
        EditTarget=lambda value: value,
    )

    sys.modules.update({
        "carb": carb,
        "carb.dictionary": carb_dictionary,
        "carb.events": carb_events,
        "carb.eventdispatcher": carb_eventdispatcher,
        "omni": omni,
        "omni.usd": omni_usd,
        "omni.kit": omni_kit,
        "omni.kit.app": omni_kit_app,
        "omni.kit.livestream": omni_kit_livestream,
        "omni.kit.livestream.messaging": omni_kit_livestream_messaging,
        "omni.kit.viewport": omni_kit_viewport,
        "omni.kit.viewport.utility": omni_kit_viewport_utility,
        "pxr": pxr,
    })


install_stage_management_stubs()

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

import stage_management  # noqa: E402
from runtime_authority import AuthorityDecision, DataChannelTraceContext  # noqa: E402
from stage_management import StageManager  # noqa: E402


class FakeAuthority:
    def __init__(self, authorized):
        self.authorized = authorized
        self.calls = []
        self.verify_calls = []

    def verify_datachannel_trace(self, event_type, payload):
        self.verify_calls.append((event_type, payload))
        if (
            payload.get("session_id") == "review_session_x"
            and payload.get("trace_id") == "rev_review_session_x"
        ):
            return "rev_review_session_x"
        return None

    def authorize(self, event_type, payload):
        self.calls.append((event_type, payload))
        if self.authorized:
            return AuthorityDecision(
                True,
                request_id=payload.get("request_id"),
                trace_id="rev_review_session_x",
            )
        return AuthorityDecision(
            False,
            reason="lease_invalid",
            request_id=payload.get("request_id"),
            retryable=False,
            detail_code="lease_released",
            trace_id="rev_review_session_x",
        )


class DummyPrim:
    def IsValid(self):
        return True

    def GetPath(self):
        return "/World/Wall_001"

    def GetAttribute(self, _name):
        return types.SimpleNamespace(Set=lambda _value: None)


class DummyStage:
    def GetPrimAtPath(self, _path):
        return DummyPrim()

    def GetSessionLayer(self):
        return object()


class DummySelection:
    def __init__(self):
        self.clear_count = 0
        self.set_calls = []

    def clear_selected_prim_paths(self):
        self.clear_count += 1

    def set_selected_prim_paths(self, paths, expand):
        self.set_calls.append((list(paths), expand))

    def get_selected_prim_paths(self):
        return ["/World/Wall_001"]


class DummyUsdContext:
    def __init__(self):
        self.selection = DummySelection()
        self.stage = DummyStage()
        self.pickable_calls = []

    def get_selection(self):
        return self.selection

    def get_stage(self):
        return self.stage

    def set_pickable(self, path, value):
        self.pickable_calls.append((path, value))


def make_manager(authority):
    manager = StageManager.__new__(StageManager)
    manager._runtime_authority = authority
    manager._trace_context = DataChannelTraceContext()
    assert manager._trace_context.bind_active_stage(
        "review_session_x",
        "rev_review_session_x",
    )
    manager._is_external_update = False
    manager._camera_attrs = {}
    manager._subscriptions = []
    return manager


def event(payload):
    return types.SimpleNamespace(payload=payload)


def base_payload(request_id="req-1"):
    return {
        "request_id": request_id,
        "session_id": "review_session_x",
        "trace_id": "rev_review_session_x",
        "source_client_id": "viewer_lease_x",
        "viewer_lease_token": "viewer-secret-sentinel",
    }


def test_every_stage_mutator_denial_emits_only_command_rejected_before_mutation(monkeypatch):
    dispatched = []
    monkeypatch.setattr(
        stage_management,
        "get_eventdispatcher",
        lambda: types.SimpleNamespace(
            dispatch_event=lambda name, payload: dispatched.append((name, payload))
        ),
    )
    monkeypatch.setattr(
        stage_management.omni.usd,
        "get_context",
        lambda: (_ for _ in ()).throw(AssertionError("runtime state accessed before authority")),
    )
    authority = FakeAuthority(False)
    manager = make_manager(authority)
    cases = [
        (manager._on_select_prims, "selectPrimsRequest", {"paths": []}),
        (manager._on_reset_camera, "resetStage", {}),
        (manager._on_make_pickable, "makePrimsPickable", {"paths": ["/World/Wall_001"]}),
        (manager._on_highlight_prims, "highlightPrimsRequest", {
            "mode": "replace",
            "items": [{"prim_path": "/World/Wall_001"}],
            "focus_first": True,
        }),
        (manager._on_clear_highlight, "clearHighlightRequest", {}),
        (manager._on_focus_prim, "focusPrimRequest", {"prim_path": "/World/Wall_001"}),
    ]

    for index, (handler, event_type, command_fields) in enumerate(cases):
        dispatched.clear()
        handler(event({**base_payload(f"req-{index}"), **command_fields}))
        assert [name for name, _payload in dispatched] == ["commandRejected"]
        assert dispatched[0][1]["rejected_event_type"] == event_type
        assert dispatched[0][1]["runtime_state"] == "unchanged"
        assert dispatched[0][1]["trace_id"] == "rev_review_session_x"
        assert "viewer-secret-sentinel" not in str(dispatched[0][1])

    assert [event_type for event_type, _payload in authority.calls] == [case[1] for case in cases]


def test_allowed_mutators_change_state_and_echo_request_id_on_existing_result(monkeypatch):
    dispatched = []
    context = DummyUsdContext()
    monkeypatch.setattr(
        stage_management,
        "get_eventdispatcher",
        lambda: types.SimpleNamespace(
            dispatch_event=lambda name, payload: dispatched.append((name, payload))
        ),
    )
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    authority = FakeAuthority(True)
    manager = make_manager(authority)

    manager._on_select_prims(event({**base_payload("req-select"), "paths": ["/World/Wall_001"]}))
    manager._on_make_pickable(event({**base_payload("req-pick"), "paths": ["/World/Wall_001"]}))
    manager._on_reset_camera(event(base_payload("req-reset")))
    manager._on_highlight_prims(event({
        **base_payload("req-highlight"),
        "mode": "replace",
        "items": [{"prim_path": "/World/Wall_001"}],
        "focus_first": True,
    }))
    manager._on_clear_highlight(event(base_payload("req-clear")))
    manager._on_focus_prim(event({**base_payload("req-focus"), "prim_path": "/World/Wall_001"}))

    result_events = [
        (name, payload)
        for name, payload in dispatched
        if name != "stageSelectionChanged"
    ]
    assert [name for name, _payload in result_events] == [
        "selectPrimsResult",
        "makePrimsPickableResponse",
        "resetStageResponse",
        "highlightPrimsResult",
        "clearHighlightResult",
        "focusPrimResult",
    ]
    assert [payload["request_id"] for _name, payload in result_events] == [
        "req-select",
        "req-pick",
        "req-reset",
        "req-highlight",
        "req-clear",
        "req-focus",
    ]
    assert {payload["trace_id"] for _name, payload in result_events} == {
        "rev_review_session_x"
    }
    assert context.pickable_calls == [("/World/Wall_001", True)]
    assert context.selection.set_calls
    assert len(authority.calls) == 6


def test_compose_stage_is_explicitly_rejected_and_never_emits_legacy_result(monkeypatch):
    dispatched = []
    authority = FakeAuthority(False)
    manager = make_manager(authority)
    monkeypatch.setattr(
        stage_management,
        "get_eventdispatcher",
        lambda: types.SimpleNamespace(
            dispatch_event=lambda name, payload: dispatched.append((name, payload))
        ),
    )

    manager._on_unsupported_mutator(event(base_payload("req-compose")))

    assert [name for name, _payload in dispatched] == ["commandRejected"]
    assert authority.calls[0][0] == "composeStageRequest"


@pytest.mark.parametrize(
    "handler_name,event_type,fields",
    [
        ("_on_get_children", "getChildrenRequest", {"prim_path": "/World", "filters": []}),
        ("_on_select_prims", "selectPrimsRequest", {"paths": []}),
        ("_on_make_pickable", "makePrimsPickable", {"paths": []}),
        ("_on_reset_camera", "resetStage", {}),
        ("_on_highlight_prims", "highlightPrimsRequest", {"items": []}),
        ("_on_clear_highlight", "clearHighlightRequest", {}),
        ("_on_focus_prim", "focusPrimRequest", {"prim_path": "/World"}),
        ("_on_unsupported_mutator", "composeStageRequest", {}),
    ],
)
@pytest.mark.parametrize("trace_id", [None, "rev_review_session_other"])
def test_all_stage_inbound_handlers_drop_unverified_trace_before_read_or_mutation(
    monkeypatch,
    handler_name,
    event_type,
    fields,
    trace_id,
):
    dispatched = []
    authority = FakeAuthority(True)
    manager = make_manager(authority)
    monkeypatch.setattr(
        stage_management,
        "get_eventdispatcher",
        lambda: types.SimpleNamespace(
            dispatch_event=lambda name, payload: dispatched.append((name, payload))
        ),
    )
    monkeypatch.setattr(
        stage_management.omni.usd,
        "get_context",
        lambda: (_ for _ in ()).throw(AssertionError("stage read before trace verification")),
    )
    monkeypatch.setattr(
        manager,
        "get_children",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("tree read before trace verification")),
    )
    payload = {**base_payload(), **fields}
    if trace_id is None:
        payload.pop("trace_id")
    else:
        payload["trace_id"] = trace_id

    getattr(manager, handler_name)(event(payload))

    assert [call[0] for call in authority.verify_calls] == [event_type]
    assert authority.calls == []
    assert dispatched == []


def test_get_children_response_and_unsolicited_selection_use_verified_active_trace(monkeypatch):
    dispatched = []
    context = DummyUsdContext()
    authority = FakeAuthority(True)
    manager = make_manager(authority)
    monkeypatch.setattr(
        stage_management,
        "get_eventdispatcher",
        lambda: types.SimpleNamespace(
            dispatch_event=lambda name, payload: dispatched.append((name, payload))
        ),
    )
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    monkeypatch.setattr(
        manager,
        "get_children",
        lambda **_kwargs: [{"name": "Wall", "path": "/World/Wall"}],
    )

    manager._on_get_children(event({
        **base_payload("req-children"),
        "prim_path": "/World",
        "filters": [],
    }))
    manager._on_stage_event_selection_changed(event({}))

    assert [name for name, _payload in dispatched] == [
        "getChildrenResponse",
        "stageSelectionChanged",
    ]
    assert all(
        payload["trace_id"] == "rev_review_session_x"
        for _name, payload in dispatched
    )
    assert dispatched[0][1]["request_id"] == "req-children"

    dispatched.clear()
    manager._trace_context.clear()
    monkeypatch.setattr(
        stage_management.omni.usd,
        "get_context",
        lambda: (_ for _ in ()).throw(AssertionError("selection read without active owner")),
    )
    manager._on_stage_event_selection_changed(event({}))
    assert dispatched == []
