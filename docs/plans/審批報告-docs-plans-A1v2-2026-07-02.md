# 審批報告 — docs/plans A1 v2 改版（選檔雙來源 · BCF 審查 · A1 連動橋）

> 日期：2026-07-02 · 依據：使用者最新明確指令（效力順序第一行）
> 範圍：docs/plans 全 10 檔出新版（7 份 .md 修訂 + 2 份 .html 原型更新 + 本報告）
> 本報告取代《審批報告-docs-plans-design-system-對齊重建-2026-06-23》成為現行審批紀錄；舊報告以 git 歷史留存。

---

## §1 指令與裁決

| # | 使用者指令 | 設計裁決 |
|---|---|---|
| 1 | A1 改成根據 MinIO 資料夾偵測到的 IFC 做下拉選單 | A1 第①步「上傳」→「選檔 · 偵測到的 IFC」，**雙來源**：local_fs 檔案庫（`GET /api/governance/files/tree`）＋ MinIO bucket 偵測（`GET /api/minio/objects?prefix=&delimiter=/`，真 MinIO 唯讀逐層，只列 .ifc）。選檔元件三樣式（下拉 optgroup／級聯 pills／樹狀）原型供挑，正式版擇一。檔案一律標「測試資料」；選檔不觸發轉檔 |
| 2 | 依選擇到的檔案做 BCF 審查 | 新增 **BCF 審查面板**（IX-A1-07）：topic 列表（對選定檔）＋狀態流轉 open→in-progress→resolved（`POST /api/governance/issues/:id/transition`，模式 3）＋匯出 BCF 2.1/Excel；**指派 assignee＝待建 P1（O7），render dashed 待建標，不提供假控制** |
| 3 | 3D 連動要給 session 管理／Runtime 監控 | （追問後裁定）**3D 連動留在 A1**，改為「**A1 連動橋**」證據 rail（IX-A1-08）——不內嵌 3D 視窗、不沿用 viewer 斜線佔位風格；四格證據（session 派發／WebRTC 首幀／DataChannel／stage matched）以 **`#sessions`／Runtime 監控為單一來源**（IX-SS-05 供應端），A1 只讀鏡射、證據未齊高亮鍵 disabled |

## §2 各檔變更摘要

| 檔 | 版本 | 變更 |
|---|---|---|
| docs-plans-README.md | v1.3 | 檔頭變更紀錄；§2 互動規格「禁重建」註記改為「本輪使用者指令授權修訂」；§3 鐵律 #7 釘子 #3（`#minio`＝真 MinIO raw-folder 已建）、#4（A1 選檔不是觸發器）；§4 A1 列 v2 流程；§5 驗收錨 |
| 互動實作規格與標準對齊.md | v2 | 檔頭 v2 變更紀錄；IX-A1-01 重寫（雙來源）；IX-A1-05 註記匯出入口移至審查面板；IX-A1-06 呈現方式改 IX-A1-08；**新增 IX-A1-07（BCF 審查面板）、IX-A1-08（A1 連動橋）、IX-SS-05（供應端）**；路由表 A1/SS 列更新；勘誤 E7（`/api/storage/tree`→真 API）、E8（`#minio` raw-folder 已建） |
| 設計規格.md | v2.1 | §3 A1 全節改版（trigger/journey/①選檔區/元件組合/provenance/誠實警示）；§4.2 `#sessions` 加 A1 連動橋供應端；§4.3 `#minio` 更正為 raw-folder 已建；§5.1(c)/§5.3 對應更正 |
| 開發軌跡與執行計畫.md | v3.2 | 決策 **D10**（A1 v2）；A1 F1/F4b/F8 功能拆解與 UI 對應更新；DoD 增 3 條 v2 驗收；M1 增補（雙來源接線＋BCF 面板；3D 高亮仍屬 M4）；未決 **O7**（assignee 欄） |
| 實作紀律與技術債防線.md | v2.1 | 新增防線 **D-31**（雙來源一邊壞不拖垮整區／禁默默換來源）、**D-32**（禁假指派控制）、**D-33**（連動橋禁自行推定證據） |
| design-system-對齊矩陣.md | v1.1 | 路由表 #17/#19 更新；§4.4 A1 列（v2 新增面＝前端待實作，不得先標已交付）；§4.5 `#minio` 頁／資料路徑列更新 |
| 前端對齊DS-保留後端-實作手冊.md | v1.1 | `#a1` 逐路由規格全面改版（SourcePicker/BcfReviewPanel/A1BridgeRail 任務、API、驗收、Prov）；`#sessions` 加 A1BridgeSupplyPanel；`#minio` API 更新。**後端凍結面不變：全部沿用既存 API，零後端改動** |
| ai-bim-governance-prototype.html | v2 | `#a1` 頁全新：來源切換＋三樣式選檔（PROTO 切換供挑）＋選定檔列（測試資料標）＋檢核模擬＋記分板/規則（未跑=模式 6 空狀態）＋BCF 審查面板＋A1 連動橋 rail；`#sessions` 頁深化：occupied 證據三欄、結束 session（模式 3、轉灰 60s）、強制釋放 disabled、A1 連動橋供應端 |
| ai-bim-geo-viewer-prototype.html | v2 註記 | 檔頭對齊註記＋A1 疊加 chip 標「範圍＝A1 選定檔 rule-run」；七區塊 IA 不動 |

## §3 誠實裁決（本輪新增的紅線）

1. **雙來源皆為真接線**（兩條 API 皆在 repo），但 **A1 頁的接線本身待實作**——矩陣 A1 列已標「v2 新增面：前端待實作，不得先標已交付」。
2. **指派 assignee**：issues schema 無此欄（O7 未決）→ UI 一律 dashed 待建標，禁下拉假控制（D-32）。
3. **連動橋**：證據單一來源＝`#sessions`／Runtime；未齊＝disabled＋原因可讀；成功只認 viewer ack（D-33）；不畫假綠燈。
4. **選檔不觸發轉檔**：只跑 rule-run（CPU）；自動轉檔仍僅 watcher（opt-in 預設關）。
5. 270/889/990/271 與 MinIO 資料夾內容皆**測試資料**，UI 必標。

## §4 驗收錨

- 原型：`ai-bim-governance-prototype.html` `#a1`／`#sessions` 兩頁（行為示意，非程式碼範本）。
- 行為合約：IX-A1-01/07/08、IX-SS-05；驗收句已寫入各卡。
- 正式版證據：gstack/Playwright per-page evidence（`artifacts/e2e/*`），backend-only done 不接受。

## §5 待人類決策

| # | 問題 | 現狀 |
|---|---|---|
| 1 | 選檔元件三樣式擇一（下拉／級聯 pills／樹狀） | 原型內建切換供挑；拍板後正式版只實作一種 |
| 2 | O7：issues schema 增 assignee 欄＋topic↔issue 對映 | 未定案前指派一律待建標 |
| 3 | BCF 3.0 升級時點 | 維持 PART C 結論：2.1 現行、3.0 目標 |
