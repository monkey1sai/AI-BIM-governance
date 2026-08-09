import json
import pathlib
import re
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".claude/workflows"


def _read(name):
    return (WF / name).read_text(encoding="utf-8")


def test_codegen_no_drift():
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/gen_routing.py"), "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"routing drift: {result.stdout}{result.stderr}"


# 每個 label 前綴 -> 期望 tier；call-site 必須 spread 對的 ROUTING.<tier>。
EXPECTED = {
    "std-plan.js": {"plan:author": "planAuthor", "plan-review:": "standard", "plan-fix:": "judge", "impact:prescan": "standard"},
    "std-implement.js": {
        "parse:plan": "extract", "impact:${T}": "standard", "spec-review:": "standard",
        "spec-fix:": "judge", "quality-review:": "standard", "quality-fix:": "judge",
        "final-review": "arbiter", "fix:cycle": "judge", "fix:verify": "judge",
    },
    "std-evidence.js": {"probe:engine": "extract", "evidence:": "arbiter"},
    "std-evidence-closeout.js": {"closeout:execute:": "standard", "closeout:verify:": "judge"},
    "fable5-repo-advisory.js": {"scan:": "scan", "merge-dedup": "reason", "verify:": "reason", "completeness-critic": "arbiter"},
    "fu-adversarial-verify-generic.js": {"verify-batch:": "judge", "critic:": "arbiter"},
    "mapping-coverage-loop.js": {
        "plan:coverage": "arbiter", "baseline": "standard", "buckets:r": "standard",
        "measure:r": "standard", "gate:r": "extract", "confirm:": "standard", "report": "standard",
    },
    "plan-next-spec-to-done-aware.js": {
        "plans:phasing-rules": "scan", "plans:boundaries-contracts": "scan", "plans:ia-sequences-data": "scan",
        "repo:frontend-routes": "scan", "repo:backend-capabilities": "scan", "repo:merged-and-inflight": "scan",
        "synthesize:gap-analysis": "arbiter", "verify:": "reason",
    },
    "plan-test-deploy-and-tidy.js": {"deploy-path": "arbiter", "features-enabled-gap": "reason", "param-config-inventory": "scan", "scattered-files": "extract"},
    "repo-health-scan.js": {"scan:${s.key}": "scan", "scan:progress": "arbiter"},
    "spec-to-done-adversarial-verify.js": {"verify:compliance": "arbiter", "verify:technical": "judge", "verify:usability": "judge", "verify:resilience": "judge"},
    "token-strategy-tournament.js": {
        "plan:tournament": "arbiter", "read:": "standard", "design:": "reason",
        "judge:": "judge", "synthesize": "reason",
    },
}


# User-directed cost variants: the user's explicit model directive (haiku/sonnet
# only) is the routing authority for these files, so they are deliberately NOT
# wired into the apex-first ROUTING codegen. They stay in the inventory so a new
# agent workflow cannot appear unlisted, and a dedicated test pins the directive
# so the file cannot silently regain apex-tier models or fake the governed shape.
USER_DIRECTED_COST_VARIANTS = {"tri-adversarial-verify-haiku-sonnet.js"}


def test_every_active_agent_workflow_is_in_routing_inventory():
    retired = {"saas-blueprint-tournament.js"}
    workflows = list(WF.glob("*.js"))
    assert {p.name for p in workflows if p.name in retired} == retired
    active = {
        p.name for p in workflows
        if p.name not in retired and re.search(r"\b(?:agent|governedAgent)\s*\(", p.read_text(encoding="utf-8"))
    }
    expected = set(EXPECTED) | USER_DIRECTED_COST_VARIANTS
    assert active == expected, f"active workflow routing inventory drift: active={sorted(active)} expected={sorted(expected)}"


