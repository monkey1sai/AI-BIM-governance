# 六邊形 harness 升級設計（routing 脊椎 + 抗幻覺 + 自我進化空殼）

- 日期：2026-06-18
- 狀態：設計定案（已過 3 Sonnet + 2 Opus + 1 Opus/max 對抗審批，NO-GO→修訂後採納全部必修）
- 交付：**3 個依序 PR**（PR-A → PR-B → PR-C），本 spec 一份涵蓋三者
- 來源：`artifacts/hexagon-coding-agent-upgrade-plan.md`（六邊形研究合成）+ 對抗審批 16 條必修

---

## 1. 目標與成功標準

把 spec-to-done 流水線從「Opus/Sonnet 幾乎全 `max`」升級成**四檔 routing 單一真相**，並補抗幻覺機械閘與自我進化空殼。**只動有下游 gate 複核的位置，judge 層碰不得**。

成功標準：
- routing.json 為唯一真相，CI 有確定性 pytest 擋漂移。
- 唯一 routing 值變更（`std-plan.js:119` plan 作者 `max→xhigh`）擺 flag 後，且用 P0 baseline A/B 證明不劣化才預設開。
- 抗幻覺三閘上線且不誤擋正常流程。
- L3 自我進化以 inert stub 進、預設關、零可執行邏輯。
- `python -m pytest tests`（走 `.venv\Scripts\python.exe`）全綠。

非目標（本輪不做）：
- **P3 並行放大延後**（`openspec-converge.js` 與三角辯論均被審批判 YAGNI/未定義，留未來獨立 spec）。

---

## 2. 約束（grounded facts，實作時據此查核）

- **workflow 腳本不能互相 import**（已 grep 證實所有 `.claude/workflows/*.js` 開頭只有 `export const meta`，無 import/require；runtime 沙箱無檔案系統/Node API）。故 routing 單一真相只能靠 **codegen + 測試**，不能 runtime import。每支 `std-*.js` 各 inline 一份完整 `const ROUTING`，**絕不生獨立模組**。
- **effort 合法階**：Sonnet 只有 `high`、`max`（無 `xhigh`）；Opus 支援 `xhigh`、`max`。非法組合（如 sonnet+xhigh）SDK 會靜默忽略 → 必須在 codegen 前驗證並 throw。
- **命名衝突**：`std-implement.js:275` 的 `task.mechanical` 指「機械式*實作*任務→sonnet」，與路由層 haiku 純抽取**不同概念**。路由 haiku 層命名為 **`extract`**，不得叫 `mechanical`。
- **`std-implement.js:276` 是 computed model 且無 effort**：`model: implModel`（`task.mechanical ? 'sonnet':'opus'`），不在「16 處 max」內，**永不 codegen**。
- 既有鐵律：誠實鐵律（無 backend 標 `DEMO DATA`/`NOT BUILT`/`not observed`）；P3 implementer 嚴禁平行；不在 main 開發走 branch→PR→Actions→merge；GitNexus impact 改 symbol 前必跑；pytest 走 `.venv`。
- 既有 evidence 閘是 **PreToolUse on `Bash(gh pr merge*)`**（`require-gstack-evidence.ps1`），**repo 0 個 Stop hook**。

---

## 3. routing.json（唯一真相）

`.claude/workflows/routing.json`（**NEW**）：

```jsonc
{
  "tiers": {
    "extract":  { "model": "haiku",  "effort": null,    "note": "純抽取/格式化，零判斷，下游必複核" },
    "standard": { "model": "sonnet", "effort": "max",   "note": "讀/探索/標準實作/首審" },
    "reason":   { "model": "opus",   "effort": "xhigh", "note": "創造/長程；唯一 max→xhigh 降階點" },
    "judge":    { "model": "opus",   "effort": "max",   "immutable": true, "note": "驗證/fix；不可降，codegen 只驗不覆寫" }
  },
  "allowed_efforts": { "haiku": [null, "max"], "sonnet": ["high", "max"], "opus": ["xhigh", "max"] },
  "do_not_codegen": ["std-implement.js:276", "std-implement.js:282", "std-implement.js:287"]
}
```

---

## 4. PR-A — routing 脊椎（P0 + P1）

**性質**：主要是「把散落的 model/effort 收斂成單一真相的 refactor」＋**唯一一處值變更**（`:119`，flag-gated）。自包含、可獨立 revert。

### 4.1 call-site → routing key 對照表（全 16 處）

