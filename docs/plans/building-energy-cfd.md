# 建築能效 CFD（風場／熱對流）：IFC → USDC → CFD 規劃

日期：2026-09-17；2026-09-21 更新 §6 進度；2026-09-23 更新為 P2 收尾狀態。狀態：**P0.1、P1 完成；P2 戶外風場完成並在 181 真站驗證，精度等級 `screening`，只作設計比較；P0.2、室內通風與熱對流、P3 未動工**。剩餘工作的前置與完成條件見 §10。P2 契約與逐切片證據在 `building-energy-cfd-p2-contract.md`；依 D1 不新增服務，介面寫在設計正本 §04 `c4-cfd-api` 卡與 `docs/agents/repository-boundaries.md`。本檔不是 runtime 完成證據，證據以各 `docs/evidence/cfd-*` 目錄為準。
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
| 幾何前處理 | 按 IFC 類別篩選、移除離群元件、包成封閉外殼、輸出 STL | 已實作：`cfd_pipeline/preprocess.py`，profile `exterior-wind/v1` |
| 求解 | 網格、RANS／浮力流求解、後處理 | OpenFOAM v2412 官方容器，digest 鎖定（D2）；浮力流未實作 |
| 呈現 | 結果疊加、互動檢視 | Kit／OpenUSD |
| 紀錄 | 輸入、設定、版本、結果雜湊 | streaming CFD job store 的 `run_record.json` 為權威，coordinator ledger 存指標（D6） |

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

**後續**：本節是 2026-09-17 的查證快照，數字不回頭改。`geo_reference.json` 已由 P0.1 改為讀取 IFC 定位資料；前處理、求解、結果回寫與模擬紀錄已由 P1、P2 補齊（§6）；方位、熱性質、可開窗仍是資料缺口（§10.1）。

## 4. 架構（P2 已落地）

```text
瀏覽器（統一工作台「風環境」面板）
  │ REST :8004
  ▼
coordinator：/api/cfd/*、綁定 model.usdc 雜湊、run ledger、overlay binding
  ├─ 超門檻風向 ──▶ governance 既有 /api/issues（存為 annotation）
  │ loopback :49101
  ▼
streaming CFD job service（同時 1 個 run）：前處理 → OpenFOAM 容器 → 結果轉 USD → run record（權威）
  │ /cfd-artifacts：每個風向一個結果 layer，不改原 model.usdc
  ▼
Kit：既有 stage-binding＋loadArtifactGroupRequest 載入；overlayStyleRequest 調行人面透明度
```

| 元件 | 負責 | 不得成為 |
|---|---|---|
| `bim-streaming-server` CFD job service（`cfd_job_service.py`＋`cfd_pipeline/`，:49101 loopback） | 幾何前處理、產生案例、執行 OpenFOAM 容器、結果轉 USD、run record 權威、`/cfd-artifacts` 下載 | 對外入口、治理權威 |
| `bim-review-coordinator` | 瀏覽器唯一入口 `/api/cfd/*`：綁定來源雜湊、run ledger、overlay binding、超門檻風向轉 issue | 求解器、run record 權威 |
| Kit | 以既有 `loadArtifactGroupRequest` 載入結果 layer；S5a `overlayStyleRequest` 調透明度 | CFD 執行者 |
| `governance-service` | 經既有 `/api/issues` 收 CFD finding（annotation，不綁 `ifc_guid`） | 模擬紀錄存放、求解器；不為 CFD 新增路由 |
| `web-viewer-sample` | 風環境面板：選模型、風向、U_ref、看進度、疊圖開關、色階、透明度、finding；Issue Center「CFD」篩選 | 直接呼叫 :49101 |

- 新增服務、紀錄存放位置與新 API，須先改設計正本 §01／§04 與 `docs/agents/repository-boundaries.md`，經 owner 裁決後才實作。P2 照此執行：D1–D6 裁決見 §8，介面在設計正本 §04 `c4-cfd-api` 卡；S5a 的 Kit 命令與 S6 的 findings 路由晚到 2026-09-23 才補進該卡。之後新增 API（例如 §10.3 的設定選項端點）同樣適用。
- 求解走 CPU。181 上與 Kit 同機分時：`CFD_N_PROCS=4`，求解容器 `--cpus 4`；R-A1 實測求解期間 Kit 串流不退化（§6.3）。開發機的 RTX 4060 Ti 8 GB 仍只給 Kit。

