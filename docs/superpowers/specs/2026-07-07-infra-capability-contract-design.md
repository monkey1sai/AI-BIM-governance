# Spec-0：基礎設施能力契約與本輪切片（INFRA）

> 日期：2026-07-07 · 狀態：使用者已核可設計（brainstorming 六節）
> 定位：**活文件（living contract）**。五個基礎設施能力的現況、消費者掛鉤矩陣與演進待辦都記在本檔；未來每輪 A1–A10 開發前，先修訂本檔矩陣再開工，變更紀錄記於下表。
> 效力：本檔屬實作層 spec，不覆寫 `docs/plans/`（效力順序見 `docs/plans/docs-plans-README.md` §1）；與 repo 程式碼衝突時以 repo 為準。
> 實作者：Codex（或任一 agent）。實作前必讀本檔 §6 共通紀律。

## 變更紀錄

| 日期 | 輪次 | 變更 |
|---|---|---|
| 2026-07-07 | A1–A4 輪 | 初版：五能力現況盤點＋本輪切片 S1–S5＋backlog |

---

## §1 五能力現況（2026-07-07 盤點，以程式碼為準）

| 能力 | 承載 | 現況 | 本輪切片 |
|---|---|---|---|
| IFC→USD 轉檔排程 | streaming-server（轉檔權威）＋ coordinator ledger ＋ `#minio` ModelDataPage（`#conv` 已 302 併入） | prioritize/retry/watch API 已建；ConversionLedger（`mw_<hash16>`）已建；**coverage/usdc ready 回填鏈未完** | S3 |
| Session 管理 | coordinator :8004 ＋ `#sessions` SessionManagementPage | 清單輪詢（IX-SS-01）、結束 session（IX-SS-04，PR #226）已建；**occupied 證據鏈（IX-SS-02）、A1 連動橋供應端（IX-SS-05）待建** | S1、S2 |
| Kit / GPU 機隊 | kit-manager-api :8010 ＋ `#instances` KitGpuFleetPage | fleet 模型正確；**節點資料為 DEMO（hardcoded edge-gpu-01..03）**；move/drain/assign intent 未建 | S4 |
| MinIO 資料 | coordinator `GET /api/minio/objects` ＋ ModelDataPage | 真 MinIO raw-folder 逐層瀏覽已建；bucket layout panel 依規格維持 `demo`（語意參照） | （無，維持現狀） |
| Runtime 監控 | coordinator `GET /api/runtime/status` ＋ `#runtime`→CoordinatorPage | 端點真有；**UI 監控面板待建**；`RuntimePage`（pages.tsx）為孤兒程式碼（EdgeConsole 無 route 指向） | S5 |

## §2 消費者掛鉤矩陣（動態演進機制）

> 規則：任一 A 軸要用某能力，先在對應表加一列（需求、狀態、觸發條件），核可後才實作。狀態值：`已建`／`本輪`／`待輪（觸發=…）`。

### 2.1 IFC→USD 轉檔排程

| 消費者 | 需求 | 狀態 |
|---|---|---|
| A1 | 選檔不觸發轉檔（鐵律 #7 釘子 #4）；只讀已下載 session | 已建 |
| A3 | federation 需成員 .usdc 產物＋coverage 可視 | 本輪（S3） |
| A6/A7 | 4D/點雲需批次轉檔排程 | 待輪（觸發=A6/A7 開工令） |

### 2.2 Session 管理

| 消費者 | 需求 | 狀態 |
|---|---|---|
| A1 | 連動橋證據鏈（IX-SS-05 供應端；證據=IX-SS-02 三欄） | 本輪（S1、S2） |
| A2 | onion-skin 3D（M4 後）沿用同一證據鏈 | 待輪（觸發=A2 3D 開工令） |
| A3 | clash 飛點高亮（M4 後）沿用同一證據鏈 | 待輪（觸發=A3 3D 開工令） |
| A4 | 搜尋結果 isolate（`source:"a4"`）沿用同一證據鏈 | 待輪（觸發=A4 開工令，見 Spec-4） |
| 全域 | SS-03 強制釋放 stale endpoint | 待輪（觸發=S1 落地後下一輪） |

### 2.3 Kit / GPU 機隊

| 消費者 | 需求 | 狀態 |
|---|---|---|
| Runtime 監控 | 真遙測（GPU busy/total、instance 狀態） | 本輪（S4） |
| A6 | GPU 排程／機隊搬移 intent（KG-02/03/04） | 待輪（觸發=多 GPU 節點或 A6 開工令） |

