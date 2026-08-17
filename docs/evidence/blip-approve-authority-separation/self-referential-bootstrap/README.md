# Blip approve-only authority separation bootstrap

- `stack_kind=self_referential_bootstrap`
- Originating PR: `#548`
- Base commit: `67f82d23127070858f05d72cbbc2a9b74849638c`
- Ledger entry: `blip-approve-authority-separation`
- Activation status: `HELD`

The PR changes `scripts/lib/trusted-host-merge-evidence.mjs`, which is an
adjudicator for trusted merge authority. The base-pinned consumer cannot prove
the post-change behavior that distinguishes an automated counted approval from
a separately authorized `merge` or `merge-elevated` review. This bootstrap
evidence records the pre-merge source and regression gates; the ledger remains
open until the merged mechanism is rerun from `main` and a fixpoint attestation
is committed.

No credential, ProgramData installation, activation, live review mutation,
approval, auto-merge, or merge was performed while producing this evidence.
