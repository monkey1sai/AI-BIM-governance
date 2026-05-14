import sys
import types
from pathlib import Path


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

from stage_loading import LoadingManager  # noqa: E402


def make_manager() -> LoadingManager:
    return LoadingManager.__new__(LoadingManager)


def test_stage_composition_takes_precedence_over_legacy_url():
    manager = make_manager()
    primary = {
        "artifact_id": "artifact_primary",
        "url": "http://127.0.0.1:8005/objects/primary.usdc",
        "load_order": 0,
    }
    secondary = {
        "artifact_id": "artifact_secondary",
        "url": "http://127.0.0.1:8005/objects/secondary.usdc",
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
