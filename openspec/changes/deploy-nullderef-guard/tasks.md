# Tasks: deploy-nullderef-guard

## 1. 修復 null-deref 防禦

- [x] 1.1 DEPLOY-001：`scripts/deploy.ps1` `Print-FinalSummary` 失敗分支的空 `.pid` `.Trim()` 加 null/empty guard（空 / 缺檔顯示 `(empty)`，不 throw）
- [x] 1.2 DEPLOY-002：`scripts/deploy.ps1` `Test-KitRuntimeSignatureMatches` 對「存在但空」signature 檔加 PS5.1 相容 null guard（回 `$false` 不 throw）

## 2. 測試

- [x] 2.1 新增 `scripts/tests/test-deploy-nullderef-guard.ps1`（沿用 `test-helpers.ps1` 純 PowerShell harness，不依賴 Pester）
- [x] 2.2 DEPLOY-001 覆蓋：RED（未防禦寫法對空 `.pid` 在 strict-mode throw）+ GREEN（已防禦邏輯對空 `.pid` 回 `(empty)` 不 throw）+ happy path（非空 `.pid` 印實際 PID）
- [x] 2.3 DEPLOY-002 覆蓋：RED（未防禦寫法對空 signature throw）+ GREEN（空 signature 回 `$false` 不 throw）+ missing / matching happy path

## 3. 自驗

- [x] 3.1 PowerShell 語法檢查（`Parser::ParseFile`）無錯誤
- [x] 3.2 `pwsh scripts/tests/test-deploy-nullderef-guard.ps1` 全 PASS
- [x] 3.3 `npx openspec validate deploy-nullderef-guard --strict` 通過
- [x] 3.4 `git diff --cached --check`（無 trailing whitespace）
