from pydantic import BaseModel, Field


class UsdcArtifact(BaseModel):
    artifact_id: str
    filename: str
    relative_path: str
    runtime_uri: str
    size_bytes: int


class KitInstanceState(BaseModel):
    instance_id: str
    status: str
    selected_artifact_ids: list[str] = Field(default_factory=list)
    opened_runtime_uris: list[str] = Field(default_factory=list)
    last_command: str | None = None
    control_status: str = "not_sent"


class OpenRequest(BaseModel):
    artifact_ids: list[str] = Field(min_length=1)
    replace_existing: bool = True


class OpenResponse(BaseModel):
    instance: KitInstanceState
    stage_composition_payload: dict
    message: str


class CloseResponse(BaseModel):
    instance: KitInstanceState
    message: str


class HealthResponse(BaseModel):
    status: str
    runtime_mode: str
    host_local_runtime_allowed: bool
    kit_instance_id: str
    kit_control_url: str
