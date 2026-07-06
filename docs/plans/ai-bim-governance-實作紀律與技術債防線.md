# AI-BIM Governance 實作紀律與技術債防線（HOW 補充層 · 不改需求/規格）

> 版本：v2.1 · 2026-07-02（新增 D-31~D-33：A1 v2 雙來源／BCF 審查／連動橋防線）· 位置：`docs/plans/`
> **本檔為 HOW 補充層**，說明「AI 寫程式不欠技術債 + 照規格精準執行」的紀律。不改任何功能需求或規格。
> 需求、互動語意、驗收條件，一律以既有規格文件為準（效力順序見下節）。
> **當本檔任何條目與上述規格字句衝突，以規格為準，並回報以更新本檔。**
>
> **用法**：每輪開工前讀「§1 一頁速查」與「§2 八原則」；交付前用「§8 交付前總檢查表」逐條打勾。

---

## §0 效力順序與本檔定位

```
使用者最新明確指令
  > 互動實作規格與標準對齊.md（行為合約 / 正典路由 / 官方對齊）—— 最高效力
  > 開發軌跡與執行計畫.md（v3：順序 / 里程碑 / DoD）
  > 設計規格.md（v2：介面 / token / A1–A10 介面分析）
  > 兩份 .html 原型（視覺 / IA 示意，非程式碼範本）
本檔（HOW 補充層·平行補充，不改需求/規格）
程式碼權威覆寫文件：repo 實作與 tests/ 為行為真相；docs 不得當行為權威
```

- 互動規格自稱 v1 但效力最高；v3.1/v2.1 版本號較大但效力較低。
- 設計系統（styles.css / 元件）對「視覺」有約束力；對「功能是否存在」無約束力——以 repo 現況為準。
- 「對齊矩陣」（若存在）為 docs 層的參照索引，不具獨立效力；當它與 repo 衝突時以 repo 為準，當它與互動規格衝突時以互動規格為準。
- **誠實第一**：本檔標 NOT BUILT 的功能，任何文件不得寫成「已交付 / 已實作 / 顯示真實資料」。

---

## §1 一頁速查（交付前 30 秒掃描）

### 開工前核查（三件事）

1. **先查文件，不靠記憶**：對應功能先在 `docs/plans/` 找到 DoD 條目、IX 互動卡、或 API 草案。找不到 → 停下來問人，不自己發明。
2. **確認里程碑順序**：M0 → M1（A1 純 CPU，不碰 3D）→ M2 → M3 → M4 → M5+，**不要先做 3D**。
3. **官方有就用官方**：diff 用 `ifcdiff`、BCF 用官方 bcf 庫語意、3D 量測/批註/剖切/書籤/場景樹/屬性/串流一律走 Omniverse 官方件；自製只做 BCF 橋接層與轉檔 coverage 報告。

### 交付前必過（精簡版，完整版見 §8）

- ☐ 沒有把示意（canvas 3D / 腳本對話）當真功能交出去
- ☐ 沒有新增寫死路由 / 版本字串 / 識別碼（全走單一來源）
- ☐ hash 路由無斜線（`#a1` 非 `#/a1`）
- ☐ 待建功能一律 `disabled + title`，無假按鈕
- ☐ 沒有樂觀更新（一律等 API 回應以事實重繪）
- ☐ provenance 由後端驅動，前端不寫死（`prov="todo"` 會 TS2322，用 `p1/p3/p4`）
- ☐ A4–A10（clash / 真 MinIO / 轉檔歷史頁）未宣稱為已建
- ☐ 有 browser E2E evidence（`artifacts/e2e/*.png` + trace）支撐 built 宣告

---

## §2 八原則

| # | 原則 | 白話 |
|---|---|---|
| **P1** | 程式碼 > 文件 | `tests/` 與合約是行為真相；docs 不得當行為權威；發現文件與 repo 不符先回報 |
| **P2** | 誠實 > 完整 | 無 Playwright 截圖 / runtime evidence / 通過測試 → 不得宣告 done/passed/ready |
| **P3** | 邊界 > 方便 | 禁跨服務職責邊界（見 §0 效力順序 & 路由 / 埠表）；governance host-native，browser 不直連 `:49102` |
| **P4** | 先量再改 | baseline 後比；沒比 baseline 好就 revert；改前先跑現有 test/lint |
| **P5** | 最小可回復 diff | 不重造 primitive；組合已發佈元件；刪 code 拿到一樣結果視為 win |
| **P6** | enum 後端逐字 echo | `SessionStatus` / `KitInstance.status` 禁自創值；enum 後端逐字傳回 |
| **P7** | provenance 後端驅動，不寫死前端 | provenance 走 `GET /api/provenance`；`prov="todo"` TS2322，用 `p1/p3/p4` |
| **P8** | user-facing 必須前端可操作 + browser E2E evidence | backend-only done 不接受；缺 E2E 截圖即降為待建 |

---

## §3 技術債陷阱（D-01 ~ D-30）

> 格式：**症狀 / 為何錯 / 正解**。本 repo 實證陷阱另含 D-24 ~ D-30。

