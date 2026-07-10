# docs/plans/ — 給 Claude Code 的導讀（必讀）

> v1.3 · 2026-07-02 A1 v2 改版對齊（使用者指令）
> 本輪變更：**A1 第①步由「上傳」改為「選檔 · 偵測到的 IFC」（雙來源：local_fs 檔案庫 / MinIO bucket 偵測）**；A1 新增 **BCF 審查面板**（topic 列表／狀態流轉／指派-待建）；**3D 連動留在 A1**，改為「A1 連動橋」證據 rail（不沿用 viewer 視窗風格），四格證據以 `#sessions`／Runtime 監控為單一來源。詳《審批報告-docs-plans-A1v2-2026-07-02.md》。
> 一句話定位：這個資料夾是「**要做成什麼樣子**」的事實來源（需求、互動語意、驗收條件）。
> 它**不是程式碼範本**：兩份 .html 是單檔 vanilla JS 示意原型，正式產品另有技術棧（見下）。
> **效力順序**：見 §1。**誠實第一：凡 NOT BUILT，任何文件不得寫成「已交付 / 已實作 / 顯示真實資料」。**

---

## §1 效力順序（衝突裁決，不看版本號大小）

```
使用者最新明確指令
  > 互動實作規格與標準對齊.md（行為合約 / 正典路由 / 官方對齊）—— 最高效力
  > 開發軌跡與執行計畫.md（v3：順序 / 里程碑 / DoD）
  > 設計規格.md（v2：介面 / token / A1–A10 介面分析）
  > 兩份 .html 原型（視覺 / IA 示意，非程式碼範本）
平行補充層（不改需求/規格）：實作紀律與技術債防線.md
                              ai-bim-governance-design-system-對齊矩陣.md（repo 覆寫彙整索引）
程式碼權威覆寫文件：repo 實作與 tests/ 為行為真相；docs 不得當行為權威
```

- 互動規格自稱 v1 但效力最高；v3.1/v2.1 版本號較大但效力較低——一律以本行順序為準。
- **design-system 對齊矩陣**屬 docs 層的 reference 索引，**不具獨立效力**；與 repo 衝突時以 repo 為準，與互動規格衝突時以互動規格為準。矩陣 §3「最終覆寫源」一詞僅指「彙整 repo 覆寫結論的索引」，不自封凌駕 repo 或互動規格。
- 設計系統（styles.css / 元件）對「視覺」有約束力；對「功能是否存在」無約束力——以 repo 現況為準。

---

## §1.1 Current Decision Ledger（避免 stale snapshot 覆寫現況）

| 主題 | 現行裁決 | Superseded / 禁用說法 |
|---|---|---|
| MinIO `#minio` | `#minio` 已接 coordinator `GET /api/minio/objects?prefix=&delimiter=/`，是真 MinIO raw-folder 逐層唯讀瀏覽；`GET /api/governance/files/tree` local_fs 仍是 A1 v2 另一選檔來源。 | 禁寫「只剩 local_fs 兩層樹」、「真 MinIO 三層待接」。三層「專案/種類/版本」只是 watcher 解析語意，不是 bucket 結構宣稱。 |
| IFC→USD 轉檔紀錄 | streaming-server `GET /api/conversions` 與 coordinator `/api/dev/conversions` proxy 皆在；前端歷史呈現已於 2026-07-06 落地（ModelDataPage GlobalConversionPane「轉檔歷史」折疊區，#303）。殘餘：獨立第一入口頁與 >50 筆分頁未排程。 | 禁寫「完全無持久化」、「完全沒接線」、「缺前端歷史頁」。 |
| A1 v2 選檔 | 選檔雙來源：local_fs + MinIO；A1 選檔只跑 governance rule-run，不觸發 IFC→USD 轉檔、不寫 bucket。 | 禁把 A1 檔案下拉當 conversion trigger。 |
| A1 for-ifc-ready rule-run | 2026-07-08 Superpowers spec 標示 `/api/governance/rule-runs/for-ifc-ready/:jobId` 已實作；此屬凍結契約 approved exception，不能外推成任意 proxy 可改。 | 禁把該例外當成 §1 後端凍結全面放寬。 |
| A1 built 粒度 | A1 core closure built；v2 新增前端面（雙來源接線、BCF 審查面板、A1BridgeRail）仍依矩陣 §4.4 標示，不得未驗收即宣稱完整交付。 | 禁把「A1 built」解讀成所有 v2 user-facing surface 均已 E2E complete。 |
| A3 clash | A3 federation built；clash NOT BUILT · **未開工**。O6 已裁定官方 `ifcclash` 路線（2026-07-07 spec），依 `docs/superpowers/plans/2026-07-07-a3-clash-ifcclash.md` 執行。 | 禁顯示真實 clash 數字；禁再引用「blocked-on-OCC」與 2026-06-23 舊 clash plan。 |
| SaaS | SaaS docs 全為 PLANNED 增補層；現況是 tenant zero，IFC/USD payload 不出站。 | 禁把 `/v1`、tenant ACL、計量計費、SaaS services 寫成已支援。 |
| Full-system E2E | 必須同時具備 governance CPU semantic E2E 與 Kit WebRTC visual/runtime evidence。 | 舊 `docs/verification` / `docs/evidence` 不能單獨作 current full-system pass；黑畫面或缺 screenshot 只能標 runtime/stage-load partial。 |

