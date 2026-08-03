"""Fail-closed tests for the layer boundary ratchet (Phase 3)."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.architecture_contract import validate_schema_instance  # noqa: E402
from scripts.lib.layered_architecture import (  # noqa: E402
    BASELINE_SCHEMA_VERSION,
    CONTRACT_SCHEMA_VERSION,
    LayerReport,
    LayerViolation,
    ServiceLayerScan,
    _assign_layer,
    _load_layer_baseline,
    _load_layer_contract,
    _validate_coverage,
    build_layer_report,
    check_layered_architecture,
    compare_layers_to_baseline,
    render_layer_report_json,
)
from scripts.lib.observed_architecture import _load_config as _load_observed_config  # noqa: E402


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def load_contract() -> dict:
    return json.loads((ROOT / "architecture" / "layer-contract.json").read_text(encoding="utf-8"))


def load_baseline() -> dict:
    return json.loads((ROOT / "architecture" / "layer-baseline.json").read_text(encoding="utf-8"))


def load_observed_config() -> dict:
    return json.loads(
        (ROOT / "architecture" / "observed-graph.config.json").read_text(encoding="utf-8")
    )


def issue_codes(issues) -> set[str]:
    return {issue.code for issue in issues}


def make_scan(
    service: str,
    assignments: dict[str, str] | None = None,
    unassigned: tuple[str, ...] = (),
    unused_rules: tuple[str, ...] = (),
    language: str = "python",
) -> ServiceLayerScan:
    pairs = tuple(sorted((assignments or {"m": "domain"}).items()))
    return ServiceLayerScan(
        service=service,
        language=language,
        modules=tuple(module for module, _ in pairs) + unassigned,
        assignments=pairs,
        edges=(),
        unassigned_modules=unassigned,
        unused_rules=unused_rules,
        scanned_file_count=len(pairs),
        declared_layers=tuple(sorted({layer for _, layer in pairs})),
    )


def make_report(
    violations: list[tuple[str, str, str]],
    services: list[ServiceLayerScan] | None = None,
) -> LayerReport:
    scans = services if services is not None else [make_scan(name) for name, _, _ in violations]
    if not scans:
        scans = [make_scan("svc")]
    return LayerReport(
        services=tuple(scans),
        violations=tuple(
            LayerViolation(
                service=service,
                from_module=source,
                from_layer="infrastructure",
                to_module=target,
                to_layer="api",
            )
            for service, source, target in sorted(violations)
        ),
        unreadable_files=(),
        unparsed_files=(),
    )


def baseline_of(
    violations: list[tuple[str, str, str]], budgets: dict[str, int]
) -> dict:
    return {
        "schema_version": BASELINE_SCHEMA_VERSION,
        "violations": [
            {
                "service": service,
                "from": source,
                "to": target,
                "debt": {"owner": "o", "reason": "r", "target_phase": "p"},
            }
            for service, source, target in violations
        ],
        "violation_budgets": [
            {"service": service, "maximum": maximum} for service, maximum in budgets.items()
        ],
    }


# --------------------------------------------------------------------------- #
# Canonical repository
# --------------------------------------------------------------------------- #


def test_canonical_repository_layer_ratchet_passes() -> None:
    result = check_layered_architecture(ROOT)

    assert result.compared is True
    assert result.error_count == 0, [issue.to_dict() for issue in result.issues]
    # A stale baseline or a rule that matches nothing is only a warning, but the
    # canonical repository must carry neither, otherwise the gate rots quietly.
    assert result.warning_count == 0, [issue.to_dict() for issue in result.issues]
    assert result.status == "passed"


def test_canonical_contract_and_baseline_match_their_schemas() -> None:
    for document, schema_name in (
        (load_contract(), "layer-contract.schema.json"),
        (load_baseline(), "layer-baseline.schema.json"),
    ):
        schema = json.loads((ROOT / "architecture" / schema_name).read_text(encoding="utf-8"))
        assert validate_schema_instance(document, schema) == []


def test_canonical_every_scanned_service_is_layered_or_excluded() -> None:
    assert _validate_coverage(load_observed_config(), load_contract()) == []


def test_canonical_budgets_have_no_slack_over_the_baseline() -> None:
    """A budget above the grandfathered count is room to add new violations."""

    baseline = load_baseline()
    counted: dict[str, int] = {}
    for entry in baseline["violations"]:
        counted[entry["service"]] = counted.get(entry["service"], 0) + 1
    for budget in baseline["violation_budgets"]:
        assert budget["maximum"] == counted.get(budget["service"], 0), budget["service"]


def test_canonical_baseline_debt_entries_are_attributed() -> None:
    for entry in load_baseline()["violations"]:
        debt = entry["debt"]
        assert debt["owner"] and debt["reason"] and debt["target_phase"]


def test_canonical_every_scanned_module_is_assigned_to_a_layer() -> None:
    config, _ = _load_observed_config(ROOT)
    report = build_layer_report(ROOT, config, load_contract())

    assert report.services
    for scan in report.services:
        assert scan.unassigned_modules == (), (scan.service, scan.unassigned_modules)
        assert scan.modules, scan.service


def test_canonical_report_is_deterministic() -> None:
    config, _ = _load_observed_config(ROOT)
    contract = load_contract()
    first = render_layer_report_json(build_layer_report(ROOT, config, contract))
    second = render_layer_report_json(build_layer_report(ROOT, config, contract))

    assert first == second
    assert "\r\n" not in first


def test_canonical_report_records_only_repository_relative_module_ids() -> None:
    config, _ = _load_observed_config(ROOT)
    payload = json.loads(render_layer_report_json(build_layer_report(ROOT, config, load_contract())))

    for scan in payload["services"]:
        for assignment in scan["assignments"]:
            module = assignment["module"]
            assert not module.startswith("/")
            assert "\\" not in module
            assert str(ROOT) not in module


def test_canonical_contract_discloses_the_tooling_deviation() -> None:
    """The named tools were not adopted; that must stay machine-readable."""

    deviation = load_contract()["tooling_deviation"]

    assert deviation["adopted"] is False
    assert set(deviation["named_tools"]) == {"dependency-cruiser", "import-linter"}
    assert len(deviation["reason"]) > 80


# --------------------------------------------------------------------------- #
# Ratchet behaviour
# --------------------------------------------------------------------------- #


def test_baselined_violation_is_accepted() -> None:
    report = make_report([("svc", "a", "b")])
    issues = compare_layers_to_baseline(report, baseline_of([("svc", "a", "b")], {"svc": 1}))

    assert issue_codes(issues) == set()


def test_new_violation_is_rejected() -> None:
    report = make_report([("svc", "a", "b")])
    issues = compare_layers_to_baseline(report, baseline_of([], {"svc": 0}))

    assert "layer.violation.new" in issue_codes(issues)


def test_disappearing_violation_is_a_tightening_warning_not_an_error() -> None:
    report = make_report([], services=[make_scan("svc")])
    issues = compare_layers_to_baseline(report, baseline_of([("svc", "a", "b")], {"svc": 1}))

    stale = [issue for issue in issues if issue.code == "layer.baseline_stale"]
    assert stale and all(issue.severity == "warning" for issue in stale)
    assert not [issue for issue in issues if issue.severity == "error"]


def test_violation_swap_that_keeps_the_count_is_still_rejected() -> None:
    """Removing one violation and adding another must not net out to a pass."""

    report = make_report([("svc", "c", "d")])
    issues = compare_layers_to_baseline(report, baseline_of([("svc", "a", "b")], {"svc": 1}))

    assert "layer.violation.new" in issue_codes(issues)


def test_budget_exceeded_is_rejected() -> None:
    report = make_report([("svc", "a", "b"), ("svc", "c", "d")])
    baseline = baseline_of([("svc", "a", "b"), ("svc", "c", "d")], {"svc": 1})
    issues = compare_layers_to_baseline(report, baseline)

    assert "layer.budget_exceeded" in issue_codes(issues)


def test_service_without_a_budget_is_rejected() -> None:
    report = make_report([], services=[make_scan("svc")])
    issues = compare_layers_to_baseline(report, baseline_of([], {}))

    assert "layer.budget_missing" in issue_codes(issues)


def test_baseline_entry_for_an_unlayered_service_is_rejected() -> None:
    report = make_report([], services=[make_scan("svc")])
    issues = compare_layers_to_baseline(report, baseline_of([("ghost", "a", "b")], {"svc": 0}))

    assert "layer.baseline_unknown_service" in issue_codes(issues)


def test_unassigned_module_is_an_error() -> None:
    scan = make_scan("svc", {"kept": "domain"}, unassigned=("orphan",))
    issues = compare_layers_to_baseline(make_report([], services=[scan]), baseline_of([], {"svc": 0}))

    assert "layer.module.unassigned" in issue_codes(issues)


def test_rule_that_matches_nothing_is_a_warning() -> None:
    scan = make_scan("svc", {"kept": "domain"}, unused_rules=("exact:gone.py",))
    issues = compare_layers_to_baseline(make_report([], services=[scan]), baseline_of([], {"svc": 0}))

    unused = [issue for issue in issues if issue.code == "layer.rule.unused"]
    assert unused and all(issue.severity == "warning" for issue in unused)


def test_service_that_produced_no_modules_is_an_error() -> None:
    scan = ServiceLayerScan("svc", "python", (), (), (), (), (), 0)
    issues = compare_layers_to_baseline(make_report([], services=[scan]), baseline_of([], {"svc": 0}))

    assert "layer.service.empty" in issue_codes(issues)


def test_violation_identity_ignores_layer_names() -> None:
    """Relabelling a layer must not launder an existing violation into a new one."""

    relabelled = LayerViolation("svc", "a", "ui", "b", "domain")
    original = LayerViolation("svc", "a", "infrastructure", "b", "api")

    assert relabelled.identity == original.identity


# --------------------------------------------------------------------------- #
# Fail-closed inputs
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("target", ["layer-contract.json", "layer-baseline.json"])
def test_missing_document_fails_closed(tmp_path: Path, target: str) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    (tmp_path / "architecture" / target).unlink()

    result = check_layered_architecture(tmp_path)

    assert result.compared is False
    assert result.status == "failed"


@pytest.mark.parametrize("payload", ["null", "[]", "123", '"text"'])
@pytest.mark.parametrize("target", ["layer-contract.json", "layer-baseline.json"])
def test_valid_json_that_is_not_an_object_fails_closed(
    tmp_path: Path, target: str, payload: str
) -> None:
    """`echo null > layer-baseline.json` must not read as a clean run."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    (tmp_path / "architecture" / target).write_text(payload, encoding="utf-8")

    result = check_layered_architecture(tmp_path)

    assert result.compared is False
    assert result.status == "failed"
    assert result.error_count > 0


