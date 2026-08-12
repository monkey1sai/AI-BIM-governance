> Document nature: **working note**. This file is bootstrap evidence, not an authoritative runtime, API, or deployment specification.

# Mechanism hardening 2 bootstrap

- `stack_kind=self_referential_bootstrap`
- Pull request: see the ledger entry `mechanism-hardening-2` (`pr` field is the binding record)
- Baseline: freshly fetched `origin/main` at `472192386f8402cf19a29005daf25556d26f222c`
- Reviewed head: `110c657fd620e3bdbac4379ac716da99d37848b9` (round 2), `d63453024f59b13714ed222ea14bdc34a2890253` (round 3) and `3044e788ae2a741ea1f877f3353874cc31d606ad` (round 4), worktree clean at each — `git status --porcelain` produced no output at any of them
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

Local mechanism suites on the branch head, on Windows with PowerShell 7.5.4. The recorded results are in `verification.txt`, split into the two rounds that produced them: the initial bundle at the baseline, and the PR #513 review round at the reviewed head above. Each `PASS` line names either a command id that resolves through the immutable command map in `scripts/tests/test-self-referential-bootstrap.ps1`, or its resolved invocation inline when that map does not carry the id.

## Round 2: PR #513 ship-gate findings

The Codex tri-adversarial ship-gate returned NO-SHIP on four findings against `Stop-HostNativeProcessTreeAndWait`, and the PR review threads named the same defects. All four are closed at the reviewed head: the pre-entry `HasExited` return no longer skips descendant containment, descendant stops are identity-revalidated against PID reuse, containment is a bounded re-enumerating fixed point rather than one snapshot, and the tree-kill capability decision is injectable so the Windows PowerShell 5.1 fallback is exercised as behaviour. The round also restored `-DryRun` adjudication of `KIT_CONTROL_URL` and put `test-host-native-launcher.ps1` into the required `rebuild-test-deploy` CI job, which is why `.github/workflows/ci.yml` and `scripts/verification-manifest.json` joined this entry's `verification_mechanism_paths`.

## Round 3: PR #513 ship-gate second pass

A second gate pass found three more defects in the same helper, all real. The exited-parent sweep added in round 2 is only sound where the OS keeps the creator PID on an orphan — measured as true on Windows and false on Linux, where the kernel re-parents orphans — so that platform fact now lives in `Test-OrphanRediscoverySupported` and the helper fails closed where PPID rediscovery cannot prove containment, naming the caller as the authoritative boundary and accepting a pre-exit descendant record as the escape. Reaching the deadline is no longer treated as a clean containment pass. `TimeoutMs` is now one end-to-end budget spanning discovery, termination, the parent wait, and every containment pass.

Both behavioural regressions were confirmed against the previous implementation before the fix, not merely argued: the clean-pass scenario returned success after discovering twelve descendants, and the slow-discovery scenario overran its advertised bound by 1286 ms. The POSIX branch of the platform gate is proven on this host through the injected capability decision; it has not been executed on a real re-parenting kernel, which is recorded as a limit in `verification.txt`.

## Round 4: narrowing the claim instead of chasing the next window

Three gate rounds each produced a HIGH against the same helper, and each one was a different way of saying that a PPID-based sweep cannot deliver inescapable containment. Round 4 stops patching windows and fixes the claim: `Stop-HostNativeProcessTreeAndWait` is now documented, messaged and tested as a **bounded best-effort sweep with a fail-closed provability report** — never "nothing survived". Inescapable containment needs an OS boundary established at launch, which is tracked separately in [#517](https://github.com/monkey1sai/AI-BIM-governance/issues/517) and its `Start-HostNativeService` follow-up.

The `-KnownDescendantProcessIds` escape hatch was removed: it existed only to let the helper keep claiming provable containment on a re-parenting platform, and neither production caller used it.

The round's remaining HIGH — a descendant appearing between enumeration and the following stop — was **refuted by measurement**, and that measurement is now a regression case. One residual survives it and is documented rather than closed, because closing it would trade a fail-open gap for a fail-dangerous one; see `verification.txt` for both.

## Limits

- No canonical Linux rebuild and no canonical deployment verification were executed for this bundle. Both are recorded in the entry's verification contract and are owed at fixpoint.
- The Linux leg of the verifier (`pwsh scripts/verify-all.ps1 -Profile Deployment -PlanOnly` on the canonical target) was not executed from this workstation; only the Windows leg was.
- Full-system browser, Kit first-frame, stage, and DataChannel E2E are not claimed.

## Fixpoint obligation

After this pull request merges, rebuild the canonical Linux test target from freshly fetched `origin/main`, rerun the entry's verification contract in full, record the merged mechanism commit and the canonical evidence under `docs/evidence/mechanism-hardening-2/fixpoint/`, and close the ledger entry with its attestation.
