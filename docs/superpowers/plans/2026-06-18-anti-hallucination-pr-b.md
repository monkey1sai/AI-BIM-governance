# 抗幻覺（PR-B）Implementation Plan — v3（採納 v2 GO-WITH-REVISIONS；砍 Task 3）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。
>
> **v3 重寫理由**：v2 經 2 輪 1 Opus/max 指揮官對抗審批 + 指揮官親跑 code 驗證，定 **GO-WITH-REVISIONS**。關鍵裁定：
> - **Task 3（PreToolUse state-evidence 閘）整個砍掉**——三輪 review + 指揮官親跑 + 我親測都證實「認 state」建在 freeform append-only prose 上**無法可靠 gate**（branch→slug、完成 regex、P5 regex 連環失配；連「收嚴版」P5 regex 對真檔 0 命中）。證據閘延後到**先讓 spec-to-done P6 寫機器可解析 marker** 的獨立 spec。
> - 保留 Task 1（citation）+ Task 2（DACS）——grounded、有真價值。
> - 新增 **Task 0**：archive 已 merge 的 `spec-to-done-routing-gate`（PR-A 的 openspec change）——解 NoSuccessorWhilePredecessorOpen + 動 `openspec/specs/` 順帶滿足 PR-B 的 pr-review-agent formal-evidence gate。

**Goal:** P5 對抗複驗加 (a) schema citation evidence（optional shape，避免向後相容 infra-HELD）、(b) DACS registry 輸入契約 fail-fast；並 archive PR-A 遺留的 active openspec change。

**Tech Stack:** workflow `.js`（schema）、PowerShell（無）、`.claude/settings.json`（無，Task 3 已砍）、Python pytest（balanced-brace + `vm.runInNewContext('('+lit+')')` 抽 schema）、openspec 手動 archive。

## Global Constraints（grounded，親驗 2026-06-18/19）

- `fu-adversarial-verify-generic.js`：`VERDICT_SCHEMA`(:15) 裸 non-export const；檔頂層 await/return/harness-injected → **不可 require**；抽物件字面用**平衡大括號掃描 + `node vm.runInNewContext('('+lit+')')`**（**裸 `{…}` 直接 vm 會 `SyntaxError: Unexpected token ':'`——已親跑坐實；必須 paren-wrap**）。findings 經 `A.findings=[{id,q}]`(:11)；既有 fail-fast `if(!ROOT) return {held:'bad_args',...}`(:13)；verdicts `filter(Boolean)`(:60)。
- **向後相容紅線（MAJOR-5）**：SKILL.md:74-76 = `verdicts.length !== findings 數 → 重呼 → 視 infra-HELD`；fu-...js:60 `filter(Boolean)` 丟掉 schema-violating verdict。→ **若把新欄位加進 VERDICT_SCHEMA 頂層 `required`，verifier 漏填會被 drop → length mismatch → 每個 spec 的 P5 變 infra-HELD-retry。故 `evidence` 一律 optional（頂層 required 不含），prompt 強烈要求、子物件完整。** 收嚴成頂層 required 列為未來 follow-up（須先實證 harness `agent({schema})` violation 是內部 retry 還是回 null——repo 無法證實；註：`fe-redesign-alignment-audit.js:26-29` 有 required evidence 成功先例，但 drop 互動未實證）。
- **無虛構機制**：plan 不得描述 repo 不存在的控制流（v1/v2 的「照想像寫」病）。harness schema-violation 行為=已知不確定，據實標註，不杜撰 per-finding retry。
- **openspec archive**：本機 `npx openspec` 壞 → 手動 archive = (1) `openspec/changes/spec-to-done-routing-gate/` 移到 `openspec/changes/archive/2026-06-19-spec-to-done-routing-gate/`；(2) 把 change 的 `## ADDED Requirements` 區塊逐字 append 進 canonical `openspec/specs/ai-coding-governance/spec.md` 的 `## Requirements` 段（[[openspec-convergence-batch-archive]] 規約）；archive 不可變。
- 誠實鐵律不變；judge 層 effort 不動；pytest 走 `.venv\Scripts\python.exe`；branch `chore/anti-hallucination-pr-b` off origin/main（PR-A 已 merge，main=3bfb27b）。
- M14（Haiku risk_level）= N/A（`grep risk_level .claude/workflows`=No files found）。

---

## File Structure

