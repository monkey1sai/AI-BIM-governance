# Parallel Delivery Fabric：多 Session 並行開發與安全交付設計

> 日期：2026-08-28
>
> 狀態：Draft — v1 擴充修訂，等待使用者重新審閱
>
> 方法：Superpowers Architectural brainstorming
>
> 文件角色：target-state design；不是目前已啟用的治理規則，也不授予 agent 合併、部署、審批或程序終止權限

## 1. Outcome

本設計要讓同一個 repository 同時容納多個可寫開發 session，各自在隔離 worktree 與 branch 中完成可獨立審查的工作，並透過 GitHub Pull Request、精確 commit 證據、整合列車及獨立 Computer Use E2E 驗證相互協作。

使用者可觀察的完成結果是：

1. v1 最多兩個互不重疊的 top-level writer session 可同時開發；Codex App 與 Claude CLI 共用同一個 global cap，第三個 writer 一律排隊，不能用 provider 名稱繞過上限。
2. 每個 session 有不可變的 provider/session/execution-context、owner、worktree、branch、scope、依賴、lease 與證據綁定，不會共同修改同一 checkout。
3. 無依賴任務使用獨立 PR；線性依賴可選 ordinary base-chained PR，或在 capability、exact-vector、獨立 gates 與外部 delivery authority 全部成立時使用 GitHub `direct_stack`；扇出任務在 root PR 後平行。
4. PR 的建置、測試與唯讀審查可以並行；共享 runtime、真實瀏覽器、合併與部署維持資源級序列化。
5. user-facing 變更必須由獨立 Computer Use verifier 對凍結的 exact SHA 執行真實操作與 E2E 證據收集。
6. 一個 session、PR 或 E2E 失敗只會凍結該 candidate 或依賴邊，不會阻塞所有無關開發。
7. session crash、Codex App restart 或 sandbox context 變動不會觸發廣域程序清理、ACL 變更、worktree 刪除或 Codex App 重裝。
8. ordinary PR 仍逐一交付；`direct_stack` 以完整 member vector、每個 member 的 merged-state 與 frozen-head-to-final ancestry，加上單一 final stack-result SHA 歸因，再由既有 autonomous delivery authority 執行 group-attributed deployment saga。GitHub 合併與部署不是跨系統物理 transaction，不得宣稱「不可部分成功」。
9. 明確的 execution envelope 可授權 agent 由 plan preview 前進到 local implementation、own-branch push、draft PR 與 delivery submission；每一級都需要不可變 generation、前置 gate 與獨立 authority，writer 不能自授權或直接 merge。

## 2. Design authority 與現況邊界

### 2.1 本文件擁有的決策

本文件只擁有以下尚未由現有交付規格完整定義的協作層：

- 多 writer session 的 admission、scope isolation 與 lease。
- task DAG、independent PR、stacked PR 與 fan-out 的選擇規則。
- Codex App／Claude CLI provider adapter、global writer admission 與 execution envelope。
- managed branch profile、GitHub direct-stack transaction 與 Merge Queue observe-only adapter。
- throw-away integration train。
- exact-SHA Computer Use E2E verifier。
- board projection、crash recovery 與 sandbox-safe lifecycle。
- candidate 如何逐一交給既有 autonomous delivery 的 promotion bridge。

### 2.2 只引用、不重新定義的 authority

下列 authority 由既有 source of truth 擁有，本文件不得建立第二套規則：

- Worktree 的 fresh origin/main、sibling path、命名與 closeout：由 docs/agents/github-workflow.md 擁有。
- 未合併 branch 的 runtime port、manifest 與 mutable-state isolation：由 canonical isolated-branch-stack-verification spec 擁有。
- exact-head machine review、外部 trust root、approval、merge、canonical Linux deployment、single-flight delivery transaction 與 terminal delivery result：由 active OpenSpec openspec/changes/autonomous-linux-delivery 擁有。該 OpenSpec 未加入 `direct_stack` contract 前，本文件的 stack path 只能 shadow/HELD，不能自行取得 merge/deploy authority。
- Live GitHub branch protection 與目前仍生效的審批規則：以 GitHub machine truth、canonical OpenSpec 及 executable tests 為準，不得從本設計推論已切換成 autonomous mode。

### 2.3 必須先調和的治理衝突

現行根 AGENTS.md 的 Single Active Writer 是 live policy；本文件提出的多 writer 是 target-state 改變。在相應的 canonical governance/OpenSpec delta 完成、驗證並啟用前，本文件不得被用來繞過 Single Active Writer。

active autonomous-linux-delivery OpenSpec 仍含 self-referential ledger、fixpoint、reconciliation PR 的舊要求；較新的 Lean Governance 與 docs/agents/self-referential-bootstrap.md 禁止新增這類純治理修復 PR，且 historical ledger 必須 byte-frozen。實作前必須在既有 OpenSpec 內明確修訂此衝突；本文件不默默選邊，也不複製衝突條款。

因此本設計通過審閱後，下一階段的第一個治理動作必須是：

1. 建立或修訂唯一 canonical OpenSpec delta，讓 global cap=2 的 Codex／Claude writer target-state 與 Single Active Writer live rule 有明確 activation boundary。
2. 在既有 autonomous-linux-delivery OpenSpec 內調和 stale self-referential closure，並明確增加 ordinary single-PR 與 `direct_stack` 兩種互斥 promotion contract。
3. 在上述 delta 啟用前，只可做 shadow-mode metadata、唯讀驗證、單 writer canary，以及不產生 GitHub/production mutation 的 adapter/transaction simulation。

### 2.4 2026-08-28 verified baseline

本設計從 freshly fetched origin/main 033ec31d9405d93a3864b2065a40e8f51f145863 建立。該 baseline 的 current/live facts 是：

- docs/plans/NOW.md 將 autonomous Linux delivery 標為 HELD/ACTIVATION_UNATTESTED；target OpenSpec 不能冒充已啟用 authority。
- canonical pull-request-review-agent spec 與 docs/agents/github-workflow.md 仍要求 User/CODEOWNER exact-head approval。`monkey1sai-blip` 雖由自動化 service account 執行，GitHub enforcement 仍把它視為 per-PR counted review；將它改成 monkey1sai Codex reviewer + App-pinned machine check 是既有 autonomous-linux-delivery OpenSpec 的 target activation，不由本文件提前生效。
- scripts/dev/manage-pr-queue.mjs 是 named-PR read-only observer；auto-fix、update、approve 與 merge 仍 fail closed。
- .github/workflows/ci.yml 的 top-level concurrency key 包含 workflow、ref 與 verification class，並設定 cancel-in-progress: true；不同 PR ref 通常互相隔離，但此 key 不表達 shared runtime lease 或 queue semantics，workflow 也沒有 merge_group trigger。未來共享資源 job 若改用 cross-PR group，不得沿用 cancel-in-progress: true。
- scripts/dev/agents-board.mjs 的 register、done、SessionStart、Stop、SessionEnd 與 Codex turn completion 都會呼叫 lifecycle maintenance；cleanup helper 會啟動 detached child，並具有終止 owner-proven dev process 與 prune worktree 的能力。

這些 facts 代表第一版不能把目前 board 或 queue observer 直接升格成 orchestrator。Board lifecycle cleanup 必須先與 session projection 解耦；本設計也不執行 board register/done 作為自身安全性的證明。

## 3. 方案比較與決策

### 3.1 方案 A：維持 Single Active Writer，多個 session 只做唯讀研究

優點是改動最小，但 writer throughput 仍為一，無法解決使用者指出的 active-session 瓶頸。此方案只保留為 activation 前的相容模式，不作為目標架構。

### 3.2 方案 B：未治理的永久 Git Flow branch

參考圖中的 feature、develop、release、hotfix 分流能表達依賴，但「沒有 owner、base SHA、TTL、generation 與 deploy-source 限制」的永久 branch 會增加長期 drift、重複 CI、回合併衝突及部署來源歧義。因此 v1 不採用未治理版本；改以 managed branch profile 納入 develop/release 類協作 branch，hotfix 仍為短生命週期 branch，且 canonical deployment 永遠只消費已驗證的 fresh merged `origin/main`。

### 3.3 方案 C：Parallel Delivery Fabric

採用隔離 branch/worktree、task DAG、managed branch registry、GitHub ordinary/direct-stack promotion、throw-away integration train 與 provider-neutral lease。它保留 Git 分散式並行優勢，又把共享 runtime、merge 與 deploy 的不可平行部分明確序列化。

決策：採用方案 C。

核心原則是：

> Parallelize development, review, and isolated verification; serialize only scarce shared resources and irreversible promotion.

## 4. 官方 Git / GitHub 能力基線

本設計依據以下官方行為，而不是圖片中的特定 Git Flow 命名：

- Git worktree 允許同一 repository 有 main worktree 與多個 linked worktrees；各自具有獨立 HEAD、index 等 per-worktree metadata，但共享 objects 與一般 refs。Worktree 隔離不等於 runtime、port 或 mutable-state 隔離。

  https://git-scm.com/docs/git-worktree.html

- Git 官方 workflow 以 topic branches 承載平行變更，並允許用可丟棄 integration branch 測試多個 topic 的交互作用；開發不得把 throw-away integration branch 當成新工作基底。

  https://git-scm.com/docs/gitworkflows

- Rebase 會重播 commit，產生新的 lineage；parent 或 trunk 改變後，上層 candidate 的 exact-SHA 證據必須失效並重新驗證。

  https://git-scm.com/docs/git-rebase

- agent-owned branch 若需安全更新，只能使用帶明確 expected remote SHA 的 force-with-lease；禁止裸 force。

  https://git-scm.com/docs/git-push.html

- Rebase 前後可用 range-diff 協助 reviewer 比較 patch series；其輸出只作人工可讀證據，不作唯一 machine gate。

  https://git-scm.com/docs/git-range-diff

- GitHub stacked PR 是同 repository、fully linear 的 PR chain，目前仍是 public preview；底層 branch 或 trunk 改變會要求 cascading rebase。

  https://docs.github.com/en/pull-requests/reference/stacked-pull-requests

- Native stack member 經 API 合併時使用專用 asynchronous stack merge API `PUT /pulls/{pull_number}/merge-async`；接受時回傳 `202` 與 operation UUID，必須輪詢到可證明的 terminal outcome，不能把 `202` 當作已合併。

  https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks

- gh stack 或 GitHub website 可建立 stack；若 preview extension/API 不可用，標準 Git branch 加 base-chained PR 仍可表達相同依賴。

  https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-stacked-pull-requests

- GitHub stack merge 的 all-or-nothing 保證只涵蓋 GitHub 內的 stack merge/enqueue 動作；它不包含外部 Linux deployment。API 的 `sha` 只綁選定 top PR，不是完整 member-vector CAS，因此 caller 必須自行凍結 ordered member vector，並在非同步完成後逐 member 重讀與驗證 ancestry/attribution。

  https://docs.github.com/en/rest/pulls/stacks

  https://docs.github.com/en/rest/pulls/pulls

- GitHub Merge Queue 使用 merge_group SHA，且 Actions 必須另外監聽 merge_group；它目前適用 public organization repositories 或 GitHub Enterprise Cloud private organization repositories，不能作為目前 personal-user public repo 的必要基線。

  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue

  https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

- GitHub Actions 相同 concurrency group 同時只允許一個 running；預設 `queue: single` 會讓新 pending 取代舊 pending，但 `queue: max` 可保留最多 100 個 pending。`queue: max` 不得與 `cancel-in-progress: true` 併用；等待順序依實際開始等待時間，不能把 dispatch 時間當嚴格 FIFO 證據。Concurrency key 必須包含 workflow 與資源 identity，避免不同 PR 互相取消。

  https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax

決策：v1 同時保留 ordinary single-PR path 與受限 `direct_stack` path。`direct_stack` 只接受同 repository、fully linear、contiguous lowest-unmerged prefix，固定 `merge_method=merge` 與 `merge_action=direct_merge`，並以 immutable member vector、async outcome poll、per-member merged-state/frozen-head-to-final ancestry proof 與 group-attributed deployment saga 補足 GitHub API 邊界。任一 capability 或歸因不可證明就 fail closed；不得把 GitHub atomicity 延伸宣稱為跨 GitHub／Linux 的物理 atomicity。

## 5. 系統模型

~~~mermaid
flowchart LR
    U[User / Coordinator] --> F[Parallel Delivery Fabric]
    F --> P[Delivery Plan Registry]
    F --> L[Lease Registry]
    F --> W[Workspace Provisioner]
    F --> D[Task DAG and Stack Adapter]
    F --> M[Managed Branch Registry]
    F --> X[Execution Envelope Gate]
    W --> S[Provider-neutral WriterSessionPort]
    D --> S
    X --> S
    S --> CA[Codex App Adapter]
    S --> CL[Claude CLI Adapter]
    CA --> R1[Writer Worktree and PR 1]
    CL --> R2[Writer Worktree and PR 2]
    R1 --> T[Throw-away Integration Train]
    R2 --> T
    T --> E[Exact-SHA Evidence Binder]
    E --> C[Independent Computer Use Verifier]
    C --> B[Single PR / Direct Stack Promotion Bridge]
    B --> A[Existing Autonomous Delivery Authority]
    B --> Q[Merge Queue Observe-only Adapter]
    P --> V[Board Projection]
    L --> V