## 5. 資料流與契約（P2 已實作）

以下保留原草案，並在各小節末尾標註實作現況；payload 以 `tests/contracts/cfd-run-*-v1.schema.json` 為準。

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
- 實作現況：`exterior-wind/v1` 已上線。服務預設體素 0.5 m（numpy 體素，不是表中草案的 OpenVDB 5–10 cm）、閉合半徑 4、`leak_fraction_limit` 0.15，相連附屬結構納入外殼（R-A2）。`interior-ventilation/v1` 未實作（§10.4）。

### 5.3 案例參數

- 風：16 個風向、參考高度與風速、地況粗糙度、氣象檔（EPW）。
- 定位：真北角度與其來源、基地位置、周邊建物（GIS）。
- 熱（第二階段）：表面溫度或 U 值；人員、燈具與設備發熱；日射。
- 計算域依 COST 732：入流、側向與頂部距建物 ≥ 5H，出流 ≥ 15H，阻塞比 < 3%（H 為建物高度）。
- 實作現況：面板可選 1–16 個風向與 U_ref；z_ref 10 m、z0 0.5 m、真北來源 `geo_reference` 由面板固定送出。API 另接受手動真北（`true_north_source: manual`）與網格、求解參數，面板都未開放，改用服務預設。計算域照 COST 732 實作，側向依阻塞比自動加寬。EPW 氣象檔、周邊建物與熱參數未實作。

### 5.4 求解

- 使用 OpenFOAM 官方容器，映像以 digest 鎖定。
- 戶外：穩態 RANS（realizable k-ε 或 k-ω SST）。
- 室內：Boussinesq 近似的浮力流。
- 實際 solver 名稱依選定的 OpenFOAM 發行版本決定。
- 實作現況：戶外為 `simpleFoam` 穩態 RANS k-ω SST，入流用 ABL 剖面（`atmBoundaryLayerInlet*`），地面用 `atmNutkWallFunction`；未達 residualControl 時自動延長 endTime 一次（S5b-1）。室內浮力流未實作。

### 5.5 輸出

| 結果 | USD 表示 |
|---|---|
| 行人高度（1.5 m）風速切面 | `UsdGeom.Mesh` 加 primvars |
| 流線 | `UsdGeom.BasisCurves` |
| 立面風壓 | 外殼 mesh 加 primvars |
| 室內速度與溫度場 | `UsdVol` 加 OpenVDB；**S3.1 實測（2026-09-21，Kit 110.1.0+feature.293547，`omni.hydra.rtx`，`omni.volume 0.5.2` 內建 `openvdb` Python 綁定）**：以 Kit 內建 `openvdb` 寫 64³ 高斯密度 FOG grid（30 m、最大密度 6）為 `.vdb`，`UsdVol.Volume`＋`UsdVol.OpenVDBAsset` 不綁材質即可由 RTX 渲染為半透明密度霧（可見／隱藏兩張截圖差異 1.37% 像素、平均差 0.74）；密度 1 以下、10 m 的小 grid 只剩極淡痕跡（0.014% 像素），量測用途須配 `OmniVolumeDensity` 類材質與色階映射再評估。結論：渲染支援成立，室內場可走 UsdVol；本切片不產出熱流資料（P0.2 阻塞，見 §6）。探針：`tools/cfd/kit/probe_usdvol_openvdb.py`，證據 `docs/evidence/cfd-s3-1-2026-09-21/usdvol/` |
| 流動動畫（S3.1） | `UsdGeom.Points` 時間取樣（24 fps、10 s、預設 1500 粒子）沿穩態流線平流；layer `customLayerData["cfd:animation"]` 讓 Kit 端 `stage_loading` 自動設定 timeline 並循環播放；標示「示意動畫，基於穩態解」 |
| 行人面透明度（S5a） | Kit 110.1 RTX 不把 `primvars:displayOpacity` 畫成半透明；改由 Kit 在 session layer 為行人面綁 `UsdPreviewSurface`（`opacity` 可調），不改結果檔 |

