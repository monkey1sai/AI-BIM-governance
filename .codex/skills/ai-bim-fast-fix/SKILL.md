---
name: ai-bim-fast-fix
description: Use for a single-service, roughly 1-3 file AI-BIM bug, docs, test, timeout, logging, or error-handling fix that does not change a public contract, user-facing workflow, security, deploy, migration, Kit/WebRTC, or GPU runtime behavior.
---

# AI-BIM Fast Fix

Use Lane F only while every boundary below remains true.

- One coordinator owns all reads, edits, and decisions.
- Do not use Superpowers, create a spec, create a plan document, or spawn a subagent.
- Read only the files needed for the fix.
- Run only the targeted test or smallest direct verification.
- GitNexus impact is optional; use source search and git diff for the normal fast path.
- Do not automatically push, open a PR, or merge.
- A clean checkout does not require a worktree.

Escalate directly to Lane G as soon as the change crosses services, changes a public contract or user-facing behavior, touches security/deploy/migration/Kit/WebRTC/GPU runtime, requires destructive action, or reveals HIGH/CRITICAL impact. Escalate only to Lane B when scope grows beyond a Fast Fix but still stays inside one service and none of those Governed triggers applies.
