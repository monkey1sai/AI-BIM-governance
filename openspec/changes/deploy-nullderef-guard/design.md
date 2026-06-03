# Design: deploy-nullderef-guard

## Context

`scripts/deploy.ps1` 頂端宣告 `Set-StrictMode -Version Latest`。strict-mode 下對 `$null` 呼叫實例方法（如 `$null.Trim()`）是 terminating error。`Get-Content` 對「空檔」或「不存在檔」回傳 `$null`（`-Raw` 模式）或空 enumeration（行模式 + `Select-Object -First 1` → `$null`）。`-ErrorAction SilentlyContinue` 只影響 `Get-Content` cmdlet 自身的 error stream，**不影響**對其 `$null` 回傳值的後續方法呼叫。

兩個 finding 是同一個 anti-pattern 的兩個實例：`(Get-Content ...).Trim()`，分別位於失敗診斷路徑與 idempotent re-run 路徑。

## Goals / Non-Goals

- Goal：讓兩處讀取對「空 / 不存在」檔 null-safe，不在邊界路徑 throw；保留成功路徑與既有非空行為不變。
- Goal：以既有純 PowerShell 測試 harness 固化，RED 先證明 bug 真實存在再 GREEN 證明修好。
- Non-Goal：不重構 `Print-FinalSummary` 其餘邏輯、不改 signature 比對語意（相符仍回 `$true`、缺檔仍回 `$false`）、不改成功路徑輸出格式。
- Non-Goal：不跑完整 `deploy.ps1`（需 Docker / GPU，非本 change 範圍）。

## Decisions

### Decision 1：DEPLOY-001 用「行模式 + 旗標 if」guard

```powershell
$raw = Get-Content $pidFile.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
$procId = if ($raw) { $raw.Trim() } else { '(empty)' }
```

`if ($raw)` 對 `$null`、空字串、全空白皆為 falsy（PowerShell truthiness），落到 `'(empty)'`。沿用原本的行模式（`Get-Content | Select-Object -First 1`，取第一行）而非改 `-Raw`，最小化 diff 並保留「PID 在第一行」的既有語意。失敗診斷的可讀性（顯示 `(empty)`）優先於完整 PID。

### Decision 2：DEPLOY-002 用 `$null -ne $raw` 顯式 guard（PS5.1 相容）

```powershell
$raw = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
$actual = if ($null -ne $raw) { $raw.Trim() } else { '' }
```

此處用 `-Raw`（與原碼一致，整檔字串比對 signature），空檔回 `$null` → `$actual = ''` → 與非空 `$Expected` 不相符 → 回 `$false`。`$null -ne $raw` 而非 `$raw -ne $null` 是 PowerShell 慣例（避免 `$raw` 是陣列時的 filter 語意），且 PS5.1 / PS7 皆相容。空 signature 視為「不相符」是正確語意：re-run 會重寫 signature 而非誤判已對齊。

### Decision 3：測試用「等價單元 / byte-faithful 複本」而非 dot-source deploy.ps1

`deploy.ps1` 頂層在載入時立即跑 Phase 1 preflight（約 `:439` 起整條 audit pipeline），無法只 dot-source 取其函式做單元測試。既有 `test-deploy-env-fallback.ps1` 已建立此 pattern：對 deploy.ps1 內無法獨立載入的邏輯，改測等價單元。

- `Test-KitRuntimeSignatureMatches` 是純函式（僅依 `$Path` / `$Expected`），測試檔放 byte-faithful 複本直接驗證。
- `Print-FinalSummary` 依賴大量 script-scope 變數（`$script:DeployStart` / `$RunDir` / `$script:resolvedEnvFile` ...），不適合整體 isolate；測試只針對其 load-bearing 的「列 PID-file」迴圈邏輯抽等價 scriptblock（同 `Get-Content`/`Select-Object`/`if` 結構），對真實 temp RunDir 內的空 `.pid` 驗證不 throw 且產出 `(empty)` summary 行。

兩處都先以 RED 斷言（`Assert-Throws`）證明未防禦寫法在 strict-mode 下確實 throw，避免 GREEN 測試淪為 tautology。

## Risks / Trade-offs

- 複本 / 等價 scriptblock 與受測函式需手動同步：若日後改 deploy.ps1 的 guard，測試複本要一起改，否則測試失去意義。已在測試檔註解明確標示此約束與行號。
- Trade-off：未採「把函式抽到 lib module 再 dot-source 真碼」的較重做法，因為那是更大的重構（動 deploy.ps1 結構 + 新檔），超出本 null-deref FU 的最小可回復範圍。

## Verification

1. `Parser::ParseFile` 對 `deploy.ps1` 無語法錯誤（不執行 pipeline）。
2. `pwsh scripts/tests/test-deploy-nullderef-guard.ps1` 全 PASS（含 RED 規格證明）。
3. `npx openspec validate deploy-nullderef-guard --strict`。
4. `git diff --cached --check`。
