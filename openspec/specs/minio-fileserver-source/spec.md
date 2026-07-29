# minio-fileserver-source Specification

## Purpose
TBD - created by archiving change minio-fileserver-source. Update Purpose after archive.
## Requirements
### Requirement: governance-service SHALL 提供唯讀 file-library tree API（兩層 IFC 結構）

governance-service SHALL 提供 `GET /api/files/tree`，唯讀列出 library root 下兩層 `{projectId}/{modelId}/*.ifc` 結構（`source_kind: "local_fs"` 誠實標示；比照真實 MinIO `bim-control/{projectId}/{modelId}/…` 規約）。library root 解析 SHALL 依序採用 `BIM_FILE_LIBRARY_ROOT`（專屬覆寫）→ `RUNTIME_STORAGE_ROOT`（deploy `.env` 的 runtime 資料根權威）→ checkout 相對 `storage/` 預設。API SHALL 以 `realpath` 防 path traversal（root 外 symlink/junction 目標不入樹）、SHALL 排除保留目錄（`ifc-cache`、`coordinator`）、版本排序 SHALL 自然排序且 `ver 竣工.ifc` 固定最後。root 不存在 SHALL 回 200 空樹；掃描中單一 entry 的 transient `OSError` SHALL 跳過該 entry 而 SHALL NOT 造成整個端點 500。本 API SHALL NOT 提供上傳/刪除/改名（唯讀）。

#### Scenario: 兩層結構列出且版本排序正確

- **WHEN** library root 下存在 `270/機電/ver 000001.ifc`、`ver 000002.ifc`、`ver 竣工.ifc` 與同層非 `.ifc` 檔
- **THEN** 回應 SHALL 列出 project `270` → model `機電` → 三個版本（含絕對 `path` / `size_bytes` / `mtime`）
- **AND** 版本順序 SHALL 為自然排序且 `ver 竣工.ifc` 最後
- **AND** 非 `.ifc` 檔與過深（三層以上）檔案 SHALL NOT 入樹

#### Scenario: root 缺失回 200 空樹（不 500）

- **WHEN** 解析出的 library root 不存在或非目錄
- **THEN** API SHALL 回 200 且 `projects` 為空陣列

#### Scenario: 掃描中 transient OSError 跳過該 entry 不致端點 500

- **WHEN** 掃描期間單一檔案的 `stat`/`mtime` 取得因檔案被刪/鎖而拋 `OSError`
- **THEN** API SHALL 跳過該 entry 並繼續掃描
- **AND** SHALL 回 200（SHALL NOT 整個端點 500）

#### Scenario: root 外 symlink 逃逸不入樹

- **WHEN** root 下存在指向 root 外目錄的 symlink 或 junction
- **THEN** 該目錄 SHALL NOT 出現在回應樹中

#### Scenario: library root 解析鏈（deploy 路徑用 runtime storage root）

- **WHEN** 未設 `BIM_FILE_LIBRARY_ROOT` 而環境存在 `RUNTIME_STORAGE_ROOT`
- **THEN** API SHALL 以 `RUNTIME_STORAGE_ROOT` 為 library root
- **AND** 兩者皆存在時 `BIM_FILE_LIBRARY_ROOT` SHALL 優先

### Requirement: 前端 SHALL 只經 coordinator proxy 取得檔案庫樹

coordinator `governanceProxy` SHALL 提供白名單一條 `GET /api/governance/files/tree` 透傳 governance-service `GET /api/files/tree`；前端 SHALL 只經 coordinator `:8004` 取樹、SHALL NOT 直連 governance-service `:49102`。governance-service 不可達時 proxy SHALL 誠實回 502（SHALL NOT 回假資料）。

#### Scenario: proxy 透傳成功

- **WHEN** 前端 GET `/api/governance/files/tree` 且 governance-service 正常
- **THEN** coordinator SHALL 回傳 governance-service 的樹回應

#### Scenario: governance-service 離線誠實 502

- **WHEN** governance-service 不可達
- **THEN** proxy SHALL 回 502
- **AND** SHALL NOT 回傳捏造的空樹或快取假資料

### Requirement: `#/a1` SHALL 提供檔案庫三層選擇器（持值受控 + 換層清理 + graceful degrade）

`#/a1`（IssuesRuleCenterPage）SHALL 提供 project → model → version 三層選擇器：選定 version SHALL 將其絕對 `path` 填入既有 `ifc_source_path` 輸入框，且 version select SHALL 為持值受控元件（選定後 SHALL NOT 跳回 placeholder）。換 project/model 或將 version 清回 placeholder 時 SHALL 重置 version 選擇並清空「由選擇器填入的」`ifc_source_path`（避免殘留舊選擇被誤送出檢核）；使用者手動輸入的路徑 SHALL NOT 被此清理波及。檔案庫不可用時 SHALL graceful degrade（誠實標示「檔案庫不可用」+ 提供「重試載入檔案庫」動作），手動輸入路徑流程 SHALL 照常可用。

#### Scenario: 選定 version 填入路徑且 select 持值

- **WHEN** 使用者依序選 project=270、model=機電、version=`ver 竣工.ifc`
- **THEN** `ifc_source_path` 輸入框 SHALL 更新為該 version 的絕對路徑
- **AND** version select SHALL 顯示選中項（SHALL NOT 跳回 placeholder）

#### Scenario: 換 project 清 selector 填入的路徑、手動輸入不受影響

- **WHEN** 使用者已由選擇器填入路徑後改選其他 project
- **THEN** version 選擇 SHALL 重置且選擇器填入的 `ifc_source_path` SHALL 清空
- **AND** 若使用者已手動覆寫路徑，該手動值 SHALL 保留不被清

#### Scenario: version 清回 placeholder 也清 selector 填入的路徑

- **WHEN** 使用者選定 version 後將 version select 清回 placeholder（空值）
- **THEN** version 選擇 SHALL 重置且「由選擇器填入的」`ifc_source_path` SHALL 清空
- **AND** 使用者手動覆寫的路徑 SHALL 保留不被清

#### Scenario: 檔案庫不可用 graceful degrade 且可重試

- **WHEN** `filesTree()` 失敗
- **THEN** 選擇器區 SHALL 誠實標示「檔案庫不可用」與原因，並提供「重試載入檔案庫」
- **AND** 手動輸入路徑與「執行規則檢核」流程 SHALL 照常可用

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
