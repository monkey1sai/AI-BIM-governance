"""Executable contract tests for the ``rvt-ifc-usdc-lineage`` schemas.

Covers ``openspec/changes/rvt-ifc-usdc-lineage/tasks.md`` 2.1-2.4: the five
lineage JSON Schemas under ``tests/contracts/``, their fixture corpus under
``tests/contracts/lineage/fixtures/``, the semantic invariants JSON Schema
cannot express, and the boundary between the new source-bundle intake and the
two frozen legacy contracts.

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
"""

from __future__ import annotations

import importlib.util
import json
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
_CLOUD_PUBLISHED_EXAMPLE_PATH = (
    _CHANGE_CONTRACTS_DIR / "examples" / "valid-lineage-result-published.json"
)

_LEGACY_IFC_READY_PATH = _CONTRACTS_DIR / "ifc_ready_payload.json"
_LEGACY_CALLBACK_PATH = _CONTRACTS_DIR / "conversion_result_callback.json"

#: contract name -> schema file, in tasks.md order (2.1, 2.2, 2.3, 2.3, 2.4).
CONTRACTS = (
    "model_version_bundle_manifest",
    "lineage_alignment_report",
    "pipeline_job_attempt",
    "result_manifest",
    "source_bundle_ready",
)

#: Fixture floors, per contract: (valid, invalid, semantic). Blueprint E-13.
#: The numbers are the corpus as landed; they are a ratchet, never a target.
FIXTURE_MINIMUMS = {
    "model_version_bundle_manifest": (9, 30, 8),
    "lineage_alignment_report": (6, 48, 24),
    "pipeline_job_attempt": (27, 53, 8),
    "result_manifest": (15, 38, 5),
    "source_bundle_ready": (2, 13, 0),
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


_SCHEMAS = {contract: _load_schema(contract) for contract in CONTRACTS}
_VALIDATORS = {
    contract: Draft202012Validator(schema) for contract, schema in _SCHEMAS.items()
}


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

#: Escape hatch for nodes that genuinely must stay open. Empty today: every
#: exception in the five contracts is structural (a partial applicator, or a
#: ``$ref`` sibling whose closure lives in the referenced ``$def``) and is
#: handled by the walker rather than by name. Any entry added here needs a
#: written reason next to it.
_OPEN_OBJECT_WHITELIST: dict[str, str] = {}


def _walk_subschemas(node: Any, pointer: str = "", partial: bool = False):
    """Yield ``(pointer, subschema, partial)`` for every object subschema."""
    if not isinstance(node, dict):
        return
    yield pointer, node, partial
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
                    sub, f"{pointer}/{keyword}/{index}", partial
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


@pytest.mark.parametrize("contract", CONTRACTS)
def test_schema_is_valid_draft_2020_12(contract: str):
    schema = _SCHEMAS[contract]
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert list(schema)[:4] == ["$schema", "$id", "title", "description"], (
        f"{contract}: header keys must lead with $schema/$id/title/description"
    )
    Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize("contract", CONTRACTS)
def test_object_schemas_close_additional_properties(contract: str):
    """Every closed object definition must set ``additionalProperties: false``."""
    schema = _SCHEMAS[contract]
    open_objects: list[str] = []
    unclassified: list[str] = []

    for pointer, node, partial in _walk_subschemas(schema):
        if partial or "properties" not in node:
            continue
        if "$ref" in node:
            # A `$ref` sibling narrows an already-closed definition; the
            # closure belongs to the referenced $def, not to this node.
            continue
        if pointer in _OPEN_OBJECT_WHITELIST:
            continue
        if not _declares_object(node):
            unclassified.append(pointer)
            continue
        if node.get("additionalProperties") is not False:
            open_objects.append(pointer)

    assert not unclassified, (
        f"{contract}: subschemas declare `properties` without an object `type`, "
        f"so their closure cannot be checked: {unclassified}"
    )
    assert not open_objects, (
        f"{contract}: object definitions missing `additionalProperties: false`: "
        f"{open_objects}"
    )


@pytest.mark.parametrize("contract", CONTRACTS)
def test_utc_timestamp_defs_carry_pattern_and_format(contract: str):
    """``pattern`` does the rejecting; ``format`` stays as the annotation."""
    defs = _SCHEMAS[contract].get("$defs", {})
    timestamp_defs = {
        name: definition
        for name, definition in defs.items()
        if "timestamp" in name.lower() or definition.get("format") == "date-time"
    }
    assert timestamp_defs, f"{contract}: no timestamp $def found"
    for name, definition in timestamp_defs.items():
        assert definition.get("format") == "date-time", (
            f"{contract}.$defs.{name}: expected format: date-time"
        )
        assert "pattern" in definition, (
            f"{contract}.$defs.{name}: no format_checker is installed, so the "
            "pattern must carry the UTC rejection on its own"
        )
        pattern = definition["pattern"]
        assert pattern.endswith("Z$"), (
            f"{contract}.$defs.{name}: pattern must pin a literal uppercase Z"
        )


def test_shared_defs_are_deep_equal_across_contracts():
    """E-4: the copied ``$defs`` must not drift between the five contracts."""
    holders: dict[str, list[str]] = {}
    for contract in CONTRACTS:
        for name in _SCHEMAS[contract].get("$defs", {}):
            holders.setdefault(name, []).append(contract)

    shared = {
        name: contracts for name, contracts in holders.items() if len(contracts) > 1
    }
    assert {"utcTimestamp", "sha256", "locator"} <= set(shared), (
        f"expected the identity/locator defs to be shared; got {sorted(shared)}"
    )
    assert shared["utcTimestamp"] == list(CONTRACTS), (
        "utcTimestamp must be present in all five contracts"
    )

    drifted: dict[str, list[str]] = {}
    for name, contracts in sorted(shared.items()):
        variants = [
            _strip_annotations(_SCHEMAS[contract]["$defs"][name])
            for contract in contracts
        ]
        if any(variant != variants[0] for variant in variants):
            drifted[name] = contracts
    assert not drifted, f"shared $defs drifted between contracts: {drifted}"


@pytest.mark.skipif(
    not _CLOUD_REQUEST_SCHEMA_PATH.exists(),
    reason=f"change contract not present: {_CLOUD_REQUEST_SCHEMA_PATH}",
)
def test_shared_defs_match_cloud_request_schema():
    """E-12: the copies must equal the cloud publication request originals."""
    cloud_defs = _read_json(_CLOUD_REQUEST_SCHEMA_PATH).get("$defs", {})
    compared = 0
    drifted: list[str] = []
    for contract in CONTRACTS:
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
    errors = sorted(_VALIDATORS[contract].iter_errors(document), key=str)
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
    errors = list(_VALIDATORS[contract].iter_errors(document))
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
    errors = list(_VALIDATORS[contract].iter_errors(document))
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
    fixture_keys = {
        f"{contract}/{path.name}"
        for contract in CONTRACTS
        for path in _fixture_paths(contract, "invalid")
    }
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

    schema_errors = list(_VALIDATORS[contract].iter_errors(payload))
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
