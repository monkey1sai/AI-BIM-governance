# 模型檔案、審查 session 與轉檔紀錄生命週期：§04 契約草案與切片計畫（方向 1）

日期：2026-09-29。狀態：**S1 實作中（分支 `feat/model-file-lifecycle-s1`）；S2、S3 未開始**。本檔是需求與契約正本的草案，不是 runtime 完成證據；payload 以 `bim-review-coordinator/src/contract/schemas/*.ts` 生成的 `tests/contracts/coordinator-browser-api-v1.openapi.json` 為最高標準。
上游：`docs-plans-README.md` §2 讀取路線、設計正本 §04 API 契約與 `c4-closed-session-recreate` 卡、`docs/agents/repository-boundaries.md`。衝突時依序採用：使用者最新指令、根目錄 `AGENTS.md`、設計正本、本檔。

## 1. Owner 裁決（2026-09-29）

| 編號 | 裁決 | 本檔如何落實 |
|---|---|---|
| D1 方向 | 方向 1：3D 工作區以「模型檔案」清單為統一入口，`#demo-control` 退為進階工具 | §5.1、§5.2 |
| D2 移除語意 | 移除只清 coordinator 本地紀錄；streaming 磁碟 job／artifact 留給後續維運腳本 | §4.3、§4.4、§6、§8 |
| D3 清理舊紀錄 | 允許先結束再移除「無人連線」的 active 舊 session | §5.3 |
| D4 入口位置 | 3D 工作區面板以「模型檔案」清單取代「審查模型／審查」兩個下拉 | §5.1 |

## 2. 現況事實（設計依據，2026-09-29 查證）

| 主題 | 事實 | 位置 |
|---|---|---|
| session 持久化 | 每個 session 一個 JSON，`SessionStore` 只有 get／list／save，沒有任何刪除方法 | `bim-review-coordinator/src/services/sessionStore.ts:141-388` |
| session 清單 | 進行中清單來自 `GET /api/runtime/status`；`GET /api/review-sessions` 只接受 `status=closed`，否則 400 | `app.ts:1914`、`app.ts:2025-2029` |
| close 語意 | `POST /api/review-sessions/{id}/close` 只做狀態轉移 closing→closed，不刪檔；idle teardown 走同一條路徑 | `app.ts:2790`、`app.ts:997-1010` |
| 唯一 DELETE | 整份瀏覽器契約只有 `DELETE /api/review-sessions/{sessionId}/cfd-overlays/{bindingId}` | `src/contract/browserContract.ts:762` |
| session 與檔案的鍵 | `session.ready_model_id` 等於 ledger 的 `idempotency_key`；`artifact_bindings[].source_ifc_filename`、`conversion_job_id` 指回轉檔；intake job 的 `review_session_id` 反指 session | `types.ts:139`、`types.ts:14-32`、`types.ts:280` |
| 來源推導 | `deriveSessionOrigin` 已算出 `source_ifc_filename`，進 `RuntimeSessionSummary.origin`；已關閉清單沒有這個欄位 | `services/sessionOrigin.ts:37-63`、`contract/schemas/runtime.ts:34-72`、`contract/schemas/sessions.ts:319-328` |
| 轉檔 ledger | `data/conversion-ledger.json`（`conversion-ledger/v2`），狀態 `detected｜queued｜converting｜ready｜failed`，無刪除方法 | `services/conversionLedger.ts:14-60` |
| intake store | `data/external-ifc-ready.json`，記憶體 Map 加 JSON 持久化，無刪除方法；註解明言與 session 是同一組本地狀態 | `services/externalIfcReadyStore.ts:18-45`、`config.ts:688-695` |
| watcher 去重 | 對每個 `*/model.ifc` 算冪等鍵查 ledger：無紀錄就觸發，有紀錄就跳過 | `services/minioWatchSurface.ts:362` |
| dev 註冊 | `POST /api/dev/ifc-sources/{id}/register` 自送 `/api/external/ifc-ready`，冪等鍵 `idem_devreg_<stamp>`，回應補 `source_ifc_filename` | `app.ts:4560-4612` |
| streaming | `conversion_authority.py` 是凍結檔，無 DELETE，失敗紀錄依設計永久保留；job 與 artifact 在 `_cache/host-native-conversion/{jobs,artifacts}`，無 retention | `conversion_authority.py:163-191,328-331`、`host_native_conversion_service.py:56-116` |
| governance | 只有 `a4_issue_evidence.review_session_id` 引用 session；全服務無刪除路徑 | `governance-service/issues/store.py:58-62` |
| 前端入口 | 真實 IFC 進件頁 `#demo-control` 不在任何導覽；A1 面板「選擇模型與審查」是兩個下拉；session 卡片不印檔名；只有「結束」，沒有移除 | `RealIfcConsolePage.tsx:220-248`、`ReadyReviewSessions.tsx:145-201`、`SessionIdentityCard.tsx:10-26`、`pages.tsx:472-546` |
| 設計正本 | close 永久不可逆、舊 id 永不復活、Session 管理分 active 與 archived；沒有刪除或 retention 需求句 | 設計正本 `c4-closed-session-recreate`（`.dc.html:244,255`） |

