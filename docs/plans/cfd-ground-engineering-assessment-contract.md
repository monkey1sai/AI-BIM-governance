# 地面工程基準診斷：metadata 第一刀

本刀使用明選原面的本機 capture 與既有算例 metadata 診斷固定平面假設，不接 Viewer/API，不改 run、模型、邊界或既有結果。不讀 USD、polyMesh、U/p，不啟動新求解或後處理程序。

## 本刀輸入與使用

`ground-assess` 讀四份本機 JSON，每檔最多 2 MiB：

- `--selection`：既有 `ground-selection-preview/v1` 或 `ground-selection-version/v1` 的 capture。接受 preview 只供診斷，不能充當 coordinator 保存／人工核准。檢查 1–100 個原三角面、有限世界公尺頂點、向上單位法向及既有 face/geometry checksum，並沿 native `ground-selection/v1` 的 canonical JSON 公式重算 conversion/model SHA/region name/排序 face IDs 的 selection checksum；不重新乘 metersPerUnit。
- `--case-meta`：native `cfd-case/v1`，使用 `params.ground_z_m`、`uref_m_s`、`zref_m`、`z0_m`、`domain.zmin`、`pedestrian_plane_height_m`、`pedestrian_plane_z_m` 及 `wind.solver_rotation_alpha_rad`／`wind_vector_model_xy`。它是聲明資料，不證明 boundary files 或 mesh 的實際內容。
- `--result`：native `cfd-run-result/v1` 的 capture，讀 run ID、來源 conversion／model SHA、exclusions SHA 與 ready 狀態；不讀 artifact URL 或場資料。
- `--exclusions`：native `cfd-exclusion-list/v1`；比對原始檔位元組 SHA、來源 SHA 與明選 GUID 是否遭排除。最多 20,000 個 entry。

```powershell
cd tools/cfd
& <repo>/.venv/Scripts/python.exe -m bimcfd ground-assess `
  --selection <local>/selection.json --case-meta <local>/case_meta.json `
  --result <local>/result.json --exclusions <local>/exclusions.json `
  --out <new>/ground-assessment.json
```

CLI 對四個實際讀取的 byte snapshots 記錄 SHA；拒絕 duplicate JSON keys、NaN/Infinity、遞迴深度解析失敗、超量、非有限／布林 numeric、錯誤 face checksum、重複 face 及不可保留 +1.5m 的精度。輸出最多 512 KiB，exclusive-create，不覆寫任何輸入或舊報告。錯誤只印固定 error code，不回顯原路徑、輸入內容或未知欄位。

## 診斷與狀態

輸出 `cfd-ground-metadata-assessment/v1`：固定 `status=HELD`、`authority=local_metadata_capture_only`。即使所有已讀 metadata 相同，也不升級為工程通過。

- 比對 result 的 conversion/model SHA；缺少或不同記 `result_source_mismatch_or_unknown`。排除清單來源或 byte SHA 不符各自記原因。
- 記原頂點高程範圍及垂直加 1.5m 的目標範圍。舊平面差值為 `[plane−(maxZ+1.5), plane−(minZ+1.5)]`，不是採樣格點分布或風速误差；不把孔洞、多層面、曲面、行走性或地形範圍視為已驗證。
- `flat_ground_differs_from_selected_surface` 表示原面不符算例聲明的固定 ground；`selected_surface_elevation_varies` 表示原頂點 Z 範圍超過 1e-6m，不表示原面不共平面（斜三角面也有高程變化）。1e-6m 是 metadata 比對容差，不是工程／測量精度。
- 核對 domain zmin、plane=ground+height 及 height=1.5 的聲明一致性；入流值缺少／非正記原因，不自動補預設。Z 軸旋轉將聲明的單位來流向量變成 +X 才稱其內部相容；沒有讀 boundary files，不證明實際施加條件。
- 明選 GUID 在排除清單時記 `selected_component_excluded_from_preprocess`。未遭排除也不代表明選原面進入 voxel shell／mesh。

固定保留 fresh model、保存 ledger、情境／地面幾何連結、case／mesh／time 連結、boundary files、真地面及有效流體未驗的原因；`fresh_model_checked`、`inlet_boundary_files_checked`、`actual_ground_verified`、`fluid_region_verified`、`velocity_sampled`、`solver_started` 全部 false。不把 input 的 true flags 當核准。

exit **2**：有界診斷報告已寫出、仍 HELD；不是成功 CFD 驗收。exit **4**：結構、完整性、解析或 IO 失敗，沒有有效報告；IO 中斷可能留下新檔，非 exit 2 不使用，沒有自動重試。此命令沒有 exit 0 的工程成功路徑。

## 限制與下一刀

checksum 可偵測 capture 內部變化，不能建立檔案、selection ID、result 與 case 的真實性或 server authority。沒有情境／原面到計算 geometry 的證據鏈，不允許讀取風速。此報告不改變現有 API 或 UI 的就緒狀態，也沒有 runtime enforcement；不宣稱「已攔截產品套用」或「已修正 CFD」。

接續需將核定來源與工程 profile 綁到服務權威，取得完整 terrain／wall／inlet／mesh/time 與有效 fluid 證據，再做同條件比較；不能只把舊平面移低。新 mesh、U/p 重取樣或 solver 先列資源、分階段 wall caps、停止與重試界，取得新預算；不能重用已耗盡探針預算。
