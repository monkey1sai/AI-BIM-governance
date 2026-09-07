## ADDED Requirements

### Requirement: Repo session admission 不得設定 writer 數量上限

當每個 session 使用獨立 branch 與 sibling worktree，且未偵測到 branch／worktree／scope 衝突時，Parallel Delivery Fabric SHALL 允許任意數量的 writer session 進入。`requested_capacity.writers` SHALL 只描述 plan-local 的執行請求，activation record 的 `writer_cap` SHALL 只描述 review／`direct_stack` authority，兩者皆 SHALL NOT 作為 repo session admission 的上限。

#### Scenario: 第三個隔離 writer 啟動

- **WHEN** 已有兩個 writer session 活躍，第三個 session 提出獨立 branch、sibling worktree 與不衝突的 scope
- **THEN** 第三個 session 被 admit，不以已佔用的 writer 數量作為阻擋條件

### Requirement: 每個 Fabric-managed spec-to-done run 必須綁定單一 delivery slice

Fabric-managed 的 `spec-to-done` run SHALL 精確綁定一組 `plan_id`、`generation`、`task_id`、`lease_id`、`owner_session`、provider、`scope_digest`、`baseline_sha`、branch 與 worktree identity。該 run 在此 binding 內 SHALL 只有一個 writer；其他彼此獨立的 binding MAY 同時執行。

#### Scenario: 兩個獨立的 spec-to-done slice 同時執行

- **WHEN** Fabric admit 兩個 task，各自持有不同的 binding 與隔離的 branch／worktree
- **THEN** 每個 task 各跑自己的單一 writer `spec-to-done` 生命週期，不施加 repo 全域的 writer 上限

#### Scenario: binding tuple 漂移

- **WHEN** plan、generation、task、lease、scope、baseline、branch 或 worktree identity 任一項與 binding packet 不同
- **THEN** 該 run 被 fail closed 拒絕，且 SHALL NOT 以新的 tuple 替代

### Requirement: Fabric-managed state 必須有由 binding 衍生的唯一 identity

系統 SHALL 以 canonical 不可變 binding tuple 衍生小寫 SHA-256 的 `binding_id`，並 SHALL 將 binding packet 存於 `artifacts/spec-to-done/bindings/{binding_id}.json`。其 durable state SHALL 使用 `artifacts/spec-to-done/{slug}--{binding_id}-state.md`，且每個 managed checkpoint SHALL 保留相同的 `fabricBindingId`。

沒有 Fabric binding 的 standalone run SHALL 維持 legacy 路徑 `artifacts/spec-to-done/{slug}-state.md` 的有效性。

#### Scenario: 平行 task 重用同一個 slug

- **WHEN** 兩個 Fabric task 使用相同的 spec slug，但 task 或 lease identity 不同
- **THEN** 不同的 binding digest 產生不同的 state 路徑，任一 state 都無法覆寫另一個

#### Scenario: 驗證 legacy standalone state

- **WHEN** 一份 binding 之前的 standalone state 不含任何 Fabric binding 欄位，且使用 legacy canonical 路徑
- **THEN** validator 套用既有 standalone 契約，不憑空捏造 Fabric lease

### Requirement: allowed paths 必須落在 Fabric touch-set 內

每個 Fabric-managed run SHALL 宣告 canonical、唯一、repo-relative 且保留 Git 大小寫路徑 identity 的 `allowed_paths`。binding validator SHALL 證明每個 allowed path 都被選定 Fabric task 的 path、glob 或 rename resource 涵蓋。state validator SHALL 證明自綁定的 `baseline_sha` 到綁定的目前 HEAD 之間每個已提交路徑都精確存在於 `allowed_paths`（rename 的兩端皆須包含）。缺漏、模糊、僅共享、未涵蓋或超出 scope 的已提交路徑 authority SHALL 回傳 `scope_drift`；workflow SHALL NOT 自動擴張 touch-set。

#### Scenario: 實作路徑超出 task scope

- **WHEN** `allowed_paths` 含有未被綁定 task scope 涵蓋的路徑
- **THEN** binding 驗證在 P3 之前回傳 `scope_drift`，且沒有任何檔案被修改

#### Scenario: 已提交路徑超出 binding touch-set

- **WHEN** 自綁定 baseline 到綁定目前 HEAD 的 NUL 分隔已提交 diff 含有未精確存在於 `allowed_paths` 的路徑
- **THEN** state 驗證回傳 `scope_drift`，該 run 無法前進

#### Scenario: scope authority 無法解析為路徑

- **WHEN** task 只宣告共享 contract 或 symbol，未對某個 allowed 檔案提供明確的 path／glob／rename resource
- **THEN** 該路徑視為未證明，run 維持 HELD

### Requirement: HELD 必須保留 Fabric lease，且 local resume 必須 fail closed

Fabric-managed 的 `spec-to-done` run 進入 HELD 時，SHALL 只停止該 delivery slice、保留綁定的 lease，並請求 Fabric 將其執行上下文標示為 `SUSPECT`。它 SHALL NOT 呼叫 release、reclaim、建立替代 lease，或以 `NEW_RUN@P0` 把 run 搬到另一個 worktree。

managed 的 `RESUMED` checkpoint SHALL 要求 Fabric 驗證過的 `RESUME_INTENT`，以及與 plan／task／lease／scope／branch／worktree／head tuple 完全一致、由 authority 綁定的替代執行上下文。在該 authority 存在之前，驗證 SHALL 回傳 durable 的 execution-authority hold。

#### Scenario: managed run 被 hold

- **WHEN** Fabric-managed run 的任一 P0–P6 gate 回傳 HELD
- **THEN** 該 run 停止，其 lease 被保留或標示為 `SUSPECT`，且不進行任何 local release 或替代

#### Scenario: session 嘗試在本機 resume

- **WHEN** managed state 在沒有 Fabric 驗證過的 rebind authority 下附加 `RESUMED`
- **THEN** 驗證以 durable 的 execution-authority hold 拒絕該轉換，且不啟動另一個 implementer

### Requirement: binding 證據不得授予 delivery authority

binding packet SHALL 是非機密的 control metadata，且 SHALL NOT 授權 push、approve、merge、deploy、終止 process、變更 branch protection、review migration 或 `direct_stack`。這些操作 SHALL 繼續受既有的 activation 與外部 authority gate 管制。

#### Scenario: 有效的 binding 請求 direct_stack

- **WHEN** binding packet 結構有效，但沒有 canonical Fabric activation record 授權 `direct_stack`
- **THEN** `direct_stack` 維持 HELD，binding 只能授權有界的本機 delivery slice
