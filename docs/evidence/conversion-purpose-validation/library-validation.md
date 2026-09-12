# 第五刀：許良宇圖書館用途驗證

日期：2026-09-12。使用者指定代表 IFC，並委託撰寫用途與必要構件條件。本次驗收對象是轉換事實、用途判定與不可變歷史紀錄；模型判定不適用仍是有效驗證結果，不可把缺漏改成通過。

## 來源與重現條件

- 檔名：東勢區許良宇紀念圖書館_root_建築_24e598ab-be3d-4dbb-a1aa-60b0ba610618.ifc
- SHA256：8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce
- 大小 52,441,473 bytes；IFC4；model version 24e598ab-be3d-4dbb-a1aa-60b0ba610618；長度單位公分，scale 0.01 m。
- IfcOpenShell 0.8.5 / OpenUSD 0.26.5 / Windows Python 3.12；profile ifcopenshell_openusd_identity。直接讀專案 storage 內的既有檔案，不複製進 Git。
- 這是使用者本次指定的 52 MB 檔案，不借用歷史 89 MB 同名模型的 SHA、MinIO identity、Stage 或 GPU 證據。

重現時以 Ifc2UsdcPowershellConverterAdapter 的 storage_root 指向 IFC 所在 storage，ifc_artifact.host_local_path 指定既有檔案；job/event 使用上述 model version 與 profile，output_dir 指向全新隔離目錄。比對輸出 metadata.json 中 source_fingerprint、conversion_validation 及實際 model.usdc/element_mapping.json SHA。通過內部 fixed-origin metadata HTTP reader 後，以隔離 tenant_library_validation/project_library_validation 發布至獨立 ledger，重建 ConversionLedger 驗證 history/replay。驗證 runner、原始產物及完整紀錄保留在本任務 visualization 的 slice5-library-* evidence；未上傳 IFC/USDC。

## 用途與必要構件

四用途 scope id 為 xuliangyu-library-{purpose}，version 1。每個 scope 綁上述 source SHA/model version、隔離 tenant/project，requiredGuids 從來源 IFC 直接枚舉全部 6,816 個帶 Representation 的 IfcProduct，排序後保存。不可由成功 mapping、抽樣四個 GUID 或任意覆蓋率反推必要集合。1,181 個無 Representation 的 IfcProduct 逐 GUID 記為 non_renderable，不算轉換缺漏。

| 用途 | 用途說明與必要證據 | 本次結果 |
|---|---|---|
| view_3d | 全模型建築配置審閱的資料適用性；來源、有效 mesh、有限的座標 bounds、全體必要構件與缺漏 | not_usable：必要構件缺 46 筆 |
| locate_highlight | 全來源構件的 GUID 定位資料；要求每個必要 GUID 對到帶相同 identity 的真 mesh prim，並通過 bounds | not_usable：必要構件缺 46 筆；不是高亮 UI 驗收 |
| distance_measurement | 模型作為距離量測輸入；另須單位、正式參考距離與容差 | not_usable：必要構件缺漏；reference_measurement 同時保留 not_run |
| ifc_rules | 以來源 IFC 執行規則；必要 GUID 依來源存在，與 USD 完整度分開 | not_validated：IFC rule authority 尚未執行 |

此 scope 採保守的全來源條件。44 個 IfcGrid 仍在來源分母，不把它們悄悄排除來放行；日後若用途改為明確子集合，須新增 scope version 與新 record，舊結論不可覆寫。正式生產租戶、MinIO enrollment、法規合規及工程量測認證不在本次授權／證據範圍。

## 實測結果

- 來源 IfcProduct 7,997 筆；expected 6,816；converted correspondence 6,770；missing 46；無重複來源 GUID。
- 缺漏類別：IfcBeam 2/262，IfcGrid 44/44。梁 GUID 為 0Cb5UG7j57jAElGkTMXRsJ、3X4lUIqlrBc9ogFGm_ic5P；其餘 19 類別 expected/converted 相等。不能把未轉出原因推定成來源錯誤。
- 修正前解析測試中兩牆應相隔 5 m，USD 卻均落在 x=[-1,1]；漏寫 shape placement 已重現。修正後 x=[-1,1] 與 [4,6]，巢狀旋轉與公分單位測試通過。
- 逐 GUID 的獨立 source world AABB vs 實際 USD world vertices：6,770 筆比對，0 mismatch、0 unavailable；最大偏差 0.000005009585080983925 m（約 0.005 mm），判定容差 1 mm。
- 比對容差是轉換資料一致性標準，不採 IFC representation precision 當工程量測精度。AABB 相同不代表表面、拓撲或內部幾何完全相同，因此只給 pass_with_limits。
- 真 metadata 經 loopback HTTP、10秒/4MiB reader、SHA/scope binding 後落盤。約 1.21 MB metadata 在上限內；重啟仍保持同 record，重送 replay，metadata checksum 竄改與 tenant mismatch 拒絕。source scope SHA 漂移產生新 not_validated history，不重用舊結論。
- 本刀新增回歸：非零位移、巢狀旋轉、公分單位、local extent/root bbox、錯誤位移/尺度、未知 frame、reference 執行失敗、bounds schema 與保存結果一致性。

## 後續切片與限制

第六刀讀同一份 immutable record 提供授權報表／PDF／CSV，必須保留上述缺漏、限制及 not_run。第七刀接 IFC rule terminal result；第九刀驗高亮；第十一刀驗真 viewport 參考距離與容差。這份 CPU/metadata/ledger 證據不等同 first frame、Stage、DataChannel ACK 或 Viewer E2E；本刀未部署。

兩支梁與格線的轉換缺漏是本次已測出的產品限制。後續修復需保持來源分母、重新轉換並新增紀錄；不能透過修改本次 scope 或報表結論消除缺漏。
