from app.kit_service import KitInstanceService
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
