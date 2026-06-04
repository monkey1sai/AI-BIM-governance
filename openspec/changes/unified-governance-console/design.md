# Design — unified-governance-console

> 完整設計見 design doc：`docs/superpowers/specs/2026-06-04-unified-governance-console-design.md`。
> 本檔為 OpenSpec change 的設計摘要與關鍵決策，與 design doc 同一 source；衝突時以使用者最新明確指令 > 根目錄 AGENTS.md / CLAUDE.md > design doc 為序。

## 脈絡

統一治理控制台北極星：A1–A10 業務治理以 overlay 疊在 primary viewer 的 live 3D 上（取代舊「`/console` 殼與 viewer 互斥掛載」），新增 HighlightBridge + MappingCache + GovPanelState 打通「點 3D 構件 ↔ IFC GUID ↔ 治理」與「治理失敗構件 → 3D 標紅」。本 change 為純規格 / 文件，固化北極星與 MVP 可驗收要求；實作（重構 viewer、抽 overlay 框架）屬後續 change。

## 已查證的既有事實（規格以實況為準，不臆測）

| 主題 | 查證來源 | 結論 |
|---|---|---|
| 互斥掛載 | `web-viewer-sample/src/main.tsx:36-39` | `/console[/...]` 掛 `<EdgeConsole/>`、其餘掛 `<App/>`，兩者互斥 → 治理與 viewer 不同框；北極星要把 A1–A10 疊到 viewer overlay。 |
| 3D 標示鏈 | `Window.tsx:333/337`（`_sendStreamMessage` + `highlightPrimsRequest`）、`clients/streamMessages.ts:53` | `highlightPrimsRequest` 由 viewer 內 WebRTC DataChannel 送出（client 主動拉）；HighlightBridge 必須在 viewer client 內，著色不走 server-push。 |
| GUID ↔ prim | `governanceClient.ts`（`ifc_guid` / `usd_prim_path` 皆 `string | null`）、`governance-rule-run-authority` spec | rule_result 帶 `ifc_guid` + `usd_prim_path`（由 governance-service join `element_mapping`）；未對映 `usd_prim_path=null`。MappingCache 快取此對映。 |
| 邊界 | `governance-rule-run-authority` spec、06 設計 §5 | 瀏覽器只打 coordinator `:8004` `/api/governance/*`；`governance-service :49102` 為內部、不直連。 |
| spectator | `multi-artifact-kit-routing` spec | primary / spectator 拓樸既有；spectator 共享同串流。GovPanelState 把 spectator 操作面板 disabled（唯讀）。 |

## 設計決策

### D1：A1–A10 疊在 primary viewer overlay，operator 頁分離

- A1–A10 業務治理 = viewer overlay（中央 live 3D + 右側清單/動作）。
- `/console/coordinator`（參考 02）/ `/console/intake`（A1，選現成模型不手填路徑）/ `/console/runtime` 是**獨立 operator 頁**，SHALL NOT 混入 A1–A10 overlay。理由：使用者明確要求兩者分離；operator 頁是控制平面視角，治理 overlay 是業務視角。

### D2：3D 標示走 client 主動拉，不復活 server-push

HighlightBridge 把 failed 構件 `usd_prim_path` 組成 `highlightPrimsRequest`，經 viewer 既有 DataChannel（`_sendStreamMessage`）送 Kit。沿用 2026-05-21 退役 server-push 後的既定方向（client → DataChannel → Kit）。未對映 `usd_prim_path=null` 的 failed 構件 SHALL 誠實「無法 3D 標示」+ 顯示 coverage%，不捏造 prim path。

### D3：spectator 唯讀靠 GovPanelState，不靠隱藏

spectator 看同串流但**不可操作**：GovPanelState 把治理操作面板 disabled（可見但 disabled，誠實表態「唯讀」），沿用 `multi-artifact-kit-routing` 的 primary/spectator 拓樸與 `streamRole`。不以「隱藏面板」假裝沒有能力。

### D4：MVP 強制 identity profile，低覆蓋誠實降級（引用既有 spec，零新引擎）

MVP 鎖定 `guid_exact` / `coverage 1.0`，多半不觸發低覆蓋。觸發時依既有三 spec 誠實降級：

- `host-native-conversion-authority-service`：未對映報 `unmapped` / `sidecar-only` / `omitted`，不建立假 GUID→prim mapping 灌水。
- `runtime-verification-evidence`：measure-first（誠實報 coverage、低覆蓋 warn 不 fail；lock 後 `minimum_coverage_ratio=1.0`、`coverage_denominator=source_ifc_entity_count`）。
- `governance-rule-run-authority`：不得把非 `guid_exact` 當 `guid_exact`；fake/smoke mapping 不得當真實覆蓋率。

### D5：重構 viewer 風險高 → 北極星建議先抽小框架

把 overlay 掛進 viewer 需動 `Window.tsx` / `App.tsx` / `main.tsx`（互斥掛載），仍在 client 邊界但範圍大、風險高。北極星建議：先抽 overlay 容器 + HighlightBridge/MappingCache/GovPanelState 介面、保留既有 viewer 行為，再漸進遷移。本 change 不做此重構（規格 only）。

## 邊界與不變式

- 瀏覽器只打 coordinator `:8004`；不直連 `governance-service :49102` / `streaming :49100/47998`。
- 3D 著色走 client `highlightPrimsRequest`（DataChannel）；不復活 server-push highlight。
- HighlightBridge / MappingCache / GovPanelState / overlay 框架皆在瀏覽器 client 邊界內。
- 本 change：不寫 production code、不新增生產依賴、不改後端 / API / data shape、不動既有 viewer 行為。
- 誠實 provenance（`asbuilt`/`artifact`/`demo`/`p1`/`p15`）不退化；後端離線 502 誠實顯示，不偽裝成功。

## 驗收

- `npx openspec validate unified-governance-console --strict` → 通過（0 failed）。
- `npx openspec validate --all --strict` → 0 failed。
- `git diff --cached --check` → 無 trailing whitespace / EOF blank。

## Open Questions

- Q1 overlay 框架抽取粒度（一次到位 vs 漸進，建議漸進）；Q2 MappingCache 跨版本失效策略（MVP 單一 model version）；Q3 A5/A6/A9/A10 新引擎與報表/稽核/封存後端契約（超出北極星與 MVP scope，各自獨立 change）。三者皆不阻擋 MVP；MVP scope 與 fallback 已以既有引擎與既有 spec 完整界定。詳見 design doc §10。
