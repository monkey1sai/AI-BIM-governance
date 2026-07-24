## MODIFIED Requirements

### Requirement: coordinator SHALL 以輪詢自動偵測 MinIO 新 IFC 並觸發既有 intake 鏈（O4 定案）

watcher SHALL 為 env opt-in（`MINIO_WATCH_ENABLED` 預設 false，未啟用時系統行為與無此功能完全一致）。啟用時 SHALL 以 `ListObjectsV2`（含 `IsTruncated`/`NextContinuationToken` 分頁）定時輪詢指定 bucket/prefix，僅對 key 以設定後綴（預設 `/model.ifc`）結尾者反應。

去重判定（本 change 由「首輪 SHALL 只登記 baseline 不觸發、之後出現的新 key 或新 etag 才觸發」修訂為持久 ledger 去重）：watcher tick SHALL 對每個命中後綴的物件算 idempotency key（由 `bucket|key|etag` 確定性導出，= `mw_<hash16>`），查**持久 ledger**（`data/conversion-ledger.json`，atomic swap 持久層）：**ledger 無對應紀錄者 SHALL 觸發 intake 並落帳；已有紀錄者 SHALL skip**。即「ledger 無紀錄才觸發」取代原「首輪 baseline 不觸發」——既有未轉的 `*/model.ifc`（ledger=0）SHALL 於下一輪 tick 自動觸發（不再被首輪 baseline 無條件吸收），新上傳（新 key 或新 etag → 新 idempotency key）SHALL 觸發。觸發 SHALL 對 loopback `POST /api/external/ifc-ready`（帶既有 webhook secret 與 presigned GET URL），由既有下載/sanitize/dispatch/callback 鏈處理。重啟重掃同 key 同 etag SHALL 算出同一 idempotency key、命中既有 ledger 紀錄而 skip（重啟不風暴，去重水印即既有持久 ledger，SHALL NOT 另建新 watermark）；只有真正新 key 或新 etag（→ 新 idempotency key）SHALL 觸發。in-memory `seen` MAY 留作單輪快取（避免同輪重複查 ledger），但權威去重 SHALL 以持久 ledger 為準。`deriveIntakeFromKey` / `idempotencyKeyFor` 算法 / ledger schema SHALL NOT 因本 change 變更——改的是 tick「要不要觸發」的判定來源。

輪詢間隔 SHALL 受下限保護且下限 SHALL 在 config overrides 合併後仍生效。單一物件的 intake 觸發失敗（presign / 網路 / 逾時 / HTTP error / 2xx 非 JSON）SHALL NOT 將該物件標記為已處理（亦即 SHALL NOT 落 ledger 成功紀錄），watcher SHALL 於後續輪重試（漏抓自癒）；key 層級不符（malformed）為確定性結果，SHALL 計數一次後跳過、不重試。惟重試若收到「已存在且 download 已失敗之 job」的 idempotent replay（replay 依既有 intake 規約不重下載、不重派工），watcher SHALL 將失敗連同 job id 誠實記入 status、SHALL NOT 計為成功觸發、並 SHALL 停止對該物件的無效重試（失敗 job 於 `#/conv` 可見；補救走手動 webhook intake、`POST /api/conversion/trigger` 一鍵觸發、或重新上傳使 etag 改變）。非空 `MINIO_WATCH_PREFIX` SHALL 於 config 層 normalize 為以 `/` 結尾（含 overrides 合併後），避免 boundary-misaligned prefix 造成整批靜默 skip。

> 推翻記錄（本 change supersede）：closed-loop observability design 非目標「不新增手動插隊/優先序佇列 UI」由本 change 推翻——新增「一鍵觸發轉檔」鈕，按下打 **main（`minio-trigger-lifecycle-backend` change，PR #259）已合併的** `POST /api/conversion/trigger`（IP allowlist 守門、server-side presigned、寫持久 ledger；trigger 後端契約以該 change 為準，本 change 只加前端按鈕、不重複規範後端 auth/回應），明示此為「手動 intake **觸發**」而非「佇列插隊」。auto-enroll 處理常態；一鍵鈕用於 retry `failed` / 強制重轉，兩者都經 idempotency key 冪等、不重複建 job。

> 取代記錄（本 change supersede）：原「seen 狀態為 in-memory、不持久化；coordinator 重啟後首輪重建 baseline，停機期間新上傳的物件會被 baseline 吸收而不自動觸發」之已知限制由本 change 解除——去重改查持久 ledger，停機期間上傳的物件在重啟後因 ledger 無紀錄仍會自動觸發；持久化 watermark 即既有 ledger，無需另案新建。

#### Scenario: ledger 無紀錄的既有物件自動補轉（不碰任何按鈕）

- **WHEN** watcher 啟用且 bucket 內既有 `*/model.ifc`（去 prefix/suffix 後 ≥3 段）在持久 ledger 中無對應 `mw_<hash16>` 紀錄
- **THEN** coordinator SHALL 在下一輪輪詢自動建立 intake job 並推進至 dispatch（操作者零介入）、ledger SHALL 落帳
- **AND** payload 的 `project_id` SHALL 由第一段經 `sanitizeArtifactIdPart` 導出、`model_category` SHALL 為倒數第二段、`external_model_version_id` SHALL 為最後一段、`project_display_name` SHALL 為第一段原值，`tenant_id` SHALL 來自設定（未設回退 `tenant_demo_001`）

#### Scenario: 新上傳自動觸發

- **WHEN** watcher 運行中 bucket 出現新的、去 prefix/suffix 後 ≥3 段的 `{專案}/…(動態中間層)…/{種類}/{版本}/model.ifc`（新 key，或同 key 新 etag）
- **THEN** 該物件算出的 idempotency key 在 ledger 中無紀錄 → coordinator SHALL 在下一輪自動建立 intake job 並落帳

#### Scenario: 重啟不風暴（持久 ledger 命中即 skip）

- **WHEN** coordinator 重啟後 watcher 重掃到曾觸發過、已落帳之同 key 同 etag 物件
- **THEN** watcher SHALL 算出同一 idempotency key、命中持久 ledger 既有紀錄而 skip，SHALL NOT 重複建 job 或重複派工
- **AND** ledger count SHALL NOT 因重啟暴增；只有新 key/新 etag（→ 新 idempotency key）SHALL 觸發

#### Scenario: key 未湊齊三段或含路徑穿越段 → malformed 跳過

- **WHEN** 物件 key 去 prefix/suffix 後少於三段、含空段（雙斜線），或任一段為 `.` 或 `..`
- **THEN** watcher SHALL 判 malformed、計數一次後跳過、SHALL NOT 觸發 intake、SHALL NOT 讓純點段原樣成為 `project_id`

#### Scenario: intake 暫時性失敗自癒重試

- **WHEN** 某物件的 loopback intake POST 因暫時性原因失敗（presign 失敗 / 網路錯誤 / 逾時 / HTTP error / 2xx 非 JSON）
- **THEN** watcher SHALL NOT 將該物件標記為已處理（不落 ledger 成功紀錄），SHALL 於後續輪重試直到成功
- **AND** 重試若命中既有去重 SHALL 視為觸發成功（idempotent_replay，不重複建 job）
