"""No solver/Kit dependency: identity and negative inputs shared with coordinator."""
import copy
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from cfd_context import validate_context


def draft():
    return json.loads((ROOT / "tests/contracts/fixtures/cfd-context-v1.json").read_text(encoding="utf-8"))


def test_frozen_canonical_vector():
    expected = json.loads((ROOT / "tests/contracts/fixtures/cfd-context-canonical-v1.json").read_text(encoding="utf-8"))
    assert validate_context(draft(), require_hash=False)["canonical_sha256"] == expected["canonical_sha256"]


def test_order_zero_and_precision():
    a = draft()
    a["masses"].append({**copy.deepcopy(a["masses"][0]), "id": "neighbor_02"})
    b = copy.deepcopy(a)
    b["masses"].reverse()
    b["masses"][1]["position_m"][2] = -0.0
    assert validate_context(a, require_hash=False) == validate_context(b, require_hash=False)
    b["masses"][0]["position_m"][0] += 0.00000001
    assert validate_context(a, require_hash=False)["canonical_sha256"] != validate_context(b, require_hash=False)["canonical_sha256"]


def test_verbatim_text_and_cross_unicode_runtime_vector():
    body = draft()
    original = validate_context(body, require_hash=False)
    body["masses"][0]["provenance"]["note"] = "測試尺寸 Cafe\u0301"
    assert validate_context(body, require_hash=False)["canonical_sha256"] != original["canonical_sha256"]
    vector = json.loads((ROOT / "tests/contracts/fixtures/cfd-context-canonical-v1.json").read_text(encoding="utf-8"))["unicode_edge"]
    body["masses"][0]["provenance"]["note"] = vector["note"]
    checked = validate_context(body, require_hash=False)
    assert checked["masses"][0]["provenance"]["note"] == vector["note"]
    assert checked["canonical_sha256"] == vector["canonical_sha256"]


@pytest.mark.parametrize("path,value", [
    (("masses", 0, "dimensions_m", 0), 0),
    (("masses", 0, "dimensions_m", 0), float("inf")),
    (("masses", 0, "position_m", 0), True),
    (("masses", 0, "rotation_degrees"), 360),
    (("masses", 0, "provenance", "note"), "   "),
    (("masses", 0, "provenance", "note"), "\ud800"),
    (("frame", "space"), "gis"),
    (("revision",), 1.5),
    (("revision",), True),
    (("masses", 0, "id"), "neighbor_01\n"),
    (("source", "model_usdc_sha256"), "a" * 64 + "\n"),
])
def test_invalid_fields(path, value):
    body = draft()
    node = body
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    with pytest.raises(ValueError):
        validate_context(body, require_hash=False)


def test_unique_bounded_masses_and_unknown_fields():
    body = draft()
    body["masses"] *= 2
    with pytest.raises(ValueError, match="unique"):
        validate_context(body, require_hash=False)
    body = draft()
    body["masses"] = [{**body["masses"][0], "id": f"block_{i}"} for i in range(50)]
    body["frame"]["up_axis"] = "Y"
    assert len(validate_context(body, require_hash=False)["masses"]) == 50
    body["masses"].append({**body["masses"][0], "id": "last"})
    with pytest.raises(ValueError):
        validate_context(body, require_hash=False)
    body = draft()
    body["masses"][0]["opening"] = True
    with pytest.raises(ValueError):
        validate_context(body, require_hash=False)


def test_required_hash_and_tampering():
    with pytest.raises(ValueError):
        validate_context(draft())
    body = validate_context(draft(), require_hash=False)
    assert validate_context(body) == body
    body["masses"][0]["dimensions_m"][0] += 1
    with pytest.raises(ValueError, match="canonical_sha256"):
        validate_context(body)
