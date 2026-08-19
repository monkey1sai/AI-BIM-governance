# 將 console 兩份 capability spec 收斂至已上線行為

## Why

`migrate-console-to-hifi-design` task 7.4 於 2026-08-12 對 `edge-console-operator-frontend`（30 個）與
`unified-governance-console`（36 個）共 66 個 Scenario 做了逐條稽核，產出
`artifacts/2026-08-12-hifi-consumer-spec-scenario-audit.md`，結果為
**48 HOLDS / 3 HOLDS-WITH-NOTE / 9 STALE / 6 UNVERIFIABLE**。

9 項 STALE **皆早於**該次遷移、**非** #357／#358／#429 造成：它們是 spec 措辭落後於已上線程式碼
（多數源自 IA v2 把 `a1`／`a2`／`a3` 讓給 UnifiedConsole workspace）。

這些 STALE **不能在 `migrate-console-to-hifi-design` 內修**。該 change 的 task 8.2 已勾選，逐字宣稱：

> 確認本 change **未修改** `unified-governance-console`、`edge-console-operator-frontend`
> 任一既有 spec 檔案本體（僅新增 `console-design-token-authority`）

在該 change 內動這兩份 spec，會使一個已結案 task 的完成宣稱變成假的，並實質擴張其已宣告的 capability
範圍（其 `specs/` 只有 `console-design-token-authority`，對這兩份 capability 沒有任何 delta）。因此依
task 7.4 自身文字「升級請 coordinator／使用者裁決是否另立 spec 對齊變更」，另立本 change 承接。

## What Changes

把 9 項 STALE 的 spec 措辭收斂到**已上線的真實行為**，逐項附稽核檔的證據行號。不改任何 production
程式碼、不改 `console-design-token-authority`、不碰 `openspec/changes/archive/`。

**已裁決項（owner 2026-08-17 委派 AI 裁決、2026-08-18 owner 明確選定；標 AI-裁決／可推翻）**

`unified-governance-console` R3 Scenario「治理失敗構件經 client highlightPrimsRequest 在 3D 標紅」——
owner 選定 **(b) 把 spec 收斂為 selection highlighting**，不在 Kit 端補顏色實作。實測依據：

- client 側 `web-viewer-sample/src/console/governance/highlightBridge.ts:59,90` 確實依 severity 寫入
  `color: severityToColor(...)`，且 `70-71` 的本地註解已自承 Kit 現行 handler 不讀 color。
- production Kit `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/
  bim_review_stream/messaging/stage_management.py:396-458` 的 `_on_highlight_prims` docstring 自承
  「First MVP uses USD selection as the visual fallback」；`426-442` 只讀 `prim_path`／`usd_prim_path`，
  `444-450` 只呼叫 `clear_selected_prim_paths()` ＋ `set_selected_prim_paths(...)`，回傳 payload
  `410`／`454` 寫死 `"applied_mode": "selection"`；**全檔 `grep -n "color"` 零命中**。

該 Scenario 的三條 THEN／AND（組 request／走既有 DataChannel／不復活退役 server-push）**仍然成立**，
不成立的只有標題所述的「標**紅**」。

## Out of Scope

- **6 項 UNVERIFIABLE 不在本 change**。它們不是 spec 措辭問題，而是需要真實部署 stack／GPU／Kit runtime
  的 browser E2E 才能逐字驗證（`npm run verify` 不含 `test:e2e`）。那是驗證環境欠帳，屬既有 evidence
  gate 的範圍，收斂 spec 措辭不會、也不應使它們變成已驗證。
- 不在 Kit 端實作 highlight 顏色（owner 已選 (b)）。若日後要做，須另開 change。
- 不改 `migrate-console-to-hifi-design` 的任何 checkbox；其 7.4 依規維持 unchecked。
