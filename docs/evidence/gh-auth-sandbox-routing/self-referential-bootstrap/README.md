# gh auth sandbox routing bootstrap evidence

- `stack_kind=self_referential_bootstrap`
- PR: `#544`
- Entry: `gh-auth-sandbox-routing`

This branch changes `scripts/tests/test-agent-governance-check.ps1`, which is an
adjudicating mechanism surface. The pre-change gate cannot prove that its new
`gh` authentication, TLS, and sandbox-routing assertions remain enforced after
merge. The immutable verification contract in the ledger records the pre-merge
bootstrap commands; a later mainline fixpoint PR must rerun the same commands.

This evidence is not canonical deployment evidence and is not
`isolated_branch_stack` evidence.
