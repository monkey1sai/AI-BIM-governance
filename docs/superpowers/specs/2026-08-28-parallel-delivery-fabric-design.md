# Parallel Delivery Fabric：多 Session 並行開發與安全交付設計

> 日期：2026-08-28
>
> 狀態：Draft — 等待使用者審閱
>
> 方法：Superpowers Architectural brainstorming
>
> 文件角色：target-state design；不是目前已啟用的治理規則，也不授予 agent 合併、部署、審批或程序終止權限

## 1. Outcome

本設計要讓同一個 repository 同時容納多個可寫開發 session，各自在隔離 worktree 與 branch 中完成可獨立審查的工作，並透過 GitHub Pull Request、精確 commit 證據、整合列車及獨立 Computer Use E2E 驗證相互協作。

使用者可觀察的完成結果是：

1. 最多四個互不重疊的 writer session 可同時開發，不再因 Codex App 同一 workspace 僅一個 active task 而序列等待。
2. 每個 session 有明確 owner、worktree、branch、scope、依賴、lease 與證據，不會共同修改同一 checkout。
3. 無依賴任務使用獨立 PR；線性依賴在 v1 使用 ordinary base-chained PR；扇出任務在 root PR 後平行。GitHub native stack 只作 preview shadow，未經 unstack、重新凍結與重驗不得 promotion。
4. PR 的建置、測試與唯讀審查可以並行；共享 runtime、真實瀏覽器、合併與部署維持資源級序列化。
5. user-facing 變更必須由獨立 Computer Use verifier 對凍結的 exact SHA 執行真實操作與 E2E 證據收集。
6. 一個 session、PR 或 E2E 失敗只會凍結該 candidate 或依賴邊，不會阻塞所有無關開發。
7. session crash、Codex App restart 或 sandbox context 變動不會觸發廣域程序清理、ACL 變更、worktree 刪除或 Codex App 重裝。
8. promotion 仍逐 PR、由下而上交給既有 autonomous delivery authority；每次合併與部署都可精確歸因。

## 2. Design authority 與現況邊界

### 2.1 本文件擁有的決策

本文件只擁有以下尚未由現有交付規格完整定義的協作層：

- 多 writer session 的 admission、scope isolation 與 lease。
- task DAG、independent PR、stacked PR 與 fan-out 的選擇規則。
- throw-away integration train。
- exact-SHA Computer Use E2E verifier。
- board projection、crash recovery 與 sandbox-safe lifecycle。
- candidate 如何逐一交給既有 autonomous delivery 的 promotion bridge。

### 2.2 只引用、不重新定義的 authority

下列 authority 由既有 source of truth 擁有，本文件不得建立第二套規則：

- Worktree 的 fresh origin/main、sibling path、命名與 closeout：由 docs/agents/github-workflow.md 擁有。
- 未合併 branch 的 runtime port、manifest 與 mutable-state isolation：由 canonical isolated-branch-stack-verification spec 擁有。
- exact-head machine review、外部 trust root、approval、merge、canonical Linux deployment、single-flight delivery transaction 與 terminal delivery result：由 active OpenSpec openspec/changes/autonomous-linux-delivery 擁有。
- Live GitHub branch protection 與目前仍生效的審批規則：以 GitHub machine truth、canonical OpenSpec 及 executable tests 為準，不得從本設計推論已切換成 autonomous mode。

### 2.3 必須先調和的治理衝突

現行根 AGENTS.md 的 Single Active Writer 是 live policy；本文件提出的多 writer 是 target-state 改變。在相應的 canonical governance/OpenSpec delta 完成、驗證並啟用前，本文件不得被用來繞過 Single Active Writer。

active autonomous-linux-delivery OpenSpec 仍含 self-referential ledger、fixpoint、reconciliation PR 的舊要求；較新的 Lean Governance 與 docs/agents/self-referential-bootstrap.md 禁止新增這類純治理修復 PR，且 historical ledger 必須 byte-frozen。實作前必須在既有 OpenSpec 內明確修訂此衝突；本文件不默默選邊，也不複製衝突條款。

因此本設計通過審閱後，下一階段的第一個治理動作必須是：

1. 建立或修訂唯一 canonical OpenSpec delta，讓多 writer target-state 與 Single Active Writer live rule 有明確 activation boundary。
2. 在既有 autonomous-linux-delivery OpenSpec 內調和 stale self-referential closure 條款。
3. 在上述 delta 啟用前，只可做 shadow-mode metadata、唯讀驗證與單 writer canary。

### 2.4 2026-08-28 verified baseline

