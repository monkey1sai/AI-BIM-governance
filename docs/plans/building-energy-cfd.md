# 建築能效 CFD（風場／熱對流）：IFC → USDC → CFD 規劃

日期：2026-09-17；2026-09-21 更新 §6 進度。狀態：**提案；P0.1 與 P1 已有本輪真實證據（見 §6.1），P2 以後未動工**。尚未納入設計正本 §01 的服務邊界；本檔不是 runtime 完成證據。
衝突時依序採用：使用者最新指令、根目錄 `AGENTS.md`、設計正本、本檔。

## 1. 目標與非目標

**目標**：在設計階段，以本 repo 正式轉檔產出的 USDC 為幾何來源，模擬戶外風環境與室內自然通風／熱對流，把結果疊回 Kit 3D 檢視，並保留可追溯的模擬紀錄，供方案比較。

**非目標（本輪不做）**：

- 法規或綠建築標章的正式計算書：需要基準驗證與網格收斂測試，另案處理。
- 全年逐時能耗模擬（EnergyPlus 類）：現有樣本缺少空間邊界資料（見 §3）。
- 在 Omniverse 內解算流場：Omniverse Flow 是視覺特效，不作工程判斷。
- AI 代理模型（PhysicsNeMo）：列為第三階段，需先累積真實求解結果。
- 修改後端凍結面（`docs-plans-README.md` §3 第 4 點列出的檔案）。

## 2. 技術定位

| 層 | 負責 | 選擇 |
|---|---|---|
| 幾何來源 | IFC 轉出的 USDC 與同次轉檔的 JSON 附屬檔 | 現有 `ifcopenshell_openusd_identity` 轉檔 |
| 幾何前處理 | 按 IFC 類別篩選、移除離群元件、包成封閉外殼、輸出 STL | 新增 |
| 求解 | 網格、RANS／浮力流求解、後處理 | OpenFOAM 官方容器（開源）；商用求解器列為待決 |
| 呈現 | 結果疊加、互動檢視 | Kit／OpenUSD |
| 紀錄 | 輸入、設定、版本、結果雜湊 | 存放位置待裁決（見 §4） |

NVIDIA 的 CFD 使用案例（見 §9）描述的流程是「CAD → 網格 → GPU 加速求解 → AI 代理模型 → Omniverse 視覺化」：求解器由合作的軟體廠商提供，Omniverse 負責視覺化與互動。本規劃採相同分工。該頁的加速倍數來自資料中心 GPU 與商用求解器，不能套用到本專案的開發機。

## 3. 現況查證（2026-09-17，唯讀）

**方法**：以 main `54a047e` 的 `IfcOpenUsdIdentityAuthor`（即 `ifc-usdc-reconversion.md` 所述的正式轉檔 profile），把開發機上一份真實公共建築 IFC 轉到暫存目錄，再用一次性腳本檢查網格與 IFC 內容。過程沒有修改 repo，也沒有上傳資料。樣本與產物不入版控；本 repo 公開，所以本節不記錄專案名稱、座標、檔名或構件識別碼。

本節的行號都指 `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/` 下的檔案。

