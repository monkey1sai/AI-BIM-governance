# Trusted host executor/broker bootstrap evidence

- Stack kind: `self_referential_bootstrap`
- Pull request: `#527`
- Trusted baseline: `origin/main@c5d423cb5e6b3f8b80e50efe2acc46d0c3bae736`
- Implementation commit: `0edd3a5147f4ff578b50cbc2c58aeec4921cdf51`

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

The implementation binds all 15 base-manifest verification targets to
source-pinned workflow provenance while keeping the 10 live branch-protection
sources as an independent exact allowlist. It also rejects opaque or non-UTF-8
old/new blobs before arbiter evidence is decoded, routes `.gitattributes`
changes through separate authorization, and treats only a pure `merged`
terminal result as a successful workflow exit.

This evidence is not deployment, hosted-provisioning, activation, or live
attestation evidence. Those operational states must be rechecked at the hosted
boundary before activation. The durable activation state remains
`requires_live_attestation`; disposable negative and positive attestations run
only after this bootstrap PR is on the default branch.
