# AI-BIM Governance Design System ↔ docs/plans ↔ repo 對齊矩陣

> **v1.1 · 2026-07-02 A1 v2 對齊**：A1 選檔雙來源／BCF 審查面板／A1 連動橋（見 §4.4 A1 列、§4.5、路由表 #17/#19）。

> **定位**：本檔是「設計系統需求 / docs 規格 / repo 現況」三方對照的單一索引。
> **效力**：docs 層的 reference 索引，不具獨立效力；與 repo 衝突時以 repo 為準；與互動規格衝突時以互動規格為準。
> **誠實第一**：標 NOT BUILT 的功能，本文件不得寫成「已交付 / 已實作 / 顯示真實資料」。
> **可執行層銜接**：本矩陣回答「對齊狀態與落差是什麼」；要把對齊**落成可執行的 per-route 任務**（DS 視覺 / 保留後端 API / 改哪幾個 .tsx / Playwright 驗收 / Prov），見 `ai-bim-governance-前端對齊DS-保留後端-實作手冊.md`（HOW 層；其 §1 後端凍結面契約為前端對齊的 DO-NOT-TOUCH 邊界）。

---

## §0 效力順序（衝突裁決）

```
使用者最新明確指令
  > 互動實作規格與標準對齊.md（行為合約 / 正典路由 / 官方對齊）—— 最高效力
  > 開發軌跡與執行計畫.md（v3：順序 / 里程碑 / DoD）
  > 設計規格.md（v2：介面 / token / A1–A10 介面分析）
  > 兩份 .html 原型（視覺 / IA 示意，非程式碼範本）
平行補充層（不改需求/規格）：實作紀律與技術債防線.md
程式碼權威覆寫文件：repo 實作與 tests/ 為行為真相；docs 不得當行為權威
```

**本對齊矩陣的位階**：彙整 repo 覆寫結論的索引，不自封「最終覆寫源」。
當矩陣與 repo 衝突 → 以 repo 為準。
當矩陣與互動規格衝突 → 以互動規格為準。
當矩陣與 sharedSheet 衝突 → 以 sharedSheet 為準。

---

## §1 對齊方法

### 三欄定義

| 欄 | 來源 | 說明 |
|---|---|---|
| **DS**（Design System） | `styles.css` / 元件庫 / 設計規格.md MAP1–3 | 視覺 token、元件、provenance 視覺規約 |
| **docs/plans** | 互動規格 / 開發軌跡 / 設計規格 / 技術債防線 | 行為合約、路由、里程碑、DoD |
| **repo 現況** | `data.ts` / `EdgeConsole.tsx` / `pages.tsx` / `governance-service/app.py` / `minioWatcher.ts` / `app.ts` / `conversion_authority.py` | 程式碼行為真相（最終覆寫源） |

### binding vs reference 判準

| 分類 | 適用主題 |
|---|---|
| **binding（必須照做）** | 視覺 token / 元件 / provenance 標記 / 誠實鐵律 / 路由凍結 / plane 色碼 / 動效 / a11y |
| **reference（參考，不強制）** | 願景敘事 / 未建 App 的 UI 細節 / scenario 數字 |

---

## §2 路由正典（22 條，hash 無斜線）

> 唯一來源：互動規格 PART A「A.1.1 正典路由表」；對應 `EdgeConsole.tsx` case key 與 `PAGES[].key`。
> **重要**：`PAGES[].key` 是 EdgeConsole switch key，對應 hash（如 `key:"a1"` → `#a1`）。`RM_APPS[].route`（如 `A1.route="issues"`）是 App 卡的內部跳轉目標，語意不同，勿混為一談。

