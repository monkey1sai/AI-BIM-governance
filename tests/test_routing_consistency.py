import subprocess, sys, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".claude/workflows"

def _read(fn): return (WF / fn).read_text(encoding="utf-8")

def test_codegen_no_drift():
    r = subprocess.run([sys.executable, str(ROOT/"scripts/gen_routing.py"), "--check"],
                       capture_output=True, text=True)
    assert r.returncode == 0, f"routing drift: {r.stdout}{r.stderr}"

# 每個可 codegen 的 label 前綴 -> 期望 tier（call-site 必須 spread 對的 ROUTING.<tier>）
EXPECTED = {
    "std-plan.js":      {"plan:author":"planAuthor","plan-review:":"standard","plan-fix:":"judge","impact:prescan":"standard"},
    "std-implement.js": {"parse:plan":"extract","impact:${T}":"standard","spec-review:":"standard",
                          "spec-fix:":"judge","quality-review:":"standard","quality-fix:":"judge","final-review":"arbiter",
                          "fix:cycle":"judge","fix:verify":"judge"},
    "std-evidence.js":  {"probe:engine":"extract","evidence:":"arbiter"},
}
def test_callsites_reference_expected_tier():
    # 每個 agent() option 物件為單行；逐行比對（label 含 ${...} 的 } 不會誤斷）
    for fn, mapping in EXPECTED.items():
        lines = _read(fn).splitlines()
        for label_prefix, tier in mapping.items():
            hits = [ln for ln in lines if ("label:" in ln) and (label_prefix in ln) and ("...ROUTING." in ln)]
            assert hits, f"{fn}: label {label_prefix} 找不到含 ...ROUTING.* 的 wired 行"
            for ln in hits:
                got = re.search(r"\.\.\.ROUTING\.(\w+)", ln).group(1)
                assert got == tier, f"{fn}: {label_prefix} 期望 ROUTING.{tier} 實得 ROUTING.{got}"

def test_judge_block_is_opus_max_literal():
    # 獨立於 routing.json：直接斷言生成後檔案內 judge 區塊字面
    for fn in EXPECTED:
        assert "judge: { model: 'opus', effort: 'max' }" in _read(fn), f"{fn}: judge 區塊非 opus/max"

def test_arbiter_and_planauthor_blocks_are_fable_max_literal():
    # gate 只增不減：arbiter/planAuthor 逐字釘 fable/max，防被靜默降回
    for fn in EXPECTED:
        content = _read(fn)
        assert "arbiter: { model: 'fable', effort: 'max' }" in content, f"{fn}: arbiter 區塊非 fable/max"
        assert "planAuthor: { model: 'fable', effort: 'max' }" in content, f"{fn}: planAuthor 區塊非 fable/max"

def test_do_not_codegen_sites_unchanged():
    impl = _read("std-implement.js")
    assert "const implModel = 'sonnet'" in impl, ":288 全類 task 首發 sonnet 基線被改"
    assert "model: implModel" in impl, ":288 implModel call-site 被 codegen 覆寫"
    assert "label: `impl:${T}:retry`, phase: 'Implement', model: 'opus', effort: 'max'" in impl, ":294 補救升級被改"
    assert "label: `impl:${T}:opus`, phase: 'Implement', model: 'opus', effort: 'max'" in impl, ":300 升級被改"

def test_no_conflicting_routing_invariant_in_tracked_workflows():
    # D3：禁 tracked workflow 再出現「Haiku ... NOT used in the routing」這類與 routing.json 衝突的不變量字串
    tracked = subprocess.run(["git","-C",str(ROOT),"ls-files",".claude/workflows/"],
                             capture_output=True, text=True).stdout.split()
    bad = []
    for rel in tracked:
        if rel.endswith(".js"):
            t = (ROOT/rel).read_text(encoding="utf-8", errors="ignore")
            if re.search(r"Haiku[^\n]*NOT used in the routing", t):
                bad.append(rel)
    assert not bad, f"衝突 routing 不變量殘留於 tracked workflow: {bad}"