@pytest.mark.parametrize(
    "target", ["layer-contract.schema.json", "layer-baseline.schema.json"]
)
def test_corrupt_schema_file_fails_closed(tmp_path: Path, target: str) -> None:
    """Replacing a schema with null would otherwise disable every schema check."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    (tmp_path / "architecture" / target).write_text("null", encoding="utf-8")

    if target.startswith("layer-contract"):
        _, issues = _load_layer_contract(tmp_path)
        assert "layer_contract.schema_not_object" in issue_codes(issues)
    else:
        _, issues = _load_layer_baseline(tmp_path)
        assert "layer_baseline.schema_not_object" in issue_codes(issues)


def test_baseline_without_debt_attribution_fails_closed(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-baseline.json"
    baseline = json.loads(path.read_text(encoding="utf-8"))
    for entry in baseline["violations"]:
        entry.pop("debt", None)
    path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")

    _, issues = _load_layer_baseline(tmp_path)

    assert "layer_baseline.debt_missing" in issue_codes(issues)


def test_debt_attribution_is_enforced_without_relying_on_the_schema_file(
    tmp_path: Path,
) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    (tmp_path / "architecture" / "layer-baseline.schema.json").write_text("null", encoding="utf-8")
    path = tmp_path / "architecture" / "layer-baseline.json"
    baseline = json.loads(path.read_text(encoding="utf-8"))
    for entry in baseline["violations"]:
        entry.pop("debt", None)
    path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")

    _, issues = _load_layer_baseline(tmp_path)

    assert "layer_baseline.debt_missing" in issue_codes(issues)


def test_duplicate_baseline_entries_are_rejected(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-baseline.json"
    baseline = json.loads(path.read_text(encoding="utf-8"))
    baseline["violations"].append(deepcopy(baseline["violations"][0]))
    path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")

    _, issues = _load_layer_baseline(tmp_path)

    assert "layer_baseline.duplicate" in issue_codes(issues)


@pytest.mark.parametrize(
    ("target", "version_key", "code"),
    [
        ("layer-contract.json", CONTRACT_SCHEMA_VERSION, "layer_contract.schema_version"),
        ("layer-baseline.json", BASELINE_SCHEMA_VERSION, "layer_baseline.schema_version"),
    ],
)
def test_wrong_schema_version_fails_closed(
    tmp_path: Path, target: str, version_key: str, code: str
) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / target
    document = json.loads(path.read_text(encoding="utf-8"))
    document["schema_version"] = version_key.replace("/v1", "/v0")
    path.write_text(json.dumps(document, indent=2), encoding="utf-8")

    loader = _load_layer_contract if target.startswith("layer-contract") else _load_layer_baseline
    _, issues = loader(tmp_path)

    assert code in issue_codes(issues)
    assert "schema.instance.const" in issue_codes(issues)


def test_contract_with_unknown_property_fails_closed(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    contract["surprise"] = True
    path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    _, issues = _load_layer_contract(tmp_path)

    assert "schema.instance.additional_property" in issue_codes(issues)


def test_allowed_matrix_missing_a_layer_fails_closed(tmp_path: Path) -> None:
    """An absent row must not be read as 'this layer depends on nothing'."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    contract["layer_sets"][0]["allowed"] = contract["layer_sets"][0]["allowed"][:2]
    path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    _, issues = _load_layer_contract(tmp_path)

    assert "layer_contract.allowed_incomplete" in issue_codes(issues)


