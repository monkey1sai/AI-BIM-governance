"""Fail-closed tests for the observed architecture ratchet (Phase 2)."""

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

from scripts.lib.observed_architecture import (  # noqa: E402
    BASELINE_SCHEMA_VERSION,
    CONFIG_SCHEMA_VERSION,
    EXTRACTION_METHOD,
    ObservedCycle,
    ObservedEdge,
    ObservedReport,
    SERVICE_GRAPH_SCOPE,
    _contract_allowed_pairs,
    _delta_declared_pairs,
    _load_baseline,
    _load_config,
    build_observed_report,
    check_observed_architecture,
    compare_observed_to_baseline,
    render_report_json,
    strip_typescript_comments,
    strongly_connected_cycles,
)


def load_config() -> dict:
    return json.loads(
        (ROOT / "architecture" / "observed-graph.config.json").read_text(encoding="utf-8")
    )


def load_baseline() -> dict:
    return json.loads(
        (ROOT / "architecture" / "observed-baseline.json").read_text(encoding="utf-8")
    )


def issue_codes(issues) -> set[str]:
    return {issue.code for issue in issues}


def canonical_allowed_pairs() -> set[tuple[str, str]]:
    """The contract's real may_call projection, so baseline honesty checks hold."""

    config, _ = _load_config(ROOT)
    contract = json.loads(
        (ROOT / "architecture" / "architecture-contract.json").read_text(encoding="utf-8")
    )
    return _contract_allowed_pairs(contract, config)


def make_report(
    edges: list[tuple[str, str]],
    cycles: list[tuple[str, tuple[str, ...]]] | None = None,
    module_services: list[str] | None = None,
) -> ObservedReport:
    return ObservedReport(
        nodes=tuple(sorted({name for pair in edges for name in pair})),
        edges=tuple(ObservedEdge(source=a, target=b, evidence=()) for a, b in sorted(edges)),
        cycles=tuple(
            ObservedCycle(scope=scope, members=members) for scope, members in sorted(cycles or [])
        ),
        module_graphs=tuple(
            {"service": name, "module_count": 0, "edge_count": 0, "cycles": []}
            for name in sorted(module_services or [])
        ),
        scanned_file_count=0,
    )


# --------------------------------------------------------------------------- #
# Canonical repository
# --------------------------------------------------------------------------- #


def test_canonical_repository_observed_ratchet_passes() -> None:
    result = check_observed_architecture(ROOT)

    assert result.status == "passed", result.to_dict()
    assert result.error_count == 0
    assert result.warning_count == 0, [issue.to_dict() for issue in result.issues]
    assert result.report is not None
    assert result.report.scanned_file_count > 0


def test_canonical_config_and_baseline_match_their_schemas() -> None:
    config, config_issues = _load_config(ROOT)
    baseline, baseline_issues = _load_baseline(ROOT)

    assert config is not None and not config_issues, [i.to_dict() for i in config_issues]
    assert baseline is not None and not baseline_issues, [i.to_dict() for i in baseline_issues]
    assert config["schema_version"] == CONFIG_SCHEMA_VERSION
    assert config["extraction_method"] == EXTRACTION_METHOD
    assert baseline["schema_version"] == BASELINE_SCHEMA_VERSION


def test_canonical_baseline_has_no_service_level_cycle_budget() -> None:
    budgets = {entry["scope"]: entry["maximum"] for entry in load_baseline()["cycle_budgets"]}

    assert budgets[SERVICE_GRAPH_SCOPE] == 0


def test_canonical_baseline_debt_entries_are_attributed() -> None:
    for edge in load_baseline()["service_edges"]:
        if edge["status"] == "declared":
            continue
        assert edge["debt"]["owner"]
        assert edge["debt"]["reason"]
        assert edge["debt"]["target_phase"]
    for cycle in load_baseline()["cycles"]:
        assert cycle["debt"]["owner"]


def test_canonical_report_is_deterministic() -> None:
    config, _ = _load_config(ROOT)
    assert config is not None

    first = render_report_json(build_observed_report(ROOT, config))
    second = render_report_json(build_observed_report(ROOT, config))

    assert first == second
    assert "\r" not in first
    assert str(ROOT) not in first
    assert first.endswith("\n")