~~~

### 5.1 Deep module boundary

Parallel Delivery Fabric 對外只暴露五個意圖層操作：

- submit(plan)：提交 task DAG、provider preference、branch profile 與 scope；只建立 immutable plan generation。
- advance(plan_id, execution_envelope)：在 envelope 允許的最高 action 內 provision worktree、啟動 top-level provider session 或產生 handoff；不得啟動 nested agent CLI，也不得越級 merge/deploy。
- reconcile(plan_id)：以 Git/GitHub machine truth 重新計算狀態、lease 與失效證據。
- drain(plan_id)：停止接受新工作，讓既有 candidate 到安全停止點；不殺程序、不刪 worktree。
- release(plan_id, lease_id, owner_end_attestation_ref)：只由 control-plane 依 §6.12 執行 writer-seat CAS release；保留 candidate branch/worktree/resource retention，不做 cleanup。

inspect(plan_id) 回傳唯讀 DeliverySnapshot。外部 caller 不需知道 board 檔案、Git ref CAS、stack preview 或 integration branch 的內部細節。

### 5.2 初始容量

第一版安全上限：

| 資源 | 上限 | 說明 |
|---|---:|---|
| Top-level writer session | 2 global | Codex App 與 Claude CLI 合併計數；每個 session 一個 branch、worktree、execution context、scope lease |
| Read-only reviewer | 2 | 與 writer 身分分離，可平行 |
| Computer Use verifier | 1 | 與 integration train 共用第三個 v1 runtime admission slot，兩者互斥 |
| Integration train | 1 | 與 Computer Use 共用第三個 v1 runtime admission slot，一次一個 generation |
| Direct stack transaction | 1 | async dispatch 到 terminal proof 與 deployment saga 結束前 single-flight |
| Promotion / delivery | 1 | 由既有 autonomous delivery single-flight 擁有 |

這是跨 top-level session 的容量，不改變單一 coordinator 內部 subagent cap 或 apex-slot invariant。擴容必須以碰撞率、等待時間、E2E flake、sandbox/process incident 與 delivery rollback 數據決定。

所有需要真實 runtime 的角色仍共用 canonical `isolated_runtime_offset[0..4]` domain，但 v1 admission budget 只允許三個同時 ACTIVE runtime leases：最多兩個 writer，加上 integration train 或 Computer Use 其中之一。其餘 offset 是 recovery／未來擴容保留，不得因「尚有可用 port」而核發第三個 writer。Computer Use 可在 evidence 證明相同 exact SHA、manifest 與 process lineage 時重用已凍結 candidate 的 owner-proven stack。第四個同時 runtime intent 必須 `QUEUED_FOR_LEASE`，不得自行選 port。

### 5.3 Provider-neutral top-level writer adapter

每個 writer 必須是 Codex App 的獨立 top-level task，或由外部 coordinator/launcher 啟動的獨立 Claude CLI session；不得從任一 writer 內 nested 啟動 Codex、Claude 或其他 agent CLI。兩個 provider 共用相同 lease registry 與 global cap，Adapter 保存下列不可混淆的一對一綁定：

plan generation → task_id → provider → provider_session_id → owner_session → execution_context_id → context_attestation_ref → repo/common-dir digest → branch → worktree id/path digest → scope lease → evidence head

Workspace Provisioner 先建立唯一 sibling worktree 與 branch，再把 immutable assignment envelope 交給 top-level adapter；adapter 不自行建立 nested worktree、切換別人的 branch 或重用別人的 execution context。Provider session 啟動後，writer 必須在自己的實際 sandbox/execution context 執行 `EXECUTION_CONTEXT_PREFLIGHT`：

1. 解析 repository root 與 git common-dir。
2. 讀取 HEAD、branch、origin/main 與 status。
3. 解析由 prior-pinned `ExecutionContextAttestor` 對這個實際 launcher/context 產生的新鮮 host-local attestation，並核對 owner、provider session、execution context、lease 與 worktree tuple。
4. 證明該 context 對 exact worktree 的 Git ownership trust 成立。
5. 證明 branch/worktree/lease 綁定與 delivery plan 相同。
6. 證明 provider/session/context tuple 未被其他未 release lease 使用，且沒有 nested CLI/worktree。
7. 寫入前重新確認 tracked worktree clean。

Coordinator 代跑的 preflight 無效。任何 dubious ownership、repo/common-dir identity 漂移、provider tuple 重複或不可判定結果都進入 `HELD_EXECUTION_CONTEXT`；禁止用 global `safe.directory`、ACL/owner 修改、sandbox.exe 操作或 Codex App 重裝補位。

Claude CLI adapter 不依賴 repo hooks：v1 保持 `.claude/settings.json` 的 `disableAllHooks=true`、`defaultMode=plan` 與 bypass-disabled machine truth，不安裝 SessionStart/Stop/End hooks，也不繼承 ignored `.claude/settings.local.json` 的 broad allowlist。每次 Claude start/privileged transition 前，`CLAUDE_CONFIG_PREFLIGHT` 都必須從 prior trusted/base-pinned source 驗證上述欄位、hooks absence/disabled、adapter-owned command policy digest 與 commit guard non-authority；candidate/local settings、provider permission resolution 或未接線 guard 不能新增允許的 command。Hooks enabled、settings source drift、adapter policy mismatch 或 local allowlist 影響決策時，全部在 file/network side effect 前進入 `HELD_PROVIDER_CONFIGURATION`。

Codex App 與 Claude CLI 都使用明確 `start`、CAS heartbeat、`handoff`、`end_request/release`、`reconcile/resume` protocol；provider-local 設定、board 或 commit guard 都不是 admission authority。

### 5.4 Heartbeat、resume 與 provider failure

Heartbeat 使用單調 `heartbeat_seq` 與 UTC timestamp 進行 CAS 更新；建議間隔不超過 30 秒。Timeout、provider process exit 或 App restart 只將該 lease 標為 `SUSPECT`，不自動釋放 slot。新 context 必須提交 `RESUME_INTENT`；coordinator 只有在能證明舊 context 結束、tuple/head/scope/worktree 未漂移時才 CAS rebind，否則建立新 generation/lease 並使舊 evidence 失效。

正常 handoff/abort 後，writer 只能送出 `END_REQUEST`；它不能自行寫 `release_evidence` 或把 lease 改成 `RELEASED`。Control-plane 只有取得 §6.12 的 fresh owner-end attestation 並完成 CAS 才釋放 writer seat。若 provider terminal event、launcher exit、envelope revocation 或 tuple 任一不可證明，lease 保持 `SUSPECT` 且占席。

Claude command nonzero 回傳 `FAILED` 與 sanitized reason/evidence gap；Codex/Claude adapter、board projection 或 launcher failure 都不得刪 branch/worktree、kill process、prune 或修改 ACL。另一個無衝突 writer 繼續運行。

## 6. Durable contracts

所有 durable artifact 只保存非機密 metadata、SHA、路徑、public GitHub identifiers 與短錯誤摘要，不保存 token、完整環境變數、瀏覽器 cookie、conversation transcript 或可逆敏感資料。

### 6.1 delivery-plan/v1

必要欄位：

- plan_id、repo_identity、created_at、coordinator_session。
- baseline_ref 與 resolved_baseline_sha。
- tasks：task_id、outcome、provider preference、owner_session、scope、dependencies、risk、e2e_required。
- requested_capacity（v1 不得超過 global 2 writers）、branch_profile 與 acceptance criteria。
- promotion_mode：`single_pr` 或明確列出 member order 的 `direct_stack`；禁止 runtime 自動猜測或切換。
- requested_execution_level 與 explicit user outcome/authority reference；不得保存 conversation transcript。
- governance_source_refs。

Plan 在 admission 後 immutable；任何 task graph 修改產生新 generation。

Plan generation 以 immutable blob 保存，只有 `refs/ai-bim/delivery-plans` 的 expected-old-OID CAS 可更新 latest index；不得把 plan preview 寫成 tracked candidate file、board record 或 remote ref。

### 6.2 lease-registry/v1

v1 只支援同一 verified git common-dir 內的多 session。Lease registry 使用本機 custom ref refs/ai-bim/session-leases 指向不可變 blob，並以 expected old OID 執行 git update-ref compare-and-swap；禁止 push 該 ref。不同 common-dir、不同 clone 或 multi-host coordination 一律 HELD_TOPOLOGY_UNSUPPORTED，留待獨立設計。

只有從 clean main、pinned SHA 執行的 Fabric control-plane 可呼叫 registry mutation port。Writer 只能提出 lease intent，不能直接把 candidate code 當成 lease writer。這個 local registry 是 cooperative coordination boundary，不是 merge security boundary；external exact-head check 仍必須重新驗證 scope 與 candidate envelope。

可租用資源：

- branch name。
- worktree path。
- tracked path glob。
- shared contract 或 exported symbol。
- isolated runtime offset。
- browser profile。
- integration train generation。

必要欄位：

- resource_key、lease_kind=`writer_seat|task_resource`、lease_id、plan_id、generation、task_id、provider、owner_session、execution_context_id、context_attestation_ref/digest。
- acquired_at、heartbeat_seq、heartbeat_at、expected_registry_sha。
- repo/common-dir digest、worktree id/path digest、branch、scope_digest、state、release_evidence_ref、retention_state。

兩個 session 對同一 resource_key 競爭時，只有 CAS 成功者取得 lease。失敗者重新讀取 registry 後進入 QUEUED_FOR_LEASE，不可覆寫 winner。

任何尚無有效 `release_evidence_ref` 的 `writer_seat` lease 都占用 global seat，不受 `ACTIVE`、`HELD`、`FAILED`、`HANDOFF_READY` 或 `SUSPECT` 等顯示狀態影響；只有 §6.12 的 owner-end CAS transition，或 coordinator 顯式完成的 auditable reclaim 才釋放席次。Writer-seat release 不等於 task-resource release：branch/worktree/scope 轉為 `RETAINED_FOR_REVIEW`，仍阻擋 conflicting writer，直到另行 rebind 或外部 reclaim。第三個 Codex/Claude 任意組合在沒有空席前永遠是 `QUEUED_FOR_LEASE`。

Git blob 只保存 opaque workspace/session IDs、repo-relative resource keys 與 path digests。Absolute worktree path、Windows SID、PID、listener handle 與 process creation identity 只存在 host-local non-secret mapping，不得 push、寫入 PR 或 evidence artifact。Fabric trusted source、registry ref、common-dir identity 或 local mapping 任一不可證明時 fail closed。

### 6.3 candidate-envelope/v1

每個 PR candidate 綁定：

- task_id、branch、PR number。
- exact head SHA、base branch、resolved base SHA。
- scope digest、dependency SHAs。
- checks、review packet、Computer Use evidence refs。
- generation、created_at、invalidated_at、invalidation_reason。

任何 push、rebase、base retarget、parent SHA 改變或 evidence source 不一致，都使舊 envelope 失效。

### 6.4 integration-train/v1

必要欄位：

- train_id、generation、integration_base_ref 與 exact integration_base_sha；`trunk` 必須是 fresh origin/main，managed profile 必須是 registry-pinned branch head。
- ordered candidate heads 與 dependency edges。
- synthetic integration SHA。
- runtime isolation manifest。
- checks、interaction failures、created_at、expires_at。

Integration train 是可丟棄驗證產物，不是 merge authority，也不是部署來源。

### 6.5 provider-session-envelope/v1

每個 top-level writer 綁定：

- plan_id、generation、task_id、provider=`codex|claude`、owner_session、opaque provider_session_id 與 execution_context_id。
- repo/common-dir identity digest、assigned worktree id/path digest、branch、baseline SHA。
- scope digest/resource keys、lease id、heartbeat sequence/state。
- context_attestation_ref/digest、evidence head/refs、handoff id、adapter version。

Opaque session/context ID 只作索引，不能單獨取得 authority。由 prior trusted/base-pinned `ExecutionContextAttestor` 產生的 host-local attestation 至少綁定 attestation id/issuer version、owner session、provider session、execution context、lease、launcher-instance digest、process-creation-lineage digest、repo/common-dir/worktree path digest、branch/head、principal-profile-to-ACL-owner relation verdict、issued/observed/expires timestamps、nonce 與 revocation epoch。Attestation 必須在 provider launch 後產生，並於 start、每次 privileged transition 與 handoff 前重驗 freshness、digest 及一對一 tuple。

