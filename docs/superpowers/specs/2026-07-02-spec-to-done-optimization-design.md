# spec-to-done 優化設計：Sonnet 5 生產層下放 × Fable 5 arbiter 兜底層 × trailer/文檔除鏽

- 日期：2026-07-02（dateStamp 固定字串，全程禁時鐘 API）
- Branch：`feat/spec-to-done-optimization`
- 形式地位：本檔為本 PR 的 formal spec（`docs/superpowers/specs/*.md`，消 pr-review-agent `missing_openspec`）
- 合成依據：六提案 × 三判官評分。Base = 提案 1「Sonnet5-implementer 下放 × Fable-arbiter 兜底層 + trailer/文檔除鏽」（判官 1/3 best、聚合總分 24.955 全場最高、零 veto），嫁接判官 grafts（詳 §K）。

---

## (a) 背景與五目標

spec-to-done 檔案組（SKILL.md 指揮官手冊 + std-plan/std-implement/std-evidence 三引擎 + fu-adversarial-verify-generic + ship-item + routing.json/gen_routing.py/兩支 pinned tests + .codex model-adapter copy）目前的 routing 校準基於 Sonnet 4.6 時代，且 SKILL.md 保留整段「2026-06-15 Fable 5 官方停用」過時敘事。2026-07-02 事實：Fable 5（Mythos 級，能力 > Opus 4.8）已恢復供應且本 session 即 Fable 5 max；alias `sonnet` 由 harness 解析到 Sonnet 5（Claude 5 家族，能力顯著高於 4.6）。

五目標（優先序不可反轉）：

1. **提升任務完成精準度** — gates 只可強化不可弱化；Fable 5 用在兜底/裁決層是合法強化。
2. **降低 token 使用** — 壓縮/去重/tier 下放，必須符合品質守恆原則（I5）。
3. **加快整體速度** — 減 round-trip、模型換代紅利；「P3 implementer 嚴禁平行」不可違反。
4. **Sonnet 4.6 → Sonnet 5 重校** — alias 自動解析，實質工作為按 Sonnet 5 真實能力重校 tier 配置與清除 4.6 時代敘述。
5. **正式納入 Fable 5** — routing（含 allowed_efforts）與文檔納入 `fable`；清除停用註記；P5/P6/指揮官口徑改 session=Fable 5 max；commit trailer 統一為 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`（指揮官已裁決）。

核心設計 =「一升一降」：

- **降（唯一降級點）**：P3 implementer **全類 task 首發 sonnet**（原：mechanical→sonnet / 非機械→opus）。守恆依據（I5）：產出被 per-task spec review + quality review + final-review(fable) + P5 對抗複驗(fable session) ≥2 層更強 gate 複核；BLOCKED/NEEDS_CONTEXT → opus/max 升級通道逐字保留；且 implModel 恆為 sonnet 使 BLOCKED 升級條件覆蓋**全部** task（原本非機械 opus 首發 BLOCKED 直接走 held，現多一次升級機會 = 韌性強化）。這是 token 成本與 wall-clock 的最大單點紅利。
- **升（兜底層強化）**：新增 **arbiter tier（fable/max, immutable）** 承接三個單點失誤代價最高的位置：**plan 作者（P1）、final-review（P3 全 diff 總覆核）、P4 evidence 裁決（誠實鐵律本體）**。judge tier（opus/max, immutable）與全部 hard gates/held/args 一字不動。P5/P6/指揮官維持 runtime-default = session（= Fable 5 max），**零 .js 改動**、僅文檔口徑更新。

已評估並否決（precision 優先序 1 > token 優先序 2）：ship-item.js prompt 外移改 Read .md（subagent 讀檔能力未驗證，失敗 = P6 buffered-merge 靜默弱化，淨 token ≈0）；fu-adversarial PRE 324 字元模板壓縮（refute-by-default 立場語句是 gate 本體）；disciplineFor 1506 字元壓縮（commit/TDD/detect_changes 紀律錨點）；刪除 reason tier 與 flags 機制（routing-v3 式結構重寫，churn 大於收益，留待後續；reason 為零 call-site 死配置之事實記錄於 §g）；SKILL.md 編排 code block 壓縮（gate 字面本體，I1 禁）。

---

## (b) 最終 routing.json 全文

```json
{
  "tiers": {
    "extract":  { "model": "haiku",  "effort": null,    "note": "純抽取/格式化，零判斷，下游必複核" },
    "standard": { "model": "sonnet", "effort": "max",   "note": "讀/探索/標準實作(全類 task 首發)/首審；sonnet=Sonnet 5" },
    "reason":   { "model": "opus",   "effort": "xhigh", "note": "創造/長程；唯一 max->xhigh 降階點" },
    "judge":    { "model": "opus",   "effort": "max",   "immutable": true, "note": "驗證/fix；不可降，codegen 只驗不覆寫" },
    "arbiter":  { "model": "fable",  "effort": "max",   "immutable": true, "note": "單點裁決層(plan 作者/final-review/P4 evidence)；Fable 5，只可升不可降" }
  },
  "allowed_efforts": { "haiku": [null, "max"], "sonnet": ["high", "max"], "opus": ["xhigh", "max"], "fable": ["max"] },
  "flags": { "plan_author_xhigh": false },
  "do_not_codegen": ["std-implement.js:288", "std-implement.js:294", "std-implement.js:300"]
}
```

設計要點：

- `allowed_efforts.fable = ["max"]`（採提案 4/6 的收緊版而非 base 的 `["xhigh","max"]`）：validate() 層直接擋任何 fable 降 effort 嘗試，是額外的機制級 gate 強化；目前無 fable/xhigh call-site，刪除可能性 = win。
- `judge` tier 完全不動（opus/max、immutable）：plan-fix / spec-fix / quality-fix / fix-cycle / fix-verify 全部維持 opus/max，作為 sonnet 與 fable 間的一階升級緩衝。
- `do_not_codegen` 行號由 stale 的 276/282/287 刷新為 **288/294/300**（判官 1 設計時親讀核實為 287/293/299；落地後 ROUTING 生成區塊淨 +1 行（新增 arbiter 單行）使三個 `// do-not-codegen` 註解行整體下移 1 行，grep 實測 288/294/300 據此修正；測試比對用字串非行號，此欄位純供人讀）。
- `reason` tier 與 `flags` 保留原樣（最小 diff；flag=true 路徑 planAuthor 仍解析到 reason=opus/xhigh，翻 flag 屬刻意降級決策且被 test pin `flags.plan_author_xhigh is False` 擋住）。

