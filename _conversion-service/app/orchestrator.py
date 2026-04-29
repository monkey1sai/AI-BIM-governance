import json
from pathlib import Path
import traceback
from typing import Any

from .bim_control_client import post_conversion_result
from .converter_runner import ConverterProcessError, run_converter
from .file_io import download_source
from .ifc_indexer import build_ifc_index
from .job_store import JobStore
from .mapping_builder import build_element_mapping
from .publisher import publish_outputs
from .settings import Settings
from .usd_indexer import USDIndexerError, run_usd_indexer


def run_conversion_job(job_id: str, settings: Settings) -> None:
    store = JobStore(settings.jobs_dir)
    job = store.get_job(job_id)
    if job is None:
        return

    log_path = settings.logs_dir / f"{job_id}.log"
    current_stage = "queued"
    try:
        work_dir = settings.work_dir / job_id
        source_ifc_path = work_dir / "source.ifc"
        output_dir = work_dir / "output"
        ifc_index_path = output_dir / "ifc_index.json"
        usd_index_path = output_dir / "usd_index.json"
        mapping_path = output_dir / "element_mapping.json"

        current_stage = "downloading_source"
        store.update_job(job_id, status="running", stage=current_stage)
        download_source(job["source_url"], source_ifc_path, timeout_seconds=60)

        current_stage = "indexing_ifc"
        store.update_job(job_id, status="running", stage=current_stage)
        ifc_index = build_ifc_index(
            source_ifc_path,
            project_id=job["project_id"],
            model_version_id=job["model_version_id"],
            source_artifact_id=job["source_artifact_id"],
        )
        _write_json(ifc_index_path, ifc_index)

        current_stage = "converting_ifc_to_usdc"
        store.update_job(job_id, status="running", stage=current_stage)
        usdc_path = run_converter(
            settings=settings,
            ifc_path=source_ifc_path,
            output_dir=output_dir,
            output_name="model.usdc",
            log_path=log_path,
            force=bool(job.get("options", {}).get("force")),
        )

        current_stage = "indexing_usd"
        store.update_job(job_id, status="running", stage=current_stage)
        run_usd_indexer(settings=settings, usd_path=usdc_path, output_path=usd_index_path, log_path=log_path)
        usd_index = json.loads(usd_index_path.read_text(encoding="utf-8"))

        current_stage = "building_mapping"
        store.update_job(job_id, status="running", stage=current_stage)
        mapping = build_element_mapping(
            ifc_index,
            usd_index,
            project_id=job["project_id"],
            model_version_id=job["model_version_id"],
            source_artifact_id=job["source_artifact_id"],
            allow_fake_mapping=bool(job.get("options", {}).get("allow_fake_mapping")),
        )
        _write_json(mapping_path, mapping)

        current_stage = "publishing_outputs"
        store.update_job(job_id, status="running", stage=current_stage)
        result = publish_outputs(
            settings=settings,
            job_id=job_id,
            project_id=job["project_id"],
            model_version_id=job["model_version_id"],
            source_artifact_id=job["source_artifact_id"],
            source_url=job["source_url"],
            source_ifc_path=source_ifc_path,
            usdc_path=usdc_path,
            ifc_index_path=ifc_index_path,
            usd_index_path=usd_index_path,
            mapping_path=mapping_path,
        )

        current_stage = "updating_bim_control"
        store.update_job(job_id, status="running", stage=current_stage, result=result)
        warning = post_conversion_result(settings, job["model_version_id"], result)
        warnings = list(job.get("warnings") or [])
        if warning:
            warnings.append(warning)

        store.update_job(job_id, status="succeeded", stage="done", result=result, warnings=warnings)
    except (ConverterProcessError, USDIndexerError) as exc:
        _fail_job(store, job_id, current_stage, getattr(exc, "code", "CONVERSION_FAILED"), str(exc), log_path)
    except Exception as exc:
        _append_log(log_path, traceback.format_exc())
        _fail_job(store, job_id, current_stage, "CONVERSION_JOB_FAILED", str(exc), log_path)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _append_log(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", errors="replace") as handle:
        handle.write(text)


def _fail_job(store: JobStore, job_id: str, stage: str, code: str, message: str, log_path: Path) -> None:
    store.update_job(
        job_id,
        status="failed",
        stage="failed",
        failed_stage=stage,
        error={
            "code": code,
            "message": message,
            "details": {"log_path": str(log_path)},
        },
    )
