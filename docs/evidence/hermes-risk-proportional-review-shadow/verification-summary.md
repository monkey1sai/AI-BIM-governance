# Hermes Risk-Proportional Review — Verification Summary

> Verification date: 2026-08-06 (Asia/Taipei)
>
> Authority: `advisory_shadow`; this evidence does not grant merge authority and does not prove hosted GitHub enforcement.

## Baseline

- Publicly observed repository: `monkey1sai/AI-BIM-governance`
- Publicly observed `origin/main`: `afa5c7392f2ee630ac222d12a59b1f1087881a87`
- Policy SHA-256: `db2950c2751f26e26f3079e17b8e21926bc3fdee07196d1510400afcd52ab10e`
- Runtime used for local verification: Node `v22.16.0`, Python `3.13.5`, Git `2.47.3`

## Deterministic checks

| Check | Result |
|---|---|
| `node --check scripts/lib/risk-proportional-review.mjs` | passed |
| `node --check scripts/dev/review-risk-shadow.mjs` | passed |
| `node --test scripts/tests/test-review-risk.mjs` | 32 passed, 0 failed |
| Golden risk-shape replay | 20 passed, 0 failed |
| Draft-07 policy schema validation | passed |
| Draft-07 input/decision/packet/result/loop/corpus validation | passed |
| Negative schema case: path traversal | rejected as expected |
| Negative schema case: more than two loop attempts | rejected as expected |
| Patch whitespace check (`git diff --cached --check`) | passed |
| Generated patch `git apply --check` in a clean Git repository | passed |
| Patch-applied file parity | 12/12 files byte-identical |
| Patch-applied focused tests | 32 passed, 0 failed |

## Behaviors established by tests

- Low submitter/agent scores cannot downgrade deterministic risk.
- High submitter/agent scores may only escalate review.
- A large diff does not become high consequence solely because of line count.
- A one-line persistent write can still become `human_critical`.
- Self-referential review-policy paths require human review.
- Failed or stale deterministic evidence cannot be overridden by a reviewer.
- A packet is bounded by bytes, changed paths, evidence references, and questions.
- Packet content, final byte count, and packet hash are independently revalidated.
- A reviewer cannot cite evidence that was not included in the packet.
- `advisory_clear` can cite only exact-head passed packet evidence.
- Reviewer output cannot modify implementation or override policy semantics.
- A loop cannot mix head, policy, normalized input, or verification-manifest identities.
- Identical evidence, no new evidence, or exhausted attempt budget produces `held`.

## Files intentionally not changed

- `.github/workflows/**`
- `.github/CODEOWNERS`
- `scripts/verification-manifest.json`
- `scripts/self-referential-bootstrap-ledger.json`
- `agent-skills-manifest.json`
- `.claude/skills/**`
- `.codex/skills/**`
- existing PR review gate implementation

This keeps the first delivery report-only and avoids allowing a new governance mechanism to certify itself.

## Unverified in this environment

- Applying the patch to a complete, freshly fetched worktree.
- GitNexus `impact` and `detect-changes` against the full repository graph.
- Existing aggregate repository verification commands.
- Hosted GitHub Actions execution and branch-protection behavior.
- Live Hermes runtime/plugin installation.
- Historical PR replay against authenticated GitHub API data.
- Production token reduction or escaped-defect reduction.

The environment could browse the public repository but could not resolve `github.com` through `git`/`curl`, and `gh` was unavailable. Therefore no branch was pushed and no Draft PR was created.
