# Autonomous Linux delivery contracts fixpoint

- Ledger entry: `autonomous-linux-delivery-contracts`
- Reverified at: `2026-08-25T03:07:02Z`
- Mechanism commit: `ea6b20ae38ceb5d06856bb3f696bf6e94e8f90cd`
- Verification contract: `autonomous-linux-delivery-contracts/v1`
- Contract SHA-256: `2b03b006e23998453d0f62a440af5dcbccc680f2771d2f7e1abc65330b321856`
- Closure scope: ledger-only post-merge fixpoint evidence and the legal `open` to `closed` transition.

## Frozen verification results

| Order | Command ID | Exit code | Provenance |
|---:|---|---:|---|
| 1 | `test-autonomous-delivery-contracts` | 0 | Local current-session execution from the exact mechanism checkout |
| 2 | `test-autonomous-delivery-contract-schemas` | 0 | Local current-session execution from the exact mechanism checkout |
| 3 | `test-self-referential-bootstrap` | 0 | Local current-session execution from the exact mechanism checkout |
| 4 | `test-trusted-host-merge` | 0 | Local current-session execution from the exact mechanism checkout |
| 5 | `test-review-risk` | 0 | Local current-session execution from the exact mechanism checkout |
| 6 | `test-agent-governance-check` | 0 | Local current-session execution from the exact mechanism checkout |
| 7 | `test-rebuild-test-deploy-pwsh` | 0 | GitHub Actions exact-mechanism run and job below |
| 8 | `test-rebuild-test-deploy-windows-powershell` | 0 | GitHub Actions exact-mechanism run and job below |
| 9 | `verify-openspec-autonomous-linux-delivery` | 0 | Local current-session strict validation from the exact mechanism checkout |
| 10 | `verify-openspec-repository-lifecycle` | 0 | Local current-session execution from the exact mechanism checkout |
| 11 | `scan-secret-patterns` | 0 | Local current-session pattern-scan execution from the exact mechanism checkout |

## Remote provenance for commands 7 and 8

- Workflow: `CI`
- Event/ref: `push` to `main`
- Head SHA: `ea6b20ae38ceb5d06856bb3f696bf6e94e8f90cd`
- Run: [32726515493](https://github.com/monkey1sai/AI-BIM-governance/actions/runs/32726515493)
- Job: [97429036115](https://github.com/monkey1sai/AI-BIM-governance/actions/runs/32726515493/job/97429036115)
- Successful steps: `Run rebuild transaction safety tests (PowerShell 7)` and `Run rebuild transaction safety tests (Windows PowerShell 5.1)`.

The rebuild contract test uses temporary fixtures, mock launchers, and short-lived child processes. It is not evidence of a live deployment or real service startup, and it does not claim zero egress. A local replay attempt for command 7 was not counted because the managed sandbox blocked a PowerShell telemetry request; command 8 was not locally replayed. The accepted evidence for both rows is the post-merge GitHub Actions execution bound to the exact mechanism commit.

No raw command output, secret value, runner credential, or private inventory is included in this evidence. No real deployment, service control, or `:49100` activity was performed for this closure.