def test_allowed_matrix_naming_an_undeclared_layer_fails_closed(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    contract["layer_sets"][0]["allowed"][0]["to"].append("nowhere")
    path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    _, issues = _load_layer_contract(tmp_path)

    assert "layer_contract.allowed_unknown_target" in issue_codes(issues)


def test_rule_naming_an_undeclared_layer_fails_closed(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    contract["services"][0]["rules"][0]["layer"] = "nowhere"
    path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    _, issues = _load_layer_contract(tmp_path)

    assert "layer_contract.rule_layer" in issue_codes(issues)


def test_duplicate_rule_is_rejected(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    contract["services"][0]["rules"].append(deepcopy(contract["services"][0]["rules"][0]))
    path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    _, issues = _load_layer_contract(tmp_path)

    assert "layer_contract.rule_duplicate" in issue_codes(issues)


# --------------------------------------------------------------------------- #
# Coverage of the scanned surface
# --------------------------------------------------------------------------- #


def test_service_that_is_scanned_but_never_layered_fails_closed() -> None:
    contract = deepcopy(load_contract())
    contract["services"] = [entry for entry in contract["services"] if entry["id"] != "kit-manager-api"]

    issues = _validate_coverage(load_observed_config(), contract)

    assert "layer_contract.service_uncovered" in issue_codes(issues)


def test_excluded_service_needs_a_reason() -> None:
    contract = deepcopy(load_contract())
    contract["services"] = [entry for entry in contract["services"] if entry["id"] != "kit-manager-api"]
    contract["excluded_services"] = [{"id": "kit-manager-api", "reason": ""}]

    issues = _validate_coverage(load_observed_config(), contract)

    assert "layer_contract.exclusion_unreasoned" in issue_codes(issues)


def test_service_cannot_be_layered_and_excluded_at_once() -> None:
    contract = deepcopy(load_contract())
    contract["excluded_services"] = [{"id": "kit-manager-api", "reason": "because"}]

    issues = _validate_coverage(load_observed_config(), contract)

    assert "layer_contract.coverage_conflict" in issue_codes(issues)


def test_layered_service_that_is_never_scanned_fails_closed() -> None:
    contract = deepcopy(load_contract())
    contract["services"].append({"id": "ghost-service", "rules": [{"match": "exact", "value": "x", "layer": "domain"}]})

    issues = _validate_coverage(load_observed_config(), contract)

    assert "layer_contract.service_unknown" in issue_codes(issues)


def test_stale_exclusion_fails_closed() -> None:
    contract = deepcopy(load_contract())
    contract["excluded_services"] = [{"id": "retired-service", "reason": "gone"}]

    issues = _validate_coverage(load_observed_config(), contract)

    assert "layer_contract.exclusion_unknown" in issue_codes(issues)


# --------------------------------------------------------------------------- #
# Classification
# --------------------------------------------------------------------------- #


def test_first_matching_rule_wins() -> None:
    rules = [
        {"match": "exact", "value": "console/coordinatorClient.ts", "layer": "client"},
        {"match": "prefix", "value": "console/", "layer": "ui"},
    ]

    assert _assign_layer("console/coordinatorClient.ts", rules)[0] == "client"
    assert _assign_layer("console/EdgeConsole.tsx", rules)[0] == "ui"


def test_unmatched_module_yields_no_layer() -> None:
    assert _assign_layer("mystery.ts", [{"match": "exact", "value": "other.ts", "layer": "ui"}]) == (
        None,
        None,
    )


def test_canonical_transport_adapters_under_console_are_not_ui() -> None:
    config, _ = _load_observed_config(ROOT)
    report = build_layer_report(ROOT, config, load_contract())
    viewer = next(scan for scan in report.services if scan.service == "web-viewer-sample")
    layers = dict(viewer.assignments)

    assert layers["console/coordinatorClient.ts"] == "client"
    assert layers["console/governanceClient.ts"] == "client"
    assert layers["console/EdgeConsole.tsx"] == "ui"
    assert layers["console/routing.ts"] == "application"


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "dev" / "check_layered_architecture.py"), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_cli_reports_passing_json_status() -> None:
    completed = run_cli("--repo-root", str(ROOT), "--format", "json")

    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["status"] == "passed"
    assert payload["compared"] is True
    assert payload["report"]["extraction_method"] == "stdlib-static-source-scan"


def test_cli_report_only_output_is_byte_identical_across_runs(tmp_path: Path) -> None:
    outputs = []
    for name in ("first.json", "second.json"):
        target = tmp_path / name
        completed = run_cli("--repo-root", str(ROOT), "--report-only", "--output", str(target))
        assert completed.returncode == 0, completed.stderr
        outputs.append(target.read_bytes())

    assert outputs[0] == outputs[1]
    assert b"\r\n" not in outputs[0]


@pytest.mark.parametrize("flag", ["--strict", "--report-only"])
def test_cli_accepts_documented_flags(flag: str) -> None:
    completed = run_cli("--repo-root", str(ROOT), flag)

    assert completed.returncode == 0, completed.stderr


# --------------------------------------------------------------------------- #
# Adversarial round 1 repairs
# --------------------------------------------------------------------------- #


def test_canonical_layer_contract_covers_every_scanned_service() -> None:
    """Moving a service into `excluded_services` must not be a silent escape hatch."""

    contract = load_contract()

    assert contract["excluded_services"] == []
    assert {entry["id"] for entry in contract["services"]} == {
        "bim-review-coordinator",
        "bim-streaming-server",
        "governance-service",
        "kit-manager-api",
        "kit-manager-web",
        "web-viewer-sample",
    }


# The gate compares the contract's declared layer set against the contract's own
# rules, so an edit to both halves is invisible to it. These literals are the
# independent pin: loosening the policy surface must require editing this file
# too, which is what makes the change visible in review.
PINNED_SERVICE_LAYERS = {
    "bim-review-coordinator": ("application", "client", "domain"),
    "bim-streaming-server": ("api", "application", "domain", "infrastructure"),
    "governance-service": ("api", "application", "domain", "infrastructure"),
    "kit-manager-api": ("api", "application", "domain", "infrastructure"),
    "kit-manager-web": ("client", "domain", "ui"),
    "web-viewer-sample": ("application", "client", "domain", "ui"),
}

PINNED_ALLOWED_MATRIX = {
    "typescript": {
        "ui": ("application", "client", "domain"),
        "application": ("client", "domain"),
        "client": ("domain",),
        "domain": (),
    },
    "python": {
        "api": ("application", "domain", "infrastructure"),
        "application": ("domain", "infrastructure"),
        "infrastructure": ("domain",),
        "domain": (),
    },
}


def test_canonical_service_layer_sets_are_pinned() -> None:
    """Editing `layers` to match a collapsed rule set must not pass silently."""

    declared = {
        entry["id"]: tuple(sorted(entry["layers"])) for entry in load_contract()["services"]
    }

    assert declared == PINNED_SERVICE_LAYERS


def test_canonical_allowed_matrix_is_pinned() -> None:
    """Widening one row would disable a rule for every service of that language."""

    actual = {
        entry["language"]: {
            row["from"]: tuple(sorted(row["to"])) for row in entry["allowed"]
        }
        for entry in load_contract()["layer_sets"]
    }

    assert actual == {
        language: {source: tuple(sorted(targets)) for source, targets in rows.items()}
        for language, rows in PINNED_ALLOWED_MATRIX.items()
    }


def test_canonical_service_languages_are_pinned() -> None:
    declared = {entry["id"]: entry["language"] for entry in load_contract()["services"]}

    assert declared == {
        "bim-review-coordinator": "typescript",
        "bim-streaming-server": "python",
        "governance-service": "python",
        "kit-manager-api": "python",
        "kit-manager-web": "typescript",
        "web-viewer-sample": "typescript",
    }


def test_canonical_observed_layers_match_the_pinned_sets() -> None:
    """The pin is only worth anything if the code actually resolves to it."""

    config, _ = _load_observed_config(ROOT)
    report = build_layer_report(ROOT, config, load_contract())

    assert {scan.service: scan.observed_layers() for scan in report.services} == {
        service: tuple(layers) for service, layers in PINNED_SERVICE_LAYERS.items()
    }


@pytest.mark.parametrize(
    ("schema_name", "required_keys"),
    [
        (
            "layer-contract.schema.json",
            ("additionalProperties", "required", "properties", "definitions"),
        ),
        (
            "layer-baseline.schema.json",
            ("additionalProperties", "required", "properties", "definitions"),
        ),
    ],
)
def test_canonical_schema_files_keep_their_load_bearing_constraints(
    schema_name: str, required_keys: tuple[str, ...]
) -> None:
    """`schema_vacuous` is a truthiness heuristic; a plausible stub would slip past it."""

    schema = json.loads((ROOT / "architecture" / schema_name).read_text(encoding="utf-8"))

    for key in required_keys:
        assert key in schema, key
    assert schema["additionalProperties"] is False
    assert len(schema["required"]) >= 5
    assert len(schema["properties"]) >= 6


def test_duplicate_language_layer_set_cannot_override_the_matrix(tmp_path: Path) -> None:
    """A second, permissive row for the same language would win silently."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    permissive = deepcopy(contract["layer_sets"][0])
    permissive["allowed"] = [
        {"from": layer, "to": [other for other in permissive["layers"] if other != layer]}
        for layer in permissive["layers"]
    ]
    contract["layer_sets"].append(permissive)
    path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    _, issues = _load_layer_contract(tmp_path)

    assert "layer_contract.duplicate_language" in issue_codes(issues)


def test_duplicate_service_entry_cannot_override_the_rules(tmp_path: Path) -> None:
    """A second entry for one service would replace its whole rule list."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    contract["services"].append(
        {
            "id": contract["services"][0]["id"],
            "layers": ["application", "domain"],
            "rules": [{"match": "prefix", "value": "a/", "layer": "application"}],
        }
    )
    path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    _, issues = _load_layer_contract(tmp_path)

    assert "layer_contract.duplicate_service" in issue_codes(issues)


def test_collapsing_a_service_into_one_layer_is_rejected() -> None:
    """A catch-all rule must not silently unlayer a whole service."""

    scan = make_scan("svc", {"a": "domain", "b": "domain"})
    collapsed = ServiceLayerScan(
        service=scan.service,
        language=scan.language,
        modules=scan.modules,
        assignments=scan.assignments,
        edges=scan.edges,
        unassigned_modules=(),
        unused_rules=(),
        scanned_file_count=scan.scanned_file_count,
        declared_layers=("application", "domain", "infrastructure"),
    )
    issues = compare_layers_to_baseline(
        make_report([], services=[collapsed]), baseline_of([], {"svc": 0})
    )

    assert "layer.service.layer_set_drift" in issue_codes(issues)


def test_budget_slack_above_the_baseline_is_rejected_by_the_gate() -> None:
    """"No slack" must be enforced by the gate, not only by a deletable test."""

    report = make_report([("svc", "a", "b")])
    issues = compare_layers_to_baseline(report, baseline_of([("svc", "a", "b")], {"svc": 99}))

    assert "layer.budget_slack" in issue_codes(issues)


@pytest.mark.parametrize(
    "target", ["layer-contract.schema.json", "layer-baseline.schema.json"]
)
def test_vacuous_schema_file_fails_closed(tmp_path: Path, target: str) -> None:
    """`{}` is a valid schema that accepts everything and must not pass."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    (tmp_path / "architecture" / target).write_text("{}", encoding="utf-8")

    loader = _load_layer_contract if target.startswith("layer-contract") else _load_layer_baseline
    _, issues = loader(tmp_path)

    assert any(code.endswith(".schema_vacuous") for code in issue_codes(issues))


def test_unanchored_prefix_rule_is_rejected(tmp_path: Path) -> None:
    """`prefix: "types"` would absorb `typesHelper.ts`."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    contract["services"][0]["rules"].append(
        {"match": "prefix", "value": "serv", "layer": "domain"}
    )
    path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    _, issues = _load_layer_contract(tmp_path)

    assert "layer_contract.prefix_unanchored" in issue_codes(issues)


