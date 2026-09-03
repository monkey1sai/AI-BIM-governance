## Context

Parallel Delivery Fabric 是 repo session 的外層 control plane，已持有 plan、task scope、provider session、lease、branch、worktree digest 與 resume-intent vocabulary。`spec-to-done` 是內層 delivery slice，目前 durable state 只以 slug 命名，並把 P3 單一 implementer 描述成流程內限制；它尚未消費 Fabric tuple，也無法區分同 slug 的平行 task。

這次變更屬 repo agent-governance/tooling mechanism surface。Persistent source of truth 分工如下：Fabric plan/task/lease/provider-session records 擁有 session admission 與資源生命週期；`spec-to-done` state 擁有該 delivery slice 的 P0/P1/P3/P4/P5/P6/P7 checkpoint；binding packet 只是兩者的 immutable、non-authorizing 對照快照，不取代任何 authority record。

## Goals / Non-Goals

**Goals:**

- 允許 repo 同時存在任意數量、以 branch／sibling worktree 隔離的 writer session，不用 writer count 拒絕 admission。
- 將一個 `spec-to-done` run 限定為一個 Fabric task／lease 的單一 writer delivery slice。
- 以 machine-verifiable tuple、scope containment 與 unique state identity 防止 task 擴張、state collision 與錯誤 resume。
- 保留既有 standalone `spec-to-done` state 的讀取相容性。
- 在目前 Fabric resume authority 尚未啟用時，對 Fabric-managed local resume 明確 fail closed，而不是建立替代恢復引擎。

**Non-Goals:**

- 不限制 repo／workspace writer 數量。
- 不變更 `direct_stack`、counted review、approve、merge、deploy 或 branch protection authority。
- 不修改產品 service、API、event、storage、browser session、GPU／Kit runtime。
- 不啟動 Fabric `CANARY_ACTIVE`／`AUTONOMOUS_ACTIVE`，不修改 historical lifecycle ledger。

## Decisions

### 1. Fabric 是 outer control plane，spec-to-done 是 single-slice inner workflow

Fabric admission 只依 branch、worktree 與 scope conflict；occupied writer count 只可做 observation，不可成為 admission blocker。每個 admitted task 可啟動一個 `spec-to-done` run；P3 的 single implementer 約束只作用於這個 binding，不作用於 repo 其他 branch/worktree。

替代方案是讓 `spec-to-done` 自行管理多 writer／多 branch。拒絕此方案，因為它會複製 Fabric admission、lease、crash recovery 與 integration-train 職責，重新產生兩套互相漂移的控制面。

### 2. 使用獨立 binding packet，不改寫 Fabric durable records

新增 `spec-to-done-fabric-binding/v1` packet。它包含 Fabric plan、selected task、session lease、provider-session envelope 的 bounded snapshot，以及 `slug`、`allowed_paths` 與 derived state path。validator 會呼叫既有 Fabric parser／canonical digest／scope predicate，檢查以下 exact tuple：

`plan_id, generation, task_id, lease_id, owner_session, provider, scope_digest, baseline_sha, branch, worktree_path_digest`。

`binding_id` 是上述 immutable tuple 加 slug／allowed paths 的 canonical SHA-256。packet 固定記錄 `lease_state_at_binding=ACTIVE`；current lease 的 `ACTIVE`／`SUSPECT` 與 heartbeat、目前 HEAD 等可變觀測值不進入 binding digest，改由每次驗證 current source 時檢查。packet 不含 credential，也不授權 push、merge 或 lease transition。

### 3. Session capacity 名詞分層，不做破壞性欄位 rename

現有 `requested_capacity.writers` 保留為單一 plan 的 requested execution contexts；activation record 的 `writer_cap` 只描述 review／`direct_stack` authority；shared runtime 的 capacity 仍由 runtime admission 管理。session admission 沒有 cap 欄位，binding contract 固定 `session_admission_limit="unbounded"` 與 `run_writer_cardinality=1`。

這次不 rename 既有 persisted fields，避免讓 active Fabric change 的 fixtures、registry bytes 與歷史 evidence 發生不必要 migration；以 schema description、contract constants 與 negative tests消除語意誤用。

### 4. Fabric-managed state 使用 binding digest 衍生路徑

Standalone run 繼續使用 `artifacts/spec-to-done/{slug}-state.md`。Fabric-managed run 使用：

