# AI-BIM-governance SaaS — 公開 API 與標準對齊

## §0 文件狀態聲明

- 本檔為增補層，效力低於 `docs-plans-README §1` 所列全部既有文件；衝突一律以既有凍結契約與對齊矩陣 §4.4 裁決為準。
- 全文能力除明確引用已建成項外，一律 **PLANNED·未建**（多附對應階段，如 PLANNED·SaaS-M6）。
- 現況＝單站點單租戶閉環＝tenant zero；本檔描述的 `/v1` 公開 API、gateway、webhook、BCF-API 3.0、IDS BYO-ruleset、bSDD 快取、Edge API Adapter 全部尚未建成。

> 分工邊界：租戶模型／隔離／身分 → `ai-bim-governance-saas-租戶與身分.md`；GPU/計費/session broker → `ai-bim-governance-saas-GPU經濟與計量計費.md`；合規/資料主權/生命週期 → `ai-bim-governance-saas-合規資料主權與生命週期.md`；雲地架構總綱 → `ai-bim-governance-saas-架構總覽.md`。本檔只寫「對外 API 契約與 buildingSMART 標準相容面」，其餘互相引用不重複展開。

---

## §1 `/v1` 公開 namespace 與凍結 `/api` 物理分離（PLANNED·SaaS-M6）

### 1.1 設計原則

全新版本化 `/v1` namespace 是對外開發者 / 第三方 BCF client / webhook 訂閱者的**唯一入口**；與前端 console 現用的內部 `/api` 面**物理分離**、各走各的通道，共用底層 governance 引擎但互不侵入。gateway 經 Edge Connector 通道把請求轉發到落地端凍結路徑，其轉發時延與落地端離線降級行為（未驗證，見 §11）尚待設計與實測。

```txt
第三方 / 開發者 / webhook  ──▶  /v1 gateway（驗 tenant-scoped token → 解析 tenant_id → rate-limit）
                                     │  byte-identical 轉發
                                     ▼
                          凍結內部路徑 /api/...（經 Edge Connector 通道或 Edge API Adapter 落地）

前端 console  ──────────────▶  coordinator 127.0.0.1:8004（/api/... 直打，永不經 gateway）
```

### 1.2 兩條對外契約的分離鐵律

1. **console 不經 gateway**：前端 console 仍直打 coordinator `127.0.0.1:8004` 的 `/api/...`，**完全不經過 `/v1` gateway**。`/v1` 的引入對 console 是零觸碰。
2. **§1 十二條凍結面零觸碰**：gateway 只在其**自有的 `/v1` 前緣**驗 token、解析 tenant_id、rate-limit，然後把請求 **byte-identical 轉發**到凍結內部路徑；不改任何 `/api` 路徑字串、不改後端檔、不在凍結路徑塞 tenant 參數（詳 §3、引 D-34 防線）。
3. **共用底層引擎**：`/v1` 與 `/api` 是同一 governance 引擎的兩個對外投影，不 fork 出第二套業務邏輯；差別只在前緣的租戶認證與版本化封裝。
4. **回退＝關 gateway**：`/v1` gateway 屬 SaaS-M6 additive 元件；停用 gateway 後 console 直打 `:8004` 的行為**完全不受影響**（凍結面本就不依賴 gateway）。

### 1.3 凍結面引用（不重述、不改寫，逐字以來源為準）

以下十二條為前端對齊 DS 手冊 `§1 後端凍結面契約` 的逐字清單；本檔僅引用，任何一條的權威文字以該手冊 §1 為準，`/v1` 轉發不得使其中任一條靜默破壞：

