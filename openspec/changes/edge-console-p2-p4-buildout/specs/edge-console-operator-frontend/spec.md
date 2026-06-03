# edge-console-operator-frontend — Spec Delta (edge-console-p2-p4-buildout)

> frontend gap 報告 P2/P3/P4：補齊 06 共用頁面真實化（Overview 三 Panel / Semantic Viewer / B·C·F）、
> A4–A10 vision 詳頁 + polish、Review Room v1。誠實鐵律優先——只接查證為真的 coordinator-owned
> 端點（只打 :8004），幻覺端點不使用 / 不 mock；無遙測值標未取得（非 fail）；mapping fake 嚴格隔離；
> A4–A10 後端不存在整段標 vision、scenario 標範例情境（非真實 run）；不做假按鈕、不偽裝成功、不捏造數字。

## ADDED Requirements

### Requirement: Overview SHALL 以真實拓樸呈現服務邊界、coordinator 路由與授權風險，SHALL NOT 宣稱零授權風險

OverviewPage SHALL 顯示 BoundaryDiagram，以 WEB-PLANE → CONTROL-PLANE BOUNDARY → INTERNAL 三欄視覺化「瀏覽器只與 coordinator :8004 對話、49100/49101/49102 為內部、瀏覽器永不直連」的邊界。OverviewPage SHALL 顯示 coordinator 已實作 HTTP 路由清單（ENDPOINTS），其內容 SHALL 為查證自 `bim-review-coordinator/src/app.ts` 的真實 route，SHALL NOT 列入查證不存在的幻覺端點。OverviewPage SHALL 顯示相依與授權風險表（DEPENDENCIES），對 LGPL / copyleft 元件 SHALL 明確標示 `copyleft`，SHALL NOT 出現「零授權風險」或「零相依」之宣稱。OverviewPage MAY 接 coordinator `GET /health` 探活；未連線時 SHALL 誠實顯示未取得，SHALL NOT 假裝 healthy。

#### Scenario: DEPENDENCIES 標 copyleft 且不宣稱零授權風險

- **WHEN** 操作員開啟 Overview
- **THEN** 授權風險表 SHALL 出現至少一個 `copyleft` 標示（如 IfcOpenShell / ifctester LGPL-3.0）
- **AND** 畫面 SHALL NOT 包含「零授權風險」「零相依」字串
- **AND** BoundaryDiagram SHALL 呈現「瀏覽器永不直連」之 INTERNAL 欄

#### Scenario: ENDPOINTS 僅列真實 coordinator route，不列幻覺端點

- **WHEN** 操作員開啟 Overview 的「已實作面 · Coordinator HTTP 介面」
- **THEN** 路由清單 SHALL 包含查證為真的 route（如 `/api/runtime/status`、`/api/external/ifc-ready`、`/api/review-sessions/:id/stream-config`）
- **AND** SHALL NOT 列入 `/api/governance/uploads` 或 `/api/governance/runtime/*` 等查證不存在的幻覺端點

### Requirement: Semantic Viewer SHALL 嚴守 mapping fake-vs-real 隔離，SHALL NOT 冒充真實 mapping

SemanticViewerPage SHALL 載入真實 `element_mapping.json`（URL 來自真實 session 或操作員貼入），並以既有 fake-vs-real 隔離規則判定：凡 `mock=true` / `allow_fake_mapping=true` / `summary.fake_mapping_count>0` / 任一 item `mapping_method=fake_for_smoke_test` 一律當 fake。偵測到 fake mapping 時，SemanticViewerPage SHALL 明確標示為示範資料（demo）並聲明「僅可做 smoke test、不列入正式 mapping 驗證」，SHALL NOT 覆蓋或冒充真實 mapping。點構件做 3D highlight 需 viewer 的 WebRTC DataChannel；因 console 殼層與 viewer 互斥掛載、無 DataChannel，該入口 SHALL 標 `p1` 且 `disabled`，SHALL NOT 呈現為點了無回應的假按鈕。

#### Scenario: fake mapping 被標 demo 且拒絕當正式 mapping

- **WHEN** 載入的 mapping 文件帶 `mock=true` / `allow_fake_mapping=true` / `fake_mapping_count>0` / `mapping_method=fake_for_smoke_test` 任一旗標
- **THEN** SemanticViewerPage SHALL 顯示 fake / mock 警示並將該資料標為示範資料（demo）
- **AND** SHALL 聲明此資料僅可做 smoke test、不列入正式 mapping 驗證
- **AND** SHALL NOT 以該 fake 資料覆蓋或冒充真實 mapping

#### Scenario: 點構件 3D 標示因無 DataChannel 而誠實標 p1（非假按鈕）

- **WHEN** 操作員在 Semantic Viewer 檢視 mapping 列
- **THEN** 「在 3D 標示」入口 SHALL 標 `p1` 且 `disabled`
- **AND** SHALL 誠實說明需 viewer 的 WebRTC DataChannel（focusPrim / highlightPrims），console 殼層無此鏈

### Requirement: Coordinator/Intake/Runtime 頁 SHALL 只打 coordinator :8004 的真實端點，無遙測值 SHALL 標未取得

