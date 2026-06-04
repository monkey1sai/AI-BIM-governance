# 統一治理控制台 · Design Spec（北極星）

> 日期：2026-06-04 · 狀態：已核准設計（使用者拍板）· 對應 OpenSpec change：`unified-governance-console`
> 落地端後端：`C:/Repos/active/iot/AI-BIM-governance` · 部署站：https://bim-docs.jackshappybot.com/
> 視覺/互動來源：`C:/Repos/design/bim-desigin-arich/project`（06 操作總覽深色風 + 02 Coordinator 控制台 + mockup）
> 本檔為純設計/規格文件，**不含 production code、不實作**；落地分期見 §8。

## 0. 文件目的與定位

本檔把已核准的「統一治理控制台」設計完整成文，作為後續實作的北極星（north star）。

與前一代「06 操作介面總覽 / Edge Console」最大的不同：

- **舊**：`/console` 殼層與 viewer（`<App/>`）**互斥掛載**（`main.tsx` 對 `/console` 掛 `<EdgeConsole/>`、其餘掛 `<App/>`），治理是「另一個畫面」，3D 標示鏈未接（A1「在 3D 中標示」永遠 disabled、標 `p1`）。
- **新**：**A1–A10 治理操作以 overlay 疊在 primary viewer 的 live 3D 上**，治理與 3D 同框；新增 **HighlightBridge + MappingCache** 打通「點 3D 構件 ↔ IFC GUID ↔ 治理」雙向；治理失敗構件可在同一個 viewer 的 3D 中標紅。

誠實鐵律延續 06 設計（§5），不退化。

## 1. 願景

**統一治理控制台**：把 A1–A10 業務治理操作以 overlay 疊在 primary viewer 的 live 3D 之上，不再是互斥的獨立 `/console` 殼。操作員在同一個畫面內：左側 nav + KPI 卡、中央 live 3D（primary viewer）、右側治理清單/動作（A1–A10 overlay），點 3D 構件即可帶進治理、治理失敗構件即可在 3D 標紅。

三條新的打通機制：

- **HighlightBridge**：治理失敗構件的 `usd_prim_path` → 組成 `highlightPrimsRequest` → 經 viewer 既有 WebRTC DataChannel（`Window._sendStreamMessage`，`Window.tsx:333/337`）送到 Kit runtime 在 3D 標紅。著色走 **client 主動拉**（client → DataChannel → Kit），不復活 2026-05-21 退役的 server-push highlight。
- **MappingCache**：快取 `element_mapping`（`ifc_guid ↔ usd_prim_path`），讓「點 3D 構件 → 查 element_mapping 得 IFC GUID → 帶進治理」與「治理失敗構件 → 查得 usd_prim_path → HighlightBridge 標紅」雙向都能在 client 即時完成。
- **GovPanelState**：集中治理面板的可操作狀態；**spectator 唯讀**——把操作面板 disabled，只看同一串流（沿用 `multi-artifact-kit-routing` 的 primary/spectator 拓樸）。

## 2. 架構

