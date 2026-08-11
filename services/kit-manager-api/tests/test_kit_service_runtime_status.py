import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

from app.kit_service import KitInstanceService
from app.kit_gateway import KitRuntimeGateway
from app.models import UsdcArtifact


class FakeRepository:
    def __init__(self):
        self.artifact = UsdcArtifact(
            artifact_id="usdc_fixture",
            filename="fixture.usdc",
            relative_path="fixture.usdc",
            runtime_uri="file:///workspace/storage/fixture.usdc",
            size_bytes=12,
        )

    def list_artifacts(self):
        return [self.artifact]

    def resolve(self, artifact_ids):
        if artifact_ids != [self.artifact.artifact_id]:
            raise KeyError(", ".join(artifact_ids))
        return [self.artifact]


class FakeGateway:
    def __init__(self, control_status):
        self.control_status = control_status

    def open_stage(self, payload):
        return self.control_status

    def close_stage(self, payload):
        return self.control_status


def make_service(control_status):
    return KitInstanceService(
        instance_id="kit_test",
        repository=FakeRepository(),
        gateway=FakeGateway(control_status),
    )


def test_open_artifacts_marks_open_when_control_command_is_sent():
    service = make_service("sent")

    response = service.open_artifacts(["usdc_fixture"], replace_existing=True)

    assert response.instance.status == "open"
    assert service.get_state().status == "open"


def test_close_instance_marks_closed_when_control_command_is_sent():
    service = make_service("sent")

    response = service.close_instance()

    assert response.instance.status == "closed"
    assert service.get_state().status == "closed"


def test_open_artifacts_marks_blocked_when_control_is_blocked():
    service = make_service("blocked_runtime_control_unavailable")

    response = service.open_artifacts(["usdc_fixture"], replace_existing=True)

    assert response.instance.status == "blocked"
    assert service.get_state().status == "blocked"


def test_close_instance_marks_blocked_when_control_is_blocked():
    service = make_service("blocked_runtime_control_unavailable")

    response = service.close_instance()

    assert response.instance.status == "blocked"
    assert service.get_state().status == "blocked"


def test_open_artifacts_records_only_when_control_fails():
    service = make_service("failed_gateway_error")

    response = service.open_artifacts(["usdc_fixture"], replace_existing=True)

    assert response.instance.status == "recorded_only"
    assert service.get_state().status == "recorded_only"


def test_close_instance_records_only_when_control_fails():
    service = make_service("failed_gateway_error")

    response = service.close_instance()

    assert response.instance.status == "recorded_only"
    assert service.get_state().status == "recorded_only"


def test_unknown_control_status_records_only():
    service = make_service("unexpected_gateway_state")

    response = service.open_artifacts(["usdc_fixture"], replace_existing=True)

    assert response.instance.status == "recorded_only"
    assert service.get_state().status == "recorded_only"


def test_unconfigured_gateway_blocks_without_constructing_a_runtime_request():
    gateway = KitRuntimeGateway("")

    assert gateway.open_stage({"type": "openStageRequest"}) == "blocked_runtime_control_unconfigured"
    assert gateway.close_stage({"instance_id": "kit_test"}) == "blocked_runtime_control_unconfigured"


def test_configured_gateway_ignores_inherited_http_proxy(monkeypatch):
    proxy_url = "http://203.0.113.10:8080"
    monkeypatch.setenv("HTTP_PROXY", proxy_url)
    monkeypatch.setenv("http_proxy", proxy_url)
    monkeypatch.setenv("NO_PROXY", "")
    monkeypatch.setenv("no_proxy", "")
    destinations = []

    def capture_destination(address, *args, **kwargs):
        destinations.append(address)
        raise OSError("stop before network access")

    monkeypatch.setattr(socket, "create_connection", capture_destination)
    gateway = KitRuntimeGateway("http://192.0.2.50:49101")

    status = gateway.open_stage({"type": "openStageRequest"})

    assert status == "blocked_runtime_control_unavailable"
    assert destinations == [("192.0.2.50", 49101)]


def test_configured_gateway_rejects_redirects_without_contacting_the_destination():
    request_counts = {"redirect": 0, "destination": 0}

    class DestinationHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            request_counts["destination"] += 1
            self.send_response(200)
            self.end_headers()

        do_POST = do_GET

        def log_message(self, format, *args):
            return

    destination_server = ThreadingHTTPServer(("127.0.0.1", 0), DestinationHandler)
    destination_thread = Thread(target=destination_server.serve_forever, daemon=True)
    destination_thread.start()
    destination_url = f"http://127.0.0.1:{destination_server.server_port}/capture"

    class RedirectHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            request_counts["redirect"] += 1
            self.send_response(302)
            self.send_header("Location", destination_url)
            self.end_headers()

        def log_message(self, format, *args):
            return

    redirect_server = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
    redirect_thread = Thread(target=redirect_server.serve_forever, daemon=True)
    redirect_thread.start()
    try:
        gateway = KitRuntimeGateway(f"http://127.0.0.1:{redirect_server.server_port}")

        status = gateway.open_stage({"type": "openStageRequest"})

        assert status == "blocked_runtime_control_unavailable"
        assert request_counts == {"redirect": 1, "destination": 0}
    finally:
        redirect_server.shutdown()
        redirect_server.server_close()
        destination_server.shutdown()
        destination_server.server_close()
        redirect_thread.join(timeout=2)
        destination_thread.join(timeout=2)
