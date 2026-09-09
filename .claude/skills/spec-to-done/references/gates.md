## held 對照表（常用處置；完整 closed enum 以 machine contract 為準）

| held | 來源 | 指揮官處置 |
|---|---|---|
| `bad_args` | 任一 std-* / fu-generic(必填 args/SHA/domainContext 缺、malformed 或被字串化) | 修正 args 為正確 object；只在對應 run/P5 額度內重呼 |
| `bad_findings` | P5 registry 缺欄、重複 id、q 過長、型別錯或 suspectFile 非 canonical repo-relative path | 修正 bounded registry；只在 P5 round 尚有額度時重呼，不得丟棄 finding 或灌 review 全文 |
| `run_budget_exhausted` | 任一 phase 的 agentCalls / P5 / evidence 上限已到，或 findings >32 | **HELD**；一般 resume 永不可歸零。只有 exact owner 啟動後由 `append-new-run.mjs` 建立 machine-bound `NEW_RUN@P0`；手寫或複製 boundary 一律無效 |
| `resume_state_invalid` | state 缺必要欄位、假 run ID、計數器/HEAD 不可信或 schema 漂移 | **HELD**；依 git/artifact 建立新格式 checkpoint，通過 validator 前不啟 agent |
| `scope_drift` | evidence-closeout 需要 production/UI/contract/config 變更 | **HELD**；改用另一個已核准 full change，不得在 closeout 內擴張 |
| `evidence_stale` / `evidence_not_closing` | P5 worktree/HEAD/target/base/subject identity 漂移、空 review range，或 closeout evidence 未綁目前 HEAD/兩次仍未閉合 | 丟棄舊 verdict；fetch/commit/clean 後重取完整 SHA；只在剩餘額度內重跑，禁止第三輪自動重試 |
| `external_blocked` | P5 有 confirmed/adjusted external blocker | HELD；回報 evidence＋精確 unblock_condition；條件實現後以新 clean subjectSha 重跑，禁止自動修 |
| `plan_author_failed` / `plan_parse_failed` / `reviewer_agent_failed` | P1/P3 infra；P5 agent null、verifier/critic 缺失或 output schema/identity 不合法 | 只在剩餘 run/P5 額度內以同一 immutable input 重呼一次；再失敗或額度用盡 → HELD |
| `review_unverified` | P5 output 合法但 supplied immutable content 無法支持 evidence/taxonomy | durable HELD；保存 unverified 細節，補齊 pinned content 或修正實際內容後才可在剩餘額度內重跑，不得當 pass |
| `plan_not_aligned` | P1 修 2 輪仍不過 | **一律 HELD**(附 spec 矛盾診斷 specConflict;不自動重跑 P1 — 強制停下點,不可自動繞) |
| `critical_impact` | P1 預掃 / P3 per-task | HELD(CRITICAL 阻擋)。使用者選:(a) 拆 change → 修 spec/plan 後重跑;(b) reviewer sign-off → resume 時把該 symbols 放進 `acknowledgedCriticalSymbols`,gate 對已 ack 的 symbol 放行(這是唯一解鎖通道;sign-off 由使用者親自給,或經「State 行詞彙與簽核委派」節的委派通道由受委派 agent 代行) |
| `impact_unavailable` | P1/P3 GitNexus 整體故障(含 overallRisk=UNKNOWN) | HELD;按 memory 復原 LadybugDB(`gitnexus status`+meta.json 為準)後 resume;復原前可用 codebase-memory trace_path 取暫時 blast-radius 寫 note 供 resume 判斷,**held 不因此解除** |
| `plan_error_at_task` | P3 implementer 判 plan 錯 | HELD(附 blockedDetail);使用者核可後修 plan 檔 → resume P3 帶 startTaskIndex=該 task(P3 會重新 Parse 修過的 plan) |
| `spec_review_not_closing` / `quality_review_not_closing` | P3 修 N 輪仍不過 | HELD(附 gaps/qualityDetail)— 真 P1/P2 修不閉合,不可繞 |
| `detect_changes_repeatedly_failing` | P3 同 run 內 detectVerdict=fail 達 3 次 | HELD;指揮官 `gh issue create`(標題含 branch + 失敗摘要),等修復或 reviewer sign-off |
| `no_browser_engine` / `no_browser_evidence` | P4 | 見編排 P4 gate(第 3 層 / stack 啟動 / HELD) |
| `test_deploy_process_unproven` | backend / 測試部署區 preflight | HELD；port / process-name / pidfile 都不能單獨授權停止。listener 必須符合 per-port service role、deployment pidfile ancestor 與精確 launcher entrypoint，且 creation identity 經雙快照與 stop 前重驗一致，才可用下方 explicit stop 模式重跑 |
| `host_env_blocked` | 任一 phase(host/環境層阻斷:CLI auth 失效、platform command/approval policy 擋操作、runtime 依賴或探測缺口等,非 spec/plan/品質問題) | HELD;診斷欄寫明被阻斷的具體操作與環境成因;修復環境後以同 phase(同 taskIndex/prNumber)resume;不得因環境阻斷降級或跳過任何 gate,也不得為個別環境狀況發明表外 held 值(細節一律進診斷欄) |
| `ledger_mismatch` | P7 對帳(指揮官發出,非 workflow 回傳):OpenSpec tasks.md / plan 勾選與 state 檔+`task#N` commits 不一致 | HELD;以 git/code 證據為準做 forensic 調和(單獨 commit/PR 修 ledger),不得單方按 state 檔補勾、也不得按 ledger 否定已有 commit 證據的完成;調和後才可宣告 done |
| `review_required` / `human_approval_required` | P6 branch protection / canonical review | HELD；使用者以固定 CODEOWNER 帳號完成 exact-head canonical approval 後，以同一 prNumber resume；agent 禁止 `gh pr merge --admin` |
| `reviewer_permission_not_strict` / `reviewer_permission_changed_after_verdict` | P6 fixed reviewer identity | HELD；使用者恢復固定 reviewer exact `write` permission/role 後 resume，不得降級 identity gate |
| `branch_requires_separate_authorization` | P6 revert-* / release / hotfix branch | HELD；持久化目前 checkpoint，取得使用者明確同意後改走另行授權流程；不得以同一 ship-item 自動重試、resume 或 merge |
| `branch_protection_changed_during_buffer` / `branch_protection_changed_after_verdict` / `human_approval_changed_after_verdict` | P6 protected-state drift | HELD；重讀 protection 與 exact-head human approval，狀態穩定且 fresh approval 綁定目前 head 後才能 resume；不得自動重試或 merge |
| `trusted_elevated_authorization_unavailable` | P6 elevated authorization broker | HELD；repo broker contract 已實作，但 hosted environment 未 provision／未 attested，或 exact tuple/runId/provider/nonce/expiry approval 不成立；caller-supplied `elevatedAuthorization` 不得解鎖或 resume |
| `unexpected_elevated_authorization` | P6 routine caller args | 移除 routine PR 不應出現的 `elevatedAuthorization` 後，以同一 prNumber resume |
| `branch_protection_single_owner_gate_not_strict` | P6 live protection | HELD；使用者／admin 恢復 approvals=1、dismiss stale、code-owner review、strict checks、conversation resolution、enforce-admins 且無 bypass/force/delete 後 resume |
| `cyber_safeguard_payload` | P5/P6 reviewer safeguard | separator-only fixture 才可換成 `a/b` / `seg/seg/id`，確認 payload paths 的 `passwd` grep 無結果後 resume；涉及 security 語意則 HELD |
| `ship_blocked` 類(由 heldReason 文字) | P6 | 見編排 P6 consume |

