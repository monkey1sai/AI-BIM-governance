# TARGET-viewer — 共享 3D/runtime、`#viewer` 七區塊 IA 與 A1–A10 viewport 契約

> v3 · 2026-07-14 · 2D design authority 與 live runtime evidence 分離
> 讀者：做 `#viewer`／M4／A1–A10 3D 連動任務的 AI coding agent；驗收 runtime evidence 的 agent。
> 本檔＝共享 viewer 互動與 runtime 證據目標；每個 route 的業務情境與頁面 IA 仍由 TARGET-shell 對應節定義。現況一律問 TRUTH.md；本檔不作任何建成宣稱。

## §0 基準與凍結點

`TARGET-viewer@v3 frozen 2026-07-14 · 2D基準=approved design-system snapshot；runtime authority=this file + TARGET-shell`

- 凍結點規約同 TARGET-shell §0：內容改版＝bump `@v<N>`＋一行作廢範圍；凍結點行固定上列語法，可 grep 可 diff。
- 作廢範圍（v2→v3）：legacy geo-viewer HTML／route PNG 作 production 2D 視覺 pass/fail 權威與 production CSS token 作獨立真相；2D 外框改依 contracts §5.1 的 approved design snapshot，live 3D 仍依本檔 runtime evidence。
- 作廢範圍（v1→v2）：舊 scene 對應 A9 Copilot／A10 Robotics、以及「所有 console route 都不得 inline viewer」的無例外敘述；依 route PNG 改為 A9 Robotics、A10 AI 決策，並承認 contracts §1.1 的 A1 inline 限定例外。
- 共享 viewer 的 2D shell／toolbar／panel／狀態依上游 `desigin-system` 與 repo-pinned snapshot；coverage 唯一 machine mapping 是 manifest `route_inventory[]`。`#viewer` 為 `status=reference_missing` 時不得宣稱 99%；`routes_without_approved_pixel_reference[]` 只是 derived compatibility projection。tracked `docs/plans/ai-bim-geo-viewer-prototype.html` 與 route PNG 只保留作七區塊、GUID⇔Prim、DataChannel 與 OpenUSD/runtime companion。durable viewport/runtime 正本是本檔 §8＋TARGET-shell 對應節；設計圖不定義數字、協定、runtime 狀態或建成證據。
- live WebRTC video／動態 GPU frame 不做 `≤1%` pixel 比對；未來若有 approved viewer baseline，只比 2D chrome 與 manifest 明列的非動態區域。first frame、loaded stage、mapping 與 Kit/DataChannel ack 永遠由 operability/runtime gate 驗證。
- 純潔性聲明：本檔為目標規格（TARGET），禁止出現對 repo 的建成宣稱（grep 樣式見 PROCESS §6 閘 1）；「待建」為需求屬性，「NOT BUILT」僅作為佔位頁 UI 呈現需求字樣。
- 全域不變量引 TARGET-contracts：官方 extensions（§7）、USD 命名與 fidelity（§8）、誠實元件（§9）、雲地邊界（§11）；本檔不重複其正文。
- 本檔被 TARGET-shell 的 `#viewer`／`#gpu`／`#review`／A1–A10 節與 BACKLOG viewer 系列 gap 引用。反向查找：route 定義、業務欄位與實作接點以 TARGET-shell 對應節為準；A1 可用 contracts §1.1 限定的 `mode=a1-inline`，其他 route 要 inline WebRTC 必先取得同節加性例外，否則 CTA 走 `/ui/open?session=` 凍結 handoff；驗收走 PROCESS §2／§3。
- prov 語彙澄清：本檔的「NOT BUILT／DEMO DATA／範例值／示意統計」皆為 UI 顯示 label 文案，**不是 repo `Prov` 型別值**（僅 7 值 asbuilt/artifact/demo/p1/p15/p3/p4，映射正本＝contracts §5）；若在 console 內以 ProvTag 實作：NOT BUILT／待建佔位 → `p1`/`p15`/`p3`/`p4`（依 phase）、DEMO DATA／範例值／示意統計 → `demo`。

---

## §1 殼層框架需求（七區塊之外的 `#viewer` 殼層）

### §1.1 頂部列（topbar）與浮水印

