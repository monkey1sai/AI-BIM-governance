## Context

此 workspace 已經有多個已歸檔驗證結果，包含 review-session lifecycle、Socket.IO collaboration、worker real conversion evidence、same-Kit browser runtime evidence，以及 canonical storage batch blocker evidence。不過目前 live demo 狀態仍可能漂移，因為 Python packages、Node dependencies、Kit/GPU availability、worker storage roots 與 active services 都是本機 runtime 事實。

此 change 建立以 demo 為核心的 observation pass。它是 cross-cutting，因為報告必須描述 `_bim-control`、`_worker`、`bim-review-coordinator`、`bim-streaming-server` 與 `web-viewer-sample` 之間的最小 review loop；但它不移動任何服務的 ownership。

## Goals / Non-Goals

**Goals:**

- 為 demo runtime 產出目前這台機器上 repo-local 的 observation report。
- 重新執行或明確分類每個 current demo tier：service health、API smoke、focused tests/builds、worker conversion/artifact readiness、review session lifecycle、Socket.IO collaboration、browser E2E、Kit/WebRTC runtime，以及 dedicated multi-Kit capacity。
- 記錄可重播的 evidence：commands、timestamps、ports、service URLs、`review_request_id`、`session_id`、`conversion_job_id`、`artifact_group_id`，以及可取得時的 screenshots 或 machine-readable summaries。
- 將 `passed`、`failed`、`blocked`、`deferred`、`not_observed` 清楚分開，讓讀者能理解真正的 current state。
- 只根據 current evidence 或明確標示的 historical references 更新 roadmap status。

**Non-Goals:**

- 此 proposal 不實作 product feature。
- 除非後續 apply phase 找到缺口並另外界定修補範圍，否則不變更 API、event schema、storage layout、session lifecycle、Kit runtime 或 browser UI contract。
- 不把已 retired 的 `_s3_storage`、`_conversion-service` 或 `_conversion-server` 復活成 current demo dependencies。
- 在至少兩個 live GPU-backed Kit endpoints 可用前，不宣稱 dedicated multi-Kit runtime 通過。
- 不處理 production observability、SLA、SSO、tenant billing 或 deployment platform。

## Decisions

1. **Observation before fixing.**
   - 原因: 使用者要求是驗證與觀測目前 demo，而不是擴充 product surface。
   - 做法: 第一個 implementation pass 只記錄 current behavior 與 blockers。任何需要 code changes 的 defect 都要保留成獨立且明確界定的 task 或 follow-up change。
   - 未採用方案: 在同一個 pass 裡順手修所有 failed checks。這會混合 observation evidence 與 feature work，讓報告難以審查。

2. **Use a stable status matrix.**
   - 原因: 如果把 API-only success、conversion success、browser readiness 與 GPU render evidence 都壓成單一 "E2E" 標籤，過去 evidence 很容易被誤讀。
   - 做法: 每個 tier 都只有一個 current status：`passed`、`failed`、`blocked`、`deferred` 或 `not_observed`。Historical evidence 可以引用，但 current status 必須說明本次是否重新執行。
   - 未採用方案: 只用單一 pass/fail checklist。這會隱藏 hardware 與 capacity blockers。

3. **Keep ownership-specific checks.**
   - 原因: 每個 service 都有清楚的 source-of-truth boundary。
   - 做法: `_bim-control` 檢查 metadata/review intent，`_worker` 檢查 file/conversion/artifact readiness，coordinator 檢查 session/collaboration，viewer 檢查 browser interaction，streaming server 檢查 Kit/WebRTC runtime。
   - 未採用方案: 只用一個 root smoke 宣稱整個 demo 健康，卻不說明 evidence 是由哪個 service 產生。

4. **Archive replayable evidence under docs.**
   - 原因: demo observations 只有在未來可比較 commands、IDs、screenshots 與 blockers 時才有價值。
   - 做法: 將 human report 存在 `docs/verification/`，並在產生 screenshots 或 JSON summaries 時放到對應的 `docs/verification/evidence/<date>-demo-current-runtime-observation/` folder。
   - 未採用方案: 只把 evidence 留在 terminal output 或 browser state。

5. **Treat GPU and Kit as environment-limited tiers.**
   - 原因: Kit runtime 與 dedicated multi-Kit evidence 依賴 local GPU、Kit build、ports 與 stream topology。
   - 做法: 如果目前環境無法執行某個 tier，就記錄 missing prerequisite 與 next runnable step。不得把 blocker 轉寫成 pass。
   - 未採用方案: 在 required runtime 不可用時把 GPU tiers 標成 failed，或只因 health ports reachable 就標成 passed。

## Risks / Trade-offs

- **Risk: Current environment is partially configured.** -> Mitigation: 精確記錄 dependency 與 service startup blockers，包含 cwd、port、command 與 missing prerequisite。
- **Risk: Historical evidence masks drift.** -> Mitigation: 將舊 evidence 標示為 historical reference，並要求 current rerun 或明確的 `not_observed` status。
- **Risk: Broad "all features" scope becomes unfocused.** -> Mitigation: 將此 pass 限定在 current demo loop 與 `openspec/specs/` 既有 OpenSpec specs。
- **Risk: Observation finds a code defect.** -> Mitigation: 用 evidence 捕捉 defect，除非修補極小且已被明確批准，否則把 fix 留到 follow-up implementation task 或另一個 OpenSpec change。
- **Risk: Long-running conversion or browser checks exceed local time budget.** -> Mitigation: 記錄 timeout、elapsed duration、last known phase，以及結果是 `blocked`、`failed` 或 `not_observed`。
