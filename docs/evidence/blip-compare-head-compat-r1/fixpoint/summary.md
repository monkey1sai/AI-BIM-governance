# Blip compare-head compatibility R1 fixpoint

- Ledger entry: `blip-compare-head-compat-r1`
- Reverified at: `2026-08-25T13:50:59Z`
- Mechanism commit: `7b46a50a4f41f771e73c50fa17b5709b24614690`
- Verification contract: `blip-compare-head-compat-r1/v1`
- Contract SHA-256: `2e84405553903ab005689ab2add48fa2c72b2aa1e6fb25e7f7f8988c4d537e7d`
- Closure scope: ledger-only post-merge fixpoint evidence and the legal `open` to `closed` transition.

## Frozen verification results

| Order | Command ID | Exit code | Provenance |
|---:|---|---:|---|
| 1 | `test-autonomous-delivery-contracts` | 0 | Local current-session execution from the fresh `origin/main` rebuild worktree |
| 2 | `test-autonomous-delivery-contract-schemas` | 0 | Local current-session execution from the fresh `origin/main` rebuild worktree |
| 3 | `test-self-referential-bootstrap` | 0 | Local current-session execution from the fresh `origin/main` rebuild worktree |
| 4 | `test-trusted-host-merge` | 0 | Local current-session execution from the fresh `origin/main` rebuild worktree |
| 5 | `test-review-risk` | 0 | Local current-session execution from the fresh `origin/main` rebuild worktree |
| 6 | `test-agent-governance-check` | 0 | Local current-session execution from the fresh `origin/main` rebuild worktree |
| 7 | `test-rebuild-test-deploy-pwsh` | 0 | Local current-session execution from the fresh `origin/main` rebuild worktree |
| 8 | `test-rebuild-test-deploy-windows-powershell` | 0 | Local current-session execution from the fresh `origin/main` rebuild worktree |
| 9 | `verify-openspec-autonomous-linux-delivery` | 0 | Local current-session strict validation from the fresh `origin/main` rebuild worktree |
| 10 | `verify-openspec-repository-lifecycle` | 0 | Local current-session execution from the fresh `origin/main` rebuild worktree |
| 11 | `scan-secret-patterns` | 0 | Local current-session pattern-scan execution from the fresh `origin/main` rebuild worktree |
| 12 | `test-ship-gate-packet` | 0 | Local current-session isolated Python execution from the fresh `origin/main` rebuild worktree |

The trusted-host merge suite has one explicit Linux-only raw-git test (`skip: process.platform !== 'linux'`); all 44 tests applicable on Windows passed. The rebuild contract test uses temporary fixtures, mock launchers, and short-lived test-owned child processes. It is not evidence of a live deployment or real service startup. Commands 7 and 8 were both replayed locally in this current session from the fresh `origin/main` rebuild worktree.

No raw command output, secret value, runner credential, or private inventory is included in this evidence. No real deployment, service control, external control-plane access, or `:49100` activity was performed for this closure.