| 元素 | 需求內容 / 範例值 | 誠實標記 |
|---|---|---|
| 品牌 | `GV` mark＋`AI-BIM-Geo Viewer`／小字 `IFC → USD SEMANTIC CHECK` | — |
| 回站連結 | `← BIM 站台` → `https://bim-docs.jackshappybot.com/` | 真連結 |
| 測試資料 pill | coordinator config 判定 `local_fs` fixture 時顯示「測試資料」；MinIO 來源不因來源或編號自動套用 | 來源驅動，不裸寫編號 |
| 來源 pill | `bim-control/270/<uuid>/v01`；key 結構＝`bim-control/<專案>/<uuid>/<版本>` | 範例值 |
| DEMO 徽章 | `DEMO · 視覺/行為示意` | DEMO |
| 租戶徽章 | `tenant zero · 單站點現況 · DEMO DATA`（tooltip：多租戶 SaaS PLANNED·未建；現況僅單站點單租戶閉環） | PLANNED |
| 場景選單 | `?scene=` 下拉（§1.5） | — |
| KIT 狀態點 | 誠實規則：無 GPU/harness 時灰點＋`KIT runtime=no`，不偽造在線 | 誠實（contracts §9） |
| 導覽開關 | `說明導覽 ON/OFF`：切 `.guide` class，顯示七區塊 1–7 編號徽章與彩框 | — |

示意畫面必帶固定右下浮水印：`⚠ CANVAS 示意 · 非真 WebRTC 串流`（pointer-events:none，永遠可見），避免驗收場合誤認。

### §1.2 模型資訊卡（左欄）

欄位一律由轉檔輸出回填；統計未回填前標示意／未取得，禁止捏造覆蓋率。

| 欄位 | 範例值 / 需求 |
|---|---|
| IFC 檔案 | `model.ifc` |
| IFC Schema | `IFC4` |
| 轉換配置 | `ifcopenshell_openusd_identity` |
| USD Stage | `model.usdc` |
| 命名規約 | `G_<sanitized_guid>`（contracts §8） |
| Mapping Fidelity | `guid_exact 97.x%`（即時統計；明文禁止捏造 99.x% 覆蓋率） |
| 總元件數 / 已對應數 / name_fallback | 即時統計 |
| Coverage 報告 | 「由轉檔輸出（不承諾 100% 無損）」 |

### §1.3 執行計畫狀態卡（里程碑卡）

- chips 兩態：完成（綠 ✓）與待建（虛線灰），涵蓋 `M0 地基`、`M1 A1 檢核`、`M2 IFC→USD`、`M3 串流`、`M4 3D 連動`、`M5 版本疊合`、`M6 IoT/FM`、`M7 4D/SDG`、`M8 進階`。
- **本卡是 M0–M8 里程碑語彙的權威定義**；必須如實顯示各里程碑實際狀態（AC-18），不假裝全綠。原型模擬「M1、M2、M4 完成後」整合畫面；M5+ 為願景 Phase。

### §1.4 中央工具列與畫布 overlay

- 工具列：`實體/線框` seg、`⌂ 重置視角`、`A1 檢核疊加 OFF/ON`、高亮模式下拉（`dim 其餘變暗`／`iso 其餘隱藏`）、hint「拖曳旋轉 · 滾輪縮放 · 點擊選取構件」。
- RR_BRIDGE 串流橋接四步常駐頂條：`1 建立 session → 2 派發 endpoint → 3 首幀 first frame → 4 DataChannel 就緒`；狀態如實反映 session 生命週期，未達的步驟顯示 pending（不假裝 done）；**首幀由 track event 驅動，非 timer**。
- cv-chip 群：`chipSel`（`尚未選取構件` → 選取後 `<tag> · <IfcClass> · <storey> · <shortGuid>`）；`chipA1`（A1 ON 時：`A1 檢核（governance-service :49102 · 經 coordinator proxy）：N 件未過 / 規則數 · 範圍＝A1 選定檔 rule-run（v2）`）；紫色 DC chip 常駐（`正式高亮路徑：DataChannel highlightPrimsRequest → Kit`）；雲地邊界 chip（`3D 審查＝落地端 GPU plane；雲端僅收 metadata PLANNED，模型 payload 不出站`，contracts §11）。
- 串流遙測卡（streamcard）：CODEC / LATENCY / CAM / FPS 四列，只顯示真實取得的值；未取得一律 `未取得 / n/a`（斜體灰），禁止偽造 60 FPS；渲染迴圈 FPS 不回寫頂條。

