> **Status: deferred 2026-07-21**（**使用者已採納**／NOW 軌0；原 #364 deferred-proposed 升格）。不計入 active WIP；解凍前不做實作。重啟時須先重驗 main 現況（#259 trigger、watcher ledger）再調和 tasks。

> **Historical correction 2026-07-24**：本 change 曾以 `--skip-specs` 誤作 completed archive；現依 deferred state model 恢復原 change id。#259／#265 與現行 source/tests 已落地 raw-folder、ledger auto-enroll、trigger 與 UI/E2E 的大部分行為，因此此 change 目前只允許 **frozen closeout reconciliation**：對帳 tasks、現行 code/tests 與 canonical specs，禁止重做既有 production code。完成 canonical delta 調和、affected tests 與 strict validation 前，仍為 non-canonical、non-owner。

## Why

部署中 console 對真實 `bim-control` bucket 暴露兩個與直覺不符、且使 NOT BUILT 文件背離現實的現象（live coordinator `:8004` 2026-06-24 實測）：

- **`#minio` 與真實 MinIO 不符**：`GET /api/minio/objects` 把 527 個物件遞迴攤平回傳、只認 `*/model.ifc` 規約做分組，導致 524 個幾何 `.json` 全落「(未知專案)」桶、6 個沒有 `model.ifc` 的專案連專案節點都不出現（真實 MinIO 瀏覽器只有 7 個乾淨專案資料夾）。`#254` 已把 `#minio` 偷接到真 bucket raw list，但接成「攤平＋只認 model.ifc」的壞掉版——這同時使 prototype HTML「真 S3/MinIO 三層待接 NOT BUILT」浮水印與 `#minio = local_fs 兩層樹` 的宣稱過時：功能已建（雖壞），文件仍掛 NOT BUILT＝說謊（誠實鐵律要求移除）。
- **`#conv` 看不出有沒有轉檔**：bucket 內既有 3 個 `model.ifc` 從未被轉檔（`baseline_count=3 / seen_count=3 / triggered_total=0`、ledger=0、ifc-ready=0）。原因是 by-design：watcher「首輪 SHALL 只登記 baseline 不觸發」（防既有大 bucket 爆量），但 UI 把擠在單一 Field 的 baseline/seen/triggered 混在一起，使用者無法判斷是「畫面壞掉」還是「真的沒轉」。

使用者 2026-06-24 拍板：① `#minio` 改走真 MinIO raw-folder 逐層導覽（像 MinIO 網頁一樣聰明）；② `geometries_chunks` 等末層摺成單一資料夾不攤開；③ 轉檔狀態以持久 ledger 為真相、`.ifc` 旁顯示狀態 chip ＋ 新增「一鍵觸發轉檔」按鈕；④ watcher tick 去重由 in-memory baseline 改為持久 ledger 去重（全自動 auto-enroll，既有未轉檔自動補轉、重啟不風暴）。本提案承載相應的規約 supersede 與三方文件同步。

設計來源：`docs/superpowers/specs/2026-06-24-minio-folderview-and-baseline-disclosure-design.md`（兩輪 ultracode ＋ 一輪 10-agent 交叉對抗，引用真偽 PASS）。

> **方向1 整合調和（2026-07-01，PR 前）**：本 change 開發期間，main 已並行合併 `minio-trigger-lifecycle-backend`（PR #259）——後端 `POST /api/conversion/trigger`（IP allowlist 守門、server-side presigned、inline 派工、回 `{ifc_ready_job_id}`）＋ `presignedRef`/`lifecycleStatus`。使用者拍板方向1：**本 change 的「觸發轉檔」鈕改用 main 已合併的 trigger 端點，不再自帶 x-dev-token 後端**。故原規劃的 `manualIntake.ts` + `conversion-trigger-route.test.ts` + `manual-intake.test.ts` 已移除；前端 `triggerConversion(key)` 直接呼叫 main 端點、chip 由 `loadRecords()` 依 ledger 對齊（不做樂觀 patch）。本 change 淨保留 main 未做、無競爭的部分：`#minio` 逐層資料夾導覽（`listMinioFolder`/`delimiter=/`）、watcher 持久 ledger auto-enroll、ledger 狀態 chip、`#conv` baseline 揭露。下方 What Changes / Tasks 的 trigger **後端**條目以此註記為準（描述原規劃，實作已交由 main #259）。

## What Changes

- **`minio-fileserver-source` `#/minio` requirement（MODIFIED）**：`#/minio` 的顯示來源由「`governanceClient.filesTree()` 的 local_fs 兩層樹」改為「coordinator `GET /api/minio/objects?prefix=…&delimiter=/` 的真 MinIO raw-folder 逐層 list」。主樹骨架＝raw-folder 逐層（CommonPrefixes 為資料夾、當層 Contents 為直屬檔），忠實鏡射 bucket 巢狀結構；頂層 7 個專案資料夾全部出現。三層「專案/種類/版本」語意由樹骨架降為「導到 `model.ifc` 葉層才掛的語意 badge」（`deriveIntakeFromKey`，≥3 段，**不改**）。`geometries_chunks` 等末層由 `Delimiter` 天然 roll-up 成單一可點擊資料夾、chunk 不入回應、不寫死物件數。四態誠實守門（loading/error/empty/populated、不寫死示意樹、不夾帶 presigned URL、頁首誠實字樣）保留並沿用至逐層導覽；empty 態須區分「MinIO 未設定」與「已設定但當前 prefix 無物件」兩種文案。`.ifc` 旁新增 ledger 衍生狀態 chip（值取自 `/api/conversion/records`，無紀錄誠實標『未轉(無 ledger 紀錄)』）與「觸發轉檔」鈕（打 main #259 已合併的 `POST /api/conversion/trigger`，IP allowlist 守門、server-side presigned、不外洩簽章）。**`minio-fileserver-source` `:6-8`（governance `GET /api/files/tree` local_fs API）與 `:69-95`（`#/a1` A1/A2 三層 binding SHALL）保留不動**——local_fs 不再當 `#minio` 顯示來源，但原地降格為 A1/A2 頁內檔案選擇器，API 與 binding 行為零變更。

