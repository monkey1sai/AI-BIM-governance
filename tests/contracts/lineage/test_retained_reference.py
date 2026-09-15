"""Retired OpenSpec references remain required inputs, never optional evidence."""

from pathlib import Path

import pytest


@pytest.mark.parametrize("relative_path", [
    "README.md",
    "cloud-lineage-publication-request-v1.schema.json",
    "cloud-lineage-publication-response-v1.schema.json",
    "cloud-lineage-publication-mysql8-reference.sql",
    "examples/valid-lineage-result-published.json",
])
def test_retained_reference_is_present(relative_path):
    reference = Path(__file__).parent / "reference" / relative_path
    assert reference.is_file(), f"Required retained contract missing: {reference}"
    assert reference.stat().st_size > 0, f"Required retained contract empty: {reference}"
