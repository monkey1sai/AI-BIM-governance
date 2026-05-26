## Context

在 B 方案（雲地分離）架構下，專案的邊界已經收斂。但在實際運行中，轉檔排隊佇列的穩定性、CI/CD 自動化測試的完備性、Fallback 機制產出的模型視覺一致性、網路高延遲下的競態條件，以及 AI 開發流程的合規性防線仍有待加強。本設計旨在提出針對這五個風險的應對策略與長遠架構規畫。

## Goals / Non-Goals

**Goals:**
- 提供五個風險的具體緩解與防禦設計方案。
- 在不影響目前 B 方案最小閉環的基礎上，定義未來的系統加固方向。

**Non-Goals:**
- 在本分支中立刻實作 Redis 或數據庫持久化隊列代碼（此工作將在後續專屬的實作變更中完成）。
- 本地配置虛擬 GPU 或雲端 GPU 測試節點。

## Decisions

### 決策 1：轉檔排隊佇列的持久化
- **方案**：將目前 Coordinator 的 `in-memory` FIFO 隊列，改為結合輕量級持久化（如 sqlite 或 file-based 隊列，或未來引入 Redis/RabbitMQ）的持久化佇列。
- **好處**：當 Coordinator 重啟時，未完成的轉換任務可從持久化存儲中重新載入並重試，避免狀態遺失。

### 決策 2：CI 盲區的模擬合約與三段 Ready 測試覆蓋
- **方案**：在 CI 中強制以 mock/fake 以及 JSON contract 作為主要驗證手段。對於 GPU Kit 渲染部分，以 `observability note` 與 `verification readiness JSON` 來分段評估，並將 "GPU / Kit 實體運行" 獨立於主線 CI pass/fail 外，以免阻塞部署。

### 決策 3：建立 Fallback 模型視覺比對規範
- **方案**：在本地開發機（具有 GPU）環境中，增加視覺測試工具（Visual Regression Test），確保 fallback 方案生成的 USDC 與 HOOPS 轉換的版本，在關鍵 prim 與結構上對齊。

### 決策 4：WebRTC DataChannel 握手與狀態機加鎖
- **方案**：在 Kit server 與 Coordinator 端引入狀態機，確保只有在 WebRTC DataChannel 狀態為 `open`，且 Kit 完成前置 initialization 後，才允許接收並執行 `openStageRequest`；並對併發請求進行排他性加鎖。

### 決策 5：利用 GitNexus 和 AI Journal 建立防越界防線
- **方案**：在 `CLAUDE.md` 和 `AGENTS.md` 中寫死 Source of Truth 優先序與禁止跨界規則，並在 CI 流程中加入 GitNexus 自動檢測，若 AI 修改跨越服務邊界則拒絕 merge。

## Risks / Trade-offs

- [持久化佇列] → 增加本地 coordinator 的 I/O 負擔。
- [CI 模擬驗證] → 測試無法 100% 反映真實 GPU 驅動崩潰或 WebRTC 連線抖動問題。
