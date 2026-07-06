import importlib.util, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("gen_routing", ROOT / "scripts/gen_routing.py")
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)

def test_render_block_includes_planauthor_off():
    data = {"tiers": {"reason": {"model":"opus","effort":"xhigh"}, "judge":{"model":"opus","effort":"max"},
                      "arbiter": {"model":"fable","effort":"max"}},
            "allowed_efforts": {"opus":["xhigh","max"], "fable":["max"]}, "flags": {"plan_author_xhigh": False}}
    block = gen.render_block(data)
    assert "planAuthor: { model: 'fable', effort: 'max' }" in block
    assert "arbiter: { model: 'fable', effort: 'max' }" in block
    assert block.startswith("// <routing:gen>") and block.rstrip().endswith("// </routing:gen>")

def test_render_block_planauthor_on():
    data = {"tiers": {"reason": {"model":"opus","effort":"xhigh"}},
            "allowed_efforts": {"opus":["xhigh","max"]}, "flags": {"plan_author_xhigh": True}}
    assert "planAuthor: { model: 'opus', effort: 'xhigh' }" in gen.render_block(data)

def test_validate_rejects_illegal_effort():
    data = {"tiers": {"x": {"model":"sonnet","effort":"xhigh"}}, "allowed_efforts": {"sonnet":["high","max"]}}
    try:
        gen.validate(data); assert False, "should have raised"
    except ValueError:
        pass

def _fallback_base():
    return {"tiers": {"x": {"model":"sonnet","effort":"max","fallback":[{"model":"opus","effort":"max"}]}},
            "allowed_efforts": {"sonnet":["high","max"], "opus":["xhigh","max"]}}

def _assert_validate_raises(data):
    try:
        gen.validate(data); assert False, "should have raised"
    except ValueError:
        pass

def test_validate_accepts_legal_fallback():
    gen.validate(_fallback_base())

def test_validate_rejects_missing_fallback():
    data = _fallback_base(); del data["tiers"]["x"]["fallback"]
    _assert_validate_raises(data)

def test_validate_rejects_fallback_unknown_model():
    data = _fallback_base(); data["tiers"]["x"]["fallback"] = [{"model":"gpt","effort":"max"}]
    _assert_validate_raises(data)

def test_validate_rejects_fallback_illegal_effort():
    data = _fallback_base(); data["tiers"]["x"]["fallback"] = [{"model":"opus","effort":"low"}]
    _assert_validate_raises(data)

def test_validate_rejects_fallback_identical_to_primary():
    data = _fallback_base(); data["tiers"]["x"]["fallback"] = [{"model":"sonnet","effort":"max"}]
    _assert_validate_raises(data)

def test_apply_replaces_marker_region():
    text = "a\n// <routing:gen>\nOLD\n// </routing:gen>\nb\n"
    out = gen.apply_to_text(text, "// <routing:gen>\nNEW\n// </routing:gen>")
    assert "NEW" in out and "OLD" not in out and out.startswith("a\n") and out.endswith("b\n")
