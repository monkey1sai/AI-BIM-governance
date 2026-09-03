"""Make outbound runtime messages reach the connected viewer exactly once.

This module forwards each registered response type to the viewer by pushing
the wire message onto the app message bus itself. It deliberately does NOT
also call `omni.kit.livestream.messaging.register_event_type_to_send`: both
delivery paths work, and running them together duplicates every response.

Measured on an isolated real-Kit instance with a real WebRTC client (issue
#624 experiment C.2, 2026-08-20): with both paths registered, every request
produced exactly two identical responses at the client; with only this
module's push path, exactly one. The 2026-08-19 measurements that this module
originally encoded -- "registration alone delivers nothing, push alone
delivers nothing, both together deliver one" -- were experiment artifacts;
issue #624 has the full record. The client-side dedupe from #664 remains as
defence in depth, not as the primary duplicate control.

The wire shape is the one `LivestreamMessaging._on_message_to_send` produces,
because that is what the plugin and the browser streaming library expect.

The livestream extensions in this deployment are version-skewed --
`app`/`core`/`webrtc` are +110.0.0 builds while
`omni.kit.livestream.messaging-1.2.1` is a +109.0.0 build. If messaging is
ever aligned to a +110 build and the upstream helper is adopted instead,
re-measure single delivery first: switching back to the upstream path while
this push path is still registered reintroduces the duplicates.

Delivery channel (issue #757, canonical-linux 181, 2026-09-03): with the
+110 livestream plugin the legacy `get_message_bus_event_stream().push(...)`
never reaches the native sender -- Kit logged every `loadingStateResponse`
dispatch while the browser received zero DataChannel events in 15 s. The
upstream `LivestreamMessaging._on_message_to_send` hands the wire message to
`omni.kit.app.queue_event(send_message_event, {...})`, which the plugin does
consume, so this module queues through the same API and keeps the legacy
push only as a fallback for Kit builds without `queue_event`. Still exactly
one path per message: the queue call replaces the push, it is never added to it.
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


def _deliver(envelope: dict) -> str:
    """Hand one wire envelope to the livestream plugin; returns the channel used.

    `omni.kit.app.queue_event` is the channel the upstream messaging extension
    uses for the very same event name, and the only one the +110 plugin reads
    (#757). The legacy message-bus push stays as the fallback for older Kit
    builds that predate `queue_event`.
    """
    queue_event = getattr(omni.kit.app, "queue_event", None)
    if callable(queue_event):
        queue_event(_SEND_MESSAGE_EVENT, envelope)
        return "queue_event"
    omni.kit.app.get_app().get_message_bus_event_stream().push(
        carb.events.type_from_string(_SEND_MESSAGE_EVENT),
        payload=envelope,
    )
    return "message_bus_push"


def register_event_type_to_send(event_type: str):
    """Register `event_type` for sending and forward it; returns the subscription.

    The caller must keep the returned handle alive -- dropping it unsubscribes.

    Single-path on purpose: no `messaging.register_event_type_to_send` call
    here -- that second path duplicates every response (issue #624, C.2).
    """

    def _forward(event) -> None:
        try:
            wire = json.dumps({"event_type": event_type, "payload": _wire_payload(event.payload)})
        except (TypeError, ValueError):
            # Never let one unserialisable response silently strand the viewer:
            # say which event type was dropped, but not the payload, which can
            # carry session/trace identifiers.
            carb.log_error(f"[client-send] {event_type} payload is not serialisable; dropped")
            return
        _deliver({"message": wire, "sender_id": _sender_id()})

    return get_eventdispatcher().observe_event(
        observer_name=f"BimReviewClientSend:{event_type}",
        event_name=event_type,
        on_event=_forward,
    )
