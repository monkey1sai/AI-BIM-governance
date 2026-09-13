"""Async, source-policy-bound adapter for temporary viewport distance readings.

Only native request_query supplies world points. No USD or renderer writes.
The owner event loop retains one primitive and its outstanding native ticket.
"""
import asyncio
import hashlib
import hmac
import re

try:
    from .distance_measurement import DistanceMeasurementController, MeasurementContext
except ImportError:  # CPU tests
    from distance_measurement import DistanceMeasurementController, MeasurementContext


_ID = re.compile(r"[A-Za-z0-9_-]{1,100}\Z")


class MeasurementRuntime:
    def __init__(self, viewport, authority, trace_context, revision):
        self.viewport = viewport
        self.authority = authority
        self.trace = trace_context
        self.revision = revision
        self.controller = None
        self.owner = None
        self.pending_owner = None
        self.busy = False
        self.cancelling = False
        self.closed = False
        self.epoch = 0
        # A cancelled await does not kill a worker. Keep the worker tracked and
        # refuse another until it has actually finished; never queue unbounded I/O.
        self.authority_task = None

    def invalidate(self):
        self.epoch += 1
        if self.controller is not None:
            self.controller.invalidate()

    def close(self):
        self.closed = True
        self.invalidate()

    def _local(self):
        return (self.epoch, self.revision(), self.trace.active_stage(), self.trace.active_binding(), self.viewport.stage)

    @staticmethod
    def _owner(payload):
        token = payload.get("viewer_lease_token") or payload.get("lease_token")
        if not isinstance(token, str) or not token or len(token) > 16384:
            raise ValueError("authority_denied")
        return (payload.get("session_id"), payload.get("source_client_id"),
                hashlib.sha256(token.encode()).digest())

    def _same_owner(self, owner):
        return self.owner is not None and self.owner[:2] == owner[:2] and hmac.compare_digest(self.owner[2], owner[2])

    def cancel_local(self, payload):
        """Provisional identity can only cancel its own work, never grant a hit."""
        if payload.get("action") not in ("cancel", "clear"):
            return False
        try:
            owner = self._owner(payload)
        except ValueError:
            return False
        pending = self.pending_owner
        owned = self._same_owner(owner) and getattr(self, "measurement_id", None) == payload.get("measurement_id")
        pending_owned = (pending is not None and pending[:2] == owner[:2]
            and hmac.compare_digest(pending[2], owner[2]) and pending[3] == payload.get("measurement_id"))
        if not owned and not pending_owned:
            return False
        self.invalidate()
        return True

    async def _grant(self, payload):
        before = self._local()
        if self.closed or self.authority_task is not None and not self.authority_task.done():
            raise ValueError("authority_busy")
        self.authority_task = asyncio.create_task(asyncio.to_thread(self.authority.authorize, "measurementRequest", payload))
        decision = await asyncio.wait_for(asyncio.shield(self.authority_task), timeout=1.0)
        if self.closed or before != self._local():
            raise ValueError("context_changed")
        if not decision.authorized:
            raise ValueError("authority_denied")
        data = decision.data.get("measurement_context")
        if not isinstance(data, dict) or data.get("policy_id") != "primary-lease-distance-v1":
            raise ValueError("policy_unavailable")
        if (data.get("session_id") != payload.get("session_id")
                or data.get("client_id") != payload.get("source_client_id")
                or self.trace.active_stage() != (data.get("session_id"), payload.get("trace_id"))
                or not self.trace.active_binding() or data.get("binding_id") != self.trace.active_binding()):
            raise ValueError("context_changed")
        artifacts = data.get("artifact_ids")
        if not isinstance(artifacts, list):
            raise ValueError("policy_unavailable")
        return MeasurementContext(session_id=data.get("session_id"), client_id=data.get("client_id"),
            lease_id=data.get("lease_id"), binding_id=data.get("binding_id"), artifact_ids=tuple(artifacts),
            measurement_policy_id=data["policy_id"], scene_revision=self.revision(), approved=True)

    async def execute(self, payload):
        request_id = payload.get("request_id")
        measurement_id = payload.get("measurement_id")
        action = payload.get("action")
        def reply(status="rejected", **data):
            return {"request_id": request_id, "measurement_id": measurement_id, "status": status, **data}
        if not isinstance(measurement_id, str) or not _ID.fullmatch(measurement_id):
            return reply(error="invalid_request")
        if action not in ("start", "pick", "cancel", "clear"):
            return reply(error="invalid_action")
        try:
            owner = self._owner(payload)
        except ValueError:
            return reply(error="authority_denied")
        if action in ("cancel", "clear"):
            if not self.cancel_local(payload):
                return reply(error="authority_denied")
            if self.cancelling:
                return reply(error="busy")
            self.cancelling = True
            try:
                # Existing I/O is bounded and cannot be killed. Cancellation is
                # already effective; return a refusal if fresh policy is unavailable.
                await self._grant(payload)
                return reply("cancelled" if action == "cancel" else "cleared")
            except Exception:
                return reply(error="authority_denied")
            finally:
                self.cancelling = False
        if self.busy or self.cancelling or self.closed:
            return reply(error="busy")
        if self.owner is not None and not self._same_owner(owner):
            # A new lease may start after fresh server verification, but cannot
            # pick points belonging to another controller owner.
            if action != "start":
                return reply(error="authority_denied")
        if action == "pick" and getattr(self, "measurement_id", None) != measurement_id:
            return reply(error="not_active")
        self.busy = True
        self.pending_owner = (*owner, measurement_id)
        before = self._local()
        try:
            grant = await self._grant(payload)
            if before != self._local():
                raise ValueError("context_changed")
            if action == "start":
                if self.controller is not None and self.controller.native_pending:
                    return reply(error="native_query_pending")
                self.owner = owner
                self.measurement_id = measurement_id
            async def reader():
                current = await self._grant(payload)
                if current != grant or before != self._local():
                    raise ValueError("context_changed")
                return current
            if self.controller is None:
                self.controller = DistanceMeasurementController(self.viewport, reader, timeout_seconds=4.0, max_requests=4096)
            else:
                self.controller._reader = reader
            pixel = None
            if action == "pick":
                uv = payload.get("uv")
                if (not isinstance(uv, (list, tuple)) or len(uv) != 2
                        or any(type(n) not in (int, float) or not 0 <= n <= 1 for n in uv)):
                    raise ValueError("invalid_pixel")
                # NDC mapping is owned by the actual rendered ViewportTexture.
                pixel, inside = self.viewport.map_ndc_to_texture_pixel((2 * uv[0] - 1, 1 - 2 * uv[1]))
                if not inside:
                    raise ValueError("invalid_pixel")
                pixel = tuple(pixel)
            result = await self.controller.execute(action, request_id, pixel)
            # execute's completion is another await boundary. Revalidate before
            # publishing a successful world reading, then compare local state.
            if result["status"] in ("started", "point", "result"):
                current = await self._grant(payload)
                if current != grant or before != self._local() or self.controller._snapshot() != self.controller._scene:
                    raise ValueError("context_changed")
            return {**result, "measurement_id": measurement_id}
        except asyncio.CancelledError:
            self.invalidate()
            return reply("cancelled")
        except Exception:
            self.invalidate()
            return reply(error="measurement_unavailable")
        finally:
            self.busy = False
            self.pending_owner = None