| 代號 | 陷阱（症狀） | 為何錯 | 正解 |
|---|---|---|---|
| D-01 | 把 canvas 示意當 3D 交付 | geo-viewer canvas 是自繪示意，非 Kit WebRTC 串流 | 3D 畫面一律來自 Kit 串流；指令走 DataChannel；非 canvas 自繪 |
| D-02 | hash 路由加斜線（`#/a1`） | 實測 EdgeConsole 讀取 `location.hash.replace(/^#\/?/,"")` 去掉斜線，`#/a1` 不等於 `#a1` | 路由一律無斜線，照正典表（見 §5） |
| D-03 | 用記憶體 `go(id)` 切頁當真路由 | 無法深連結 / 無法回退 | 每頁對應真 hash route，可直連可回退 |
| D-04 | BCF 版本字串寫死且錯（3.0） | 現行匯出 2.1；3.0 需 buildingSMART 確認才升級 | 版本字串集中一處常數；UI 顯示 `BCF 2.1` |
| D-05 | 專案編號裸寫（270/889/990/271） | 皆暫時測試檔，舊值 270/899/988 已淘汰 | 識別碼進設定/fixture；業務邏輯無裸數字；UI 標「測試資料」 |
| D-06 | provenance 寫死前端 | 與後端狀態脫鉤，標記會「說謊」 | 徽章走 `GET /api/provenance`；後端每功能一條；前端不 hardcode |
| D-07 | 假按鈕（可點但沒事件 / 無 disabled） | 違反誠實文化，使用者分不清壞掉還是待建 | 待建按鈕一律 `disabled + title`；無「點了沒反應」的按鈕 |
| D-08 | 樂觀更新（先改畫面再等 API） | 出現「畫面 ≠ 事實」時間窗，動搖信任 | busy → 等 API → 以事實重繪；失敗畫面不變只顯示錯誤 |
| D-09 | 輪詢忘了清理 / 失敗清空舊資料 | 記憶體洩漏；使用者分不清掛了還是真沒資料 | 離頁 `clearInterval`；失敗顯示「上次更新時間·連線異常」不清空 |
| D-10 | 危險動作缺三段式確認 | 操作不可追溯、使用者不知後果 | 插隊/重試/釋放/terminate/drain/move/批次建 issue/匯出 一律 intent → confirm → audited |
| D-11 | 版本 diff 自寫、不用 ifcdiff | 跨 schema 不保證正確，後期重做 | A2 用 `from ifcdiff import IfcDiff`；前端直接吃其 JSON；無自寫比對 |
| D-12 | A1/A2/A3/A5 各做各的 Issue schema | Issue 中心無法統一、BCF 欄位不一致 | 共用 v3 §2.0.3 同一 schema；`source` 填 A1/A2/A3/A5/manual；無 `A1Issue/A2Issue` 獨立型別 |
| D-13 | 3D 功能在 web 端重做 | 與 Kit 升版行為不保證一致 | 量測/批註/剖切/書籤/場景樹/屬性/串流走官方件；自製僅 BCF 橋接層 |
| D-14 | AI 碰 source model | source 被改無法還原 | usd-code-mcp 目標一律 session layer；還原 = 切可見性；source 雜湊不變 |
| D-15 | 跳過 coverage、宣稱 100% 無損 | 不知哪些構件沒轉成功 | 每筆 ConvJob 出 coverage 報告；未建顯示待建徽章；不宣稱無損 |
| D-16 | browser 直連 governance `:49102` | 繞過 proxy/認證；開發能跑、部署就壞 | 前端走 `/api/governance/*` proxy；前端不出現 `:49102` |
| D-17 | 宣稱 session 無縫遷移 | 官方不支援，1 GPU = 1 Kit = 1 stream；換 GPU = terminate + recreate（約 30–40 秒） | confirm 文案含重啟搬移 + 約 30–40 秒 + 重載 stage；UI/API 不出現 live migration |
| D-18 | 用 IfcConvert 輸出 USD | 官方不支援，會靜默失敗 | IFC→USD 走自製轉檔器；備援 `IfcConvert --use-element-guids`→glb；無 IfcConvert 帶 `.usd` 輸出 |
| D-19 | prim 命名不用 GlobalId | 對照表失效，A1 高亮/A2 onion-skin/A4 搜尋全斷 | prim 一律 `G_<sanitized_guid>`；轉檔後寫 elementGuid↔usdPath 對照表 |
| D-20 | 3D 高亮啟用條件漏判 | 指令發出無反應 | 啟用需四條件齊備：DataChannel ready ∧ first_frame_at ∧ stage matched ∧ 構件有 usd_prim_path |
| D-21 | 空狀態補假列 / 把 404·501 當錯誤 | 假列混淆真資料；待建被誤判成壞掉 | 空資料顯示「目前沒有 X + 下一步」；404/501 顯示待建徽章非錯誤 |
| D-22 | 拖放直接改前端狀態 | 等同樂觀更新且無稽核軌跡 | drop 後彈 IntentDialog → 確認才 POST intent；drop 規則函式先寫並有單測 |
| D-23 | 跳過 M0→M1→M2 直接做 3D | 最快能交付客戶的 A1（純 CPU）反而最晚完成 | 每輪確認當前里程碑，不跳接；3D 高亮在 M3 前一律 disabled 標待建 |
| **D-24** | **樂觀更新假 stage matched**（`_completeStageLoad \|\| pendingStageUrl` 偽 matched） | 前端在收到真實 first_frame_at 前就標 stage matched，DataChannel 指令發出後無 3D 回應 | `stage matched` 必須等 viewer 端真實回報 `first_frame_at`；coordinator 不得推定；PR #238 實例 |
| **D-25** | **conv-coverage = 1 自我參照**（`usd_stage_enumeration` 結構性恆等） | `coverage_ratio=1` 在 usd_stage_enumeration 路徑下因 `source_count == mapped_count`（同源枚舉），造成「100% 覆蓋率」假象，非 IFC lossless | UI 加 `conv-coverage-selfref-note` 標注；M2-b 真覆蓋率須引入獨立 IFC entity 分母；禁止以 coverage=1 宣稱無損 |
| **D-26** | **MinIO runtime env 改 `coordinator/.env` 無效** | dockerized coordinator 的 `MINIO_WATCH_*` 只能走 compose 透傳；`.env` 沒掛進容器、image 不烤 | 改 compose 透傳的部署區頂層 `.env`，不改 `coordinator/.env`；PR #237 實例 |
| **D-27** | **clash `has_occ=False` 靜默回 0** | ifcopenshell 0.8.5 缺 OpenCASCADE（`has_occ=False`）→ `clash_*_many` 靜默回 0 碰撞，使用者以為無碰撞 | A3 clash 須加 `has_occ` hard guard；`has_occ=False` 時顯示「碰撞引擎不可用（缺 OCC）」非 0 碰撞；clash 標 `spec·blocked-on-OCC`（NOT BUILT） |
| **D-28** | **`prov="todo"` 會 TS2322** | `data.ts` Prov 型別僅 7 值（`asbuilt\|artifact\|demo\|p1\|p15\|p3\|p4`），無 `todo` 值 | 文件層「待建」對映 repo 的 `p1/p3/p4`；程式碼禁用 `prov="todo"` |
| **D-29** | **`#minio` 誤稱已顯示真 MinIO 三層結構** | `MinioDataPage` 實際接 `GET /api/governance/files/tree`（local_fs 兩層樹），非真 MinIO S3 三層 key | `#minio` 頁已建，但只顯示本地 local_fs 兩層樹；真 S3/MinIO 三層結構瀏覽 NOT BUILT；頁面自標「真 S3/MinIO 待接」 |
| **D-30** | **`vi.mock` 給有 ref 的元件須用 `forwardRef`** | createRoot 測試裡 `vi.mock` 把被 ref 掛載的子元件換純 function stub → `box.current` 永遠 undefined + 印 ref 警告 | 改 `forwardRef((_props, _ref) => ...)`；配 `vi.hoisted` 共享 box；flush 跑 5 tick microtask |
| **D-31** | **A1 雙來源選檔一邊壞拖垮整區**（2026-07-02 新增） | MinIO `GET /api/minio/objects` 502 時若整個選檔區降破或 fallback 到 local_fs 不告知，使用者誤以為看的是 MinIO | 雙來源各自模式 6：失敗邊顯錯誤條 + 保留另一邊；**禁默默換來源**；來源切換後下游狀態清空（回 idle） |
| **D-32** | **BCF 審查面板假指派控制**（2026-07-02 新增） | issues schema 現無 assignee 欄（O7）；前端若 render 可選人員下拉（寫入無處去）＝假按鈕 | 指派一律 dashed 待建標 + title 說明；狀態流轉只走 `POST /api/issues/:id/transition` 證據型更新，禁前端自存 |
| **D-33** | **A1 連動橋自行推定證據**（2026-07-02 新增） | A1 若自己快取／推定 session 證據（或沿用 D-24 式偽 matched），與 `#sessions` 顯示不一致 | 四格證據單一來源＝`#sessions`／Runtime（IX-SS-05）；A1 只讀鏡射同輪詢值；證據未齊高亮鍵 disabled，成功只認 viewer ack |
| **D-34** | **（SaaS 增補·PLANNED 語境：防線於對應 SaaS-M 階段生效，現為前瞻登錄）租戶參數塞進凍結 governance 路徑**（PLANNED·SaaS-M6） | 實作 `/v1` gateway 或租戶中介層時把 tenant 塞進 proxy 路徑字串／query，破壞 §1 proxy 路徑 byte-identical 凍結契約 | golden-path 逐位元組對比測試（直打 `:8004` vs 經 `/v1`）+ code review 檢查點「proxy 路徑字串 grep 不含 tenant」；驗證：對比測試綠 |
| **D-35** | **（SaaS 增補·PLANNED 語境：防線於對應 SaaS-M 階段生效，現為前瞻登錄）metadata 上報夾帶 payload 破 H6**（PLANNED·SaaS-M1） | connector 投影邏輯讀到 IFC/USD 內容片段或超白名單欄位，使 metadata-only 承諾失守 | 上報 schema 白名單（計數/狀態/hash/摘要/時戳/版本號）+ 網路擷取抽驗；驗證：抽驗擷取檔 grep 無 payload 特徵 |
| **D-36** | **（SaaS 增補·PLANNED 語境：防線於對應 SaaS-M 階段生效，現為前瞻登錄）spectator 跨租戶洩漏**（PLANNED·SaaS-M3） | spectator 加入未驗租戶即掛 stream，同一 GPU stream 被跨租戶共看 | 加入前同租戶顯式驗證 + 稽核 log（SOC 2 稽核路徑）；驗證：跨租戶加入被拒且留 log 的 E2E |
| **D-37** | **（SaaS 增補·PLANNED 語境：防線於對應 SaaS-M 階段生效，現為前瞻登錄）tenant_id 回填漏表**（PLANNED·SaaS-M4） | expand-contract 遷移時漏掉關聯表（ConversionLedger／mapping 索引），造成租戶隔離破洞 | 每次只動一張表 + 雙寫驗證清單 + 級聯清單盤點；驗證：兩租戶隔離測試 + 抹除級聯完整性檢查 |