Raw SID/PID、完整 process chain、absolute path、ProfileList 與 ACL owner evidence 只留在 host-local non-secret record；Git blob/envelope 只保存 opaque reference、digest 與 `MATCH|MISMATCH|UNKNOWN` verdict。Attestor 只可對已指派的 current context 做 target-scoped read-only probe，不能改 ACL/owner/sandbox、終止程序或掃描 unknown inventory。Forged、replayed、expired、revoked、issuer drift、launcher lineage mismatch、owner mismatch 或 host-local record 遺失一律在任何 writer side effect 前進入 `HELD_EXECUTION_CONTEXT`。

Tuple 的任一欄位重複、未知或不一致時 fail closed。Envelope 不包含 raw SID/PID、完整 absolute path、token、cookie、環境值或 transcript。

### 6.6 managed-branch/v1

v1 支援兩種顯式 branch profile：

- `trunk`：所有 task 從 fresh `origin/main` 建立短生命週期 topic branch，為預設。
- `managed_gitflow`：允許 renewable long-lived `develop`，以及按 generation 建立的 `release/*`、`hotfix/*` family；每個 branch 都必須進入 managed registry。

Registry 最少保存 branch class、owner、protection profile、base ref/SHA、generation、scope、allowed merge targets、created/renewed/expires timestamps 與 current head。Branch drift、保護設定不符、owner 不明或到期時狀態為 `FROZEN/REBASE_REQUIRED`，不得 admission、promotion 或 deployment；expiry 只凍結，不自動刪除。`develop`、`release/*`、`hotfix/*` 都只是協作或穩定化基底，不是 canonical deploy source。

Managed base ref 與 candidate branch 必須分離。Candidate writer 只取得自己的 task branch lease，永遠不能直接 push `develop`、`release/*` 或 `hotfix/*`；managed base 只能由 prior-pinned `ManagedBranchAuthority` 在專用 `managed-base:<ref>` lease 下操作。每個 `renew|advance|rebase` intent 必須保存 operation id、owner authority、action、current generation、expected registry OID、expected base/head、protection snapshot digest、transition sequence、one-time nonce、requested expiry 與 authorized policy bound。

`renew` 只可在 owner、lease、expected head/base、protection snapshot、未過期 grace policy 與 registry CAS 全部成立時延長 expiry；不得同時修改 owner、scope、base、generation 或 Git head。`advance|rebase` 是另一個 operation，必須列舉 candidate lineage、使用 expected remote head 的受保護更新並建立新 generation，使舊 candidate/train/evidence 失效。Owner transfer 不在 v1；需要 transfer 時凍結舊 branch並建立新 managed generation。兩個競爭 operation 只有 CAS winner 可前進；loser 重讀後 HELD/queue，不得覆寫。

Managed branch 上的 candidate 要進入 `origin/main` 時，promotion planner 必須列舉完整 candidate/commit lineage，並在 dispatch 前選擇且凍結一種路徑：

- 將每個 candidate rebase/retarget 到 fresh `origin/main`，建立新 generation，逐一走 ordinary single-PR gates。
- 只有 candidate 形成同 repository、fully linear、contiguous lowest-unmerged prefix，且 §6.7 全部 gate 成立時，才走 `direct_stack`。

未列舉 included commits 的 generic `develop|release|hotfix → main` bulk PR、octopus merge 或 branch-level deployment 一律在 mutation 前拒絕。

### 6.7 stack-delivery-envelope/v1

`direct_stack` 只接受同 repository、fully linear、contiguous lowest-unmerged prefix；selected top PR 的 async request 固定使用 `merge_action=direct_merge` 與 `merge_method=merge`。Pre-dispatch immutable request packet 至少包含：

- stack_id、trunk_ref、trunk_sha、selected_top_pr、ordered_member_vector_digest。
- members：PR number/node id、position、head ref/SHA、direct base ref/SHA、exact-head packet digest。
- 每個 member 的 checks、independent review、E2E requirement/result 與 unresolved finding state。
- expected protection/capability snapshot 與 deployment target/profile reference。

Append-only outcome record 保存 async operation UUID、poll history、terminal status、每個 member 的 `merged` observation、frozen head SHA 與 optional GitHub-reported merge-commit SHA、`stack_result_merge_commit_sha`、group verification result 與 repair/revert lineage；任何 observation 不得反向改寫 request packet。

Dispatch 前重新讀取完整 vector、PR heads/bases、branch protection、required CheckRun source、review/E2E packet 與 unresolved review-conversation state。API request 對 selected top PR 傳入 exact top head SHA。Response/poll 必須依下表處理：

| GitHub observation | Fabric internal action | External closed projection |
|---|---|---|
| `202` + UUID | Append request UUID，進入 `MERGE_ASYNC_DISPATCHED`，在官方 24 小時 result-retention window 內 polling；不部署 | 尚未 terminal |
| `200 already merged/queued` | 只有 existing operation reference 或完整 terminal vector reconciliation 能證明相同 request 才可 adopt；否則 reconcile | 無法證明時 `CLOSED/HELD/MERGE_OUTCOME_UNVERIFIED` |
| `409` existing request | 只在 UUID/request/vector 完全相同時 adopt 並 poll；否則不得 retry | `CLOSED/HELD/MERGE_OUTCOME_UNVERIFIED` |
| `400/422` 且 authoritative reread 證明零 member merged | 不部署；保存 sanitized failure，必須新 generation 才可 retry 或改 ordinary | deterministic evidence error 為 `CLOSED/HELD/PREMERGE_EVIDENCE_INVALID`；其他 authority uncertainty 為 `CLOSED/HELD/PREMERGE_AUTHORITY_UNAVAILABLE` |
| `403/404` before accepted operation，且 authoritative reread 證明零 member merged | 不部署、不猜測、不換 credential | `CLOSED/HELD/PREMERGE_AUTHORITY_UNAVAILABLE` |
| Poll terminal failed，且 authoritative reread 證明零 member merged | 不部署；依 GitHub failure reason 新 generation 修復 | rule/settings drift 為 `CLOSED/HELD/POLICY_OR_SETTINGS_DRIFT`，其他只可用 canonical closed reason |
| Poll timeout、404/expiry、partial/ambiguous result 或無法證明零/全員 merged | 不部署、不 retry merge；進入 reconciliation | `CLOSED/HELD/MERGE_OUTCOME_UNVERIFIED` |
| Poll terminal success + complete vector/ancestry proof | 進入 `MERGED_PENDING_DEPLOY` | deployment 後才可 terminal |

GitHub 官方 `merge_method=merge` 對整個 stack group 建立一個 merge commit；因此不能要求每個 PR 有不同 merge commit。Terminal success 必須逐 member 證明 PR 已 merged，且 frozen member head 都可達單一 `stack_result_merge_commit_sha`；optional per-PR reported merge SHA 可缺省或全部等於 final group SHA，只能作冗餘 observation。最後再證明 `stack_result_merge_commit_sha = fresh origin/main`，才可進入 deployment。

每個 external `delivery_id/attempt_id` 只能 append-only close 一次；response failure、reconciliation、retry、改 ordinary 或 repair/revert 都必須建立新 attempt，並以 `supersedes_attempt_id` 連回舊 attempt，不得改寫舊 terminal record。

每個 member 保有自己的 exact-SHA check/review/E2E packet，但 delivery terminal state 以 group barrier 發布：在 group deployment 與 post-deploy verification 全部成功前，沒有任何 member 可標 `DELIVERED`。GitHub stack merge 成功但部署失敗時，Fabric internal observation 是 `STACK_DELIVERY_FAILED`，external closed projection 是 `CLOSED/FAILED/MERGED_NOT_DELIVERED`；保留已發生的 merge fact、凍結新 admission，並以新的 exact-head repair/revert PR lineage補償，禁止把 revert 稱為物理 rollback 成功。

### 6.8 execution-envelope/v1

Execution envelope 由 prior trusted/base-pinned coordinator 根據使用者明確 outcome/authority 建立，對 plan generation immutable。必要欄位：

- envelope id、schema/version、plan id、generation、task id、owner session、provider/session/context 與 context-attestation digest。
- issuer control-plane identity/version、opaque explicit-authority reference/digest、issued/expires timestamps、revocation epoch 與 one-time command nonce。
- authorized highest level、current level、transition sequence、expected previous envelope OID 與 expected lease-registry OID。
- repo/common-dir/worktree/branch/baseline/head/scope/lease binding、allowed remote/repository/base、expected remote ref/SHA、promotion mode 與 external capability reference。

Envelope 最新指標以 expected-old-OID CAS 更新；每個 transition record 綁定 `from_level → next_level`、command id/nonce、side-effect intent digest 與 result。只有 control-plane mutation port 能 issue、renew、revoke 或提高 highest level；writer 只能消費一次已核發 transition。Expired、revoked、stale OID/generation、nonce replay、非相鄰跳級、owner/context/attestation drift 或 writer 自製／升級 envelope，全部在 file/network side effect 前拒絕。

Side-effect taxonomy 必須由 command spy 機械分類：

- `CONTROL_METADATA`：只限 immutable `delivery-plan/v1` blob、單一 `refs/ai-bim/delivery-plans` latest-index CAS，以及嵌入同一 plan blob/index 的 plan-only execution-envelope/audit record；禁止額外 local ref、lease、board、branch/worktree 或 remote ref。
- `CANDIDATE_FILESYSTEM`：candidate worktree file、index、commit、branch/worktree creation。
- `REMOTE_GIT_GITHUB`：fetch/push、PR、CheckRun、review、merge 或其他 network write。
- `HOST_RUNTIME_SECURITY`：process/listener/runtime、sandbox/install、ACL/owner/account/firewall。
- `EXTERNAL_ENVIRONMENT`：deployment target、production、secret broker 或 GitHub App/protection mutation。

`plan_only` 只允許上述 `CONTROL_METADATA` allowlist；它不是「整個 process 零位元寫入」，而是零 candidate-filesystem、lease、board、remote、host-runtime/security 與 external-environment mutation。任何未分類 side effect 一律視為 forbidden。

支援依序包含的最高權限級別：

1. `plan_only`：只產生/保存 allowlisted immutable plan preview 與 plan-only envelope/audit metadata；不建立 lease、branch、worktree、session、PR 或 network call。
2. `implement_local`：建立已指派 top-level task/worktree，僅在 scope lease 內修改與驗證。
3. `push_owned_branch`：只可 push 自己的 branch，先核對 expected remote SHA；rewrite 只可 explicit `force-with-lease`，禁止裸 force、main 或他人 branch。
4. `open_draft_pr`：只對 envelope 綁定的 candidate 開 draft PR，PR head/base/scope 必須與 candidate packet一致。
5. `submit_delivery`：完成獨立 review、E2E、train 與 drift recheck 後，只把 single-PR 或 direct-stack packet交給既有 external delivery authority。

同一 envelope 可讓 agent 在 gates 成功後無需逐步人類點擊而自動前進到已授權最高級別；它不能新增 scope、改 branch profile、提高 writer cap、取得 candidate merge credential、自我批准、直接 merge 或 deploy。任何 generation/head/base/scope/evidence/authority drift 立即使 envelope 失效並回到 `HELD`。

### 6.9 merge-queue-observation/v1

Merge Queue 在 v1 是 observe-only adapter：保存帶 `snapshot_generation`、`observed_at/expires_at` 與 source digest 的非權威 queue snapshot，內容含 eligibility probe、merge_group SHA、member PR/head vector、queue position 與 group-SHA checks，驗證 `merge_group` evidence 不會冒充 PR-head evidence。Merge group 被移除、eject、重建或 member vector/SHAs 改變時，舊 snapshot 立即失效，不得作 membership、PR-head 或 delivery evidence。Adapter 沒有 enqueue/dequeue、branch-protection、merge 或 deploy write authority，也不能發布 `DELIVERED`。Repository 不符合資格或 workflow 缺少必要 `merge_group` contract 時回傳 `HELD_QUEUE_CAPABILITY`；ordinary/direct-stack path 不得把 queue observation 當作通過證據。

### 6.10 external-authority-handoff/v1

Production、deployment target、secret broker 與 GitHub App activation 在 v1 以受限 handoff 納入：Fabric 可讀取非機密 capability/provenance/config fingerprint，執行 schema/source/protection dry-run validation，並產生綁定 plan/generation/head/target-profile 的 sanitized handoff packet。Fabric 不保存或轉送 secret/token，也不修改 target、broker、App installation、branch protection或 production；只有既有 external authority 可執行 mutation並回傳 source-pinned machine evidence。Authority 不可證明時保持 `HELD_NOT_IN_SCOPE`，不得由 Fabric 將其改寫為 READY。

### 6.11 reclaim-intent/v1

