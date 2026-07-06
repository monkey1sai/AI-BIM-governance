# 2026-07-06 Conversion Kit Lifecycle Recovery Design

> 形式地位：本檔為 `$ultracode` workflow 的 formal spec evidence，對應 OpenSpec change `conversion-kit-lifecycle-recovery`。本檔記錄測試部署區診斷後的完整修復範圍、成功標準與驗證策略。

## Problem

測試部署區顯示三個 lifecycle 斷裂：

1. `GET /api/conversions` 列出 `succeeded` job，但 `model.usdc` artifact URL 可回 `404 Not Found`，代表 job JSON 與實體 artifact truth 分裂。
2. 已派工後 converter terminal failed 的 ifc-ready job 不能用現有 retry route 重跑；現有 retry 只適合 dispatch failure。
3. coordinator `kit_instance_bindings.status="ready"` 表示 local-fixed metadata binding，不代表 Kit/GPU 已經 open stage；這與使用者期待的 kill/select/open 完整生命週期不一致。

## Scope

- Streaming conversion authority：
  - ready/succeeded 對外前驗證必要 artifacts 存在且可 serve。
  - persisted ready job 若缺檔，list/detail/result 必須降級為 non-ready anomaly。
- Coordinator：
  - 區分 dispatch retry 與 terminal converter failure re-trigger。
  - 對 failed conversion job 暴露 `retrigger_required` / `reingest_required` 類 recovery action。
  - session/runtime status 區分 binding intent、stage open、first frame。
- Kit manager/runtime：
  - ready artifact 到 Kit open 必須走 kit-manager / streaming runtime control path。
  - metadata binding 不可單獨宣告 stage opened。

## Non-Goals

- 不重建 `D:\Users\deploy\AI-bim-geo`。
- 不 kill live runtime process。
- 不新增多 GPU scheduler / OVAS / K8s fleet。
- 不宣告 full-system E2E complete。
- 不覆蓋其他 active OpenSpec change；本 change 是 recovery/lifecycle truth capability。

## Acceptance

- Missing `model.usdc` 的 persisted succeeded job 不再對 coordinator/UI 表示 ready。
- Terminal converter failed job 的 UI/API recovery 語意是 re-trigger/re-ingest，不是 dispatch retry。
- Review session status 至少可分辨：
  - conversion artifact ready
  - Kit binding intent
  - Kit stage open command/evidence
  - viewer first frame evidence
- Focused tests 覆蓋上述三個行為。
- `npx openspec validate conversion-kit-lifecycle-recovery --strict` 通過。

## Verification

- `npx openspec validate conversion-kit-lifecycle-recovery --strict`
- focused `bim-streaming-server` conversion authority tests
- focused `bim-review-coordinator` conversion/session tests
- focused `services/kit-manager-api` tests if touched
- `git diff --check`
- GitNexus detect_changes

## Risks

- 若沒有部署重建與 browser/gstack E2E，本輪只能驗證 backend/control-plane contract，不能宣告 Kit visual runtime 完整通過。
- 現有 active MinIO trigger change 可能提供部分 re-trigger endpoint；整合時要避免雙重定義同一路由行為。
- `kit_instance_bindings` 既有消費者可能把 `ready` 當 stage-open，需要保留 additive 欄位與誠實 UI 文字，避免 breaking change。