def test_suffix_rule_is_rejected(tmp_path: Path) -> None:
    """A bare extension rule turns the unassigned-module error into a default."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    contract["services"][0]["rules"].append({"match": "suffix", "value": ".ts", "layer": "ui"})
    path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    _, issues = _load_layer_contract(tmp_path)

    assert "layer_contract.suffix_rule" in issue_codes(issues)


def test_canonical_contract_uses_no_suffix_rules() -> None:
    for service in load_contract()["services"]:
        for rule in service["rules"]:
            assert rule["match"] in {"exact", "prefix"}, (service["id"], rule)
            if rule["match"] == "prefix":
                assert rule["value"].endswith(("/", ".")), (service["id"], rule)


# --------------------------------------------------------------------------- #
# Adversarial round 3 repairs (PR review: CodeRabbit / Copilot / Codex)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("field", ["service", "from", "to"])
def test_baseline_entry_with_a_missing_identity_field_is_rejected(
    tmp_path: Path, field: str
) -> None:
    """`str(None)` is a non-empty string, so the guard must read the raw value."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-baseline.json"
    baseline = json.loads(path.read_text(encoding="utf-8"))
    baseline["violations"][0].pop(field, None)
    path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")

    _, issues = _load_layer_baseline(tmp_path)

    assert "layer_baseline.entry_incomplete" in issue_codes(issues)


