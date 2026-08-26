# Agent Governance Policy

Repo-tooling vocabulary. **Not product domain language** — `CONTEXT.md` is the product glossary and
already owns *Governance Library Workflow*, which means running IFC rules against a governance
library and has nothing to do with this. Nothing here belongs in `CONTEXT.md`.

## Terms

**Agent Governance Policy**
The deep module that decides whether this repository's machine-readable governance surface holds:
`scripts/lib/agent-governance-policy.psm1`. It owns rule interpretation and nothing else — it does
not decide *which* rules exist (that is data), and it does not read the filesystem directly (that is
the RepoSnapshotPort).
_Avoid_: governance checker, governance gate (the gate is the script that consumes this module's
verdict), Governance Library Workflow (a product concept — different thing entirely).

**Governance rule**
One row in `scripts/agent-governance-rules.json`. Data, not code. Adding a governance capability
adds a rule; it does not edit the module. A rule has an `id`, a `kind` from the closed vocabulary, a
`severity`, a `title`, and the fields its kind requires.
_Avoid_: check, assertion (an assertion lives in a test and is code; a rule is data)

**Rule kind**
One of six: `file_exists`, `json_schema`, `json_node`, `yaml_node`, `yaml_every`,
`codeowners_owns`. The vocabulary is **closed**. Adding a kind edits the module, which is a
mechanism-surface change; adding a rule instance is not. There is deliberately **no**
`regex_matches` kind — see below.

**RepoSnapshotPort**
The seam between policy evaluation and the repository: `ReadText(path, ref)` and
`ListTracked(glob, ref)`, both parameterized by git ref (empty ref = working tree). Two adapters
exist, which is what makes it a real seam rather than indirection: a git-backed one
(`New-AgentGovernanceSnapshot`) and an in-memory one (`New-AgentGovernanceFakeSnapshot`).
_Avoid_: file reader, git wrapper

**Rule ratchet**
`Test-AgentGovernancePolicyRatchet`. Compares head against the PR base and is monotonic on exactly
two things: the rule id set may only grow, and no rule may drop in severity. Rule *content* is not
compared here.
_Avoid_: baseline (that word belongs to `architecture/observed-baseline.json`, a different
mechanism)

**Retirement record**
An entry in the rule document's `retired` array authorising one rule's removal. Fields mirror the
`ARCH-EXC-001` exception record in `architecture/README.md`: `rule_id`, `owner`, `reason`, `pr`,
`retired_on`. A removal without a complete record fails closed.

**Load-bearing rule**
A rule listed in `PINNED_LOAD_BEARING` in `scripts/tests/test-agent-governance-policy.ps1`, pinned
by content fingerprint. The ratchet stops a load-bearing rule from vanishing; the pin stops it from
being hollowed out while keeping its id. Changing one means editing the test, so it appears in the
review diff. This layer is **review-enforced, not gate-enforced** — the same posture
`architecture/README.md` documents for `PINNED_SERVICE_LAYERS` and `PINNED_FORBIDDEN`.

## Why there is no `regex_matches` kind

The gate this module is replacing carries 438 assertions, 248 of which match a regular expression
against the *source text* of another file. Two consequences the repository has already paid for:

- **Rephrasing prose breaks a merge gate.** Renaming a heading in `docs/PR_REVIEW_AGENT.md` is
  enough to redden a required check.
- **Universal statements get written as counts.** `test-agent-governance-check.ps1:315` asserts a
  pattern occurs exactly 13 times; its own message says "every downstream CI job". Adding a job
  broke it. The in-file post-mortem at lines 466–473 records the same class of bug being fixed by
  replacing one arithmetic coincidence (`-eq 2`) with another (`+ 2`).

`yaml_every` states the invariant directly — *every member of this collection satisfying this filter
must have this property* — so adding a job or a step no longer reddens a gate that never meant to
count anything. Migrating a counting assertion therefore means re-deriving what it actually meant.
The first migration found a real distinction hidden inside the number 13: fourteen CI jobs depend on
the changed-path classifier, but one (`platform-adapter-linux`) is deliberately not a required check
and correctly carries no guard. The rule now filters on the required-check `always()` pattern rather
than counting.

## Reading YAML without a YAML library

The `agent-governance` CI job provides `pwsh` and a pinned Node 20 and nothing else; the repository
has no root `package.json` and installs no YAML parser. The module therefore carries a reader for
the YAML subset these files actually use (block mappings and sequences, plain and quoted scalars,
inline flow sequences, block scalars, comments).

