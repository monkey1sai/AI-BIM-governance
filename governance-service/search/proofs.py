"""Short-lived, opaque A4 row proofs.

Proofs are deliberately process-local rather than a query-history store.  A
browser sees only an opaque id plus MAC; the immutable snapshot remains on the
governance side until expiry or one successful A4 Issue transaction.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import secrets
import threading
import time
import unicodedata
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any, Optional


DEFAULT_PROOF_TTL_SECONDS = 300.0
MAX_PROOF_TTL_SECONDS = 900.0
MAX_PROOF_RECORDS = 2_048
MAX_PROOF_SNAPSHOT_BYTES = 64 * 1024
MAX_PROOF_SNAPSHOT_DEPTH = 8
MAX_PROOF_SNAPSHOT_ITEMS = 128
MAX_PROOF_SNAPSHOT_TEXT = 4_096
_KID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# Dots make the three variable-length fields unambiguous.  Both ``kid`` and a
# URL-safe opaque identifier may contain underscores, so an underscore-delimited
# token would admit ambiguous parses during verification.
_TOKEN_RE = re.compile(r"^a4p\.([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{16,96})\.([0-9a-f]{64})$")
_QUERY_ID_RE = re.compile(r"^a4q_[A-Za-z0-9_-]{12,64}$")
_SNAPSHOT_KEYS = {
    "schema_version",
    "query_id",
    "query",
    "normalized_filters",
    "interpretation",
    "row",
    "model_version_id",
    "session_binding",
    "mapping_digest",
}
_FORBIDDEN_SNAPSHOT_KEYS = {
    "ifc_source_path",
    "element_mapping_path",
    "mapping_path",
    "mapping_url",
    "endpoint",
    "base_url",
    "authorization",
    "api_key",
    "lease_token",
    "a4_trusted_context",
}


class ProofUnavailable(ValueError):
    """Proof configuration is unavailable or a proof cannot be used safely."""


class ProofExpired(ProofUnavailable):
    """The process still knows that an otherwise well-formed proof expired."""


def _canonical_value(value: Any) -> Any:
    """Normalize JSON input before hashing so proof digests are deterministic."""
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite JSON value")
        return value
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [_canonical_value(item) for item in value]
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for raw_key, item in value.items():
            if not isinstance(raw_key, str):
                raise ValueError("JSON object key must be a string")
            key = unicodedata.normalize("NFC", raw_key)
            if key in normalized:
                raise ValueError("duplicate canonical JSON key")
            normalized[key] = _canonical_value(item)
        return normalized
    raise ValueError("unsupported canonical JSON value")


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        _canonical_value(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _is_bounded_snapshot_value(value: Any, *, depth: int = 0) -> bool:
    if depth > MAX_PROOF_SNAPSHOT_DEPTH:
        return False
    if value is None or isinstance(value, (bool, int)):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, str):
        return len(value) <= MAX_PROOF_SNAPSHOT_TEXT
    if isinstance(value, list):
        return len(value) <= MAX_PROOF_SNAPSHOT_ITEMS and all(
            _is_bounded_snapshot_value(item, depth=depth + 1) for item in value
        )
    if isinstance(value, dict):
        return len(value) <= MAX_PROOF_SNAPSHOT_ITEMS and all(
            isinstance(key, str)
            and len(key) <= 160
            and _is_bounded_snapshot_value(item, depth=depth + 1)
            for key, item in value.items()
        )
    return False


def _contains_forbidden_snapshot_key(value: Any) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(key, str) and key.casefold() in _FORBIDDEN_SNAPSHOT_KEYS:
                return True
            if _contains_forbidden_snapshot_key(item):
                return True
    elif isinstance(value, list):
        return any(_contains_forbidden_snapshot_key(item) for item in value)
    return False


def _canonical_snapshot(snapshot: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Accept only the small, path-free A4 proof snapshot contract."""
    if (
        not isinstance(snapshot, dict)
        or set(snapshot) != _SNAPSHOT_KEYS
        or snapshot.get("schema_version") != "a4-proof-v1"
        or not isinstance(snapshot.get("query_id"), str)
        or not _QUERY_ID_RE.fullmatch(snapshot["query_id"])
        or not isinstance(snapshot.get("query"), str)
        or not isinstance(snapshot.get("model_version_id"), str)
        or not snapshot["model_version_id"]
        or not isinstance(snapshot.get("mapping_digest"), str)
        or not snapshot["mapping_digest"]
        or not _is_bounded_snapshot_value(snapshot)
        or _contains_forbidden_snapshot_key(snapshot)
    ):
        return None
    try:
        encoded = canonical_json(snapshot)
    except (TypeError, ValueError):
        return None
    if len(encoded) > MAX_PROOF_SNAPSHOT_BYTES:
        return None
    return json.loads(encoded)


