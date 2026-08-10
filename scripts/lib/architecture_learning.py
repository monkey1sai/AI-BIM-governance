"""Continuous architecture learning (Phase 5 of the architecture contract).

Phases 1-4 made the desired topology, the observed graph, the layer boundaries,
and the lifecycle machines executable. This module closes the loop the change
proposal opened with: recurring ``$improve-codebase-architecture`` findings are
classified into named erosion patterns in ``architecture/learning-ledger.json``,
a pattern that recurs can be promoted to an invariant / validator / structural
test, and the promotion is recorded machine-readably so it cannot be quietly
forgotten.

The quality report aggregates the machine outputs of the existing gates plus
the ledger into one deterministic snapshot with an explainable grade:

* ``A`` - every gate passes and there is no recorded debt anywhere (no
  grandfathered baseline entries, no open ledger findings).
* ``B`` - every gate passes; grandfathered or open debt remains, attributed.
* ``C`` - at least one gate fails (or the ledger itself is invalid).

Honest limits: the report is a *current snapshot*. It does not reconstruct a
historical trend (a shallow CI clone cannot), and it never repairs anything -
"publish without auto-merging repairs" is the contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, TypeGuard

from scripts.lib.architecture_contract import (
    ValidationIssue,
    _is_mapping,
    _is_sequence,
    _issue,
)
from scripts.lib.layered_architecture import _load_document, check_layered_architecture
from scripts.lib.lifecycle_contracts import check_lifecycle_contracts
from scripts.lib.observed_architecture import check_observed_architecture

LEDGER_SCHEMA_VERSION = "ai-bim-learning-ledger/v1"
LEDGER_RELATIVE_PATH = "architecture/learning-ledger.json"
LEDGER_SCHEMA_RELATIVE_PATH = "architecture/learning-ledger.schema.json"
ARCHITECTURE_CONTRACT_RELATIVE_PATH = "architecture/architecture-contract.json"
ARCHITECTURE_CONTRACT_SCHEMA_RELATIVE_PATH = "architecture/architecture-contract.schema.json"
OBSERVED_BASELINE_RELATIVE_PATH = "architecture/observed-baseline.json"
LAYER_BASELINE_RELATIVE_PATH = "architecture/layer-baseline.json"

QUALITY_REPORT_SCHEMA_VERSION = "ai-bim-architecture-quality-report/v1"

STATUS_TO_RESOLUTION_KIND = {
    "open": None,
    "refactored": "refactor",
    "promoted": "promotion",
    "retired": "retirement",
}


def _non_empty_string(value: Any) -> TypeGuard[str]:
    return isinstance(value, str) and bool(value.strip())


def _list_of_mappings(value: Any) -> list[Mapping[str, Any]]:
    if not _is_sequence(value):
        return []
    return [item for item in value if _is_mapping(item)]


def _duplicates(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    repeated: list[str] = []
    for value in values:
        if value in seen and value not in repeated:
            repeated.append(value)
        seen.add(value)
    return sorted(repeated)


@dataclass(frozen=True, slots=True)
class LedgerCheckResult:
    """Result returned by :func:`check_learning_ledger`."""

    repo_root: str
    compared: bool
    pattern_count: int
    finding_count: int
    open_count: int
    promoted_pattern_count: int
    issues: tuple[ValidationIssue, ...]

    @property
    def error_count(self) -> int:
        return sum(issue.severity == "error" for issue in self.issues)

    @property
    def warning_count(self) -> int:
        return sum(issue.severity == "warning" for issue in self.issues)

    @property
    def status(self) -> str:
        return "passed" if self.compared and self.error_count == 0 else "failed"

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "compared": self.compared,
            "patterns": self.pattern_count,
            "findings": self.finding_count,
            "open_findings": self.open_count,
            "promoted_patterns": self.promoted_pattern_count,
            "errors": self.error_count,
            "warnings": self.warning_count,
            "issues": [issue.to_dict() for issue in self.issues],
        }


def check_learning_ledger(repo_root: Path | str) -> LedgerCheckResult:
    """Validate the learning ledger's shape and reference integrity."""

    repo_root = Path(repo_root).resolve()
    issues: list[ValidationIssue] = []

    ledger, ledger_issues = _load_document(
        repo_root,
        LEDGER_RELATIVE_PATH,
        LEDGER_SCHEMA_RELATIVE_PATH,
        LEDGER_SCHEMA_VERSION,
        "learning_ledger",
    )
    issues.extend(ledger_issues)
    contract, contract_issues = _load_document(
        repo_root,
        ARCHITECTURE_CONTRACT_RELATIVE_PATH,
        ARCHITECTURE_CONTRACT_SCHEMA_RELATIVE_PATH,
        "ai-bim-architecture-contract/v1",
        "learning.architecture_contract",
    )
    issues.extend(contract_issues)

    if ledger is None:
        return LedgerCheckResult(
            repo_root=str(repo_root),
            compared=False,
            pattern_count=0,
            finding_count=0,
            open_count=0,
            promoted_pattern_count=0,
            issues=_finalize(issues),
        )

    patterns = _list_of_mappings(ledger.get("pattern_classes"))
    pattern_ids = [pid for item in patterns if _non_empty_string(pid := item.get("id"))]
    for duplicate in _duplicates(pattern_ids):
        issues.append(
            _issue(
                "learning.pattern.duplicate",
                "$.pattern_classes",
                f"Pattern class {duplicate!r} is declared more than once.",
            )
        )
    pattern_set = set(pattern_ids)

    invariant_ids: set[str] = set()
    if contract is not None:
        invariant_ids = {
            iid
            for invariant in _list_of_mappings(contract.get("invariants"))
            if _non_empty_string(iid := invariant.get("id"))
        }
    else:
        issues.append(
            _issue(
                "learning.promotion.unverifiable",
                "$.promoted_patterns",
                "The architecture contract could not be loaded, so promoted_to references cannot "
                "be verified; failing closed.",
            )
        )

    promoted = _list_of_mappings(ledger.get("promoted_patterns"))
    for index, entry in enumerate(promoted):
        entry_path = f"$.promoted_patterns[{index}]"
        pattern = entry.get("pattern")
        if pattern not in pattern_set:
            issues.append(
                _issue(
                    "learning.promotion.unknown_pattern",
                    entry_path,
                    f"Promoted pattern {pattern!r} is not a declared pattern class.",
                )
            )
        promoted_to = entry.get("promoted_to")
        if invariant_ids and promoted_to not in invariant_ids:
            issues.append(
                _issue(
                    "learning.promotion.unknown_invariant",
                    entry_path,
                    f"promoted_to {promoted_to!r} is not an invariant declared by the architecture "
                    "contract; a promotion must point at a real gate.",
                )
            )

    findings = _list_of_mappings(ledger.get("findings"))
    finding_ids = [fid for item in findings if _non_empty_string(fid := item.get("id"))]
    for duplicate in _duplicates(finding_ids):
        issues.append(
            _issue(
                "learning.finding.duplicate",
                "$.findings",
                f"Finding {duplicate!r} is declared more than once.",
            )
        )
    open_count = 0
    referenced_patterns: set[str] = set()
    for index, finding in enumerate(findings):
        finding_path = f"$.findings[{index}]"
        pattern = finding.get("pattern")
        if pattern not in pattern_set:
            issues.append(
                _issue(
                    "learning.finding.unknown_pattern",
                    finding_path,
                    f"Finding {finding.get('id')!r} references undeclared pattern {pattern!r}.",
                )
            )
        elif isinstance(pattern, str):
            referenced_patterns.add(pattern)
        status = finding.get("status")
        resolution = finding.get("resolution")
        if not isinstance(status, str) or status not in STATUS_TO_RESOLUTION_KIND:
            continue  # schema already reported the enum violation
        expected_kind = STATUS_TO_RESOLUTION_KIND[status]
        if status == "open":
            open_count += 1
            if resolution is not None:
                issues.append(
                    _issue(
                        "learning.finding.resolution_mismatch",
                        finding_path,
                        f"Finding {finding.get('id')!r} is open but carries a resolution.",
                    )
                )
        else:
            kind = resolution.get("kind") if isinstance(resolution, Mapping) else None
            if kind != expected_kind:
                issues.append(
                    _issue(
                        "learning.finding.resolution_mismatch",
                        finding_path,
                        f"Finding {finding.get('id')!r} has status {status!r} but resolution kind "
                        f"{kind!r}; expected {expected_kind!r}.",
                    )
                )

    for entry in promoted:
        pattern = entry.get("pattern")
        if isinstance(pattern, str):
            referenced_patterns.add(pattern)
    for unused in sorted(pattern_set - referenced_patterns):
        issues.append(
            _issue(
                "learning.pattern.unused",
                f"$.pattern_classes/{unused}",
                f"Pattern class {unused!r} is referenced by no finding and no promotion; drift.",
                severity="warning",
            )
        )

    return LedgerCheckResult(
        repo_root=str(repo_root),
        compared=True,
        pattern_count=len(pattern_set),
        finding_count=len(findings),
        open_count=open_count,
        promoted_pattern_count=len(promoted),
        issues=_finalize(issues),
    )


