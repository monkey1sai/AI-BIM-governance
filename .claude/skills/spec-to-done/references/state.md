## Resume(使用者一句話重入;支援跨 session)

- `--git-exe` 僅允許 owner 安裝、caller 不可寫的 system Git：Windows 的
  `C:\Program Files\Git\cmd\git.exe`、`C:\Program Files\Git\bin\git.exe`、
  `C:\Program Files\Git\mingw64\bin\git.exe`；POSIX 的 `/usr/bin/git` 或 `/usr/local/bin/git`。
  不使用 `Get-Command git`、PATH proxy、repo-local Git 或 caller-writable binary；仍須通過既有
  executable identity、hash、owner 與 git-dir/common-dir 檢查。沒有合格 binary 即 `host_env_blocked`。
- 任何 resume 先跑 `append-new-run.mjs status --state <absolute-state-path> --json`。若
  `canStartNewRun=true`，沒有當輪 exact owner authorization 時只能回報 tuple，不得啟 agent；有授權也只能
  用 helper 遷移到 freshly fetched main descendant worktree，舊 state 不得修改或截斷。
- 若 status 回 `fabricManaged=true`，本 run 已 terminal：保留 exact lease/binding 並請 outer Fabric 維持
  `SUSPECT`；不得 append `RESUMED`、`AUTHORIZATION`、`NEW_RUN`，也不得換 CLI／worktree 偷渡。只有
  Fabric 新建 task/lease/binding 才能另開 state；舊 ledger byte-identical 保留。
- **State 檔(durable,跨 session 唯一座標)**:`agent-contracts/spec-to-done.contract.json` 固定 standalone path
  `artifacts/spec-to-done/{slug}-state.md`；Fabric-managed path 是
  `artifacts/spec-to-done/{slug}--{binding_id}-state.md`。validator 單一正本位於 `.claude` 側，`.codex` 不放副本。
  先把 durable history 完整複製到 sibling temp，再 append 候選行（禁止單行 temp），執行
  `node .claude/skills/spec-to-done/validate-state.mjs --state <temp>
  --platform codex --git-exe <上述 system Git 的絕對路徑> --expected-head <git SHA>
  --expected-worktree <worktreeRoot> --expected-agent-limit 40 --expected-p5-limit 2
  --expected-evidence-limit 2 --trusted-main-ref refs/heads/main`；exit 0 才 append canonical durable state。
  allowlist 內沒有 caller 不可寫的 system Git 時回 `host_env_blocked`，不得改傳其他 binary。
  `--trusted-main-ref` 只是 machine contract 所定 remote ref 的固定 marker，不接受 local tracking ref。validator
  會清除 ambient `GIT_*`／config injection，並驗證 Git executable 與 git-dir/common-dir identity；它
  會載入 machine contract，檢查完整 history 的每一行、所有相鄰 transition、實際 HEAD、dirty/staged/untracked
  與 rename source，並只在 DONE@P7 獨立 live-resolve 固定 trusted remote、驗 remote main SHA、prHead ancestry
  與 same tree。若既有 history 無法通過行或
  transition 驗證，只能追加 counters 全到上限的 `HELD ... reason=resume_state_invalid` 作終端封存；
  該行不能用來繼續 progress，必須先修復或正規化歷史。
  Fabric-managed 的同一命令必須再帶
  `--fabric-binding <fabricBindingPath> --fabric-plan <fabricPlanPath> --fabric-lease <fabricLeasePath> --fabric-provider-session <fabricProviderSessionPath> --expected-state-path <expectedStatePath>`；五個參數缺一、傳給 standalone、binding path/state path 非 canonical、或 current tuple/branch/HEAD 漂移都 fail closed。
- 「繼續 spec-to-done」→ 先對 durable state 跑同一 validator；通過後還原全部 args 與累計計數，只重跑該 phase：
  `Workflow({name:<phase>, args:{...還原,remainingAgentCalls:40-agentCalls.used}, resumeFromRunId:<該 phase 實際 runId>})`。
  state HEAD 與目前 worktree HEAD 不同即 `evidence_stale`；不得靠新 session / 新 agent 跳過。
- P3 的 review anchor 是首次實作前保存的 `baseSha`，不是恢復時的 checkpoint HEAD。還原同一實際
  phase run／plan digest 綁定的原始 args 與完整 `resumeHint`；規則見 repo-root 路徑
  `.claude/skills/spec-to-done/references/implementation.md`。缺少可信 anchor 時 `HELD/resume_state_invalid`，
  不以目前 HEAD 或 `task#N:` commit 標題猜測 review 起點；不得重設計數。
- `evidenceHead` 可等於目前 HEAD 或其 ancestor；所有 committed/dirty 路徑只允許
  `docs/evidence/**`、`artifacts/e2e/**` 或精確 `openspec/changes/<change>/tasks.md`；closeout 只允許
  命名 change 的該 tasks.md，rename 來源與目的都檢查，任何產品變動皆判 `evidence_stale`。