def test_user_directed_cost_variants_declare_their_directive():
    assert not USER_DIRECTED_COST_VARIANTS & set(EXPECTED), "a workflow cannot be both governed and user-directed"
    for name in USER_DIRECTED_COST_VARIANTS:
        content = _read(name)
        # The exemption exists only for an explicit user model directive; the file
        # must carry it where the next reader (and this pin) can see it.
        assert "user-directed" in content, f"{name}: missing the user-directed directive marker"
        # It is not part of the governed codegen family and must not pretend to be.
        assert "governedAgent" not in content, f"{name}: user-directed variant must not fake the governed shape"
        assert "// <routing:gen>" not in content, f"{name}: user-directed variant must not carry codegen markers"
        # The directive is haiku/sonnet only; apex-tier model literals would mean
        # the file outgrew its exemption and belongs in EXPECTED instead.
        assert not re.search(r"model:\s*['\"](?:opus|fable)['\"]", content), (
            f"{name}: apex-tier model literal found; the cost-variant exemption no longer applies"
        )
        # Model routing flows through variables, so the literal check above alone
        # could be bypassed by editing the tier tables. Pin the dynamic sources
        # too: the tier list, the effort table, the refuter, and the apex line.
        assert "const TIERS = ['haiku', 'sonnet']" in content, f"{name}: tier table drifted"
        assert "const TIER_EFFORT = { haiku: 'low', sonnet: 'high' }" in content, (
            f"{name}: tier effort table drifted"
        )
        assert "const refuterModel = 'sonnet'" in content, f"{name}: refuter model drifted"
        assert "model: 'sonnet', effort: 'max'" in content, f"{name}: apex routing drifted"


def test_every_execution_path_is_apex_first_and_concurrency_bounded():
    for name in EXPECTED:
        content = _read(name)
        marker_end = content.index("// </routing:gen>")
        first_call = content.index("governedAgent(", marker_end)
        assert content.index("const RAW_AGENT = agent") < first_call
        assert "const MAX_CHILD_CONCURRENCY = 2" in content
        assert "const startSyntheticApex = (prompt, options = {})" in content
        assert "agentType: 'code-reviewer', ...ROUTING.arbiter" in content
        assert "apexGatePromise = apexTask.then((result) => result !== null && result !== undefined)" in content
        assert "if (!(await apexGatePromise)) throw new Error('HELD: apex_unavailable_or_denied')" in content
        assert not re.search(r"(?<![A-Za-z])agent\s*\(", content[marker_end:]), f"{name}: call bypasses governedAgent"


def test_routing_is_declared_before_first_governed_call():
    for name in EXPECTED:
        content = _read(name)
        assert content.index("const ROUTING") < content.index("governedAgent(")


def test_callsites_reference_expected_tier():
    for name, mapping in EXPECTED.items():
        lines = _read(name).splitlines()
        for label_prefix, tier in mapping.items():
            hits = [line for line in lines if "label:" in line and label_prefix in line and "...ROUTING." in line]
            assert hits, f"{name}: label {label_prefix} 找不到含 ...ROUTING.* 的 wired 行"
            for line in hits:
                got = re.search(r"\.\.\.ROUTING\.(\w+)", line).group(1)
                assert got == tier, f"{name}: {label_prefix} 期望 ROUTING.{tier} 實得 ROUTING.{got}"


def test_generated_model_literals_and_efforts_are_pinned():
    for name in EXPECTED:
        content = _read(name)
        assert 'scan: { model: "sonnet", effort: "medium" }' in content
        assert 'judge: { model: "opus", effort: "max" }' in content
        assert 'arbiter: { model: "fable", effort: "max" }' in content
        assert 'planAuthor: { model: "fable", effort: "max" }' in content
        assert 'effort: "high"' not in content
        assert "mediua" not in content


def test_prompt_contract_is_machine_readable_and_complete():
    data = json.loads((WF / "routing.json").read_text(encoding="utf-8"))
    contract = data["prompt_contract"]
    assert contract["required_input_fields"] == ["Objective", "Scope", "Inputs", "Evidence", "Stop", "Output"]
    assert contract["native_output_headings"] == ["Scope", "Evidence", "Finding", "Uncertainty", "Risk", "Next step"]
    assert set(contract["workflow_schema_equivalence"]) == set(contract["required_input_fields"])
    assert data["tiers"]["arbiter"]["fallback"] == []
    assert data["tiers"]["arbiter"]["on_unavailable"] == "HELD"
    for field in contract["required_input_fields"]:
        assert f"{field}:" in _read("std-implement.js")