Unknown process/worktree 以外部 inventory attestation、quarantine 與 reclaim intent 納入，不以 automatic cleanup 納入。Prior-pinned、read-only `HostInventoryAuthority` 位於 Fabric adapter 外部，只對明確 host/repo boundary 產生 source-pinned、digest-addressed host-local attestation；Fabric adapter 本身不 scan process/listener、不中止程序，也不列舉未知 target 作 authority。Fabric 只消費 sanitized attestation reference：issuer/version、observed/expires timestamps、nonce、opaque target/type/digest、owner-proof status、lease/runtime correlation 與 revocation epoch；raw PID/SID/path/process evidence 留在 host-local authority。

Stale heartbeat 只產生 `SUSPECT`。只有 attestation 新鮮有效、明確 owner-end evidence、exact target identity、無 live lease/runtime、預期 registry OID 與 coordinator CAS 決策全數成立時，Fabric 才可產生 auditable sanitized reclaim handoff；真正 reclaim 仍屬 Fabric 外部、另行授權的 cleanup authority。v1 Fabric 自身不 kill PID、不 delete/prune branch/worktree、不改 ACL；unknown/stale/malformed/issuer-drift inventory 維持 `UNKNOWN/HELD` 且零 reclaim side effect，其他無衝突 writer 可繼續。

### 6.12 lease-release/v1

正常 release 與 destructive reclaim 完全分離。Writer 只能提交 `END_REQUEST`；prior trusted/base-pinned `OwnerEndAttestor` 從 Codex App top-level task terminal event 或 Claude launcher exit 取得 target-scoped、read-only owner-end evidence，writer、provider hook、board 或 candidate source 都不能自行簽發。若 provider 沒有可驗證 terminal event，保持 `SUSPECT`。

Release record 至少包含 release id、plan/generation/task、lease id/kind、owner/provider/session/context、final heartbeat sequence、final head/scope/worktree digest、handoff/candidate reference、release reason=`handoff|failed|aborted`、owner-end attestation ref/digest、attestor issuer/version、observed/expires timestamps、one-time nonce、revocation epoch、expected registry OID、expected envelope OID/transition sequence 與 retained resource keys。

Control-plane 只有在 owner-end attestation 新鮮且未重播、execution envelope 已以 CAS revoke、沒有 in-flight command、tuple/head/scope 未漂移、release reason 有 immutable evidence，並且 expected registry OID 仍相等時，才可將 `writer_seat: ACTIVE → RELEASING → RELEASED` 以單次 transaction commit。Duplicate/self-issued/replayed/expired/issuer drift/wrong owner/context/head、兩個 competing release 或 stale OID 全部 fail closed；只有一個 CAS winner。

`RELEASED` 只釋放 global writer seat，第三個 disjoint writer 才可 admission。Branch/worktree/scope task resources 同時轉為 `RETAINED_FOR_REVIEW`，不 delete/prune、不讓衝突 writer 接手；後續 rebind 需新 execution envelope 與 CAS，後續 reclaim 仍走 §6.11 的外部 authority。

## 7. Admission 與 scope ownership

### 7.1 Admission rule

Coordinator 在建立 writer 前先把 outcome 分成 task DAG，並依下列規則分類：

| 情況 | 決策 |
|---|---|
| 不同 service、檔案與 contract，無依賴 | global 兩席內直接平行；第三個 task 排隊 |
| 共用一個小 contract，之後可扇出 | 先建立 root contract PR；child 可在自己的 worktree 預作不碰 contract 的部分 |
| 線性依賴 | 建立 ordinary base-chained PR；符合 §6.7 與 §8.5.2 全部 gate 時可宣告 `direct_stack` |
| 同一檔案、同一 symbol 或同一 schema migration | 排隊給同一 writer，或重新切分 |
| 依賴共享 mutable runtime | 程式碼可平行，runtime lease 序列化 |
| 執行中 scope 超出 lease | HELD_SCOPE_DRIFT，禁止自動擴權 |

### 7.2 Scope digest

Scope 不只列檔案，也包含：

- owning service 與 public entrypoint。
- tracked path patterns。
- shared/exported symbols。
- API、schema、event、migration 與 deployment boundary。
- expected tests 和 E2E route。

Writer 每次準備 commit、push 或 handoff 前重新計算 changed paths 與 declared scope。新增未宣告 shared contract 時，candidate 進入 HELD_SCOPE_DRIFT；coordinator 必須重新分 DAG 或建立新 generation。

Overlap predicate 必須 deterministic：

- 所有 path 先正規化為 repository-relative、分隔符為 slash、拒絕 parent traversal；Windows 比對不分大小寫。
- Rename 同時占用 old path 與 new path；新增檔占用其 canonical parent scope。
- Glob 必須轉成 canonical matcher 後計算交集；無法證明 disjoint 就視為 overlap。
- Shared contract、schema、event、migration、runtime 與 exported symbol 使用明確 resource ID；任何相同 ID 都 overlap。
- Changed-path evidence 使用 NUL-safe Git output，不能以 newline parsing 決定安全邊界。

Admission、commit 與 push 前都以相同 predicate 重驗。無法判定時進入 QUEUED_FOR_LEASE 或 HELD_SCOPE_DRIFT，不得樂觀平行。

### 7.3 Lease lifecycle

狀態：

ACQUIRING → ACTIVE → RELEASING → RELEASED

這條主線只適用 `writer_seat` lease；`task_resource` 在 writer seat release 時轉為 `RETAINED_FOR_REVIEW`，不視為可重新核發。只有 §6.12 的 control-plane CAS 能進入 `RELEASING/RELEASED`。

旁路狀態：

- SUSPECT：heartbeat 超時或 session 不可達。
- HELD_CONFLICT：machine truth 與 registry 不一致。
- HELD_SCOPE_DRIFT：變更超出 scope。
- HELD_EXECUTION_CONTEXT：實際 writer context 無法證明 Git ownership/repository trust。
- HELD_EXECUTION_AUTHORITY：execution envelope 或 release authority 不可證明。
- HELD_PROVIDER_CONFIGURATION：Claude/Codex provider configuration 與 pinned adapter policy 不符。
- HELD_TOPOLOGY_UNSUPPORTED：不在同一 verified common-dir 或要求 multi-host coordination。

Heartbeat timeout 只把 lease 標成 SUSPECT。系統不得因此自動刪 worktree、刪 branch、kill PID、停止 sandbox.exe 或釋放可能仍被使用的 runtime。正常釋放必須有 §6.12 的 owner-end attestation 與一次性 CAS；不符合 normal release 的工作只能在 coordinator 確認 Git/GitHub 狀態後產生 §6.11 可稽核 reclaim handoff。

## 8. Git branch 與 PR topology

### 8.1 Branch profiles

Plan 必須選擇 `trunk` 或 `managed_gitflow`，不得在執行中隱式切換。`trunk` 的 task 一律從 freshly fetched `origin/main` exact SHA 建立；`managed_gitflow` 可從 registry 內仍有效的 `develop`、`release/*` 或 `hotfix/*` exact SHA 分支，但每個 candidate 仍有獨立 worktree/branch/scope。Promotion 必須依 §6.6 將完整 candidate lineage 轉成 fresh-main ordinary PR，或符合全部 gate 的 `direct_stack`；任何 managed branch 都不可直接部署，也不可用一個未列舉 commits 的 branch-level PR 粗粒度取代逐 candidate attribution。

### 8.2 Independent task

預設 `trunk` profile 的每個 root task 從 freshly fetched origin/main 的 exact SHA 建立 sibling worktree 與短生命週期 branch：

origin/main → task-A PR

origin/main → task-B PR

origin/main → task-C PR

這些 PR 可同時建置、測試及 review。

### 8.3 Linear dependency

依賴鏈使用：

origin/main → PR-A → PR-B → PR-C

PR-B 的 base 是 PR-A branch，PR-C 的 base 是 PR-B branch。Plan 建立時必須選擇：

- `single_pr`：ordinary GitHub base-chained PR，不建立 native stack object，依 §8.5.1 bottom-up promotion。
- `direct_stack`：建立 GitHub native stack object，完整綁定 §6.7 member vector，依 §8.5.2 group promotion。Capability 不可用時必須在任何 stack merge dispatch 前建立新 generation 改回 `single_pr`；不得執行中偷偷切換。

Parent 改變時：

1. Child 進入 REBASE_REQUIRED。
2. writer 對 agent-owned branch rebase。
3. push 前記錄 remote expected SHA。
4. 使用 explicit force-with-lease 更新；禁止裸 force。
5. 產出 range-diff 給 reviewer。
6. 失效舊 exact-SHA checks、review 與 E2E evidence。
7. 重新凍結 candidate。

### 8.4 Fan-out dependency

若一個 root contract 支援多個功能：

origin/main → root-contract

root-contract → feature-A

root-contract → feature-B

root-contract → feature-C

Root 尚未 delivered 前，child PR 保持 draft 並只收集開發證據。Root delivered 後，每個 child 重新以 fresh origin/main 為 base，更新 envelope 並各自進入驗證。

### 8.5 Promotion modes

#### 8.5.1 Ordinary single-PR

Ordinary chain 由底向上，一次只提交一個 PR 給既有 autonomous delivery：

1. PR-A 通過並 delivered。
2. fresh fetch origin/main，確認 deployed lineage。
3. PR-B rebase/retarget 到 fresh main，失效舊證據並重新驗證 exact head。
4. PR-B delivered 後才處理 PR-C。

此模式維持 `pr.head_sha → observed merge commit = fresh origin/main = deployed commit` 的逐 PR scalar attribution。

#### 8.5.2 Direct stack group

只有 active OpenSpec 與 external executor 已啟用 `stack-delivery-envelope/v1` capability，且 §6.7 全部 preconditions 通過時，Promotion Bridge 才接受 native stack packet。Bridge 對 selected top PR 發出一次 async merge request，持續輪詢到 terminal result，再以完整 member reread 與 Git ancestry 證明：

each members[].frozen_head_sha → stack_result_merge_commit_sha = fresh origin/main = deployed commit

Deployment 是 group-attributed single-flight saga；所有 member 在 group deploy/verify 成功後一起取得 `DELIVERED` projection。GitHub merge 完成後不可退回 ordinary sequential mode；deploy 失敗必須保留 `MERGED_NOT_DELIVERED` 事實並進入 repair/revert lineage。這是 v1 唯一允許的 multi-PR batch；任意不相依 PR、非線性 DAG 或跨 repository batch 不得包成同一 transaction。

#### 8.5.3 Merge Queue observation

Merge Queue adapter 只讀取 eligibility、queue state、merge_group SHA 與 checks，用於未來可行性與 evidence-contract canary。它不取代 ordinary/direct-stack delivery，不 enqueue、不 merge、不 deploy，也不能用 merge_group evidence 發布 PR-head 或 delivery success。

禁止：

- 在 `direct_stack` capability/OpenSpec 未啟用時 dispatch native stack merge。
- 把 `202 Accepted`、top PR SHA 或 ancestor containment當成完整 stack merge proof。
- 在 async dispatch 後改用 sequential fallback、修改 member vector或部分發布 `DELIVERED`。
- 把任意獨立 PR coalesce 成未綁 per-member merged-state、frozen-head-to-final ancestry 與 final stack-result SHA 的 batch attribution。
- 從 integration train、develop、release 或 hotfix branch 直接合併到 deployment target或部署。

## 9. Throw-away Integration Train

Integration train 的用途是比單一 PR checks 更早發現 candidate 交互作用，不是替代 main 或 managed branch。

流程：

1. 從 `integration-train/v1` 凍結的 `integration_base_ref/SHA` 建立 ephemeral train worktree/branch；`trunk` profile 必須是 fresh `origin/main`，`managed_gitflow` 必須是 registry-pinned managed branch head。
2. 依 DAG 拓樸與穩定 tie-breaker 合併 exact candidate heads。
3. 從 canonical `isolated_runtime_offset[0..4]` domain 取得第三個 v1 admission slot；若 Computer Use 正在使用就排隊。
4. 使用 canonical isolated runtime manifest 分配 port、state directory、artifact root 與 process ownership。
5. 執行跨 candidate integration checks。
6. 將結果綁定 train generation 與 candidate SHAs。
7. train head 漂移、candidate push 或 baseline 更新時，舊 train evidence 立即失效。
8. train 只在確定 clean、session-owned 且沒有 live runtime lease 後才可刪除。

Failure isolation：

- 單一 candidate 自身測試失敗：只 HELD 該 candidate。
- A 與 B 組合才失敗：標記 dependency edge A↔B，兩者暫停 promotion；其他無關 candidate 可繼續。
- train infrastructure 失敗：標記 HELD_INFRA，不能把 candidate 判為 failed。
- 連續兩輪相同 infrastructure failure：停止重試並交付具體證據，不進入無限 repair loop。

## 10. CI concurrency

### 10.1 可平行

- lint、typecheck、affected unit tests。
- per-PR contract checks。
- read-only review agent。
- 不使用 shared runtime 的 integration tests。

