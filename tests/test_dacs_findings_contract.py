import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = ROOT / ".claude/workflows/fu-adversarial-verify-generic.js"


def test_findings_contract_landed():
    src = JS.read_text(encoding="utf-8")
    assert "bad_findings" in src, "缺 findings 輸入契約 held"
    assert "MAX_Q" in src, "缺 q 長度上限機械化"
    assert "MAX_FINDINGS = 32" in src, "缺 findings registry 總量上限"
    assert "MAX_VERIFIER_BATCHES = 2" in src, "缺 verifier batch 上限"
    assert "FINDINGS.map((f) => () =>" not in src, "不得維持一 finding 一 agent 的平行扇出"