結果寫成獨立 layer，每個風向一個（`<run_id>_<wNNN>.usdc`），放在轉檔已建立的 `/World/Overlays` 之下（`ifc_openusd_identity_author.py:167`）。run prim 為 `/World/Overlays/Cfd/<run_id>_<wNNN>`，`<wNNN>` 取自 overlay artifact id `cfd:<run_id>:<wNNN>`。本節原寫的 `/World/Overlays/Cfd/<run_id>` 少了風向標記；viewer 滑桿與 S6 finding 照這個路徑組 prim 而找不到，2026-09-23 真站驗證時發現，PR #905 已修正程式。不修改原 `model.usdc`。

### 5.6 模擬紀錄 `cfd-run-record/v1`（已實作）

`run_id`、來源轉檔 job 與 `model.usdc` SHA-256、前處理 profile 與版本、剔除清單參照、網格統計（格數與品質指標）、求解器映像 digest、紊流模型、邊界條件、氣象檔雜湊、真北角度與其來源、收斂殘差、輸出檔 SHA-256、建立時間與操作者。

實作後新增 `purpose: design_comparison_only`、`validation_level`（`screening`／`mesh_convergence_checked`／`benchmark_compared`，高於 `screening` 須附 evidence sha256）、`solver.end_time_effective` 與 `extended_once`。每個 run 一份，以 `directions[]` 分風向，存在 streaming job store 的 run 目錄（D6）。

## 6. 分期與驗收

### P0 資料前置（可平行進行）

- [x] P0.1 轉檔器讀取 IFC 定位資料（`IfcMapConversion`、`IfcSite`、`TrueNorth`）寫入 `geo_reference.json`；缺值時維持 `available: false`，不得推算。附 `bim-streaming-server` 單元測試。（2026-09-21：`ifc_geo_reference.py`，format_version 2；見 §6.1）
- [ ] P0.2 向設計單位取得真北角度、基地位置、周邊建物、可開窗資訊、U 值與空調設計。（2026-09-23：未動工；拆成可先做的抽取器與需對外取得的資料，見 §10.1）

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

未做／限制：粗網格、無網格收斂測試、無 AIJ 比對；真北未知（TrueNorth 為預設值），風向相對 project north；行人面涵蓋整個計算域未裁切；`checkMesh` 有 1 項未過。以上都在 P2 範圍。

#### 6.2 2026-09-21 補跑：閉合半徑 4 與 16 風向批次

證據：`docs/evidence/cfd-p1-poc-2026-09-21/r4/`（半徑 4 單方向）與 `batch16_r2/`（半徑 2 外殼的 16 方向批次彙總）。

| 項目 | 半徑 2（§6.1） | 半徑 4（本節，owner 指定） |
|---|---|---|
| 外殼 | 109,796 三角形；保留體積 21,657 m³ | 134,776 三角形；保留體積 26,188 m³；單一分量、5 條非流形邊 |
| 洩漏指標（參考半徑 8 = 4 m） | 短少 23.6% | **短少 12.0%，仍高於 10% 門檻，`sealing_suspect: true`**；owner 裁決照半徑 4 補跑並如實標記 |
| 網格 | 511,100 格 | 626,099 格；最大非正交 64.7°、3 個高偏斜面（Failed 1 check） |
| 求解（北風、5 m/s） | 268 步收斂 | 285 步收斂（endTime 600），8 進程 189 秒 |
| 1.5 m 行人面峰值 | 2.92 m/s | 3.58 m/s |
| 建物表面壓力 | −20.3～12.7 | −17.6～11.8 |
| Kit 載入 | 通過 | 通過：sublayer 兩層、prim 15,205、overlay 三個 prim（29,859／4,680／18,490 點），兩張截圖 |
| run record | 通過 | 通過；`case.assumptions` 帶 `true_north_default_direction` |

半徑 2 與半徑 4 的行人面峰值差 0.66 m/s，顯示外殼封閉程度直接影響結果，是 P2 前處理 profile 必須固定並驗證的參數。Kit 截圖顯示主體東側連著一條約 100 m 的線性結構（圍牆或步道頂），這就是 §6.1 所述使 bbox 達 176 m 的相連附屬結構；剩餘 12% 洩漏也包含雨遮、騎樓等真實半開放空間，不全是缺陷。