Concurrency group 必須至少包含 workflow identity、PR number 與 verification class。只允許取消同一 PR 舊 generation 的 stale job，不得因另一個 PR 啟動而取消仍有效的 job。

### 10.2 必須排隊

- 共用 GPU / Kit / WebRTC runtime。
- 真實 Computer Use browser profile。
- integration train generation。
- canonical Linux deployment。

這些 group 使用 queue semantics；不得設定跨 candidate 的 cancel-in-progress。新工作等待資源，不取消已開始且仍有效的驗證。

Shared-resource group 必須使用 `queue: max`，並省略 `cancel-in-progress` 或明確設為 `false`；禁止 `queue: max` + `cancel-in-progress: true`。Group key 至少包含 workflow identity 與 resource identity，不接受 candidate input。Fabric durable registry 保存 candidate/run/lease mapping 與 machine-truth reconcile，但不重新發明 GitHub queue ordering。GitHub 最多保留 100 個 pending；第 101 個被取消時必須以 exact run/candidate/lease mapping fail closed，不得留下假 pending、pass 或 delivery。若 workflow syntax、repository plan/runtime 或 mapping evidence 不支援此 contract，shared-resource job 進入 `HELD_QUEUE_CAPABILITY`，不得退回 default pending replacement。

### 10.3 證據分層

- PR-head evidence：綁 exact candidate head SHA。
- PR-head E2E evidence：另綁 shared manifest physical-path equality result/path digest、manifest digest、stack kind、resolved ports/base URLs、exact HEAD equality、trusted verifier/binder pins、runtime identity attestation、reserved-port guard 與 command records；raw absolute path 只留 host-local attestation。
- Train evidence：綁 synthetic integration SHA 與完整 ordered input SHAs。
- 未來 merge-group evidence：綁 merge_group SHA，不得冒充 PR-head evidence。
- Delivery evidence：由既有 autonomous-linux-delivery 綁 observed merge commit、fresh origin/main 與 deployed commit。

## 11. Independent Computer Use E2E

Computer Use verifier 是獨立驗證角色，與 writer、canonical Playwright runner 及 evidence binder 分離；它沒有 source、PR、approval、merge 或 deploy 寫入權。Computer Use 是真實 UI 操作證據，不得取代 canonical require-real Playwright。

觸發條件：

- user-facing route、workflow 或 UI behavior 變更。
- shared browser/runtime interaction 變更。
- repo policy 明確要求 E2E。

每個 writer 在 `CANDIDATE_FROZEN` 前都必須產生 E2E applicability record；符合任一觸發條件時 `e2e_required=true`，且每次新的 exact-head candidate handoff 都必須重新執行 canonical require-real Playwright 與獨立 Computer Use 真實操作。只有明確不涉及上述路徑的 docs/static-only candidate 才可記錄 `e2e_required=false` 與 machine-checkable reason；writer 不能自行把 required E2E 改成 optional。

### 11.1 Shared canonical E2E stack

Computer Use 與 canonical E2E_REQUIRE_REAL=1 Playwright 必須使用同一個 E2E_STACK_MANIFEST 實體檔案及同一 exact candidate：

- 兩者使用 physical/real path 相同的 absolute manifest path。
- 服務啟動前計算 manifest bytes SHA-256，並以 manifest_sha256 寫入兩份 evidence、binder 與 candidate envelope；publication 前重新計算，不一致即 HELD_MANIFEST_DRIFT。
- manifest schema_version 必須是 isolated-branch-stack/v1，stack_kind 必須是 isolated_branch_stack。
- manifest head_sha、candidate envelope head SHA 與 candidate worktree 的 Git HEAD 在 verifier start、Playwright start 與 publication 前都必須相等。
- Manifest ports 與 base URLs 是唯一 authority；environment override 若存在必須 byte-equivalent。
- Browser 只經 manifest coordinator base 進入；不得直接連 governance internal port、其他 loopback service 或 canonical deployment。

Computer Use 不得建立第二份 manifest、改寫 manifest、選替代 offset，或使用另一個 worktree/canonical deployment 的畫面冒充 candidate evidence。

### 11.2 Reserved-port 與 runtime identity preflight

在 listener 查詢、cleanup 或服務啟動前，trusted verifier 必須：

1. 驗證 offset 是 0..4 的整數。
2. 計算 manifest resolved port set。
3. 驗證它與 canonical reserved-port set 不相交。
4. 驗證 stack kind、ports/base URLs、worktree identity、manifest identity 與 HEAD equality。

任一 conflict/mismatch 必須在任何 process mutation 前回傳具體 HELD reason；不得啟動服務、停止 listener、執行 cleanup 或開始 browser。Playwright request/WebSocket guard 在執行期間監控 HTTP、HTTPS、WS、WSS；任何 reserved port 或非 manifest coordinator authority request 都使 run 失敗。

Coordinator health 成功後及 evidence publication 前各取得一次 live identity snapshot，驗證 manifest 記錄的 service role、PID、精確 launcher entrypoint、executable、safe command digest、process creation identity、listener owner、parent lineage 與第二次查詢一致。PID reuse、listener replacement、lineage 不連續、查詢失敗或雙快照不一致都回傳 HELD_RUNTIME_OWNERSHIP，不執行 browser spec，也不產生成功 evidence。

### 11.3 Trusted verifier 與 binder source

Verifier、canonical Playwright config/global setup、manifest validator、reserved-port guard、evidence binder 與 result classifier 必須從 prior trusted/base-pinned immutable SHA 的 clean worktree 執行，不得從 candidate head 動態載入。

Evidence packet 記錄 trusted verifier ref/SHA、verifier tree digest、binder digest、canonical harness file-set digest、candidate_harness_status 與 verification_mode。Candidate 自帶的 runner、config、fixture loader、evidence writer 或 classifier 只能作診斷。

Canonical harness file set 至少涵蓋 Playwright configs、web-viewer-sample/e2e、e2e/support、isolated-stack launcher、seed helper 及 canonical contract 列出的 verifier/binder。Candidate 若修改任何 harness 檔案：

- candidate_harness_status = modified。
- verification_mode = shadow。
- 該 evidence 不得進入 READY_FOR_TRAIN、READY_FOR_PROMOTION 或 autonomous delivery input。
- 新 harness 只有通過獨立 trust canary 並成為新的 base-pinned trusted source 後，才能產出 promotion-eligible evidence。

### 11.4 Evidence binding 與 command records

Evidence binder 必須驗證 canonical Playwright packet 與 Computer Use packet 具有：

- 相同 exact head、physical manifest path、manifest_sha256、stack kind、ports/base URLs。
- 相同 trusted verifier/binder pins 與 runtime identity attestation。
- E2E_REQUIRE_REAL=1、reserved-port guard 無違規、require-real 未以 skip 取代 hard failure。
- 相同 worktree identity、execution window 與可回溯 command records。

任一欄位不一致回傳 HELD_EVIDENCE_BINDING。Computer Use 通過但 canonical require-real Playwright 缺失、失敗、來源未 pin 或 manifest 不一致時，不得宣稱 E2E 通過。

每筆 command record 至少包含 role、resolved cwd、exact argv 或 safe digest、safe environment contract、開始/結束時間、exit code、stdout/stderr artifact reference 與 redaction status。必要 roles 是 git_preflight、stack_start、stack_status、playwright_require_real、computer_use、postflight。Stack lifecycle 只用 repo-owned canonical entrypoint；viewer lifecycle 由 canonical Playwright webServer 擁有。

Durable evidence 只保存 process/listener identity status、role、creation-identity digest、listener-lineage digest 與 host-local attestation reference。Raw PID、完整 command line、Windows SID、listener handle 等 host identity 留在受控 host-local attestation，不寫 Git blob、PR body或公開 artifact。

### 11.5 Head drift、停止與 failure isolation

Candidate push、parent rebase、base retarget、manifest bytes、trusted source pin、runtime identity 或 command/environment contract 任一改變，都使 Playwright 與 Computer Use evidence 立即失效。

Computer Use、manifest、runtime ownership、binder 或 Playwright failure 只凍結該 candidate，標記 HELD_E2E 或 HELD_EVIDENCE_BINDING；其他無依賴 writer 繼續。結束時只停止能以 exact handle、launcher lineage 與雙快照 creation identity 證明 owner 的 runtime。

Computer Use 不得：

- 代替 unit、contract 或 integration tests。
- 在畫面上批准或合併自己的 candidate。
- 操作 sandbox.exe、ACL、Windows owner、firewall 或 Codex installation。

## 12. Authority separation

| Role | 可做 | 不可做 |
|---|---|---|
| Coordinator | 分 DAG、在使用者 authority 內核發 execution envelope、reconcile、決定重新切分 | 自我滿足獨立 review、擴張原授權、繞過 delivery authority |
| Codex／Claude writer | 在自己 worktree/scope 與 execution envelope 內實作、測試、推送自己的 branch、開 draft PR | 修改他人 branch、擴大 scope、自我批准、直接合併／部署、持有 merge credential |
| ExecutionContextAttestor | 對已指派 current context 做 source-pinned、target-scoped read-only identity/owner/launcher attestation | 寫 source/GitHub、掃描 unknown inventory、改 ACL/owner/sandbox、kill process |
| OwnerEndAttestor | 以 provider terminal event/launcher exit 與 revoked envelope 產生 owner-end attestation | 接受 writer self-assertion、核發 lease、release resource retention、kill process 或 cleanup |
| ManagedBranchAuthority | 以 managed-base lease、expected head 與 registry CAS renew/advance/rebase 指定 managed base | 寫 candidate code、push main、直接部署、替 writer 擴權或 cleanup |
| HostInventoryAuthority | 對明確 host/repo boundary 產生唯讀、host-local inventory attestation | 核發 lease/pass、執行 reclaim、kill/delete/prune、把 unknown 判為 safe |
| Codex reviewer | 對 exact candidate 執行唯讀分析、產出 findings 與非權威 review packet | source/GitHub 寫入、approval-equivalent verdict、required-check publication、merge |
| Computer Use verifier | 真實 UI 操作與 evidence packet | source/GitHub 寫入、approval-equivalent verdict、merge |
| External machine check App | 以固定 App source 對 exact head SHA 發出 required CheckRun；僅該成功 CheckRun 在既有 OpenSpec activation 後具 approval-equivalent gate 語意 | 使用 candidate credential、修改 branch、merge |
| External delivery executor | 依既有 OpenSpec 執行 single-PR 或 activated direct-stack merge→deploy→verify | 接受未凍結、任意 batch、來源不明或 attribution 不完整 candidate |
| Merge Queue observer | 讀取 eligibility、merge_group 與 queue evidence | enqueue/dequeue、merge、deploy、發布 delivery success |
| Board projection | 顯示 session/task/lease snapshot | 核發 lease、判定 pass、kill process、回收 worktree |

monkey1sai Codex reviewer 的角色是獨立、無寫入權的審查計算者；Codex 或 Claude candidate 的 self-review 只能標為 advisory。任何 review packet 本身都不構成 GitHub approval，也不能解除 branch protection。自治審批的唯一 approval-equivalent gate 是 External machine check App 對同一 exact head 發出的 source-pinned required CheckRun；其 activation、來源驗證與 merge authority 仍完全由 autonomous-linux-delivery OpenSpec 擁有。

Promotion Bridge 只接受下列已由 live machine truth 證明的 external target：

- 固定名稱的 exact-head required check 綁定預期 GitHub App source；不同 App、commit status、neutral、skipped、timeout 或 incomplete evidence 均不能等同 success。
- Reviewer execution identity 與 writer/fixer 分離；publisher 只有 read/check publication 所需權限，沒有 contents write 或 merge 權。
- Branch protection 不再要求 monkey1sai-blip counted review、CODEOWNER approval 或任何逐 PR human vote；也不要求 PR author monkey1sai 自我批准。
- 遷移採 add-before-remove：新 App check 先 shadow、再與 legacy counted-review gate 雙閘門 canary，證明 rollback 後才把 required approvals 調為零並 retire monkey1sai-blip broker。
- Merge adapter 在每次 mutation 前重新讀取 exact head、required check source、unresolved findings 與 protection snapshot。

以上 activation sequence 仍由既有 autonomous-linux-delivery OpenSpec 擁有；本文件只把它定義為 Promotion Bridge 的必要輸入，避免多 session layer 偷渡第二套 approval path。

## 13. State machine

