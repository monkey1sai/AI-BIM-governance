## Why

AI coding 產生的 diff、文件與驗證證據常常很大，人工逐次檢查容易漏掉 repo 邊界、測試缺口、OpenSpec 對齊與高風險檔案變更。這個 change 要建立一個每次 PR 都會自動執行的 review agent gate，先幫使用者整理「能不能安全進入人工審查」的結論與證據。

## What Changes

- 新增 PR review agent capability，定義每個 PR 必須產生可審查的自動審查報告。
- 定義 agent 要收集的最小證據：diff scope、OpenSpec change 對應、repo 邊界檢查、測試/建置結果、GitNexus detect changes 結果或不可用原因、風險分級與阻擋項目。
- 定義自動通過與阻擋條件：只有在必要驗證通過、沒有 HIGH/CRITICAL 未處理風險、沒有 secrets / `.env` 實值修改、沒有未說明的跨 repo 邊界變更時，agent 才能標示 review gate passed。
- 定義 agent 的 GitHub PR 輸出：status check 或 PR comment 必須讓人看得懂，不只寫 pass/fail。
- 明確限制自動化範圍：review agent 不自動 merge、不取代 CODEOWNERS / branch protection / human review，也不把本機 skill 或生成工具狀態變成產品需求。
- 不修改 product runtime API、資料結構、事件、storage、session 或 WebRTC / Kit runtime 邊界。

## Capabilities

### New Capabilities

- `pull-request-review-agent`: 定義 PR 自動審查 agent 的觸發時機、證據輸出、通過/阻擋條件、人工審查邊界與 repo boundary guardrails。

### Modified Capabilities

- None.

## Impact

- 主要 owner folder：`.github/`、`scripts/`、`docs/`、`openspec/changes/add-pr-review-agent/`。
- 後續 apply 可能新增 GitHub Actions workflow、review prompt / policy 文件、PR review report schema 與本機驗證 script。
- 後續 apply 可讀取 repo diff、OpenSpec artifacts、GitNexus detect changes、測試結果與文件狀態，但不得修改 secrets、private keys 或既有 `.env` 實值。
- 無 production dependency；若後續需要外部 LLM / Codex / GitHub token，必須用既有 GitHub Actions secret / app permission 並在 design 中列為部署前置，不把任何 secret 寫入 repo。
- Repo 邊界保持不變：review agent 只負責 PR 驗證與審查證據，不成為 `bim-review-coordinator`、`bim-streaming-server`、`web-viewer-sample` 或外部平台的 runtime component。
- 無 breaking change。
