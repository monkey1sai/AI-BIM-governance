# conversion-service-ci-wiring fixpoint

> 文件性質：**evidence**（fixpoint 完成證據）。本檔記錄已執行之驗證與結果，不是 contract、不是 working note；ledger entry 閉合後受閘門的證據不可變規則保護。

## Verified facts

- Stack kind: `self_referential_fixpoint`
- Entry: `conversion-service-ci-wiring`
- Originating PR: `#566`
- Mechanism commit: `1e01a9c4f80200c305c6b9e62b2d0f6dd821b644`
- Merge subject: `ci(streaming): run the host-native conversion service tests (issue #516) (#566)`
- Verification CWD: `C:\Repos\active\iot\ai-bim-fixpoint-1e01a9c`（repo-sibling worktree，detached 於 mechanism commit）
- Before verification, `HEAD` resolved to the mechanism commit and `git status --porcelain` was empty.
- Immutable contract: `conversion-service-ci-wiring/v1`
- Contract SHA-256: `488bc1d25000fb444089ac040ea60409c6ddadc796df98ccc2490b8d74e026ae`
- The immutable verification contract was replayed in its declared order. Every command exited `0` before the `2026-08-17T09:27:55Z` re-verification stamp.

| Command ID | Exact invocation | Result | Exit |
|---|---|---|---:|
| `test-host-native-conversion-service` | `python -m pytest bim-streaming-server/tests/test_host_native_conversion_service.py -q` | 130 passed, 8 skipped | `0` |
| `test-agent-governance-check` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-check.ps1` | all assertions passed | `0` |
| `test-verification-plan` | `node --test scripts/tests/test-verification-plan.mjs scripts/tests/test-verification-command-policy.mjs scripts/tests/test-verification-runner.mjs` | 33/33 | `0` |
| `test-self-referential-bootstrap` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-self-referential-bootstrap.ps1` | all assertions passed | `0` |
| `test-pr-body-evidence` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-pr-body-evidence.ps1` | all assertions passed | `0` |
| `invoke-powershell-static` | `pwsh -NoProfile -NonInteractive -File scripts/tests/invoke-powershell-static.ps1` | passed | `0` |

Python invocations used the repository's canonical `.venv` interpreter（`C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe`，Python 3.12.7）; Node was the pinned toolchain on PATH; PSScriptAnalyzer 1.24.0.

## What this proves

Entry `conversion-service-ci-wiring` froze the claim that the pre-merge branch could not demonstrate the new required CI streaming step（`ci.yml` 的 host-native conversion service suite，issue #516）as mainline behavior. Replaying the entry's immutable contract at the merged mechanism commit shows the wired mechanism passing its own gate suite from `main` itself: the conversion-service suite runs and passes, the adjudication suite that classifies `ci.yml` edits passes, and the verification planner, bootstrap gate, PR-body gate, and static analysis all hold on the exact commit that landed the mechanism.

## Inferences

- The debt's fail-closed premise（branch cannot self-prove a required-CI wiring change）is discharged by this mainline replay; no pre-merge claim was substituted for post-merge evidence.

## Unverified risks

- 本 replay 在 Windows 主機執行；`ubuntu-latest` 上的行為由該 workflow 自身的後續 mainline 執行持有，不由本 attestation 宣稱。
