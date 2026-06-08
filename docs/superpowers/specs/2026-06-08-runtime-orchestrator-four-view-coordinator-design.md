# C / Hybrid Runtime Orchestrator 四視角 Coordinator 控制台 · Design Spec

> 日期：2026-06-08 · 狀態：設計草案，待使用者 review
> 對應目標：`https://bim-docs.jackshappybot.com/`「02 Coordinator 控制台」與本機 `C:/Repos/design/bim-desigin-arich/project`
> 目標落點：`/ui#/coordinator`（由 coordinator `:8004` 對外提供的 operator console）
> 本檔是設計補充文件，不含 production code。

## 1. 新版一句話定義

C / Hybrid Runtime Orchestrator 不是單一 `Lifecycle Flow` 頁面，而是由四種視角組成的 Coordinator 治理控制台：Classic Dashboard 看整體健康、ATC Tower 做調度操作、Lifecycle Flow 檢查 readiness gates、Terminal / Debug 追工程證據。Coordinator 是 session / lifecycle / lease / audit / policy 權威，負責發出 audited intent 與接收 evidence，但不把自己做成完整 GPU process manager。

核心原則：

```txt
port listening != viewer has frame
Kit control sent != runtime ready
openedStageResult != browser first-frame
endpoint occupied requires browser first-frame evidence
stage ready requires expected == loaded evidence
```

## 2. 背景定位

Coordinator 控制台不是為了漂亮，而是要讓 operator 一眼看出：

- Kit process 是否活著。
- endpoint 是否正確分配。
- primary viewer 是否存在。
- spectator viewer 是否真的連上。
- 每個 viewer 是否真的收到 first frame。
- USD / stage 是否 `expected == loaded`。
- 哪個 session / endpoint / viewer 卡在哪個 lifecycle step。
- 哪些狀態有 evidence，哪些只是後端宣稱。

參考系統的「02 Coordinator 控制台」明確採用航管塔心智模型。重點不是圖表炫麗，而是避免 operator 把 `port listening`、`endpoint reserved`、`control sent` 誤判成可審查狀態。

## 3. Repo 邊界

### `bim-review-coordinator`

權威範圍：

- session lifecycle
- endpoint lease
- viewer lease
- stage binding revision
- USD selection policy
- audit log
- readiness policy
- controlled operation intent

允許做：

- 顯示狀態。
- 套用 policy。
- 建立 / 關閉 session。
- 發送 audited intent。
- 接收 Kit-side 與 Browser-side evidence。
- 寫 audit log。
- 將 state-changing action 轉成可審查事件。

不得做：

- heavy IFC to USDC conversion。
- 直接操作 USD internal implementation。
- 直接渲染 viewport。
- 直接編碼 WebRTC video。
- 直接宣稱 GPU process 已成功 restart / release，除非 runtime manager 回填證據。

### `kit-manager-api / runtime manager`

權威範圍：

- 真正控制 Kit process。
- endpoint pool runtime operation。
- restart / release / close 的實際執行。
- 回填 `sent` / `blocked` / `recorded_only` / runtime failure reason。

Coordinator 在 Hybrid 模式下只發出 audited intent。一般操作不直接碰 process；只有 operator 明確確認的 `force_release`、`restart_failed_runtime` 會透過 kit-manager 觸發真實 runtime control。

### `bim-streaming-server`

權威範圍：

- IFC to USDC conversion authority。
- Kit / WebRTC / USD runtime。
- stage loading。
- prim selection。
- visual overlay runtime 操作。
- Kit-side evidence，例如 `control_sent`、`stage_open_requested`、`openedStageResult`、selected / loaded stage URL。

### `web-viewer-sample`

權威範圍：

- browser client。
- primary / spectator viewer evidence。
- DataChannel ready。
- first frame observed。
- viewer heartbeat。
- stage matched。

Endpoint 是否 `occupied` 必須以 browser first-frame evidence 為準。Kit-side evidence 只能把狀態推到 `streaming_started` 或 `stage_opened_unverified`，不能單獨宣告 ready。

## 4. 四種視角總覽

```txt
A Classic Dashboard | B ATC Tower | C Lifecycle Flow | D Terminal / Debug
```

| Tab | 視角 | 主要用途 | 操作強度 |
|---|---|---|---|
| A Classic Dashboard | 總覽 | 一眼看懂整體 runtime health | 低，只導引 |
| B ATC Tower | 調度 | endpoint pool、primary/spectator lease、受控操作 | 中，高風險需確認 |
| C Lifecycle Flow | 治理 | state-machine evidence、readiness gate、下一步允許操作 | 中，以判斷為主 |
| D Terminal / Debug | 工程 | raw event / API / WebRTC / Kit / E2E evidence | 高資訊密度，非 demo 預設 |

