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

def test_apply_replaces_marker_region():
    text = "a\n// <routing:gen>\nOLD\n// </routing:gen>\nb\n"
    out = gen.apply_to_text(text, "// <routing:gen>\nNEW\n// </routing:gen>")
    assert "NEW" in out and "OLD" not in out and out.startswith("a\n") and out.endswith("b\n")