CoordinatorPage / IntakePage / RuntimePage SHALL 經新建 `coordinatorClient` 取資料，且 `coordinatorClient` SHALL 只打 coordinator `:8004` 的 coordinator-owned 端點（`GET /api/runtime/status`、`GET /api/external/ifc-ready`、`GET /api/review-sessions/:id/stream-config`、`GET /health`、`GET /ui/open?session=`），SHALL NOT 直連 `:49100` / `:49101` / `:49102`，SHALL NOT 呼叫查證不存在的幻覺端點。GPU / Kit 首幀 / conversion 秒數無真實遙測來源者，SHALL 標「未取得」（idle），SHALL NOT 畫成 fail、SHALL NOT 捏造秒數或首幀數。callback outbox 三態直查需 internal token（瀏覽器不可達），SHALL NOT 捏造投遞數，改由 coordinator 摘要可見的 `callback_outbox_id` 觀察。後端離線時三頁 SHALL 誠實顯示未連線，SHALL NOT 假裝成功。

#### Scenario: coordinatorClient 只打 :8004 且不含幻覺端點

- **WHEN** B/C/F 頁向後端取資料
- **THEN** 請求 base SHALL 為 coordinator `:8004`
- **AND** SHALL NOT 直連 `:49100` / `:49101` / `:49102`
- **AND** SHALL NOT 呼叫 `/api/governance/uploads` 或 `/api/governance/runtime/*` 等幻覺端點

#### Scenario: GPU / 首幀無遙測標未取得（非 fail，非捏造）

- **WHEN** 操作員開啟 Coordinator / Intake / Runtime 頁
- **THEN** GPU / Kit 首幀 / conversion 秒數無真實遙測者 SHALL 標「未取得」（idle）
- **AND** SHALL NOT 畫成 fail，SHALL NOT 顯示捏造的秒數 / 首幀數
- **AND** 後端離線時 SHALL 誠實顯示未連線，SHALL NOT 假裝成功

### Requirement: A4–A10 vision 詳頁 SHALL 整段標願景，scenario SHALL 標範例情境且 SHALL NOT 當真實實測

AppsPage 的 A4–A10 roadmap 卡 SHALL 可點並導向泛用 vision 詳頁（`app/<slug>`）。每個 vision 詳頁 SHALL 顯示 DB schema / REST api / UI 面板 / MVP 驗收 / sprint steps / risks，且 SHALL 明確標示「後端未建」（願景，prov `p3`/`p4`：A5=p3、其餘 p4）。詳頁的 scenario SHALL 標示為「範例情境（願景敘事，非真實 run）」，SHALL NOT 將 RM_APPS 內具體數字呈現為本系統真實實測。詳頁的 api 區 SHALL 標示為「願景 API 設計（非已實作 route）」，SHALL NOT 呈現為可呼叫的真實端點。vision 詳頁 SHALL NOT 顯示任何捏造的成功數字（如 99.1% / 92.4%）。

#### Scenario: vision 詳頁明確標後端未建且 scenario 標範例情境

- **WHEN** 操作員從 Applications 點開任一 A4–A10 roadmap 卡
- **THEN** 詳頁 SHALL 顯示「後端未建」之願景標示（prov `p3` 或 `p4`）
- **AND** scenario 區 SHALL 標示為「範例情境」且「非真實 run」
- **AND** api 區 SHALL 標示為「願景 API 設計（非已實作 route）」
- **AND** SHALL NOT 顯示捏造的成功數字（99.1% / 92.4%）

#### Scenario: roadmap 卡可點且 prov 細分對齊 RM phase

- **WHEN** 載入 Applications 的 A4–A10 roadmap 卡
- **THEN** 每張卡 SHALL 帶 `app/<slug>` route（可點）
- **AND** A5 SHALL 標 `p3`（RM phase 3），A4/A6/A7/A8/A9/A10 SHALL 標 `p4`

### Requirement: Review Room v1 SHALL 連到既有 viewer 而不在 console 內嵌 3D，SHALL NOT 改動 viewer 主體

Review Room（G）v1 SHALL 維持殼層狀態並提供「在既有 viewer 開啟」連結，連到既有 viewer 入口（coordinator `GET /ui/open?session=` 之 server-side redirect，及本地 `/?session=`），SHALL NOT 在 console 殼層內嵌 WebRTC 3D viewport。session id 不符 `lwv_` / `review_session_` 前綴格式時連結 SHALL 停用，SHALL NOT 呈現為可點的假連結。Review Room SHALL NOT 改動 `App.tsx` / `Window.tsx`（守 console 邊界）。工具列 SHALL 誠實標 provenance：openStage / focusPrim / selectPrims / clearHighlight 標 `asbuilt`；highlight（client 主動拉）/ section / snapshot 標 `p15`，SHALL NOT 把待建工具標為已實作。

#### Scenario: 提供連到既有 viewer 的真實連結，不在 console 內嵌 3D

- **WHEN** 操作員在 Review Room 輸入合法 review_session_id
- **THEN** 頁面 SHALL 提供 coordinator `/ui/open?session=` 與本地 `/?session=` 連結
- **AND** SHALL 誠實標示 3D viewport 在既有 viewer（非 console 殼層）
- **AND** session id 格式不符時連結 SHALL 停用，SHALL NOT 呈現可點假連結

#### Scenario: 不改動 viewer 主體且工具列誠實標 provenance

- **WHEN** 操作員開啟 Review Room
- **THEN** 頁面 SHALL 誠實標示「不動 App.tsx / Window.tsx」
- **AND** 工具列 section / snapshot SHALL 標 `p15`（待建），SHALL NOT 標為已實作
