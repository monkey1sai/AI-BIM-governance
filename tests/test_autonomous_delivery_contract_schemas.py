import copy
import json
from pathlib import Path

from jsonschema import Draft7Validator


ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "agent-contracts"
SHA1 = "c" * 40
SHA256 = "d" * 64


def load_schema(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def delivered_record() -> dict:
    return {
        "schema_version": "autonomous-delivery-terminal-record/v1",
        "delivery_id": "delivery:551",
        "attempt_id": "attempt:551.1",
        "pr_class": "ordinary",
        "supersedes_delivery_id": None,
        "supersedes_attempt_id": None,
        "previous_attempt_sha256": None,
        "repository": {
            "full_name": "monkey1sai/AI-BIM-governance",
            "repository_id": 123456,
        },
        "pull_request": {
            "number": 551,
            "base_oid": "b" * 40,
            "head_oid": "a" * 40,
        },
        "phase": "CLOSED",
        "last_phase": "VERIFYING_DEPLOYMENT",
        "terminal_class": "DELIVERED",
        "reason_code": "DELIVERY_VERIFIED",
        "merge_observed": True,
        "merge_commit_oid": SHA1,
        "fetched_origin_main_oid": SHA1,
        "deployed_commit_oid": SHA1,
        "command_state": "completed",
        "target_id": "canonical-linux-test",
        "runner_ids": ["runner-linux", "runner-windows"],
        "gates": [
            {"gate_id": "linux-health", "status": "passed", "result_sha256": SHA256},
        ],
        "artifacts": [
            {
                "artifact_id": "delivery:summary",
                "sha256": SHA256,
                "size_bytes": 128,
                "media_type": "application/json",
                "retention_class": "audit_1y",
            }
        ],
        "failure_detail": [],
        "closed_at": "2026-08-17T08:30:00.000Z",
    }


def test_all_autonomous_delivery_schemas_are_valid_draft7() -> None:
    paths = sorted(CONTRACTS.glob("autonomous-delivery-*.schema.json"))
    assert len(paths) == 4
    for path in paths:
        Draft7Validator.check_schema(json.loads(path.read_text(encoding="utf-8")))


def test_terminal_schema_accepts_complete_delivered_record() -> None:
    validator = Draft7Validator(load_schema("autonomous-delivery-terminal-record.schema.json"))
    assert list(validator.iter_errors(delivered_record())) == []


def test_terminal_schema_rejects_class_reason_confusion_and_partial_delivery() -> None:
    validator = Draft7Validator(load_schema("autonomous-delivery-terminal-record.schema.json"))
    invalid = delivered_record()
    invalid.update(
        terminal_class="DELIVERED",
        reason_code="MERGED_NOT_DELIVERED",
        merge_observed=False,
        merge_commit_oid=None,
        fetched_origin_main_oid=None,
        deployed_commit_oid=None,
        command_state="not_started",
        target_id=None,
        runner_ids=[],
        gates=[],
        artifacts=[],
    )
    errors = list(validator.iter_errors(invalid))
    assert errors, "public schema must reject records that the strict parser rejects"


def test_terminal_schema_rejects_draft_delivery_and_private_path_identifier() -> None:
    validator = Draft7Validator(load_schema("autonomous-delivery-terminal-record.schema.json"))
    draft = delivered_record()
    draft["pr_class"] = "draft_report_only"
    assert list(validator.iter_errors(draft))

    private_path = copy.deepcopy(delivered_record())
    private_path["artifacts"][0]["artifact_id"] = "C:/Users/IOT/private/deploy.log"
    assert list(validator.iter_errors(private_path))


def test_terminal_schema_requires_failed_delivery_origin_main_identity() -> None:
    validator = Draft7Validator(load_schema("autonomous-delivery-terminal-record.schema.json"))
    failed = delivered_record()
    failed.update(
        terminal_class="FAILED",
        reason_code="MERGED_NOT_DELIVERED",
        fetched_origin_main_oid=None,
        deployed_commit_oid=None,
        runner_ids=["runner-linux"],
        gates=[{"gate_id": "linux-build", "status": "failed", "result_sha256": SHA256}],
        failure_detail=[{"namespace": "deploy", "code": "build-nonzero", "evidence_sha256": SHA256}],
    )
    assert list(validator.iter_errors(failed))