def _safe_ttl_seconds() -> Optional[float]:
    raw = os.getenv("A4_PROOF_TTL_SECONDS", "").strip()
    if not raw:
        return DEFAULT_PROOF_TTL_SECONDS
    try:
        value = float(raw)
    except ValueError:
        return None
    if not math.isfinite(value) or value <= 0 or value > MAX_PROOF_TTL_SECONDS:
        return None
    return value


@dataclass(frozen=True)
class ProofKeyring:
    active_kid: str
    active_key: bytes
    verify_keys: dict[str, bytes]

    @classmethod
    def from_environment(cls) -> Optional["ProofKeyring"]:
        active_kid = os.getenv("A4_PROOF_ACTIVE_KID", "").strip()
        active_key = os.getenv("A4_PROOF_ACTIVE_KEY", "").strip()
        active_key_bytes = active_key.encode("utf-8")
        if (
            not active_kid
            or not active_key
            or not _KID_RE.fullmatch(active_kid)
            or len(active_key_bytes) < 32
        ):
            return None
        verify_keys = {active_kid: active_key_bytes}
        previous_kid = os.getenv("A4_PROOF_PREVIOUS_KID", "").strip()
        previous_key = os.getenv("A4_PROOF_PREVIOUS_KEY", "").strip()
        if bool(previous_kid) != bool(previous_key):
            return None
        if previous_kid:
            previous_key_bytes = previous_key.encode("utf-8")
            if (
                not _KID_RE.fullmatch(previous_kid)
                or previous_kid == active_kid
                or len(previous_key_bytes) < 32
            ):
                return None
            verify_keys[previous_kid] = previous_key_bytes
        return cls(active_kid=active_kid, active_key=active_key_bytes, verify_keys=verify_keys)


@dataclass(frozen=True)
class VerifiedProof:
    proof_id: str
    kid: str
    expires_at: str
    expires_at_epoch: float
    snapshot_hash: str
    snapshot: dict[str, Any]
    proof_digest: str


@dataclass(frozen=True)
class ProofTokenReference:
    kid: str
    proof_id: str


@dataclass
class _ProofRecord:
    verified: VerifiedProof
    signature: str


def _signature_claims(*, kid: str, proof_id: str, expires_at_epoch: float, snapshot_hash: str) -> bytes:
    return canonical_json(
        {
            "kid": kid,
            "proof_id": proof_id,
            "expires_at_epoch": int(expires_at_epoch),
            "snapshot_hash": snapshot_hash,
        }
    )


def _sign(key: bytes, claims: bytes) -> str:
    return hmac.new(key, claims, hashlib.sha256).hexdigest()


def parse_proof_token(token: str) -> Optional[ProofTokenReference]:
    """Parse an opaque envelope without treating it as authenticated evidence."""
    match = _TOKEN_RE.fullmatch(token or "")
    if not match:
        return None
    kid, proof_id, _signature = match.groups()
    return ProofTokenReference(kid=kid, proof_id=proof_id)


