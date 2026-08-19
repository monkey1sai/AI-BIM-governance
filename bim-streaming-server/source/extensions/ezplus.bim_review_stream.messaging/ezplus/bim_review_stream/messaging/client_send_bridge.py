"""Make outbound runtime messages actually reach the connected viewer.

`omni.kit.livestream.messaging.register_event_type_to_send` observes the event
on carb's Events 2.0 dispatcher and forwards it with `omni.kit.app.queue_event`.
On this deployment that registration alone never delivers: measured end to end
against the real Kit, the handler runs, the trace gate passes, `dispatch_event`
fires observers, and the upstream extension serialises the message correctly and
hands it over -- and the browser receives nothing at all, for every response
type, so a viewer's runtime commands hang forever.

Pushing the same wire message onto the app message bus alongside that
registration does deliver it. Measured, both together deliver exactly one copy
per response, not two -- six `loadingStateQuery` round trips produced six
`loadingStateResponse` messages at the client. Neither half works on its own:
the registration without the push delivers nothing, and the push without the
registration also delivers nothing, so both are kept deliberately. The wire
shape is the one `LivestreamMessaging._on_message_to_send` produces, because
that is what the plugin and the browser streaming library expect.

Why one copy rather than two is not established here; only that this pairing is
what makes the product's runtime responses arrive. The livestream extensions in
this deployment are version-skewed -- `app`/`core`/`webrtc` are +110.0.0 builds
while `omni.kit.livestream.messaging-1.2.1` is a +109.0.0 build -- so aligning
messaging to a +110 build is the upstream thing to try. Once responses arrive
without this module, delete it and call the upstream helper directly.
"""

import json

import carb
import carb.dictionary
import carb.events
import omni.kit.app
import omni.kit.livestream.messaging as messaging
from carb.eventdispatcher import get_eventdispatcher

# Owned by omni.kit.livestream.messaging's `send_message_event` setting; the
# native plugin subscribes to this exact name.
_SEND_MESSAGE_EVENT = "omni.kit.livestream.send_message"


def _sender_id() -> int:
    """The livestream sender id, so the extension skips its own feedback loop."""
    livestream = getattr(messaging, "LivestreamMessaging", None)
    instance = getattr(livestream, "instance", None)
    return getattr(instance, "_sender_id", 0)


def _wire_payload(payload) -> dict:
    return {
        key: value.get_dict() if isinstance(value, carb.dictionary.Item) else value
        for key, value in dict(payload).items()
        if not (key == "_Event" and value is None)
    }


def register_event_type_to_send(event_type: str):
    """Register `event_type` for sending and forward it; returns the subscription.

    The caller must keep the returned handle alive -- dropping it unsubscribes.
    """

    messaging.register_event_type_to_send(event_type)

    def _forward(event) -> None:
        try:
            wire = json.dumps({"event_type": event_type, "payload": _wire_payload(event.payload)})
        except (TypeError, ValueError):
            # Never let one unserialisable response silently strand the viewer:
            # say which event type was dropped, but not the payload, which can
            # carry session/trace identifiers.
            carb.log_error(f"[client-send] {event_type} payload is not serialisable; dropped")
            return
        omni.kit.app.get_app().get_message_bus_event_stream().push(
            carb.events.type_from_string(_SEND_MESSAGE_EVENT),
            payload={"message": wire, "sender_id": _sender_id()},
        )

    return get_eventdispatcher().observe_event(
        observer_name=f"BimReviewClientSend:{event_type}",
        event_name=event_type,
        on_event=_forward,
    )
