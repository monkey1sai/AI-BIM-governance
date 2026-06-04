## ADDED Requirements

### Requirement: MVP 垂直切片 SHALL 以 client-only 元件交付且 frontend-operable

統一治理控制台 MVP 垂直切片的**實作** SHALL 完全落在 `web-viewer-sample` 瀏覽器 client 邊界內交付（governance 純邏輯模組 + A1–A10 overlay + operator 三頁 + viewer 最小整合），SHALL NOT 新增後端 / API / data shape / 生產依賴，SHALL 沿用既有 NVIDIA WebRTC streaming library（`AppStreamer.sendMessage`）與既有 message builders（`buildHighlightPrimsRequest` 等）。該實作 SHALL 為 frontend-operable（可從前端 route 操作並具 browser E2E 證據，對齊 `AGENTS.md §0.1`），SHALL NOT 以 backend-only 或僅單元測試宣稱完成。

#### Scenario: MVP 元件以 client-only 交付、零後端改動

- **WHEN** 交付 MVP 垂直切片實作
- **THEN** 所有新元件（MappingCache / GovPanelState / HighlightBridge / GovernanceOverlay / OperatorConsole / IntakeSelectPage / viewer glue）SHALL 僅存在於 `web-viewer-sample/src/` client 邊界內
- **AND** SHALL NOT 改動 `bim-review-coordinator` / `governance-service` / `bim-streaming-server`，亦 SHALL NOT 新增 API / data shape / 生產依賴
- **AND** 3D 著色 SHALL 重用既有 `buildHighlightPrimsRequest` 經既有 viewer WebRTC DataChannel，SHALL NOT 新增 Kit / USD server-side 指令、SHALL NOT 復活 2026-05-21 退役的 server-push highlight

#### Scenario: 三 operator 頁與治理 overlay 皆可從前端操作且有 E2E 證據

- **WHEN** 驗收 MVP 實作是否完成
- **THEN** `#coordinator` / `#intake` / `#runtime` 三頁 SHALL 可從前端 hash route 操作、各自獨立 render 且不含 A1–A10 治理 overlay，並具 browser E2E 截圖證據
- **AND** A1–A10 治理 overlay SHALL 可疊在 primary viewer 的 live 3D 上操作（失敗構件 → 在 3D 標示 / 清除標示），其完整互動 E2E SHALL 於部署環境（`scripts/deploy.ps1` golden path）以真 IFC + 真 3D 截圖佐證
- **AND** 後端不可達時前端 SHALL 誠實顯示錯誤狀態（不偽裝成功、不顯示捏造數值）
