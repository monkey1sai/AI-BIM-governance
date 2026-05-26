## ADDED Requirements

### Requirement: RISK-IN-MEMORY-QUEUE-PERSISTENCE

`bim-review-coordinator` 中的轉檔排隊調度任務若僅保存在記憶體中，在伺服器重啟或異常崩潰時，未完成的轉檔任務會被清空，導致外部公司雲端永遠無法獲得 Callback 回報。系統應建立持久化隊列以應對崩潰恢復。

#### Scenario: Coordinator restart drops in-memory queue items
- **WHEN** `bim-review-coordinator` 在多個轉檔任務排隊中時重啟或崩潰
- **THEN** 所有處於 `queued_for_conversion` 的任務狀態會被標記為 `dropped_on_restart`，且無法被自動接續處理，需要操作員重新手動 POST。

---

### Requirement: RISK-CI-GPU-VERIFICATION-BLINDSPOT

專案高度依賴 Windows Host-Native NVIDIA GPU 來執行 Kit Viewport 渲染與 WebRTC 串流，使得在無實體 GPU 的標準 CI/CD 環境下，無法進行畫面正確性與 WebRTC 連線健全性的自動化集成測試。

#### Scenario: Running verification scripts on no-GPU CI environment
- **WHEN** 持續整合 (CI) 環境在沒有實體 NVIDIA 顯示卡的情況下運行驗證腳本
- **THEN** 涉及到 3D 渲染與 WebRTC 串流的相關測試被標記為 `blocked_gpu_runtime_unavailable`，造成 3D 畫面與串流品質的黑盒盲區。

---

### Requirement: RISK-FALLBACK-VISUAL-INCONSISTENCY

當原生 HOOPS 或 Kit 轉檔失敗時，系統會調用 `IfcOpenShell` 與 `pxr` Fallback 方案產出備用的 USDC 模型，但兩者轉檔管線不同，可能會產出結構或外觀不一致的 3D 模型。

#### Scenario: Fallback path activates and produces model
- **WHEN** `bim-streaming-server` 遭遇 Kit 轉換失敗並觸發 `IfcOpenShell/OpenUSD` Fallback 備份路徑
- **THEN** 產出的備用 USDC 與原生 HOOPS 轉換出的模型在 Mesh 節點結構（Prim Tree）、材質精度上可能存在視覺表現不一致，容易導致審查人員產生視覺誤判。

---

### Requirement: RISK-WEBRTC-DATA-CHANNEL-RACE

由於 Kit 啟動為非同步，為了避免與瀏覽器連線競速而使用了 `-SkipAutoLoad`，改由瀏覽器端在建立 WebRTC 連線後，透過 DataChannel 發送 `openStageRequest` 加載模型，這在併發或網路延遲時存在競態風險。

#### Scenario: Multiple concurrent open stage requests
- **WHEN** 網路有高延遲，且多個會話 Client 同時透過 DataChannel 對同一個 Kit 實例發送不同模型的 `openStageRequest`
- **THEN** 轉檔與 Kit 舞台加載狀態可能會發生競態衝突，造成 Kit 舞台資料混亂或加載執行緒卡死。

---

### Requirement: RISK-AI-AGENT-HISTORICAL-HALLUCINATION

專案中退役服務（`_worker` / `_bim-control`）的歷史文件與 placeholder 大量殘留，使得 AI 程式助手在生成代碼時，容易產生歷史幻覺而違背雲地分離的鐵律（如在 callback 中傳遞模型本體）。

#### Scenario: AI agent references legacy components
- **WHEN** AI 程式助手在沒有嚴格的 `AGENTS.md` 規則限制下，依據殘留的歷史文件進行 API 設計
- **THEN** 生成的代碼可能會越過服務邊界（例如使 Coordinator 進行 3D 渲染，或是在 Callback 傳遞大檔案二進制），破壞專案的核心安全邊界。
