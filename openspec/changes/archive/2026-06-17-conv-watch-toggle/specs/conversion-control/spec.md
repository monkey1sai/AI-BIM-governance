## ADDED Requirements

### Requirement: MinIO 自動偵測 runtime 開關（watch toggle）

協調器 SHALL 對 MinIO watcher 的輪詢生命週期提供 operator 可在 runtime 開關的 controlled action（`PUT /api/conversion/watch {enabled}`），沿用 IX 模式 3（intent→confirm→audited）。runtime 開關狀態以 in-memory flag 表達（初值=env `MINIO_WATCH_ENABLED`），coordinator 重啟後回 env 初值，不偽稱持久。

#### Scenario: runtime 關閉自動偵測

- **WHEN** operator 對啟用中的 watcher 觸發關閉（`PUT /api/conversion/watch {enabled:false}`）
- **THEN** watcher 安全 dispose（停止輪詢、`poll_count` 不再前進），`GET status` 回 `enabled:false` 且 note 標「已由操作者於 console 關閉」，回 200 並 audit 記 who/when/reason

#### Scenario: runtime 開啟自動偵測（已配置）

- **WHEN** operator 對已配置 MinIO 連線參數、目前關閉態的 watcher 觸發開啟（`PUT {enabled:true}`）
- **THEN** watcher 重建並恢復輪詢，`GET status` 回 `enabled:true`，回 200 並 audit 記錄

#### Scenario: 未配置連線參數誠實拒絕

- **WHEN** operator 對未配置 MinIO 連線參數（endpoint/bucket/credentials 缺）的環境觸發 `PUT {enabled:true}`
- **THEN** 回 422 誠實「not configured」，不空轉、不 throw 未捕捉例外、不假成功

#### Scenario: mutation surface 守門與並發

- **WHEN** caller IP 不在 allowlist，或 toggle 進行中（async dispose 未 settle）再來一筆 PUT
- **THEN** 分別回 403（IP 守門）/ 409（toggle busy 鎖），不得讓任意 LAN origin 匿名開關、不得交錯啟動雙 watcher

#### Scenario: 前端關閉態誠實揭露

- **WHEN** `#conv` 頁 watcher 為關閉態（`enabled:false`）
- **THEN** 佇列頁頂顯示琥珀條「自動偵測已關閉——新 model.ifc 不會自動進件」，且開關動作為非樂觀（toggle 後重抓真 status，失敗顯誠實錯誤不改狀態）
