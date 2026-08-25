# Autonomous Linux delivery contracts fixpoint

- Ledger entry: `autonomous-linux-delivery-contracts`
- Reverified at: `2026-08-25T12:22:05Z`
- Mechanism commit: `ea6b20ae38ceb5d06856bb3f696bf6e94e8f90cd`
- Verification contract: `autonomous-linux-delivery-contracts/v1`
- Contract SHA-256: `2b03b006e23998453d0f62a440af5dcbccc680f2771d2f7e1abc65330b321856`
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

The rebuild contract test uses temporary fixtures, mock launchers, and short-lived child processes. It is not evidence of a live deployment or real service startup, and it does not claim zero egress. Commands 7 and 8 were both replayed locally in this current session from the fresh `origin/main` rebuild worktree.

No raw command output, secret value, runner credential, or private inventory is included in this evidence. No real deployment, service control, or `:49100` activity was performed for this closure.