### §1.5 `?scene=` 場景系統（七景）

| scene id | 標籤 | 需求姿態 | 佔位文案要點（UI 呈現需求） |
|---|---|---|---|
| `viewer` | ◳ GPU 審查室 · 語意驗證 | 主驗收景 | `#viewer / M4：IFC→USD 語意驗證驗收示意（目標組合＝A1＋A2＋A3 federation）` |
| `clash` | ◈ A3 跨專業疊合 · Clash | 佔位景 | `NOT BUILT · 未開工`：O6 已裁決 ifcclash；實作前不顯任何碰撞計數，引擎不可用時顯 runtime probe 原因 |
| `4d` | ▤ A6 4D/5D 進度成本 | route viewport mode | activity/time overlay；資料缺席時顯明確 unavailable，不填 demo EVM |
| `reality` | ◫ A7 掃描比對 | route viewport mode | model/point cloud/deviation；alignment 未成立前禁止畫 deviation |
| `synthetic` | ⊞ A8 Synthetic Data | route viewport mode | camera path/preview/annotator outputs；所有 frame 標 synthetic |
| `robotics` | ⊿ A9 機器人/自主巡檢 | route viewport mode | route/waypoint/sensor coverage；預設且顯眼標 `SIMULATION` |
| `copilot` | ✦ A10 AI 決策 context | route viewport mode | 只提供 scenario/evidence 的 3D context；AI 寫入僅 session layer，source hash 不變 |

能力缺席時的共用 fallback：畫布只畫暗 stage＋決定性 hatch（不偽造 matched 影像）、`scene-todo` overlay 顯示 glyph／能力名稱／原因／下一步，右欄改「尚無 runtime/語意資料」，drag/wheel/pick 全停用；若只缺 GPU，CPU/表格能力可繼續但 3D control disabled。場景切換走 URL `?scene=` 整頁跳轉。

### §1.6 狀態持久化

- localStorage key：`aibim:geo-viewer:<sceneId>`（per-scene）。
- 持久欄位：`sel`（選取構件 id）、`view`（solid/wire）、`himode`（dim/iso）、`a1on`、`tab`。
- refresh 不丟狀態；**cache 非 source of truth**（硬規則，見 §7）。

### §1.7 底部測試重點七條（逐字＝驗收敘事本體）

固定顯示「測試重點：如何判斷是否保留 IFC 語意？」：

1. 點選 3D 元件 → 右側看 IFC Type / Name / GlobalId
2. 檢視 Pset / Quantity 是否正確（尺寸、體積、材質）
3. 下方表格 IFC GUID ⇔ USD Prim Path 應為 guid_exact（命名 `G_<guid>`）
4. 空間關係正確（樓層 / 建築 / 場地）
5. 幾何定位與 Bounding Box 合理
6. 反向跳轉：從列表 / 結構樹選取 → 3D 自動高亮
7. A1 檢核疊加 → 未過規則的構件紅色高亮（M4 成果）

右端 `footRes` 鏡射右欄驗證結果五軸（✓/⚠，§5）。

---

## §2 七區塊 IA 正典

導覽 ON 時每區顯示編號徽章（gnum 1–7）＝IA 正典順序。各區塊欄位表＝正式 API／DataChannel payload 的欄位需求底稿。

### 區塊 1 — 點選構件（canvas banner）

- 目的：從 3D 畫面點選 IFC 元件 → 高亮鎖定 → 對應到 USD Prim Path。banner 文案：「點選 IFC 元件 → 高亮鎖定，對應到 USD Prim Path」。
- 互動：點擊選取（位移 <6px 才算 click）；拖曳＝旋轉、滾輪＝縮放。正式版拾取走 Kit 側（前端送座標／指令、Kit 回選取結果，§3）。
- 選取視覺：選中構件填色品牌綠 `rgba(132,199,20,.58)`＋黃描邊 `#ffd84d` 外框線。
- 選取回饋：同步更新區塊 2/5/6/7、`chipSel`、對應表捲動至該列。

### 區塊 2 — IFC 語意屬性（右欄）

- 目的：驗證點選構件的 IFC 語意在 USD 側仍完整可讀。