四個 tab 不是四套資料，而是同一套 runtime truth 的四種投影。A 給 orientation，B 給操作，C 給 readiness 判斷，D 給工程證據。

## 5. A · Classic Dashboard

### 用途

Classic Dashboard 是 operator 的第一眼總覽：

- 一眼看懂整體系統是否健康。
- 不放 raw JSON。
- 不做強操作。
- 提供前往 ATC / Lifecycle / Debug 的入口。

### 顯示資訊

- Kit Runtime：Kit process / runtime manager 是否可達。
- Endpoint Pool：primary / spectator endpoint 總量、occupied、reserved、free、stale。
- Active Sessions：active / closing / failed session。
- Viewer Evidence：primary 是否存在，spectator 是否有 first frame。
- Stage Truth：expected stage 與 loaded stage 是否一致。
- Recent Risk：no frame、stage mismatch、stale lease、runtime control blocked。

### 業務語言

A 頁預設用業務語言，不先丟技術 ID：

```txt
● 綠 可審查模型已就緒
● 黃 等待第一幀畫面
● 黃 已送出 Kit 控制指令，等待 runtime 回證
● 紅 Runtime 無法連線
● 紅 Stage mismatch，載入模型不是預期版本
```

### 技術細節限制

以下資訊只能放在「展開技術細節」：

- `session_id`
- `artifact_id`
- `conversion_job_id`
- `prim_path`
- WebRTC `signalingServer` / `signalingPort`
- `mediaPort`
- request / correlation IDs

A 頁不提供 `force release`、`restart failed runtime`、raw payload、stack trace。

## 6. B · ATC Tower

### 用途

ATC Tower 是 operator 主要工作的地方。心智模型像航管塔：

- 每個 endpoint 像 runway。
- 每個 primary / spectator viewer 像飛機。
- operator 要知道誰佔用、誰等待、誰卡住、誰可以被回收。

### Endpoint Pool 顯示

範例：

```txt
PRI :49100 · primary   · occupied · first frame OK · stage matched
SPC :49110 · spectator · occupied · heartbeat OK
SPC :49120 · spectator · reserved · no frame 21s / 45s
SPC :49130 · free
```

每一列至少顯示：

- endpoint type：`PRI` / `SPC`
- port / kit instance id
- assigned role
- lease state
- viewer id / display name
- last heartbeat age
- first frame status
- stage match status
- next allowed action

### 主要按鈕

- `[Open primary URL]`
- `[Open spectator URL]`
- `[Apply Stage Binding]`
- `[Close Session]`
- `[Reclaim stale spectator]`
- `[Force release / restart failed runtime]`

### 操作規則

- `Open primary URL` 只代表產生導引 URL，不等於 endpoint `occupied`。
- `Open spectator URL` 只代表產生導引 URL，不等於 endpoint `occupied`。
- `occupied` 必須等 browser first-frame evidence。
- `Reclaim stale spectator` 可以半自動，限 spectator reservation 或 viewer lease。
- primary release、force release、restart failed runtime 必須人工確認，並輸入 reason。
- 所有 state-changing action 必須寫 audit log。

### USD Selection

USD 選擇由使用者勾選決定，不由 orchestrator 靜默選 latest。

規則：

- checkbox 選「要載入哪些 USD / USDC」。
- radio 選「哪一個是 primary stage」。
- 未選 primary 時不得 Apply Stage Binding。
- 只有 `ready` 且有安全 stage URL 的 artifact 可被勾選。
- mapping / coverage / semantic fidelity 不是靜默阻擋，而是顯示 warning；operator 可依政策決定是否套用。

Apply Stage Binding 會建立 revision：

```txt
stage_binding_revision = {
  actor,
  selected_artifacts,
  primary_artifact_id,
  reason,
  previous_revision,
  created_at
}
```

## 7. C · Lifecycle Flow

### 用途

Lifecycle Flow 不是漂亮流程圖，而是回答：

- 這個 session 現在在哪個階段？
- 哪一步有 evidence？
- 哪一步只是後端宣稱？
- 哪一步卡住？
- 誰觸發 transition？
- 下一步允許什麼操作？

### 三條 lifecycle

不要把所有狀態混成一條。C 頁必須拆成三條 lifecycle。

Session lifecycle：

```txt
created -> allocated -> active -> closing -> closed
```

Endpoint lifecycle：