| file:line | context | 現況 model+effort | 目標 | 備註 |
|---|---|---|---|---|
| std-plan.js:119 | plan:author | opus, max | **reason (opus,xhigh)** | **唯一值變更**，flag-gated（見 4.3） |
| std-plan.js:147 | plan-review 四軸 | sonnet, max | standard | |
| std-plan.js:178 | plan-fix | opus, max | judge | |
| std-plan.js:209 | impact:prescan | sonnet, max | standard | |
| std-implement.js:209 | parse:plan | haiku, (無) | **extract** | 形式化既有 haiku |
| std-implement.js:242 | impact:T | sonnet, max | standard | |
| std-implement.js:276 | impl 主呼叫 | implModel, (無) | **DO-NOT-CODEGEN** | computed；test 斷言條件分支存活 |
| std-implement.js:282 | impl:retry | opus, max | **DO-NOT-CODEGEN（pinned）** | 失敗補救升級，保留 max + rationale 註解 |
| std-implement.js:287 | impl:opus | opus, max | **DO-NOT-CODEGEN（pinned）** | BLOCKED 升級，保留 max + rationale 註解 |
| std-implement.js:324 | spec-review:T | sonnet, max | standard | |
| std-implement.js:339 | spec-fix | opus, max | judge | |
| std-implement.js:364 | quality-review:T | sonnet, max | standard | |
| std-implement.js:377 | quality-fix | opus, max | judge | |
| std-implement.js:418 | final-review | opus, max | judge | judge 層，不可降 |
| std-evidence.js:73 | probe:engine | haiku, (無) | **extract** | 形式化既有 haiku |
| std-evidence.js:103 | evidence | opus, max | judge | E2E 裁決 = judge |

> 除 `:119` 外，所有 site 的 model+effort **值不變**；codegen 只是把它們改成引用 `ROUTING.<key>` 以集中管理＋防漂移。

### 4.2 codegen（`scripts/gen-routing.mjs`，NEW）— Marker 規格

- 每支 `std-*.js` 內有一段 `// <routing:gen>` … `// </routing:gen>` 包住的 `const ROUTING = {…}`，由 codegen 從 routing.json 整段重生。
- agent() 呼叫一次性手改為展開引用，例：`{ label:…, phase:…, ...ROUTING.judge, schema:… }`。
- `gen-routing.mjs --check`：在記憶體生成 → 對檔案做 **normalized diff**（忽略行尾/空白）→ 不一致 exit-1。
- **生成前驗證**：每層 `model×effort` 須在 `allowed_efforts` 內，否則 throw。
- 遇 `immutable:true`（judge 層）**只驗不覆寫**。
- `do_not_codegen` 清單內的 site **不碰**。
- 約束：`gen-routing` **只能 pre-session 跑，禁止 workflow run 中途執行**（codegen build-time 與 workflow load session-time 解耦）。

### 4.3 `:119` 降階 flag

- plan 作者降 `xhigh` 用環境旗標控制（如 `STD_PLAN_REASON_XHIGH`），預設**關**（維持 max）。
- P0 baseline A/B 證明不劣化後才翻開。

### 4.4 既有衝突和解 + trailer 修正

- 更新/退役 `hexagon-coding-agent-design-v2.js` 的 `ROUTING_CONSTRAINT` 字串，附一行 rationale：「Haiku 僅進 `extract` 層做純抽取，位於 reason/judge floor 之下，不違反兩-model 推理/判斷原則」。
- 修 3 處 legacy trailer `Claude Fable 5` → canonical `Claude Opus 4.8 (1M context)`：`std-plan.js:104`、`std-plan.js:172`、`std-implement.js:165`。**trailer 一律固定字面字串，禁任何 LLM 生成。**

### 4.5 測試（`tests/test_routing_consistency.py`，NEW）

確定性絕對 gate，含**獨立於 routing.json 的字面斷言**（避免閉環自證）：
1. 跑 `gen-routing.mjs --check`，非 0 即 fail。
2. 字面 grep：每個 `phase:'FinalReview'|'Fix'` 的 agent() 同行含 `effort: 'max'`（不從 json 衍生）。
3. 字面斷言 `std-implement.js:276` 維持 `model: implModel`（條件分支存活）。
4. mtime 斷言：無 `.claude/workflows/*.js` 比 routing.json 新卻未 regen。
5. 新 test：grep `.claude/workflows/*.js` 抓互相衝突的 routing 不變量字串。

> 解析用 regex（agent() 經實證單行、model+effort 同行），spec 附 pattern 範例，不需 AST。

### 4.6 P0 baseline（`artifacts/self-evolve/baseline.md`，NEW）

- schema 欄位：`spec_id / total_tokens / held_count / impl_round_count / wall_sec`。
- 代表性樣本 spec-id：PR-A 第 0 步選定，準則＝「最近一支已 merged 且完整跑過 P0–P6 的 spec」（由 `git log` + `artifacts/spec-to-done/*-state.md` 判定），選定後寫入 baseline.md。
- 回歸條件：`held_count` 不升、`total_tokens` 不超 baseline 20%。
- 乾淨度：baseline 須在 clean HEAD 跑（開頭記 `git rev-parse HEAD` + 確認 `git status --short` 空）。

### 4.7 SKILL.md

加 operator step：「routing.json 改動後跑 `gen-routing.mjs`，並 re-save 受影響 workflow 讓 harness reload」。

