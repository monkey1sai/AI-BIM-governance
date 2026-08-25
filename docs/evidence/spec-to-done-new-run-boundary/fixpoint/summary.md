# Spec-to-done NEW_RUN boundary classifier fixpoint

- Ledger entry: `spec-to-done-new-run-boundary-classifier`
- Reverified at: `2026-08-25T23:00:54Z`
- Mechanism commit: `2c983944e2a0c56fdfc8bb292f167b13b22c8250`
- Verification contract: `spec-to-done-new-run-boundary-classifier/v1`
- Contract SHA-256: `82d607837a5a7d78ca3e1b2100082f9d018e4333e68c3016931d9a1b95bbd9e3`
- Closure scope: ledger-only post-merge fixpoint evidence and the legal `open` to `closed` transition.
- Fresh-main provenance: branch `codex/governance/spec-to-done-new-run-boundary-classifier-fixpoint` was created from freshly fetched `origin/main`; initial `HEAD` and `origin/main` both resolved to the mechanism commit above and the worktree was clean.

## Frozen verification results

| Order | Command ID | Exit code | Provenance |
|---:|---|---:|---|
| 1 | `test-self-referential-bootstrap` | 0 | Local current-session execution from the fresh `origin/main` fixpoint worktree |
| 2 | `test-agent-governance-check` | 0 | Local current-session execution from the fresh `origin/main` fixpoint worktree; embedded lifecycle suite passed 46/46 |
| 3 | `test-trusted-host-merge` | 0 | Local current-session execution from the fresh `origin/main` fixpoint worktree; 18 passed and one Linux-only test was expectedly skipped on Windows |
| 4 | `invoke-powershell-static` | 0 | Local current-session execution from the fresh `origin/main` fixpoint worktree |
| 5 | `scan-secret-patterns` | 0 | Local current-session execution from the fresh `origin/main` fixpoint worktree |

All commands completed in the immutable contract order. There were no failures or unexpected skips. The test suites used test-owned temporary fixtures and left the tracked worktree unchanged.

## GitNexus and scope evidence

- CLI version: `1.6.9`.
- Exact worktree index: rebuilt with the repository-authorized `npx gitnexus@1.6.9 analyze --index-only` command.
- Indexed commit and current commit before this evidence-only edit: `2c98394` (`up-to-date`).
- Symbol impact: not applicable because this closure changes only the ledger and evidence files, not a function, class, or method.
- Allowed changed paths: this summary, its sibling `attestation.json`, and `scripts/self-referential-bootstrap-ledger.json` only.

No raw command output, secret value, runner credential, or private inventory is included in this evidence. No deployment, service control, external control-plane access, or `:49100` activity was performed for this closure.
