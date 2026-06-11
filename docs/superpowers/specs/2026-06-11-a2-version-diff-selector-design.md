# A2 版本 diff 檔案庫選擇器 + file_library 三層版本目錄（松風庵）設計

- 文件性質：spec design（設計文件）。權威序：code > contracts > AGENTS > wiki；與實作衝突時以實作程式碼與 `openspec/specs/` capability spec 為準。
- 日期：2026-06-11
- Phase 對應：M5「A2 真差異」的 CPU 部分（v3 §3.2/§3.3：O3 版本層落地 → A2 IFC-diff）；3D onion-skin 需 M3，不在本輪。
- userFacing：true（`#/a2` / `#/version-diff`）

## 1. 背景與現狀（盤點已實證）

A2 後端**完整 as-built**：governance-service `diff_engine/`（`POST /api/diffs` 吃 `base_ifc_path`/`target_ifc_path`、GlobalId→Tag→type+Name+loc 三級對齊、`/items`、`/issue-impact`、`apply-overlay` 誠實 501）、coordinator proxy 五端點一一對應、`governanceClient` 的 `createDiff/getDiff/getDiffItems/diffIssueImpact/applyDiffOverlay` 全接真 API、`VersionDiffPage`（`pages.tsx:898-1009`）有輪詢與結果卡。capability spec：`openspec/specs/model-version-diff-authority/spec.md`。

缺口兩個：

1. **`VersionDiffPage` 沒有檔案庫選擇器**：base/target 是兩個寫死預設值的手填 `<input>`，operator 無法從 file-library 的版本中選 — 而 270/889/990 每系統 4 個版本（PR #204）正是為 A2 準備的資料。
2. **file_library 只掃兩層**：新專案「松風庵」（使用者 2026-06-11 指定，權威來源 `C:\.llmcode\松風庵`，已同步到主工作區與部署區 `storage/松風庵/`）是三層結構 `{系統}/v1/*.ifc`（8 系統 × v1），現行 `{project}/{model}/*.ifc` 掃描看不到它。

## 2. 目標（成功標準）