---

## 5. PR-B — 抗幻覺（P2）

- **(a) Citation-forcing**：`fu-adversarial-verify-generic.js` verdict schema 強制每個 `not_closed`/`new_issue` 帶 `evidence:{file,line,quote}`，缺則 tool-call 層 retry。
- **(b) DACS registry summary**：P5 入場改傳 ≤200 token/finding 的 `{id, claim_oneliner, suspect_file}`，verifier 要細節自己 Read。改 SKILL.md 編排段 + `fu-...js` 入參處理。
- **(c) PreToolUse evidence gate**（**不是 Stop hook**）：`scripts/hooks/require-state-evidence.ps1`（NEW）綁 `PreToolUse` on `Bash(gh pr merge*)`，鏡像 `require-gstack-evidence.ps1` 結構。讀當前 slug state 檔的 phase 完成行，**並對行內 artifact 路徑做 `Test-Path`**（防 Haiku 幻覺路徑繞過）；缺則 exit-2。`.claude/settings.json` 註冊。
- **(d) Haiku risk_level 複核**（M14）：`extract` 層輸出的 GitNexus impact 結構化結果，`risk_level` 須由 `standard`（sonnet）層過一道複核 gate 才進 HELD 決策，不可 Haiku 直接輸出進決策流。

---

## 6. PR-C — 自我進化空殼（P4，預設關）

- **L1 記憶**：沿用既有 append-only `artifacts/spec-to-done/<slug>-state.md`，不變。
- **L2 skill library**（`artifacts/skill-library/learned.jsonl`，NEW）：
  - schema：`id / spec_id / pr_url / procedure_text / extracted_by / extracted_at / verified_pr_merged_at / verified_by`。
  - merged 判定用 `gh pr view --json mergedAt` **確定性 CLI，禁 LLM/Haiku 判**，entry 標 `verified_by:"gh-cli"`。
  - **須明寫消費方**（誰檢索複用）；若本輪無消費方則 L2 **不入 PR**（避免單向死檔）。
- **L3 自改 harness — inert stub，零可執行邏輯**：
  - flag `SELF_EVOLVE_L3` 嚴格 `=== '1'` opt-in，預設關（undefined→關）。
  - 觸發參數寫死：`N = 3` 次同類 HELD；「同類」= `held_reason` 前 8-token hash。
  - 將來啟用時 oracle 從 **pinned merged SHA** 取 `spec-to-done-adversarial-verify.js` + `fu-adversarial-verify-generic.js` 兩者（避免拿被改的引擎驗自改）。
  - `artifacts/self-evolve/tried.jsonl`（NEW）記已試失敗的 harness 改法，防鬼打牆。
  - 鏈路（停用中，僅文件）：N 次同類 HELD → opus 提 diff 到 staging → oracle → 回歸對比 baseline → **人類 PR merge**（agent 永不自改 harness 本體）。

---

## 7. 安全邊界（不可妥協）

- judge 層 effort 永遠 `max`；`:282/:287` 補救升級保留 `max`；`:418` final-review 不可降。
- Haiku（`extract`）產出一律草稿/中間件，下游必有 sonnet/opus 或 commander 複核；錯了顯性。
- L3 預設關、人類 merge gate；trailer 固定字面禁 LLM。
- LLM-judge 只用於相對排序（A/B 對比 baseline），絕對 gate 一律靠確定性測試（pytest、`gh` CLI、`Test-Path`）。

---

## 8. 落地順序

1. **PR-A**：routing.json + gen-routing + 16 site 接線 + `:119` flag 降階 + trailer 修正 + v2 和解 + pytest gate + P0 baseline + SKILL.md step。先跑 P0 baseline（clean HEAD）→ 實作 → 跑 `spec-to-done-adversarial-verify.js` 確認語義 → `pytest` 綠。
2. **PR-B**：citation schema + DACS + PreToolUse evidence gate + Haiku risk_level 複核。
3. **PR-C**：L2（若有消費方）+ L3 inert stub + tried.jsonl。

每 PR 用 P0 同一把尺比，沒比 baseline 好就 revert 該 PR。

---

## 9. 檔案清單

**NEW**：`.claude/workflows/routing.json`、`scripts/gen-routing.mjs`、`scripts/hooks/require-state-evidence.ps1`、`tests/test_routing_consistency.py`、`artifacts/self-evolve/{baseline.md,tried.jsonl}`、`artifacts/skill-library/learned.jsonl`（條件性）、`.claude/workflows/self-evolve-l3-stub.js`（L3 inert stub）。
**改**：`std-plan.js`、`std-implement.js`、`std-evidence.js`、`fu-adversarial-verify-generic.js`、`hexagon-coding-agent-design-v2.js`、`SKILL.md`、`.claude/settings.json`。
**延後（不在本 spec）**：P3 並行放大（`openspec-converge.js`、三角辯論）。
