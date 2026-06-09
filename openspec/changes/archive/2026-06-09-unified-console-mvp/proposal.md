## Why

`unified-governance-console` 北極星 capability 已於 #180 / #181 以**純規格 change**（`2026-06-04-unified-governance-console`，已 archive）落地並進 live spec。該 change 明確聲明「後續實作 change 依本 capability 為北極星」，且 Non-goals 列出「不實作 overlay / HighlightBridge / MappingCache / GovPanelState、不重構 viewer……皆屬後續實作 change（依本北極星 capability）」。

本 change 即該被**預期的實作 change**：依 live spec 落地統一治理控制台 MVP 垂直切片（5 requirements 的 MVP slice），並把 overlay **真正接上 live viewer**（不只是單元測試過的 UI 骨架）。實作主體在 `web-viewer-sample` 瀏覽器 client；為讓「overlay 從當前 review session 跑 A3 規則檢核」可行（governance-service 的 rule-run 需 server 端 IFC 路徑、瀏覽器不持有也不得手填），**新增一個最小 coordinator session-scoped rule-run 端點**（由 coordinator 端解析 server IFC 路徑後轉發；governance-service 與 data shape 不變）。

## What Changes

- **client governance 純邏輯**：`MappingCache`（雙向 `ifc_guid↔usd_prim_path` + 拒 fake mapping；coverage 不在此計算）、`GovPanelState`（spectator 唯讀 / 等待 viewer）、`HighlightBridge`（client `highlightPrimsRequest`，不復活 server-push）、`govEndpoints`（`guid_exact` / coverage gate：locked 1.0、fallback `<0.9`、measure-first warn）。
- **UI**：`GovernanceOverlay`（A2/A3/A4/A8 = `asbuilt`；A5/A6/A9/A10 標 `p3`/`p4` 且 `disabled`；A3「執行規則檢核」、失敗構件→3D 標示 / 清除標示、A8 開 issue + BCF 下載；未對映 / 降級誠實顯 coverage%）、`IntakeSelectPage`（選現成模型、不手填、可開 viewer）、`OperatorConsole`（`#coordinator`/`#intake`/`#runtime` 三頁獨立殼、不混 overlay）。
- **live 接線（讓 overlay 真正可操作）**：A3 由當前 session 起 rule-run → 輪詢 → `getResults("failed")` 餵 `govFailedElements`；失敗構件→`highlightPrimsRequest`（誠實：送出後等 Kit `highlightPrimsResult` 確認，不假稱已標示）；live viewport 點選（`stageSelectionChanged`）→ `ifc_guid` 反查；A8 `issuesFromRuleRun` + BCF；coverage 來源改為 `streamConfig.quality_metrics_summary.coverage_ratio`（原樣呈現，型別文件規定 viewer MUST NOT compute）；MappingCache 依 `mapping_url` 重建。
- **最小 coordinator 端點**：`POST /api/governance/rule-runs/for-session/:sessionId`（解析 `session → model_version_id` + `externalIfcReadyStore` 進件下載的 host IFC 路徑 → 轉發 governance-service `POST /api/rule-runs`；honest 404 無進件 IFC / 502 governance 離線）。新增 contract doc `docs/contracts/governance-rule-run-proxy.md`。
- 沿用既有 NVIDIA WebRTC streaming library（`AppStreamer.sendMessage`）+ 既有 `streamMessages.ts` builders + 既有 identity profile `element_mapping` + 既有 governance proxy 端點（rule-runs / issues / bcf）。

## Capabilities

### New Capabilities

- None（本 change 為實作交付，不新增 capability）。

### Modified Capabilities

- `unified-governance-console`：本 change 為其 MVP 垂直切片之 **frontend-operable 實作交付**。新增一項可驗收 `### Requirement`（frontend-operable 交付驗收）固化「MVP 以 viewer client 元件 + 一個最小 coordinator session-scoped rule-run 端點交付、前端只經 `:8004`、且須可從前端 route 操作並有 browser E2E 證據」之驗收契約；不修改既有 5 項行為要求（已 live）。

## Impact

- Owner repo / folder：`web-viewer-sample/src/`（governance 模組 + overlay / operator / intake + `main.tsx` / `Window.tsx` 整合）；`bim-review-coordinator/src/routes/governanceProxy.ts`（**新增 1 個 session-scoped rule-run proxy 端點**）+ `docs/contracts/`。
- API / data shape：**新增 1 個 coordinator 端點** `POST /api/governance/rule-runs/for-session/:sessionId`（read-resolve + forward）。governance-service 端點 / `element_mapping` / 既有 stream-config data shape **不變**。
- Runtime boundary：不變（前端只打 `:8004`；3D 著色走 viewer↔Kit 既有 WebRTC DataChannel carve-out；不以治理 / 資料目的直連 `:49102` / `:49101` / `:49100`）。coordinator 僅 resolve server IFC 路徑 + forward，不執行 rule-run、不成為新資料權威。
- Dependencies：**無新增生產依賴**。
- 驗證：`web-viewer-sample` `npm run verify` 全綠（vite build + vitest 111 + struct-log 10）、`npx tsc --noEmit` 0 error；`bim-review-coordinator` `npm run verify` 全綠（279 tests，含 6 個新端點測試）；5-lens 多 agent 交叉對抗驗證 + 外部 CodeRabbit / Codex 複審迴圈修畢。overlay 疊 live 3D 的完整互動 E2E（overlay 跑 A3→失敗構件→3D 標紅→A8 開 issue、真 IFC）於 merge 後 `scripts/deploy.ps1 -Build` 重建部署環境完成（保留環境供檢視）。
- Deploy：coordinator 與 viewer 為 docker 服務，端點 / 接線變更需 `scripts/deploy.ps1 -Build` 重建 image（golden path 不新增 root script）。
- Non-goals：不新增 A5/A6/A9/A10 引擎、不接 spectator 多人協作、不補 `geometry_changed`、不做跨版本 MappingCache、不改 governance-service / streaming / data shape。