本設計從 freshly fetched origin/main 033ec31d9405d93a3864b2065a40e8f51f145863 建立。該 baseline 的 current/live facts 是：

- docs/plans/NOW.md 將 autonomous Linux delivery 標為 HELD/ACTIVATION_UNATTESTED；target OpenSpec 不能冒充已啟用 authority。
- canonical pull-request-review-agent spec 與 docs/agents/github-workflow.md 仍要求 human/CODEOWNER exact-head approval。移除 monkey1sai-blip 的 per-PR human counted review 是既有 autonomous-linux-delivery OpenSpec 的 target activation，不由本文件提前生效。
- scripts/dev/manage-pr-queue.mjs 是 named-PR read-only observer；auto-fix、update、approve 與 merge 仍 fail closed。
- .github/workflows/ci.yml 的 top-level concurrency key 包含 workflow、ref 與 verification class，並設定 cancel-in-progress: true；不同 PR ref 通常互相隔離，但此 key 不表達 shared runtime lease 或 queue semantics，workflow 也沒有 merge_group trigger。未來共享資源 job 若改用 cross-PR group，不得沿用 cancel-in-progress: true。
- scripts/dev/agents-board.mjs 的 register、done、SessionStart、Stop、SessionEnd 與 Codex turn completion 都會呼叫 lifecycle maintenance；cleanup helper 會啟動 detached child，並具有終止 owner-proven dev process 與 prune worktree 的能力。

這些 facts 代表第一版不能把目前 board 或 queue observer 直接升格成 orchestrator。Board lifecycle cleanup 必須先與 session projection 解耦；本設計也不執行 board register/done 作為自身安全性的證明。

## 3. 方案比較與決策

### 3.1 方案 A：維持 Single Active Writer，多個 session 只做唯讀研究

優點是改動最小，但 writer throughput 仍為一，無法解決使用者指出的 active-session 瓶頸。此方案只保留為 activation 前的相容模式，不作為目標架構。

### 3.2 方案 B：傳統 Git Flow，永久 develop / release / hotfix 分支

參考圖中的 feature、develop、release、hotfix 分流能表達依賴，但永久 develop branch 會增加長期 drift、重複 CI、回合併衝突及「哪個 branch 可部署」的歧義。它也不符合本 repo canonical deployment 只消費 fresh merged origin/main 的邊界，因此不採用。

### 3.3 方案 C：Parallel Delivery Fabric

採用短生命週期 branch/worktree、task DAG、GitHub PR chain、throw-away integration train 與逐 PR promotion。它保留 Git 分散式並行優勢，又把共享 runtime、merge 與 deploy 的不可平行部分明確序列化。

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

- Native stack member 經 API 合併時使用專用 asynchronous stack merge API，不等同既有單一 PR synchronous merge sink。因此 v1 production path 不保留 native stack membership。

  https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks

- gh stack 或 GitHub website 可建立 stack；若 preview extension/API 不可用，標準 Git branch 加 base-chained PR 仍可表達相同依賴。

  https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-stacked-pull-requests

- GitHub Merge Queue 使用 merge_group SHA，且 Actions 必須另外監聽 merge_group；它目前適用 public organization repositories 或 GitHub Enterprise Cloud private organization repositories，不能作為目前 personal-user public repo 的必要基線。

  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue

  https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

- GitHub Actions 相同 concurrency group 同時只允許一個 running；新 pending 預設可取消舊 pending，cancel-in-progress 也會取消 running。Concurrency key 必須包含 workflow 與資源 identity，避免不同 PR 互相取消。

  https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax

GitHub stacked PR 的 stack merge 是整疊 atomic operation。它與本 repo 現有「一個 PR、一個 delivery transaction、不可 coalesce」契約不相容，因此本設計只使用 stack 來平行開發及審查，不使用 all-at-once stack merge。

## 5. 系統模型

~~~mermaid
flowchart LR
    U[User / Coordinator] --> F[Parallel Delivery Fabric]
    F --> P[Delivery Plan Registry]
    F --> L[Lease Registry]
    F --> W[Workspace Provisioner]
    F --> D[Task DAG and Stack Adapter]
    W --> S[Codex App Top-level Task Adapter]
    D --> S
    S --> R1[Writer Worktree and PR 1]
    S --> R2[Writer Worktree and PR 2]
    S --> R3[Writer Worktree and PR 3]
    S --> R4[Writer Worktree and PR 4]
    R1 --> T[Throw-away Integration Train]
    R2 --> T
    R3 --> T
    R4 --> T
    T --> E[Exact-SHA Evidence Binder]
    E --> C[Independent Computer Use Verifier]
    C --> B[Promotion Bridge]
    B --> A[Existing Autonomous Delivery Authority]
    P --> V[Board Projection]
    L --> V