- `openspec/changes/spec-to-done-routing-gate/` → 移到 `openspec/changes/archive/2026-06-19-spec-to-done-routing-gate/`（Task 0）。
- `openspec/specs/ai-coding-governance/spec.md`（MODIFY，Task 0 append ADDED requirement）。
- `.claude/workflows/fu-adversarial-verify-generic.js`（MODIFY，Task 1+2）。
- `.claude/skills/spec-to-done/SKILL.md` + `.codex/skills/spec-to-done/SKILL.md`（MODIFY，Task 2 DACS 規約同步）。
- `tests/test_fu_verdict_schema.py`、`tests/test_dacs_findings_contract.py`（NEW）。

---

## Task 0: archive spec-to-done-routing-gate（解 successor 衝突 + formal-evidence）

**Files:** Move `openspec/changes/spec-to-done-routing-gate/` → `openspec/changes/archive/2026-06-19-spec-to-done-routing-gate/`；Modify `openspec/specs/ai-coding-governance/spec.md`

- [ ] **Step 1: 用 git mv 移到 archive**
```bash
git -C "C:/Repos/active/iot/AI-BIM-governance" mv openspec/changes/spec-to-done-routing-gate openspec/changes/archive/2026-06-19-spec-to-done-routing-gate
```

- [ ] **Step 2: 把 ADDED requirement 逐字 append 進 canonical**

讀 `openspec/changes/archive/2026-06-19-spec-to-done-routing-gate/specs/ai-coding-governance/spec.md` 的 `### Requirement: spec-to-done agent routing SHALL have a single source of truth...` 整段（含其 4 個 `#### Scenario:`），**逐字** append 到 `openspec/specs/ai-coding-governance/spec.md` 的 `## Requirements` 段末（接在最後一條 `### Requirement:` 之後，維持既有 markdown 階層）。**不改既有 requirement、不動 archive 內檔。**

- [ ] **Step 3: 驗證 + commit**

`git -C "..." diff --cached --check`；確認 `openspec/changes/spec-to-done-routing-gate/` 已不存在、canonical 多一條 requirement。Commit（trailer canonical Opus 4.8）：
`chore(openspec): archive spec-to-done-routing-gate（PR-A 已 merge）+ delta 併入 ai-coding-governance canonical`

---

## Task 1: VERDICT_SCHEMA 加 citation evidence（optional shape；§5a）

**Files:** Modify `fu-adversarial-verify-generic.js`；Test `tests/test_fu_verdict_schema.py`

- [ ] **Step 1: 失敗測試（balanced-brace + paren-wrap vm；RED 須是 assert/KeyError 非 crash）**

```python
import subprocess, json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = ROOT / ".claude/workflows/fu-adversarial-verify-generic.js"

def _extract(text, anchor):
    i = text.index(anchor); i = text.index("{", i); depth = 0
    for j in range(i, len(text)):
        if text[j] == "{": depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0: return text[i:j+1]
    raise AssertionError("unbalanced braces")

def _schema():
    lit = _extract(JS.read_text(encoding="utf-8"), "const VERDICT_SCHEMA =")
    # 親驗：裸 {…} vm 會 SyntaxError，必須 paren-wrap '('+lit+')'
    out = subprocess.run(
        ["node", "-e", "const vm=require('vm');process.stdout.write(JSON.stringify(vm.runInNewContext('('+process.argv[1]+')')))", lit],
        capture_output=True, text=True, check=True).stdout
    return json.loads(out)

def test_evidence_optional_but_well_shaped():
    s = _schema()
    assert "evidence" not in s["required"], "evidence 須 optional（向後相容：避免 verifier drop→infra-HELD）"
    ev = s["properties"]["evidence"]          # 改前無此鍵 → KeyError（乾淨 RED，非 vm crash）
    assert ev["type"] == "object" and ev.get("additionalProperties") is False
    assert set(ev["required"]) == {"file", "line", "quote"}
    lt = ev["properties"]["line"]["type"]
    assert "integer" in lt and "null" in lt   # 找不到行填 null，禁猜行號
```

- [ ] **Step 2: 跑確認 RED**（`s["properties"]["evidence"]` KeyError）。

- [ ] **Step 3: 改 VERDICT_SCHEMA（evidence optional、子物件完整、line 容 null）**

```js
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['finding_id', 'truly_closed', 'introduced_new_issue', 'reason'], // evidence 刻意 optional：避免漏填被 :60 filter drop → SKILL.md:74 length-mismatch infra-HELD
  properties: {
    finding_id: { type: 'string' }, truly_closed: { type: 'boolean' },
    introduced_new_issue: { type: 'boolean' }, reason: { type: 'string' },
    evidence: {
      type: 'object', additionalProperties: false,
      required: ['file', 'line', 'quote'],
      properties: {
        file: { type: 'string' },
        line: { type: ['integer', 'null'] },
        quote: { type: 'string' },
      },
    },
  },
}
```
`:50` per-finding prompt 末加（**據實，不杜撰 retry**）：「**強烈建議**附 evidence `{file,line,quote}`＝你判斷所依據的真實 code 位置；找不到確切行就填 `line:null` 並在 quote/reason 說明，**嚴禁猜行號**。」（schema 不強制 required → verifier 漏填不會被 drop；無自訂 retry，harness schema-handling 行為視為已知不確定。）