~~~mermaid
stateDiagram-v2
    [*] --> PLANNED
    PLANNED --> PREFLIGHTING
    PREFLIGHTING --> QUEUED_FOR_LEASE: cap/full or conflict
    PREFLIGHTING --> ADMITTED: tuple and lease valid
    QUEUED_FOR_LEASE --> PREFLIGHTING: admission retry
    ADMITTED --> BUILDING
    BUILDING --> PR_OPEN
    PR_OPEN --> CANDIDATE_FROZEN
    CANDIDATE_FROZEN --> REVIEWING
    REVIEWING --> E2E: e2e_required
    REVIEWING --> READY_FOR_TRAIN: no_e2e
    E2E --> READY_FOR_TRAIN
    READY_FOR_TRAIN --> TRAIN_VALIDATING
    TRAIN_VALIDATING --> READY_FOR_PROMOTION
    READY_FOR_PROMOTION --> SUBMITTED_TO_DELIVERY
    SUBMITTED_TO_DELIVERY --> CLOSED: external DELIVERED or FAILED or HELD

    BUILDING --> HELD_SCOPE_DRIFT
    BUILDING --> FAILED
    PREFLIGHTING --> HELD_EXECUTION_CONTEXT
    PREFLIGHTING --> HELD_EXECUTION_AUTHORITY
    PREFLIGHTING --> HELD_CONFLICT
    REVIEWING --> FINDINGS
    E2E --> HELD_E2E
    TRAIN_VALIDATING --> HELD_INTERACTION
    CANDIDATE_FROZEN --> REBASE_REQUIRED
    ADMITTED --> SUSPECT
~~~

Provider session 的 `SUSPECT` 不會自動回到 `ADMITTED`；只有 explicit `RESUME_INTENT` 與 CAS rebind 能恢復。未知 transition 一律 fail closed。

`direct_stack` 另有不可逆邊界：

~~~mermaid
stateDiagram-v2
    [*] --> STACK_PREPARED
    STACK_PREPARED --> MERGE_ASYNC_DISPATCHED
    MERGE_ASYNC_DISPATCHED --> MERGE_OUTCOME_VERIFIED
    MERGE_OUTCOME_VERIFIED --> MERGED_PENDING_DEPLOY
    MERGED_PENDING_DEPLOY --> DEPLOYING
    DEPLOYING --> STACK_CLOSED: external DELIVERED

    STACK_PREPARED --> STACK_CLOSED: external HELD premerge
    MERGE_ASYNC_DISPATCHED --> STACK_RECONCILING
    STACK_RECONCILING --> STACK_CLOSED: external HELD outcome unknown
    DEPLOYING --> STACK_CLOSED: external FAILED after merge
~~~

`STACK_*` 名稱只屬 Fabric internal observation，不得寫入 external terminal-class。Active autonomous-linux-delivery 的 external record 仍只允許 `phase=CLOSED` 與 `terminal_class=DELIVERED|FAILED|HELD`，reason 必須來自其 closed enum。必要投影至少為：

- outcome 無法證明：`CLOSED/HELD/MERGE_OUTCOME_UNVERIFIED`。
- 已 merge 但 deploy/verify 失敗：`CLOSED/FAILED/MERGED_NOT_DELIVERED`。
- group deploy/verify 全通過：`CLOSED/DELIVERED/DELIVERY_VERIFIED`。

其他 premerge response 只能依 §6.7 投影為既有 `PREMERGE_EVIDENCE_INVALID|PREMERGE_AUTHORITY_UNAVAILABLE|POLICY_OR_SETTINGS_DRIFT` reason；任何新 reason 必須先走 OpenSpec delta。`MERGE_ASYNC_DISPATCHED` 後不得改 member vector、切換 sequential fallback 或宣稱 rollback。`SUBMITTED_TO_DELIVERY` 之後的 authority、reason、terminal result 與 repair lineage由修訂後的 autonomous-linux-delivery OpenSpec 管理；Fabric 只保存 external transaction reference 與結果投影。

## 14. Board 與 sandbox-safe recovery

現行 `.agents/board` 只能視為 best-effort projection，不能當 lease 或 authority。現有 `register`、`done`、SessionStart/Stop/End hooks 與 Codex notify 會進入 lifecycle maintenance；`update` 只寫 legacy projection、不呼叫 maintenance，但仍沒有 lease/authority 語意。v1 adapter 因此禁止呼叫全部 legacy board writes；唯一允許的 legacy board 讀取是 exact `status --json --no-prune`。

若 v1 實作 board projection writer，必須新增與 legacy lifecycle 完全分離的 projection-only CAS/atomic path，並符合：

- 只從 durable plan/lease refs、provider envelopes 與 GitHub state 重建 projection。
- 不呼叫 lifecycle maintenance、orphan cleanup、detached launcher、process/listener scan、runtime stop 或 Git worktree prune。
- stale/unknown heartbeat 只投影 `SUSPECT`，不回收 lease、process、branch 或 worktree。
- projection read/write/loss/malformed 只產生 `PROJECTION_DEGRADED`；不得放寬 global cap、scope、identity 或 evidence gate。
- board 與 Fabric admission/reconcile/drain 不得隱含呼叫任何 cleanup 工具。

Orchestration 必須存在 provider-neutral durable state，不存在 Codex App 或 Claude CLI parent process。App/CLI crash 或 sandbox.exe 重啟後，新 coordinator 執行 reconcile 即可恢復：

1. 讀 plan generation 與 lease registry。
2. 比對 worktree、branch、remote ref、PR head 與 checks。
3. 把無 owner heartbeat 但仍有 Git evidence 的工作標成 SUSPECT。
4. 要求顯式 `RESUME_INTENT` 或 reclaim；無法證明舊 context 結束時維持 `SUSPECT` 並占用席次。
5. 只有 owner-end evidence、exact tuple/head/scope 重驗與 CAS 成功後才 rebind/release；不自動刪除或終止。

禁止以重裝 Codex App、終止 sandbox.exe、設定 global safe.directory、改 ACL/owner 或清空所有 worktree 作為正常 recovery。

## 15. Failure 與 rollback

| Failure | 局部結果 | Recovery |
|---|---|---|
| 兩 session 同時搶同一 lease | 一個 CAS winner；另一個 QUEUED_FOR_LEASE | loser refresh registry |
| 不同 common-dir / multi-host | HELD_TOPOLOGY_UNSUPPORTED | 不跨 host 協調；另案設計 |
| Writer Git ownership/context mismatch | HELD_EXECUTION_CONTEXT | 保留 worktree；不用 safe.directory/ACL/重裝 |
| Writer scope drift | HELD_SCOPE_DRIFT | coordinator 分新 task/generation |
| Session crash | lease SUSPECT | reconcile Git/GitHub；顯式 reclaim |
| Parent PR 更新 | child REBASE_REQUIRED；舊證據失效 | rebase、explicit lease push、range-diff、重驗 |
| Direct-stack capability/OpenSpec 未啟用 | Fabric HELD；external `CLOSED/HELD/PREMERGE_AUTHORITY_UNAVAILABLE` | dispatch 前可建立新 generation 改用 ordinary chain |
| Stack vector/protection/head drift | Fabric HELD；external `CLOSED/HELD/POLICY_OR_SETTINGS_DRIFT` 或 `CLOSED/HELD/PREMERGE_EVIDENCE_INVALID` | 不 dispatch；重新凍結完整 vector 與全部 member evidence |
| Async response/poll failure | 依 §6.7 response matrix 投影 closed class/reason | authoritative reread；不部署、不盲目 retry、不發明 terminal class |
| Stack merge 成功、deploy 失敗 | internal `STACK_DELIVERY_FAILED`；external `CLOSED/FAILED/MERGED_NOT_DELIVERED` | 凍結 admission；建立新 exact-head repair/revert PR lineage |
| Managed branch drift/expiry | FROZEN/REBASE_REQUIRED | expiry 前由 authority CAS renew；否則建立新 generation/rebase；不自動刪 branch |
| Execution envelope/release stale、replay 或 forged | Fabric internal `HELD_EXECUTION_AUTHORITY` | 在任何 file/network side effect 前拒絕；重新取得新 envelope/attestation |
| Owner end 不可證明 | `SUSPECT`，writer seat 仍占用 | 不 self-release；等待新 terminal attestation 或外部 reclaim |
| Inventory attestation unknown/stale/malformed | UNKNOWN/HELD | 不 scan、不 reclaim；等待外部 inventory authority 的新 attestation |
| Candidate push during train | train evidence invalid | 建立新 train generation |
| Manifest/verifier/runtime binding 失敗 | HELD_E2E / HELD_EVIDENCE_BINDING | 修復後以同 manifest、新證據重驗 |
| Shared runtime busy | queue | 等待 lease；不可取消 owner |
| CI queue capability 不足 | HELD_QUEUE_CAPABILITY | 不退回 default single-pending cancellation |
| Board read/projection failure | PROJECTION_DEGRADED | 從 durable registry 重建；不得回收 lease或放寬 gate |
| Integration interaction fail | HELD_INTERACTION 限候選/依賴邊 | 最小組合重現 |
| Delivery authority HELD | SUBMITTED_TO_DELIVERY 保持外部 HELD | 不繞過；依既有 OpenSpec 修復 |
| Fabric metadata defect | 停止新 admission | 回退 single-writer live policy；保留 branches/worktrees |

Fabric activation rollback 不重寫 Git history：停用新 admission、凍結新 lease、保持既有 worktree/PR，讓每個 owner 在安全點 handoff，live policy 回到 Single Active Writer。若 `direct_stack` 尚未 dispatch，可安全取消 plan；若 GitHub merge 已發生，不能「回滾 transaction」，只能保存 merge fact並以受保護 repair/revert PR 建立新的 exact-head lineage。任何 rollback 都不得批次刪 branch、worktree 或 process。

## 16. Activation phases

### Phase 0 — Governance reconciliation

先調和 Single Active Writer 與 global cap=2 target-state、active autonomous delivery OpenSpec 的 stale self-referential closure、monkey1sai autonomous machine-check gate，以及 `single_pr|direct_stack` promotion contract。未完成前本文件只有設計效力，所有 writer/stack/GitHub mutation保持 shadow/HELD。

### Phase 1 — Provider-neutral shadow registry and no-cleanup boundary

Phase 2 以前先建立 provider-neutral plan/session/lease registry、mock launcher 與 side-effect spy：

1. Adapter 唯一可呼叫的 legacy board operation 是 `status --json --no-prune`；不得呼叫 register/update/done/hooks/notify。
2. 若新增 projection writer，它使用獨立 atomic path，不能 import/call lifecycle maintenance 或 cleanup helper。
3. Codex/Claude mock sessions 產生 provider-session envelope、fresh execution-context attestation reference、heartbeat、handoff、END_REQUEST、owner-end release 與 explicit resume records。
4. `.claude/settings.json` hooks-disabled/default-plan/bypass-disabled 保持不變；不採信 ignored local allowlist 或未接線 commit guard。
5. Fake prior-pinned `ExecutionContextAttestor`、`OwnerEndAttestor` 與外部 `HostInventoryAuthority` 覆蓋 forged/replay/stale/malformed/owner mismatch；Fabric adapter 只消費 reference，不能 scan/reclaim。
6. Static/config fixtures 證明 pinned `.claude/settings.json`、hooks disabled、default plan、bypass disabled 與 adapter command-policy digest；ignored local broad allowlist 與 advisory commit guard 不能改變 command verdict。
7. 單一 writer 以 shadow mode 產生 allowlisted plan metadata、lease、candidate 與 board projection；不阻擋 live flow，也不自動建立/清理 workspace。

Executable negative tests 必須對 adapter `start/heartbeat/handoff/end_request/release/reconcile/resume` 逐一證明 zero legacy lifecycle call、zero orphan-cleanup invocation、zero detached child、zero process/listener scan、zero PID termination、zero worktree/branch prune、zero ACL/owner/sandbox mutation。唯讀 Git metadata query 與 allowlisted `CONTROL_METADATA` 不算 cleanup。任一失敗即禁止 Phase 2。

### Phase 2 — Two-writer cross-provider canary

只有 Phase 1 negative tests 全部通過才可開始。由兩個 top-level task/session 實作兩個明確不重疊的小型 task；至少一輪使用 Codex App + Claude CLI，另以 test harness 覆蓋 Codex+Codex 與 Claude+Claude。不得以同一 coordinator 的 nested child、共用 execution context 或代跑 preflight 取代。

每個 writer 必須：

1. 在自己的 execution context 以 fresh context attestation 通過 EXECUTION_CONTEXT_PREFLIGHT。
2. 取得不同 owner/provider/session id、execution-context/launcher binding、branch、sibling worktree 與 disjoint scope lease。
3. 至少寫兩次相隔 30 秒的 heartbeat；兩個 heartbeat interval 至少共同重疊 30 秒。
4. 各自產出 scope-disjoint commit、PR-head exact SHA 與綁定該 SHA 的 check result。
5. 兩者都完成 preflight 與 overlap 後，以 test harness 停止其中一個 heartbeat 模擬 crash，不 kill sandbox.exe、PID 或 runtime；該 lease 只變 `SUSPECT` 且仍占 writer seat，另一個完成 commit、check 與 evidence binding。

