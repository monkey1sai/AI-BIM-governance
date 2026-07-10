# Codex Governance Routing and Auto-Update Program

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved global Codex governance, AI-BIM repo overlay, and fail-closed unattended maintenance system as independently testable slices.

**Architecture:** Global files remain the machine runtime source of truth. The repo-local files hold only AI-BIM behavior and verification overlays. The maintenance engine is deterministic PowerShell, staged in this repository for review and installed into `CODEX_HOME` only after its fake-home, rollback, and health-gate tests pass.

**Tech Stack:** PowerShell 7.5.4, Codex CLI 0.144.1 compatibility, TOML/JSON, Windows ScheduledTasks, existing assertion-based PowerShell tests, GitNexus impact/detect_changes.

## Global Constraints

- Do not modify global config, create Scheduled Tasks, or apply updates until the implementation slice has passed its foreground gates.
- Global task routing has one source of truth: `C:\Users\IOT\.codex\docs\agents\task-routing.md`.
- Skills are trusted only through the foreground allowlist; installed does not mean trusted.
- Exact versions, commit SHAs, archive hashes, staged tree hashes, and capability baselines are mandatory for unattended Apply.
- New hooks, MCP servers, connectors, destructive/open-world tools, setup/install scripts, or permission expansion stop the candidate.
- No secrets, tokens, credentials, production dependencies, or production runtime files are added.
- High-risk or irreversible actions require user confirmation; deterministic maintenance is the only unattended exception.

---

## Worktree and execution order

- [ ] Use `C:\Repos\active\iot\AI-BIM-governance.worktrees\codex-governance-auto-update-design` for every repo change. Do not touch the dirty main checkout.
- [ ] Run Plan A G0 and resolve the `max` versus approved `high` effort drift before changing global files.
- [ ] Execute Plan A G1-G4 as one host-level change cohort; record hashes and rollback evidence instead of creating a false Git commit for files outside the repository.
- [ ] Execute Plan B in three Green commits: repo config, compact overlays, and spec-to-done role routing.
- [ ] Execute Plan C in RED/GREEN tasks. Install the engine to a fake `CODEX_HOME`, run Audit/Stage/Apply/Rollback rehearsal, then install to the live `CODEX_HOME`.
- [ ] Register `CodexGovernance-Audit` only after all engine tests pass. Register `CodexGovernance-Apply` only after one foreground Apply and one rollback drill pass.

## Gates between plans

- Plan B may start only when the global routing document and role names are finalized.
- Plan C may start its trust onboarding only when the global maintenance contract and source boundaries are approved.
- Scheduled Apply remains disabled if any rollback, ACL, profile, plugin rebind, or health gate fails.
- A candidate may be staged and reported without being applied; “staged” is never reported as “updated”.

## Final verification

```powershell
Set-Location 'C:\Repos\active\iot\AI-BIM-governance.worktrees\codex-governance-auto-update-design'
pwsh -NoProfile -File .\scripts\tests\test-agent-governance-check.ps1
git diff --check
git status --short --branch
```

Expected: governance assertions pass, `git diff --check` is empty, and only the four plan files are uncommitted before the plan-document commit. After implementation, run the repository’s normal targeted checks plus the maintenance harness from Plan C.

## Plan files

- [ ] [Global governance and routing](2026-07-10-codex-global-governance-routing.md)
- [ ] [AI-BIM repo overlay](2026-07-10-ai-bim-agent-governance-overlay.md)
- [ ] [Unattended maintenance engine](2026-07-10-codex-unattended-maintenance.md)

