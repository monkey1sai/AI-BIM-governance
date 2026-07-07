## ADDED Requirements

### Requirement: runtime mutator 指令 SHALL 經前端 UX 閘門與 Kit 端 defense-in-depth 授權檢查

治理面板送往 3D viewer runtime 的 mutating 指令（highlight / focus / stage load / artifact binding）SHALL 先經前端中央 `_sendStreamMessage` 的三道 UX 閘門（primary role、viewer lease token 非空、session lifecycle 非阻擋）；SHALL 再經 Kit 端 `is_authorized_mutator` 的 defense-in-depth 檢查（要求 payload `role=="primary"` 且 `session_id`/`lease_token` 非空）。lease 簽發、spectator 唯讀與 token 真偽的**權威層 SHALL 為 coordinator**；Kit 端目前 SHALL 為形狀檢查（不回 coordinator 驗 token 真偽，追蹤於 follow-up issue #307）。前端 UX 閘門 SHALL NOT 被當成安全邊界（直呼 DataChannel 可繞過）。

#### Scenario: spectator 明示唯讀角色的 mutating 指令被拒

- **WHEN** 一個 spectator（`role!=="primary"` 或缺 lease token）送出 mutating 指令
- **THEN** 前端 SHALL 略過送出並記錄阻擋原因，Kit 端 `is_authorized_mutator` SHALL 回 false 使 handler 拒絕

#### Scenario: primary 帶合法 lease 的 mutating 指令通過閘門

- **WHEN** primary viewer 已由 coordinator 取得 viewer lease token 且 session lifecycle 未阻擋，送出 `loadArtifactGroupRequest`
- **THEN** 指令 SHALL 通過前端 UX 閘門與 Kit 端授權檢查並套用，`binding_revision_id` SHALL 隨 `openedStageResult` 回傳供前端宣告 applied

### Requirement: mapping table 選列 SHALL 為 UI-local，不觸發 runtime mutator

治理面板 mapping table 的選列 SHALL 只更新前端語意面板狀態（UI-local），SHALL NOT 送出任何 runtime mutator（如 `focusPrimRequest`）。USD tree node 的選取 SHALL 送出 `selectPrimsRequest` 與 `focusPrimRequest`（reverse-jump 到 3D focus）。

#### Scenario: 點擊 mapping row 更新語意面板但不送 runtime mutator

- **WHEN** 使用者點擊一列 mapping row
- **THEN** 語意面板 SHALL 更新，且對外 DataChannel log SHALL NOT 含 `focusPrimRequest`

### Requirement: coordinator SHALL NOT 提供通用 runtime operations endpoint

runtime mutator SHALL 只走 Kit 端 DataChannel + 授權閘門；coordinator SHALL NOT 提供通用 `/operations`、`/viewer-operations`、`/operation-log` 類 runtime operations 代理路由。此邊界 SHALL 有 committed 回歸測試守衛。

#### Scenario: 通用 operations 路徑未被路由

- **WHEN** 對 coordinator 送出 `GET` 或 `POST /api/operations`（或 `/operations`、`/viewer-operations`、`/operation-log` 等）
- **THEN** coordinator SHALL 回 404（未註冊），且既有合法路由（如 `/health`）SHALL 仍為 200