---

## §4 DoD 硬化（built 的硬性條件）

`built` 宣告須同時滿足全部五條，缺一即降級為 `demo / spec / 待建`：

1. **route 可達**：hash route 已登記於正典表（§5），且 EdgeConsole switch case 確實渲染該頁。
2. **後端真接線（非 mock）**：Network 面板能看到真實 API response；無 `mock=true` / `allow_fake_mapping=true` / `fake_mapping_count>0`。
3. **provenance 標記成立**：`prov="asbuilt"` 或 `prov="artifact"`；非 `demo/p1/p15/p3/p4`。
4. **browser E2E evidence**：`artifacts/e2e/*.png` + Playwright trace 存在，且拍攝時間戳可追溯。
5. **0 blocker**：四軸 verifier（§6）無任何 severity=blocker 開放項。

### 里程碑驗收門（摘要）

| 里程碑 | 核心 DoD（以 v3 §3.3 原文為準） | 必附證據 |
|---|---|---|
| M0 地基 | 七頁可點到、誠實標記設定化 | 七個 route 各一張截圖（URL hash + 有效畫面） |
| M1 A1 閉環 | 上傳→檢核→Issue→BCF 全來真 | 真實 .ifc 跑 API log；BCF 2.1 第三方可開 |
| M2 轉檔 | 新 model.ifc → model.usdc 出現 + coverage | ConvJob status=done；coverage 報告；prim `G_<guid>` 抽樣 |
| M3 串流 | 瀏覽器見 Kit first frame；兩人同看 | `first_frame_at` viewer 端回報；1 PRI+1 SPC 截圖 |
| M4 3D 連動 | A1 高亮失敗構件 | 四條件齊備截圖；DataChannel trace；elementGuid↔usdPath 樣本 |
| M5+ | A2 ifcdiff onion-skin；A3 federation | A3 clash 在 `has_occ=False` 前標待建 |

