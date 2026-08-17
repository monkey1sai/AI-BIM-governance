"""Fail-closed tests for the architecture learning ledger and quality report (Phase 5)."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.architecture_contract import validate_schema_instance  # noqa: E402
from scripts.lib.architecture_learning import (  # noqa: E402
    _count_baseline_debt,
    build_quality_report,
    check_learning_ledger,
)

LEDGER_PATH = ROOT / "architecture" / "learning-ledger.json"
SCHEMA_PATH = ROOT / "architecture" / "learning-ledger.schema.json"

# Pinned literals: loosening the ledger (dropping a pattern, silently flipping a
# finding's status, or unhooking a promotion from its gate) must edit this file
# in the same diff.
PINNED_PATTERN_IDS = frozenset(
    {
        "duplicate-capability-implementations",
        "god-file-accretion",
        "unregistered-literal-fanout",
        "test-fixture-monolith",
        "deep-module-consolidation",
        "structural-erosion-classes",
    }
)
PINNED_FINDING_STATUS = {
    "c1-minio-watch-surface": "refactored",
    "c2-edge-artifact-health": "open",
    "c3-governance-egress-redaction": "open",
    "c4-session-artifact-authority": "open",
    "c5-job-projection-fusion": "open",
    "f1-page-registry": "open",
    "f2-session-view-read-model": "open",
    "f3-rule-run-triplication": "open",
    "f4-viewer-lease-fork": "refactored",
    "f5-unified-fixtures": "open",
}
PINNED_PROMOTIONS = frozenset(
    {
        ("structural-erosion-classes", "ARCH-GRAPH-001"),
        ("structural-erosion-classes", "ARCH-LAYER-001"),
        ("structural-erosion-classes", "ARCH-LIFECYCLE-001"),
    }
)


def load_ledger() -> dict:
    return json.loads(LEDGER_PATH.read_text(encoding="utf-8"))


def issue_codes(result) -> set[str]:
    return {issue.code for issue in result.issues}


def write_tmp_repo(tmp_path: Path, ledger: dict) -> Path:
    repo = tmp_path / "repo"
    arch = repo / "architecture"
    arch.mkdir(parents=True)
    (arch / "learning-ledger.json").write_text(
        json.dumps(ledger, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    for name in (
        "learning-ledger.schema.json",
        "architecture-contract.json",
        "architecture-contract.schema.json",
    ):
        (arch / name).write_text((ROOT / "architecture" / name).read_text(encoding="utf-8"), encoding="utf-8")
    return repo


# --------------------------------------------------------------------------- #
# Canonical repository
# --------------------------------------------------------------------------- #


def test_canonical_learning_ledger_passes() -> None:
    result = check_learning_ledger(ROOT)

    assert result.compared is True
    assert result.error_count == 0, [issue.to_dict() for issue in result.issues]
    assert result.warning_count == 0, [issue.to_dict() for issue in result.issues]
    assert result.status == "passed"


def test_canonical_ledger_matches_its_schema() -> None:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert validate_schema_instance(load_ledger(), schema) == []


def test_canonical_patterns_findings_and_promotions_are_pinned() -> None:
    ledger = load_ledger()
    assert {item["id"] for item in ledger["pattern_classes"]} == set(PINNED_PATTERN_IDS)
    statuses = {item["id"]: item["status"] for item in ledger["findings"]}
    assert statuses == PINNED_FINDING_STATUS
    promotions = {
        (item["pattern"], item["promoted_to"]) for item in ledger["promoted_patterns"]
    }
    assert promotions == set(PINNED_PROMOTIONS)


def test_canonical_quality_report_grades_b_with_attributed_debt() -> None:
    report, aggregation_issues = build_quality_report(ROOT)

    assert aggregation_issues == []
    assert report.all_gates_passed is True
    assert dict(report.gates) == {
        "observed_graph_ratchet": "passed",
        "layer_boundary_ratchet": "passed",
        "lifecycle_contracts": "passed",
        "learning_ledger": "passed",
    }
    debt = dict(report.debt)
    assert set(debt) == {
        "observed_undeclared_edges",
        "observed_grandfathered_cycles",
        "layer_grandfathered_violations",
        "learning_open_findings",
    }
    # Attributed debt exists today, so the honest grade is B, not A. Closing
    # debt to reach A must show up here as a deliberate pin edit.
    assert debt["learning_open_findings"] == 8
    assert report.total_debt > 0
    assert report.grade == "B"


# --------------------------------------------------------------------------- #
# Fail-closed ledger semantics
# --------------------------------------------------------------------------- #


def test_missing_ledger_fails_closed(tmp_path: Path) -> None:
    repo = write_tmp_repo(tmp_path, load_ledger())
    (repo / "architecture" / "learning-ledger.json").unlink()
    result = check_learning_ledger(repo)
    assert result.compared is False
    assert result.status == "failed"


def test_unknown_pattern_reference_rejected(tmp_path: Path) -> None:
    ledger = load_ledger()
    ledger["findings"][0]["pattern"] = "ghost-pattern"
    result = check_learning_ledger(write_tmp_repo(tmp_path, ledger))
    assert result.status == "failed"
    assert "learning.finding.unknown_pattern" in issue_codes(result)


def test_promotion_must_point_at_a_declared_invariant(tmp_path: Path) -> None:
    ledger = load_ledger()
    ledger["promoted_patterns"][0]["promoted_to"] = "ARCH-GHOST-999"
    result = check_learning_ledger(write_tmp_repo(tmp_path, ledger))
    assert result.status == "failed"
    assert "learning.promotion.unknown_invariant" in issue_codes(result)


def test_promotion_must_point_at_an_active_invariant(tmp_path: Path) -> None:
    """ARCH-UI-001 is declared but delegated, not active: a promotion claiming
    it would assert a gate canonical verification does not run."""

    ledger = load_ledger()
    ledger["promoted_patterns"][0]["promoted_to"] = "ARCH-UI-001"
    result = check_learning_ledger(write_tmp_repo(tmp_path, ledger))
    assert result.status == "failed"
    assert "learning.promotion.invariant_not_active" in issue_codes(result)


def test_duplicate_promotion_pair_rejected(tmp_path: Path) -> None:
    ledger = load_ledger()
    ledger["promoted_patterns"].append(deepcopy(ledger["promoted_patterns"][0]))
    result = check_learning_ledger(write_tmp_repo(tmp_path, ledger))
    assert result.status == "failed"
    assert "learning.promotion.duplicate" in issue_codes(result)


def test_promoted_finding_requires_a_promotion_record(tmp_path: Path) -> None:
    """Flipping a finding to promoted improves the grade; the promised
    pattern-to-gate promotion must actually be on record."""

    ledger = load_ledger()
    finding = next(item for item in ledger["findings"] if item["id"] == "c3-governance-egress-redaction")
    finding["status"] = "promoted"
    finding["resolution"] = {"kind": "promotion", "reference": "invented"}
    result = check_learning_ledger(write_tmp_repo(tmp_path, ledger))
    assert result.status == "failed"
    assert "learning.finding.promotion_unrecorded" in issue_codes(result)


def test_strict_verdict_aggregates_every_gate_warning() -> None:
    report, _ = build_quality_report(ROOT)
    assert dict(report.gate_warnings) == {
        "observed_graph_ratchet": 0,
        "layer_boundary_ratchet": 0,
        "lifecycle_contracts": 0,
        "learning_ledger": 0,
    }
    assert report.total_gate_warnings == 0


def test_whitespace_only_strings_fail_the_schema() -> None:
    from scripts.lib.architecture_learning import LEDGER_SCHEMA_RELATIVE_PATH

    schema = json.loads((ROOT / LEDGER_SCHEMA_RELATIVE_PATH).read_text(encoding="utf-8"))
    ledger = load_ledger()
    ledger["promoted_patterns"][0]["evidence"] = "   "
    assert validate_schema_instance(ledger, schema) != []


def test_duplicate_finding_rejected(tmp_path: Path) -> None:
    ledger = load_ledger()
    ledger["findings"].append(deepcopy(ledger["findings"][0]))
    result = check_learning_ledger(write_tmp_repo(tmp_path, ledger))
    assert result.status == "failed"
    assert "learning.finding.duplicate" in issue_codes(result)


def test_open_finding_with_a_resolution_rejected(tmp_path: Path) -> None:
    ledger = load_ledger()
    open_finding = next(item for item in ledger["findings"] if item["status"] == "open")
    open_finding["resolution"] = {"kind": "refactor", "reference": "invented"}
    result = check_learning_ledger(write_tmp_repo(tmp_path, ledger))
    assert result.status == "failed"
    assert "learning.finding.resolution_mismatch" in issue_codes(result)


def test_status_and_resolution_kind_must_agree(tmp_path: Path) -> None:
    ledger = load_ledger()
    refactored = next(item for item in ledger["findings"] if item["status"] == "refactored")
    refactored["resolution"]["kind"] = "promotion"
    result = check_learning_ledger(write_tmp_repo(tmp_path, ledger))
    assert result.status == "failed"
    assert "learning.finding.resolution_mismatch" in issue_codes(result)


def test_unused_pattern_class_warns(tmp_path: Path) -> None:
    ledger = load_ledger()
    ledger["pattern_classes"].append(
        {"id": "orphan-pattern", "title": "Orphan", "description": "Referenced by nothing."}
    )
    result = check_learning_ledger(write_tmp_repo(tmp_path, ledger))
    assert "learning.pattern.unused" in issue_codes(result)
    assert result.warning_count >= 1
    assert result.error_count == 0
    assert result.status == "passed"


def test_vacuous_schema_rejected(tmp_path: Path) -> None:
    repo = write_tmp_repo(tmp_path, load_ledger())
    (repo / "architecture" / "learning-ledger.schema.json").write_text("{}", encoding="utf-8")
    result = check_learning_ledger(repo)
    assert result.status == "failed"
    assert "learning_ledger.schema_vacuous" in issue_codes(result)


# --------------------------------------------------------------------------- #
# Quality aggregation fail-closed
# --------------------------------------------------------------------------- #


def test_unreadable_baseline_surfaces_as_an_aggregation_issue(tmp_path: Path) -> None:
    counts, issues = _count_baseline_debt(tmp_path)
    assert counts == []
    assert {issue.code for issue in issues} == {"learning.quality.baseline_unreadable"}


def test_report_script_passes_on_canonical_repository() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "dev" / "report_architecture_quality.py"),
            "--repo-root",
            str(ROOT),
            "--format",
            "json",
            "--strict",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["cli_status"] == "passed"
    assert payload["grade"] == "B"
    assert payload["all_gates_passed"] is True
    assert payload["aggregation_issues"] == []
    assert "never repairs anything" in payload["notes"]
