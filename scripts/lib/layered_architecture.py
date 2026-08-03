"""Executable language-level layer boundaries (Phase 3 of the architecture contract).

Phase 2 answered "which service depends on which service, and does anything
cycle". This module answers the narrower question the layer contract asks:
*inside* a service, does a module in one layer reach into a layer it is not
allowed to see.

The module graph itself is not re-derived here. It is produced by the Phase 2
extractors in :mod:`scripts.lib.observed_architecture`, which have already been
hardened against JSX regex confusion, block-comment confusion, ``://`` being
read as a line comment, and NUL bytes in Python sources. Reusing them keeps a
single extraction truth; this module only classifies the resulting modules into
layers and judges edge direction.

The named tools in the originating task (``dependency-cruiser`` and
``import-linter``) are deliberately not adopted. The reason is recorded as
machine-readable data in ``architecture/layer-contract.json`` under
``tooling_deviation`` so the deviation cannot be quietly dropped, and it is
mirrored in ``architecture/README.md``.

Fail-closed posture, mirroring Phase 2: a run that could not compare must never
report ``passed``. Missing or corrupt config, a service root the contract never
decided about, a module no rule matches, a rule that matches nothing, a
duplicated baseline entry, a budget that disagrees with the baseline -- all of
these are findings, not silent successes.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from scripts.lib.architecture_contract import (
    ValidationIssue,
    _is_mapping,
    _is_sequence,
    _issue,
    _load_json,
    validate_schema_instance,
)
from scripts.lib.observed_architecture import (
    ScanDiagnostics,
    _iter_source_files,
    _load_config as _load_observed_config,
    _python_module_edges,
    _python_module_name,
    _typescript_module_edges,
)

CONTRACT_SCHEMA_VERSION = "ai-bim-layer-contract/v1"
BASELINE_SCHEMA_VERSION = "ai-bim-layer-baseline/v1"
REPORT_SCHEMA_VERSION = "ai-bim-layer-report/v1"
RATCHET_RESULT_SCHEMA_VERSION = "ai-bim-layer-ratchet-result/v1"

CONTRACT_RELATIVE_PATH = "architecture/layer-contract.json"
CONTRACT_SCHEMA_RELATIVE_PATH = "architecture/layer-contract.schema.json"
BASELINE_RELATIVE_PATH = "architecture/layer-baseline.json"
BASELINE_SCHEMA_RELATIVE_PATH = "architecture/layer-baseline.schema.json"

MATCH_KINDS = ("exact", "prefix", "suffix")


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class LayerViolation:
    """One intra-service module edge that crosses a forbidden layer boundary."""

    service: str
    from_module: str
    from_layer: str
    to_module: str
    to_layer: str

    @property
    def identity(self) -> tuple[str, str, str]:
        """Identity excludes layer names and file positions on purpose.

        Line drift must not break the ratchet, and relabelling a layer must not
        launder an existing violation into a "new" one or vice versa.
        """

        return (self.service, self.from_module, self.to_module)

    def to_dict(self) -> dict[str, Any]:
        return {
            "service": self.service,
            "from": self.from_module,
            "from_layer": self.from_layer,
            "to": self.to_module,
            "to_layer": self.to_layer,
        }


@dataclass(frozen=True, slots=True)
class ServiceLayerScan:
    """Per-service scan outcome: module inventory, layer assignment, edges."""

    service: str
    language: str
    modules: tuple[str, ...]
    assignments: tuple[tuple[str, str], ...]
    edges: tuple[tuple[str, str], ...]
    unassigned_modules: tuple[str, ...]
    unused_rules: tuple[str, ...]
    scanned_file_count: int
    declared_layers: tuple[str, ...] = ()
    """Layers the contract says this service is built from.

    Pinning the set is what stops a catch-all rule from collapsing a whole
    service into one layer: adding a file to an existing layer never changes the
    set, but flattening the service does.
    """

    def observed_layers(self) -> tuple[str, ...]:
        return tuple(sorted({layer for _, layer in self.assignments}))

    def layer_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for _, layer in self.assignments:
            counts[layer] = counts.get(layer, 0) + 1
        return counts

    def to_dict(self) -> dict[str, Any]:
        return {
            "service": self.service,
            "language": self.language,
            "module_count": len(self.modules),
            "scanned_file_count": self.scanned_file_count,
            "edge_count": len(self.edges),
            "layer_counts": self.layer_counts(),
            "declared_layers": list(self.declared_layers),
            "observed_layers": list(self.observed_layers()),
            "assignments": [
                {"module": module, "layer": layer} for module, layer in self.assignments
            ],
            "unassigned_modules": list(self.unassigned_modules),
            "unused_rules": list(self.unused_rules),
        }


@dataclass(frozen=True, slots=True)
class LayerReport:
    """Deterministic, repo-relative description of observed layering."""

    services: tuple[ServiceLayerScan, ...]
    violations: tuple[LayerViolation, ...]
    unreadable_files: tuple[str, ...]
    unparsed_files: tuple[str, ...]

    @property
    def scanned_file_count(self) -> int:
        return sum(scan.scanned_file_count for scan in self.services)

    def read_failures(self) -> list[ValidationIssue]:
        issues = [
            _issue(
                "layer.file.unreadable",
                relative,
                "Source file could not be read, so its layer edges were not observed.",
            )
            for relative in self.unreadable_files
        ]
        issues.extend(
            _issue(
                "layer.file.unparsed",
                relative,
                "Source file could not be parsed, so its layer edges were not observed.",
            )
            for relative in self.unparsed_files
        )
        return issues

    def violation_counts(self) -> dict[str, int]:
        counts = {scan.service: 0 for scan in self.services}
        for violation in self.violations:
            counts[violation.service] = counts.get(violation.service, 0) + 1
        return counts

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": REPORT_SCHEMA_VERSION,
            "extraction_method": "stdlib-static-source-scan",
            "scanned_file_count": self.scanned_file_count,
            "unreadable_files": list(self.unreadable_files),
            "unparsed_files": list(self.unparsed_files),
            "services": [scan.to_dict() for scan in self.services],
            "violations": [violation.to_dict() for violation in self.violations],
        }


@dataclass(frozen=True, slots=True)
class LayerRatchetResult:
    """Result returned by :func:`check_layered_architecture`."""

    repo_root: str
    report: LayerReport | None
    issues: tuple[ValidationIssue, ...]
    compared: bool = False
    """True only when the observed layering was actually compared to the baseline.

    Every early return leaves this False, so a run that never reached the
    comparison cannot report ``passed`` merely because it collected no issues.
    """

    @property
    def error_count(self) -> int:
        return sum(issue.severity == "error" for issue in self.issues)

    @property
    def warning_count(self) -> int:
        return sum(issue.severity == "warning" for issue in self.issues)

    @property
    def status(self) -> str:
        return "passed" if self.error_count == 0 and self.compared else "failed"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": RATCHET_RESULT_SCHEMA_VERSION,
            "status": self.status,
            "repo_root": self.repo_root,
            "compared": self.compared,
            "summary": {
                "errors": self.error_count,
                "warnings": self.warning_count,
                "issues": len(self.issues),
            },
            "report": self.report.to_dict() if self.report is not None else None,
            "issues": [issue.to_dict() for issue in self.issues],
        }


# --------------------------------------------------------------------------- #
# Contract and baseline loading
# --------------------------------------------------------------------------- #


def _load_document(
    repo_root: Path,
    document_relative: str,
    schema_relative: str,
    expected_version: str,
    code_prefix: str,
) -> tuple[Mapping[str, Any] | None, list[ValidationIssue]]:
    """Load a JSON document and validate it against its committed schema.

    The schema file is itself validated for being an object. Replacing a schema
    with ``null`` would otherwise disable every ``required`` / ``enum`` /
    ``additionalProperties`` check while the run still reported success.
    """

    issues: list[ValidationIssue] = []
    document, document_issues = _load_json(repo_root / document_relative)
    issues.extend(document_issues)
    schema, schema_issues = _load_json(repo_root / schema_relative)
    issues.extend(schema_issues)

    if not _is_mapping(schema):
        issues.append(
            _issue(
                f"{code_prefix}.schema_not_object",
                schema_relative,
                "Schema document must be a JSON object.",
            )
        )
    elif not schema.get("properties") or not schema.get("required"):
        # `{}` is a valid JSON object and a valid JSON Schema that accepts everything.
        # Accepting it would switch off every required / enum / additionalProperties
        # check while the run still reported success, which is the same failure the
        # non-object guard exists to prevent.
        issues.append(
            _issue(
                f"{code_prefix}.schema_vacuous",
                schema_relative,
                "Schema document declares no 'properties' or no 'required'. A vacuous schema "
                "accepts everything, which silently disables validation.",
            )
        )
    if not _is_mapping(document):
        issues.append(
            _issue(
                f"{code_prefix}.not_object",
                document_relative,
                "Document must be a JSON object.",
            )
        )
        return None, issues

    if _is_mapping(schema):
        issues.extend(
            ValidationIssue(
                code=issue.code,
                path=f"{document_relative}:{issue.path}",
                message=issue.message,
                severity=issue.severity,
            )
            for issue in validate_schema_instance(document, schema)
        )
    if document.get("schema_version") != expected_version:
        issues.append(
            _issue(
                f"{code_prefix}.schema_version",
                document_relative,
                f"schema_version must be {expected_version!r}.",
            )
        )
    return document, issues


def _load_layer_contract(
    repo_root: Path,
) -> tuple[Mapping[str, Any] | None, list[ValidationIssue]]:
    contract, issues = _load_document(
        repo_root,
        CONTRACT_RELATIVE_PATH,
        CONTRACT_SCHEMA_RELATIVE_PATH,
        CONTRACT_SCHEMA_VERSION,
        "layer_contract",
    )
    if contract is None:
        return None, issues
    issues.extend(_validate_layer_sets(contract))
    issues.extend(_validate_contract_rules(contract))
    return contract, issues


def _load_layer_baseline(
    repo_root: Path,
) -> tuple[Mapping[str, Any] | None, list[ValidationIssue]]:
    baseline, issues = _load_document(
        repo_root,
        BASELINE_RELATIVE_PATH,
        BASELINE_SCHEMA_RELATIVE_PATH,
        BASELINE_SCHEMA_VERSION,
        "layer_baseline",
    )
    if baseline is None:
        return None, issues

    # Re-enforced in Python so a single corrupted schema file cannot switch the
    # debt attribution and duplicate checks off while the run still passes.
    seen: set[tuple[str, str, str]] = set()
    entries = baseline.get("violations")
    if _is_sequence(entries):
        for index, entry in enumerate(entries):
            path = f"{BASELINE_RELATIVE_PATH}:violations[{index}]"
            if not _is_mapping(entry):
                issues.append(
                    _issue("layer_baseline.entry_not_object", path, "Entry must be a JSON object.")
                )
                continue
            # Check the raw values first. Coercing with str() would turn a missing
            # field into the non-empty string "None", so the guard would never fire
            # on the very inputs it exists to reject.
            raw = (entry.get("service"), entry.get("from"), entry.get("to"))
            if not all(isinstance(part, str) and part for part in raw):
                issues.append(
                    _issue(
                        "layer_baseline.entry_incomplete",
                        path,
                        "Entry requires non-empty string 'service', 'from' and 'to'.",
                    )
                )
            identity = tuple(str(part) for part in raw)
            if identity in seen:
                issues.append(
                    _issue(
                        "layer_baseline.duplicate",
                        path,
                        f"Duplicate baseline entry for {identity!r}. A duplicate hides how "
                        "many violations a budget actually covers.",
                    )
                )
            seen.add(identity)
            debt = entry.get("debt")
            if not _is_mapping(debt) or not all(
                isinstance(debt.get(key), str) and debt.get(key)
                for key in ("owner", "reason", "target_phase")
            ):
                issues.append(
                    _issue(
                        "layer_baseline.debt_missing",
                        path,
                        "Every grandfathered violation requires debt.owner, debt.reason "
                        "and debt.target_phase so it stays attributable.",
                    )
                )

    budgets = baseline.get("violation_budgets")
    if _is_sequence(budgets):
        seen_services: set[str] = set()
        for index, budget in enumerate(budgets):
            path = f"{BASELINE_RELATIVE_PATH}:violation_budgets[{index}]"
            if not _is_mapping(budget):
                issues.append(
                    _issue("layer_baseline.budget_not_object", path, "Budget must be a JSON object.")
                )
                continue
            service = budget.get("service")
            if not isinstance(service, str) or not service:
                issues.append(
                    _issue("layer_baseline.budget_service", path, "Budget requires a service id.")
                )
                continue
            if service in seen_services:
                issues.append(
                    _issue(
                        "layer_baseline.budget_duplicate",
                        path,
                        f"Duplicate budget for service {service!r}.",
                    )
                )
            seen_services.add(service)
            maximum = budget.get("maximum")
            if not isinstance(maximum, int) or isinstance(maximum, bool) or maximum < 0:
                issues.append(
                    _issue(
                        "layer_baseline.budget_maximum",
                        path,
                        "Budget maximum must be a non-negative integer.",
                    )
                )
    return baseline, issues


def _layer_sets(contract: Mapping[str, Any]) -> dict[str, tuple[list[str], dict[str, set[str]]]]:
    result: dict[str, tuple[list[str], dict[str, set[str]]]] = {}
    entries = contract.get("layer_sets")
    if not _is_sequence(entries):
        return result
    for entry in entries:
        if not _is_mapping(entry):
            continue
        language = entry.get("language")
        layers = entry.get("layers")
        allowed_entries = entry.get("allowed")
        if not isinstance(language, str) or not _is_sequence(layers):
            continue
        allowed: dict[str, set[str]] = {}
        if _is_sequence(allowed_entries):
            for allowed_entry in allowed_entries:
                if not _is_mapping(allowed_entry):
                    continue
                source = allowed_entry.get("from")
                targets = allowed_entry.get("to")
                if not isinstance(source, str) or not _is_sequence(targets):
                    continue
                allowed[source] = {t for t in targets if isinstance(t, str)}
        result[language] = ([layer for layer in layers if isinstance(layer, str)], allowed)
    return result


def _validate_layer_sets(contract: Mapping[str, Any]) -> list[ValidationIssue]:
    """A matrix that omits a layer must fail rather than default to permissive."""

    issues: list[ValidationIssue] = []
    # _layer_sets() keys by language, so a second row for the same language would
    # silently replace the real matrix while the original stayed visible in the
    # file. Detect the duplication on the raw list before it is collapsed.
    seen_languages: set[str] = set()
    raw = contract.get("layer_sets")
    for index, entry in enumerate(raw if _is_sequence(raw) else []):
        if not _is_mapping(entry):
            continue
        language = entry.get("language")
        if not isinstance(language, str):
            continue
        if language in seen_languages:
            issues.append(
                _issue(
                    "layer_contract.duplicate_language",
                    f"{CONTRACT_RELATIVE_PATH}:layer_sets[{index}]",
                    f"Language {language!r} already has a layer set. A second row would "
                    "override the first without any rule appearing unused.",
                )
            )
        seen_languages.add(language)
    for language, (layers, allowed) in sorted(_layer_sets(contract).items()):
        path = f"{CONTRACT_RELATIVE_PATH}:layer_sets[{language}]"
        if len(set(layers)) != len(layers):
            issues.append(
                _issue("layer_contract.duplicate_layer", path, "Layer ids must be unique.")
            )
        missing = sorted(set(layers) - set(allowed))
        if missing:
            issues.append(
                _issue(
                    "layer_contract.allowed_incomplete",
                    path,
                    f"Layers {missing!r} have no 'allowed' row. An absent row would be read "
                    "as 'depends on nothing' by accident rather than by decision.",
                )
            )
        seen_rows: set[str] = set()
        raw_allowed = next(
            (
                entry.get("allowed")
                for entry in (raw if _is_sequence(raw) else [])
                if _is_mapping(entry) and entry.get("language") == language
            ),
            None,
        )
        for row in raw_allowed if _is_sequence(raw_allowed) else []:
            if not _is_mapping(row) or not isinstance(row.get("from"), str):
                continue
            if row["from"] in seen_rows:
                issues.append(
                    _issue(
                        "layer_contract.duplicate_allowed_row",
                        path,
                        f"Layer {row['from']!r} has more than one 'allowed' row. The later row "
                        "would silently replace the earlier one.",
                    )
                )
            seen_rows.add(row["from"])

        for source, targets in sorted(allowed.items()):
            if source not in layers:
                issues.append(
                    _issue(
                        "layer_contract.allowed_unknown_source",
                        path,
                        f"Allowed row {source!r} is not a declared layer.",
                    )
                )
            unknown = sorted(targets - set(layers))
            if unknown:
                issues.append(
                    _issue(
                        "layer_contract.allowed_unknown_target",
                        path,
                        f"Allowed row {source!r} targets undeclared layers {unknown!r}.",
                    )
                )
            if source in targets:
                issues.append(
                    _issue(
                        "layer_contract.allowed_self",
                        path,
                        f"Allowed row {source!r} lists itself. Same-layer edges are always "
                        "permitted and must not be restated as policy.",
                    )
                )
    return issues


def _contract_services(contract: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    services: dict[str, Mapping[str, Any]] = {}
    entries = contract.get("services")
    if not _is_sequence(entries):
        return services
    for entry in entries:
        if _is_mapping(entry) and isinstance(entry.get("id"), str):
            services[entry["id"]] = entry
    return services


def _validate_contract_rules(contract: Mapping[str, Any]) -> list[ValidationIssue]:
    layer_sets = _layer_sets(contract)
    known_layers = {layer for layers, _ in layer_sets.values() for layer in layers}
    issues: list[ValidationIssue] = []

    # _contract_services() keys by id, so a second entry for the same service would
    # replace its whole rule list while the original rules stayed in the file and
    # never showed up as unused.
    seen_ids: set[str] = set()
    raw_services = contract.get("services")
    for index, entry in enumerate(raw_services if _is_sequence(raw_services) else []):
        if not _is_mapping(entry) or not isinstance(entry.get("id"), str):
            continue
        if entry["id"] in seen_ids:
            issues.append(
                _issue(
                    "layer_contract.duplicate_service",
                    f"{CONTRACT_RELATIVE_PATH}:services[{index}]",
                    f"Service {entry['id']!r} is declared more than once. A second entry would "
                    "override the first without any rule appearing unused.",
                )
            )
        seen_ids.add(entry["id"])

    for service_id, entry in sorted(_contract_services(contract).items()):
        service_path = f"{CONTRACT_RELATIVE_PATH}:services[{service_id}]"
        language = entry.get("language")
        # Validating rule layers against the union of every language's layers would
        # let a Python service be labelled `ui`. Scope them to the service's own set.
        service_layers = known_layers
        if isinstance(language, str) and language in layer_sets:
            service_layers = set(layer_sets[language][0])
        elif language is not None:
            issues.append(
                _issue(
                    "layer_contract.service_language_unknown",
                    service_path,
                    f"Service language {language!r} has no layer set.",
                )
            )
        declared = entry.get("layers")
        if not _is_sequence(declared) or not [layer for layer in declared if isinstance(layer, str)]:
            # Re-enforced here so a stubbed-out schema file cannot switch the
            # declared-layer-set drift check off by making `layers` optional.
            issues.append(
                _issue(
                    "layer_contract.service_layers_missing",
                    service_path,
                    "Service must declare the layers it is built from; without them the "
                    "layer-set drift check silently does nothing.",
                )
            )
            declared = []
        declared_set = {layer for layer in declared if isinstance(layer, str)}
        unknown_declared = sorted(declared_set - service_layers)
        if unknown_declared:
            issues.append(
                _issue(
                    "layer_contract.service_layer_unknown",
                    service_path,
                    f"Declared layers {unknown_declared!r} are not part of the "
                    f"{language!r} layer set.",
                )
            )
        rules = entry.get("rules")
        if not _is_sequence(rules):
            continue
        seen: set[tuple[str, str]] = set()
        for index, rule in enumerate(rules):
            path = f"{CONTRACT_RELATIVE_PATH}:services[{service_id}].rules[{index}]"
            if not _is_mapping(rule):
                issues.append(_issue("layer_contract.rule_not_object", path, "Rule must be an object."))
                continue
            kind = rule.get("match")
            value = rule.get("value")
            layer = rule.get("layer")
            if kind not in MATCH_KINDS:
                issues.append(
                    _issue("layer_contract.rule_match", path, f"match must be one of {MATCH_KINDS!r}.")
                )
            if not isinstance(value, str) or not value:
                issues.append(_issue("layer_contract.rule_value", path, "value must be a non-empty string."))
            elif kind == "prefix" and not value.endswith(("/", ".")):
                # `prefix: "types"` would silently absorb `typesHelper.ts`. Requiring a
                # separator keeps a prefix rule anchored to a real module boundary.
                issues.append(
                    _issue(
                        "layer_contract.prefix_unanchored",
                        path,
                        f"Prefix {value!r} must end with '/' or '.' so it cannot absorb a "
                        "module that merely starts with the same characters.",
                    )
                )
            elif kind == "suffix":
                # A bare extension suffix classifies every future file of that kind,
                # which converts the unassigned-module error into a silent default.
                issues.append(
                    _issue(
                        "layer_contract.suffix_rule",
                        path,
                        f"Suffix rule {value!r} would classify every future module ending that "
                        "way, turning the unassigned-module error into a silent default. Use "
                        "exact or anchored prefix rules instead.",
                    )
                )
            if not isinstance(layer, str) or layer not in service_layers:
                issues.append(
                    _issue(
                        "layer_contract.rule_layer",
                        path,
                        f"layer {layer!r} is not part of the layer set for this service.",
                    )
                )
            elif isinstance(layer, str) and declared_set and layer not in declared_set:
                issues.append(
                    _issue(
                        "layer_contract.rule_layer_undeclared",
                        path,
                        f"Rule assigns layer {layer!r} but the service does not declare it.",
                    )
                )
            if isinstance(kind, str) and isinstance(value, str):
                if (kind, value) in seen:
                    issues.append(
                        _issue(
                            "layer_contract.rule_duplicate",
                            path,
                            f"Duplicate rule {kind!r} {value!r}. The later copy can never match, "
                            "so it silently rots.",
                        )
                    )
                seen.add((kind, value))
    return issues


# --------------------------------------------------------------------------- #
# Scanning and classification
# --------------------------------------------------------------------------- #


def _rule_key(rule: Mapping[str, Any]) -> str:
    return f"{rule.get('match')}:{rule.get('value')}"


def _assign_layer(
    module: str, rules: Sequence[Mapping[str, Any]]
) -> tuple[str | None, str | None]:
    """First matching rule wins, so ordering in the contract is meaningful."""

    for rule in rules:
        kind = rule.get("match")
        value = rule.get("value")
        layer = rule.get("layer")
        if not isinstance(value, str) or not isinstance(layer, str):
            continue
        if kind == "exact" and module == value:
            return layer, _rule_key(rule)
        if kind == "prefix" and module.startswith(value):
            return layer, _rule_key(rule)
        if kind == "suffix" and module.endswith(value):
            return layer, _rule_key(rule)
    return None, None


def _scan_service(
    repo_root: Path,
    entry: Mapping[str, Any],
    observed_config: Mapping[str, Any],
    rules: Sequence[Mapping[str, Any]],
    diagnostics: ScanDiagnostics,
    declared_layers: Sequence[str] = (),
) -> ServiceLayerScan:
    service_id = str(entry.get("id"))
    language = str(entry.get("language"))
    suffixes = observed_config.get("source_suffixes", {})
    language_suffixes = suffixes.get(language, []) if _is_mapping(suffixes) else []

    modules: set[str] = set()
    edges: set[tuple[str, str]] = set()
    scanned = 0
    roots = entry.get("roots")
    for root_relative in roots if _is_sequence(roots) else []:
        if not isinstance(root_relative, str):
            continue
        files = _iter_source_files(repo_root, root_relative, language_suffixes, observed_config)
        scanned += len(files)
        root = repo_root / root_relative
        if language == "python":
            edges |= _python_module_edges(root, repo_root, files, diagnostics)
            modules |= {_python_module_name(root, path) for path in files}
        else:
            edges |= _typescript_module_edges(root, repo_root, files, diagnostics)
            modules |= {path.relative_to(root).as_posix() for path in files}

    assignments: list[tuple[str, str]] = []
    unassigned: list[str] = []
    used_rules: set[str] = set()
    for module in sorted(modules):
        layer, rule_key = _assign_layer(module, rules)
        if layer is None:
            unassigned.append(module)
            continue
        assignments.append((module, layer))
        if rule_key is not None:
            used_rules.add(rule_key)

    unused = sorted(
        _rule_key(rule) for rule in rules if _is_mapping(rule) and _rule_key(rule) not in used_rules
    )
    return ServiceLayerScan(
        service=service_id,
        language=language,
        modules=tuple(sorted(modules)),
        assignments=tuple(assignments),
        edges=tuple(sorted(edges)),
        unassigned_modules=tuple(unassigned),
        unused_rules=tuple(unused),
        scanned_file_count=scanned,
        declared_layers=tuple(sorted({layer for layer in declared_layers if isinstance(layer, str)})),
    )


def build_layer_report(
    repo_root: str | Path,
    observed_config: Mapping[str, Any],
    contract: Mapping[str, Any],
) -> LayerReport:
    """Scan every contract-covered service and collect cross-layer violations."""

    root = Path(repo_root).resolve()
    layer_sets = _layer_sets(contract)
    services = _contract_services(contract)
    diagnostics = ScanDiagnostics([], [])

    scans: list[ServiceLayerScan] = []
    violations: list[LayerViolation] = []
    service_roots = observed_config.get("service_roots")
    for entry in service_roots if _is_sequence(service_roots) else []:
        if not _is_mapping(entry):
            continue
        service_id = entry.get("id")
        if not isinstance(service_id, str) or service_id not in services:
            continue
        rules = services[service_id].get("rules")
        rule_list = [rule for rule in rules if _is_mapping(rule)] if _is_sequence(rules) else []
        declared = services[service_id].get("layers")
        declared_list = list(declared) if _is_sequence(declared) else []
        scan = _scan_service(root, entry, observed_config, rule_list, diagnostics, declared_list)
        scans.append(scan)

        _, allowed = layer_sets.get(scan.language, ([], {}))
        layer_of = dict(scan.assignments)
        for source, target in scan.edges:
            from_layer = layer_of.get(source)
            to_layer = layer_of.get(target)
            if from_layer is None or to_layer is None:
                # Unassigned modules are reported separately as errors; judging an
                # edge with an unknown endpoint would invent a verdict.
                continue
            if from_layer == to_layer:
                continue
            if to_layer in allowed.get(from_layer, set()):
                continue
            violations.append(
                LayerViolation(
                    service=scan.service,
                    from_module=source,
                    from_layer=from_layer,
                    to_module=target,
                    to_layer=to_layer,
                )
            )

    scans.sort(key=lambda scan: scan.service)
    violations.sort(key=lambda violation: violation.identity)
    return LayerReport(
        services=tuple(scans),
        violations=tuple(violations),
        unreadable_files=tuple(sorted(set(diagnostics.unreadable))),
        unparsed_files=tuple(sorted(set(diagnostics.unparsed))),
    )


# --------------------------------------------------------------------------- #
# Coverage and ratchet
# --------------------------------------------------------------------------- #


def _validate_coverage(
    observed_config: Mapping[str, Any], contract: Mapping[str, Any]
) -> list[ValidationIssue]:
    """Every scanned service must be either layered or explicitly excluded.

    Silently omitting a service from the layer contract would disable layer
    enforcement for it while the gate still reported zero violations.
    """

    issues: list[ValidationIssue] = []
    services = _contract_services(contract)
    excluded: dict[str, str] = {}
    excluded_entries = contract.get("excluded_services")
    if _is_sequence(excluded_entries):
        for entry in excluded_entries:
            if _is_mapping(entry) and isinstance(entry.get("id"), str):
                reason = entry.get("reason")
                excluded[entry["id"]] = reason if isinstance(reason, str) else ""

    observed_ids: list[str] = []
    languages: dict[str, str] = {}
    service_roots = observed_config.get("service_roots")
    for entry in service_roots if _is_sequence(service_roots) else []:
        if _is_mapping(entry) and isinstance(entry.get("id"), str):
            observed_ids.append(entry["id"])
            languages[entry["id"]] = str(entry.get("language"))

    layer_sets = _layer_sets(contract)
    for service_id in sorted(observed_ids):
        if service_id in services and service_id in excluded:
            issues.append(
                _issue(
                    "layer_contract.coverage_conflict",
                    CONTRACT_RELATIVE_PATH,
                    f"Service {service_id!r} is both layered and excluded.",
                )
            )
        elif service_id in services:
            language = languages[service_id]
            declared_language = services[service_id].get("language")
            if isinstance(declared_language, str) and declared_language != language:
                issues.append(
                    _issue(
                        "layer_contract.language_mismatch",
                        CONTRACT_RELATIVE_PATH,
                        f"Service {service_id!r} is declared {declared_language!r} in the layer "
                        f"contract but {language!r} in the observed-graph config.",
                    )
                )
            if language not in layer_sets:
                issues.append(
                    _issue(
                        "layer_contract.language_unknown",
                        CONTRACT_RELATIVE_PATH,
                        f"Service {service_id!r} scans {language!r} sources but no layer_sets "
                        "entry declares that language.",
                    )
                )
        elif service_id in excluded:
            if not excluded[service_id]:
                issues.append(
                    _issue(
                        "layer_contract.exclusion_unreasoned",
                        CONTRACT_RELATIVE_PATH,
                        f"Excluded service {service_id!r} needs a non-empty reason.",
                    )
                )
        else:
            issues.append(
                _issue(
                    "layer_contract.service_uncovered",
                    CONTRACT_RELATIVE_PATH,
                    f"Service {service_id!r} is scanned by "
                    "architecture/observed-graph.config.json but the layer contract neither "
                    "layers nor excludes it. An undecided service is not a passing service.",
                )
            )

    for service_id in sorted(set(services) - set(observed_ids)):
        issues.append(
            _issue(
                "layer_contract.service_unknown",
                CONTRACT_RELATIVE_PATH,
                f"Layered service {service_id!r} has no matching service_roots entry in "
                "architecture/observed-graph.config.json, so its rules can never run.",
            )
        )
    for service_id in sorted(set(excluded) - set(observed_ids)):
        issues.append(
            _issue(
                "layer_contract.exclusion_unknown",
                CONTRACT_RELATIVE_PATH,
                f"Excluded service {service_id!r} is not scanned at all, so the exclusion is stale.",
            )
        )
    return issues


def compare_layers_to_baseline(
    report: LayerReport, baseline: Mapping[str, Any]
) -> list[ValidationIssue]:
    """Ratchet: baselined violations pass, anything new fails, stale entries warn."""

    issues: list[ValidationIssue] = []
    known_services = {scan.service for scan in report.services}

    baselined: dict[tuple[str, str, str], Mapping[str, Any]] = {}
    entries = baseline.get("violations")
    if _is_sequence(entries):
        for entry in entries:
            if not _is_mapping(entry):
                continue
            identity = (str(entry.get("service")), str(entry.get("from")), str(entry.get("to")))
            baselined[identity] = entry
            if identity[0] not in known_services:
                issues.append(
                    _issue(
                        "layer.baseline_unknown_service",
                        BASELINE_RELATIVE_PATH,
                        f"Baseline entry names service {identity[0]!r}, which is not layered. "
                        "A baseline entry that can never match hides nothing and must be removed.",
                    )
                )

    observed = {violation.identity: violation for violation in report.violations}

    for scan in report.services:
        for module in scan.unassigned_modules:
            issues.append(
                _issue(
                    "layer.module.unassigned",
                    f"{CONTRACT_RELATIVE_PATH}:services[{scan.service}]",
                    f"Module {module!r} matches no rule. An unclassified module is invisible "
                    "to the gate, which is a failure, not a pass.",
                )
            )
        for rule_key in scan.unused_rules:
            issues.append(
                _issue(
                    "layer.rule.unused",
                    f"{CONTRACT_RELATIVE_PATH}:services[{scan.service}]",
                    f"Rule {rule_key!r} matched no module. Renames leave rules behind that "
                    "look like enforcement but are not.",
                    severity="warning",
                )
            )
        if not scan.modules:
            issues.append(
                _issue(
                    "layer.service.empty",
                    f"{CONTRACT_RELATIVE_PATH}:services[{scan.service}]",
                    f"Service {scan.service!r} produced no modules. A misconfigured root "
                    "reports zero violations for the wrong reason.",
                )
            )
        observed_layers = scan.observed_layers()
        if scan.declared_layers and set(observed_layers) != set(scan.declared_layers):
            issues.append(
                _issue(
                    "layer.service.layer_set_drift",
                    f"{CONTRACT_RELATIVE_PATH}:services[{scan.service}]",
                    f"Service {scan.service!r} declares layers {list(scan.declared_layers)!r} but "
                    f"its modules resolve to {list(observed_layers)!r}. A broad rule that "
                    "collapses a service into fewer layers disables enforcement without "
                    "leaving an unassigned module behind.",
                )
            )

    for identity, violation in sorted(observed.items()):
        if identity in baselined:
            continue
        issues.append(
            _issue(
                "layer.violation.new",
                f"{violation.service}:{violation.from_module}",
                f"{violation.from_layer} module {violation.from_module!r} depends on "
                f"{violation.to_layer} module {violation.to_module!r}, which the layer "
                "contract does not permit.",
            )
        )

    for identity in sorted(set(baselined) - set(observed)):
        issues.append(
            _issue(
                "layer.baseline_stale",
                BASELINE_RELATIVE_PATH,
                f"Baselined violation {identity!r} is no longer observed. Tighten the baseline "
                "instead of leaving grandfathered debt that no longer exists.",
                severity="warning",
            )
        )

    budgets: dict[str, int] = {}
    budget_entries = baseline.get("violation_budgets")
    if _is_sequence(budget_entries):
        for entry in budget_entries:
            if _is_mapping(entry) and isinstance(entry.get("service"), str):
                maximum = entry.get("maximum")
                if isinstance(maximum, int) and not isinstance(maximum, bool):
                    budgets[entry["service"]] = maximum

    baselined_counts: dict[str, int] = {}
    for service, _, _ in baselined:
        baselined_counts[service] = baselined_counts.get(service, 0) + 1

    counts = report.violation_counts()
    for service in sorted(known_services):
        if service in budgets and budgets[service] > baselined_counts.get(service, 0):
            # Slack above the grandfathered count is pre-approved room for new
            # violations. Enforce it in the gate, not only in a deletable test.
            issues.append(
                _issue(
                    "layer.budget_slack",
                    BASELINE_RELATIVE_PATH,
                    f"Service {service!r} has a budget of {budgets[service]} but only "
                    f"{baselined_counts.get(service, 0)} grandfathered violations. A budget above "
                    "the recorded count is room to add new violations without failing.",
                )
            )
        if service not in budgets:
            issues.append(
                _issue(
                    "layer.budget_missing",
                    BASELINE_RELATIVE_PATH,
                    f"Service {service!r} has no violation budget. Without one, a service can "
                    "accumulate violations that no count check ever sees.",
                )
            )
            continue
        if counts.get(service, 0) > budgets[service]:
            issues.append(
                _issue(
                    "layer.budget_exceeded",
                    BASELINE_RELATIVE_PATH,
                    f"Service {service!r} has {counts.get(service, 0)} layer violations but a "
                    f"budget of {budgets[service]}.",
                )
            )
    for service in sorted(set(budgets) - known_services):
        issues.append(
            _issue(
                "layer.budget_unknown_service",
                BASELINE_RELATIVE_PATH,
                f"Budget names service {service!r}, which is not layered.",
                severity="warning",
            )
        )

    issues.extend(report.read_failures())
    return issues


def check_layered_architecture(repo_root: str | Path) -> LayerRatchetResult:
    """Canonical entry point used by the root-contract gate."""

    root = Path(repo_root).resolve()
    issues: list[ValidationIssue] = []

    observed_config, observed_issues = _load_observed_config(root)
    # Only blocking problems from the shared config matter here; the observed
    # ratchet reports its own findings and duplicating them would double-count.
    issues.extend(issue for issue in observed_issues if issue.severity == "error")
    contract, contract_issues = _load_layer_contract(root)
    issues.extend(contract_issues)
    baseline, baseline_issues = _load_layer_baseline(root)
    issues.extend(baseline_issues)

    if observed_config is None or contract is None or baseline is None:
        return LayerRatchetResult(str(root), None, tuple(_dedupe(issues)))
    if any(issue.severity == "error" for issue in issues):
        return LayerRatchetResult(str(root), None, tuple(_dedupe(issues)))

    issues.extend(_validate_coverage(observed_config, contract))
    if any(issue.severity == "error" for issue in issues):
        return LayerRatchetResult(str(root), None, tuple(_dedupe(issues)))

    report = build_layer_report(root, observed_config, contract)
    issues.extend(compare_layers_to_baseline(report, baseline))
    return LayerRatchetResult(str(root), report, tuple(_dedupe(issues)), compared=True)


def _dedupe(issues: Iterable[ValidationIssue]) -> list[ValidationIssue]:
    seen: set[tuple[str, str, str, str]] = set()
    unique: list[ValidationIssue] = []
    for issue in issues:
        key = (issue.code, issue.path, issue.message, issue.severity)
        if key in seen:
            continue
        seen.add(key)
        unique.append(issue)
    return unique


def render_layer_report_json(report: LayerReport) -> str:
    """LF-terminated, sorted-key JSON so Windows and Linux emit identical bytes."""

    return json.dumps(report.to_dict(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"