It **fails closed on everything else** — anchors, aliases, tags, flow mappings, multi-document
streams, duplicate keys, tab indentation, unknown escapes. Never partial parsing: a construct the
reader cannot read must redden the rule, because "nothing matched" and "the rule holds" would
otherwise be indistinguishable. This is the same posture as the lifecycle-contract TypeScript union
scan (`lifecycle.source_sync.union_unparsed`), and the same reasoning that led Phase 2 and Phase 3 to
hand-write scanners rather than adopt `dependency-cruiser` / `import-linter`.

Scalars stay strings; there is no YAML 1.1 type coercion, so the `on:` key stays the string `on`
rather than becoming a boolean.

**Validation:** parser output was compared node-for-node against PyYAML on all seven real target
files. Seven of seven match. The single divergence is an empty value (`workflow_dispatch:`), where
this reader yields null and PyYAML's `BaseLoader` yields `''` — `BaseLoader` refuses to resolve
implicit types at all, and `SafeLoader` agrees with this reader. PyYAML is not available in CI, so
that comparison is PR evidence, not a gate.

## Mechanism-surface status

`docs/agents/self-referential-bootstrap.md` §2.1 governs this.

| Path | Mechanism surface? |
|---|---|
| `scripts/lib/agent-governance-policy.psm1` | **Yes, once a gate consumes it.** Registering it is the §2.1 upgrade rule, and must happen in the same PR that wires it in. |
| `scripts/tests/test-agent-governance-policy.ps1` | Yes, same PR — it holds the PINNED layer. |
| `scripts/agent-governance-rules.json` | **No.** This is the point: adding a rule must not open self-referential debt. Removal and downgrade are held by the ratchet; content of load-bearing rules by the pins. |
| `scripts/dev/report-agent-governance-policy.ps1` | **Not while it stays report-only** — §2.1 explicitly excludes scripts whose report no gate consumes by machine. |

Until the wiring PR lands, nothing here adjudicates anything. `report-agent-governance-policy.ps1`
exits 0 regardless of findings, deliberately, so that no caller can turn it into a gate by accident.

## Lifecycle-ledger subject binding

A different machine-readable artifact with a different ratchet from the rule ratchet above:
`openspec/lifecycle-ledger.json`, adjudicated by the machine-truth comparator
(`scripts/lib/openspec-machine-truth.mjs`, `scripts/tests/verify-openspec-machine-truth.mjs`).
Spec: `openspec/specs/openspec-lifecycle-ledger-schema/spec.md`、`openspec/specs/openspec-machine-truth-subject-resolution/spec.md`、`openspec/specs/openspec-machine-truth-reconcile-ratchet/spec.md`。

**Reconcile declares the sentinel.** A lifecycle row that a reconcile *adds*, or whose
`subject_commit` it *rewrites*, MUST also carry `subject_binding: "introduction"`. The sentinel
says "when the recorded SHA is no longer reachable from the trusted base, resolve my subject from
its introduction commit", which is what lets a row survive the squash merge that lands it. The
reconcile ratchet (`assertReconcileRatchet`) fails closed with `subject_binding_required` on every
other rewrite, so a row can no longer advance its watermark past accrued drift.

**A dangling subject is not a PR.** Post-squash dangling subjects no longer get a rebind PR —
owner ruling on #589 P1, 2026-08-18. The required CI ledger check is base-aware and recovers the
introduction itself, so a PR whose only content is re-pointing a `subject_commit` at a landed
squash is the treadmill this replaced, not a chore.

**Rebind is repair, not routine.** Moving a subject by hand is legitimate only where
introduction recovery fails closed — `subject_not_ancestor`, ambiguity, more than 32 candidates —
and the repair states which failure it answers.

Legacy rows without the sentinel stay legal. They are normalized opportunistically: only a
reconcile that already touches a row rewrites it, and then only to the resolved introduction of
its base binding. There is no batch upgrade and no tooling for one.

## Running it

```powershell
pwsh -File scripts/dev/report-agent-governance-policy.ps1
pwsh -File scripts/dev/report-agent-governance-policy.ps1 -BaseRef origin/main
pwsh -File scripts/tests/test-agent-governance-policy.ps1
```

When a load-bearing rule changes deliberately, refresh its pin in the same commit:

```powershell
pwsh -File scripts/tests/test-agent-governance-policy.ps1 -DumpFingerprints
```

## Lean Governance Policy (減法方針)

1. **禁止元治理無限自我維護**：Agent 不得將產能消耗在連續開立 fixpoint rebuild、ledger debt repair 等純內部治理 PR。
2. **單 PR 閉環**：所有需求與變更在單一 PR 內完成，杜絕 3-PR 分段開立。
3. **業務優先原則**：若治理機制與業務交付產生摩擦，以業務功能交付為第一優先，治理警告改為 non-blocking advisory。

