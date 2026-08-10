# Linux test deploy verifier hardening bootstrap

- `stack_kind=self_referential_bootstrap`
- Pull request: #484
- Baseline: freshly fetched `origin/main` at `89ff9c8b773da9a3c0c44990e2267f70f4e8007d`
- This is isolated branch bootstrap evidence. It is not canonical post-change evidence and does not claim full-system E2E completion.

## Why bootstrap evidence is required

The canonical Linux deployment transport consumes only freshly fetched `origin/main`. Pull request #484 changes that deployment and verification mechanism, so the branch cannot produce canonical post-change evidence before merge. The open ledger entry requires a mainline fixpoint rebuild and re-verification after merge.

## Observations

- The canonical baseline rebuild completed from the recorded `origin/main` commit and created deployment tag `deploy-20260810-639219377529672976-002`.
- The owner-provided temporary environment staging was removed after use.
- The canonical remote checkout had 2,205 pre-reset changes; the explicitly authorized reset/clean completed as part of the rebuild.
- The branch hardener and strict adapter preflight completed in the isolated bootstrap run.
- The verified native CAD entrypoint matched its pinned digest and size and had mode `0400` after hardening.
- The currently deployed baseline runtime still reports `hoops_entrypoint_missing` because the pre-change resolver cannot traverse the approved top-level cache link. This is expected to remain open until the fixpoint rebuild deploys merged code.
- Owner-private ACL restoration was independently verified after deployment access ended.

## Fixpoint obligation

After pull request #484 merges, rebuild the canonical Linux test target from freshly fetched `origin/main`, rerun the same verification contract, record the merged mechanism commit and canonical evidence, then close the ledger entry. Full-system browser, Kit first-frame, stage, and DataChannel E2E are not claimed by this bootstrap.