# --------------------------------------------------------------------------- #
# Quality report
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class QualityReport:
    """Deterministic snapshot of the architecture gates plus attributed debt."""

    repo_root: str
    gates: tuple[tuple[str, str], ...]
    debt: tuple[tuple[str, int], ...]
    ledger: LedgerCheckResult

    @property
    def all_gates_passed(self) -> bool:
        return all(status == "passed" for _, status in self.gates)

    @property
    def total_debt(self) -> int:
        return sum(count for _, count in self.debt)

    @property
    def grade(self) -> str:
        if not self.all_gates_passed:
            return "C"
        return "A" if self.total_debt == 0 else "B"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": QUALITY_REPORT_SCHEMA_VERSION,
            "repo_root": self.repo_root,
            "grade": self.grade,
            "all_gates_passed": self.all_gates_passed,
            "gates": {name: status for name, status in self.gates},
            "debt_inventory": {name: count for name, count in self.debt},
            "total_debt": self.total_debt,
            "learning_ledger": self.ledger.to_dict(),
            "notes": (
                "Snapshot only: the report never repairs anything and does not claim a "
                "historical trend; debt attribution lives in the baseline files and the "
                "learning ledger."
            ),
        }


def _count_baseline_debt(repo_root: Path) -> tuple[list[tuple[str, int]], list[ValidationIssue]]:
    """Count grandfathered baseline entries, failing closed on unreadable files."""

    import json

    issues: list[ValidationIssue] = []
    counts: list[tuple[str, int]] = []
    observed_path = repo_root / OBSERVED_BASELINE_RELATIVE_PATH
    layer_path = repo_root / LAYER_BASELINE_RELATIVE_PATH
    try:
        observed = json.loads(observed_path.read_text(encoding="utf-8"))
        edges = _list_of_mappings(observed.get("service_edges")) if _is_mapping(observed) else []
        cycles = observed.get("cycles") if _is_mapping(observed) else None
        undeclared = [edge for edge in edges if edge.get("status") != "declared"]
        cycle_count = len(cycles) if isinstance(cycles, (list, tuple)) else 0
        counts.append(("observed_undeclared_edges", len(undeclared)))
        counts.append(("observed_grandfathered_cycles", cycle_count))
    except (OSError, ValueError) as exc:
        issues.append(
            _issue(
                "learning.quality.baseline_unreadable",
                OBSERVED_BASELINE_RELATIVE_PATH,
                f"Observed baseline could not be read for the debt inventory: {exc}.",
            )
        )
    try:
        layer = json.loads(layer_path.read_text(encoding="utf-8"))
        violations = layer.get("violations") if _is_mapping(layer) else None
        violation_count = len(violations) if isinstance(violations, (list, tuple)) else 0
        counts.append(("layer_grandfathered_violations", violation_count))
    except (OSError, ValueError) as exc:
        issues.append(
            _issue(
                "learning.quality.baseline_unreadable",
                LAYER_BASELINE_RELATIVE_PATH,
                f"Layer baseline could not be read for the debt inventory: {exc}.",
            )
        )
    return counts, issues


