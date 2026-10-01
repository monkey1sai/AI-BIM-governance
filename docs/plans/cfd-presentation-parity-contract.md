# CFD 呈現對齊（Presentation Parity）：契約草案與切片計畫

日期：2026-09-30。狀態：**草案——owner 已核可十項目標（2026-09-30）；§1 的 D3–D6、R0–R2 暫採建議預設，D1、D2 待 owner 裁決**。本檔是需求與契約正本的草案，不是 runtime 完成證據；payload 以 `tests/contracts/*.schema.json` 與 coordinator OpenAPI 為最高標準。
上游：`building-energy-cfd.md`（§5.5、§10）、`building-energy-cfd-p2-contract.md`（方向 A、R-A3）、`docs/architecture/pedestrian-wind-field-adr.md`。衝突時依序採用：使用者最新指令、根目錄 `AGENTS.md`、設計正本、本檔。

目標來源：一份顧問風場簡報的呈現方式——整區風速雲圖配向量箭頭與色階（平面）、上游種子簾釋出並逐漸長出的流線影片（近景）、建物剖面與樓層平面的風速雲圖配剖切位置小圖與氣流路徑箭頭。本檔只處理「呈現」與其所需的取樣；精度等級仍是 `screening`、用途仍是 `design_comparison_only`。

## 1. Owner 裁決

| 編號 | 內容 | 狀態 |
|---|---|---|
| 目標 1 | viewer 顯示東西南北方位（專案北羅盤） | 已核可；獨立 PR（分支 `feat/viewer-compass-cfd-framing`） |
| 目標 2 | 顯示疊圖後相機聚焦建物區域 | 已核可；同上 PR |
| 目標 3 | 流線像簡報影片：種子靠近建物、裁切、加粗、漸進生長、播放控制 | 已核可 → CP2、CP3 |
| 目標 4 | 3D 畫面內的圖例與風向箭頭；羅盤標出風的來向 | 已核可 → CP4、CP5 |
| 目標 5 | 行人面向量箭頭 | 已核可 → CP4 |
| 目標 6 | 多切面剖面／樓層平面風速雲圖，可切換，配正交視角與剖切位置示意 | 已核可 → CP8 |
| 目標 7 | 周遭建物量體納入計算與畫面 | 已核可；**待 D1** → CP9 |
| 目標 8 | 室內開窗通風 | 已核可；**待 D2** → CP10 |
| 目標 9 | 報告輸出：目前視角（含圖例、方位、風向）匯出圖片或短片 | 已核可 → CP6 |
| 目標 10 | 真北來源進 viewer，羅盤由專案北升級為真北 | 已核可 → CP7 |
| D1 周遭量體來源 | A 每次 run 手動量體方塊（≤50）／B 第二份 IFC 經 A3 federation／C GIS 匯入 | **待裁決**；建議 A（schema 預留 `meshes` 讓 B 之後接上） |
| D2 室內開窗資料與範圍 | A 外牆窗全開／B 手動開口清單（選 IfcWindow、IfcDoor GUID）／C IFC 可開啟性 | **待裁決**；建議 B，預算：單向、fast_preview 網格、格數上限不變 |
| D3 圖例與風向位置 | A 只在 viewer DOM HUD／B 只在場景 USD prim／C 風向箭頭在場景、圖例與羅盤在 HUD | 暫採 C |
| D4 匯出格式 | A 僅 PNG／B PNG＋最長 20 s WebM（瀏覽器端）／C Kit 伺服器端算圖 | 暫採 B |
| D5 切面何時選 | A 固定標準組／B 標準組＋送出時最多 8 個自訂切面／C 求解後再取樣（新 job 類型） | 暫採 B |
| D6 手動真北存哪 | A 只隨 run（套用手動真北的 run 疊圖時羅盤顯示真北）／B 每模型存 coordinator／C 只認 IFC | 暫採 A |
| R0 | 新增兩個 Kit 命令 `overlayVisibilityRequest`、`overlayPlaybackRequest`（P2 契約「Kit 無新命令」需 owner 放行，S5a 為前例） | 暫採同意 |
| R1 | 新增 coordinator browser 路由 `GET /api/conversions/{id}/geo-reference`（需同步設計正本 §04 卡與 `repository-boundaries.md`） | 暫採同意 |
| R2 | 新 run 的預設可見性：`StreamlineGrowth`、`PedestrianWindVectors`、`WindDirectionArrow` 顯示；`Streamlines`、`FlowParticles` 預設隱藏 | 暫採同意 |

