# 真 MinIO IFC/RVT 資料最終驗收報告（2026-08-12）

> Document type: **working note（歷史驗收紀錄，非權威）**。本檔記錄 2026-08-12 對特定部署 revision 的一次性驗收觀測；不是 runtime／API 行為的 authority，現況一律以 runtime code、executable tests 與活的部署為準。

驗收面：canonical Linux 測試部署（deploy tag `deploy-20260812-639221315101291265-002` → main `daf551e`；驗收當時 main tip `c5d423c`）。**部署 revision 與 tip 的版差裁決（file-level）**：streaming 側 delta 僅 #509（Kit 轉換器 timeout 之行程樹 containment）——`ifc_openusd_identity_author.py`（本次實際執行的 identity 轉換實作）在 `daf551e..c5d423c` 之間 **0 diff**；`ifc2usdc_powershell_adapter.py` 雖為傘狀模組（identity 亦由其分派），但版差 hunks 全部落在 pwsh/Kit 子行程路徑（模組頂 containment 輔助、constructor 增欄、`_build_converter_command`／`_run_powershell_conversion`／`_failure_diagnostics`），identity 分派區塊只以 diff context 出現、未被修改。殘餘誠實界限：constructor 增欄在任何 profile 的服務啟動時都會執行，本驗收未在 c5d423c 上重跑（可選 follow-up＝重新 canonical 部署後複跑 skill）。

外部資料源：真實 MinIO（LAN `192.168.20.234:9000`，此 endpoint 為 repo 內既有 example 值）private bucket `bim-control`，內容為外部公司雲端實際上傳的 RVT bundle 與外部 IFC Worker 產出的衍生 IFC。

本報告與附件不含任何憑證值。**Redaction 政策**：canonical 部署主機以 `<canonical-host>` 遮蔽（host/network 對映屬 repo-external inventory 契約）；附件內 UUID 一律截斷為前 8 碼；mapping 原始列（完整 GUID＋構件顯示名）自 tracked 附件撤下，僅留 provenance／旗標／彙總與 2 筆去識別樣本（完整資料留在部署主機 artifact）。來源物件的不可變身分綁定＝`idempotency_key`（`(bucket, key, etag)` 的 SHA 指紋，附件完整保留 12 筆）。

## Verified facts（本次 session 逐項實測）

1. **憑證供裝邊界**：`MINIO_WATCH_ACCESS_KEY` / `MINIO_WATCH_SECRET_KEY` 由 owner 親自填入部署機 runtime env（`.env.web-plane.host-kit`）；agent 全程只以 SET/EMPTY、長度、字元類別（CR／空白／非 ASCII）檢查欄位，未讀取值。
2. **compose 透傳與生效方式**：coordinator 容器 env 來自 `--env-file .env.web-plane.host-kit` 的 compose 內插；`docker compose … up -d coordinator`（recreate）後新值生效。單純 restart 不會重讀 env。
3. **watch 啟用**：`GET /api/external/minio-watch/status` 由 `enabled:false`（誠實 note：credentials 未完整）轉為 `enabled:true`、`last_error:null`。
4. **首輪自動觸發（0→12）**：首輪 tick `baseline_count=12`（規約 key `{專案}/root/{種類}/{UUID}/model.ifc`、含中文專案名），`triggered_total=12`、`skipped_malformed_total=0`、`last_triggered[].error` 全部 null。
5. **真實 key 結構**：實測 key 如 `測試建案0321/root/給水/677f85ca-…/model.ifc`、`洲際好宅/root/弱電-JJtest/4e3da869-…/model.ifc`；中文專案名經 `sanitizeArtifactIdPart` 轉出 `project_id`（例 `0321_6b258730`），原名保留於 `project_display_name`，種類（倒數第二層）保留於 `category`。
6. **真檔下載**：12 個來源 IFC 經 presigned GET 由 coordinator 下載至 `storage/ifc-cache/`，實測大小 51MB×5、65MB×2、100MB×2、157MB×3（合計約 1.06 GB）——為真實大型模型，非 fixture。
7. **轉檔閉環**：streaming 轉檔服務（`host-native-conversion-authority`，:49101）12/12 job `succeeded`、`stage=done`；coordinator ConversionLedger 12/12 `ready`（`detected→queued→converting→ready` 全走完）；`GET /api/conversion/records` count 由 0→12。
8. **產物真實性**：12/12 `model.usdc` 落盤（0.95MB–22.2MB）；artifact 目錄含完整 sidecar 族（element_mapping / entity_index / pset_index / spatial_index / bbox_index / geo_reference / metadata / quality_metrics）。
9. **mapping 誠實性（抽驗 `stream_conv_20260812124112_daf8f8b3`）**：`mapping_provenance="converter_verified"`、`mock=false`、`allow_fake_mapping=false`、`fake_mapping_count=0`、`mapping_fidelity="guid_exact"`、items=2639，構件名為真實中文 MEP 內容（tracked 附件僅留彙總與去識別樣本，見 `element-mapping-sample.json`）。轉換 profile `ifcopenshell_openusd_identity`。
10. **RVT 邊界（B 方案）觀測**：bucket 內 RVT bundle（`model.rvt`＋elements.json/schedule.csv/geometries_chunks 等）與 `model.ifc` 同版本資料夾共存，抽驗之轉檔紀錄所在資料夾同時存在 `model.rvt`。（該 IFC「由該 RVT 衍生」屬推論，見 Inferences——derivation 權威在外部雲，附件無 worker handoff 紀錄可稽。）
11. **RVT 邊界反向（負向測試）**：RVT-only 專案（`愛臻邸PPMS測試`、`東勢區許良宇紀念圖書館`——只有 `model.rvt`、無 `model.ifc`）**未**出現在 ConversionLedger；ledger 內無任何 `.rvt` key；watcher 未對 RVT 物件觸發 intake。data-plane 不越權、不假轉。
12. **同行程冪等**：watcher 連續 8 輪 poll（`poll_count=8`），`seen_count=12`、`triggered_total` 維持 12——同一 watcher 行程內（in-memory seen 快取）不重複觸發、不重複建 job。
13. **跨行程冪等（2026-08-13 補測，coordinator force-recreate 後首輪 tick 實測）**：重觸發 12 筆 intake POST（`triggered_total=12`），但 **streaming 端 job 數維持 12、零重轉**（新 ledger record `detected_at=2026-08-13T04:16` 綁回既有 job `stream_conv_20260812124112_…`）。同時暴露部署接線事實：coordinator 的 `conversion-ledger.json`／`callback-outbox.json` 預設落在容器內非掛載路徑（`<cwd>/data/`），**recreate 即蒸發**——`isLedgered` 水印因此在 recreate 後全 miss，最終擋住重轉的是 host-native streaming 的 request-fingerprint 冪等（三層去重的最深層）。已立案 issue #531。
14. **bucket census（資料夾視圖 BFS，各 root 上限 400 物件抽樣）**：頂層 7 資料夾；抽樣所見 16 個 `model.rvt`、10 個 `model.ifc`（watcher 全量 flat 權威計數為 12 個規約 `model.ifc`）；全 bucket flat list 總數 1680 物件。

