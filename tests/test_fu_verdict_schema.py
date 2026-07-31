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

def _schema(anchor="const VERDICT_SCHEMA =", findings_count=0):
    lit = _extract(JS.read_text(encoding="utf-8"), anchor)
    # 親驗: 裸 {...} vm 會 SyntaxError, 必須 paren-wrap '('+lit+')'
    # CRITIC_SCHEMA 的 maxItems 引用 FINDINGS.length (剩餘容量), vm context 需一併供給。
    context = json.dumps({"MAX_FINDINGS": 32, "FINDINGS": [{}] * findings_count})
    out = subprocess.run(
        ["node", "-e", "const vm=require('vm');process.stdout.write(JSON.stringify(vm.runInNewContext('('+process.argv[1]+')',JSON.parse(process.argv[2]))))", lit, context],
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


def test_critic_schema_caps_issue_count():
    # maxItems 鎖在剩餘容量 (MAX_FINDINGS - FINDINGS.length), 與 prompt 的「最多 N 筆」同值。
    assert _schema("const CRITIC_SCHEMA =")["properties"]["issues"]["maxItems"] == 32
    assert _schema("const CRITIC_SCHEMA =", findings_count=5)["properties"]["issues"]["maxItems"] == 27
    assert _schema("const CRITIC_SCHEMA =", findings_count=31)["properties"]["issues"]["maxItems"] == 1
