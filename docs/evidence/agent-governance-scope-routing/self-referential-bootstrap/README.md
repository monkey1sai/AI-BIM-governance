# Agent Governance scope routing bootstrap

- `stack_kind`: `self_referential_bootstrap`
- PR: `#543`
- trusted base: `028771a6f100028d5532c9983a8556963ad07b8a`
- ledger entry: `agent-governance-scope-routing`
- verification contract: `agent-governance-scope-routing/v1`

## Why bootstrap evidence is required

This pull request changes the required Agent Governance workflow, its shared
verification manifest binding, the CI job that previously duplicated the same
suite, the planner regressions, and the immutable command resolver that
adjudicate those files. Before this branch
merges, GitHub can only execute the base workflow as the established mechanism;
that mechanism cannot prove the candidate scope classifier, explicit no-op
success, or duplicate-job removal as mainline behavior.

The branch therefore records bounded bootstrap evidence. It is not canonical
deployment evidence and does not close the ledger entry. After merge, the exact
verification contract must be rerun from main and closed in a ledger-only
fixpoint pull request.

## Intended invariant

- The protected PR context remains exactly `agent-governance`.
- A base retarget is reclassified against the new exact base/head pair.
- `git diff` failure, classifier failure, and missing or malformed classifier
  output each produce a failing terminal context.
- Product code, Compose, security boundaries, OpenSpec, core plans, and
  governance inputs run the complete suite; only bounded known non-code docs
  may produce an explicit successful no-op context.
- An affected path set runs the complete Agent Governance suite before the
  terminal context can succeed.
- Manual dispatch retains the non-authoritative name
  `agent-governance-diagnostic` and runs the full suite.
- CI no longer runs a second `agent-governance-contracts` job.

Public-safe command results are recorded in `verification.txt`. No credential,
private topology, production metadata, or external runtime identifier is
included.
