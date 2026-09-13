"""Deterministic DI checks, not installed Kit or measurement acceptance."""
import asyncio
import copy
import sys
from dataclasses import replace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from distance_measurement import DistanceMeasurementController, MeasurementContext


class Stage:
    def __init__(self, units=0.01, authored=True):
        self.units = units
        self.authored = authored

    def HasAuthoredMetadata(self, key):
        assert key == "metersPerUnit"
        return self.authored

    def GetMetadata(self, key):
        assert key == "metersPerUnit"
        return self.units


class Viewport:
    def __init__(self):
        self.stage = Stage()
        self.camera_path = "/Camera"
        self.view = [[float(i == j) for j in range(4)] for i in range(4)]
        self.projection = copy.deepcopy(self.view)
        self.resolution = (640, 480)
        self.time = 0.0
        self.callbacks = []
        self.pixels = []
        self.raise_query = False

    def request_query(self, pixel, callback):
        if self.raise_query:
            raise RuntimeError("secret USD path/token")
        self.pixels.append(pixel)
        self.callbacks.append(callback)


def context():
    return MeasurementContext(
        session_id="session-1", client_id="client-1", lease_id="lease-1",
        binding_id="binding-1", artifact_ids=("artifact-1",),
        measurement_policy_id="policy-1", scene_revision=1, approved=True,
    )


class Authority:
    def __init__(self):
        self.current = context()
        self.reads = 0
        self.on_read = None

    def __call__(self):
        self.reads += 1
        if self.on_read:
            self.on_read(self)
        return self.current


async def until_query(viewport, count):
    for _ in range(100):
        if len(viewport.callbacks) == count:
            return
        await asyncio.sleep(0)
    pytest.fail("query never scheduled")


async def hit(controller, viewport, request_id, point):
    count = len(viewport.callbacks) + 1
    task = asyncio.create_task(controller.execute("pick", request_id, (10, 20)))
    await until_query(viewport, count)
    viewport.callbacks[-1]("/World/Mesh", point, "native extra argument")
    return await task


def test_native_hits_compute_world_distance_and_preserve_scene():
    async def scenario():
        viewport, authority = Viewport(), Authority()
        original = copy.deepcopy(viewport.__dict__)
        controller = DistanceMeasurementController(viewport, authority)
        assert (await controller.execute("start", "start-1"))["status"] == "started"
        first = await hit(controller, viewport, "point-1", (0, 0, 0))
        assert first["status"] == "point"
        result = await hit(controller, viewport, "point-2", (300, 400, 1200))
        assert result["status"] == "result"
        assert result["distance_model_units"] == 1300
        assert result["distance_metres"] == 13
        assert result["points"] == ((0.0, 0.0, 0.0), (300.0, 400.0, 1200.0))
        assert viewport.pixels == [(10, 20), (10, 20)]
        assert authority.reads >= 8
        assert viewport.camera_path == original["camera_path"]
        assert viewport.view == original["view"]
        assert viewport.projection == original["projection"]
        assert viewport.stage.units == original["stage"].units
        assert (await controller.execute("pick", "third", (1, 2)))["error"] == "not_active"
    asyncio.run(scenario())


@pytest.mark.parametrize("units,authored", [
    (0.01, False), (None, True), (0, True), (-1, True), (True, True),
    (float("nan"), True), (float("inf"), True), ("0.01", True),
])
def test_unknown_or_invalid_units_never_query(units, authored):
    async def scenario():
        viewport = Viewport()
        viewport.stage = Stage(units, authored)
        result = await DistanceMeasurementController(viewport, Authority()).execute("start", "start")
        assert result["status"] == "rejected"
        assert not viewport.callbacks
    asyncio.run(scenario())


def test_default_deny_and_caller_cannot_supply_grants():
    async def scenario():
        viewport = Viewport()
        controller = DistanceMeasurementController(viewport)
        assert (await controller.execute("start", "start"))["error"] == "authority_unavailable"
        assert not viewport.callbacks
        with pytest.raises(TypeError):
            await controller.execute("start", "forged", context=context())
    asyncio.run(scenario())


