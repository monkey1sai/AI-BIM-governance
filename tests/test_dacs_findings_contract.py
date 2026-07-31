import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = ROOT / ".claude/workflows/fu-adversarial-verify-generic.js"
SKILLS = [
    ROOT / ".claude/skills/spec-to-done/SKILL.md",
    ROOT / ".codex/skills/spec-to-done/SKILL.md",
]


def test_findings_contract_landed():
    src = JS.read_text(encoding="utf-8")
    assert "bad_findings" in src, "缺 findings 輸入契約 held"
    assert "MAX_Q" in src, "缺 q 長度上限機械化"
    assert "MAX_FINDINGS = 32" in src, "缺 findings registry 總量上限"
    assert "MAX_VERIFIER_BATCHES = 2" in src, "缺 verifier batch 上限"
    assert "maxItems: MAX_FINDINGS" in src, "缺 critic output 總量上限"
    assert "evidence_not_bound_to_subject_sha" in src, "缺 exact subject evidence 機械綁定"
    assert "repoRelativePath" in src, "缺 reviewer path canonicalization"
    assert "suspect_file_not_tracked_at_subject_sha" in src, "缺 dispatch 前 subject-tree suspectFile gate"
    assert "禁止 Read mutable worktree path" in src, "缺 pinned-object-only reviewer read boundary"
    assert "FINDINGS.map((f) => () =>" not in src, "不得維持一 finding 一 agent 的平行扇出"


def test_p5_contract_binds_immutable_identity_and_taxonomy_in_both_skills():
    required = {
        "targetSha", "baseSha", "subjectSha", "domainContext", "evidence_stale",
        "fix_now", "external_blockers", "known_gaps", "follow_ups",
        "unverified", "refuted", "external_blocked", "unblock_condition",
    }
    for path in SKILLS:
        src = path.read_text(encoding="utf-8")
        missing = sorted(token for token in required if token not in src)
        assert not missing, f"{path} 缺 P5 contract tokens: {missing}"
        assert "P5.not_closed" not in src
        assert "P5.new_issues" not in src