**16 風向批次（半徑 2 外殼，`bimcfd batch`，38.5 分鐘）**：16 個方向全部完成，11 個達 residualControl 收斂，5 個（45°、112.5°、135°、225°、315°）跑到 endTime 300 未收斂；1.5 m 行人面峰值 2.68（337.5°）～4.05 m/s（135°）。網格數隨方向在 186,761～559,772 格之間變動，因為計算域與細化盒依旋轉後的 bbox 決定；S5 網格收斂測試前要固定細化策略。批次結果只作工具驗證與趨勢參考，不作設計比較依據（外殼洩漏 23.6%）。

### P2 產品化（2026-09-21～23）

契約、owner 裁決與各切片 DoD 在 `building-energy-cfd-p2-contract.md`。

- [x] CFD worker、coordinator API、模擬紀錄存放、前端結果圖層與色階、Kit 圖層開關指令。
- [x] 16 個風向批次、網格收斂測試、與 AIJ 基準案例比對：三項都已實跑；網格只證明峰值收斂，AIJ 比對未通過（見下表）。
- [ ] 室內自然通風與熱對流 profile：未動工，受 P0.2 阻塞（§10.4）。

| 項目 | 結果 | PR | 證據（`docs/evidence/`） |
|---|---|---|---|
| streaming CFD job service | 完成：建立、查詢、取消、下載；同時只跑 1 個 run | S1 #887、S1.1 #889 | `cfd-s1-2026-09-21/`、`cfd-s1-1-2026-09-21/` |
| coordinator API 與 run ledger | 完成：`/api/cfd/*`、來源雜湊綁定、overlay binding | S2 #888、S2.1 #890 | route 測試（無獨立證據目錄） |
| 前端結果圖層與色階 | 完成：風環境面板、固定色階圖例、管狀流線、粒子動畫 | S3 #891、S3.1 #892 | `cfd-s3-1-2026-09-21/` |
| Kit 圖層開關與透明度 | 完成：開關＝重送 stage-binding；透明度＝新 Kit 命令 `overlayStyleRequest`；prim 路徑 2026-09-23 修正 | S3 #891、S5a #894、#905、#906 | `cfd-s5a-2026-09-21/` |
| 181 部署與 16 風向批次 | 完成：16/16 residualControl 收斂，共 7.06 h | S4 #893、#902、#907 | `cfd-s4-2026-09-22/` |
| 網格收斂測試 | 峰值 `U_max` 收斂（等向盒 fine-grid GCI 1.9%）；面積加權平均與 p95 未收斂 | S5b-1 #895、S5b-2 #896、S5c #897 | `cfd-s5b-2026-09-22/`、`cfd-s5b2-2026-09-22/`、`cfd-s5c-2026-09-22/` |
| AIJ 基準比對 | **未通過**：Case C hit rate 38%，五個對照實驗最高 44%，門檻 66% | S5b-2 #896、S6 前置 #898、#899 | `cfd-s5b2-2026-09-22/`、`cfd-s6pre-2026-09-22/` |
| 超門檻風向轉 A1 issue | 完成：開 governance annotation，同條件不重開；Issue Center 可篩「CFD」 | S6 #901、#904 | `cfd-s6-2026-09-23/`、`cfd-issue-center-filter-2026-09-23/` |
| 風環境面板以模型為主體 | 完成：沒有 3D session 也能瀏覽與送出 | S7 #900 | `cfd-s7-2026-09-22/` |
| 求解期間 Kit 不退化（R-A1） | 通過，有限制（§6.3） | #903 | `cfd-ra1-2026-09-23/` |

驗收結論：P2 戶外風場的產品流程完成。結果精度只到 `validation_level: screening`，只能做設計方案之間的比較；要標 `benchmark_compared`，須先完成 §10.2。

#### 6.3 P2 的 181 真站驗證