@pytest.mark.parametrize("field,value", [
    ("approved", False), ("approved", 1), ("session_id", ""),
    ("lease_id", "../bad"), ("binding_id", None), ("client_id", "x" * 257),
    ("artifact_ids", ("\n",)), ("artifact_ids", ()),
    ("artifact_ids", ["artifact-1"]), ("measurement_policy_id", ""),
    ("scene_revision", -1), ("scene_revision", True),
])
def test_malformed_trusted_context_denies(field, value):
    async def scenario():
        authority = Authority()
        authority.current = replace(authority.current, **{field: value})
        result = await DistanceMeasurementController(Viewport(), authority).execute("start", "start")
        assert result["status"] == "rejected"
    asyncio.run(scenario())


@pytest.mark.parametrize("pixel", [None, (1,), (1, 2, 3), (True, 2), (-1, 0), (640, 0), (0, 480), (1.2, 2), ("1", 2), {"x": 1, "y": 2}])
def test_malformed_pixels_cannot_start_query(pixel):
    async def scenario():
        viewport = Viewport()
        controller = DistanceMeasurementController(viewport, Authority())
        await controller.execute("start", "start")
        result = await controller.execute("pick", "bad-pixel", pixel)
        assert result["error"] == "invalid_pixel"
        assert not viewport.callbacks
    asyncio.run(scenario())


@pytest.mark.parametrize("request_id", [None, "", True, "../id", "a b", "a" * 257])
def test_malformed_request_id_is_not_echoed(request_id):
    async def scenario():
        result = await DistanceMeasurementController(Viewport(), Authority()).execute("start", request_id)
        assert result["error"] == "invalid_request"
        assert result["request_id"] is None
    asyncio.run(scenario())


@pytest.mark.parametrize("drift", ["stage", "camera", "view", "projection", "resolution", "units", "time", "lease", "binding", "artifact", "policy", "revision", "revoked"])
def test_drift_while_query_pending_rejects_and_discards_points(drift):
    async def scenario():
        viewport, authority = Viewport(), Authority()
        controller = DistanceMeasurementController(viewport, authority)
        await controller.execute("start", "start")
        await hit(controller, viewport, "first", (1, 2, 3))
        task = asyncio.create_task(controller.execute("pick", "second", (10, 20)))
        await until_query(viewport, 2)
        if drift == "stage":
            viewport.stage = Stage()
        elif drift == "camera":
            viewport.camera_path = "/OtherCamera"
        elif drift in ("view", "projection"):
            getattr(viewport, drift)[0][0] = 2
        elif drift == "resolution":
            viewport.resolution = (800, 600)
        elif drift == "units":
            viewport.stage.units = 1
        elif drift == "time":
            viewport.time = 1.0
        else:
            field = {"lease": "lease_id", "binding": "binding_id",
                     "artifact": "artifact_ids", "policy": "measurement_policy_id",
                     "revision": "scene_revision", "revoked": "approved"}[drift]
            value = False if field == "approved" else 2 if field == "scene_revision" else "changed"
            if field == "artifact_ids":
                value = ("changed",)
            authority.current = replace(authority.current, **{field: value})
        viewport.callbacks[-1]("/Mesh", (4, 5, 6))
        result = await task
        assert result["status"] == "rejected"
        assert "distance_metres" not in result
        assert (await controller.execute("pick", "next", (2, 3)))["error"] == "not_active"
    asyncio.run(scenario())


@pytest.mark.parametrize("path,point", [("", (1, 2, 3)), (None, (1, 2, 3)), ("/Mesh", None), ("/Mesh", [1, 2]), ("/Mesh", [True, 2, 3]), ("/Mesh", [1, 2, float("nan")]), ("/Mesh", [1, 2, float("inf")])])
def test_miss_or_invalid_world_point_never_publishes_distance(path, point):
    async def scenario():
        viewport = Viewport()
        controller = DistanceMeasurementController(viewport, Authority())
        await controller.execute("start", "start")
        task = asyncio.create_task(controller.execute("pick", "point", (1, 2)))
        await until_query(viewport, 1)
        viewport.callbacks[-1](path, point)
        result = await task
        assert result["status"] == "rejected"
        assert "distance_metres" not in result
    asyncio.run(scenario())