| 欄位 | 需求 / 範例值 |
|---|---|
| IFC Type | `IfcColumn` 等 |
| IFC Name | `COL-450x600` 等 |
| GlobalId | 22 碼 IFC base64 GUID，完整顯示 |
| PredefinedType | COLUMN/BEAM/STANDARD/DOOR/WINDOW；Slab 用 BASESLAB/FLOOR/ROOF |
| ObjectType | 中文：結構柱/結構梁/牆/樓板/防火門/鋁窗 |
| Tag | C-2xx/B-3xx/W-1xx/S-00x/D-0x/N-1xx |
| Fidelity | pill：綠 `guid_exact` 或警示 `⚠ name_fallback` |

- A1 內嵌盒（a1box）：構件有未過規則時顯示紅框盒 `A1 檢核：未通過 N 條規則`，逐條列 `規則ID · 描述（嚴重度）`。
- 空狀態：「點選 3D 構件、結構樹或下方表格列。」正式版欄位由 IFC 讀取。

### 區塊 3 — 結構樹 / IFC 分類（左欄）

- 目的：以 IFC 空間結構樹瀏覽與篩選（Spatial 驗證的導航面）。
- 結構：`IfcProject (1) > IfcSite — Site A (1) > IfcBuilding — Building A (1) > 樓層 1F/2F/RF（含件數）> 各 IfcClass 節點（含件數）`。
- 互動：點樓層＝篩選該層全部；點 class 節點＝篩選「樓層＋類別」；篩選中顯示 `✕ 取消篩選，顯示全部`。高亮模式兩種：`dim`＝其餘 ghost（低透明度仍可見）、`iso`＝其餘隱藏（不參與拾取）。

### 區塊 4 — IFC GUID ⇔ USD Prim Path 對應表（底部 tab「模型對應」）

- 目的：逐件證明 IFC→USD 對應保真（M2 產物的可驗證面）。

| 欄位 | 需求 |
|---|---|
| IFC GUID | 縮寫 `8…4` 顯示 |
| IFC Type / IFC Name | Name 含 tag |
| USD Prim Path | `/World/Elements/<IfcClass>/G_<sanitizeGuid(guid)>`；`sanitizeGuid` 把非 `[A-Za-z0-9_]` 換 `_`（正典命名，contracts §8） |
| Mapping Fidelity | `guid_exact` 綠／`⚠ name_fallback` 警示，**降級不隱藏** |

- 互動：點列＝選取（反向跳轉入口之一）；選中列青色底＋左緣 inset 條＋`scrollIntoView`。
- 同列其他頁籤：
  - `問題 / BCF 2.1`（含未過件數紅色計數）：欄位＝嚴重度（LED 點：Critical 紅發光/Major 琥珀/Minor 青）、規則 ID、說明、構件（tag+name）、`定位` 按鈕；點列或定位＝選取構件且**自動開啟 A1 疊加**。BCF 匯出一律 2.1；3.0 為升級目標（須先向 buildingSMART 確認）。
  - 停用頁籤四件（`待建` 小標）：`批註`＝`omni.kit.tool.markup`、`測量`＝`omni.kit.tool.measure`、`剖切`＝`omni.kit.window.section`、`書籤`＝`omni.kit.waypoint.core`，全標「M5+ 交付」。**正式件指定用官方 Kit extension，不自寫**（contracts §7）。

### 區塊 5 — 幾何資訊條（底部 geo strip）

- 目的：驗證幾何定位與 BBox 合理性。

| 欄位 | 需求 |
|---|---|
| BBOX (WORLD·mm) | `[x0,y0,z0] ~ [x1,y1,z1]` |
| 體積 | m³，3 位小數 |
| 材質 | Concrete/Steel/Aluminium/Glass |
| 樓層 / 系統 | 樓層；系統＝結構/建築 |
| USD | prim path |

- 正式版數值由真幾何計算；示意空狀態文案須含「（範例值·示意）」。

### 區塊 6 — Pset / Quantity 檢視（右欄）