---

## §2 檔案角色表（16 檔）

> **缺檔警告已解除（2026-06-23 更正）**：最高效力的 `ai-bim-governance-互動實作規格與標準對齊.md`（正典路由 22 條的唯一來源、PART B 互動卡、PART C 官方對齊）**已在本資料夾**。**2026-07-02 使用者明確指令**：本輪 A1 v2 改版**授權修訂此檔**（效力順序 §1 第一行）；v2 修訂附變更紀錄於檔頭，此後回復「非使用者指令不得重建/覆寫」。各檔仍把它當 source of truth 引用，引用名以現檔名為準。

| 檔案 | 角色 | 照著做 | 不要照抄 |
|---|---|---|---|
| `ai-bim-governance-互動實作規格與標準對齊.md` | **行為合約 + 實測差距 + 官方標準**（最高效力；**已在本資料夾，禁重建/覆寫**） | PART B 互動卡 IX-xx（狀態機 / API / 驗收）、六個通用互動模式、PART C 三領域官方對齊；**A.1.1 正典路由表 22 條（唯一來源）** | — |
| `ai-bim-governance-prototype.html` | 產品殼層需求原型（A1–A10 + 落地端控制台四頁） | 頁面清單、版面結構、互動語意（轉檔排程 / Session 端點池 / 機隊重啟搬移）、誠實標記呈現、NOT BUILT 全 disabled + 待建標記 | 單檔 vanilla JS 實作。正式殼層 = **React 18 + TypeScript EdgeConsole**，由 coordinator `/ui` 提供 |
| `ai-bim-geo-viewer-prototype.html` | 3D viewer「M4 完成後」的驗收示意（對應 `#viewer`） | 七區塊 IA（點選 → IFC 語意 → Pset/Qto → Spatial → GUID⇔USD 對應表 → A1 疊加 → 反向跳轉）；IA 保留、重生不動；示意原型內一律標「範例值·示意」 | **自寫 canvas 3D 引擎（純示意）**。正式版來自 Kit WebRTC 串流，前端只收 frame、指令走 DataChannel（`highlightPrimsRequest`）。「由幾何計算非寫死」為正式版要求，示意頁標「範例值·示意」 |
| `ai-bim-governance-設計規格.md` | v2 介面 + token + A1–A10 介面分析 | Design tokens（**以 styles.css 為唯一真相，文件數值示意**）、A1–A10 介面分析、MinIO / 轉檔狀態須對齊本 README §1.1 與 §3 鐵律 #7 | 舊版「local_fs 兩層樹、真 MinIO 待接」與「完全無轉檔紀錄 / 完全沒接線」皆已作廢；A4 狀態以對齊矩陣裁決為準 |
| `ai-bim-governance-開發軌跡與執行計畫.md` | v3 軌跡 + 工程規格 + 執行計畫 | **實作順序照這份**：里程碑 M0–M8、各 App API 草案與 DoD、決策 D1–D9、未決事項 O1–O6 | — |
| `ai-bim-governance-實作紀律與技術債防線.md` | **實作紀律 + 技術債防線**（HOW 補充層，不改需求/規格） | §1 一頁速查、§2 八原則、§3 技術債陷阱 D-01~D-23、§4 DoD 硬化、§8 交付前總檢查表 | — |
| `ai-bim-governance-design-system-對齊矩陣.md` | **DS × repo 三方對照**（新增；A4 狀態唯一裁決源） | repo 覆寫結論索引（DS 宣稱 vs 互動規格 vs repo 現況）；A4=NOT BUILT·p4 裁決在此 | 自封「功能最終覆寫源」（效力見 §1）；不得獨立改需求 |
| `ai-bim-governance-前端對齊DS-保留後端-實作手冊.md` | **前端對齊 DS 的唯一可執行計畫（HOW 層）**（新增 2026-06-23） | §1 後端凍結面契約（DO-NOT-TOUCH）、§2 token 對照、§3 13 元件對應、§5 逐路由可執行規格（DS 視覺 / 保留後端 API / AI-coding 任務 / 改檔 / Playwright 驗收 / Prov）、§6 執行順序、§8 待人類決策 | 不取代互動規格/設計規格/對齊矩陣（效力見 §1）；路由表/A1–A10 裁決只引用不重維護 |
| `ai-bim-governance-saas-架構總覽.md` | 雲地混合 SaaS 架構總綱（控制面 / edge plane / 通訊契約 / survivability；**全 PLANNED**，新增 2026-07-06） | 定位框架與服務清單方向 | 當成已建成事實；具體數字（心跳頻率 / SLO 等）皆規劃值·非實測 |
| `ai-bim-governance-saas-租戶與身分.md` | 租戶模型（tenant→project→model-container）/ Bridge 隔離分層 / 身分與 token 相容路徑（**全 PLANNED**，新增 2026-07-06） | 隔離策略方向（Pool/Silo/tenant-per-stamp）與相容路徑設計 | 當成 repo 已支援多租戶；ACL/assignee 授權模型屬待人類簽核的新決策 |
| `ai-bim-governance-saas-GPU經濟與計量計費.md` | Session broker 設計 / GPU 硬約束（H8）/ 三軸計量 / 方案分層（**全 PLANNED**，新增 2026-07-06） | GPU 物理死線與排隊 / 配額設計方向 | 承諾 live migration / hot-swap；定價與 COGS 數字皆規劃值·非實測 |
| `ai-bim-governance-saas-公開API與標準對齊.md` | `/v1` 物理分離設計 / webhook / BCF·IDS·bSDD 對齊（**全 PLANNED**，新增 2026-07-06） | 凍結契約保護矩陣與 golden-path 守門設計方向 | 宣稱已支援 BCF 3.0；動 §1 禁改後端檔 |
| `ai-bim-governance-saas-合規資料主權與生命週期.md` | ADR / 資料主權三層 / 生命週期狀態機 / DR / GDPR（**全 PLANNED**，新增 2026-07-06） | 合規框架與資料主權承諾方向 | 當成已通過稽核；ISO/SOC 2 範疇聲明皆待簽核 |
| `ai-bim-governance-saas-遷移路線與里程碑.md` | SaaS-M1～M8 scope / DoD / 回退（**全 PLANNED**，新增 2026-07-06） | 各階段 scope 與 DoD 驗收方向 | 跳過既有 M0–M4 里程碑語意；SaaS-M 編號為接續而非覆寫 |
| `審批報告-docs-plans-SaaS改版-2026-07-06.md` | 本輪 SaaS 改版審批紀錄（現行最高審批） | 追溯本輪裁決依據與 open_question_rulings | 當成需求規格本身；具體設計以對應 saas-* 檔為準 |
| `docs/superpowers/specs/2026-07-06-plans-saas-replatform-design.md` | 本輪改寫變更契約（CI missing_openspec gate 佐證；位於 `docs/superpowers/specs/`，非本目錄） | 對照本輪文件變更範圍 | 當成產品需求規格；此檔僅供 CI 治理佐證 |