## Inferences（由事實推得）

- **RVT→IFC 衍生鏈**：`model.ifc` 與 `model.rvt` 同版本資料夾共存符合 B 方案外部 worker 的產出慣例，據此推論該 IFC 由該 RVT 衍生；但同 key 佈局也可能由獨立上傳或 stale IFC 造成，附件無 worker handoff／version manifest 可資證明，故列為推論而非 verified fact。
- 三個 ~22.23MB 的 USDC 與三個 157MB 來源 IFC 對應，應為同一模型的三個版本（`測試建案0321/root/建築` 兩版＋弱電），與 key 結構一致。
- `GET /api/minio/objects`（無 delimiter 的 flat list）於 1680 物件 bucket 靜默期實測 26.4s 完成（HTTP 200）；mass-intake 高峰（12 檔並行下載）期間同呼叫 30–45s 未回。production console 使用 delimiter=/ 資料夾視圖（單頁快回），不受影響。

## Unverified risks（誠實列出，本次未驗）

- **Kit GPU 視覺鏈未在本驗收內**：本次轉檔 profile 為 `ifcopenshell_openusd_identity`（CPU identity）；Kit GPU 真轉檔與 WebRTC 視覺 E2E 屬另一驗收面（2026-08-12 已於本機 GPU 與 #511 harness 另行實證）。本報告不宣稱 viewer 首幀／stage truth。
- **coverage_ratio=1 為自我參照指標**（source_count 恆等 mapped_count），不得解讀為「IFC 全實體覆蓋率」；獨立分母的真覆蓋率不在本驗收範圍。
- **live 新檔觸發（watch 運行中上傳新 model.ifc → 60s 內自動觸發）**未在本次觀測——本次觀測的是 enable 後首輪對既有 12 檔的 0→12 觸發（同一 tick 程式路徑）。如需補測：於 watch 運行中上傳一個新規約 key 的 `model.ifc` 後觀察 `triggered_total` +1。
- 部署機所用存取金鑰經 owner 填入，觀測其為**管理者等級帳號**（presigned URL 的公開 credential 欄位可見）；建議改建唯讀專用帳號並輪替現用金鑰。金鑰值不在本報告與 repo 任何檔案中。

## Next actions

1. （建議）owner 於 MinIO 建立唯讀 service account，替換部署機 env 內金鑰並輪替現用管理金鑰。
2. **（已立案）coordinator 容器內 `data/` store（conversion-ledger／callback-outbox）非掛載、recreate 即蒸發**：ledger 水印 recreate 後全 miss，callback outbox 亦歸零（pending callback 有遺失風險）——canonical 部署 compose 應供給持久路徑（`CONVERSION_LEDGER_STORE_PATH`／`CALLBACK_OUTBOX_STORE_PATH` 指向掛載 volume）——issue #531。
3. （可選）以 `deploy-main-to-linux-test` 重新 canonical 部署 current main（含 #509）後複跑本 skill，完全退役「部署 revision 落後 tip」殘餘界限。
4. （可選）live 新檔觸發補測——**此為對 production bucket 的寫入，超出本驗收與 skill 的唯讀邊界，只能由 owner 自行決定並親自上傳**；上傳後觀測 `triggered_total` 遞增與新 record。
5. （可選）viewer/A1 console 以資料夾視圖瀏覽 `bim-control` 並手動觸發任一 IFC 的 force retrigger，驗 UI 鏈。
6. 依 `verify-minio-real-data-e2e` skill（本 PR 一併落地）可隨時重跑本驗收。

## 附件

- `runtime-snapshot.json` — watch status／conversion records／streaming jobs 終態快照（redacted：host 遮蔽、UUID 截斷；`idempotency_key` 完整保留作為 `(bucket, key, etag)` 不可變身分綁定）
- `element-mapping-sample.json` — 抽驗 mapping 的 provenance／fake 旗標／彙總＋2 筆去識別樣本＋quality_metrics 數值彙總（原始列撤下，完整資料在部署主機 artifact）