- 目的：驗證 IFC 屬性集與數量在轉檔後可檢視、缺漏可見。
- Pset：依類別顯示標準 Pset 名（`Pset_ColumnCommon`/`Pset_BeamCommon`/`Pset_WallCommon`/`Pset_SlabCommon`/`Pset_DoorCommon`/`Pset_WindowCommon`）＋屬性列（Reference/Status/FireRating/IsExternal/LoadBearing/SelfClosing/PredefinedType/ThermalTransmittance 等）。**缺值顯示紅色 `— 缺 —`**——缺漏是可視化的一級狀態。示意時 Pset 名旁掛 `範例值` 標示（顯示文案；ProvTag 實作＝`demo`，contracts §5）。
- Qto：`Qto_<Class>BaseQuantities`（CrossSectionArea/Length/GrossVolume/GrossArea/Width/Height/NetVolume/Area，單位 m/m²/m³）；**正式版由真幾何計算**，示意標 `示意 · 正式版由幾何計算`。
- 互動：隨選取聯動，無獨立操作。

### 區塊 7 — 空間關係 Spatial（右欄）

- 目的：驗證 IFC 空間包含鏈與分類系統保留。

| 欄位 | 需求 / 範例值 |
|---|---|
| Contained In | `IfcBuildingStorey`（1F/2F/RF）、`IfcBuilding`（Building A）、`IfcSite`（Site A） |
| 分類系統 | `MasterFormat`（如 03 30 00 Cast-in-Place Concrete）、`OmniClass`（如 23-15 23 11 11）、`Uniformat`（如 B1010） |

### 區塊（附）— A1 檢核疊加（工具列按鈕＋紅色高亮）

- 目的：把 A1 rule-run 失敗構件疊加到 3D（M4 成果；IX-A1-08 A1 連動橋證據語彙）。
- 資料源：`governance-service :49102 · 經 coordinator proxy`；**疊加範圍＝A1 選定檔的 rule-run 失敗構件（v2），不是全庫**。
- 視覺：失敗構件紅色脈動填色＋紅描邊；選取態優先於失敗態。示意規則形狀範例（DEMO DATA，僅定義形狀）：`ARC-DOOR-REQ-001`（Critical）/`STR-COL-REQ-002`（Major）/`GEN-NAME-001`（Minor）。
- 聯動：切到問題 tab 或從 issue 列定位時自動開 A1；A1 ON 時區塊 2 顯示 a1box。

### 區塊（附）— 反向跳轉

三個反向入口收斂到同一 `select()` 語意：

1. 對應表列點選 → 3D 高亮＋右欄三卡＋geo 條更新。
2. 問題/BCF 列或 `定位` 按鈕 → 同上且自動開 A1 疊加。
3. 結構樹 → 篩選（dim/iso），非單件選取（樹是過濾器不是 selector）。

---

## §3 正式架構真相（原型內明文宣告，升格為架構需求）

- 正式 3D＝**落地端 Kit WebRTC 串流**：前端只收 video frame，**不做任何幾何運算**；正式版沒有前端 3D 引擎（§7）。
- 指令通道＝**DataChannel**；高亮正典指令＝`highlightPrimsRequest` → Kit 執行並**回 ack**（viewer 回 ack 是 A1 連動橋 IX-A1-08 的證據語彙）。點選拾取同樣走 Kit 側：前端送座標／指令、Kit 回選取結果。
- RR_BRIDGE 生命週期四步＝`建立 session → 派發 endpoint → 首幀 → DataChannel 就緒`；**首幀完成由 track event 驅動判定，非 timer 假進度**。
- A1 疊加資料源＝governance-service :49102，**經 coordinator proxy**（前端不直連 governance）；範圍＝A1 選定檔 rule-run，非全庫。A1 rule-run API 逐字（`/api/governance/rule-runs*` 全清單）與實作接點見 TARGET-shell `#a1` 節；3D 高亮啟用條件與 ack 語意見同檔 IX-A1-06／IX-A1-08。
- 批註/測量/剖切/書籤＝官方 Kit extensions（markup/measure/section/waypoint.core），M5+ 交付，不自建（contracts §7）。
- 串流遙測未取得＝`n/a` 斜體灰；禁止偽造 60 FPS（contracts §9）。
- 雲地邊界：3D 審查在落地端 GPU plane；雲端控制面僅收 metadata（PLANNED）、模型 payload 不出站；未導入多租戶時使用 tenant-zero 單站點姿態（contracts §11）。
- 視覺 token：上游 design source 經 primitive→semantic→component 三層投影到 production `--ec-*`／viewer styles，權威與 99% gate 見 contracts §5.1。legacy prototype 內嵌 fallback 只供單檔 companion，不可反向覆寫 production token 或 hardcode 品牌值。

