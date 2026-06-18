# minio-watch-auto-intake Specification

## Purpose
TBD - created by archiving change minio-watch-auto-intake. Update Purpose after archive.
## Requirements
### Requirement: coordinator SHALL 以輪詢自動偵測 MinIO 新 IFC 並觸發既有 intake 鏈（O4 定案）

watcher SHALL 為 env opt-in（`MINIO_WATCH_ENABLED` 預設 false，未啟用時系統行為與無此功能完全一致）。啟用時 SHALL 以 `ListObjectsV2`（含 `IsTruncated`/`NextContinuationToken` 分頁）定時輪詢指定 bucket/prefix，僅對 key 以設定後綴（預設 `/model.ifc`）結尾者反應。首輪 SHALL 只登記 baseline 不觸發；後續輪的新 key 或同 key 新 etag SHALL 觸發對 loopback `POST /api/external/ifc-ready`（帶既有 webhook secret 與 presigned GET URL），由既有下載/sanitize/dispatch/callback 鏈處理。idempotency key SHALL 由 `bucket|key|etag` 確定性導出，重啟重掃同物件 SHALL 命中既有去重（idempotent_replay，不重複建 job）。輪詢間隔 SHALL 受下限保護且下限 SHALL 在 config overrides 合併後仍生效。單一物件的 intake 觸發失敗（presign / 網路 / 逾時 / HTTP error / 2xx 非 JSON）SHALL NOT 將該物件標記為已處理，watcher SHALL 於後續輪重試（漏抓自癒）；key 層級不符（malformed）為確定性結果，SHALL 計數一次後跳過、不重試。惟重試若收到「已存在且 download 已失敗之 job」的 idempotent replay（replay 依既有 intake 規約不重下載、不重派工），watcher SHALL 將失敗連同 job id 誠實記入 status、SHALL NOT 計為成功觸發、並 SHALL 停止對該物件的無效重試（失敗 job 於 `#/conv` 可見；補救走手動 webhook intake 或重新上傳使 etag 改變）。非空 `MINIO_WATCH_PREFIX` SHALL 於 config 層 normalize 為以 `/` 結尾（含 overrides 合併後），避免 boundary-misaligned prefix 造成整批靜默 skip。

已知限制（v1 刻意取捨，review 揭露）：seen 狀態為 in-memory、不持久化；coordinator 重啟後首輪重建 baseline，**停機期間**新上傳的物件會被 baseline 吸收而不自動觸發（補救路徑：既有手動 webhook intake，或重新上傳使 etag 改變）。持久化 watermark 須與 intake 去重索引（同為 in-memory）一併設計，否則重啟後逕行全量觸發會重複建 job — 屬後續 change（與 bucket event 低延遲升級路同列）。

#### Scenario: 新物件自動觸發（不碰任何按鈕）

- **WHEN** watcher 已完成 baseline 且 bucket 出現新的 `{projectId}/{modelId}/model.ifc`
- **THEN** coordinator SHALL 在下一輪輪詢自動建立 intake job 並推進至 dispatch（操作者零介入）
- **AND** payload 的 `project_id`/`external_model_version_id` SHALL 由 key 路徑導出，`tenant_id` SHALL 來自設定（未設回退 `tenant_demo_001`）

#### Scenario: 首輪 baseline 不爆量

- **WHEN** watcher 對既有大量物件的 bucket 首次啟動
- **THEN** 首輪 SHALL 只登記 seen（baseline 計數可見於 status），SHALL NOT 對既有物件觸發任何 intake

#### Scenario: 重啟冪等

- **WHEN** coordinator 重啟後 watcher 重掃到曾觸發過的同 key 同 etag 物件
- **THEN** intake SHALL 回 idempotent replay（同一 job），SHALL NOT 重複建 job 或重複派工

#### Scenario: intake 暫時性失敗自癒重試

- **WHEN** 某新物件的 loopback intake POST 因暫時性原因失敗（presign 失敗 / 網路錯誤 / 逾時 / HTTP error / 2xx 非 JSON）
- **THEN** watcher SHALL NOT 將該物件標記為已處理，SHALL 於後續輪重試直到成功
- **AND** 重試若命中既有去重 SHALL 視為觸發成功（idempotent_replay，不重複建 job）

### Requirement: watcher SHALL 具備安全防護且狀態對 operator 誠實可見

`selfBaseUrl` SHALL 通過 loopback 白名單驗證（hostname 限 `127.0.0.1`/`localhost`、protocol 限 http），否則啟動 SHALL fast-fail（防 SSRF 洩漏 webhook secret）。`MINIO_WATCH_KEY_SUFFIX` SHALL 以 `/` 開頭，否則啟動 SHALL fast-fail（非 boundary-aligned 後綴會讓所有命中物件被判 malformed 而靜默 skip）。watcher 啟用且 `EXTERNAL_INTAKE_IP_ALLOWLIST` 非空但 `127.0.0.1` 與 `::1` 皆不在名單時，啟動 SHALL fast-fail（loopback intake 必然 403，不靜默空轉）。S3 credentials SHALL 僅由 env 提供（`.env.example` 只含空值欄位名）且 SHALL 顯式注入 SDK（不落 IMDS/instance metadata chain）。`GET /api/external/minio-watch/status` SHALL 回報 enabled/bucket/輪詢計數/baseline/seen/觸發/跳過/最近觸發與錯誤，SHALL NOT 包含 credentials 或 presigned URL；`#/conv` 的 watcher Panel 在未啟用時 SHALL 誠實顯示 opt-in 提示而 SHALL NOT 偽稱功能在跑。

#### Scenario: 非 loopback selfBaseUrl 啟動即拒

- **WHEN** `MINIO_WATCH_SELF_BASE_URL` 指向非 loopback host
- **THEN** watcher 啟動 SHALL throw（fast-fail），SHALL NOT 對該 URL 送出任何帶 secret 的請求

#### Scenario: 未啟用時的誠實 UI

- **WHEN** operator 開啟 `#/conv` 而 `MINIO_WATCH_ENABLED` 未設
- **THEN** watcher Panel SHALL 顯示「未啟用（env opt-in）」字樣與真實 status API 結果，SHALL NOT 顯示任何虛構的輪詢數據
