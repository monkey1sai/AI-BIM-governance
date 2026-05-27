## 1. 規格文檔與方案確認

- [x] 1.1 初始化專案風險規格文件並定義 Requirement ID
- [x] 1.2 完成風險對應的初步技術架構設計 (design.md)
- [x] 1.3 重寫 5 個 Requirement 為 SHALL / MUST 語氣，描述「現行接受的最小行為」(非未來 wishlist)
- [x] 1.4 每個 Requirement 多加「out of scope」scenario，明文「升級實作 MUST 另開 change」
- [x] 1.5 重寫 proposal.md 與 design.md，加 Why / Out of Scope / Decisions 三段
- [x] 1.6 `npx openspec validate project-risks-mitigation --strict` 通過

## 2. Deferred → Successor Changes（不在本 change 實作）

以下三個 task 原本被視為「後續階段」實作 backlog。經 scope 收斂後**正式 defer 為 successor OpenSpec changes**，本 change 一律不實作：

- [~] 2.1 Coordinator 排隊佇列加入本地持久化 (sqlite / file-based)
  - **Defer 至**：未來新 change（建議 ID：`add-coordinator-conversion-queue-persistence`）
  - **理由**：本 change spec `RISK-IN-MEMORY-QUEUE-PERSISTENCE` 已明文「升級實作 MUST 另開 change」
- [~] 2.2 CI 流程整合 GitNexus 跨界防禦自動校驗
  - **Defer 至**：未來新 change（建議 ID：`add-ci-gitnexus-cross-boundary-guard`）
  - **理由**：本 change spec `RISK-AI-AGENT-HISTORICAL-HALLUCINATION` 已明文「升級實作 MUST 另開 change」
- [~] 2.3 WebRTC DataChannel `openStageRequest` 加入連線狀態機與排他鎖
  - **Defer 至**：未來新 change（建議 ID：`add-datachannel-stage-loading-state-machine`）
  - **理由**：本 change spec `RISK-WEBRTC-DATA-CHANNEL-RACE` 已明文「升級實作 MUST 另開 change」

## 3. 驗證

- [x] 3.1 `npx openspec validate project-risks-mitigation --strict` 通過
- [x] 3.2 `npx openspec validate --all --strict` 在 main 上保持其他 31 spec 全綠（本 change 此次預期會由 fail → pass）

Notes:

- `[~]` 標記表示「正式 deferred」，與 `[ ]` (pending) 和 `[x]` (done) 區分。
- Successor change 立案時 owner 應引用本 change 的對應 Requirement ID 作為 origin 依據。