```txt
┌──────────────────────────── 瀏覽器 client（web-viewer-sample） ────────────────────────────┐
│                                                                                            │
│  ┌── operator 頁（獨立 React 路由，非 overlay）──┐   ┌──── primary viewer（<App/> + Window）────┐ │
│  │  /console/coordinator  Coordinator 控制台      │   │   live 3D（WebRTC video + DataChannel）   │ │
│  │  /console/intake       模型進件/版本（A1）       │   │                                          │ │
│  │  /console/runtime      Kit/WebRTC runtime 狀態  │   │   ┌──── A1–A10 治理 overlay 框架 ────┐    │ │
│  └────────────────────────────────────────────┘   │   │  KPI 卡 / 清單 / 動作（右側）        │    │ │
│                                                     │   │  GovPanelState（spectator → disabled）│  │ │
│  ┌── client 內部能力 ──┐                              │   │                                  │    │ │
│  │ MappingCache        │◄──── element_mapping ──────►│   │  HighlightBridge:                │    │ │
│  │ (ifc_guid↔prim_path)│                             │   │   failed 構件 usd_prim_path →     │    │ │
│  └─────────────────────┘                             │   │   highlightPrimsRequest →        │    │ │
│                                                      │   │   _sendStreamMessage(DataChannel)│    │ │
│                                                      │   └──────────────────────────────────┘    │ │
│                                                      └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                               │ 僅此一條：HTTPS / WSS（business state / artifact ref）
                                               ▼
                          ┌──────────── Coordinator :8004（控制平面邊界）────────────┐
                          │  /api/governance/*（proxy）· /api/external/ifc-ready ·    │
                          │  /api/review-sessions · Socket.IO /review · stream-config │
                          └───────────────────────────┬─────────────────────────────┘
                                                       │ internal loopback proxy（瀏覽器永不直連）
                          ┌────────────────────────────┴─────────────────────────────┐
                          │  governance-service 127.0.0.1:49102（A2/A3/A4/A7/A8 引擎）   │
                          │  bim-streaming-server 49100/47998（轉檔 + USD 組合 + Kit）     │
                          │  conversion authority（IFC→USDC + element_mapping）          │
                          └────────────────────────────────────────────────────────────┘
```

關鍵不變式（沿用既有邊界）：

- 瀏覽器只打 Coordinator `:8004`；`governance-service :49102` / `streaming :49100/47998` / conversion authority 皆為內部，**SHALL NOT 直連**。
- 3D 著色由 client 主動拉（`highlightPrimsRequest` 走既有 DataChannel）；**不復活 server-push highlight**（2026-05-21 退役）。
- HighlightBridge / MappingCache / GovPanelState / overlay 框架全在**瀏覽器 client 邊界**內，不新增後端、不改 API/data shape。

## 3. 路由分離（使用者明確要求，不混進 A1–A10 overlay）

三個 operator 頁是**獨立 operator 頁**（非 overlay），與 viewer overlay 互補：

| 路由 | 內容 | 參考設計 |
|---|---|---|
| `/console/coordinator` | Coordinator 控制台：sessions / control（Session 生命週期、Kit Endpoint Pool、Conversion Dispatch、Callback Outbox 三態、Event Feed、N-viewer test） | bim-desigin-arich「02 Coordinator 控制台」（`coordinator/console/pages.jsx` `CoordinatorPage`） |
| `/console/intake` | 模型進件/版本（A1）：於現成模型清單選取（**不手填路徑**）、版本、conversion 狀態、品質摘要 | bim-desigin-arich `IntakePage` + 06 進件頁 |
| `/console/runtime` | Kit / WebRTC runtime 狀態：kit_instance_bindings、stream-config、GPU 卡片（無遙測標未取得，不畫成 fail） | 06 `RuntimePage` |

- 這三頁 **SHALL NOT 混入 A1–A10 治理 overlay**；A1–A10 業務治理才疊在 viewer overlay。
- **轉檔功能併入此控制台**（intake/runtime 涵蓋進件→轉檔→runtime 的 operator 視角）。

## 4. 視覺與互動

- **視覺** = 06 操作總覽**深色**風（bim-desigin-arich console）：深色底、綠 accent、provenance 標籤（`asbuilt` / `artifact` / `demo` / `p1` / `p15`）；100% 保留 `data.jsx` provenance 系統與 `components.jsx` 誠實元件（`Prov` / `Panel` / `Btn` 強制 caption）。
- **互動** = mockup：左 nav + KPI 卡 + 中央 live 3D + 右側清單/動作。
- enum 用 repo 權威值（`SessionStatus` / `KitInstance.status` / `ready_status` 等）；待建項不可假裝 ready，標 `p1` / `p15` 並 disabled。
- 移除一切願景假數字（127 rules / 53 BCF / 73–100 分 / 99.1% GUID / 92.4% mapping 等）。

