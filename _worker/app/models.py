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