> `docs/plans/` 共有**兩份**原型 .html——`ai-bim-governance-prototype.html`（殼層，22 頁導航）與 `ai-bim-geo-viewer-prototype.html`（3D 語意驗收示意，M4）。兩份皆為行為/視覺示意，非程式碼範本。

---

## §3 實作鐵律（11 條，違反 = 做錯）

### 1. 順序照 v3
M0 地基 → M1 A1 核心閉環（P0，純 CPU，不碰 3D）→ M2 轉檔 → M3 串流 → M4 3D 連動 → M5+。不要先做 3D。

### 2. Route contract（唯一正典）
完整路由以《互動實作規格》PART A「**A.1.1 正典路由表（22 條）**」為唯一來源。各文件不得各自維護路由表，只引用。

要點：

- hash 無斜線（`#a1` 非 `#/a1`）
- **`#gpu` 為 GPU 審查室正典 route，`#review` 為別名**；但 repo `EdgeConsole.tsx` 同時存在獨立的 `case "review"` = ReviewRoomPage，**兩者語意不同，勿混淆**；保留別名清單須含 `review`，勿斷現有 ReviewRoomPage 連結
- **路由表「hash」欄（如 `#a1`）對應 `EdgeConsole.tsx` switch key 與 `PAGES[].key`**；`RM_APPS[].route`（如 A1→`"issues"`）是 App 卡內部跳轉目標，語意不同，勿當等式
- `#runtime` 正式（已建）、`#admin` **待建**；operator `#kit`、`#demo-control` 保留不砍
- `/ui/open?session=:id` 為凍結 handoff path，禁 `/ui/*` 萬用 redirect 吃掉
- deep-link aliases（`overview/coordinator/intake/semantic/apps/review`）保留，不砍