本機 coordinator 現況作為規模參考：session 檔 7 個（全部 `active`，最舊 2026-07-15，4 個綁同一個 artifact）；ledger 紀錄 64 筆（queued 50、ready 11、failed 3）。

## 3. 名詞與連結規則

- **模型檔案**：使用者眼中的一個 `.ifc`。在資料上它是「一筆轉檔紀錄」或「一個尚未註冊的本機 IFC 來源」。
- **轉檔紀錄**：ledger 的一列，鍵為 `idempotency_key`（MinIO 進件為 `mw_<hash16>`，dev 註冊為 `idem_devreg_<stamp>`，外部 worker 為其自送的鍵）。同鍵的 intake job 視為同一筆紀錄的進件面。
- **審查 session**：`ReviewSession`，狀態 `created｜active｜closing｜closed｜failed`。

### 3.1 session 歸屬規則（server 端計算，前端不得自行拼湊）

一個 session 屬於一筆轉檔紀錄，若下列任一成立；多條成立時 `link` 取第一個命中的規則：

| 規則 | 條件 | `link` 值 |
|---|---|---|
| R1 | `session.ready_model_id === record.idempotency_key` | `ready_model` |
| R2 | 存在 intake job 使 `job.idempotency_key === record.idempotency_key` 且 `job.review_session_id === session.session_id` | `intake_job` |
| R3 | `record.conversion_job_id` 非 null 且 `session.artifact_bindings[]` 任一 `conversion_job_id` 等於它 | `artifact_binding` |

### 3.2 檔名推導順序

`source_ifc_filename` 一律由 server 推導，查無資料為 `null`，不得猜測：

1. ledger `object_key` 的最後一段（MinIO 進件）。
2. intake job 新增欄位 `source_ifc_filename`（S1 起在 intake 時從事件 `source_ifc.filename` 寫入；舊 job 為 null）。
3. 任一歸屬 session 的 `artifact_bindings[].source_ifc_filename`。
4. `null`。

session 側維持 `deriveSessionOrigin` 的既有順序（object key 檔名優先，其次 binding 檔名），S1 在其間插入第 2 項。

## 4. §04 契約草案（coordinator，瀏覽器面）

四條變更都登錄在 `src/contract/browserContract.ts`，schema 放 `src/contract/schemas/`，以 `npm run contract:emit` 重生 OpenAPI，`npm run contract:check` 守護；前端以 `npm run generate:api-types` 重生 `web-viewer-sample/src/generated/coordinator-api.ts`。

### 4.1 `GET /api/conversion/records`（additive）

每筆新增兩個欄位，既有欄位與排序不變：

