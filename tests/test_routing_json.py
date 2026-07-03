import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
RJSON = ROOT / ".claude/workflows/routing.json"

def test_routing_json_schema():
    data = json.loads(RJSON.read_text(encoding="utf-8"))
    tiers = data["tiers"]
    assert tiers["extract"]  == {"model": "haiku",  "effort": None, "note": tiers["extract"]["note"]}
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