### 3. 誠實標記
由後端 provenance 驅動，不寫死前端。未做的功能一律標「待建」，**不提供假按鈕**。無遙測標「未取得」不畫 fail。設計系統五類 ProvTag 對映 repo `Prov` 型別（**僅 7 值，無 `todo`**）：

| 設計系統類別 | repo Prov 值 | 標籤 |
|---|---|---|
| built | `asbuilt` | 已實作 |
| artifact | `artifact` | 實測 artifact |
| demo | `demo` | 示範資料 |
| ai | `p15` | 後端待建 · P1.5 |
| todo | `p1` / `p3` / `p4` | 後端待建 · P1 / 願景 Phase 3 / 願景 Phase 4 |

`prov="todo"` 會 TS2322，禁用。

### 4. 官方支援才做
1 GPU = 1 Kit instance = 1 stream（同時 session ≤ GPU 數）；session 換 GPU = terminate + recreate（約 30–40 秒），**無 live migration**；spectator 共看同一 stream 不另吃 GPU。GPU 受限的是**容器 plane**（缺 Vulkan ICD）；host 有 RTX 4060 Ti + host-native Kit。

### 5. host-native vs container plane 分離（雲地分離鐵律）
governance-service / Kit / 轉檔引擎為 **host-native**，browser 不直連，一律經 coordinator proxy；容器 plane 只跑 web 面且缺 Vulkan ICD，GPU 受限的是容器而非 host。prototype.html 的「依賴列表」每頁標 host-native / container 歸屬。

### 6. Issue 共同出海口
A1/A2/A3/A5 共用同一 Issue/BCF schema（見 v3 §2.0.3），不要各做各的。BCF 現行 2.1 匯出保留；3.0 為升級目標（須先向 buildingSMART 確認）——此句只在互動規格 PART C 落一次，其餘引用。

### 7. 資料路徑（MinIO 誠實框架，四釘子逐字）

**1 — watcher 已實作**：`bim-review-coordinator/src/services/minioWatcher.ts` `deriveIntakeFromKey` 解析 ≥3 段 key；種類=倒數第二段、版本=末段；中文資料夾→`mv_<hash8>`。env opt-in 預設關；真實 MinIO endpoint（`192.168.20.234:9000` / bucket `bim-control`）由部署區 .env 注入，不硬編碼。live 多層觸發 not observed。

**2 — 轉檔紀錄**：轉檔權威 `bim-streaming-server`（`GET /api/conversions` list / `/{id}` / `/{id}/result`）已存在；coordinator 已有 `/api/dev/conversions` proxy 轉發 streaming list。**前端歷史呈現已落地（2026-07-06，#303）**：`ModelDataPage` 的 GlobalConversionPane「轉檔歷史（conversion service pass-through）」折疊區渲染前 50 筆，含誠實空/錯誤狀態。殘餘缺口：獨立第一入口頁與 >50 筆分頁未排程。禁寫「完全無持久化」、「完全沒接線」或「缺前端歷史頁」。