~~~

### 5.1 Deep module boundary

Parallel Delivery Fabric 對外只暴露三個意圖層操作：

- submit(plan)：提交 task DAG 與 scope，透過 adapter 非同步建立 top-level task；不啟動 nested Codex process，也不合併 PR。
- reconcile(plan_id)：以 Git/GitHub machine truth 重新計算狀態、lease 與失效證據。
- drain(plan_id)：停止接受新工作，讓既有 candidate 到安全停止點；不殺程序、不刪 worktree。

inspect(plan_id) 回傳唯讀 DeliverySnapshot。外部 caller 不需知道 board 檔案、Git ref CAS、stack preview 或 integration branch 的內部細節。

### 5.2 初始容量

第一版安全上限：

| 資源 | 上限 | 說明 |
|---|---:|---|
| Top-level writer session | 4 | 每個 session 一個 branch、worktree、scope lease |
| Read-only reviewer | 2 | 與 writer 身分分離，可平行 |
| Computer Use verifier | 1 | 與 integration train 共用第五個 runtime slot，兩者互斥 |
| Integration train | 1 | 與 Computer Use 共用第五個 runtime slot，一次一個 generation |
| Promotion / delivery | 1 | 由既有 autonomous delivery single-flight 擁有 |

這是跨 top-level session 的容量，不改變單一 coordinator 內部 subagent cap 或 apex-slot invariant。擴容必須以碰撞率、等待時間、E2E flake、sandbox/process incident 與 delivery rollback 數據決定。

所有需要真實 runtime 的角色共用唯一的 isolated_runtime_offset[0..4] 池。四個 writer 最多取得四個 offset；第五個只供 integration train 或 Computer Use 其中之一。Computer Use 也可在 evidence 證明相同 exact SHA、manifest 與 process lineage 時，重用已凍結 candidate 的 owner-proven stack。第六個同時請求必須 QUEUED_FOR_LEASE，不得自行選 port。

### 5.3 Codex App top-level task adapter

每個 writer 必須是 Codex App 中不同的 top-level task，不是 coordinator 內用 nested codex CLI 啟動的 child process。Adapter 保存下列不可混淆的綁定：

task_id → Codex task/thread id → execution context id → branch → worktree id → scope lease

Adapter 建立 task 後，writer 必須在自己的實際 sandbox/execution context 執行 EXECUTION_CONTEXT_PREFLIGHT：

1. 解析 repository root 與 git common-dir。
2. 讀取 HEAD、branch、origin/main 與 status。
3. 證明該 context 對 exact worktree 的 Git ownership trust 成立。
4. 證明 branch/worktree/lease 綁定與 delivery plan 相同。
5. 寫入前重新確認 tracked worktree clean。

Coordinator 代跑的 preflight 無效。任何 dubious ownership、repo/common-dir identity 漂移或不可判定結果都進入 HELD_EXECUTION_CONTEXT；禁止用 global safe.directory、ACL/owner 修改、sandbox.exe 操作或 Codex App 重裝補位。

## 6. Durable contracts

所有 durable artifact 只保存非機密 metadata、SHA、路徑、public GitHub identifiers 與短錯誤摘要，不保存 token、完整環境變數、瀏覽器 cookie、conversation transcript 或可逆敏感資料。

### 6.1 delivery-plan/v1

必要欄位：

- plan_id、repo_identity、created_at、coordinator_session。
- baseline_ref 與 resolved_baseline_sha。
- tasks：task_id、outcome、owner_session、scope、dependencies、risk、e2e_required。
- requested_capacity 與 acceptance criteria。
- governance_source_refs。

Plan 在 admission 後 immutable；任何 task graph 修改產生新 generation。

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

- resource_key、lease_id、plan_id、task_id、owner_session。
- acquired_at、heartbeat_at、expected_registry_sha。
- scope_digest、state、release_evidence。

兩個 session 對同一 resource_key 競爭時，只有 CAS 成功者取得 lease。失敗者重新讀取 registry 後進入 QUEUED_FOR_LEASE，不可覆寫 winner。

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

- train_id、generation、fresh origin/main SHA。
- ordered candidate heads 與 dependency edges。
- synthetic integration SHA。
- runtime isolation manifest。
- checks、interaction failures、created_at、expires_at。

Integration train 是可丟棄驗證產物，不是 merge authority，也不是部署來源。