---

## §5 正典路由表（22 條主表 + 別名保留）

> 唯一來源 = 互動規格 PART A A.1.1；對應 repo `EdgeConsole.tsx` switch case key 與 `PAGES[].key`。
> **重要區分**：`PAGES[].key` = EdgeConsole hash case key（本表「hash key」欄）。
> `A1A10[].route`（如 A1→`issues`、A4→`app/ai-search`）= App 卡的內部跳轉目標，語意不同，勿混為一談。

| # | hash key | no | 標題 | plane / group | 後端服務 | 狀態 |
|---|---|---|---|---|---|---|
| 1 | `home` | ⌂ | 今天要做什麼 | governance / workspace | coordinator | built |
| 2 | `a1` | A1 | 治理與模型檢核 [P0] | governance / core | governance-service :49102 | built |
| 3 | `a2` | A2 | 版本差異與責任 | governance / core | governance-service :49102 | built |
| 4 | `a3` | A3 | 跨專業疊合 | governance / core | governance-service :49102（federation built；clash NOT BUILT） | split |
| 5 | `a4` | A4 | 語意搜尋問答 | governance / core | 後端不存在 | **NOT BUILT · 願景 Phase 4** |
| 6 | `a5` | A5 | IoT / FM 數位分身 | governance / core | 後端不存在 | **NOT BUILT · 願景 Phase 3** |
| 7 | `issues` | BC | Issue / BCF [A1] | governance / core | governance-service :49102 | built |
| 8 | `reports` | RP | 報表中心 | governance / core | 部分（A1 Excel 匯出 built；中心化待建） | partial |
| 9 | `viewer` | 3D | 3D Viewer 呈現 | omniverse / omniverse | bim-streaming-server（WebRTC） | demo（串流示意，M4 目標） |
| 10 | `gpu` | 01 | GPU 審查室 [MVP] | omniverse / omniverse | coordinator + streaming | built（殼）/ demo（內容） |
| 11 | `a6` | A6 | 4D / 5D 施工模擬 | omniverse / omniverse | 後端不存在 | **NOT BUILT · 願景 Phase 4** |
| 12 | `a7` | A7 | Reality Capture 比對 | omniverse / omniverse | 後端不存在 | **NOT BUILT · 願景 Phase 4** |
| 13 | `a8` | A8 | Synthetic Data | omniverse / omniverse | 後端不存在 | **NOT BUILT · 願景 Phase 4** |
| 14 | `a9` | A9 | 設計 / 審查 Copilot | omniverse / omniverse | 後端不存在 | **NOT BUILT · 願景 Phase 4** |
| 15 | `a10` | A10 | 機器人 / 巡檢模擬 | omniverse / omniverse | 後端不存在 | **NOT BUILT · 願景 Phase 4** |
| 16 | `conv` | CV | IFC→USD 轉檔排程 [P1] | governance / coordinator | coordinator（ifc-ready intake）+ streaming :49101 | built（intake 佇列 + coverage）；轉檔歷史頁 NOT BUILT |
| 17 | `sessions` | SS | Session 管理 | governance / coordinator | coordinator :8004 | built |
| 18 | `instances` | KG | Kit / GPU 機隊 | omniverse / coordinator | kit-manager-api :8010 | partial |
| 19 | `minio` | M | MinIO 資料 | governance / coordinator | governance-service `/api/files/tree`（local_fs） | 頁已建·但僅 local_fs 兩層樹；真 MinIO 三層 **NOT BUILT** |
| 20 | `runtime` | RT | Runtime 監控 | omniverse / system | coordinator + kit-manager-api | built |
| 21 | `admin` | SY | 系統管理 | governance / system | stub | **NOT BUILT · 待建** |
| 22 | `spec` | ▦ | 設計規格說明 | governance / system | 靜態 | built |