**3 — `#minio` 頁現況（2026-07-02 更新）**：頁面已升級為**真 MinIO raw-folder 逐層瀏覽**（coordinator `GET /api/minio/objects?prefix=&delimiter=/`，唯讀；folders[]=CommonPrefixes、objects[]=當層直屬檔），中文資料夾原樣顯示；舊版「local_fs 兩層樹、真 MinIO 待接」已過時。「專案/種類/版本」三層語意仍只是 watcher 解析語意（釘子 #1），不得當成 bucket 實際結構宣稱；bucket layout panel 仍標 `prov="demo"`（語意參照）。`GET /api/governance/files/tree`（local_fs）繼續存在，是 **A1 v2 選檔的另一來源**：雙來源切換（local_fs / MinIO），兩條路徑不得互冒。

**4 — 觸發**：自動觸發靠 watcher 偵測新/變更的 key；**手動觸發已接線（2026-06-30 起）**：`POST /api/conversion/trigger`（IP allowlist＋IntentDialog 確認＋idempotency；GlobalConversionPane／ObjectDetailPane「觸發轉檔」按鈕），僅對**未被 watcher 偵測**或**終局失敗**（`force_retrigger=true`）的 MinIO 物件建新請求。prioritize/retry 仍只對既有 ifc-ready job 排序/重試；`PUT /api/conversion/watch` 只開關 watcher 生命週期。**A1 v2 選檔不是觸發器**：從下拉選到 MinIO 檔只對該檔跑 rule-run（CPU，governance-service），不觸發 IFC→USD 轉檔、不寫 bucket。

短期真相源 = local_fs storage（三層規約已落地 270/機電|水電|消防/000001~000003+竣工.ifc）。**測試資料歸屬（2026-07-10 R8 修正）：MinIO bucket 為真實資料監控來源（不標測試資料）；local_fs storage 270/889/990/271 為本地測試 fixtures，A1 選檔 local_fs 來源須標「測試資料」（清單由 coordinator config 驅動，不得裸寫編號）。** 轉檔輸出 `model.usdc` 寫回對應位置 + coverage 報告（不承諾 100% 無損；conv-coverage=1 在 usd_stage_enumeration 下為結構性自我參照，須加 `conv-coverage-selfref-note`）。

### 8. 服務邊界（6 服務，埠以《互動規格》§8 / 《開發軌跡》§2.0.2 為準）

| 服務 | 埠 | 能做 | 不能做 |
|---|---|---|---|
| coordinator | `127.0.0.1:8004` | session/instance、`/ui`、`/api/governance/*` proxy、ifc-ready intake、`/ui/open?session=` redirect | 不渲染 / 不開 USD stage / 不奪 Kit 控制權威 |
| governance-service | `127.0.0.1:49102` | A1 rule-run / A2 diff / A3 federation / Issue / BCF / `/api/files/tree`（CPU） | **永遠 host-native、browser 不直連，一律經 coordinator proxy** |
| bim-streaming-server | 信令 49100 / 串流 47998 / 轉檔 API 49101 / spectator 兩條序列（signaling 49110 起、media 48008 起、stride 10；KIT_SPECTATOR_COUNT 決定範圍） | IFC→USDC 轉檔 / Kit runtime / viewport / WebRTC + DataChannel | 不處理登入 / 不當 project 資料權威 / 不當長期 Issue DB |
| web-viewer-sample（viewer） | `127.0.0.1:5173` | 顯示串流 / DataChannel 互動 / 前端 spectator gate | 不啟 Kit / 不分配 GPU / 前端 `disabled` 不是授權邊界 |
| kit-manager-api | `127.0.0.1:8010` | `#instances`/`#runtime` 真遙測、Kit 啟停 / GPU pool 控制權威 | — |
| kit-manager-web | `127.0.0.1:5174` | kit-manager-api 的 operator 前端（Mode B compose 部署） | 不作產品入口；收斂觸發條件＝console Kit 頁功能對等 |
| MCP sidecars | `9901/9902/9903` | kit-mcp / usd-code-mcp / omni-ui-mcp 官方驗證（**dev-time 驗證工具，非 golden-path runtime、不由 deploy.ps1 編排**） | — |

