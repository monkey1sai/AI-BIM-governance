# orphan-kit-liveness-preflight — fixpoint 重驗摘要

- Entry：`orphan-kit-liveness-preflight`（open 於 PR #653，2026-08-19T10:44:44Z；#653 於 2026-08-19T11:58:44Z merged）
- Mechanism commit：`cb92a2bf99a4cbb7ba3c67ec17bfcf2996721972`（#653 以 merge commit 落 main，subject `Merge pull request #653 from monkey1sai/fix/orphan-kit-liveness-preflight`；位於 `origin/main` first-parent mainline（`git rev-list --first-parent origin/main` 命中一次），first-parent diff touch 全部三個 declared `verification_mechanism_paths`：`scripts/deploy.ps1`、`scripts/lib/host-native-launcher.ps1`、`scripts/self-referential-bootstrap-ledger.json`）
- 重驗環境：`git worktree` detached checkout 恰為 mechanism commit `cb92a2b` 本身，tracked 檔 0 dirty、untracked 0，置於非 Temp 路徑；本機 pwsh 7.5.4（Windows 11）
- 重驗時間：2026-08-19T13:44:15Z – 2026-08-19T13:45:51Z（UTC，實測；`reverified_at` 取重放結束時刻）
- Verification contract：`orphan-kit-liveness-preflight/v1`（sha256 `aaf83a0022155d2b8858e98570bbf15ead369b298ce8360402982a6e0c149223`）。該 digest 由本次獨立重算核對：以 `scripts/tests/test-self-referential-bootstrap.ps1` 的 `New-VerificationContract` 規範形式（contract id 與 command_ids 以 LF 串接、UTF-8 無 BOM 取 SHA-256）重算後與 ledger 記載 byte-exact 相符。
- 依凍結順序重放全部 5 個 command，全部 exit `0`：

