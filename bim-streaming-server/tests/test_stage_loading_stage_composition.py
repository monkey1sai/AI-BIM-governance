import os
import sys
import types
from pathlib import Path

_ALLOWED_STAGE_HOSTS_ENV = "BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS"


def install_stage_loading_stubs() -> None:
    class DummyItem:
        def get_dict(self):
            return {}

    carb = types.ModuleType("carb")
    carb.dictionary = types.SimpleNamespace(Item=DummyItem)
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
    omni_kit = types.ModuleType("omni.kit")
    omni_kit_app = types.ModuleType("omni.kit.app")
    omni_kit_app.register_event_alias = lambda *args, **kwargs: None
    omni_kit.app = omni_kit_app

    omni_kit_livestream = types.ModuleType("omni.kit.livestream")
    omni_kit_livestream_messaging = types.ModuleType("omni.kit.livestream.messaging")
    omni_kit_livestream_messaging.register_event_type_to_send = lambda *args, **kwargs: None
    omni_kit_livestream.messaging = omni_kit_livestream_messaging
    omni_kit.livestream = omni_kit_livestream

    omni_usd = types.ModuleType("omni.usd")
    omni_usd.StageEventType = types.SimpleNamespace(OPENING=1, ASSETS_LOADED=2)
    omni_usd.get_context = lambda: types.SimpleNamespace(
        stage_event_name=lambda event_type: f"stage_event_{event_type}"
    )
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
from stage_loading import (  # noqa: E402
    LoadingManager,
    _http_stage_allowed_hosts,
)


def make_manager() -> LoadingManager:
    return LoadingManager.__new__(LoadingManager)


def test_stage_composition_takes_precedence_over_legacy_url():
    manager = make_manager()
    primary = {
        "artifact_id": "artifact_primary",
        "url": "http://127.0.0.1:49101/objects/primary.usdc",
        "load_order": 0,
    }
    secondary = {
        "artifact_id": "artifact_secondary",
        "url": "http://127.0.0.1:49101/objects/secondary.usdc",
        "load_order": 1,
    }

    url, context = manager._resolve_stage_request(
        {
            "url": primary["url"],
            "stage_composition": {
                "primary": primary,
                "secondary_layers": [secondary],
            },
        }
    )

    assert url == primary["url"]
    assert context["applied_mode"] == "stage_composition"
    assert context["applied_primary"]["artifact_id"] == "artifact_primary"
    assert context["secondary_bindings"][0]["artifact_id"] == "artifact_secondary"


def test_load_artifact_group_result_preserves_binding_revision(monkeypatch):
    manager = make_manager()
    primary = {
        "artifact_id": "artifact_primary",
        "url": "http://127.0.0.1:49101/objects/primary.usdc",
        "load_order": 0,
    }
    dispatched = []

    monkeypatch.setattr(
        stage_loading,
        "get_eventdispatcher",
        lambda: types.SimpleNamespace(
            dispatch_event=lambda name, payload: dispatched.append((name, payload))
        ),
    )
    monkeypatch.setattr(
        manager,
        "_on_open_stage",
        lambda event: dispatched.append(("openStageRequestDelegated", event.payload)),
    )

    manager._on_load_artifact_group(
        types.SimpleNamespace(
            payload={
                "role": "primary",
                "source_client_id": "viewer_lease_primary",
                "viewer_lease_token": "lease_token_primary",
                "session_id": "review_session_x",
                "binding_revision_id": "rev_binding_001",
                "stage_composition": {"primary": primary},
            }
        )
    )

    assert dispatched[0][0] == "loadArtifactGroupResult"
    assert dispatched[0][1]["result"] == "accepted"
    assert dispatched[0][1]["binding_revision_id"] == "rev_binding_001"
    assert dispatched[1][0] == "openStageRequestDelegated"
    assert dispatched[1][1]["binding_revision_id"] == "rev_binding_001"


def test_load_artifact_group_rejects_unauthorized_payload(monkeypatch):
    manager = make_manager()
    primary = {
        "artifact_id": "artifact_primary",
        "url": "http://127.0.0.1:49101/objects/primary.usdc",
        "load_order": 0,
    }
    dispatched = []

    monkeypatch.setattr(
        stage_loading,
        "get_eventdispatcher",
        lambda: types.SimpleNamespace(
            dispatch_event=lambda name, payload: dispatched.append((name, payload))
        ),
    )
    monkeypatch.setattr(
        manager,
        "_on_open_stage",
        lambda event: dispatched.append(("openStageRequestDelegated", event.payload)),
    )

    manager._on_load_artifact_group(
        types.SimpleNamespace(
            payload={
                # spectator role 且缺 session_id/viewer_lease_token,模擬 forged/spectator payload
                "role": "spectator",
                "source_client_id": "viewer_lease_spectator",
                "stage_composition": {"primary": primary},
            }
        )
    )

    assert len(dispatched) == 1
    assert dispatched[0][0] == "loadArtifactGroupResult"
    assert dispatched[0][1]["result"] == "error"
    assert dispatched[0][1]["error"] == "unauthorized_mutating_command"


def test_open_stage_rejects_unauthorized_payload(monkeypatch):
    manager = make_manager()
    dispatched = []

    monkeypatch.setattr(
        stage_loading,
        "get_eventdispatcher",
        lambda: types.SimpleNamespace(
            dispatch_event=lambda name, payload: dispatched.append((name, payload))
        ),
    )

    manager._on_open_stage(
        types.SimpleNamespace(
            payload={"url": "http://127.0.0.1:49101/objects/primary.usdc"}
        )
    )

    assert len(dispatched) == 1
    assert dispatched[0][0] == "openedStageResult"
    assert dispatched[0][1]["result"] == "error"
    assert dispatched[0][1]["error"] == "unauthorized_mutating_command"


def test_allowed_hosts_uses_env_var():
    # setUp: 還原用的原始值
    original = os.environ.get(_ALLOWED_STAGE_HOSTS_ENV)
    try:
        os.environ[_ALLOWED_STAGE_HOSTS_ENV] = "192.168.1.1:49101"
        assert _http_stage_allowed_hosts() == {"192.168.1.1:49101"}
    finally:
        # tearDown: 還原 os.environ 避免污染
        if original is None:
            os.environ.pop(_ALLOWED_STAGE_HOSTS_ENV, None)
        else:
            os.environ[_ALLOWED_STAGE_HOSTS_ENV] = original


def test_allowed_hosts_empty_env_falls_back():
    # setUp: 還原用的原始值
    original = os.environ.get(_ALLOWED_STAGE_HOSTS_ENV)
    try:
        os.environ[_ALLOWED_STAGE_HOSTS_ENV] = ""
        hosts = _http_stage_allowed_hosts()
        assert "127.0.0.1:49101" in hosts
        # 退役 _worker 的 :8005 不得留在內建預設
        assert not any(":8005" in host for host in hosts)
    finally:
        # tearDown: 還原 os.environ 避免污染
        if original is None:
            os.environ.pop(_ALLOWED_STAGE_HOSTS_ENV, None)
        else:
            os.environ[_ALLOWED_STAGE_HOSTS_ENV] = original