「暫採」的項目在對應切片開工前 owner 可改；改動只影響尚未開工的切片。

## 2. 現況基準（main `e1c5bea`，讀自程式碼；其後 #985、#986 只改 busy 處理，不影響下表）

以下 `M` = `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging`，`V` = `web-viewer-sample/src`，`C` = `bim-review-coordinator/src`。

| 面向 | 現況 | 位置 |
|---|---|---|
| 流線種子 | 入口內 1 m、域寬 10–90%、行人高到 2.5H，8 列共 240 點；計算域上游 5H、下游 15H、側向與頂 5H | `M/cfd_pipeline/openfoam_case.py:48-62,586-596,677-710` |
| 流線寫入 | 單一線性 `BasisCurves`「Streamlines」，固定寬 0.5 m、逐頂點風速著色，**未裁切**；只解析第一個 track 檔 | `M/cfd_pipeline/usd_results.py:204-221`、`case_run.py:362-365` |
| 動畫 | 24 fps × 10 s、1,500 顆粒子沿流線平流，寫成時間取樣 `Points`「FlowParticles」與 `cfd:animation` | `flow_animation.py:23-103`、`usd_results.py:223-289` |
| 播放 | 疊圖合成時 Kit 直接播放 timeline；沒有暫停、速度、顯示切換命令 | `M/stage_loading.py:757-802`、`stage_management.py:128-152` |
| 圖例 | `cfd:legend` 逐字進 `directions[].legend`，只畫在 console 面板；3D 畫面內沒有 | `usd_results.py:156-161`、`V/console/unified/WindEnvironmentPanel.tsx:93-124,666-707` |
| 風向／真北 | 結果帶 `wind_from_degrees` 與 `assumptions`；實際採用的真北角只在 layer customData 與 run record | `case_run.py:381-386`、`M/cfd_job_service.py:824,868-888` |
| 向量 | 行人面 Mesh 帶每頂點 `U` primvar；沒有箭頭幾何 | `usd_results.py:179-181` |
| 切面 | controlDict 只有 1.5 m 行人面一個 `cuttingPlane` 加建物 patch；case 目錄保留 | `openfoam_case.py:655-674`、`case_run.py:357-361` |
| Kit 剖切與視角 | 單一軸向裁切面；預設視角加正交切換 | `M/section_plane.py:60-95`、`M/camera_view.py:33-45,122-141` |
| 周遭量體 | 只有一個外殼；核心盒 ±1H 外的構件被視為離群剔除 | `M/cfd_pipeline/preprocess.py:46-89`、`wind.py:65-113` |
| 室內 | 只有 `exterior-wind/v1`（窗視為關閉、閉合半徑 4）；請求 enum 只此一值 | `profiles.py:34-83`、`cfd_job_service.py:252-254` |
| 真北資料 | `geo_reference.json` 是轉檔的選用產物；browser API 沒有任何 geo 欄位 | `M/ifc_geo_reference.py:91-108,278-279` |
| 匯出 | viewer 沒有任何擷取（無 canvas、MediaRecorder）；iframe sandbox 無 `allow-downloads` | `V/AppStream.tsx:370-372`、`V/console/EmbeddedViewer.tsx:248-250` |
| 已知異常 | S3.1 證據中 240 個種子只得到 30 條曲線，原因未查 | `docs/evidence/cfd-s3-1-2026-09-21/overlay/postprocess_summary.json` |

## 3. 設計不變式

1. **單一 layer**：新幾何都寫進既有的每風向 layer `<run>_<wNNN>.usdc`、同一個 run prim 之下；`/cfd-artifacts` 白名單與 stage binding 不變。
2. **可切換的 prim 都是 run prim 的直接子項**（維持 `overlay_style.py` 的路徑假設與一層深的清除）。
3. **顯示與隱藏都寫明確 opinion**（`inherited`／`invisible`），只寫 session layer，重新合成疊圖時清除；artifact 永不被改寫，讀回值才是證據。
4. **呈現參數不進設定目錄**：是 `CaseParams` 欄位，預設值保持今日輸出；CLI、batch、converge、AIJ 不受影響，golden hash 不變。
5. **契約只增不改**：舊結果、舊 ledger、舊 layer 仍可驗證與顯示；缺新 prim 時對應控制不出現或停用並說明，不是錯誤。
6. **誠實標示不變**：所有動畫 prim 與面板常駐「示意動畫，基於穩態解；非瞬態模擬」；穿過建物的戶外剖面標「建物內部為實體（外部風場，未模擬室內）」；HUD 頁尾常駐「設計比較用 · {validation_level}」。

