# 2026-07-03 Conversion Ledger Status Reconcile Design

> 形式地位：本檔為 PR #287 的 formal spec evidence（`docs/superpowers/specs/*.md`），用來記錄 `bim-review-coordinator` 轉檔 ledger 狀態回填 bugfix 的 requirement、scope 與驗證。

## Problem

測試部署區 `#conv` 的 MinIO 自動偵測面板曾顯示 `The operation was aborted due to timeout`，但 runtime conversion authority 實際已完成 USDC 轉檔。根因切在 observability / ledger 層：`/api/external/ifc-ready` intake 先把 `ConversionLedger` row 寫成 `queued`，後續 `POST /api/internal/conversion-result` ingest 只更新 external IFC ready store 與 callback outbox，沒有同步把 `/api/conversion/records` 使用的 ledger row 回填成 `ready` 或 `failed`。

這會讓使用者在 `#conv` 看到 stale `queued` / `pending` 狀態，誤判為 IFC 轉檔錯誤。

## Scope

- 當 `ingestConversionReport` 收到 terminal conversion result：
  - `ready` SHALL 回填 `ConversionLedger.status=ready`。
  - 非 `ready` terminal report SHALL 回填 `ConversionLedger.status=failed`。
  - SHALL 保留/回填 `conversion_job_id`、`usdc_key` 與 coverage summary，讓 `/api/conversion/records` 可呈現終局結果。
- Ledger 回填失敗 SHALL NOT 阻斷 conversion result ingest 與既有 callback outbox 流程；此段保持 best-effort。
- 新增 regression test，覆蓋 `POST /api/external/ifc-ready` → `POST /api/internal/conversion-result` → `GET /api/conversion/records` 的 ready 狀態回填。

## Non-Goals

- 不改 MinIO watcher trigger timeout policy。
- 不改 conversion authority 的 IFC→USDC 實作。
- 不改部署腳本或 runtime port / Docker / Kit 設定。
- 不宣告 browser/gstack E2E 完成；本 PR 僅完成 backend ledger consistency fix。

## Acceptance

- `GET /api/conversion/records` 在收到 ready conversion result 後，對應 row SHALL 顯示 `status=ready`、`job_id` 與 `usdc` reference。
- 既有 coordinator build / tests SHALL 通過。
- GitNexus detect_changes SHALL 無 HIGH / CRITICAL risk。
- 測試部署重建仍依 repo contract 從 freshly fetched `origin/main` 執行；PR 未 merge 前，不得宣稱此 fix 已部署到測試區。

## Verification

- `git diff --check`
- `npm run build` in `bim-review-coordinator`
- `npm test` in `bim-review-coordinator`
- GitNexus `detect_changes`
- Post-PR test deployment rebuild evidence documented in PR #287 comment; rebuild deployed `origin/main` commit `a334e49`, not this PR commit.
