import sys
import types
from pathlib import Path

import pytest

def test_material_commands_preserve_selection_and_stage_lifecycle(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    dispatched = []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: dispatched.append((name, payload))))
    manager = make_manager(FakeAuthorityService())
    changes = []
    manager._highlight_stage = context.stage
    manager._camera_stage = context.stage
    manager._highlight_overlay.clear = lambda: changes.append("clear")
    manager._highlight_overlay.replace = lambda stage, items: changes.append(("replace", stage)) or {
        "applied_paths": ["/B", "/C"], "missing_paths": [], "unsupported_paths": []}
    manager._on_highlight_prims(event({**base_payload(), "items": [{"prim_path": "/B"}, {"prim_path": "/C"}]}))
    manager._on_stage_event_opened(None)
    assert changes == [("replace", context.stage)]
    manager._on_clear_highlight(event(base_payload()))
    assert context.selection.set_calls == [] and context.selection.clear_count == 0
    manager._on_focus_prim(event({**base_payload(), "prim_path": "/B"}))
    assert context.selection.set_calls == [(["/B"], True)]
    assert dispatched[-1][1]["framed"] is True
    assert changes == [("replace", context.stage), "clear"]
    manager._on_stage_event_closed(None)
    assert changes[-1] == "clear" and manager._highlight_stage is None
    manager.on_shutdown()


@pytest.mark.parametrize("bad", ["bad", False, 123, {}, None])
def test_invalid_highlight_container_preserves_previous_effect_and_reports_error(monkeypatch, bad):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    dispatched = []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: dispatched.append((name, payload))))
    manager = make_manager(FakeAuthorityService())
    manager._highlight_stage = context.stage
    manager._highlight_overlay.clear = lambda: pytest.fail("invalid payload cleared existing overlay")
    manager._highlight_overlay.replace = lambda *_args: pytest.fail("invalid payload reached replace")
    manager._on_highlight_prims(event({**base_payload("bad-batch"), "items": bad}))
    assert dispatched[-1][1]["result"] == "error"
    assert dispatched[-1][1]["request_id"] == "bad-batch"
    assert context.selection.set_calls == []


@pytest.mark.parametrize("bad", [[], {}, False, "relative", "/World.attr", "/bad path", "/"])
def test_invalid_focus_path_emits_correlated_error_without_selection(monkeypatch, bad):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    dispatched = []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: dispatched.append((name, payload))))
    manager = make_manager(FakeAuthorityService())
    manager._on_focus_prim(event({**base_payload("bad-focus"), "prim_path": bad}))
    assert dispatched[-1][1]["result"] == "error"
    assert dispatched[-1][1]["request_id"] == "bad-focus"
    assert context.selection.set_calls == []


def test_focus_emphasis_is_authorized_and_explicit_and_selection_restores(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    dispatched, calls = [], []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: dispatched.append((name, payload))))
    authority = FakeAuthorityService()
    manager = make_manager(authority)
    manager._focus_overlay = types.SimpleNamespace(active=True,
        clear=lambda: calls.append('clear'),
        replace=lambda stage, path: calls.append(path) or {'focus_emphasis': True, 'context_opacity': .08})
    manager._on_focus_prim(event({**base_payload(), 'prim_path': '/B', 'emphasis': True}))
    assert calls == ['/B'] and dispatched[-1][1]['focus_emphasis'] is True
    manager._on_select_prims(event({**base_payload(), 'paths': []}))
    assert calls[-1] == 'clear' and dispatched[-1][1]['selected_paths'] == []
    calls.clear()
    authority.authorize = LEASE_RELEASED
    manager._on_focus_prim(event({**base_payload(), 'prim_path': '/B', 'emphasis': True}))
    assert calls == [] and dispatched[-1][0] == 'commandRejected'


def test_focus_refuses_invalid_flags_and_measurement_through_translucent_context(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    dispatched = []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: dispatched.append((name, payload))))
    manager = make_manager(FakeAuthorityService())
    manager._on_focus_prim(event({**base_payload(), 'prim_path':'/B', 'emphasis':'true'}))
    assert dispatched[-1][1]['result'] == 'error' and not context.selection.set_calls
    manager._on_focus_prim(event({**base_payload(), 'prim_path':'/B', 'emphasis':True, 'pulse':True}))
    assert dispatched[-1][1]['result'] == 'error' and not context.selection.set_calls
    manager._focus_overlay.active = True
    manager._on_measurement(event({**base_payload(), 'action':'start', 'measurement_id':'m'}))
    assert dispatched[-1][1]['error'] == 'restore_focus_before_measurement'


def test_highlight_clear_errors_and_denials_do_not_report_success(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    dispatched = []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: dispatched.append((name, payload))))
    authority = FakeAuthorityService()
    manager = make_manager(authority)
    def failed_clear():
        raise RuntimeError("injected layer removal error")
    manager._highlight_overlay.clear = failed_clear
    manager._on_clear_highlight(event(base_payload()))
    assert dispatched[-1][1]["result"] == "error"
    authority.authorize = LEASE_RELEASED
    manager._on_clear_highlight(event(base_payload()))
    assert dispatched[-1][0] == "commandRejected"
    assert context.selection.clear_count == 0



