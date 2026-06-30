# A1 重構 — 治理檢核 + 3D 高亮（MinIO 來源 · 排隊轉檔）設計文件

> 版本：2026-06-24 · 範圍：`web-viewer-sample` A1 頁面前端重構 + coordinator 一支共用後端端點
> 相依 spec：`2026-06-24-ifc-ready-api-field-redesign-design`（PR #257，定義 `POST /api/conversion/trigger` 與 `conversion_lifecycle_status` 等欄位）、`2026-06-24-minio-folderview-and-baseline-disclosure-design`（R-TRIGGER-ENDPOINT）
> 對象程式碼：`web-viewer-sample/src/console/pages.tsx`（`A1GovernanceWorkbenchPage`）、`RealIfcConsolePage.tsx`、`bim-review-coordinator/src/app.ts` / `governanceProxy.ts`

---

## 1. 目標與範圍

把 A1 頁面收斂為**只做兩件事：治理檢核 + 3D 高亮**。模型來源改自 **MinIO**（下拉選 `.ifc`），3D 高亮要的 USD 改以**操作員手動按鈕排入 IFC→USD 轉檔排程**取得；移除頁面底部的「真實 IFC Fixture 垂直切片（demo-control）」14 欄大表內嵌。對齊互動規格 IX-A1（五步）與誠實鐵律。

**不在範圍**：MinIO watcher 自動偵測（並存的另一條，零變更）；A1 不做插隊（去 `#conv`）；不刪 `#/demo-control` 路由（operator 工具，規格保留）。

---

## 2. 既有現況（baseline）

`A1GovernanceWorkbenchPage`（`pages.tsx:260`）目前由上到下 5 塊：

1. A1 五步引導式流程（step1 選模型＝**手打路徑文字框** `a1-step-path` at pages.tsx:407）
2. 結果記分板（`state.run` 後出現）
3. 3D 即時檢視（嵌入 live viewer；無 active session 時顯示「需先派發 review session」）
4. 交付（建 Issue / 匯 Excel / 匯 BCF / 在 3D 高亮）
5. `<RealIfcConsolePage/>` 內嵌（pages.tsx:591-593，`data-testid="a1-real-ifc-slice"`）＝demo-control 大表

關鍵事實：
- A1 **不建 session**，只 `runtimeStatus()` 撈現有 active session（pages.tsx:295-308）。
- 3D 高亮鈕四條件（IX-A1-06，pages.tsx:558-585）：`firstFrame` ∧ 有選 session ∧ stage matched ∧ 失敗構件第一筆有 `ifc_guid`+`usd_prim_path`。
- demo-control（`RealIfcConsolePage`）= 目前 A1 上唯一能「手動把 IFC 轉成 USD + 生 session」的觸發器，但用 `./storage` 平面清單（`/api/dev/ifc-sources`），非 MinIO。
- `RealIfcConsolePage` 同時掛在 `#/demo-control`（`EdgeConsole.tsx:86`）— 移除 A1 內嵌不影響該路由。

---

## 3. 新版 A1 設計

### 3.1 頁面流程（一條線）

```
① 選模型    下拉列 MinIO .ifc（專案·種類·版本）   GET /api/minio/objects (role=source_ifc)   ← 現成
② 排入轉檔   按「排入 IFC→USD 轉檔排程」          POST /api/conversion/trigger {key}          ← 後端地基（相依 spec）
            coordinator server-side presign + intake → 下載 + 排隊 → 轉檔
            狀態行：detected→queued→converting→ready（讀 conversion_lifecycle_status）
            + 「到 IFC→USD 轉檔排程查看詳情 → #conv」連結
③ 轉檔完成   auto-session 自動建立（app.ts:1350-1427）→ A1 runtimeStatus 撈到 session
④ 治理檢核   按「執行規則檢核」                    POST /api/governance/rule-runs/for-session/:sessionId  ← 現成
            記分板 / 開 Issue / 匯 Excel / BCF（全不動）
⑤ 3D 高亮    既有四條件 → 內嵌 viewer 高亮失敗構件（不動）
移除：demo-control 14 欄大表
```