**保留別名（不砍、不列入 22 條主表，禁斷舊連結）**：
- `review`（EdgeConsole case = ReviewRoomPage；與 `gpu`/GpuReviewRoomPage 是**兩個不同元件**，非 `gpu` 純別名，實作須保留 ReviewRoomPage 與 GpuReviewRoomPage 各自 case）
- `overview` / `coordinator` / `intake` / `semantic` / `apps`（data.ts:71-76 PAGES deep-link aliases）
- `kit` / `demo-control`（operator tools，保留）
- `version-diff` / `federation`（A1A10 route targets，保留）
- `/ui/open?session=:id`（凍結 handoff path，byte-for-byte；禁 `/ui/*` 萬用 redirect 吃掉）

---

## §6 六服務埠表

> 以互動規格 §8 / 開發軌跡 §2.0.2 為準。governance-service 為 **host-native**，browser 不直連。

| 服務 | 埠（loopback bind） | 能做 | 絕對不能做 |
|---|---|---|---|
| coordinator | `127.0.0.1:8004` | session/instance、`/ui`、`/api/governance/*` proxy、ifc-ready intake、`/ui/open?session=` redirect | 不渲染 / 不開 USD stage / 不存大型模型 |
| governance-service | `127.0.0.1:49102` | A1 rule-run / A2 diff / A3 federation / Issue / BCF / `/api/files/tree`（CPU） | **永遠 host-native；browser 不直連，一律經 coordinator proxy** |
| bim-streaming-server | 信令 `49100` / 串流 `47998` / 轉檔 API `49101` / spectator `49110`（起，KIT_SPECTATOR_COUNT 決定範圍） | IFC→USDC 轉檔 / Kit runtime / viewport / WebRTC + DataChannel | 不處理登入 / 不當 project 資料權威 / 不當長期 Issue DB |
| web-viewer-sample（viewer） | `127.0.0.1:5173` | 顯示串流 / DataChannel 互動 | 不啟 Kit / 不分配 GPU；前端 disabled 不是授權邊界 |
| kit-manager-api | `127.0.0.1:8010` | `#instances`/`#runtime` 真遙測、Kit 啟停 | — |
| MCP sidecars | `9901/9902/9903` | omni-ui-mcp / kit-mcp / usd-code-mcp 官方驗證 | — |

> **真實 MinIO endpoint**（`192.168.20.234:9000` / bucket `bim-control`）為 bim-review-coordinator 的**外連依賴**（outbound S3Client），非 loopback bind；不在埠表中，由部署區 .env 注入，不在程式碼硬編碼。

**GPU 鐵律**：1 GPU = 1 Kit instance = 1 stream（同時 session ≤ GPU 數）；換 GPU = terminate + recreate（約 30–40 秒），**無 live migration**；spectator 共看同一 stream 不另吃 GPU。GPU 受限的是**容器 plane**（缺 Vulkan ICD）；host 有 RTX 4060 Ti + host-native Kit。

**host-native vs container plane 分離鐵律**：governance-service / Kit / 轉檔 = host-native；容器只跑 web plane（coordinator + viewer），且缺 Vulkan ICD，GPU 受限的是容器。frontend 改動重建 viewer image；`build:ui` 只更新 `:8004/ui`（另一個 dist-ui console），非 `/ui/open` 入口。

---

## §7 A1–A10 狀態表

> 以 repo `data.ts` Prov 值 + 官方對齊為準；「A4 NOT BUILT」為本表裁決唯一源，其餘文件只引用此表。

| App | 狀態 | repo Prov | 真相 |
|---|---|---|---|
| A1 治理檢核 | **built** | `asbuilt` | rule_engine + ifctester(IDS) + BCF 2.1 stdlib + issues；3D 高亮 todo（需 viewer DataChannel） |
| A2 版本差異 | **built** | `asbuilt` | diff_engine（GlobalId 多級 + geometry_changed opt-in）；ifc_type/ifc_name 落庫 bug 已修（PR #242） |
| A3 跨專業疊合 | **拆分** | `asbuilt`（federation） | federation built（USD sublayer + per-member transform）；**clash NOT BUILT**（卡 OCC `has_occ=False`，靜默 0 碰撞；spike 未 push；須加 hard guard） |
| A4 語意搜尋 | **NOT BUILT** | `p4` | **願景 Phase 4**；無 pgvector / element_search_index / `/api/search/model`；EdgeConsole case `a4` → AppVisionPage（願景詳頁）；禁寫成 hero built |
| A5 IoT/FM | **NOT BUILT** | `p3` | 願景 Phase 3；sensor wiring todo，須等 MQTT+TimescaleDB |
| A6 4D/5D | **NOT BUILT** | `p4` | 願景 Phase 4；RM_APPS phase=2（data.ts:102）但 GPU-bound 實際待建；狀態以 `prov=p4` 為準 |
| A7 Reality Capture | **NOT BUILT** | `p4` | 願景 Phase 4；GPU-bound；需 usd-code-mcp 驗 mesh-compare |
| A8 Synthetic Data | **NOT BUILT** | `p4` | 願景 Phase 4；需對齊 Omniverse Replicator（先驗再寫） |
| A9 審查 Copilot | **NOT BUILT** | `p4` | 願景 Phase 4；復用 ChatToolCall；只在 session layer；實作在 session layer 非 3D 場景 |
| A10 機器人巡檢 | **NOT BUILT** | `p4` | 願景 Phase 4；Isaac-sim adjacent；先驗再宣稱 |

> **A4 的具體數字（如「向量索引 search microservice」）一律為願景敘事，禁當實測事實。** Hero built = A1 + A2 + A3-federation。

---

## §7.5 MinIO / 轉檔誠實框架（四條釘子）

