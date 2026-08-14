# agent-governance-scope-routing fixpoint

> 文件性質：**evidence**（fixpoint 完成證據）。本檔記錄已執行之驗證與結果，
> 不是 contract、不是 runtime 行為權威；ledger entry 閉合後受證據不可變規則保護。

## Verified facts

- Stack kind: self_referential_fixpoint
- Entry: agent-governance-scope-routing
- Originating PR: #543
- Mechanism commit: 1eec958c727099e06cfb877dfaa2d4103bd103ea
- First parent: 8c401e95a3ae207ee9dd5b8f4307b840e3972ed8
- Merge subject: Merge pull request #543 from monkey1sai/codex/governance-loop-reduction-mechanism
- CWD: C:\Repos\active\iot\AI-BIM-governance.worktrees\agent-governance-scope-fixpoint
- Branch: codex/close-agent-governance-scope-fixpoint
- Before verification, HEAD and freshly fetched origin/main both resolved to the mechanism commit and `git status --porcelain` was empty.
- Immutable contract: agent-governance-scope-routing/v1
- Contract SHA-256: c35e227950b720d265eeb0866d4dc76aab563e997c6f427ff7d3ed297d08248c
- The successful frozen command sequence completed in declared order before the 2026-08-14T11:41:01Z re-verification stamp.
- The first sandbox attempt of `test-verification-plan` exited 1 because the sandbox denied `artifacts/tmp` creation in the sibling worktree and injected an experimental proxy warning into child stderr. The exact command was rerun in the owner-authorized non-sandbox boundary and passed all 33 tests; the attestation records that successful rerun.

| Command ID | Exact invocation | Observed duration | Exit |
|---|---|---:|---:|
| test-agent-governance-check | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-check.ps1` | 148.0s | 0 |
| test-verification-plan | `node --test scripts/tests/test-verification-plan.mjs scripts/tests/test-verification-command-policy.mjs scripts/tests/test-verification-runner.mjs` | 5.7s | 0 |
| test-self-referential-bootstrap | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-self-referential-bootstrap.ps1` | 34.2s | 0 |
| test-pr-body-evidence | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-pr-body-evidence.ps1` | 10.1s | 0 |
| invoke-powershell-static | `pwsh -NoProfile -NonInteractive -File scripts/tests/invoke-powershell-static.ps1` | 2.2s | 0 |

## Inference

- The scope classifier, affected-path full-suite routing, explicit no-op outcome, missing-output guard, and duplicate-job removal introduced by PR #543 remain enforced when the merged mechanism is replayed from main.

## Unverified risks

- This fixpoint does not create a synthetic hosted docs-only PR; the next natural docs-only PR remains the appropriate live check of the explicit no-op path.
- This governance-only fixpoint does not verify deployment, runtime services, browser behavior, or production data.
- Exact-head CODEOWNER review and base-owned PR gates remain required for this closure transition.

## Next actions

- Submit this three-file closure-only PR with `Self-referential bootstrap = no`.
- Merge through the protected main workflow, verify the merge commit is reachable from `origin/main`, then close out the merged worktrees and branches from this governance session.