```json
{
  "idempotency_key": "mw_0123456789abcdef",
  "status": "ready",
  "source_ifc_filename": "japanese_villa.ifc",
  "sessions": [
    { "session_id": "review_session_9bd3179352c7", "status": "active", "created_at": "2026-09-21T03:55:32.425Z", "updated_at": "2026-09-21T04:10:00.000Z", "link": "ready_model" },
    { "session_id": "review_session_664ffcf6efef", "status": "closed", "created_at": "2026-09-03T05:16:13.497Z", "updated_at": "2026-09-22T00:00:00.000Z", "link": "artifact_binding" }
  ]
}
```

- `sessions[]` 含所有狀態，依 `created_at` 降冪；前端自行分「進行中」與「已關閉」。
- 新增查詢參數 `include_removed=1`：預設不回 `status: "removed"` 的墓碑（§4.4）；`count` 反映過濾後的數量。參數只接受 `1`（契約宣告為只含 `"1"` 的列舉），其他值等同省略。
- `status` 列舉新增 `removed`；墓碑筆帶 `removed_at`、`removed_by`。

### 4.2 `GET /api/review-sessions?status=closed`（additive）

`ClosedSessionItem` 新增 `source_ifc_filename: string | null`（推導同 §3.2）。分頁、cursor 與其餘欄位不變。

### 4.3 `DELETE /api/review-sessions/{sessionId}`

清除一個已結束的 session 的 coordinator 本地紀錄。查詢參數 `reason`（`manual` 或 `stale_cleanup`，省略視為 `manual`）只用於稽核；其他值回 400。

| 情況 | 回應 |
|---|---|
| 守門未過（§4.5） | 403 |
| `sessionId` 不符 `isSafeSessionId` | 400 `{ "detail": "Invalid review session id." }` |
| `reason` 不是 `manual` 或 `stale_cleanup` | 400 `{ "error_code": "invalid_reason" }` |
| 不存在（含已清除） | 404 `{ "error_code": "review_session_not_found" }` |
| 狀態不是 `closed` 或 `failed` | 409 `{ "error_code": "review_session_not_closed", "status": "<現況>" }` |
| 有其他 session 的 `recreated_from_session_id` 鏈經過此 id | 409 `{ "error_code": "review_session_has_descendants", "sessions": [...] }` |
| 退役標記已寫、但刪檔失敗 | 500 `{ "error_code": "purge_incomplete", "removed": { "session_file": false, "events_file": true } }`（`removed` 如實回報已刪的檔；再送一次 DELETE 補完） |
| 成功 | 200 `{ "session_id": "...", "status": "purged", "purged_at": "<ISO>", "removed": { "session_file": true, "events_file": true } }` |

後代 session 的 lineage 查找（A1 規則執行、A4 搜尋與 issue）沿 `recreated_from_session_id` 走回祖先，祖先被 purge 會讓整條鏈失去 IFC-ready job；因此只要有任一 session（任何狀態；每條鏈最多 32 跳並防環）的鏈經過此 id 就拒絕。清理時由新到舊逐一 purge 即可清完整條 closed 鏈。

副作用（全部在 coordinator 內），依序執行：

1. 在 session 目錄寫固定名稱的退役標記 `<session_id>.json.purged`（冪等，`list()` 不列出）。之後任何一步失敗，這個 id 都不會再被寫出新檔。
2. 釋放記憶體內以 session id 為鍵的殘留狀態：viewer lease 列（含 first-frame 與 stage 證據）整批刪除（`ViewerLeaseStore.purgeSession`）、idle reclaim 狀態移除（`removeSession`）；stage-binding 交易表以授權 id 為鍵、完成者由既有的逐 session 淘汰處理，列為已知殘留不另清除。lease 列清除以測試釘住。
3. 刪除 `<EVENT_LOG_DIR>/<session_id>.jsonl`（不存在時 `events_file: false`）。
4. 刪除 `<SESSION_STORE_DIR>/<session_id>.json`。`.recreation-receipts/` 與 `.corrupt-*` 隔離檔不動。

