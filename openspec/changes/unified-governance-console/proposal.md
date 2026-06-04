## Why

「06 操作介面總覽 / Edge Console」目前把治理做成與 primary viewer **互斥掛載**的獨立 `/console` 殼（`main.tsx`：`/console` 掛 `<EdgeConsole/>`、其餘掛 `<App/>`）。後果：治理是「另一個畫面」，3D 標示鏈未接——A1「在 3D 中標示」永遠 `disabled` 並標 `p1`（殼層無 WebRTC DataChannel）。使用者已核准下一步北極星：**統一治理控制台**——A1–A10 業務治理以 overlay 疊在 primary viewer 的 live 3D 上，治理與 3D 同框，點 3D 構件即可帶進治理、治理失敗構件即可在同一 viewer 的 3D 標紅。

本 change 是該北極星的**規格落地（純規格/文件，不寫 production code）**：新增北極星 capability `unified-governance-console`，把願景/架構/路由分離/A1–A10 新編號對映/MVP 垂直切片/coverage fallback（引用既有 spec）/新建元件+重構 flag/分期/風險，固化為可驗收的 SHALL 要求；並落地對應的 design doc。後續實作 change 依本 capability 為北極星。

誠實鐵律延續既有 Edge Console 契約（畫面與真實落地一致、無假數字、待建標 `p1`/`p15` 並 disabled、不偽裝成功），不退化。

## What Changes

- 新增 design doc `docs/superpowers/specs/2026-06-04-unified-governance-console-design.md`（北極星完整設計：願景 / 架構 / 路由 / A1–A10 新對映表 / MVP 切片 / coverage fallback / 新建元件 + 重構 flag / 分期 / 風險 + open questions）。
- 新增北極星 capability `unified-governance-console`，ADD 五項可驗收要求：
  1. A1–A10 治理操作 SHALL 疊在 primary viewer overlay（非獨立 console 殼）、spectator SHALL 唯讀（GovPanelState disabled）。
  2. operator 頁 SHALL 分離於 `/console/coordinator`（參考 02 設計）/ `/console/intake` / `/console/runtime`，SHALL NOT 混入 A1–A10 治理 overlay。
  3. 點 3D 構件 ↔ IFC GUID 雙向（MappingCache）+ 治理失敗構件 SHALL 經 client `highlightPrimsRequest`（HighlightBridge）在 3D 標示，走 client 主動拉、不復活 server-push。
  4. MVP 垂直切片 SHALL 強制 identity profile（`guid_exact`、coverage 1.0）；coverage < 90% SHALL 依既有 spec（`host-native-conversion-authority-service` / `runtime-verification-evidence` / `governance-rule-run-authority`）誠實降級、不捏造、不冒充 `guid_exact`。
  5. 前端 SHALL 只經 coordinator `:8004`，SHALL NOT 直連 `:49102`；誠實 provenance + 後端離線 502。

**純規格 / 文件**：不寫 production code、不實作、不新增生產依賴、不改後端、不改 API / data shape、不動既有 viewer 行為（`App.tsx` / `Window.tsx` / `main.tsx` 的實際重構屬後續實作 change）。

## Capabilities

### New Capabilities

- `unified-governance-console`：統一治理控制台北極星。定義「A1–A10 overlay 疊在 primary viewer / spectator 唯讀」「operator 頁路由分離且不混 overlay」「點 3D ↔ IFC GUID 雙向 + 失敗構件 client highlight」「MVP 強制 identity profile 且低覆蓋誠實降級」「前端只經 coordinator + 誠實 provenance / 502」五項 ADDED 要求。

### Modified Capabilities

- None.

## Impact

- 產出物：`docs/superpowers/specs/2026-06-04-unified-governance-console-design.md`（新 design doc）+ `openspec/changes/unified-governance-console/`（proposal / design / tasks / specs delta）。
- Owner repo / folder（北極星指向，本 change 不改 code）：實作落地時為 `web-viewer-sample/src/`（新建 HighlightBridge / MappingCache / GovPanelState / overlay 框架；重構 `Window.tsx` / `App.tsx` / `main.tsx`）；後端引擎沿用既有 `governance-service` / coordinator proxy / streaming，不新增。
- API / data shape：無變更（沿用既有 coordinator `/api/governance/*` proxy、`/api/external/ifc-ready`、`/api/review-sessions`、stream-config 與 governance-service 契約；`element_mapping` 的 `ifc_guid ↔ usd_prim_path` 為既有）。
- Runtime boundary：不變（瀏覽器只打 coordinator `:8004`；不直連 `:49102` / `:49100`；3D 著色走 client `highlightPrimsRequest`，不復活退役 server-push）。
- Dependencies：**無新增生產依賴**。
- 驗收：`npx openspec validate unified-governance-console --strict` → 0 failed；`npx openspec validate --all --strict` → 0 failed。
- Non-goals：本 change 不實作 overlay / HighlightBridge / MappingCache / GovPanelState、不重構 viewer、不新增 A5/A6/A9/A10 新引擎、不接 spectator 多人、不補 `geometry_changed`、不改既有後端與 API。皆屬後續實作 change（依本北極星 capability）。