### 2.4 MinIO 資料

| 消費者 | 需求 | 狀態 |
|---|---|---|
| A1 | 選檔雙來源之 MinIO 來源（唯讀、只列 .ifc、標測試資料） | 已建 |
| A2 | 版本層命名規約（O3）真 S3 落地 | 待輪（觸發=O3 拍板） |

### 2.5 Runtime 監控

| 消費者 | 需求 | 狀態 |
|---|---|---|
| A1 | 連動橋證據單一來源之一（與 `#sessions` 一致） | 本輪（S5） |
| A5 | IoT 遙測面板 | 待輪（觸發=A5 開工令，需 MQTT+TimescaleDB） |

---

## §3 本輪切片詳規（Codex 實作範圍）

### S1 — SS-02 occupied 證據鏈

**行為合約**（互動規格 IX-SS-02）：`#sessions` 每一 active/occupied 列顯示三欄證據：

1. `first_frame_at`：viewer 回報的 WebRTC 首幀時間戳
2. `last_heartbeat`：viewer 心跳；距今 >15s 顯示 `stale` 標記
3. `stage matched`：stage truth 比對結果（沿用既有 stage_truth 機制）

**硬規則**：

- 「Open URL」≠ occupied：開 URL 只開新分頁，不改任何狀態。
- 無遙測一律顯「未取得」，**禁推定、禁畫 fail**（D-33：console 只顯示不推定）。
- 證據欄位由 coordinator `GET /api/runtime/status` 回傳（欄位 additive，不改既有 envelope 結構）。

**後端接線（Task 0 先驗現況再設計）**：

- viewer（web-viewer-sample）量測 first frame 與心跳，回報給 coordinator。回報端點為 **additive 新端點**（建議 `POST /api/review-sessions/:id/telemetry`），或重用既有 lifecycle 通道——Codex 先盤點 `/lifecycle-events`、stage_truth 現行上報路徑，能重用就重用，不得重加 2026-05-21 已退役的 socket 協作 server-push 事件（DO-NOT-RE-ADD 清單見前端手冊 §1.12）。
- coordinator 聚合進 `/api/runtime/status` 各 session 物件（additive 欄位：`first_frame_at`、`last_heartbeat`、`stage_matched`）。

**驗收**：真 Kit session 開啟後，`#sessions` 三欄證據在 15s 內轉綠；殺掉 viewer 分頁後 heartbeat 轉 stale；未開 viewer 的 session 顯「未取得」。Playwright evidence（截圖＋trace）。

### S2 — SS-05 A1 連動橋供應端

**行為合約**（互動規格 IX-SS-05）：`#sessions` 新增 `A1BridgeSupplyPanel`，顯示繫結鏈：

```
A1 rule_run ⇢ session ⇢ DataChannel ⇢ highlight ack
```

**硬規則**：

- `#sessions` 與 `#a1` 用**同一輪詢週期、同一證據來源**（`/api/runtime/status`），任何一邊不得快取過期值。
- 關閉 session 後，A1 連動橋（`#a1` 側）同步回 idle。
- 無新 endpoint：供應端只是 `/api/runtime/status` 的鏡射呈現（S1 欄位＋rule_run 繫結資訊）。rule_run⇢session 繫結資料若現況沒有，走 additive 欄位，不改既有 key。

**驗收**：`#a1` 連動橋四格與 `#sessions` 供應端同刻一致（同輪詢內）；關 session 後兩頁同步回 idle。E2E 雙頁對照截圖。

### S3 — 轉檔 coverage / usdc ready 回填（Ledger Phase 2）

**目標**：ModelDataPage 轉檔產物列顯示真 coverage% 與 usdc ready 狀態，移除該區 `p1` 待建標。

**設計約束**：

- streaming-server `conversion_authority.py` 為凍結檔**禁改**。回填走 **coordinator 側 reconcile**：輪詢 streaming `GET /api/conversions/:id`／`/:id/result`，把 `usdc 路徑、coverage、ready` 回填進 ConversionLedger record（atomic swap 寫法沿用現行 ledger）。
- **Task 0 先讀** `docs/superpowers/specs/2026-07-03-conv-ledger-status-reconcile-design.md` 與 ledger 現行程式，確認該 spec 已落地到哪，只補缺口，不重做。
- coverage=1 的自我參照語意保留 `conv-coverage-selfref-note` 註記（usd_stage_enumeration 下 coverage_ratio=1 為結構性恆等，不得當 IFC lossless 宣稱）。

