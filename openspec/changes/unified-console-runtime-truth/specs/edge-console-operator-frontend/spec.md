## MODIFIED Requirements

### Requirement: Coordinator/Intake/Runtime 頁 SHALL 只打 coordinator :8004 的真實端點，無遙測值 SHALL 標未取得

`coordinatorClient` SHALL 只打 coordinator `:8004` 的 coordinator-owned 端點（`GET /api/runtime/status`、`GET /api/external/ifc-ready`、`GET /api/review-sessions/:id/stream-config`、`GET /health`、`GET /ui/open?session=`），SHALL NOT 直連 `:49100` / `:49101` / `:49102`，SHALL NOT 呼叫查證不存在的幻覺端點。凡由 `coordinatorClient` 供資料的頁面，GPU / Kit 首幀 / conversion 秒數無真實遙測來源者 SHALL 標「未取得」（idle），SHALL NOT 畫成 fail、SHALL NOT 捏造秒數或首幀數。callback outbox 三態直查需 internal token（瀏覽器不可達），SHALL NOT 捏造投遞數。後端離線時 SHALL 誠實顯示未連線，SHALL NOT 假裝成功。**路由現況揭露（已知缺口，非追認）**：舊 `RuntimePage` 入口已刪，`#runtime` 現由 fixture `OpsPage` 承接（`unified/OpsPage.tsx` 檔頭自承「GPU/Kit 固定值照原型抄寫」「不打任何 `/api`」），其畫面渲染具體數字而非「未取得」；`UnifiedShell` 頂列亦帶固定 GPU chip。此與本 requirement 的誠實義務**牴觸**，SHALL 以 known gap 記錄並另行修復，SHALL NOT 因本次措辭收斂而被視為已符合。 **修復承接（`unified-console-runtime-truth`）**：上述 `#runtime` fixture 缺口由該 change 修復——liveBackend 時 `#runtime` SHALL 綁 `GET /api/runtime/status` 與 `GET /api/kit/instances/current`（Kit instance id／state、GPU 無遙測標「未取得」、服務健康），SHALL NOT 渲染固定數值；`UnifiedShell` 頂列 GPU chip 同此。`coordinatorClient` 的允許端點清單為此擴充為：`GET /api/runtime/status`、`GET /api/external/ifc-ready`、`GET /api/review-sessions/:id/stream-config`、`GET /health`、`GET /ui/open?session=`、`GET /api/conversion/records`、`GET /api/callback-outbox/summary`（redacted 投影：排除 `payload`／`target_url`、`limit` 上限 200；callback outbox 三態直查仍需 internal token 且瀏覽器不可達，SHALL NOT 捏造投遞數）、`GET /api/governance/issues`、`GET /api/governance/rule-runs`、`GET /api/external/minio-watch/status`、`GET /api/minio/objects`、`GET /api/kit/health`、`GET /api/kit/instances/current`；仍 SHALL NOT 直連 `:49100`／`:49101`／`:49102`、SHALL NOT 呼叫 `/api/dev/*` 或幻覺端點。

#### Scenario: coordinatorClient 只打 :8004 且不含幻覺端點

- **WHEN** B/C/F 頁向後端取資料
- **THEN** 請求 base SHALL 為 coordinator `:8004`
- **AND** SHALL NOT 直連 `:49100` / `:49101` / `:49102`
- **AND** SHALL NOT 呼叫 `/api/governance/uploads` 或 `/api/governance/runtime/*` 等幻覺端點

#### Scenario: GPU / 首幀無遙測標未取得（非 fail，非捏造）

- **WHEN** 操作員開啟由 `coordinatorClient` 供資料的 Coordinator / Intake 頁
- **THEN** GPU / Kit 首幀 / conversion 秒數無真實遙測者 SHALL 標「未取得」（idle）
- **AND** SHALL NOT 畫成 fail，SHALL NOT 顯示捏造的秒數 / 首幀數
- **AND** 後端離線時 SHALL 誠實顯示未連線，SHALL NOT 假裝成功

#### Scenario: fixture Ops 面為已知缺口，SHALL NOT 充作 runtime 遙測

- **WHEN** 操作員開啟 `#runtime`
- **AND** 自 `unified-console-runtime-truth` 落地後，liveBackend 時 `#runtime` SHALL NOT 掛載 fixture 數值；fixture 只得於 design-preview／後端離線態出現，且 SHALL 標 `data-prov="demo"`、SHALL NOT 顯示任何 GPU／VRAM 數字

#### Scenario: #runtime 於 liveBackend 綁真值
- **WHEN** operator 於 liveBackend 狀態開啟 `#runtime`
- **THEN** Kit instance 卡 SHALL 顯示 `GET /api/kit/instances/current` 的 id 與 state（例：`kit_local_001` idle），GPU 卡 SHALL 顯示「未取得」（`data-state="unavailable"`）除非 API 提供使用率
- **AND** 服務健康 SHALL 來自 `GET /api/kit/health`／`GET /api/runtime/status`／`GET /api/external/minio-watch/status`，不可達者標 unknown；事件列 SHALL 誠實停用並導向 `#instances`