def install_stage_management_stubs() -> dict:
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
    omni_usd.StageEventType = types.SimpleNamespace(ASSETS_LOADED=1, SELECTION_CHANGED=2, CLOSED=3, CLOSING=4)
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
    omni_kit_viewport_utility.frame_viewport_prims = lambda **_kwargs: True
    omni_kit_viewport.utility = omni_kit_viewport_utility
    omni.kit = omni_kit

    pxr = types.ModuleType("pxr")
    pxr.UsdGeom = types.ModuleType("pxr.UsdGeom")
    pxr.Sdf = types.SimpleNamespace(Path=lambda value: types.SimpleNamespace(
        IsAbsolutePath=lambda: value.startswith("/"),
        IsPrimPath=lambda: "." not in value and " " not in value,
    ))
    pxr.Usd = types.SimpleNamespace(
        EditContext=lambda *_args: DummyEditContext(),
        EditTarget=lambda value: value,
    )

    return {
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
def _kit_stub_modules():
    saved = _install_kit_stubs(_KIT_STUBS)
    try:
        yield
    finally:
        _restore_kit_stubs(saved)


_KIT_STUBS = install_stage_management_stubs()
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
    import stage_management  # noqa: E402
    from mutation_gate import MutationGate  # noqa: E402
    from runtime_authority import DataChannelTraceContext, RuntimeAuthorityClient  # noqa: E402
    from stage_management import StageManager  # noqa: E402
finally:
    _restore_kit_stubs(_saved_kit_stubs)

from runtime_authority_service_fake import AUTHORIZE, LEASE_RELEASED, UNREACHABLE, VERIFY, FakeAuthorityService  # noqa: E402


def authority_gate(service):
    """A real Mutation Gate over a real RuntimeAuthorityClient whose transport is the in-memory authority service."""
    return MutationGate(RuntimeAuthorityClient(
        base_url="http://127.0.0.1:8004",
        internal_token="internal-test-token",
        transport=service,
    ))


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


def make_manager(service):
    manager = StageManager.__new__(StageManager)
    manager._gate = authority_gate(service)
    manager._trace_context = DataChannelTraceContext()
    assert manager._trace_context.bind_active_stage(
        "review_session_x",
        "rev_review_session_x",
    )
    manager._is_external_update = False
    manager._focus_overlay = types.SimpleNamespace(active=False, clear=lambda: None,
        replace=lambda stage, path: {"focus_emphasis": True, "context_opacity": .08})
    manager._camera_attrs = {}
    manager._highlight_stage = None
    manager._camera_stage = None
    manager._section_plane = None
    manager._camera_view = None
    manager._fly_navigation = None
    manager._overlay_style = None
    manager._measurement_runtime = None
    manager._measurement_tasks = set()
    manager._measurement_notice = None
    manager._measurement_stage = None
    manager._measurement_revision = 0
    manager._measurement_epoch_lock = stage_management.threading.Lock()
    manager._measurement_loop = None
    manager._measurement_closed = False
    manager._highlight_overlay = types.SimpleNamespace(
        clear=lambda: None,
        replace=lambda _stage, items: {"applied_paths": [item["prim_path"] for item in items],
                                      "missing_paths": [], "unsupported_paths": []},
    )
    manager._subscriptions = []
    return manager


def event(payload):
    return types.SimpleNamespace(payload=payload)


@pytest.mark.parametrize("scope,expected", [(None, "/World/Elements/IfcWall"), ("building", "/World/Elements/IfcWall"), ("all", "/World/Elements")])
def test_reset_camera_reframes_ifc_after_restoring_cached_pose(monkeypatch, scope, expected):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    manager = make_manager(FakeAuthorityService())
    calls = []
    manager._camera_attrs = {"focalLength": 50}
    context.stage.GetPrimAtPath = lambda path: types.SimpleNamespace(
        GetAttribute=lambda name: types.SimpleNamespace(Set=lambda value: calls.append((name, value)))) if path in (
            "/OmniverseKit_Persp", "/World/Elements", "/World/Elements/IfcWall") else None
    monkeypatch.setattr(StageManager, "_has_geometry_bounds", lambda _stage, _prim: True, raising=False)
    utility = sys.modules["omni.kit.viewport.utility"]
    monkeypatch.setattr(utility, "frame_viewport_prims", lambda **kwargs: calls.append(kwargs) or True)
    pending = types.SimpleNamespace(done=lambda: False, cancel=lambda: calls.append("cancel"))
    manager._camera_task = pending
    manager._on_reset_camera(event({**base_payload("reset-model"), **({"scope": scope} if scope else {})}))
    assert calls == ["cancel", ("focalLength", 50), {"prims": [expected]}]


@pytest.mark.parametrize("scope", ["typo", "", None, {}, 1])
def test_reset_camera_invalid_scope_does_not_mutate(monkeypatch, scope):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    manager = make_manager(FakeAuthorityService())
    manager._camera_attrs = {"focalLength": 50}
    context.stage.GetPrimAtPath = lambda path: pytest.fail("invalid scope must not read or mutate camera")
    results = []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: results.append(payload)))
    manager._on_reset_camera(event({**base_payload("invalid-scope"), "scope": scope}))
    assert results[-1]["result"] == "error"
    assert results[-1]["request_id"] == "invalid-scope"