- 退役 id 永不復活：`SessionStore` 不再為有退役標記且無 session 檔的 id 寫出新檔（顯式 id 的 `create`、持有舊 session 物件的 `save` 一律拒絕）。`createOrGetReviewRequest` 對退役 id 回 `retired`；以同一個 request id 重放 ready-review `create_new`，或以同一個 `Idempotency-Key` 重放 `recreate`（推導出的 id 已退役）時，路由回 409 `{ "error_code": "review_session_retired" }`；`recreate` 路由的這個 409 主體另外帶 `detail`（該路由既有的錯誤形狀要求此欄位），ready-review `create_new` 路徑沿用共用的 `refuse()` 只帶 `error_code`。
- 無論成敗都寫 audit 事件 `session.purge`（`data`：`action`＝`session.purge`、`actor`、`target`＝session id、`reason`、`previous_status`、`session_file_removed`、`events_file_removed`（實際結果）、`outcome`＝`ok`｜`failed`，失敗時另有 `error_code`＝`purge_incomplete`），trace id 用該 session 的 canonical trace id（預設 `rev_<session_id>`，intake 建立的 session 為其 `ifcready_…` 鏈）。事件走 conversion 控制路由使用的同一個結構化 logger，不再寫入已刪除的 session 事件檔。
- 不動 `artifact-health-ledger.json`、governance、streaming。第二次呼叫回 404；前端批次流程把 404 視為「已不存在」。
- 與設計正本 `c4-closed-session-recreate` 的關係：purge 之後該 id 永久 404，以它為來源的 `recreate` 也回 404；會推導出退役 id 的重放一律回 409；「舊 id 永不復活」不變。

### 4.4 `DELETE /api/conversion/records/{key}`

移除一筆轉檔紀錄（ledger 墓碑加 intake job 刪除）。`{key}` 是 ledger `idempotency_key`，格式 `^[A-Za-z0-9_.:-]{1,200}$`。

| 情況 | 回應 |
|---|---|
| 守門未過（§4.5） | 403 |
| 鍵格式不符 | 400 `{ "error_code": "invalid_record_key" }` |
| 不存在 | 404 `{ "error_code": "record_not_found" }` |
| 已是墓碑 | 先做下兩列同樣的檢查；通過後 200，冪等回放同一個 `removed_at`；墓碑之後才出現的同鍵 intake job 一併刪除，`intake_jobs_removed` 回實際數量 |
| 任一歸屬 session（§3.1）狀態不是 `closed` 或 `failed` | 409 `{ "error_code": "record_in_use", "sessions": ["review_session_..."] }` |
| 任一同鍵 intake job 在途（定義見下表；同一個鍵可能有多個 job） | 409 `{ "error_code": "record_in_flight", "intake_status": "<最新在途 job 的現況>" }` |
| 成功 | 200 `{ "idempotency_key": "...", "status": "removed", "removed_at": "<ISO>", "intake_jobs_removed": 1 }` |

intake job「在途」的定義（依 `IfcReadyIntakeStatus` 與 `download_status`、`conversion_status` 判定；`failureReason.ts:20-36` 的失敗投影為準）：

| `status` | 在途 | 說明 |
|---|---|---|
| `accepted` | 是，除非 `download_status === "failed"` | 下載中或等待派工；下載失敗即為終態 |
| `queued_for_conversion` | 是 | 等待派工槽 |
| `dispatched` | 是，除非 `conversion_status` 為 `ready` 或 `failed` | 轉檔權威尚未回報 |
| `dispatch_failed`、`dropped_on_restart`、`failed` | 否 | 終態 |

副作用：

