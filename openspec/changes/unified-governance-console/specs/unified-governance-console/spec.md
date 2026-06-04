# unified-governance-console — Spec Delta (unified-governance-console)

> 北極星 capability：統一治理控制台。A1–A10 業務治理以 overlay 疊在 primary viewer 的 live 3D 上（取代舊「`/console` 殼與 viewer 互斥掛載」），HighlightBridge + MappingCache + GovPanelState 打通「點 3D 構件 ↔ IFC GUID ↔ 治理」與「治理失敗構件 → 3D 標紅」。誠實鐵律延續既有 Edge Console 契約：畫面與真實落地一致、無假數字、待建標 `p1`/`p15` 並 disabled、後端離線顯 502、不偽裝成功、不捏造、不冒充 `guid_exact`、不復活 2026-05-21 退役的 server-push highlight。完整設計見 `docs/superpowers/specs/2026-06-04-unified-governance-console-design.md`。

## ADDED Requirements

### Requirement: A1–A10 治理操作 SHALL 疊在 primary viewer overlay，spectator SHALL 唯讀

統一治理控制台的 A1–A10 業務治理操作 SHALL 以 overlay 疊在 primary viewer 的 live 3D 之上（中央 live 3D + 右側治理清單 / 動作），SHALL NOT 退回為與 viewer 互斥掛載的獨立 `/console` 殼。spectator 角色 SHALL 唯讀：經 GovPanelState 將治理操作面板 `disabled`（面板可見但不可操作，誠實表態「唯讀」），SHALL NOT 對 spectator 隱藏面板而假裝該能力不存在，SHALL NOT 讓 spectator 觸發 A1–A10 治理動作。primary / spectator 拓樸沿用 `multi-artifact-kit-routing`（spectator 共享同一串流）。

#### Scenario: A1–A10 治理以 overlay 疊在 primary viewer 而非獨立殼

- **WHEN** primary viewer 載入並開啟 A1–A10 治理
- **THEN** A1–A10 治理面板 SHALL 以 overlay 呈現在同一個 primary viewer 的 live 3D 之上（治理與 3D 同框）
- **AND** SHALL NOT 以「與 viewer 互斥掛載的獨立 console 殼」呈現（不得是「另一個畫面」）

#### Scenario: spectator 看同串流但治理面板唯讀（disabled，非隱藏）

- **WHEN** 一個 spectator 角色加入同一 review session 並看到 A1–A10 overlay
- **THEN** GovPanelState SHALL 將治理操作面板標為 `disabled`（唯讀）
- **AND** spectator SHALL 仍看到與 primary 相同的串流與面板內容（不隱藏）
- **AND** spectator SHALL NOT 能觸發任何 A1–A10 治理動作（建立 / 派工 / 標示 / 匯出等）

### Requirement: operator 頁 SHALL 分離於三條獨立路由，SHALL NOT 混入 A1–A10 治理 overlay

統一治理控制台 SHALL 提供三個**獨立 operator 頁**（非 viewer overlay）：`/console/coordinator`（Coordinator 控制台：sessions / control，參考 bim-desigin-arich「02 Coordinator 控制台」設計）、`/console/intake`（模型進件 / 版本，A1）、`/console/runtime`（Kit / WebRTC runtime 狀態）。這三頁 SHALL NOT 混入 A1–A10 業務治理 overlay；A1–A10 治理 SHALL 僅疊在 primary viewer overlay。`/console/intake` 的 A1 進件 SHALL 讓操作員從現成模型清單選取，SHALL NOT 要求手填模型路徑。

#### Scenario: 三個 operator 頁獨立且不含 A1–A10 治理 overlay

- **WHEN** 操作員開啟 `/console/coordinator` 或 `/console/intake` 或 `/console/runtime`
- **THEN** 該頁 SHALL 呈現為獨立 operator 頁（Coordinator 控制 / 進件版本 / runtime 狀態）
- **AND** 該頁 SHALL NOT 內嵌 A1–A10 業務治理 overlay
- **AND** A1–A10 業務治理 SHALL 僅出現在 primary viewer 的 overlay，不混入 operator 頁

