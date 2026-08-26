# spec-to-done owner-only NEW_RUN bootstrap evidence

## Identity

- Originating PR: `#704`
- Branch: `codex/governance/spec-to-done-new-run-boundary-implementation`
- Fresh branch base: `01d6390ffbd4652a77934c8af558f3c356fa9dd5`
- Implementation checkpoint: `8b32bc897b0c31a37688482240ff43a242d154fb`
- Live PR base observed before ledger commit: `97f905c73d5ec13fcc2e3e64d70d99d64dc67bce`

## Why bootstrap is required

This PR changes the preregistered durable-state validator, owner-bound append
authority, machine contract, procedure adapters, and enforcement tests. The
pre-change mechanism therefore cannot prove the post-merge behavior. The PR
opens exactly one self-referential bootstrap debt and leaves its fixpoint null.

## Declared mechanism surface

- `.claude/skills/spec-to-done/GROK.md`
- `.claude/skills/spec-to-done/SKILL.md`
- `.claude/skills/spec-to-done/append-new-run.mjs`
- `.claude/skills/spec-to-done/validate-state.mjs`
- `.codex/skills/spec-to-done/SKILL.md`
- `agent-contracts/spec-to-done.contract.json`
- `agent-contracts/spec-to-done.contract.schema.json`
- `scripts/self-referential-bootstrap-ledger.json`
- `tests/test_spec_to_done_state_contract.py`

`agent-skills-manifest.json` is part of the PR but is not classified as a
self-referential mechanism path. Its only changes bind the `spec-to-done`
Claude and Codex trees to the owner-authorized integrity hashes:

- Claude: `93877ebf909c087f501b8b74aaa2cb7b28bd168e39666e5439d8507d75a2d37f`
- Codex: `ba92625a395298907aa9128723673426c8b5afecc1ea5db1806f4c629115b85e`

## Frozen verification contract

- Contract ID: `spec-to-done-new-run-boundary-implementation/v1`
- Digest: `79fb7c5610955b41f9f8a7bd21348b79e126f5206184f4887e31f65f9738e3ef`
- Ordered commands: see `verification.txt`

The implementation checkpoint also passed the focused NEW_RUN tests, the full
state/budget/closeout suite, syntax checks, agent-skill integrity check, and
`git diff --check`. GitNexus CLI `1.6.9` reported LOW change risk with zero
affected processes; its report did not resolve all new internal symbols, so
that metadata limitation remains explicit rather than being treated as full
symbol coverage.

This is pre-merge bootstrap evidence, not fixpoint evidence. A separate
ledger-only PR must re-run this immutable contract against the mechanism commit
on fresh `origin/main` before the debt can transition from open to closed.

No deployment, service/process control, secret-value access, external runtime,
or probe of `:49100` was performed.
