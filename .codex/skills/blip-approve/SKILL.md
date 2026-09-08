---
name: blip-approve
description: Refusal-only retired automated approval entrypoint; explain manual exact-head GitHub UI approval without invoking a broker.
---

# Retired approval lane

The User/PAT counted-approval automation is retired. Do not execute any helper, broker, Live/override mode, credential lookup or direct API vote. An explicit invocation of this skill does not revive it.

Review and prepare the evidence packet only. The current session reviews the full diff; a policy-eligible human uses the GitHub UI to approve the exact current head. Preserve required checks, CODEOWNERS, resolved threads, branch protection and real runtime evidence. If machine policy still demands the retired path, report HELD; do not replace it with another automated identity or weaken protection.

Follow `docs/agents/github-workflow.md` for the current session-review and manual handoff contract. This skill grants no push, approve, merge, deployment, credential or permission authority.
