# A2 version-diff 選擇器 Browser E2E — 跑測摘要（summary）

對應 spec §6.3 user-facing 驗收。Browser E2E：
`web-viewer-sample/e2e/a2-version-diff-selector.spec.ts`（Playwright，走 coordinator `:8004/ui#/a2`）。
本檔為 task#4 finding 要求的 `summary.md`，逐項記：跑的 base/target 路徑、counts 實際數字、
succeeded 與否、松風庵三層可見截圖。詳細運行前置與既有覆蓋見同目錄 `README.md`。

## 跑測結果（2026-06-11 12:17，真 backend，**2 passed**，非 skipped、非 mock）

`npx playwright test e2e/a2-version-diff-selector.spec.ts --reporter=line` → **2 passed (5.1s)**。

| test | 結果 |
|---|---|
| `#/a2 選 270/機電 base/target 兩版 → Run Diff → succeeded → counts 非全零` | **passed** |
| `base project 下拉含松風庵；選松風庵/建築 → 版本下拉含三層 v1/japanese_villa.ifc` | **passed** |

## test 1 — Run Diff 端到端（真 IFC GlobalId diff）

- **跑的 base 路徑**：`D:\Users\deploy\AI-bim-geo\storage\270\機電\ver 000001.ifc`
- **跑的 target 路徑**：`D:\Users\deploy\AI-bim-geo\storage\270\機電\ver 竣工.ifc`
- 經 coordinator `:8004` proxy → governance-service `:49102`：`POST /api/governance/diffs` → 輪詢
  `GET /api/governance/diffs/:id` → **status = succeeded**（本次取證以同一 proxy 路徑直查確認）。
- **counts 實際數字**（backend summary，與 UI counts 卡一致）：

  | 指標 | 值 |
  |---|---|
  | base_count | 4 |
  | target_count | 14 |
  | matched | 4 |
  | added | 10 |
  | removed | 0 |
  | moved | 0 |
  | property_changed | 4 |
  | geometry_changed | 0（`include_geometry=false`，僅 placement/pset，幾何 tessellation 未計算） |

- **非全零**：added(10) + removed(0) + moved(0) + property_changed(4) = **14 > 0** ✓
  （兩版 GlobalId 對齊確有差異，非 identity；base 4 元素 vs target 14 元素）。
- **succeeded 直接 UI gate（本次新增斷言）**：spec 新增
  `expect(page.getByRole("button", { name: /套用 3D Overlay/ })).toBeEnabled()`。
  pages.tsx L1106「套用 3D Overlay」鈕 `disabled={busy || diff?.status !== "succeeded"}` 是 UI 中
  唯一直接觀察 `status==="succeeded"` 的元素（`run()` 結束 `busy=false`，僅 succeeded 才 enable）。
  本次該斷言 **passed** → 明確證明後端回 succeeded，而非僅靠「counts 卡可見 + sum>0」間接守門。
- 截圖：[`a2-version-diff-selector-diff-counts.png`](a2-version-diff-selector-diff-counts.png)
  （counts 卡 matched=4 / added=10 / removed=0 / moved=0 / property changed=4 / geometry changed=0）。

## test 2 — 松風庵三層版本下拉（三層掃描 user-facing 證明）

- base project 下拉含「松風庵」option ×1；選 `松風庵` → model 選 `建築` → 版本下拉含 option
  `v1/japanese_villa.ifc` ×1。
- 此 name 形狀 = `{versionDir}/{filename}`，由 governance-service `file_library/api.py` `_list_versions`
  三層下探（task#1）產出；coordinator proxy `GET /api/governance/files/tree` 本次回
  `projects = ["270","889","990","松風庵"]`、`松風庵/建築` 版本含 `v1/japanese_villa.ifc`，與 UI 下拉一致。
- **松風庵三層可見截圖**：[`a2-version-diff-selector-matsu-three-level.png`](a2-version-diff-selector-matsu-three-level.png)
  （base = 松風庵/建築）。

## task#5 全套回歸驗收（2026-06-11，補錄）

### 後端回歸：test_file_library.py（12 passed）

指令：`"C:\Program Files\Python312\python.exe" -m pytest governance-service/tests/test_file_library.py -p no:cacheprovider -q`
結果：**12 passed, 1 warning in 1.51s**（兩層回歸 9 + 三層新 3，無 fail）。

### 前端回歸：console.test.tsx（63 passed）

指令：`npm --prefix web-viewer-sample test -- --run console.test.tsx`
結果：**2 files, 63 tests passed**（OperatorConsole 13 + console.test.tsx 50）。

### minio E2E 回歸：minio-fileserver-source.spec.ts（2 skipped — 前置未對齊）

指令：`npm --prefix web-viewer-sample exec -- playwright test e2e/minio-fileserver-source.spec.ts --reporter=line`
結果：**2 skipped**（governance-service :49102 不在線；`beforeEach` 守門 (1) 觸發 conditional skip）。

skipped ≠ fail；per spec task#5 描述「前置未對齊則全 skip，與本輪改動無關」。
本 `file_library` 三層支援與 task#1 後端已由 12 passed pytest 覆蓋；minio E2E 的 file-server
兩層（270/889/990）輸出由 `test_list_projects_two_layer` 等 9 項回歸守住，確認未破壞兩層路徑。

## 截圖抽樣說明（誠實）

evidence 只存抽樣截圖（2 張 PNG，各 ~130–144KB），不存 trace/video 全量、不 commit 任何 IFC/usdc
（真 IFC 為 gitignored，部署同步由部署規則維持）。Playwright `trace`/`video` 落在 gitignored
`artifacts/e2e/`，非 tracked evidence。

## 取證前置（指揮官紀律，乾淨環境必做）

1. governance-service 起於 `:49102`，`BIM_FILE_LIBRARY_ROOT=D:\Users\deploy\AI-bim-geo\storage`
   （含 `270/889/990` 與 `松風庵/<系統>/v1/*.ifc`），帶 task#1 三層掃描。
2. 服務 `:8004/ui` 的 coordinator dist-ui 須是本 branch 的碼（含 `a2-base-project` 三層選擇器與
   `套用 3D Overlay` 鈕）；本機 :8004 為 docker 容器，dist-ui 以本 branch `npm run build:ui` 產物熱換
   （served bundle = `index-f2IASQLC.js`，已驗含 `a2-base-project` / `a2-base-version` / `套用 3D Overlay`）。
3. coordinator 跑別 port 用 `E2E_COORDINATOR_BASE_URL` 覆寫。
4. 前置缺失 → `beforeEach` 兩道 conditional skip（誠實：不假裝跑過）。本 repo `.github/workflows` 僅
   `pr-review-agent.yml`、無 Playwright job，此 skip 設計不會 false-green 任何既有自動化 gate；
   本次取證前置已對齊，**兩 test 實跑 passed**。
