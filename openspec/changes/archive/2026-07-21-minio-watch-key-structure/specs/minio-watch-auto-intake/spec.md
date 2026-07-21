## MODIFIED Requirements

### Requirement: coordinator SHALL 以輪詢自動偵測 MinIO 新 IFC 並觸發既有 intake 鏈（O4 定案）

watcher SHALL 為 env opt-in（`MINIO_WATCH_ENABLED` 預設 false，未啟用時系統行為與無此功能完全一致）。啟用時 SHALL 以 `ListObjectsV2`（含 `IsTruncated`/`NextContinuationToken` 分頁）定時輪詢指定 bucket/prefix，僅對 key 以設定後綴（預設 `/model.ifc`）結尾者反應。每輪 SHALL 由 `bucket|key|etag` 確定性導出 idempotency key 並查持久 conversion ledger：ledger 無紀錄者（包含首輪既有未轉物件）SHALL 觸發對 loopback `POST /api/external/ifc-ready`（帶既有 webhook secret 與 presigned GET URL）；已有紀錄者 SHALL skip。成功 intake 的 conversion ledger 寫入是 best-effort：若 intake store 已有同一 idempotency key 的 job、但 ledger 因先前 persistence degraded 而缺錄，watcher MAY 再送一次並由 intake idempotency 回同一 job，SHALL NOT 重複建 job 或重複派工；目前不宣稱 watcher 會自動回填該缺失 ledger。`baseline_count` 只表示首輪 list 到的可解析規約檔數，不代表「首輪不觸發」。重啟重掃同 key 同 etag SHALL 算出同一 idempotency key；ledger 有紀錄時 SHALL 在 intake POST 前 skip，新 key 或同 key 新 etag SHALL 產生新 idempotency key 並觸發。輪詢間隔 SHALL 受下限保護且下限 SHALL 在 config overrides 合併後仍生效。單一物件的 intake 觸發失敗（presign / 網路 / 逾時 / HTTP error / 2xx 非 JSON）SHALL NOT 落成功 ledger 紀錄，watcher SHALL 於後續輪重試（漏抓自癒）；key 層級不符（malformed）為確定性結果，SHALL 計數一次後跳過、不重試。

key 結構規約（本 change 由「恰兩層 `{projectId}/{modelId}`」修訂為多層）：去 prefix 與 keySuffix 後 SHALL 為 **≥3 段、皆非空、且無純點段（`.`/`..`）**——第一段為「專案」、**倒數第二段為「種類」**、最後一段為「版本」，中間層（專案管理者動態管理，層數可變）識別時 SHALL 忽略。未湊齊三段、含空段（雙斜線）或含純點段者 SHALL 判 malformed（兼路徑穿越防護，避免 `..` 原樣成為 `project_id`）。`project_id` SHALL 重用 `sanitizeArtifactIdPart`（conversion-artifact-id-sanitize 的單一安全真相）導出（純英數原樣、含非安全 `${safe}_<hash8>`、全非安全純中文 `mv_<hash8>`），使 watcher 自動路徑與手動 intake 路徑對同一名稱得**同一** `project_id`（dispatch 端再 sanitize 對已安全值冪等）。專案原名（如中文）SHALL 以 `project_display_name` 如實保留供顯示/對帳；種類 SHALL 以 `model_category` 帶入。`project_display_name` 與 `model_category` 為 additive/optional；可依 `local-artifact-shadow-metadata` 契約作為非權威 display hints 落本地 store，但 SHALL NOT 成為 project/model authority。完整原始 object key SHALL 由 watcher status `last_triggered[].key` 保留供 UI 完整顯示。非空 `MINIO_WATCH_PREFIX` SHALL 於 config 層 normalize 為以 `/` 結尾。安全 `project_id` 對 raw bytes 直接 hash、不做 Unicode NFC/NFD 正規化（已知限制：NFC≠NFD 來源的同一視覺名稱可能分裂；純漢字 NFC==NFD 穩定）。

> 跨 surface 調和：`minio-fileserver-source` / `a2-version-diff-selector` 描述 bim-control 為兩層 `{projectId}/{modelId}`，指的是 **governance-service 掃本機 `storage/` local_fs（dev fixture 270/889/990）**；本 requirement 規範的是 **watcher 讀的真實雲端 bim-control bucket（≥3 段、含動態中間層）**——不同來源、不相矛盾。

#### Scenario: ledger 無紀錄的既有物件或新物件自動觸發（不碰任何按鈕）

- **WHEN** watcher 掃到一個去 prefix/suffix 後 ≥3 段的 `{專案}/…(動態中間層)…/{種類}/{版本}/model.ifc`，且其 `bucket|key|etag` idempotency key 在持久 ledger 無紀錄
- **THEN** coordinator SHALL 在下一輪輪詢自動建立 intake job 並推進至 dispatch（操作者零介入）
- **AND** payload 的 `project_id` SHALL 由第一段經 `sanitizeArtifactIdPart` 導出、`model_category` SHALL 為倒數第二段、`external_model_version_id` SHALL 為最後一段、`project_display_name` SHALL 為第一段原值，`tenant_id` SHALL 來自設定（未設回退 `tenant_demo_001`）

#### Scenario: key 未湊齊三段或含路徑穿越段 → malformed 跳過

- **WHEN** 物件 key 去 prefix/suffix 後少於三段、含空段（雙斜線），或任一段為 `.` 或 `..`
- **THEN** watcher SHALL 判 malformed、計數一次後跳過、SHALL NOT 觸發 intake、SHALL NOT 讓純點段原樣成為 `project_id`

#### Scenario: 首輪 baseline 為診斷值且以持久 ledger 防重複

- **WHEN** watcher 對既有大量物件的 bucket 首次啟動
- **THEN** `baseline_count` SHALL 誠實回報首輪 list 到的可解析規約檔數
- **AND** ledger 無紀錄者 SHALL 自動觸發並落帳，已有紀錄者 SHALL skip；SHALL NOT 以 in-memory baseline 吸收停機期間上傳的物件

#### Scenario: 重啟冪等

- **WHEN** coordinator 重啟後 watcher 重掃到曾觸發過的同 key 同 etag 物件
- **AND** conversion ledger 已有該 idempotency key 紀錄
- **THEN** watcher SHALL 在 intake POST 前 skip，SHALL NOT 重複建 job 或重複派工

#### Scenario: intake store 有 job 但 ledger 缺錄的降級冪等

- **WHEN** conversion ledger 缺少該 idempotency key，但 intake store 已有同一 idempotency key 的 job
- **THEN** watcher MAY 再送 intake POST，intake SHALL 回 idempotent replay（同一 job），SHALL NOT 重複建 job 或重複派工
- **AND** watcher 目前不宣稱自動回填缺失 ledger；後續重啟 MAY 再次依同一路徑重試

#### Scenario: intake 暫時性失敗自癒重試

- **WHEN** 某新物件的 loopback intake POST 因暫時性原因失敗（presign 失敗 / 網路錯誤 / 逾時 / HTTP error / 2xx 非 JSON）
- **THEN** watcher SHALL NOT 將該物件標記為已處理，SHALL 於後續輪重試直到成功
- **AND** 重試若命中既有去重 SHALL 視為觸發成功（idempotent_replay，不重複建 job）
