# edge-console-operator-frontend — Spec Delta (edge-console-a1a3-interface-completion)

> frontend gap 報告 P1 主線：補齊 A1/A2/A3「真實可驗證」缺口。誠實鐵律優先——真的接 live 的
> 才標 asbuilt 並接（A1 Excel）；後端誠實回 501 / 此鏈未接的標誠實 p1/p15 並顯示後端誠實訊息
> （A2 apply-overlay 501、A1 3D 標示需 viewer DataChannel），不做假按鈕、不偽裝成功、不顯示假數字。

## ADDED Requirements

### Requirement: A1 Rule Center SHALL 提供真實 Excel 匯出與誠實標示的 3D 標示入口

A1 Rule Center（`IssuesRuleCenterPage`）SHALL 提供 [匯出 Excel] 入口，經 coordinator proxy `GET /api/governance/rule-runs/:id/export?fmt=excel` 觸發 governance-service 真實匯出並下載，標 `asbuilt`；成功 rule-run 前 SHALL `disabled`（無 run 不可匯出）。A1 SHALL 提供 [在 3D 中標示] 入口；因 Edge Console（`/console`）與 viewer（`<App/>`）互斥掛載、殼層無 WebRTC DataChannel，`highlightPrimsRequest` 鏈未接，該入口 SHALL 標 `p1` 並 `disabled` 且誠實說明「需 viewer DataChannel（後續整合）」，SHALL NOT 呈現為點了無回應的假按鈕；未對映 `usd_prim_path=null` SHALL 誠實顯示無法標示。

#### Scenario: Excel 匯出為真實下載且成功 run 前 disabled

- **WHEN** 操作員開啟 A1 Rule Center 但尚未成功跑 rule-run
- **THEN** [匯出 Excel] 按鈕 SHALL 存在且 `disabled`
- **WHEN** rule-run 成功（取得 `runId` 且 `status === "succeeded"`）後點 [匯出 Excel]
- **THEN** 前端 SHALL 呼叫 `governanceClient.exportUrl(runId)`（coordinator proxy 透傳至 governance-service openpyxl 匯出）並下載 `.xlsx`
- **AND** 該入口 SHALL 標 `asbuilt`（已實作），SHALL NOT 標待建

#### Scenario: 3D 標示入口因無 DataChannel 而誠實標 p1（非假按鈕）

- **WHEN** 操作員開啟 A1 Rule Center
- **THEN** [在 3D 中標示] 按鈕 SHALL 標 `p1` 且 `disabled`
- **AND** SHALL 誠實說明需 viewer 的 WebRTC DataChannel（`highlightPrimsRequest`），console 殼層目前無此鏈
- **AND** SHALL NOT 呈現為「點了沒反應」的可點假按鈕

### Requirement: A2 VersionDiff SHALL 經 apply-overlay 端點誠實呈現後端狀態，SHALL NOT 偽裝成功

A2 VersionDiffPage SHALL 提供 [套用 3D Overlay] 入口，經 coordinator proxy `POST /api/governance/diffs/:id/apply-overlay` 呼叫 governance-service。該端點後端誠實回 501（3D 著色走 client `highlightPrimsRequest`，非後端 server-push），故前端 SHALL 標 `p15` 並顯示後端誠實回應（含狀態碼與說明），SHALL NOT 把 501 / 502 偽裝成成功，SHALL NOT 顯示捏造的 overlay 結果。成功 diff 前該入口 SHALL `disabled`。

#### Scenario: apply-overlay 回 501 時誠實顯示，不偽裝成功

- **WHEN** 操作員在成功 diff 後點 [套用 3D Overlay]
- **THEN** 前端 SHALL 呼叫 coordinator `/api/governance/diffs/:id/apply-overlay`（SHALL NOT 直連 `:49102`）
- **AND** 後端回 501 時前端 SHALL 顯示後端狀態碼（`501`）與誠實說明（走 client `highlightPrimsRequest`，需 viewer DataChannel；非 server-push）
- **AND** 該入口 SHALL 標 `p15`，SHALL NOT 顯示「成功套用 overlay」或任何捏造結果

#### Scenario: 成功 diff 前 apply-overlay 入口 disabled

- **WHEN** 尚未取得成功 diff（無 `diffId`）
- **THEN** [套用 3D Overlay] 按鈕 SHALL `disabled`
- **AND** SHALL NOT 在無 diff 時送出 apply-overlay 請求

### Requirement: A3 Federation SHALL 提供 build 時 member visibility 並誠實標示須重新 Build

A3 FederationPage SHALL 在 member 表提供 `visible` 切換，於 build 前以 `visibility_default` 帶入 `POST /api/governance/federated-sets/:id/members`。因後端僅提供 build 時 visibility（隱藏 member 寫成 invisible 並於 build 回傳 `hidden[]`）、無「不重建即時切換」端點，前端 SHALL 誠實標示「改 visible 須重新 Build 才生效」，SHALL NOT 捏造即時切換能力。build 成功後 SHALL 顯示後端回傳的 `hidden` members 作為真實證據。

#### Scenario: member visibility 於 build 時帶入且誠實標示須重新 Build

- **WHEN** 操作員在 A3 Federation 取消某 member 的 `visible` 並 Build
- **THEN** 前端 SHALL 以 `visibility_default=false` 帶入該 member 後再 build
- **AND** build 成功後 SHALL 顯示後端回傳的 `hidden members`（visibility=false）
- **AND** 前端 SHALL 誠實標示「無不重建即時切換端點，改 visible 須重新 Build 才生效」，SHALL NOT 宣稱可即時切換 visibility