def test_canonical_report_records_only_repository_relative_posix_paths() -> None:
    config, _ = _load_config(ROOT)
    assert config is not None

    report = build_observed_report(ROOT, config)

    for edge in report.edges:
        for evidence in edge.evidence:
            assert not evidence.file.startswith("/")
            assert "\\" not in evidence.file
            assert evidence.line >= 1


def test_browser_clients_declare_no_inbound_edge_ports() -> None:
    config = load_config()
    by_id = {entry["id"]: entry for entry in config["service_roots"]}

    assert by_id["web-viewer-sample"]["inbound_edge_ports"] == []
    assert by_id["kit-manager-web"]["inbound_edge_ports"] == []


# --------------------------------------------------------------------------- #
# Ratchet semantics
# --------------------------------------------------------------------------- #


def test_new_edge_outside_the_contract_is_rejected() -> None:
    baseline = load_baseline()
    report = make_report([("web-viewer-sample", "governance-service")])

    issues = compare_observed_to_baseline(
        report, baseline=baseline, allowed_pairs=set(), declared_pairs=set()
    )

    assert "observed.edge.not_allowed" in issue_codes(issues)


def test_contract_allowed_edge_without_a_delta_is_rejected() -> None:
    baseline = load_baseline()
    report = make_report([("governance-service", "kit-manager-api")])

    issues = compare_observed_to_baseline(
        report,
        baseline=baseline,
        allowed_pairs={("governance-service", "kit-manager-api")},
        declared_pairs=set(),
    )

    assert "observed.edge.undeclared" in issue_codes(issues)
    assert "observed.edge.not_allowed" not in issue_codes(issues)


def test_contract_allowed_and_delta_declared_edge_is_accepted() -> None:
    baseline = load_baseline()
    report = make_report([("governance-service", "kit-manager-api")])

    issues = compare_observed_to_baseline(
        report,
        baseline=baseline,
        allowed_pairs={("governance-service", "kit-manager-api")},
        declared_pairs={("governance-service", "kit-manager-api")},
    )

    assert "observed.edge.undeclared" not in issue_codes(issues)
    assert "observed.edge.not_allowed" not in issue_codes(issues)


def test_baselined_edge_needs_no_delta() -> None:
    baseline = load_baseline()
    report = make_report([("kit-manager-web", "bim-review-coordinator")])

    issues = compare_observed_to_baseline(
        report,
        baseline=baseline,
        allowed_pairs=canonical_allowed_pairs(),
        declared_pairs=set(),
    )

    assert not [issue for issue in issues if issue.severity == "error"]


def test_disappearing_edge_is_a_tightening_warning_not_an_error() -> None:
    baseline = load_baseline()
    report = make_report([])

    issues = compare_observed_to_baseline(
        report,
        baseline=baseline,
        allowed_pairs=canonical_allowed_pairs(),
        declared_pairs=set(),
    )

    assert "observed.edge.baseline_stale" in issue_codes(issues)
    assert all(issue.severity == "warning" for issue in issues)
    assert not [issue for issue in issues if issue.severity == "error"]


def test_new_cycle_is_rejected() -> None:
    baseline = load_baseline()
    report = make_report(
        [("governance-service", "kit-manager-api"), ("kit-manager-api", "governance-service")],
        cycles=[(SERVICE_GRAPH_SCOPE, ("governance-service", "kit-manager-api"))],
    )

    issues = compare_observed_to_baseline(
        report,
        baseline=baseline,
        allowed_pairs={
            ("governance-service", "kit-manager-api"),
            ("kit-manager-api", "governance-service"),
        },
        declared_pairs={
            ("governance-service", "kit-manager-api"),
            ("kit-manager-api", "governance-service"),
        },
    )

    codes = issue_codes(issues)
    assert "observed.cycle.new" in codes
    assert "observed.cycle.count_increase" in codes