生成後三支 std-*.js 的 `<routing:gen>` 區塊（由 codegen 產出，**禁手改**）：

```js
// <routing:gen>
const ROUTING = {
  extract: { model: 'haiku' },
  standard: { model: 'sonnet', effort: 'max' },
  reason: { model: 'opus', effort: 'xhigh' },
  judge: { model: 'opus', effort: 'max' },
  arbiter: { model: 'fable', effort: 'max' },
  planAuthor: { model: 'fable', effort: 'max' },
}
// </routing:gen>
```

---

## (c) 逐檔精確 edit 清單

> 通則：全部保留既有行尾/編碼；agent option 物件維持單行（consistency test 逐行 parse）；ROUTING 區塊只經 codegen 改動。

### c-1. `.claude/workflows/routing.json`

- 定位錨：整檔（11 行）。
- 動作：整檔改寫為 §b 全文（新增 arbiter tier、allowed_efforts 補 `"fable": ["max"]`、standard note 更新、do_not_codegen 行號刷新）。

### c-2. `scripts/gen_routing.py`（兩處單行）

- 錨 1（L36）：
  - 舊：`    plan = tiers["reason"] if flags.get("plan_author_xhigh") else {"model": "opus", "effort": "max"}`
  - 新：`    plan = tiers["reason"] if flags.get("plan_author_xhigh") else tiers["arbiter"]`
  - 理由：planAuthor 從 codegen 硬編變 data-driven 指向 arbiter（fable/max）；plan 是全下游地基、每 run 單發、單點失誤代價最高（判官 1/3 graft + 判官 2 base 共識）。
- 錨 2（L38）：
  - 舊：`    for key in ("extract", "standard", "reason", "judge"):`
  - 新：`    for key in ("extract", "standard", "reason", "judge", "arbiter"):`
- validate() 不動（資料驅動，自動涵蓋 fable）。

### c-3. `.claude/workflows/std-plan.js` / `std-implement.js` / `std-evidence.js` 的 ROUTING 區塊

- 動作：改完 c-1/c-2 後執行 `./.venv/Scripts/python.exe scripts/gen_routing.py` 重生三檔區塊（各 +1 行 arbiter、planAuthor 值變 fable/max），再 `--check` 驗零 drift。**禁手改區塊本體**。

### c-4. `.claude/workflows/std-implement.js`（手改區，4 處）

1. L286-287（do-not-codegen 保護點；保留 `model: implModel` 字面與單行格式）：
   - 舊：
     ```js
       const implModel = task.mechanical ? 'sonnet' : 'opus'
       // do-not-codegen: model 為 computed(task.mechanical ? sonnet : opus)
     ```
   - 新：
     ```js
       const implModel = 'sonnet'
       // do-not-codegen: Sonnet 5 起全類 task 首發 sonnet;BLOCKED/NEEDS_CONTEXT → opus/max 升級通道不變
     ```
   - L288 `model: implModel` 呼叫行、L293-295 NEEDS_CONTEXT 重派行、L299-301 BLOCKED 升級行**逐字不動**（pinned literals）。L297 條件 `impl.status === 'BLOCKED' && implModel === 'sonnet'` 保留原樣，語義自然擴為覆蓋全部 task。
2. L432 final-review call-site（單行）：
   - 舊：`  { label: 'final-review', phase: 'FinalReview', ...ROUTING.judge, schema: FINAL_SCHEMA })`
   - 新：`  { label: 'final-review', phase: 'FinalReview', ...ROUTING.arbiter, schema: FINAL_SCHEMA })`
3. L175 trailer（disciplineFor 內唯一原始碼位置，4 個呼叫點 189/281/351/389 全生效；**勿在呼叫點另貼字串**）：
   - 舊：`- commit message 繁中、第一行前綴「${commitPrefix}」,結尾附「Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>」。`
   - 新：`- commit message 繁中、第一行前綴「${commitPrefix}」,結尾附「Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>」。`
4. meta.phases L11（純 literal 描述同步；Fix 列 L10 維持 opus 不動，因 fix 系列仍走 judge）：
   - 舊：`    { title: 'FinalReview', detail: 'opus 整體 diff vs plan+spec,產出 adversarial findings', model: 'opus' },`
   - 新：`    { title: 'FinalReview', detail: 'fable(arbiter) 整體 diff vs plan+spec,產出 adversarial findings', model: 'fable' },`

### c-5. `.claude/workflows/std-plan.js`（手改區，3 處）

1. L114 trailer：字串內 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` → `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
2. L182 trailer：同上（獨立字串，需各改一次）。
3. meta.phases L7：
   - 舊：`    { title: 'Plan', detail: 'opus 作者照 writing-plans 規格寫 plan 檔並 commit', model: 'opus' },`
   - 新：`    { title: 'Plan', detail: 'fable(arbiter) 作者照 writing-plans 規格寫 plan 檔並 commit', model: 'fable' },`
   - L8 PlanReview detail「plan-fix 仍 opus」維持不動（plan-fix 走 judge=opus/max，敘述仍正確）。