**決策（已與使用者確認）**：
- 模型選取＝下拉（非手打路徑）；來源＝MinIO。
- 排隊＝**手動按鈕**（轉檔吃資源、序列佇列，交人控制）。
- 治理檢核＝**等轉檔完成**才跑，走既有 `for-session/:sessionId`（server-side 從 session 反解 IFC 路徑，瀏覽器不需知道伺服器路徑）。故只需**一支新後端端點**（trigger），不需 `for-ifc-ready` 端點。
- 呈現＝方案 A（精簡內嵌，非把 #conv 表格搬進來）。

### 3.2 區塊配置

1. **選模型（step1，改下拉）**：`<select>` 來源 `GET /api/minio/objects` 過濾 `role==="source_ifc"`，每項顯示 `project_display_name · category · version`（值來自 listMinioObjects，現成）。保留選填 IDS 路徑欄。
2. **排入轉檔排程（3D 區，無 session 時）**：取代現「需先派發 review session」靜態字。一顆 `排入 IFC→USD 轉檔排程` 按鈕 → `POST /api/conversion/trigger {key:<選定 object key>}` → 回 `ifc_ready_job_id` → 輪詢 `GET /api/external/ifc-ready/:jobId` 顯示精簡狀態行（讀 `conversion_lifecycle_status`，falls back 既有 `download_status`/`conversion_status` 直到 lifecycle 欄落地）+ `#conv` 連結。
3. **3D 即時檢視（有 session 時）**：既有 EmbeddedViewer + first frame 證據 + stage matched（不動）。
4. **治理檢核 + 記分板 + 交付**：step2 改打 `for-session/:sessionId`；記分板/Issue/Excel/BCF 不動。
5. **3D 高亮**：既有四條件邏輯不動。

---

## 4. 後端依賴與實作排序（B）

**排序 B（已確認）：後端地基先做、A1 純前端後做。**

- **Phase B1（後端地基，相依 spec=PR #257 / folderview）**：
  - `POST /api/conversion/trigger {key}`：server-side `deriveIntakeFromKey`（≥3 段、拒 `.`/`..`/空段）+ presign（憑證/簽章不出瀏覽器）+ 重用 watcher `triggerIntake` 等效邏輯餵既有 intake；冪等鍵 `mw_<hash16>`，同 key 回既有 job。
  - `conversion_lifecycle_status` 欄位（detected/queued/converting/ready/failed，單一 helper，job/ledger 共用）。
  - （獨立但相關）P0：presigned URL 全出口遮蔽（見 PR #257 §8.1）。
- **Phase B2（A1 前端，本 spec）**：B1 merge 後，A1 變純前端改動（下拉 + 排隊鈕 + for-session + 移除 demo-control + 測試）。

A1 的「排入轉檔」按鈕**依賴 B1 的 trigger 端點先落地**。

---

## 5. 資料流（API，全部相依 spec 或現成）

| 步驟 | API | 狀態 |
|---|---|---|
| 選模型清單 | `GET /api/minio/objects`（過濾 role=source_ifc） | 現成 |
| 排入轉檔 | `POST /api/conversion/trigger {key}` | 後端地基 B1 |
| 輪詢狀態 | `GET /api/external/ifc-ready/:jobId`（讀 conversion_lifecycle_status） | 現成端點 + B1 新欄位 |
| 撈 session | `runtimeStatus()` | 現成 |
| 治理檢核 | `POST /api/governance/rule-runs/for-session/:sessionId` | 現成 |
| 記分板/失敗 | `GET /api/governance/rule-runs/:id[/results|/failures]` | 現成 |
| 開 Issue / Excel / BCF | 現有端點 | 現成 |
| 3D 高亮 | postMessage → viewer HighlightBridge | 現成 |

---

## 6. 誠實 / 邊界 / 錯誤處理

- 轉檔/排隊狀態**原樣顯示**（detected/queued/converting/ready/failed；或既有 download/conversion status），不偽造成功；轉檔未完成不顯示假 ready。
- 3D 高亮四條件未滿足**誠實停用**並顯示原因（既有邏輯）。
- presigned 簽章 / secret **絕不入前端與 log**：`POST /api/conversion/trigger` 前端只送 `key`，presign 與 webhook secret 一律 coordinator server-side（folderview AC-trigger）。
- 排隊失敗（trigger 4xx/5xx、download failed）、轉檔逾時、coordinator 連不上 → 照實顯示，按鈕可重試。
- coordinator 邊界不變：A1 只消費讀視圖；不在前端保存權威資料。

