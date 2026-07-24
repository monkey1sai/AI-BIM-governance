"""Short-lived, opaque A4 row proofs.

Live proof records are deliberately process-local rather than a query-history
store.  A browser receives an opaque id plus MAC and the bounded path-free
snapshot that the MAC binds. Authenticated expiry/hash claims let a retained
active/previous key verify that submitted snapshot after a normal restart.
Only a human-confirmed Issue may persist the snapshot.
"""
from __future__ import annotations

import base64
import binascii
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
MAX_PROOF_RECORDS_PER_BINDING = 256
MAX_PROOF_RECORDS_PER_PRINCIPAL = 512
MAX_PROOF_SNAPSHOT_BYTES = 64 * 1024
MAX_PROOF_SNAPSHOT_DEPTH = 8
MAX_PROOF_SNAPSHOT_ITEMS = 128
MAX_PROOF_SNAPSHOT_TEXT = 4_096
MAX_SAFE_JSON_INTEGER = (1 << 53) - 1
MAX_PROOF_INTEGER_DECIMAL_DIGITS = 256
MAX_PROOF_INTEGER_BITS = 851
_KID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# Dots make the three variable-length fields unambiguous.  Both ``kid`` and a
# URL-safe opaque identifier may contain underscores, so an underscore-delimited
# token would admit ambiguous parses during verification.
_TOKEN_RE = re.compile(r"^a4p\.([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{16,96})\.([0-9a-f]{64})$")
_QUERY_ID_RE = re.compile(r"^a4q_[A-Za-z0-9_-]{12,64}$")
_EMBEDDED_PROOF_ID_VERSION = 1
_EMBEDDED_PROOF_NONCE_BYTES = 18
_EMBEDDED_PROOF_ID_BYTES = 1 + 8 + 32 + _EMBEDDED_PROOF_NONCE_BYTES
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


def _wire_stable_snapshot_value(value: Any) -> Any:
    """Normalize proof values that JavaScript JSON cannot round-trip exactly.

    The proof snapshot crosses Python -> JSON -> Node -> JSON -> Python before
    Issue creation.  JSON numbers do not preserve Python's float spelling or
    integers outside JavaScript's safe range, so proof-only numeric evidence is
    represented as an exact string.  Booleans remain booleans because ``bool``
    is an ``int`` subclass in Python.
    """
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        if abs(value) <= MAX_SAFE_JSON_INTEGER:
            return value
        if value.bit_length() > MAX_PROOF_INTEGER_BITS:
            raise ValueError("integer exceeds proof snapshot budget")
        text = str(value)
        if len(text.lstrip("-")) > MAX_PROOF_INTEGER_DECIMAL_DIGITS:
            raise ValueError("integer exceeds proof snapshot budget")
        return text
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite JSON value")
        return repr(value)
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [_wire_stable_snapshot_value(item) for item in value]
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for raw_key, item in value.items():
            if not isinstance(raw_key, str):
                raise ValueError("JSON object key must be a string")
            key = unicodedata.normalize("NFC", raw_key)
            if key in normalized:
                raise ValueError("duplicate canonical JSON key")
            normalized[key] = _wire_stable_snapshot_value(item)
        return normalized
    raise ValueError("unsupported proof snapshot value")


def _is_bounded_snapshot_value(value: Any, *, depth: int = 0) -> bool:
    if depth > MAX_PROOF_SNAPSHOT_DEPTH:
        return False
    if value is None or isinstance(value, bool):
        return True
    if isinstance(value, int):
        return value.bit_length() <= MAX_PROOF_INTEGER_BITS
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
        wire_stable = _wire_stable_snapshot_value(snapshot)
        encoded = canonical_json(wire_stable)
    except (TypeError, ValueError):
        return None
    if len(encoded) > MAX_PROOF_SNAPSHOT_BYTES:
        return None
    return json.loads(encoded)