| # | hash（EdgeConsole key） | no | 標題 | plane / group | 後端服務 | repo 狀態 | binding |
|---|---|---|---|---|---|---|---|
| 1 | `#home` | ⌂ | 今天要做什麼 | governance / workspace | coordinator | built | ✓ |
| 2 | `#a1` | A1 | 治理與模型檢核 [P0] | governance / core | governance-service :49102 | built | ✓ |
| 3 | `#a2` | A2 | 版本差異與責任 | governance / core | governance-service :49102 | built | ✓ |
| 4 | `#a3` | A3 | 跨專業疊合 | governance / core | federation built；clash NOT BUILT（OCC blocker） | split | ✓ |
| 5 | `#a4` | A4 | 語意搜尋問答 | governance / core | 後端不存在 | NOT BUILT · p4 | ✓ |
| 6 | `#a5` | A5 | IoT / FM 數位分身 | governance / core | 後端不存在 | NOT BUILT · p3 | ✓ |
| 7 | `#issues` | BC | Issue / BCF [A1] | governance / core | governance-service :49102 | built | ✓ |
| 8 | `#reports` | RP | 報表中心 | governance / core | A1 Excel 匯出 built；中心化報表待建 | partial | ✓ |
| 9 | `#viewer` | 3D | 3D Viewer 呈現 | omniverse | bim-streaming-server（WebRTC） | demo（串流示意） | ✓ |
| 10 | `#gpu` | 01 | GPU 審查室 [MVP] | omniverse | coordinator + streaming | built（殼）/ demo（內容） | ✓ |
| 11 | `#a6` | A6 | 4D / 5D 施工模擬 | omniverse | 後端不存在 | NOT BUILT · p4 | ✓ |
| 12 | `#a7` | A7 | Reality Capture 比對 | omniverse | 後端不存在 | NOT BUILT · p4 | ✓ |
| 13 | `#a8` | A8 | Synthetic Data | omniverse | 後端不存在 | NOT BUILT · p4 | ✓ |
| 14 | `#a9` | A9 | 設計 / 審查 Copilot | omniverse | 後端不存在（A9 實作在 session layer） | NOT BUILT · p4 | ✓ |
| 15 | `#a10` | A10 | 機器人 / 巡檢模擬 | omniverse | 後端不存在 | NOT BUILT · p4 | ✓ |
| 16 | `#conv` | CV | IFC→USD 轉檔排程 [P1] | governance / coordinator | coordinator intake + streaming :49101 | built（intake 佇列 + coverage）；轉檔歷史頁待建 | ✓ |
| 17 | `#sessions` | SS | Session 管理 | governance / coordinator | coordinator :8004 | built；**v2：新增 A1 連動橋供應端面板（IX-SS-05，前端待實作）** | ✓ |
| 18 | `#instances` | KG | Kit / GPU 機隊 | omniverse / coordinator | kit-manager-api :8010 | partial（真遙測接 :8010；部分待建） | ✓ |
| 19 | `#minio` | M | MinIO 資料 | governance / coordinator | coordinator `/api/minio/objects`（真 MinIO raw-folder）+ governance-service `/api/files/tree`（local_fs） | **真 MinIO raw-folder 逐層瀏覽已建（唯讀）；三層「專案/種類/版本」僅 watcher 解析語意；兩條 API 供 A1 v2 雙來源** | ✓ |
| 20 | `#runtime` | RT | Runtime 監控 | omniverse / system | coordinator + kit-manager-api | built | ✓ |
| 21 | `#admin` | SY | 系統管理 | governance / system | stub | NOT BUILT · 待建 | ✓ |
| 22 | `#spec` | ▦ | 設計規格說明 | governance / system | 靜態文件頁 | built | ✓ |

### 保留別名（不列入 22 條主表，不得砍斷）

`data.ts PAGES` 額外 key（deep-link aliases，以免舊測試 / 連結斷掉）：