| 項目 | 結果 | 對 CFD 的影響 |
|---|---|---|
| 轉檔 | IFC4、約 52 MB、長度單位 cm；37 秒完成；6,816 個有幾何的元件轉出 6,770 個，約 52 萬個三角面 | 可直接使用 |
| 座標與識別 | 公尺、Z 軸朝上（`ifc_openusd_identity_author.py:171`）；元件位於 `/World/Elements/<IfcClass>/G_<GlobalId>`，帶 `bim:ifc_guid`、`bim:ifc_type` customData（`:212`） | 可按類別篩選，結果可用 GlobalId 回查 |
| 建物尺寸 | 平面約 70 × 60 m，高約 23 m | 決定計算域大小 |
| 封閉實體 | 6,308／6,770（93%）：牆 369／375、窗 158／158、樓板 79／90、帷幕框料與面板幾乎全部 | 外殼大致可用 |
| 不封閉 | 462 個：門 68／68、燈具 198／198、樓梯 15／16、欄杆 51／62 等；另有 13,754 個退化三角形 | 排除或簡化 |
| 牆上開口 | 157／158 扇窗、68／68 扇門的中心不在牆體實體內；IFC 沒有 `IfcOpeningElement`、`IfcRelVoidsElement` | 洞口已在牆體幾何中，自然通風可行；1 扇窗與牆重疊需確認 |
| 室內空間 | `IfcSpace` 92 個，86 個有幾何，其中 83 個封閉；沒有面積或體積數量集 | 可作為室內空氣體積的起點 |
| 離群元件 | 至少一支梁距主體 100 m 以上 | 不排除會把計算域放大數倍 |
| 方位與定位 | 真北為預設值；9 個 `IfcSite` 只有 1 個有經緯度，且看起來與專案所在行政區不一致；**轉檔器的 `geo_reference.json` 固定輸出 `available: false`**，不讀 IFC 定位資料（`ifc_openusd_identity_author.py:477`、`:556`） | 風向無法可靠對應，列為 P0 前置 |
| 熱性質 | 牆、窗、屋頂、樓板、門、帷幕都沒有 U 值；100 種材料都沒有導熱係數 | 熱邊界條件需另外提供 |
| 通風與能耗資料 | 窗戶沒有開啟方式；沒有 `IfcRelSpaceBoundary` | 可開窗面積需另外提供；不能直接接 EnergyPlus |
| 樓層 | 921 個 `IfcBuildingStorey`，名稱大量重複 | 不影響幾何，但不能依樓層切分 |

**結論**：幾何可以用。方位、熱性質、可開窗是資料缺口。前處理、求解、結果回寫與模擬紀錄是能力缺口，repo 內目前完全沒有。開發機沒有安裝 OpenFOAM，但有 Docker 與 WSL Ubuntu 24.04。

## 4. 目標架構

```text
IFC ─(現有轉檔)→ model.usdc + JSON 附屬檔 ─────────────→ Kit 檢視（現有）
                        │ GET /artifacts/{job_id}/{filename}         ▲
                        ▼                                            │
       CFD worker（新）：前處理 → OpenFOAM → 結果轉 USD ─────────────┘
                        │                            結果圖層（不改原 USDC）
                        ▼
                模擬紀錄（存放位置待裁決）
```

| 元件 | 負責 | 不得成為 |
|---|---|---|
| CFD worker（新，暫名） | 幾何前處理、產生案例、執行求解器、結果轉 USD | 對外入口、Kit renderer、治理權威 |
| `bim-review-coordinator` | 對外 API、工作排程、權限 | 求解器 |
| `bim-streaming-server` | 提供 USDC 與附屬檔（既有路由，`host_native_conversion_service.py:144`）；Kit 載入結果圖層 | CFD 執行者 |
| `governance-service` | 候選：保存模擬紀錄 | 求解器 |
| `web-viewer-sample` | 參數輸入、結果圖層開關、色階 | 直接呼叫 CFD worker |

- 新增服務、紀錄存放位置與新 API，都必須先修改設計正本 §01／§04 與 `docs/agents/repository-boundaries.md`，**由 owner 裁決後才能實作**。
- CFD 與 Kit 不共用 GPU。開發機的 RTX 4060 Ti 只有 8 GB，保留給 Kit 串流；求解走 CPU。

## 5. 資料流與契約草案

### 5.1 輸入

同一次成功轉檔的 `model.usdc`、`element_mapping.json`、`pset_index.json`、`spatial_index.json`、`bbox_index.json`、`geo_reference.json`。沿用 `ifc-usdc-reconversion.md` 的「來源與產物不可混用」：模擬紀錄必須綁定轉檔 job 與 `model.usdc` 的 SHA-256。

### 5.2 幾何前處理 profile（版本化）

