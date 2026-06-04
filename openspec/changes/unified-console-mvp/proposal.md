## Why

`unified-governance-console` 北極星 capability 已於 #180 / #181 以**純規格 change**（`2026-06-04-unified-governance-console`，已 archive）落地並進 live spec。該 change 明確聲明「後續實作 change 依本 capability 為北極星」，且 Non-goals 列出「不實作 overlay / HighlightBridge / MappingCache / GovPanelState、不重構 viewer……皆屬後續實作 change（依本北極星 capability）」。

本 change 即該被**預期的實作 change**：在 `web-viewer-sample` 瀏覽器 client 邊界內，依 live spec 落地統一治理控制台 MVP 垂直切片（5 requirements 的 MVP slice）。不新增任何後端 / API / data shape / 生產依賴；不新增 SHALL 要求（spec 已 live）。

## What Changes

- 新增 client-only governance 純邏輯：`MappingCache`（雙向 `ifc_guid↔usd_prim_path` + 拒 fake mapping + 誠實 coverage%，denominator=`source_ifc_entity_count`）、`GovPanelState`（spectator 唯讀 / 等待 viewer）、`HighlightBridge`（client `highlightPrimsRequest`，不復活 server-push）、`govEndpoints`（`guid_exact` / coverage gate + measure-first 誠實降級）。
- 新增 UI：`GovernanceOverlay`（A2/A3/A4/A8 = `asbuilt`；A5/A6/A9/A10 標 `p3`/`p4` 且 `disabled`，不做假按鈕；失敗構件→3D 標示 / 清除標示；未對映誠實顯 coverage%）、`IntakeSelectPage`（從 `/api/external/ifc-ready` 選現成模型、不手填路徑）、`OperatorConsole`（`#coordinator`/`#intake`/`#runtime` 三頁獨立殼、不混 overlay）。
- 接進 viewer（漸進式）：`main.tsx` 路由分流掛 `OperatorConsole`（保留既有 `<App/>` viewer 與 `?session=` bootstrap）；`Window.tsx` 最小掛載 `GovernanceOverlay`（guarded by `state.showStream`）+ 餵 `MappingCache`（鎖 model version）+ `_onSelectUSDPrims` 點 3D 反查 `ifc_guid`（保留既有 viewer 子樹與既有 mapping-verification pipeline）。
- 沿用既有 NVIDIA WebRTC streaming library（`AppStreamer.sendMessage`）+ 既有 `streamMessages.ts` builders（`buildHighlightPrimsRequest` / `severityToColor` / `buildClearHighlightRequest`）+ 既有 identity profile `element_mapping`。

## Capabilities

### New Capabilities

- None（本 change 為實作交付，不新增 capability）。

### Modified Capabilities

- `unified-governance-console`：本 change 為其 MVP 垂直切片之 **client-only 實作交付**。新增一項可驗收 `### Requirement`（frontend-operable 交付驗收）固化「MVP 元件以 client-only 在 viewer client 邊界內交付、且須可從前端 route 操作並有 browser E2E 證據」之驗收契約；不修改既有 5 項行為要求（已 live）。

## Impact

- Owner repo / folder：`web-viewer-sample/src/`（新增 `console/governance/*` 模組 + `GovernanceOverlay` / `OperatorConsole` / `IntakeSelectPage`；`main.tsx` / `Window.tsx` 最小整合）。
- API / data shape：**無變更**（只用既有 coordinator `:8004` 端點 + 既有 `element_mapping`）。
- Runtime boundary：不變（前端只打 `:8004`；3D 著色走 viewer↔Kit 既有 WebRTC DataChannel carve-out；不以治理 / 資料目的直連 `:49102` / `:49101` / `:49100`）。
- Dependencies：**無新增生產依賴**。
- 驗證：`web-viewer-sample` `npm run verify` 全綠（vite build + vitest 91 + struct-log 10）、`npx tsc --noEmit` 0 error；5-lens 多 agent 交叉對抗驗證 0 blocker；operator console Chrome E2E（三頁 render + hash 路由 + 無 overlay + 誠實錯誤態）。overlay 疊 live 3D 的完整互動 E2E（點 failed→3D 標紅、A8 開 issue、真 IFC identity 轉檔）於 merge 後 `scripts/deploy.ps1` 重建部署環境完成（保留環境供檢視）。
- Non-goals：不新增 A5/A6/A9/A10 引擎、不接 spectator 多人協作、不補 `geometry_changed`、不做跨版本 MappingCache、不改後端 / API / data shape。