| 日期 | 部署 | 方式 | 內容 | 證據 |
|---|---|---|---|---|
| 2026-09-22 | run 期間 `6f7f611` | 自動化真 Chrome（Playwright） | 16 向 run 完成；啟動 3D → N 0° 疊圖 → Kit 確認載入 → 10 秒錄影 | `cfd-s4-2026-09-22/` |
| 2026-09-22 | `bbb9d76` | 自動化真 Chrome（Playwright） | S7：沒有 session 時選模型、瀏覽 16 向結果、疊圖按鈕停用 | `cfd-s7-2026-09-22/` |
| 2026-09-23 | `f2905ba` | 自動化真 Chrome（Playwright） | S6：門檻 4.4 m/s 開 2 筆 annotation；再按一次不重開 | `cfd-s6-2026-09-23/` |
| 2026-09-23 | `f2905ba` | headless Chrome 量測，A-B-A 各 3 次 | R-A1：first frame 中位數 1238→1287 ms；ACK 最差 p95 40.6→43.9 ms；fps 中位數 59.3→55.4；0 斷線 | `cfd-ra1-2026-09-23/` |
| 2026-09-23 | `48f04db`、`1704bc8` | owner 看得到的 Chrome，逐步操作並截圖 | `48f04db`：Issue Center「CFD」篩選、S7 選模型、啟動 3D、N 0° 疊圖、S6 同條件不重開，並發現透明度滑桿失效。`1704bc8`（#905 修正後）：透明度 0.10、0.50 都由 Kit 回報已套用 | PR #905、#906 描述；截圖與錄影已在對話中交給 owner，未入版控 |

2026-09-23 起的 global 規則：部署後的真站驗證，只認在使用者看得到的 Chrome 逐步操作並附截圖；headless、request-routed 或本機 harness 只算輔助證據。前四列早於此規則，屬輔助證據。R-A1 的限制：每個條件 3 次、只驗 `CFD_N_PROCS=4`、ACK 只量唯讀 `camera_state`、前處理階段未量。

### P3 AI 代理模型（未動工）

- 以 P2 的求解結果訓練 PhysicsNeMo 代理模型，做換風向、開窗等即時預測。
- 需要開發機以外的 GPU 資源；預測結果必須標示為 AI 預測，並記錄與求解結果的誤差。
- 前置與完成條件見 §10.5。

## 7. 資源（實測）

2026-09-17 的原估：計算域約 530 × 400–500 × 140 m，數百萬到千萬格；開發機單一風向以小時計，16 個風向以天計。實測如下。

| 情境 | 機器 | 網格 | 耗時 |
|---|---|---|---|
| P1.2 單向（閉合半徑 2） | 開發機 i5-13500 14 核，8 進程 | 511,100 格，268 步收斂 | 132 s |
| P1 補跑（閉合半徑 4） | 開發機，8 進程 | 626,099 格，285 步收斂 | 189 s |
| P1 16 向批次（閉合半徑 2，endTime 300） | 開發機 | 每向 186,761–559,772 格 | 共 38.5 min |
| S5b-2 等向盒 3 m 層 | 開發機 | 4,455,873 格，延長後 640 步收斂 | 3,146 s |
| S6 前置 E4（AIJ 縮尺，背景格 1.5 m） | 開發機，8 進程 | 5,152,214 格，1,200 步未收斂 | 6,202 s |
| S4 16 向 service run | 181（20 核、RTX 5080），`CFD_N_PROCS=4` | 每向 1.25–3.41 M 格，436–571 步收斂 | 共 7.06 h，平均每向 26.5 min |

- 計算域比原估大。S4 模型 N 0° 的計算域約 664 × 1,136 × 138 m（流向 × 側向 × 高）：外殼含相連附屬結構（R-A2），側向又為了阻塞比 3% 自動加寬。背景格 3.85 m 由自動規則 `min(6, max(1.5, H/6))` 算出（H = 23.08 m），背景網格 173 × 296 × 36 格。
- 181 上 16 個風向約需一個工作天；求解期間不必停 Kit（R-A1）。
- 細網格的成本推估見 §10.2。

## 8. 風險與裁決