## 7. Admission 與 scope ownership

### 7.1 Admission rule

Coordinator 在建立 writer 前先把 outcome 分成 task DAG，並依下列規則分類：

| 情況 | 決策 |
|---|---|
| 不同 service、檔案與 contract，無依賴 | 四個容量內直接平行 |
| 共用一個小 contract，之後可扇出 | 先建立 root contract PR；child 可在自己的 worktree 預作不碰 contract 的部分 |
| 線性依賴 | 建立 stacked/base-chained PR |
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

旁路狀態：

- SUSPECT：heartbeat 超時或 session 不可達。
- HELD_CONFLICT：machine truth 與 registry 不一致。
- HELD_SCOPE_DRIFT：變更超出 scope。
- HELD_EXECUTION_CONTEXT：實際 writer context 無法證明 Git ownership/repository trust。
- HELD_TOPOLOGY_UNSUPPORTED：不在同一 verified common-dir 或要求 multi-host coordination。

Heartbeat timeout 只把 lease 標成 SUSPECT。系統不得因此自動刪 worktree、刪 branch、kill PID、停止 sandbox.exe 或釋放可能仍被使用的 runtime。釋放必須有 owner 結束證據，或 coordinator 在確認 Git/GitHub 狀態後執行可稽核的 reclaim。

## 8. Git branch 與 PR topology

### 8.1 Independent task

每個 root task 從 freshly fetched origin/main 的 exact SHA 建立 sibling worktree 與短生命週期 branch：

origin/main → task-A PR

origin/main → task-B PR

origin/main → task-C PR

這些 PR 可同時建置、測試及 review。

### 8.2 Linear dependency

依賴鏈使用：

origin/main → PR-A → PR-B → PR-C

PR-B 的 base 是 PR-A branch，PR-C 的 base 是 PR-B branch。v1 production path 使用 ordinary GitHub base-chained PR，不把 PR 加入 GitHub native stack object。GitHub stacked PR preview 只可在 Phase 3 shadow canary 評估 UI、webhook 與 API；preview 不可用時不影響 ordinary chain。

Parent 改變時：

1. Child 進入 REBASE_REQUIRED。
2. writer 對 agent-owned branch rebase。
3. push 前記錄 remote expected SHA。
4. 使用 explicit force-with-lease 更新；禁止裸 force。
5. 產出 range-diff 給 reviewer。
6. 失效舊 exact-SHA checks、review 與 E2E evidence。
7. 重新凍結 candidate。

### 8.3 Fan-out dependency

若一個 root contract 支援多個功能：

origin/main → root-contract

root-contract → feature-A

root-contract → feature-B

root-contract → feature-C

Root 尚未 delivered 前，child PR 保持 draft 並只收集開發證據。Root delivered 後，每個 child 重新以 fresh origin/main 為 base，更新 envelope 並各自進入驗證。

### 8.4 Promotion order

Stack 由底向上，一次只提交一個 PR 給既有 autonomous delivery：

1. PR-A 通過並 delivered。
2. fresh fetch origin/main，確認 deployed lineage。
3. PR-B rebase/retarget 到 fresh main，重新驗證 exact head。
4. PR-B delivered 後才處理 PR-C。

Promotion Bridge 只接受 ordinary PR。若 candidate 曾加入 GitHub native stack object，必須先 unstack，將 base retarget 到當時正確的 ordinary branch/main，建立新 generation，重新凍結 exact head，並重跑 checks、review、train 與必要 E2E。Native stack metadata 不得直接送入既有 synchronous exact-SHA merge sink。

若未來要讓 native stack membership 保留到 promotion，必須另開 OpenSpec 擴充 external executor，至少證明 lowest-unmerged-only、asynchronous operation completion reread、head/base drift handling 與逐 PR exact delivery attribution。

禁止：

- 使用 gh stack merge 或網站 stack merge 將整疊一次合併。
- 把 native stack member 直接交給 v1 Promotion Bridge。
- 把多個 PR coalesce 成單一 deployment attribution。
- 以 ancestor containment 取代 exact per-PR merge/deploy evidence。
- 從 integration train branch 合併或部署。

Native Merge Queue、organization transfer、merge_group workflow 與 batch attribution 是未來獨立 OpenSpec delta；不在第一版範圍。

## 9. Throw-away Integration Train

Integration train 的用途是比單一 PR checks 更早發現 candidate 交互作用，不是替代 main 或 develop。

流程：

