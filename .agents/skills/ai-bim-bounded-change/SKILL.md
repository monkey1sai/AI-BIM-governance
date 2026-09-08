---
name: ai-bim-bounded-change
description: Use for a clear, limited feature or fix within one AI-BIM service when architecture boundaries, public APIs or schemas, security, deploy, migration, Kit/WebRTC, GPU runtime, and user-facing routes or workflows remain unchanged.
---

# AI-BIM Bounded Change

Use Lane B with one writing coordinator.

- Keep a 3-5 item inline checklist; do not create a detailed plan document.
- Do not use the full Superpowers lifecycle or create a spec.
- Use one debugger only when the root cause is unknown.
- Use at most one read-only reviewer after implementation.
- Never run parallel writers.
- Run affected tests, not the full repository suite by default.
- Run one task-level or primary-entry-symbol GitNexus impact; do not repeat impact for every local helper.
- Run detect_changes only when code symbols or execution flows changed.
- Do not automatically push, open a PR, or merge.

Escalate to Lane G if scope crosses services or expands into architecture, public contract/schema, user-facing workflow, security, deploy, migration, destructive scripts, Kit/WebRTC/GPU runtime, or HIGH/CRITICAL impact.