- 舊格式 state 不可直接 resume。最多由指揮官做一次 bounded read，以 git log / task ledger / evidence artifact 建立新格式 checkpoint；
  無法證明的計數一律視為已到上限並回 `resume_state_invalid`，不得派 reviewer swarm 猜測或把計數設 0。
- 前序產物(plan 檔、commits、evidence)都在 git/磁碟,不重做;P3 錨點 = startTaskIndex(per-task commit 訊息規定前綴 `task#N:`,崩潰時可從 git log 重建);P6 帶同一 prNumber(ship-item 沿用既有 PR,不重複 create)。
- 時間戳一律由主對話經 args 注入(dateStamp);workflow 內禁時鐘/亂數 API。

## State 行詞彙與簽核委派(跨 CLI resume 契約;Claude 與 Codex 共用)

state 檔是跨 session / 跨 CLI 的唯一 resume 座標；新寫入的行一律遵守下列詞彙。歷史行保留作 audit，
但必須先正規化並通過 validator，禁止直接「盡力解析」後啟 agent：

- **行首 token 只允許五種**:`HELD@P<n>`、`DONE@P<n>`、`RESUMED@P<n>`、
  `AUTHORIZATION@P<n>`，以及只准 `append-new-run.mjs` 生成的 `NEW_RUN@P0`。後者只可直接接在有效
  `run_budget_exhausted` terminal 後，且不是一般 resume。
- **`reason=` 的 held 值 MUST 取自 `agent-contracts/spec-to-done.contract.json` 的 closed enum**；本檔處置表不是完整名單。不得發明表外值、不得把多個值併成複合值（一行一個主因，其餘寫 `heldDetail`／診斷欄）。host/環境層阻斷一律用 `host_env_blocked`。
- **欄位鍵固定 hold block 契約**，包含 `head/executionMode/closeoutTaskIds/runIds/agentCalls/p5Rounds/evidenceAttempts/evidenceHead` 與中文鍵
  (`診斷=`、`需要使用者決定=`)；不得混入同義欄位(`diagnosis=` / `need=` / `stateSchema=`)。
- Fabric-managed 每行另固定 `fabricMode=fabric-managed` 與 `fabricBindingId=<64-hex>`；整條 audit chain
  不得缺欄、切回 standalone 或更換 binding ID，validator `--platform` 必須等於 binding provider。
- **phase 編號取自 machine contract，固定 P0/P1/P3–P7 跳號，不存在 P2**；任何 state 行不得出現 `P2`(全域或他處 skill 的「P2 Test Design」詞彙不得滲入本 repo 的 run;測項設計屬 P1 plan 範圍)。
- **跨 CLI handoff**：原平台先驗 durable state；新平台不得 reattach 異平台 ID，只能啟 bounded 新 agent
  （Codex `fork_turns:"none"` 或最小 turns），append `RESUMED@P<n> | decision=cross-cli-handoff`，
  `runIds` 保留所有舊、新真實 `wf_*`/`codex:*` ID；新 call 照實增加 agentCalls，其餘 counters 不重設。
  此 handoff 只適用 standalone；Fabric-managed 的 provider 是 immutable tuple 一部分，必須由 outer Fabric
  另建 provider session/task/lease/binding，不可在原 state append cross-CLI `RESUMED`。

**簽核委派(delegated sign-off)**:使用者可顯式委派一個獨立 read-only agent 代行本 run 後續 HIGH/CRITICAL sign-off。委派必須由使用者明說(agent 不得自行發起或暗示),記錄為一行:

```
AUTHORIZATION@P<n> | spec=<specPath/changePath> | slug=<slug> | userFacing=<bool> | branch=<branch>
| worktree=<絕對路徑> | head=<git SHA> | executionMode=<mode> | closeoutTaskIds=<IDs 或空>
| runIds=<實際 IDs> | agentCalls=<used>/40 | p5Rounds=<used>/2 | evidenceAttempts=<used>/2
| evidenceHead=<SHA 或空> | decision=delegate-repo-workflow-signoff | scope=<代簽範圍>
| exclusions=<排除項> | 診斷=<使用者授權原文摘要> | 需要使用者決定=none
```

AUTHORIZATION 必須是完整 checkpoint；`decision` 只能是 `delegate-repo-workflow-signoff`，`scope` 只能取
`impact-signoff,detect-signoff,review-signoff,repo-workflow-signoff` 的非空子集，`exclusions` 必須完整且只能是
`secrets,credentials,billing,production-data,destructive-delete,unproven-process-stop`。validator 只驗 schema，
不會創造同意；仍須真實使用者訊息 provenance。短格式或 agent 自造授權無效。

## Platform invocation
以上 state procedure 的 --platform 使用實際 host。Claude 命令格式為：
`node .claude/skills/spec-to-done/validate-state.mjs --state <temp> --platform claude`
其餘 --git-exe / --expected-* / --trusted-main-ref 參數全部保留。Codex 使用 codex，Grok 使用 grok。
