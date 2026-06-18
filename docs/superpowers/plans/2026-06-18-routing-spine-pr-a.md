# Routing 脊椎（PR-A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 spec-to-done 的 model/effort 路由收斂成 `routing.json` 單一真相 + Python codegen + 確定性 pytest gate，並把 plan 作者降階做成 flag（預設關＝零行為變更）。

**Architecture:** workflow 腳本不能互相 import，故每支 `std-*.js` 各 inline 一份由 codegen 從 `routing.json` 生成的 `const ROUTING` 區塊；agent() 呼叫改引用 `...ROUTING.<tier>`。降階 flag 放 `routing.json`、由 codegen 在生成時解析（沙箱無 `process.env`）。PR-A 在 flag 預設關時對既有行為**零變更**，只是把散落的字面值集中＋上防漂移 gate。

**Tech Stack:** Python 3（codegen + pytest，走 `.venv\Scripts\python.exe`）、workflow `.js`（純文字 regex 改寫）、JSON。

## 與 spec 的 deviation（已驗證、附理由）

- **D1：codegen 用 Python（`scripts/gen_routing.py`）而非 spec 寫的 `.mjs`** — 讓 pytest gate 直接 import 測試、不引入 node 依賴、與既有 Python 工具鏈一致。
- **D2：降階 flag 放 `routing.json` 的 `flags.plan_author_xhigh`（codegen 套用）而非環境變數** — workflow runtime 沙箱無 `process.env`，env var runtime 讀不到。
- **D3：`hexagon-coding-agent-design-v2.js` 經 `git ls-files` 驗證為 untracked throwaway 研究腳本**（非 committed 治理權威）。spec §4.4「和解 v2 約束」縮為「刪本機 throwaway + 對 tracked workflow 加衝突不變量 guard test」。

## Global Constraints

- workflow 腳本**不能 import**；每支 `std-*.js` 各 inline 完整 `const ROUTING`，**絕不生獨立模組**。
- effort 合法階：`sonnet ∈ {high, max}`、`opus ∈ {xhigh, max}`、`haiku ∈ {null, max}`。非法組合 codegen 須 throw。
- **judge 層 `{opus, max}` immutable**；`std-implement.js:282/:287`（補救升級）與 `:418`（final-review）一律保留 `max`，移出降階。
- **`std-implement.js:276` 是 computed `model: implModel`，永不 codegen**（`task.mechanical ? 'sonnet':'opus'`，且無 effort）。
- 路由 haiku 層命名 **`extract`**，不得叫 `mechanical`（避免與 `task.mechanical` 撞名）。
- 唯一值變更＝`std-plan.js:119` plan 作者，經 `flags.plan_author_xhigh`（預設 `false`）控制；`false`→`{opus,max}`、`true`→`{opus,xhigh}`。
- trailer 一律固定字面字串，**禁 LLM 生成**；canonical＝`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- pytest 走 `.venv\Scripts\python.exe`；不在 main 開發，本 plan 於 branch `spec/hexagon-harness-upgrade`（spec 已在此）續作或新開 `feat/routing-spine-pr-a`。

---

## File Structure

- `artifacts/self-evolve/baseline.md`（NEW）— P0 baseline 模板＋clean-HEAD 記錄。
- `.claude/workflows/routing.json`（NEW）— 四層 canonical 路由 + allowed_efforts + flags + do_not_codegen。
- `scripts/gen_routing.py`（NEW）— codegen：validate / render_block / apply / `--check`。
- `tests/test_routing_json.py`（NEW）— routing.json schema + effort 合法性。
- `tests/test_routing_consistency.py`（NEW）— 全域確定性 gate（codegen --check + call-site→tier + 獨立字面斷言 + mtime + 衝突不變量）。
- `.claude/workflows/std-evidence.js` / `std-plan.js` / `std-implement.js`（MODIFY）— 加 marker 區塊、wire call-sites、trailer 修正。
- `.claude/skills/spec-to-done/SKILL.md`（MODIFY）— operator step。

---

## Task 1: P0 baseline 模板 + clean-HEAD 記錄

**Files:**
- Create: `artifacts/self-evolve/baseline.md`

**說明：** PR-A 在 flag 預設關時零行為變更，故**不需**真跑一支 spec 才能 merge。本 task 只建模板＋記錄當前乾淨 HEAD；真正的 A/B 量測是「翻 flag 時」的 operational step（見檔內註記），不是 PR-A 的 code gate。

- [ ] **Step 1: 記錄當前 HEAD 與乾淨度**

Run:
```bash
git -C "C:/Repos/active/iot/AI-BIM-governance" rev-parse HEAD
git -C "C:/Repos/active/iot/AI-BIM-governance" status --short
```
Expected: 印出 sha；status 應僅有本 plan 相關檔（記下 sha 填入下一步）。

- [ ] **Step 2: 建 baseline.md**

Create `artifacts/self-evolve/baseline.md`：
```markdown
# spec-to-done routing baseline

