## REMOVED Requirements

### Requirement: `#/minio` SHALL 顯示真實檔案庫樹（四態 + 可重試）

**Reason**: `#/minio` 顯示來源由 governance local_fs files-tree 改為真 MinIO raw-folder 逐層瀏覽（#265 落地、#303 IA 重塑）；由下方 ADDED Requirement 整體取代。local_fs `GET /api/files/tree` API 與 `#/a1` 選擇器等其餘 Requirement 不受影響。

## ADDED Requirements

### Requirement: `#/minio` SHALL 顯示真實 MinIO raw-folder 逐層瀏覽（四態 + 可重試）

`#/minio`（實作落點：`ModelDataPage` master-detail；#303 IA 合併後原 `MinioDataPage` 拆分為 `modelData/*` 元件組）SHALL 經 coordinator `GET /api/minio/objects?prefix=<層>&delimiter=/`（真 MinIO 唯讀 list proxy，S3 `Delimiter='/'`）取真實 bucket 的逐層資料夾結構並渲染，**取代**原「`governanceClient.filesTree()` 的 local_fs 兩層樹」顯示來源（local_fs `GET /api/files/tree` API 與 `#/a1` A1/A2 binding 保留不動，僅不再當 `#/minio` 顯示來源）。`delimiter` 參數 SHALL 白名單校驗（僅接受 `/`），非法值 SHALL 回 `400 invalid_delimiter`；`prefix` 含 CR/LF SHALL 拒絕。資料夾 list MAY 使用短期快取，但 SHALL 提供手動重新整理動作並誠實揭露快取/過時狀態，SHALL NOT 偽裝即時。

主樹骨架 SHALL 為 raw-folder 逐層：回應 `folders[]`（CommonPrefixes，每筆 `{ prefix, has_source_ifc }`，資料夾節點）為可點擊資料夾、當層 `objects`（Contents 直屬檔）為葉物件；點資料夾 SHALL 以該 prefix 重打一次 list（每層由使用者手動展開、換 prefix 才打下一次 list）。頂層 SHALL 出現全部專案資料夾（忠實鏡射 bucket 巢狀結構，SHALL NOT 把無 `model.ifc` 的專案藏掉、SHALL NOT 把非 `model.ifc` 物件歸入「(未知專案)」桶）。資料夾節點 SHALL 依 `localeCompare('zh-TW')` 重排（對中文使用者直覺，S3 回 CommonPrefixes 為 UTF-8 byte order）。`listMinioFolder` 對單層 list SHALL 處理 `IsTruncated`（while-loop 全拉，超 1000 子前綴/物件不截斷）。

三層「專案/種類/版本」語意 SHALL 由樹骨架降為葉層 badge：導到含 `model.ifc` 的版本層時，對該 `model.ifc` 呼 `deriveIntakeFromKey`（≥3 段才掛）把「專案(中文原名)/種類(倒數二)/版本(末)」當語意 badge 顯示在物件旁；非 `model.ifc` SHALL NOT 掛 badge；malformed（<3 段）SHALL 只影響 badge、SHALL NOT 影響資料夾是否顯示。`geometries_chunks` 等末層 SHALL 由 `Delimiter` 天然 roll-up 成單一可點擊資料夾節點（其下 chunk SHALL NOT 入回應、SHALL NOT 被展開），資料夾節點旁 SHALL NOT 顯示寫死的物件數（CommonPrefix 只回 prefix 字串、不含其下物件數；真實物件數於使用者點入該 prefix 時由下一次 list 自然顯示）。資料夾（遞迴）直屬含 `.ifc` 葉物件者 SHALL 標一枚輕量『含 source IFC』badge（`has_source_ifc=true`），SHALL NOT 在資料夾層宣稱「已轉/可轉」。

物件 role SHALL 由副檔名計算（`.ifc→source_ifc / .usdc→parsed_usdc / else other`，與 intake 三段脫鉤）；「有 `.ifc` 無 `.usdc`→pending·待產生」SHALL 只掛在同層可見 `.ifc` 且無 `.usdc` 的版本層，看不到 `.usdc` SHALL NOT 臆測。`.ifc` 葉物件旁 SHALL 顯示 ledger 衍生狀態 chip（`ready`/`detected`/`queued`/`converting`/`failed`/`未轉(無 ledger 紀錄)`/`未進佇列`；records 讀取失敗或截斷時 SHALL 標 `indeterminate` 而 SHALL NOT 誤標『未轉』），值取自 `GET /api/conversion/records`、以後端對該 `.ifc` 物件附帶的預計算 `idempotency_key` 對 records map lookup，無紀錄 SHALL 誠實標『未轉』而 SHALL NOT 臆測。對「未轉/failed」`model.ifc` SHALL 提供「觸發轉檔」鈕（位於左樹選檔後的單檔詳情面板，非物件列上——#303 master-detail IA 的刻意配置；走 intent→confirm→audited），按下打 **main（`minio-trigger-lifecycle-backend` change，PR #259）已合併的** `POST /api/conversion/trigger`（IP allowlist 守門、coordinator server-side 生 presigned + 寫 ledger、成功回 `{ifc_ready_job_id, status?, trigger_source?}`；trigger 後端契約以該 change 為準，本 change **不重複規範** trigger 後端 auth/回應 shape）；前端成功 SHALL 關 dialog 並 `loadRecords()` 由 ledger 真值對齊 chip（**不做樂觀 patch**，狀態真相來源＝ledger）；失敗 SHALL 顯 inline error、chip 不變；同 key 重觸發 SHALL 冪等不重複建 job；按鈕/回應 SHALL NOT 洩漏 presigned URL。