## 強制停下點(repo 規範明文,不可自動繞)

spec 矛盾(P0/P1)、GitNexus CRITICAL(未 ack)、browser evidence not observed、真 P1/P2 修不閉合、
evidence-closeout scope drift / stale / 兩輪未閉合、run budget 到頂、ship consent carve-out、工具反覆故障(detect 3 次 / GitNexus 不可復原)。
HIGH 不是停下點:在對話中明確回報 blast radius 後繼續,PR body 必寫補強策略(P6 前置 c 是執行通道)。

**Hold block 固定格式**(輸出後停;同時 append 到 state 檔):

```
HELD@P<n> | reason=<held 值> | spec=<specPath/changePath> | slug=<slug> | userFacing=<bool>
| branch=<..> | worktree=<絕對路徑> | head=<git SHA> | executionMode=<full/evidence-closeout>
| closeoutTaskIds=<逗號分隔;full 留空> | runIds=<codex:actual-session-or-agent-id>
| agentCalls=<used>/40 | p5Rounds=<used>/2 | evidenceAttempts=<used>/2 | evidenceHead=<SHA 或空>
| dateStamp=<..> | planPath=<..> | taskIndex=<..> | prNumber=<..>
| 診斷=<specConflict/gaps/blockedDetail 摘要> | 需要使用者決定=<具體選項>
| fabricMode=fabric-managed | fabricBindingId=<64-hex>
```

最後兩欄只在 Fabric-managed 出現，且必須同時存在；standalone 兩欄都不得寫。
