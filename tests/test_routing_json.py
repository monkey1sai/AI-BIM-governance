import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
RJSON = ROOT / ".claude/workflows/routing.json"

def test_routing_json_schema():
    data = json.loads(RJSON.read_text(encoding="utf-8"))
    tiers = data["tiers"]
    assert tiers["extract"]  == {"model": "haiku",  "effort": None, "note": tiers["extract"]["note"],
                                 "fallback": [{"model": "sonnet", "effort": "high"}]}
    assert tiers["standard"]["model"] == "sonnet" and tiers["standard"]["effort"] == "max"
    assert tiers["reason"]["model"]   == "opus"   and tiers["reason"]["effort"]   == "xhigh"
    assert tiers["judge"]["model"]    == "opus"   and tiers["judge"]["effort"]    == "max"
    assert tiers["judge"].get("immutable") is True
    assert tiers["arbiter"]["model"]  == "fable"  and tiers["arbiter"]["effort"]  == "max"
    assert tiers["arbiter"].get("immutable") is True
    allowed = data["allowed_efforts"]
    assert allowed["fable"] == ["max"]
    for name, t in tiers.items():
        assert t["effort"] in allowed[t["model"]], f"{name}: {t['effort']} not allowed for {t['model']}"
    assert data["flags"]["plan_author_xhigh"] is False
    assert data["do_not_codegen"] == ["std-implement.js:288", "std-implement.js:294", "std-implement.js:300"]

def test_fallback_chains_pinned():
    # 供應中斷降落點逐字釘住（SKILL.md「供應例外，非品質降級」政策的機器可讀形式）
    data = json.loads(RJSON.read_text(encoding="utf-8"))
    tiers, allowed = data["tiers"], data["allowed_efforts"]
    assert tiers["arbiter"]["fallback"]  == [{"model": "opus",  "effort": "max"}]   # 2026-06-15 前科的正式化
    assert tiers["judge"]["fallback"]    == [{"model": "fable", "effort": "max"}]   # judge 不降，只可升
    assert tiers["standard"]["fallback"] == [{"model": "opus",  "effort": "max"}]   # 與 BLOCKED 升級通道同向
    assert tiers["reason"]["fallback"]   == [{"model": "fable", "effort": "max"}]
    assert data["fallback_policy"]
    for name, t in tiers.items():
        assert t.get("fallback"), f"{name}: 缺 fallback 鏈"
        for i, fb in enumerate(t["fallback"]):
            assert fb["effort"] in allowed[fb["model"]], f"{name}.fallback[{i}] 違反 allowed_efforts"
            assert (fb["model"], fb.get("effort")) != (t["model"], t.get("effort")), f"{name}.fallback[{i}] 與本階相同"
