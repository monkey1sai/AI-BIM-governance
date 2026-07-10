"""stage_composition 跨服務鏡像契約守門（R5 2026-07-10 C4）。

同一個 openStageRequest.stage_composition 語意分佈在多個服務的手工鏡像：
完整鏡像（欄位級）＝kit-manager-api 建構端、streaming 消費端、coordinator 型別、
console overlay 型別；部分鏡像（token 級 pass-through）＝kit-manager-web、federation handoff。
權威文件：docs/contracts/streaming-datachannel-events.md。

本測試不改任何值（§1.7 逐字 echo），只防「單邊改名/刪欄」的靜默 drift——
任何一站點對 stage_composition 語意的變更都必須同步全部鏡像＋權威文件，否則此處紅燈。
"""
from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# 完整鏡像：必含 stage_composition 語意錨＋三個核心欄位 token。
FULL_MIRRORS = {
    "services/kit-manager-api/app/kit_service.py": ("stage_composition", "primary", "secondary", "load_order"),
    "bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py": ("stage_composition", "primary", "secondary", "load_order"),
    "bim-review-coordinator/src/types.ts": ("stage_composition", "load_order"),
    "web-viewer-sample/src/console/GovernanceOverlay.tsx": ("StageArtifactBinding", "primary", "secondary", "load_order"),
}

# 部分鏡像（pass-through / handoff）：至少保住語意錨 token，改名即紅燈。
TOKEN_MIRRORS = {
    "apps/kit-manager-web/src/models.ts": ("stage_composition",),
    "governance-service/federation/api.py": ("stage_composition",),
}

AUTHORITY_DOC = "docs/contracts/streaming-datachannel-events.md"


def _read(rel: str) -> str:
    return (REPO / rel).read_text(encoding="utf-8")


def test_full_mirrors_keep_core_fields():
    for rel, tokens in FULL_MIRRORS.items():
        text = _read(rel)
        missing = [t for t in tokens if t not in text]
        assert not missing, f"{rel} 缺 stage_composition 核心 token {missing}（鏡像 drift；同步全部鏡像＋權威文件後更新本表）"


def test_token_mirrors_keep_semantic_anchor():
    for rel, tokens in TOKEN_MIRRORS.items():
        text = _read(rel)
        missing = [t for t in tokens if t not in text]
        assert not missing, f"{rel} 缺語意錨 {missing}（pass-through 站點改名未同步）"


def test_authority_doc_declares_single_source():
    text = _read(AUTHORITY_DOC)
    assert "stage_composition" in text, "權威文件須涵蓋 stage_composition 語意"
    assert "單一真相" in text or "single source" in text.lower(), (
        "權威文件須自我聲明為 stage_composition 鏡像的單一真相（見 C4 升權威段）"
    )
