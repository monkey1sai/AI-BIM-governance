"""client_send_bridge must stay single-path.

Issue #624 experiment C.2 (2026-08-20, isolated real Kit + real WebRTC client)
measured that the upstream `omni.kit.livestream.messaging` registration and
this module's message-bus push each deliver one copy per response: registering
both duplicates every response at the client. These tests pin the single-path
shape so the upstream call cannot quietly come back.
"""

import json
import sys
import types
from pathlib import Path

import pytest


def install_bridge_stubs():
    class DummyItem:
        def get_dict(self):
            return {}

    calls = types.SimpleNamespace(
        upstream_register=[],
        observe_kwargs=[],
        pushes=[],
        log_errors=[],
    )

    carb = types.ModuleType("carb")
    carb_dictionary = types.ModuleType("carb.dictionary")
    carb_dictionary.Item = DummyItem
    carb.dictionary = carb_dictionary
    carb.log_error = lambda *args, **kwargs: calls.log_errors.append(args)
    carb.log_info = lambda *args, **kwargs: None
    carb.log_warn = lambda *args, **kwargs: None

    carb_events = types.ModuleType("carb.events")
    carb_events.IEvent = object
    carb_events.type_from_string = lambda value: f"type:{value}"
    carb.events = carb_events

    carb_eventdispatcher = types.ModuleType("carb.eventdispatcher")

    def observe_event(**kwargs):
        calls.observe_kwargs.append(kwargs)
        return object()

    carb_eventdispatcher.get_eventdispatcher = lambda: types.SimpleNamespace(
        observe_event=observe_event
    )

    omni = types.ModuleType("omni")
    omni_kit = types.ModuleType("omni.kit")
    omni_kit_app = types.ModuleType("omni.kit.app")

    def push(event_type, payload=None):
        calls.pushes.append({"event_type": event_type, "payload": payload})

    omni_kit_app.get_app = lambda: types.SimpleNamespace(
        get_message_bus_event_stream=lambda: types.SimpleNamespace(push=push)
    )
    omni_kit.app = omni_kit_app

    omni_kit_livestream = types.ModuleType("omni.kit.livestream")
    omni_kit_livestream_messaging = types.ModuleType("omni.kit.livestream.messaging")
    omni_kit_livestream_messaging.register_event_type_to_send = (
        lambda *args, **kwargs: calls.upstream_register.append(args)
    )
    omni_kit_livestream_messaging.LivestreamMessaging = types.SimpleNamespace(
        instance=types.SimpleNamespace(_sender_id=7)
    )
    omni_kit_livestream.messaging = omni_kit_livestream_messaging
    omni_kit.livestream = omni_kit_livestream
    omni.kit = omni_kit

    sys.modules.update(
        {
            "carb": carb,
            "carb.dictionary": carb_dictionary,
            "carb.events": carb_events,
            "carb.eventdispatcher": carb_eventdispatcher,
            "omni": omni,
            "omni.kit": omni_kit,
            "omni.kit.app": omni_kit_app,
            "omni.kit.livestream": omni_kit_livestream,
            "omni.kit.livestream.messaging": omni_kit_livestream_messaging,
        }
    )
    return calls


CALLS = install_bridge_stubs()

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

import client_send_bridge  # noqa: E402


@pytest.fixture(autouse=True)
def reset_calls():
    CALLS.upstream_register.clear()
    CALLS.observe_kwargs.clear()
    CALLS.pushes.clear()
    CALLS.log_errors.clear()


def test_upstream_registration_is_never_called():
    client_send_bridge.register_event_type_to_send("loadingStateResponse")
    assert CALLS.upstream_register == [], (
        "client_send_bridge must not call "
        "omni.kit.livestream.messaging.register_event_type_to_send: both paths "
        "deliver, so registering both duplicates every response (issue #624 C.2)"
    )


def test_push_half_still_registers_and_forwards_wire_shape():
    handle = client_send_bridge.register_event_type_to_send("commandRejected")
    assert handle is not None

    assert len(CALLS.observe_kwargs) == 1
    observed = CALLS.observe_kwargs[0]
    assert observed["event_name"] == "commandRejected"
    assert observed["observer_name"] == "BimReviewClientSend:commandRejected"

    event = types.SimpleNamespace(
        payload={"request_id": "c2-01", "_Event": None}
    )
    observed["on_event"](event)

    assert len(CALLS.pushes) == 1
    pushed = CALLS.pushes[0]
    assert pushed["event_type"] == "type:omni.kit.livestream.send_message"
    assert pushed["payload"]["sender_id"] == 7
    wire = json.loads(pushed["payload"]["message"])
    assert wire == {
        "event_type": "commandRejected",
        "payload": {"request_id": "c2-01"},
    }


def test_unserialisable_payload_is_dropped_not_pushed():
    client_send_bridge.register_event_type_to_send("loadingStateResponse")
    on_event = CALLS.observe_kwargs[0]["on_event"]

    on_event(types.SimpleNamespace(payload={"bad": object()}))

    assert CALLS.pushes == []
    assert len(CALLS.log_errors) == 1
