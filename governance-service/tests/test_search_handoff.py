"""Governance 端 A4 3D handoff proof-set 驗證權威（tasks 6.1 governance 半部）。

spec（a4-semantic-search）：Governance-service SHALL 驗每個 signed proof 的
signature/snapshot/model/mapping 與 accepted prim；任一 invalid／mismatched proof
SHALL atomic reject 整個 focus/highlight handoff，不得 silent drop；任一 proof 已
過期時拒絕建立；handoff URL/payload 不得含 query text、evidence snapshot、prim
以外的 host/mapping path 或 proof token。

Proof 簽章權威（ProofRegistry）由 §2.8/2.9 切片提供；本測試依既有 fake-LLM 慣例
以 fake authority 注入，不打真實端點、不讀 .env。
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Optional

import pytest

from search.handoff import (
    MAX_HIGHLIGHT_ROWS,
    HandoffVerification,
    ProofRejected,
    verify_handoff_evidence,
)


NOW = 1_800_000_000.0


@dataclass(frozen=True)
class FakeVerifiedProof:
    """鏡射 §2.8/2.9 proof 權威 verify() 回傳面（proofs.VerifiedProof 的子集）。"""

    proof_id: str
    expires_at: str
    expires_at_epoch: float
    snapshot: dict[str, Any]


@dataclass
class FakeAuthority:
    """token -> VerifiedProof 或 exception；記錄呼叫順序供 fail-closed 斷言。"""

    proofs: dict[str, Any] = field(default_factory=dict)
    calls: list[str] = field(default_factory=list)

    def verify(self, token: str, *, now: Optional[float] = None):
        self.calls.append(token)
        outcome = self.proofs.get(token)
        if isinstance(outcome, Exception):
            raise outcome
        if outcome is None:
            raise ProofRejected("proof_invalid")
        return outcome


def _binding(**overrides: str) -> dict[str, str]:
    binding = {
        "session_id": "sess_1",
        "principal": "user_a",
        "model_version_id": "mv_1",
        "model_artifact": "artifact_1",
        "active_binding_revision": "rev_1",
    }
    binding.update(overrides)
    return binding


def _snapshot(
    *,
    prim: Optional[str] = "/World/Doors/Door_001",
    highlight_eligible: bool = True,
    guid: str = "2O2Fr$t4X7Zf8NOew3FLOH",
    session_id: str = "sess_1",
    principal: str = "user_a",
    model_version_id: str = "mv_1",
    model_artifact: str = "artifact_1",
    active_binding_revision: str = "rev_1",
    session_binding_extra: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    session_binding: dict[str, Any] = {
        "session_id": session_id,
        "principal": principal,
        "model_artifact": model_artifact,
        "active_binding_revision": active_binding_revision,
    }
    if session_binding_extra:
        session_binding.update(session_binding_extra)
    return {
        "schema_version": 1,
        "query_id": "a4q_handoff_fixture_0001",
        "query": "四樓防火門",
        "normalized_filters": {"ifc_classes": ["IfcDoor"]},
        "model_version_id": model_version_id,
        "session_binding": session_binding,
        "row": {
            "ifc_guid": guid,
            "usd_prim_path": prim,
            "highlight_eligible": highlight_eligible,
        },
    }


def _verified(
    token_id: str,
    *,
    expires_in: float = 300.0,
    snapshot: Optional[dict[str, Any]] = None,
) -> FakeVerifiedProof:
    return FakeVerifiedProof(
        proof_id=token_id,
        expires_at="2027-01-15T08:00:00Z",
        expires_at_epoch=NOW + expires_in,
        snapshot=snapshot if snapshot is not None else _snapshot(),
    )


def _authority_for(*entries: tuple[str, Any]) -> FakeAuthority:
    return FakeAuthority(proofs=dict(entries))


# ---------------------------------------------------------------------------
# Happy paths
# ---------------------------------------------------------------------------


def test_focus_accepts_single_mapped_proof():
    token = "a4p.kid1.focus_row.deadbeef"
    authority = _authority_for((token, _verified("p1")))
    result = verify_handoff_evidence(
        action="focus",
        proof_tokens=[token],
        binding=_binding(),
        authority=authority,
        now=NOW,
    )
    assert isinstance(result, HandoffVerification)
    assert result.accepted is True
    assert result.code is None
    assert result.action == "focus"
    assert len(result.rows) == 1
    row = result.rows[0]
    # Trusted prim 一律取自 verified snapshot，不接受 client 提供值。
    assert row.prim_path == "/World/Doors/Door_001"
    assert row.ifc_guid == "2O2Fr$t4X7Zf8NOew3FLOH"
    assert row.proof_id == "p1"
    assert result.min_proof_expires_at_epoch == pytest.approx(NOW + 300.0)


def test_highlight_accepts_rows_in_request_order_with_earliest_expiry():
    t1, t2, t3 = "a4p.k.r1.aa", "a4p.k.r2.bb", "a4p.k.r3.cc"
    authority = _authority_for(
        (t1, _verified("p1", expires_in=300.0, snapshot=_snapshot(prim="/World/A"))),
        (t2, _verified("p2", expires_in=120.0, snapshot=_snapshot(prim="/World/B"))),
        (t3, _verified("p3", expires_in=600.0, snapshot=_snapshot(prim="/World/C"))),
    )
    result = verify_handoff_evidence(
        action="highlight",
        proof_tokens=[t1, t2, t3],
        binding=_binding(),
        authority=authority,
        now=NOW,
    )
    assert result.accepted is True
    assert [r.prim_path for r in result.rows] == ["/World/A", "/World/B", "/World/C"]
    # spec：expires_at 取全部 proof expiry 的最小值（coordinator 再與 TTL 取 min）。
    assert result.min_proof_expires_at_epoch == pytest.approx(NOW + 120.0)


# ---------------------------------------------------------------------------
# Fail closed：權威缺席、request 形狀
# ---------------------------------------------------------------------------


def test_missing_authority_fails_closed_without_rows():
    result = verify_handoff_evidence(
        action="focus",
        proof_tokens=["a4p.k.r1.aa"],
        binding=_binding(),
        authority=None,
        now=NOW,
    )
    assert result.accepted is False
    assert result.code == "handoff_authority_unavailable"
    assert result.rows == ()
    assert result.min_proof_expires_at_epoch is None


def test_unknown_action_rejected():
    authority = _authority_for(("a4p.k.r1.aa", _verified("p1")))
    result = verify_handoff_evidence(
        action="navigate",
        proof_tokens=["a4p.k.r1.aa"],
        binding=_binding(),
        authority=authority,
        now=NOW,
    )
    assert result.accepted is False
    assert result.code == "invalid_action"
    assert authority.calls == []


@pytest.mark.parametrize("tokens", [[], ["a4p.k.r1.aa", "a4p.k.r2.bb"]])
def test_focus_requires_exactly_one_proof(tokens):
    authority = FakeAuthority()
    result = verify_handoff_evidence(
        action="focus", proof_tokens=tokens, binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "invalid_row_count"
    assert authority.calls == []


def test_highlight_row_count_bounds():
    authority = FakeAuthority()
    empty = verify_handoff_evidence(
        action="highlight", proof_tokens=[], binding=_binding(), authority=authority, now=NOW
    )
    assert empty.accepted is False and empty.code == "invalid_row_count"

    too_many = [f"a4p.k.r{i}.sig{i}" for i in range(MAX_HIGHLIGHT_ROWS + 1)]
    result = verify_handoff_evidence(
        action="highlight", proof_tokens=too_many, binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "invalid_row_count"
    assert authority.calls == []


def test_duplicate_proof_tokens_rejected_atomically():
    token = "a4p.k.r1.aa"
    authority = _authority_for((token, _verified("p1")))
    result = verify_handoff_evidence(
        action="highlight",
        proof_tokens=[token, token],
        binding=_binding(),
        authority=authority,
        now=NOW,
    )
    assert result.accepted is False
    assert result.code == "duplicate_proof"
    assert result.rows == ()
    assert authority.calls == []


@pytest.mark.parametrize("bad_token", ["", None, 42])
def test_malformed_token_rejected_before_verification(bad_token):
    good = "a4p.k.r1.aa"
    authority = _authority_for((good, _verified("p1")))
    result = verify_handoff_evidence(
        action="highlight",
        proof_tokens=[good, bad_token],
        binding=_binding(),
        authority=authority,
        now=NOW,
    )
    assert result.accepted is False
    assert result.code == "proof_invalid"
    assert result.failed_index == 1
    assert authority.calls == []


@pytest.mark.parametrize(
    "binding",
    [
        {},
        {"session_id": "sess_1", "principal": "user_a"},  # 缺 model_version_id
        {"session_id": "", "principal": "user_a", "model_version_id": "mv_1"},
        {"session_id": "sess_1", "principal": 7, "model_version_id": "mv_1"},
        "not-a-dict",
        {  # 缺 model_artifact（不得因 caller 省略而放行寬鬆綁定）
            "session_id": "sess_1",
            "principal": "user_a",
            "model_version_id": "mv_1",
            "active_binding_revision": "rev_1",
        },
        {  # 缺 active_binding_revision
            "session_id": "sess_1",
            "principal": "user_a",
            "model_version_id": "mv_1",
            "model_artifact": "artifact_1",
        },
    ],
)
def test_invalid_binding_rejects_before_any_verification(binding):
    authority = _authority_for(("a4p.k.r1.aa", _verified("p1")))
    result = verify_handoff_evidence(
        action="focus",
        proof_tokens=["a4p.k.r1.aa"],
        binding=binding,
        authority=authority,
        now=NOW,
    )
    assert result.accepted is False
    assert result.code == "invalid_binding"
    assert authority.calls == []


# ---------------------------------------------------------------------------
# Atomic reject：proof 驗證與 snapshot/binding/mapping 檢查
# ---------------------------------------------------------------------------


def test_one_invalid_proof_rejects_whole_set():
    t1, t2, t3 = "a4p.k.r1.aa", "a4p.k.r2.bb", "a4p.k.r3.cc"
    authority = _authority_for(
        (t1, _verified("p1", snapshot=_snapshot(prim="/World/A"))),
        (t2, ProofRejected("proof_invalid")),
        (t3, _verified("p3", snapshot=_snapshot(prim="/World/C"))),
    )
    result = verify_handoff_evidence(
        action="highlight",
        proof_tokens=[t1, t2, t3],
        binding=_binding(),
        authority=authority,
        now=NOW,
    )
    assert result.accepted is False
    assert result.code == "proof_invalid"
    assert result.failed_index == 1
    assert result.rows == ()  # 不得 silent drop 局部成功列


def test_expired_proof_rejects_creation():
    token = "a4p.k.r1.aa"
    authority = _authority_for((token, ProofRejected("proof_expired")))
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "proof_expired"


def test_defensively_rejects_verified_proof_already_past_expiry():
    token = "a4p.k.r1.aa"
    authority = _authority_for((token, _verified("p1", expires_in=-1.0)))
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "proof_expired"


@pytest.mark.parametrize("bad_epoch", [math.nan, math.inf, -math.inf])
def test_non_finite_proof_expiry_rejected(bad_epoch):
    """proof 權威若回傳 NaN/Infinity expiry，SHALL 結構化拒絕而非讓後續 _iso_utc()
    未捕捉拋錯（finding C）。"""
    token = "a4p.k.r1.aa"
    malformed = FakeVerifiedProof(
        proof_id="p1",
        expires_at="2027-01-15T08:00:00Z",
        expires_at_epoch=bad_epoch,
        snapshot=_snapshot(),
    )
    authority = _authority_for((token, malformed))
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "proof_invalid"
    assert result.rows == ()


def test_unexpected_authority_error_fails_closed():
    token = "a4p.k.r1.aa"
    authority = _authority_for((token, RuntimeError("boom")))
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "proof_invalid"
    assert result.rows == ()


def test_cross_session_binding_mismatch_rejected():
    token = "a4p.k.r1.aa"
    authority = _authority_for(
        (token, _verified("p1", snapshot=_snapshot(session_id="sess_other")))
    )
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "binding_mismatch"


def test_cross_principal_binding_mismatch_rejected():
    token = "a4p.k.r1.aa"
    authority = _authority_for(
        (token, _verified("p1", snapshot=_snapshot(principal="user_b")))
    )
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "binding_mismatch"


def test_model_version_mismatch_rejected():
    token = "a4p.k.r1.aa"
    authority = _authority_for(
        (token, _verified("p1", snapshot=_snapshot(model_version_id="mv_stale")))
    )
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "binding_mismatch"


def test_session_binding_missing_in_snapshot_rejected():
    token = "a4p.k.r1.aa"
    snapshot = _snapshot()
    del snapshot["session_binding"]
    authority = _authority_for((token, _verified("p1", snapshot=snapshot)))
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "binding_mismatch"


def test_artifact_and_revision_always_compared():
    """model_artifact／active_binding_revision 為必填欄位，恆逐字比對（finding A）。"""
    token = "a4p.k.r1.aa"
    matching = _authority_for(
        (
            token,
            _verified(
                "p1",
                snapshot=_snapshot(
                    session_binding_extra={
                        "model_artifact": "artifact_7",
                        "active_binding_revision": "rev_3",
                    }
                ),
            ),
        )
    )
    ok = verify_handoff_evidence(
        action="focus",
        proof_tokens=[token],
        binding=_binding(model_artifact="artifact_7", active_binding_revision="rev_3"),
        authority=matching,
        now=NOW,
    )
    assert ok.accepted is True

    stale = verify_handoff_evidence(
        action="focus",
        proof_tokens=[token],
        binding=_binding(model_artifact="artifact_7", active_binding_revision="rev_4"),
        authority=matching,
        now=NOW,
    )
    assert stale.accepted is False
    assert stale.code == "binding_mismatch"


def test_unmapped_row_rejected():
    token = "a4p.k.r1.aa"
    authority = _authority_for(
        (token, _verified("p1", snapshot=_snapshot(prim=None, highlight_eligible=False)))
    )
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "row_not_mapped"


def test_highlight_ineligible_row_rejected_even_with_prim():
    token = "a4p.k.r1.aa"
    authority = _authority_for(
        (token, _verified("p1", snapshot=_snapshot(highlight_eligible=False)))
    )
    result = verify_handoff_evidence(
        action="highlight", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "row_not_mapped"


@pytest.mark.parametrize(
    "prim",
    [
        "relative/path",
        "../escape",
        "/bad prim",
        "/",
        "",
        "/trailing/",
        "/a//b",
        "/World/123Bad",  # segment 首字元為數字：USD 不合法識別字（finding D）
    ],
)
def test_malformed_prim_path_rejected(prim):
    token = "a4p.k.r1.aa"
    authority = _authority_for((token, _verified("p1", snapshot=_snapshot(prim=prim))))
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    assert result.accepted is False
    assert result.code == "row_prim_invalid"


def test_duplicate_prim_across_proofs_rejected():
    t1, t2 = "a4p.k.r1.aa", "a4p.k.r2.bb"
    authority = _authority_for(
        (t1, _verified("p1", snapshot=_snapshot(prim="/World/A"))),
        (t2, _verified("p2", snapshot=_snapshot(prim="/World/A"))),
    )
    result = verify_handoff_evidence(
        action="highlight",
        proof_tokens=[t1, t2],
        binding=_binding(),
        authority=authority,
        now=NOW,
    )
    assert result.accepted is False
    assert result.code == "duplicate_prim"
    assert result.failed_index == 1


# ---------------------------------------------------------------------------
# Payload 消毒
# ---------------------------------------------------------------------------


def test_payload_contains_no_token_query_or_secret_material():
    token = "a4p.kid1.super_opaque_row.aabbccdd"
    authority = _authority_for((token, _verified("p1")))
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    payload = result.to_payload()
    encoded = json.dumps(payload, ensure_ascii=False)
    assert token not in encoded
    assert "a4p." not in encoded
    assert "四樓防火門" not in encoded  # 不外洩 query text
    for forbidden in (
        "api_key",
        "authorization",
        "ifc_source_path",
        "element_mapping_path",
        "normalized_filters",
        "snapshot",
    ):
        assert forbidden not in encoded
    assert payload["accepted"] is True
    assert payload["rows"][0]["prim_path"] == "/World/Doors/Door_001"
    assert payload["rows"][0]["proof_id"] == "p1"


def test_rejection_payload_is_sanitized_and_row_free():
    token = "a4p.k.r1.aa"
    authority = _authority_for((token, ProofRejected("proof_expired")))
    result = verify_handoff_evidence(
        action="focus", proof_tokens=[token], binding=_binding(), authority=authority, now=NOW
    )
    payload = result.to_payload()
    assert payload["accepted"] is False
    assert payload["code"] == "proof_expired"
    assert payload["rows"] == []
    assert "a4p." not in json.dumps(payload)
