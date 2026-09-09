# P6/P7 — authorized delivery and terminal evidence

先確認本次授權涵蓋 push／PR／merge。Skill 的啟動、測試與 review 通過都不擴張授權。

P6 的 base-pinned trusted host executor 擁有 evidence collection 與 identity-bound merge sink；
apex 始終沒有 shell/write capability。production ship-item 維持 validation-only，caller 注入工具不能解鎖。

```
P6 前置(指揮官親自做,解決 PR body 資料通道):
     Fabric-managed 時先重驗 current binding evidence；binding 只鎖 local slice，絕不可當作 push／PR／merge
     consent、`direct_stack` activation 或部署授權。任一 lease/branch/worktree/scope tuple 漂移即 HELD。
     a. behavior gate:PR body 填 Change lane=S、Behavior contract changed=yes、
        Requirement source=superpowers spec,並連到本次已核准 specPath。不得只因 changed path
        建立 OpenSpec；只有 repo 需求明確要求 OpenSpec artifact 時才建立。
     a.1 base freshness gate:先把 implementation + evidence 的 tracked work commit 完整並確認 worktree clean；
        `git fetch origin +refs/heads/main:refs/remotes/origin/main` 後用 `git merge-base HEAD origin/main`
        與 `git rev-parse origin/main` 比對。不同代表 branch stale：尚無 prNumber 且未發布的 branch MUST
        `git rebase origin/main`；已有 prNumber 或 published PR branch MUST NOT 改寫 history，改用
        `git merge --no-edit origin/main` 以維持 normal push（conflict → HELD）。完成後重跑 affected verify、
       必要 evidence、以新 targetSha/baseSha/subjectSha 完整重跑 P5 與 GitNexus detect_changes；不得拿更新 base 前的驗證直接進 P6。
     b. push:git push -u origin <branch>
     c. gh pr create --base main(繁中):body 含 ──
        - Change lane / Behavior contract changed / Requirement source 三個 machine fields
        - user-facing:product-operability §4 的 current Frontend 驗收表(資料來自 P4.evidence 的
          screenshots/runtimeIds/engine + **Read 其 summaryJson 檔**補齊 route/buttons/fixture/
          backend API/E2E command/manual steps)
        - P1.impact HIGH 的補強策略、P3.highRiskNotes
        - P3.detectFallbackTasks / detectFailTasks / fixDetectVerdicts(非 pass 項)的 GitNexus fallback 揭露
        - deferredAccum(P5 known_gaps/follow_ups 跨輪累計，非只最後一輪) 與 Full completion claimed=false(accumulator 任一非空時)
        - 動 runtime/deploy 時附 Deploy Path 表;純 tooling/docs 註明不適用
        記下 prNumber
     d. local preflight（進入持 merge authority 的 workflow 前）：在目前已 push 的乾淨 head 上執行
        `.\scripts\dev\check-pr-local-preflight.ps1 -PrNumber <prNumber>`；通過後立即比對
        `git rev-parse HEAD` 與 `gh pr view <prNumber> --json headRefOid --jq .headRefOid` 完全相同。
        任一失敗或 head 改變都 HELD；不得把舊 head 的 preflight 當成 P6 證據。
P6 = Workflow({name:'ship-item', args:{branch, prNumber:<前置 c 的號碼>, userFacing}})
     **目前實際狀態**：已量測 Workflow runtime 沒有 `$` shell helper。`ship-item` 在 Validate 完成 args 檢查後
       回 `heldReason='host_env_blocked'`、`heldDetail='ship_workflow_shell_unavailable'`；不 dispatch apex、
       不讀 git/gh、不 merge。production `ship-item.js` 已移除 legacy coordinator 與 merge sink；注入 synthetic
       `$`／`agent` 的測試只證明 caller capability 無法解鎖這個 durable hold，不是 deployability evidence。
     **external executor**：repo 已實作 default-branch-only `.github/workflows/trusted-elevated-merge.yml`，
       由 freshly fetched trusted base 執行固定 preparation、tool-free Claude/Codex apex、final reads 與
       exact-head REST merge；不得 checkout 或執行 PR branch 可修改的 script/action/hook/dependency。
     **activation**：repo state=`requires_live_attestation` 時，credential step 前的 trusted-base preflight 只接受
       workflow input/assertion 與 protected variables 所綁 exact mode/tuple 的 `attesting_negative`／`attesting_positive`。negative mode 可完成
       reversible gates 但永不到達 merge sink；positive live merge 通過後仍須受審 closure 把 repo/external state
       一起改為 `active` 並清除 tuple digest。之前一律 `trusted_elevated_authorization_unavailable`，不得 retry 成
       成功、手填 `merged=true` 或進 P7；sink 已嘗試但 bounded authoritative reads 無法確認時必須保留
       `status=merge_outcome_unverified`、`merged=null`，不得降成未 merge。
     external executor consume：所有 `heldReason` 必須先通過 machine contract closed enum；raw 細節寫
       `heldDetail`／`診斷=`。review／approval／protection／elevated／consent carve-out 依下方處置表停下；
       常用 protection/branch checkpoint 是 `branch_requires_separate_authorization`、
       `branch_protection_changed_during_buffer`、`branch_protection_changed_after_verdict` 與
       `human_approval_changed_after_verdict`；
       只有 trusted host 已重新驗證 exact repo/PR/base/head、required checks、三處 review evidence、branch
       protection 與 shell-free apex verdict，且 authoritative GitHub state 證明 merge 後，才可進 P7。
P7 = 主對話回報四項:改了哪些 tracked files / 跑了哪些最小驗證 / 哪些測試沒跑及原因 / 已知風險
     + mergeCommit + evidence 路徑；適用的 user-facing 欄位依 product-operability §4
     宣告前先對帳:OpenSpec/plan 的 task 勾選 ↔ state 檔 + task#N commits;不一致 → held='ledger_mismatch'
     DONE@P7 前仍須 freshly fetch `origin/main`，但用途只限讓 merge commit object 在本機可供 ancestry/tree
     檢查；local tracking ref 不構成信任證據。machine contract 的 `terminal_evidence` 固定 trusted HTTPS remote
     與 `refs/heads/main`；validator 使用已驗證、worktree 外的絕對 Git executable，清除 local/global Git config
     與不安全 CA override 後同步執行 `git ls-remote`。live remote SHA 必須等於 full 40-char `mergeCommit` 與
     terminal `head`；`git merge-base --is-ancestor <prHead> <mergeCommit>` 必須成功，且
     `git diff --quiet <prHead> <mergeCommit> --` 證明 same tree；`evidenceHead..prHead` 仍只含 evidence
     allowlist。state 另記 prHead=<合併前 PR head>、mergeCommit=<live remote refs/heads/main commit>。任一 live
     resolution、ancestry 或 tree 證據失敗都 `evidence_stale`；terminal 行不得 resume 任何 agent phase。
```
