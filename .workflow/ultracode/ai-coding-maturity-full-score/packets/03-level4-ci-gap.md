# Packet 03-level4-ci-gap: Level 4 CI Gap

## Objective

Identify the smallest repo-local CI artifacts needed to move from partial Level 4 to a credible Level 4 baseline.

## Context

Read-only packet. Parent may add workflow files after integration.

## Sources

- `.github/workflows/`
- package manifests
- requirements files
- `scripts/verify-all.ps1`
- `scripts/tests/*.ps1`
- `docs/agents/sub-repo-verify-commands.md`

## Ownership

Read-only. Do not edit files.

## Do

- Find existing package/test commands.
- Recommend a minimal GitHub Actions workflow that is likely to be maintainable.
- Distinguish fast CI from GPU/Kit/self-hosted smoke.
- Identify commands that should not be placed in hosted CI.

## Do not

- Edit files.
- Assume Docker/GPU/Kit availability on GitHub-hosted runners.

## Expected output

- Summary
- Evidence
- Proposed Level 4 workflow shape
- Risks

## Verification

Use read-only file inspection and command discovery.

## Handoff format

Markdown under `Summary`, `Evidence`, `Proposal`, `Risks`.
