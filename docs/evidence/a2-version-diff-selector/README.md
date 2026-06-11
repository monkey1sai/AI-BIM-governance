# A2 模型版本差異 · 雙組三層選擇器 + Run Diff — Browser E2E 證據

對應 spec §6.3 的 user-facing 驗收。Browser E2E：
`web-viewer-sample/e2e/a2-version-diff-selector.spec.ts`（Playwright，走 coordinator `:8004/ui#/a2`）。

## 驗收項（spec §6.3）

1. `#/a2` base/target 雙組三層選擇器選 `270/機電/ver 000001.ifc`、`270/機電/ver 竣工.ifc`
   → Run Diff → diff `succeeded` → counts 卡 `added + removed + moved + property_changed` 總和 > 0。
2. project 下拉可見「松風庵」；選 `松風庵/建築` → 版本下拉含三層 `v1/japanese_villa.ifc`
   （`{project}/{model}/{versionDir}/*.ifc` 三層目錄掃描 user-facing 支援的證明）。
3. 截圖 + summary 落 `artifacts/e2e/a2-version-diff-selector-*` 與本 tracked 目錄。

## 本機實跑結果（2026-06-11，真 backend，**2 passed**）

實跑 `playwright test e2e/a2-version-diff-selector.spec.ts --reporter=line`：**2 passed（5.7s，非 skipped、非 mock）**。

| test | 結果 | 觀察 |
|---|---|---|
| `#/a2 選 270/機電 base/target 兩版 → Run Diff → succeeded → counts 非全零` | **passed** | counts 卡渲染（diff!=null），sum>0 |
| `base project 下拉含松風庵；選松風庵/建築 → 版本下拉含三層 v1/japanese_villa.ifc` | **passed** | 松風庵 option×1、版本 option `v1/japanese_villa.ifc`×1 |

### test 1 — Run Diff 端到端（真 IFC GlobalId diff）

- base = `D:\Users\deploy\AI-bim-geo\storage\270\機電\ver 000001.ifc`
- target = `D:\Users\deploy\AI-bim-geo\storage\270\機電\ver 竣工.ifc`
- POST `/api/governance/diffs`（經 coordinator proxy → governance-service）→ 輪詢 → **status=succeeded**
- summary：`base_count=4, target_count=14, matched=4, counts={added:10, property_changed:4}`（removed=0, moved=0, geometry_changed 未計算 include_geometry=false）
- **added(10)+removed(0)+moved(0)+property_changed(4) = 14 > 0** ✓（兩版 GlobalId 對齊確有差異，非 identity）
- 截圖：`a2-version-diff-selector-diff-counts.png`（counts 卡 matched=4/added=10/removed=0/moved=0/property changed=4/geometry changed=0，與 backend summary 一致）

### test 2 — 松風庵三層版本下拉（三層掃描 user-facing 證明）

- project 下拉含「松風庵」option×1；選 `松風庵` → model 選 `建築` → 版本下拉含 option `v1/japanese_villa.ifc`×1
- 此 name 形狀 = `{versionDir}/{filename}`，由 `governance-service/file_library/api.py` `_list_versions` 三層下探（task#1）產出，coordinator proxy `/api/governance/files/tree` 回傳驗證一致
- 截圖：`a2-version-diff-selector-matsu-three-level.png`（base = 松風庵/建築）

## 取證時的運行前置（指揮官紀律，乾淨環境必做）

1. `cd web-viewer-sample && npm run build:ui` → 產出 `dist-ui/assets/index-*.js`（含 `a2-base-project` 三層選擇器）。
2. 服務 `:8004/ui` 的 coordinator dist-ui 須是本 branch 的碼。本機取證時 :8004 為 docker 容器
   `ai-bim-web-plane-host-kit-coordinator-1`（dist-ui 烤進 image，build:ui 不會自動換容器內陳舊 dist-ui），
   故以 `docker cp dist-ui/* …:/workspace/console-dist/` 熱換容器服務的 dist-ui（served bundle 由
   `index-DZLmxBB3.js`→`index-f2IASQLC.js`，後者含 `a2-base-project`）。
3. governance-service（`/api/governance/*` proxy target `host.docker.internal:49102`）須含 task#1 三層掃描。
   部署區 `D:\Users\deploy\AI-bim-geo\governance-service` 為 origin/main 版（無三層掃描，松風庵不入樹），
   取證時以本 worktree `governance-service/app.py` 跑 :49102、`BIM_FILE_LIBRARY_ROOT=D:\Users\deploy\AI-bim-geo\storage`
   （該 storage 含 `270/889/990` 與 `松風庵/<系統>/v1/*.ifc`）→ files/tree 回 `["270","889","990","松風庵"]`、
   `松風庵/建築` 版本含 `v1/japanese_villa.ifc`。
4. `coordinator` 在別 port 時用 `E2E_COORDINATOR_BASE_URL` 覆寫。

> 部署 follow-up（task #11）：上述 (2)(3) 為本機取證的指揮官手動前置；要讓部署區 golden runtime 常態服務
> 本功能，須循 `rebuild-test-deploy.ps1` 在本 branch merge 進 origin/main 後重建部署區（dist-ui 重 bake +
> governance-service 帶三層掃描）。松風庵真 IFC 為 gitignored，部署同步由部署規則維持（memory checklist）。

## skip-gate 效力限制（誠實揭露）

`beforeEach` 兩道為 conditional skip：守門 (1) files/tree 缺 270、守門 (2) `#/a2` 缺 `a2-base-project` →
`test.skip`（計 pass）。本 repo `.github/workflows` 僅 `pr-review-agent.yml`、無 Playwright job，故此 skip 設計
不會 false-green 任何既有自動化 gate；此 spec 純屬本機/指揮官手動 P4 硬 gate。本次取證前置已對齊，**兩 test 實跑 passed**。

## 既有覆蓋（補充而非取代 E2E）

`web-viewer-sample/src/console/console.test.tsx` 之 A2 vitest 覆蓋選擇器 data-binding、`model_version_id`
帶出、換 project/model 清 selector 填入值、手動值不波及、`createDiff` 帶正確
`base_model_version_id`/`target_model_version_id`。E2E 補的是「Run Diff 端到端 + 松風庵三層下拉」browser-only 驗收。