- ledger 該列改為墓碑：`status: "removed"`，加 `removed_at`、`removed_by`（取 `resolveActor(request)`，與 close 路由相同）；其餘欄位保留。墓碑仍是 watcher 的水印，所以 MinIO 物件不會被重新轉檔（`minioWatchSurface.ts:362` 的「有紀錄就跳過」行為不改）。
- `ConversionLedger.upsert` 遇到墓碑一律忽略並寫 audit 事件 `conversion.ledger.upsert_ignored`（`actor`＝`system`、`target`＝鍵、`attempted_status`、`removed_at`），避免遲到的轉檔結果回拋讓紀錄復活。
- 同鍵的每一個 intake job 都從 `ExternalIfcReadyStore` 刪除（`remove(idempotencyKey)`：下載失敗或重啟丟失的 job 不會被重放，重送會建新 job，所以同鍵可能有多個；清 `jobsById` 與指向它們的三個索引後持久化一次）。`GET /api/external/ifc-ready` 自然不再列出。
- 進件拒收：`POST /api/external/ifc-ready` 對墓碑鍵回 409 `{ "error_code": "record_removed", "idempotency_key": "..." }`，不建 job、不下載、不派工（檢查在 `IfcReadyConversionPipeline.accept` 建 job 之前），並寫 audit 事件 `conversion.intake.rejected_removed`（`actor`＝進件來源 `minio_watch`／`external`、`target`＝鍵）。MinIO watcher 自送進件收到 409 時記為 `skip_permanent`（標 seen、不重送）。
- 移除後要重新取得同一個 MinIO 物件的轉檔，一律透過另一個鍵：物件變更（新 etag）時 watcher 推導出新鍵；手動觸發以物件鍵推導自己的鍵，`force_retrigger` 再加 attempt salt；重派轉檔（`reconversionRequests.ts`）以 intent 專屬的新鍵建立新紀錄，進行中衝突檢查只看 `detected｜queued｜converting`，不受墓碑影響。同鍵重送一律 409 `record_removed`。
- 寫 audit 事件 `conversion.record.remove`（`actor`、`target`＝鍵、`previous_status`、`intake_jobs_removed`）。墓碑重放只有在實際刪掉 intake job（`intake_jobs_removed` > 0）時才寫，並加 `replay: true`。trace id 用同鍵最新 intake job（`created_at` 最新）的 `ifcready_…`，沒有 job 時用 `external_<鍵>`：鍵先把 `[A-Za-z0-9_-]` 以外的字元換成 `_`、再截至 191 字元，總長不超過結構化日誌契約的 200 字元上限；`target` 保留完整鍵。`conversion.ledger.upsert_ignored` 與 `conversion.intake.rejected_removed` 一律用 `external_<鍵>`（同樣的消毒與截斷規則），即使同鍵仍有 job。
- 不動 streaming 的 job 與 artifact（D2）；`_cache/host-native-conversion` 的清理另立維運腳本（§8）。

### 4.5 守門、事件與錯誤碼

- 兩條 DELETE 都掛 `rejectIfConversionControlUnauthorized`（IP allowlist 通過或 operator token 通過，token 路徑限速），與 prioritize／retry／watch 三條控制路由同一組守門（`app.ts:2287`）。`POST .../close` 依 IX-SS-04 裁定維持不加 IP 守門，本檔不改它。
- 錯誤碼一律走 `error_code` 欄位；400 的 session id 與既有路由同形使用 `detail`。
- 新 audit 事件（`event_type: audit`，`data` 必含 `action`、`actor`、`target`，其餘為額外欄位）：`session.purge`、`conversion.record.remove`、`conversion.ledger.upsert_ignored`、`conversion.intake.rejected_removed`，比照既有 `conversion.prioritize` 的寫法（`app.ts:2319`）。`tests/contracts/structured-log/schema.json` 的 audit 分支允許額外欄位，預期不需修改；S1 以 root pytest 驗證，四個事件另以 app 層 vitest 經 `validateLogRecordBasic` 驗證。
- 409／500 錯誤體在瀏覽器契約中以具名 strict schema 宣告：`ReviewSessionNotClosedError`、`ReviewSessionHasDescendantsError`、`PurgeIncompleteError`、`RecordInUseError`、`RecordInFlightError`、`RecordRemovedError`。

### 4.6 不變量

- 不改凍結檔：`conversion_authority.py`、`governanceProxy.ts`、governance `app.py`。不新增 governance 或 streaming 路由。
- 瀏覽器只打 `:8004`。
- 既有 `POST /api/conversion/records/{readyModelId}/review-session` 只接受 `mw_` 身分的規則不變；dev 註冊紀錄不得偽造 `mw_` id。
- `GET /api/runtime/status` 形狀不變。

