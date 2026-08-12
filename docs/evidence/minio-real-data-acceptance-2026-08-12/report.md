# 真 MinIO IFC/RVT 資料最終驗收報告（2026-08-12）

驗收面：canonical Linux 測試部署（deploy tag `deploy-20260812-639221315101291265-002` → main `daf551e`；驗收當時 main tip `c5d423c`，部署與 tip 差距僅 openspec/streaming 修補，不影響本驗收路徑）。外部資料源：真實 MinIO（LAN `192.168.20.234:9000`）private bucket `bim-control`，內容為外部公司雲端實際上傳的 RVT bundle 與外部 IFC Worker 產出的衍生 IFC。

本報告不含任何憑證值；來源 key 只記錄物件 key 與 etag。

## Verified facts（本次 session 逐項實測）

1. **憑證供裝邊界**：`MINIO_WATCH_ACCESS_KEY` / `MINIO_WATCH_SECRET_KEY` 由 owner 親自填入部署機 runtime env（`.env.web-plane.host-kit`）；agent 全程只以 SET/EMPTY、長度、字元類別（CR／空白／非 ASCII）檢查欄位，未讀取值。
2. **compose 透傳與生效方式**：coordinator 容器 env 來自 `--env-file .env.web-plane.host-kit` 的 compose 內插；`docker compose … up -d coordinator`（recreate）後新值生效。單純 restart 不會重讀 env。
3. **watch 啟用**：`GET /api/external/minio-watch/status` 由 `enabled:false`（誠實 note：credentials 未完整）轉為 `enabled:true`、`last_error:null`。
4. **首輪自動觸發（0→12）**：首輪 tick `baseline_count=12`（規約 key `{專案}/root/{種類}/{UUID}/model.ifc`、含中文專案名），`triggered_total=12`、`skipped_malformed_total=0`、`last_triggered[].error` 全部 null。
5. **真實 key 結構**：實測 key 如 `測試建案0321/root/給水/677f85ca-…/model.ifc`、`洲際好宅/root/弱電-JJtest/4e3da869-…/model.ifc`；中文專案名經 `sanitizeArtifactIdPart` 轉出 `project_id`（例 `0321_6b258730`），原名保留於 `project_display_name`，種類（倒數第二層）保留於 `category`。
6. **真檔下載**：12 個來源 IFC 經 presigned GET 由 coordinator 下載至 `storage/ifc-cache/`，實測大小 51MB×5、65MB×2、100MB×2、157MB×3（合計約 1.06 GB）——為真實大型模型，非 fixture。
7. **轉檔閉環**：streaming 轉檔服務（`host-native-conversion-authority`，:49101）12/12 job `succeeded`、`stage=done`；coordinator ConversionLedger 12/12 `ready`（`detected→queued→converting→ready` 全走完）；`GET /api/conversion/records` count 由 0→12。
8. **產物真實性**：12/12 `model.usdc` 落盤（0.95MB–22.2MB）；artifact 目錄含完整 sidecar 族（element_mapping / entity_index / pset_index / spatial_index / bbox_index / geo_reference / metadata / quality_metrics）。
9. **mapping 誠實性（抽驗 `stream_conv_20260812124112_daf8f8b3`）**：`mapping_provenance="converter_verified"`、`mock=false`、`allow_fake_mapping=false`、`fake_mapping_count=0`、`mapping_fidelity="guid_exact"`、items=2639（首 20 筆抽樣見 `element-mapping-sample.json`，構件名為真實中文 MEP 內容）。轉換 profile `ifcopenshell_openusd_identity`。
10. **RVT 邊界（B 方案）正向**：bucket 內 RVT bundle（`model.rvt`＋elements.json/schedule.csv/geometries_chunks 等）與衍生 `model.ifc` 同版本資料夾共存；抽驗之轉檔紀錄即為 RVT 衍生鏈（同資料夾存在 `model.rvt`）——RVT→IFC 由外部 worker 完成、IFC→USDC 由本 data-plane 完成。
11. **RVT 邊界反向（負向測試）**：RVT-only 專案（`愛臻邸PPMS測試`、`東勢區許良宇紀念圖書館`——只有 `model.rvt`、無 `model.ifc`）**未**出現在 ConversionLedger；ledger 內無任何 `.rvt` key；watcher 未對 RVT 物件觸發 intake。data-plane 不越權、不假轉。
12. **冪等**：watcher 連續 8 輪 poll（`poll_count=8`），`seen_count=12`、`triggered_total` 維持 12——已觸發物件不重複觸發、不重複建 job。
13. **bucket census（資料夾視圖 BFS，各 root 上限 400 物件抽樣）**：頂層 7 資料夾；抽樣所見 16 個 `model.rvt`、10 個 `model.ifc`（watcher 全量 flat 權威計數為 12 個規約 `model.ifc`）；全 bucket flat list 總數 1680 物件。

## Inferences（由事實推得）

- 三個 ~22.23MB 的 USDC 與三個 157MB 來源 IFC 對應，應為同一模型的三個版本（`測試建案0321/root/建築` 兩版＋弱電），與 key 結構一致。
- `GET /api/minio/objects`（無 delimiter 的 flat list）於 1680 物件 bucket 靜默期實測 26.4s 完成（HTTP 200）；mass-intake 高峰（12 檔並行下載）期間同呼叫 30–45s 未回。production console 使用 delimiter=/ 資料夾視圖（單頁快回），不受影響。

## Unverified risks（誠實列出，本次未驗）

- **Kit GPU 視覺鏈未在本驗收內**：本次轉檔 profile 為 `ifcopenshell_openusd_identity`（CPU identity）；Kit GPU 真轉檔與 WebRTC 視覺 E2E 屬另一驗收面（2026-08-12 已於本機 GPU 與 #511 harness 另行實證）。本報告不宣稱 viewer 首幀／stage truth。
- **coverage_ratio=1 為自我參照指標**（source_count 恆等 mapped_count），不得解讀為「IFC 全實體覆蓋率」；獨立分母的真覆蓋率不在本驗收範圍。
- **live 新檔觸發（watch 運行中上傳新 model.ifc → 60s 內自動觸發）**未在本次觀測——本次觀測的是 enable 後首輪對既有 12 檔的 0→12 觸發（同一 tick 程式路徑）。如需補測：於 watch 運行中上傳一個新規約 key 的 `model.ifc` 後觀察 `triggered_total` +1。
- 部署機所用存取金鑰經 owner 填入，觀測其為**管理者等級帳號**（presigned URL 的公開 credential 欄位可見）；建議改建唯讀專用帳號並輪替現用金鑰。金鑰值不在本報告與 repo 任何檔案中。

## Next actions

1. （建議）owner 於 MinIO 建立唯讀 service account，替換部署機 env 內金鑰並輪替現用管理金鑰。
2. （可選）live 新檔觸發補測（上傳新 `model.ifc` → 觀測 `triggered_total` 遞增與新 record）。
3. （可選）viewer/A1 console 以資料夾視圖瀏覽 `bim-control` 並手動觸發任一 IFC 的 force retrigger，驗 UI 鏈。
4. 依 `verify-minio-real-data-e2e` skill（本 PR 一併落地）可隨時重跑本驗收。

## 附件

- `runtime-snapshot.json` — watch status／conversion records／streaming jobs 終態快照
- `element-mapping-sample.json` — 抽驗 mapping 首 20 筆＋fake 旗標＋quality_metrics