| key | no | 說明 |
|---|---|---|
| `overview` | OV | Overview 別名 |
| `coordinator` | CO | Coordinator Console |
| `intake` | IN | Model Intake |
| `review` | G | **Review Room（ReviewRoomPage，獨立頁，非 `#gpu` 別名）** |
| `semantic` | SE | Semantic Viewer |
| `apps` | AP | Applications · A1–A10 |
| `version-diff` | A2 | A2 deep-link 別名（`data.ts` `RM_APPS` A2.route，與 `#a2` 同 VersionDiffPage、同後端；2026-07-02 census 補登） |
| `federation` | A3 | A3 deep-link 別名（`data.ts` `RM_APPS` A3.route，與 `#a3` 同 FederationPage；2026-07-02 census 補登） |
| `kit` | — | operator 工具（保留，互動規格 A.1.1 operator 行；kit-manager-web；2026-07-02 census 補登） |
| `demo-control` | — | operator 工具（保留；掛 `RealIfcConsolePage`，實打 coordinator `/api/dev/*` + `/api/external/ifc-ready`；2026-07-02 census 補登） |

> 補登依據（2026-06-24 census，4/4 對抗驗證 holds）：§2 原僅列 6 項，系統性漏掉兩種別名來源——`RM_APPS` 的 A1–A10 `route` 欄衍生 deep-link、與互動規格 A.1.1 的 operator 保留行。以上 4 列為登錄既有現實，非新增路由；升格第 23 條主表需走升格決策樹（專屬後端 or 專屬 IX 卡＋無法被現有頁吸收＋使用者核可）。

> **M2 更正（`#review` 雙義釐清）**：`#gpu` 為 GPU 審查室正典、`#review` 在互動規格語意上是「GPU 審查室別名」，但 repo `data.ts:74`（`key:"review"`, no:"G", label:"Review Room"）是**獨立 ReviewRoomPage**，與 `#gpu`（key:"gpu"）是兩個不同頁。
> HTML 重生時不得把 `key:"review"` 的 ReviewRoomPage 連結砍掉或重定向到 `#gpu`。
> 路由表 `#review` 別名標記以互動規格語意為準（指向 GPU 審查室 UX），repo key="review" 保留為現有實作。

`/ui/open?session=:id` 為凍結 handoff path（byte-for-byte，禁 `/ui/*` 萬用 redirect 吃掉）。

---

## §3 六服務埠表

| 服務 | 埠 | 能做 | 絕對不能做 |
|---|---|---|---|
| coordinator | `127.0.0.1:8004` | session/instance、`/ui`、`/api/governance/*` proxy、ifc-ready intake、`/ui/open?session=` redirect | 不渲染 / 不開 USD stage / 不存大型模型 / 不奪 Kit 控制權威 |
| governance-service | `127.0.0.1:49102` | A1 rule-run / A2 diff / A3 federation / Issue / BCF / `/api/files/tree`（CPU） | **永遠 host-native、browser 不直連，一律經 coordinator proxy** |
| bim-streaming-server | 信令 Kit `49100` / 串流 `47998` / 轉檔 API `49101` / spectator `49110`（起，KIT_SPECTATOR_COUNT 決定範圍） | IFC→USDC 轉檔權威 / Kit runtime / viewport / WebRTC + DataChannel | 不處理登入 / 不當 project 資料權威 / 不當長期 Issue DB |
| web-viewer-sample（viewer） | `127.0.0.1:5173` | 顯示串流 / DataChannel 互動 / 前端 spectator gate（UX） | 不啟 Kit / 不分配 GPU / 前端 `disabled` 不是授權邊界 |
| kit-manager-api | `127.0.0.1:8010` | `#instances` / `#runtime` 真遙測、Kit 啟停 / GPU pool 控制權威 | — |
| MCP sidecars | `9901/9902/9903` | kit-mcp / usd-code-mcp / omni-ui-mcp 官方驗證 | — |

### host-native vs container plane 分離（鐵律）

governance-service / Kit / 轉檔 = **host-native**；容器只跑 web plane，且缺 Vulkan ICD，GPU 受限的是**容器 plane**，非 host RTX 4060 Ti。

