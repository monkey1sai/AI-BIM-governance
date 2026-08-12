> Document nature: **working note**. This file is bootstrap evidence, not an authoritative runtime, API, or deployment specification.

# Mechanism hardening 2 bootstrap

- `stack_kind=self_referential_bootstrap`
- Pull request: see the ledger entry `mechanism-hardening-2` (`pr` field is the binding record)
- Baseline: freshly fetched `origin/main` at `472192386f8402cf19a29005daf25556d26f222c`
- This is isolated branch bootstrap evidence. It is not canonical post-change evidence and does not claim full-system E2E completion.

## Scope

Three post-merge findings from the PR #484 Codex tri-adversarial ship-gate, landed together because each one edits a classified verification-mechanism path:

| Issue | Finding | Mechanism path |
|---|---|---|
| #490 | L1-COR-001 — Kit control URL fixed before the `.env` missing-key merge | `scripts/deploy.ps1` |
| #491 | SEC-004 — Deployment profile never applied locality to the Kit control URL | `scripts/verify-all.ps1` |
| #489 | L1-COR-004 — process-tree terminator proved only the parent exited | `scripts/lib/host-native-launcher.ps1` |

They share one ledger entry deliberately. The debt gate admits one open entry at a time, and every entry owes a full canonical Linux rebuild plus deployment verification to close. Splitting these three into separate pull requests would serialise three rebuilds for one coherent hardening round.

## Why this branch cannot produce canonical post-change evidence

The canonical deployment transport rebuilds the Linux test target only from freshly fetched `origin/main` and refuses an unmerged revision. All three changes live inside that transport: the deploy entrypoint that resolves runtime identity, the aggregate verifier that adjudicates the deployed runtime, and the shared launcher primitive both rely on to prove a terminated process tree is gone. A pre-merge run against `origin/main` therefore exercises the unchanged mechanism, and the changed mechanism has no mainline to run on until this merges.

## What this branch did verify

Local mechanism suites on the branch head, on Windows with PowerShell 7.5.4. The recorded results are in `verification.txt`.

## Limits

- No canonical Linux rebuild and no canonical deployment verification were executed for this bundle. Both are recorded in the entry's verification contract and are owed at fixpoint.
- The Linux leg of the verifier (`pwsh scripts/verify-all.ps1 -Profile Deployment -PlanOnly` on the canonical target) was not executed from this workstation; only the Windows leg was.
- Full-system browser, Kit first-frame, stage, and DataChannel E2E are not claimed.

## Fixpoint obligation

After this pull request merges, rebuild the canonical Linux test target from freshly fetched `origin/main`, rerun the entry's verification contract in full, record the merged mechanism commit and the canonical evidence under `docs/evidence/mechanism-hardening-2/fixpoint/`, and close the ledger entry with its attestation.
