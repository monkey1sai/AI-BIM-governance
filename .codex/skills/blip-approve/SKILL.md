---
name: blip-approve
description: Refusal-only compatibility skill for the retired monkey1sai-blip automated approval lane.
---

# Automated approval retired

`monkey1sai-blip` User/PAT approval and its protected broker are retired.

- Never invoke, install, repair, or recreate the automated approval path.
- Never read or request `BLIP_GITHUB_TOKEN` or an approval capability.
- Never use a bot, PAT, bypass, auto-merge, or protection change to manufacture counted approval.
- Replacement authority must be a source-pinned, App-ID-pinned required AI CheckRun bound to the exact head.
- If CODEOWNERS or repository protection still names the retired identity and the replacement AI check is not activated, return `HELD_REPOSITORY_APPROVAL_POLICY`.
- If auto-merge is active, return `HELD_AUTO_MERGE_ACTIVE`.

This skill performs no mutation. Its only valid automated-approval outcome is `HELD_AUTOMATED_APPROVAL_RETIRED`.