### 9. IFC diff / BCF 對齊 IfcOpenShell 官方語意
版本比對現行採**自製多級鍵引擎**（`governance-service/diff_engine`：GlobalId→(is_a,Tag)→type+Name+loc；moved 用 placement Δ、property 用 pset hash；語意對齊 ifcdiff——GlobalId 主鍵、JSON 輸出）。**2026-07-10 簽核（R2）**：選型理由＝三級配對抗 GUID churn＋moved 責任語意＋直接對接 Issue/3D schema；已知限制＝跨 IFC schema 比對不保證正確，碰到跨 schema 需求時再評估官方 `ifcdiff`。（2026-07-10 實測：270 機電 v1→v2 與 v2→v3 皆純增量、零 GUID churn，兩引擎輸出同構——三級配對屬防禦性設計尚無自家資料實證；詳 `artifacts/2026-07-10-a2-diff-vs-ifcdiff-experiment.md`。）BCF 用官方 bcf 庫語意（現行 2.1 保留，3.0 為升級目標）。

### 10. IFC→USD 對齊 IfcConvert 官方能力邊界
IfcConvert 無 USD 輸出；自製 IFC→USD 必須：(a) 以 GlobalId 命名 prim（`G_<sanitized_guid>`）、(b) 出 mapping coverage 報告（不承諾 100% 無損）；備援路線 `IfcConvert --use-element-guids` → glb。

### 11. 3D viewer 功能對齊 Omniverse 官方 extensions
量測/批註/剖切/書籤/場景樹/屬性/串流一律用官方件（`omni.kit.tool.measure`、`omni.kit.tool.markup`、`omni.kit.window.section`、`omni.kit.waypoint.core`、`omni.kit.widget.stage`、`omni.kit.window.property`、`omni.kit.livestream.webrtc`），web 端不重做；自製僅限 BCF 橋接層。Replicator / Cosmos / Isaac（A8/A10）版本風險高，先用 kit-mcp/usd-code-mcp/omni-ui-mcp + nvidia.com/omniverse 驗證再寫；無法確認標 `Phase X · 待驗證`。

---

## §4 A1–A10 狀態一覽（以 repo data.ts + 官方對齊為準）

**A4 狀態唯一裁決源 = design-system 對齊矩陣 §4.4**，其他文件一律寫「A4=NOT BUILT·p4，裁決見對齊矩陣 §4.4」，禁各自展開論證。**A2 頁不得出現成本影響塊；成本屬 A6（5D 成本/S-curve）/ A9 範疇，非 A2，A2 不呈現。**

| App | 狀態 | 真相要點 |
|---|---|---|
| A1 治理檢核 | **built** | **v2 流程：選檔（雙來源）→ 檢核 → 結果 → 審查（Issue·BCF）→ 交付**。rule_engine + ifctester(IDS) + issues + BCF 2.1；選檔=`GET /api/governance/files/tree`（local_fs·built）+`GET /api/minio/objects`（真 MinIO 逐層·built，唯讀），local_fs 測試 fixtures 標「測試資料」（MinIO＝真實資料監控，不標；R8）；BCF 審查面板=issues API（列表/狀態流轉 built；**指派欄待建 P1**）；3D 高亮 P1.5——A1 連動橋只讀 `#sessions` 證據，證據未齊鍵保持 disabled |
| A2 版本差異 | **built** | diff_engine（GlobalId 多級）；ifc_type/ifc_name 落庫 bug 已修（PR #242）；**無成本影響塊（成本屬 A6/A9，非 A2）** |
| A3 跨專業疊合 | **拆分** | **federation built**（USD sublayer + review-room handoff）；**clash NOT BUILT · 未開工**——O6 已裁定官方 `ifcclash` 路線（2026-07-07 spec/plan 已核可待執行）；`#a3` 頁 clash 佔位標示依該 plan 落地 |
| A4 語意搜尋 | **NOT BUILT · p4** | 願景 Phase 4；無任何後端程式碼；**禁寫成 hero built**；裁決見對齊矩陣 §4.4 |
| A5 IoT/FM | **NOT BUILT · p3** | 願景 Phase 3；須等 MQTT+TimescaleDB |
| A6 4D/5D | **NOT BUILT · p4** | 願景 Phase 4；GPU-bound；RM_APPS phase=2 但 prov=p4，狀態以 prov 為準 |
| A7 Reality Capture | **NOT BUILT · p4** | 願景 Phase 4；需 usd-code-mcp 驗 mesh-compare |
| A8 Synthetic Data | **NOT BUILT · p4** | 願景 Phase 4；需對齊 Omniverse Replicator（先驗再寫） |
| A9 審查 Copilot | **NOT BUILT · p4** | 願景 Phase 4；僅 session layer（intent→confirm→audited result）；不在 3D 場景 |
| A10 機器人巡檢 | **NOT BUILT · p4** | 願景 Phase 4；Isaac-sim adjacent；先驗再宣稱 |