| Profile | 保留 | 排除 | 處理 |
|---|---|---|---|
| `exterior-wind/v1` | 牆、樓板、屋頂、帷幕（`IfcPlate`、`IfcMember`）、窗（視為關閉）、柱、梁 | 門、燈具、家具、衛浴、`IfcFlowTerminal`、欄杆、`IfcSpace`、`IfcGrid` | 移除離群元件 → 以 OpenVDB 體素（解析度從 5–10 cm 起試）包成單一封閉外殼 → STL |
| `interior-ventilation/v1`（第二階段） | `IfcSpace` 空氣體積、門洞口、窗（依可開窗資訊決定開或關） | 門扇（洞口視為開啟）、燈具幾何（位置改作熱源）、家具、衛浴、`IfcFlowTerminal`、欄杆、`IfcGrid` | 以封閉的 `IfcSpace` 與洞口組成室內空氣域，空間之間經門洞連通 |

- 採用包覆，是因為帷幕由 4,320 支框料和 882 片面板組成，逐一解析縫隙會讓網格數量暴增，而外部風場不需要這個細節。
- 每次前處理都輸出**剔除清單**（GlobalId、類別、原因），可審查、可重現。
- 離群判定規則（例如距主體外框超過 N 倍建物高度）寫進 profile，不能每次手動挑選。

### 5.3 案例參數

- 風：16 個風向、參考高度與風速、地況粗糙度、氣象檔（EPW）。
- 定位：真北角度與其來源、基地位置、周邊建物（GIS）。
- 熱（第二階段）：表面溫度或 U 值；人員、燈具與設備發熱；日射。
- 計算域依 COST 732：入流、側向與頂部距建物 ≥ 5H，出流 ≥ 15H，阻塞比 < 3%（H 為建物高度）。

### 5.4 求解

- 使用 OpenFOAM 官方容器，映像以 digest 鎖定。
- 戶外：穩態 RANS（realizable k-ε 或 k-ω SST）。
- 室內：Boussinesq 近似的浮力流。
- 實際 solver 名稱依選定的 OpenFOAM 發行版本決定。

### 5.5 輸出

| 結果 | USD 表示 |
|---|---|
| 行人高度（1.5 m）風速切面 | `UsdGeom.Mesh` 加 primvars |
| 流線 | `UsdGeom.BasisCurves` |
| 立面風壓 | 外殼 mesh 加 primvars |
| 室內速度與溫度場 | `UsdVol` 加 OpenVDB；Kit 的渲染支援在 P1 實測，不支援時先以切面與流線替代 |

結果寫成獨立 layer，放在轉檔已建立但目前空置的 `/World/Overlays` 之下（`ifc_openusd_identity_author.py:167`），例如 `/World/Overlays/Cfd/<run_id>`，不修改原 `model.usdc`。

### 5.6 模擬紀錄 `cfd-run-record/v1`（草案欄位）

`run_id`、來源轉檔 job 與 `model.usdc` SHA-256、前處理 profile 與版本、剔除清單參照、網格統計（格數與品質指標）、求解器映像 digest、紊流模型、邊界條件、氣象檔雜湊、真北角度與其來源、收斂殘差、輸出檔 SHA-256、建立時間與操作者。

## 6. 分期與驗收

### P0 資料前置（可平行進行）

- [x] P0.1 轉檔器讀取 IFC 定位資料（`IfcMapConversion`、`IfcSite`、`TrueNorth`）寫入 `geo_reference.json`；缺值時維持 `available: false`，不得推算。附 `bim-streaming-server` 單元測試。（2026-09-21：`ifc_geo_reference.py`，format_version 2；見 §6.1）
- [ ] P0.2 向設計單位取得真北角度、基地位置、周邊建物、可開窗資訊、U 值與空調設計。

### P1 本機概念驗證（離線、不接產品 UI）

- [x] P1.1 前處理腳本與測試：類別篩選、離群移除，包覆後外殼封閉（邊界邊為 0）。（2026-09-21 補：體素邊界面在建構上必然封閉，「邊界邊為 0」不能證明包住建物；驗收改看 `sealing_*` 洩漏指標，見 §6.1）
- [x] P1.2 OpenFOAM 容器以粗網格跑一個風向，殘差收斂。
- [x] P1.3 結果轉 USD；以包裝 stage（sublayer 原 `model.usdc` 與結果 layer）在本機 Kit 真實載入，保留 first frame、Stage 與結果圖層的截圖。
- [x] P1.4 產出完整的 `cfd-run-record/v1`。