def test_final_publication_has_no_task_handoff_after_live_context_check():
    async def direct():
        viewport, authority = Viewport(), Authority()
        controller = DistanceMeasurementController(viewport, authority)
        await controller.execute("start", "start")
        await hit(controller, viewport, "first", (0, 0, 0))
        before = authority.reads
        def revoke_next_tick(reader):
            if reader.reads == before + 3:
                asyncio.get_running_loop().call_soon(
                    lambda: setattr(reader, "current", replace(reader.current, approved=False)))
        authority.on_read = revoke_next_tick
        async def deliver():
            await until_query(viewport, 2)
            viewport.callbacks[-1]("/Mesh", (3, 4, 0))
        delivery = asyncio.create_task(deliver())
        result = await controller.execute("pick", "second", (1, 2))
        await delivery
        assert result["status"] != "result" or authority.current.approved is True
    asyncio.run(direct())


@pytest.mark.parametrize("action", ["timeout", "cancel"])
def test_native_inflight_is_retained_until_callback_after_abandonment(action):
    async def scenario():
        viewport = Viewport()
        controller = DistanceMeasurementController(viewport, Authority(), timeout_seconds=0.1)
        await controller.execute("start", "start")
        task = asyncio.create_task(controller.execute("pick", "old", (1, 2)))
        await until_query(viewport, 1)
        old_callback = viewport.callbacks[-1]
        if action == "cancel":
            await controller.execute("cancel", "cancel")
        await task
        await controller.execute("start", "start2")
        denied = await controller.execute("pick", "new", (3, 4))
        assert denied["error"] == "native_query_pending"
        assert len(viewport.callbacks) == 1
        old_callback("/Mesh", (10, 20, 30))
        await controller.execute("start", "start3")
        assert (await hit(controller, viewport, "after-drain", (0, 0, 0)))["status"] == "point"
    asyncio.run(scenario())


def test_quota_exhaustion_cannot_block_cancellation_and_publish():
    async def scenario():
        viewport = Viewport()
        controller = DistanceMeasurementController(viewport, Authority(), max_requests=4)
        await controller.execute("start", "start")
        await hit(controller, viewport, "first", (0, 0, 0))
        task = asyncio.create_task(controller.execute("pick", "second", (1, 2)))
        await until_query(viewport, 2)
        await controller.execute("pick", "busy", (3, 4))
        await controller.execute("cancel", "cancel")
        viewport.callbacks[-1]("/Mesh", (3, 4, 0))
        assert (await task)["status"] != "result"
    asyncio.run(scenario())


def test_async_cancellation_resistant_authority_cannot_publish_after_deadline():
    async def scenario():
        entered = []
        async def unsupported_reader():
            entered.append(True)
            try:
                await asyncio.sleep(0.2)
            except asyncio.CancelledError:
                return context()
        controller = DistanceMeasurementController(Viewport(), unsupported_reader, timeout_seconds=0.1)
        result = await controller.execute("start", "start")
        assert result["status"] == "rejected"
        assert entered
    asyncio.run(scenario())



@pytest.mark.parametrize("action", ["cancel", "clear"])
def test_cancel_clear_and_late_duplicate_callback_have_one_terminal(action):
    async def scenario():
        viewport = Viewport()
        controller = DistanceMeasurementController(viewport, Authority())
        await controller.execute("start", "start")
        pending = asyncio.create_task(controller.execute("pick", "point", (1, 2)))
        await until_query(viewport, 1)
        callback = viewport.callbacks[-1]
        busy = await controller.execute("pick", "busy", (2, 3))
        assert busy["error"] == "busy"
        await controller.execute(action, "control")
        assert (await pending)["status"] == "cancelled"
        callback("/Mesh", (1, 2, 3))
        callback("/Mesh", (4, 5, 6))
        assert sum(item["request_id"] == "point" for item in controller.history) == 1
        await controller.execute("start", "new-start")
        callback("/Mesh", (7, 8, 9))
        result = await hit(controller, viewport, "new-point", (0, 0, 0))
        assert result["status"] == "point"
    asyncio.run(scenario())


def test_timeout_exception_zero_distance_and_bounded_history():
    async def scenario():
        viewport = Viewport()
        # Windows timer resolution may exceed 10ms even for immediately ready tasks.
        controller = DistanceMeasurementController(viewport, Authority(), timeout_seconds=0.1, history_limit=3)
        assert (await controller.execute("start", "start"))["status"] == "started"
        timeout = await controller.execute("pick", "timeout", (1, 2))
        assert timeout["error"] == "timeout"
        viewport.callbacks[-1]("/Mesh", (1, 2, 3))
        await asyncio.sleep(0)  # native callback now marshals onto the owning loop
        await controller.execute("start", "start2")
        viewport.raise_query = True
        failed = await controller.execute("pick", "exception", (1, 2))
        assert failed["error"] == "query_failed"
        assert "secret" not in repr(failed)
        # An exception does not prove native teardown. A new fixture represents
        # actual viewport destruction, not clearing the old in-flight ticket.
        viewport = Viewport()
        controller = DistanceMeasurementController(viewport, Authority(), history_limit=3)
        await controller.execute("start", "start3")
        await hit(controller, viewport, "first", (1, 2, 3))
        zero = await hit(controller, viewport, "second", (1, 2, 3))
        assert zero["distance_metres"] == 0
        assert len(controller.history) == 3
        assert all("points" not in item for item in controller.history)
    asyncio.run(scenario())