## 5. 新治理工作流 A1–A10 編號 → 既有引擎對映

採用新治理工作流的 A1–A10 編號（與舊 `roadmap-data.jsx` RM_APPS 的 A1–A10 不同；本表為新編號的權威對映）：

| 新編號 | 名稱 | 對映既有引擎 | 引擎狀態 |
|---|---|---|---|
| **A1** | 進件 / 版本 | coordinator `/api/external/ifc-ready` | 引擎在、UI 弱 |
| **A2** | 轉檔 / 語意映射 | streaming conversion + identity profile + `element_mapping` | ✅ 引擎在 |
| **A3** | 規則庫 / IDS | governance `rule_engine` + `ifctester` | ✅ 引擎在 |
| **A4** | 完整性 / 治理分 | rule-run score | ✅（完整治理分待補）|
| **A5** | 碰撞 / 空間干涉 | —（新引擎，CPU） | ❌ 新引擎 |
| **A6** | 圖模一致 | —（新引擎） | ❌ 新引擎 |
| **A7** | 版本差異 / 責任 | governance `diff_engine`（GlobalId） | ✅ 引擎在（`geometry_changed` 待補）|
| **A8** | Issue / BCF | governance `issues` + `bcf` | ✅ 引擎在 |
| **A9** | AI 搜尋 / 問答 | —（新引擎，LLM/GPU） | ❌ 新引擎 |
| **A10** | 報表 / 稽核 / 封存 | Excel / BCF 匯出 | 部分 |
| （舊 federation） | — | governance `federation` | 降為內部能力（Review Room） |

> 註：舊 federation 不再是頂層 A 編號，降為 Review Room 的內部組合能力。

## 6. MVP 垂直切片

在 primary viewer + 06 深色風上跑通一條垂直線：

```txt
A1 進件（於 /console/intake 選現成模型，不手填路徑）
  → A2 看轉檔/語意映射
  → A3 跑規則檢核
  → A4 看治理分
  → 點 failed 構件在 3D 標紅（HighlightBridge，必含）
  → A8 開 BCF issue
```

MVP 規約：

- **強制 identity profile**：`guid_exact`、`coverage 1.0`。MVP 鎖定此條件，多半不會觸發低覆蓋 fallback。
- 只用**已驗證的** coordinator / governance 端點；全程只打 `:8004`。
- 誠實 provenance；後端離線顯 **502**（不靜默、不偽裝成功）。
- E2E 驗收：用 `storage/` 兩份真 IFC + 瀏覽器截圖。

MVP **不含**：A5 / A6 / A9 / A10、spectator 多人、`geometry_changed`。

## 7. coverage < 90% fallback（引用既有 spec，零新引擎）

MVP 強制 identity 多半不觸發 fallback；一旦觸發（未對映 failed 構件），**誠實降級**而非捏造：

- 未對映 failed 構件 → 誠實顯示「無法在 3D 標示」+ 顯示 coverage%，**SHALL NOT** 以捏造 prim path 取代。

引用既有三份 spec（不新增引擎，引用即可）：

| spec | 引用條款 |
|---|---|
| `host-native-conversion-authority-service` | fallback 不捏造：未對映 entity 報 `unmapped` / `sidecar-only` / `omitted`（不建立假 GUID→prim mapping 灌水 coverage）。 |
| `runtime-verification-evidence` | measure-first：誠實報 coverage、低覆蓋 warn 不 fail；threshold lock 後 `minimum_coverage_ratio=1.0`、`coverage_denominator=source_ifc_entity_count`。 |
| `governance-rule-run-authority` | rule-run 不得把非 `guid_exact` 當 `guid_exact`；未對映 `usd_prim_path=null` 誠實標示；fake/smoke mapping 不得當真實覆蓋率。 |