1. **偵測已實作**：`bim-review-coordinator/src/services/minioWatcher.ts`；`deriveIntakeFromKey` 解析 ≥3 段 key（`segments.length < 3` 擋）：`projectRaw=segments[0]`、**種類=倒數第二段**、**版本=末段**，中間動態層忽略；中文資料夾 → `mv_<hash8>`（`sanitizeArtifactIdPart`）；env opt-in 預設關；真實 MinIO（`192.168.20.234:9000` / `bim-control`）由部署區 `.env` 注入，不在程式碼硬編碼；live 多層觸發證據 not observed。

2. **轉檔紀錄**：`bim-streaming-server` 已落地（非整體待建）；轉檔 job 有持久化（`stream_conv_*.json` + `GET /api/conversions` list / `/{id}` / `/{id}/result`）。coordinator 已有 `/api/dev/conversions` proxy（`app.ts:1795`）轉發 streaming list，但**前端 console 未渲染成歷史頁**。精確說法：「job 在 streaming-server 有 JSON 持久化與 list API，coordinator proxy 已存在，但前端無轉檔歷史紀錄頁」。不可寫「完全無持久化」；亦不可寫「轉檔歷史頁已建」。真實 GPU 轉檔須 env 配 `adapter_from_env`，預設 `HeadlessConverterNotConfigured`；live GPU 轉檔證據 not observed。

3. **結構顯示頁（`#minio`）**：頁面已建且有真接線，但接的是 `GET /api/governance/files/tree` 的**本地 local_fs 兩層樹**（`{projectId}/{modelId}/*.ifc`，`source_kind="local_fs"`），**非真 MinIO 三層 key 結構**。頁面自標「真 S3/MinIO 待接」、bucket layout panel 標 `prov="demo"`。watcher 三層解析（釘子#1）與 `#minio` 頁（local_fs 樹）是兩條**獨立資料路徑**，watcher 結果未餵進此頁。

4. **觸發**：自動觸發**僅靠 watcher** 偵測到新/變更的 `*/model.ifc`（同 key 同 etag 跳過 → `triggerIntake`）。**無已接線的手動佇列/插隊 UI 觸發新轉檔**——`#conv` 的 prioritize/retry 只對既有 ifc-ready job 排序/重試；`PUT /api/conversion/watch` 只開關 watcher 生命週期。

短期真相源 = local_fs storage（270/889/990+271，皆暫時測試檔，UI 須標示）。conv-coverage=1 在 usd_stage_enumeration 下為結構性自我參照（`conv-coverage-selfref-note`），非 IFC lossless；不承諾 100% 無損。

---

## §8 ultracode 三角色 + ship gate

**三角色**：
- **Implementer**：依 spec/契約 TDD + commit 錨點，不加非規格功能。
- **Adversary**：預設綠燈說謊——切 stream / 卡 ICE / 餵 demo 當 real / 繞 gate / 假前端狀態機 / 藏 mock-only success。
- **Reconciler**：對照 IfcOpenShell / NVIDIA Omniverse / buildingSMART 裁決。

**Ship gate**：三方一致 + provenance 成立才宣告 done；任一方 refute 成立 → 退回 implementer。有 blocker 不得 ship。

---

## §9 四軸 verifier（refute-by-default）

平行 Opus，severity：**blocker**（會做錯事或違規）/ **major**（會卡住或誤導）/ **minor**（nit）。**有 blocker 不得 ship。**

| 軸 | 驗核問題 |
|---|---|
| 規範一致性 | 路由 / 埠 / schema 欄位 / enum 值域是否符合互動規格與 v3 原文 |
| 技術正確性 | ifcdiff / BCF 2.1 / IfcOpenShell / NVIDIA 官方約束是否違反 |
| 應用測試（可依循性） | 開發者照文件能實作且測試通過；IX 卡行為可被 E2E trace 覆蓋 |
| 防錯覆蓋與失敗復原 | 缺 OCC / 缺遙測 / 假 stage matched / conv-coverage 自我參照 是否有 guard 與誠實標記 |

啟用條件：非平凡功能 → spec-to-done（plan → implement → evidence）→ 對抗驗證 workflow → user-facing change 附 gstack/Playwright evidence → 0 blocker + Reconciler 對齊 + provenance 成立 → ship-item merge。

---

## §10 誠實鐵律（Design System 誠實簽名機制）

**五類 ProvTag**（Design System styles.css token，dashed 規格以 styles.css 為唯一真相，文件不另定 px）：

| 類別 | 語意 | repo Prov 值 | 視覺（示意） |
|---|---|---|---|
| `built` | AS-BUILT 已實作 | `asbuilt` | 實線綠 |
| `artifact` | ARTIFACT 實測輸出 | `artifact` | 實線青 |
| `demo` | DEMO DATA 示範 | `demo` | dashed amber |
| `ai` | AI / PHASE 1.5 | `p15` | 紫 |
| `todo` | NOT BUILT 待建 | `p1` / `p3` / `p4` | dashed 灰 |

**誠實鐵律逐條**（程式碼層已落實，文件須遵守）：
- 無假數字（禁 127 rules / 治理分數 / 99.x% GUID 等願景數字當實測事實）
- 無 mock-only success（Network 面板必須見真 API response）
- 無靜默失敗（`has_occ=False` / HeadlessConverterNotConfigured 必須有 guard + 顯示錯誤）
- 缺遙測標「未取得」+ idle LED；未建標 `NOT BUILT · Phase X` + 虛線 panel + disabled 控制
- 離線標「離線快取 · cached」不當 live truth
- `fake_mapping` 覆蓋真 mapping 擋住（`mock=true / allow_fake_mapping=true / fake_mapping_count>0 / mapping_method=fake_for_smoke_test` 一律當 fake，嚴禁覆蓋真 `element_mapping.json`）
- placeholder USDC 拒發
- enum（`SessionStatus` / `KitInstance.status`）後端逐字 echo，禁自創值
- 3D viewport 首幀前 = 暗 stage + 斜線佔位，harness/無 GPU 顯可決定性佔位標 `Runtime=no`，不偽造 matched 影像
- A2 頁**不得**出現成本影響塊；成本 = A6（4D/5D 成本曲線）/ A9 範疇，非 A2 範疇，A2 不呈現（砍「若呈現須標 demo」開後門措辭）

