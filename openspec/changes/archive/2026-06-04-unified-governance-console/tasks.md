# Tasks — unified-governance-console

> 純規格 / 文件 change：不寫 production code、不實作。任務為「查證既有事實 → 落地 design doc → 固化北極星 capability → 驗證」。

## 1. 既有事實查證（規格以實況為準，不臆測）

- [x] 1.1 確認互斥掛載：`web-viewer-sample/src/main.tsx:36-39`（`/console` 掛 `<EdgeConsole/>`、其餘掛 `<App/>`）→ 北極星要把 A1–A10 疊到 primary viewer overlay。
- [x] 1.2 確認 3D 標示鏈：`Window.tsx:333/337` `_sendStreamMessage` + `highlightPrimsRequest`、`clients/streamMessages.ts:53` → HighlightBridge 在 viewer client 內、走 client 主動拉，不 server-push。
- [x] 1.3 確認 GUID↔prim：`governanceClient.ts`（`ifc_guid`/`usd_prim_path` 皆 `string|null`）+ `governance-rule-run-authority` spec（未對映 `usd_prim_path=null`）→ MappingCache 快取 `element_mapping`。
- [x] 1.4 確認邊界：瀏覽器只打 coordinator `:8004` `/api/governance/*`；`governance-service :49102` 為內部（`governance-rule-run-authority` spec）。
- [x] 1.5 確認 spectator 拓樸：`multi-artifact-kit-routing` spec（primary/spectator）→ GovPanelState 把 spectator 操作面板 disabled（唯讀）。
- [x] 1.6 確認 fallback 引用 spec：`host-native-conversion-authority-service`（unmapped/sidecar-only/omitted、不造假 GUID）、`runtime-verification-evidence`（measure-first、lock 後 `minimum_coverage_ratio=1.0`）、`governance-rule-run-authority`（不得冒充 `guid_exact`）。

## 2. Design doc（北極星完整設計）

- [x] 2.1 建 `docs/superpowers/specs/2026-06-04-unified-governance-console-design.md`：願景 / 架構 / 路由分離 / A1–A10 新編號對映表 / MVP 垂直切片 / coverage fallback（引用既有 spec）/ 新建元件 + 重構 flag / 分期 / 風險 + open questions。

## 3. OpenSpec change artifacts

- [x] 3.1 `proposal.md`：Why / What Changes / Capabilities（New: `unified-governance-console`）/ Impact（純規格、無生產依賴、不改後端 / API）。
- [x] 3.2 `design.md`：設計摘要 + D1–D5 決策 + 邊界不變式 + 驗收 + Open Questions（指向 design doc）。
- [x] 3.3 `specs/unified-governance-console/spec.md`：ADD 五項要求，每項 ≥1 個含誠實條款的可驗收 Scenario，保留 parser 標頭（`## ADDED Requirements` / `### Requirement:` / `#### Scenario:` / `SHALL`）。

## 4. 驗證

- [x] 4.1 `npx openspec validate unified-governance-console --strict` → 0 failed。
- [x] 4.2 `npx openspec validate --all --strict` → 43 passed / 0 failed。
- [x] 4.3 `git diff --cached --check` → 無 trailing whitespace / EOF blank。

## 5. 後續實作 change（非本 change scope，依本北極星 capability）

- [ ] 5.1 抽 overlay 框架 + HighlightBridge / MappingCache / GovPanelState 介面（保留既有 viewer 行為）。
- [ ] 5.2 把 A1–A10 治理面板移入 primary viewer overlay；重構 `Window.tsx` / `App.tsx` / `main.tsx` 互斥掛載。
- [ ] 5.3 MVP 垂直切片實作（A1 進件 → A2 → A3 → A4 → HighlightBridge 標紅 → A8 BCF issue），E2E 用 `storage/` 兩份真 IFC + 截圖。
- [ ] 5.4 後段：+A7 / `geometry_changed` → A5 碰撞（CPU 新引擎）→ A6 + A4 完整分 → A9 / A10 → spectator 多人。
