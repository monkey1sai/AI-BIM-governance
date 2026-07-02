# Spec: pr-review-agent 放寬「已追蹤工具鏡像」修改（generated_tooling_path 只擋新增）

## 背景與需求來源

`scripts/lib/pr-review-agent.ps1` 的 path guard 對 `.codex/skills|.claude/skills/generated|.gitnexus` 的任何非刪除變更一律出 `generated_tooling_path` hard blocker。但 `.codex/` 目前有 373 個檔依 #212 政策納入版控（含 `.codex/skills/spec-to-done` adapter），形成結構矛盾：**被追蹤的檔案永遠無法透過 PR 更新**。PR #275 曾撞此 blocker，依「agent 不得自行放寬 review gate」原則刻意保留凍結、adapter 同步 diff 因此遺失；2026-07-02 治理審計把規則調整列為遺留待拍板事項，使用者於本日拍板：**放寬——只擋新增、放行修改**。

## 變更範圍（最小 diff）

`scripts/lib/pr-review-agent.ps1`：

1. 新增 helper `Test-PrReviewPathExistsAtBase`（鏡射既有 `Test-PrReviewDeletedPath` 結構）：以 `git cat-file -e <merge-base>:<path>` 判定路徑在 base 是否已被追蹤；Base/Head 缺失或 merge-base 解析失敗一律回 `false`。
2. `Get-PrReviewPathGuardFindings` 的 generated-tooling 分支加一層判定：
   - 刪除 → 維持既有 `generated_tooling_path_deleted` warning（不變）。
   - **修改 merge-base 已追蹤的檔** → 降級為 `generated_tooling_path_modified` warning（medium，人工複核 adapter-sync 範圍）。
   - **新增路徑、或無 base 可判定（本機模式/淺 clone）** → 維持 `generated_tooling_path` hard blocker（fail-closed，防塞入新生成物）。

`scripts/tests/test-pr-review-agent.ps1`：新增 Test 3c（temp git repo，鏡射 Test 3b 手法）驗證上述三種行為。

## 不變式

- 追蹤集合只能透過「明確政策變更」擴大：新增檔在 PR 內即被 block，無法先混入再變成 tracked。
- `.gitnexus`、`.claude/skills/generated` 實際未被追蹤 → `ExistsAtBase=false` → 行為與現行完全相同。
- 判定不可得時 fail-closed（維持 blocker），與現行本機模式行為一致。

## 成功標準

- `pwsh scripts/tests/test-pr-review-agent.ps1` 全綠（baseline 已先跑過同尺）。
- Test 3c 三斷言：tracked 修改=1 warning、新增=1 blocker、無 base=2 blockers。

## 已知風險

- 對 tracked 鏡像檔的惡意/錯誤修改從「機器擋下」變為「人工複核 warning」；緩解：警訊仍會出現在 review 報告，且該區檔案本質是 agent 工具鏡像非產品 runtime。
- GitNexus 不索引 PowerShell symbol（impact 查無 target），爆炸半徑以 grep 人工確認：production 呼叫點僅 `Invoke-PrReviewAgent` 一處。