**驗收**：跑一筆真轉檔後，`#minio` ModelDataPage 該物件的產物列顯示 coverage% 與 usdc ready；ledger JSON 內 record 有回填欄位。pytest（coordinator ledger 單測）＋ Playwright 截圖。

### S4 — `#instances` 真遙測第一片

**目標**：KitGpuFleetPage 的節點資料從 hardcoded DEMO 翻真值。

**設計約束**：

- 資料源=kit-manager-api :8010 `/instances`（GPU pool 控制權威），**前端不得直連 :8010**，一律經 coordinator `/api/kit/*` proxy（含現行 `x-dev-token` header，不得移除）。
- GPU busy/total、instance 狀態（`KitInstance.status` enum 逐字 echo）翻真值；kit-manager 查無資料時誠實顯「未取得」，**不得保留假 DEMO 節點混充**——DEMO 節點卡整區移除或明標 `DEMO DATA` 分區，不得與真資料混排。
- fleet「模型層」（節點卡版面）維持現行設計；本片只換資料源。

**驗收**：host-native Kit 啟動時 `#instances` 顯示真 instance（狀態與 `/api/runtime/status` 一致）；Kit 全關時顯「未取得／無 instance」，不出現 edge-gpu-01..03 假節點。Playwright 截圖兩態（有/無 Kit）。

### S5 — `#runtime` 監控面板 v1 ＋ RuntimePage 孤兒處置

**目標**：維持 `#runtime`→CoordinatorPage 現路由，把監控彙總補進 CoordinatorPage：

- session 彙總（active/queued 數、各 session 三欄證據摘要，資料同 S1）
- Kit instance 彙總（來源同 S4）
- 無統一遙測的欄位顯「未取得」，**不畫 fail、不捏造秒數**（現行誠實原則不變）

**RuntimePage 孤兒處置（守衛式）**：Task 0 先驗 `RuntimePage` 與 `OperatorConsole.tsx` 的引用鏈（GitNexus impact）；確認產品殼層無任何 route/import 觸達後才刪除兩者；若仍有活引用，回報並保留，不硬刪。

**驗收**：`#runtime` 顯示彙總面板；`npx tsc --noEmit`＋`npm test` 綠；若刪檔，`detect_changes` 確認 blast radius 只含預期符號。

---

## §4 Backlog（本輪不做，觸發條件明列）

| 項目 | 內容 | 觸發條件 |
|---|---|---|
| KG-02/03/04 | 機隊搬移／drain／指派 intent API（`/api/fleet/*`，模式 5+3，規則函式先寫並單測） | 多 GPU 節點上線，或 A6 排程需要 |
| SS-03 | 強制釋放 stale endpoint（條件=heartbeat stale ∧ 無 first frame） | S1 落地後下一輪 |
| CV-03 佇列 UI 深化 | 按鈕式插隊的佇列視覺 | 轉檔量成長到人工排序有感 |
| A4 F1 | elements 可查詢索引（SQLite FTS5） | A4 開工令（見 Spec-5） |
| MinIO 版本層真 S3 | O3 命名規約落地 | O3 拍板 |

## §5 明確不做（本輪）

- 不動 bucket layout panel 的 `demo` 語意參照標記。
- 不做 live migration／GPU 熱搬移（D9：搬移=terminate+recreate）。
- 不加任何繞過 coordinator 的直連（拓樸凍結）。
- 不重加已退役 socket 協作事件（`highlightRequest`/`selectionUpdate`/`annotationCreate` 等）。

## §6 共通紀律（S1–S5 一體適用）

1. **凍結契約**（前端手冊 §1）：前端只打 `127.0.0.1:8004`；既有 proxy 路徑字串 byte-identical 不改名；回應 envelope（`{items,count}` 等）不 flatten；enum 逐字 echo；新增 API 一律 additive。
2. **誠實鐵律**：證據型更新（禁樂觀更新）；無遙測顯「未取得」；ack/實測才算成功。
3. **驗收工具鏈**：pytest 走 `.venv\Scripts\python.exe`；前端 `npx tsc --noEmit`＋`npm test`（vite build 不跑 tsc，須另跑）；console 改動要 `build:ui`＋重啟 coordinator 才會出現在 `:8004/ui`；user-facing 驗收一律 Playwright/gstack evidence（PNG 需 `git add -f`，`artifacts/e2e/` 的 .gitignore 擋 *.png）。
4. **流程**：改 symbol 前 GitNexus `impact`；commit 前 `detect_changes`；branch→PR→CI（pr-review-agent body-evidence 表格照 changed paths 填）→auto-merge；不在 main 上開發。
