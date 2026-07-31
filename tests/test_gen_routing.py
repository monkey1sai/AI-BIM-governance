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
    assert 'planAuthor: { model: "fable", effort: "max" }' in block
    assert 'arbiter: { model: "fable", effort: "max" }' in block
    assert "const MAX_CHILD_CONCURRENCY = 2" in block
    assert "HELD: apex_unavailable_or_denied" in block
    assert "agentType: 'code-reviewer'" in block
    assert "outputSchema: schema" in block
    assert "coordinator holds on denial" in block
    assert "if (!schema) return Promise.resolve(false)" in block
    assert block.startswith("// <routing:gen>") and block.rstrip().endswith("// </routing:gen>")


def test_apex_gate_schema_property_keys_are_api_safe():
    # #455 回歸:StructuredOutput property keys 必須符合 ^[a-zA-Z0-9_.-]{1,64}$;
    # 含空格的 key(如舊 'Next step')會被 API 400 拒收 → synthetic apex gate 永遠失敗。
    # schema 物件閉括號在第 0 欄,properties 的縮排 '  },' 不會誤中 → 覆蓋整個 schema。
    import re as _re
    block = gen.render_block(_valid_data())
    start = block.index("const APEX_GATE_SCHEMA = {")
    end = block.index("\n}", start)
    schema_text = block[start:end]
    required_line = next(l for l in schema_text.splitlines() if l.strip().startswith("required:"))
    required_keys = _re.findall(r"'([^']*)'", required_line)
    prop_keys = [a or b for a, b in _re.findall(r"(?:'([^']+)'|\b([A-Za-z_][A-Za-z0-9_]*))\s*:\s*\{ type:", schema_text)]
    assert len(required_keys) >= 7, f"required 陣列覆蓋不足: {required_keys}"
    assert len(prop_keys) >= 7, f"properties 覆蓋不足(僅抓到 {prop_keys};舊版守門只覆蓋第一個 property 即此類問題)"
    for key in required_keys + prop_keys:
        assert _re.fullmatch(r"[a-zA-Z0-9_.-]{1,64}", key), f"API-unsafe schema key: {key!r}"


def test_render_block_planauthor_flag_only_changes_plan_author():
    data = _valid_data()
    data["flags"]["plan_author_xhigh"] = True
    block = gen.render_block(data)
    assert 'planAuthor: { model: "opus", effort: "xhigh" }' in block
    assert 'arbiter: { model: "fable", effort: "max" }' in block


def test_validate_accepts_complete_contract():
    gen.validate(_valid_data())


def test_validate_rejects_illegal_effort():
    data = _valid_data()
    data["tiers"]["scan"]["effort"] = "high"
    _assert_validate_raises(data)


def test_validate_rejects_registry_attempt_to_expand_model_enum():
    data = _valid_data()
    data["allowed_efforts"]["attacker-model"] = ["max"]
    _assert_validate_raises(data)


def test_entry_uses_json_string_literals_for_untrusted_values():
    model = 'fable" }; globalThis.injected = true; //'
    effort = 'max" }; throw new Error("injected") //'
    entry = gen._entry(model, effort)
    assert f"model: {gen.json.dumps(model)}" in entry
    assert f"effort: {gen.json.dumps(effort)}" in entry


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
