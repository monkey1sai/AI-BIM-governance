## MODIFIED Requirements

### Requirement: Final Summary 可診斷性

deploy.ps1 SHALL 印結構化 Final Summary,成功 / 失敗兩種情況都有對應的「下一步」指令給使用者。失敗時 deploy.ps1 SHALL 走到 Print-FinalSummary 才退出,MUST NOT 因 strict-mode（`Set-StrictMode -Version Latest`）下 build / probe 失敗路徑的未初始化變數觸發 `VariableNotDefined` terminating error 而繞過 Final Summary。

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
