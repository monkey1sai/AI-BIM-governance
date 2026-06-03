# Proposal: deploy-nullderef-guard

## Why

對抗驗證在 `scripts/deploy.ps1` 確認了 2 個同類的 null-deref 防禦缺口:在 `Set-StrictMode -Version Latest` 下，對「空 / 不存在」檔案做 `(Get-Content ...).Trim()` 會對 `$null` 呼叫 `.Trim()` 方法，觸發 terminating error。`-ErrorAction SilentlyContinue` 只壓得住 `Get-Content` 本身的錯誤，壓不住後續對 `$null` 的方法呼叫。

- **DEPLOY-001**(`Print-FinalSummary` 失敗分支，約 `:104-107`):列「What might be running」時逐一讀 `scripts\.run\*.pid`。若某 `.pid` 是空檔（程序剛崩、寫到一半、或被截斷），`(Get-Content $pidFile.FullName | Select-Object -First 1).Trim()` 對 `$null` 呼叫 `.Trim()` → throw。這會在**印出失敗診斷摘要之前**讓 `Print-FinalSummary` 自身 crash，直接違反 `one-click-deploy-hybrid` spec 的「Final Summary 可診斷性」requirement（失敗時 SHALL 走到 `Print-FinalSummary` 才退出，MUST NOT 因 strict-mode 未防禦讀取繞過 Final Summary）。
- **DEPLOY-002**(`Test-KitRuntimeSignatureMatches`，約 `:402-410`）：idempotent re-run 比對 runtime signature 檔時，`(Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue).Trim()` 對「存在但空」的 signature 檔回 `$null`，`.Trim()` 同樣 throw。空 signature 檔應視為「不相符」走重寫路徑，而非讓 re-run crash。

兩者都是失敗 / 邊界路徑的 robustness 缺口：正常成功路徑不會踩到，但一旦踩到就會吃掉診斷資訊或中斷 idempotent re-run。

## What Changes

- **deploy.ps1 DEPLOY-001**：`Print-FinalSummary` 失敗分支的 `.pid` 讀取改為 null/empty/whitespace guard——`$raw = Get-Content ... | Select-Object -First 1; $procId = if (-not [string]::IsNullOrWhiteSpace($raw)) { $raw.Trim() } else { '(empty)' }`，空 / 缺檔 / 只含空白皆顯示 `(empty)`，不讓 Final Summary 自身 throw。（用 `IsNullOrWhiteSpace` 而非 `if ($raw)`：PowerShell 中純空白字串為 truthy，`if ($raw)` 會誤入 `.Trim()` 印出空白 PID。）
- **deploy.ps1 DEPLOY-002**：`Test-KitRuntimeSignatureMatches` 改為 PS5.1 相容 guard——`$raw = Get-Content ...; $actual = if ($null -ne $raw) { $raw.Trim() } else { '' }`，存在但空的 signature 檔回 `$false`（不相符）不 throw。
- 新增 `scripts/tests/test-deploy-nullderef-guard.ps1`：以既有純 PowerShell harness（`test-helpers.ps1` dot-source + 自訂 assert + temp sandbox，不依賴 Pester）覆蓋兩處 guard。每處先以 RED 斷言證明未防禦寫法在 strict-mode 下確實 throw，再以 GREEN 斷言證明已防禦寫法安全並保留 happy path。
- spec delta：MODIFIED `one-click-deploy-hybrid` 的「Final Summary 可診斷性」requirement，明確化 Final Summary 與 idempotent re-run 路徑 SHALL 對空 / 缺失 `.pid` / signature 檔做 null-safe 讀取，不得在印出診斷前 crash。

## Impact

- Affected specs: `one-click-deploy-hybrid`（MODIFIED 1 requirement）
- Affected code:
  - `scripts/deploy.ps1`（2 處 guard，行為僅在失敗 / 空檔邊界路徑改變；成功路徑 0 行為變化）
  - `scripts/tests/test-deploy-nullderef-guard.ps1`（新增測試）
- 不動 production runtime、不動其他 sub-repo source、不動 `compose.*.yml` / `start-*.ps1`（符合 `scripts/AGENTS.md` 邊界）。
- 風險低：guard 是 additive null-check，成功路徑與既有非空 `.pid` / 相符 signature 行為不變（已由 happy-path 測試固化）。