---

## §4 AC-1 ~ AC-21 驗收條件全文（`#viewer`／M4 的 DONE 定義）

> [硬]＝原型明文；[推]＝合理推導。計數＝21。

### §4.1 核心語意驗證迴路（M2＋M4 交會）

- **AC-1 [硬]** 點選串流畫面中的構件 → 構件高亮鎖定，右欄顯示 IFC Type / Name / GlobalId（22 碼）/ PredefinedType / ObjectType / Tag / Fidelity。
- **AC-2 [硬]** Pset / Quantity 面板顯示真實 IFC 讀出的 Pset 與由幾何計算的 Qto（尺寸/體積/材質正確）；**缺值必須以「— 缺 —」級別可視化**，不得靜默省略。
- **AC-3 [硬]** GUID⇔USD 對應表逐件顯示，prim 命名為 `G_<sanitized_guid>`、路徑 `/World/Elements/<IfcClass>/…`，fidelity 應為 `guid_exact`；任何 `name_fallback` 降級必須標警示並計入統計，**不得隱藏或宣稱 100%**。
- **AC-4 [硬]** 空間關係正確：每件可見 IfcBuildingStorey / IfcBuilding / IfcSite 包含鏈（＋分類系統 MasterFormat/OmniClass/Uniformat 如來源有）。
- **AC-5 [硬]** 幾何定位合理：world-mm BBox 與體積可查且落在場地/樓層合理範圍（可移植 checkSpatial/checkGeom 斷言語意，§5）。
- **AC-6 [硬]** 反向跳轉：從對應表列、問題列、結構樹選取/篩選 → 3D 畫面自動高亮（正式路徑＝DataChannel `highlightPrimsRequest`，**Kit 回 ack** 才算成立）。
- **AC-7 [硬]** A1 檢核疊加 ON → 該 A1 選定檔 rule-run 的失敗構件在 3D 中紅色高亮（M4 成果、IX-A1-08）；資料源＝governance-service :49102 經 coordinator proxy；範圍＝選定檔 rule-run，非全庫。

### §4.2 檢視操作

- **AC-8 [硬]** 實體/線框切換、重置視角、拖曳旋轉、滾輪縮放、（正式版經串流指令）點擊選取。
- **AC-9 [硬]** 結構樹篩選支援兩種高亮模式：`dim`（其餘變暗）與 `iso`（其餘隱藏），且可一鍵取消篩選。
- **AC-10 [硬]** 問題 / BCF 2.1 頁籤：嚴重度（Critical/Major/Minor 三級視覺）、規則 ID、說明、構件、`定位`；點列/定位＝選取構件＋自動開啟 A1 疊加。BCF 匯出版本＝2.1（3.0 僅為升級目標）。
- **AC-11 [硬]** 批註/測量/剖切/書籤在 M4 驗收時為**停用頁籤＋「待建」標示**（正式件＝官方 omni.kit.tool.markup / tool.measure / window.section / waypoint.core，M5+）。

### §4.3 誠實鐵律（驗收時的呈現義務）

- **AC-12 [硬]** 串流遙測（CODEC/LATENCY/CAM/FPS）只顯示真實取得的值；未取得一律標 `未取得 / n/a`，禁止偽造 60 FPS。
- **AC-13 [硬]** KIT runtime 狀態點誠實：無 GPU/harness 時顯示 `KIT runtime=no`，不偽造在線。
- **AC-14 [硬]** RR_BRIDGE 四步狀態如實反映 session 生命週期；首幀完成由 track event 判定，禁止 timer 假進度。
- **AC-15 [硬]** `?scene=` 未建場景（clash/4d/reality/synthetic/copilot/robotics）顯示 NOT BUILT / 願景 Phase 佔位，**零構件/碰撞/量測資料**；clash 實作前不得顯示任何碰撞數，引擎不可用時顯 runtime probe 原因而非 0。
- **AC-16 [硬]** DEMO/示意資料一律掛 provenance 標示（顯示文案：DEMO DATA/範例值/示意統計；ProvTag 實作＝`demo`，映射見 §0／contracts §5）；coverage 敘述不承諾 100% 無損；只有 coordinator config 指定的 `local_fs` fixture 在 UI 明示「測試資料」，MinIO 來源不自動標測試。
- **AC-17 [硬]** 雲地邊界與未導入多租戶時的姿態照實標示：`tenant zero · 單站點`、雲端 metadata-only＝PLANNED、模型 payload 不出站。