## 5. 前端行為契約（`web-viewer-sample/src/console/`）

### 5.1 3D 工作區「模型檔案」清單

新元件 `modelFiles/ModelFileList.tsx` 取代 A1 面板「選擇模型與審查」內的 `ReadyReviewSessions`（D4）。資料來源：

- `GET /api/conversion/records?limit=100`（含 `sessions[]`；`parseListLimit` 上限 100，`app.ts:5281-5286`，現行 `getConversionRecords(200)` 實際只拿到 100 筆，S2 一併改正）。
- `GET /api/dev/ifc-sources`：回 404 代表 dev routes 關閉，整段「本機未轉檔 IFC」不顯示並以 `ProvTag` 標示原因；回 200 時只列「檔名不等於任何紀錄 `source_ifc_filename`」的來源。

每列固定顯示：檔名（`source_ifc_filename`，null 時顯示「來源未知」加鍵的短碼）、專案與版本、轉檔狀態、session 摘要（進行中 n、已關閉 m）。動作依狀態出現，缺條件時停用並用 caption 說明：

| 列的狀態 | 動作 | 呼叫 |
|---|---|---|
| 本機未轉檔 IFC | 轉檔 | 既有 `POST /api/dev/ifc-sources/{id}/register`，之後輪詢 `GET /api/external/ifc-ready/{jobId}`（沿用 `RealIfcConsolePage` 的輪詢邏輯抽成 hook） |
| 紀錄 `ready`，有進行中 session | 開啟審查 | `mw_` 鍵走既有 ready-review 端點 `open_existing`；其他鍵直接以 `sessions[]` 中最新的進行中 session 呼叫 `onSelected` |
| 紀錄 `ready`，`mw_` 鍵 | 建立新的審查 | 既有 ready-review 端點 `create_new`（保留現有 pending／stop 流程） |
| 紀錄 `ready`，非 `mw_` 鍵，無進行中 session | 建立新的審查（停用） | caption：「僅 MinIO 進件可建立新審查；本機 IFC 請重新轉檔」 |
| 紀錄任一狀態，無進行中 session，intake 非在途 | 移除 | §4.4，經 `IntentDialog` 確認 |
| 紀錄有進行中 session | 移除（停用） | caption 列出佔用的 session |

- 目前選定的 session 變更時，清單捲到並標示該檔（沿用 `currentSessionId` 對齊邏輯）。
- `#demo-control` 頁保留，改由 A1 面板「進階」區塊提供連結，並在頁首標示「操作工具，正式流程請用 3D 工作區的模型檔案清單」。

### 5.2 session 身分顯示

- `SessionIdentityCard` 與 `sessionOptionLabel` 的第一行改為檔名優先：`<檔名> · <來源標籤> · <相對時間> · <狀態>`；檔名 null 時顯示「來源未知」。
- `ClosedSessionRecovery` 的已封存列同樣顯示檔名（§4.2）。

### 5.3 `#sessions` Session 管理：清理舊紀錄

- 進行中列保留「結束」；已封存列新增「移除」（§4.3，確認對話）。
- 頁頂新增「清理舊紀錄」：輸入保留天數 N（預設 14，最小 1），按「預覽」先列出候選，分三組：
  1. 已關閉或失敗、`updated_at` 早於 N 天前的 session → 移除。
  2. `created` 或 `active`、`updated_at` 早於 N 天前、`viewer_leases` 為空且 `primary_viewer_lease_id` 為 null 的 session → 先 `POST .../close` 帶 `reason: "stale_cleanup"`，再移除（D3）。
  3. 轉檔紀錄：`updated_at` 早於 N 天前、`sessions[]` 中沒有進行中者、intake 非在途 → 移除紀錄。
- 確認後逐筆循序執行（不新增批次端點），逐列顯示結果；403 立即停止並提示 operator token，404 視為已不存在，409 記錄原因後繼續。完成後重新載入三個清單。
- 對話內固定一句誠實提示：「streaming 的轉檔 artifact 不在此清理範圍」。

### 5.4 轉檔歷史面板