1. **拓樸凍結**：前端**只能打 coordinator `127.0.0.1:8004`**。**永遠不得**新增對 governance-service `:49102`、streaming-server `:49101`、kit-manager `:8010` 的直連。一切走 `/api/governance/*`、`/api/dev/conversions*`、`/api/kit/*`、`/api/external/*` proxy。
2. **proxy 路徑字串 byte-identical（不得改名）**：
   `POST /api/governance/rule-runs`、`/api/governance/rule-runs/for-session/:sessionId`、`/results`、`/failures`、`/export`；`/api/governance/diffs*`（create / `:diffId` / `/items` / `/apply-overlay` / `/issue-impact`）；`/api/governance/federated-sets*`（create / `:setId/members` / `/validate-coords` / `/build` / `/review-room`）；`/api/governance/issues*`（create / list / `:issueId/transition` / `from-rule-run/:runId` / `from-diff/:diffId`）；`/api/governance/bcf/export`；`/api/governance/files/tree`；`/api/governance/element-mapping/for-session/:sessionId`。
3. **轉檔 dev proxy 路徑凍結**：`/api/dev/conversions`（GET/POST）、`/api/dev/conversions/:jobId`、`/:jobId/result`、`/api/dev/conversions/mock`。coordinator 會改寫到 streaming-server `/api/conversions*`，**不得改名**。
4. **`/ui/open?session=...` 凍結 handoff（RK6 CRITICAL）**：必須保留 302→viewer redirect、session-id regex `^(lwv_|review_session_)[A-Za-z0-9_]+$`，且必須註冊在 `/ui` SPA fallback **之前**；**禁止**任何 catch-all 吃掉 `/ui/open` 或 `/ui/console`。React console 由 `/ui` 與 `/ui/*` SPA fallback 提供。
5. **`apply-overlay` 故意回 501**：`POST /api/governance/diffs/:id/apply-overlay` 是 **by design 501**（overlay 走 client `highlightPrimsRequest`，非 server-push）。前端**不得**把它接到「真實後端 overlay」當缺功能補；維持 `p15`。
6. **誠實資料契約不動**：A1 `RuleResult` / A2 `DiffItem` 的 `usd_prim_path` 未映射時為 `null`（**禁捏造**）；semantics endpoint 的 `classification` / `geometry` 維持 `null` + `roadmap[]`；`coverage_ratio==1` 在 `usd_stage_enumeration` 下是**結構性自我參照**——前端**可重新標註說明**，但**不得改後端數值**；`source_kind`（`local_fs` vs `s3`）是 UI 用來判斷檔案來源的誠實標記。
7. **穩定 enum（逐字 echo，禁自創）**：`change_type`（added/removed/moved/geometry_changed/property_changed）；issue `status`（open/assigned/in_progress/resolved/rejected/reopened）；`severity`（low/medium/high/critical）；conversion `status`（queued/running/succeeded/succeeded_with_warnings/failed/cancelled）；session `status`（queued/active/closing/closed）；ifc-ready job status；`KitInstance.status`。`ifc_guid` 是 BCF/governance 永遠存在的主鍵。
8. **rule-run export 只支援 `?fmt=excel`**（`fmt=bcf` → 400）。**BCF 匯出是獨立 endpoint**（`/api/governance/bcf/export` → `.bcfzip`），且**只有在用 `from-rule-run`/`from-diff` 建立 issues 之後**才可用。BCF gating UI 必須誠實呈現這個兩步流程。
9. **control-plane 授權不動**：`prioritize`/`retry`/`watch` 是 IP-allowlist gated 且 audited；`/close` **故意不 gate**（cooperative/operator 雙語意，IX-SS-04）；Kit `open`/`close` 需 `x-dev-token`。前端**不得**假設這些是公開/匿名，也**不得**移除目前送出的 auth header。
10. **權威歸屬凍結**：coordinator 對 project/artifact metadata **只是 reference，非資料權威**。轉檔 artifact / `quality_metrics` / lineage 仍從 streaming-server（經 proxy）讀；rule/diff/issue 權威仍在 governance-service（經 proxy）。**不得**把權威搬進前端或 coordinator。
11. **回應 envelope key 是載重結構（不得 flatten/改名）**：list 用 `{items,count}`（conversions、ifc-ready）或 `{issues}`/`{projects}`/`{results}`/`{items}`；failures 用 `{items,total,limit,offset}`。
12. **DO-NOT-RE-ADD（2026-05-21 已退役）**：socket 協作 server-push（`highlightRequest`/`selectionUpdate`/`annotationCreate`、`getReviewIssues`、`createAnnotation`、`/api/model-versions/:id/review-bootstrap`）。只剩 `/events` 與 `/lifecycle-events`。**禁改的後端檔**：governance-service（`app.py`、`diff_engine/api.py`、`federation/api.py`、`issues/api.py`、`bcf/api.py`、`file_library/api.py`）、coordinator（`src/app.ts`、`src/routes/governanceProxy.ts`）、streaming `conversion_authority.py`。

