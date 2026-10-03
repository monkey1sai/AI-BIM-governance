# 獨立地形幾何準備契約

本刀接續 [服務端地面來源核對](cfd-ground-service-assessment.md) 與
[相對地面取樣](cfd-ground-relative-sampling-contract.md)，提供獨立、來源綁定的地形候選。
它不接入 `CfdJobService`、`build_case`、網格或求解流程，也不變更既有結果。

## 解決的問題與邊界

目前 exterior-wind profile 排除 `IfcSite`；建築外殼會經體素包覆、閉合及最大連通分量處理。
地形不能直接混入這條建築簡化流程。新工具保留明選原三角面，獨立輸出
`terrain.stl` 與 `manifest.json`，供下一刀檢查計算域接合。

固定 `status: HELD`；`actual_ground_verified`、`coverage_verified`、
`fluid_region_verified`、`solver_started` 全為 `false`。
即使地形是單一連通面，也不代表覆蓋完整、可步行、有效流體或工程精度已確認。
本刀沒有 API、UI、環境變數或資料 migration 變更。

## 輸入與來源

使用獨立入口，避免載入通用 CLI 的求解流程：

```powershell
# 在 tools/cfd 執行；只使用已取得授權的本機模型與輸出路徑。
& '<repo>\.venv\Scripts\python.exe' -m bimcfd.terrain_geometry `
  --model-usdc '<source>\model.usdc' --model-sha256 '<64 lowercase hex>' `
  --selection '<work>\terrain-faces.json' --out '<work>\new-terrain-candidate'
```

選取檔沿用地面位置工具的來源面格式：

```json
{
  "model_usdc_sha256": "<64 lowercase hex>",
  "faces": [{
    "ifc_guid": "<IFC GUID>",
    "mesh_prim_path": "/World/Elements/IfcSite/<element>/<mesh>",
    "polygon_face_index": 0,
    "face_id": "<fresh face identity>",
    "geometry_sha256": "<fresh geometry hash>"
  }]
}
```

範例中的識別碼是佔位值；不能據此執行或繞過來源驗證。
工具透過既有 `read_ground_selection` 的私有快照重新讀取來源，驗證模型 SHA-256、GUID、
Mesh、原面序號及幾何雜湊；來源必須自包含、靜態、Z-up，單位與父變換只套用一次。
不支援的 polygon、USD hole、composition、動畫、非向上面均拒絕，不能扇形三角化替代。
subdivision 只保留來源聲明；輸出的是 authored triangle，不是 subdivision limit surface。

純函式 `prepare_terrain_geometry` 的 authority 為 `in_memory_source_face_identity`；
它驗證傳入幾何與身分，不能證明來源檔案仍存在或完整 metadata 來自該檔案。
CLI 完成快照讀取與最後來源 SHA 重核對後，才標記 `fresh_source_snapshot_face_identity`。
該聲明綁定當次快照；不保證之後磁碟來源不再變更。

## 幾何、拓撲與輸出

- 保留世界座標公尺制的原三角面；不移到全域地平面、不增加展示偏移、不轉成 solver frame。
- 依 `face_id` 排序，保留 `source_faces`、`triangle_to_face_id`、STL 位元組雜湊與選取檔雜湊。
- 鏡像或 USD handedness 造成原順序朝下時，只反轉 STL 面順序，記錄 `export_winding_reversed`；
  原座標、序號與來源雜湊保持原值。法向量及面積與原幾何不符即拒絕。
- 重複面／幾何、非流形邊／邊界、相鄰面方向不一致均拒絕。
- 用原 binary64 值的精確有理數 XY 判定，同時檢查來源與 STL：任何正面積重疊均拒絕，
  包含同高程重疊及多層地面；共用邊允許。沒有 snap tolerance。
- 連通分量、開放邊、外邊界與內孔逐項記錄；孔洞或不連通候選標示 `incomplete`，不補洞、
  不外插、不默選最高／最低層，也不刪掉較小分量。
- STL 使用 binary32；每座標最大誤差上限 `1e-5 m`，不同來源頂點不得量化成同一頂點，
  且量化後不能退化、反向或新增 XY 重疊。這是匯出保真上限，**不是 CFD 精度或網格尺寸**。

上限：100 個面、512 KiB 選取檔、512 MiB 模型私有快照、512 KiB manifest。
沿用來源 reader 的 mesh/selection scope 上限；重核對模型另讀最多 512 MiB。
100 個面最多比較 4,950 對三角面，來源與 STL 各一次。
這些是輸入與工作量上限，沒有提供正式模型的耗時、記憶體或 CFD 算力預算。

全部輸入與幾何檢查完成後，排他建立**新的**輸出資料夾；既有目錄一律拒絕，包含空目錄。
先寫 `terrain.stl`，最後寫 `manifest.json`。這不是多檔案原子交易；I/O 失敗可能留下新建的
不完整資料夾。缺失、破損或雜湊不符的 manifest／STL 不可採用；不自動刪檔或覆寫重試。

Exit 2 表示候選已建立但工程狀態仍為 `HELD`；exit 4 表示來源、幾何、預算或 I/O 拒絕。
錯誤訊息不回顯模型內容、原始檔案錯誤、私有路徑或憑證。

## 驗收與下一刀

本機測試涵蓋平面、斜坡、多高程、單位／旋轉／鏡像一次套用、孔洞、不連通、重疊、重複、
非流形、失效來源與匯出精度拒絕；以禁止 subprocess 的測試證明入口不啟動網格或求解。
既有 case golden tests 必須維持原樣。

正式模型的全地形候選仍須保留完整列舉範圍、排除理由及覆蓋證據，不能把兩個診斷面當完整地形。
下一刀再檢查 terrain/building 分流、共同座標旋轉、terrain wall 與 domain 接合、
`locationInMesh`、真實 wall boundary 與有效 fluid cells。
地形相對 1.5 m 的位置只有通過 fluid 檢查後，才能用於對應新算例的 U/p 取樣。

新正式模型處理、網格或求解前，須提出 CPU／RAM／磁碟／時間上限、停止與清理條件、
單次執行及重試數；不沿用已耗盡的舊探針預算。