### c-6. `.claude/workflows/std-evidence.js`（手改區，2 處）

1. L113 evidence call-site（單行）：`...ROUTING.judge` → `...ROUTING.arbiter`。
2. meta.phases L9：
   - 舊：`    { title: 'Evidence', detail: 'opus 跑 E2E、收 evidence、逐項裁決 vertical slice', model: 'opus' },`
   - 新：`    { title: 'Evidence', detail: 'fable(arbiter) 跑 E2E、收 evidence、逐項裁決 vertical slice', model: 'fable' },`

### c-7. `.claude/workflows/ship-item.js`（2 處；agent() 維持無 model 欄位 = runtime default）

1. L41 trailer：`結尾附 Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>。` → `結尾附 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。`
2. L30 prompt 首行句尾加同步註記（消雙份維護 drift 的低成本層；外移方案已否決）：
   - 舊：`const result = await agent(\`你是 AI-BIM-governance 的 ship-cycle 執行 agent。請對一個已完成的 work item 走 .claude/workflows/ship-item.md 定義的完整 buffered ship-cycle。`
   - 新：`const result = await agent(\`你是 AI-BIM-governance 的 ship-cycle 執行 agent。請對一個已完成的 work item 走 .claude/workflows/ship-item.md 定義的完整 buffered ship-cycle。（本 prompt 步驟 0-11 與 ship-item.md 為雙份維護：修改任一側 MUST 同步另一側。）`

### c-8. `.claude/workflows/ship-item.md`（4 處）

1. L3 blockquote 句尾追加：`本檔與 ship-item.js 內嵌 prompt 為雙份維護：修改任一側 MUST 同步另一側。`
2. L15 trailer code block：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` → `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
3. 「## 步驟」節、現行 step 1 之前插入正式 step 0（把 .js prompt 內隱形防呆升為 .md 單一權威；判官 2/3 graft）：
   ```md
   0. **checkout 防呆**：若指定 branch 且當前不在該 branch（`git rev-parse --abbrev-ref HEAD` 比對），先 `git checkout <branch>` 再動作，避免 commit/push 推錯 branch。
   ```
4. L63 required checks「共 11 項」：**實作時先 `gh api repos/monkey1sai/AI-BIM-governance/branches/main/protection --jq '.required_status_checks.contexts | length'` 核實現值**；數字未變則零改動，變了才更新（條件式 edit；不盲信快照）。

### c-9. `tests/test_routing_json.py`（新全文）

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
    assert tiers["arbiter"]["model"]  == "fable"  and tiers["arbiter"]["effort"]  == "max"
    assert tiers["arbiter"].get("immutable") is True
    allowed = data["allowed_efforts"]
    assert allowed["fable"] == ["max"]
    for name, t in tiers.items():
        assert t["effort"] in allowed[t["model"]], f"{name}: {t['effort']} not allowed for {t['model']}"
    assert data["flags"]["plan_author_xhigh"] is False
    assert data["do_not_codegen"] == ["std-implement.js:288", "std-implement.js:294", "std-implement.js:300"]