## 4. 契約

### 4.1 疊圖 layer（`cfd:presentation`，version 2）

| Prim（run prim 直接子項） | role | 新 run 預設 | 來源切片 |
|---|---|---|---|
| `PedestrianWind_1p5m` | `plane` | 顯示 | 既有 |
| `BuildingSurfacePressure` | `surface_pressure` | 顯示 | 既有 |
| `Streamlines` | `streamlines` | 隱藏（R2） | 既有，CP3 改為裁切＋加粗 |
| `FlowParticles` | `particles` | 隱藏（R2） | 既有 |
| `StreamlineGrowth/Seg_NNN` | `streamline_growth` | 顯示 | CP3 |
| `PedestrianWindVectors` | `vectors` | 顯示 | CP4 |
| `WindDirectionArrow` | `wind_arrow` | 顯示 | CP4 |
| `Section_<id>`、`Section_<id>_Vectors` | `section`、`section_vectors` | 隱藏 | CP8 |
| `ContextMassing` | `context` | 顯示 | CP9（待 D1） |

CP1 P5 的呈現上限：流線 **240 條×每條最多 200 點**、生長 **48 段**、粒子 **3,000 顆（240 幀）**、向量 **5,000 支**、切面 **13 個（5 標準＋8 自訂）**。合成場景將全部上限加行人面／壓力殼一起合成，layer **23,418,101 bytes**，暖 Kit 合成到擷取 **1.250 s**，相對空疊圖基準多 **0.186 s**。目標仍為 layer 約 ≤25 MB、附加開啟時間 ≤5 s；真實網格的頂點數與壓力殼大小仍需控制，數量上限不保證任意模型同樣大小或效能。方法、三個大小的掃描與限制見 [CP1 P5 證據](../evidence/cfd-presentation-probes-2026-09-30/README.md#p5-上限cp3cp4cp8)。

### 4.2 `cfd-run-result/v1` 新增欄位（選填）

- `directions[].presentation`：`version`、`prims[{name, role, default_visible, quantity}]`、`animation{fps, frames, growth_seconds, note}`、`sections[{id, axis, position_m, label, source: standard|requested, polygons}]`、`building_footprint_xy`（模型座標、凸包、≤64 點）。CP3 一次落地完整結構，後續切片只填值。
- `wind_frame`：`directions_relative_to: project_north|true_north`、`true_north_degrees_used`、`true_north_source: geo_reference|manual|unknown`（CP5）。
- 同步：`C/contract/schemas/cfd.ts` → `npm run contract:emit` → `npm run generate:api-types`。

### 4.3 Kit 命令（R0）

- `overlayVisibilityRequest{items[1..32]{prim_path, visible}}` → `overlayVisibilityResult{items[{prim_path, visible, present}]}`；`prim_path` 規則同 `overlayStyleRequest`。
- `overlayPlaybackRequest{action: play|pause|restart|set_rate, rate?: 0.25–4}` → `{playing, rate, time_seconds}`；疊圖 layer 沒有 `cfd:animation` 時拒絕。
- 兩者 `mutates: true`、加入 `commandRejected` 列舉；宣告在 `tests/contracts/kit-datachannel-v1.schema.json`，以 `npm run generate:kit-command-vocabulary` 產生三份產物。重新合成疊圖時速度回 1×。

### 4.4 Viewer Embed Protocol（vg01）

- parent → viewer：`overlay_hud{hud|null}`（CP5）；`capture_view{clientRequestId, format: png|webm, seconds?, restartPlayback?}`（CP6）。
- viewer → parent：`capture_result{clientRequestId, status, blob?, mime?, width?, height?, durationMs?, reason?}`。存檔由最上層 console 以 object URL 完成，iframe sandbox 不變。

### 4.5 Coordinator 路由（R1）

`GET /api/conversions/{conversionJobId}/geo-reference` → `GeoReferenceSummary{conversion_job_id, available, true_north:{degrees|null, source|null, status: reliable|default_direction|missing}, grid_north_degrees}`。只讀取並分類 `geo_reference.json`，不做其他計算；錯誤碼比照 quality-metrics（404／502／503）。

### 4.6 請求新增

- `sampling.sections[]`（D5=B，≤8，軸向 x／y／z＋模型座標位置）：手寫在 `cfd-run-request-v1.schema.json`，不是 `x-cfd-setting`；超出計算域或超過數量回 400；記入 ledger origin；不影響估算。
- `context.massing[]`（待 D1）、開口清單（待 D2）。

## 5. 規範條文

**流線與播放（目標 3）**
- N3.1 新的 service run 由建物上游的種子簾出發：求解座標 x = bbox_min.x − 0.5H，寬度涵蓋建物寬加兩側各 0.25W，高度自行人高到 1.2H，8 × 30 點，bbox 內不放種子。
- N3.2 寫入的流線裁切到 bbox ±3H（XY）與頂 +1H，離開處切斷，少於 2 點的片段丟棄。
- N3.3 管寬 = `clamp(0.005 × footprint, 0.3, 1.2)` m。
- N3.4 `StreamlineGrowth` 依行進時間在 `growth_seconds`（預設 6 s）內逐段顯現，置於既有 240 幀循環內；CP1 P1 已通過，採 **分段 prim 的時間取樣 `visibility`（invisible → inherited）**。P1 停在第一個可行方案；時間取樣寬度未測，不作選型依據。
- N3.5 播放、暫停、重播、速度（0.25–4×）只經 `overlayPlaybackRequest`；UI 只顯示 Kit 讀回值。
- N3.6 面板只在 `presentation.prims` 列出對應 role 時提供該顯示模式；沒有 `presentation` 的舊結果維持舊控制。

**圖例與風向（目標 4）**
- N4.1 HUD 模型只由結果文件建立（圖例逐字、`wind_from_degrees`、`wind_frame` 或 assumptions、`validation_level`、`purpose`、run 與方向標籤），在疊圖 `applied` 且 Kit 確認載入後送出，隱藏、換 run 或 iframe 重載時清除。
- N4.2 色條使用與 `usd_results.colormap` 相同的五段色階與圖例的 min／max／單位，不寫死常數；壓力色條只在 `BuildingSurfacePressure` 讀回為顯示時出現。
- N4.3 羅盤上的風向箭頭指向風的來向；除非 frame 是 `true_north`，一律標「相對 project north」。角度換算以共用案例檔 `tests/contracts/wind-bearing-cases-v1.json` 同時釘住 Python 與 TypeScript。
- N4.4 新 layer 帶場景內的 `WindDirectionArrow`（D3=C），Kit 端擷取也看得到風向。
- N4.5 HUD 不攔截指標輸入。

**向量（目標 5）**
- N5.1 `PedestrianWindVectors`：格距 = max(2 m, 範圍／60)；長度 = 0.9 × 格距 × min(|U|／圖例上限, 1)；|U| < 0.05 m/s 不畫；最多 5,000 支；位於行人面上方 0.05 m；方向為模型座標的 U。
- N5.2 行人面與切面共用同一個箭頭產生器。

**剖面與平面（目標 6）**
- N6.1 切面只取模型 X、Y、Z 軸向，配既有預設視角加正交投影即為正剖面／平面；色階沿用圖例的 U 範圍。
- N6.2 標準組：Z 於 0.25H、0.5H、0.75H，加通過 footprint 形心的 X、Y 面；另加請求的自訂切面（D5）。
- N6.3 「剖面檢視」是一個宣告的序列，每一步的 Kit 讀回都顯示，部分失敗如實回報：(1) 顯示該切面與其向量、隱藏行人面與流線；(2) `section_plane` 於切面位置（向相機偏 0.05 m）；(3) `camera_view`（z→top、y→front/back、x→left/right）；(4) 正交投影。「離開」還原先前狀態。
- N6.4 HUD 的剖切位置小圖畫出 `building_footprint_xy`、切線或樓高與北向。

**匯出（目標 9）**
- N9.1 由 console 發起；iframe 以畫面上同一個 HUD 繪製器把目前影像幀（原生解析度）與 HUD 合成後回傳 Blob。
- N9.2 PNG 為單幀；WebM 為 1–20 s、30 fps、VP9 退 VP8；失敗回報錯誤，不產生半成品。
- N9.3 每份匯出都帶 HUD 頁尾（用途、validation_level、run 短碼、風向、北向基準、UTC 時間）；檔名 `cfd_<run 尾碼>_<wNNN>_<UTC>.<ext>`，不含模型或專案名稱。
- N9.4 匯出只在本機：不上傳、不存伺服器。

**真北（目標 10）**
- N10.1 羅盤只在以下情況顯示真北：(a) IFC 真北狀態為 `reliable`，或 (b) 目前套用的疊圖 `wind_frame.true_north_source` 為 `manual`。其餘維持「專案北（真北未知）」。這是 P2 契約 R-A3 與 `building-energy-cfd.md` §10.1 的放行條件。
- N10.2 顯示 run 疊圖時，HUD 使用該 run 的 `true_north_degrees_used`，不混用來源；來源標「IFC」或「手動」。

## 6. 切片

| 切片 | 目標 | Outcome | 前置 | 完成條件與證據 |
|---|---|---|---|---|
| CP0 | 全部 | 本契約文件與 owner 裁決 | — | 本檔合併 |
| 方位＋聚焦 | 1、2 | 專案北羅盤 HUD；疊圖合成後框取建物外殼 | — | 獨立 PR；181 真站截圖 |
| CP1 | 3–6、9 | Kit／RTX 與瀏覽器探針（只有工具與證據）：P1 流線生長、P2 箭頭、P3 場景內風向箭頭、P4 多切面、P5 上限、P6 瀏覽器擷取、P7 timeline 速度 | CP0 | `docs/evidence/cfd-presentation-probes-<date>/`，每個探針有通過／未通過判定；結果寫回 §4.1 上限與 N3.4 技術選擇 |
| CP2 | 3、6 | 兩個 Kit 命令；面板的圖層開關與播放／暫停／速度 | 方位＋聚焦已合併、P7 | 各服務測試綠；181 用既有 run 疊圖切換與變速（不需新 run），Kit 讀回與截圖 |
| CP3 | 3 | 種子簾靠近建物、裁切、加粗、漸進生長；`presentation` 區塊 | CP2、P1 | `tools/cfd` 與 streaming 測試綠、golden hash 不變；181 一次 fast_preview 0° run；查明 30／240 異常 |
| CP4 | 5、4 | 行人面向量箭頭與場景內風向箭頭（只改後處理） | CP2、CP3 之後（同檔） | 箭頭方向對四個風向與兩個真北值的單元測試；181 俯視正交截圖 |
| CP5 | 4 | viewer 內 HUD：圖例、羅盤上的風向、頁尾；結果 `wind_frame` | 方位＋聚焦已合併 | 共用案例檔雙邊測試綠；181 既有 run 截圖 |
| CP6 | 9 | PNG 與 WebM 匯出 | CP5、P6 | 擷取單元測試；owner Chrome 實際匯出一張圖與一段片 |
| CP7 | 10 | geo-reference 路由；羅盤真北模式 | CP5 | 路由與契約測試綠、設計正本與 boundaries 同步；181：無真北模型顯示專案北 |
| CP8 | 6 | 標準＋自訂切面、切換、剖面檢視序列、剖切位置小圖 | CP2、CP4、CP5、P4／P5 | 181 一次含兩個自訂切面的 run；剖面檢視與匯出截圖 |
| CP9 | 7 | 周遭量體納入計算與畫面 | D1、CP3 | 依 D1 另訂 |
| CP10 | 8 | 室內開窗通風（開口資料與 profile → 網格與求解 → 室內切面與氣流路徑） | D2、CP8 | 依 D2 另訂；先出估算（格數、耗時）再決定是否求解 |

順序理由：CP2 解開所有呈現控制，且可用既有疊圖驗證；CP3、CP4 依序改 `usd_results.py`，各需一次 181 run；CP5–CP7 依序改同一個 viewer HUD；CP8 依賴前面全部。求解中的 run 不部署（部署的 CFD run guard 會擋，且部署會重啟 Kit）。

## 7. 風險與待確認

- **CP1 P1 PASS（CP3）**：分段 prim＋時間取樣 visibility 可漸進生長；回到起點的 capture 有 RTX 殘影，持續時間未測。時間取樣 widths 未在 Kit 測試。
- **CP1 P2 PASS（CP4）**：PointInstancer 逐實例 displayColor 與 merged mesh 的擷取差 0.00–0.02%，layer 小約 7 倍；合成 Mesh 的非 constant displayColor 需 displayOpacity 的發現，與 181 多色壓力殼仍待對照，動產品 writer 前釐清。
- **CP1 P3 PARTIAL（CP4）**：0°／90°／225° 俯視的風向位置與指向正確，iso 的上游箭頭可能被建物擋住；深色箭頭未測，CP4 需補俯視／iso 驗證。
- **CP1 P4 PASS（CP8）**：五個 session 切面可獨立切換與透明交疊，復原差 0.0051%；刪除 visibility opinion 曾使 RTX 殘留面，必須遵守 §3 的明確 invisible opinion。
- **CP1 P5 PASS**：上限寫入 §4.1；合併候選 23.42 MB、暖 Kit 附加 0.186 s。單次合成量測，不保證其他 GPU／真實網格或冷啟動相同。
- **CP1 P6 PASS（CP6）**：合成 MediaStream 原生 1280×720 PNG＋HUD、VP9／VP8 約 3 秒 WebM 成功；產品 iframe／WebRTC／下載仍需真站驗證。
- **CP1 P7 PASS（CP2）**：變速採 session `subLayerOffsets` 的 `Sdf.LayerOffset(0,1/rate)`，配合 end/current time；0.25×／4×／1×、各速度循環、暫停／恢復／重播均已量測，artifact SHA-256 不變。timeline TCPS 變速無效且會改 root opinion，不採用。完整結果見 [CP1 證據](../evidence/cfd-presentation-probes-2026-09-30/README.md)。
- **已知錯誤：套用 CFD 後與 session 模型不符（2026-09-30，owner 回報）**：在既有 review session 的風環境面板直接按「顯示疊圖」，owner 觀察到疊圖中的建物與原 session 模型明顯不同。尚未獨立重現，原因與受影響範圍未確認；需核對 run source、primary artifact、stage-binding 與 Kit 讀回，不能先認定是模型綁定或後處理幾何錯誤。原始截圖與指定 Chrome 重現入口只存於本機私有交接紀錄；尚未修復。
- **headless Kit 與串流 Kit 的差異**：探針用離線擷取工具，181 串流端可能不同；每個切片都要在 181 真站再驗一次。
- **Kit 剛重啟回 `busy` 時 viewer 不送開檔請求**（2026-09-30 真站實測）：已由 PR #985（viewer）與 #986（Kit）修正並合併，181 尚未部署；部署後要補「重啟 Kit 後第一次 attach 即首幀且 stage 相符」的真站證據。
- **層檔大小與開啟時間**：分段生長 prim、多切面會放大 layer；P5 記錄開啟時間與檔案大小，超標則減少段數或切面數。
- **室內通風的成本未實測**：0.3–0.5 m 格距下單向可能達數百萬到上千萬格、181 上數小時；CP10 第一步只做估算。
- **周遭量體是資料缺口**：目前沒有鄰棟資料來源，D1 決定前 CP9 不開工。
- **R-A3 放行**：專案北羅盤不違反「不顯示真北方位」；真北模式以 N10.1 為唯一放行條件。
- **PUBLIC repo**：證據不寫真實專案名稱；匯出檔名不含模型或專案名稱。

## 8. 驗證命令

- `cd tools/cfd; ..\..\.venv\Scripts\python.exe -m pytest tests -q`
- streaming：`.venv\Scripts\python.exe -m pytest bim-streaming-server/tests/test_overlay_style.py bim-streaming-server/tests/test_cfd_job_service.py bim-streaming-server/tests/test_cfd_openfoam_runner.py bim-streaming-server/tests/test_stage_loading_stage_composition.py -q`
- root：`.venv\Scripts\python.exe -m pytest tests/test_cfd_contracts.py tests/test_kit_command_vocabulary_contract.py tests/test_runtime_command_contracts.py -q`
- coordinator：`npm run contract:emit && npm run contract:check && npm test`
- viewer：`npm run generate:kit-command-vocabulary -- --check && npm run generate:api-types && npm test && npm run typecheck`
- Kit 離線探針：`tools/cfd/kit/open_stage_capture_and_quit.py`（CP1 擴充）。
- 181：`scripts/dev/rebuild-test-deploy.ps1 -Build`（freshly fetched `origin/main`）→ 一次 fast_preview run → owner 的 Chrome 操作與截圖，證據去識別化。

## 9. 回滾

每個切片以 revert 該 PR 回滾。契約只增不改，舊 layer 與舊結果持續可用；新 Kit 命令與新路由移除後，面板對應控制依 N3.6 自動不出現。