`#/minio` SHALL 呈現 loading / error / empty / populated 四態：error 態 SHALL 誠實顯示「未連線後端」與錯誤原因並提供使用者可觸發的「重試」動作（重打同一條真實 fetch，SHALL NOT 要求整頁 reload）；empty 態 SHALL 分兩種誠實文案——(a) MinIO 未設定（後端回 `note`，200）、(b) 已設定但當前 prefix 無物件（`folders=[] objects=[]`），SHALL NOT 把兩因混寫成「MinIO watch 未設定」誤導文案。SHALL NOT 以寫死示意樹偽裝真資料；list 回應 SHALL NOT 夾帶 presigned URL；頁首『唯讀 intake 來源視圖，非 metadata 權威…權威在 bim-control·MySQL』誠實字樣 SHALL 保留；bucket-layout 規約面板（prov=demo）SHALL 留作純語意參照、不與真實逐層結果混淆。

#### Scenario: raw-folder 逐層導覽（populated）

- **WHEN** 對真 `bim-control` bucket 在頂層帶 `delimiter=/` list
- **THEN** 頁面 SHALL 渲染全部頂層專案資料夾（CommonPrefixes，依 `localeCompare('zh-TW')` 排序）為可點擊節點，當層直屬檔為葉物件
- **AND** 點資料夾 SHALL 以該 prefix 重打 list 顯示下一層，SHALL NOT 把無 `model.ifc` 的專案藏掉或把 `.json` 歸入「(未知專案)」

#### Scenario: 末層 chunk 摺成單一資料夾不攤開

- **WHEN** 逐層導到含大量 `chunk_*.json` 的 `…/geometries_chunks/` 上一層
- **THEN** 該 `geometries_chunks/` SHALL 以單一可點擊資料夾節點呈現，回應 `objects` SHALL NOT 含 chunk 葉物件、`folders[]` SHALL 含該 prefix
- **AND** 資料夾節點旁 SHALL NOT 顯示寫死的物件數（真實數於點入時由下一次 list 自然顯示）

#### Scenario: 導到 model.ifc 葉層掛三段語意 badge ＋ 狀態 chip

- **WHEN** 逐層導到含 `model.ifc` 的版本層（去 prefix/suffix 後 ≥3 段）
- **THEN** 該 `model.ifc` 旁 SHALL 顯示「專案(中文原名)/種類/版本」語意 badge（`deriveIntakeFromKey`）與 ledger 衍生狀態 chip（值取自 `/api/conversion/records`、無紀錄標『未轉』）
- **AND** 非 `model.ifc` 物件 SHALL NOT 掛 badge；raw 樹逐層 SHALL 顯示完整中文 key

#### Scenario: error 態誠實顯示且可重試

- **WHEN** `GET /api/minio/objects?delimiter=/` 失敗（coordinator / MinIO 不可達，502）
- **THEN** 頁面 SHALL 顯示「未連線後端」與錯誤原因（不吞錯、不偽裝有樹）
- **AND** SHALL 提供「重試」按鈕，點擊後重打同一條真實 fetch，成功即渲染真樹

#### Scenario: empty 態分兩種誠實文案

- **WHEN** MinIO 未設定（後端回 `count:0 + note`）相對於已設定但當前 prefix 無物件（`folders=[] objects=[]`）
- **THEN** 前者 SHALL 顯示「MinIO 未設定」、後者 SHALL 顯示「此資料夾為空」
- **AND** SHALL NOT 把兩因混寫成同一誤導文案

#### Scenario: 非法 delimiter 拒絕

- **WHEN** `GET /api/minio/objects` 帶非 `/` 的 delimiter 值
- **THEN** 後端 SHALL 回 `400 invalid_delimiter`，SHALL NOT 以未定義分組行為回應