def proof_digest(token: str) -> str:
    """Digest exact envelope bytes without retaining the token in durable state."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class ProofRegistry:
    def __init__(self, *, max_records: int = MAX_PROOF_RECORDS):
        self.max_records = max_records
        self._records: dict[str, _ProofRecord] = {}
        self._expired_ids: dict[str, float] = {}
        self._lock = threading.Lock()

    def _purge_expired(self, now: float) -> None:
        for proof_id, record in list(self._records.items()):
            if record.verified.expires_at_epoch <= now:
                self._records.pop(proof_id, None)
                self._expired_ids[proof_id] = now
        # This remains a short-lived availability hint, not proof/query history.
        for proof_id, recorded_at in list(self._expired_ids.items()):
            if recorded_at + MAX_PROOF_TTL_SECONDS <= now:
                self._expired_ids.pop(proof_id, None)

    def issue(self, snapshot: dict[str, Any]) -> Optional[dict[str, str]]:
        keyring = ProofKeyring.from_environment()
        normalized_snapshot = _canonical_snapshot(snapshot)
        ttl_seconds = _safe_ttl_seconds()
        if keyring is None or normalized_snapshot is None or ttl_seconds is None:
            return None
        now = time.time()
        expires_at_epoch = now + ttl_seconds
        proof_id = secrets.token_urlsafe(18)
        snapshot_hash = hashlib.sha256(canonical_json(normalized_snapshot)).hexdigest()
        claims = _signature_claims(
            kid=keyring.active_kid,
            proof_id=proof_id,
            expires_at_epoch=expires_at_epoch,
            snapshot_hash=snapshot_hash,
        )
        signature = _sign(keyring.active_key, claims)
        token = f"a4p.{keyring.active_kid}.{proof_id}.{signature}"
        expires_at = datetime.fromtimestamp(expires_at_epoch, timezone.utc).isoformat().replace("+00:00", "Z")
        verified = VerifiedProof(
            proof_id=proof_id,
            kid=keyring.active_kid,
            expires_at=expires_at,
            expires_at_epoch=expires_at_epoch,
            snapshot_hash=snapshot_hash,
            snapshot=normalized_snapshot,
            proof_digest=proof_digest(token),
        )
        with self._lock:
            self._purge_expired(now)
            # Do not evict another active session's proof.  A saturated registry
            # degrades to table-only rather than allowing one principal to cancel
            # another principal's yet-valid confirmation path.
            if len(self._records) >= self.max_records or proof_id in self._records:
                return None
            self._records[proof_id] = _ProofRecord(verified=verified, signature=signature)
        return {"evidence_proof": token, "proof_id": proof_id, "kid": keyring.active_kid, "expires_at": expires_at}

    def verify(self, token: str, *, now: Optional[float] = None) -> VerifiedProof:
        reference = parse_proof_token(token)
        if reference is None:
            raise ProofUnavailable("proof unavailable")
        kid = reference.kid
        proof_id = reference.proof_id
        signature = token.rsplit(".", 1)[-1]
        current = time.time() if now is None else now
        with self._lock:
            self._purge_expired(current)
            record = self._records.get(proof_id)
            known_expired = proof_id in self._expired_ids
        if record is None:
            if known_expired:
                raise ProofExpired("proof expired")
            raise ProofUnavailable("proof unavailable")
        if record.verified.kid != kid or record.verified.expires_at_epoch <= current:
            raise ProofUnavailable("proof unavailable")
        keyring = ProofKeyring.from_environment()
        key = keyring.verify_keys.get(kid) if keyring is not None else None
        if key is None:
            raise ProofUnavailable("proof unavailable")
        claims = _signature_claims(
            kid=kid,
            proof_id=proof_id,
            expires_at_epoch=record.verified.expires_at_epoch,
            snapshot_hash=record.verified.snapshot_hash,
        )
        expected = _sign(key, claims)
        if not hmac.compare_digest(signature, expected) or not hmac.compare_digest(signature, record.signature):
            raise ProofUnavailable("proof unavailable")
        # Callers must not be able to mutate the short-lived registry snapshot.
        return replace(record.verified, snapshot=json.loads(canonical_json(record.verified.snapshot)))


proof_registry = ProofRegistry()