> P0 baseline。PR-A flag 預設關＝零行為變更，本檔在翻 `flags.plan_author_xhigh=true` 前才需填「實測列」。

- baseline_head_sha: <填 Step 1 的 sha>
- clean_worktree: true
- representative_spec_id: <PR-A 收尾時選定：最近一支已 merged 且完整跑過 P0–P6 的 spec>

## metrics schema（每次量測一列）
| run | spec_id | total_tokens | held_count | impl_round_count | wall_sec | routing_flag |
|-----|---------|--------------|------------|------------------|----------|--------------|
| baseline(flag=off) | TBD-operational | | | | | off |

## 回歸判定（翻 flag 前必過）
- held_count 不升
- total_tokens 不超 baseline 20%
```

- [ ] **Step 3: Commit**

```bash
git -C "C:/Repos/active/iot/AI-BIM-governance" add -- artifacts/self-evolve/baseline.md
git -C "C:/Repos/active/iot/AI-BIM-governance" commit -m "chore(routing): P0 baseline 模板 + clean-HEAD 記錄

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: routing.json + schema 驗證測試

**Files:**
- Create: `.claude/workflows/routing.json`
- Test: `tests/test_routing_json.py`

**Interfaces:**
- Produces: `routing.json` 結構 `{tiers:{extract,standard,reason,judge}, allowed_efforts, flags, do_not_codegen}`，被 Task 3 `gen_routing.py` 消費。

- [ ] **Step 1: 寫失敗測試**

Create `tests/test_routing_json.py`：
```python
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
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_routing_json.py -v`
Expected: FAIL（`routing.json` 不存在 → FileNotFoundError）。

- [ ] **Step 3: 建 routing.json**

Create `.claude/workflows/routing.json`：
```json
{
  "tiers": {
    "extract":  { "model": "haiku",  "effort": null,    "note": "純抽取/格式化，零判斷，下游必複核" },
    "standard": { "model": "sonnet", "effort": "max",   "note": "讀/探索/標準實作/首審" },
    "reason":   { "model": "opus",   "effort": "xhigh", "note": "創造/長程；唯一 max->xhigh 降階點" },
    "judge":    { "model": "opus",   "effort": "max",   "immutable": true, "note": "驗證/fix；不可降，codegen 只驗不覆寫" }
  },
  "allowed_efforts": { "haiku": [null, "max"], "sonnet": ["high", "max"], "opus": ["xhigh", "max"] },
  "flags": { "plan_author_xhigh": false },
  "do_not_codegen": ["std-implement.js:276", "std-implement.js:282", "std-implement.js:287"]
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_routing_json.py -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -- .claude/workflows/routing.json tests/test_routing_json.py
git commit -m "feat(routing): 新增 routing.json 四層 canonical 表 + schema 測試

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: gen_routing.py codegen 核心（單元測試）

**Files:**
- Create: `scripts/gen_routing.py`
- Test: `tests/test_gen_routing.py`

**Interfaces:**
- Consumes: `routing.json`（Task 2）。
- Produces: 函式 `load_routing()->dict`、`render_block(data)->str`、`apply_to_text(text, block)->str`、CLI `python scripts/gen_routing.py [--check]`。`render_block` 產出含 `extract/standard/reason/judge/planAuthor` 五鍵的 `const ROUTING`，被 Task 4–6 消費。

- [ ] **Step 1: 寫失敗測試**

Create `tests/test_gen_routing.py`：
```python
import importlib.util, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("gen_routing", ROOT / "scripts/gen_routing.py")
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)

