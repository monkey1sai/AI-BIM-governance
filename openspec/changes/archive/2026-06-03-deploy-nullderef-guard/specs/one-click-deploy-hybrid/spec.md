## MODIFIED Requirements

### Requirement: Final Summary 可診斷性

deploy.ps1 SHALL 印結構化 Final Summary,成功 / 失敗兩種情況都有對應的「下一步」指令給使用者。失敗時 deploy.ps1 SHALL 走到 Print-FinalSummary 才退出,MUST NOT 因 strict-mode（`Set-StrictMode -Version Latest`）下 build / probe 失敗路徑的未初始化變數觸發 `VariableNotDefined` terminating error 而繞過 Final Summary。

Final Summary 與 idempotent re-run 路徑 SHALL 對空 / 缺失的 `scripts\.run\*.pid` 與 runtime signature 檔（如 `bim-streaming-server.params.json` / `bim-streaming-conversion-service.params.json`）做 null-safe 讀取:對「空檔 / 不存在檔」`Get-Content` 回 `$null` 時 MUST NOT 直接呼叫 `.Trim()`（strict-mode 下對 `$null` 的方法呼叫為 terminating error;`-ErrorAction SilentlyContinue` 只壓 `Get-Content` cmdlet 自身錯誤,壓不住後續對 `$null` 的方法呼叫）。失敗診斷的「What might be running」清單對空 / 缺 `.pid` SHALL 顯示佔位字串（如 `(empty)`）而非 crash;runtime signature 比對對「存在但空」的 signature 檔 SHALL 視為不相符（回 `$false`,走重寫 signature 路徑）而非在印出診斷前 throw。

#### Scenario: 成功完成

- **WHEN** deploy.ps1 退 0
- **THEN** Final Summary MUST 印 `=== Deploy Summary ===` 標題、`Mode: hybrid (web-plane Docker + host-native Kit)`、Elapsed、EnvFile、Storage root + status
- **AND** MUST 印 `Next:` 區塊含 coordinator UI URL `http://127.0.0.1:8004/ui`、tail Kit log 指令、stop all 指令

#### Scenario: 任何階段失敗

- **WHEN** deploy.ps1 退非 0
- **THEN** Final Summary MUST 印 `Status: FAILED (exit <code>, <FailedPhase>)`
- **AND** MUST 列出 `scripts\.run\*.pid` 內仍活著的 process,印 `What might be running (NOT auto-rolled-back)` 段落
- **AND** MUST 印 `To recover:` 區塊含 stop scripts 與 re-run 指令(含 `-Force`)

#### Scenario: Build 或 probe 失敗不得繞過 Final Summary

- **WHEN** Phase 2/4 的 build(`repo.bat build` / docker build)或 process probe 失敗,使對應 exit-code / id 變數(如 `$kitBuildExit` / `$buildExit` / `$runningIds`)在 `Set-StrictMode -Version Latest` 下可能未賦值就被讀取
- **THEN** deploy.ps1 SHALL 對這些變數提供 fail-safe 初始化(失敗以非零值 / 空集表示),使失敗路徑仍走到 Print-FinalSummary 並以非零 exit 回報
- **AND** MUST NOT 因 `VariableNotDefined` terminating error 在印出 Final Summary 之前 crash,吃掉失敗診斷摘要

#### Scenario: 空或缺失的 .pid / signature 檔不得讓診斷路徑 null-deref crash

- **WHEN** Print-FinalSummary 失敗分支列 `scripts\.run\*.pid` 時遇到空 / 只含空白的 `.pid` 檔,或 idempotent re-run 比對 runtime signature 時遇到「存在但空」的 signature 檔
- **THEN** deploy.ps1 SHALL 對 `Get-Content` 回傳值做 null/empty guard（空 / 缺值落到佔位字串或空字串）後才呼叫 `.Trim()`,MUST NOT 對 `$null` 直接呼叫 `.Trim()` 觸發 strict-mode terminating error
- **AND** Print-FinalSummary 對空 / 缺 `.pid` MUST 仍印出該行 summary（PID 顯示為 `(empty)` 等佔位字串）而非在印出失敗診斷前 crash
- **AND** runtime signature 比對對「存在但空」的 signature 檔 MUST 回 `$false`（視為不相符,走重寫 signature 路徑）而非 throw
