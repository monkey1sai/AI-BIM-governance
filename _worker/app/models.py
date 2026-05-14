from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ArtifactIntakeRequest(BaseModel):
    tenant_id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)
    model_version_id: str = Field(min_length=1)
    source_system: str = Field(min_length=1)
    uploaded_by: str = Field(min_length=1)
    filename: str = Field(min_length=1)
    source_format: Literal["ifc", "rvt", "dwg"] = "ifc"
    artifact_group_id: str | None = None
    content_base64: str | None = None
    content_text: str | None = None
    source_url: str | None = None
    signed_upload_url: str | None = None

    @model_validator(mode="after")
    def require_source(self) -> "ArtifactIntakeRequest":
        if self.content_base64 or self.content_text or self.source_url or self.signed_upload_url:
            return self
        raise ValueError("One of content_base64, content_text, source_url, or signed_upload_url is required.")


class ConversionOptions(BaseModel):
    force: bool = False
    generate_mapping: bool = True
    auto_complete: bool = True


class ConversionRequest(BaseModel):
    source_artifact_id: str = Field(min_length=1)
    target_format: Literal["usdc"] = "usdc"
    generate_mapping: bool = True
    materialization_strategy: Literal["sidecar", "usd_prim"] = "sidecar"
    options: ConversionOptions = Field(default_factory=ConversionOptions)


class DevIfcSourceConversionRequest(BaseModel):
    tenant_id: str = Field(default="tenant_demo_001", min_length=1)
    project_id: str = Field(default="project_demo_001", min_length=1)
    model_version_id: str = Field(default="version_demo_001", min_length=1)
    source_system: str = Field(default="dev_storage", min_length=1)
    uploaded_by: str = Field(default="dev_user_001", min_length=1)
    artifact_group_id: str | None = None
    target_format: Literal["usdc"] = "usdc"
    generate_mapping: bool = True
    materialization_strategy: Literal["sidecar", "usd_prim"] = "sidecar"
    options: ConversionOptions = Field(default_factory=ConversionOptions)


class RvtUploadedSourceArtifact(BaseModel):
    artifact_id: str = Field(min_length=1)
    format: Literal["rvt"] = "rvt"
    filename: str = Field(min_length=1)
    url: str | None = None
    file_url: str | None = None
    signed_upload_reference: str | None = None
    checksum_sha256: str | None = None

    @model_validator(mode="after")
    def require_reference(self) -> "RvtUploadedSourceArtifact":
        if self.url or self.file_url or self.signed_upload_reference:
            return self
        raise ValueError("RVT source artifact must include url, file_url, or signed_upload_reference.")


class RvtExportOptions(BaseModel):
    export_mode: Literal["external_revit", "fake_fixture"] = "external_revit"
    auto_process: bool = True
    fixture_ifc_url: str | None = None
    fixture_ifc_artifact_id: str | None = None

    @model_validator(mode="after")
    def require_fixture_for_fake_mode(self) -> "RvtExportOptions":
        if self.export_mode != "fake_fixture" or self.fixture_ifc_url:
            return self
        raise ValueError("fixture_ifc_url is required when export_mode='fake_fixture'.")


class RvtExportRequest(BaseModel):
    event_type: Literal["rvt_uploaded"] = "rvt_uploaded"
    event_id: str = Field(min_length=1)
    correlation_id: str = Field(min_length=1)
    tenant_id: str = Field(default="tenant_demo_001", min_length=1)
    project_id: str = Field(default="project_demo_001", min_length=1)
    model_version_id: str = Field(min_length=1)
    source_artifact: RvtUploadedSourceArtifact
    requested_outputs: list[str] = Field(default_factory=lambda: ["ifc"])
    callback_url: str | None = None
    handoff_target_url: str | None = None
    options: RvtExportOptions = Field(default_factory=RvtExportOptions)