**Design System token 速查**（暗色 Edge Console 為預設識別）：

```html
<link rel="stylesheet" href="<DS_ROOT>/styles.css">
<div class="theme-docs"> ... </div>  <!-- 切淺色 docs 面 -->
```

- Plane 色碼：CORE = cyan（CPU/API）｜ OMNIVERSE = green（GPU）｜ AI = violet
- 強調（品牌綠 `#84c714`）：`--accent --accent-deep --accent-soft --accent-ring --on-accent`
- 語意色：`--info(cyan #46c7e6) --warn(amber #f2b43b) --err(red #f0635f) --ai(violet #9a8cff)` 各帶 `-soft`；不可互換
- 狀態：`--ok --warn --err --ai --idle`；StatusLED glow 只加在有狀態意義者，idle 無 glow，`.pulse`=live
- 字：`--font-sans`（Plus Jakarta Sans + Noto Sans TC）/ `--font-mono`（JetBrains Mono）；mono label `letter-spacing .12em uppercase` 標機器權威事實（port / enum / status）；**數值以 styles.css 為唯一真相**
- 間距：`--pad-card(16) --pad-page(30) --content-max(1080)`；圓角 `--radius(14) --radius-sm(10) --radius-xs(6)`
- 動畫：`--ease cubic-bezier(.4,0,.2,1)`；route 轉場 opacity+translateY(6→0) ~0.28s；禁 bounce/parallax；守 `prefers-reduced-motion` + `[data-anim="off"]`；WCAG 2.2 AA
- 13 元件：Button / ProvTag / StatusLED / Pill / Badge / Card / Panel(phase=hatched 紅 header) / MetricCard(tabular-nums) / Stepper / NavItem(plane 決定 active bar 色) / ChatToolCall / HealthChip(缺值="未取得"+idle) / LangToggle
- **No emoji** 在 product chrome；狀態用 LED + prov tag；頁標題格式「中文主標 + English/code 副標」；缺值寫「未取得」絕不偽綠

---

## §11 官方對齊鐵律（三領域，禁憑記憶）

- **IfcOpenShell**：版本比對用 `ifcdiff`（JSON，GlobalId 鍵）；BCF 用官方 bcf 庫語意，**現行 BCF 2.1 匯出保留、3.0 為升級目標（須先向 buildingSMART 確認）**；IFC→USD 自製須 (a) GlobalId 命名 prim `G_<sanitized_guid>`、(b) 出 mapping coverage 報告；IfcConvert 無 USD 輸出，備援 `IfcConvert --use-element-guids → glb`。
- **Omniverse**：量測/批註/剖切/書籤/場景樹/屬性/串流一律用官方件，web 端不重做，自製僅限 BCF 橋接層；1 GPU = 1 Kit = 1 stream；terminate + recreate 無 live migration。
- **Replicator / Cosmos / Isaac（A8/A10）**：版本風險高，先用 kit-mcp/usd-code-mcp/omni-ui-mcp + nvidia.com/omniverse 驗證再寫，無法確認標 `Phase X · 待驗證`。
- **強制驗證順序**：`kit-mcp` → `usd-code-mcp` → `omni-ui-mcp` → nvidia.com/omniverse → IfcOpenShell → buildingSMART BCF。

---

## §12 AI 動作邊界與防擅改

**危險動作三段式（intent → confirm → audited）**：適用插隊/重試/強制釋放/terminate/drain/move/批次建 Issue/匯出。
- **Intent**：開 confirm 對話框，文案含白話成本與後果（依 IX 卡，不得自行縮減；move 不得省略「約 30–40 秒/重載 stage/短暫斷線」）。
- **Confirm**：使用者明確按「確認執行」才 POST intent API，body 帶 `reason`（可空）。
- **Audited**：後端寫 audit（who/when/what/reason）；前端依模式1 以事實重繪，不樂觀更新。

**AI 不得自行更動的清單**（要改先停下問人）：route contract、Issue/BCF schema 欄位與值域、`elementGuid`/`usdPath` 格式、既有 API path 與 method、六個通用互動模式核心規則、誠實標記四值域、provenance 由後端驅動的原則。

**遇到文件矛盾/缺漏**（一律停、不臆測）：在程式碼插入：
```
// TODO [SPEC-GAP]: 文件 [檔名 §節號] 與 [檔名 §節號] 矛盾/缺漏，待確認後再實作。
//   描述：[具體哪裡衝突或缺什麼]
//   本輪 self-check 已記錄；未自行填入推斷解法。
```

---

## §13 交付前總檢查表（逐條 boolean）

> 每完成一個可驗收目標，逐條打勾。未完成須修復，或明確記為「刻意待建（附理由）」。

