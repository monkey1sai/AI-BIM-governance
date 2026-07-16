# Superpowers Invocation Policy

> Lazy-loaded by `AGENTS.md` / `CLAUDE.md`; this is the local source of truth for skill invocation.

## 1. Default mode

Default to **repo-native lean mode**: one coordinator, minimum necessary source of truth, targeted exploration, GitNexus impact before code-symbol changes, and affected-area verification first. Do not automatically create a spec, implementation-plan file, subagent, or Superpowers workflow. A heavy skill may be suggested but needs explicit user authorization.

The repo vendors the official `obra/superpowers` v6.1.1 skill-only bundle as tracked physical copies. [`agent-skills-manifest.json`](../../agent-skills-manifest.json) owns the pinned provenance and mirrors `.claude/skills` to `.codex/skills`; plugin hooks, commands, and marketplace state are not vendored. Claude keeps `superpowers@claude-plugins-official` disabled to avoid duplicate discovery, while Codex plugin enablement remains user-scoped in `%USERPROFILE%\.codex\config.toml`. Repo-local skill availability does not authorize invocation: this policy still governs every Superpowers skill, both harnesses default to their native read-only / plan permission mode, and Codex metadata mechanically disables implicit invocation for the explicit-only bootstrap, shaping, planning, subagent, worktree, and branch-closeout entries.

## 2. Risk routing matrix

| Tier | Examples | Route |
|---|---|---|
| **0 — Trivial** | Explain a term, inspect one file, one command, small doc correction, clear one-line setting. | No Superpowers, subagent, or plan file. Execute directly and run one needed check. |
| **1 — Bounded implementation** | Clear bug, one service, small cross-file change, explicit acceptance, existing design/contract. | Repo-native workflow with 3–7 inline steps; no Superpowers spec/plan, brainstorming, or writing-plans. One focused skill (debugging, TDD, verification) may serve this work only and must not form a chain. One coordinator; at most one truly parallel read-heavy subagent. |
| **2 — Complex but defined** | Cross-service change, contract migration, multiple runtime components, user-facing slice with clear source and acceptance. | Use existing `docs/plans`, OpenSpec, contract, or approved design. Do not brainstorm a defined requirement or duplicate it in `docs/superpowers/specs`. A short checklist is allowed without writing-plans. One coordinator plus necessary bounded read-only explorer/reviewer; no parallel writers or whole-repo reviewer scan. Verify by the repository evidence contract. |
| **3 — Ambiguous or high-risk** | Undecided architecture, material trade-offs, auth/permissions/deploy/destructive or irreversible action, large public API/data change, missing acceptance. | Explain why design work is necessary, then only suggest a single shaping skill. Each needs explicit authorization. Existing OpenSpec or approved `docs/plans` must not be duplicated. Shaping produces decisions only; planning produces a plan only. Full `spec-to-done` also needs explicit invocation and an approved spec path. |

## 3. Explicit-only skills

`spec-to-done`, brainstorming, writing-plans, wayfinding/work-shaping, subagent-driven-development, any workflow that creates a branch/worktree/commit/PR/merge automatically, and any forced multi-stage reviewer loop are explicit-only. **Task complexity itself is never a substitute for explicit invocation.**

Research or a throwaway prototype may be selected as one bounded Lane G aid when it answers a named uncertainty. It must have a fixed question, evidence path, and stop condition; it must not silently activate a full lifecycle.

## 4. No automatic chaining

| From | Automatic next step |
|---|---|
| work-shaping map | spec or implementation — prohibited |
| brainstorm | plan — prohibited |
| plan | implementation — prohibited |
| implementation | review swarm — prohibited |
| verification | commit — prohibited |
| commit | push / PR — prohibited |
| PR | merge — prohibited |

Only an explicitly invoked workflow may authorize its own documented chain, such as `spec-to-done`; otherwise each next stage needs user authorization.

## 5. Work-shaping boundary

Use a work-shaping map only for a destination whose unresolved decisions cannot fit one effective session. The map stores links and short status only; each decision lives in one ticket. Allowed ticket outcomes are research evidence, a throwaway prototype, a human decision, or completion of a manual unblocker.

Apply a no-fog early exit: when the requirement and acceptance criteria are already clear, skip the map. Route to the existing requirement source and implement the smallest vertical slice.

Work shaping must not edit production code, create an implementation PR, or claim the destination is delivered. Graduation occurs when material fog is resolved and implementation can be represented as agent-ready vertical tickets with blockers, validation, and evidence.

## 6. Spec source-of-truth rule

When an OpenSpec change, approved `docs/plans` requirement, contract, or user-provided complete spec exists, do not brainstorm it again. Do not create parallel OpenSpec, `docs/plans`, work-shaping maps, and `docs/superpowers/specs` specifications for one need; use the existing source and label mismatches as implementation gaps. `docs/superpowers/` may retain history or explicitly requested artifacts, never a default task entrypoint.

## 7. Ticket context rule

Each implementation ticket must be independently verifiable and sized for one fresh agent context. Carry forward only the requirement source, blocker outcomes, affected boundaries, acceptance criteria, validation commands, and evidence contract. Do not replay the entire discovery or specification conversation in every implementation session.

## 8. Subagent budget

Default to zero subagents. Dispatch only independent, read-heavy work that can genuinely run in parallel. Never use one agent per small task, recursively create child agents, or ask a reviewer to rescan the whole repo. Small docs lookup stays with the coordinator. A final report must state each dispatched agent's reason and bounded scope.
