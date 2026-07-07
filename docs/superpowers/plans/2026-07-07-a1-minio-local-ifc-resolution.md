# A1 MinIO Downloaded IFC Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A1 的 MinIO 下拉選單可以選到 watcher 已下載並建立 review session 的 IFC；A1 rule-run 必須走 coordinator `for-session` proxy，由 coordinator 解析 downloaded server-local IFC path，不得把 MinIO object key 或 browser-supplied host path 送進 generic rule-run。

**Architecture:** 前端在 A1 mount 時讀 `getMinioObjects()` 與 `listIfcReady(100)`，用 `MinioObject.idempotency_key` 對 `IfcReadyListItem.idempotency_key`。只有 matching ifc-ready job 同時具備 `download_status === "downloaded"` 與 `review_session_id` 時，MinIO pick 才會鎖定對應 session 並啟用 A1 rule-run；rule-run 呼叫 `POST /api/governance/rule-runs/for-session/:sessionId`。若找不到 downloaded/session 證據，UI 顯示 honest blocked state 並保持 disabled。

**Tech Stack:** React 18 + TypeScript + Vitest；只使用既有 `coordinatorClient` / `governanceClient`，不新增 backend API，不新增 production dependency。

**Spec Source:** 使用者最新指令：MinIO 資料由自動監控系統下載並轉檔，因此 A1 下拉不應指向 raw MinIO object key；應指向已下載後可檢核的地方。Repo product contract 仍要求 A1 不直接觸發 conversion，3D/highlight 由 Review Room 負責。

## Constraints

- 不改 governance-service 檔案，不改 coordinator backend route contract。
- 不把 raw MinIO key 傳入 `ifc_source_path`。
- 不讓 browser 產生或信任任意 server-local path；A1 MinIO path resolution 優先使用 `review_session_id` + `createRuleRunForSession`。
- 沒有 matching `idempotency_key`、尚未 downloaded、或沒有 `review_session_id` 時，A1 必須顯示 blocked/pending/error，不能假裝可檢核。
- A1 不排 conversion、不 embed viewer、不 claim viewer lease、不直接 highlight。
- 修改 symbol 前跑 GitNexus impact；commit 前跑 GitNexus detect_changes。

## File Plan

- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`
  - 補齊 `IfcReadyListItem` 的 downloaded/session resolution 錯誤欄位型別；不讓 A1 依賴 browser-visible server path。
- Modify: `web-viewer-sample/src/console/pages.tsx`
  - A1 mount 載入 ifc-ready jobs。
  - 用 idempotency key 解析 selected MinIO object 的 downloaded/session state。
  - MinIO pick 只在 `downloaded + review_session_id` 時啟用，鎖定 session 並把 state 標為 session-backed。
- Modify: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`
  - TDD 新增 MinIO downloaded/session happy path。
  - 保留 raw key 不可送 `ifc_source_path` 的 negative path。

## Tasks

- [x] Step 1: Add frontend red tests for MinIO downloaded/session resolution.
  - Test matching `idempotency_key` + `download_status=downloaded` + `review_session_id` enables pick/run.
  - Assert `createRuleRunForSession(sessionId, ...)` is called.
  - Assert `createRuleRun` is not called and raw MinIO key never appears in `ifc_source_path`.
  - Test no matching job or no session keeps pick/run disabled with honest note.

- [x] Step 2: Add DTO fields in `coordinatorClient.ts`.
  - Add optional `download_failure` and `source_ifc_etag` to match existing wire shape where needed.
  - Do not add A1 dependencies on `local_path` / `host_local_path`; downloaded path remains coordinator-internal and is resolved by `for-session`.

- [x] Step 3: Implement A1 resolver.
  - Load `listIfcReady(100)` in A1.
  - Derive `selectedMinioObject`, `selectedMinioJob`, and `selectedMinioSessionId`.
  - Enable MinIO `a1-step-pick` only when the matching job is downloaded and has a `review_session_id`.
  - On pick, reset stale results, set `selectedSession`, and dispatch `PICK_FILE` with a non-path session marker so run button becomes enabled while `doRun` uses `createRuleRunForSession`.

- [x] Step 4: Validation.
  - Run `npm test -- src/console/A1ViewerEmbed.test.tsx` in `web-viewer-sample`.
  - Run `npm run build` in `web-viewer-sample`.
  - Rerun coordinator targeted test if frontend depends on for-session assumptions.

- [x] Step 5: Review gates.
  - Run GitNexus `detect_changes`.
  - Inspect `git diff --check`.
  - Confirm no server path or MinIO key is newly exposed as a trusted generic rule-run input.

- [ ] Step 6: Ship workflow.
  - Commit on `fix/a1-minio-local-ifc-resolution`.
  - Push branch.
  - Create PR in Traditional Chinese.
  - Check PR status and report whether it is mergeable.

## Execution Notes

- PR: https://github.com/monkey1sai/AI-BIM-governance/pull/305
- CI note: `pr-review-agent` requires the PR body `Frontend Verification` table. The PR body was updated after the first run; this plan records that workflow note so a new branch push triggers checks with the updated PR payload.