**A · 識別碼與字串（無寫死）**
- ☐ A1 無新增 `#/` 開頭路由（hash 無斜線）
- ☐ A2 業務邏輯無裸寫專案編號（270/889/990/271 只在設定/fixture）
- ☐ A3 BCF 版本字串集中一處常數，UI 顯示 `BCF 2.1`
- ☐ A4 前端無 `:49102` / `localhost:49102`
- ☐ A5 prim 命名一律 `G_<sanitized_guid>`
- ☐ A6 `prov` 無 `"todo"` 字串（TS2322；用 `p1/p3/p4`）

**B · 誠實標記與假按鈕**
- ☐ B1 待建按鈕一律 `disabled + title` 非空
- ☐ B2 無「可點但點了沒反應」的按鈕
- ☐ B3 前端無 hardcode 已實作/示範資料/待建對應具體功能（走 API）
- ☐ B4 測試資料頁面有「測試資料」標記
- ☐ B5 A4–A10 / clash / 真 MinIO / 轉檔歷史頁未宣稱已建
- ☐ B6 conv-coverage=1 有 `conv-coverage-selfref-note` 標注，未宣稱無損
- ☐ B7 A2 頁無成本影響塊（成本屬 A6/A9，非 A2 範疇）

**C · 更新模式（無樂觀更新）**
- ☐ C1 動作按鈕 API 回應前保持 busy，不提前改業務資料
- ☐ C2 API 失敗：業務資料不變，只顯示錯誤條含 status code
- ☐ C3 有輪詢的頁面離開時有 clearInterval/cleanup
- ☐ C4 輪詢失敗顯示「上次更新時間·連線異常」、不清空舊資料
- ☐ C5 佇列/Session/機隊 5000ms；執行中進度 1500ms
- ☐ C6 `stage matched` 等 viewer 端真實回報 `first_frame_at`，coordinator 不推定（D-24）

**D · 危險動作（三段式）**
- ☐ D1 插隊/重試/釋放/terminate/drain/move/批次建 issue/匯出 全部有 IntentDialog
- ☐ D2 confirm 文案含白話成本與後果
- ☐ D3 POST intent body 有 `reason` 欄位
- ☐ D4 move confirm 明確含「約 30–40 秒/重載 stage/短暫斷線」

**E · 官方工具邊界**
- ☐ E1 A2 diff 走 `ifcdiff`，無自寫比對
- ☐ E2 無 `IfcConvert` 帶 `.usd/.usdc` 輸出
- ☐ E3 BCF 走官方庫語意/自建 2.1，無完全自寫 BCF-XML
- ☐ E4 無 web 端自製量測/批註/剖切/書籤/場景樹/屬性元件
- ☐ E5 A3 clash 未 `has_occ=False` 前有 hard guard，不顯示 0 碰撞

**F · Schema 一致性**
- ☐ F1 A1/A2/A3/A5 建 Issue 用同一 schema（`source` 標來源）
- ☐ F2 無 `A1Issue/A2Issue` 等獨立型別/資料表
- ☐ F3 Issue `severity`=`Critical|Major|Minor`；`status`=`open|in_progress|resolved|closed`；未新增/改名

**G · 3D 邊界**
- ☐ G1 3D 畫面來自 Kit WebRTC，非 canvas 自繪
- ☐ G2 高亮走 DataChannel `highlightPrimsRequest`，非本地重畫
- ☐ G3 高亮按鈕四條件齊備才 enabled（DataChannel ready ∧ first_frame_at ∧ stage matched ∧ usd_prim_path）
- ☐ G4 session move confirm 含 30–40 秒斷線、無「無縫遷移」字眼
- ☐ G5 AI 操作只在 session layer，source model 雜湊不變

**H · 轉檔管線**
- ☐ H1 每筆 ConvJob 有 coverage 報告
- ☐ H2 coverage 未建顯示待建徽章，不省略
- ☐ H3 未宣稱「轉檔 100% 無損」
- ☐ H4 MinIO MINIO_WATCH_* 走 compose 透傳，未改 coordinator/.env

**I · 路由、順序與需求對齊**
- ☐ I1 route 符合 §5 唯一清單，無遺漏/多出未登記 route
- ☐ I2 實作順序 M0→M1→M2→M3→M4，M3 前不交付 3D
- ☐ I3 本輪每個功能都對得上某條 DoD/IX 卡/API 草案
- ☐ I4 本輪所有 `// TODO [SPEC-GAP]` 已列入下方，未自行臆測補上
- ☐ I5 `#review` case 保留（ReviewRoomPage）；`#gpu` case 保留（GpuReviewRoomPage）；兩者獨立

**J · 工具套件（本 repo 實證）**
- ☐ J1 `vi.mock` 給被 ref 掛載的元件用 `forwardRef` stub（D-30）
- ☐ J2 `fake_mapping` 未覆蓋真 `element_mapping.json`
- ☐ J3 E2E evidence 存 `artifacts/e2e/*.png`（非 C:\ 根目錄；Windows EPERM 陷阱）

**本輪 SPEC-GAP 清單**：
- （若無，寫「本輪無 SPEC-GAP」）

---

## §14 與既有文件的關係

- 本檔為**補充紀律層**，不改任何需求/規格。既有效力順序不變（見 §0）。
- **衝突規則**：本檔任何條目與規格字句衝突，以規格為準，並回報更新本檔。
- **維護**：每次審批/實測發現新技術債來源，回來補一條 D-xx 與一條 §13 檢查表項目。

*本檔所有條文均為「如何不欠技術債、如何照規格精準落地與驗收」的 HOW 層，未新增或修改任何功能需求。DoD / API / 欄位 / 識別碼 / 互動模式均引用自互動實作規格（PART A/B/C）、開發軌跡（v3 §2.0.x/M0–M8）、設計規格（v2.1）。*
