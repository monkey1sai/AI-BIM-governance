> Document nature: **working note**. This file is bootstrap evidence, not an authoritative runtime, API, or deployment specification.

# Linux test deploy verifier hardening bootstrap

- `stack_kind=self_referential_bootstrap`
- Pull request: #484
- Baseline: freshly fetched `origin/main` at `89ff9c8b773da9a3c0c44990e2267f70f4e8007d`
- This is isolated branch bootstrap evidence. It is not canonical post-change evidence and does not claim full-system E2E completion.

## Why bootstrap evidence is required

The canonical Linux deployment transport consumes only freshly fetched `origin/main`. Pull request #484 changes that deployment and verification mechanism, so the branch cannot produce canonical post-change evidence before merge. The open ledger entry requires a mainline fixpoint rebuild and re-verification after merge.

## Observations

- The initial baseline run used a fresh sibling worktree pinned to the recorded `origin/main` commit. The recorded baseline below is a later regular-form rerun executed with the branch wrapper at head `1b764e24f04e07c63257c977aa924b02fc58d28e`; the deployment transport itself consumes only freshly fetched `origin/main`, so the deployed source is independent of the caller checkout.
- The recorded baseline canonical rebuild used the regular form `pwsh -NoProfile -NonInteractive -File scripts/dev/rebuild-test-deploy.ps1 -Build -InventoryPath '<owner-private-inventory>'` — no explicit `-TargetId`; the wrapper resolves the registry `canonical_target` — with the owner-controlled private inventory, deployed source commit `a93c5a34cfef7bb6f3fdd5d20c287d9c83c89ea1`, and created deployment tag `deploy-20260811-639220225263578177-002`. This is bootstrap evidence pending the post-merge fixpoint, not canonical post-change proof.
- The owner-provided temporary environment staging was removed after use.
- The canonical remote checkout had 2,205 pre-reset changes; the explicitly authorized reset/clean completed as part of the rebuild. That remote cleanup is an operational observation, not evidence that the local source baseline was isolated.
- The branch hardener and strict adapter preflight completed in the isolated bootstrap run.
- The verified native CAD entrypoint matched its pinned digest and size and had mode `0400` after hardening.
- The currently deployed baseline runtime still reports `hoops_entrypoint_missing` because the pre-change resolver cannot traverse the approved top-level cache link. This is expected to remain open until the fixpoint rebuild deploys merged code.
- Owner-private ACL restoration was independently verified after deployment access ended.

## Fixpoint obligation

After pull request #484 merges, rebuild the canonical Linux test target from freshly fetched `origin/main`, rerun the same verification contract, record the merged mechanism commit and canonical evidence, then close the ledger entry. Full-system browser, Kit first-frame, stage, and DataChannel E2E are not claimed by this bootstrap.
