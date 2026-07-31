import subprocess, json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = ROOT / ".claude/workflows/fu-adversarial-verify-generic.js"

def _extract(text, anchor):
    i = text.index(anchor); i = text.index("{", i); depth = 0
    for j in range(i, len(text)):
        if text[j] == "{": depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0: return text[i:j+1]
    raise AssertionError("unbalanced braces")

def _schema():
    lit = _extract(JS.read_text(encoding="utf-8"), "const VERDICT_SCHEMA =")
    # 親驗：裸 {…} vm 會 SyntaxError，必須 paren-wrap '('+lit+')'
    out = subprocess.run(
        ["node", "-e", "const vm=require('vm');process.stdout.write(JSON.stringify(vm.runInNewContext('('+process.argv[1]+')')))", lit],
        capture_output=True, text=True, check=True).stdout
    return json.loads(out)

def test_verdict_taxonomy_requires_evidence():
    s = _schema()
    assert set(s["required"]) == {
        "finding_id", "verdict", "disposition", "scope", "reason", "unblock_condition", "evidence"
    }
    assert s["properties"]["verdict"]["enum"] == [
        "confirmed", "adjusted", "refuted", "unverified"
    ]
    assert s["properties"]["disposition"]["enum"] == [
        "fix_now", "external_blocker", "known_gap", "follow_up", "none"
    ]
    assert s["properties"]["scope"]["enum"] == ["in_scope", "out_of_scope"]
    assert set(s["properties"]["unblock_condition"]["type"]) == {"string", "null"}
    ev = s["properties"]["evidence"]
    assert ev["type"] == "object" and ev.get("additionalProperties") is False
    assert set(ev["required"]) == {"file", "line", "quote"}
    lt = ev["properties"]["line"]["type"]
    assert "integer" in lt and "null" in lt   # 找不到行填 null，禁猜行號
