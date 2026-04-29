from typing import Literal

from pydantic import BaseModel, Field


class ConversionOptions(BaseModel):
    force: bool = False
    generate_mapping: bool = True
    allow_fake_mapping: bool = False


class ConversionRequest(BaseModel):
    project_id: str = Field(min_length=1)
    model_version_id: str = Field(min_length=1)
    source_artifact_id: str = Field(min_length=1)
    source_url: str = Field(min_length=1)
    target_format: Literal["usdc"] = "usdc"
    options: ConversionOptions = Field(default_factory=ConversionOptions)