```txt
free -> reserved -> signaling -> connected -> first_frame -> occupied -> draining -> released / failed
```

Stage binding lifecycle：

```txt
draft -> applied -> stage_open_requested -> stage_matched -> rejected / rollback
```

### 每個節點顯示

每個 lifecycle node 必須能展開：

- state
- timestamp
- actor
- trigger
- required evidence
- actual evidence
- next allowed action

範例：

```txt
Endpoint node: connected
timestamp: 2026-06-08T05:36:04Z
actor: viewer-004
trigger: WebRTC connected event
required evidence: first_frame_at
actual evidence: DataChannel ready, heartbeat OK, first_frame_at missing
next allowed action: wait until 45s, then reclaim stale spectator
```

### Readiness gates

Coordinator 不得只因為 Kit process alive 宣稱 ready。

Coordinator 不得只因為 endpoint reserved 宣稱 occupied。

Coordinator 不得只因為 stage open requested 宣稱 stage matched。

Runtime ready 必須同時具備：

```txt
Kit-side evidence
+ Browser-side evidence
+ expected == loaded stage proof
```

Kit-side evidence：

- `control_sent`
- `stage_open_requested`
- `openedStageResult`
- selected stage URL
- loaded stage URL

Browser-side evidence：

- DataChannel ready
- first_frame_at
- heartbeat
- stage matched
- primary / spectator role

## 8. D · Terminal / Debug

### 用途

D 頁不是客戶主畫面，也不是 demo 預設頁。它是工程師追查、E2E 驗證、現場排障頁。

### 可以顯示

- Raw event stream。
- API trace。
- WebRTC trace。
- Kit message trace。
- E2E evidence。
- structured logs。
- console logs。
- network summary。

### 可包含技術細節

- `session_id`
- `artifact_id`
- `prim_path`
- `correlation_id`
- `request_id`
- port
- payload summary
- stack trace

### 限制

- D 可以顯示 raw JSON。
- D 可以顯示 stack trace。
- D 不應該是 demo 預設頁。
- D 不應該承擔 operator 日常流程。
- D 的資訊可以高密度，但 state-changing action 仍要走 B 或 C 的受控按鈕與 audit。

## 9. 四個視角的操作流

標準 operator 路徑：

1. 先看 A Classic Dashboard。
   - 確認整體健康狀態。

2. 若 endpoint / viewer 異常，進 B ATC Tower。
   - 查看誰佔用哪個 endpoint。
   - 判斷是否需要開 primary、開 spectator、回收 stale lease。

3. 若不確定為什麼沒有 ready，進 C Lifecycle Flow。
   - 看卡在哪一步：Kit 沒開、DataChannel 沒 ready、沒有 first frame、stage mismatch。

4. 若 C 仍無法解釋，進 D Terminal / Debug。
   - 查 raw logs、API response、WebRTC trace、Kit command result。

具體例子：

```txt
A 顯示：● 黃 有 viewer 等待第一幀
↓
B 顯示：SPC :49120 reserved · no frame 21s / 45s
↓
C 顯示：endpoint 卡在 connected，缺 first_frame_at
↓
D 顯示：browser WebRTC connected，但 video frame 未 observed
↓
Operator 執行：Reclaim stale spectator
↓
Audit log 記錄：actor / action / reason / previous_state / next_state
```

## 10. 設計 Contract

```txt
The Coordinator Console SHALL provide four coordinated views:

1. Classic Dashboard
   for high-level runtime health and operator orientation.

2. ATC Tower
   for endpoint pool, primary/spectator lease, and controlled operator actions.

3. Lifecycle Flow
   for state-machine evidence and readiness gates.

4. Terminal / Debug
   for raw event, API, WebRTC, Kit, and E2E evidence.

The system SHALL NOT mark a runtime endpoint as occupied or ready until both
Kit-side control evidence and browser-side first-frame / stage-match evidence
exist.

The system MAY semi-auto reclaim stale spectator reservations or viewer leases.

The system SHALL require explicit operator confirmation and reason for primary
release, force release, or failed runtime restart.

Every state-changing action SHALL write an audit event with actor, action,
reason, previous_state, next_state, selected_artifacts, and control_status.
```

## 11. Evidence 與 audit 硬規則

### Evidence

所有 evidence 必須標明來源：

```txt
source = coordinator | kit_manager | streaming_server | browser_viewer | e2e
```

所有 readiness 判斷必須區分：

```txt
asserted_by_backend
observed_by_browser
confirmed_by_kit
verified_by_e2e
```

不可把 `asserted_by_backend` 顯示成 `verified`。

