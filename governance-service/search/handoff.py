"""Governance 端 A4 3D handoff proof-set 驗證權威。

spec（a4-semantic-search「A4 3D handoff、focus 與 highlight SHALL 明確、可關聯且限
primary」）：Governance-service SHALL 驗每個 signed proof 的 signature/snapshot/
model/mapping 與 accepted prim，但 SHALL NOT 成為 current Kit stage authority。
短效 handoff intent store、principal/lease 重授權與 `/ui/open` URL 屬 coordinator
（tasks 6.1 的另一半）；本模組不儲存任何 intent、不建立 query history。

邊界與 fail-closed 原則：
- Proof 簽章權威（§2.8/2.9 的 ProofRegistry）尚未在本分支合併，因此以
  ``ProofAuthority`` 接縫注入；``authority=None`` 一律拒絕（fail closed），不得
  假設 proof 有效。未來接線只需一個把 ``ProofUnavailable``/``ProofExpired`` 映射為
  :class:`ProofRejected` 的薄 adapter。
- 任一 invalid／mismatched／expired proof SHALL atomic reject 整組，不得 silent
  drop 局部成功列。
- Trusted prim path 一律取自 verified snapshot（``row.usd_prim_path``），永不接受
  client 提供值；輸出 payload 不含 proof token、query text 或 evidence snapshot。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from time import time as _time
from typing import Any, Optional, Protocol


HANDOFF_FOCUS = "focus"
HANDOFF_HIGHLIGHT = "highlight"
HANDOFF_ACTIONS = (HANDOFF_FOCUS, HANDOFF_HIGHLIGHT)

# Bounded transient intent（spec：bounded expiry/consumption policy）。單次 highlight
# handoff 的列數上限；超出即整組拒絕，不得截斷後部分執行。
MAX_HIGHLIGHT_ROWS = 64

REQUIRED_BINDING_FIELDS = ("session_id", "principal", "model_version_id")
# binding 若帶出這些欄位（coordinator resolve 的 current artifact/revision），
# snapshot 的 session_binding 必須逐字相符。
OPTIONAL_BINDING_FIELDS = ("model_artifact", "active_binding_revision")

MAX_PRIM_PATH_CHARS = 512
# USD prim path：絕對路徑、僅識別字元的 segment，不允許空 segment 或尾端斜線。
_PRIM_RE = re.compile(r"^/[A-Za-z0-9_]+(?:/[A-Za-z0-9_]+)*$")


class ProofRejected(Exception):
    """Proof 權威對單一 token 的結構化拒絕。

    ``code`` 只允許 sanitized 分類（例如 ``proof_invalid``／``proof_expired``），
    不得攜帶 upstream 內容。§2.8/2.9 adapter 負責把 ``ProofUnavailable``／
    ``ProofExpired`` 映射到這裡。
    """

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code if code in ("proof_invalid", "proof_expired") else "proof_invalid"


class VerifiedRowProof(Protocol):
    """Proof 權威 verify() 需提供的最小表面（proofs.VerifiedProof 的子集）。"""

    proof_id: str
    expires_at: str
    expires_at_epoch: float
    snapshot: dict[str, Any]


class ProofAuthority(Protocol):
    def verify(self, token: str, *, now: Optional[float] = None) -> VerifiedRowProof: ...


@dataclass(frozen=True)
class HandoffRow:
    """單列 trusted evidence：只保留 handoff 所需、可外露的欄位。"""

    proof_id: str
    ifc_guid: Optional[str]
    prim_path: str
    proof_expires_at: str
    proof_expires_at_epoch: float


@dataclass(frozen=True)
class HandoffVerification:
    accepted: bool
    action: str
    code: Optional[str]
    failed_index: Optional[int]
    rows: tuple[HandoffRow, ...]
    min_proof_expires_at: Optional[str]
    min_proof_expires_at_epoch: Optional[float]

    def to_payload(self) -> dict[str, Any]:
        """Sanitized 序列化：無 token、query text、snapshot 或 host/mapping path。"""
        return {
            "accepted": self.accepted,
            "action": self.action,
            "code": self.code,
            "failed_index": self.failed_index,
            "min_proof_expires_at": self.min_proof_expires_at,
            "rows": [
                {
                    "proof_id": row.proof_id,
                    "ifc_guid": row.ifc_guid,
                    "prim_path": row.prim_path,
                    "proof_expires_at": row.proof_expires_at,
                }
                for row in self.rows
            ],
        }


def _reject(action: str, code: str, failed_index: Optional[int] = None) -> HandoffVerification:
    return HandoffVerification(
        accepted=False,
        action=action if action in HANDOFF_ACTIONS else "invalid",
        code=code,
        failed_index=failed_index,
        rows=(),
        min_proof_expires_at=None,
        min_proof_expires_at_epoch=None,
    )


def _iso_utc(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace("+00:00", "Z")


def _valid_binding(binding: Any) -> bool:
    if not isinstance(binding, dict):
        return False
    for field_name in REQUIRED_BINDING_FIELDS:
        value = binding.get(field_name)
        if not isinstance(value, str) or not value.strip():
            return False
    for field_name in OPTIONAL_BINDING_FIELDS:
        if field_name in binding:
            value = binding.get(field_name)
            if not isinstance(value, str) or not value.strip():
                return False
    return True


def _valid_prim(prim: Any) -> bool:
    return (
        isinstance(prim, str)
        and len(prim) <= MAX_PRIM_PATH_CHARS
        and _PRIM_RE.fullmatch(prim) is not None
    )


def _binding_matches(snapshot: dict[str, Any], binding: dict[str, str]) -> bool:
    """Snapshot 的 model/session binding 必須與 coordinator resolve 的 binding 相符。"""
    if snapshot.get("model_version_id") != binding["model_version_id"]:
        return False
    session_binding = snapshot.get("session_binding")
    if not isinstance(session_binding, dict):
        return False
    if session_binding.get("session_id") != binding["session_id"]:
        return False
    if session_binding.get("principal") != binding["principal"]:
        return False
    for field_name in OPTIONAL_BINDING_FIELDS:
        if field_name in binding and session_binding.get(field_name) != binding[field_name]:
            return False
    return True


def verify_handoff_evidence(
    *,
    action: str,
    proof_tokens: Any,
    binding: Any,
    authority: Optional[ProofAuthority],
    now: Optional[float] = None,
) -> HandoffVerification:
    """驗證一組 signed row proofs 是否可支持一個 focus/highlight handoff。

    全部檢查採 atomic reject：任何一列失敗即回 ``accepted=False`` 且 ``rows=()``。
    成功時回傳 request 順序的 trusted rows 與全組 proof expiry 的最小值，供
    coordinator 以 ``min(configured TTL, min_proof_expires_at)`` 設定 handoff
    expiry。本函式不儲存任何狀態。
    """
    current = _time() if now is None else now

    if action not in HANDOFF_ACTIONS:
        return _reject(action, "invalid_action")

    if not isinstance(proof_tokens, (list, tuple)):
        return _reject(action, "invalid_row_count")
    count = len(proof_tokens)
    if action == HANDOFF_FOCUS and count != 1:
        return _reject(action, "invalid_row_count")
    if action == HANDOFF_HIGHLIGHT and not (1 <= count <= MAX_HIGHLIGHT_ROWS):
        return _reject(action, "invalid_row_count")

    for index, token in enumerate(proof_tokens):
        if not isinstance(token, str) or not token.strip():
            return _reject(action, "proof_invalid", failed_index=index)
    if len(set(proof_tokens)) != count:
        return _reject(action, "duplicate_proof")

    if not _valid_binding(binding):
        return _reject(action, "invalid_binding")

    if authority is None:
        return _reject(action, "handoff_authority_unavailable")

    rows: list[HandoffRow] = []
    seen_prims: set[str] = set()
    for index, token in enumerate(proof_tokens):
        try:
            verified = authority.verify(token, now=current)
        except ProofRejected as exc:
            return _reject(action, exc.code, failed_index=index)
        except Exception:
            # 未預期的權威失敗一律 fail closed，不外露 upstream 內容。
            return _reject(action, "proof_invalid", failed_index=index)

        snapshot = getattr(verified, "snapshot", None)
        expires_at_epoch = getattr(verified, "expires_at_epoch", None)
        proof_id = getattr(verified, "proof_id", None)
        if (
            not isinstance(snapshot, dict)
            or not isinstance(proof_id, str)
            or not proof_id
            or not isinstance(expires_at_epoch, (int, float))
        ):
            return _reject(action, "proof_invalid", failed_index=index)
        # 防衛性過期檢查：權威應已擋掉，仍不得放行（spec：任一 proof 已過期時拒絕建立）。
        if float(expires_at_epoch) <= current:
            return _reject(action, "proof_expired", failed_index=index)

        if not _binding_matches(snapshot, binding):
            return _reject(action, "binding_mismatch", failed_index=index)

        row = snapshot.get("row")
        if not isinstance(row, dict):
            return _reject(action, "proof_invalid", failed_index=index)
        prim = row.get("usd_prim_path")
        if row.get("highlight_eligible") is not True or prim is None:
            return _reject(action, "row_not_mapped", failed_index=index)
        if not _valid_prim(prim):
            return _reject(action, "row_prim_invalid", failed_index=index)
        if prim in seen_prims:
            return _reject(action, "duplicate_prim", failed_index=index)
        seen_prims.add(prim)

        guid = row.get("ifc_guid")
        rows.append(
            HandoffRow(
                proof_id=proof_id,
                ifc_guid=guid if isinstance(guid, str) and guid else None,
                prim_path=prim,
                proof_expires_at=_iso_utc(float(expires_at_epoch)),
                proof_expires_at_epoch=float(expires_at_epoch),
            )
        )

    min_epoch = min(row.proof_expires_at_epoch for row in rows)
    return HandoffVerification(
        accepted=True,
        action=action,
        code=None,
        failed_index=None,
        rows=tuple(rows),
        min_proof_expires_at=_iso_utc(min_epoch),
        min_proof_expires_at_epoch=min_epoch,
    )