---

## 7. 測試

- **元件測試（vitest）**：A1 step1 渲染下拉（非文字框）；A1 不再含 `data-testid="real-ifc-demo-control"`（修 `console.test.tsx:365`）；無 session 時出現「排入轉檔」按鈕；輪詢狀態行隨 job 狀態變化；誠實守門 `not.toContainText` 假 ready。
- **瀏覽器 E2E（gstack）**：選 MinIO 模型 → 排隊 → 看到佇列/轉檔狀態 →（真 stack）轉好 → session → for-session 檢核 → 3D 高亮。AGENTS.md 要求 user-facing feature 必須有 browser E2E 證據。
- **回歸**：`#/demo-control`（`RealIfcConsolePage`）仍可達且渲染正常（`OperatorConsole.test.tsx:78`、`EdgeConsole.tsx:86`）。

---

## 8. 移除清單與相容性

| 項目 | 處置 | 影響 |
|---|---|---|
| `<RealIfcConsolePage/>` 內嵌（pages.tsx:591-593） | 移除 | A1 失去 on-page demo-control；工具仍在 `#/demo-control` |
| `console.test.tsx:365` 斷言 A1 含 `real-ifc-demo-control` | 改：斷言 A1 **不含** + `#/demo-control` 仍含 | 測試更新 |
| A1 step1 文字框 `a1-step-path` | 改為下拉 | E2E/元件對 step1 的選取互動更新 |
| step2 `rule-runs`（直接路徑） | 改 `rule-runs/for-session/:sessionId` | 對齊「檢核等轉檔完成」；舊直接路徑端點保留不破壞 |

全部前端 additive/替換，無破壞性後端契約變更（後端只新增 trigger 端點 + lifecycle 欄位，均 additive）。

---

## 9. YAGNI / 不做

- 不做「專案→類別→版本」三層 storage-tree 巢狀下拉（IX-A1-01 進階版，另立項）；用 `/api/minio/objects` 平面清單（已帶三段欄位）。
- A1 不做插隊；插隊在 `#conv`，A1 只連結過去。
- 不刪 `#/demo-control`。
- 不做 `for-ifc-ready` 端點（檢核等轉檔完成 → 用既有 for-session）。

---

## 10. 開放問題

> **2026-06-30 相依進度更新（指揮官 · spec-to-done P0）**：B1 後端地基（`POST /api/conversion/trigger` + `conversion_lifecycle_status` 單一 helper + presigned 全出口遮蔽 + `project_display_name`/`category` 落 store）已於 **PR #259（mergeCommit `b660b1f`）merge 進 `main`**。本 spec 三項開放問題因此定案：
> - **OQ-A1-1 解除**：B1 已落地，**排序 B 成立**，A1（B2）為純前端改動，不退排序 C。
> - **OQ-A1-2 解除**：`conversion_lifecycle_status` 已落地，A1 狀態行**主讀** `conversion_lifecycle_status`；既有 `download_status`/`conversion_status` 僅作該欄缺失時的 falls-back（誠實降級保留，不移除）。
> - **OQ-A1-3 定案**：依 §9 YAGNI 用 `GET /api/minio/objects` 平面清單，A1 端**先不做**分頁/搜尋；物件多時的 baseline 揭露走 folderview（不在本 change）。
>
> 以下為設計當時原始開放問題，保留為歷史紀錄：

- **OQ-A1-1**：B1 落地時程未定；A1（B2）卡在 trigger 端點。若 B1 延遲，是否退回排序 C（A1 先做下拉+移除 demo-control，按鈕後補）須再確認。
- **OQ-A1-2**：`conversion_lifecycle_status` 未落地前，A1 狀態行先用既有 `download_status`/`conversion_status` 顯示（誠實降級），lifecycle 欄落地後切換 —— 此過渡策略需在 plan 標明。
- **OQ-A1-3**：MinIO 下拉若物件多（baseline 揭露），是否要在 A1 端分頁/搜尋，或只列「未轉/failed」可觸發者，待 plan 依 folderview baseline 揭露語意定。