每頁 prototype 的「依賴列表」須標 host-native / container 歸屬，不得把 host-native 服務標為容器內可直連。

---

## §4 三方對照矩陣

每列格式：主題 / DS 要求 / docs 條款 / repo 現況 / binding 分類 / 落差與處置

### 4.1 路由

| 主題 | DS 要求 | docs 條款 | repo 現況 | 分類 | 落差 |
|---|---|---|---|---|---|
| 22 條正典 hash | hash 無斜線 | 互動規格 PART A A.1.1 | `PAGES[].key` 22 + aliases（data.ts:48–77） | **binding** | 一致 |
| `/ui/open` handoff | 凍結路徑 | 互動規格 §handoff | coordinator app.ts redirect | **binding** | 一致 |
| `#review` vs `#gpu` | `#review`=`#gpu` 別名（互動規格語意） | 互動規格 | repo key="review"=ReviewRoomPage（獨立） | **binding** | 釐清（見 §2 M2 說明）；repo 實作保留 |

### 4.2 Plane 色碼

| 主題 | DS 要求 | docs 條款 | repo 現況 | 分類 | 落差 |
|---|---|---|---|---|---|
| CORE（governance） | cyan | 設計規格 | NavItem plane="governance" → cyan active bar | **binding** | 一致 |
| OMNIVERSE | green | 設計規格 | NavItem plane="omniverse" → green active bar | **binding** | 一致 |
| AI | violet | 設計規格 | AI prov tag + ChatToolCall | **binding** | 一致 |

### 4.3 ProvTag / Prov 系統

| 主題 | DS 要求（五類） | repo Prov（七值） | 映射 | 分類 | 落差 |
|---|---|---|---|---|---|
| built | 實線綠 | `asbuilt` | 直接對映 | **binding** | 一致 |
| artifact | 實線青 | `artifact` | 直接對映 | **binding** | 一致 |
| demo | 1px dashed amber | `demo` | 直接對映 | **binding** | 一致 |
| ai | 紫 | `p15` | P1.5 後端待建 | **binding** | 對映成立 |
| todo（DS 設計類別） | 1px dashed 灰 | `p1` / `p3` / `p4` | 三值分別對映不同 Phase | **binding·落差** | **`prov="todo"` 在 repo 會 TS2322；待建功能須用 `p1`/`p3`/`p4`，不得用字串 `"todo"`** |

> dashed 規格以 `styles.css` token（`--prov-demo/-bg --prov-todo/-bg`）為準，文件不另定 px。

### 4.4 A1–A10 狀態對照

**裁決源：本矩陣為 A1–A10 功能狀態的唯一裁決索引。其他文件只引用本節，不各自展開論證。**

