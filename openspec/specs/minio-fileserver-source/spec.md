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

### Requirement: `#/minio` SHALL 顯示真實檔案庫樹（四態 + 可重試）

> 被 supersede（pending archive）：`openspec/changes/minio-folderview-and-baseline-disclosure/`（使用者 2026-06-24 拍板）把本 requirement 的 `#/minio` 顯示來源由「`governanceClient.filesTree()` 的 local_fs 兩層樹」改為「coordinator `GET /api/minio/objects?prefix=…&delimiter=/` 的真 MinIO raw-folder 逐層 list」（三層語意降為葉層 badge、加 ledger 狀態 chip 與一鍵觸發鈕）。權威以該 change spec delta `specs/minio-fileserver-source/spec.md` 為準；本段於該 change archive 後由 `npx openspec archive` 落地覆寫。本檔 `governance SHALL 提供唯讀 file-library tree API`（local_fs `GET /api/files/tree`）與 `#/a1` A1/A2 binding requirement **不受影響、保留不動**（local_fs 不再當 `#/minio` 顯示來源，原地降格為 A1/A2 頁內檔案選擇器）。

`#/minio`（MinioDataPage）SHALL 經 `governanceClient.filesTree()` 取真樹並渲染 project/model/version（含 `source_kind` / `root` 誠實標示），SHALL 呈現 loading / error / empty / populated 四態：error 態 SHALL 誠實顯示「未連線後端」與錯誤原因並提供使用者可觸發的「重試」動作（重打同一條真實 fetch，SHALL NOT 要求整頁 reload）；empty 態 SHALL 誠實顯示「檔案庫為空」。SHALL NOT 以寫死示意樹偽裝真資料；`model.usdc` 轉檔產物仍標 p1 待建。

#### Scenario: 真樹渲染（populated）

- **WHEN** `filesTree()` 回含 270/889/990 的樹
- **THEN** 頁面 SHALL 渲染各 project/model/version 節點與 `source_kind=local_fs`

#### Scenario: error 態誠實顯示且可重試

- **WHEN** `filesTree()` 失敗（coordinator / governance-service 離線）
- **THEN** 頁面 SHALL 顯示「未連線後端」與錯誤原因（不吞錯、不偽裝有樹）
- **AND** SHALL 提供「重試」按鈕，點擊後重打 `filesTree()`，成功即渲染真樹

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
