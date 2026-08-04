"""Behavioral tests for the default-branch-owned governance trust root."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / "scripts" / "dev" / "check_governance_trust_root.py"
REVIEWER_LOGIN = "monkey1sai-blip"
REVIEWER_ID = 311287868
HEAD = "a" * 40


def _read(relative: str) -> object:
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def _write(root: Path, relative: str, payload: object | str) -> None:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(payload, str):
        target.write_text(payload, encoding="utf-8")
    else:
        target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _fixture(tmp_path: Path) -> tuple[Path, Path]:
    base = tmp_path / "base"
    candidate = tmp_path / "candidate"
    for root in (base, candidate):
        _write(root, "architecture/observed-baseline.json", _read("architecture/observed-baseline.json"))
        _write(root, "architecture/layer-baseline.json", _read("architecture/layer-baseline.json"))
        _write(root, "architecture/architecture-contract.json", {"policy": "base"})
        _write(root, "architecture/observed-graph.config.json", {"policy": "base"})
        _write(root, "architecture/layer-contract.json", {"policy": "base"})
        _write(root, "scripts/verification-manifest.json", {"policy": "base"})
        _write(root, ".github/workflows/governance-trust-root.yml", "name: trusted\n")
        _write(root, "scripts/dev/check_governance_trust_root.py", "# trusted checker\n")
        _write(root, ".github/CODEOWNERS", "* @monkey1sai-blip\n")
    return base, candidate


def _evidence(tmp_path: Path, *, commit_id: str = HEAD, permission: str = "write") -> tuple[Path, Path]:
    reviews = tmp_path / "reviews.json"
    collaborator = tmp_path / "permission.json"
    reviews.write_text(
        json.dumps(
            [
                {
                    "id": 101,
                    "state": "APPROVED",
                    "commit_id": commit_id,
                    "submitted_at": "2026-08-04T00:00:00Z",
                    "user": {"login": REVIEWER_LOGIN, "id": REVIEWER_ID, "type": "User"},
                }
            ]
        ),
        encoding="utf-8",
    )
    collaborator.write_text(
        json.dumps(
            {
                "permission": permission,
                "role_name": permission,
                "user": {"login": REVIEWER_LOGIN, "id": REVIEWER_ID, "type": "User"},
            }
        ),
        encoding="utf-8",
    )
    return reviews, collaborator


def _run(
    base: Path,
    candidate: Path,
    tmp_path: Path,
    *,
    with_approval: bool = False,
    approval_head: str = HEAD,
) -> subprocess.CompletedProcess[str]:
    command = [
        sys.executable,
        str(CHECKER),
        "--base-root",
        str(base),
        "--candidate-root",
        str(candidate),
        "--head-sha",
        HEAD,
        "--format",
        "json",
    ]
    if with_approval:
        reviews, permission = _evidence(tmp_path, commit_id=approval_head)
        command.extend(["--reviews-json", str(reviews), "--permission-json", str(permission)])
    return subprocess.run(command, text=True, capture_output=True, check=False)


def _codes(result: subprocess.CompletedProcess[str]) -> set[str]:
    payload = json.loads(result.stdout)
    return {finding["code"] for finding in payload["findings"]}


def _payload(result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    return json.loads(result.stdout)


def _workflow_run_sources(workflow: str) -> list[str]:
    """Extract inline and multiline YAML ``run`` values without executing YAML."""

    lines = workflow.splitlines()
    sources: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        match = re.match(r"^(\s*)run:\s*(.*)$", line)
        if match is None:
            index += 1
            continue
        indentation = len(match.group(1))
        value = match.group(2).strip()
        if value not in {"|", "|-", "|+", ">", ">-", ">+"}:
            sources.append(value)
            index += 1
            continue
        block: list[str] = []
        index += 1
        while index < len(lines):
            candidate_line = lines[index]
            candidate_indentation = len(candidate_line) - len(candidate_line.lstrip())
            if candidate_line.strip() and candidate_indentation <= indentation:
                break
            block.append(candidate_line)
            index += 1
        sources.append("\n".join(block))
    return sources


def test_unchanged_governance_state_passes_without_review(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)

    result = _run(base, candidate, tmp_path)

    assert result.returncode == 0, result.stderr or result.stdout
    assert _codes(result) == set()


def test_observed_baseline_cannot_add_an_edge_in_the_same_pr(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    baseline = _read("architecture/observed-baseline.json")
    baseline["service_edges"].append(
        {"from": "governance-service", "to": "kit-manager-api", "status": "declared"}
    )
    _write(candidate, "architecture/observed-baseline.json", baseline)

    result = _run(base, candidate, tmp_path, with_approval=True)

    assert result.returncode == 1
    assert "observed_baseline.edge_added" in _codes(result)


def test_observed_baseline_cannot_add_a_cycle_or_raise_a_budget(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    baseline = _read("architecture/observed-baseline.json")
    baseline["cycles"].append(
        {"scope": "module-graph:new", "members": ["a", "b"], "debt": {"owner": "x"}}
    )
    baseline["cycle_budgets"][0]["maximum"] += 1
    _write(candidate, "architecture/observed-baseline.json", baseline)

    result = _run(base, candidate, tmp_path, with_approval=True)

    assert result.returncode == 1
    assert {"observed_baseline.cycle_added", "observed_baseline.budget_increased"} <= _codes(result)


def test_layer_baseline_cannot_add_a_violation_or_raise_a_budget(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    baseline = _read("architecture/layer-baseline.json")
    extra = deepcopy(baseline["violations"][0])
    extra["from"] = "new.module"
    baseline["violations"].append(extra)
    baseline["violation_budgets"][0]["maximum"] += 1
    _write(candidate, "architecture/layer-baseline.json", baseline)

    result = _run(base, candidate, tmp_path, with_approval=True)

    assert result.returncode == 1
    assert {"layer_baseline.violation_added", "layer_baseline.budget_increased"} <= _codes(result)


def test_shrinking_baselines_is_allowed_without_policy_review(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    observed = _read("architecture/observed-baseline.json")
    observed["cycles"] = observed["cycles"][:-1]
    observed["cycle_budgets"][-1]["maximum"] = 0
    layered = _read("architecture/layer-baseline.json")
    layered["violations"] = layered["violations"][:-1]
    layered["violation_budgets"][-1]["maximum"] = 0
    _write(candidate, "architecture/observed-baseline.json", observed)
    _write(candidate, "architecture/layer-baseline.json", layered)

    result = _run(base, candidate, tmp_path)

    assert result.returncode == 0, result.stderr or result.stdout


def test_removing_a_budget_or_adding_a_zero_budget_is_tightening(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    observed = _read("architecture/observed-baseline.json")
    observed["cycle_budgets"] = observed["cycle_budgets"][1:]
    observed["cycle_budgets"].append({"scope": "module-graph:new", "maximum": 0})
    layered = _read("architecture/layer-baseline.json")
    layered["violation_budgets"] = layered["violation_budgets"][1:]
    layered["violation_budgets"].append({"service": "new-service", "maximum": 0})
    _write(candidate, "architecture/observed-baseline.json", observed)
    _write(candidate, "architecture/layer-baseline.json", layered)

    result = _run(base, candidate, tmp_path)

    assert result.returncode == 0, result.stderr or result.stdout


def test_top_level_baseline_metadata_must_match_the_trusted_base(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    observed = _read("architecture/observed-baseline.json")
    observed["approved_by"] = "candidate"
    layered = _read("architecture/layer-baseline.json")
    layered["candidate_note"] = "untrusted"
    _write(candidate, "architecture/observed-baseline.json", observed)
    _write(candidate, "architecture/layer-baseline.json", layered)

    result = _run(base, candidate, tmp_path, with_approval=True)

    assert result.returncode == 1
    assert {
        "observed_baseline.metadata_changed",
        "layer_baseline.metadata_changed",
    } <= _codes(result)


def test_retained_baseline_records_must_keep_their_exact_metadata(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    observed = _read("architecture/observed-baseline.json")
    observed["service_edges"][0]["note"] = "candidate changed the evidence"
    observed["cycles"][0]["debt"]["owner"] = "candidate"
    layered = _read("architecture/layer-baseline.json")
    layered["violations"][0]["from_layer"] = "candidate-layer"
    _write(candidate, "architecture/observed-baseline.json", observed)
    _write(candidate, "architecture/layer-baseline.json", layered)

    result = _run(base, candidate, tmp_path, with_approval=True)

    assert result.returncode == 1
    codes = _codes(result)
    assert {
        "observed_baseline.edge_metadata_changed",
        "observed_baseline.cycle_metadata_changed",
        "layer_baseline.violation_metadata_changed",
    } <= codes
    assert "layer_baseline.violation_added" not in codes


def test_retained_budget_may_only_lower_maximum_without_changing_metadata(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    observed = _read("architecture/observed-baseline.json")
    observed["cycle_budgets"][0]["note"] = "candidate changed policy context"
    layered = _read("architecture/layer-baseline.json")
    layered["violation_budgets"][1]["owner"] = "candidate"
    _write(candidate, "architecture/observed-baseline.json", observed)
    _write(candidate, "architecture/layer-baseline.json", layered)

    result = _run(base, candidate, tmp_path, with_approval=True)

    assert result.returncode == 1
    assert {
        "observed_baseline.budget_metadata_changed",
        "layer_baseline.budget_metadata_changed",
    } <= _codes(result)


def test_layer_violation_identity_excludes_optional_layer_metadata(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    layered = _read("architecture/layer-baseline.json")
    del layered["violations"][0]["from_layer"]
    del layered["violations"][0]["to_layer"]
    _write(candidate, "architecture/layer-baseline.json", layered)

    result = _run(base, candidate, tmp_path, with_approval=True)

    assert result.returncode == 1
    assert "layer_baseline.violation_metadata_changed" in _codes(result)
    assert "layer_baseline.violation_added" not in _codes(result)


def test_policy_change_requires_fixed_reviewer_approval_at_exact_head(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    _write(candidate, "architecture/architecture-contract.json", {"policy": "candidate"})

    missing = _run(base, candidate, tmp_path)
    stale = _run(base, candidate, tmp_path, with_approval=True, approval_head="b" * 40)
    exact = _run(base, candidate, tmp_path, with_approval=True)

    assert missing.returncode == 1
    assert stale.returncode == 1
    assert "policy_change.exact_head_approval_missing" in _codes(missing)
    assert "policy_change.exact_head_approval_missing" in _codes(stale)
    assert exact.returncode == 0, exact.stderr or exact.stdout


def test_trust_root_mechanism_cannot_change_without_exact_head_approval(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    _write(candidate, ".github/workflows/governance-trust-root.yml", "name: candidate\n")
    _write(candidate, "scripts/dev/check_governance_trust_root.py", "# candidate checker\n")

    result = _run(base, candidate, tmp_path)

    assert result.returncode == 1
    assert "policy_change.exact_head_approval_missing" in _codes(result)


def test_governance_enforcement_tests_are_policy_bearing_paths(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    protected_tests = {
        "tests/test_architecture_contract.py",
        "tests/test_observed_architecture.py",
        "tests/test_layered_architecture.py",
        "tests/test_governance_trust_root.py",
        "tests/conftest.py",
    }
    for relative in protected_tests:
        _write(candidate, relative, "# candidate changed the enforcement oracle\n")

    result = _run(base, candidate, tmp_path)

    assert result.returncode == 1
    payload = _payload(result)
    assert "policy_change.exact_head_approval_missing" in _codes(result)
    assert protected_tests <= set(payload["protected_changed_paths"])


def test_latest_decisive_fixed_reviewer_state_must_still_be_approved(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    _write(candidate, "scripts/new-policy-check.py", "# candidate policy\n")
    reviews, permission = _evidence(tmp_path)
    payload = json.loads(reviews.read_text(encoding="utf-8"))
    payload.append(
        {
            "id": 102,
            "state": "CHANGES_REQUESTED",
            "commit_id": HEAD,
            "submitted_at": "2026-08-04T00:01:00Z",
            "user": {"login": REVIEWER_LOGIN, "id": REVIEWER_ID, "type": "User"},
        }
    )
    reviews.write_text(json.dumps(payload), encoding="utf-8")
    command = [
        sys.executable,
        str(CHECKER),
        "--base-root",
        str(base),
        "--candidate-root",
        str(candidate),
        "--head-sha",
        HEAD,
        "--reviews-json",
        str(reviews),
        "--permission-json",
        str(permission),
        "--format",
        "json",
    ]

    result = subprocess.run(command, text=True, capture_output=True, check=False)

    assert result.returncode == 1
    assert "policy_change.exact_head_approval_missing" in _codes(result)


def test_malformed_or_missing_candidate_baseline_fails_closed(tmp_path: Path) -> None:
    base, candidate = _fixture(tmp_path)
    (candidate / "architecture/observed-baseline.json").write_text("not json", encoding="utf-8")
    malformed = _run(base, candidate, tmp_path)
    (candidate / "architecture/observed-baseline.json").unlink()
    missing = _run(base, candidate, tmp_path)

    assert malformed.returncode == 1
    assert missing.returncode == 1
    assert _codes(malformed) == {"trust_root.input_invalid"}
    assert _codes(missing) == {"trust_root.input_invalid"}


def test_trust_root_workflow_runs_only_the_base_owned_checker() -> None:
    workflow = (ROOT / ".github" / "workflows" / "governance-trust-root.yml").read_text(
        encoding="utf-8"
    )

    assert "pull_request_target:" in workflow
    assert "pull_request_review:" in workflow
    assert "name: Governance Base Audit" in workflow
    assert "name: governance-base-audit" in workflow
    assert "trusted-base/scripts/dev/check_governance_trust_root.py" in workflow
    assert "candidate/scripts/dev/check_governance_trust_root.py" not in workflow
    assert "persist-credentials: false" in workflow
    assert "statuses: write" not in workflow
    assert "checks: write" not in workflow
    assert "repository: ${{ github.event.pull_request.head.repo.full_name }}" in workflow
    assert re.search(r"(?m)^\s*uses:\s*\./candidate(?:/|\s*$)", workflow) is None
    assert re.search(r"(?m)^\s*working-directory:\s*candidate(?:/|\s*$)", workflow) is None

    run_source = "\n".join(_workflow_run_sources(workflow))
    assert any("\n" in source for source in _workflow_run_sources(workflow))
    assert "trusted-base/scripts/dev/check_governance_trust_root.py" in run_source
    candidate_root_argument = re.compile(
        r"(?m)^\s*--candidate-root\s+candidate\s*\\\s*$"
    )
    assert len(candidate_root_argument.findall(run_source)) == 1
    candidate_execution_source = candidate_root_argument.sub("", run_source)
    assert re.search(
        r"(?<![A-Za-z0-9_-])candidate(?![A-Za-z0-9_-])",
        candidate_execution_source,
    ) is None
    assert re.search(r"(?<![A-Za-z0-9_-])candidate(?:/|\\)", candidate_execution_source) is None
    assert re.search(
        r"(?im)(?:^|[;&|]\s*)(?:\./)?candidate(?:/|\\)[^\s]*",
        candidate_execution_source,
    ) is None
