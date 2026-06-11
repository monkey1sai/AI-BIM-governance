## Why

A2「版本差異」後端（diff_engine、proxy、client）全 as-built，但 `#/a2` 的 base/target 只能手填寫死路徑，operator 無法消費 file-library 的版本資料（270/889/990 每系統 4 版本，PR #204）。同時使用者新增專案「松風庵」（權威來源 `C:\.llmcode\松風庵`）為三層結構 `{系統}/v1/*.ifc`，現行 file_library 兩層掃描看不到 — 即 v3 §3.3 M5「O3 版本層落地 → A2 IFC-diff」的最後一哩。

## What Changes

- **governance-service `file_library`**：`_list_versions` 支援第三層版本目錄 `{project}/{model}/{versionDir}/*.ifc`（version `name = "{versionDir}/{filename}"`，第四層忽略、`realpath` 防護沿用、`竣工` 仍排最後）；既有兩層輸出**零變化**（A/B 實測 + pytest 回歸鎖）。
- **EdgeConsole `#/a2`（VersionDiffPage）**：base 與 target 各一組「專案→模型→版本」三層選擇器（複用 A1 filesTree 模式），選定填入路徑 input 並帶出 `base/target_model_version_id`（`{project}/{model}/{version name}`，供 issue-impact 版本綁定）；手動覆寫清空綁定（誠實：手填路徑無版本語意）；檔案庫不可用 graceful degradation；換 project/model 清空下層選擇與已填路徑。
- **品質修復（review 迴圈）**：React updater 純函數違反修復（clear 邏輯移出 setState updater）、測試 guard/防交叉污染斷言補強。
- **Browser E2E**：`270/機電` 兩版本真 diff（`diff_b4b296bc4847`：matched 4 / added 10 / property_changed 4，items 逐元素核對與 counts 一致）+ 松風庵三層 option DOM 斷言；tracked 證據 `docs/evidence/a2-version-diff-selector/`（含 final re-run 段）。
- 非目標：3D onion-skin / overlay（`apply-overlay` 維持誠實 501 + p15）、clash、diff 匯出、diff 引擎本體改動。

## Capabilities

### New Capabilities

- `a2-version-diff-selector`: operator 可從 file-library（含三層版本目錄專案如松風庵）選 base/target 版本執行真 IFC diff 並看到變更計數與清單。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder：`governance-service/file_library/`、`governance-service/tests/`、`web-viewer-sample/src/console/`、`web-viewer-sample/e2e/`。
- API / data shape：`GET /api/files/tree` 的 version `name` 新增三層樣式（`FilesTreeResponse` 形狀不變）；`POST /api/diffs` 既有欄位不變（前端新增帶出 optional model_version_id）。
- Runtime boundary：不動 ports/服務拓樸；部署區生效需 merge 後 rebuild（dist-ui 重 bake + governance-service 重啟 + storage 同步，見部署 checklist）。
- 行為變更框定：舊行為「三層一律不入樹」反轉為「三層入樹」— 對既有兩層條目是純加法；現有部署 storage（270/889/990 扁平結構）不受影響，僅松風庵類三層專案新增條目。
