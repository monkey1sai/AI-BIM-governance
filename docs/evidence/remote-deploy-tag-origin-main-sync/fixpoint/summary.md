# remote-deploy-tag-origin-main-sync — fixpoint 重驗摘要

- Entry：`remote-deploy-tag-origin-main-sync`（open 於 PR #647，2026-08-19T08:37:28Z）
- Mechanism commit：`4f55c26d18a4e8cbc7c3ac34816b64bdc188f7fe`（#647 以 merge commit 落 main，subject `Merge pull request #647 from monkey1sai/feat/remote-deploy-tag-sync-origin-main`；位於 `origin/main` first-parent mainline，first-parent diff touch 全部兩個 declared `verification_mechanism_paths`：`scripts/lib/remote-deploy-transport.ps1`、`scripts/self-referential-bootstrap-ledger.json`）
- 重驗環境：`git worktree` detached checkout 恰為 mechanism commit `4f55c26` 本身，tracked 檔 0 dirty，置於非 Temp 路徑；本機 pwsh 7.5.4（Windows 11）
- 重驗時間：2026-08-19T09:46:38Z – 2026-08-19T09:47:18Z（UTC，實測；`reverified_at` 取重放結束時刻）
- Verification contract：`remote-deploy-tag-origin-main-sync/v1`（sha256 `79f59833ee9e310be43cca15dd1429a4e830e1dd7de0fddb0fba125ed51e2211`）。該 digest 由本次獨立重算核對：以 `scripts/tests/test-self-referential-bootstrap.ps1` 的 `New-VerificationContract` 規範形式（contract id 與 command_ids 以 LF 串接、UTF-8 無 BOM 取 SHA-256）重算後與 ledger 記載 byte-exact 相符。
- 依凍結順序重放全部 4 個 command，全部 exit `0`：