---

## §2 逐端點 wrap 對照表（PLANNED·SaaS-M6）

`/v1` 只做「租戶認證 + 版本封裝 + byte-identical 轉發」；下表右欄為既有凍結內部路徑（不改名、不改語意）。所有 `/v1` 路徑均要求 tenant-scoped token（帶 `tenant_id` claim），gateway 解析後 rate-limit 再轉發。

| `/v1` 公開端點 | 轉發到（凍結內部路徑，byte-identical） | 說明 |
|---|---|---|
| `POST /v1/governance/rule-runs` | `POST /api/governance/rule-runs`（含 `/for-session/:sessionId`、`/results`、`/failures`、`/export?fmt=excel`） | CPU 軸 rule-run；`export` 只支援 `fmt=excel`（§1.8） |
| `GET/POST /v1/conversions` | `/api/dev/conversions*`（`:jobId`、`/:jobId/result`、`/mock`） | coordinator 再改寫到 streaming-server `/api/conversions*`（§1.3） |
| `/v1/sessions` | `/api/review-sessions*` | 審查 session 生命週期；`/ui/open` handoff 契約不變（§1.4） |
| `/v1/diffs` | `/api/governance/diffs*`（create / `:diffId` / `/items` / `/apply-overlay` / `/issue-impact`） | `apply-overlay` 維持 by-design 501（§1.5） |
| `/v1/federated-sets` | `/api/governance/federated-sets*`（create / `:setId/members` / `/validate-coords` / `/build` / `/review-room`） | A3 federation |
| `/v1/issues` | `/api/governance/issues*`（create / list / `:issueId/transition` / `from-rule-run/:runId` / `from-diff/:diffId`） | Issue 共同出海口（D4 schema 不動） |
| `/v1/bcf/*` | `/api/governance/bcf/export`（→`.bcfzip`） | 現行 BCF 2.1 匯出（§6）；3.0 面為 PLANNED |
| `/v1/files/tree` | `/api/governance/files/tree` | 檔案樹唯讀瀏覽 |

> 表列 `/v1` 端點全部 PLANNED·SaaS-M6·未建；右欄凍結路徑為現況既有面，wrap 不得改其路徑字串、enum echo、envelope key。

---

## §3 凍結契約保護矩陣 ＋ golden-path 守門（PLANNED·SaaS-M6）

`/v1` gateway 一旦做 re-serialize / 重新編碼，最容易在**看不見的地方**破壞凍結契約（enum 大小寫、envelope 攤平、路徑改名）。以下三類逐字 byte-identical 是不可協商的守門對象。

### 3.1 三類 byte-identical

| 類別 | 保護內容 | 破壞樣態（須擋） |
|---|---|---|
| 路徑字串 | §1.2/§1.3 全部 proxy 路徑字串逐字不改名 | gateway 對路徑做「美化」/複數化/加租戶前綴 |
| enum 逐字 echo | §3.2 全部穩定 enum 原樣回傳 | gateway 靜默改大小寫、翻譯、正規化 enum |
| envelope key | `{items,count}` / `{issues}` / `{items,total,limit,offset}` 等載重結構 | gateway flatten、改 key 名、包一層額外 wrapper |