本 phase 同時執行 global-cap 與 runtime 負測試：兩個任意 provider writer ACTIVE 時，第三個 writer 必須 `QUEUED_FOR_LEASE`；兩個 writer runtime leases 加上一個 train lease 可共三個 ACTIVE，並行的 Computer Use intent 必須排隊。Train release/reconcile 後 Computer Use 才能取得第三席；不得重複 offset、覆寫 winner、取消 owner 或用角色名稱繞過互斥。

另以正常 handoff fixture 證明 writer 只能送 `END_REQUEST`；OwnerEndAttestor + envelope revoke + registry CAS 成功後只釋放 writer seat，task resources 保持 `RETAINED_FOR_REVIEW`，原本排隊的第三個 disjoint writer 才能 admission。Self-issued/replayed release、competing release 與 owner-end unknown 都不得釋放席位。

任何 execution identity 重複、scope overlap、heartbeat 未重疊、第三 writer 被放行、crash 波及另一 writer、runtime admission 結果不符，或出現 cleanup/process mutation，都使 Phase 2 失敗。Pilot 達標只授權 cap=2；擴至四 writers 必須另開 activation delta，不能由 metrics 自動提高。

### Phase 3 — Branch topology and stack simulation

各驗證一條兩層 ordinary base-chained PR、一個 root-plus-two-child fan-out，以及 `managed_gitflow` registry。Managed branch 必須覆蓋 valid renew、competing CAS、stale owner/head/protection、candidate direct-push managed base、advance generation 與 drift/expiry freeze，且不刪除、不直接部署。以 mock GitHub API 驗證 direct-stack vector freeze、完整 `200|202|400|403|404|409|422`/poll matrix、member reread、single group merge SHA attribution 與 closed-schema projection；此 phase 不執行 live merge。

同 phase 啟用 Merge Queue observe-only adapter，以 synthetic `merge_group`、eject/rebuild 與 `queue: max` capacity-full fixtures 證明 stale group SHA 不會冒充 PR-head/delivery evidence；不得 enqueue 或修改 branch protection。

### Phase 4 — Train and Computer Use canary

啟用互斥的單一 integration train／Computer Use runtime slot；以同一 canonical manifest 對 exact SHA 執行 require-real Playwright + independent Computer Use 雙證據，驗證 head/manifest drift、trusted harness pin、reserved-port preflight、runtime ownership、failure isolation 與 evidence invalidation。Candidate 修改 harness 的 canary 只能得到 shadow evidence。

### Phase 5 — Execution envelope and ordinary promotion

先以 side-effect spy 證明 `plan_only` 只寫 allowlisted `CONTROL_METADATA`，不取得 lease 或觸及 candidate/remote/host/external sinks；再以 mock remote/API 驗證 `implement_local → push_owned_branch → open_draft_pr → submit_delivery` 每級的正向/負向 gate，以及 issuer/highest-level/target binding、expected-old-OID CAS、expiry/revocation、nonce replay 與 writer self-escalation negatives。只有 autonomous-linux-delivery 完成 activation 且 current machine truth 證明可用後，才以一個 ordinary PR 做 bottom-up promotion canary；任何 external HELD 直接投影，不建立 bypass。

### Phase 6 — Direct-stack promotion

只有 canonical OpenSpec 已加入 stack contract、Phase 3 simulation 與 Phase 5 ordinary canary 全部通過，才以一個最小兩-member linear stack，在既有 delivery authority 明確選定的 canonical test deployment target 執行 live canary；production activation 必須另案。Dispatch 前凍結完整 vector；dispatch 後一直 single-flight 到 GitHub outcome 與 group deployment terminal。另以 mock deployment failure 證明 internal `STACK_DELIVERY_FAILED` 只投影為 `CLOSED/FAILED/MERGED_NOT_DELIVERED`、admission freeze 與 repair/revert lineage；不得在 live canary 故意破壞 production。

### Phase 7 — Merge Queue observation

若 repository 符合資格，只啟用 eligibility/merge_group/queue evidence observation；若不符合則保持 `HELD_QUEUE_CAPABILITY`。把 Merge Queue 升為 delivery authority 必須另案，不由本設計自動啟用。

## 17. Acceptance criteria

設計實作完成必須由 executable evidence 證明：

1. **AC-01 — Cross-writer positive canary.** 兩個 top-level writers 各自在不同 provider/session/context、branch、sibling worktree 與 scope 通過 preflight；tracked main 保持 clean，heartbeat 至少重疊 30 秒，且各自產出 scope-disjoint exact-head evidence。
2. **AC-02 — Provider-neutral cap.** Codex+Claude、Codex+Codex、Claude+Claude 三種組合都受同一 global cap=2；第三個 writer 必須 `QUEUED_FOR_LEASE`，provider label 不可繞過。
3. **AC-03 — Crash isolation.** 中斷一個 writer heartbeat 後只將該 lease 標為 `SUSPECT` 且仍占席；另一個 writer 繼續完成，zero delete/kill/prune/ACL/sandbox mutation。
4. **AC-04 — Explicit resume.** 新 execution context 沒有 explicit `RESUME_INTENT` 與 exact tuple/head/scope CAS rebind 時不得接手舊 lease/evidence。
5. **AC-05 — Lease CAS.** 同一 common-dir 的 CAS race 對相同 resource_key 恰有一個 winner；不同 common-dir 或 multi-host request 必須 `HELD_TOPOLOGY_UNSUPPORTED`。
6. **AC-06 — Scope normalization.** Canonical path normalization、Windows case folding、glob intersection、rename old/new path、new-file parent scope 與 shared resource IDs 能 deterministic 判定 overlap；無法證明 disjoint 一律 queue。
7. **AC-07 — Scope drift.** Commit/push/handoff 前的 NUL-safe changed-path/symbol 重驗若發現未宣告 scope，candidate 進入 `HELD_SCOPE_DRIFT`，不得自動擴權。
8. **AC-08 — Actual-context preflight.** 每個 writer 都在自己的實際 context 證明 repo/common-dir/HEAD/branch/status/ownership trust；dubious ownership 只產生 `HELD_EXECUTION_CONTEXT`，不以 safe.directory、ACL/owner、sandbox 或重裝補位。
9. **AC-09 — Isolation negatives.** Nested Codex/Claude/agent CLI、nested worktree、共用 worktree/branch/context 的 fixture 全部在寫入前拒絕。
10. **AC-10 — Runtime capacity.** 兩個 writer runtime leases 加上一個 train lease 可共三個 ACTIVE；並行 Computer Use intent 必須排隊，train release/reconcile 後才取得第三席，不得自行挑選 reserve offset。
11. **AC-11 — Managed-branch base rules.** Managed branch 缺 owner/base/protection/generation/expiry 任一欄位即拒絕；drift/expiry 只 freeze/rebase-required，zero delete。任何 develop/release/hotfix direct-deploy intent，或未列舉 included commits 與逐 candidate attribution 的 generic branch-to-main bulk promotion，都在 mutation 前拒絕。
12. **AC-12 — Parent drift.** Parent/base SHA 改變後，所有 child checks、review、train 與 E2E evidence 失效；rebase push 使用明確 expected remote SHA 的 force-with-lease 並附 range-diff。
13. **AC-13 — Execution-level gates.** `plan_only` 只可寫 §6.8 allowlisted `CONTROL_METADATA`，不得取得 lease 或觸及 candidate/remote/host/external sinks；其餘 execution levels 不能跳級。Own-branch push、draft PR 與 delivery submission 在 lease/head/base/scope/authority 任一不符時於 network write 前拒絕。
14. **AC-14 — Delivery authority negatives.** Envelope 禁止 push main/他人 branch、裸 force、candidate self-approval、candidate merge credential 與直接 merge/deploy；lower-level envelope 的 mock 不得收到 push/PR/delivery call。
15. **AC-15 — Stack capability gate.** Direct-stack capability/OpenSpec 未啟用時 Fabric 保持 HELD；若已建立 external attempt，只可投影 `CLOSED/HELD/PREMERGE_AUTHORITY_UNAVAILABLE`。只能在 dispatch 前以新 generation 回到 ordinary chain。
16. **AC-16 — Stack vector freeze.** Direct-stack packet 凍結完整 ordered member vector、trunk SHA、每個 PR exact head/base、checks、independent review、E2E 與 protection/capability snapshot；任何 drift 在 dispatch 前拒絕。
17. **AC-17 — Async response/poll matrix.** `200|202|400|403|404|409|422` 與 pending/success/known-failure/timeout/expiry/ambiguous poll fixtures 全部依 §6.7 分類；只有 `202` 保存新 UUID，且任何無法證明零或全員 merged 的情況都不部署、不盲目 retry。
18. **AC-18 — Stack attribution.** `merge_method=merge` 只要求每個 PR 已 merged、每個 frozen member head 都可達單一 `stack_result_merge_commit_sha`，以及 final SHA 等於 fresh `origin/main`；不要求每個 member 有不同 merge commit，optional reported SHA 可缺省或全等於 final。
19. **AC-19 — Group delivery barrier.** Group deployment/verification 成功前沒有 member 可標 `DELIVERED`；merge 後 deploy failure 只可投影 `CLOSED/FAILED/MERGED_NOT_DELIVERED` 並建立新 repair/revert PR lineage，不能聲稱跨系統 rollback 成功。
20. **AC-20 — Batch negatives.** 把任意不相依 PR coalesce 成同一 batch/transaction、非線性 DAG batch、跨 repository batch，或建立未綁 member/final attribution 的多 PR deployment，都在 mutation 前拒絕；ordinary independent single-PR path 維持允許。
21. **AC-21 — Train boundary.** Integration train 只合成測試，不可合併到 main，也不可作 canonical deployment source；train base 必須符合 profile 的 exact `integration_base_ref/SHA`，任一 base/input SHA 改變使舊 evidence 失效。
22. **AC-22 — Per-head real E2E.** 每個 candidate freeze 前都有 machine-checkable E2E applicability record；任何 required user-facing/runtime candidate 的每個新 exact-head handoff，都重新執行 canonical `E2E_REQUIRE_REAL=1` Playwright 與獨立 Computer Use，並使用同一 physical manifest、manifest digest、stack kind、ports/base URLs 與 exact head；不一致即 `HELD_EVIDENCE_BINDING`。
23. **AC-23 — Manifest freeze.** Manifest bytes digest 在服務啟動前與 publication 前相同，且 manifest head、candidate envelope head、worktree Git HEAD 三者相等。
24. **AC-24 — Runtime preflight negatives.** Offset、reserved-port、manifest、URL 或 safe-env mismatch 在 listener query、cleanup、服務啟動與 browser spec 前拒絕，且沒有 process mutation。
25. **AC-25 — Trusted verifier source.** Verifier/binder 來源是 prior trusted/base-pinned immutable SHA；candidate 修改 canonical harness 只能產生 shadow evidence。
26. **AC-26 — Evidence completeness.** E2E evidence 包含 route、button、fixture、API、runtime ID、visible state、network、trace、screenshot、command records、runtime/listener/lineage digests 與 reserved-port guard；raw host identity 只留 host-local attestation。
27. **AC-27 — E2E failure isolation.** E2E 或 interaction failure 只凍結相關 candidate/edge，另一個無依賴 writer 持續。
28. **AC-28 — Board/cleanup zero side effect.** Adapter start/heartbeat/handoff/end_request/release/reconcile/resume 的 spy 證明不呼叫 legacy board register/update/done/hooks/notify，並具有 zero cleanup、detached child、process/listener scan、PID termination、branch/worktree prune、ACL mutation。
29. **AC-29 — Projection non-authority.** 唯一 legacy board read 是 exact `status --json --no-prune`；projection loss/malformed 只成為 `PROJECTION_DEGRADED`，可由 durable registry/GitHub 重建，且不核發 lease/pass/process authority。
30. **AC-30 — Shared-resource queue.** Shared-resource concurrency 使用 `queue: max` 且不使用 `cancel-in-progress: true`；一個 running 加兩個 pending 時沒有 candidate 被 replacement。Workflow validation 必須拒絕 `queue: max` 與 cancel=true 組合，Fabric registry 能把每個 run 對回 exact candidate/lease。
31. **AC-31 — Merge Queue non-authority.** Merge Queue observer 對 unsupported repo 回傳 `HELD_QUEUE_CAPABILITY`；synthetic merge_group SHA 不得冒充 PR-head 或 delivery evidence，adapter 沒有 enqueue/merge/deploy calls。
32. **AC-32 — Delivery lineage.** Ordinary promotion 保有 `PR head → merge commit = fresh origin/main = deployed commit`；direct-stack promotion 保有 `each frozen member head → final stack-result SHA = fresh origin/main = deployed commit`。
33. **AC-33 — Role separation.** Codex/Claude writer、monkey1sai Codex reviewer、Computer Use verifier、External machine check App 與 delivery executor 的權限由測試證明互不替代；self-review 只能 advisory。
34. **AC-34 — Approval-equivalent check.** 只有正確 App source、exact SHA、required success 的 CheckRun 可作 approval-equivalent gate；review text、commit status、neutral/skipped/timeout CheckRun 或 candidate credential 都不可替代。
35. **AC-35 — External authority handoff.** Production、deployment target、secret broker 或 GitHub App activation intent 只可產生 sanitized validation/handoff packet；未有外部 authority 時在 mutation 前 `HELD_NOT_IN_SCOPE`，schema/linter 拒絕 secret、token、cookie、raw env、transcript 與完整 SID/PID。
36. **AC-36 — Global fail closed.** 任一安全 gate 不可判定時回傳 `HELD/UNKNOWN`；Fabric lifecycle 都不得修改 sandbox.exe、Codex installation、ACL/owner、firewall，或清理 unknown process/worktree。
37. **AC-37 — Context-attestation anti-forgery.** 正向 fixture 的 fresh attestation 必須一對一綁定 owner/provider session/execution context/launcher lineage/lease/worktree；forged、replayed、expired、revoked、owner mismatch、different launcher 或 host-local mapping loss 全部在任何 writer/file/network side effect 前 `HELD_EXECUTION_CONTEXT`，且 attestor 無 ACL/sandbox/process mutation。
38. **AC-38 — Execution-envelope CAS and replay guard.** 合法 envelope 只可逐級、一次性前進到 authorized highest level；self-issued、self-upgraded、stale OID/generation、expired/revoked、nonce replay、non-adjacent jump、wrong owner/context/remote SHA 的 fixture 全部在 side-effect mock 前拒絕。
39. **AC-39 — Managed-branch operation protocol.** Valid owner + managed-base lease + expected head/base/protection + CAS 的 renew 正向案例只延長 expiry且不改 Git head；competing renew 恰一 winner。Candidate direct-push managed base、owner mismatch、stale head/OID/nonce、protection drift、renew 改 owner/scope/generation/head 與未列舉 advance 全部拒絕且零 remote write。
40. **AC-40 — External inventory boundary.** Fresh source-pinned HostInventoryAuthority attestation 可產生 sanitized reclaim handoff；unknown/stale/malformed/replayed/issuer-drift inventory 保持 `UNKNOWN/HELD`。Spy 證明 Fabric adapter 不 scan process/listener、不 reclaim、不 kill/delete/prune/改 ACL。
41. **AC-41 — Queue capacity and rebuild.** `queue: max` 第 101 個 pending cancellation 必須對回 exact candidate/run/lease 並 fail closed，不留下假 pending/pass/delivery；Merge Queue group 被 eject/rebuild 或 member vector 改變後，舊 snapshot 立即失效且不能作 membership/PR-head evidence。
42. **AC-42 — Closed-schema projection.** Schema tests 對每個 §6.7 response/poll fixture只接受 active OpenSpec 的 `CLOSED/{HELD|FAILED|DELIVERED}/<closed reason>`；`MERGE_OUTCOME_UNVERIFIED`、`MERGED_NOT_DELIVERED` 或任意 `STACK_*` 被寫入 terminal-class 時必須拒絕且不得發布 passing record。
43. **AC-43 — Safe writer-seat release.** Valid END_REQUEST + fresh OwnerEndAttestor evidence + envelope revoke + expected registry OID 的 CAS 正向案例只把 writer seat 置為 `RELEASED`、task resources 置為 `RETAINED_FOR_REVIEW`，並允許原本排隊的第三個 disjoint writer admission。Writer self-release、duplicate/replay/expired/wrong owner/context/head、competing CAS 與 unknown terminal event 都不得釋放席位；全程 zero cleanup/delete/prune/process mutation。
44. **AC-44 — Plan-only metadata allowlist.** Submit/plan-only 正向案例只新增 immutable plan blob、單一 `refs/ai-bim/delivery-plans` expected-OID index，以及嵌入同一 plan blob/index 的 plan-only envelope/audit metadata；spy 對 lease/board/tracked candidate file/branch/worktree/network/host/external sink 的 call count 都是零。Unknown side-effect class、stale plan CAS、額外 local ref 或 detached metadata store 全部拒絕。
45. **AC-45 — Claude configuration isolation.** Base-pinned hooks-disabled/default-plan/bypass-disabled settings 與 adapter command-policy digest 可通過；hooks enabled、settings source drift、bypass/default-mode drift、candidate 或 ignored `.claude/settings.local.json` broad `gh/git push/taskkill/powershell` allowlist、commit-guard wiring 或 provider permission resolution 都不能擴大 command set，且在任何 file/network side effect 前 `HELD_PROVIDER_CONFIGURATION`。

