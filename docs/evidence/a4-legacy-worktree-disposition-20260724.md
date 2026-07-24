# A4 legacy worktree disposition — 2026-07-24

## Purpose

This ledger records the disposition of the two pre-convergence A4 worktrees before any ref cleanup. It is not a claim that their commits were exactly merged. It separates current-main successors from local work that still needs an explicit re-home.

Source snapshots:

- `codex/openspec/a4-semantic-search-model-qa` at `0cfaa66a5a795f7929e54928c3edb35e3061ced5`
- `codex/openspec/a4-semantic-search-model-qa-convergence` at `c36f1f0e7db94b70640f4ae573b3347ee82e02c4`
- Comparison base: `origin/main` at `64cadb06c8eba6400aecb8f75125dd2f7df2e1b7`

The source branches and worktrees remain intact. Sanitized binary patches were captured outside the source worktrees and passed reverse-apply checks. They include the three modified PNG files but deliberately exclude environment samples and the LLM runbook so removed credential or endpoint preimages are not duplicated. Those excluded files remain recoverable from the protected source worktree, and their approved fail-closed form is re-homed by this branch. No environment value is reproduced in this document.

Local verification snapshot, with locators relative to the primary workspace root `C:\Repos\active\iot\AI-BIM-governance` (gitignored and therefore not a substitute for the source refs/worktrees):

- `.workflow/worktree-quarantine/20260724-step2-a4/original.sanitized.binary.patch` — 3,615,906 bytes, SHA-256 `652B77B242B458BB9C32A1077571080F8AC17D58A584585FDE124DC9A587F077`
- `.workflow/worktree-quarantine/20260724-step2-a4/convergence.sanitized.binary.patch` — 33,770 bytes, SHA-256 `3B06B99D41026211EDF1F2B9A585F2930C3F949B1AC804FA05A11236C473808E`

Both patches passed `git apply --check --reverse` against their source worktree. A future `git clean -fdx` can remove this local snapshot, so the protected source refs/worktrees remain the durable recovery anchors.

## Committed-path disposition

The original branch changes 33 committed paths; the convergence branch changes 42. The convergence set is the superset used below, so every committed path is covered exactly once by one of the following categories.

### `already-main` — exact current-main blobs (4)

- `_fixtures/a4-semantic-search/README.md`
- `_fixtures/a4-semantic-search/a4_fire_doors.ifc`
- `_fixtures/a4-semantic-search/element_mapping.json`
- `bim-review-coordinator/src/services/a4HandoffStore.ts`

### `evidence-only` — historical lineage (1)

- `docs/superpowers/plans/2026-07-16-a4-semantic-search-model-qa.md`

The 690-line plan documents the abandoned large-branch delivery path. It contains stale workflow and worktree instructions, so it must not be restored as an active plan. The original branch remains its Git anchor.

### `superseded-by-current-main` — do not replay old committed blobs (37)

Tracked samples and runbook; their newer dirty convergence form is handled separately below:

- `.env.example`
- `env.sample`
- `docs/runbooks/a4-ornith-llm.md`
- `bim-review-coordinator/.env.example`

Coordinator S2/S4 routing and tests, superseded by PRs #380, #384, #393 and #398:

- `bim-review-coordinator/README.md`
- `bim-review-coordinator/src/app.ts`
- `bim-review-coordinator/src/routes/a4HandoffRoutes.ts`
- `bim-review-coordinator/src/routes/governanceProxy.ts`
- `bim-review-coordinator/tests/a4-handoffs.test.ts`
- `bim-review-coordinator/tests/dev-console.test.ts`
- `bim-review-coordinator/tests/governance-search-for-session.test.ts`

Governance search, issue, proof and tests, superseded by PRs #365, #383 and #398:

- `governance-service/issues/api.py`
- `governance-service/issues/store.py`
- `governance-service/search/api.py`
- `governance-service/search/engine.py`
- `governance-service/search/interpreter.py`
- `governance-service/search/llm_client.py`
- `governance-service/search/proofs.py`
- `governance-service/tests/test_a4_issue_provenance.py`
- `governance-service/tests/test_search_handoff_api.py`
- `governance-service/tests/test_search_llm.py`
- `governance-service/tests/test_search_model.py`

Viewer and E2E committed blobs, superseded by the later S4-B/S4 UI implementation in PRs #384 and #386. Their newer dirty UI intent is handled separately below:

- `web-viewer-sample/e2e/a4-closeout.spec.ts`
- `web-viewer-sample/e2e/a9-a10-identity-a4-primary.spec.ts`
- `web-viewer-sample/e2e/design-system-semantic-cases.ts`
- `web-viewer-sample/src/console/A4SemanticSearchPage.test.tsx`
- `web-viewer-sample/src/console/A4SemanticSearchPage.tsx`
- `web-viewer-sample/src/console/EdgeConsole.aliasRedirect.test.tsx`
- `web-viewer-sample/src/console/EdgeConsole.tsx`
- `web-viewer-sample/src/console/governanceClient.test.ts`
- `web-viewer-sample/src/console/governanceClient.ts`
- `web-viewer-sample/src/console/routing.test.ts`
- `web-viewer-sample/src/console/routing.ts`
- `web-viewer-sample/src/console/unified/WorkspacePage.tsx`
- `web-viewer-sample/src/console/unified/dockLiveLink.test.tsx`
- `web-viewer-sample/src/console/unified/docks.tsx`
- `web-viewer-sample/src/console/unified/fixtures.ts`

`superseded-by-current-main` means “do not replay this old blob”; it does not mean the old commit has an exact patch-id or ancestry match.

## Dirty convergence disposition (6 paths, zero unclassified)

### `needs-rehome-now` (4)

- `.env.example`: tracked A4 LLM defaults become disabled and placeholder-only.
- `env.sample`: the same fail-closed tracked-sample posture at the service sample boundary.
- `docs/runbooks/a4-ornith-llm.md`: operator-owned, out-of-repo injection and proof/context transport boundaries.
- `governance-service/tests/test_search_model.py`: only the committed-fixture mapped/unmapped, no-match and truncation contract is reimplemented on current main.

The environment files are copied without changing unrelated current-main values. The test is manually rewritten; the old whole-file fixture refactor is not replayed.

### `stale-discard` (2)

- `docs/plans/NOW.md`: incorrectly says S2 is local and its PR is not open.
- `openspec/changes/a4-semantic-search-model-qa/tasks.md`: stale S2/S3 completion state.

## Dirty original disposition (17 paths, zero unclassified)

### `needs-rehome-after-hifi-convergence` (7)

- `web-viewer-sample/e2e/a4-closeout.spec.ts`
- `web-viewer-sample/src/console/A4SemanticSearchPage.tsx`
- `web-viewer-sample/src/console/A4SemanticSearchPage.test.tsx`
- `web-viewer-sample/src/console/EdgeConsole.tsx`
- `web-viewer-sample/src/console/EdgeConsole.aliasRedirect.test.tsx`
- `web-viewer-sample/src/console/governanceClient.ts`
- `web-viewer-sample/src/console/governanceClient.test.ts`

The immutable behavior handoff is:

- A4 is session-only and uses the coordinator-facing browser API.
- Alias navigation scrubs query, proof, prim and handoff authority material.
- No active session produces a visible unavailable state with no fallback data.
- Semantic errors, partial confirmation, retry and proof-expired drafts remain honest.
- Issue creation requires row-level proof selection and explicit confirmation; outcomes remain row-scoped.
- The A4 console does not directly invoke 3D, WebRTC or DataChannel actions.
- The final browser flow must cover `WorkspacePage.tsx`, `docks.tsx`, `fixtures.ts`, `A4SemanticSearchPage.tsx` and `EdgeConsole.tsx` on the post-Hi-Fi tree.

These files are reference material only until the Hi-Fi safe-token slice is reconciled. They must not be cherry-picked or used as whole-file replacements.

### `superseded-or-stale-discard` (7)

- `docs/runbooks/a4-ornith-llm.md`: the convergence runbook is the retained version.
- `governance-service/search/llm_client.py`
- `governance-service/search/proofs.py`
- `governance-service/tests/test_a4_issue_provenance.py`
- `governance-service/tests/test_search_llm.py`
- `governance-service/tests/test_search_model.py`: except for the separately rewritten committed-fixture contract.
- `openspec/changes/a4-semantic-search-model-qa/tasks.md`

Current main has stronger proof snapshot, replay, resource-bound and issue-persistence coverage. The dirty task ledger also marks unfinished UI authority work complete, so it cannot be reused.

### `evidence-only` (3)

- `artifacts/e2e/a9-a10-identity-a4-primary/a10-ai-decision.png`
- `artifacts/e2e/a9-a10-identity-a4-primary/a9-robot-inspection.png`
- `artifacts/e2e/a9-a10-identity-a4-primary/apps-cards.png`

These screenshots describe the old tree. Their bytes are preserved by the binary patch, but they are not current design or operability evidence.

## Durable destinations and deletion boundary

- Immediate security slice: `fix/a4-ornith-tracked-placeholders`.
- Post-Hi-Fi UI destination: `feat/a4-s4d-session-ui-rehome` from the then-current `origin/main`.
- The two source branches/worktrees remain deletion-protected until every `needs-rehome-*` item has a named destination commit and affected validation.
- The duplicate `codex/safety/a4-s2-backend-checkpoint-20260722` ref may be removed only after this ledger, the binary patches and the convergence ref have been revalidated. Removing that duplicate ref is not evidence that the convergence branch was exactly merged.