@pytest.mark.parametrize("groups,expected", [
    (["IfcWall", "IfcRoof", "IfcSite", "IfcBeam"], ["IfcWall", "IfcRoof"]),
    (["IfcColumn", "IfcBeam"], ["IfcColumn"]),
    (["IfcSite", "IfcBeam"], [""]),
    ([], [""]),
])
def test_building_framing_uses_envelope_then_columns_then_all(monkeypatch, groups, expected):
    stage = DummyStage()
    stage.GetPrimAtPath = lambda path: path if path == "/World/Elements" or path.rsplit("/", 1)[-1] in groups else None
    monkeypatch.setattr(StageManager, "_has_geometry_bounds", lambda _stage, _prim: True, raising=False)
    calls = []
    monkeypatch.setattr(sys.modules["omni.kit.viewport.utility"], "frame_viewport_prims", lambda **kw: calls.append(kw) or True)
    StageManager._frame_ifc_model(stage)
    assert calls == [{"prims": ["/World/Elements" + ("/" + name if name else "") for name in expected]}]


def test_empty_building_groups_fall_back_without_hiding_geometry(monkeypatch):
    monkeypatch.setattr(StageManager, "_has_geometry_bounds", lambda _stage, _prim: False, raising=False)
    calls = []
    monkeypatch.setattr(sys.modules["omni.kit.viewport.utility"], "frame_viewport_prims", lambda **kw: calls.append(kw) or True)
    StageManager._frame_ifc_model(DummyStage())
    assert calls == [{"prims": ["/World/Elements"]}]


def test_reset_camera_reports_failed_model_framing(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    dispatched = []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: dispatched.append((name, payload))))
    monkeypatch.setattr(sys.modules["omni.kit.viewport.utility"], "frame_viewport_prims", lambda **kwargs: False)
    manager = make_manager(FakeAuthorityService())
    manager._on_reset_camera(event(base_payload("reset-failed")))
    assert dispatched[-1][1]["result"] == "error"
    assert dispatched[-1][1]["request_id"] == "reset-failed"


@pytest.mark.parametrize("replacement", [None, "stage", "viewport", "camera", "focus"])
def test_initial_camera_waits_for_render_and_cannot_frame_replacement(monkeypatch, replacement):
    import asyncio
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    calls = []
    camera = types.SimpleNamespace(GetAttributes=lambda: [types.SimpleNamespace(
        GetName=lambda: "pose", Get=lambda: "framed" if calls else "too-far")])
    context.stage.GetPrimAtPath = lambda path: camera
    context.stage.GetRootLayer = lambda: types.SimpleNamespace(identifier="model.usdc")
    utility = sys.modules["omni.kit.viewport.utility"]
    viewport = types.SimpleNamespace(stage=context.stage)
    active_viewport = [viewport]
    monkeypatch.setattr(utility, "get_active_viewport", lambda: active_viewport[0], raising=False)
    monkeypatch.setattr(utility, "frame_viewport_prims", lambda **kwargs: calls.append(kwargs) or True)

    async def scenario():
        gate = asyncio.Event()
        async def next_frame(_viewport, n_frames=0):
            await gate.wait()
        monkeypatch.setattr(utility, "next_viewport_frame_async", next_frame, raising=False)
        manager = make_manager(FakeAuthorityService())
        manager._on_stage_event_opened(None)
        await asyncio.sleep(0)
        assert calls == [] and manager._camera_attrs == {}
        task = manager._camera_task
        if replacement == "stage":
            context.stage = DummyStage()
        elif replacement == "viewport":
            active_viewport[0] = types.SimpleNamespace(stage=context.stage, replacement=True)
        elif replacement == "camera":
            monkeypatch.setattr(stage_management, "get_active_viewport_camera_string", lambda: "/OtherCamera")
        elif replacement == "focus":
            manager._on_focus_prim(event({**base_payload(), "prim_path": "/World/Wall"}))
        gate.set()
        if replacement == "focus":
            with pytest.raises(asyncio.CancelledError):
                await task
            assert calls == [{"prims": ["/World/Wall"]}]
            assert manager._camera_attrs == {}
        elif replacement:
            await task
            assert calls == [] and manager._camera_attrs == {}
        else:
            await task
            assert calls == [{"prims": ["/World/Elements"]}]
            assert manager._camera_attrs == {"pose": "framed"}
            manager._on_stage_event_opened(None)
            assert len(calls) == 1
    asyncio.run(scenario())


