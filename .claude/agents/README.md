# Agent Personas

Specialist personas that play a single role with a single perspective. Each persona is a Markdown file consumed as a system prompt by your harness (Claude Code, Cursor, Copilot, etc.).

| Persona | Role | Best for |
|---------|------|----------|
| [code-reviewer](code-reviewer.md) | Senior Staff Engineer | Five-axis review before merge |
| [security-auditor](security-auditor.md) | Security Engineer | Vulnerability detection, OWASP-style audit |
| [test-engineer](test-engineer.md) | QA Engineer | Test strategy, coverage analysis, Prove-It pattern |

## How personas relate to skills and coordinator entrypoints

Three layers, each with a distinct job:

| Layer | What it is | Example | Composition role |
|-------|-----------|---------|------------------|
| **Skill** | A workflow with steps and exit criteria | `code-review-and-quality` | The *how* — invoked from inside a persona or coordinator flow |
| **Persona** | A role with a perspective and an output format | `code-reviewer` | The *who* — adopts a viewpoint, produces a report |
| **User intent** | A user-facing entry point | “review this PR”, “ship this branch” | The *when* — the coordinator composes personas and skills |

The coordinator interprets explicit user intent and owns orchestration. **Personas do not call other personas.** Skills are mandatory hops inside a persona's workflow.

Every child dispatch also obeys the global apex-slot gate. `code-reviewer` and `security-auditor` are hard read-only apex roles: their tool allowlist excludes shell and write tools. `test-engineer` is a secondary role and may run only when the primary is already apex or an independent apex assignment is reserved. Writing tests additionally requires an explicit, non-conflicting file scope. Remaining worker selection uses the minimum sufficient model, effort, bounded prompt, and evidence duty.

## When to use each

### Direct persona invocation
Pick this when you want one perspective on the current change and the user is in the loop.

- "Review this PR" → invoke `code-reviewer` directly
- "Are there security issues in `auth.ts`?" → invoke `security-auditor` directly
- "What tests are missing for the checkout flow?" → invoke `test-engineer` directly

### Coordinator entrypoint (single persona)
Pick this when explicit user intent maps to one repeatable perspective.

- “review this change” → wraps `code-reviewer` with the project's review workflow
- “design or assess the missing tests” → wraps `test-engineer` with the TDD workflow

### Coordinator entrypoint (risk-based fan-out)
Pick this only when **independent** investigations can run in parallel and produce reports that the coordinator then merges.

- An explicit ship request follows [ship-item.md](../workflows/ship-item.md): `ship-item.js` remains validation-only, while the default-branch trusted host collects immutable PR evidence, calls a tool-free Claude/Codex apex, and exclusively owns the exact-head merge sink after protected-environment approval.

This is the only orchestration pattern this repo endorses. See [references/orchestration-patterns.md](../references/orchestration-patterns.md) for the full pattern catalog and anti-patterns.

## Decision matrix

```
Is the work a single perspective on a single artifact?
├── Yes → Direct persona invocation
└── No  → Are the sub-tasks independent (no shared mutable state, no ordering)?
         ├── Yes → Coordinator may use risk-based parallel fan-out
         └── No  → Coordinator runs the required workflow stages sequentially
```

## Worked example: valid orchestration

An explicit ship request is the canonical merge orchestrator in this repo:

```text
ship request → coordinator follows ship-item.md
  ├── fixed coordinator commands → PR/base/head/checks/diff/reviewer evidence
  ├── code-reviewer → shell-less Fable/max apex allow/hold verdict
  └── (as risk requires) security-auditor / test-engineer reports
                  ↓ exact PR/head + allow verdict
        merge sink (workflow coordinator only)
                  ↓
        go/no-go decision + rollback plan
```

Why this works:
- Each sub-agent operates on the same diff but produces a **different perspective**
- They have no dependencies on each other → genuine parallelism, real wall-clock savings
- Each runs in a fresh context window → main session stays uncluttered
- The merge step is small and benefits from full context, so it stays in the main agent

## Worked example: invalid orchestration (do not build this)

A `meta-orchestrator` persona whose job is "decide which other persona to call":

```
“work on this PR” → meta-orchestrator
                  ↓ (decides "this needs a review")
              code-reviewer
                  ↓ (returns)
              meta-orchestrator (paraphrases result)
                  ↓
              user
```

Why this fails:
- Pure routing layer with no domain value
- Adds two paraphrasing hops → information loss + 2× token cost
- The user already knows they want a review; let the coordinator invoke `code-reviewer` directly
- Replicates work that `AGENTS.md` intent-mapping already does

## Rules for personas

1. A persona is a single role with a single output format. If you find yourself adding a second role, create a second persona.
2. **Personas do not invoke other personas.** Composition is the job of the coordinator acting on explicit user intent. On Claude Code this is also a hard platform constraint — *"subagents cannot spawn other subagents"* — so the rule is enforced for you.
3. A persona may invoke skills (the *how*).
4. Every persona file ends with a "Composition" block stating where it fits.

## Claude Code interop

The personas in this repo are designed to work as Claude Code subagents and as Agent Teams teammates without modification:

- **As subagents:** auto-discovered from the project (and when packaged as a plugin). Use the Agent tool with `subagent_type: code-reviewer` (or `security-auditor`, `test-engineer`). [ship-item.md](../workflows/ship-item.md) is the canonical merge example.
- **As Agent Teams teammates** (experimental, requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): reference the same persona name when spawning a teammate. The persona's body is **appended to** the teammate's system prompt as additional instructions (not a replacement), so your persona text sits on top of the team-coordination instructions the lead installs (SendMessage, task-list tools, etc.).

Subagents only report results back to the main agent. Agent Teams let teammates message each other directly. Use subagents when reports are enough; use Agent Teams when sub-agents need to challenge each other's findings (e.g. competing-hypothesis debugging). See [references/orchestration-patterns.md](../references/orchestration-patterns.md) for the full mapping.

Project-local agents support frontmatter hooks after workspace trust; plugin-packaged agents ignore hooks. Security boundaries therefore require declarative `disallowedTools` first. Hooks may add defense in depth but must not be the only barrier.

## Adding a new persona

1. Create `agents/<role>.md` with the same frontmatter format used by existing personas.
2. Define the role, scope, output format, and rules.
3. Add a **Composition** block at the bottom (Invoke directly when / Invoke via / Do not invoke from another persona).
4. Add the persona to the table at the top of this file.
5. If the persona enables a new orchestration pattern, document it in `references/orchestration-patterns.md` rather than inventing the pattern in the persona file itself.
