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
    "ship-item.js": {"ship:arbiter:${prNumber}": "arbiter"},
    "spec-to-done-adversarial-verify.js": {"verify:compliance": "arbiter", "verify:technical": "judge", "verify:usability": "judge", "verify:resilience": "judge"},
    "token-strategy-tournament.js": {
        "plan:tournament": "arbiter", "read:": "standard", "design:": "reason",
        "judge:": "judge", "synthesize": "reason",
    },
}


def test_every_active_agent_workflow_is_in_routing_inventory():
    retired = {"saas-blueprint-tournament.js"}
    workflows = list(WF.glob("*.js"))
    assert {p.name for p in workflows if p.name in retired} == retired
    active = {
        p.name for p in workflows
        if p.name not in retired and re.search(r"\b(?:agent|governedAgent)\s*\(", p.read_text(encoding="utf-8"))
    }
    assert active == set(EXPECTED), f"active workflow routing inventory drift: active={sorted(active)} expected={sorted(EXPECTED)}"


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
        assert f"{field}:" in _read("ship-item.js")


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


def test_ship_merge_sink_is_fixed_evidence_and_identity_bound():
    ship = _read("ship-item.js")
    assert ship.count("await governedAgent(") == 1
    assert "agentType: 'code-reviewer'" in ship
    assert "const ARGS_SAFE" in ship and "invalid_args_format" in ship
    assert "Number.isSafeInteger(INPUT_PR_NUMBER)" in ship
    assert "branch_requires_human_consent" in ship
    assert "path.startsWith('.claude/')" in ship and "path.startsWith('scripts/')" in ship
    assert "path === 'agent-skills-manifest.json'" in ship and "path.startsWith('infra/')" in ship
    assert "gh api --paginate --slurp" in ship
    assert "check-pr-local-preflight.ps1" not in ship
    assert "gh pr diff" not in ship
    assert "git diff --no-ext-diff --no-textconv --no-renames --name-only ${preparedBase}...${preparedHead}" in ship
    assert "git diff --no-ext-diff --no-textconv --no-renames ${preparedBase}...${preparedHead}" in ship

    governance_gate = ship.index("governance_change_requires_human_consent")
    arbiter_call = ship.index("label: `ship:arbiter:${prNumber}`")
    allow_guard = ship.index("decision.allowMerge !== true")
    evidence_guard = ship.index("!decision.evidence.trim()")
    identity_guard = ship.index("decision.prNumber !== prNumber")
    reviewer_race_guard = ship.index("review_evidence_changed_after_verdict")
    final_head_guard = ship.index("finalState.headRefOid !== preparedHead")
    merge_sink = ship.index("await $`gh pr merge ${prNumber}")
    verify_merge = ship.index("--json state,mergeCommit")
    assert governance_gate < arbiter_call < allow_guard < evidence_guard < identity_guard < reviewer_race_guard < final_head_guard < merge_sink < verify_merge

    assert ship.count("await $`gh pr merge") == 1
    assert "--match-head-commit ${preparedHead}" in ship
    assert ship.count("pulls/${prNumber}/comments") == 2
    assert ship.count("pulls/${prNumber}/reviews") == 2
    assert ship.count("issues/${prNumber}/comments") == 2
    assert "merge_command_failed_unverified" in ship
    assert "GitHub 已確認 merge，但本機 post-merge fetch 失敗" in ship


def test_ship_document_matches_runtime_security_boundary():
    doc = _read("ship-item.md")
    for literal in (
        "coordinator", "fable` + `max", "governance_change_requires_human_consent",
        "--match-head-commit", "review_required", "git fetch origin", "git merge-base",
        "git rebase origin/main", "published PR branch", "git merge --no-edit origin/main",
        "cyber_safeguard_payload", "seg/seg/id", "passwd", "SHALL NOT",
    ):
        assert literal in doc
    assert re.search(r"MUST NOT[^\n]*gh pr merge --admin", doc)
    assert "preparation child" in doc and "沒有 preparation child" in doc
