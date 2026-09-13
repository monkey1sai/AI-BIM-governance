"""Production adapter concurrency/authority contracts using native-query doubles."""
import asyncio
import copy
import threading
from types import SimpleNamespace

import pytest

from test_distance_measurement import Viewport
from measurement_runtime import MeasurementRuntime
from runtime_authority import DataChannelTraceContext


class Authority:
    def __init__(self):
        self.calls = 0
        self.allow = True
        self.hook = lambda: None
        self.context = {"session_id": "review_session_a", "client_id": "client-a", "lease_id": "lease-a",
                        "binding_id": "binding-a", "artifact_ids": ["artifact-a"], "policy_id": "primary-lease-distance-v1"}

    def authorize(self, event, payload):
        assert event == "measurementRequest"
        self.calls += 1
        self.hook()
        return SimpleNamespace(authorized=self.allow, data={"measurement_context": copy.deepcopy(self.context)})


def setup():
    viewport, authority, trace = Viewport(), Authority(), DataChannelTraceContext()
    trace.bind_active_stage("review_session_a", "rev_a", "binding-a")
    revision = [0]
    viewport.map_ndc_to_texture_pixel = lambda ndc: ((int((ndc[0] + 1) * 319), int((1 - ndc[1]) * 239)), True)
    runtime = MeasurementRuntime(viewport, authority, trace, lambda: revision[0])
    return runtime, viewport, authority, trace, revision


def request(action, rid="start", **extra):
    return {"session_id": "review_session_a", "source_client_id": "client-a", "viewer_lease_token": "test-only-lease",
            "trace_id": "rev_a", "measurement_id": "measure-a", "request_id": rid, "action": action, **extra}


async def until(predicate):
    for _ in range(2000):
        if predicate():
            return
        await asyncio.sleep(0.001)
    pytest.fail("bounded test wait expired")


async def pick(runtime, viewport, rid, position, before_hit=lambda: None):
    count = len(viewport.callbacks)
    task = asyncio.create_task(runtime.execute(request("pick", rid, uv=[0.25, 0.5])))
    await until(lambda: len(viewport.callbacks) > count)
    before_hit()
    viewport.callbacks[-1]("/World/Wall", position)
    return await task


def test_native_points_are_unit_scaled_only_after_fresh_policy_and_binding_checks():
    async def run():
        runtime, viewport, authority, _, _ = setup()
        assert (await runtime.execute(request("start")))["status"] == "started"
        assert (await pick(runtime, viewport, "p1", (0, 0, 0)))["status"] == "point"
        result = await pick(runtime, viewport, "p2", (300, 400, 0))
        assert result["status"] == "result" and result["distance_metres"] == 5
        assert authority.calls >= 6
        assert viewport.pixels == [(159, 239), (159, 239)]
        assert "viewer_lease_token" not in result
    asyncio.run(run())


@pytest.mark.parametrize("field,value", [("policy_id", None), ("binding_id", "other"), ("client_id", "other"),
    ("session_id", "other"), ("lease_id", None), ("artifact_ids", [])])
def test_missing_or_mismatched_server_context_prevents_native_query(field, value):
    async def run():
        runtime, viewport, authority, _, _ = setup()
        authority.context[field] = value
        assert (await runtime.execute(request("start")))["status"] == "rejected"
        assert viewport.callbacks == []
    asyncio.run(run())


@pytest.mark.parametrize("drift", ["revoked", "lease", "binding", "edit_restore", "camera", "units"])
def test_drift_after_native_query_before_publication_discards_points(drift):
    async def run():
        runtime, viewport, authority, trace, revision = setup()
        await runtime.execute(request("start"))
        await pick(runtime, viewport, "p1", (0, 0, 0))
        def change():
            if drift == "revoked": authority.allow = False
            elif drift == "lease": authority.context["lease_id"] = "new-lease"
            elif drift == "binding": trace.bind_active_stage("review_session_a", "rev_a", "new-binding")
            elif drift == "edit_restore": revision[0] += 2
            elif drift == "camera": viewport.view[0][0] = 2
            elif drift == "units": viewport.stage.units = 1
        result = await pick(runtime, viewport, "p2", (100, 0, 0), change)
        assert result["status"] in ("rejected", "cancelled") and "distance_metres" not in result
    asyncio.run(run())


@pytest.mark.parametrize("initial", [False, True])
def test_cancel_during_authority_wait_invalidates_before_worker_returns(initial):
    async def run():
        runtime, viewport, authority, _, _ = setup()
        if not initial:
            await runtime.execute(request("start"))
        entered, release = threading.Event(), threading.Event()
        authority.hook = lambda: (entered.set(), release.wait(1))
        task = asyncio.create_task(runtime.execute(request("start"))) if initial else asyncio.create_task(runtime.execute(request("pick", "p1", uv=[0.5, 0.5])))
        await until(entered.is_set)
        old_epoch = runtime.epoch
        result = await runtime.execute(request("cancel", "cancel"))
        assert runtime.epoch > old_epoch
        assert result["status"] == "rejected"  # fresh authority still busy, cancellation remains effective
        release.set()
        assert (await task)["status"] == "rejected"
        assert viewport.callbacks == []
    asyncio.run(run())


def test_cancel_keeps_native_ticket_and_foreign_caller_cannot_cancel():
    async def run():
        runtime, viewport, _, _, _ = setup()
        await runtime.execute(request("start"))
        task = asyncio.create_task(runtime.execute(request("pick", "p1", uv=[0.5, 0.5])))
        await until(lambda: len(viewport.callbacks) == 1)
        epoch = runtime.epoch
        assert (await runtime.execute(request("cancel", "foreign", source_client_id="other")))["status"] == "rejected"
        assert runtime.epoch == epoch
        await runtime.execute(request("cancel", "cancel"))
        assert (await task)["status"] in ("cancelled", "rejected")
        assert runtime.controller.native_pending
        assert (await runtime.execute(request("start", "new-start")))["error"] == "native_query_pending"
        viewport.callbacks[0]("/World/Wall", (0, 0, 0))
        assert (await runtime.execute(request("start", "after-drain")))["status"] == "started"
    asyncio.run(run())


def test_unknown_units_and_duplicate_request_never_publish_distance():
    async def run():
        runtime, viewport, _, _, _ = setup()
        viewport.stage.authored = False
        assert (await runtime.execute(request("start")))["status"] == "rejected"
        assert viewport.callbacks == []
        viewport.stage.authored = True
        assert (await runtime.execute(request("start", "start-2")))["status"] == "started"
        assert (await runtime.execute(request("start", "start-2")))["error"] == "duplicate_request"
    asyncio.run(run())
