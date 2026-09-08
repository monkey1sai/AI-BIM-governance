---
name: pr-queue-manager
description: Use when legacy instructions refer to pr-queue-manager while observing or delivering one named repository PR.
---

# PR queue manager compatibility alias

**REQUIRED SUB-SKILL:** Use autonomous-pr-queue before any command.

This `LEGACY_GUARDED` name is retained for discovery only. The queue is not FIFO automation and never processes all open PRs. Repository helper commands require `--pr <number>` and are GitHub-read-only; lifecycle events may run strictly owned-process cleanup; preflight never rewrites evidence. It must not become a second controller beside `autonomous-pr-queue`, and it is not a merge or approval prerequisite in `CANARY_ACTIVE` or `AUTONOMOUS_ACTIVE`.

If the named PR, external authority, exact head, complete pagination, source-bound checks, finding dispositions, or bounded-round evidence is missing, return `HELD`.
