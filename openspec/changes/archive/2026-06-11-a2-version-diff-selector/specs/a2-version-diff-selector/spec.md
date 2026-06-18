# a2-version-diff-selector

## ADDED Requirements

### Requirement: file_library SHALL 支援第三層版本目錄且既有兩層輸出零變化

`GET /api/files/tree` 掃描 SHALL 同時收錄兩層 `{projectId}/{modelId}/*.ifc`（version `name = filename`，既有行為）與三層 `{projectId}/{modelId}/{versionDir}/*.ifc`（version `name = "{versionDir}/{filename}"`）；第四層以下 SHALL 忽略、versionDir 內無 `.ifc` SHALL NOT 產生條目。`realpath` 防 traversal SHALL 作用於 versionDir 與檔案兩層；保留目錄排除（`ifc-cache`、`coordinator`）維持只作用於 project 層。兩形狀混排 SHALL 走同一把自然排序尺且 `竣工` 字樣仍固定排最後。對純兩層結構的既有專案，輸出 SHALL 與擴充前完全一致。

#### Scenario: 三層專案（松風庵形狀）入樹

- **WHEN** root 下存在 `松風庵/建築/v1/japanese_villa.ifc`
- **THEN** tree 的 `松風庵/建築` versions SHALL 含 `name="v1/japanese_villa.ifc"` 條目，`path` 為該檔絕對路徑

#### Scenario: 第四層與空 versionDir 忽略

- **WHEN** 存在 `{p}/{m}/v1/nested/too_deep.ifc` 與無 `.ifc` 的 `{p}/{m}/empty-ver/`
- **THEN** tree SHALL NOT 含 `too_deep` 條目，`empty-ver` SHALL NOT 產生任何條目

#### Scenario: 既有兩層輸出零變化（回歸鎖）

- **WHEN** root 僅含兩層結構專案（如 270/889/990）
- **THEN** `GET /api/files/tree` 輸出 SHALL 與三層擴充前逐欄一致

### Requirement: `#/a2` SHALL 提供 base/target 檔案庫版本選擇器且版本綁定誠實

`VersionDiffPage` SHALL 提供 base 與 target 各一組「專案→模型→版本」三層選擇器（資料來自 `filesTree()`，含三層版本目錄專案）；選定版本 SHALL 將該檔路徑填入對應 input 並帶出 `base/target_model_version_id = "{project_id}/{model_id}/{version name}"` 隨 `createDiff` 送出。手動覆寫 input SHALL 清空該側版本綁定（手填路徑無版本語意）；換 project/model SHALL 清空下層選擇與已填路徑。檔案庫不可用時選擇器 SHALL 顯示不可用狀態而手動輸入照常可用。狀態更新 SHALL NOT 在 React state updater 內執行副作用（純函數契約）。

#### Scenario: 選擇器選定兩版本跑出真 diff

- **WHEN** operator 以選擇器選 `270/機電/ver 000001.ifc`（base）與 `270/機電/ver 竣工.ifc`（target）並執行 Run Diff
- **THEN** `POST /api/governance/diffs` SHALL 帶兩檔路徑與兩側 `model_version_id`，輪詢至 `succeeded` 後 counts 卡 SHALL 顯示非全零變更計數

#### Scenario: 手動覆寫清空版本綁定

- **WHEN** operator 選定 base 版本後手動改寫 base input 為任意路徑
- **THEN** 送出的 `base_model_version_id` SHALL 為未定義，且 target 側選擇與路徑 SHALL NOT 受影響

#### Scenario: 松風庵三層版本可被選擇（user-facing 證明）

- **WHEN** operator 展開 base 專案下拉
- **THEN** SHALL 含「松風庵」option；選 `松風庵/建築` 後版本下拉 SHALL 含 `v1/japanese_villa.ifc`
