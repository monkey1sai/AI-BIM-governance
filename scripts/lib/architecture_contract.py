"""Semantic validation for AI-BIM-governance architecture contracts.

The JSON Schema files describe shape. This module enforces cross-object semantics
that JSON Schema cannot reliably express: unique ownership, allowed dependency
edges, browser/API boundaries, edge data residency, readiness evidence, and
exception expiry.

It intentionally uses only Python's standard library so the canonical root
contract gate does not gain a production dependency.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime
import json
from pathlib import Path
import re
from typing import Any, Iterable, Mapping, Sequence

CONTRACT_SCHEMA_VERSION = "ai-bim-architecture-contract/v1"
DELTA_SCHEMA_VERSION = "ai-bim-architecture-delta/v1"
VALIDATION_RESULT_SCHEMA_VERSION = "ai-bim-architecture-validation-result/v1"

REQUIRED_SERVICE_IDS = {
    "bim-review-coordinator",
    "bim-streaming-server",
    "governance-service",
    "web-viewer-sample",
    "kit-manager-api",
}
REQUIRED_EXTERNAL_SYSTEM_IDS = {
    "external-company-cloud-bim-control",
    "external-customer-edge-ifc-worker",
}
REQUIRED_INVARIANT_IDS = {
    "ARCH-DATA-001",
    "ARCH-HTTP-001",
    "ARCH-SVC-001",
    "ARCH-CALL-001",
    "ARCH-GRAPH-001",
    "ARCH-LAYER-001",
    "ARCH-LIFECYCLE-001",
    "ARCH-READY-001",
    "ARCH-UI-001",
    "ARCH-DELTA-001",
    "ARCH-EXC-001",
    "ARCH-TRUTH-001",
}
REQUIRED_READINESS_EVIDENCE = {
    "kit-process-alive",
    "opened-stage-result",
    "datachannel-ready",
    "first-frame-at",
    "stage-matched",
}
REQUIRED_LARGE_ARTIFACT_PATTERNS = {
    "*.ifc",
    "*.rvt",
    "*.dwg",
    "*.usd",
    "*.usdc",
    "element_mapping.json",
    "entity_index.json",
}
EXPECTED_RUNTIME_TRUTH_PREFIX = [
    "implementation",
    "executable-tests-and-contracts",
    "docs-plans-target-behavior",
]
CHANGE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
INVARIANT_ID_PATTERN = re.compile(r"^ARCH-[A-Z]+-[0-9]{3}$")


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    """A stable machine-readable validation finding."""

    code: str
    path: str
    message: str
    severity: str = "error"

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class RepositoryValidationResult:
    """Result returned by :func:`validate_repository`."""

    repo_root: str
    checked_files: tuple[str, ...]
    issues: tuple[ValidationIssue, ...]

    @property
    def error_count(self) -> int:
        return sum(issue.severity == "error" for issue in self.issues)

    @property
    def warning_count(self) -> int:
        return sum(issue.severity == "warning" for issue in self.issues)

    @property
    def status(self) -> str:
        return "passed" if self.error_count == 0 else "failed"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": VALIDATION_RESULT_SCHEMA_VERSION,
            "status": self.status,
            "repo_root": self.repo_root,
            "checked_files": list(self.checked_files),
            "summary": {
                "errors": self.error_count,
                "warnings": self.warning_count,
                "issues": len(self.issues),
            },
            "issues": [issue.to_dict() for issue in self.issues],
        }


def _issue(code: str, path: str, message: str, severity: str = "error") -> ValidationIssue:
    return ValidationIssue(code=code, path=path, message=message, severity=severity)


def _is_mapping(value: Any) -> bool:
    return isinstance(value, Mapping)


def _is_sequence(value: Any) -> bool:
    return isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray))


def _non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _string_list(value: Any) -> list[str] | None:
    if not _is_sequence(value) or not all(_non_empty_string(item) for item in value):
        return None
    return list(value)


def _duplicate_values(values: Iterable[str]) -> set[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return duplicates


def _list_of_mappings(value: Any) -> list[Mapping[str, Any]] | None:
    if not _is_sequence(value) or not all(_is_mapping(item) for item in value):
        return None
    return list(value)


def _parse_iso_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _schema_path(path: str, key: str) -> str:
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", key):
        return f"{path}.{key}"
    return f"{path}[{json.dumps(key)}]"


def _schema_type_matches(value: Any, expected: str) -> bool:
    if expected == "object":
        return _is_mapping(value)
    if expected == "array":
        return _is_sequence(value)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return False


def _resolve_local_schema_ref(
    root_schema: Mapping[str, Any],
    reference: str,
) -> Mapping[str, Any] | None:
    if not reference.startswith("#/"):
        return None
    current: Any = root_schema
    for raw_part in reference[2:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if not _is_mapping(current) or part not in current:
            return None
        current = current[part]
    return current if _is_mapping(current) else None


def _validate_schema_node(
    instance: Any,
    schema: Mapping[str, Any],
    *,
    root_schema: Mapping[str, Any],
    path: str,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    reference = schema.get("$ref")
    if reference is not None:
        if not isinstance(reference, str):
            return [_issue("schema.ref", path, "$ref must be a string.")]
        resolved = _resolve_local_schema_ref(root_schema, reference)
        if resolved is None:
            return [_issue("schema.ref", path, f"Unsupported or unresolved $ref {reference!r}.")]
        return _validate_schema_node(instance, resolved, root_schema=root_schema, path=path)

    expected_type = schema.get("type")
    if isinstance(expected_type, str):
        expected_types = [expected_type]
    elif _is_sequence(expected_type) and all(isinstance(item, str) for item in expected_type):
        expected_types = list(expected_type)
    elif expected_type is None:
        expected_types = []
    else:
        return [_issue("schema.definition.type", path, "Schema type must be a string or string array.")]

    if expected_types and not any(_schema_type_matches(instance, item) for item in expected_types):
        return [
            _issue(
                "schema.instance.type",
                path,
                f"Expected JSON type {' or '.join(expected_types)}.",
            )
        ]

    if "const" in schema and instance != schema["const"]:
        issues.append(_issue("schema.instance.const", path, f"Value must equal {schema['const']!r}."))
    enum = schema.get("enum")
    if _is_sequence(enum) and instance not in enum:
        issues.append(_issue("schema.instance.enum", path, f"Value must be one of {list(enum)!r}."))

    if _is_mapping(instance):
        properties = schema.get("properties", {})
        if not _is_mapping(properties):
            issues.append(_issue("schema.definition.properties", path, "Schema properties must be an object."))
            properties = {}

        required = schema.get("required", [])
        if not _is_sequence(required) or not all(isinstance(item, str) for item in required):
            issues.append(_issue("schema.definition.required", path, "Schema required must be a string array."))
            required = []
        for key in required:
            if key not in instance:
                issues.append(
                    _issue(
                        "schema.instance.required",
                        _schema_path(path, key),
                        f"Required property {key!r} is missing.",
                    )
                )

        additional = schema.get("additionalProperties", True)
        for key, value in instance.items():
            child_path = _schema_path(path, str(key))
            child_schema = properties.get(key)
            if _is_mapping(child_schema):
                issues.extend(
                    _validate_schema_node(
                        value,
                        child_schema,
                        root_schema=root_schema,
                        path=child_path,
                    )
                )
            elif child_schema is not None:
                issues.append(
                    _issue(
                        "schema.definition.property",
                        child_path,
                        f"Schema for property {key!r} must be an object.",
                    )
                )
            elif additional is False:
                issues.append(
                    _issue(
                        "schema.instance.additional_property",
                        child_path,
                        f"Additional property {key!r} is not allowed.",
                    )
                )
            elif _is_mapping(additional):
                issues.extend(
                    _validate_schema_node(
                        value,
                        additional,
                        root_schema=root_schema,
                        path=child_path,
                    )
                )

    if _is_sequence(instance):
        min_items = schema.get("minItems")
        if isinstance(min_items, int) and len(instance) < min_items:
            issues.append(_issue("schema.instance.min_items", path, f"Array must contain at least {min_items} item(s)."))
        max_items = schema.get("maxItems")
        if isinstance(max_items, int) and len(instance) > max_items:
            issues.append(_issue("schema.instance.max_items", path, f"Array must contain at most {max_items} item(s)."))
        if schema.get("uniqueItems") is True:
            rendered = [json.dumps(item, sort_keys=True, separators=(",", ":"), ensure_ascii=False) for item in instance]
            if len(rendered) != len(set(rendered)):
                issues.append(_issue("schema.instance.unique_items", path, "Array items must be unique."))
        item_schema = schema.get("items")
        if _is_mapping(item_schema):
            for index, value in enumerate(instance):
                issues.extend(
                    _validate_schema_node(
                        value,
                        item_schema,
                        root_schema=root_schema,
                        path=f"{path}[{index}]",
                    )
                )
        elif item_schema is not None:
            issues.append(_issue("schema.definition.items", path, "Schema items must be an object."))

    if isinstance(instance, str):
        min_length = schema.get("minLength")
        if isinstance(min_length, int) and len(instance) < min_length:
            issues.append(_issue("schema.instance.min_length", path, f"String must contain at least {min_length} character(s)."))
        max_length = schema.get("maxLength")
        if isinstance(max_length, int) and len(instance) > max_length:
            issues.append(_issue("schema.instance.max_length", path, f"String must contain at most {max_length} character(s)."))
        pattern = schema.get("pattern")
        if isinstance(pattern, str) and re.search(pattern, instance) is None:
            issues.append(_issue("schema.instance.pattern", path, f"String does not match pattern {pattern!r}."))
        format_name = schema.get("format")
        if format_name == "date" and _parse_iso_date(instance) is None:
            issues.append(_issue("schema.instance.format", path, "String must be an ISO date."))
        elif format_name == "date-time":
            try:
                if "T" not in instance:
                    raise ValueError("date-time separator missing")
                datetime.fromisoformat(instance.replace("Z", "+00:00"))
            except ValueError:
                issues.append(_issue("schema.instance.format", path, "String must be an ISO date-time."))

    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        minimum = schema.get("minimum")
        if isinstance(minimum, (int, float)) and instance < minimum:
            issues.append(_issue("schema.instance.minimum", path, f"Number must be at least {minimum}."))
        maximum = schema.get("maximum")
        if isinstance(maximum, (int, float)) and instance > maximum:
            issues.append(_issue("schema.instance.maximum", path, f"Number must be at most {maximum}."))

    return issues


def validate_schema_instance(instance: Any, schema: Any) -> list[ValidationIssue]:
    """Validate an instance against the Draft-07 subset used by this repository."""

    if not _is_mapping(schema):
        return [_issue("schema.definition.type", "$", "Schema document must be a JSON object.")]
    issues = _validate_schema_node(instance, schema, root_schema=schema, path="$")
    return sorted(set(issues), key=lambda item: (item.severity, item.path, item.code, item.message))


def _service_index(contract: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    services = _list_of_mappings(contract.get("services")) or []
    return {
        str(service.get("id")): service
        for service in services
        if _non_empty_string(service.get("id"))
    }


def _external_index(contract: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    systems = _list_of_mappings(contract.get("external_systems")) or []
    return {
        str(system.get("id")): system
        for system in systems
        if _non_empty_string(system.get("id"))
    }


def _invariant_index(contract: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    invariants = _list_of_mappings(contract.get("invariants")) or []
    return {
        str(invariant.get("id")): invariant
        for invariant in invariants
        if _non_empty_string(invariant.get("id"))
    }


def _allowed_dependency_edges(contract: Mapping[str, Any]) -> set[tuple[str, str, str]]:
    edges: set[tuple[str, str, str]] = set()
    for service_id, service in _service_index(contract).items():
        calls = _list_of_mappings(service.get("may_call")) or []
        for call in calls:
            target = call.get("target")
            interfaces = _string_list(call.get("interfaces")) or []
            if not _non_empty_string(target):
                continue
            for interface in interfaces:
                edges.add((service_id, str(target), interface))
    return edges


def validate_contract(contract: Any) -> list[ValidationIssue]:
    """Validate a desired architecture contract.

    The function is deliberately fail-closed: malformed sections produce errors
    and are not silently ignored.
    """

    issues: list[ValidationIssue] = []
    if not _is_mapping(contract):
        return [_issue("contract.type", "$", "Architecture contract must be a JSON object.")]

    if contract.get("schema_version") != CONTRACT_SCHEMA_VERSION:
        issues.append(
            _issue(
                "contract.schema_version",
                "$.schema_version",
                f"Expected {CONTRACT_SCHEMA_VERSION!r}.",
            )
        )

    contract_id = contract.get("contract_id")
    if not _non_empty_string(contract_id) or not CHANGE_ID_PATTERN.fullmatch(str(contract_id)):
        issues.append(
            _issue(
                "contract.id",
                "$.contract_id",
                "contract_id must be a lowercase kebab-case identifier.",
            )
        )

    authority = contract.get("authority")
    if not _is_mapping(authority):
        issues.append(_issue("contract.authority", "$.authority", "authority must be an object."))
    else:
        truth_order = _string_list(authority.get("runtime_truth_order"))
        if truth_order is None:
            issues.append(
                _issue(
                    "truth_order.type",
                    "$.authority.runtime_truth_order",
                    "runtime_truth_order must be a non-empty string array.",
                )
            )
        elif truth_order[: len(EXPECTED_RUNTIME_TRUTH_PREFIX)] != EXPECTED_RUNTIME_TRUTH_PREFIX:
            issues.append(
                _issue(
                    "truth_order.priority",
                    "$.authority.runtime_truth_order",
                    "Runtime truth must begin with implementation, executable tests/contracts, then docs/plans target behavior.",
                )
            )

    services = _list_of_mappings(contract.get("services"))
    if services is None:
        issues.append(_issue("services.type", "$.services", "services must be an array of objects."))
        services = []

    service_ids: list[str] = []
    for index, service in enumerate(services):
        path = f"$.services[{index}]"
        service_id = service.get("id")
        if not _non_empty_string(service_id) or not CHANGE_ID_PATTERN.fullmatch(str(service_id)):
            issues.append(_issue("service.id", f"{path}.id", "Service id must be lowercase kebab-case."))
            continue
        service_id = str(service_id)
        service_ids.append(service_id)

        for field in ("owns", "must_not"):
            values = _string_list(service.get(field))
            if values is None:
                issues.append(_issue(f"service.{field}.type", f"{path}.{field}", f"{field} must be a string array."))
                continue
            duplicates = _duplicate_values(values)
            for duplicate in sorted(duplicates):
                issues.append(
                    _issue(
                        f"service.{field}.duplicate",
                        f"{path}.{field}",
                        f"Duplicate value {duplicate!r}.",
                    )
                )

        owns = set(_string_list(service.get("owns")) or [])
        forbidden = set(_string_list(service.get("must_not")) or [])
        overlap = owns & forbidden
        for capability in sorted(overlap):
            issues.append(
                _issue(
                    "service.ownership_forbidden_overlap",
                    path,
                    f"Service {service_id!r} both owns and forbids {capability!r}.",
                )
            )

        ports = service.get("ports")
        if not _is_sequence(ports) or not all(isinstance(port, int) and 1 <= port <= 65535 for port in ports):
            issues.append(_issue("service.ports", f"{path}.ports", "ports must contain valid integer TCP/UDP ports."))
        elif len(set(ports)) != len(list(ports)):
            issues.append(_issue("service.ports.duplicate", f"{path}.ports", "ports must be unique within a service."))

        calls = _list_of_mappings(service.get("may_call"))
        if calls is None:
            issues.append(_issue("service.may_call.type", f"{path}.may_call", "may_call must be an array of objects."))
            continue
        seen_calls: set[tuple[str, str]] = set()
        for call_index, call in enumerate(calls):
            call_path = f"{path}.may_call[{call_index}]"
            target = call.get("target")
            interfaces = _string_list(call.get("interfaces"))
            if not _non_empty_string(target):
                issues.append(_issue("service.call.target", f"{call_path}.target", "Call target must be an identifier."))
            if interfaces is None or not interfaces:
                issues.append(_issue("service.call.interfaces", f"{call_path}.interfaces", "Call interfaces must be a non-empty string array."))
                continue
            for interface in interfaces:
                key = (str(target), interface)
                if key in seen_calls:
                    issues.append(
                        _issue(
                            "service.call.duplicate",
                            call_path,
                            f"Duplicate dependency declaration to {target!r} via {interface!r}.",
                        )
                    )
                seen_calls.add(key)

    for duplicate in sorted(_duplicate_values(service_ids)):
        issues.append(_issue("service.id.duplicate", "$.services", f"Duplicate service id {duplicate!r}."))

    missing_services = REQUIRED_SERVICE_IDS - set(service_ids)
    if missing_services:
        issues.append(
            _issue(
                "service.required_missing",
                "$.services",
                "Missing required services: " + ", ".join(sorted(missing_services)) + ".",
            )
        )

    external_systems = _list_of_mappings(contract.get("external_systems"))
    if external_systems is None:
        issues.append(_issue("external_systems.type", "$.external_systems", "external_systems must be an array of objects."))
        external_systems = []
    external_ids = [
        str(system.get("id"))
        for system in external_systems
        if _non_empty_string(system.get("id"))
    ]
    for duplicate in sorted(_duplicate_values(external_ids)):
        issues.append(_issue("external.id.duplicate", "$.external_systems", f"Duplicate external system id {duplicate!r}."))
    missing_external = REQUIRED_EXTERNAL_SYSTEM_IDS - set(external_ids)
    if missing_external:
        issues.append(
            _issue(
                "external.required_missing",
                "$.external_systems",
                "Missing required external systems: " + ", ".join(sorted(missing_external)) + ".",
            )
        )

    known_targets = set(service_ids) | set(external_ids)
    for index, service in enumerate(services):
        calls = _list_of_mappings(service.get("may_call")) or []
        for call_index, call in enumerate(calls):
            target = call.get("target")
            if _non_empty_string(target) and str(target) not in known_targets:
                issues.append(
                    _issue(
                        "service.call.unknown_target",
                        f"$.services[{index}].may_call[{call_index}].target",
                        f"Unknown dependency target {target!r}.",
                    )
                )

    owner_by_capability: dict[str, str] = {}
    for index, service in enumerate(services):
        service_id = str(service.get("id", f"index-{index}"))
        for capability in _string_list(service.get("owns")) or []:
            previous_owner = owner_by_capability.get(capability)
            if previous_owner is not None and previous_owner != service_id:
                issues.append(
                    _issue(
                        "ownership.duplicate_owner",
                        f"$.services[{index}].owns",
                        f"Capability {capability!r} is owned by both {previous_owner!r} and {service_id!r}.",
                    )
                )
            else:
                owner_by_capability[capability] = service_id

    browser = contract.get("browser_access_policy")
    if not _is_mapping(browser):
        issues.append(_issue("browser_policy.type", "$.browser_access_policy", "browser_access_policy must be an object."))
    else:
        entrypoints = _list_of_mappings(browser.get("http_api_entrypoints"))
        if entrypoints is None:
            issues.append(
                _issue(
                    "browser_policy.entrypoints.type",
                    "$.browser_access_policy.http_api_entrypoints",
                    "http_api_entrypoints must be an array of objects.",
                )
            )
            entrypoints = []
        expected_entrypoints = {("bim-review-coordinator", 8004)}
        actual_entrypoints = {
            (str(entry.get("service")), entry.get("port"))
            for entry in entrypoints
            if _non_empty_string(entry.get("service")) and isinstance(entry.get("port"), int)
        }
        if actual_entrypoints != expected_entrypoints:
            issues.append(
                _issue(
                    "browser_policy.http_entrypoint",
                    "$.browser_access_policy.http_api_entrypoints",
                    "The only public browser HTTP API entrypoint must be bim-review-coordinator:8004.",
                )
            )

        forbidden = set(_string_list(browser.get("forbidden_direct_http_services")) or [])
        required_forbidden = {"bim-streaming-server", "governance-service", "kit-manager-api"}
        missing_forbidden = required_forbidden - forbidden
        if missing_forbidden:
            issues.append(
                _issue(
                    "browser_policy.forbidden_missing",
                    "$.browser_access_policy.forbidden_direct_http_services",
                    "Internal services missing from browser HTTP deny-list: " + ", ".join(sorted(missing_forbidden)) + ".",
                )
            )

        realtime = _list_of_mappings(browser.get("realtime_channels")) or []
        realtime_endpoints = {
            (str(channel.get("service")), channel.get("port"))
            for channel in realtime
            if _non_empty_string(channel.get("service")) and isinstance(channel.get("port"), int)
        }
        required_realtime = {("bim-streaming-server", 49100), ("bim-streaming-server", 47998)}
        missing_realtime = required_realtime - realtime_endpoints
        if missing_realtime:
            formatted = ", ".join(f"{service}:{port}" for service, port in sorted(missing_realtime))
            issues.append(
                _issue(
                    "browser_policy.realtime_missing",
                    "$.browser_access_policy.realtime_channels",
                    f"Missing required browser realtime channels: {formatted}.",
                )
            )

    data_classes = _list_of_mappings(contract.get("data_classes"))
    if data_classes is None:
        issues.append(_issue("data_classes.type", "$.data_classes", "data_classes must be an array of objects."))
        data_classes = []
    large_artifact_classes = [item for item in data_classes if item.get("id") == "large-bim-artifacts"]
    if len(large_artifact_classes) != 1:
        issues.append(
            _issue(
                "data_residency.large_artifacts",
                "$.data_classes",
                "Exactly one large-bim-artifacts data class is required.",
            )
        )
    else:
        item = large_artifact_classes[0]
        if item.get("authority") != "customer-edge" or item.get("cloud_transfer") != "forbidden":
            issues.append(
                _issue(
                    "data_residency.edge_only",
                    "$.data_classes[large-bim-artifacts]",
                    "Large BIM artifacts must be customer-edge authoritative with cloud_transfer=forbidden.",
                )
            )
        includes = set(_string_list(item.get("includes")) or [])
        missing_patterns = REQUIRED_LARGE_ARTIFACT_PATTERNS - includes
        if missing_patterns:
            issues.append(
                _issue(
                    "data_residency.patterns_missing",
                    "$.data_classes[large-bim-artifacts].includes",
                    "Large-artifact policy is missing: " + ", ".join(sorted(missing_patterns)) + ".",
                )
            )

    cloud = next((item for item in external_systems if item.get("id") == "external-company-cloud-bim-control"), None)
    if cloud is not None:
        forbidden_receive = set(_string_list(cloud.get("must_not_receive")) or [])
        required_cloud_forbidden = {
            "ifc-source-artifact",
            "usd-derived-artifact",
            "usdc-derived-artifact",
            "element-mapping",
            "entity-index",
        }
        missing = required_cloud_forbidden - forbidden_receive
        if missing:
            issues.append(
                _issue(
                    "data_residency.cloud_deny_missing",
                    "$.external_systems[external-company-cloud-bim-control].must_not_receive",
                    "Cloud deny-list is missing: " + ", ".join(sorted(missing)) + ".",
                )
            )

    readiness = _list_of_mappings(contract.get("readiness_policies"))
    if readiness is None:
        issues.append(_issue("readiness.type", "$.readiness_policies", "readiness_policies must be an array of objects."))
        readiness = []
    ready_policy = next((item for item in readiness if item.get("id") == "review-session-ready"), None)
    if ready_policy is None:
        issues.append(
            _issue(
                "readiness.required_missing",
                "$.readiness_policies",
                "review-session-ready policy is required.",
            )
        )
    else:
        if ready_policy.get("operator") != "all":
            issues.append(
                _issue(
                    "readiness.operator",
                    "$.readiness_policies[review-session-ready].operator",
                    "Readiness evidence must use an all/conjunction operator.",
                )
            )
        evidence = _list_of_mappings(ready_policy.get("required_evidence"))
        if evidence is None:
            issues.append(
                _issue(
                    "readiness.evidence.type",
                    "$.readiness_policies[review-session-ready].required_evidence",
                    "required_evidence must be an array of objects.",
                )
            )
            evidence = []
        evidence_ids = {
            str(item.get("id"))
            for item in evidence
            if _non_empty_string(item.get("id"))
        }
        missing_evidence = REQUIRED_READINESS_EVIDENCE - evidence_ids
        if missing_evidence:
            issues.append(
                _issue(
                    "readiness.evidence_missing",
                    "$.readiness_policies[review-session-ready].required_evidence",
                    "Missing readiness evidence: " + ", ".join(sorted(missing_evidence)) + ".",
                )
            )
        sides = {
            str(item.get("side"))
            for item in evidence
            if _non_empty_string(item.get("side"))
        }
        if not {"kit", "browser"}.issubset(sides):
            issues.append(
                _issue(
                    "readiness.cross_side",
                    "$.readiness_policies[review-session-ready].required_evidence",
                    "Readiness must contain both Kit-side and browser-side evidence.",
                )
            )
        browser_sources = {
            str(item.get("source"))
            for item in evidence
            if item.get("side") == "browser" and _non_empty_string(item.get("source"))
        }
        if "web-viewer-sample" not in browser_sources:
            issues.append(
                _issue(
                    "readiness.browser_source",
                    "$.readiness_policies[review-session-ready].required_evidence",
                    "Browser evidence must be produced by web-viewer-sample.",
                )
            )

    invariants = _list_of_mappings(contract.get("invariants"))
    if invariants is None:
        issues.append(_issue("invariants.type", "$.invariants", "invariants must be an array of objects."))
        invariants = []
    invariant_ids: list[str] = []
    for index, invariant in enumerate(invariants):
        invariant_id = invariant.get("id")
        path = f"$.invariants[{index}]"
        if not _non_empty_string(invariant_id) or not INVARIANT_ID_PATTERN.fullmatch(str(invariant_id)):
            issues.append(_issue("invariant.id", f"{path}.id", "Invariant id must match ARCH-<DOMAIN>-NNN."))
            continue
        invariant_ids.append(str(invariant_id))
        enforcement = invariant.get("enforcement")
        if not _is_mapping(enforcement):
            issues.append(_issue("invariant.enforcement", f"{path}.enforcement", "enforcement must be an object."))
            continue
        if enforcement.get("status") not in {"active", "delegated", "planned"}:
            issues.append(
                _issue(
                    "invariant.enforcement.status",
                    f"{path}.enforcement.status",
                    "Enforcement status must be active, delegated, or planned.",
                )
            )
        for field in ("mode", "rule"):
            if not _non_empty_string(enforcement.get(field)):
                issues.append(
                    _issue(
                        f"invariant.enforcement.{field}",
                        f"{path}.enforcement.{field}",
                        f"enforcement.{field} must be non-empty.",
                    )
                )

    for duplicate in sorted(_duplicate_values(invariant_ids)):
        issues.append(_issue("invariant.id.duplicate", "$.invariants", f"Duplicate invariant id {duplicate!r}."))
    missing_invariants = REQUIRED_INVARIANT_IDS - set(invariant_ids)
    if missing_invariants:
        issues.append(
            _issue(
                "invariant.required_missing",
                "$.invariants",
                "Missing required invariants: " + ", ".join(sorted(missing_invariants)) + ".",
            )
        )

    delta_policy = contract.get("architecture_delta_policy")
    if not _is_mapping(delta_policy):
        issues.append(_issue("delta_policy.type", "$.architecture_delta_policy", "architecture_delta_policy must be an object."))
    else:
        required_lanes = set(_string_list(delta_policy.get("required_for_lanes")) or [])
        if not {"G", "S"}.issubset(required_lanes):
            issues.append(
                _issue(
                    "delta_policy.lanes",
                    "$.architecture_delta_policy.required_for_lanes",
                    "Architecture deltas must be required for Lane G and Lane S.",
                )
            )
        if delta_policy.get("directory") != "architecture/deltas":
            issues.append(
                _issue(
                    "delta_policy.directory",
                    "$.architecture_delta_policy.directory",
                    "Delta directory must be architecture/deltas.",
                )
            )

    exception_policy = contract.get("exception_policy")
    if not _is_mapping(exception_policy):
        issues.append(_issue("exception_policy.type", "$.exception_policy", "exception_policy must be an object."))
    else:
        max_days = exception_policy.get("maximum_days")
        if not isinstance(max_days, int) or not 1 <= max_days <= 90:
            issues.append(
                _issue(
                    "exception_policy.maximum_days",
                    "$.exception_policy.maximum_days",
                    "maximum_days must be an integer between 1 and 90.",
                )
            )
        required_fields = set(_string_list(exception_policy.get("required_fields")) or [])
        expected_fields = {"invariant_id", "owner", "reason", "adr", "created_on", "expires_on"}
        missing_fields = expected_fields - required_fields
        if missing_fields:
            issues.append(
                _issue(
                    "exception_policy.required_fields",
                    "$.exception_policy.required_fields",
                    "Exception policy is missing fields: " + ", ".join(sorted(missing_fields)) + ".",
                )
            )
        if exception_policy.get("expired_exception_policy") != "fail":
            issues.append(
                _issue(
                    "exception_policy.expired",
                    "$.exception_policy.expired_exception_policy",
                    "Expired architecture exceptions must fail validation.",
                )
            )

    return sorted(issues, key=lambda item: (item.severity, item.path, item.code, item.message))


def validate_delta(
    delta: Any,
    contract: Mapping[str, Any],
    *,
    today: date | None = None,
) -> list[ValidationIssue]:
    """Validate one architecture delta against the desired architecture."""

    issues: list[ValidationIssue] = []
    today = today or date.today()
    if not _is_mapping(delta):
        return [_issue("delta.type", "$", "Architecture delta must be a JSON object.")]

    if delta.get("schema_version") != DELTA_SCHEMA_VERSION:
        issues.append(
            _issue(
                "delta.schema_version",
                "$.schema_version",
                f"Expected {DELTA_SCHEMA_VERSION!r}.",
            )
        )

    change_id = delta.get("change_id")
    if not _non_empty_string(change_id) or not CHANGE_ID_PATTERN.fullmatch(str(change_id)):
        issues.append(_issue("delta.change_id", "$.change_id", "change_id must be lowercase kebab-case."))

    lane = delta.get("lane")
    if lane not in {"F", "B", "G", "S"}:
        issues.append(_issue("delta.lane", "$.lane", "lane must be F, B, G, or S."))

    created_on = _parse_iso_date(delta.get("created_on"))
    if created_on is None:
        issues.append(_issue("delta.created_on", "$.created_on", "created_on must be an ISO date."))

    services = _service_index(contract)
    external = _external_index(contract)
    known_nodes = set(services) | set(external)
    affected_services = _string_list(delta.get("affected_services"))
    if affected_services is None:
        issues.append(_issue("delta.affected_services", "$.affected_services", "affected_services must be a string array."))
        affected_services = []
    for service_id in affected_services:
        if service_id not in services:
            issues.append(
                _issue(
                    "delta.affected_service.unknown",
                    "$.affected_services",
                    f"Unknown affected service {service_id!r}.",
                )
            )

    architecture_change_present = False
    allowed_edges = _allowed_dependency_edges(contract)
    seen_edges: set[tuple[str, str, str, str]] = set()
    for field in ("added_dependency_edges", "removed_dependency_edges"):
        edges = _list_of_mappings(delta.get(field))
        if edges is None:
            issues.append(_issue(f"delta.{field}.type", f"$.{field}", f"{field} must be an array of objects."))
            edges = []
        if edges:
            architecture_change_present = True
        for index, edge in enumerate(edges):
            path = f"$.{field}[{index}]"
            source = edge.get("from")
            target = edge.get("to")
            interface = edge.get("interface")
            reason = edge.get("reason")
            if not _non_empty_string(source) or str(source) not in services:
                issues.append(_issue("delta.edge.source", f"{path}.from", f"Unknown source service {source!r}."))
            if not _non_empty_string(target) or str(target) not in known_nodes:
                issues.append(_issue("delta.edge.target", f"{path}.to", f"Unknown edge target {target!r}."))
            if source == target and _non_empty_string(source):
                issues.append(_issue("delta.edge.self", path, "Self dependency edges are not allowed."))
            if not _non_empty_string(interface):
                issues.append(_issue("delta.edge.interface", f"{path}.interface", "interface must be non-empty."))
            if not _non_empty_string(reason):
                issues.append(_issue("delta.edge.reason", f"{path}.reason", "reason must be non-empty."))
            edge_key = (str(source), str(target), str(interface), field)
            if edge_key in seen_edges:
                issues.append(_issue("delta.edge.duplicate", path, f"Duplicate dependency edge {source!r} -> {target!r} via {interface!r}."))
            seen_edges.add(edge_key)

            if field == "added_dependency_edges" and all(
                _non_empty_string(value) for value in (source, target, interface)
            ):
                if (str(source), str(target), str(interface)) not in allowed_edges:
                    issues.append(
                        _issue(
                            "delta.edge.not_allowed",
                            path,
                            f"Desired architecture does not allow {source!r} -> {target!r} via {interface!r}.",
                        )
                    )

    public_changes = _list_of_mappings(delta.get("public_contract_changes"))
    if public_changes is None:
        issues.append(_issue("delta.public_contract_changes.type", "$.public_contract_changes", "public_contract_changes must be an array."))
        public_changes = []
    if public_changes:
        architecture_change_present = True
    breaking_change = False
    for index, change in enumerate(public_changes):
        path = f"$.public_contract_changes[{index}]"
        if change.get("change_type") not in {"none", "additive", "breaking"}:
            issues.append(_issue("delta.public.change_type", f"{path}.change_type", "change_type must be none, additive, or breaking."))
        if change.get("change_type") == "breaking":
            breaking_change = True
        for field in ("contract", "description"):
            if not _non_empty_string(change.get(field)):
                issues.append(_issue(f"delta.public.{field}", f"{path}.{field}", f"{field} must be non-empty."))

    owner_by_capability: dict[str, str] = {}
    for service_id, service in services.items():
        for capability in _string_list(service.get("owns")) or []:
            owner_by_capability[capability] = service_id

    ownership_changes = _list_of_mappings(delta.get("data_ownership_changes"))
    if ownership_changes is None:
        issues.append(_issue("delta.data_ownership_changes.type", "$.data_ownership_changes", "data_ownership_changes must be an array."))
        ownership_changes = []
    if ownership_changes:
        architecture_change_present = True
    for index, change in enumerate(ownership_changes):
        path = f"$.data_ownership_changes[{index}]"
        capability = change.get("capability")
        from_owner = change.get("from_owner")
        to_owner = change.get("to_owner")
        if not _non_empty_string(capability):
            issues.append(_issue("delta.ownership.capability", f"{path}.capability", "capability must be non-empty."))
        elif owner_by_capability.get(str(capability)) != from_owner:
            issues.append(
                _issue(
                    "delta.ownership.from_owner",
                    f"{path}.from_owner",
                    f"Declared from_owner {from_owner!r} does not own capability {capability!r} in the desired contract.",
                )
            )
        if not _non_empty_string(to_owner) or str(to_owner) not in services:
            issues.append(_issue("delta.ownership.to_owner", f"{path}.to_owner", f"Unknown to_owner {to_owner!r}."))
        if from_owner == to_owner and _non_empty_string(from_owner):
            issues.append(_issue("delta.ownership.same_owner", path, "Ownership change must move between different owners."))
        if not _non_empty_string(change.get("reason")):
            issues.append(_issue("delta.ownership.reason", f"{path}.reason", "reason must be non-empty."))

    state_changes = _list_of_mappings(delta.get("state_machine_changes"))
    if state_changes is None:
        issues.append(_issue("delta.state_machine_changes.type", "$.state_machine_changes", "state_machine_changes must be an array."))
        state_changes = []
    if state_changes:
        architecture_change_present = True
    for index, change in enumerate(state_changes):
        path = f"$.state_machine_changes[{index}]"
        if change.get("change_type") not in {"additive", "behavioral", "breaking"}:
            issues.append(_issue("delta.state.change_type", f"{path}.change_type", "Unsupported state-machine change type."))
        for field in ("machine", "description"):
            if not _non_empty_string(change.get(field)):
                issues.append(_issue(f"delta.state.{field}", f"{path}.{field}", f"{field} must be non-empty."))
        if change.get("change_type") == "breaking":
            breaking_change = True

    invariants = _invariant_index(contract)
    exception_policy = contract.get("exception_policy") if _is_mapping(contract.get("exception_policy")) else {}
    max_days = exception_policy.get("maximum_days", 90)
    exceptions = _list_of_mappings(delta.get("exceptions"))
    if exceptions is None:
        issues.append(_issue("delta.exceptions.type", "$.exceptions", "exceptions must be an array."))
        exceptions = []
    if exceptions:
        architecture_change_present = True
    for index, exception in enumerate(exceptions):
        path = f"$.exceptions[{index}]"
        invariant_id = exception.get("invariant_id")
        if not _non_empty_string(invariant_id) or str(invariant_id) not in invariants:
            issues.append(_issue("delta.exception.invariant", f"{path}.invariant_id", f"Unknown invariant {invariant_id!r}."))
        for field in ("owner", "reason", "adr"):
            if not _non_empty_string(exception.get(field)):
                issues.append(_issue(f"delta.exception.{field}", f"{path}.{field}", f"{field} must be non-empty."))
        adr = exception.get("adr")
        if _non_empty_string(adr) and not str(adr).lower().endswith(".md"):
            issues.append(_issue("delta.exception.adr_extension", f"{path}.adr", "ADR reference must point to a Markdown file."))
        created = _parse_iso_date(exception.get("created_on"))
        expires = _parse_iso_date(exception.get("expires_on"))
        if created is None:
            issues.append(_issue("delta.exception.created_on", f"{path}.created_on", "created_on must be an ISO date."))
        if expires is None:
            issues.append(_issue("delta.exception.expires_on", f"{path}.expires_on", "expires_on must be an ISO date."))
        if created is not None and expires is not None:
            if expires <= created:
                issues.append(_issue("delta.exception.date_order", path, "expires_on must be later than created_on."))
            if isinstance(max_days, int) and (expires - created).days > max_days:
                issues.append(
                    _issue(
                        "delta.exception.too_long",
                        path,
                        f"Exception duration exceeds the {max_days}-day policy.",
                    )
                )
            if expires < today:
                issues.append(
                    _issue(
                        "delta.exception.expired",
                        f"{path}.expires_on",
                        f"Architecture exception expired on {expires.isoformat()}.",
                    )
                )

    if lane in {"F", "B"} and architecture_change_present:
        issues.append(
            _issue(
                "delta.lane.insufficient",
                "$.lane",
                "Architecture-affecting deltas require Lane G or Lane S.",
            )
        )

    approval = delta.get("approval")
    requires_approval = breaking_change or bool(ownership_changes) or bool(exceptions)
    if not _is_mapping(approval):
        issues.append(_issue("delta.approval.type", "$.approval", "approval must be an object."))
    else:
        declared_required = approval.get("required")
        status = approval.get("status")
        if not isinstance(declared_required, bool):
            issues.append(_issue("delta.approval.required", "$.approval.required", "required must be boolean."))
        elif requires_approval and not declared_required:
            issues.append(
                _issue(
                    "delta.approval.required_false",
                    "$.approval.required",
                    "Breaking, ownership, or exception changes require explicit approval.",
                )
            )
        if declared_required is True and status != "approved":
            issues.append(
                _issue(
                    "delta.approval.not_approved",
                    "$.approval.status",
                    "A required architecture approval must have status=approved before validation can pass.",
                )
            )
        if declared_required is False and status != "not-required":
            issues.append(
                _issue(
                    "delta.approval.status",
                    "$.approval.status",
                    "When approval is not required, status must be not-required.",
                )
            )
        if status == "approved":
            if not _non_empty_string(approval.get("approved_by")):
                issues.append(_issue("delta.approval.approved_by", "$.approval.approved_by", "approved_by is required for approved status."))
            approved_at = approval.get("approved_at")
            if not _non_empty_string(approved_at):
                issues.append(_issue("delta.approval.approved_at", "$.approval.approved_at", "approved_at is required for approved status."))
            else:
                try:
                    datetime.fromisoformat(str(approved_at).replace("Z", "+00:00"))
                except ValueError:
                    issues.append(_issue("delta.approval.approved_at_format", "$.approval.approved_at", "approved_at must be ISO date-time."))

    return sorted(issues, key=lambda item: (item.severity, item.path, item.code, item.message))


def _load_json(path: Path) -> tuple[Any | None, list[ValidationIssue]]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return None, [_issue("file.read", str(path), f"Cannot read file: {exc}")]
    try:
        return json.loads(text), []
    except json.JSONDecodeError as exc:
        return None, [
            _issue(
                "json.parse",
                str(path),
                f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}",
            )
        ]


def validate_repository(repo_root: str | Path, *, today: date | None = None) -> RepositoryValidationResult:
    """Validate the canonical contract, schemas, and every committed delta."""

    root = Path(repo_root).resolve()
    architecture_root = root / "architecture"
    contract_path = architecture_root / "architecture-contract.json"
    schema_paths = (
        architecture_root / "architecture-contract.schema.json",
        architecture_root / "architecture-delta.schema.json",
    )
    delta_root = architecture_root / "deltas"

    issues: list[ValidationIssue] = []
    checked: list[str] = []
    schemas: dict[str, Mapping[str, Any]] = {}

    for schema_path in schema_paths:
        relative = schema_path.relative_to(root).as_posix()
        checked.append(relative)
        schema, schema_issues = _load_json(schema_path)
        issues.extend(schema_issues)
        if schema is not None and not _is_mapping(schema):
            issues.append(_issue("schema.type", relative, "Schema document must be a JSON object."))
        elif _is_mapping(schema) and schema.get("type") != "object":
            issues.append(_issue("schema.root_type", relative, "Schema root type must be object."))
        elif _is_mapping(schema):
            schemas[schema_path.name] = schema

    contract_relative = contract_path.relative_to(root).as_posix()
    checked.append(contract_relative)
    contract, contract_issues = _load_json(contract_path)
    issues.extend(contract_issues)
    if contract is not None:
        contract_schema = schemas.get("architecture-contract.schema.json")
        if contract_schema is not None:
            issues.extend(
                ValidationIssue(
                    code=issue.code,
                    path=f"{contract_relative}:{issue.path}",
                    message=issue.message,
                    severity=issue.severity,
                )
                for issue in validate_schema_instance(contract, contract_schema)
            )
        issues.extend(validate_contract(contract))

    if not delta_root.is_dir():
        issues.append(_issue("delta.directory_missing", "architecture/deltas", "architecture/deltas directory is required."))
    elif contract is not None and _is_mapping(contract):
        delta_paths = sorted(delta_root.glob("*.json"))
        if not delta_paths:
            issues.append(_issue("delta.none", "architecture/deltas", "At least one architecture delta is required."))
        for delta_path in delta_paths:
            relative = delta_path.relative_to(root).as_posix()
            checked.append(relative)
            delta, delta_issues = _load_json(delta_path)
            issues.extend(delta_issues)
            if delta is not None:
                delta_schema = schemas.get("architecture-delta.schema.json")
                if delta_schema is not None:
                    issues.extend(
                        ValidationIssue(
                            code=issue.code,
                            path=f"{relative}:{issue.path}",
                            message=issue.message,
                            severity=issue.severity,
                        )
                        for issue in validate_schema_instance(delta, delta_schema)
                    )
                issues.extend(
                    ValidationIssue(
                        code=issue.code,
                        path=f"{relative}:{issue.path}",
                        message=issue.message,
                        severity=issue.severity,
                    )
                    for issue in validate_delta(delta, contract, today=today)
                )

    unique_issues = sorted(
        set(issues),
        key=lambda item: (item.severity, item.path, item.code, item.message),
    )
    return RepositoryValidationResult(
        repo_root=str(root),
        checked_files=tuple(sorted(set(checked))),
        issues=tuple(unique_issues),
    )
