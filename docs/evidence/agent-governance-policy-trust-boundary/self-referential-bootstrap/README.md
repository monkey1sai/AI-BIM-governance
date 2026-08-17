# agent-governance-policy-trust-boundary — self-referential bootstrap evidence

- Stack kind: `self_referential_bootstrap`
- Originating repair PR: `#579`
- Predecessor: `agent-governance-policy-wiring`
- Successor: `agent-governance-policy-trust-boundary`

## Why this successor exists

The required Agent Governance workflow executes `verify-governance-policy.ps1`, which reads
`scripts/agent-governance-rules.json` through `agent-governance-policy.psm1`; its required
behaviour suite also validates that rule document against
`scripts/tests/agent-governance-rules.schema.json`. Changing any of those inputs can therefore
change another PR's required-check verdict. The wiring commit classified the module and gate but
deliberately omitted the rule document and schema, while the trusted-host merge contract omitted
the rule document and module from its explicit human-critical mechanism boundary.

PR #579 repairs the existing open debt by classifying the rule document and schema while
preserving exact, case-sensitive negative guards. Updating the separate trusted-host merge
contract is outside the predecessor's immutable surface, so the repair lane requires this linked
successor rather than widening the predecessor in place.

## Bound surface

- `scripts/self-referential-bootstrap-ledger.json`
- `agent-contracts/trusted-host-merge.contract.json`

The predecessor remains `open`, records `repair_prs: [579]`, and retains its original immutable
paths and verification contract. This evidence is not a fixpoint, deployment result, or merge
authorization.

## Verification contract

- ID: `agent-governance-policy-trust-boundary/v1`
- SHA-256: `050a2d2b9a7bea7c80f98480a7295da5b44f7a08b2c6c4aac4d21dfd41529396`
- Ordered command IDs: the predecessor's complete six-command prefix, followed by
  `test-trusted-host-merge`.

All seven commands exited `0` on the candidate branch on 2026-08-17. Exact invocations and
focused classifier probes are recorded in [`verification.txt`](verification.txt).