A1–A10 具體數字（「312 扇門」「17000 frames」等）為**願景敘事**，禁當實測。Hero built（Edge Console）= **A1 + A2 + A3-federation**。

---

## §5 驗收方式

- **A1 v2 / #sessions 改版**：以本輪更新後的 `ai-bim-governance-prototype.html`（`#a1`、`#sessions` 兩頁）+《互動規格》IX-A1-01/07/08、IX-SS-05 為驗收基準；選檔區三樣式（下拉／級聯 pills／樹狀）為原型供挑設計，正式版擇一實作
- **里程碑**：以 v3 DoD 為準
- **互動行為**：以互動規格 PART B 互動卡（IX-xx）為準（禁樂觀更新、一律證據型更新）；既有 e2e trace（`artifacts/e2e/conv-watch-toggle-trace/` 等）可當驗收錨
- **介面長相**：以兩份原型對應頁面為準（styles.css 為 token 唯一真相，文件數值示意）
- **user-facing 功能**：須附 gstack/Playwright evidence（`artifacts/e2e/*.png` + trace）；backend-only done 不接受

---

## §6 給 repo root CLAUDE.md 的建議段落（5 份文件 + 對齊矩陣 + 前端對齊實作手冊）

```
## 需求事實來源
A1–A10 功能需求、UI 驗收語意與實作順序，一律以 docs/plans/ 為準：
先讀 docs/plans/docs-plans-README.md，再依任務讀：
  互動實作規格與標準對齊.md（行為合約 / 正典路由 22 條 / 官方對齊）
  開發軌跡與執行計畫.md（里程碑 M0–M8 / DoD / 順序）
  設計規格.md（介面 / A1–A10 介面分析；MinIO / 轉檔現況須對齊 README §1.1 / §3.7）
  ai-bim-governance-design-system-對齊矩陣.md（DS × repo 三方對照；A4 狀態唯一裁決源）
  前端對齊DS-保留後端-實作手冊.md（前端對齊 DS 的可執行任務層；§1 後端凍結面契約 = DO-NOT-TOUCH，做前端對齊前必讀）
  實作紀律與技術債防線.md（HOW 補充層，不改需求）
兩份 .html 是行為示意，不是程式碼範本。
```

---

## SaaS 增補層導讀（2026-07-06）

- 本輪 SaaS 重定位承接《審批報告-docs-plans-SaaS改版-2026-07-06.md》審批紀錄；該報告為本輪裁決依據的唯一追溯來源。
- 定位一句話：AI-BIM-governance 是「雲端控制面 + 落地端 plane」的雲地混合多租戶 SaaS；**SaaS ≠ 全上雲**，模型檔（IFC/USD payload）不出站，雲端只收 metadata-only 白名單投影。
- 全部 `ai-bim-governance-saas-*` 檔案（含審批報告與本段）為**增補層**：效力位於本 README §1 所列全部既有文件之下；與既有文件衝突時，一律以既有凍結契約（互動實作規格 A.1.1、前端對齊DS手冊 §1）與對齊矩陣 §4.4 裁決為準，不得覆寫。
- 全部 SaaS 能力狀態 = **PLANNED**；現況已建成僅單站點閉環（即 tenant zero），任何 SaaS 服務、隔離層、計量計費、`/v1` API 均尚未實作，禁止任何文件寫成「已交付」。
- 凡本增補層或其對應 saas-* 檔中標記「**待人類簽核的新決策**」的條目，未經人類明確簽核前，一律不得進入實作。
