## Why

A1「治理與模型檢核」後端閉環（rule-run / results / issues / BCF / export）全 as-built，但 `#/a1` 仍是靜態版型：五步 stepper 步驟間無狀態機（上傳完不會自動亮步驟2）、記分板失敗結果只能看被截斷的扁平表（無 per-rule 展開 / 分頁 / 樓層 / GUID 複製，IX-A1-03 未落地）。這是 v3 M1「A1 核心閉環」DoD 的最後一哩 —— 純 CPU、不碰 3D。

## What Changes

- **governance-service**：新增 `GET /api/rule-runs/{run_id}/failures?rule=&limit=&offset=`（按 `rule_code` 分組、分頁、開 IFC model 一次補 `ifc_name`/`ifc_type`/`storey`；`rule_results` 表未持久化這些欄位，storey 走 `_spatial_chain` 容納鏈，無容器構件降級 `null` 不捏造）。`open_model` 加 `@lru_cache`（per-process，加速 /failures 重開；in-place 覆寫才會 stale，現行 CPU host-native flow 無 in-place 覆寫路徑）。`/results`、`/export`、`get_results` 形狀零變動。
- **coordinator**：透傳 `GET /api/governance/rule-runs/:runId/failures`（比照既有 `/results` proxy，無新 SSRF/auth 守門）。
- **web-viewer-sample**：`governanceClient.getFailures`；純函數 reducer `a1Machine`（`idle→picked→running→scored→issued→delivered` + `uiSteps`，證據型更新、禁樂觀）；`#/a1`（`A1GovernanceWorkbenchPage`）重構為 reducer 驅動五步 stepper，接現有 inline 失敗抽屜 `FailureScoreboard`（逐規則展開 GUID+名稱+樓層、GUID 複製、懶載入分頁），並移除 `#/a1` 內嵌的 `IssuesRuleCenterPage`（後者仍由 `#/issues` 路由獨立服務）。
- **既有 E2E 對齊**：`product-console-integration.spec.ts`（斷言改對齊新 stepper）、`minio-fileserver-source.spec.ts`（guard 與 rule-center scoping 從 `#/a1` retarget 到 `#/issues`，因選擇器隨內嵌移除而搬家）。
- **Browser E2E**：`#/a1` 五步 stepper + 失敗抽屜樓層 + 重跑路徑（Playwright，隔離 branch stack；API 硬證 71 失敗·真樓層 FL1/FL2，見 `docs/evidence/a1-m1-closeout/`）。
- **非目標**：3D highlight（IX-A1-06，需 M3/M4 串流，維持待建 `p1` disabled）；A2/轉檔覆蓋率；rule-engine / issues / BCF / export 本體。

## Capabilities

### New Capabilities

- `a1-m1-closeout`: operator 在 `#/a1` 以整頁單一 reducer 驅動的五步 stepper 走完「上傳→檢核→記分→開 Issue→匯出」並可逐規則展開命中構件（GUID+名稱+樓層）的單頁治理閉環。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder：`governance-service/`（app.py、rule_engine/）、`bim-review-coordinator/src/routes/`、`web-viewer-sample/src/console/`、`web-viewer-sample/e2e/`。
- API / data shape：新增 `GET .../failures`（回 `{rule_run_id, rule_filter, limit, offset, total, items:[{ifc_guid, ifc_name, ifc_type, storey, severity, rule_code, message, usd_prim_path}]}`）；既有 `/results`、`/export`、`get_results` 形狀零變動（回歸鎖）。
- Runtime boundary：不動 ports / 服務拓樸；部署區生效需 merge 後 rebuild（dist-ui 重 bake + governance-service 重啟）。
- 行為變更框定：`#/a1` 從靜態版型變 reducer stepper、內嵌 `IssuesRuleCenterPage` 移除 —— 對 `#/issues` 純無影響（獨立路由不變），既有 rule-run 路徑不變（client 方法原封複用）。