def build_quality_report(repo_root: Path | str) -> tuple[QualityReport, list[ValidationIssue]]:
    """Aggregate every architecture gate plus the ledger into one snapshot."""

    repo_root = Path(repo_root).resolve()
    observed = check_observed_architecture(repo_root)
    layered = check_layered_architecture(repo_root)
    lifecycle = check_lifecycle_contracts(repo_root)
    ledger = check_learning_ledger(repo_root)

    debt_counts, debt_issues = _count_baseline_debt(repo_root)
    gates = (
        ("observed_graph_ratchet", observed.status),
        ("layer_boundary_ratchet", layered.status),
        ("lifecycle_contracts", lifecycle.status),
        ("learning_ledger", ledger.status),
    )
    debt = tuple(debt_counts + [("learning_open_findings", ledger.open_count)])
    report = QualityReport(
        repo_root=str(repo_root),
        gates=gates,
        debt=debt,
        ledger=ledger,
    )
    # An unreadable baseline makes the debt inventory a lie; surface it as a
    # failing condition through the returned issues (the CLI maps it to exit 1).
    return report, _list(debt_issues)


def _list(issues: Iterable[ValidationIssue]) -> list[ValidationIssue]:
    return sorted(set(issues), key=lambda item: (item.severity, item.path, item.code, item.message))


def _finalize(issues: Iterable[ValidationIssue]) -> tuple[ValidationIssue, ...]:
    return tuple(_list(issues))
