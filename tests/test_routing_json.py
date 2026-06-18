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
    allowed = data["allowed_efforts"]
    for name, t in tiers.items():
        assert t["effort"] in allowed[t["model"]], f"{name}: {t['effort']} not allowed for {t['model']}"
    assert data["flags"]["plan_author_xhigh"] is False
    assert "std-implement.js:276" in data["do_not_codegen"]