驗收：四項都要有本輪真實證據；靜態檔案、測試替身或歷史紀錄不算通過。

#### 6.1 2026-09-21 P0.1／P1 實測紀錄

工具：`tools/cfd/`（`bimcfd` 套件，純 numpy＋pxr，不接任何 service 或 A1–A10）。證據：`docs/evidence/cfd-p1-poc-2026-09-21/`（已去除本機路徑、構件 GlobalId 與基地座標；IFC、USDC、STL、OpenFOAM 產物留在本機不入版控）。

| 項目 | 本輪結果 |
|---|---|
| 來源 | MinIO 經 ifc-ready intake 下載到 `storage/ifc-cache/` 的同一份 52 MB IFC（SHA-256 `8fe7efdb…`），以 worktree 版 `IfcOpenUsdIdentityAuthor` 轉檔 36.5 秒，6,770 元件 |
| P0.1 | 該 IFC 無 `IfcMapConversion`／`IfcProjectedCRS`，`TrueNorth` 為預設 (0,1)，9 個 `IfcSite` 只有 1 個有經緯度 → `available: false`，warnings `geo_reference_missing`、`true_north_default_direction`，site 經緯度與高程照實記錄。streaming 測試 213 通過（新增 16 項） |
| P1.1 | profile `exterior-wind/v1`：剔除 454（類別）＋39（離群）→ 留 6,277 元件、164,195 三角形；0.5 m 體素、閉合半徑 2 → 外殼 109,796 三角形，邊界邊 0，25 條非流形邊，另有 1 個 17,655 體素的孤島被丟棄。外殼 bbox 176 × 175 × 26 m，比 §3 估的 70 × 60 大：基地上有與主體相連的附屬結構，需在 P2 決定是否納入。**自審後量測（同日）**：以閉合半徑 8 的包覆當密封參考，半徑 2 的保留體積 21,657 m³ 對參考 28,345 m³，短少約 23.6%＝外部空氣經寬於 2 m 的開口灌入室內；半徑 4（封到 4 m 開口）短少 7.4%。因此 profile 預設閉合半徑改 4，並以 `leak_fraction ≤ 0.10` 為驗收條件；本節 P1.2／P1.3 與 16 風向批次使用的是半徑 2 外殼，屬「室內部分被當成流域」的近似結果，見 §6.2 補跑 |
| P1.2 | 北風、Uref 5 m/s @10 m、z0 0.5。COST 732 計算域 636 × 978 × 138 m（側向邊距為滿足阻塞比 3% 自動加寬）；背景格 6 m、建物表面 2 級細化 → snappyHexMesh 511,100 格，checkMesh 最大非正交 64.3°、3 個高偏斜面（Failed 1 check，PoC 接受）。simpleFoam k-ω SST＋ABL 入流 **268 步達 residualControl 收斂**（p 5.9e-5、Ux 9.7e-7、k 7.5e-5），8 進程 132 秒。映像 `opencfd/openfoam-default:2412` digest `sha256:1ba02114…` |
| P1.3 | 1.5 m 行人面 22,466 面（\|U\| 0–2.92 m/s）、建物表面壓力 3,311 面（p −20.3～12.7）、30 條流線 17,995 點寫入 `/World/Overlays/Cfd/<run_id>`；包裝 stage sublayer `model.usdc`＋結果 layer。真 Kit 110.1（`ezplus.bim_review_stream.kit`，`--no-window`，RTX）開啟：prim 15,205、mesh 6,772，overlay 三個 prim 與 primvars 均被讀到，兩張截圖（`kit_first_frame_model.png`、`kit_cfd_overlay.png`）可見尾流與轉角加速區 |
| P1.4 | `run_record.json` 通過 schema 檢查：來源 USDC／8 個 sidecar／剔除清單／輸出 SHA-256、映像 digest、殘差、網格統計；`purpose: design_comparison_only` |