def test_render_block_includes_planauthor_off():
    data = {"tiers": {"reason": {"model":"opus","effort":"xhigh"}, "judge":{"model":"opus","effort":"max"}},
            "allowed_efforts": {"opus":["xhigh","max"]}, "flags": {"plan_author_xhigh": False}}
    block = gen.render_block(data)
    assert "planAuthor: { model: 'opus', effort: 'max' }" in block
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
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_gen_routing.py -v`
Expected: FAIL（`scripts/gen_routing.py` 不存在）。

- [ ] **Step 3: 實作 gen_routing.py**

Create `scripts/gen_routing.py`：
```python
#!/usr/bin/env python
"""routing.json -> 各 std-*.js 的 // <routing:gen> const ROUTING 區塊 codegen。
只能 pre-session 跑；禁止 workflow run 中途執行。"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
RJSON = ROOT / ".claude/workflows/routing.json"
WF = ROOT / ".claude/workflows"
TARGETS = ["std-plan.js", "std-implement.js", "std-evidence.js"]
BEGIN, END = "// <routing:gen>", "// </routing:gen>"
_MARK = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.DOTALL)

def validate(data):
    allowed = data["allowed_efforts"]
    for name, t in data["tiers"].items():
        m, e = t["model"], t.get("effort")
        if m not in allowed:
            raise ValueError(f"tier {name}: unknown model {m}")
        if e not in allowed[m]:
            raise ValueError(f"tier {name}: effort {e!r} not allowed for {m} ({allowed[m]})")

def load_routing():
    data = json.loads(RJSON.read_text(encoding="utf-8"))
    validate(data)
    return data

def _entry(model, effort):
    parts = [f"model: '{model}'"]
    if effort is not None:
        parts.append(f"effort: '{effort}'")
    return "{ " + ", ".join(parts) + " }"

def render_block(data):
    tiers = data["tiers"]
    flags = data.get("flags", {})
    plan = tiers["reason"] if flags.get("plan_author_xhigh") else {"model": "opus", "effort": "max"}
    lines = [BEGIN, "const ROUTING = {"]
    for key in ("extract", "standard", "reason", "judge"):
        if key in tiers:
            lines.append(f"  {key}: {_entry(tiers[key]['model'], tiers[key].get('effort'))},")
    lines.append(f"  planAuthor: {_entry(plan['model'], plan.get('effort'))},")
    lines.append("}")
    lines.append(END)
    return "\n".join(lines)

def apply_to_text(text, block):
    if not _MARK.search(text):
        raise ValueError("marker region // <routing:gen> not found")
    return _MARK.sub(lambda m: block, text)

def main():
    check = "--check" in sys.argv
    data = load_routing()
    block = render_block(data)
    drift = []
    for fn in TARGETS:
        p = WF / fn
        text = p.read_text(encoding="utf-8")
        new = apply_to_text(text, block)
        if new != text:
            if check:
                drift.append(fn)
            else:
                p.write_text(new, encoding="utf-8")
                print(f"regenerated {fn}")
    if check and drift:
        print("DRIFT:", drift)
        sys.exit(1)
    sys.exit(0)

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_gen_routing.py -v`
Expected: PASS（4 passed）。

- [ ] **Step 5: Commit**

```bash
git add -- scripts/gen_routing.py tests/test_gen_routing.py
git commit -m "feat(routing): gen_routing.py codegen 核心 + 單元測試

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: wire std-evidence.js（最小檔，建立 pattern）

**Files:**
- Modify: `.claude/workflows/std-evidence.js`（加 marker；`:73` probe→extract、`:103` evidence→judge）

**Interfaces:**
- Consumes: `gen_routing.py`（Task 3）、`routing.json`（Task 2）。

- [ ] **Step 1: 在 meta 區塊後插入空 marker**

在 `export const meta = {...}` 之後、第一個 `agent()` 之前插入：
```js
// <routing:gen>
// </routing:gen>
```

- [ ] **Step 2: 跑 codegen 填入 ROUTING 區塊**

Run: `.venv\Scripts\python.exe scripts/gen_routing.py`
Expected: 印出 `regenerated std-evidence.js`；marker 間出現 `const ROUTING = {...}`。

- [ ] **Step 3: wire 兩個 call-site**

`std-evidence.js:73` probe（extract 層）：
- 從：`{ label: 'probe:engine', phase: 'Probe', model: 'haiku', schema: PROBE_SCHEMA }`
- 改為：`{ label: 'probe:engine', phase: 'Probe', ...ROUTING.extract, schema: PROBE_SCHEMA }`

`std-evidence.js:103` evidence（judge 層）：
- 從：`{ label: \`evidence:${SLUG}\`, phase: 'Evidence', model: 'opus', effort: 'max', schema: EVIDENCE_SCHEMA }`
- 改為：`{ label: \`evidence:${SLUG}\`, phase: 'Evidence', ...ROUTING.judge, schema: EVIDENCE_SCHEMA }`

- [ ] **Step 4: codegen --check 確認無漂移**

Run: `.venv\Scripts\python.exe scripts/gen_routing.py --check`
Expected: exit 0（無 DRIFT）。

- [ ] **Step 5: Commit**

```bash
git add -- .claude/workflows/std-evidence.js
git commit -m "refactor(routing): std-evidence.js 接 routing.json（probe=extract, evidence=judge）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: wire std-plan.js（4 site + :119 flag + 2 trailer）

**Files:**
- Modify: `.claude/workflows/std-plan.js`

- [ ] **Step 1: 插入空 marker（meta 後）**
```js
// <routing:gen>
// </routing:gen>
```

- [ ] **Step 2: 跑 codegen 填入**

Run: `.venv\Scripts\python.exe scripts/gen_routing.py`
Expected: `regenerated std-plan.js`。

- [ ] **Step 3: wire call-sites**

| 行 | label | 改為 |
|---|---|---|
| :119 | `plan:author` | `...ROUTING.planAuthor`（取代 `model: 'opus', effort: 'max'`）|
| :147 | `plan-review:${a.key}` | `...ROUTING.standard`（取代 `model: 'sonnet', effort: 'max'`）|
| :178 | `plan-fix:r${...}` | `...ROUTING.judge`（取代 `model: 'opus', effort: 'max'`）|
| :209 | `impact:prescan` | `...ROUTING.standard`（取代 `model: 'sonnet', effort: 'max'`）|

例（:119）：
- 從：`{ label: 'plan:author', phase: 'Plan', model: 'opus', effort: 'max', schema: PLAN_SCHEMA }`
- 改為：`{ label: 'plan:author', phase: 'Plan', ...ROUTING.planAuthor, schema: PLAN_SCHEMA }`

- [ ] **Step 4: 修 2 處 Fable 5 trailer**

`std-plan.js:104` 與 `:172` 內字串 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` → `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`（固定字面）。

- [ ] **Step 5: codegen --check + 確認 flag=off 行為不變**

Run: `.venv\Scripts\python.exe scripts/gen_routing.py --check`
Expected: exit 0。檢視 ROUTING 區塊 `planAuthor: { model: 'opus', effort: 'max' }`（flag off ⇒ 等同原 `:119` 值，零行為變更）。

- [ ] **Step 6: Commit**

```bash
git add -- .claude/workflows/std-plan.js
git commit -m "refactor(routing): std-plan.js 接 routing.json + planAuthor flag(off) + trailer 修正

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: wire std-implement.js（標準/judge site + do-not-codegen + 1 trailer）

**Files:**
- Modify: `.claude/workflows/std-implement.js`

- [ ] **Step 1: 插入空 marker（meta 後）+ 跑 codegen**
```js
// <routing:gen>
// </routing:gen>
```
Run: `.venv\Scripts\python.exe scripts/gen_routing.py` → `regenerated std-implement.js`。

- [ ] **Step 2: wire 可 codegen 的 call-sites**

| 行 | label | 改為 |
|---|---|---|
| :209 | `parse:plan` | `...ROUTING.extract` |
| :242 | `impact:${T}` | `...ROUTING.standard` |
| :324 | `spec-review:${T}` | `...ROUTING.standard` |
| :339 | `spec-fix:${T}:r${round}` | `...ROUTING.judge` |
| :364 | `quality-review:${T}` | `...ROUTING.standard` |
| :377 | `quality-fix:${T}:r${round}` | `...ROUTING.judge` |
| :418 | `final-review` | `...ROUTING.judge` |

例（:209）：`{ label: 'parse:plan', phase: 'Parse', model: 'haiku', schema: TASKS_SCHEMA }` → `{ label: 'parse:plan', phase: 'Parse', ...ROUTING.extract, schema: TASKS_SCHEMA }`

- [ ] **Step 3: do-not-codegen 三處加保護註解（值不動）**

- `:275` 上一行加：`// do-not-codegen: model 為 computed(task.mechanical ? sonnet : opus)`
- `:282`（`impl:${T}:retry`）上一行加：`// do-not-codegen: 失敗補救升級，刻意保留 opus/max`
- `:287`（`impl:${T}:opus`）上一行加：`// do-not-codegen: BLOCKED 升級，刻意保留 opus/max`

（`:276` `model: implModel`、`:282/:287` `model: 'opus', effort: 'max'` **字面不變**。）

- [ ] **Step 4: 修 1 處 Fable 5 trailer**

`std-implement.js:165` 字串內 `Claude Fable 5 <noreply@anthropic.com>` → `Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

- [ ] **Step 5: codegen --check**

Run: `.venv\Scripts\python.exe scripts/gen_routing.py --check`
Expected: exit 0。

- [ ] **Step 6: Commit**

```bash
git add -- .claude/workflows/std-implement.js
git commit -m "refactor(routing): std-implement.js 接 routing.json + 保護 do-not-codegen 三處 + trailer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: test_routing_consistency.py 全域確定性 gate

**Files:**
- Test: `tests/test_routing_consistency.py`

**Interfaces:**
- Consumes: Task 4–6 wire 後的三個 `std-*.js`、`gen_routing.py`、`routing.json`。

- [ ] **Step 1: 寫測試**

Create `tests/test_routing_consistency.py`：
```python
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
                          "spec-fix:":"judge","quality-review:":"standard","quality-fix:":"judge","final-review":"judge"},
    "std-evidence.js":  {"probe:engine":"extract","evidence:":"judge"},
}
def test_callsites_reference_expected_tier():
    for fn, mapping in EXPECTED.items():
        text = _read(fn)
        for label_prefix, tier in mapping.items():
            # 找含此 label 前綴的 agent() 物件，斷言同物件內有 ...ROUTING.<tier>
            m = re.search(r"label:\s*[`'\"]" + re.escape(label_prefix) + r"[^}]*?\.\.\.ROUTING\.(\w+)", text, re.DOTALL)
            assert m, f"{fn}: label {label_prefix} 找不到 ...ROUTING.* spread"
            assert m.group(1) == tier, f"{fn}: {label_prefix} 期望 ROUTING.{tier} 實得 ROUTING.{m.group(1)}"

def test_judge_block_is_opus_max_literal():
    # 獨立於 routing.json：直接斷言生成後檔案內 judge 區塊字面
    for fn in EXPECTED:
        assert "judge: { model: 'opus', effort: 'max' }" in _read(fn), f"{fn}: judge 區塊非 opus/max"

def test_do_not_codegen_sites_unchanged():
    impl = _read("std-implement.js")
    assert "model: implModel" in impl, ":276 computed model 條件分支被破壞"
    assert "label: `impl:${T}:retry`, phase: 'Implement', model: 'opus', effort: 'max'" in impl, ":282 補救升級被改"
    assert "label: `impl:${T}:opus`, phase: 'Implement', model: 'opus', effort: 'max'" in impl, ":287 升級被改"

def test_no_workflow_newer_than_routing_unregenerated():
    rjson = (WF / "routing.json").stat().st_mtime
    # 任一 target 比 routing.json 新時，--check 必仍綠（已涵蓋於 test_codegen_no_drift；此處明示語義）
    for fn in EXPECTED:
        _ = (WF / fn).stat().st_mtime  # 存在性即可；漂移由 codegen --check 把關

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
```

- [ ] **Step 2: 跑測試確認 pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_routing_consistency.py -v`
Expected: PASS（6 passed）。若 `test_callsites_reference_expected_tier` 失敗，回 Task 4–6 修對應 site。

- [ ] **Step 3: Commit**

```bash
git add -- tests/test_routing_consistency.py
git commit -m "test(routing): 全域確定性 gate（drift + tier 對照 + judge 字面 + do-not-codegen + 衝突不變量）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 清 throwaway v2 + SKILL.md operator step

**Files:**
- Delete（若存在、untracked）：`.claude/workflows/hexagon-coding-agent-design-v2.js`、`.claude/workflows/spec-adversarial-*.js`
- Modify: `.claude/skills/spec-to-done/SKILL.md`

- [ ] **Step 1: 確認 throwaway 為 untracked 再刪**

Run:
```bash
git -C "C:/Repos/active/iot/AI-BIM-governance" ls-files .claude/workflows/ | grep -E "hexagon-coding-agent-design-v2|spec-adversarial" || echo "UNTRACKED-OK"
```
Expected: 印 `UNTRACKED-OK`（確認非 tracked）。然後刪本機檔：
```bash
rm -f "C:/Repos/active/iot/AI-BIM-governance/.claude/workflows/hexagon-coding-agent-design-v2.js"
```
（其餘 throwaway 同理；tracked 者**不得**刪。）

- [ ] **Step 2: SKILL.md 加 operator step**

在 SKILL.md 適當 operator/維運段加一行：
> routing.json 改動後須跑 `.venv\Scripts\python.exe scripts/gen_routing.py` 重生各 std-*.js 的 ROUTING 區塊，並 re-save 受影響 workflow 讓 harness reload；禁止 workflow run 中途執行 codegen。

- [ ] **Step 3: 全測試綠 + 語義驗證**

Run: `.venv\Scripts\python.exe -m pytest tests/test_routing_json.py tests/test_gen_routing.py tests/test_routing_consistency.py -v`
Expected: 全 PASS。

（語義回歸：本 PR flag=off ⇒ 三檔 agent() 的 model+effort 解析值與改動前逐一相同；唯一差異是改用 `...ROUTING.*` spread。）

- [ ] **Step 4: Commit**

```bash
git add -- .claude/skills/spec-to-done/SKILL.md
git commit -m "chore(routing): 清 untracked throwaway 研究 workflow + SKILL.md operator step

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review（對 spec 逐項）

- **§3 routing.json 四層 + allowed_efforts + do_not_codegen** → Task 2 ✓
- **§4.1 16 site 對照表** → Task 4(2)/Task 5(4)/Task 6(7+3 do-not-codegen) = 13 wired + 3 do-not-codegen ✓（evidence:103 屬 judge，共 16）
- **§4.2 codegen marker 規格 / --check / 合法性驗證 / immutable 只驗不覆寫** → Task 3 ✓（immutable judge 在 render 仍輸出固定 opus/max，--check 比對即「只驗」）
- **§4.3 :119 flag 降階（沙箱用 json flag，D2）** → Task 2 flags + Task 3 planAuthor + Task 5 ✓
- **§4.4 v2 和解（D3 縮為刪 throwaway + guard test）** → Task 7(衝突不變量) + Task 8 ✓
- **§4.4 trailer 修正 3 處** → Task 5(2)/Task 6(1) ✓
- **§4.5 5 條 pytest 獨立斷言** → Task 7：drift / tier 對照 / judge 字面 / do-not-codegen / 衝突不變量（mtime 語義併入 drift）✓
- **§4.6 P0 baseline schema** → Task 1 ✓
- **§4.7 SKILL.md operator step** → Task 8 ✓

**Placeholder scan：** baseline.md 的 `representative_spec_id: TBD-operational` 為刻意 operational（flag 翻開時才需），非 plan gap，已於檔內註明。其餘無 TBD/TODO。

**Type/命名一致性：** `ROUTING.extract/standard/reason/judge/planAuthor` 五鍵在 render_block（Task 3）、wire（Task 4–6）、consistency test（Task 7）三處一致；`do-not-codegen` 字面斷言與 Task 6 保護字串逐字一致。