@pytest.mark.parametrize("field", ["service", "from", "to"])
def test_baseline_entry_with_a_null_identity_field_is_rejected(
    tmp_path: Path, field: str
) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-baseline.json"
    baseline = json.loads(path.read_text(encoding="utf-8"))
    baseline["violations"][0][field] = None
    path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")

    _, issues = _load_layer_baseline(tmp_path)

    assert "layer_baseline.entry_incomplete" in issue_codes(issues)


def test_duplicate_allowed_row_is_rejected(tmp_path: Path) -> None:
    """Two rows for one `from` layer: the later would silently replace the earlier."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    path = tmp_path / "architecture" / "layer-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    layer_set = contract["layer_sets"][0]
    first = layer_set["allowed"][0]
    layer_set["allowed"].append({"from": first["from"], "to": list(layer_set["layers"])[1:]})
    path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    _, issues = _load_layer_contract(tmp_path)

    assert "layer_contract.duplicate_allowed_row" in issue_codes(issues)


def test_report_only_fails_when_a_source_file_cannot_be_read(tmp_path: Path) -> None:
    """A report built from a partial scan must not exit 0 and become a baseline."""

    report = LayerReport(
        services=(make_scan("svc"),),
        violations=(),
        unreadable_files=("governance-service/app.py",),
        unparsed_files=(),
    )

    failures = report.read_failures()

    assert [issue.code for issue in failures] == ["layer.file.unreadable"]
    assert all(issue.severity == "error" for issue in failures)


def test_cli_report_only_help_documents_the_ignored_flags() -> None:
    completed = run_cli("--help")

    assert completed.returncode == 0, completed.stderr
    assert "--format is ignored" in completed.stdout
    assert "Ignored with" in completed.stdout