def test_final_async_authority_check_uses_remaining_deadline():
    async def scenario():
        reads = 0
        async def reader():
            nonlocal reads
            reads += 1
            if reads == 3:
                await asyncio.Event().wait()
            return context()
        controller = DistanceMeasurementController(Viewport(), reader, timeout_seconds=0.05)
        result = await asyncio.wait_for(controller.execute("start", "start"), timeout=0.5)
        assert result["status"] == "rejected" and "distance_metres" not in result
    asyncio.run(scenario())


def test_native_callback_from_worker_thread_settles_on_owner_loop():
    async def scenario():
        viewport = Viewport()
        controller = DistanceMeasurementController(viewport, Authority())
        await controller.execute("start", "start")
        task = asyncio.create_task(controller.execute("pick", "pick", (10, 10)))
        await until_query(viewport, 1)
        await asyncio.to_thread(viewport.callbacks[0], "/World/Wall", (1, 2, 3))
        assert (await task)["status"] == "point"
    asyncio.run(scenario())


def test_exception_after_queue_retains_native_ticket_until_callback():
    async def scenario():
        viewport = Viewport()
        native = viewport.request_query
        def queued_then_raise(pixel, callback):
            native(pixel, callback)
            raise RuntimeError("private native detail")
        viewport.request_query = queued_then_raise
        controller = DistanceMeasurementController(viewport, Authority())
        await controller.execute("start", "start")
        assert (await controller.execute("pick", "first", (1, 2)))["error"] == "query_failed"
        await controller.execute("start", "restart")
        assert (await controller.execute("pick", "blocked", (1, 2)))["error"] == "native_query_pending"
        viewport.callbacks[-1]("/Mesh", (1, 2, 3))
        viewport.request_query = native
        await controller.execute("start", "after-drain")
        assert (await hit(controller, viewport, "point", (0, 0, 0)))["status"] == "point"
    asyncio.run(scenario())


def test_duplicate_request_and_exhaustion_keep_bounded_memory():
    async def scenario():
        viewport = Viewport()
        controller = DistanceMeasurementController(viewport, Authority(), max_requests=4, history_limit=2)
        for number in range(4):
            await controller.execute("start", "start-" + str(number))
        assert (await controller.execute("start", "start-0"))["error"] == "duplicate_request"
        for number in range(20):
            assert (await controller.execute("start", "overflow-" + str(number)))["error"] == "request_limit"
        assert len(controller._seen) == 4
        assert len(controller.history) == 2
        history = controller.history
        history[0]["status"] = "forged"
        assert controller.history[0]["status"] != "forged"
    asyncio.run(scenario())


@pytest.mark.parametrize("kwargs", [
    {"timeout_seconds": 0}, {"timeout_seconds": float("nan")}, {"timeout_seconds": True},
    {"history_limit": 0}, {"history_limit": True}, {"max_requests": 4097},
])
def test_invalid_resource_limits_reject(kwargs):
    with pytest.raises(ValueError):
        DistanceMeasurementController(Viewport(), Authority(), **kwargs)


def test_prepublication_revocation_denies_after_two_valid_hits():
    async def scenario():
        viewport, authority = Viewport(), Authority()
        controller = DistanceMeasurementController(viewport, authority)
        await controller.execute("start", "start")
        await hit(controller, viewport, "first", (0, 0, 0))
        def revoke(reader):
            # Second pick pre-query, post-query then final publication read.
            if reader.reads == before + 3:
                reader.current = replace(reader.current, approved=False)
        before = authority.reads
        authority.on_read = revoke
        result = await hit(controller, viewport, "second", (3, 4, 0))
        assert result["status"] == "rejected"
        assert "distance_metres" not in result
    asyncio.run(scenario())
