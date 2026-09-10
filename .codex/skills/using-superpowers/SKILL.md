---
name: using-superpowers
description: Use only when the user explicitly requests the full Superpowers workflow or this skill by name. Do not activate for routine fixes or merely because a task is complex.
---

# Explicit Superpowers entry

This is a local adaptation of obra/superpowers v6.1.1. The repository's
`AGENTS.md` and `docs/agents/superpowers-invocation-policy.md` govern invocation.

1. Identify the user's explicit request and its authorized outcome. A request to
   inspect or edit this skill is not a request to execute the workflow. Without
   explicit invocation, continue the repository's native F/B/G route.
2. Load only the requested skill or the current phase of an explicitly requested
   full workflow. Use its declared inputs and minimum relevant sources; do not
   preload the library or all phase references. If the requested workflow is
   unavailable or materially ambiguous, report that specific gap.
3. Follow that workflow within its existing state, evidence contract and budget.
   Resume or retry does not reset counters. A dispatched subagent follows its
   bounded assignment and does not bootstrap another workflow.
4. Report the result, supporting checks and missing evidence. Stop at the
   requested workflow's boundary; do not automatically chain another skill.
   An explicitly authorized full workflow may follow its own documented phases,
   subject to the user's current scope and required approval gates.

Codex invocation policy is in `agents/openai.yaml`; other harnesses must follow
their own adapter and the repository policy. When a selected workflow needs a
tool mapping, read only the matching reference: Codex `references/codex-tools.md`,
Pi `references/pi-tools.md`, or Antigravity `references/antigravity-tools.md`.
