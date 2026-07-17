## ADDED Requirements

### Requirement: 每次conversion execution SHALL 通過相同runtime admission

Automatic enqueue、manual trigger 與 retry SHALL 在 execution 前通過同一 runtime admission。Admission evidence SHALL 至少包含 `required_runtime_capabilities[]`、`admission_status`、`runtime_profile`、`requires_exclusive_runtime`、nullable `lease_id`、`readiness_evidence[]`、`blocker_codes[]` 與 `observed_at`，且 SHALL 不綁死 queue vendor、service topology 或 port。此欄位只描述runtime能力；user authorization另由external capability decision裁決。

#### Scenario: Kit-backed runtime已就緒

- **WHEN** required runtime capabilities 全部滿足、runtime health READY、exclusive profile lease有效且無 blocker
- **THEN** admission SHALL 通過
- **AND**系統 MAY 配置新的 attempt 並開始 conversion

#### Scenario: Runtime admission發現阻擋項

- **WHEN**任一 required runtime capability/readiness條件不滿足，或exclusive profile lease不滿足
- **THEN** execution SHALL 不開始
- **AND** admission response SHALL 回報具體 blocker codes/evidence

#### Scenario: CPU／non-exclusive profile已就緒

- **WHEN** profile的 `requires_exclusive_runtime=false`、required runtime capabilities與readiness evidence全部滿足
- **THEN** admission MAY 以 `lease_id=null` 通過
- **AND**系統 MUST NOT 為滿足 schema建立假 Kit lease

### Requirement: Capacity wait SHALL 不消耗 attempt

缺少可用 runtime capacity SHALL 表達為 `WAITING_CAPACITY`，保持 logical job 可恢復，且 MUST NOT 配置 attempt、增加 attempt counter 或用任意固定 timeout 轉為 semantic failure。

#### Scenario: 佇列等待Kit容量

- **WHEN**所有 inputs 有效但沒有可租用的 Kit/runtime slot
- **THEN** job SHALL 保持 `WAITING_CAPACITY`
- **AND** attempt count SHALL 不變

### Requirement: Runtime lease SHALL 防止衝突 execution

Kit-backed attempt SHALL 持有可驗證且具期限/owner 的 runtime lease。Lease loss、stale ownership 或 readiness regression SHALL 阻止新的 execution；系統 SHALL 保存 admission/lease evidence 供 recovery 與 audit。

#### Scenario: Lease 在 execution 前失效

- **WHEN** admission 通過後、attempt 啟動前 lease 已失效
- **THEN** attempt SHALL 不開始
- **AND** job SHALL 重新進入 admission，而非消耗失敗 attempt

### Requirement: Kit release SHALL 先 cooperative 並保護 live users

系統 SHALL 先執行 cooperative drain/close/release，且 SHALL NOT 自動終止仍有 active viewer/session 的 Kit process。Force release 的 `eligible_reason` SHALL 明確為 `stale_lease`、`runtime_failed` 或 `cooperative_release_failed` 任一；具 `runtime.force_release` capability 的 operator還必須提供 reason、明確確認並建立 append-only audit。若 runtime仍有healthy active viewer/session，force release SHALL 被拒絕，即使 cooperative release失敗。

#### Scenario: Kit 正在服務 live session

- **WHEN** operator 或 scheduler 要求釋放仍有 active viewer/session 的 Kit
- **THEN**自動 force kill SHALL 被拒絕
- **AND** UI/API SHALL 顯示 blocking session/lease evidence

#### Scenario: Force release 合法

- **WHEN** eligible reason為 `runtime_failed`、`stale_lease` 或 `cooperative_release_failed` 任一，且沒有healthy active viewer/session
- **AND** operator 具 `runtime.force_release`、提供 reason 並確認
- **THEN**系統 MAY force release
- **AND** SHALL 記錄 actor、reason、evidence、affected runtime/session 與結果
