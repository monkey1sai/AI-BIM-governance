## 1. governance-service failures 端點 + storey enrichment

- [x] 1.1 `_storey_from_element`（從 `_spatial_chain` 取 containing storey 名，無樓層回 `None`）
- [x] 1.2 `GET /api/rule-runs/{run_id}/failures`（按 `rule_code` 分組過濾、`limit`/`offset` 分頁、開 model 一次補 name/type/storey、404 守門、開檔失敗降級無 enrichment）
- [x] 1.3 `open_model` 加 `@lru_cache`（per-process 加速重開）
- [x] 1.4 pytest：端點分組/分頁/total、storey helper 有/無容器、404；既有 `/results`、`/export` 回歸全綠（102 passed）

## 2. coordinator proxy

- [x] 2.1 `GET /api/governance/rule-runs/:runId/failures` 透傳（比照 `/results`，無新守門）
- [x] 2.2 `docs/contracts/governance-rule-run-proxy.md` 路由表補 `/failures`

## 3. 前端 reducer + stepper + 失敗抽屜

- [x] 3.1 `governanceClient.getFailures` + `FailureRow`/`FailuresResponse` 型別（array key `items`）
- [x] 3.2 純 reducer `a1Machine`（六態轉移 + `uiSteps`，重跑清下游保留 artifact）+ vitest（含 RUN_FAIL→重試→RUN_DONE runError reset 回歸鎖）
- [x] 3.3 `#/a1`（`A1GovernanceWorkbenchPage`）重構為 reducer 驅動五步 stepper，接 inline `FailureScoreboard`，移除內嵌 `IssuesRuleCenterPage`
- [x] 3.4 失敗抽屜逐規則展開（GUID+名稱+樓層+複製、懶載入分頁、輪詢去重鎖）；`LifecycleStrip` 吃 state；`edge-console.css` `.ec-flow-step.done`
- [x] 3.5 `console.test.tsx` A1 斷言對齊新 stepper（198 passed）

## 4. 既有 E2E 對齊 + 新 E2E

- [x] 4.1 `product-console-integration.spec.ts` 斷言改對齊新 stepper（`a1-step-run` / `POST /api/governance/rule-runs`）
- [x] 4.2 `minio-fileserver-source.spec.ts` guard(2) 與 rule-center scoping 從 `#/a1` retarget 到 `#/issues`
- [x] 4.3 `e2e/a1-m1-closeout.spec.ts`（flow 五步 + 失敗抽屜樓層 + 重跑路徑）

## 5. 驗證 + evidence

- [x] 5.1 三層全綠（governance 102 / web 198 vitest / build）
- [x] 5.2 Browser E2E（Playwright flow + rerun 皆 PASS，隔離 branch stack :8005/:49103）+ API 硬證（71 失敗·storey FL1/FL2·8/8 非 null）
- [x] 5.3 evidence `docs/evidence/a1-m1-closeout/`（summary + 2 截圖，tracked）
- [x] 5.4 對抗複驗（P5）closed：修 product-console / minio E2E regression + console.test fixture schema
