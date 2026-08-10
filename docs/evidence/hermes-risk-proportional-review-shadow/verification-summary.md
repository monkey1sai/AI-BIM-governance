# Hermes Risk-Proportional Review — Verification Summary

> Verification date: 2026-08-10 (Asia/Taipei)
>
> Document nature: working verification note; not a contract or runtime authority.
>
> Authority: `advisory_shadow`; this evidence does not grant merge authority and does not prove hosted GitHub enforcement.

## Baseline

- Repository: `monkey1sai/AI-BIM-governance`
- Applied branch base `origin/main`: `89ff9c8b773da9a3c0c44990e2267f70f4e8007d`
- Policy SHA-256: `db2950c2751f26e26f3079e17b8e21926bc3fdee07196d1510400afcd52ab10e`
- Runtime used for focused verification: Node `v22.22.0`, PowerShell 7 on Windows

## Deterministic checks

| Check | Result |
|---|---|
| `node --check scripts/lib/risk-proportional-review.mjs` | passed |
| `node --check scripts/dev/review-risk-shadow.mjs` | passed |
| `node --test scripts/tests/test-review-risk.mjs` | 62 passed, 0 failed |
| `node --test --experimental-test-coverage scripts/tests/test-review-risk.mjs` | 62 passed; all files line 96.43%, branch 88.76%, functions 98.77%; core classifier line 97.29%, branch 86.34% |
| Golden risk-shape replay | 20 passed, 0 failed |
| Draft-07 policy schema validation | passed |
| Draft-07 input/decision/packet/result/loop/corpus validation | passed |
| Negative schema case: packet `max_bytes = -1` | rejected as expected |
| Negative schema case: path traversal | rejected as expected |
| Negative schema case: more than two loop attempts | rejected as expected |
| Maximum 512-byte evidence ref round trip | packet self-validation passed |
| Windows junction read escape and filesystem-output option probes | rejected as expected; CLI is stdout-only |
| `scripts/tests/test-self-referential-bootstrap.ps1` | passed |
| `scripts/tests/test-agent-governance-check.ps1` | passed |
| PR #483 local preflight | passed; no blockers, advisory GitNexus warning only |
| GitNexus branch compare against `origin/main` | high: 12 files, 198 symbols, 10 flows; no critical result |
| Canonical self-referential path classification | 12 changed paths, 0 mechanism paths; bootstrap ledger not applicable to PR-A |
| Patch whitespace check (`git diff --check`) | passed |
| Independent final Codex read-only review | 3 findings fixed; closure found no residual P0/P1/P2 and returned `recommendation=accept` |

## Behaviors established by tests

- Low submitter/agent scores cannot downgrade deterministic risk.
- High submitter/agent scores may only escalate review.
- A large diff does not become high consequence solely because of line count.
- A one-line persistent write can still become `human_critical`.
- Self-referential review-policy paths require human review.
- `.github/CODEOWNERS` and case variants retain the `critical_authority` / `human_critical` floor.
- Failed or stale deterministic evidence cannot be overridden by a reviewer.
- Unknown service/caller blast radius requires impact evidence and cannot remain `mechanical_only`.
- Unknown affected-user blast radius also fails closed until exact-head impact evidence exists.
- Renames bind both source and destination paths, including protected and self-referential surfaces.
- Production service paths require runtime and integration evidence; frontend paths additionally require separate browser-operability and design-fidelity evidence.
- A packet is bounded by bytes, changed paths, evidence references, and questions.
- Packet content, final byte count, and packet hash are independently revalidated.
- Evidence refs are canonical `artifacts/.../file.ext` identifiers and cannot inject URLs, traversal, or free-form instructions.
- CLI reads are realpath-contained; filesystem-output flags are rejected and results are emitted to stdout only.
- A reviewer cannot cite evidence that was not included in the packet.
- `advisory_clear` can cite only exact-head passed packet evidence.
- A `human_critical` packet can only be cleared by the human reviewer role.
- Reviewer output cannot modify implementation or override policy semantics.
- A loop cannot mix head, policy, normalized input, or verification-manifest identities.
- A loop rejects attempts appended after a terminal decision and checks repeated/no-new evidence before accepting a later terminal verdict.
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

- Exact-head approval from the required independent `monkey1sai-blip` reviewer; `governance-base-audit` correctly remains blocked until that review exists.
- Completion of hosted third-party review after the final follow-up head is pushed.
- Trusted-adapter binding of hosted repository identity, policy/manifest digests, packet origin, and artifact provenance (PR-B scope).
- Live Hermes runtime/plugin installation.
- Historical PR replay against authenticated GitHub API data.
- Production token reduction or escaped-defect reduction.