1. file_library 支援第三層版本目錄：`{project}/{model}/{versionDir}/*.ifc` 入樹，version 條目 `name = "{versionDir}/{filename}"`（如 `v1/japanese_villa.ifc`）；既有兩層（檔名即版本）行為與輸出**完全不變**。`GET /api/files/tree` 的 projects 含 270/889/990/**松風庵**。
2. `#/a2`（`VersionDiffPage`）有 base 與 target 各一組「專案→模型→版本」三層選擇器（複用 A1 既有 filesTree 模式），選定即填入對應路徑 input；手動輸入保留、檔案庫不可用時 graceful degradation（比照 A1）。
3. 選擇器選定時同步帶出 `base_model_version_id` / `target_model_version_id` = `"{project_id}/{model_id}/{version name}"`（供 `/issue-impact` 版本綁定；手動輸入路徑時兩欄留空維持現行為）。
4. Browser E2E：選 `270/機電` 的 `ver 000001.ifc` vs `ver 竣工.ifc` → Run Diff → succeeded → 變更計數卡顯示真實非全零結果（8KB vs 22KB 兩版必有差異）；且 project 下拉可見「松風庵」（三層支援的 user-facing 證明）。

## 3. 非目標（明確不做）

- 不動 diff 引擎本體 / proxy / governanceClient diff 方法（全部 as-built）。
- 不做 3D onion-skin / overlay（`apply-overlay` 維持誠實 501 + `p15` 標記；需 M3 串流）。
- 不做 clash（O6/M5 後段）、不做 diff 結果匯出。
- 不改兩層結構既有專案的 version name 形狀（向後相容：A1 選擇器與既有 E2E 不受影響）。
- 松風庵的非 IFC 檔（`.blend`、`building-info.md`）不入樹（file_library 只列 `.ifc`，既有規則）。

## 4. 設計

### 4.1 file_library 三層版本目錄（governance-service/file_library/api.py）

- 掃描規則擴充：對 `{project}/{model}/` 下的**子目錄**（versionDir）再掃一層 `*.ifc`：
  - 兩層檔案（既有）：`name = filename`（不變）。
  - 三層檔案（新）：`name = f"{versionDir.name}/{filename}"`、`path` = 該檔絕對路徑、`size_bytes`/`mtime` 同既有欄位。
  - 第四層以下忽略；versionDir 內無 `.ifc` 則該目錄不產生條目。
- 排序：兩形狀混排走同一把自然排序尺；`竣工` 字樣仍固定排最後（既有規則不動）。
- 防護沿用：`realpath` 必在 root 內；保留目錄排除（`ifc-cache`、`coordinator`）只作用於 project 層（既有行為不變）。
- `source_kind`、空 root、錯誤處理全部不變。

### 4.2 VersionDiffPage 檔案庫選擇器（web-viewer-sample/src/console/pages.tsx）

- 頁面載入呼叫一次 `governanceClient.filesTree()`（與 A1 同模式：loading / fsErr 狀態）。
- base 與 target 各一組三層 `<select>`（testid 比照 A1 慣例：`a2-base-project/model/version`、`a2-target-project/model/version`）；選定版本 → 該檔 `path` 填入既有 base/target `<input>`（受控 state，input 保留可手動覆寫）。
- 選擇器選定時記 `base_model_version_id` / `target_model_version_id` = `{project_id}/{model_id}/{version.name}`，隨 `createDiff` 送出；手動改寫 input 後該欄位清空（誠實：手填路徑沒有版本綁定語意）。
- fsErr 時選擇器顯示「檔案庫不可用…可改用下方手動輸入」（A1 同款 graceful degradation）。

### 4.3 資料流（一句話版）

`#/a2` → `filesTree()`（含松風庵三層）→ 選 base/target 版本 → `POST /api/governance/diffs {base_ifc_path, target_ifc_path, base_model_version_id?, target_model_version_id?}` → 輪詢 succeeded → counts/items/issue-impact（全既有鏈路）。

## 5. 錯誤處理

| 情境 | 行為 |
|---|---|
| 檔案庫不可用 | 選擇器標不可用、手動輸入照常（A1 同款） |
| 三層目錄無 .ifc / 第四層檔案 | 不產生條目 / 忽略（pytest 鎖） |
| 選定檔在 diff 前被移走 | 既有 `POST /api/diffs` 400（path 不存在）路徑，前端顯示錯誤（不動） |
| 兩 input 同路徑 | 允許（identity diff 是合法案例，引擎回 0 變更） |

## 6. 測試與驗收

1. **governance pytest**（`tests/test_file_library.py` 擴充）：
   - 三層案例：tmp root 造 `松/建築/v1/a.ifc` → tree 含 `name="v1/a.ifc"` 與正確 path。
   - 兩形狀混合同 model：兩層檔與三層檔並存 → 都列出、排序穩定、`竣工` 仍最後。
   - 第四層忽略、空 versionDir 不產生條目。
   - 既有兩層案例輸出零變化（回歸鎖）。
2. **前端 vitest**（`console.test.tsx` 既有模式）：VersionDiffPage 選擇器 render；選定後 base input 值更新且 model_version_id 帶出；fsErr graceful degradation；手動覆寫清空版本綁定。
3. **Browser E2E（Playwright，`e2e/a2-version-diff-selector.spec.ts`）**：
   - 守門與檔頭 skip 限制揭露比照 `minio-fileserver-source.spec.ts` 先例。
   - `#/a2`：base 選 `270/機電/ver 000001.ifc`、target 選 `270/機電/ver 竣工.ifc` → Run Diff → succeeded → counts 卡顯示且 added+removed+moved+property_changed 總和 > 0。
   - project 下拉含「松風庵」；切到 `松風庵/建築` 版本下拉含 `v1/japanese_villa.ifc`（三層支援 user-facing 證明）。
   - 截圖 + summary 落 `artifacts/e2e/a2-version-diff-selector-*` 與 tracked `docs/evidence/a2-version-diff-selector/`。
4. **驗收基準**：全綠 + 四項回報；`#/minio` 與 `#/a1` 既有 E2E 不壞（file_library 回歸）。

## 7. 風險與緩解

- **`IfcReadyListItem`/filesTree 型別變動面**：本輪不改 `FilesTreeResponse` 欄位形狀（只是 name 內容多一種樣式），前端零型別變動 — 風險低。
- **三層掃描效能**：storage 量級（百檔內）線性掃描無虞；不做快取（YAGNI）。
- **松風庵資料為 gitignored**：E2E 依賴主工作區 `storage/松風庵/`（已同步）；worktree E2E 讀主工作區絕對路徑或隔離 stack 的 `BIM_FILE_LIBRARY_ROOT` 指主工作區 storage（比照 #204 E2E 慣例）。部署區由部署同步規則維持（memory checklist）。
- **diff 引擎對小合成 IFC 的行為**：270 的 8KB vs 22KB 為同 model 連續版本，GlobalId 對齊應命中大量 matched + added；若 counts 全零（意外 identity）E2E 紅燈會顯性暴露，屬可接受的提早爆雷。
