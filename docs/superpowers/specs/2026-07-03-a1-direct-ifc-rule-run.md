# A1 Direct IFC Rule Run · Formal Spec Evidence

> Date: 2026-07-03
> Status: documented exception for PR #291
> Scope: `web-viewer-sample/src/console/pages.tsx`, `web-viewer-sample/src/console/a1Machine.ts`, A1 related tests

## Purpose

This document records the formal product evidence for PR #291. The change restores
A1 governance validation to the direct CPU rule-run path after an IFC file is
selected. A review session is no longer required to start validation.

## Requirement

A1 rule validation SHALL run against the selected IFC source path by calling:

```txt
POST /api/governance/rule-runs
```

The request SHALL include the selected IFC path as `ifc_source_path` and MAY include
`ids_path` when an IDS file is selected.

## Non-Requirement

Selecting a review session SHALL NOT be required for CPU rule validation.

Review sessions remain valid only for 3D Review Room handoff, first-frame/stage
matching, element-mapping enrichment, and highlight trace workflows.

## Acceptance Criteria

- Selecting an IFC source enables the A1 run button without selecting a review session.
- Clicking the A1 run button calls `createRuleRun` / `POST /api/governance/rule-runs`.
- `createRuleRunForSession` is not used as the validation gate.
- Review Room and highlight flows remain manually session-gated.
- The reducer rejects `RUN` while no IFC path is selected.

## Evidence

- `npm test -- A1ViewerEmbed.test.tsx console.test.tsx`
- `npm test -- a1Machine.test.ts`
- `npm run verify`
- GitNexus impact on `a1Reducer`: LOW
- GitNexus staged detect_changes: implementation MEDIUM, test-only LOW