`modelData/ConversionHistoryPanel.tsx` 與 `GlobalConversionPane.tsx` 每列新增「移除紀錄」（§4.4），被引用或在途時停用並說明；提供「顯示已移除」切換（`include_removed=1`）。

### 5.5 誠實標示與 test id

- 未接通或停用的動作一律 `<Btn disabled caption=…>` 加 `ProvTag`；不得出現假成功。
- 穩定 test id：`model-file-list`、`model-file-row`、`model-file-convert`、`model-file-open`、`model-file-create`、`model-file-remove`、`session-purge-<id>`、`cleanup-open`、`cleanup-days`、`cleanup-preview`、`cleanup-confirm`、`cleanup-result-row`、`conversion-record-remove-<key>`、`conversion-records-include-removed`。

### 5.6 S1 已知殘留（S2 必補）

- 模型資料的 chips（`web-viewer-sample/src/console/modelData/useConversionData.ts` 取紀錄、`conversionShared.tsx` 的 `MINIO_CHIP_LABEL`／`ledgerChipStatus`）必須以 `include_removed=1` 取轉檔紀錄，把 `removed` 顯示為「已移除」，並停用該物件的觸發按鈕（caption 指向重派轉檔）。S1 預設隱藏墓碑，所以 S2 之前被移除的 MinIO 物件在模型資料頁會顯示為「未轉」；此時觸發若推導出的鍵正是被移除的鍵，intake 回 409 `record_removed`，不會產生殭屍轉檔。
- viewer 執行期的 `CONVERSION_LEDGER_STATUSES`（`web-viewer-sample/src/coordinatorClient/types.ts`）必須加入 `removed`；目前 `narrowConversionStatus` 會把 `removed` 退成 `unknown`。

## 6. 資料落地與生命週期

| 資料 | 移除 session 時 | 移除轉檔紀錄時 | 重啟後 |
|---|---|---|---|
| `data/sessions/<id>.json` | 刪除，並先留下 `<id>.json.purged` 退役標記 | 不動 | 已刪者不再載入；標記讓同 id 永不重建 |
| `data/events/<id>.jsonl` | 刪除 | 不動 | 同上 |
| viewer lease 列（記憶體） | 整批刪除 | 不動 | 記憶體狀態，重啟即無 |
| `data/external-ifc-ready.json` 內同鍵 job | 不動 | 刪除 | 持久化後不再載入 |
| `data/conversion-ledger.json` 該列 | 不動 | 改為墓碑 | 墓碑照常載入，繼續當水印 |
| `data/artifact-health-ledger.json` | 不動（殘留引用，S1 記錄為已知殘留） | 不動 | 不變 |
| governance `a4_issue_evidence` | 不動（歷史引用） | 不動 | 不變 |
| streaming `_cache/host-native-conversion` | 不動 | 不動 | 不變 |

## 7. 切片與交付

每個切片各在獨立 sibling worktree 與 branch，PR 依 `.github/PULL_REQUEST_TEMPLATE.md`；`main` 只經 PR 合併，`pr-safety` 綠燈不取代人工審查。

