## 1. Baseline 與觀測矩陣

- [x] 1.1 重新確認目前 branch、HEAD、`origin/main` 對齊狀態與工作區乾淨度。
- [x] 1.2 盤點現行 OpenSpec specs、active changes、roadmap §1.3 runtime evidence 與最近 `docs/verification/` 報告，標記哪些只能當 historical reference。
- [x] 1.3 建立 demo observation matrix，至少包含 service health、API smoke、tests/builds、worker conversion/artifact readiness、review session lifecycle、Socket.IO collaboration、browser E2E、Kit/WebRTC runtime、dedicated multi-Kit capacity。
- [x] 1.4 為每個 tier 預先定義 status 欄位：`passed`、`failed`、`blocked`、`deferred`、`not_observed`，並記錄預期 evidence 欄位。

## 2. Service Health 與啟動前條件

- [x] 2.1 檢查 `_bim-control`、`_worker`、`bim-review-coordinator`、`web-viewer-sample`、`bim-streaming-server` 的 README / runbook / root scripts 啟動入口。
- [x] 2.2 檢查 8001、8005、8004、5173、49100 與相關 stream/media ports 是否已有服務監聽，記錄 PID、process name 與 health endpoint 結果。
- [x] 2.3 若服務未啟動，依 repo-local script 或 runbook 啟動可運行服務；Kit/GPU 不可用時記錄 blocker，不用 retired services 補位。
- [x] 2.4 記錄 Python/Node/Kit/GPU/browser automation prerequisites，包括缺失套件、版本漂移或 sandbox 權限限制。

## 3. API、Tests 與 Contract Evidence

- [x] 3.1 在 `_bim-control` 服務目錄執行 focused pytest，至少涵蓋 review session requests / lifecycle API。
- [x] 3.2 在 `_worker` 服務目錄執行 focused pytest，至少涵蓋 artifact intake、conversion result、quality/lineage 或目前 active worker blocker 相關 tests。
- [x] 3.3 在 `bim-review-coordinator` 執行 `npm test` 或最小可用 focused suite，記錄 session / Kit pool / Socket.IO coverage。
- [x] 3.4 在 `web-viewer-sample` 執行最小 contract/build 檢查，記錄已知 lint pre-existing errors 是否仍只屬既有狀態。
- [x] 3.5 執行可用的 root smoke scripts，例如 `scripts/dev-health-check.ps1`、`scripts/smoke-worker-review-request.ps1`、`scripts/smoke-review-session.ps1`、`scripts/smoke-review-socket.ps1`，並保留 command output 摘要。
- [x] 3.6 執行 `bim-streaming-server` non-GPU contract check；若 Kit SDK 或 GPU 不可用，分類為 `blocked` 而非 `failed`。

## 4. Worker Artifact / Conversion 現況觀測

- [x] 4.1 盤點 repo-local storage fixture root 與 `WORKER_DEV_STORAGE_ROOT` resolution，記錄 IFC fixture count 與 selected fixture identity。
- [x] 4.2 執行最小 worker artifact upload / conversion / readiness path，記錄 `source_artifact_id`、`conversion_job_id`、`artifact_group_id`、artifact URLs、mapping URLs 與 readiness status。
- [x] 4.3 若 active `optimize-worker-source-entity-enumeration` blocker 尚未解，記錄 canonical `--limit 1` 目前 status、last known phase、timeout 或 optimization dependency。
- [x] 4.4 分離記錄 API success、real conversion success、mapping quality、lineage API status 與 visual preview readiness，不互相代替。

## 5. Review Session 與 Collaboration 現況觀測

- [x] 5.1 以 `_worker` artifact 或可用 fixture 建立 review session request，記錄 `_bim-control` request status、required artifact readiness 與 lifecycle events。
- [x] 5.2 透過 `bim-review-coordinator` 建立或查詢 session，記錄 `session_id`、`artifact_bindings[]`、`kit_instance_bindings[]`、stream config 與 lifecycle audit events。
- [x] 5.3 執行 Socket.IO collaboration smoke，至少涵蓋 join/presence 與一個 selection 或 annotation event，記錄 broadcast 與 `_bim-control` persistence result。
- [x] 5.4 執行 session close / release observation，記錄 `closing`、`closed`、`kitInstanceReleased` 或 blocker。

## 6. Browser / Kit / WebRTC 現況觀測

- [x] 6.1 開啟 `web-viewer-sample` demo route 或 session-first route，記錄 URL、session bootstrap status、API panels 與錯誤 banner。
- [x] 6.2 若 Kit signaling 可用，執行 single Kit browser observation，記錄 WebRTC readiness、video dimensions、DataChannel response、`openedStageResult`、screenshot 或 blocker。
- [x] 6.3 若 primary / spectator stream topology 可用，執行 same-Kit concurrent observation，記錄 primary 與 spectator 各自 screenshot、video readiness 與 session continuity。
- [x] 6.4 若少於兩個 live GPU-backed Kit endpoints，將 dedicated multi-Kit runtime tier 標為 `deferred` 或 `blocked`，不得宣稱 passed。
- [x] 6.5 若 browser automation 或 GUI 權限不可用，記錄可替代的 manual observation 或 `not_observed`，並列出下一個可重跑步驟。

## 7. Evidence、Roadmap 與驗證收斂

- [x] 7.1 建立 `docs/verification/<date>-demo-current-runtime-observation.md`，用 observation matrix 彙整每個 tier 的 current status、命令、IDs、evidence paths 與 blockers。
- [x] 7.2 將 screenshots / JSON summaries / command summaries 放在 matching `docs/verification/evidence/<date>-demo-current-runtime-observation/` 目錄。
- [x] 7.3 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 的 runtime evidence 與 active change 狀態；沒有新 runtime evidence 的項目不得標 passed。
- [x] 7.4 由同名 Markdown 重新產生 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html`。
- [x] 7.5 執行 `openspec validate demo-current-runtime-observation --strict`。
- [x] 7.6 執行 `git diff --check` 與 GitNexus detect changes；若只修改 OpenSpec/docs，回報無 code symbol impact。
- [x] 7.7 回報完成狀態：哪些 tier passed、failed、blocked、deferred、not_observed，哪些需要後續 implementation change。
