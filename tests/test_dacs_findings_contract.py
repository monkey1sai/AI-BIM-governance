import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = ROOT / ".claude/workflows/fu-adversarial-verify-generic.js"


def test_findings_contract_landed():
    src = JS.read_text(encoding="utf-8")
    assert "bad_findings" in src, "缺 findings 輸入契約 held"
    assert "MAX_Q" in src, "缺 q 長度上限機械化"