def base_payload(request_id="req-1"):
    return {
        "request_id": request_id,
        "session_id": "review_session_x",
        "trace_id": "rev_review_session_x",
        "source_client_id": "viewer_lease_x",
        "viewer_lease_token": "viewer-secret-sentinel",
    }


@pytest.mark.parametrize("fail", [False, True])
def test_clip_handler_correlates_single_result_and_restores_on_close(monkeypatch, fail):
    manager = make_manager(FakeAuthorityService())
    effects, results = [], []
    def apply(stage, payload):
        effects.append("apply")
        if fail:
            raise RuntimeError("private renderer exception")
        return {"enabled": True, "planes": [[1, 0, 0, -3]]}
    manager._section_plane = types.SimpleNamespace(apply=apply, restore=lambda: effects.append("restore"))
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: results.append((name, payload))))
    manager._on_clip_plane(event({**base_payload(), "enabled": True, "axis": "x", "position": 3, "normal": [1, 0, 0]}))
    assert len(results) == 1 and results[0][0] == "clipPlaneResult"
    result = results[0][1]
    assert result["result"] == ("error" if fail else "success")
    assert result["request_id"] == "req-1" and result["trace_id"] == "rev_review_session_x"
    assert "private" not in str(result) and "viewer-secret" not in str(result)
    assert context.selection.set_calls == [] and context.selection.clear_count == 0
    manager._restore_section_plane(event({}))
    manager.on_shutdown()
    assert effects == ["apply", "restore", "restore"]


def test_constructor_registers_clip_request_result_and_stage_closing(monkeypatch):
    subscriptions, outgoing = [], []
    monkeypatch.setattr(stage_management.carb, "settings", types.SimpleNamespace(get_settings=lambda: object()), raising=False)
    monkeypatch.setattr(stage_management, "register_client_send", lambda name: outgoing.append(name))
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        observe_event=lambda **kwargs: subscriptions.append(kwargs)))
    monkeypatch.setattr(stage_management.omni.usd, "StageEventType",
                        types.SimpleNamespace(ASSETS_LOADED=1, SELECTION_CHANGED=2, CLOSING=3, CLOSED=4))
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: types.SimpleNamespace(
        stage_event_name=lambda value: "stage-" + str(value)))
    manager = StageManager(mutation_gate=authority_gate(FakeAuthorityService(authorize=LEASE_RELEASED)))
    assert manager._section_plane is None
    assert "clipPlaneResult" in outgoing
    by_name = {row["event_name"]: row["on_event"] for row in subscriptions}
    assert by_name["clipPlaneRequest"] == manager._on_clip_plane
    assert by_name["stage-3"] == manager._on_stage_closing
    assert by_name["measurementRequest"] == manager._on_measurement
    assert "measurementResult" in outgoing
    assert by_name["cameraViewRequest"] == manager._on_camera_view
    assert by_name["cameraStateRequest"] == manager._on_camera_state
    assert by_name["flyNavigationRequest"] == manager._on_fly_navigation
    assert by_name["overlayStyleRequest"] == manager._on_overlay_style
    assert {"cameraViewResult", "cameraStateResult", "flyNavigationResult", "overlayStyleResult"} <= set(outgoing)


def test_focus_restore_failure_reports_correlated_error_and_can_retry(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    dispatched = []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: dispatched.append((name, payload))))
    manager = make_manager(FakeAuthorityService())
    def fail(): raise ValueError("restore unconfirmed")
    manager._focus_overlay.clear = fail
    manager._on_select_prims(event({**base_payload("restore-failed"), "paths": []}))
    name, payload = dispatched[-1]
    assert name == "selectPrimsResult" and payload["result"] == "error"
    assert payload["request_id"] == "restore-failed" and payload["selected_paths"] == ["/World/Wall_001"]
    assert context.selection.set_calls == []
    assert manager._is_external_update is False
    manager._on_stage_event_selection_changed(None)
    assert dispatched[-1][0] == "stageSelectionChanged"
    assert dispatched[-1][1]["prims"] == ["/World/Wall_001"]
    manager._focus_overlay.clear = lambda: None
    manager._on_select_prims(event({**base_payload("restore-retry"), "paths": []}))
    assert dispatched[-1][1]["result"] == "success"


def test_focus_restore_failure_does_not_strand_shutdown_safety_cleanup(monkeypatch):
    manager = make_manager(FakeAuthorityService())
    calls, warnings = [], []
    def fail(): raise ValueError("restore unconfirmed")
    manager._focus_overlay.clear = fail
    manager._measurement_notice = types.SimpleNamespace(Revoke=lambda: calls.append("revoke"))
    manager._measurement_runtime = types.SimpleNamespace(close=lambda: calls.append("close"))
    manager._invalidate_measurement = lambda: calls.append("invalidate")
    manager._measurement_tasks = (types.SimpleNamespace(cancel=lambda: calls.append("cancel")),)
    manager._highlight_stage = object()
    manager._highlight_overlay.clear = lambda: calls.append("highlight")
    manager._subscriptions = [object()]
    monkeypatch.setattr(stage_management.carb, "log_warn", warnings.append)
    manager.on_shutdown()
    assert manager._trace_context.active_binding() is None
    assert manager._measurement_notice is None and not manager._subscriptions
    assert all(item in calls for item in ("revoke", "close", "cancel", "highlight"))
    assert warnings and "unconfirmed" in warnings[0]