### §4.4 殼層／狀態

- **AC-18 [硬]** 里程碑卡如實顯示 M0–M4 ✓ 與 M5–M8 待建（不假裝全綠）。
- **AC-19 [推]** UI 狀態（選取/檢視模式/高亮模式/A1 開關/頁籤）per-scene 持久化，refresh 還原；持久層不得被當資料 source of truth。
- **AC-20 [推]** 驗證結果卡五軸（Mapping Fidelity / IFC 語意 / Pset·Qto / Spatial / 幾何）由真資料即時計算並在底部列鏡射；模型資訊卡欄位（Schema/轉換配置 `ifcopenshell_openusd_identity`/USD Stage/命名規約/統計）由轉檔輸出回填。
- **AC-21 [推]** 有 `← BIM 站台` 回鏈與來源 key（`bim-control/<專案>/<uuid>/<版本>`）顯示，串起 A1 選檔→轉檔→viewer 的溯源鏈。

---

## §5 驗證五軸斷言語意（可移植為 E2E 斷言雛形）

右欄驗證結果卡五軸各 ✓/⚠，由真資料即時計算（示意版標 `即時計算（示意模型）`）：

| 軸 | 判定邏輯 |
|---|---|
| Mapping Fidelity | `name_fallback` 件數＝0 → ✓；否則顯示 `guid_exact xx.x%（N 件 name_fallback）⚠` |
| IFC 語意 | `checkSemantic`：每件 guid 存在且長度 22、全域唯一、cls/name 非空 |
| Pset / Quantity | 原型硬編 ✓；**正式版須真檢** |
| Spatial 關係 | `checkSpatial`：構件 z 範圍落在所屬樓層區間（STOREY_RANGE 1F/2F/RF） |
| 幾何定位 | `checkGeom`：BBox 三軸正長且落在場地外框內 |

---

## §6 IX-3D 互動卡族全文（逐卡搬運，嚴禁濃縮）

> 本卡的七區塊資訊架構與 GUID⇔USD 互動可參考 legacy `ai-bim-geo-viewer-prototype.html`，但它不是 2D visual pass/fail baseline。**誠實驗收規則**：該檔為 canvas 示意，正式 3D 一律來自落地端 Kit 的 WebRTC 串流；示意畫面須帶可見浮水印「CANVAS 示意 · 非真 WebRTC 串流」，避免驗收場合誤認。
> TARGET-shell 的 `#review`／`#gpu`／A1 連動橋相關節以卡號引用本節。

**IX-3D-01 開啟 viewer**：一般 route 輸入或選 `review_session_id` → 開 `coordinator /ui/open?session=` server redirect；A1 可依 contracts §1.1 用 `POST /api/external/ifc-ready/:jobId/review-session`＋`mode=a1-inline`。其他 route 要內嵌 WebRTC 必先新增 approved exception，不得只因 PNG 有 viewport 就繞過凍結面。

**IX-3D-02 DataChannel 指令契約**：openStage（成功證據=loaded stage URL 回報）/ focusPrim / selectPrims / clearHighlight。每次指令在 UI 留一行 trace（時間、指令、參數摘要、ack/timeout）——對齊「AI 透明可追」原則。**傳輸機制（官方）**：瀏覽器端 `AppStreamer.sendMessage(JSON.stringify({event_type, payload}))` 經 WebRTC DataChannel 送出；Kit 端由 `omni.kit.livestream.messaging`(v1.2.1) 收下→解析 JSON→重發到內部 message bus 交給對應 handler；Kit→瀏覽器回 ack 用 `messaging.register_event_type_to_send(event_type)`。命名對齊 NVIDIA `web-viewer-sample` 的 `openStageRequest`→`openedStageResult` 往返——本案 openStage / highlightPrimsRequest / isolatePrimsRequest 一律沿用同一 `*Request`/`*Result` ack 慣例。

**IX-3D-03 mapping table ↔ 3D 連動**：點 mapping 列 → 若 viewer 開著 → 發 focusPrim；無 usd_prim_path（mapping 缺）→ 該列標 ⚠ name_fallback 並 disabled 連動，tooltip「此構件未對應，無法定位」。