| App | DS / MAP 宣稱 | docs 規格 | repo 現況（程式碼覆寫） | 裁決 | 分類 |
|---|---|---|---|---|---|
| A1 治理檢核 | built | built（**v2 2026-07-02**：選檔雙來源→檢核→結果→審查→交付） | `prov:"asbuilt"`；rule_engine + ifctester(IDS) + BCF 2.1 純 stdlib + issues；BCF 2.1 匯出已在 PR #241；選檔兩條 API 已在（`files/tree`、`minio/objects`）但 **A1 頁接線待實作**；BCF 審查面板：issues list/transition 已在、**assignee 欄無（O7）**；3D 高亮 P1.5（需 viewer DataChannel） | **built（核心閉環）；v2 新增面：前端待實作，不得先標已交付** | binding |
| A2 版本差異 | built | built | `prov:"asbuilt"`；diff_engine（GlobalId 多級 + geometry_changed opt-in + issue-impact）；ifc_type/ifc_name 落庫 bug 已修（PR #242）；**A2 頁不得出現成本影響塊（成本非 A2 範疇；5D 成本/S-curve 屬 A6，審查 Copilot 屬 A9）** | **built** | binding |
| A3 跨專業疊合 | built | 拆分 | `prov:"asbuilt"`（federation）；clash NOT BUILT：卡 ifcopenshell 缺 OpenCASCADE（`has_occ=False`），出不了真實 clash 數，spike 未 push 主分支 | **federation built / clash NOT BUILT · blocked-on-OCC** | binding |
| A4 語意搜尋 | （MAP/DS 部分版本標 artifact 或 hero built） | **NOT BUILT · p4** | `prov:"p4"`；無 pgvector / element_search_index / `/api/search/model` 任何程式碼（AppVisionPage=願景頁） | **NOT BUILT · p4**（repo 覆寫 DS/MAP 宣稱） | **binding·落差：DS/MAP「A4 built」必須被本裁決覆寫** |
| A5 IoT/FM | spec / Phase 3 | NOT BUILT · p3 | `prov:"p3"` | **NOT BUILT · p3** | reference（一致） |
| A6 4D/5D | spec | NOT BUILT · p4 | `prov:"p4"`；data.ts RM_APPS phase=2（卡，實際 GPU-bound 待建） | **NOT BUILT · p4**（以 repo prov="p4" 為準，RM phase=2 指規劃優先序非已建） | binding |
| A7 Reality Capture | spec / Phase 4 | NOT BUILT · p4 | `prov:"p4"` | **NOT BUILT · p4** | reference（一致） |
| A8 Synthetic Data | spec / Phase 4 | NOT BUILT · p4 | `prov:"p4"` | **NOT BUILT · p4** | reference（一致） |
| A9 審查 Copilot | spec / Phase 4 | NOT BUILT · p4（實作在 session layer） | `prov:"p4"` | **NOT BUILT · p4；A9 場景示意僅示意，實作在 session layer 非 3D 場景** | reference（一致） |
| A10 機器人巡檢 | spec / Phase 4 | NOT BUILT · p4 | `prov:"p4"` | **NOT BUILT · p4** | reference（一致） |

### 4.5 MinIO / 轉檔誠實框架

| 主題 | repo 現況 | 裁決 | 分類 |
|---|---|---|---|
| MinIO watcher 偵測 | `minioWatcher.ts` 實作 `deriveIntakeFromKey`（≥3 段 key，種類=倒數第二，版本=末段，中文→`mv_<hash8>`）；S3Client 外連 LAN MinIO `192.168.20.234:9000` bucket `bim-control`（外連依賴非 bind） | **已實作；live 多層觸發 not observed** | binding |
| `#minio` 頁 | **2026-07-02 更新**：頁面接 coordinator `GET /api/minio/objects?prefix=&delimiter=/`（真 MinIO raw-folder 逐層，唯讀；`app.ts:1597`）；local_fs 樹 API（`files/tree`）保留 | **真 MinIO raw-folder 逐層瀏覽已建（唯讀）；三層「專案/種類/版本」僅 watcher 解析語意，非 bucket 結構宣稱；兩條 API 供 A1 v2 雙來源** | **binding** |
| 轉檔歷史頁 | coordinator 有 `/api/dev/conversions` proxy（`app.ts:1795`）轉發 streaming `/api/conversions` list；`conversion_authority.py:126` `GET /api/conversions` 存在；但**前端 console 未渲染成歷史頁** | 後端 list + proxy 皆在；缺的是 UI 呈現層。精確說法：「job 在 streaming-server 有 JSON 持久化與 list API，但前端無轉檔歷史紀錄頁」 | **binding·落差：不得寫「完全沒接線」** |
| 手動觸發 UI | `#conv` prioritize/retry 只對既有 ifc-ready job 排序/重試；`PUT /api/conversion/watch` 只開關 watcher 生命週期 | **無已接線的手動佇列/插隊 UI 觸發新轉檔** | binding |
| conv-coverage 自我參照 | `usd_stage_enumeration` 下 source_count 結構性恆等 mapped_count | coverage_ratio=1 是結構性自我參照；標 `conv-coverage-selfref-note`，不宣稱 lossless | binding |
| watcher vs `#minio`／A1 選檔資料路徑 | watcher 解析三層 key（自動 intake，opt-in 預設關）；UI 列表走 `minio/objects`／`files/tree` | 獨立路徑：watcher 不餵 UI 列表；UI 選檔不觸發轉檔（A1 v2 只跑 rule-run） | binding |