### 3.2 穩定 enum 逐字清單（以前端對齊 DS 手冊 §1.7 為權威）

> 誠實註記：本清單以 repo 凍結契約（手冊 §1.7）**實際 enum 值**為準。gateway 的「byte-identical echo」意即原樣回傳後端所發的以下值，不得增刪、不得改大小寫。

- `change_type`：`added` / `removed` / `moved` / `geometry_changed` / `property_changed`
- issue `status`：`open` / `assigned` / `in_progress` / `resolved` / `rejected` / `reopened`
- `severity`：`low` / `medium` / `high` / `critical`
- conversion `status`：`queued` / `running` / `succeeded` / `succeeded_with_warnings` / `failed` / `cancelled`
- session `status`：`queued` / `active` / `closing` / `closed`
- ifc-ready job status（沿用後端原值）
- `KitInstance.status`（沿用後端原值）
- `ifc_guid`：BCF/governance 永遠存在的主鍵，非 enum 但為 byte-identical 保護對象

### 3.3 golden-path 逐位元組對比測試（SaaS-M6 驗收 gate）

- **測試定義**：對同一請求，分別「直打 `:8004` 的 `/api/...`」與「經 `/v1` gateway 轉發」取回應，做 **byte-for-byte 比對**（狀態碼、header 中的載重相關欄位、body 位元組）。
- **驗收 gate**：SaaS-M6 上線 gate；比對綠才可放行 gateway。
- **迴歸守門**：作為 `§1` 凍結面的迴歸測試，專防 gateway re-serialize / enum 大小寫 / envelope 攤平造成的**靜默破壞**。
- **防線引用**：對應技術債防線 **D-34（tenant 參數禁塞進凍結 governance 路徑）**——code review 檢查點「proxy 路徑字串 grep 不含 tenant」＋對比測試綠。租戶身分只走 token `tenant_id` claim 與 gateway 前緣，**不進凍結路徑字串**。

---

## §4 API 版本策略（PLANNED·SaaS-M6）

- **URL-path 版本化**：對外一律 `/v1/...`；版本進 path 而非 header，讓第三方 client 直觀鎖版。
- **服務發現 `/v1/versions`**：root 提供服務發現端點，比照 buildingSMART **Foundation API `/foundation/versions`** 模式，讓 client 動態發現支援的版本與各版 `base_url`。
- **Deprecation policy**：舊版與新版**並存窗口**；淘汰前於回應加 `Sunset` / `Deprecation` header 預告；破壞性變更**升 major**（`/v1`→`/v2`），非破壞性擴充在同 major 內加欄位。
- **相容承諾**：同一 major 內對既有欄位只加不改不刪，維持第三方整合穩定。

---

## §5 Webhook（PLANNED·SaaS-M6）

- **dispatch pattern＝correlation key ＋ scope 比對，非廣播**：client 建 hook 時指定含 workflow id 的 scope；送 job 時帶相同 id；server 端以 scope 比對決定投遞對象，避免把事件廣播給無關訂閱者（跨租戶隔離的一環，scope 綁 `tenant_id`）。
- **來源驗證＝HMAC（per-tenant secret ＋ 簽章標頭）**：每租戶獨立 secret；投遞附 HMAC 簽章標頭供訂閱端驗來源，防偽造。
- **事件清單**：`conversion.finished` / `rulerun.finished` / `diff.finished` / `session.state`。
- **投遞保證等級（未驗證，見 §11）**：at-least-once / 重試 / 死信策略與 per-tenant secret 輪替均為設計方向，尚未實作驗證，SaaS-M6 前須補設計並定義投遞保證等級。
- **對接既有待辦**：直接補上 ConversionLedger 既有「Phase 2 callback 回填 `usdc`/`coverage`/`ready`」待辦的**對外訂閱層**——轉檔完成 callback 除回填 ledger 外，另發 `conversion.finished` webhook 給訂閱者。
- **payload 紀律**：webhook payload 只承載事件 metadata（狀態/計數/hash/摘要/時戳/版本號/correlation id），**IFC/USD payload 不出站**（H6）。