`artifacts/spec-to-done/{slug}--{binding_id}-state.md`

每個 managed checkpoint 必須帶 `fabricMode=fabric-managed` 與 `fabricBindingId=<64-hex>`；binding packet 固定放在 `artifacts/spec-to-done/bindings/{binding_id}.json`。validator 會檢查 packet、state path、actual branch/worktree/HEAD 與 audit-chain 全程 binding identity 不變。

### 5. Scope containment 重用 Fabric predicate

`allowed_paths` 必須是 canonical、去重且保留 Git 大小寫身分的 repo-relative exact paths，並以既有 `evaluateScopeDrift` 對 selected task 的 scope resources 驗證。path／glob／rename 可被覆蓋；shared contract／symbol 未能解析成 path 時不推測，回 `scope_drift`。state validator 另以 NUL-delimited name-status 驗證 `baseline_sha..current_head_sha` 的 committed paths（rename 同時檢查 old/new path）；任何未列入 `allowed_paths` 的路徑皆回 `scope_drift`。執行中的 dirty changed paths 仍需通過既有 Fabric scope revalidation 與 GitNexus gate。

### 6. HELD 保留 lease；v1 禁止 local resume

Fabric-managed `HELD` 不得呼叫 release／reclaim／new-run helper；binding validator 只接受 lease `ACTIVE` 或 `SUSPECT`，並回報 `retain_lease_as_suspect`。`RELEASED`、新 lease、branch/worktree/scope tuple 漂移全部 fail closed。

`RESUMED` 必須由 Fabric 先驗證 exact `RESUME_INTENT` 並產生新的 authority-bound execution context。候選 Fabric 現況仍回 `resume_authority_activation_unavailable`，所以 v1 validator 對 managed `RESUMED` 固定 HELD；不在 `spec-to-done` 內實作第二套 rebind engine。未來 Fabric authority 啟用時以另一個 reviewed change 加入 verified rebind receipt。

### 7. Compatibility 與 adapter parity

Machine contract 升級到 v2，但 legacy state 未帶 Fabric fields 時仍按原 standalone path與規則驗證。Claude skill 仍是程序權威；Codex skill 只加入等價 binding args／HELD 語意。共同 validator 只有 `.claude` 一份，Codex 不新增副本。

## Risks / Trade-offs

- [Risk] Binding packet 是 repo-local snapshot，可能被 caller 修改。→ Mitigation：canonical digest、closed schema、exact Fabric parser、actual Git identity 與 state-path revalidation；packet 明確不授權外部效果。
- [Risk] Fabric contract 後續 hardened main 造成 binding drift。→ Mitigation：以 freshly fetched `origin/main` 作唯一整合基線，binding fixture、schema 與 parser 接受集合必須通過 current-main regression tests。
- [Risk] Fabric-managed budget exhaustion 原本會建立 fresh worktree 的 `NEW_RUN`，與原 lease identity 衝突。→ Mitigation：managed run 禁止 local `NEW_RUN`；必須由 outer Fabric 建立新 task／lease／binding與新 state，舊 audit chain保持 terminal。
- [Risk] shared resource 無法直接解析成檔案。→ Mitigation：不猜測映射，要求 explicit path/glob/rename scope，否則 `scope_drift`。
- [Trade-off] v1 不讓 Fabric-managed run自行恢復。→ 這是刻意的 fail-closed boundary；比假造 resume authority 或跨日盲重試更容易收斂。

## Migration Plan

1. 新增 binding contract、schema、pure validator 與 deterministic tests。
2. 升級 `spec-to-done` machine contract與共同 state validator，legacy mode保持相容。
3. 同步 Claude／Codex skill 文件與 Fabric operator文件。
4. 跑 affected Node/Python tests、governance checks、OpenSpec strict validation與 GitNexus detect-changes。
5. Closeout 前整合 Fabric母分支新 head；若 contract tuple 漂移，先更新本 change artifacts與 tests，不用 compatibility guess。

Rollback 是撤回本 change 的單一 commit／PR；它沒有 external activation、runtime 或 data migration。既有 standalone state 與 Fabric records不需改寫。

## Open Questions

Fabric verified rebind receipt 的正式 schema與 activation 時點留給後續 source-pinned change；在此之前 managed resume保持 HELD。