實測踩到的事實（已寫進工具）：ESI v2412 粗糙地面 nut 邊界為 `atmNutkWallFunction` 且需 `libs (atmosphericModels)`；`streamLine` 的 `formatOptions legacy` 只在求解 onEnd 路徑生效，獨立 `postProcess` 會寫 `.vtp`（工具兩種都能解析，但 `postProcess` 模式的軌跡只有 6 點，完整流線要在求解結束時寫）；容器 entrypoint 會切換工作目錄；Kit 無視窗渲染要在 session layer 補 dome＋distant light，否則截圖全黑；Docker Desktop 新建目錄後立刻掛載可能看到空目錄。

未做／限制：只跑 1 個風向、粗網格、無網格收斂測試、無 AIJ 比對；真北未知（TrueNorth 為預設值），風向相對 project north；行人面涵蓋整個計算域未裁切；`checkMesh` 有 1 項未過。以上都在 P2 範圍。

### P2 產品化（服務邊界裁決後）

- CFD worker、coordinator API、模擬紀錄存放、前端結果圖層與色階、Kit 圖層開關指令。
- 16 個風向批次、網格收斂測試、與 AIJ 基準案例比對。
- 室內自然通風與熱對流 profile。

### P3 AI 代理模型

- 以 P2 的求解結果訓練 PhysicsNeMo 代理模型，做換風向、開窗等即時預測。
- 需要開發機以外的 GPU 資源；預測結果必須標示為 AI 預測，並記錄與求解結果的誤差。

## 7. 資源估計（未實測）

- 計算域：以 H ≈ 23 m、平面約 70 × 60 m 估算，約 530 m 長、400–500 m 寬（視風向與阻塞比而定）、140 m 高。
- 網格：戶外 RANS 通常在數百萬到千萬格之間。
- 開發機（i5-13500 14 核、64 GB RAM）：單一風向以小時計，16 個風向以天計。
- 以上數字在 P1.2 實測後更新。

## 8. 風險與待決事項

| 編號 | 內容 | 處置 |
|---|---|---|
| R1 | 方位錯誤會讓所有風向的結果都錯 | P0 完成前不產出正式結果 |
| R2 | BIM 幾何瑕疵導致網格失敗或結果失真 | 剔除清單可審查；封閉性檢查納入測試 |
| R3 | 結果被當成法規或認證依據 | 介面與紀錄標示「設計比較用」 |
| R4 | 與 Kit 搶 CPU／GPU | 求解與 Kit 分機或分時執行 |
| R5 | 代理模型誤差 | 標示 AI 預測，持續與求解結果比對 |
| D1 | CFD worker 的名稱、邊界與部署位置 | 待 owner 裁決 |
| D2 | 求解器：OpenFOAM 或商用（Fluent、STAR-CCM+ 等） | 待決 |
| D3 | 優先情境：戶外風場或室內熱對流 | 建議先做戶外 |
| D4 | 精度目標：設計比較或正式計算書 | 建議先做設計比較 |
| D5 | 計算資源：開發機、canonical Linux 測試機或雲端 | 待決 |
| D6 | 模擬紀錄存放位置：`governance-service` 或新服務 | 待決 |

## 9. 參考

- NVIDIA，計算流體動力學模擬使用案例：<https://www.nvidia.com/zh-tw/use-cases/computational-fluid-dynamics-simulation/>
- Franke et al.（2007），COST Action 732：*Best Practice Guideline for the CFD Simulation of Flows in the Urban Environment*。
- Tominaga et al.（2008），*AIJ guidelines for practical applications of CFD to pedestrian wind environment around buildings*。
- 程式碼：`ifc_openusd_identity_author.py`、`host_native_conversion_service.py`、`conversion_authority.py`（目錄見 §3）。
- 相關規劃：`ifc-usdc-reconversion.md`。
