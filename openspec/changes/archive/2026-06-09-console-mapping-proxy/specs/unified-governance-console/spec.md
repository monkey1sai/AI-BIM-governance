## ADDED Requirements

### Requirement: viewer 的 element_mapping 載入 SHALL 經 coordinator :8004 proxy，SHALL NOT HTTP 直連 :49101

統一治理控制台 overlay 的「在 3D 標示」依賴 viewer 端 `MappingCache`（`ifc_guid → usd_prim_path`）。該 `element_mapping` 文件的載入 SHALL 經 coordinator `:8004`（`GET /api/governance/element-mapping/for-session/:sessionId`），SHALL NOT 由瀏覽器 HTTP 直連 `bim-streaming-server` artifact 端點（`:49101`）。理由：(1) 對齊 `web-viewer-sample` 邊界「所有 file URL 查詢一律透過 coordinator」「與 streaming server 的互動限定於 WebRTC video + DataChannel」；(2) hybrid / LAN 部署下 viewer origin ≠ artifact origin 且 artifact 端點無 CORS，直連必 `Failed to fetch` 使 `MappingCache` 為空、標示恆誤判未對映。

coordinator 端點 SHALL 僅解析 `session → 該 session artifact binding 的 mapping_url` 後，於 server 端經 `config.conversionApiBase`（host 可達位址）抓取並原樣回傳，SHALL NOT 解讀 / 改寫 / 保存 mapping（非新資料權威）。誠實：session 或 mapping 無法解析 SHALL 回 404、conversion 不可達 SHALL 回 502，SHALL NOT 偽造空對映或成功。`element_mapping` JSON shape、governance-service / `bim-streaming-server` 端點、stream-config data shape SHALL NOT 改動；SHALL NOT 新增生產依賴；SHALL NOT 給 `:49101` 直接加 CORS（改走 coordinator proxy 才合邊界）。

#### Scenario: viewer 經 coordinator proxy 載入 element_mapping 並能解析有對映構件

- **WHEN** primary viewer 有當前 `reviewSessionId` 且 overlay 需要 `MappingCache`
- **THEN** viewer SHALL 經 `GET /api/governance/element-mapping/for-session/:sessionId`（coordinator `:8004`）載入 `element_mapping`，SHALL NOT 直接 `fetch` 指向 `:49101` 的 `mapping_url`
- **AND** coordinator SHALL 解析該 session 的 `mapping_url`、於 server 端抓取後原樣回傳（200 + 同一 JSON shape），使 viewer `MappingCache` 對「有有效 `usd_prim_path` 的失敗構件」能解析出 prim 並送出 `highlightPrimsRequest`
- **AND** 無 `reviewSessionId`（debug / 本機直開檔）時 viewer MAY fallback 直接抓 `mapping_url`，不影響合規部署路徑

#### Scenario: 誠實失敗 — session / mapping 無法解析或後端不可達

- **WHEN** 呼叫 `GET /api/governance/element-mapping/for-session/:sessionId`
- **THEN** sessionId 格式非法 SHALL 回 400；session 不存在或該 session 無帶 `mapping_url` 的 artifact binding SHALL 回 404
- **AND** conversion artifact 服務不可達時 SHALL 回 502（不偽造空對映、不假稱成功）
- **AND** coordinator SHALL 僅 resolve + forward，SHALL NOT 改動 `element_mapping` 內容或成為新資料權威
