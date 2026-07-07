# A1 MinIO Local IFC Resolution Design

> 文件性質：formal spec evidence（`docs/superpowers/specs/*.md`）。本檔作為 PR #305 的 documented exception / requirement source；不新增 active OpenSpec change，因本 repo 目前以 Superpowers specs 承接 behavior/code PR 的 formal evidence。

## Problem

A1 的 MinIO 下拉原本只顯示 raw MinIO object key，並刻意禁止把 key 當 `ifc_source_path` 送到 governance-service。使用者指出 MinIO 來源其實已由 watcher 自動監控、下載並進入轉檔 / review session 流程；因此 A1 不應停在 raw object key，而應找到已下載後可檢核的 session-backed 來源。

## Requirements

1. A1 MUST match a selected MinIO `source_ifc` object to an ifc-ready job by `idempotency_key`.
2. A1 MUST only enable MinIO-backed rule-run when the matching ifc-ready job has `download_status === "downloaded"` and a non-empty `review_session_id`.
3. A1 MUST call `POST /api/governance/rule-runs/for-session/:sessionId` for MinIO-backed rule-runs.
4. A1 MUST NOT send raw MinIO object keys or browser-supplied host paths as `ifc_source_path` to generic `POST /api/governance/rule-runs`.
5. A1 MUST keep blocked / pending / failed states honest when the matching job is missing, not downloaded, or lacks a review session.
6. A1 MUST NOT trigger conversion, embed the viewer, claim viewer lease, or send highlight commands; Review Room remains owner of 3D attach / highlight evidence.

## Verification

- Unit: `npm test -- src/console/A1ViewerEmbed.test.tsx`
- Browser: `npm run test:e2e -- e2e/a1-minio-local-resolution.spec.ts`
- Backend contract: `npm test -- tests/governance-rule-run-for-session.test.ts`