```

（相對舊版：+arbiter 兩斷言、+fable allowed_efforts 等值斷言、do_not_codegen 由 `in` 改整列等值並刷新行號；既有四 tier/flags 斷言逐字保留。）

### c-10. `tests/test_routing_consistency.py`（3 處）

1. EXPECTED dict（L13-19）兩值改動：
   ```python
   EXPECTED = {
       "std-plan.js":      {"plan:author":"planAuthor","plan-review:":"standard","plan-fix:":"judge","impact:prescan":"standard"},
       "std-implement.js": {"parse:plan":"extract","impact:${T}":"standard","spec-review:":"standard",
                             "spec-fix:":"judge","quality-review:":"standard","quality-fix:":"judge","final-review":"arbiter",
                             "fix:cycle":"judge","fix:verify":"judge"},
       "std-evidence.js":  {"probe:engine":"extract","evidence:":"arbiter"},
   }
   ```
2. `test_judge_block_is_opus_max_literal` **一字不動**（judge 仍 opus/max，證明 judge 未被弱化）；其後新增對稱測試：
   ```python
   def test_arbiter_and_planauthor_blocks_are_fable_max_literal():
       # gate 只增不減：arbiter/planAuthor 逐字釘 fable/max，防被靜默降回
       for fn in EXPECTED:
           content = _read(fn)
           assert "arbiter: { model: 'fable', effort: 'max' }" in content, f"{fn}: arbiter 區塊非 fable/max"
           assert "planAuthor: { model: 'fable', effort: 'max' }" in content, f"{fn}: planAuthor 區塊非 fable/max"
   ```
3. `test_do_not_codegen_sites_unchanged` 新全文（+1 斷言鎖住下放決策本身；兩條 opus/max 升級字面與 `model: implModel` 逐字保留；訊息內 stale 行號同步刷新）：
   ```python
   def test_do_not_codegen_sites_unchanged():
       impl = _read("std-implement.js")
       assert "const implModel = 'sonnet'" in impl, ":288 全類 task 首發 sonnet 基線被改"
       assert "model: implModel" in impl, ":288 implModel call-site 被 codegen 覆寫"
       assert "label: `impl:${T}:retry`, phase: 'Implement', model: 'opus', effort: 'max'" in impl, ":294 補救升級被改"
       assert "label: `impl:${T}:opus`, phase: 'Implement', model: 'opus', effort: 'max'" in impl, ":300 升級被改"
   ```
   （其餘測試 `test_codegen_no_drift` / `test_callsites_reference_expected_tier` / D3 測試零改動。）

### c-11. `.claude/skills/spec-to-done/SKILL.md`（4 處）

1. **L11 sync 義務句**（按新 tier 更新）：
   - 舊片段：`(只把 haiku/sonnet/opus tier 映射到 GPT 模型與調整 helper 路徑、不改 gate)`
   - 新片段：`(只把 haiku/sonnet/opus/fable tier 映射到 GPT 模型與調整 helper 路徑、不改 gate)`
2. **L189-203 模型預算節整段重寫**（舊 15 行 → 新 14 行；L191 ⚠blockquote 整段刪除）。新成品全文：

   ```md
   ## 模型預算(agent 四級 haiku/sonnet/opus/fable + 指揮官/runtime-default=session=Fable 5 max;gates 不動)

   | 位置 | 模型 | 品質守恆(誰兜底) |
   |---|---|---|
   | 指揮官(主對話) | 當前 session(**Fable 5 max**;2026-07-02 恢復供應,正式納入 routing) | — |
   | plan 解析(P3 Parse)、引擎偵測(P4 Probe) | haiku | 機械抽取/探測,錯誤顯性:抽壞 → implementer 立刻 BLOCKED;探錯 → E2E 起不來即 held |
   | GitNexus impact 預掃 + per-task impact、**全類 task implementer 首發(機械/非機械皆是)**、P1 四軸 reviewer、P3 spec/quality reviewer(首審) | sonnet(=Sonnet 5) | impact 只是風險輸入(CRITICAL gate 在指揮官);implementer 有雙 review + final-review(fable) + P5 兜底,BLOCKED/NEEDS_CONTEXT → opus/max 升級通道 |
   | NEEDS_CONTEXT/BLOCKED 升級重派、plan/spec/quality fix、fix-cycle + fix-verify(P5 修復) | opus(judge tier,immutable) | 修復/迭代兜底層,**不降**;sonnet 與 fable 間的一階升級緩衝 |
   | plan 作者、final-review(全 diff 兜底)、evidence 執行+裁決(P4 誠實鐵律本體) | fable(arbiter tier,immutable) | 單點失誤代價最高,**只可升不可降** |
   | P5 fu-adversarial-verify-generic(verifier + critic)、P6 ship-item | runtime default(=session 模型,現為 **Fable 5 max**) | P5=抓雷主力(實績:#206 三顆連環雷 + fix 自引 regression 全在 merge 前攔下);P6=端到端代理操作(git/gh/merge 判斷),sonnet 首跑即出程序偏差(#208),**兩者不降** |

   升級通道(自動,腳本內建):sonnet implementer(全類首發)回 BLOCKED → 換 opus/max 重派;NEEDS_CONTEXT → opus/max 補脈絡重派。fable 供應中斷時(2026-06-15 有前科):routing.json 的 arbiter 暫改 opus/max(供應例外,非品質降級),與 gen_routing 重生、兩支 pinned tests 同 commit 原子回退。
   平行:P1 四軸 review、P5 per-finding verifier 平行;**P3 implementer 嚴禁平行**(實作衝突)。
   **降本原則**:hard gates(四軸 approved 條件/兩階段 review 閉合條件/P4 vertical slice 七項/P5 refute-by-default + critic/P6 buffered merge)一個不動;降級只發生在「產出被 ≥2 層更強 gate 複核」或「錯誤顯性必爆」的位置。等效性靠 gate 結構保證,非靠單點模型強度。
   ```

   （L202 平行規則、L203 降本原則逐字保留；升級通道行擴入供應中斷 SOP——判官 2/3 graft。）
3. **L218 已知限制 item3 改寫**（採判官 1 graft 的誠實口徑：「第一次對齊」非「改回」）：
   - 新全文：`3. commit trailer:std-*.js 與 ship-item 內的 \`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>\` 是 **harness attribution 文字、非模型調用**(agent 實際模型由 routing/session 決定)。2026-07-02 已裁決與現行 harness commit 規則同步為單一 trailer——此為文件與程式碼**第一次真正對齊**(先前程式碼字面是 Opus 4.8、本檔敘述卻寫 Fable 5,兩邊各錯一半),非「改回」。`
4. **其餘全部逐字不動**：編排 code block(58-125)、held 對照表、強制停下點、hold block 格式、誠實鐵律、雙源交叉驗證節、backend port 前置節、已知限制 1/2/4/5/6/7、維運注意事項。

### c-12. `.claude/workflows/spec-to-done-adversarial-verify.js`（1 處）

- L37 PRE 內過時架構句：
  - 舊：`模型:fable=讀/導航/機械,opus=設計/裁決/實作。`
  - 新：`模型:haiku=抽取/探測,sonnet(=Sonnet 5)=impact/標準實作(全類 task 首發)/首審,opus=judge(fix 系列/BLOCKED/NEEDS_CONTEXT 升級重派),fable=arbiter(plan 作者/final-review/evidence 裁決)+指揮官與 P5/P6 runtime-default(=session)。`
- L59 model enum（`sonnet/opus/haiku/fable`）已含 fable，**不動**。

### c-13. `.codex/skills/spec-to-done/SKILL.md`（Codex 對齊，詳 §i；6 處）

見 §(i) 逐節規格。

### c-14. `openspec/specs/ai-coding-governance/spec.md`（2 處，最小修訂）

1. Requirement 本文（L56）句中 `the judgment layer (\`judge\` tier) SHALL remain at the highest effort and be immutable to codegen` 之後追加：`, the adjudication layer (\`arbiter\` tier, \`fable\`/\`max\`) SHALL likewise be immutable and only ever strengthened`。
2. Scenario「Effort downgrade flag defaults off (zero behavior change)」（L64-68）改寫：
   - 標題：`#### Scenario: Plan-author resolves to the arbiter tier when the effort downgrade flag is off`
   - THEN 行：`- **THEN** it SHALL resolve to the \`arbiter\` tier (\`fable\` / \`max\`); flipping the flag to \`true\` is a deliberate downgrade decision that requires updating the pinned tests in the same commit.`
   - Scenario「Judge tier and do-not-codegen sites are protected」（L70-74）**不動**（judge 仍 opus/max、三 pinned 字面仍逐字存活，敘述持續為真）。
   - 註：openspec 已退役為歷史稽核面（#189），但本檔是唯一 pin routing 機制的規格檔，planAuthor 解析變更若不同步會被治理審計抓；`openspec/changes/archive/**` immutable，不碰。

---

## (d) 刪除段清單與外移目的地

| 刪除內容 | 位置 | 外移目的地 / 處置 |
|---|---|---|
| 「⚠ 2026-06-15 Fable 5 官方停用」整段 blockquote（約 600 字元） | canonical SKILL.md L191 | 刪除。恢復供應事實併入指揮官表格列；供應中斷應急程序外移至 L201 升級通道行（SOP 一句話） |
| item3 的「legacy / 待決策 / 雙 trailer 風險」自我懷疑敘述（約 500→280 字元） | canonical SKILL.md L218 | 改寫為已裁決口徑（c-11.3），不外移 |
| 指向磁碟上不存在的 global helper 路徑 `C:\Users\IOT\.codex\skills\spec-to-done\ensure-host-native-ports-free.ps1` | .codex SKILL.md L175-181 | 直接刪除該行 + 「三份」改「兩份」（判官 3 graft：親盤點證實不存在，優於「若存在」括註）；無外移 |
| item6 的「#202 paths-ignore 可跳過 / main 無 branch protection」stale 敘述 | .codex SKILL.md L231 | 以 canonical L221 的 2026-07-02 gh api 查證版覆蓋（保留 `:55` gitignore 資訊） |
| `sonnet-low` 自造 tier 標籤 | .codex SKILL.md L206 | 改為 canonical 詞彙 `sonnet(輕量面)`；implementer 職掌移至 gpt-5.4 列 |

---

## (e) 一致性鏈 checklist（I3 逐項，實作依此順序核銷）

1. [ ] `routing.json` 改寫（+arbiter/+allowed_efforts.fable=["max"]/standard note/do_not_codegen 288/294/300）——唯一手改的 routing 源。
2. [ ] `scripts/gen_routing.py`：L36 planAuthor→`tiers["arbiter"]`、L38 迴圈 +`"arbiter"`。
3. [ ] 跑 `./.venv/Scripts/python.exe scripts/gen_routing.py` 重生 std-plan/std-implement/std-evidence 三支 ROUTING 區塊（各 +單行 arbiter、planAuthor 變 fable/max；禁手改）→ 同指令 `--check` 零 drift。
4. [ ] `std-implement.js` 手改：L286 `const implModel = 'sonnet'` + L287 註解、L432 `...ROUTING.arbiter`、L175 trailer、meta FinalReview→fable（保留 `model: implModel` 與兩條 opus/max 升級行字面、全部單行）。
5. [ ] `std-plan.js` 手改：L114/L182 trailer、meta Plan→fable。`std-evidence.js` 手改：L113 `...ROUTING.arbiter`、meta Evidence→fable。
6. [ ] trailer 五處程式碼字面原子同改：`std-plan.js:114`、`std-plan.js:182`、`std-implement.js:175`（disciplineFor 單源）、`ship-item.js:41`、`ship-item.md:15` → `Claude Fable 5`。
7. [ ] `tests/test_routing_json.py`：arbiter/fable pin + do_not_codegen 整列等值（288/294/300）。
8. [ ] `tests/test_routing_consistency.py`：EXPECTED 兩處 judge→arbiter、新增 arbiter/planAuthor fable/max 字面測試、do-not-codegen 函式 +`const implModel = 'sonnet'` pin（judge 字面測試不動）。
9. [ ] canonical `SKILL.md`：L11 tier 清單、模型預算節整段（c-11.2 成品）、item3 口徑——表格值必須與 routing.json/std-*.js 改後現實逐格對得上。
10. [ ] meta 驗證器 `spec-to-done-adversarial-verify.js:37` 架構敘述同步（:59 enum 已含 fable 免改）。
11. [ ] `.codex/skills/spec-to-done/SKILL.md` 六處同步（§i）——I7 / canonical L11 MUST-sync 義務。
12. [ ] `ship-item.js` 同步註記 + `ship-item.md` step 0 / 同步註記 / required-checks 數字 gh api 核實。
13. [ ] `openspec/specs/ai-coding-governance/spec.md` L54-80 兩處最小修訂（c-14）。
14. [ ] 收尾驗證（§h 全套）+ scoped grep 殘留掃描 + `git add` 全部目標檔後才跑 pytest（D3 測試只掃 tracked）。

---

## (f) 預估 before→after 大小與 token 節省（**全為估計，未經真 run 量測**）

| 項目 | before | after(估) | 說明 |
|---|---|---|---|
| canonical SKILL.md | 226 行 / 23,542 bytes | ~225 行 / ~22,900 bytes | blockquote −600 字元、item3 −220 字元、表格 +1 列 +~300 字元;淨 −400~−650 字元。**誠實註記：190 行目標不可達**——唯一夠肥的編排 code block 是 gate 字面本體，I1 禁壓縮;寧可少刪不硬湊 |
| 指揮官每 run context | — | −150~−250 token(估) | SKILL.md 為指揮官必讀 |
| 三支 std-*.js ROUTING 區塊 | — | 各 +~45 字元 | +arbiter 單行;一次性打破 prompt cache 前綴(TTL 5 分),僅首 run 輕微變慢 |
| ship-item.js/.md、codex SKILL.md | — | 淨 +~350 字元 | 同步註記/step 0/DACS 註記/arbiter 列 > item6 縮短;多數不在每-agent 熱路徑 |
| **每 run API 成本** | baseline | **−20%~−40%(估)** | 主紅利:P3 implementer(生成量大宗、非機械占多數)opus→sonnet,單價比約 4~5:1;反向:arbiter 三點位(plan author/final-review/evidence,各每 run 1 次)fable 加價估 +5~10% |
| **每 run wall-clock** | baseline | **−15%~−30%(估)** | Sonnet 5 吞吐 + BLOCKED/NEEDS_CONTEXT 升級重派頻率預期下降(每次重派=整輪序列 round-trip);fable 三點位單發可能各 +0.5~2 分鐘,佔比小;並行結構零變動 |

---

## (g) 風險與緩解

1. **Sonnet 5 在 Kit/USD/ifcopenshell 冷門領域首發品質未實測**（唯一降級點）。緩解：BLOCKED/NEEDS_CONTEXT→opus/max 升級通道自動兜底不損正確性；**失效訊號 = run log 中 `impl:*:opus` / `impl:*:retry` label 頻率超基準**；回退 = 還原 `std-implement.js:286` 單行為原三元式 + 同步刪 c-10.3 新 pin（一 commit 可完成）。此「可量測、可回退、有書面反證（#208 sonnet 程序偏差警訊屬 P6 自主任務、非 implementer 情境）」條款寫進 PR body（判官 3 graft）。
2. **Fable 5 供應中斷前科（2026-06-15）**：arbiter 三 call-site 會回 null——既有分支 fail-safe（final null→合成 `f-final-null` 進 P5 全 diff 通讀；evidence null→`held:'no_browser_evidence'`；plan null→`held:'plan_author_failed'`），不會靜默弱化但 run 會 held。應急 SOP 已文檔化於 SKILL.md 升級通道行（c-11.2）。
3. **一致性鏈 14 節點漏改任一即 CI 紅或審計復發**：字面測試不會提示改哪裡；緩解 = §e checklist 逐項核銷 + §h 全套驗證。
4. **trailer 雙軌復發**：五處程式碼字面 + canonical item3 + codex item3 漏一即雙 trailer。驗收 = **scoped grep**（§h 第 6 條）；**嚴禁全庫 grep 後順手改歷史檔**——`docs/superpowers/plans/*.md` 與 `openspec/changes/archive/**` 含大量歷史 `Opus 4.8 (1M context)` 字面，屬不可改歷史文件（判官 3 親查證實；違者踩 I6）。
5. **pr-review-agent 是 main required check 且無 paths-ignore**：本 PR 全落 `.claude/**`/`.codex/**`/`tests/`/`openspec/`，PR body 必須照 AI Coding Governance body-evidence 表填誠實值；本設計檔即 formal spec（消 missing_openspec）。
6. **agent option 單行格式**：重生區塊或改 call-site 時 reflow 換行會讓 consistency test 逐行 parser 假性失敗；c-3~c-6 全部維持單行。
7. **flag=true 潛在降級路徑**（planAuthor→reason=opus/xhigh）：被 `flags.plan_author_xhigh is False` pin 擋住；翻 flag 須同 commit 改測試，屬顯性決策。
8. **codex copy 行數持續增肥**（233→~240）：無硬預算，趨勢記錄供下輪關注。
9. **P1 Impact × PlanReview round-0 推測性並行**（提案 2 的速度加碼）：**本次不做**，留獨立 follow-up PR，且合入前必須先對 std-plan.js 加專門 stale-impact 重驗測試（symbol 集變動即序列重跑新鮮 impact 過 CRITICAL gate）——三判官一致 walled（動 gate-critical 控制流 + resume 路徑）。

---

## (h) 驗證計畫（cwd = repo root；全部真跑並引用關鍵輸出；先量 baseline 再改）

```
0. baseline(已綠,改前重確認):
   ./.venv/Scripts/python.exe -m pytest tests/test_routing_json.py tests/test_routing_consistency.py -p no:cacheprovider -q   # 6 passed
   ./.venv/Scripts/python.exe scripts/gen_routing.py --check                                                                  # exit 0
1. ./.venv/Scripts/python.exe scripts/gen_routing.py            # 改 routing.json/gen_routing.py 後重生區塊
2. ./.venv/Scripts/python.exe scripts/gen_routing.py --check    # must exit 0(零 drift)
3. git add 全部目標檔(D3 測試只掃 tracked)後:
   ./.venv/Scripts/python.exe -m pytest tests/test_routing_json.py tests/test_routing_consistency.py -p no:cacheprovider -q
   # 期望:7 passed(6 baseline + 新增 test_arbiter_and_planauthor_blocks_are_fable_max_literal)
4. node --check .claude/workflows/std-plan.js
   node --check .claude/workflows/std-implement.js
   node --check .claude/workflows/std-evidence.js
   node --check .claude/workflows/ship-item.js
   node --check .claude/workflows/spec-to-done-adversarial-verify.js
5. wc -l .claude/skills/spec-to-done/SKILL.md                   # <=226(預期 ~225)
6. scoped 殘留掃描(不含 worktrees/歷史檔):
   grep -rn "Opus 4.8 (1M context)" .claude/workflows .claude/skills .codex/skills   # 期望 0 hit
   grep -n "Fable 5 官方停用" .claude/skills/spec-to-done/SKILL.md .codex/skills/spec-to-done/SKILL.md  # 期望 0 hit
7. git --no-pager diff --stat    # 不得出現任務範圍外檔案
   git --no-pager diff --check   # 無 whitespace 錯
```

補充：ship-item.md required-checks 數字核實用 `gh api repos/monkey1sai/AI-BIM-governance/branches/main/protection --jq '.required_status_checks.contexts | length'`（僅讀取）。

---

## (i) Codex 對齊規格（`.codex/skills/spec-to-done/SKILL.md`；I7：只配接 executor/model/path，不改 gate）

### 要改的節

1. **L200 tier 詞彙句**：`Claude 版的 haiku / sonnet / opus 是**任務難度 tier**` → `Claude 版的 haiku / sonnet / opus / fable 是**任務難度 tier**`（其後「不得因模型降級而刪減 P4/P5/P6 或放寬 HELD 條件」保留）。
2. **模型預算對照表（L202-209）納入 fable/arbiter**，成品列：
   - 指揮官列（L204）「對齊的 Claude tier」欄 → `runtime default / fable(Claude 側 session=Fable 5 max)`。
   - L206（gpt-5.4-mini）：移除「機械性 task implementer」職掌，`sonnet-low` 標籤改 `sonnet(輕量面)`——新職掌只剩 impact 預掃/per-task impact/非 gate 初步檢查。
   - L207（gpt-5.4）：職掌加 `**全類 task implementer 首發(機械/非機械皆是)**`，對齊 tier 由 `sonnet / opus boundary` 改 `sonnet`；兜底欄加 `BLOCKED/NEEDS_CONTEXT → gpt-5.5 升級`。
   - L208（gpt-5.5）：職掌縮為 `NEEDS_CONTEXT/BLOCKED 升級重派、plan/spec/quality fix、fix-cycle + fix-verify(P5 修復)`，對齊 tier = `opus(judge)`。
   - **新增 arbiter 列**：`| plan 作者、final-review(全 diff 兜底)、evidence 執行+裁決(P4 誠實鐵律本體) | gpt-5.5 xhigh(GPT 側無 Mythos 級對等品,取最高檔並在此註明) | fable(arbiter) | 單點失誤代價最高,**只可升不可降** |`。
   - L209 runtime-default 列：對齊 tier 註記 `(Claude 側現為 Fable 5 max)`。
   - L211 升級通道：改 `gpt-5.4 implementer 回 BLOCKED 或 NEEDS_CONTEXT → 換 gpt-5.5 high/xhigh 重派`（mini 不再派 implementer）。
3. **stale 節對齊 canonical**：
   - **已知限制 #3（L228）**：trailer 敘述同步——`std-*.js 與 ship-item 內的 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> 是 harness attribution 文字、非 Codex 模型調用。Codex agent 實際模型分配以本檔「模型預算」表為準;trailer 已於 2026-07-02 與 Claude 側 harness commit 規則同步為單一 trailer,Codex 側 commit 沿用同一字面。`
   - **已知限制 #6（L231）**：整句以 canonical L221 的 2026-07-02 gh api 查證版覆蓋（pr-review-agent 對所有 PR 跑、#202 paths-ignore 已移除、是 main branch protection 11 項 required check 之一），**保留 codex 側獨有的 `:55` `!.codex/skills/spec-to-done/` gitignore 資訊**。
4. **P5 段補 DACS findings-registry 註記**（既有 sync debt；`fu-adversarial-verify-generic.js:45-47` 已實證為真 gate）：在 codex P5 block 的 criticFocus 行後插入與 canonical L88-90 逐字等價的三行註解（`{id, q≤800, suspectFile}` registry + `held:'bad_findings'` fail-fast + 指揮官截斷紀律）。
5. **helper 路徑清單（L175-181）**：刪除磁碟上不存在的 `C:\Users\IOT\.codex\skills\spec-to-done\ensure-host-native-ports-free.ps1` 一行；「三份 helper 若同時存在,內容必須維持一致」改「兩份 helper 內容必須維持一致(user 級路徑經 2026-07-02 磁碟盤點確認不存在,勿引用)」。

### 保留的 Codex-only 節（零改動）

- L13-21「Codex 對齊補充」整節（Workflow phase-contract 等價、無 parent-only fallback、commit-guard/gstack hook 手動代償、雙圖譜同義）。
- gpt-5.x 階梯本身（gpt-5.3-codex-spark / 5.4-mini / 5.4 / 5.5 四階）——adapter 自主權，僅職掌重排。
- 已知限制 #1/#2/#4/#5/#7（與 canonical byte-identical，無 drift）。
- `ensure-host-native-ports-free.ps1` 本體。

### 明確不同步的對象

- **Global `C:\Users\IOT\.codex\skills\spec-to-done\`**：經查證為結構獨立 skill（自帶 P2 Test Design 階段、自有 artifact schema、3 階 gpt 梯不掛 routing.json，全文無 Fable/Opus 4.8/sonnet 4.6 字樣）→ **不受本次核心邏輯變更波及，零同步需求；不得當第三面鏡子改**。唯一關聯 = repo codex copy 刪除指向它的壞 helper 路徑後兩邊自然收斂。

---

## (j) 本次不動的檔案與原因

| 檔案 | 原因 |
|---|---|
| `.claude/workflows/fu-adversarial-verify-generic.js` | **零 diff（刻意）**。P5 verifier+critic 無 model 欄位 = runtime default，session=Fable 5 max 自動升級；硬編 model 會破壞其被 P5/P6 共用的參數化設計。PRE 模板壓縮已否決（gate 本體） |
| `.claude/skills/spec-to-done/ensure-host-native-ports-free.ps1` 與 `.codex` 同名檔 | 任務明列本次不動 |
| Global `C:\Users\IOT\.codex\skills\spec-to-done\**` | 獨立 skill，evaluate-only 結論 = 無耦合、零同步（§i） |
| `docs/superpowers/plans/*.md`、`openspec/changes/archive/**` | 含歷史 `Opus 4.8 (1M context)`/`Claude Fable 5` trailer 字面，屬 immutable 歷史文件；scoped grep 刻意排除 |
| canonical SKILL.md 編排 code block(58-125)、held 對照表(129-142)、強制停下點(144-147)、hold block 格式(149-155)、誠實鐵律(205-212)、雙源交叉驗證(22-34)、backend port 前置(164-187)、已知限制 1/2/4/5/6/7 | I1：gate/held 字面本體，一字不動；port 節 L171「若…亦存在,三份一致」為條件句仍為真，不改 |
| `routing.json` 的 `reason` tier 與 `flags` 機制 | 零 call-site 死配置 + flag 語義保留 = 最小 diff；結構性清除（routing-v3 式）留待後續獨立提案 |
| `std-plan.js` PlanReview meta detail、axisPrompt/impact prompt 的 MUST 語句 | gate 強制語句錨點（「不得升降 risk、不得寫入 blockers」等），壓縮 = 弱化 |
| `AGENTS.md`、`docs/agents/**`、`docs/plans/**` | 已知限制 item1/2 的外部字面落差屬另開 docs PR 的範圍，本次不越界 |
| P1 Impact × PlanReview 推測性並行 | 三判官一致 walled 為 follow-up PR（需先加 stale-rerun 專門測試） |

---

## (K) 合成裁決紀錄（判官共識 → 最終取捨）

| 決策 | 來源 | 裁決 |
|---|---|---|
| Base = 提案 1 | 判官 1 best(8.325)、判官 3 best(8.7)、判官 2 並列次高(7.93)；聚合 24.955 全場最高、零 veto | 採用 |
| planAuthor → arbiter(fable/max) | 判官 1 graft(明示 base 保留 opus 理由較弱)、判官 2 base 內建、判官 3 opt-in；使用者事實地圖明列 plan 作者為 fable 合法點位 | **採用**（精準度優先裁決 base 與 grafts 的唯一實質衝突） |
| allowed_efforts.fable=["max"]（非 base 的 ["xhigh","max"]） | 提案 4/6；validate 層 gate 強化 + 刪除可能性=win | 採用（收緊版） |
| `const implModel = 'sonnet'` CI pin | 判官 1/3 graft（提案 6 原創） | 採用 |
| fable 供應中斷 SOP 入 SKILL.md | 判官 2/3 graft（提案 6 原創） | 採用（併入升級通道行守行數） |
| item3「第一次對齊」誠實口徑 | 判官 1 graft（提案 5 原創；grep 證實 canonical 原敘述為誤植） | 採用 |
| do_not_codegen 刷新 287/293/299 | 判官 1 graft（親讀核實註解行座標；否定 base 自稱的 288/295/301） | 採用 |
| codex 壞 helper 路徑直接移除（非「若存在」括註） | 判官 3 graft（提案 6 親盤點） | 採用 |
| ship-item.md step 0 正式化 + gh api 核實 11 checks；否決 .js prompt 外移 | 判官 2/3 graft（各取提案 6 安全半部） | 採用 |
| trailer grep 限定 scoped 範圍 | 判官 3 graft（親 grep 證實歷史檔大量命中） | 採用 |
| judge tier 升 fable（提案 3/4/6 路線） | 判官 2 曾傾向；但 base + 判官 1/3 共識為 judge 不動、fable 只落單發裁決點——fix 迭代層全升 fable 撞 token（違目標 2）且失去 opus 一階升級緩衝 | **否決**（judge=opus/max immutable 不動） |
| 刪 reason tier / 刪 flags（routing-v3/提案 6） | 判官未 graft；churn 集中在最多 pin 的檔案、feasibility 被評 5~6.5 | 否決（記錄為後續候選） |
| P1 推測性並行（提案 2） | 三判官一致標 walled follow-up | 延後（獨立 PR + stale-rerun 測試前置） |

## (L) PR body 必附條款（實作者責任）

1. AI Coding Governance body-evidence 表（pr-review-agent required check，缺項 exit 1；誠實值，不填 -/tbd/n-a）。
2. 「考慮後拒絕」清單（§K 否決列）與 implementer 下放的失效觀測條款：監看 `impl:*:opus` / `impl:*:retry` 頻率，超基準即回退 `std-implement.js:286` 單行 + 刪 implModel pin。
3. 雙圖譜/detect fallback 依既有規則揭露；本 PR 為純 tooling/docs（無 runtime deploy 面），Frontend/Deploy 兩表註明不適用。

## (M) 維運紀錄（post-merge）

- 2026-07-02 本設計以 PR #284（squash `8adcb1f`）merge 進 main；兩輪 CI 全綠（期間 main 並行推進 2 commits，與 #282 對兩份 SKILL.md 的改動語義正交，merge 調和後重驗 79 passed）。
- merge 後依 CLAUDE.md §4 重建 GitNexus 索引：`.gitnexus/meta.json lastCommit=8adcb1f`，計數 15954→16063 symbols、26201→26312 relationships、flows 300 不變；AGENTS.md / CLAUDE.md 自動維護區塊計數行隨之同步（該同步 PR 以本節為正式依據，設計語義零變更）。
- 待辦（§K 延後項之外）：以一次真實 spec-to-done run 量測 token/wall-clock，把 §f 估計值轉實測；監看 `impl:*:opus` 升級頻率（§L.2 觀測條款）。