| # | Command id | 指令 | 關鍵輸出 | 秒 | Exit |
|---:|---|---|---|---:|---:|
| 1 | `test-host-native-launcher` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-host-native-launcher.ps1` | `[PASS] orphaned listener detection is fail-closed and tree-aware (#640)` ／ `=== test-host-native-launcher.ps1: ALL PASSED ===` | 41 | 0 |
| 2 | `test-deploy-governance-static` | `pwsh … scripts/tests/test-deploy-governance-static.ps1` | `PASS deploy governance static checks` | 7 | 0 |
| 3 | `test-self-referential-bootstrap` | `pwsh … scripts/tests/test-self-referential-bootstrap.ps1` | `[test-self-referential-bootstrap] all assertions passed` | 32 | 0 |
| 4 | `test-pr-body-evidence` | `pwsh … scripts/tests/test-pr-body-evidence.ps1` | `[test-pr-body-evidence] all assertions passed` | 11 | 0 |
| 5 | `invoke-powershell-static` | `pwsh … scripts/tests/invoke-powershell-static.ps1` | `[invoke-powershell-static] passed` | 5 | 0 |

指令對照取自 `scripts/tests/test-self-referential-bootstrap.ps1` 的 immutable command map，非自行拼寫；本 contract 的五個 command 皆無 `<…>` 佔位參數，故不需具現任何佔位。

## 這次重驗回答的正是 opening reason 的循環

Entry 的 reason 指出：canonical deploy path 只在「一次真實部署正在對已 merge 的 `origin/main` 內容執行」的那一刻，才會決定「是不是已經有 instance 在跑、還能不能安全啟動下一個」；而本 PR 改的行為只存在於那一刻——`<Name>.ports` claim 由 live `Start-HostNativeService` 寫出，Phase 4c 的拒絕只對「launcher 已死、child 仍握著真實 LISTEN socket」的孤兒 Kit 觸發。這兩種狀態在變更抵達 `origin/main` 之前，無法由 canonical 機制在 branch 上製造；單元套件以注入式 port／process／child-enumeration probe 與 sidecar fixture 證明偵測與拒絕邏輯，但 fixture 孤兒不是一次 canonical 部署週期。

該真實週期**已於 2026-08-19 發生**（coordinator 主導的 canonical 部署，時點在 #653 於 11:58:44Z merge 之後）：

- 部署 commit：`88b7fb868c9837c560cf7fd87aa4039696d15708`（`origin/main` tip；`git merge-base --is-ancestor cb92a2bf99a4cbb7ba3c67ec17bfcf2996721972 88b7fb868c9837c560cf7fd87aa4039696d15708` 為真，故部署樹確實含本 entry 的 mechanism），wrapper `deploy_exit=0`。
- Deploy tag：`deploy-20260819-639227436548274529-004` → `88b7fb868c9837c560cf7fd87aa4039696d15708`，annotated tag，message `deploy target=canonical-linux exit=0 snapshot=20260819T134054Z-effective-env.json deployed=88b7fb8…`；已 push，`git fetch --tags` 後於本機可解析（`git rev-parse deploy-20260819-639227436548274529-004^{commit}` 回 `88b7fb8…`）。
- 部署後端點抽查全綠：coordinator `:8004/health`、`:8004/ui`、viewer `:5173`、conversion `:49101/health` 皆 HTTP 200；kit `:49100` TCP 可達。

新 gate 在該次部署確實執行過 pass path 的 code-path 論證（皆以 mechanism commit `cb92a2b` 的版本為準）：

1. remote transport 每次都把部署 checkout `git reset --hard` 到新鮮 fetch 的目標 commit，再執行 `pwsh -NoProfile -NonInteractive -File scripts/deploy.ps1 -Build`；該指令沒有 `-SkipKit`，所以 Phase 4c 一定進入。
2. Phase 4c 不會走 skip 分支。`deploy.ps1` 的 Kit runtime signature 含 `-Revision $resolvedDeployRevision`，而 `Resolve-DeployRevision` 就是部署 checkout 的 `git rev-parse --verify HEAD`。今日的 deploy tag 鏈顯示每一次部署的 deployed revision 都改變了（`-002` → `b6ccc3c…`、`-003` → `cb92a2b…`、`-004` → `88b7fb8…`），因此 `-004` 這次 `Test-KitRuntimeSignatureMatches` 必然不符，Phase 4c 走 `Phase 4c restarting host-native Kit because runtime parameters changed`（`Stop-HostNativeService`、`$kitAlreadyRunning = $false`），只能落到帶新 preflight 的 else 分支，不可能命中 `already running with matching runtime parameters` 的 skip 分支。
3. 該 else 分支在 `Start-HostNativeKit` **之前**呼叫 `Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $RunDir -ExpectedPorts (@($resolvedKitSignalPort) + @($resolvedSpectatorSignalPorts))`。回傳非 `$null` 即為硬停：`Write-DeployTag -Tag 'fail'`（訊息 `stage=4c Phase 4c refusing to start a second Kit: TCP port(s) … still LISTEN under PID(s) …`）、`Print-FinalSummary -ExitCode 4`、`exit 4`，不是警告也不是可略過的建議。
4. 因此「部署樹含 mechanism」加上「`deploy_exit=0`」蘊含：該 preflight 在 canonical-linux 上實跑，且走的是 pass path（`Get-HostNativeOrphanListener` 回傳 `$null`）。這正是 opening reason 說「merge 前拿不到」的那一半證據。

同一次 Phase 4c 啟動亦蘊含 `.ports` claim 被寫出：`Start-HostNativeKit` 以 `-ListenPorts (@($SignalPort) + @($SpectatorSignalPorts))` 呼叫 `Start-HostNativeService`，而 `Start-HostNativeService` 是在 `Start-Process` **之前**就寫下 `<Name>.ports`（程式碼註解點名「Written BEFORE the launch, not after (#640)」，理由是啟動後才記錄會重開 pid file 已有的同一個競態窗口）。

## 補充觀察（屬已關閉的 `remote-deploy-tag-origin-main-sync` entry，僅作旁證）

同日在 `-004` 之前還有一次中間部署嘗試：deploy tag `deploy-20260819-639227435444539723-003` → `cb92a2bf99a4cbb7ba3c67ec17bfcf2996721972`，tag 已 push 且可見。該次部署進行期間 `origin/main` 被另一條並行 merge（#657）推進，於是 `refs/heads/main` 的 non-fast-forward push 被拒，wrapper 逐字浮出 `remote_deploy_transport: deploy tag '<tag>' was pushed, but origin/main could not be synced to the deployed commit <sha> (…)` 並以非 0 結束，且**沒有**回收已推出的 tag——這正是 #652 的 summary 列為「未由真實部署驗證過」的那條 rejection 分支，如今被真實觀察到一次。本節僅為旁證，不改動任何 ledger 狀態，也不重開該已 closed 的 entry。

## 誠實界定（deliberately not claimed）

- **REFUSAL 分支未在真實部署中觸發**。部署環境是乾淨的，沒有孤兒 Kit，因此上面取得的是 pass path 的實跑，不是拒絕行為的實跑。拒絕分支目前只由 `scripts/tests/test-host-native-launcher.ps1` 的 5 個 `#640` fixture 案例釘住（`host-native launch records the ports its tree will own`、`stale-pid cleanup keeps the port claim that outlives the launcher`、`orphaned listener detection is fail-closed and tree-aware`、`only a stop that terminated something releases the port claim`、`Kit launch declares the signal ports it will own`），本次重放全綠，並在 Windows CI 上綠過：#653 merged head `0724397` 的 `rebuild/test-deploy contracts`（windows-latest）job，run `32249873467`，conclusion success；同 PR 較早的 head `eba8ca81` 亦有 run `32244348942` 的同名 job success。
- **remote host 上的 `.ports` sidecar 內容未被 operator 直接檢視**。它的產生是 code-path 蘊含（`Start-HostNativeService` 於 launch 前寫入），不是一次直接觀察；本檔不宣稱看過 `scripts/.run/bim-streaming-server.ports` 的實際位元組。
- **preflight 的 pass path 沒有專屬輸出行**。通過時 deploy 不印任何 preflight 專屬訊息，因此上述是「code path 蘊含＋`deploy_exit=0`」，不是一行直接的 log。
- 部署 log 屬 operator 本機，未 commit 進 repo；同批部署產生的去識別化 effective-env 快照（`20260819T134054Z-effective-env.json` 等，位於 operator 主機 `artifacts/deploy-reports/canonical-linux/`）同樣未 commit，本檔不引用其內容。
- 端點抽查為 coordinator session 的當下觀察，未附主機資訊，也未附可重放的 artifact。
- 本重放為本機 pwsh 7.5.4（Windows 11）執行；hosted runner 的對應綠燈由本 closure PR 自己的 required checks 提供，不由本檔主張。
- 補充觀察一節描述的是 `remote-deploy-tag-origin-main-sync` 的機制，該 entry 已由 PR #652 關閉；本檔記錄它只是因為它與本次同一批部署同時發生，並不屬於本 entry 的 verification contract。

過程未讀取 credential、未做任何 live mutation、未觸碰部署區或生產狀態，未執行任何 approve／merge。