---

## §6 BCF-API（現行 2.1；3.0＝PLANNED 優先目標）

### 6.1 現行：BCF 2.1

- 現行匯出＝**BCF 2.1**，用官方 IfcOpenShell **`bcf` 庫**語意；本 repo 短期保留 **stdlib 自建的 2.1 匯出以避 GPLv3 依賴**。此為官方對齊鐵律，引用不改寫：**BCF 用官方 bcf 庫語意（現行 2.1 匯出保留，3.0 為升級目標）**。
- 匯出為獨立 endpoint（`/api/governance/bcf/export`→`.bcfzip`），且須先以 `from-rule-run`/`from-diff` 建立 issues 之後才可用（§1.8）；無 viewpoint 時 BCF 內誠實缺省，不假截圖。

### 6.2 PLANNED：BCF-API 3.0 相容面（硬性禁宣稱已支援）

- **狀態硬規範**：BCF-API 3.0 列為**優先標準相容目標**，但全程標 **PLANNED·未建**；文件與銷售物料**硬性禁止宣稱「已支援 3.0」**。客戶要求 3.0 時，以 roadmap（SaaS-M6 相容面設計）揭露回應，不假宣稱。
- **相容面設計要點（僅設計，未實作）**：URL-path `/bcf/{version}/`；階層 `projects → topics → comments/viewpoints`；per-entity authorization（`includeAuthorization`）。
- **實作前置條件**：實作任何 `/bcf/3.0` 端點前，**須先完成向 buildingSMART 的規格確認**，並將確認結果與相容面範圍交人類簽核（見 §6.3 待簽核區塊）。
- **viewpoint 相機對接**：3.0 viewpoint 相機定義（`perspective` / `orthogonal` ＋裁切面）用於把 3D 審查發現回寫成 BCF topic 證據；viewpoint/snapshot 在 3D 證據（M4）後補進 topic。
- **broker 在標準之外**：GPU session broker / WebRTC 串流獨立於 buildingSMART 標準之外（官方 BCF-API 無 WebRTC 概念），**不把 session 塞進標準**。

### 6.3 待人類簽核的新決策 — BCF 3.0 授權面與租戶 ACL 依賴

> 此區塊為凍結面/授權面新決策，未簽核前不得實作；正文不得以肯定語氣預設通過。

- **觸發條件 (a)**：實作任何 `/bcf/3.0` 端點前，須先完成向 buildingSMART 的規格確認（規格確認流程尚未發起，未驗證，見 §11），並將確認結果與相容面範圍交人類簽核。
- **觸發條件 (b)**：任何銷售合約要承諾 BCF 3.0 時程。
- **觸發條件 (c)＝順序依賴**：3.0 的 per-entity authorization（`includeAuthorization`）與本平台租戶 ACL 有依賴關係，而租戶 ACL / issue-BCF assignee 屬 O7 待決（見 `ai-bim-governance-saas-租戶與身分.md` §6）。**3.0 授權面實作須待 O7 租戶 ACL 簽核之後**，順序不可顛倒。

---

## §7 IDS 1.0 BYO-ruleset（PLANNED·SaaS-M6）

- **標準**：IDS 1.0（2024/6 正式標準），以官方 **`ifctester`** 包裝。`ifctester`（IDS）現況已於 A1 規則面實作。
- **BYO-ruleset 服務端點**：把 IDS 檢核做成**租戶可自帶 IDS 檔**的端點（非規則寫死後端），租戶上傳自有 `.ids` 規則集執行檢核。
- **界線不動（官方對齊鐵律，引用不改寫）**：維持「**只驗英數資訊（屬性/數量/分類/材質/關係），不驗幾何、不驗計算值、且假設 IFC 已 schema-valid**」界線；語意不走幾何檔，屬性/Pset 用 ifcopenshell python 另行入庫。
- **分發路徑**：租戶 IDS 規則集經 **Rule & Pipeline Version Distribution**（雲端控制面服務，見 `ai-bim-governance-saas-架構總覽.md` §3）版本化分發至落地端，由 governance-service 照既有機制消費，支援回滾。