**IX-3D-04 first frame / stage truth 證據（P1）**：viewer 端回報 `first_frame_at`；console 只顯示，不推定。

**IX-3D-05 高亮／隔離**：A1 rule failure、A2 diff、A4 query、A5 alert、A7 deviation、A9 anomaly、A10 evidence focus 共用 highlight/isolate family；payload `{prim_paths[], color, source}` 的 `source` 目標值為 `a1|a2|a4|a5|a7|a9|a10`，ack＝同名 `*Result`。A3 用 sublayer/openStage、A6 用 time/status overlay、A8 用 camera/annotator 指令，不硬塞進 highlight。任何新 event type 仍走 IX-3D-02 `*Request/*Result`、trace、timeout 與 approved backend/runtime contract。

---

## §7 絕不可照抄清單（示意專用）

- **整個 canvas 3D 引擎**：`mulberry32` 亂數、`buildModel` 示意建築（seed 20260610、4×3 柱網、兩層樓）、`camBasis/project/rayFromScreen/rayAABB/pickElement`、軟體光照/背面剔除/painter's sort——原型檔頭明言「自寫 canvas 純示意，非程式碼範本」。**正式版沒有前端 3D 引擎**（§3）。
- **示意模型的所有數值**：GUID、BBox、Pset 值、Qto、fidelity 統計、3 條規則與失敗件——全是 DEMO DATA，僅定義**欄位形狀與呈現規則**（§2 各欄位表）。
- **localStorage 示意持久化**：可參考互動語意（§1.6），但「cache 非 source of truth」是硬規則；禁止把 localStorage 當業務狀態或資料權威。

---

## §8 A1–A10 viewport / runtime 角色矩陣

| route | 3D 在情境中的用途 | 必要輸入與 runtime action | 必留 evidence / 缺席姿態 |
|---|---|---|---|
| A1 | 規則失敗定位與交付視點 | rule-run failures＋mapping；inline session；highlight ack | `rule_run_id/review_session_id/first_frame/stage matched/ack`；GPU 缺席仍可 CPU 檢核 |
| A2 | Base/Target split/overlay 與 change focus | `diff_id`＋兩版 stage/mapping；client highlight | 兩 stage hash、session、selected item/ack；禁止呼叫 501 apply-overlay 當成功 |
| A3 | sublayer federation、visibility、transform | `federated_set_id`＋member hashes/transforms；open built stage | build artifact/hash、coordinate report、loaded stage；clash unavailable 不回 0 |
| A4 | 查詢結果 isolate 與 evidence focus | interpreted filters＋result prim paths；isolate/highlight | query/result/evidence refs＋ack；無 mapping 保留 table、不定位 |
| A5 | room/asset heatmap 與 alert focus | timestamped telemetry＋asset mapping；throttled overlay | point freshness/quality＋ack；stale/fixture 不顯 live |
| A6 | activity/time/status overlay 與 4D playback | baseline＋data date＋activity-element bindings；time/status overlay | baseline/source hash、activity id、as-of time、overlay ack；無 mapping 不著色，無 cost 不填 5D |
| A7 | model/point-cloud/deviation 對照 | aligned `capture_job_id`＋transform/RMS/tolerance；slice/deviation overlay | capture hash、transform、tool version、RMS/tolerance、selected deviation/ack；alignment 未成立不畫 deviation |
| A8 | camera path、preview 與 annotator output 檢查 | stage hash＋camera/seed/randomization/annotators；Replicator preview/run | `dataset_job_id`、runtime/tool version、per-frame manifest、failed frames；所有輸出標 synthetic |
| A9 | mission route、waypoint、sensor coverage 與 anomaly focus | `RobotMission`＋navmesh/sensor pack；Isaac Sim run/route/feeds | mission/runtime id、`mode`、telemetry freshness、event refs；預設顯 `SIMULATION`，physical 無 edge contract 時不可啟動 |
| A10 | scenario/evidence 的 3D context 與 evidence focus | scenario＋source refs＋mapped evidence；highlight/isolate 或 session-layer preview | scenario/module/report ids、source hashes、selected evidence/ack、source hash 前後一致；GPU 缺席仍保留表格分析 |
