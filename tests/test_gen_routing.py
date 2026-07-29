import copy
import importlib.util
import pathlib


ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("gen_routing", ROOT / "scripts/gen_routing.py")
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)


def _contract():
    return {
        "version": 1,
        "required_input_fields": ["Objective", "Scope", "Inputs", "Evidence", "Stop", "Output"],
        "native_output_headings": ["Scope", "Evidence", "Finding", "Uncertainty", "Risk", "Next step"],
        "workflow_schema_equivalence": {
            "Objective": "task", "Scope": "label", "Inputs": "payload",
            "Evidence": "schema", "Stop": "hold", "Output": "json",
        },
    }


def _valid_data():
    return {
        "tiers": {
            "extract": {"model": "haiku", "effort": "low", "fallback": [{"model": "sonnet", "effort": "medium"}]},
            "scan": {"model": "sonnet", "effort": "medium", "fallback": [{"model": "opus", "effort": "xhigh"}]},
            "standard": {"model": "sonnet", "effort": "xhigh", "fallback": [{"model": "opus", "effort": "xhigh"}]},
            "reason": {"model": "opus", "effort": "xhigh", "fallback": [{"model": "fable", "effort": "max"}]},
            "judge": {"model": "opus", "effort": "max", "fallback": [{"model": "fable", "effort": "max"}]},
            "arbiter": {"model": "fable", "effort": "max", "fallback": [], "on_unavailable": "HELD"},
        },
        "allowed_efforts": {
            "haiku": ["low"], "sonnet": ["medium", "xhigh"],
            "opus": ["xhigh", "max"], "fable": ["max"],
        },
        "flags": {"plan_author_xhigh": False},
        "prompt_contract": _contract(),
    }


def _assert_validate_raises(data):
    try:
        gen.validate(data)
        assert False, "should have raised"
    except ValueError:
        pass


def test_render_block_includes_apex_first_gate_and_semaphore():
    block = gen.render_block(_valid_data())
    assert "planAuthor: { model: 'fable', effort: 'max' }" in block
    assert "arbiter: { model: 'fable', effort: 'max' }" in block
    assert "const MAX_CHILD_CONCURRENCY = 2" in block
    assert "HELD: apex_unavailable_or_denied" in block
    assert "agentType: 'code-reviewer'" in block
    assert block.startswith("// <routing:gen>") and block.rstrip().endswith("// </routing:gen>")


def test_render_block_planauthor_flag_only_changes_plan_author():
    data = _valid_data()
    data["flags"]["plan_author_xhigh"] = True
    block = gen.render_block(data)
    assert "planAuthor: { model: 'opus', effort: 'xhigh' }" in block
    assert "arbiter: { model: 'fable', effort: 'max' }" in block


def test_validate_accepts_complete_contract():
    gen.validate(_valid_data())


def test_validate_rejects_illegal_effort():
    data = _valid_data()
    data["tiers"]["scan"]["effort"] = "high"
    _assert_validate_raises(data)


def test_validate_rejects_missing_required_tier():
    data = _valid_data()
    del data["tiers"]["scan"]
    _assert_validate_raises(data)


def test_validate_rejects_missing_secondary_fallback():
    data = _valid_data()
    data["tiers"]["scan"]["fallback"] = []
    _assert_validate_raises(data)


def test_validate_rejects_fallback_unknown_model():
    data = _valid_data()
    data["tiers"]["scan"]["fallback"] = [{"model": "gpt", "effort": "max"}]
    _assert_validate_raises(data)


def test_validate_rejects_fallback_illegal_effort():
    data = _valid_data()
    data["tiers"]["scan"]["fallback"] = [{"model": "opus", "effort": "low"}]
    _assert_validate_raises(data)


def test_validate_rejects_fallback_identical_to_primary():
    data = _valid_data()
    data["tiers"]["scan"]["fallback"] = [{"model": "sonnet", "effort": "medium"}]
    _assert_validate_raises(data)


def test_validate_rejects_apex_fallback_or_nonheld_policy():
    with_fallback = _valid_data()
    with_fallback["tiers"]["arbiter"]["fallback"] = [{"model": "opus", "effort": "max"}]
    _assert_validate_raises(with_fallback)
    no_hold = _valid_data()
    no_hold["tiers"]["arbiter"]["on_unavailable"] = "DEGRADED"
    _assert_validate_raises(no_hold)


def test_validate_rejects_prompt_contract_drift():
    data = _valid_data()
    data["prompt_contract"]["native_output_headings"][2] = "Findings"
    _assert_validate_raises(data)


def test_apply_replaces_only_marker_region_and_is_string_safe():
    text = "a\n// <routing:gen>\nOLD\n// </routing:gen>\nconst note = 'agent()';\nagent('task')\n"
    out = gen.apply_to_text(text, "// <routing:gen>\nNEW\n// </routing:gen>")
    assert "NEW" in out and "OLD" not in out
    assert "const note = 'agent()'" in out
    assert "agent('task')" in out
