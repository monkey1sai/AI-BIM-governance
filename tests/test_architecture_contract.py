from __future__ import annotations

from copy import deepcopy
from datetime import date
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.architecture_contract import (  # noqa: E402
    validate_contract,
    validate_delta,
    validate_repository,
)


def load_contract() -> dict:
    return json.loads((ROOT / "architecture" / "architecture-contract.json").read_text(encoding="utf-8"))


def load_delta() -> dict:
    return json.loads(
        (
            ROOT
            / "architecture"
            / "deltas"
            / "introduce-executable-architecture-contracts.json"
        ).read_text(encoding="utf-8")
    )


def issue_codes(issues) -> set[str]:
    return {issue.code for issue in issues}


def copy_architecture_contracts(tmp_path: Path) -> Path:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    return tmp_path


def test_canonical_repository_contract_passes() -> None:
    result = validate_repository(ROOT, today=date(2026, 7, 30))
    assert result.status == "passed", result.to_dict()
    assert result.error_count == 0
    assert "architecture/architecture-contract.json" in result.checked_files


def test_duplicate_capability_owner_is_rejected() -> None:
    contract = load_contract()
    contract["services"][1]["owns"].append("review-session")

    issues = validate_contract(contract)

    assert "ownership.duplicate_owner" in issue_codes(issues)


def test_browser_cannot_gain_second_http_api_entrypoint() -> None:
    contract = load_contract()
    contract["browser_access_policy"]["http_api_entrypoints"].append(
        {"service": "governance-service", "port": 49102, "scope": "public"}
    )

    issues = validate_contract(contract)

    assert "browser_policy.http_entrypoint" in issue_codes(issues)


def test_readiness_requires_browser_first_frame_evidence() -> None:
    contract = load_contract()
    policy = contract["readiness_policies"][0]
    policy["required_evidence"] = [
        item for item in policy["required_evidence"] if item["id"] != "first-frame-at"
    ]

    issues = validate_contract(contract)

    assert "readiness.evidence_missing" in issue_codes(issues)


def test_undeclared_dependency_edge_is_rejected() -> None:
    contract = load_contract()
    delta = load_delta()
    delta["added_dependency_edges"] = [
        {
            "from": "web-viewer-sample",
            "to": "governance-service",
            "interface": "direct-browser-http",
            "reason": "Negative test: bypass coordinator.",
        }
    ]

    issues = validate_delta(delta, contract, today=date(2026, 7, 30))

    assert "delta.edge.not_allowed" in issue_codes(issues)


def test_bounded_lane_cannot_carry_architecture_change() -> None:
    contract = load_contract()
    delta = load_delta()
    delta["lane"] = "B"

    issues = validate_delta(delta, contract, today=date(2026, 7, 30))

    assert "delta.lane.insufficient" in issue_codes(issues)


def test_expired_exception_fails_closed() -> None:
    contract = load_contract()
    delta = load_delta()
    delta["exceptions"] = [
        {
            "invariant_id": "ARCH-HTTP-001",
            "owner": "architecture-owner",
            "reason": "Negative test only.",
            "adr": "docs/adr/0001-negative-test.md",
            "created_on": "2026-01-01",
            "expires_on": "2026-01-31",
        }
    ]
    delta["approval"] = {
        "required": True,
        "status": "approved",
        "approved_by": "test-owner",
        "approved_at": "2026-01-01T00:00:00Z",
    }

    issues = validate_delta(delta, contract, today=date(2026, 7, 30))

    assert "delta.exception.expired" in issue_codes(issues)


def test_contract_schema_documents_are_valid_json() -> None:
    for name in (
        "architecture-contract.schema.json",
        "architecture-delta.schema.json",
    ):
        schema = json.loads((ROOT / "architecture" / name).read_text(encoding="utf-8"))
        assert schema["type"] == "object"
        assert schema["$schema"] == "http://json-schema.org/draft-07/schema#"


def test_repository_schema_rejects_missing_required_delta_fields(tmp_path: Path) -> None:
    repo_root = copy_architecture_contracts(tmp_path)
    delta_path = (
        repo_root
        / "architecture"
        / "deltas"
        / "introduce-executable-architecture-contracts.json"
    )
    delta = json.loads(delta_path.read_text(encoding="utf-8"))
    delta.pop("summary")
    delta.pop("affected_surfaces")
    delta_path.write_text(json.dumps(delta), encoding="utf-8")

    result = validate_repository(repo_root, today=date(2026, 7, 30))

    assert result.status == "failed"
    assert "schema.instance.required" in issue_codes(result.issues)
    assert any(issue.path.endswith("$.summary") for issue in result.issues)
    assert any(issue.path.endswith("$.affected_surfaces") for issue in result.issues)


def test_repository_schema_rejects_unknown_contract_property(tmp_path: Path) -> None:
    repo_root = copy_architecture_contracts(tmp_path)
    contract_path = repo_root / "architecture" / "architecture-contract.json"
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    contract["unknown_top_level"] = True
    contract_path.write_text(json.dumps(contract), encoding="utf-8")

    result = validate_repository(repo_root, today=date(2026, 7, 30))

    assert result.status == "failed"
    assert "schema.instance.additional_property" in issue_codes(result.issues)
    assert any(issue.path.endswith("$.unknown_top_level") for issue in result.issues)


def test_cli_json_output_is_machine_readable() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "dev" / "validate_architecture_contract.py"),
            "--repo-root",
            str(ROOT),
            "--format",
            "json",
            "--strict",
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr or completed.stdout
    payload = json.loads(completed.stdout)
    assert payload["status"] == "passed"
    assert payload["summary"] == {"errors": 0, "warnings": 0, "issues": 0}