def test_repo_personas_route_apex_reviewers_and_secondary_test_engineer():
    personas = ROOT / ".claude/agents"
    for name in ("code-reviewer.md", "security-auditor.md"):
        content = (personas / name).read_text(encoding="utf-8")
        assert re.search(r"(?m)^model: fable$", content)
        assert re.search(r"(?m)^effort: max$", content)
        assert re.search(r"(?m)^tools: Read, Grep, Glob$", content)
        for denied in ("Edit", "Write", "Bash", "PowerShell"):
            assert re.search(rf"(?m)^disallowedTools:.*\b{denied}\b", content)
        assert "read-only" in content and "Never modify files" in content
    test_engineer = (personas / "test-engineer.md").read_text(encoding="utf-8")
    assert re.search(r"(?m)^model: sonnet$", test_engineer)
    assert re.search(r"(?m)^effort: medium$", test_engineer)
    assert not (personas / "ship-preparer.md").exists()


def test_read_only_scanners_preserve_explore_capability_boundary():
    health = _read("repo-health-scan.js")
    plan_next = _read("plan-next-spec-to-done-aware.js")
    assert re.search(r"label: `scan:\$\{s\.key\}`[^\n]*agentType: 'Explore'", health)
    assert re.search(r"label: 'scan:progress'[^\n]*agentType: 'Explore'", health)
    assert re.search(r"label: 'repo:frontend-routes'[^\n]*agentType: 'Explore'", plan_next)
    assert re.search(r"label: 'repo:backend-capabilities'[^\n]*agentType: 'Explore'", plan_next)


def test_do_not_codegen_sites_unchanged():
    impl = _read("std-implement.js")
    assert "const implModel = 'sonnet'" in impl
    assert "model: implModel" in impl
    assert "label: `impl:${T}:retry`, phase: 'Implement', model: 'opus', effort: 'max'" in impl
    assert "label: `impl:${T}:opus`, phase: 'Implement', model: 'opus', effort: 'max'" in impl


def test_no_conflicting_routing_invariant_in_tracked_workflows():
    bad = []
    for path in WF.glob("*.js"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if re.search(r"Haiku[^\n]*NOT used in the routing", text):
            bad.append(str(path.relative_to(ROOT)))
    assert not bad, f"衝突 routing 不變量殘留於 tracked workflow: {bad}"


def test_ship_runtime_is_validation_only_until_trusted_host_exists():
    ship = _read("ship-item.js")
    assert "const ARGS_SAFE" in ship and "invalid_args_format" in ship
    assert "const ALLOWED_ARG_KEYS" in ship
    assert "Number.isSafeInteger(INPUT_PR_NUMBER)" in ship
    assert "invalid_branch_arg" in ship
    assert "invalid_pr_number_arg" in ship
    assert "invalid_elevated_authorization_arg" in ship
    runtime_hold = ship.index("return held('host_env_blocked', INPUT_PR_NUMBER, 'ship_workflow_shell_unavailable')")
    assert ship.index("phase('Validate')") < runtime_hold
    assert ship.index("invalid_elevated_authorization_arg") < runtime_hold
    assert ship.index("phase('Hold')") < runtime_hold

    assert "// <routing:gen>" not in ship
    assert "const RAW_AGENT" not in ship
    assert "governedAgent" not in ship
    assert not re.search(r"\bagent\s*\(", ship)
    assert "$`" not in ship
    assert "gh pr merge" not in ship
    assert "merged: true" not in ship
    assert "phase('Prepare')" not in ship
    assert "phase('Arbitrate')" not in ship
    assert "phase('Merge')" not in ship


def test_ship_document_matches_runtime_security_boundary():
    doc = _read("ship-item.md")
    for literal in (
        "coordinator", "Fable/max", "human_approval_required",
        "single-owner", "canonical human approval", "approvals=1",
        "--match-head-commit", "review_required", "git fetch origin", "git merge-base",
        "git rebase origin/main", "published PR branch", "git merge --no-edit origin/main",
        "cyber_safeguard_payload", "seg/seg/id", "passwd", "SHALL NOT",
        "trusted_elevated_authorization_unavailable", "agent-inaccessible",
        "host_env_blocked", "ship_workflow_shell_unavailable",
        "base-pinned trusted host executor", "synthetic",
    ):
        assert literal in doc
    assert (
        '{"merged":false,"prNumber":42,"mergeCommit":null,'
        '"heldReason":"host_env_blocked",'
        '"heldDetail":"ship_workflow_shell_unavailable"}'
    ) in doc
    assert "prNumber` 原樣保留 validated input" in doc
    assert re.search(r"MUST NOT[^\n]*gh pr merge --admin", doc)
    assert "preparation child" in doc and "沒有 preparation child" in doc