#### Scenario: A1 進件於現成模型清單選取，不手填路徑

- **WHEN** 操作員在 `/console/intake` 進行 A1 進件
- **THEN** 介面 SHALL 提供現成模型 / 版本清單供選取
- **AND** SHALL NOT 要求操作員手動輸入模型檔案路徑

### Requirement: 點 3D 構件 ↔ IFC GUID 雙向 + 治理失敗構件 SHALL 經 client highlightPrimsRequest 在 3D 標示

統一治理控制台 SHALL 提供 3D 構件與 IFC GUID 的雙向打通（MappingCache 快取 `element_mapping` 的 `ifc_guid ↔ usd_prim_path`）：點 3D 構件 SHALL 經 `element_mapping` 反查得 IFC GUID 並帶進治理；治理失敗構件 SHALL 經其 `usd_prim_path` 由 HighlightBridge 組成 `highlightPrimsRequest`、透過 viewer 既有 WebRTC DataChannel（client 主動拉）在 3D 標示。3D 著色 SHALL 走 client `highlightPrimsRequest`，SHALL NOT 復活 2026-05-21 退役的 server-push highlight。未對映（`usd_prim_path=null`）的失敗構件 SHALL 誠實顯示「無法在 3D 標示」並顯示 coverage%，SHALL NOT 以捏造的 prim path 取代以假裝可標示。

#### Scenario: 治理失敗構件經 client highlightPrimsRequest 在 3D 標紅

- **WHEN** 操作員在 A1–A10 overlay 對一個帶有效 `usd_prim_path` 的治理失敗構件按「在 3D 標示」
- **THEN** HighlightBridge SHALL 以該 `usd_prim_path` 組成 `highlightPrimsRequest`
- **AND** SHALL 經 primary viewer 既有的 WebRTC DataChannel（`Window._sendStreamMessage`，client 主動拉）送至 Kit runtime
- **AND** SHALL NOT 透過已退役的 server-push highlight 機制標示

#### Scenario: 點 3D 構件反查 IFC GUID 帶進治理

- **WHEN** 操作員在 primary viewer 的 3D 中點選一個構件
- **THEN** MappingCache SHALL 以該構件的 `usd_prim_path` 經 `element_mapping` 反查得對應 `ifc_guid`
- **AND** SHALL 將該 `ifc_guid` 帶進 A1–A10 治理（作為治理操作的目標構件）

#### Scenario: 未對映的失敗構件誠實標示無法 3D 標示，不捏造 prim path

- **WHEN** 一個治理失敗構件的 `usd_prim_path` 為 `null`（未對映）
- **THEN** overlay SHALL 誠實顯示「無法在 3D 標示」並顯示當前 coverage%
- **AND** SHALL NOT 以任意或捏造的 prim path 觸發 `highlightPrimsRequest` 假裝可標示

### Requirement: MVP 垂直切片 SHALL 強制 identity profile，coverage 不足 SHALL 依既有 spec 誠實降級

MVP 垂直切片（A1 進件 → A2 轉檔 / 語意映射 → A3 規則檢核 → A4 治理分 → 點 failed 構件在 3D 標紅 → A8 開 BCF issue）SHALL 強制 identity profile 為 `guid_exact` 且 coverage 為 `1.0`。當 coverage < 90%（低覆蓋 fallback 觸發）時，系統 SHALL 依既有 spec 誠實降級：依 `host-native-conversion-authority-service` 把未對映 entity 報為 `unmapped` / `sidecar-only` / `omitted` 且 SHALL NOT 建立假 GUID→prim mapping 灌水 coverage；依 `runtime-verification-evidence` 採 measure-first（誠實報 coverage、低覆蓋 warn 不 fail、threshold lock 後 `minimum_coverage_ratio=1.0`、`coverage_denominator=source_ifc_entity_count`）；依 `governance-rule-run-authority` SHALL NOT 把非 `guid_exact` 的 mapping 當作 `guid_exact`，且 fake / smoke mapping（`mock` / `allow_fake_mapping` / `fake_mapping_count>0` / `mapping_method=fake_for_smoke_test`）SHALL NOT 被當作真實覆蓋率。MVP SHALL 只使用已驗證的 coordinator / governance 端點，SHALL NOT 引入新引擎以滿足 fallback。