## 18. Metrics

啟用判斷使用四週滾動指標：

- writer utilization 與 queue wait p50/p95。
- lease collision、scope drift 與 rebase 次數。
- PR cycle time、review latency 與 exact-head invalidation 次數。
- train interaction detection rate。
- Computer Use flake rate 與 candidate-local recovery time。
- CI mistaken cancellation count。
- sandbox/process/ACL incident count；目標為零。
- delivered PR 的 attribution completeness；目標為 100%。
- rollback、external HELD 與人工介入原因。

任何 sandbox/process/ACL incident、雙重 lease、錯誤合併 authority 或不可歸因 delivery 都是立即停止擴容的條件。

## 19. V1 inclusion rationale and guarded mechanisms

先前把下列能力整項排除，是因為當時只有需求語句，沒有 identity、CAS、exact-SHA、external authority 與 failure semantics；直接開啟會放大 host 損壞、雙 writer、錯誤合併或不可歸因部署的風險。v1 現改為「納入安全控制面與可執行 contract，保留不可跨越 invariant」：

| 使用者要求 | 原先不允許的原因 | v1 納入機制 | 不可跨越邊界 | 可測 acceptance |
|---|---|---|---|---|
| develop/release/hotfix branch | 未治理永久 branch 會 drift、重複 CI、提高回合併衝突並造成 deploy source 歧義 | §6.6 `managed-branch/v1`：managed base/candidate 分離、owner/base/protection/generation/expiry、專用 lease 與 renewal/advance CAS；promotion 逐 candidate fresh-main PR 或符合 gate 的 `direct_stack` | 到期只 freeze、不刪除；candidate 不可 push managed base；不得 direct deploy 或 generic bulk PR | AC-11 正／負向與 zero-delete；AC-39 valid renew、CAS race、stale/owner/direct-push negatives 與 zero remote write |
| 最多兩個 session 並行 | 現行 Single Active Writer 尚未調和；worktree 不等於 execution/runtime/scope isolation，provider 可重複計數 | §5.2–§6.5/§6.12：Codex/Claude 共用 global cap=2、不可變 tuple、CAS lease/heartbeat、actual-context preflight 與 attested writer-seat release；第三席 queue | 一 session 一 context/worktree/branch/scope；不得 nested CLI、共用 checkout、self-release 或以 provider 繞 cap；release 保留 task resources；四席需另案 activation | AC-01/02 正向並行；AC-03/05/09 conflict/crash negatives；AC-43 release positive/forgery/race negatives；AC-28 zero cleanup |
| sandbox.exe、安裝、ACL/owner/account | Execution-context mismatch 不能靠擴權修復；這些 mutation 可能破壞整機與證據 trust | §5.3/§6.5 prior-pinned `ExecutionContextAttestor`、host-local attestation、provider-config preflight、deny-list 與 `HELD_EXECUTION_CONTEXT` | Fabric/attestor 永不修改 sandbox/install/ACL/owner/account/firewall，不用 global safe.directory；local allowlist不能擴權 | AC-08 positive actual-context；AC-37 forged/replay/mismatch negatives；AC-45 config/local-allowlist negatives；AC-28/36 zero host mutation |
| 清除未知 process/worktree | stale heartbeat 不是 owner-death proof，錯殺/錯刪不可逆且可能影響其他使用者/session | §6.11 外部 `HostInventoryAuthority` attestation + quarantine + sanitized reclaim handoff | Fabric adapter 不 scan；Unknown/SUSPECT 不 release、kill、delete 或 prune；真正 reclaim 需另行外部 authority | AC-40 fresh-attestation positive、stale/malformed negatives 與 zero scan/reclaim；AC-28/29 projection no-side-effect |
| Candidate 自主審查／審批 | self-review 不是獨立證據；candidate 持 reviewer/publisher/merge credential 會形成循環放行 | Self-diagnostic 標 advisory；monkey1sai Codex reviewer 唯讀；prior-pinned reviewer/binder + source-pinned External CheckRun | writer≠reviewer/verifier/publisher/executor；candidate 沒 merge credential；self-review 永不解除 gate | AC-33 independent-role positive/self-review negative；AC-34 correct-App positive與 spoof/neutral/timeout negatives |
| atomic stack／多 PR batch | GitHub stack API 是 async，top SHA 不是完整 vector CAS；merge 與 Linux deploy 不能成為跨系統物理 transaction | §6.7 `direct_stack`：linear vector、逐 PR exact gates、async response matrix、single group merge SHA、group deployment saga 與 repair/revert lineage | v1 只限同 repo fully-linear stack；delivery group barrier；不得把 `202` 或 compensating revert 稱為 atomic success/rollback | AC-15–19/32 positive與 drift/outcome/deploy negatives；AC-20 zero-mutation batch rejection；AC-42 closed-schema guard |
| Merge Queue | 目前 repo eligibility/workflow 不具必要 baseline；merge_group evidence 與 PR-head evidence 不同，queue 也可能重組 member | §6.9 observe-only、timestamped non-authority snapshot；`queue: max` CI contract simulation | 不 enqueue/dequeue、不取代 autonomous delivery、不用 stale merge_group 冒充 PR-head/DELIVERED；升格 authority 另案 | AC-30 queue positive/validation negative；AC-31 no-write observer；AC-41 capacity-full/rebuilt-group negatives |
| production／deploy target／secret broker／GitHub App | 這些是外部、敏感或不可逆 authority，Fabric 無權自行改寫 | §6.10 sanitized validation + immutable external-authority handoff；外部 executor 回傳 machine evidence | Fabric 不保存 secret/token、不改 production/target/broker/App/protection，也不把 HELD 改成 READY | AC-35 sanitized-handoff positive、missing-authority negative、secret rejection；AC-36 zero external mutation |
| plan→implementation→push→PR→merge 自治鏈 | 未分級的 unattended chain 會擴 scope、寫錯 remote，並讓 writer 自授權 merge | §6.8 immutable execution envelope：issuer/authority/target binding、highest/current level、CAS transition、expiry/revocation/replay guard 與 side-effect taxonomy | `plan_only` 只寫 allowlisted control metadata；每級重驗 lease/head/base/scope/authority；只 push own branch；merge/deploy 永遠交外部受保護 authority | AC-13 legal-level positive/precondition negatives；AC-14 forbidden sinks；AC-38 self-issue/upgrade/replay/stale negatives；AC-44 plan metadata allowlist/zero forbidden sinks |

其中「atomic」採精確語意：GitHub stack merge 在 GitHub 邊界內 all-or-nothing；跨 GitHub merge與 Linux deploy 採 saga。邏輯 delivery barrier 可保證沒有 member 被部分標為 `DELIVERED`，但無法保證外部系統不存在 `MERGED_NOT_DELIVERED` 中間狀態。這個限制必須顯示給 operator，不能用文字承諾掩蓋。

## 20. Remaining hard non-goals

第一版仍不包含：

- 修改 Codex App sandbox.exe、Codex/Claude 安裝、Windows ACL/owner/account、firewall 或 global Git trust。
- 對 UNKNOWN/SUSPECT process、listener、branch 或 worktree 自動 kill/delete/prune。
- Candidate self-approval、candidate-owned required-check publication 或 candidate merge/deploy credential。
- 把任意不相依 PR coalesce 成同一 batch/transaction、非線性 DAG batch、跨 repository batch，以及跨 GitHub／deployment 的物理 all-or-nothing transaction；ordinary independent single-PR path 不在此禁令內。
- 讓 Merge Queue 成為 promotion/deployment authority。
- 由 Fabric 直接修改 production、deployment target、secret broker、GitHub App activation 或 branch protection。
- 多 host/multi-clone writer coordination、global writer cap > 2、共用 worktree/branch/context 或 nested agent CLI。
- 在 Phase 0 canonical governance/OpenSpec activation 前進行 live multi-writer、stack merge 或 delivery mutation。

## 21. Implementation handoff gate

本次修訂使先前核准失效。本 design spec 經使用者重新明確核准後，才可使用 Superpowers writing-plans 建立 implementation plan。Plan 必須先處理 Phase 0 的 canonical OpenSpec/governance reconciliation，將實作拆成可獨立驗證的小任務，並在任何 runtime、GitHub authority 或 live direct-stack mutation 前通過 strict OpenSpec lifecycle validation。

在使用者核准前，停在 written-spec review gate。