### 4.6 Persistence 雙層

| 主題 | DS 要求 | repo 現況 | 分類 |
|---|---|---|---|
| `usePersistentState` | `AIBIM.usePersistentState(key, fallback)`（localStorage prefix `aibim:`） | `pages.tsx` 使用；cache 非 source of truth，load 時對後端 reconcile，server win | **binding** |

### 4.7 動效 / a11y

| 主題 | DS 要求 | 分類 |
|---|---|---|
| route 轉場 | opacity + translateY(6→0) ~0.28s | **binding** |
| hover | brightness(1.06) 不 darken | **binding** |
| 禁用 | bounce / parallax | **binding** |
| 減動效 | `prefers-reduced-motion` + `[data-anim="off"]` | **binding** |
| a11y | WCAG 2.2 AA | **binding** |

### 4.8 Design System 元件

| 元件 | 用途 | 分類 |
|---|---|---|
| Button / ProvTag / StatusLED / Pill / Badge | 通用 UI | **binding** |
| Card / Panel（phase=hatched 紅 header） | 資訊容器 | **binding** |
| MetricCard（tabular-nums） | 數值呈現（A1 記分板 / A2 三色碼） | **binding** |
| Stepper | A1 5-step flow | **binding** |
| NavItem（plane 決定 active bar 色） | 導覽 | **binding** |
| ChatToolCall | A9 session layer / `#gpu` operator | **binding** |
| HealthChip（缺值="未取得"+idle） | 遙測健康狀態 | **binding** |
| LangToggle | zh/en 切換 | **binding** |

---

## §5 落差清單與處置

| # | 落差 | 風險 | 處置 |
|---|---|---|---|
| L1 | A4 DS/MAP 部分版本標「built / artifact」，repo `prov:"p4"`，無後端程式碼 | 過度宣稱，被 adversary 反駁 | **以 repo 覆寫**；本矩陣 §4.4 A4 裁決=NOT BUILT；其餘文件只引用本節，不各自展開 |
| L2 | `#minio` 頁舊版標「介面已交付 / 顯示真實三層結構」 | 過度宣稱 | **更正**：`#minio` 頁已建，但只顯示 local_fs 兩層 IFC 樹；真 MinIO 三層結構瀏覽 NOT BUILT |
| L3 | 轉檔歷史頁描述「完全無持久化 / 完全無接線」 | 不足宣稱（proxy + list API 已在） | **收緊**：後端 list + proxy 皆在；缺的是前端 UI 呈現層 |
| L4 | A3 clash 顯示真實數 | 過度宣稱（`has_occ=False` 出不了真實數） | **強制標記**：clash NOT BUILT · blocked-on-OCC；任何 clash 數字須標示範 |
| L5 | `prov="todo"` 出現在文件或 UI 程式碼 | TS2322 編譯錯誤 | **映射**：todo → `p1` / `p3` / `p4`（依 Phase） |
| L6 | A2 頁出現成本影響塊 | 誤導（成本非 A2 範疇：5D 成本/S-curve 屬 A6、審查 Copilot 屬 A9；A2 第一輪誤報） | **禁止**：A2 頁不得出現成本影響塊 |
| L7 | A6 RM_APPS `phase:2` vs 願景 Phase 4 混淆 | 讀者誤判實作進度 | **澄清**：A6 RM phase=2 是規劃優先序，repo `prov:"p4"`=GPU-bound 待建；以 prov 為準 |
| L8 | `#review` 雙義（互動規格別名 vs repo ReviewRoomPage） | HTML 重生時砍掉既有 ReviewRoomPage 連結 | **保留**：repo key="review" 保留；互動規格語意別名標記不得覆蓋 repo 實作 |
| L9 | scenario 具體數字（「312 扇門」「17,000 frames」等）被當實測 | 過度宣稱 | **統一**：A4–A10 scenario 數字一律標「願景敘事 · 示意」，禁當實測 |
| L10 | spectator 埠只標 49110 | 讀者誤以為只有 1 個 spectator | **補充**：49110 起，KIT_SPECTATOR_COUNT 決定範圍（預設 5，支援 49110~49150） |
| L11 | host-native vs container 分離無專節 | 讀者誤以為容器可直連 governance-service | **已在 §3 補鐵律**；每頁依賴列表須標 host-native / container 歸屬 |