### Audit

每個 state-changing action 必須寫 audit event：

```txt
{
  actor,
  action,
  reason,
  previous_state,
  next_state,
  selected_artifacts,
  control_status,
  created_at,
  correlation_id
}
```

至少涵蓋：

- Apply Stage Binding。
- Close Session。
- Reclaim stale spectator。
- Force release。
- Restart failed runtime。
- Primary release。
- Stage binding rollback。

## 12. Runtime Orchestrator Hybrid 行為

Hybrid 的分工：

- 日常 lifecycle 由 coordinator 管 state machine、lease、policy、audit。
- browser viewer 回報 first-frame / heartbeat / stage-match evidence。
- streaming server / Kit 回報 stage / control evidence。
- kit-manager 實際執行 restart / release / close。
- coordinator 發 audited intent，不直接假設 process control 成功。

半自動 reclaim：

- 可以自動 reclaim stale spectator reservation。
- 可以自動 reclaim 已離線 viewer lease。
- 不可以自動 release primary。
- 不可以自動 restart failed runtime。
- primary / force release / restart failed runtime 必須 operator confirmation + reason。

## 13. MVP 實作順序

### Phase 1：A Classic Dashboard + B ATC Tower read-only

目標：

- 整合 existing `/api/runtime/status`。
- 顯示 session / kit_instance_bindings / stream-config 摘要。
- 顯示 endpoint pool read-only。
- 顯示 stage truth read-only。
- 不做 state-changing action。

驗收：

- `/ui#/coordinator` 可看到四 tab 架構。
- A 頁用業務語言顯示健康狀態。
- B 頁 read-only endpoint pool 不捏造 first-frame。

### Phase 2：B ATC Tower controlled actions

目標：

- `Open primary URL`。
- `Open spectator URL`。
- `Close Session`。
- `Reclaim stale spectator`。
- State-changing action 寫 audit event。

限制：

- `Open URL` 不等於 occupied。
- Reclaim 僅限 stale spectator reservation / viewer lease。
- primary / failed runtime restart 仍只顯示 disabled 或 require confirmation。

### Phase 3：C Lifecycle Flow evidence gate

目標：

- 新增 Kit-side evidence model。
- 新增 Browser-side evidence reporter。
- 顯示 Session / Endpoint / Stage binding 三條 lifecycle。
- Endpoint occupied 必須等 first_frame。
- Stage matched 必須等 expected == loaded。

驗收：

- C 頁可指出卡住原因：缺 Kit evidence、缺 DataChannel、缺 first_frame、stage mismatch。
- Runtime ready 不再只看 Kit binding `ready`。

### Phase 4：D Terminal / Debug

目標：

- raw event stream。
- API trace。
- WebRTC trace。
- Kit message trace。
- E2E evidence link / summary。
- structured logs / console logs / network summary。

限制：

- D 不是 demo 預設頁。
- D 可顯示 raw JSON / stack trace，但不承擔日常 operator 主流程。

### Phase 5：Kit Manager intent integration

目標：

- Coordinator 發 audited intent。
- kit-manager 實際執行 restart / release。
- 回填 `sent` / `blocked` / `recorded_only`。
- operator 可在 B/C 看見 control result。

限制：

- Coordinator 不把 `sent` 解讀成 runtime ready。
- failed runtime restart 必須人工確認 + reason。

## 14. Non-goals

本設計不包含：

- 讓 coordinator 直接管理 GPU process。
- 讓 coordinator 直接操作 USD stage internals。
- 讓 coordinator 直接處理 WebRTC video。
- 新增 heavy conversion 到 coordinator。
- 把 Terminal / Debug 做成客戶 demo 預設頁。
- 在 Phase 1 就實作自動 primary failover。

## 15. Spec self-review

Placeholder scan：

- 無未定標記或待辦標記。
- 所有 MVP phase 都有明確目標與限制。

Consistency check：

- 四視角定位與 repo 邊界一致。
- Hybrid 不把 coordinator 升級成 GPU process manager。
- `occupied` 與 `ready` 都需要 browser-side evidence。

Scope check：

- 本設計可拆成 Phase 1-5。Phase 1/2 可在現有 `/api/runtime/status`、session、event log 上 additive 落地；Phase 3 才引入新的 evidence gate。

Ambiguity check：

- 多 USD 選擇規則已明確：checkbox 選集合，radio 選 primary。
- 半自動 reclaim 範圍已明確：只限 stale spectator reservation / viewer lease。
- 高風險 primary release / force release / restart failed runtime 都需要人工確認與 reason。