1. 從 fresh origin/main 建立 ephemeral train worktree/branch。
2. 依 DAG 拓樸與穩定 tie-breaker 合併 exact candidate heads。
3. 從唯一 isolated_runtime_offset[0..4] pool 取得第五槽；若 Computer Use 正在使用就排隊。
4. 使用 canonical isolated runtime manifest 分配 port、state directory、artifact root 與 process ownership。
5. 執行跨 candidate integration checks。
6. 將結果綁定 train generation 與 candidate SHAs。
7. train head 漂移、candidate push 或 baseline 更新時，舊 train evidence 立即失效。
8. train 只在確定 clean、session-owned 且沒有 live runtime lease 後才可刪除。

Failure isolation：

- 單一 candidate 自身測試失敗：只 HELD 該 candidate。
- A 與 B 組合才失敗：標記 dependency edge A↔B，兩者暫停 promotion；C、D 可繼續。
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

GitHub Actions shared-resource group 必須設定 cancel-in-progress: false，並使用 concurrency 下的 queue: max YAML 契約保留至少兩個 pending candidates；queue: max 不得與 cancel-in-progress: true 併用。容量值由 repository policy 固定，不接受 candidate input。驗證必須建立一個 running 加兩個 pending runs，證明第三個 candidate 不會取代第二個 pending。若當前 GitHub plan/runtime 不支援所需 queue semantics，shared-resource job 進入 HELD_QUEUE_CAPABILITY，不得退回會遺失 candidate 的 default pending 行為。

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

Candidate push、parent rebase、base retarget、manifest bytes、trusted source pin、runtime identity 或 command/environment contract 任一改變，都使 Playwright 與 Computer Use evidence立即失效。

Computer Use、manifest、runtime ownership、binder 或 Playwright failure 只凍結該 candidate，標記 HELD_E2E 或 HELD_EVIDENCE_BINDING；其他無依賴 writer 繼續。結束時只停止能以 exact handle、launcher lineage 與雙快照 creation identity 證明 owner 的 runtime。

Computer Use 不得：

- 代替 unit、contract 或 integration tests。
- 在畫面上批准或合併自己的 candidate。
- 操作 sandbox.exe、ACL、Windows owner、firewall 或 Codex installation。

## 12. Authority separation

| Role | 可做 | 不可做 |
|---|---|---|
| Coordinator | 分 DAG、核發 intent、reconcile、決定重新切分 | 自我滿足獨立 review、繞過 delivery authority |
| Writer | 在自己 worktree/scope 實作、測試、推送自己的 branch | 修改他人 branch、擴大 scope、合併 |
| Codex reviewer | 對 exact candidate 執行唯讀分析、產出 findings 與非權威 review packet | source/GitHub 寫入、approval-equivalent verdict、required-check publication、merge |
| Computer Use verifier | 真實 UI 操作與 evidence packet | source/GitHub 寫入、approval-equivalent verdict、merge |
| External machine check App | 以固定 App source 對 exact head SHA 發出 required CheckRun；僅該成功 CheckRun 在既有 OpenSpec activation 後具 approval-equivalent gate 語意 | 使用 candidate credential、修改 branch、merge |
| External delivery executor | 依既有 OpenSpec 執行 merge→deploy→verify | 接受未凍結、多 PR coalesced 或來源不明 candidate |
| Board projection | 顯示 session/task/lease snapshot | 核發 lease、判定 pass、kill process |

monkey1sai Codex reviewer 的角色是獨立、無寫入權的審查計算者；其 review packet 本身不構成 GitHub approval，也不能解除 branch protection。自治審批的唯一 approval-equivalent gate 是 External machine check App 對同一 exact head 發出的 source-pinned required CheckRun；其 activation、來源驗證與 merge authority 仍完全由 autonomous-linux-delivery OpenSpec 擁有。

Promotion Bridge 只接受下列已由 live machine truth 證明的 external target：

- 固定名稱的 exact-head required check 綁定預期 GitHub App source；不同 App、commit status、neutral、skipped、timeout 或 incomplete evidence 均不能等同 success。
- Reviewer execution identity 與 writer/fixer 分離；publisher 只有 read/check publication 所需權限，沒有 contents write 或 merge 權。
- Branch protection 不再要求 monkey1sai-blip counted review、CODEOWNER approval 或任何逐 PR human vote；也不要求 PR author monkey1sai 自我批准。
- 遷移採 add-before-remove：新 App check 先 shadow、再與舊 human gate 雙閘門 canary，證明 rollback 後才把 required approvals 調為零並 retire monkey1sai-blip broker。
- Merge adapter 在每次 mutation 前重新讀取 exact head、required check source、unresolved findings 與 protection snapshot。