---

## §6 binding 速查

以下主題一律 **binding（必須照做）**：

- **DS token**：`styles.css` 為唯一入口（數值以 `styles.css` 為準，文件不另定 px）
- **元件**：13 元件（Button / ProvTag / StatusLED / Pill / Badge / Card / Panel / MetricCard / Stepper / NavItem / ChatToolCall / HealthChip / LangToggle）
- **Provenance 標記**：五類 DS 類別對映 repo 七值（`asbuilt / artifact / demo / p15 / p1 / p3 / p4`）；demo/todo 帶虛線框
- **路由凍結**：22 條正典 hash 無斜線；`/ui/open?session=:id` byte-for-byte 凍結
- **Plane 色碼**：CORE=cyan / OMNIVERSE=green / AI=violet
- **動效 / a11y**：fade-up / WCAG AA / reduced-motion
- **誠實鐵律**：無假數字 / 無 mock-only success / 無靜默失敗；缺遙測標「未取得」；未建標「NOT BUILT · Phase X」+ 虛線 panel + disabled 控制

---

## §7 reference 速查

以下主題為 **reference（參考，不強制）**：

- 願景 App（A4–A10）UI 細節與 scenario 數字（一律標「願景敘事 · 示意」）
- 未建頁（`#admin` / 真 MinIO 三層瀏覽 / 轉檔歷史頁）的 UI 示意稿
- A3 clash 介面（待解 OCC blocker 後才能定案）
- geo-viewer prototype 的「由幾何計算」欄位（正式版才由 BBox/Volume/Pset 計算；示意頁標「範例值 · 示意」）

---

## §8 官方對齊鐵律（三領域）

> 禁憑記憶；使用前先跑對應 MCP tool 或查官方文件。

| 領域 | 鐵律 |
|---|---|
| **IfcOpenShell** | 版本比對用 `ifcdiff`（JSON / GlobalId 鍵），不自寫 diff；BCF 用官方 bcf 庫語意，現行 BCF 2.1 保留，3.0 為升級目標（須先向 buildingSMART 確認）；IFC→USD 自製須 GlobalId 命名 prim `G_<sanitized_guid>` + mapping coverage 報告；IfcConvert 無 USD 輸出，備援 `IfcConvert --use-element-guids → glb` |
| **Omniverse** | 量測/批註/剖切/書籤/場景樹/屬性/串流一律用官方件（`omni.kit.tool.measure` / `.tool.markup` / `.window.section` / `.waypoint.core` / `.widget.stage` / `.window.property` / `.livestream.webrtc`）；web 端不重做，自製僅限 BCF 橋接層；1 GPU=1 Kit=1 stream；terminate+recreate 無 live migration |
| **Replicator / Cosmos / Isaac（A8/A10）** | 版本風險高，先用 kit-mcp/usd-code-mcp/omni-ui-mcp + nvidia.com/omniverse 驗證再寫；無法確認標 `Phase X · 待驗證` |