- **`minio-watch-auto-intake` watcher 觸發判定（MODIFIED）**：watcher tick 的去重來源由 in-memory `seen` baseline（「首輪 SHALL 只登記 baseline 不觸發」）改為**持久 ledger 去重水印**——對每個 `*/model.ifc` 算 `idempotencyKeyFor(bucket,key,etag)`（=`mw_<hash16>`），查持久 ledger（`data/conversion-ledger.json`，atomic swap）：**ledger 無紀錄→觸發 intake（並落帳）；有紀錄→skip**。效果：既有未轉的 `model.ifc`（目前 ledger=0）下一輪 tick 自動觸發；新上傳自動觸發；coordinator 重啟重掃命中既有 ledger 紀錄→skip，只有真正新 key/新 etag（→新 `idkey`）才觸發（重啟不風暴，水印用既有持久 ledger、**非新建 watermark**）。`deriveIntakeFromKey` / `idempotencyKeyFor` / ledger schema **不改**，改的是 tick「要不要觸發」的判定來源。in-memory `seen` 可留作單輪快取，但權威去重以持久 ledger 為準。此 supersede「首輪 baseline SHALL NOT 觸發」語意為「ledger 無紀錄才觸發」，並推翻 closed-loop design 非目標「不新增手動插隊/優先序佇列 UI」（一鍵觸發鈕＝手動 intake 觸發、非佇列插隊）。

- **三方文件同步（同 PR）**：`docs/plans/ai-bim-governance-prototype.html` 移除「真 S3/MinIO 三層待接 NOT BUILT」浮水印與 local_fs 兩層樹渲染、改寫 `MinioPage` 為 raw-folder 逐層導覽 ＋ 葉層 badge；`docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md` §4.2 display_model 改記 raw-folder 逐層（無三層語意骨架）＋ 葉層 badge，非目標「不新增手動觸發 UI」標為被本 change supersede；`docs/superpowers/specs/2026-06-12-minio-watch-auto-intake-design.md` §2/§3/§7 註記「首掃 baseline 不觸發」已被本 change 的 ledger 去重 supersede。

## Impact

- Affected specs：`minio-fileserver-source`（MODIFIED：`#/minio` 顯示來源 local_fs→真 MinIO raw-folder 逐層、葉層 badge、狀態 chip、一鍵觸發鈕）；`minio-watch-auto-intake`（MODIFIED：watcher tick 去重 in-memory baseline→持久 ledger 去重、首輪不觸發語意改為 ledger 無紀錄才觸發、重啟不風暴靠持久 ledger）。
- 保留不動：`minio-fileserver-source` governance `GET /api/files/tree`（local_fs 兩層 API）與 `#/a1` A1/A2 binding SHALL；`deriveIntakeFromKey` 三段規約；ledger schema 與 `idempotencyKeyFor` 算法。
- Affected code：`bim-review-coordinator`（`minioClient.ts` 加 `listMinioFolder`＋`MinioObjectView` 加 `idempotency_key`、舊 `listMinioObjects` 簽名零改；`app.ts` `/api/minio/objects` additive 加 `delimiter` 參數、新增 `POST /api/conversion/trigger`；`manualIntake.ts` 新增 `triggerManualIntake`；`startMinioWatcher` tick 去重注入持久 ledger）；`web-viewer-sample`（`MinioDataPage` 逐層導覽＋狀態 chip＋觸發鈕、`ConversionSchedulingPage` baseline 揭露、`coordinatorClient` 加 `getMinioFolder`/`triggerConversion`）。
- 既有測試衝擊：後端 `listMinioObjects` 舊簽名 + 加 `listMinioFolder` → `minio-objects-route.test.ts` 零改、新增 folder/trigger 測試；watcher tick 去重改動會改既有 watcher 測試（baseline_count/首輪不觸發斷言）；前端 `MinioDataPage.test.tsx`（含原「不呼叫 getConversionRecords」改為會呼叫）/ `console.test.tsx` / `e2e/minio-closed-loop.spec.ts` 重寫斷言。watcher tick 去重屬非零 blast radius——實作前跑 GitNexus `impact({target:'startMinioWatcher'})`、commit 前 `detect_changes`，確認 blast radius 限於 tick dedup、未波及 intake/dispatch 下游。
- 不改 `bim-streaming-server` / MinIO server / viewer；零新 production dependency（`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 皆已裝）。
- userFacing：true（`#minio` 逐層導覽 ＋ `#conv` baseline 揭露 ＋ 一鍵觸發鈕須 browser E2E 截圖驗收；維持「無假 ready / ledger 不出現 ready / `#minio` 不出現假 parsed USDC」不變量）。
- 跨 surface 調和：`minio-fileserver-source` `:6-8`/`a2-version-diff-selector` 描述 bim-control 為兩層 `{projectId}/{modelId}`，指的是 governance-service 掃本機 `storage/` local_fs（dev fixture 270/889/990）；本 change `#/minio` 規範的是 watcher 同源的真實雲端 bim-control bucket（≥3 段、含動態中間層）——不同來源、不相矛盾。
- 風險：watcher tick 去重由 baseline 反轉為 ledger 去重屬契約變更（既有 baseline 斷言全升級、既有未轉檔下一輪自動補轉），須以「重啟 coordinator → ledger count 不暴增、無重複 job」與全 vitest 套件為回歸鎖。
