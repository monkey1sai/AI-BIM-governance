# Fabric binding — conditional

不同 Fabric binding 可在各自 branch/worktree 併行；本 run 仍只有一個 writer。
每個 phase 前後都比對 planned/changed paths 與 binding allowed_paths；超出即 scope_drift，不能擴張 scope。

### Parallel Delivery Fabric profile（outer control plane；不建立第二套引擎）

- Fabric-managed run 只在 outer Fabric 已交付 `spec-to-done-fabric-binding/v1` packet 與上述四份 current evidence 時啟動。binding 固定一個 `plan_id/generation/task_id/lease_id/owner_session/provider/scope_digest/baseline_sha/branch/worktree_path_digest`，P3 仍只有一個 implementer。
- v1 binding 的 `delivery_authority.push=false`，且 validator 輸入與 durable state 都不含 execution envelope：**Fabric-managed run 不進入 P6**——P5 收斂後即以 `HELD@P5`／`fabric_resume_authority_unavailable`／`return-control-to-parallel-delivery-fabric` 結束本 slice；validator 拒絕任何 Fabric-managed 的 P6／P7 checkpoint。push／PR／merge 只能由 outer Fabric 以 `push_owned_branch`／`open_draft_pr` 以上等級的 execution envelope 另行授權執行。
- `session_admission_limit=unbounded`：repo 可同時有任意數量 writer，只要各自使用獨立 branch、sibling worktree且 Fabric 判定 scope 不衝突。`run_writer_cardinality=1` 只限制本 binding。不得讀 occupied writer count 作 admission blocker；`requested_capacity.writers` 只是 plan-local request，activation `writer_cap` 只屬 review／`direct_stack` authority。
- `allowed_paths` 是該 delivery slice 的最大可寫集合，必須已由 Fabric path/glob/rename scope 證明。P1 plan、P3 edits、tests、docs 與 task ledger 都不可超出；shared contract/symbol 未解析成 path 時回 `scope_drift`，不得補猜或自動擴張。
- binding packet 是 non-authorizing metadata：不授權 push、approve、merge、deploy、process stop、branch-protection mutation、review migration 或 `direct_stack`；P5–P7 既有 gates 完整保留。
- managed HELD 只停止本 binding，lease 不 release/reclaim，交回 Fabric 保留並標記/維持 `SUSPECT`。v1 沒有 verified rebind receipt，所以 local `RESUMED` 固定 `fabric_resume_authority_unavailable`，local `NEW_RUN` 固定拒絕；要繼續只能由 Fabric 建立新 task/lease/binding 後啟一個新的 state identity。

`resume`、retry、換 session／CLI 永遠不得重設 counter。唯一例外是有效 terminal
`HELD@P<n> reason=run_budget_exhausted`、至少一個固定 counter 精確到頂，且 owner 對舊 state tuple 與
fresh descendant worktree 明確啟動新 run。先唯讀執行
`node .claude/skills/spec-to-done/append-new-run.mjs status --state <absolute-state-path> --json`；不得靠聊天
記憶猜測。只有當輪 exact owner message 存在時才能呼叫同檔 `append`，不得手寫 `NEW_RUN@P0`。
上述 `NEW_RUN` 例外只適用 standalone state。Fabric-managed status 固定回 `fabricManaged=true`、
`canStartNewRun=false` 與 `return-control-to-parallel-delivery-fabric`；即使 owner 另行同意也不得 local append。
`--git-exe` 只能選 owner 安裝的 system Git：Windows 的
`C:\Program Files\Git\{cmd,bin,mingw64\bin}\git.exe`，或 POSIX 的 `/usr/bin/git`／`/usr/local/bin/git`；
不得使用 `Get-Command git`、PATH proxy、repo 內工具或 caller-writable binary。helper 保留舊 state 每個 byte，
綁定全檔 hash/size/checkpoint count、terminal hash、Git executable path/hash/size/trust class、
git-dir/common-dir 與舊/新 Git identity
與 ancestry，再以 lock + atomic replace + validator readback 寫入。provenance marker 明說它只是 SHA-256
tuple binding，不是數位簽章或 owner 身分驗證。`status --json` 的 `nextAction` 與
`appendRequiredArguments` 是後續 session 的 machine-readable 指引；NEW_RUN 只建立 P0 rollback point，
不得宣稱任何 P0–P7 gate 已通過。
