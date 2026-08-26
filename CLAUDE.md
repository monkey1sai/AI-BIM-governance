# CLAUDE.md

Claude Code entrypoint for this repository. Shared agent instructions and the
repository boundary are maintained in `AGENTS.md`, the sole source of truth.

@AGENTS.md

## Claude-specific runtime notes

- Claude project plugin enablement/disablement is machine truth from
  `.claude/settings.json` and `claude plugin list`; the repo skill inventory is
  `agent-skills-manifest.json`.
- GitNexus generated content is owned by `AGENTS.md`. Use the reviewed CLI with
  `--index-only`; do not regenerate or edit a duplicate block in this file.