以上 activation sequence 仍由既有 autonomous-linux-delivery OpenSpec 擁有；本文件只把它定義為 Promotion Bridge 的必要輸入，避免多 session layer 偷渡第二套 approval path。

## 13. State machine

~~~mermaid
stateDiagram-v2
    [*] --> PLANNED
    PLANNED --> QUEUED_FOR_LEASE
    QUEUED_FOR_LEASE --> ADMITTED
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
    SUBMITTED_TO_DELIVERY --> CLOSED: external DELIVERED

    BUILDING --> HELD_SCOPE_DRIFT
    REVIEWING --> FINDINGS
    E2E --> HELD_E2E
    TRAIN_VALIDATING --> HELD_INTERACTION
    CANDIDATE_FROZEN --> REBASE_REQUIRED
    ADMITTED --> SUSPECT
~~~

SUBMITTED_TO_DELIVERY 之後的 phase、reason、terminal result 與 repair lineage 完全由既有 autonomous-linux-delivery OpenSpec 管理。本設計只保存外部 transaction reference 與結果投影。

## 14. Board 與 sandbox-safe recovery

現行 .agents/board 只能視為 best-effort projection，不能當 lease 或 authority。目標版 projection 必須：

- 從 durable plan/lease Git refs 與 GitHub state 重建。
- register、status、update、done、SessionStart、Stop、SessionEnd 與 Codex turn-complete notify 只更新 projection。
- 所有 board commands、hooks 與 notify 都不得呼叫 lifecycle maintenance、orphan cleanup、detached launcher、process/listener scan 或 runtime stop。
- 不因 stale heartbeat 自動 prune unknown worktree。
- 不執行 PID kill、branch/worktree prune、ACL/owner 修改或 sandbox repair。
- 若保留獨立 cleanup 工具，它不得是 board 或 Fabric admission/reconcile/drain 的隱含副作用。

Orchestration 必須存在 Git/GitHub durable state，不存在 Codex App parent process。Codex App crash 或 sandbox.exe 重啟後，新 coordinator 執行 reconcile 即可恢復：

1. 讀 plan generation 與 lease registry。
2. 比對 worktree、branch、remote ref、PR head 與 checks。
3. 把無 owner heartbeat 但仍有 Git evidence 的工作標成 SUSPECT。
4. 要求顯式 reclaim；不自動刪除或終止。
5. 重新核發可證明未使用的資源。

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
| GitHub stack preview unavailable | 不阻塞 | fallback 普通 base-chained PR |
| Native stack candidate 準備 promotion | 不接受 | unstack、new generation、全量重驗 |
| Candidate push during train | train evidence invalid | 建立新 train generation |
| Manifest/verifier/runtime binding 失敗 | HELD_E2E / HELD_EVIDENCE_BINDING | 修復後以同 manifest、新證據重驗 |
| Shared runtime busy | queue | 等待 lease；不可取消 owner |
| CI queue capability 不足 | HELD_QUEUE_CAPABILITY | 不退回 default single-pending cancellation |
| Integration interaction fail | HELD_INTERACTION 限候選/依賴邊 | 最小組合重現 |
| Delivery authority HELD | SUBMITTED_TO_DELIVERY 保持外部 HELD | 不繞過；依既有 OpenSpec 修復 |
| Fabric metadata defect | 停止新 admission | 回退 single-writer live policy；保留 branches/worktrees |

Rollback 不需要回滾 Git commits：停用 Fabric admission、凍結新 lease、保持既有 worktree/PR，讓每個 owner 在安全點 handoff；live policy 回到 Single Active Writer。不得以批次刪 branch、worktree 或 process 作 rollback。

## 16. Activation phases

### Phase 0 — Governance reconciliation

先調和 Single Active Writer 與 active autonomous delivery OpenSpec 的 stale self-referential closure。未完成前本文件只有設計效力。

### Phase 1 — Board cleanup decoupling and shadow registry

Phase 2 以前，先把 board projection lifecycle 與 cleanup 完全解耦：

1. register、update、done 只能讀寫 projection。
2. SessionStart、Stop、SessionEnd 與 Codex turn-complete notify 同樣只能更新 projection。
3. Board 不得 process/listener discovery、PID termination、runtime stop、worktree/branch prune 或 ACL/owner/sandbox repair。
4. 獨立 cleanup 工具不得由 board 或 Fabric 隱含呼叫。
5. 單一 writer 以 shadow mode 產生 delivery-plan、lease 與 candidate projection；不阻擋 live flow，也不自動建 workspace。