**強制驗證順序**：`kit-mcp` → `usd-code-mcp` → `omni-ui-mcp` → nvidia.com/omniverse → IfcOpenShell → buildingSMART BCF

---

## §9 誠實標記速查

| 情境 | 標記方式 |
|---|---|
| 功能未建 | `NOT BUILT · Phase X` + 虛線 panel + disabled 控制 |
| 遙測缺值 | 「未取得」+ idle LED（無 glow，不偽綠） |
| Demo 數據 | `prov="demo"` + 1px dashed amber 框 + 標「示範資料」 |
| 願景 scenario | 標「願景敘事 · 示意」；禁當實測 |
| 離線快取 | 標「離線快取 · cached」；不當 live truth |
| 3D viewport 首幀前 | 暗 stage + 斜線佔位；harness/無 GPU 標 `Runtime=no`，不偽造 matched 影像 |
| conv-coverage=1 | 標 `conv-coverage-selfref-note`；不宣稱 lossless |
| 測試資料（270/889/990/271） | UI 標示「測試資料」 |

---

## §10 矩陣維護規約

1. **修改 `data.ts` PAGES / Prov / A1A10 後，須同步更新 §2 / §4.4**。
2. **repo 功能狀態變更（built → NOT BUILT 或反之）須先更新本矩陣，再更新其他 docs**。
3. **本矩陣不具獨立效力**：若本矩陣與 repo 衝突 → 以 repo 為準，並在下次 docs 週期更新本矩陣。
4. **A4 狀態裁決**：其他文件只寫「A4=NOT BUILT·p4，裁決見對齊矩陣 §4.4」並反向連結，禁各自展開論證。

---

## 附錄：SaaS 增補層對照（2026-07-06）

> 本附錄為 SaaS 改版新增檔案的對照索引，僅供查找用；**不修改 §0–§8 任何一字**。

| 檔名 | 角色（一句話） | 與本矩陣關係 |
|---|---|---|
| `ai-bim-governance-saas-架構總覽.md` | 雲地混合 SaaS 架構總綱（控制面 / edge plane / 通訊契約 / survivability，全 PLANNED） | 引用 §4.4 裁決，不覆寫 |
| `ai-bim-governance-saas-租戶與身分.md` | 租戶模型 / Bridge 隔離 / 身分與 token 相容路徑 | 引用 §4.4 裁決，不覆寫 |
| `ai-bim-governance-saas-GPU經濟與計量計費.md` | session broker / GPU 硬約束 / 三軸計量 / 方案分層 | 引用 §4.4 裁決，不覆寫 |
| `ai-bim-governance-saas-公開API與標準對齊.md` | `/v1` 物理分離 / webhook / BCF / IDS / bSDD | 引用 §4.4 裁決，不覆寫 |
| `ai-bim-governance-saas-合規資料主權與生命週期.md` | ADR / 資料主權三層 / 生命週期 / DR / GDPR | 引用 §4.4 裁決，不覆寫 |
| `ai-bim-governance-saas-遷移路線與里程碑.md` | SaaS-M1～M8 scope + DoD + 回退 | 引用 §4.4 裁決，不覆寫 |
| `審批報告-docs-plans-SaaS改版-2026-07-06.md` | 本輪 SaaS 改版審批紀錄（現行最高審批） | 引用 §4.4 裁決，不覆寫 |

**聲明（三行）：**

1. §4.4 A1–A10 建成裁決不因 SaaS 改版變動：Hero built = A1 + A2 + A3-federation；A3-clash 維持 blocked-on-OCC；A4–A10 維持 NOT BUILT · p3/p4。
2. 以上 SaaS 檔全部為增補層，效力低於本矩陣；與本矩陣衝突時一律以本矩陣為準。
3. §8 七項待人類拍板事項維持 open，本輪 SaaS 改版不定案任何一項。
