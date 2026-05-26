"""Cross-service structured log schema contract test (Python side).

Reads ``schema.json`` and walks ``fixtures/valid/*.jsonl`` and
``fixtures/invalid/*.jsonl``. Asserts that every record in ``valid/`` passes
validation and every record in ``invalid/`` fails. The TS counterpart in
``bim-review-coordinator/tests/contracts/structured-log/validate.contract.test.ts``
uses the exact same schema and fixtures via ajv.

Run with:

    python -m pytest tests/contracts/structured-log/test_validate.py -p no:cacheprovider
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

_HERE = Path(__file__).parent
_SCHEMA_PATH = _HERE / "schema.json"
_FIXTURES_DIR = _HERE / "fixtures"


def _load_schema() -> dict:
    with _SCHEMA_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def _load_fixture(path: Path) -> dict:
    text = path.read_text(encoding="utf-8").strip()
    if "\n" in text:
        raise AssertionError(
            f"Fixture {path} contains more than one JSONL line; one record per file."
        )
    return json.loads(text)


def _list_fixtures(subdir: str) -> list[Path]:
    base = _FIXTURES_DIR / subdir
    if not base.is_dir():
        raise AssertionError(f"Missing fixture dir: {base}")
    return sorted(p for p in base.glob("*.jsonl"))


@pytest.fixture(scope="module")
def validator() -> Draft7Validator:
    return Draft7Validator(_load_schema())


def test_schema_is_valid_draft7():
    schema = _load_schema()
    Draft7Validator.check_schema(schema)


def test_valid_fixture_count_meets_minimum():
    valids = _list_fixtures("valid")
    assert len(valids) >= 14, (
        f"design §6.1 / tasks 1.4 require >=14 positive fixtures; found {len(valids)}"
    )


def test_invalid_fixture_count_meets_minimum():
    invalids = _list_fixtures("invalid")
    assert len(invalids) >= 4, (
        f"need >=4 negative fixtures to exercise validator failure paths; "
        f"found {len(invalids)}"
    )


@pytest.mark.parametrize("fixture_path", _list_fixtures("valid"), ids=lambda p: p.name)
def test_valid_fixture_passes_schema(fixture_path: Path, validator: Draft7Validator):
    record = _load_fixture(fixture_path)
    errors = sorted(validator.iter_errors(record), key=lambda e: e.path)
    assert not errors, (
        f"{fixture_path.name} expected to pass schema but got errors: "
        + "; ".join(f"{list(e.absolute_path)}: {e.message}" for e in errors)
    )


@pytest.mark.parametrize("fixture_path", _list_fixtures("invalid"), ids=lambda p: p.name)
def test_invalid_fixture_fails_schema(fixture_path: Path, validator: Draft7Validator):
    record = _load_fixture(fixture_path)
    errors = list(validator.iter_errors(record))
    assert errors, (
        f"{fixture_path.name} expected to fail schema but passed validation; "
        "either the fixture is no longer invalid or the schema is too lax."
    )


def test_event_type_enum_covers_seven_documented_values():
    """Guard against silent drift: schema enum must equal the 7 documented types."""
    schema = _load_schema()
    enum_values = set(schema["properties"]["event_type"]["enum"])
    expected = {
        "logic_error",
        "operation_anomaly",
        "env_snapshot",
        "lifecycle",
        "audit",
        "network",
        "general",
    }
    assert enum_values == expected, (
        f"event_type enum drift: schema={enum_values}, contract={expected}"
    )


def test_lifecycle_subject_kinds_match_contract():
    """Guard against subject_kind drift between schema.json and structured-log-schema.md."""
    schema = _load_schema()
    lifecycle_branch = next(
        branch
        for branch in schema["allOf"]
        if branch.get("if", {}).get("properties", {}).get("event_type", {}).get("const")
        == "lifecycle"
    )
    subject_kinds = set(
        lifecycle_branch["then"]["properties"]["data"]["properties"]["subject_kind"]["enum"]
    )
    expected = {
        "review_session",
        "conversion_job",
        "kit_subprocess",
        "ifc_ready_job",
        "script_run",
        "outbox_delivery",
    }
    assert subject_kinds == expected
