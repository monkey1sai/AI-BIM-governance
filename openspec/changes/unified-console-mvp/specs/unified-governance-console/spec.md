## ADDED Requirements

### Requirement: MVP 垂直切片 SHALL frontend-operable，前端只經 coordinator :8004（後端僅限最小 session-scoped rule-run 端點）

統一治理控制台 MVP 垂直切片的實作主體 SHALL 落在 `web-viewer-sample` 瀏覽器 client（governance 模組 + A1–A10 overlay + operator 三頁 + viewer 整合），且 SHALL 為 frontend-operable（可從前端 route 操作並具 browser E2E 證據，對齊 `AGENTS.md §0.1`），SHALL NOT 以 backend-only 或僅單元測試宣稱完成。

為讓 overlay 從當前 review session 跑 A3 規則檢核（governance-service 的 rule-run 需 server 端 IFC 路徑、瀏覽器不持有也 SHALL NOT 手填），MAY 新增**一個最小 coordinator session-scoped rule-run 端點**（`POST /api/governance/rule-runs/for-session/:sessionId`：解析 `session → 進件下載的 server IFC 路徑` 後轉發 governance-service）。但：前端 SHALL 只經 coordinator `:8004`、SHALL NOT 直連 `:49102` / `:49101` / `:49100`；coordinator SHALL 僅 resolve + forward（不執行 rule-run、不成為新資料權威）；SHALL NOT 改動 governance-service / `bim-streaming-server` 端點或 `element_mapping` / stream-config data shape；SHALL NOT 新增生產依賴。3D 著色 SHALL 重用既有 `buildHighlightPrimsRequest` 經既有 viewer WebRTC DataChannel，SHALL NOT 復活 2026-05-21 退役的 server-push highlight。

#### Scenario: MVP 元件邊界 + 最小 coordinator 端點，不改 data shape

- **WHEN** 交付 MVP 垂直切片實作
- **THEN** client 元件（MappingCache / GovPanelState / HighlightBridge / GovernanceOverlay / OperatorConsole / IntakeSelectPage / viewer glue）SHALL 僅存在於 `web-viewer-sample/src/`
- **AND** 新增的後端 SHALL 僅限 coordinator 的一個 session-scoped rule-run proxy 端點（resolve server IFC 路徑 + forward 至 governance-service），coordinator SHALL 僅 resolve+forward
- **AND** SHALL NOT 改動 governance-service / `bim-streaming-server` 端點或 `element_mapping` / stream-config data shape、SHALL NOT 新增生產依賴、SHALL NOT 復活退役 server-push（3D 著色一律 client `highlightPrimsRequest`）

#### Scenario: 三 operator 頁與治理 overlay 皆可從前端操作且有 E2E 證據

- **WHEN** 驗收 MVP 實作是否完成
- **THEN** `#coordinator` / `#intake` / `#runtime` 三頁 SHALL 可從前端 hash route 操作、各自獨立 render 且不含 A1–A10 治理 overlay，並具 browser E2E 截圖證據
- **AND** A1–A10 治理 overlay SHALL 可疊在 primary viewer 的 live 3D 上操作（從 session 跑 A3 規則檢核 → 失敗構件 → 在 3D 標示 → A8 開 BCF issue），其完整互動 E2E SHALL 於部署環境（`scripts/deploy.ps1` golden path）以真 IFC + 真 3D 截圖佐證
- **AND** 後端不可達時前端 SHALL 誠實顯示錯誤狀態（不偽裝成功、不顯示捏造數值）；3D 標示送出後 SHALL 等 Kit `highlightPrimsResult` 確認再表態，SHALL NOT 在送出當下假稱「已標示」