def canonicalize_proof_snapshot(snapshot: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Return the bounded canonical A4 snapshot accepted by proof issuance.

    A4 Issue creation receives the same immutable snapshot alongside the opaque
    proof.  Keeping this validator public lets that boundary hash exactly the
    contract that was signed without exposing registry state or signing keys.
    """
    return _canonical_snapshot(snapshot)


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


@dataclass(frozen=True)
class _EmbeddedProofClaims:
    expires_at_epoch: float
    snapshot_hash: str


@dataclass
class _ProofRecord:
    verified: VerifiedProof
    signature: str
    binding_digest: str
    principal_digest: str


def _proof_quota_digests(snapshot: dict[str, Any]) -> Optional[tuple[str, str]]:
    binding = snapshot.get("session_binding")
    if not isinstance(binding, dict):
        return None
    review_session_id = binding.get("review_session_id")
    legacy_session_id = binding.get("session_id")
    principal_ref = binding.get("principal_ref")
    legacy_principal = binding.get("principal")
    if (
        isinstance(review_session_id, str)
        and isinstance(legacy_session_id, str)
        and review_session_id != legacy_session_id
    ):
        return None
    if (
        isinstance(principal_ref, str)
        and isinstance(legacy_principal, str)
        and principal_ref != legacy_principal
    ):
        return None
    if not isinstance(review_session_id, str):
        review_session_id = legacy_session_id
    if not isinstance(principal_ref, str):
        principal_ref = legacy_principal
    if (
        not isinstance(review_session_id, str)
        or not review_session_id
        or not isinstance(principal_ref, str)
        or not principal_ref
    ):
        return None
    binding_digest = hashlib.sha256(
        canonical_json(
            {
                "review_session_id": review_session_id,
                "principal_ref": principal_ref,
            }
        )
    ).hexdigest()
    principal_digest = hashlib.sha256(principal_ref.encode("utf-8")).hexdigest()
    return binding_digest, principal_digest


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


def _encode_proof_id(*, expires_at_epoch: float, snapshot_hash: str) -> str:
    """Encode restart-safe public claims inside the still-opaque proof id.

    The random nonce preserves proof-id uniqueness. Expiry and snapshot hash are
    authenticated by the outer MAC, so an Issue can verify a browser-submitted
    snapshot after a normal key-rotation restart without persisting query rows.
    """
    raw = (
        bytes([_EMBEDDED_PROOF_ID_VERSION])
        + int(expires_at_epoch).to_bytes(8, "big")
        + bytes.fromhex(snapshot_hash)
        + secrets.token_bytes(_EMBEDDED_PROOF_NONCE_BYTES)
    )
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _decode_proof_id(proof_id: str) -> Optional[_EmbeddedProofClaims]:
    padding = "=" * (-len(proof_id) % 4)
    try:
        raw = base64.b64decode(proof_id + padding, altchars=b"-_", validate=True)
    except (binascii.Error, ValueError):
        return None
    if len(raw) != _EMBEDDED_PROOF_ID_BYTES or raw[0] != _EMBEDDED_PROOF_ID_VERSION:
        return None
    expires_at_epoch = float(int.from_bytes(raw[1:9], "big"))
    snapshot_hash = raw[9:41].hex()
    if expires_at_epoch <= 0:
        return None
    return _EmbeddedProofClaims(
        expires_at_epoch=expires_at_epoch,
        snapshot_hash=snapshot_hash,
    )


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
    def __init__(
        self,
        *,
        max_records: int = MAX_PROOF_RECORDS,
        max_records_per_binding: int = MAX_PROOF_RECORDS_PER_BINDING,
        max_records_per_principal: int = MAX_PROOF_RECORDS_PER_PRINCIPAL,
    ):
        self.max_records = max_records
        self.max_records_per_binding = max_records_per_binding
        self.max_records_per_principal = max_records_per_principal
        self._records: dict[str, _ProofRecord] = {}
        self._binding_counts: dict[str, int] = {}
        self._principal_counts: dict[str, int] = {}
        self._expired_ids: dict[str, float] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _decrement_count(counts: dict[str, int], key: str) -> None:
        remaining = counts.get(key, 0) - 1
        if remaining > 0:
            counts[key] = remaining
        else:
            counts.pop(key, None)

    def _remove_record(self, proof_id: str) -> Optional[_ProofRecord]:
        record = self._records.pop(proof_id, None)
        if record is not None:
            self._decrement_count(self._binding_counts, record.binding_digest)
            self._decrement_count(self._principal_counts, record.principal_digest)
        return record

    def _purge_expired(self, now: float) -> None:
        for proof_id, record in list(self._records.items()):
            if record.verified.expires_at_epoch <= now:
                self._remove_record(proof_id)
                self._expired_ids[proof_id] = now
        # This remains a short-lived availability hint, not proof/query history.
        for proof_id, recorded_at in list(self._expired_ids.items()):
            if recorded_at + MAX_PROOF_TTL_SECONDS <= now:
                self._expired_ids.pop(proof_id, None)

    def issue(self, snapshot: dict[str, Any]) -> Optional[dict[str, Any]]:
        keyring = ProofKeyring.from_environment()
        normalized_snapshot = canonicalize_proof_snapshot(snapshot)
        ttl_seconds = _safe_ttl_seconds()
        quota_digests = (
            _proof_quota_digests(normalized_snapshot)
            if normalized_snapshot is not None
            else None
        )
        if (
            keyring is None
            or normalized_snapshot is None
            or ttl_seconds is None
            or quota_digests is None
        ):
            return None
        binding_digest, principal_digest = quota_digests
        now = time.time()
        # Whole-second expiry is encoded into the opaque proof id so normal
        # key rotation can survive a process restart. Ceil avoids shortening a
        # configured fractional TTL.
        expires_at_epoch = float(math.ceil(now + ttl_seconds))
        snapshot_hash = hashlib.sha256(canonical_json(normalized_snapshot)).hexdigest()
        proof_id = _encode_proof_id(
            expires_at_epoch=expires_at_epoch,
            snapshot_hash=snapshot_hash,
        )
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
            if (
                len(self._records) >= self.max_records
                or self._binding_counts.get(binding_digest, 0) >= self.max_records_per_binding
                or self._principal_counts.get(principal_digest, 0) >= self.max_records_per_principal
                or proof_id in self._records
            ):
                return None
            self._records[proof_id] = _ProofRecord(
                verified=verified,
                signature=signature,
                binding_digest=binding_digest,
                principal_digest=principal_digest,
            )
            self._binding_counts[binding_digest] = self._binding_counts.get(binding_digest, 0) + 1
            self._principal_counts[principal_digest] = self._principal_counts.get(principal_digest, 0) + 1
        return {
            "evidence_proof": token,
            "proof_id": proof_id,
            "kid": keyring.active_kid,
            "expires_at": expires_at,
            # The browser may persist this only when a human confirms an Issue.
            # It is the same canonical, bounded, path-free object whose hash is
            # signed above; callers receive a copy and cannot mutate registry state.
            "a4_evidence_snapshot": json.loads(canonical_json(normalized_snapshot)),
        }

    def discard(self, proof_id: str) -> None:
        """Remove an unreturned proof minted during response budgeting."""
        with self._lock:
            self._remove_record(proof_id)

    def verify(
        self,
        token: str,
        *,
        now: Optional[float] = None,
        snapshot: Optional[dict[str, Any]] = None,
    ) -> VerifiedProof:
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
        embedded = _decode_proof_id(proof_id)
        if record is None and embedded is None:
            if known_expired:
                raise ProofExpired("proof expired")
            raise ProofUnavailable("proof unavailable")
        if record is not None:
            expires_at_epoch = record.verified.expires_at_epoch
            snapshot_hash = record.verified.snapshot_hash
            if (
                record.verified.kid != kid
                or (
                    embedded is not None
                    and (
                        embedded.expires_at_epoch != expires_at_epoch
                        or not hmac.compare_digest(embedded.snapshot_hash, snapshot_hash)
                    )
                )
            ):
                raise ProofUnavailable("proof unavailable")
        else:
            if embedded is None:  # narrowed above; keeps type checkers honest
                raise ProofUnavailable("proof unavailable")
            expires_at_epoch = embedded.expires_at_epoch
            snapshot_hash = embedded.snapshot_hash

        keyring = ProofKeyring.from_environment()
        key = keyring.verify_keys.get(kid) if keyring is not None else None
        if key is None:
            raise ProofUnavailable("proof unavailable")
        claims = _signature_claims(
            kid=kid,
            proof_id=proof_id,
            expires_at_epoch=expires_at_epoch,
            snapshot_hash=snapshot_hash,
        )
        expected = _sign(key, claims)
        signature_matches = hmac.compare_digest(signature, expected)
        record_matches = record is None or hmac.compare_digest(signature, record.signature)
        if not signature_matches or not record_matches:
            raise ProofUnavailable("proof unavailable")
        if expires_at_epoch <= current:
            raise ProofExpired("proof expired")

        if record is not None:
            # Callers must not be able to mutate the short-lived registry snapshot.
            return replace(record.verified, snapshot=json.loads(canonical_json(record.verified.snapshot)))

        normalized_snapshot = canonicalize_proof_snapshot(snapshot) if snapshot is not None else None
        if normalized_snapshot is None:
            raise ProofUnavailable("proof unavailable")
        submitted_hash = hashlib.sha256(canonical_json(normalized_snapshot)).hexdigest()
        if not hmac.compare_digest(submitted_hash, snapshot_hash):
            raise ProofUnavailable("proof unavailable")
        expires_at = datetime.fromtimestamp(expires_at_epoch, timezone.utc).isoformat().replace("+00:00", "Z")
        return VerifiedProof(
            proof_id=proof_id,
            kid=kid,
            expires_at=expires_at,
            expires_at_epoch=expires_at_epoch,
            snapshot_hash=snapshot_hash,
            snapshot=normalized_snapshot,
            proof_digest=proof_digest(token),
        )


proof_registry = ProofRegistry()
