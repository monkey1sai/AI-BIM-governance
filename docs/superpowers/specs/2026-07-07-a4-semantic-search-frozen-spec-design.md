# Spec-4：A4 語意搜尋（規格凍結稿 · 本輪不實作）

> 日期：2026-07-07 · 狀態：**規格凍結稿——使用者裁定本輪只立 spec、不實作**。
> 開工條件：使用者明確下達 A4 開工令，且 §5 待人類決策全數拍板。
> 在此之前：`#a4` 維持 AppVisionPage 願景頁（`prov:"p4"`、全 action disabled、**對 `/api/*` 零 network 呼叫**斷言不變）；任何文件不得改稱 A4 已交付（對齊矩陣 §4.4 裁決不變）。

## §1 需求（承開發軌跡 A4 節，M4-R4 最小版）

一句白話找構件（例：「三樓所有沒填防火時效的防火門」），免查詢語法。**兩段式架構**：先結構化過濾（可解八成需求），後向量語意（Could、後做）。與右側 Copilot 共用同一查詢引擎（規格 §6 既有決定）。

## §2 功能拆解（F1–F5）

### F1 — elements 可查詢索引（Must）

- 來源：選定 IFC 的構件枚舉（ifcopenshell）：`ifc_guid`、`ifc_class`、`name`、`storey`（spatial 鏈）、Pset 屬性攤平文字。
- 落地：**SQLite + FTS5**（不新增 Postgres 依賴；開發軌跡允許二擇一，取最簡）。索引按「檔案（source_kind＋路徑＋mtime）」為單位建立與失效。
- 增建為 governance-service 新模組 `search/`；`app.py` additive 一行掛載（屆時憑本 spec＋開工令解凍）。

### F2 — 白話→條件解析（Must）

- LLM function calling 把中文白話解析成結構化條件：`{ storey?, ifc_class?, property_conditions[]（pset/名稱/比較子/值、含「未填」判定） }`。
- **透明原則**：回應必回 echo 解析出的條件，UI 顯示給使用者確認 AI 沒理解錯。
- 中文建築術語對照表（「防火時效」→`FireRating` 等）為可維護資產，隨使用累積（開發軌跡風險表要求）。
- LLM 供應商/部署形態=**待人類決策**（§5）。解析失敗或低信心→誠實顯示「無法解析」＋建議改寫，禁瞎猜條件。

### F3 — 結果清單與出海口（Must）

- 結果清單（構件列：GUID/類別/名稱/樓層/命中欄位）；可框選→一鍵轉 Issue（走 issues 共同出海口 D4，`from-search` 冪等）或匯出報表（比照 rule-run Excel 匯出模式）。

### F4 — 3D isolate（Could，M4）

- viewer 開著時符合構件 isolate 高亮、其餘變暗；沿用 IX-3D-05 指令族（`highlightPrimsRequest`，`source:"a4"`）＋ A1 連動橋同款證據鏈（Spec-0 §2.2 掛鉤）。證據未齊=disabled。

### F5 — 向量語意層（Could，後做）

- 屬性文字 embedding 進向量庫撈相似構件。明確排在最小版之外；不在開工令範圍內，屆時另立 spec。

## §3 API 契約（草案，開工時定稿）

```
POST /api/governance/search
  { file_ref: {source_kind, path}, q: "三樓沒填防火時效的防火門" }
  → { parsed_conditions: {...},        # 透明 echo，UI 必顯示
      items: [ {ifc_guid, ifc_class, name, storey, matched} ],
      count }
POST /api/governance/issues/from-search  { file_ref, q_hash, ifc_guids[] }   # 冪等
```

- **命名調和**：正式路徑定為 `/api/governance/search`（經 coordinator proxy，additive）。開發軌跡的 `/api/v1/projects/{pid}/search` 屬未來 SaaS `/v1` 投影、對齊矩陣的 `/api/search/model` 為舊稱——兩者皆不採用，自本 spec 起文件引用以本節為準。
- envelope／誠實契約照凍結規約（`{items,count}`；查無結果=誠實空集合非錯誤）。

## §4 DoD（開工後驗收）

1. 10 句典型中文問句解析正確率 ≥ 8，且**每句回傳可見解析條件**（測試語料入庫）。
2. 結果清單可框選一鍵轉 Issue／報表（冪等驗證）。
3. F4 若做：viewer isolate 高亮符合構件、其餘變暗（真 Kit E2E＋ack）。
4. `#a4` prov 翻轉：p4 → asbuilt/artifact，僅在上述證據齊備後；對齊矩陣 §4.4、README §4 同步更新（docs/plans 治理流程）。

## §5 待人類決策（開工前必拍板）

| # | 問題 | 選項空間 |
|---|---|---|
| 1 | F2 LLM 供應商/部署 | 本地模型（離線、合 SaaS「模型檔不出站」精神）vs 雲端 API（品質高、但屬性文字出站需資料主權裁決）|
| 2 | 索引觸發時機 | 選檔即建索引（首查慢→快）vs 首查時建（lazy）|
| 3 | 與 Copilot（A9）共用引擎的邊界 | 本輪只留介面相容註記或直接抽共用層 |

## §6 明確不做（凍結期）

- 不寫任何 A4 後端程式碼、不建索引、不加依賴。
- `#a4` 頁不加任何看似可用的控制（D-32 禁假控制）。
- 不在任何文件把 A4 寫成 built/hero（§4.4 裁決）。
