# A1 MinIO downloaded IFC rule-run without review session

Status: implemented in PR #316 (`fix/a1-minio-downloaded-rule-run`)

## Trigger

Runtime diagnosis on 2026-07-08 showed an A1 operator flow where a MinIO
`source_ifc` object was already downloaded to the edge host, but A1 still stayed
blocked on "IFC->USD schedule / Review Room creates session". That made CPU
governance depend on a 3D review-session artifact even when the server-local IFC
needed by governance-service already existed.

This document is the formal spec evidence / documented exception for the
behavior and repo-boundary change. OpenSpec active changes are retired for this
repo; `docs/superpowers/specs/*.md` is the formal design-evidence path consumed
by `pr-review-agent`.

## Decision

A1 CPU rule-run may start from a MinIO IFC-ready job without a review session
when all of these are true:

- the IFC-ready job exists in the coordinator store;
- `download_status` is `downloaded`;
- the coordinator can resolve a server-local IFC path from the job;
- the source IFC path passes the existing server-side source-path check.

The browser must not send a MinIO key, browser path, host path, or downloaded
artifact path to governance-service. The browser only sends the non-secret
`ifc_ready_job_id` to the coordinator. The coordinator is the only component that
resolves `ifc_source_path` and forwards it to loopback governance-service.

Session-backed MinIO jobs continue to use the existing
`/api/governance/rule-runs/for-session/:sessionId` path. No-session downloaded
jobs use the new
`/api/governance/rule-runs/for-ifc-ready/:jobId` path.

When A1 has locked an `ifc-ready://<jobId>` source, that locked source takes
precedence over a manually selected review session. A later session selection
must not silently reroute the run to an unrelated session/model.

## Non-goals

- Do not create a Review Room session from A1.
- Do not trigger IFC->USD conversion from A1.
- Do not claim Kit/WebRTC or 3D visual E2E completion.
- Do not make `ifc_ready_job_id` an authorization token.
- Do not expose this endpoint as multi-tenant/public without a real
  coordinator user/tenant authorization layer.

## User-visible behavior

In `/#a1`, selecting a MinIO `source_ifc` with a downloaded IFC-ready job and no
`review_session_id` should show that the rule-run will use the coordinator
`ifc-ready` proxy, enable the pick/run flow, and display the A1 rule-run
scoreboard after the run succeeds.

If the downloaded source IFC is stale or missing, A1 must stay blocked and show
the stale reason instead of falling back to direct browser paths or MinIO keys.

## Validation evidence

- `bim-review-coordinator npm run verify`
- `web-viewer-sample npm run verify`
- `web-viewer-sample npm run test:session-first`
- `web-viewer-sample` Playwright:
  `npx playwright test e2e/a1-minio-local-resolution.spec.ts --reporter=list`
- `git diff --check`
- `gitnexus detect-changes --scope staged --repo AI-BIM-governance`

The expected GitNexus risk is high because the change touches coordinator
governance proxy and A1 user-facing route behavior.
