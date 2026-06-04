# Tasks — unified-console-mvp（統一治理控制台 MVP 垂直切片實作）

> 實作 change：依 live `unified-governance-console` spec 落地 MVP slice。逐 task TDD（RED→GREEN→commit），全程 client 邊界、誠實鐵律、只打 :8004。

## 1. Phase A — governance 純邏輯單元（不碰 Window.tsx）

- [x] 1.1 A0 量 baseline + 建 `console/governance/` 目錄
- [x] 1.2 A1 `MappingCache` 雙向 `ifc_guid↔usd_prim_path`（鎖單一 model version）
- [x] 1.3 A2 `MappingCache` 拒 fake mapping + 誠實 coverage%（denominator=`source_ifc_entity_count`）
- [x] 1.4 A3 `GovPanelState` spectator 唯讀 + 等待 viewer
- [x] 1.5 A4 `HighlightBridge` failed→`highlightPrimsRequest`（client 主動拉，未對映 / 未就緒誠實回拒）
- [x] 1.6 A5 `govEndpoints` `guid_exact` / coverage gate（measure-first 誠實降級）

## 2. Phase B — overlay 與 operator UI（renderToString smoke）

- [x] 2.1 B1 `GovernanceOverlay` A2/A3/A4/A8 骨架 + provenance；A5/A6/A9/A10 標 `p3`/`p4` disabled
- [x] 2.2 B2 `GovernanceOverlay` spectator 唯讀 disabled + 等待 viewer 文案
- [x] 2.3 B3 `GovernanceOverlay` failed 清單→3D 標紅 / 清除標示 + 未對映 / 降級誠實 coverage%
- [x] 2.4 B4 `IntakeSelectPage` A1 選現成模型（不手填路徑、只打 :8004）
- [x] 2.5 B5 `OperatorConsole` 三頁獨立殼（coordinator/intake/runtime，不含 A1–A10 overlay）

## 3. Phase C — 接進 viewer（漸進式，`gitnexus_impact` 全 LOW）

- [x] 3.1 C1 `main.tsx` 路由分流掛 `OperatorConsole`（保留既有 `<App/>` viewer）
- [x] 3.2 C2 `Window.tsx` 疊 `GovernanceOverlay`（spectator 判定，guarded by `showStream`，保留既有子樹）
- [x] 3.3 C3 `Window.tsx` 餵 `MappingCache`（鎖 version）+ `_onSelectUSDPrims` 點 3D 反查 `ifc_guid`
- [x] 3.4 C4 全套件回歸 + struct-log gate

## 4. 驗證 / 對抗驗證

- [x] 4.1 `npm run verify` 全綠（vite build + vitest 91 + struct-log 10）；`npx tsc --noEmit` 0 error（並修掉一個被 vite build 漏掉的型別錯誤）
- [x] 4.2 5-lens 多 agent 交叉對抗驗證：0 blocker / 0 major；唯一非阻斷 finding（`onClearHighlight` dead wiring）已修（接線清除標示鈕 + spectator 防禦縱深 + 刪 dead `HighlightBridge.clear()`）

## 5. Frontend-operable E2E 驗收

- [x] 5.1 operator console Chrome E2E：`#coordinator`/`#intake`/`#runtime` 三頁 render + hash 路由 + 無 A1–A10 overlay（footer 明示）+ 邊界文字（只打 :8004）+ 後端不可達誠實錯誤態（截圖見 PR）
- [ ] 5.2 overlay 疊 live 3D 完整互動 E2E（點 failed→3D 標紅、A8 開 BCF issue、真 IFC identity 轉檔截圖）：於 merge 後 `scripts/deploy.ps1` 重建部署環境完成並保留環境供檢視