Executable negative tests 必須逐一證明 register、update、done、各 lifecycle hook 與 Codex notify 具有 zero orphan-cleanup invocation、zero detached child、zero process/listener scan、zero PID termination、zero worktree/branch prune。唯讀 Git metadata query 不算 cleanup。任一失敗即禁止 Phase 2。

### Phase 2 — Four-writer disjoint canary

只有 Phase 1 negative tests 全部通過才可開始。由四個不同 Codex App top-level task/session 實作四個明確不重疊的小型 task；不得以同一 coordinator 的 nested child、共用 execution context 或代跑 preflight 取代。

每個 writer 必須：

1. 在自己的 execution context 通過 EXECUTION_CONTEXT_PREFLIGHT。
2. 取得不同 task/thread id、execution-context binding、branch、sibling worktree 與 disjoint scope lease。
3. 至少寫兩次相隔 30 秒的 heartbeat；四個 heartbeat interval 至少共同重疊 30 秒。
4. 各自產出 scope-disjoint commit、PR-head exact SHA 與綁定該 SHA 的 check result。
5. 四者都完成 preflight 與 overlap 後，以 test harness 停止其中一個 heartbeat 模擬 crash，不 kill sandbox.exe、PID 或 runtime；該 lease 只變 SUSPECT，其餘三個完成 commit、check 與 evidence binding。

本 phase 同時執行六方 runtime lease 負測試：六個不同 task/session 對 isolated_runtime_offset[0..4] 同時提出 intent，恰有五個不同 ACTIVE resources，第六個 QUEUED_FOR_LEASE；不得重複 offset、覆寫 winner、取消 owner 或以 train/Computer Use 身分繞過互斥。

任何 execution identity 重複、scope overlap、heartbeat 未重疊、crash 波及其他 writer、六方 admission 結果不符，或出現 cleanup/process mutation，都使 Phase 2 失敗。

### Phase 3 — Stack and fan-out canary

各選一條兩層 ordinary base-chained PR 與一個 root-plus-two-child fan-out。GitHub native stack object 僅作 shadow API/UI canary；只驗證開發/review/rebase/unstack，不啟用 native 或 atomic stack merge。

### Phase 4 — Train and Computer Use canary

啟用互斥的單一 integration train／Computer Use runtime slot；以同一 canonical manifest 對 exact SHA 執行 require-real Playwright + independent Computer Use 雙證據，驗證 head/manifest drift、trusted harness pin、reserved-port preflight、runtime ownership、failure isolation 與 evidence invalidation。Candidate 修改 harness 的 canary 只能得到 shadow evidence。

### Phase 5 — Promotion bridge

只在 autonomous-linux-delivery 已完成 activation 且 current machine truth 證明可用後，逐 PR bottom-up 提交。任何 external HELD 直接投影，不建立 bypass。

### Phase 6 — Optional organization-native queue

若未來 repository 轉為符合資格的 organization repository，另開 OpenSpec 評估 Merge Queue、merge_group checks 與 per-PR delivery attribution。本 phase 不由目前設計自動啟用。

## 17. Acceptance criteria

設計實作完成必須由 executable evidence 證明：

