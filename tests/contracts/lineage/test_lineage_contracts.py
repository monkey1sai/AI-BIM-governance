"""Executable contract tests for the ``rvt-ifc-usdc-lineage`` schemas.

Covers ``openspec/changes/rvt-ifc-usdc-lineage/tasks.md`` 2.1-2.5 and the
document half of 2.7: the five lineage JSON Schemas plus the two promoted
``cloud-lineage-publication`` schemas under ``tests/contracts/``, their
fixture corpus under ``tests/contracts/lineage/fixtures/``, the semantic
invariants JSON Schema cannot express, and the boundary between the new
source-bundle intake and the two frozen legacy contracts.

The wire/transport half of 2.6 and 2.7 -- HMAC, the signature timestamp
header, skew, ACK classification, the nine HTTP/code/retryable triples --
lives next door in ``test_cloud_publication_protocol.py``.

Run with::

    .\\.venv\\Scripts\\python.exe -m pytest tests/contracts/lineage -q -p no:cacheprovider

CI job: ``root contracts and fakes`` in ``.github/workflows/ci.yml``. That job
installs ``pytest`` and ``jsonschema`` and nothing else, so this module imports
only the standard library plus those two.

Two structural notes:

* The lineage contract directory intentionally ships no ``__init__.py``
  (blueprint E-6), so ``semantic_validators.py`` is loaded through
  ``importlib.util.spec_from_file_location`` rather than as a package member.
* Validators are built **without** a ``format_checker``. ``format: date-time``
  stays an annotation and every timestamp rejection is carried by ``pattern``,
  which is what task 2.6 depends on.
* ``cloud_lineage_publication`` is the one contract with **two** schemas, a
  request envelope and a response body, behind a single fixture directory.
  Fixtures are routed by content through
  ``semantic_validators.cloud_publication_direction``; see
  :func:`_validator_for`.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterator

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_HERE = Path(__file__).resolve().parent            # tests/contracts/lineage
_CONTRACTS_DIR = _HERE.parent                      # tests/contracts
_REPO_ROOT = _CONTRACTS_DIR.parent.parent          # repository root
_FIXTURES_DIR = _HERE / "fixtures"
_EXPECTATIONS_PATH = _HERE / "expectations.json"
_ROUNDTRIP_TABLE_PATH = _HERE / "roundtrip_truth_table.json"
_SEMANTIC_VALIDATORS_PATH = _HERE / "semantic_validators.py"

_CHANGE_CONTRACTS_DIR = (
    _REPO_ROOT / "openspec" / "changes" / "rvt-ifc-usdc-lineage" / "contracts"
)
_CLOUD_REQUEST_SCHEMA_PATH = (
    _CHANGE_CONTRACTS_DIR / "cloud-lineage-publication-request-v1.schema.json"
)
_CLOUD_RESPONSE_SCHEMA_PATH = (
    _CHANGE_CONTRACTS_DIR / "cloud-lineage-publication-response-v1.schema.json"
)
_CLOUD_PUBLISHED_EXAMPLE_PATH = (
    _CHANGE_CONTRACTS_DIR / "examples" / "valid-lineage-result-published.json"
)

_LEGACY_IFC_READY_PATH = _CONTRACTS_DIR / "ifc_ready_payload.json"
_LEGACY_CALLBACK_PATH = _CONTRACTS_DIR / "conversion_result_callback.json"

#: The 2.5 contract, promoted out of the change directory. It is the only
#: contract with two schemas -- a request envelope and a response body --
#: behind one fixture directory, so it is named separately everywhere the
#: "one contract, one schema file" assumption would otherwise hold.
CLOUD_CONTRACT = "cloud_lineage_publication"

#: contract name -> fixture directory, in tasks.md order
#: (2.1, 2.2, 2.3, 2.3, 2.4, 2.5).
CONTRACTS = (
    "model_version_bundle_manifest",
    "lineage_alignment_report",
    "pipeline_job_attempt",
    "result_manifest",
    "source_bundle_ready",
    CLOUD_CONTRACT,
)

#: The contracts whose schema file is ``<contract>.json`` (naming decision E-1).
SINGLE_SCHEMA_CONTRACTS = tuple(
    contract for contract in CONTRACTS if contract != CLOUD_CONTRACT
)

#: direction -> promoted schema filename. These two keep the change's own
#: ``cloud-lineage-publication-<direction>-v1.schema.json`` spelling rather
#: than the E-1 snake_case style: they are byte-identical promotions of the
#: change originals, and the matching filename is what lets
#: :func:`test_promoted_cloud_schemas_are_byte_equal_to_the_change_originals`
#: read as a provenance claim instead of as a rename.
CLOUD_SCHEMA_FILES = {
    "request": "cloud-lineage-publication-request-v1.schema.json",
    "response": "cloud-lineage-publication-response-v1.schema.json",
}

#: tasks.md 2.7: "三個valid request fixture event IDs互異". These three are the
#: request-direction examples the change shipped. The other three valid
#: request fixtures are deliberate *variants of the same event* -- a second
#: health transition, a 64-code summary, a zero-denominator summary -- and
#: reuse those event IDs on purpose, so the distinctness claim names the
#: three it is actually about instead of quantifying over the directory.
CLOUD_DISTINCT_EVENT_ID_FIXTURES = (
    "valid-lineage-result-published.json",
    "valid-lineage-result-health-changed.json",
    "valid-lineage-result-tombstoned.json",
)

#: Fixture floors, per contract: (valid, invalid, semantic). Blueprint E-13.
#: The numbers are the corpus as landed; they are a ratchet, never a target.
FIXTURE_MINIMUMS = {
    "model_version_bundle_manifest": (9, 30, 8),
    "lineage_alignment_report": (6, 48, 24),
    "pipeline_job_attempt": (27, 54, 9),
    "result_manifest": (15, 38, 6),
    "source_bundle_ready": (2, 13, 0),
    CLOUD_CONTRACT: (10, 41, 22),
}

#: Tokens the two frozen legacy contracts must never learn about.
LINEAGE_TOKENS = (
    "source_bundle_ready",
    "lineage_result_published",
    "lineage_result_health_changed",
    "cloud-lineage-publication",
)


# ---------------------------------------------------------------------------
# semantic_validators.py, loaded without a package (blueprint E-6)
# ---------------------------------------------------------------------------


def _load_semantic_validators():
    spec = importlib.util.spec_from_file_location(
        "lineage_semantic_validators", _SEMANTIC_VALIDATORS_PATH
    )
    if spec is None or spec.loader is None:
        raise ImportError(
            f"cannot build a module spec for {_SEMANTIC_VALIDATORS_PATH}; "
            "the lineage contract directory ships no __init__.py on purpose, "
            "so the file must be loadable by path"
        )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


semantic_validators = _load_semantic_validators()


# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_schema(contract: str) -> dict:
    return _read_json(_CONTRACTS_DIR / f"{contract}.json")


_SCHEMAS = {
    contract: _load_schema(contract) for contract in SINGLE_SCHEMA_CONTRACTS
}
_VALIDATORS = {
    contract: Draft202012Validator(schema) for contract, schema in _SCHEMAS.items()
}

#: direction -> promoted cloud schema / validator (task 2.5).
_CLOUD_SCHEMAS = {
    direction: _read_json(_CONTRACTS_DIR / filename)
    for direction, filename in CLOUD_SCHEMA_FILES.items()
}
_CLOUD_VALIDATORS = {
    direction: Draft202012Validator(schema)
    for direction, schema in _CLOUD_SCHEMAS.items()
}

#: Every schema document this module owns, keyed by a stable id: the five
#: single-schema contracts keep their contract name, the two cloud schemas
#: are ``cloud_lineage_publication/request`` and ``.../response``. The
#: schema-health tests walk this map, so the promoted schemas get exactly the
#: same treatment as the five that landed with 2.1-2.4.
SCHEMA_DOCUMENTS = {
    **_SCHEMAS,
    **{
        f"{CLOUD_CONTRACT}/{direction}": schema
        for direction, schema in _CLOUD_SCHEMAS.items()
    },
}


def _validator_for(contract: str, document: Any) -> Draft202012Validator:
    """Return the validator that owns ``document`` for ``contract``.

    Every contract but ``cloud_lineage_publication`` has exactly one schema.
    The cloud publication fixtures share one directory across a request
    envelope and a response body, so the direction is derived from the
    document itself. ``cloud_publication_direction`` keys on the *presence*
    of ``schema_version``, which both response bodies are closed against, so
    a fixture that deliberately breaks the ``schema_version`` ``const`` still
    routes to the request schema.
    """
    if contract != CLOUD_CONTRACT:
        return _VALIDATORS[contract]
    direction = semantic_validators.cloud_publication_direction(document)
    return _CLOUD_VALIDATORS[direction]


def _fixture_paths(contract: str, kind: str) -> list[Path]:
    directory = _FIXTURES_DIR / contract / kind
    if not directory.is_dir():
        return []
    return sorted(directory.glob("*.json"))


def _fixture_params(kind: str) -> list:
    params = []
    for contract in CONTRACTS:
        for path in _fixture_paths(contract, kind):
            params.append(pytest.param(contract, path, id=f"{contract}/{path.name}"))
    return params


VALID_FIXTURES = _fixture_params("valid")
INVALID_FIXTURES = _fixture_params("invalid")
SEMANTIC_FIXTURES = _fixture_params("semantic")


# ---------------------------------------------------------------------------
# expectations.json
# ---------------------------------------------------------------------------


def _load_expectations() -> dict[str, dict]:
    """Return expectations keyed by ``<contract>/<file>``.

    The three fixture drafts were merged verbatim, so the stored keys are not
    uniform: one of them writes ``<contract>/invalid/<file>``. The optional
    ``invalid/`` segment is normalised away here rather than by rewriting the
    file, and a collision is a hard error rather than a silent overwrite.
    """
    raw = _read_json(_EXPECTATIONS_PATH)
    normalised: dict[str, dict] = {}
    for key, value in raw.items():
        parts = key.split("/")
        if len(parts) == 3 and parts[1] == "invalid":
            lookup = f"{parts[0]}/{parts[2]}"
        else:
            lookup = key
        if lookup in normalised:
            raise AssertionError(
                f"expectations.json: {key!r} normalises to {lookup!r}, which is "
                "already claimed by another entry"
            )
        normalised[lookup] = value
    return normalised


EXPECTATIONS = _load_expectations()


def _invalid_fixture_keys() -> Iterator[tuple[str, Path, str]]:
    """Yield ``(contract, path, expectations key)`` for every negative fixture."""
    for contract in CONTRACTS:
        for path in _fixture_paths(contract, "invalid"):
            yield contract, path, f"{contract}/{path.name}"


# ---------------------------------------------------------------------------
# Deterministic "first error" rule
# ---------------------------------------------------------------------------
#
# `jsonschema.best_match` is not usable here: with a discriminated `oneOf` it
# falls back to the parent `oneOf` error whenever two leaves sit at the same
# depth, which points expectations at the union instead of the offending field.
# The rule below is the one the fixture drafts recorded their expectations
# with, and it must stay verbatim:
#
#   1. flatten the error tree to leaves (recursively expand `err.context`);
#   2. drop boolean-schema leaves (`err.validator is None`) -- those are the
#      `"else": false` discriminator rejections of the non-matching `oneOf`
#      branches and are never the real cause;
#   3. take the deepest instance path; on a tie sort by instance path, then by
#      schema path, and take the first.


def _json_pointer(parts) -> str:
    """RFC 6901 pointer for a jsonschema path deque."""
    return "".join(
        "/" + str(part).replace("~", "~0").replace("/", "~1") for part in parts
    )


def _flatten_leaf_errors(errors) -> Iterator[ValidationError]:
    for error in errors:
        if error.context:
            yield from _flatten_leaf_errors(error.context)
        else:
            yield error


def deterministic_leaf_error(errors) -> ValidationError | None:
    """Return the single leaf error the expectations table records."""
    leaves = [
        error
        for error in _flatten_leaf_errors(errors)
        if error.validator is not None
    ]
    if not leaves:
        return None
    deepest = max(len(error.absolute_path) for error in leaves)
    candidates = [error for error in leaves if len(error.absolute_path) == deepest]
    candidates.sort(
        key=lambda error: (
            _json_pointer(error.absolute_path),
            _json_pointer(error.absolute_schema_path),
        )
    )
    return candidates[0]


# ---------------------------------------------------------------------------
# Schema health
# ---------------------------------------------------------------------------

#: Keywords whose value is a map of subschemas.
_SUBSCHEMA_MAPS = ("properties", "$defs", "definitions", "patternProperties",
                   "dependentSchemas")
#: Keywords whose value is a list of subschemas.
_SUBSCHEMA_LISTS = ("allOf", "anyOf", "oneOf", "prefixItems")
#: Keywords whose value is a single subschema.
_SUBSCHEMA_SINGLES = ("items", "additionalProperties", "unevaluatedProperties",
                      "contains", "if", "then", "else", "not", "propertyNames")
#: Applicators that constrain only *part* of an instance. A subschema reached
#: through one of these is a predicate, not an object definition, so closing it
#: with ``additionalProperties: false`` would reject the sibling members the
#: enclosing definition legitimately allows.
_PARTIAL_APPLICATORS = frozenset(
    {"if", "then", "else", "not", "contains", "propertyNames"}
)
#: Applicators whose *direct* branches narrow an already-closed definition.
#: A bare branch -- ``properties`` with neither an object ``type`` nor a
#: ``$ref`` sibling -- is the list form of the ``$ref``-sibling exemption
#: below: what it narrows is the enclosing definition, which already closed
#: itself, so closing the branch too would reject that definition's other
#: legitimate members. The flag applies to the branch only, never to its
#: descendants, and ``prefixItems`` is deliberately absent -- its entries are
#: whole item definitions, not narrowings of a shared one.
_LIST_NARROWING_APPLICATORS = frozenset({"allOf", "anyOf", "oneOf"})

#: Escape hatch for nodes that genuinely must stay open. Empty today: every
#: exception in the five contracts is structural (a partial applicator, or a
#: ``$ref`` sibling whose closure lives in the referenced ``$def``) and is
#: handled by the walker rather than by name. Any entry added here needs a
#: written reason next to it.
_OPEN_OBJECT_WHITELIST: dict[str, str] = {}


def _walk_subschemas(
    node: Any, pointer: str = "", partial: bool = False, narrowing: bool = False
):
    """Yield ``(pointer, subschema, partial, narrowing)`` per object subschema.

    ``narrowing`` is true only for a *direct* branch of ``allOf`` / ``anyOf``
    / ``oneOf``; it is reset for that branch's own descendants.
    """
    if not isinstance(node, dict):
        return
    yield pointer, node, partial, narrowing
    for keyword, child in node.items():
        if keyword in _SUBSCHEMA_MAPS and isinstance(child, dict):
            for name, sub in child.items():
                escaped = str(name).replace("~", "~0").replace("/", "~1")
                yield from _walk_subschemas(
                    sub, f"{pointer}/{keyword}/{escaped}", partial
                )
        elif keyword in _SUBSCHEMA_LISTS and isinstance(child, list):
            for index, sub in enumerate(child):
                yield from _walk_subschemas(
                    sub,
                    f"{pointer}/{keyword}/{index}",
                    partial,
                    keyword in _LIST_NARROWING_APPLICATORS,
                )
        elif keyword in _SUBSCHEMA_SINGLES:
            yield from _walk_subschemas(
                child,
                f"{pointer}/{keyword}",
                partial or keyword in _PARTIAL_APPLICATORS,
            )


def _declares_object(node: dict) -> bool:
    declared = node.get("type")
    return declared == "object" or (
        isinstance(declared, list) and "object" in declared
    )


def _strip_annotations(node: Any) -> Any:
    """Drop ``$comment`` recursively.

    E-4 requires the shared ``$defs`` to be copied verbatim into every
    contract. ``$comment`` is annotation-only prose explaining *why this file
    carries the copy*, so it is per-file by design; every constraint keyword is
    still compared byte-for-byte.
    """
    if isinstance(node, dict):
        return {
            key: _strip_annotations(value)
            for key, value in node.items()
            if key != "$comment"
        }
    if isinstance(node, list):
        return [_strip_annotations(item) for item in node]
    return node


@pytest.mark.parametrize("schema_id", sorted(SCHEMA_DOCUMENTS))
def test_schema_is_valid_draft_2020_12(schema_id: str):
    schema = SCHEMA_DOCUMENTS[schema_id]
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert list(schema)[:4] == ["$schema", "$id", "title", "description"], (
        f"{schema_id}: header keys must lead with $schema/$id/title/description"
    )
    Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize("schema_id", sorted(SCHEMA_DOCUMENTS))
def test_object_schemas_close_additional_properties(schema_id: str):
    """Every closed object definition must set ``additionalProperties: false``."""
    schema = SCHEMA_DOCUMENTS[schema_id]
    open_objects: list[str] = []
    unclassified: list[str] = []

    for pointer, node, partial, narrowing in _walk_subschemas(schema):
        if partial or "properties" not in node:
            continue
        if "$ref" in node:
            # A `$ref` sibling narrows an already-closed definition; the
            # closure belongs to the referenced $def, not to this node.
            continue
        if pointer in _OPEN_OBJECT_WHITELIST:
            continue
        if not _declares_object(node):
            if narrowing:
                # A bare `allOf`/`anyOf`/`oneOf` branch: same exemption as a
                # `$ref` sibling, in list form. It narrows the enclosing
                # definition, which owns the closure.
                continue
            unclassified.append(pointer)
            continue
        if node.get("additionalProperties") is not False:
            open_objects.append(pointer)

    assert not unclassified, (
        f"{schema_id}: subschemas declare `properties` without an object "
        f"`type`, so their closure cannot be checked: {unclassified}"
    )
    assert not open_objects, (
        f"{schema_id}: object definitions missing `additionalProperties: "
        f"false`: {open_objects}"
    )


@pytest.mark.parametrize("schema_id", sorted(SCHEMA_DOCUMENTS))
def test_utc_timestamp_defs_carry_pattern_and_format(schema_id: str):
    """``pattern`` does the rejecting; ``format`` stays as the annotation."""
    defs = SCHEMA_DOCUMENTS[schema_id].get("$defs", {})
    timestamp_defs = {
        name: definition
        for name, definition in defs.items()
        if "timestamp" in name.lower() or definition.get("format") == "date-time"
    }
    assert timestamp_defs, f"{schema_id}: no timestamp $def found"
    for name, definition in timestamp_defs.items():
        assert definition.get("format") == "date-time", (
            f"{schema_id}.$defs.{name}: expected format: date-time"
        )
        assert "pattern" in definition, (
            f"{schema_id}.$defs.{name}: no format_checker is installed, so the "
            "pattern must carry the UTC rejection on its own"
        )
        pattern = definition["pattern"]
        assert pattern.endswith("Z$"), (
            f"{schema_id}.$defs.{name}: pattern must pin a literal uppercase Z"
        )


def test_shared_defs_are_deep_equal_across_contracts():
    """E-4: the copied ``$defs`` must not drift between the schema documents.

    Scope grew with 2.5: the two promoted cloud schemas are compared on the
    same footing as the five 2.1-2.4 contracts, so a copy cannot drift on the
    request/response side either.
    """
    holders: dict[str, list[str]] = {}
    for schema_id, schema in SCHEMA_DOCUMENTS.items():
        for name in schema.get("$defs", {}):
            holders.setdefault(name, []).append(schema_id)

    shared = {
        name: holder for name, holder in holders.items() if len(holder) > 1
    }
    assert {"utcTimestamp", "sha256", "locator", "uuid"} <= set(shared), (
        f"expected the identity/locator defs to be shared; got {sorted(shared)}"
    )
    assert shared["utcTimestamp"] == list(SCHEMA_DOCUMENTS), (
        "utcTimestamp must be present in every schema document, including "
        "both cloud directions"
    )

    drifted: dict[str, list[str]] = {}
    for name, holder in sorted(shared.items()):
        variants = [
            _strip_annotations(SCHEMA_DOCUMENTS[schema_id]["$defs"][name])
            for schema_id in holder
        ]
        if any(variant != variants[0] for variant in variants):
            drifted[name] = holder
    assert not drifted, f"shared $defs drifted between schemas: {drifted}"


@pytest.mark.skipif(
    not _CLOUD_REQUEST_SCHEMA_PATH.exists(),
    reason=f"change contract not present: {_CLOUD_REQUEST_SCHEMA_PATH}",
)
def test_shared_defs_match_cloud_request_schema():
    """E-12: the copies must equal the cloud publication request originals."""
    cloud_defs = _read_json(_CLOUD_REQUEST_SCHEMA_PATH).get("$defs", {})
    compared = 0
    drifted: list[str] = []
    for contract in SINGLE_SCHEMA_CONTRACTS:
        for name, definition in _SCHEMAS[contract].get("$defs", {}).items():
            if name not in cloud_defs:
                continue
            compared += 1
            if _strip_annotations(definition) != _strip_annotations(cloud_defs[name]):
                drifted.append(f"{contract}.$defs.{name}")
    assert compared >= 5, (
        f"expected at least the five shared defs to be compared; compared {compared}"
    )
    assert not drifted, f"lineage copies drifted from the cloud originals: {drifted}"


# ---------------------------------------------------------------------------
# Fixture corpus
# ---------------------------------------------------------------------------


def test_fixture_minimum_counts():
    """E-13: per-contract fixture floors, as a ratchet against silent shrinkage."""
    shortfalls: list[str] = []
    for contract, (valid, invalid, semantic) in FIXTURE_MINIMUMS.items():
        observed = (
            len(_fixture_paths(contract, "valid")),
            len(_fixture_paths(contract, "invalid")),
            len(_fixture_paths(contract, "semantic")),
        )
        for kind, floor, actual in zip(
            ("valid", "invalid", "semantic"), (valid, invalid, semantic), observed
        ):
            if actual < floor:
                shortfalls.append(f"{contract}/{kind}: {actual} < {floor}")
    assert not shortfalls, f"fixture corpus shrank: {shortfalls}"


@pytest.mark.parametrize(("contract", "fixture_path"), VALID_FIXTURES)
def test_valid_fixture_passes_schema(contract: str, fixture_path: Path):
    document = _read_json(fixture_path)
    errors = sorted(_validator_for(contract, document).iter_errors(document), key=str)
    assert not errors, (
        f"{contract}/{fixture_path.name} must satisfy the schema; got: "
        + "; ".join(
            f"{_json_pointer(error.absolute_path) or '(root)'}: "
            f"{error.validator}: {error.message}"
            for error in errors
        )
    )


@pytest.mark.parametrize(("contract", "fixture_path"), INVALID_FIXTURES)
def test_invalid_fixture_fails_schema(contract: str, fixture_path: Path):
    document = _read_json(fixture_path)
    errors = list(_validator_for(contract, document).iter_errors(document))
    assert errors, (
        f"{contract}/{fixture_path.name} passed validation; either the fixture "
        "is no longer invalid or the schema stopped enforcing the rule it targets"
    )


@pytest.mark.parametrize(("contract", "fixture_path"), INVALID_FIXTURES)
def test_invalid_fixture_hits_expected_violation(contract: str, fixture_path: Path):
    """Each negative fixture must fail on the rule its expectation names."""
    key = f"{contract}/{fixture_path.name}"
    assert key in EXPECTATIONS, (
        f"{key} has no entry in expectations.json; a negative fixture without a "
        "declared target rule cannot prove which rule it exercises"
    )
    expectation = EXPECTATIONS[key]

    document = _read_json(fixture_path)
    errors = list(_validator_for(contract, document).iter_errors(document))
    leaf = deterministic_leaf_error(errors)
    assert leaf is not None, f"{key}: no non-boolean leaf error was produced"

    observed = {
        "keyword": leaf.validator,
        "instance_pointer": _json_pointer(leaf.absolute_path),
    }
    assert observed == {
        "keyword": expectation["keyword"],
        "instance_pointer": expectation["instance_pointer"],
    }, (
        f"{key}: expected {expectation['keyword']} @ "
        f"{expectation['instance_pointer'] or '(root)'}, got "
        f"{observed['keyword']} @ {observed['instance_pointer'] or '(root)'} "
        f"({leaf.message})"
    )


def test_every_invalid_fixture_is_covered_by_expectations():
    """No orphan expectations, no undeclared negative fixtures."""
    fixture_keys = {key for _contract, _path, key in _invalid_fixture_keys()}
    assert fixture_keys == set(EXPECTATIONS), (
        "expectations.json and the invalid fixtures disagree:\n"
        f"  only_in_fixtures={sorted(fixture_keys - set(EXPECTATIONS))}\n"
        f"  only_in_expectations={sorted(set(EXPECTATIONS) - fixture_keys)}"
    )


# ---------------------------------------------------------------------------
# Task 2.4 boundary: the new intake must not become a second authority
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not _CLOUD_PUBLISHED_EXAMPLE_PATH.exists(),
    reason=f"change example not present: {_CLOUD_PUBLISHED_EXAMPLE_PATH}",
)
def test_source_bundle_ready_rejects_cloud_publication_example():
    """A cloud publication event is not a producer intake claim."""
    document = _read_json(_CLOUD_PUBLISHED_EXAMPLE_PATH)
    errors = list(_VALIDATORS["source_bundle_ready"].iter_errors(document))
    assert errors, (
        "source_bundle_ready.json accepted a cloud lineage publication event; "
        "the intake contract would then be a second publication authority"
    )
    leaf = deterministic_leaf_error(errors)
    assert leaf is not None and leaf.validator == "additionalProperties", (
        f"expected the cloud-only members to be rejected as additional "
        f"properties, got {leaf.validator if leaf else None}"
    )


@pytest.mark.skipif(
    not _CLOUD_REQUEST_SCHEMA_PATH.exists(),
    reason=f"change contract not present: {_CLOUD_REQUEST_SCHEMA_PATH}",
)
def test_cloud_request_schema_rejects_source_bundle_ready_example():
    """And the reverse: an intake claim is not a publication request."""
    validator = Draft202012Validator(_read_json(_CLOUD_REQUEST_SCHEMA_PATH))
    document = _read_json(
        _FIXTURES_DIR
        / "source_bundle_ready"
        / "valid"
        / "valid-source-bundle-ready-minimal.json"
    )
    assert list(validator.iter_errors(document)), (
        "the cloud publication request schema accepted a source_bundle_ready "
        "claim; the two directions would no longer be distinguishable"
    )


def test_legacy_ifc_ready_contract_is_frozen():
    contract = _read_json(_LEGACY_IFC_READY_PATH)
    assert contract["contract_version"] == "1.1.0"
    assert contract["transport"]["path"] == "/api/external/ifc-ready"


def test_legacy_callback_contract_is_frozen():
    contract = _read_json(_LEGACY_CALLBACK_PATH)
    assert contract["contract_version"] == "1.0.0"
    assert set(contract["events"]) == {"conversion_result_ready", "conversion_failed"}


@pytest.mark.parametrize(
    "legacy_path",
    (_LEGACY_IFC_READY_PATH, _LEGACY_CALLBACK_PATH),
    ids=lambda path: path.name,
)
def test_legacy_contracts_contain_no_lineage_tokens(legacy_path: Path):
    """The lineage change is additive; it must not edit the frozen contracts."""
    text = legacy_path.read_text(encoding="utf-8")
    leaked = [token for token in LINEAGE_TOKENS if token in text]
    assert not leaked, (
        f"{legacy_path.name} mentions lineage tokens {leaked}; the frozen "
        "contract must stay untouched by this change"
    )


# ---------------------------------------------------------------------------
# Semantic layer
# ---------------------------------------------------------------------------

#: contract -> the semantic entry point that owns its scenarios.
SEMANTIC_DISPATCH = {
    "model_version_bundle_manifest": "validate_bundle_scenario",
    "lineage_alignment_report": "validate_alignment_report",
    "pipeline_job_attempt": "validate_job_scenario",
    "result_manifest": "validate_result_publication_scenario",
    CLOUD_CONTRACT: "validate_cloud_publication_scenario",
}


@pytest.mark.parametrize(("contract", "fixture_path"), SEMANTIC_FIXTURES)
def test_every_semantic_fixture_declares_expect(contract: str, fixture_path: Path):
    """E-14: ``{"payload": ..., "expect": {"diagnostic_codes": [...]}}``."""
    fixture = _read_json(fixture_path)
    assert set(fixture) == {"payload", "expect"}, (
        f"{contract}/{fixture_path.name}: top level must be exactly "
        f"payload + expect, got {sorted(fixture)}"
    )
    expect = fixture["expect"]
    assert set(expect) == {"diagnostic_codes"}, (
        f"{contract}/{fixture_path.name}: expect must carry only "
        f"diagnostic_codes, got {sorted(expect)}"
    )
    codes = expect["diagnostic_codes"]
    assert isinstance(codes, list) and all(isinstance(code, str) for code in codes), (
        f"{contract}/{fixture_path.name}: diagnostic_codes must be a list of strings"
    )
    assert len(set(codes)) == len(codes), (
        f"{contract}/{fixture_path.name}: diagnostic_codes must not repeat a code"
    )


@pytest.mark.parametrize(("contract", "fixture_path"), SEMANTIC_FIXTURES)
def test_semantic_scenario(contract: str, fixture_path: Path):
    """Schema-valid payload, semantic verdict equal to the declared codes.

    The empty-list cases are load-bearing: they prove the validator stays quiet
    on a self-consistent document instead of firing on everything it sees.
    """
    fixture = _read_json(fixture_path)
    payload = fixture["payload"]

    schema_errors = list(_validator_for(contract, payload).iter_errors(payload))
    assert not schema_errors, (
        f"{contract}/{fixture_path.name}: a semantic fixture payload must be "
        "schema-valid so the scenario isolates the semantic layer; got: "
        + "; ".join(
            f"{_json_pointer(error.absolute_path) or '(root)'}: {error.message}"
            for error in schema_errors
        )
    )

    validate = getattr(semantic_validators, SEMANTIC_DISPATCH[contract])
    assert validate(payload) == fixture["expect"]["diagnostic_codes"], (
        f"{contract}/{fixture_path.name}: semantic verdict differs from expect"
    )


#: The positive fixtures of the four contracts that own a semantic validator.
SEMANTICALLY_CHECKED_VALID_FIXTURES = [
    param for param in VALID_FIXTURES if param.values[0] in SEMANTIC_DISPATCH
]


@pytest.mark.parametrize(
    ("contract", "fixture_path"), SEMANTICALLY_CHECKED_VALID_FIXTURES
)
def test_valid_fixtures_carry_no_semantic_contradiction(
    contract: str, fixture_path: Path
):
    """A schema-valid, self-consistent document must produce no semantic code.

    The ``semantic/`` corpus proves the validators fire on the documents they
    should. This proves the other direction -- that they stay quiet otherwise
    -- across the whole positive corpus, so a rule cannot be tightened into
    something that reports every well-formed document.
    """
    validate = getattr(semantic_validators, SEMANTIC_DISPATCH[contract])
    assert validate(_read_json(fixture_path)) == [], (
        f"{contract}/{fixture_path.name} is a positive fixture but the "
        "semantic validator reported a contradiction"
    )


def test_semantic_dispatch_covers_every_contract_with_semantic_fixtures():
    with_fixtures = {
        contract for contract in CONTRACTS if _fixture_paths(contract, "semantic")
    }
    assert with_fixtures == set(SEMANTIC_DISPATCH), (
        "a contract grew semantic fixtures without a validator entry point: "
        f"{sorted(with_fixtures ^ set(SEMANTIC_DISPATCH))}"
    )


# ---------------------------------------------------------------------------
# Identity and arithmetic primitives
# ---------------------------------------------------------------------------


def test_uuid36_globalid22_roundtrip_table():
    """E-9: UUID36 <-> GlobalId22 round-trips; the prim token derives one way."""
    table = _read_json(_ROUNDTRIP_TABLE_PATH)
    assert len(table) >= 8, f"truth table needs >=8 rows, has {len(table)}"

    alphabet_seen: set[str] = set()
    for row in table:
        source = row["uuid36_source"]
        canonical = row["uuid36_canonical"]
        global_id = row["global_id22"]

        assert semantic_validators.canonical_uuid36(source) == canonical
        assert semantic_validators.ifc_guid_compress(source) == global_id
        assert semantic_validators.ifc_guid_expand(global_id) == canonical
        # Round-trip in both directions, not just one.
        assert (
            semantic_validators.ifc_guid_compress(
                semantic_validators.ifc_guid_expand(global_id)
            )
            == global_id
        )
        assert global_id[0] in semantic_validators.IFC_GUID_LEADING_CHARS

        assert (
            semantic_validators.usd_safe_identifier(global_id, fallback="Shape")
            == row["usd_safe_identifier"]
        )
        token = semantic_validators.usd_guid_token(global_id)
        assert token == row["usd_guid_token"]
        assert len(token) == semantic_validators.USD_GUID_TOKEN_LENGTH

        ifc_class = row["usd_element_root_path"].split("/")[3]
        assert (
            semantic_validators.usd_element_root_path(ifc_class, global_id)
            == row["usd_element_root_path"]
        )
        alphabet_seen.update(global_id)

    assert {"$", "_"} <= alphabet_seen, (
        "the truth table must exercise both non-alphanumeric GlobalId "
        "characters, since they are what the prim-token sanitizer rewrites"
    )


def test_ratio_truncation_is_decimal_not_float():
    """tasks.md 4.4: decimal division truncated at 10 dp, never rounded.

    The three assertions below fail against the two implementations that look
    right and are not: binary-float division, and rounding instead of
    truncating.
    """
    truncate_ratio = semantic_validators.truncate_ratio

    # Truncation, not rounding: 2/3 rounds to ...667 and truncates to ...666.
    assert truncate_ratio(2, 3) == Decimal("0.6666666666")
    assert truncate_ratio(2, 3) != Decimal("0.6666666667")

    # Decimal division, not float: 29/100 and 7/10 are exact in decimal but sit
    # just below their decimal value in binary, so a float implementation
    # truncates to ...9999999.
    assert truncate_ratio(29, 100) == Decimal("0.2900000000")
    assert truncate_ratio(7, 10) == Decimal("0.7000000000")

    # The E-11 partial-scale value carried by the alignment fixtures.
    assert truncate_ratio(975, 1180) == Decimal("0.8262711864")

    # Zero denominator is not evaluable; it is never 0% and never 100%.
    assert truncate_ratio(0, 0) is None
    assert truncate_ratio(5, 0) is None

    result = truncate_ratio(1, 3)
    assert isinstance(result, Decimal) and not isinstance(result, float)
    assert result.as_tuple().exponent == -semantic_validators.RATIO_DECIMAL_PLACES


# ---------------------------------------------------------------------------
# Task 2.5: the promoted cloud publication contract
# ---------------------------------------------------------------------------


def _cloud_fixture_documents() -> list:
    """``(kind, path, document)`` for every cloud fixture, semantic unwrapped."""
    entries = []
    for kind in ("valid", "invalid", "semantic"):
        for path in _fixture_paths(CLOUD_CONTRACT, kind):
            fixture = _read_json(path)
            document = fixture["payload"] if kind == "semantic" else fixture
            entries.append((kind, path, document))
    return entries


CLOUD_FIXTURE_PARAMS = [
    pytest.param(kind, path, id=f"{kind}/{path.name}")
    for kind, path, _document in _cloud_fixture_documents()
]

CLOUD_INVALID_PARAMS = [
    pytest.param(path, id=path.name)
    for path in _fixture_paths(CLOUD_CONTRACT, "invalid")
]


@pytest.mark.skipif(
    not (
        _CLOUD_REQUEST_SCHEMA_PATH.exists() and _CLOUD_RESPONSE_SCHEMA_PATH.exists()
    ),
    reason=f"change contracts not present: {_CHANGE_CONTRACTS_DIR}",
)
@pytest.mark.parametrize("direction", sorted(CLOUD_SCHEMA_FILES))
def test_promoted_cloud_schemas_are_byte_equal_to_the_change_originals(
    direction: str,
):
    """2.5 is a *promotion*: the two schemas were copied, never re-authored.

    Compared as bytes rather than as parsed documents, so key order, spacing
    and comment text are all in scope -- a JSON deep-equal would let a
    reformatted copy pass. Line endings are normalised first because
    ``core.autocrlf`` decides them per checkout, and the same normalisation is
    applied to both sides.
    """
    original = (
        _CHANGE_CONTRACTS_DIR / CLOUD_SCHEMA_FILES[direction]
    ).read_bytes().replace(b"\r\n", b"\n")
    promoted = (
        _CONTRACTS_DIR / CLOUD_SCHEMA_FILES[direction]
    ).read_bytes().replace(b"\r\n", b"\n")
    assert promoted == original, (
        f"tests/contracts/{CLOUD_SCHEMA_FILES[direction]} is no longer a "
        "byte-identical promotion of the change original; a re-authored copy "
        "would make the change and the executable contract two authorities"
    )


def test_shared_defs_match_the_promoted_cloud_request_schema():
    """E-12, but against the copy that survives archiving.

    :func:`test_shared_defs_match_cloud_request_schema` binds the five 2.1-2.4
    contracts to the *change* original and skips once the change is archived.
    This one makes the same comparison against the promoted copy under
    ``tests/contracts/``, so the binding keeps running afterwards. The two
    cannot disagree while
    :func:`test_promoted_cloud_schemas_are_byte_equal_to_the_change_originals`
    holds.
    """
    cloud_defs = _CLOUD_SCHEMAS["request"].get("$defs", {})
    compared = 0
    drifted: list[str] = []
    for contract in SINGLE_SCHEMA_CONTRACTS:
        for name, definition in _SCHEMAS[contract].get("$defs", {}).items():
            if name not in cloud_defs:
                continue
            compared += 1
            if _strip_annotations(definition) != _strip_annotations(cloud_defs[name]):
                drifted.append(f"{contract}.$defs.{name}")
    assert compared >= 5, (
        f"expected at least the five shared defs to be compared; compared {compared}"
    )
    assert not drifted, f"lineage copies drifted from the promoted cloud copy: {drifted}"


@pytest.mark.parametrize("fixture_path", CLOUD_INVALID_PARAMS)
def test_cloud_expectation_schema_field_matches_the_direction_router(
    fixture_path: Path,
):
    """The expectations' ``schema`` field is a redundant check on the router.

    One fixture directory feeds two schemas, so a routing mistake would show up
    as a fixture silently validated against the wrong side. Every cloud
    expectation records which direction its author meant; this compares that
    declaration against what ``cloud_publication_direction`` actually decides.
    """
    key = f"{CLOUD_CONTRACT}/{fixture_path.name}"
    declared = EXPECTATIONS[key].get("schema")
    assert declared in CLOUD_SCHEMA_FILES, (
        f"{key}: expectations must declare schema as one of "
        f"{sorted(CLOUD_SCHEMA_FILES)}, got {declared!r}"
    )
    document = _read_json(fixture_path)
    routed = semantic_validators.cloud_publication_direction(document)
    assert routed == declared, (
        f"{key}: expectations say {declared}, the router says {routed}"
    )


@pytest.mark.parametrize(("kind", "fixture_path"), CLOUD_FIXTURE_PARAMS)
def test_cloud_fixture_is_rejected_by_the_opposite_direction_schema(
    kind: str, fixture_path: Path
):
    """Routing cannot silently point at the wrong schema.

    Every cloud fixture must be rejected by the direction it was *not* routed
    to. Without this the request and response corpora could drift into
    something both schemas accept, and the router would stop meaning anything.
    """
    fixture = _read_json(fixture_path)
    document = fixture["payload"] if kind == "semantic" else fixture
    routed = semantic_validators.cloud_publication_direction(document)
    opposite = "response" if routed == "request" else "request"
    assert list(_CLOUD_VALIDATORS[opposite].iter_errors(document)), (
        f"{kind}/{fixture_path.name} routed to the {routed} schema but the "
        f"{opposite} schema also accepts it; the two directions are no longer "
        "distinguishable"
    )


# ---------------------------------------------------------------------------
# expectations.json: the optional ``must_contain`` target (F-2)
# ---------------------------------------------------------------------------
#
# `deterministic_leaf_error` answers "which leaf does the tie-break pick?".
# For a bare `oneOf` -- the shape the cloud request schema uses -- the
# non-matching branch leaves a real `const` leaf on the discriminator rather
# than the boolean leaf that step 2 of the rule drops, so a violation at the
# same depth can lose the lexicographic tie to `/event_type`. Those fixtures
# additionally declare `must_contain`: the rule they actually exercise, which
# must be present somewhere in the error tree. The check is purely additive --
# the 182 entries that landed with 2.1-2.4 declare no `must_contain` and are
# untouched.

MUST_CONTAIN_FIXTURES = [
    pytest.param(contract, path, id=key)
    for contract, path, key in _invalid_fixture_keys()
    if "must_contain" in EXPECTATIONS.get(key, {})
]


def _leaf_targets(errors) -> set:
    """Every ``(keyword, instance pointer)`` the error tree carries."""
    return {
        (error.validator, _json_pointer(error.absolute_path))
        for error in _flatten_leaf_errors(errors)
        if error.validator is not None
    }


def test_must_contain_declarations_exist():
    """A ratchet: the ``must_contain`` corpus must not silently empty out."""
    assert len(MUST_CONTAIN_FIXTURES) >= 5, (
        "the bare-oneOf fixtures that need a must_contain target disappeared; "
        f"found {len(MUST_CONTAIN_FIXTURES)}"
    )


@pytest.mark.parametrize(("contract", "fixture_path"), MUST_CONTAIN_FIXTURES)
def test_invalid_fixture_contains_declared_target(contract: str, fixture_path: Path):
    """The rule the fixture is *about* must really fire, tie-break aside."""
    key = f"{contract}/{fixture_path.name}"
    expectation = EXPECTATIONS[key]
    target = expectation["must_contain"]
    assert set(target) == {"keyword", "instance_pointer"}, (
        f"{key}: must_contain must carry exactly keyword + instance_pointer, "
        f"got {sorted(target)}"
    )
    wanted = (target["keyword"], target["instance_pointer"])
    recorded = (expectation["keyword"], expectation["instance_pointer"])
    assert wanted != recorded, (
        f"{key}: must_contain repeats the deterministic leaf, so it proves "
        "nothing the existing expectation does not already prove; drop it"
    )

    document = _read_json(fixture_path)
    observed = _leaf_targets(_validator_for(contract, document).iter_errors(document))
    assert wanted in observed, (
        f"{key}: expected {wanted[0]} @ {wanted[1] or '(root)'} somewhere in the "
        f"error tree; the tree carries {sorted(observed)}"
    )


# ---------------------------------------------------------------------------
# Task 2.7 negative cases that need a fixture-reading assertion
# ---------------------------------------------------------------------------


def _cloud_valid_fixture(name: str) -> dict:
    return _read_json(_FIXTURES_DIR / CLOUD_CONTRACT / "valid" / name)


def test_three_valid_cloud_request_fixtures_have_distinct_event_ids():
    """tasks.md 2.7: "三個valid request fixture event IDs互異".

    Event IDs are the receiver's primary key for the immutable event identity
    ledger, so three examples sharing one would make the corpus unable to
    demonstrate three distinct events at all -- and every replay/conflict rule
    downstream is stated in terms of that key.
    """
    uuid_pattern = _CLOUD_SCHEMAS["request"]["$defs"]["uuid"]["pattern"]
    seen: dict[str, str] = {}
    for name in CLOUD_DISTINCT_EVENT_ID_FIXTURES:
        document = _cloud_valid_fixture(name)
        assert semantic_validators.cloud_publication_direction(document) == "request", (
            f"{name} is not a request-direction fixture"
        )
        event_id = document["event_id"]
        assert re.fullmatch(uuid_pattern.strip("^$"), event_id), (
            f"{name}: event_id {event_id!r} is not a schema-valid UUID"
        )
        assert event_id not in seen, (
            f"{name} reuses the event_id of {seen[event_id]}; the three shipped "
            "valid request examples must name three distinct events"
        )
        seen[event_id] = name
    assert len(seen) == len(CLOUD_DISTINCT_EVENT_ID_FIXTURES)


#: Response bodies that echo a request's ``event_id`` back to the sender.
CLOUD_ECHO_FIXTURES = ("valid-created-ack.json", "valid-conflict-error.json")


@pytest.mark.parametrize("name", CLOUD_ECHO_FIXTURES)
def test_ack_or_error_echo_is_not_a_second_request_event(name: str):
    """tasks.md 2.7: "ACK/error echo request ID不得誤算為request event重用".

    Both fixtures echo the ``event_id`` of
    ``valid-lineage-result-published.json``. Three separate mechanisms have to
    agree that the echo is still a response:

    1. the direction router sends it to the response schema -- it carries no
       ``schema_version``, and neither response body may declare one;
    2. the request schema rejects it outright, so it can never be replayed into
       the publication corpus as a second event with that ID;
    3. the request-side semantic rules stay silent on it, so no identity or
       reuse diagnosis is invented for a document that is not an event.
    """
    published_event_id = _cloud_valid_fixture(
        "valid-lineage-result-published.json"
    )["event_id"]
    echo = _cloud_valid_fixture(name)
    assert echo["event_id"] == published_event_id, (
        f"{name} no longer echoes the published event's ID, so it stops being "
        "the confusable case this test exists for"
    )

    assert semantic_validators.cloud_publication_direction(echo) == "response"
    assert list(_CLOUD_VALIDATORS["request"].iter_errors(echo)), (
        f"{name} was accepted by the request schema; an echoed request ID would "
        "then be indistinguishable from a reuse of that event ID"
    )
    assert semantic_validators.validate_cloud_publication_scenario(echo) == []


def test_same_health_event_id_with_a_different_body_is_a_receiver_side_conflict():
    """tasks.md 2.7: "same-health-event/different-body".

    The two health fixtures carry one event ID and two different bodies. Both
    are individually schema-valid and semantically clean, which is the point:
    no single-document validator can see the conflict, so the rule has to live
    in the receiver's event-identity ledger and surface on the wire as
    ``409``/``PUBLICATION_DIGEST_CONFLICT``. This test pins the exhibit and the
    error code it demands; the status/retryable binding for that code is
    asserted in ``test_cloud_publication_protocol.py``.
    """
    first = _cloud_valid_fixture("valid-lineage-result-health-changed.json")
    second = _cloud_valid_fixture("valid-health-verified-restored.json")

    assert first["event_id"] == second["event_id"], (
        "the two health fixtures no longer share an event ID, so they stop "
        "being the same-event/different-body exhibit"
    )
    assert first["payload"] != second["payload"], "the two bodies must differ"
    for document in (first, second):
        assert not list(_CLOUD_VALIDATORS["request"].iter_errors(document))
        assert semantic_validators.validate_cloud_publication_scenario(document) == []

    error_codes = _CLOUD_SCHEMAS["response"]["$defs"]["errorResponse"]["properties"][
        "error"
    ]["properties"]["code"]["enum"]
    assert "PUBLICATION_DIGEST_CONFLICT" in error_codes, (
        "the response schema must be able to name the conflict the document "
        "layer cannot detect"
    )
