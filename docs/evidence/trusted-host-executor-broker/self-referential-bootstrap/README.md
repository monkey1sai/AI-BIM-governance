# Trusted host executor/broker bootstrap evidence

- Stack kind: `self_referential_bootstrap`
- Pull request: `#527`
- Trusted baseline: `origin/main@7d85190a7f57e8abde8725b2d07484443aa58d04`
- Implementation commit: `642fa9c`

This branch introduces the default-branch trusted executor that will eventually
hold a short-lived GitHub App merge credential. The canonical workflow cannot
be dispatched from this feature branch because GitHub loads
`workflow_dispatch` definitions from the default branch, and candidate code is
not allowed to adjudicate or merge itself.

The branch therefore records isolated contract, schema, negative-path, and
governance evidence. After PR #527 is merged, the same immutable verification
contract must be rerun from the resulting first-parent mainline mechanism
commit. The open ledger entry remains debt until a separate ledger-only
fixpoint PR commits that attestation.

This evidence is not deployment evidence, an isolated branch stack result, or
proof that the hosted environment and GitHub App are already provisioned.
