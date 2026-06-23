# pr-review-agent 認可 superpowers spec 作為 formal evidence

> 日期：2026-06-23
> 類型：CI 流程脫節根治（surgical）

## 背景與問題

本 repo 自 **#189（2026-06-09）退役 OpenSpec**，改用 superpowers `docs/superpowers/specs/` 作為 behavior/code/repo-boundary 變更的正式設計依據（見 memory `openspec-skills-removed-use-superpowers`）。

但 `scripts/lib/pr-review-agent.ps1` 的 `Test-PrReviewHasFormalOpenSpecEvidence` 仍**只認** `openspec/specs/` 與 `openspec/changes/archive/` 路徑。結果：任何附了 superpowers spec、卻沒有 OpenSpec change id 的 behavior/code PR，都會被 `missing_openspec` high blocker 誤擋。

實例：合併風險 follow-up 的 **PR #244（A 前端）/ #246（C script）** 雖已附 `docs/superpowers/specs/2026-06-23-merge-risk-followup-fixes-design.md`，仍被誤擋（#245 因 review 判 F3 純內部防禦不需 change id 而倖免）。

## 修法（surgical）

`Test-PrReviewHasFormalOpenSpecEvidence`（`scripts/lib/pr-review-agent.ps1`）的 changed-path 迴圈，新增一條判定：路徑 match `^docs/superpowers/specs/.+\.md$` 也回傳 `$true`（視為 formal spec evidence、消 `missing_openspec` blocker）。

**關鍵不變式**：superpowers spec 非 OpenSpec 格式，**不應觸發 `openspec validate`**。`Get-PrReviewValidationPlan` 的 strict-spec 驗證只對 `^(openspec/specs|openspec/changes/archive)/` 排程，故新判定只消 blocker、不會誤排 `openspec validate --specs --strict`。兩者語義一致、互不干擾。

## 驗證

`scripts/tests/test-pr-review-agent.ps1` 新增 **Test 1d**：`web-viewer-sample/` code 變更 + `docs/superpowers/specs/*.md` →
- 無 `missing_openspec` blocker（superpowers spec 覆蓋 behavior/code 變更）；
- `validation_commands` **不含** `openspec validate --specs --strict`（不誤觸發）。

`pwsh scripts/tests/test-pr-review-agent.ps1` 全綠（含既有 Test 1c openspec/specs 路徑、Test 2 無 spec blocker 等回歸）。

## 影響與連鎖

- 範圍：僅 `pr-review-agent.ps1`（1 個判定分支）+ 測試。不改 blocker 嚴重度、不改 needsOpenSpec 偵測、不加 paths-ignore（遵 `docs/PR_REVIEW_AGENT.md` 規約）。
- 連鎖：本 PR merge 後，附 superpowers spec 的 behavior/code PR（如 #244、加上 spec 的 #246）re-run `pr-review-agent` 即可通過 evidence policy。
- 注意：本 PR 自身改 `scripts/`，在**舊版** `pr-review-agent` 下仍會 advisory `missing_openspec`（舊版尚不認 superpowers spec）；`pr-review-agent` 為 **非 required check**（見 `docs/PR_REVIEW_AGENT.md` §Required checks「尚待加入」+ #241/#242/#243 先例），approve 後可 merge。