1. 四個不同 Codex App top-level writer sessions 各自在自己的 execution context 通過 preflight，從同一 fresh origin/main 建立不同 sibling worktrees；tracked main 保持 clean，四個 heartbeat interval 至少重疊 30 秒，且各自產出 scope-disjoint commit、exact head 與 check。
2. Test harness 中斷一個 writer heartbeat 後，該 lease 只變 SUSPECT；其餘三個 writer 持續完成，不刪 worktree、不 kill PID、不觸碰 sandbox.exe/ACL/owner。
3. 同一 common-dir 的 CAS race 中，相同 resource_key 恰有一個 winner；不得雙重核發。不同 common-dir 或 multi-host request 必須 HELD_TOPOLOGY_UNSUPPORTED。
4. Canonical path normalization、Windows case folding、glob intersection、rename old/new path、new-file parent scope 與 shared resource IDs 能 deterministic 判定 overlap；無法證明 disjoint 一律 queue。
5. Commit/push 前的 NUL-safe changed-path 重驗若發現未宣告 contract/path/symbol，candidate 進入 HELD_SCOPE_DRIFT。
6. 四個 writer 必須各自證明 Git repo/common-dir/HEAD/status/ownership trust；任一 dubious ownership 只產生 HELD_EXECUTION_CONTEXT，不以 safe.directory、ACL/owner 或重裝補位。
7. 六個不同 task/session 同時請求 isolated_runtime_offset[0..4] 時，恰有五個不同 ACTIVE leases，第六個 QUEUED_FOR_LEASE；不得重複、覆寫、取消 owner 或繞過 train/Computer Use 互斥。
8. Parent SHA 改變後，所有 child checks、review、train 與 E2E evidence 失效。
9. Rebase update 使用明確 expected remote SHA 的 force-with-lease，並附人工可讀 range-diff。
10. GitHub stack preview 不可用時 ordinary base-chained PR 不受影響；曾加入 native stack 的 candidate 必須 unstack、建立新 generation 並重驗後才可 promotion。
11. Integration train 只合成測試，不可合併到 main，也不可作 canonical deployment source；任一 input SHA 改變使舊 evidence 失效。
12. Canonical E2E_REQUIRE_REAL=1 Playwright 與 Computer Use 使用同一 physical E2E_STACK_MANIFEST、manifest_sha256、stack kind、ports/base URLs 與 exact head；任何不一致回傳 HELD_EVIDENCE_BINDING，durable packet 只保存 path digest/equality result。
13. Manifest bytes digest 在服務啟動前與 publication 前相同，且 manifest head、candidate envelope head、worktree Git HEAD 三者相等。
14. Offset domain、reserved-port intersection、manifest path/kind/ports/base URLs/env mismatch 的拒絕都發生在 listener query、cleanup、服務啟動與 browser spec 前；拒絕時沒有 process mutation。
15. Verifier/binder 來源是 prior trusted/base-pinned immutable SHA；candidate 修改 canonical harness 只能產生 shadow evidence，不得進入 train、promotion 或 delivery。
16. E2E evidence 含 route、button、fixture、API、runtime ID、visible state、network、trace、screenshot、command records、runtime/listener/lineage digests 與 reserved-port guard；raw host identity 只留 host-local attestation。
17. E2E 或 interaction failure 只凍結相關 candidate/edge，其他無依賴 writer 持續。
18. register/update/done、所有 lifecycle hooks 與 Codex notify 的負測試證明 zero cleanup invocation、zero detached child、zero process/listener scan、zero PID termination、zero branch/worktree prune。
19. Board projection 遺失後可由 Git/GitHub durable state 重建，且 board 不可核發 lease、pass 或 process authority。
20. Per-PR CI 不因錯誤 concurrency key 互相取消；shared-resource group 使用 cancel-in-progress:false 與 concurrency queue: max，且兩者不採互斥的 true/max 組合；測試一個 running 加兩個 pending 時無 candidate 遺失。
21. Promotion 一次只交付一個 ordinary PR，保有 PR head → merge commit → fresh origin/main → deployed commit 的精確歸因。
22. 不使用 gh stack merge、native stack member direct promotion、batch merge、ancestor containment 或 train SHA 取代逐 PR delivery proof。
23. Writer、Codex reviewer、Computer Use verifier、External machine check App 與 delivery executor 的權限由測試證明互不替代。
24. Codex reviewer 只能產出無權威 computation；只有正確 App source、exact SHA、required success 的 CheckRun 可作 approval-equivalent gate。Review text、commit status、neutral/skipped/timeout CheckRun 或 candidate credential 都不可替代。
25. 任一安全 gate 不可判定時回傳 HELD/UNKNOWN，不以 human-pressure bypass、legacy flag 或 provider substitution 前進。
26. Fabric 的 admission、reconcile、drain、rollback 與 session lifecycle 都不得修改 sandbox.exe、Codex installation、ACL/owner、firewall，或清理 unknown process/worktree。

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

## 19. Non-goals

第一版不包含：

- 永久 develop/release/hotfix branch。
- 讓多 session 共同寫同一 worktree。
- 修改 Codex App sandbox.exe、安裝目錄、ACL、owner 或 Windows account。
- 自動清除未知 process/worktree。
- Candidate 自我審查、自我批准或持有 merge credential。
- Atomic stack merge 或多 PR batch deployment。
- 以 Merge Queue 取代既有 autonomous delivery。
- 修改 production、部署目標、secret broker 或 GitHub App activation。
- 自動產生 implementation plan、開始實作、push、開 PR 或 merge。

## 20. Implementation handoff gate

本 design spec 經使用者明確核准後，才可使用 Superpowers writing-plans 建立 implementation plan。Plan 必須先處理 Phase 0 的 canonical OpenSpec/governance reconciliation，並在任何 runtime 或 GitHub authority 變更前通過 strict OpenSpec lifecycle validation。

在使用者核准前，停在 written-spec review gate。