def test_measurement_task_cap_still_cancels_matching_owner(monkeypatch):
    import asyncio
    from test_measurement_runtime import setup, request
    async def run():
        runtime, _, authority, _, _ = setup()
        await runtime.execute(request("start"))
        manager = make_manager(authority)
        manager._measurement_runtime = runtime
        manager._measurement_tasks = {object(), object()}
        emitted = []
        monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
            dispatch_event=lambda *args, **kwargs: emitted.append((args, kwargs))))
        before = runtime.epoch
        manager._on_measurement(event(request("cancel", "foreign", source_client_id="other")))
        assert runtime.epoch == before
        manager._on_measurement(event(request("cancel", "cancel")))
        assert runtime.epoch > before
        assert len(manager._measurement_tasks) == 2
        assert len(emitted) == 2
    asyncio.run(run())


@pytest.mark.parametrize("worker_thread", [False, True])
def test_measurement_handler_uses_native_query_notice_and_no_shutdown_publish(monkeypatch, worker_thread):
    import asyncio
    from test_measurement_runtime import setup, request, until
    async def run():
        asyncio.get_running_loop().set_debug(True)
        runtime, viewport, authority, trace, _ = setup()
        manager = make_manager(FakeAuthorityService())
        # Measurement still asks its authority directly until it is admitted through the gate (ADR bullet 2).
        manager._gate = MutationGate(authority)
        manager._trace_context = trace
        notice = types.SimpleNamespace(Revoke=lambda: None)
        callbacks, emitted = [], []
        monkeypatch.setattr(sys.modules["pxr"], "Tf", types.SimpleNamespace(Notice=types.SimpleNamespace(
            Register=lambda kind, callback, stage: (callbacks.append(callback), notice)[1])), raising=False)
        monkeypatch.setattr(stage_management.Usd, "Notice", types.SimpleNamespace(ObjectsChanged=object()), raising=False)
        monkeypatch.setattr(sys.modules["omni.kit.viewport.utility"], "get_active_viewport", lambda: viewport, raising=False)
        monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: types.SimpleNamespace(get_stage=lambda: viewport.stage))
        monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
            dispatch_event=lambda name, payload: emitted.append((name, payload))))
        manager._on_measurement(event(request("start")))
        await until(lambda: len(emitted) == 1)
        assert emitted[-1][1]["status"] == "started" and len(callbacks) == 1
        manager._on_measurement(event(request("pick", "p1", uv=[0.5, 0.5])))
        await until(lambda: len(viewport.callbacks) == 1)
        before = manager._measurement_scene_revision()
        if worker_thread:
            errors = []
            def notify():
                try:
                    callbacks[0](None, None)
                except Exception as exc:
                    errors.append(exc)
            thread = stage_management.threading.Thread(target=notify)
            thread.start()
            thread.join(timeout=1)
            assert not thread.is_alive() and errors == []
            # Notice epoch is visible even before this loop can drain cancellation.
            assert manager._measurement_scene_revision() > before
        else:
            callbacks[0](None, None)
        viewport.callbacks[0]("/Wall", (1, 2, 3))
        await until(lambda: len(emitted) == 2)
        assert emitted[-1][1]["status"] in ("rejected", "cancelled")
        manager._on_measurement(event(request("start", "start2")))
        manager.on_shutdown()
        await asyncio.sleep(0.02)
        assert len(emitted) == 2
        assert trace.active_binding() is None
    asyncio.run(run())


def test_section_lifecycle_preserves_same_stage_and_retries_failed_cleanup(monkeypatch):
    from section_plane import SectionPlaneController, ENABLED, PLANE
    from test_section_plane import FakeSettings, payload
    settings, context = FakeSettings(), DummyUsdContext()
    manager = make_manager(FakeAuthorityService())
    manager._section_plane = SectionPlaneController(settings)
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    manager._camera_stage = context.stage
    manager._highlight_stage = context.stage
    manager._section_plane.apply(context.stage, payload())
    manager._on_stage_event_opened(None)
    assert settings.values[ENABLED] is True
    settings.fail_once = PLANE
    warnings = []
    monkeypatch.setattr(stage_management.carb, "log_warn", warnings.append)
    manager._restore_section_plane()
    assert warnings == ["Section settings could not be restored."]
    assert settings.values[ENABLED] is True
    manager._on_stage_event_closed(None)
    assert settings.values == {ENABLED: False, PLANE: [0, 0, 0, 0]}
    manager._section_plane.apply(context.stage, payload())
    context.stage = object()
    manager._camera_stage = context.stage
    manager._on_stage_event_opened(None)
    assert settings.values == {ENABLED: False, PLANE: [0, 0, 0, 0]}