#### Scenario: MVP 強制 guid_exact 且 coverage 1.0

- **WHEN** 啟動 MVP 垂直切片並進件一份真實 IFC 模型
- **THEN** MVP SHALL 要求 identity profile 為 `guid_exact` 且 coverage 為 `1.0`
- **AND** 在此條件下 failed 構件 SHALL 具備可標示的 `usd_prim_path`（低覆蓋 fallback 多半不觸發）

#### Scenario: coverage 不足時誠實降級，不捏造、不冒充 guid_exact

- **WHEN** 進件模型的 coverage < 90%（低覆蓋 fallback 觸發），部分 failed 構件未對映
- **THEN** 系統 SHALL 依 `host-native-conversion-authority-service` 把未對映 entity 報為 `unmapped` / `sidecar-only` / `omitted`，SHALL NOT 建立假 GUID→prim mapping 灌水
- **AND** SHALL 依 `runtime-verification-evidence` 誠實報出 coverage（measure-first；threshold lock 後 `minimum_coverage_ratio=1.0`、`coverage_denominator=source_ifc_entity_count`）
- **AND** SHALL 依 `governance-rule-run-authority` 不把非 `guid_exact` 的 mapping 當 `guid_exact`，且 fake / smoke mapping 不得當真實覆蓋率
- **AND** 未對映 failed 構件 SHALL 誠實顯示「無法在 3D 標示」+ coverage%，SHALL NOT 捏造 prim path

### Requirement: 前端 SHALL 只經 coordinator :8004，SHALL NOT 直連 :49102；誠實 provenance + 後端離線 502

統一治理控制台前端（含 A1–A10 overlay、三個 operator 頁、HighlightBridge / MappingCache 的資料存取）SHALL 只經 coordinator `:8004`（`/api/governance/*` proxy、`/api/external/ifc-ready`、`/api/review-sessions`、stream-config 等已驗證端點），SHALL NOT 直連 `governance-service` 的 `127.0.0.1:49102`，亦 SHALL NOT 直連 `bim-streaming-server` 的 `49100/47998`。前端 SHALL 對每塊資料與每顆動作標誠實 provenance（`asbuilt` / `artifact` / `demo` / `p1` / `p15`），待建項 SHALL 標 `p1` / `p15` 並 `disabled`。當 coordinator / 後端不可達時，前端 SHALL 誠實顯示 502（後端離線），SHALL NOT 偽裝成功、SHALL NOT 顯示捏造數值、SHALL NOT 殘留舊結果假裝成功。

#### Scenario: 治理請求經 coordinator proxy，不直連內部埠

- **WHEN** 前端（overlay 或 operator 頁）需要觸發或讀取 A1–A10 治理資料
- **THEN** 它 SHALL 呼叫 coordinator `:8004` 的 `/api/governance/*`（或其他已驗證 coordinator 端點）
- **AND** SHALL NOT 直接連線 `governance-service` 的 `127.0.0.1:49102` 或 streaming 的 `49100/47998`

#### Scenario: 後端離線時誠實顯示 502，不偽裝成功

- **WHEN** 前端送出治理請求但 coordinator / 後端不可達
- **THEN** 前端 SHALL 誠實顯示 502（後端離線）的錯誤狀態
- **AND** SHALL NOT 偽裝成功、SHALL NOT 顯示捏造數值、SHALL NOT 殘留舊結果假裝成功

#### Scenario: 待建能力誠實標 p1 / p15 並 disabled，不做假按鈕

- **WHEN** 某 A1–A10 能力的後端鏈尚未接通（例如新引擎 A5/A6/A9/A10 或 server-push 類動作）
- **THEN** 對應入口 SHALL 標 `p1` 或 `p15` 並 `disabled`，並誠實說明待建原因
- **AND** SHALL NOT 呈現為「點了沒反應」的可點假按鈕，SHALL NOT 假裝該能力已 ready