## 8. 新建元件 + 重構 flag

**新建元件**（皆在瀏覽器 client 邊界）：

| 元件 | 職責 |
|---|---|
| **HighlightBridge** | failed 構件 `usd_prim_path` → `highlightPrimsRequest` → viewer DataChannel（`_sendStreamMessage`）在 3D 標紅；走 client 主動拉，不 server-push。 |
| **MappingCache** | 快取 `element_mapping`（`ifc_guid ↔ usd_prim_path`），支援「點 3D → IFC GUID → 治理」與「治理失敗 → prim_path → 標紅」雙向。 |
| **GovPanelState** | 集中治理面板可操作狀態；spectator 唯讀（disabled）。 |
| **viewer 內 A1–A10 overlay 框架** | 把 A1–A10 治理面板掛進 primary viewer 之上的 overlay 容器。 |

**重構 flag（範圍大、風險高）**：

- 要動 `web-viewer-sample/src/Window.tsx` / `App.tsx`（以及 `main.tsx` 目前的 console↔viewer 互斥掛載邏輯），把 overlay 掛進 viewer。
- 仍在瀏覽器 client 邊界（只打 coordinator），但**範圍大、風險高**。
- **建議**：先抽小框架（overlay 容器 + HighlightBridge/MappingCache/GovPanelState 介面）**保留既有 viewer 行為**，再逐步把治理面板移入；避免一次大改動破壞已驗證的 viewer。

## 9. 分期

```txt
MVP（已有引擎 A2/A3/A4/A8 + A1 進件 + HighlightBridge）
  → +A7 diff/責任 + geometry_changed
  → A5 碰撞（CPU 新引擎）
  → A6 圖模一致 + A4 完整治理分
  → A9 AI 搜尋（LLM/GPU）/ A10 報表稽核封存
  → spectator 多人
```

## 10. 風險與未決問題

### 風險

- **R1 viewer 重構風險高**：動 `Window.tsx` / `App.tsx` / `main.tsx` 互斥掛載是已驗證 viewer 的核心；先抽小框架、保留既有行為，逐步遷移（見 §8 重構 flag）。
- **R2 HighlightBridge 依賴 DataChannel 就緒**：overlay 標紅需 primary viewer 的 WebRTC DataChannel 已連線；DataChannel 未就緒時 overlay 動作 SHALL 誠實標示「等待 viewer 連線」，不做假按鈕。
- **R3 coverage < 90% 觸發降級**：MVP 強制 `guid_exact`/`coverage 1.0` 多半不觸發；觸發時未對映 failed 構件誠實「無法 3D 標示」+ 顯示 coverage%（見 §7），SHALL NOT 捏造。
- **R4 後端離線**：governance / coordinator proxy 離線回 502；前端誠實顯示，SHALL NOT 偽裝成功或顯示舊結果。
- **R5 spectator 誤操作**：spectator 唯讀靠 GovPanelState disabled；SHALL 以 `streamRole` / 角色判定，避免把操作面板誤暴露給 spectator。

### 已裁示決策（2026-06-04 使用者拍板）

- **Q1（overlay 框架抽取粒度）→ 漸進式，不一次到位**：先保留既有 viewer 行為、逐步遷移；抽取步驟由實作 change 在其 design 階段收斂。
- **Q2（MappingCache 失效/重整策略）→ MVP 鎖單一 model version**：MappingCache **不做跨版本智能失效**；多版本切換的快取失效留待 +A7 階段另立議題。
- **Q3（A5/A6/A9/A10 新引擎 + 報表/稽核/封存後端契約）→ 全部拆成獨立 OpenSpec change**：各自獨立規格化，**SHALL NOT 併入本北極星 PR #180、SHALL NOT 併入 MVP scope**。

> 三項已裁示，皆不阻擋 MVP；MVP scope（§6）與 fallback（§7）已以既有引擎與既有 spec 完整界定。