def test_shutdown_restores_section_and_cleans_up_if_highlight_clear_throws():
    manager = make_manager(FakeAuthorityService())
    effects = []
    def fail_clear():
        raise RuntimeError("clear failed")
    manager._highlight_overlay = types.SimpleNamespace(clear=fail_clear)
    manager._highlight_stage = object()
    manager._section_plane = types.SimpleNamespace(restore=lambda: effects.append("restore"))
    manager._subscriptions = [object()]
    manager._camera_attrs = {"camera": object()}
    manager._is_external_update = True
    with pytest.raises(RuntimeError, match="clear failed"):
        manager.on_shutdown()
    assert effects == ["restore"]
    assert manager._subscriptions == [] and manager._camera_attrs == {}
    assert manager._is_external_update is False


def test_clip_handler_normalizes_nested_carb_normal_after_authorization(monkeypatch):
    class NormalItem(stage_management.carb.dictionary.Item):
        def get_dict(self):
            return [1, 0, 0]
    manager = make_manager(FakeAuthorityService())
    results = []
    def apply(stage, payload):
        assert payload["normal"] == [1, 0, 0]
        return {"enabled": True, "planes": [[1, 0, 0, -3]]}
    manager._section_plane = types.SimpleNamespace(apply=apply)
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: DummyUsdContext())
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: results.append(payload)))
    manager._on_clip_plane(event({**base_payload(), "enabled": True, "axis": "x",
                                  "position": 3, "normal": NormalItem()}))
    assert len(results) == 1 and results[0]["result"] == "success"


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
    authority = FakeAuthorityService(authorize=LEASE_RELEASED)
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
        (manager._on_clip_plane, "clipPlaneRequest", {"enabled": True, "axis": "x", "position": 3, "normal": [1, 0, 0]}),
        (manager._on_focus_prim, "focusPrimRequest", {"prim_path": "/World/Wall_001"}),
        (manager._on_camera_view, "cameraViewRequest", {"action": "preset", "view": "top", "scope": "all"}),
        (manager._on_fly_navigation, "flyNavigationRequest", {"speed": 2.0}),
        (manager._on_overlay_style, "overlayStyleRequest",
         {"prim_path": "/World/Overlays/Cfd/run_1/PedestrianWind_1p5m", "display_opacity": 0.3}),
    ]

    for index, (handler, event_type, command_fields) in enumerate(cases):
        dispatched.clear()
        handler(event({**base_payload(f"req-{index}"), **command_fields}))
        assert [name for name, _payload in dispatched] == ["commandRejected"]
        assert dispatched[0][1]["rejected_event_type"] == event_type
        assert dispatched[0][1]["runtime_state"] == "unchanged"
        assert dispatched[0][1]["trace_id"] == "rev_review_session_x"
        assert "viewer-secret-sentinel" not in str(dispatched[0][1])

    assert authority.authorized_events == [case[1] for case in cases]


def test_unreachable_authority_answers_instead_of_dropping_the_command(monkeypatch):
    # A coordinator outage used to make every command vanish: the trace could not be
    # verified, the handler returned early, and nothing went back to the viewer, which
    # then waited forever. An unverifiable command must still be refused out loud - and
    # retryably, because "could not check" is not "checked and denied". It must still
    # never execute, and must never reach the authorization step.
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
    authority = FakeAuthorityService(verify=UNREACHABLE)
    manager = make_manager(authority)

    manager._on_focus_prim(event({**base_payload("req-outage"), "prim_path": "/World/Wall_001"}))

    assert [name for name, _payload in dispatched] == ["commandRejected"]
    rejection = dispatched[0][1]
    assert rejection["rejected_event_type"] == "focusPrimRequest"
    assert rejection["detail_code"] == "authority_unavailable"
    assert rejection["retryable"] is True
    assert rejection["runtime_state"] == "unchanged"
    assert authority.bodies(AUTHORIZE) == []
    assert "viewer-secret-sentinel" not in str(rejection)


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
    authority = FakeAuthorityService()
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
        "cameraFrameResult",
        "highlightPrimsResult",
        "clearHighlightResult",
        "focusPrimResult",
    ]
    assert [payload["request_id"] for _name, payload in result_events] == [
        "req-select",
        "req-pick",
        "req-reset",
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
    assert len(authority.authorized_events) == 6


def test_compose_stage_is_explicitly_rejected_and_never_emits_legacy_result(monkeypatch):
    dispatched = []
    authority = FakeAuthorityService(authorize=LEASE_RELEASED)
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
    # A harness-only command is refused by the client itself; the coordinator is never asked.
    assert (dispatched[0][1]["reason"], dispatched[0][1]["detail_code"]) == ("unsupported_command", "harness_only_command")
    assert authority.bodies(AUTHORIZE) == []


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
        ("_on_camera_view", "cameraViewRequest", {"action": "projection", "projection": "orthographic"}),
        ("_on_camera_state", "cameraStateRequest", {}),
        ("_on_fly_navigation", "flyNavigationRequest", {"speed": 2.0}),
        ("_on_overlay_style", "overlayStyleRequest",
         {"prim_path": "/World/Overlays/Cfd/run_1/PedestrianWind_1p5m", "display_opacity": 0.3}),
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
    authority = FakeAuthorityService()
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

    # A missing trace is refused before the coordinator is asked; a foreign one is asked about once and refused.
    assert len(authority.bodies(VERIFY)) == (0 if trace_id is None else 1)
    assert authority.bodies(AUTHORIZE) == []
    assert dispatched == []


def test_get_children_response_and_unsolicited_selection_use_verified_active_trace(monkeypatch):
    dispatched = []
    context = DummyUsdContext()
    authority = FakeAuthorityService()
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


CAMERA = {"projection": "perspective", "position": [0.0, 0.0, 1.0], "direction": [0.0, 0.0, -1.0],
          "up": [0.0, 1.0, 0.0], "target_distance": 5.0, "fov_deg": 40.0, "ortho_height": None}


def _capture(monkeypatch):
    results = []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: results.append((name, payload))))
    return results