| 編號 | 內容 | 處置與現況（2026-09-23） |
|---|---|---|
| R1 | 方位錯誤會讓所有風向的結果都錯 | **未解除**：結果都帶真北假設（相對 project north），UI 不顯示羅盤方位。API 已能收手動真北，解除條件見 §10.1 |
| R2 | BIM 幾何瑕疵導致網格失敗或結果失真 | 剔除清單可經 API 取得；每次量外殼洩漏率，超過門檻 0.15 標 `sealing_suspect`。S4 模型洩漏 12.0% |
| R3 | 結果被當成法規或認證依據 | 已落實：API 回應、USD customData、run record、面板與 A1 issue 文字都標 `design_comparison_only` 與 `validation_level` |
| R4 | 與 Kit 搶 CPU／GPU | 同機分時，R-A1 實測通過；限制見 §6.3 |
| R5 | 代理模型誤差 | P3 未動工 |
| D1 | CFD worker 的名稱、邊界與部署位置 | **已裁決（2026-09-21）**：不新增服務；CFD job 是 streaming host-native conversion service（:49101）的新 job 類型，瀏覽器只經 coordinator `/api/cfd/*` |
| D2 | 求解器：OpenFOAM 或商用（Fluent、STAR-CCM+ 等） | **已裁決**：OpenFOAM v2412 官方容器，digest 鎖定；不做商用求解器 |
| D3 | 優先情境：戶外風場或室內熱對流 | **已裁決**：戶外先做，已完成；室內待 P0.2（§10.4） |
| D4 | 精度目標：設計比較或正式計算書 | **已裁決**：設計比較。實測等級 `screening`；正式計算書仍是非目標 |
| D5 | 計算資源：開發機、canonical Linux 測試機或雲端 | **已裁決**：canonical Linux 181 的 CPU，與 Kit 分時；`CFD_N_PROCS` 預設 4 |
| D6 | 模擬紀錄存放位置：`governance-service` 或新服務 | **已裁決（C-1）**：run record 權威留在 streaming CFD job store；coordinator ledger 存指標與 finding；governance 只收 finding |

裁決出處：`building-energy-cfd-p2-contract.md` §1。

## 9. 參考

- NVIDIA，計算流體動力學模擬使用案例：<https://www.nvidia.com/zh-tw/use-cases/computational-fluid-dynamics-simulation/>
- Franke et al.（2007），COST Action 732：*Best Practice Guideline for the CFD Simulation of Flows in the Urban Environment*。
- Tominaga et al.（2008），*AIJ guidelines for practical applications of CFD to pedestrian wind environment around buildings*。
- AIJ 都市風環境 Case C 資料集：Zenodo `10.5281/zenodo.15401792`（CC BY 4.0；資料只放本機，不入版控）。
- Celik et al.（2008），網格收斂指數（GCI）的估計與報告程序，ASME *Journal of Fluids Engineering*。
- 程式碼：`ifc_openusd_identity_author.py`、`host_native_conversion_service.py`、`conversion_authority.py`（目錄見 §3）。
- 相關規劃：`building-energy-cfd-p2-contract.md`（P2 契約與切片）、`ifc-usdc-reconversion.md`。

## 10. 剩餘工作與完成條件（2026-09-23）

| 項目 | 可否現在開始 | 主要前置 |
|---|---|---|
| 10.1 P0.2 資料前置 | 抽取器可以；資料要 owner 對外取得 | 帶屬性的真 IFC 或設計單位資料 |
| 10.2 精度：AIJ 基準與網格 | 可以，本機實驗 | 無 |
| 10.3 設定可調與服務預設 | 待 owner 選方向 | owner 對 2026-09-23 提案的裁決 |
| 10.4 室內自然通風與熱對流 | 否 | 10.1 |
| 10.5 P3 AI 代理模型 | 否 | GPU 資源與服務邊界裁決、10.2 |
| 10.6 已知小項 | 可以 | 無 |

### 10.1 P0.2 資料前置

- **現況**：測試 IFC 沒有 U 值、窗戶開啟方式與可靠的真北。P0.1 只讀定位資料，沒有抽取材質層與窗戶屬性。
- **可先做**：
  - 抽取器：讀 `IfcMaterialLayerSet` 與 `Pset_*Common.ThermalTransmittance`（U 值）、`IfcWindow.OperationType` 與 `Pset_WindowCommon`（可開窗、`IsExternal`）、開口面積，寫入轉檔附屬檔。缺值照實標 unavailable，不推算（同 P0.1）。
  - 面板開放手動真北：API 已接受 `true_north_source: manual`，結果會帶 `true_north_manual` 假設。
