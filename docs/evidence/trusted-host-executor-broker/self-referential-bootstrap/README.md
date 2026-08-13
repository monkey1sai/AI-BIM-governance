# Trusted host executor/broker bootstrap evidence

- Stack kind: `self_referential_bootstrap`
- Pull request: `#527`
- Trusted baseline: `origin/main@c5d423cb5e6b3f8b80e50efe2acc46d0c3bae736`
- Implementation commit: `f6b39991d4359f8735741759e00d9a649b3deac3`

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

This evidence is not deployment, hosted-provisioning, activation, or live
attestation evidence. Those operational states must be rechecked at the hosted
boundary before activation. The durable activation state remains
`requires_live_attestation`; disposable negative and positive attestations run
only after this bootstrap PR is on the default branch.