def _camera_controller(calls):
    return types.SimpleNamespace(
        sync_stage=lambda stage: calls.append(("sync", stage)),
        orient=lambda stage, view: calls.append(("orient", view)),
        set_projection=lambda stage, projection: calls.append(("projection", projection)),
        read_state=lambda stage: CAMERA,
    )


def test_camera_preset_orients_then_frames_scope_and_reports_camera(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results, calls = _capture(monkeypatch), []
    manager = make_manager(FakeAuthorityService())
    manager._camera_view = _camera_controller(calls)
    monkeypatch.setattr(StageManager, "_frame_ifc_model",
                        classmethod(lambda cls, stage, scope: calls.append(("frame", scope)) or ["/World/Elements"]))
    manager._camera_task = types.SimpleNamespace(done=lambda: False, cancel=lambda: calls.append("cancel"))
    manager._on_camera_view(event({**base_payload("view-1"), "action": "preset", "view": "top", "scope": "all"}))
    assert calls == [("sync", context.stage), "cancel", ("orient", "top"), ("frame", "all")]
    assert results == [("cameraViewResult", {"result": "success", "camera": CAMERA,
                                              "request_id": "view-1", "trace_id": "rev_review_session_x"})]


def test_camera_projection_does_not_reframe(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results, calls = _capture(monkeypatch), []
    manager = make_manager(FakeAuthorityService())
    manager._camera_view = _camera_controller(calls)
    monkeypatch.setattr(StageManager, "_frame_ifc_model",
                        classmethod(lambda cls, stage, scope: pytest.fail("projection must not reframe")))
    manager._on_camera_view(event({**base_payload("view-2"), "action": "projection", "projection": "orthographic"}))
    assert calls == [("sync", context.stage), ("projection", "orthographic")]
    assert results[-1][1]["result"] == "success"


def test_camera_preset_refuses_stage_without_identity_elements_before_mutation(monkeypatch):
    context = DummyUsdContext()
    context.stage.GetPrimAtPath = lambda path: None
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results, calls = _capture(monkeypatch), []
    manager = make_manager(FakeAuthorityService())
    manager._camera_view = _camera_controller(calls)
    manager._on_camera_view(event({**base_payload("view-3"), "action": "preset", "view": "iso", "scope": "building"}))
    assert ("orient", "iso") not in calls
    assert results == [("cameraViewResult", {"result": "error", "error": "Camera view could not be applied.",
                                              "request_id": "view-3", "trace_id": "rev_review_session_x"})]


@pytest.mark.parametrize("bad", [
    {"action": "preset", "view": "bottom", "scope": "all"},
    {"action": "projection", "projection": "fisheye"},
    {"action": "apply_state"},
])
def test_camera_invalid_request_reports_generic_error_before_camera_access(monkeypatch, bad):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results = _capture(monkeypatch)
    manager = make_manager(FakeAuthorityService())
    manager._camera_view = types.SimpleNamespace(
        sync_stage=lambda stage: pytest.fail("invalid request reached the camera"))
    manager._on_camera_view(event({**base_payload("view-bad"), **bad}))
    assert results[-1][1]["result"] == "error"
    assert results[-1][1]["request_id"] == "view-bad"


def test_camera_failure_hides_private_exception_text(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results = _capture(monkeypatch)
    manager = make_manager(FakeAuthorityService())

    def boom(stage, projection):
        raise RuntimeError("private renderer exception")

    manager._camera_view = types.SimpleNamespace(sync_stage=lambda stage: None, set_projection=boom)
    manager._on_camera_view(event({**base_payload("view-4"), "action": "projection", "projection": "perspective"}))
    assert results[-1][1]["result"] == "error"
    assert "private" not in str(results) and "viewer-secret" not in str(results)


def test_camera_state_is_readonly_and_correlated(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results, calls = _capture(monkeypatch), []
    authority = FakeAuthorityService(authorize=LEASE_RELEASED)
    manager = make_manager(authority)
    manager._camera_view = _camera_controller(calls)
    manager._on_camera_state(event({"request_id": "state-1", "session_id": "review_session_x",
                                    "trace_id": "rev_review_session_x"}))
    assert authority.bodies(AUTHORIZE) == []
    assert calls == [("sync", context.stage)]
    assert results == [("cameraStateResult", {"result": "success", "camera": CAMERA,
                                               "request_id": "state-1", "trace_id": "rev_review_session_x"})]


def test_fly_navigation_applies_speed_and_reports_readback(monkeypatch):
    results, calls = _capture(monkeypatch), []
    manager = make_manager(FakeAuthorityService())
    manager._fly_navigation = types.SimpleNamespace(apply=lambda speed: calls.append(speed) or 2.5)
    manager._on_fly_navigation(event({**base_payload("fly-1"), "speed": 2.5}))
    assert calls == [2.5]
    assert results == [("flyNavigationResult", {"result": "success", "speed": 2.5,
                                                 "request_id": "fly-1", "trace_id": "rev_review_session_x"})]


def _open_stage_with_fly(monkeypatch, calibrate):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    monkeypatch.setattr(stage_management.UsdGeom, "GetStageMetersPerUnit",
                        lambda stage: 0.01 if stage is context.stage else None, raising=False)
    warnings = []
    monkeypatch.setattr(stage_management.carb, "log_warn", warnings.append)
    manager = make_manager(FakeAuthorityService())
    manager._fly_navigation = types.SimpleNamespace(calibrate=calibrate)
    manager._camera_stage = context.stage
    manager._highlight_stage = context.stage
    manager._on_stage_event_opened(None)
    return warnings


def test_stage_open_calibrates_fly_speed_to_stage_units(monkeypatch):
    calls = []
    warnings = _open_stage_with_fly(monkeypatch, calls.append)
    assert calls == [0.01]
    assert warnings == []


def test_stage_open_warns_when_fly_calibration_fails(monkeypatch):
    def fail(_meters_per_unit):
        raise ValueError("readback")
    warnings = _open_stage_with_fly(monkeypatch, fail)
    assert warnings == ["Fly speed calibration was not applied."]


def test_overlay_style_applies_opacity_and_reports_readback(monkeypatch):
    results, calls = _capture(monkeypatch), []
    manager = make_manager(FakeAuthorityService())
    path = "/World/Overlays/Cfd/run_1/PedestrianWind_1p5m"

    def apply(prim_path, display_opacity):
        calls.append((prim_path, display_opacity))
        return {"prim_path": prim_path, "display_opacity": 0.25, "prims": 1}

    manager._overlay_style = types.SimpleNamespace(apply=apply)
    manager._on_overlay_style(event({**base_payload("style-1"), "prim_path": path, "display_opacity": 0.25}))
    assert calls == [(path, 0.25)]
    assert results == [("overlayStyleResult", {"result": "success", "prim_path": path, "display_opacity": 0.25,
                                               "request_id": "style-1", "trace_id": "rev_review_session_x"})]


def test_overlay_style_failure_is_generic(monkeypatch):
    results = _capture(monkeypatch)
    manager = make_manager(FakeAuthorityService())

    def boom(prim_path, display_opacity):
        raise RuntimeError("private usd exception")

    manager._overlay_style = types.SimpleNamespace(apply=boom)
    manager._on_overlay_style(event({**base_payload("style-2"), "prim_path": "/World/Overlays/Cfd/run_1",
                                     "display_opacity": 0.5}))
    assert results == [("overlayStyleResult", {"result": "error", "error": "Overlay style could not be applied.",
                                               "request_id": "style-2", "trace_id": "rev_review_session_x"})]
    assert "private usd exception" not in str(results)


def test_fly_navigation_failure_is_generic(monkeypatch):
    results = _capture(monkeypatch)
    manager = make_manager(FakeAuthorityService())

    def boom(speed):
        raise RuntimeError("private settings exception")

    manager._fly_navigation = types.SimpleNamespace(apply=boom)
    manager._on_fly_navigation(event({**base_payload("fly-2"), "speed": 2.5}))
    assert results == [("flyNavigationResult", {"result": "error", "error": "Fly speed could not be applied.",
                                                 "request_id": "fly-2", "trace_id": "rev_review_session_x"})]


def test_stage_closing_drops_camera_view_state():
    calls = []
    manager = make_manager(FakeAuthorityService())
    manager._camera_view = types.SimpleNamespace(sync_stage=lambda stage: calls.append(stage))
    manager._on_stage_closing()
    assert calls == [None]