| 切片 | 內容 | 完成條件 |
|---|---|---|
| S1 契約與後端 | `contract/schemas` 與 `browserContract.ts` 登錄四項變更；`SessionStore.purge`、`ExternalIfcReadyStore.remove`、`ConversionLedger.remove` 與墓碑 upsert 規則；兩條 DELETE 路由與守門；`sessions[]`、`source_ifc_filename` 推導；intake job 新欄位；墓碑鍵進件拒收（409 `record_removed`）；四個 audit 事件；設計正本 §04 新增 `c4-model-file-lifecycle` 卡；`repository-boundaries.md` 在 coordinator 責任欄加「session 與轉檔紀錄的本地清除」 | coordinator `npm test`、`npm run build`、`npm run contract:check` 綠；新增 vitest 覆蓋：兩條 DELETE 的 400／403／404／409／200 與 purge 的 500、退役 id 重放的 409、墓碑鍵進件的 409、四個 audit 事件的 app 層斷言、墓碑對 watcher 的 `skip_ledgered`、upsert 忽略墓碑、三條歸屬規則各一例、檔名推導四層各一例；root `pytest tests` 綠 |
| S2 前端 | `ModelFileList` 取代 `ReadyReviewSessions`；身分卡與選項標籤改檔名優先；`#sessions` 清理流程；轉檔歷史移除；`#demo-control` 降級為進階連結；`generate:api-types` 重生 | §5.6 兩項 S1 已知殘留補齊（chips 以 `include_removed=1` 取紀錄、`removed` 顯示「已移除」並停用觸發、`CONVERSION_LEDGER_STATUSES` 加 `removed`）；viewer `npm test`、`npx tsc --noEmit`、`npm run build:ui` 綠；改寫 `ReadyReviewSessions.test.tsx`、`SessionManagementPage.test.tsx`、`ClosedSessionRecovery.test.tsx`、`SessionIdentityCard.test.tsx`、`sessionIdentity.test.ts`、`ConversionHistoryPanel.test.tsx`；新增 `ModelFileList.test.tsx` 與清理流程測試；product path 變更依既有 visual gate 重錄基線 |
| S3 真 stack E2E 與部署 | 本機真 API 與 runtime：選本機 IFC → 轉檔 → 從清單開啟審查 → Kit 首幀與 Stage 證據；清理舊紀錄後三個清單縮短且重啟 coordinator 後不復活；部署 181（`scripts/deploy.ps1` canonical 路徑，從 freshly fetched `origin/main`）後以 owner 的 Chrome 逐步操作並截圖 | 證據目錄 `docs/evidence/model-file-lifecycle-<date>/`；Functional 與 Semantic browser E2E 各一條通過；181 真站截圖 |

## 8. 風險、限制與後續

- **streaming 磁碟殘留**：artifact 被多個 session 共用（本機 4 個 session 綁同一個 artifact），刪除需要引用計數與凍結檔以外的新路由；後續另立 `scripts/ops/prune-conversion-artifacts.ps1` 契約，不在本檔範圍。
- **governance 孤兒引用**：purge 後 `a4_issue_evidence.review_session_id` 指向不存在的 session；UI 在移除確認對話註明「issue 證據保留，但無法再開啟該 session」。
- **LAN 守門**：LAN 端瀏覽器若不在 allowlist，DELETE 會 403（與現有控制路由相同）；清理流程遇 403 立即停止並提示使用 operator token 路徑。
- **181 env**：部署區需確認 `EVENT_LOG_DIR`、`SESSION_STORE_DIR` 與 canonical env 一致，否則 purge 刪錯目錄；S3 部署前以 `/api/runtime/status` 與 deploy snapshot 核對。
- **舊 job 無檔名**：S1 之前的 intake job 沒有 `source_ifc_filename`，這些紀錄在清單顯示「來源未知」，不回填、不猜測。
- **MinIO 紀錄都叫 `model.ifc`**：MinIO 進件的物件鍵都以 `model.ifc` 結尾，watcher 送出的事件檔名也是 `model.ifc`，而 pipeline 寫入的列 `object_key` 為 null（檔名改由 intake job 取得），所以這些紀錄推導出的檔名全是 `model.ifc`。S2 以檔案為主的清單需要顯示名稱規則（專案／種類／版本），屬 owner 裁決，S1 未決定。
- **UNVERIFIED**：契約生成器對新 DELETE 路由的支援以既有 cfd-overlays DELETE 為前例推定可行，S1 第一步以 `contract:emit` 驗證。

## 9. 不做的事

- 不新增批次清除端點、不加排程自動清理、不做 retention 設定。
- 不刪 streaming job／artifact、不動 governance 資料、不改 `conversion_authority.py` 與 `governanceProxy.ts`。
- 不改 `POST .../close` 的守門與 payload。
- 不引入新的檔案來源；governance 檔案庫樹（`/api/governance/files/tree`）維持給 A1 檢核使用，不併入模型檔案清單。
- 不提供「復原已移除紀錄」。
