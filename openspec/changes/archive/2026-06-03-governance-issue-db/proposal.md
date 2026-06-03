## Why

A1（rule-run）產出帶 `ifc_guid` 的失敗構件、A2（diff）產出變更構件，但目前**沒有 issue 生命週期**可把這些發現變成可指派、可追蹤、可交換的 issue。管理層需要 open/assigned/resolved 的 issue 流程；A2 的 issue-impact（resolved/reopened/new）與 BCF 匯出都以此為基礎。

## What Changes

- 擴充落地端 `governance-service`（:49102 loopback）新增 issue tracking：
  - `issues` + `issue_events`（SQLite）：issue 生命週期狀態機（open → assigned → in_progress → resolved/rejected → reopened）+ 每次變更寫 audit（BCF rule 9：可重播、可驗證）。
  - **BCF 對齊**：issue 綁 `model_version_id` + `ifc_guid`（主鍵，BCF rule 3/4）；**無 `ifc_guid` 只能建 `kind=annotation`（視覺標註），不得當正式可交換 issue（BCF rule 10）**。
  - 來源綁定：`POST /api/issues/from-rule-run/{id}`（A1 失敗構件批次建 issue）、`POST /api/issues/from-diff/{id}`（A2 變更構件批次建 issue）。
  - REST：`POST/GET /api/issues`、`GET /api/issues/{id}`（含 events）、`POST /api/issues/{id}/transition`。
- coordinator additive `/api/governance/issues*` proxy（HTTP 透傳）。
- 前端 A1 Issues 頁新增 Issue Center（失敗構件一鍵建 issue、列表、狀態轉換）。

## Capabilities

### New Capabilities

- `governance-issue-tracking`：落地端 issue 生命週期 + audit + BCF-aligned 來源綁定（ifc_guid 主鍵、無 guid 僅標註），經 coordinator proxy，**不復活** 2026-05-21 退役的 socket collaboration server-push。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder:
  - `governance-service/issues/`（store / api）；`app.py` 一行 include_router。
  - `bim-review-coordinator/src/routes/governanceProxy.ts`（additive issues proxy）。
  - `web-viewer-sample/src/console/`（Issues 頁 Issue Center + governanceClient issue 方法）。
- API / data shape:
  - 內部 :49102 新增 `/api/issues*`；coordinator `/api/governance/issues*`；外部契約不變。
- Runtime boundary:
  - issue 權威在 `governance-service`；coordinator 僅 HTTP 透傳。**非**復活退役的 socket `getReviewIssues`/`createAnnotation`/server-push（那是不同機制）。瀏覽器只打 :8004。
- Dependencies:
  - 無新增生產依賴（SQLite stdlib）。
- Non-goals:
  - 不做 BCF .bcfzip 匯出（另一 change）、不做 socket 即時廣播、不取代外部雲端 control-plane 成為 issue 權威於雲端（本服務為落地端 issue 權威；雲端同步另議）。
