from .kit_gateway import KitRuntimeGateway
from .models import KitInstanceState, OpenResponse, CloseResponse
from .usdc_repository import UsdcRepository


class KitInstanceService:
    def __init__(self, instance_id: str, repository: UsdcRepository, gateway: KitRuntimeGateway):
        self.instance_id = instance_id
        self.repository = repository
        self.gateway = gateway
        self.state = KitInstanceState(instance_id=instance_id, status="idle")

    def list_usdc(self):
        return self.repository.list_artifacts()

    def open_artifacts(self, artifact_ids: list[str], replace_existing: bool) -> OpenResponse:
        artifacts = self.repository.resolve(artifact_ids)
        payload = self._stage_composition_payload([artifact.runtime_uri for artifact in artifacts])
        control_status = self.gateway.open_stage(payload)
        self.state = KitInstanceState(
            instance_id=self.instance_id,
            status=self._runtime_status("open", control_status),
            selected_artifact_ids=artifact_ids,
            opened_runtime_uris=[artifact.runtime_uri for artifact in artifacts],
            last_command="open",
            control_status=control_status,
        )
        message = "Open command recorded."
        if control_status != "sent":
            message = f"Open command recorded; Kit control is {control_status}."
        return OpenResponse(instance=self.state, stage_composition_payload=payload, message=message)

    def close_instance(self) -> CloseResponse:
        payload = {"instance_id": self.instance_id}
        control_status = self.gateway.close_stage(payload)
        self.state = KitInstanceState(
            instance_id=self.instance_id,
            status=self._runtime_status("closed", control_status),
            selected_artifact_ids=[],
            opened_runtime_uris=[],
            last_command="close",
            control_status=control_status,
        )
        message = "Close command recorded."
        if control_status != "sent":
            message = f"Close command recorded; Kit control is {control_status}."
        return CloseResponse(instance=self.state, message=message)

    def get_state(self) -> KitInstanceState:
        return self.state

    def _stage_composition_payload(self, runtime_uris: list[str]) -> dict:
        primary = runtime_uris[0]
        secondary = runtime_uris[1:]
        return {
            "type": "openStageRequest",
            "instance_id": self.instance_id,
            "stage_composition": {
                "primary": {"url": primary, "role": "primary_model"},
                "secondary": [{"url": url, "role": "secondary_model"} for url in secondary],
                "load_order": runtime_uris,
            },
        }

    def _runtime_status(self, successful_status: str, control_status: str) -> str:
        if control_status == "sent":
            return successful_status
        if control_status.startswith("blocked"):
            return "blocked"
        return "recorded_only"