- [ ] **Step 4: 跑確認 GREEN + `node --check fu-...js`。Step 5: Commit。**

---

## Task 2: DACS registry 輸入契約 fail-fast（§5b）

**Files:** Modify `fu-adversarial-verify-generic.js`、`SKILL.md`(+`.codex` 同步)；Test `tests/test_dacs_findings_contract.py`

> 誠實標註：DACS 唯一可機械化點＝fu-...js 輸入契約（`buildP5Args` 不存在；P5 args 由指揮官主對話內聯，**「指揮官真截斷 q」是 SKILL.md doc 紀律、機械測不到**）。本 task 只驗「進來 findings 合規」。

- [ ] **Step 1: 失敗測試（契約字串落地 + held 分支存在）**

```python
import pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = ROOT / ".claude/workflows/fu-adversarial-verify-generic.js"

def test_findings_contract_landed():
    src = JS.read_text(encoding="utf-8")
    assert "bad_findings" in src, "缺 findings 輸入契約 held"
    assert "MAX_Q" in src, "缺 q 長度上限機械化"
```
（fu-...js 為 harness 腳本不可在 pytest 求值；以契約落地 + held 分支為確定性斷言，行為層由既有 P5 流程涵蓋——據實標註限制。）

- [ ] **Step 2: 跑確認 RED。**

- [ ] **Step 3: fu-...js `:44` FINDINGS.map 前加輸入契約（沿用 :13 既有 held-shape）**

```js
const MAX_Q = 800 // ≈200 token；超長即非 registry summary，違反 DACS
const badF = FINDINGS.filter((f) => !f || typeof f.id !== 'string' || typeof f.q !== 'string' || f.q.length > MAX_Q || (f.suspectFile != null && typeof f.suspectFile !== 'string'))
if (badF.length) return { label: LABEL, held: 'bad_findings', badCount: badF.length, verdicts: [], not_closed: [], new_issues: [], critic: null }
```
`:50`（per-finding prompt）在既有 `${f.q}` 之後加（三元式對 undefined 回 `''`，語言保證不產 `undefined` 字面）：
```js
${f.suspectFile ? `\n最可疑檔：${f.suspectFile}（先 Read 它再判，細節自取、不靠全文廣播）` : ''}
```

- [ ] **Step 4: SKILL.md `:70-73` 編排明文 DACS 規約 + `.codex` 同步**

> P5 findings 一律壓成 registry `{id, q:<一句話 claim ≤800 char>, suspectFile}`，**不灌 P3 finalReview 全文**（DACS，arXiv:2604.07911）；fu-...js 對超長 q / 缺 id 會 `held:'bad_findings'` fail-fast。（指揮官真截斷 q 為 doc 紀律。）

- [ ] **Step 5: 跑確認 GREEN + `node --check fu-...js`。Step 6: Commit。**

---

## Self-Review（對 spec §5 + v2 GO-WITH-REVISIONS）

- §5a citation → Task 1（BLOCKER-α vm paren-wrap **已親跑驗**；MAJOR-5 evidence optional 避 infra-HELD；N1 刪虛構 retry；N2 RED=KeyError 非 crash；line 容 null 抗幻覺）✓
- §5b DACS → Task 2（BLOCKER-4 落 fu-...js 輸入契約；誠實標 doc-only 限制）✓
- §5c evidence gate → **砍掉**（freeform state 無法可靠 gate，延後到先加 machine-marker 的獨立 spec）✓
- §5d M14 → N/A（grep 證據）✓
- BLOCKER-β（openspec successor）→ Task 0 archive（定死，非二選一）✓
- Task 1→Task 2 依賴：兩者觸及 fu-...js 不相交區段（:15-22 schema vs :44 入口）+ 不相交測試檔；可獨立 commit，依序較順。

**殘留誠實風險（執行者須知）**：
1. DACS「指揮官真截斷 q」是 doc 紀律，機械只驗入參合規。
2. evidence optional → citation 是「schema-shaped + prompt 強烈要求」非「頂層 required 硬性強制」；收嚴為 follow-up（須先實證 harness schema-violation drop 行為）。
3. 證據閘（原 Task 3）延後＝本 PR 不含 merge-time state 證據強制；現況靠 spec-to-done 內建 P6 P5-gate + gstack hook。
