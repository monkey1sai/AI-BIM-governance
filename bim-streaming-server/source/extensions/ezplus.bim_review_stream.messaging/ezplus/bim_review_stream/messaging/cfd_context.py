"""CP9a manual massing identity. No stage access, mesh, solver or persistent writes."""
from __future__ import annotations

import hashlib
import json
import math
import re
import struct
from typing import Any

_ID = re.compile(r"[A-Za-z0-9._:-]{1,64}\Z")
_JOB = re.compile(r"[A-Za-z0-9._-]{1,200}\Z")
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_BLANK = re.compile(r"[ \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*\Z")


def _object(value: Any, keys: set[str], required: set[str]) -> dict:
    if not isinstance(value, dict) or set(value) - keys or required - set(value):
        raise ValueError("context has unknown or missing fields")
    return value


def _text(value: Any, pattern: re.Pattern) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError("context identifier or hash is invalid")
    return value


def _number(value: Any, low: float, high: float, *, exclusive_low=False, exclusive_high=False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("context numeric fields must be finite numbers")
    try:
        number = float(value)
    except OverflowError as exc:
        raise ValueError("context numeric field exceeds binary64") from exc
    if not math.isfinite(number) or number < low or number > high or (exclusive_low and number == low) or (exclusive_high and number == high):
        raise ValueError("context numeric field is outside its bounds")
    return 0.0 if number == 0 else number


def _triple(value: Any, low: float, high: float, *, positive=False) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError("context coordinates and dimensions require exactly three numbers")
    return [_number(item, low, high, exclusive_low=positive) for item in value]


def validate_context(body: Any, *, require_hash: bool = True) -> dict[str, Any]:
    keys = {"schema", "scenario_id", "revision", "source", "frame", "masses", "canonical_sha256"}
    doc = _object(body, keys, keys if require_hash else keys - {"canonical_sha256"})
    if doc["schema"] != "cfd-context/v1":
        raise ValueError("unsupported context schema")
    _text(doc["scenario_id"], _ID)
    revision = doc["revision"]
    if isinstance(revision, bool) or not isinstance(revision, (int, float)) or not 1 <= revision <= 2147483647 or int(revision) != revision:
        raise ValueError("context revision must be an integer in 1..2147483647")
    source = _object(doc["source"], {"conversion_job_id", "model_usdc_sha256"}, {"conversion_job_id", "model_usdc_sha256"})
    _text(source["conversion_job_id"], _JOB)
    _text(source["model_usdc_sha256"], _SHA)
    frame_keys = {"space", "units", "up_axis", "north_reference"}
    frame = _object(doc["frame"], frame_keys, frame_keys)
    if frame["space"] != "model" or frame["units"] != "m" or frame["up_axis"] not in ("Y", "Z") or frame["north_reference"] != "project_north":
        raise ValueError("context requires the model metre/project-north frame")
    if not isinstance(doc["masses"], list) or len(doc["masses"]) > 50:
        raise ValueError("context requires 0..50 masses")
    masses = []
    ids = set()
    for item in doc["masses"]:
        mass_keys = {"id", "position_m", "dimensions_m", "rotation_degrees", "provenance"}
        mass = _object(item, mass_keys, mass_keys)
        mass_id = _text(mass["id"], _ID)
        if mass_id in ids:
            raise ValueError("context mass IDs must be unique")
        ids.add(mass_id)
        provenance = _object(mass["provenance"], {"kind", "note"}, {"kind", "note"})
        if provenance["kind"] not in ("measured", "drawing", "client_supplied", "estimated"):
            raise ValueError("context provenance kind is invalid")
        note = provenance["note"]
        if not isinstance(note, str) or not 1 <= len(note) <= 500 or _BLANK.fullmatch(note) or any(ord(c) < 32 or 127 <= ord(c) <= 159 or 0xd800 <= ord(c) <= 0xdfff for c in note):
            raise ValueError("context source note must contain 1..500 Unicode scalars, no controls, and nonblank text")
        masses.append({"id": mass_id, "position_m": _triple(mass["position_m"], -1e9, 1e9),
                       "dimensions_m": _triple(mass["dimensions_m"], 0, 1e6, positive=True),
                       "rotation_degrees": _number(mass["rotation_degrees"], 0, 360, exclusive_high=True),
                       "provenance": {"kind": provenance["kind"], "note": note}})
    masses.sort(key=lambda mass: mass["id"])
    number_hex = lambda value: struct.pack(">d", value).hex()
    canonical = [doc["schema"], doc["scenario_id"], str(int(revision)), source["conversion_job_id"], source["model_usdc_sha256"],
                 [frame["space"], frame["units"], frame["up_axis"], frame["north_reference"]],
                 [[mass["id"], list(map(number_hex, mass["position_m"])), list(map(number_hex, mass["dimensions_m"])),
                   number_hex(mass["rotation_degrees"]), mass["provenance"]["kind"], mass["provenance"]["note"].encode("utf-8").hex()] for mass in masses]]
    digest = hashlib.sha256(json.dumps(canonical, separators=(",", ":"), ensure_ascii=True).encode("ascii")).hexdigest()
    if "canonical_sha256" in doc and _text(doc["canonical_sha256"], _SHA) != digest:
        raise ValueError("context canonical_sha256 does not match its contents")
    return {**doc, "revision": int(revision), "masses": masses, "canonical_sha256": digest}
