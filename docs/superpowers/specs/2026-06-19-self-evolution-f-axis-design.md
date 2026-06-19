# F 軸自我進化 — 設計/決策記錄（PR-C：記錄，不實作）

- 日期：2026-06-19
- 狀態：**設計定案、刻意不實作**（記錄供日後建造）
- 來源：六邊形 harness 升級 spec `2026-06-18-hexagon-harness-upgrade-design.md` §6（PR-C）
- 前置 PR：PR-A #233（routing 脊椎，merged）、PR-B #234（抗幻覺 citation+DACS，merged）

## 0. 為何「記錄不實作」

原 spec §6 設計 PR-C 為「L3 自我進化 inert stub，預設關」。落地前用 grounded 事實查核，發現**硬出 stub code 會是 YAGNI／照想像寫**（這正是 PR-A/PR-B 對抗審批一路在抓的病）：

| grounded 事實（2026-06-19 親驗） | 對 PR-C 的影響 |
|---|---|
| workflow runtime 沙箱**無 `process.env`／無 `fs`**（grep 全 `.claude/workflows/*.js` 無人讀） | L3 flag `SELF_EVOLVE_L3` **不能住 workflow 腳本**；「零可執行邏輯」的 stub 根本不會跑 → 寫了就是死碼 |
| L2 消費方：`plan-next-spec-to-done-aware.js` 只讀 **state 檔 + git**，**不讀 `learned.jsonl`** | L2 **無消費方** → 依 spec §6 自己的規則「無消費方則不入 PR」→ 單向死檔，不建 |
| oracle `spec-to-done-adversarial-verify.js` 存在 ✓ | L3 將來可用它當 fitness oracle（須 pinned SHA，見 §3） |

結論：誠實的 PR-C ＝**本設計文件**（把安全鏈、護欄、grounded 落點限制記下來，日後前置條件滿足時直接照建）＋ 一個空 `artifacts/self-evolve/tried.jsonl` scaffolding。**零可執行死碼、零單向死檔。**

## 1. L1 記憶（已有，基礎，不動）

append-only `artifacts/spec-to-done/<slug>-state.md` 是跨 session 唯一座標，已運作（`plan-next-spec-to-done-aware.js` 讀它重建 MERGED/IN-FLIGHT）。F 軸的「記憶」層**已存在且夠用**，PR-C 不動它。

## 2. L2 skill library — 設計（本輪不建：無消費方）

**schema**（`artifacts/skill-library/learned.jsonl`，每行一 JSON）：
```
{ id, spec_id, pr_url, procedure_text, extracted_by, extracted_at, verified_pr_merged_at, verified_by }
```
- `verified_pr_merged_at` / merged 判定一律用 `gh pr view --json mergedAt` **確定性 CLI，禁 LLM/Haiku 判**；entry 標 `verified_by:"gh-cli"`。
- 入庫前該 procedure 須在 ≥1 次 **merged** PR 驗證過（MUSE unit-test gating）。

**為何本輪不建**：目前**無檢索消費方**——`plan-next-spec-to-done-aware.js` 不讀 `learned.jsonl`。建一個沒人讀的 append 檔＝單向死檔。

**建造觸發條件**：當有 agent 流程會「**檢索並複用**過往成功 sub-procedure」時（例如 `plan-next` 或 `std-plan` 加一個 retrieval 步驟），同批一起建 L2 寫入＋讀取，才不死檔。

## 3. L3 自改 harness — 設計（本輪不建：安全鏈 + grounded 落點限制）

**核心不變量：agent 永不自 merge harness 本體。** 一切改 `SKILL.md`／`std-*.js`／prompt 的提案，最終都經**人類 PR merge**。

**安全鏈（停用中，僅設計）**：
```
累積 N 次同類 HELD
  → propose（opus）：讀 HELD 模式，提 harness 最小 diff 到 staging 分支（絕不動 main、絕不動 in-flight worktree）
  → oracle gate：跑 spec-to-done-adversarial-verify.js（4 opus 從 compliance/correctness/usability/resilience 驗）
  → 回歸量測：在 staging 重跑「最近 1 個 merged spec」的 P1→P5，比 baseline（artifacts/self-evolve/baseline.md）
  → Keep/Discard：oracle 全綠且回歸不劣於 baseline → 產 PR 給【人類審 + 人類 merge】；任一不過 → discard + 記 tried.jsonl
```

**護欄（寫死，日後實作時照用）**：
- **flag `SELF_EVOLVE_L3`**：嚴格 `=== '1'` opt-in，預設關（undefined→關）。**grounded 落點限制：必須在 standalone 觸發腳本（可讀 `process.env`/`fs`）讀此 flag，不可放 workflow 沙箱**（沙箱無 env）。
- **觸發門檻**：`N = 3` 次同類 HELD；「同類」＝ `held_reason` 前 8-token hash（對齊全域守則「同一假設連續失敗 2~3 次跳過」）。
- **oracle 反污染**：oracle 引擎（`spec-to-done-adversarial-verify.js` **＋** `fu-adversarial-verify-generic.js`）一律從 **pinned merged SHA** 取，**不可用被本次提案改過的引擎驗自改**（否則自我背書）。
- **`artifacts/self-evolve/tried.jsonl`**：記已試過且失敗的 harness 改法，propose 前先查避免鬼打牆（Darwin Gödel tried-before history）。
- **回歸基準**：`artifacts/self-evolve/baseline.md`（PR-A 已建）。

**tried.jsonl schema**（每行一 JSON，本 PR 建空檔 scaffolding）：
```
{ tried_at, held_reason_hash, proposed_diff_summary, outcome: "oracle_fail"|"regression_worse"|"human_rejected", note }
```

## 4. 不可妥協安全邊界

- L3 改動**永遠經人類 merge**，agent 不自改 harness 本體。
- oracle 用 LLM-judge → 只可用於**相對排序**（新版 vs baseline），**不設絕對門檻**；絕對 gate 一律靠確定性測試（`pytest tests`、回歸 spec P4 七項）。
- flag 預設關、嚴格 `=== '1'`；undefined／任何非 `'1'` 值都視為關。

## 5. 本 PR 交付 / 不交付

- **交付**：本設計文件 + 空 `artifacts/self-evolve/tried.jsonl`（scaffolding，schema 見 §3）。
- **不交付（刻意）**：L2 `learned.jsonl`（無消費方）、L3 任何可執行 stub（沙箱無 env、零邏輯＝死碼）、flag 讀取邏輯（待 standalone 觸發腳本）。
- **建造觸發**：L2＝出現 retrieval 消費方時；L3＝決定要自動化 harness 自我精煉、且接受「人類 merge gate + standalone flag 腳本」成本時。

## 6. 六邊形收尾狀態

| 軸 | 狀態 |
|---|---|
| A 拆解 / C 抗幻覺(基礎) / E 取證 | 已 frontier |
| B 路由 | ✅ PR-A #233 merged |
| C 抗幻覺(citation+DACS) | ✅ PR-B #234 merged |
| F 自我進化 | L1 已運作；L2/L3 **設計記錄完成（本文件）、實作待觸發條件** |
| D 並行 | 審批判 YAGNI 延後 |
| §5c PreToolUse 證據閘 | 砍除（freeform state 無法可靠 gate，延後到先加 machine-marker） |
