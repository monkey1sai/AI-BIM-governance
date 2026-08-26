# Blip approval continuity bootstrap

- `stack_kind=self_referential_bootstrap`
- Originating PR: `#707`
- Opening base commit: `97f905c73d5ec13fcc2e3e64d70d99d64dc67bce`
- Pre-ledger implementation checkpoint: `274bfff22fa9f39e999e108069e3ac9505653f9e`
- Final candidate head binding: live PR metadata and exact-head checks; it is intentionally not self-embedded because changing this tracked evidence changes that commit
- Ledger entry: `blip-approve-full-authority-continuity`
- Verification contract: `blip-approve-full-authority-continuity/v1`
- Contract SHA-256: `d7c9775c8ea719b02536bcaeaf15d0a6da5b54dcc01e69aae58965943f06a675`
- Activation status: `HELD` until a post-merge ledger-only fixpoint closes this debt

## Scope and bootstrap boundary

This PR introduces the tracked `blip-approve` policy and its byte-identical
Claude/Codex mirror, preserves the immutable-base risk classifier, restores the
protected exact-tuple Codex App `SHIP` attestation for machine-eligible votes,
and documents an interactive protected User broker. It also registers exactly
the two skill copies, `agent-skills-manifest.json`, and
`docs/agents/github-workflow.md` as approval adjudicators for future changes.

The immutable PR base does not yet classify those four newly registered paths.
The opening debt therefore declares only the three changed mechanism paths that
the base classifier can lawfully recognize: the classifier, its ledger, and its
adversarial test. The frozen seven-command contract uses only IDs already
resolved by the immutable command map and validates the classifier, policy
gates, review-risk logic, agent-governance behavior, static PowerShell behavior,
and secret scanning. Separate pre-merge Skill Creator and 33-skill integrity
checks cover both skill mirrors and manifest integrity. After merge, the new exact path rules
become base-owned; a later ledger-only fixpoint must rerun the frozen contract
against the merged mechanism before this debt can close.

The change does not install or activate a ProgramData runtime, handle a token,
submit an approval, resolve a GitHub review thread, merge a PR, deploy, or alter
repository protection. Candidate policy from this PR cannot approve this PR.

## Pre-merge evidence

GitNexus 1.6.9 could not resolve the PowerShell function
`Get-SelfReferentialMechanismPaths` as an indexed symbol, so impact remains
`UNKNOWN`; this is not reported as a pass. Exact source inspection and the
executable adversarial classifier suite are the fallback. Detect-changes on the
pre-ledger implementation checkpoint reported LOW risk, six files, four indexed
symbols, zero affected processes.

Both Skill Creator quick validators passed. The 33-skill integrity check passed
with zero file operations, the agent-skill sync regression passed, and
`scripts/tests/test-self-referential-bootstrap.ps1` passed all assertions,
including exact approval-adjudicator matches, adjacent/wrong-case negatives,
and mandatory `bootstrap=yes` behavior. The remaining frozen commands also
passed: governance policy verification had 37 rules with zero errors/warnings
and zero ratchet, its behavior suite passed 106 assertions, review-risk passed
65 tests, agent-governance passed all assertions, and both PowerShell static and
secret-pattern checks passed. Exact commands and results are recorded in
`verification.txt`.

PR #704 independently proposes debt from the same zero-open base. Only one may
enter `main` before its fixpoint closure; if #704 merges first, #707 must rebase
and remain queue-held rather than open concurrent debt.
