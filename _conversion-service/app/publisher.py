from pathlib import Path
import re
import shutil
from typing import Any

from .mapping_builder import _derive_usdc_artifact_id
from .settings import Settings


SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def publish_outputs(
    *,
    settings: Settings,
    job_id: str,
    project_id: str,
    model_version_id: str,
    source_artifact_id: str,
    source_url: str,
    source_ifc_path: Path,
    usdc_path: Path,
    ifc_index_path: Path,
    usd_index_path: Path,
    mapping_path: Path,
) -> dict[str, Any]:
    _validate_id(project_id, "project_id")
    _validate_id(model_version_id, "model_version_id")
    destination_dir = settings.fake_storage_root / "static" / "projects" / project_id / "versions" / model_version_id
    destination_dir.mkdir(parents=True, exist_ok=True)

    outputs = {
        "source.ifc": source_ifc_path,
        "model.usdc": usdc_path,
        "ifc_index.json": ifc_index_path,
        "usd_index.json": usd_index_path,
        "element_mapping.json": mapping_path,
    }
    for name, source in outputs.items():
        shutil.copy2(source, destination_dir / name)

    url_base = f"{settings.fake_storage_static_url}/projects/{project_id}/versions/{model_version_id}"
    return {
        "job_id": job_id,
        "status": "succeeded",
        "project_id": project_id,
        "model_version_id": model_version_id,
        "source_artifact_id": source_artifact_id,
        "usdc_artifact_id": _derive_usdc_artifact_id(source_artifact_id),
        "source_url": source_url,
        "usdc_url": f"{url_base}/model.usdc",
        "ifc_index_url": f"{url_base}/ifc_index.json",
        "usd_index_url": f"{url_base}/usd_index.json",
        "mapping_url": f"{url_base}/element_mapping.json",
    }


def _validate_id(value: str, label: str) -> None:
    if not SAFE_ID_RE.fullmatch(value):
        raise ValueError(f"Invalid {label}: {value}")