| # | Command id | 指令 | 關鍵輸出 | 秒 | Exit |
|---:|---|---|---|---:|---:|
| 1 | `test-remote-deploy-transport` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-remote-deploy-transport.ps1` | `[PASS] deploy tag push also syncs origin/main to the deployed commit` ／ `all assertions passed` | 1 | 0 |
| 2 | `test-self-referential-bootstrap` | `pwsh … scripts/tests/test-self-referential-bootstrap.ps1` | `all assertions passed` | 27 | 0 |
| 3 | `test-pr-body-evidence` | `pwsh … scripts/tests/test-pr-body-evidence.ps1` | `all assertions passed` | 10 | 0 |
| 4 | `invoke-powershell-static` | `pwsh … scripts/tests/invoke-powershell-static.ps1` | `passed` | 2 | 0 |

指令對照取自 `scripts/tests/test-self-referential-bootstrap.ps1` 的 immutable command map，非自行拼寫；本 contract 的四個 command 皆無 `<…>` 佔位參數，故不需具現任何佔位。

## 這次重驗回答的正是 opening reason 的循環

Entry 的 reason 指出：canonical deploy path 依契約只對**已 merge 的 `origin/main` 內容**執行真實部署，因此在這支變更自己抵達 `origin/main` 之前，無法用一次真實 canonical 部署證明「新增的 origin/main 同步步驟真的會執行並成功」；單元測試只能驗證 injected `$GitRunner` 收到的 git 呼叫序列，取代不了一次真實的 B13 tag-and-sync 部署週期。

該真實週期**已於 2026-08-19 發生**（coordinator 主導的 canonical 部署，發生於 #647 於 09:09:49Z merge 之後）：

- 部署 commit：`b6ccc3c2224ef6b56d8ee241d3570eb4eefb42f7`（`origin/main` tip，其 first-parent 歷史包含 mechanism commit `4f55c26`），wrapper `deploy_exit=0`。
- Deploy tag：`deploy-20260819-639227293146090441-002` → `b6ccc3c2224ef6b56d8ee241d3570eb4eefb42f7`，annotated tag，message `deploy target=canonical-linux exit=0 snapshot=20260819T094154Z-effective-env.json deployed=b6ccc3c…`；已 push，`git fetch --tags` 後於本機可解析（`git rev-parse deploy-20260819-639227293146090441-002^{commit}` 回 `b6ccc3c…`）。
- 執行的正是變更後機制：operator 側 `scripts/lib/remote-deploy-transport.ps1` 的 blob 在 operator checkout HEAD（`e9abe507`，位於 #647 的 feature branch `feat/remote-deploy-tag-sync-origin-main` 上，且為 #647 merged head `ad64ed6` 的祖先）、mechanism commit `4f55c26`、`origin/main` 與 operator 工作樹 `git hash-object` 四處皆為同一顆 `5c7079c5463c691a1e252939ccd5fd8c6e9f8d31`，即 tag/sync 是由**含同步步驟的那份程式碼**執行的。

同步步驟成功的論證走 code path（`New-RemoteDeployTag`，mechanism commit 版本）：

1. 先 `git push origin refs/tags/<tag>`；失敗即刪本地 tag 並 throw。
2. tag push 成功後才執行 `git push origin <DeployedSha>:refs/heads/main`；此步 exit 非 0 會 throw（`deploy tag '<tag>' was pushed, but origin/main could not be synced to the deployed commit …`），且刻意不回收已推出的 tag。
3. 唯一的產線呼叫點 `Invoke-RemoteTestDeployRebuild` 沒有任何 try/catch 包住 `New-RemoteDeployTag`，而 `Write-Host "[deploy-tag] $deployTag -> $fullSha"` 是在該函式**回傳之後**才輸出。

因此本次觀察到的 `[deploy-tag] deploy-20260819-639227293146090441-002 -> b6ccc3c…` 這一行加上 wrapper exit 0，蘊含同步步驟確實執行且 exit 0——若同步失敗，該行根本不會被印出，wrapper 也不會是 0。

本次成功屬程式碼註解點名的 **expected no-op case**：部署來源本來就是一次 `origin/main` 的新鮮 fetch，所以 `origin/main` 早已在該 commit 上，push 為 no-op。部署後的 post-state 亦已核對：`git ls-remote origin refs/heads/main` 仍解析為 `b6ccc3c2224ef6b56d8ee241d3570eb4eefb42f7`。

## 誠實界定（deliberately not claimed）

- **同步步驟沒有專屬成功輸出行**。上述證據是「code path 蘊含 + 部署後 post-state」，不是一行直接的 log。本檔不宣稱看到過任何 `origin/main synced` 之類的字串。
- 本次真實週期走的是 **no-op 分支**（`origin/main` 已在部署 commit 上）。「`origin/main` 落後於部署 commit、push 真的推進 ref」以及「push 被拒而 throw」兩條分支**未由真實部署驗證過**，僅由 `test-remote-deploy-transport` 的 injected-`$GitRunner` 單元測試覆蓋。
- 部署 log 屬 operator 本機，未 commit 進 repo；同次部署產生的去識別化 effective-env 快照 `20260819T094154Z-effective-env.json`（operator 主機 `artifacts/deploy-reports/canonical-linux/` 下）同樣未 commit。本檔不引用其內容。
- 部署後的端點抽查（coordinator `:8004/health`、`:8004/ui`、viewer `:5173`、conversion `:49101/health` 皆 HTTP 200；kit `:49100` TCP 可達）為 coordinator session 的當下觀察，未附主機資訊，也未附可重放的 artifact。
- 本重放為本機 pwsh 7.5.4（Windows 11）執行；hosted runner 的對應綠燈由本 closure PR 自己的 required checks 提供，不由本檔主張。
- 重放第 1 條指令輸出中的 `[deploy-tag] deploy-20260819-639227295991554363-001 -> ffffffff…` 是單元測試以 injected runner 產生的**測試內字串**，未建立也未推送任何真實 tag（重放後 `git tag -l 'deploy-20260819-*'` 仍只有 `-001`／`-002` 兩顆真實 tag）。

過程未讀取 credential、未做任何 live mutation、未觸碰部署區或生產狀態，未執行任何 approve／merge。
