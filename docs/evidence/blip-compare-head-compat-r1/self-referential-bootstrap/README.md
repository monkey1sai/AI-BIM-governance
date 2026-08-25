# Blip compare-head compatibility R1 bootstrap

- `stack_kind=self_referential_bootstrap`
- Repair PR: `#695`
- Repair target: `autonomous-linux-delivery-contracts`
- Linked successor: `blip-compare-head-compat-r1`
- Base commit: `c3a7bf3bb2704df1602bed6a2bfbb73eb0d78a8c`
- Implementation checkpoint: `b6580bbe0a4aaf229c8669c67b788acaef7f1ff9`
- Verification contract: `blip-compare-head-compat-r1/v1`
- Contract SHA-256: `2e84405553903ab005689ab2add48fa2c72b2aa1e6fb25e7f7f8988c4d537e7d`
- Activation status: `HELD`

The live GitHub Compare API response binds the base and merge-base commits but
does not include the `head_commit` field required by the protected ship-packet
collector. The pre-change collector therefore cannot produce its own
post-change exact-head evidence. This repair fetches the already pinned head SHA
from the fixed base repository only when the key is absent. An explicit null,
malformed response, wrong SHA or tree, incomplete file evidence, unsupported
mode, blob mismatch, or final PR metadata drift remains fail closed.

The two packet paths are classified mechanism paths outside the active #557
root surface. PR #695 therefore appends its number to the open root repair
history and opens exactly one linked successor owning those paths plus the
ledger. The root remains open and otherwise immutable. This evidence is the
pre-merge bootstrap record; it is not a fixpoint and cannot close either debt.

GitNexus 1.6.9 was rebuilt for this exact worktree at the pinned base. Impact on
`collect_pr_snapshot` was LOW. Exact-path detect-changes reported LOW risk and
zero affected processes. The frozen 11-command root prefix plus the isolated
packet regression command all completed with exit code zero; exact invocations
are recorded in `verification.txt`.

No credential value, private inventory, live approval, merge, deployment,
runtime stop, external service, or `:49100` probe was used to produce this
evidence.
