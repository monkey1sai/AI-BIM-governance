# A2 模型版本差異 · 雙組三層選擇器 + Run Diff — Browser E2E 證據

對應 spec §6.3 的 user-facing 驗收。Browser E2E：
`web-viewer-sample/e2e/a2-version-diff-selector.spec.ts`（Playwright，走 coordinator `:8004/ui#/a2`）。

## 驗收項（spec §6.3）

1. `#/a2` base 雙組三層選擇器選 `270/機電/ver 000001.ifc`、target 選 `270/機電/ver 竣工.ifc`
   → Run Diff → diff `succeeded` → counts 卡 `added + removed + moved + property_changed` 總和 > 0。
2. project 下拉可見「松風庵」（`{project}/{model}/{versionDir}/*.ifc` 三層目錄 user-facing 支援的證明）。
3. 截圖 + summary 落 `artifacts/e2e/a2-version-diff-selector-*` 與本 tracked 目錄。

## 本機實跑現況（2026-06-11，誠實標記）

本機實跑 `npx playwright test e2e/a2-version-diff-selector.spec.ts` 結果：**2 skipped（非 fail、非 crash）**。
原因如下，皆為「運行環境/部署狀態未齊」而非前端缺陷，spec 以 conditional skip 誠實標 `not observed`，不假綠：

- **test A（Run Diff 端到端）`not observed`**：運行中 coordinator `:8004/ui` 服務的 dist-ui 尚未含本 branch
  的 A2 三層選擇器（`#/a2` 缺 `a2-base-project`/`a2-base-model`/`a2-base-version` testid）。
  取綠前置：`cd web-viewer-sample && npm run build:ui` → 重建/重啟服務 `:8004` dist-ui 的 coordinator 容器
  （`ai-bim-web-plane-host-kit-coordinator-1`，build:ui 只更新 dist，docker 容器需重建才換掉 baked dist-ui）。
  後端條件已具備：`GET /api/governance/files/tree` 已回 `270/機電` 之 `ver 000001.ifc`+`ver 竣工.ifc`、
  `POST /api/governance/diffs` 可達。歸 **task #10 P3 證據 / ship**。
- **test B（松風庵下拉可見）`not observed`**：運行中 `files/tree`（root=`D:\Users\deploy\AI-bim-geo\storage`）
  只回 `270/889/990`，未含「松風庵」。根因：松風庵為三層形狀 `松風庵/<model>/v1/*.ifc`，需後端三層掃描
  （`governance-service/file_library/api.py` `_list_versions` 子目錄下探，task#1 改動）已部署 + 部署區 storage
  已同步松風庵真 IFC。部署區 storage 雖已有 `松風庵/`（8 個 .ifc），但運行中 governance-service 跑的是
  尚未含 task#1 三層掃描的版本，故松風庵不入樹。歸 **task #11 松風庵同步 + 部署 checklist**。

> 跨 origin 備註：前端 `governanceClient` 的 `COORD_BASE` 為絕對 `http://127.0.0.1:8004`，且 coordinator
> 未回 `Access-Control-Allow-Origin`；故 E2E 必須走同 origin 的 `:8004/ui`（dist-ui），無法改走 Playwright
> 自起的 `:5180` viewer dev server 跨打 `:8004`（會被 CORS 擋）。此即 spec 以 dist-ui 為門面、缺選擇器即
> skip 的原因。

## 何時會綠（取證步驟）

1. `cd web-viewer-sample && npm run build:ui`
2. 重建/重啟服務 `:8004` dist-ui 的 coordinator；governance-service 跑含 task#1 三層掃描的版本，
   `BIM_FILE_LIBRARY_ROOT` / `RUNTIME_STORAGE_ROOT` 指含 `270/889/990` 與 `松風庵/<model>/v1/*.ifc` 的 storage。
3. `npx playwright test e2e/a2-version-diff-selector.spec.ts --reporter=list`
4. 綠後截圖落 `artifacts/e2e/a2-version-diff-selector-run-diff.png`、`-songfeng.png`，並 sync 至本目錄。

## 既有覆蓋（已綠，補充而非取代 E2E）

`web-viewer-sample/src/console/console.test.tsx` 之 A2 vitest（8 個 case，全綠）覆蓋選擇器 data-binding、
`model_version_id` 帶出、換 project/model 清 selector 填入值、手動值不波及、`createDiff` 帶正確
`base_model_version_id`/`target_model_version_id`。E2E spec 補的是「Run Diff 端到端 + 松風庵下拉」這段
browser-only 驗收。
