# Delivery Safety

## Worktree

- 主 checkout 維持乾淨的 `main`；tracked 修改在 canonical sibling worktree 進行。
- Windows 建立入口：`pwsh -NoProfile -NonInteractive -File scripts/dev/new-governed-worktree.ps1 -BranchName <type>/<slug> -Json`。
- 建立後確認 worktree 位於 repo 外 sibling path、HEAD 來自 freshly fetched `origin/main`、branch 唯一且 status 乾淨。
- 同一 branch/worktree 只允許一位 writer；不明確或重疊的 touch-set 先停止協調。

## Pull request

- 不 force push、不使用 admin bypass、不由 agent 產生人類 approval。
- 合併前重新讀取 base/head、`pr-safety`、CODEOWNER approval、last-push approval、unresolved threads 與 mergeability。
- Approval 必須對準 exact head；push 後舊 approval 不再有效。
- 自動 reviewer、bot comment、artifact 或本機 pass 都不是 merge authority。
- `pr-safety` 不支援 merge queue；PR 改 base 後須重新 push 或 reopen 觸發新檢查，不能沿用舊 base 的結果。
- Worktree helper 的 agent board 已退役；移除 readiness 會保留 `board_status_unknown`，不得將此狀態當作安全刪除許可。

## Deployment and process ownership

- Deploy 是獨立授權邊界；PR merge 不自動授權 deploy。
- Canonical test deployment 只能從已合併且 freshly fetched 的 `origin/main`，透過 `scripts/dev/rebuild-test-deploy.ps1 -Build` 與 repo 外 private inventory 執行。
- Inventory、credential、topology 與秘密值不得提交或輸出。
- 停止程序前必須證明 listener、PID、launcher、deployment root 與 creation identity 一致；不能證明即停止。不得用 ACL、`safe.directory`、`-Force` 或任意 kill 繞過。
- Kit 的 `_build` tree 只能在 Kit 停止且 tree 釋放後才可刪除或重建：remote transport 只寫 `scripts/.run/kit-inputs-changed` 標記，實際的 stop → release → invalidate → rebuild 由 `deploy.ps1` Phase 2 執行。Linux 不會像 Windows 以檔案鎖擋下這件事，運行中的 Kit 會直接 crash。
- Kit 部署成功的定義是 Phase 4c media gate 通過（signalling `sign_in` 收到含 video track 的 offer），不是 `:49100 LISTEN` 或 log 出現 `app ready`；deploy.log 沒有 `Kit media gate passed` 的部署不得宣稱 Kit 可串流。
- 重啟 host-native conversion service 會讓進行中的 CFD run（`preprocessing`/`meshing`/`solving`/`postprocessing`）被標 `failed`。部署停止它之前先讀該服務的 run list，有進行中的 run 或讀不到就 fail closed 並列出 run id；只有明確加 `-AllowInterruptingCfdRuns` 才中斷，`-Force` 不代表同意。細節見 `local-verification.md` 的「進行中的 CFD run」。
- Production、migration、permission、scheduled automation 與 destructive cleanup 各自需要明確授權。