def test_cycle_swap_that_keeps_the_count_is_still_rejected() -> None:
    """Identity, not just count — swapping one cycle for another must fail."""

    baseline = load_baseline()
    report = make_report(
        [],
        cycles=[
            ("module-graph:governance-service", ("bcf", "bcf.api")),
            ("module-graph:bim-streaming-server", tuple(load_baseline()["cycles"][0]["members"])),
            ("module-graph:web-viewer-sample", tuple(load_baseline()["cycles"][2]["members"])),
        ],
    )

    issues = compare_observed_to_baseline(
        report, baseline=baseline, allowed_pairs=set(), declared_pairs=set()
    )

    codes = issue_codes(issues)
    assert "observed.cycle.new" in codes
    assert "observed.cycle.count_increase" not in codes


def test_cycle_in_a_scope_without_a_budget_is_rejected() -> None:
    baseline = deepcopy(load_baseline())
    baseline["cycle_budgets"] = []
    report = make_report(
        [],
        cycles=[("module-graph:kit-manager-api", ("app.main", "app.settings"))],
    )

    issues = compare_observed_to_baseline(
        report, baseline=baseline, allowed_pairs=set(), declared_pairs=set()
    )

    assert "observed.cycle.budget_missing" in issue_codes(issues)


def test_baseline_without_debt_attribution_fails_closed(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    baseline_path = tmp_path / "architecture" / "observed-baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    for entry in baseline["service_edges"]:
        entry.pop("debt", None)
    baseline_path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")

    _, issues = _load_baseline(tmp_path)

    assert "baseline.debt_missing" in issue_codes(issues)


def test_baseline_with_wrong_schema_version_fails_closed(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    baseline_path = tmp_path / "architecture" / "observed-baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    baseline["schema_version"] = "ai-bim-observed-baseline/v0"
    baseline_path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")

    _, issues = _load_baseline(tmp_path)

    assert "baseline.schema_version" in issue_codes(issues)
    assert "schema.instance.const" in issue_codes(issues)


def test_config_with_unknown_property_fails_closed(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    config_path = tmp_path / "architecture" / "observed-graph.config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    config["surprise"] = True
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    _, issues = _load_config(tmp_path)

    assert "schema.instance.additional_property" in issue_codes(issues)


def test_missing_baseline_fails_closed(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    (tmp_path / "architecture" / "observed-baseline.json").unlink()

    result = check_observed_architecture(tmp_path)

    assert result.status == "failed"


@pytest.mark.parametrize("payload", ["null", "[]", "123", '"text"'])
@pytest.mark.parametrize(
    "target",
    ["observed-baseline.json", "observed-graph.config.json", "architecture-contract.json"],
)
def test_valid_json_that_is_not_an_object_fails_closed(
    tmp_path: Path, target: str, payload: str
) -> None:
    """`echo null > baseline` must not read as a clean run."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    (tmp_path / "architecture" / target).write_text(payload, encoding="utf-8")

    result = check_observed_architecture(tmp_path)

    assert result.status == "failed"
    assert result.error_count > 0


def test_a_run_that_never_compared_cannot_report_passed(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    (tmp_path / "architecture" / "observed-graph.config.json").write_text("null", encoding="utf-8")

    result = check_observed_architecture(tmp_path)

    assert result.compared is False
    assert result.status == "failed"


def test_mistyped_scan_root_fails_closed(tmp_path: Path) -> None:
    """A renamed directory must not silently disable observation for a service."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    config_path = tmp_path / "architecture" / "observed-graph.config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    config["service_roots"][0]["roots"] = ["does/not/exist"]
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    _, issues = _load_config(tmp_path)

    assert "observed_config.root_missing" in issue_codes(issues)


def test_baseline_cannot_launder_a_forbidden_edge_as_declared() -> None:
    """A baseline entry short-circuits the contract check, so it must not lie."""

    baseline = deepcopy(load_baseline())
    baseline["service_edges"].append(
        {
            "from": "governance-service",
            "to": "kit-manager-api",
            "status": "declared",
            "note": "totally fine, trust me",
        }
    )
    report = make_report([("governance-service", "kit-manager-api")])

    issues = compare_observed_to_baseline(
        report, baseline=baseline, allowed_pairs=set(), declared_pairs=set()
    )

    assert "baseline.declared_not_allowed" in issue_codes(issues)


def test_canonical_baseline_declared_entries_match_the_contract() -> None:
    config, _ = _load_config(ROOT)
    contract = json.loads(
        (ROOT / "architecture" / "architecture-contract.json").read_text(encoding="utf-8")
    )
    allowed = _contract_allowed_pairs(contract, config)

    for entry in load_baseline()["service_edges"]:
        if entry["status"] == "declared":
            assert (entry["from"], entry["to"]) in allowed, entry


def test_a_removed_edge_can_be_declared_again_by_a_later_delta(tmp_path: Path) -> None:
    """Chronological application: an old removal must not veto a new declaration."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    deltas = tmp_path / "architecture" / "deltas"
    pair = {"from": "governance-service", "to": "kit-manager-api", "interface": "x", "reason": "y"}

    def write(name: str, created_on: str, key: str) -> None:
        (deltas / name).write_text(
            json.dumps(
                {
                    "change_id": name[:-5],
                    "created_on": created_on,
                    "added_dependency_edges": [pair] if key == "added" else [],
                    "removed_dependency_edges": [pair] if key == "removed" else [],
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    write("aaa-first-add.json", "2026-01-01", "added")
    write("bbb-then-remove.json", "2026-02-01", "removed")
    write("ccc-then-readd.json", "2026-03-01", "added")

    declared, _ = _delta_declared_pairs(tmp_path, load_config())

    assert ("governance-service", "kit-manager-api") in declared


def test_python_relative_imports_at_the_scan_root_are_resolved(tmp_path: Path) -> None:
    """`services/kit-manager-api/app` has no __init__.py; its edges must still appear."""

    config = deepcopy(load_config())
    config["service_roots"] = [
        {
            "id": "kit-manager-api",
            "contract_service": "kit-manager-api",
            "language": "python",
            "roots": ["app"],
            "inbound_edge_ports": [8010],
        }
    ]
    config["compose_files"] = []
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "main.py").write_text(
        "from .settings import Settings\nfrom . import models\n", encoding="utf-8"
    )
    (tmp_path / "app" / "settings.py").write_text("VALUE = 1\n", encoding="utf-8")
    (tmp_path / "app" / "models.py").write_text("VALUE = 2\n", encoding="utf-8")

    report = build_observed_report(tmp_path, config)
    graph = report.module_graphs[0]

    assert graph["edge_count"] == 2, graph


def test_canonical_kit_manager_api_module_graph_is_not_empty() -> None:
    """Regression: an unresolved relative import silently emptied this graph."""

    config, _ = _load_config(ROOT)
    report = build_observed_report(ROOT, config)
    graph = next(g for g in report.module_graphs if g["service"] == "kit-manager-api")

    assert graph["edge_count"] > 0, graph


def test_absolute_root_package_imports_resolve_to_edges(tmp_path: Path) -> None:
    """Regression: `from app.x import y` produced no edge and no diagnostic.

    The production import form is rooted at the scan-root package name; the
    index holds module ids relative to that root. An unrelated prefix that
    merely resembles the root name must not be stripped.
    """

    config = deepcopy(load_config())
    config["service_roots"] = [
        {
            "id": "kit-manager-api",
            "contract_service": "kit-manager-api",
            "language": "python",
            "roots": ["app"],
            "inbound_edge_ports": [8010],
        }
    ]
    config["compose_files"] = []
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "main.py").write_text(
        "from app.settings import Settings\n"
        "import app.models\n"
        "from application.settings import Other\n",
        encoding="utf-8",
    )
    (tmp_path / "app" / "settings.py").write_text("VALUE = 1\n", encoding="utf-8")
    (tmp_path / "app" / "models.py").write_text("VALUE = 2\n", encoding="utf-8")

    report = build_observed_report(tmp_path, config)
    graph = report.module_graphs[0]

    # settings + models via the root-package form; the `application.*` import
    # resolves to nothing and stays external.
    assert graph["edge_count"] == 2, graph


def test_root_qualified_form_wins_over_a_same_named_nested_module(tmp_path: Path) -> None:
    """`from app.settings import y` means the relative id `settings` at runtime;
    a nested app/app/settings.py (relative id `app.settings`) must not capture it."""

    from scripts.lib.observed_architecture import _resolve_python_target

    index = {"main", "settings", "app.settings"}
    assert _resolve_python_target("app.settings", index, root_package="app") == "settings"
    # Without the root-package context the unstripped relative id still resolves.
    assert _resolve_python_target("app.settings", index) == "app.settings"
    # Stripping only applies to the exact root name, and a stripped miss stays
    # unresolved (external) rather than falling back to the wrong module.
    assert _resolve_python_target("app.missing", index, root_package="app") is None
    assert _resolve_python_target("application.settings", index, root_package="app") is None


def test_case_mismatched_relative_import_still_yields_the_edge(tmp_path: Path) -> None:
    """Regression: a casing mismatch resolved at runtime on the canonical
    case-insensitive runner but was silently dropped by the exact-match scan."""

    config = deepcopy(load_config())
    config["service_roots"] = [
        {
            "id": "web-viewer-sample",
            "contract_service": "web-viewer-sample",
            "language": "typescript",
            "roots": ["src"],
            "browser_client": True,
            "inbound_edge_ports": [],
        }
    ]
    config["compose_files"] = []
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "App.ts").write_text(
        'import { conf } from "./StreamConfig.js";\n', encoding="utf-8"
    )
    (tmp_path / "src" / "streamConfig.ts").write_text(
        "export const conf = 1;\n", encoding="utf-8"
    )

    report = build_observed_report(tmp_path, config)
    graph = report.module_graphs[0]

    assert graph["edge_count"] == 1, graph


@pytest.mark.parametrize(
    "schema_file",
    ["observed-baseline.schema.json", "observed-graph.config.schema.json"],
)
@pytest.mark.parametrize("payload", ["null", "[]", "123"])
def test_corrupt_schema_file_fails_closed(
    tmp_path: Path, schema_file: str, payload: str
) -> None:
    """A broken schema would silently disable every required/enum check."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    (tmp_path / "architecture" / schema_file).write_text(payload, encoding="utf-8")

    result = check_observed_architecture(tmp_path)

    assert result.status == "failed"
    assert result.error_count > 0


def test_service_without_inbound_ports_must_be_marked_a_browser_client(
    tmp_path: Path,
) -> None:
    """Emptying inbound ports makes calls to a service invisible, not flagged."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    config_path = tmp_path / "architecture" / "observed-graph.config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    for entry in config["service_roots"]:
        if entry["id"] == "kit-manager-api":
            entry["inbound_edge_ports"] = []
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    _, issues = _load_config(tmp_path)

    assert "observed_config.no_inbound_ports" in issue_codes(issues)


def test_declared_browser_clients_are_allowed_to_have_no_inbound_ports() -> None:
    config = load_config()
    by_id = {entry["id"]: entry for entry in config["service_roots"]}

    for name in ("web-viewer-sample", "kit-manager-web"):
        assert by_id[name]["inbound_edge_ports"] == []
        assert by_id[name]["browser_client"] is True


def test_baseline_status_is_validated_without_relying_on_the_schema_file(
    tmp_path: Path,
) -> None:
    """Defence in depth: the check must hold even if the schema file is replaced."""

    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    schema_path = tmp_path / "architecture" / "observed-baseline.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    del schema["properties"]["service_edges"]["items"]["properties"]["status"]["enum"]
    schema_path.write_text(json.dumps(schema, indent=2), encoding="utf-8")
    baseline_path = tmp_path / "architecture" / "observed-baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    baseline["service_edges"][0]["status"] = "obviously-fine"
    baseline_path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")

    _, issues = _load_baseline(tmp_path)

    assert "baseline.status_invalid" in issue_codes(issues)


def test_duplicate_baseline_edges_are_rejected(tmp_path: Path) -> None:
    shutil.copytree(ROOT / "architecture", tmp_path / "architecture")
    baseline_path = tmp_path / "architecture" / "observed-baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    baseline["service_edges"].append(deepcopy(baseline["service_edges"][0]))
    baseline_path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")

    _, issues = _load_baseline(tmp_path)

    assert "baseline.duplicate_edge" in issue_codes(issues)


def test_python_source_with_a_null_byte_is_reported_not_crashed(tmp_path: Path) -> None:
    """read_text accepts NUL bytes but ast.parse raises ValueError, not SyntaxError."""

    config = deepcopy(load_config())
    config["service_roots"] = [
        {
            "id": "kit-manager-api",
            "contract_service": "kit-manager-api",
            "language": "python",
            "roots": ["app"],
            "inbound_edge_ports": [8010],
        }
    ]
    config["compose_files"] = []
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "bad.py").write_bytes(b"X = 1\x00\n")

    report = build_observed_report(tmp_path, config)

    assert report.unparsed_files == ("app/bad.py",)


def test_url_scheme_slashes_are_never_read_as_a_line_comment() -> None:
    """An unstripped comment containing `http://` must not erase the rest of the line."""

    source = (
        "const legacy = old /* was http://127.0.0.1:8004 */ ; "
        'const real = "http://127.0.0.1:49102/api";'
    )

    lines, clean = strip_typescript_comments(source)

    assert clean
    assert "49102" in lines[0]


def test_unreadable_source_is_reported_rather_than_skipped(tmp_path: Path) -> None:
    config = deepcopy(load_config())
    config["service_roots"] = [
        {
            "id": "kit-manager-api",
            "contract_service": "kit-manager-api",
            "language": "python",
            "roots": ["app"],
            "inbound_edge_ports": [8010],
        }
    ]
    config["compose_files"] = []
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "broken.py").write_bytes(b"\xff\xfe\x00binary")

    report = build_observed_report(tmp_path, config)

    assert report.unreadable_files == ("app/broken.py",)
    assert "observed.file.unreadable" in {issue.code for issue in report.read_failures}


# --------------------------------------------------------------------------- #
# Extraction primitives
# --------------------------------------------------------------------------- #


def test_typescript_comments_cannot_manufacture_an_edge() -> None:
    source = "\n".join(
        [
            '// talks to http://127.0.0.1:49102 one day',
            '/* http://127.0.0.1:8010 */',
            'const base = "http://127.0.0.1:49102";',
            'const url = "http://127.0.0.1:8010"; // http://127.0.0.1:8004',
        ]
    )

    lines, clean = strip_typescript_comments(source)

    assert clean
    assert "49102" not in lines[0]
    assert "8010" not in lines[1]
    assert "49102" in lines[2]
    assert "8010" in lines[3]
    assert "8004" not in lines[3]


def test_typescript_comment_stripper_preserves_line_count() -> None:
    source = "a\n/* multi\nline */ b\nc\n"

    lines, clean = strip_typescript_comments(source)

    assert clean
    assert len(lines) == len(source.splitlines())


def test_typescript_comment_stripper_keeps_urls_inside_template_literals() -> None:
    source = "const u = `http://127.0.0.1:8004/api`;"

    lines, clean = strip_typescript_comments(source)

    assert clean
    assert "8004" in lines[0]


def test_regex_literal_containing_a_quote_does_not_swallow_the_rest_of_the_line() -> None:
    source = 'const r = raw.replace(/["\']/g, "") + "http://127.0.0.1:8004/api";'

    lines, clean = strip_typescript_comments(source)

    assert clean
    assert "8004" in lines[0]


def test_jsx_closing_tag_is_not_treated_as_a_regex() -> None:
    source = '<h1>title</h1>\nconst api = "http://127.0.0.1:8004/api";'

    lines, clean = strip_typescript_comments(source)

    assert clean
    assert "8004" in lines[1]


def test_jsx_text_containing_a_slash_star_does_not_comment_out_the_file() -> None:
    """`<code>/api/kit/*</code>` is JSX text, not the start of a block comment."""

    source = '<code>:8004 /api/kit/*</code>\nconst api = "http://127.0.0.1:8010/x";'

    lines, clean = strip_typescript_comments(source)

    assert clean
    assert "8010" in lines[1]


def test_jsx_slash_star_does_not_run_to_a_later_genuine_block_comment() -> None:
    """The dangerous case: text `/*` swallowing everything up to a real `*/`."""

    source = "\n".join(
        [
            "<code>/api/kit/*</code>",
            'const api = "http://127.0.0.1:8004/x";',
            "/* a genuine block comment */",
            'const b = "http://127.0.0.1:8010/y";',
        ]
    )

    lines, clean = strip_typescript_comments(source)

    assert clean
    assert "8004" in lines[1], "a real URL between JSX text and a later comment was erased"
    assert "8010" in lines[3]


@pytest.mark.parametrize(
    "source",
    [
        '/* http://127.0.0.1:8004 */\nconst a = 1;',
        '/**\n * see http://127.0.0.1:8004\n */\nconst a = 1;',
        'foo(/* http://127.0.0.1:8004 */ 1);',
        'const x = 1; /* http://127.0.0.1:8004 */',
        'if (x) /* http://127.0.0.1:8004 */ y();',
    ],
)
def test_block_comments_in_normal_code_positions_are_still_stripped(source: str) -> None:
    lines, clean = strip_typescript_comments(source)

    assert clean
    assert "8004" not in "\n".join(lines)


@pytest.mark.parametrize(
    "source",
    [
        'const parts = url.split(/\\/\\//); const a = "http://127.0.0.1:8004";',
        'if (/^http/.test(u)) { const a = "http://127.0.0.1:8004"; }',
        'const r = raw.replace(/["\']/g, "") + "http://127.0.0.1:8004/api";',
    ],
)
def test_regex_literals_never_hide_a_url_on_the_same_line(source: str) -> None:
    lines, clean = strip_typescript_comments(source)

    assert clean
    assert "8004" in "\n".join(lines)


def test_unclosed_block_comment_marker_does_not_swallow_the_rest_of_the_file() -> None:
    """No `*/` anywhere later means the `/*` was never a comment opener."""

    source = 'const a = 1;\n/* looks open but never closes\nconst api = "http://127.0.0.1:8004";'

    lines, clean = strip_typescript_comments(source)

    assert clean
    assert "8004" in lines[2]


def test_scanner_reports_itself_unclean_when_it_ends_inside_a_template() -> None:
    """The clean flag is the backstop for inputs the heuristics still misread."""

    source = 'const a = `unterminated \\` still open\nconst api = "http://127.0.0.1:8004";'

    _, clean = strip_typescript_comments(source)

    assert not clean


def test_cycle_detection_is_deterministic_and_ignores_self_loops() -> None:
    edges = [("a", "b"), ("b", "a"), ("c", "c"), ("d", "e")]

    first = strongly_connected_cycles(edges)
    second = strongly_connected_cycles(reversed(edges))

    assert first == second == [("a", "b")]


def test_cycle_detection_handles_deep_chains_without_recursion_error() -> None:
    depth = 4000
    edges = [(f"n{index}", f"n{index + 1}") for index in range(depth)]
    edges.append((f"n{depth}", "n0"))

    cycles = strongly_connected_cycles(edges)

    assert len(cycles) == 1
    assert len(cycles[0]) == depth + 1


def test_extractor_ignores_cors_allowlists(tmp_path: Path) -> None:
    """A CORS origin names an inbound caller; treating it as outbound inverts the edge."""

    config = deepcopy(load_config())
    config["service_roots"] = [
        {
            "id": "kit-manager-api",
            "contract_service": "kit-manager-api",
            "language": "python",
            "roots": ["svc"],
            "inbound_edge_ports": [8010],
        },
        {
            "id": "bim-review-coordinator",
            "contract_service": "bim-review-coordinator",
            "language": "python",
            "roots": ["coord"],
            "inbound_edge_ports": [8004],
        },
    ]
    config["compose_files"] = []
    (tmp_path / "svc").mkdir()
    (tmp_path / "coord").mkdir()
    (tmp_path / "svc" / "settings.py").write_text(
        'KIT_MANAGER_CORS_ORIGINS = "http://127.0.0.1:8004"\n', encoding="utf-8"
    )

    report = build_observed_report(tmp_path, config)

    assert report.edges == ()


def test_extractor_still_records_a_real_outbound_call(tmp_path: Path) -> None:
    config = deepcopy(load_config())
    config["service_roots"] = [
        {
            "id": "kit-manager-api",
            "contract_service": "kit-manager-api",
            "language": "python",
            "roots": ["svc"],
            "inbound_edge_ports": [8010],
        },
        {
            "id": "bim-review-coordinator",
            "contract_service": "bim-review-coordinator",
            "language": "python",
            "roots": ["coord"],
            "inbound_edge_ports": [8004],
        },
    ]
    config["compose_files"] = []
    (tmp_path / "svc").mkdir()
    (tmp_path / "coord").mkdir()
    (tmp_path / "svc" / "client.py").write_text(
        'CALLBACK = "http://127.0.0.1:8004/api/callback"\n', encoding="utf-8"
    )

    report = build_observed_report(tmp_path, config)

    assert [edge.pair for edge in report.edges] == [("kit-manager-api", "bim-review-coordinator")]
    assert report.edges[0].evidence[0].file == "svc/client.py"
    assert report.edges[0].evidence[0].line == 1


def test_python_comments_cannot_manufacture_an_edge(tmp_path: Path) -> None:
    config = deepcopy(load_config())
    config["service_roots"] = [
        {
            "id": "kit-manager-api",
            "contract_service": "kit-manager-api",
            "language": "python",
            "roots": ["svc"],
            "inbound_edge_ports": [8010],
        },
        {
            "id": "bim-review-coordinator",
            "contract_service": "bim-review-coordinator",
            "language": "python",
            "roots": ["coord"],
            "inbound_edge_ports": [8004],
        },
    ]
    config["compose_files"] = []
    (tmp_path / "svc").mkdir()
    (tmp_path / "coord").mkdir()
    (tmp_path / "svc" / "notes.py").write_text(
        '# someday we may call http://127.0.0.1:8004\nVALUE = 1\n', encoding="utf-8"
    )

    report = build_observed_report(tmp_path, config)

    assert report.edges == ()


def test_self_edges_are_never_recorded(tmp_path: Path) -> None:
    config = deepcopy(load_config())
    config["service_roots"] = [
        {
            "id": "kit-manager-api",
            "contract_service": "kit-manager-api",
            "language": "python",
            "roots": ["svc"],
            "inbound_edge_ports": [8010],
        }
    ]
    config["compose_files"] = []
    (tmp_path / "svc").mkdir()
    (tmp_path / "svc" / "health.py").write_text(
        'PROBE = "http://127.0.0.1:8010/health"\n', encoding="utf-8"
    )

    report = build_observed_report(tmp_path, config)

    assert report.edges == ()


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def test_cli_reports_passing_json_status() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "dev" / "export_observed_architecture.py"),
            "--repo-root",
            str(ROOT),
            "--format",
            "json",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["status"] == "passed"
    assert payload["report"]["extraction_method"] == EXTRACTION_METHOD


def test_cli_report_only_output_is_byte_identical_across_runs(tmp_path: Path) -> None:
    outputs = []
    for name in ("first.json", "second.json"):
        target = tmp_path / name
        completed = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "dev" / "export_observed_architecture.py"),
                "--repo-root",
                str(ROOT),
                "--report-only",
                "--output",
                str(target),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        assert completed.returncode == 0, completed.stderr
        outputs.append(target.read_bytes())

    assert outputs[0] == outputs[1]
    assert b"\r\n" not in outputs[0]


@pytest.mark.parametrize("flag", ["--strict", "--report-only"])
def test_cli_accepts_documented_flags(flag: str) -> None:
    completed = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "dev" / "export_observed_architecture.py"),
            "--repo-root",
            str(ROOT),
            flag,
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
