---
name: pr-queue-manager
description: Use when legacy instructions refer to pr-queue-manager while observing or delivering one named repository PR.
---

# PR queue manager compatibility alias

**REQUIRED SUB-SKILL:** Use autonomous-pr-queue before any command.

This name is retained for discovery only. The queue is not FIFO automation and never processes all open PRs. Repository helper commands require `--pr <number>` and are GitHub-read-only; lifecycle events may run strictly owned-process cleanup; preflight never rewrites evidence; counted approval and native merge remain independent coordinator actions under the canonical exact-tuple policy.

If the named PR, authority, exact head, fixed reviewer, review mode, source-bound checks, or human-critical override is missing, return `HELD`.