---

## §8 bSDD 只讀字典 ＋ 快取（PLANNED）／ openCDE 觀察

- **bSDD 定位**：作為**外部只讀分類/屬性字典**整合來源（IFC entity ↔ Uniclass / OmniClass），使用官方 production / test 環境；**不自建字典**。
- **快取層**：加快取層降延遲，避免每次查詢都打 bSDD 官方端點。
- **openCDE**：buildingSMART Documents / openCDE 母 repo 於 2024/3 **archived**，屬 in-progress 狀態；列**中長期觀察**，不進本輪承諾範圍。

---

## §9 multi-tenancy 外層（PLANNED）

- **標準無租戶語意**：buildingSMART 三大 API（Foundation / BCF / Documents）**皆無 multi-tenancy 語意**——租戶是本平台自建的**外層**概念，不寄望標準提供。
- **映射方式**：`project_id`（BCF 允許任意字串）作前綴 / 映射 `tenant_id`；在 `/auth` 之上疊 **tenant-aware JWT**（帶 `tenant_id` claim）。
- **一致性**：租戶維度一律加在標準端點的**更外層**（token claim 為主），不侵入 BCF/Foundation 既有 path 語意；此與前端 22 條正典路由「租戶維度在 hash 之外」的裁決一致（見 `TARGET-contracts.md` §12）。

---

## §10 Edge API Adapter（選配，PLANNED·SaaS-M6+）

- **定位**：on-prem / BYO 落地端客戶可在**站點本地直接暴露 `/v1`**（不經雲端 gateway），供內網系統整合。
- **強化 H2**：此選項強化「落地端六服務為一級產品元件、永不規劃淘汰」的定位（H2）——客戶拔掉雲端仍能用標準化 `/v1` 對接內網。
- **回退無影響**：無論走雲端 gateway 或落地端 Adapter，前端 console 皆直打 `:8004` 的 `/api`，回退時 console **完全不受影響**。

---

## §11 未驗證假設

> 本章集中列出推論類設計；正文引用時以「（未驗證，見 §11）」標註。以下皆為 PLANNED 設計推論，不得包裝成 runtime-verified fact。

1. **gateway→connector 轉發時延與離線行為未經設計驗證**：`/v1` gateway 把請求經 Edge Connector 通道轉發到落地端凍結路徑，其**轉發時延、逾時策略、落地端離線時 `/v1` 的降級/排隊行為**均未經設計或實測；SaaS-M6 前須補設計並以 golden-path 對比測試 + 離線 E2E 驗收。
2. **BCF 3.0 規格確認流程未啟動**：向 buildingSMART 的 3.0 規格確認尚未發起；`/bcf/{version}/`、per-entity authorization 相容面均為依二手資料推論的設計，未經官方一手確認（見 §6.3）。
3. **byte-identical 轉發的完整破壞面未窮舉**：§3 列舉了路徑/enum/envelope 三類已知破壞樣態，但 gateway 引入的 header 正規化、字元編碼、壓縮、chunked transfer 等是否會造成位元組差異，未經完整枚舉測試。
4. **webhook 投遞保證等級未定**：`§5` 的 at-least-once / 重試 / 死信策略、per-tenant secret 輪替機制均為設計方向，未實作驗證。
5. **標準對齊界線引用自既有文件**：BCF 2.1 / ifcdiff / IDS / Kit extension 的官方對齊鐵律引用自 `TARGET-contracts.md` §7（各項官方來源：IfcOpenShell／BCF／ifcdiff／IDS＝docs.ifcopenshell.org；Kit extensions＝docs.omniverse.nvidia.com），本檔僅承接不重新查證。
