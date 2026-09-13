"""Bounded, read-only native viewport measurement primitive; not a command handler.

The host must supply a fresh, trusted, nonblocking context reader
bound to the actual connection and source-backed policy. No caller payload
grants permission. scene_revision must change for in-place scene edits; polling
stage/camera snapshots alone cannot detect an edit-and-restore between reads.

Use on the viewport's owning asyncio loop. Native callbacks may arrive late:
they settle only their own pending Future, never mutate the scene or publish.
Async readers are awaited with the operation deadline; blocking I/O is
unsupported on this loop. The runtime adapter revalidates Coordinator policy
after native hits. No positive authority cache is permitted.
No Kit imports, network, global settings or import-time side effects.

Sources: NVIDIA Viewport API request_query(pixel, callback(path, pos, *args));
OpenUSD authored stage metersPerUnit (the unauthored 0.01 fallback is rejected).
Real Kit acceptance remains separate from deterministic primitive tests.
"""
import asyncio
import inspect
import math
import re
from collections import deque
from dataclasses import dataclass, fields


_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}\Z")


def _identifier(value):
    return isinstance(value, str) and _ID.fullmatch(value) is not None


def _finite(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


@dataclass(frozen=True)
class MeasurementContext:
    session_id: str
    client_id: str
    lease_id: str
    binding_id: str
    artifact_ids: tuple
    measurement_policy_id: str
    scene_revision: int
    approved: bool


@dataclass(frozen=True)
class _Scene:
    stage: object
    camera: str
    view: tuple
    projection: tuple
    resolution: tuple
    units: float
    time: object


class _Denied(Exception):
    pass


def _matrix(value):
    if len(value) != 4 or any(len(row) != 4 for row in value):
        raise _Denied("scene_unavailable")
    result = tuple(tuple(row) for row in value)
    if not all(_finite(item) for row in result for item in row):
        raise _Denied("scene_unavailable")
    return result


class DistanceMeasurementController:
    """One pending operation; no production authority or renderer mutations.

    Request IDs cannot be reused during this controller's lifetime. A fixed
    request budget bounds dedup memory; exhaustion fails closed and requires
    the host to dispose its controller (never silently evict IDs). Keep one
    controller per viewport lifetime: an abandoned native query must drain
    before replacement/reuse, or the actual viewport must be destroyed.
    history is bounded diagnostic status only, not a measurement report.
    """

    def __init__(self, viewport, context_reader=None, *, timeout_seconds=2.0,
                 history_limit=64, max_requests=256):
        if not _finite(timeout_seconds) or not 0 < timeout_seconds <= 30:
            raise ValueError("invalid_timeout")
        if type(history_limit) is not int or not 1 <= history_limit <= 256:
            raise ValueError("invalid_history_limit")
        if type(max_requests) is not int or not 4 <= max_requests <= 4096:
            raise ValueError("invalid_request_limit")
        self._viewport = viewport
        self._reader = context_reader
        self._timeout = timeout_seconds
        self._history = deque(maxlen=history_limit)
        self._seen = set()
        self._max_requests = max_requests
        self._generation = 0
        self._pending = None
        self._native_ticket = None
        self._context = None
        self._scene = None
        self._points = ()

    @property
    def history(self):
        return tuple(dict(item) for item in self._history)

    def _reply(self, request_id, status, **data):
        return {"request_id": request_id, "status": status,
                "generation": self._generation, **data}

    def _record(self, reply):
        self._history.append({key: reply[key] for key in
                              ("request_id", "status", "generation")})
        return reply

    def _discard(self):
        self._context = None
        self._scene = None
        self._points = ()

    def invalidate(self):
        """Local lifecycle cancellation; keep the native ticket until it drains."""
        self._generation += 1
        self._discard()
        if self._pending is not None:
            self._pending.cancel()

    @property
    def native_pending(self):
        return self._native_ticket is not None

    async def _read_context(self):
        if self._reader is None:
            raise _Denied("authority_unavailable")
        try:
            result = self._reader()
            if inspect.isawaitable(result):
                remaining = max(0, self._deadline - asyncio.get_running_loop().time())
                result = await asyncio.wait_for(result, timeout=remaining)
            if type(result) is not MeasurementContext or result.approved is not True:
                raise _Denied("authority_denied")
            if type(result.scene_revision) is not int or not 0 <= result.scene_revision < 2**63:
                raise _Denied("authority_denied")
            if not all(_identifier(getattr(result, field.name)) for field in
                       fields(result) if field.name not in ("approved", "scene_revision", "artifact_ids")):
                raise _Denied("authority_denied")
            if (not isinstance(result.artifact_ids, tuple) or not 1 <= len(result.artifact_ids) <= 256
                    or not all(_identifier(item) for item in result.artifact_ids)):
                raise _Denied("authority_denied")
            return result
        except _Denied:
            raise
        except Exception:
            raise _Denied("authority_unavailable") from None

    def _snapshot(self):
        try:
            viewport = self._viewport
            stage = viewport.stage
            if stage is None or stage.HasAuthoredMetadata("metersPerUnit") is not True:
                raise _Denied("units_unverified")
            units = stage.GetMetadata("metersPerUnit")
            if not _finite(units) or units <= 0:
                raise _Denied("units_unverified")
            resolution = tuple(viewport.resolution)
            if len(resolution) != 2 or any(type(n) is not int or n <= 0 for n in resolution):
                raise _Denied("scene_unavailable")
            camera = str(viewport.camera_path)
            if not camera.startswith("/") or len(camera) > 2048:
                raise _Denied("scene_unavailable")
            time = viewport.time
            if hasattr(time, "IsDefault"):
                time = "default" if time.IsDefault() else time.GetValue()
            if time != "default" and not _finite(time):
                raise _Denied("scene_unavailable")
            return _Scene(stage, camera, _matrix(viewport.view),
                          _matrix(viewport.projection), resolution, units, time)
        except _Denied:
            raise
        except Exception:
            raise _Denied("scene_unavailable") from None

    async def _check(self, generation):
        current = await self._read_context()
        if generation != self._generation:
            raise _Denied("cancelled")
        if current != self._context:
            raise _Denied("context_changed")
        if self._snapshot() != self._scene:
            raise _Denied("scene_changed")

    async def _start(self):
        self._context = await self._read_context()
        self._scene = self._snapshot()
        return {"status": "started", "meters_per_unit": self._scene.units}

    async def _pick(self, pixel, generation, deadline):
        await self._check(generation)
        if self._native_ticket is not None:
            raise _Denied("native_query_pending")
        resolution = self._scene.resolution
        if (not isinstance(pixel, (tuple, list)) or len(pixel) != 2
                or any(type(n) is not int for n in pixel)
                or not all(0 <= n < bound for n, bound in zip(pixel, resolution))):
            raise _Denied("invalid_pixel")
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        ticket = object()
        self._native_ticket = ticket
        self._pending = future

        def settle(path, position):
            # The native request cannot be withdrawn. Generation + Future state
            # make a late or duplicate completion a no-op.
            if self._native_ticket is not ticket:
                return
            self._native_ticket = None
            if generation == self._generation and not future.done():
                future.set_result((path, position))

        def completed(path, position, *_):
            # A native callback may arrive from a render thread. All Future and
            # ticket mutations remain on the owning loop, including late results.
            if not loop.is_closed():
                try:
                    loop.call_soon_threadsafe(settle, path, position)
                except RuntimeError:  # shutdown can close the loop after is_closed
                    pass

        try:
            self._viewport.request_query(tuple(pixel), completed)
        except Exception:
            # The API could have queued work before raising. Retain its ticket
            # until a callback proves completion; do not infer native teardown.
            future.cancel()
            raise _Denied("query_failed") from None
        try:
            path, position = await asyncio.wait_for(future, timeout=max(0, deadline - loop.time()))
        finally:
            if not future.done():
                future.cancel()
        await self._check(generation)
        if not path:
            raise _Denied("no_hit")
        try:
            if len(position) != 3 or not all(_finite(n) for n in position):
                raise _Denied("invalid_hit")
            point = tuple(float(n) for n in position)
        except (TypeError, ValueError, OverflowError):
            raise _Denied("invalid_hit") from None
        self._points = (*self._points, point)
        if len(self._points) == 1:
            return {"status": "point", "point": point, "point_index": 1}
        distance = math.dist(*self._points)
        metres = distance * self._scene.units
        if not _finite(distance) or not _finite(metres):
            raise _Denied("invalid_distance")
        return {"status": "result", "points": self._points, "meters_per_unit": self._scene.units,
                "distance_model_units": distance, "distance_metres": metres}

    async def execute(self, action, request_id, pixel=None):
        if not _identifier(request_id):
            return self._reply(None, "rejected", error="invalid_request")
        if request_id in self._seen:
            return self._reply(request_id, "rejected", error="duplicate_request")
        if action not in ("start", "pick", "cancel", "clear"):
            return self._reply(request_id, "rejected", error="invalid_action")
        if len(self._seen) >= self._max_requests:
            # Exhaustion must never leave a measurement publishable while
            # denying its cancellation. This also bounds repeated controls.
            self.invalidate()
            return self._reply(request_id, "rejected", error="request_limit")
        self._seen.add(request_id)
        if action in ("cancel", "clear"):
            self.invalidate()
            return self._record(self._reply(
                request_id, "cancelled" if action == "cancel" else "cleared"))
        if self._pending is not None:
            return self._record(self._reply(request_id, "rejected", error="busy"))
        if action == "pick" and (self._context is None or len(self._points) >= 2):
            return self._record(self._reply(request_id, "rejected", error="not_active"))
        if action == "start":
            self._generation += 1
            self._discard()
        generation = self._generation
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._timeout
        self._deadline = deadline
        try:
            async def operation():
                result = await self._start() if action == "start" else await self._pick(pixel, generation, deadline)
                await self._check(generation)
                return result
            result = await asyncio.wait_for(operation(), timeout=self._timeout)
            # In the publishing coroutine, after its LAST await. No task
            # handoff may occur between this live check and terminal reply.
            # wait_for hands control back once. The adapter reader performs fresh
            # bounded policy verification before the final local snapshot.
            await self._check(generation)
            if generation != self._generation or self._snapshot() != self._scene:
                raise _Denied("scene_changed")
            if loop.time() >= deadline:
                raise _Denied("timeout")
            reply = self._reply(request_id, **result)
        except asyncio.CancelledError:
            self._discard()
            reply = self._reply(request_id, "cancelled")
        except asyncio.TimeoutError:
            self._discard()
            reply = self._reply(request_id, "rejected", error="timeout")
        except _Denied as error:
            self._discard()
            reply = self._reply(request_id, "rejected", error=str(error))
        except Exception:
            self._discard()
            reply = self._reply(request_id, "rejected", error="measurement_unavailable")
        finally:
            self._pending = None
        return self._record(reply)