- **要 owner 對外取得**：真北角度、基地位置、周邊建物、可開窗資訊、U 值、空調設計。
- **完成條件**：抽取器附單元測試；一份帶上述屬性的真 IFC 抽取證據；真北有來源紀錄（IFC 或手動）後，UI 才可改顯示羅盤方位（R1 與契約 R-A3 的解除條件）。

### 10.2 精度：AIJ 基準與網格

- **現況**：峰值 `U_max` 已網格收斂（等向盒 fine-grid GCI 1.9%），平均場未收斂。AIJ Case C 基準 hit rate 38%。S6 前置顯示低估偏差的主因是網格：背景格為方塊邊長 1/5 時平均低估約 30%，1/10 時偏差消失；但 hit rate 仍只有 40%，殘餘缺口在逐點空間分佈。
- **候選做法**：換紊流模型（realizable k-ε；LES 成本高很多）、跑 AIJ 其他組態交叉檢查、細網格跑到 residualControl 收斂（基準與五個對照實驗跑到 1,200 步都未收斂）。
- **成本推估（未實測）**：若以建物高 H 類比 AIJ 方塊邊長，細到 H/10 時本模型背景格約 2.3 m，格數約為現行 3.85 m 的 4–5 倍；181 在 4 核下每個風向可能超過 2 小時。
- **完成條件**：在服務可用的網格設定下，AIJ hit rate ≥ 66%（COST 732 門檻）並附 evidence sha256，才可標 `benchmark_compared`。若 owner 決定 `screening` 就是本系統的最終等級，本項改為關閉，UI 維持現行標示。

### 10.3 設定可調與服務預設

- **現況**：面板只開放風向與 U_ref；網格、求解與真北用服務預設或固定值。服務預設背景格為自動規則 `min(6, max(1.5, H/6))`、等向精細盒、endTime 600、未收斂自動延長一次。
- **待裁決**：owner 2026-09-23 提出面板設定可調的提案，內容含預設組合、一般／進階／實驗參數、格數與時間估算、A／B／C 分階段；待選方向。
- **完成條件**：依選定方向另立契約。新增的 API 先改設計正本 §04 與 `repository-boundaries.md`；會改變網格或求解的預設組合，須附 golden 測試與 10.2 的收斂或基準證據，才能標為「已驗證」。

### 10.4 室內自然通風與熱對流 `interior-ventilation/v1`

- **前置**：10.1 的 U 值、可開窗資訊與內部發熱資料；Boussinesq 浮力流求解設定。
- **已具備**：83 個封閉 `IfcSpace` 可當空氣體積起點（§3）；UsdVol＋OpenVDB 可在 Kit 渲染（S3.1 探針），量測用途仍須配色階材質。
- **完成條件**：profile 與測試、一次真檔 run、Kit 顯示、run record 如實標示假設，並附 evidence。不以假資料做熱流。

### 10.5 P3 AI 代理模型（PhysicsNeMo）

- **前置**：
  - GPU 資源裁決：開發機 8 GB 只給 Kit；181 的 RTX 5080 與 Kit 同機。
  - 新 runtime 或服務的邊界：先改設計正本 §01／§04。
  - 訓練資料：目前只有 1 個模型、16 個風向的 service run，遠遠不夠。
  - 10.2 的精度等級：代理模型不會比它學習的求解結果更準。
- **完成條件**：owner 裁決資源與邊界後另立契約；預測結果標示為 AI 預測，並記錄與求解結果的誤差（R5）。

### 10.6 已知小項

- 面板 U_ref 上限 60 m/s，契約上限 40 m/s：輸入 40–60 會被 coordinator 以 400 拒絕。修法是面板上限改 40。
- S6 回覆的 `skipped_reason` 面板只計數，沒有逐項顯示（PR #906 自審 Low）。
- S6 路由的 ledger replay 排在 overlay 檢查之後；結果檔在 ready 後不再變動，目前不影響行為（PR #906 自審 Low）。
