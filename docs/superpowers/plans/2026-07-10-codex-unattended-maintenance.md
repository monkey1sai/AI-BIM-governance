# Codex Unattended Maintenance Engine Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Replace the moving-ref updater with a deterministic, journaled, fail-closed Audit/Stage/Apply/Rollback engine for Codex CLI, marketplaces/plugins, and allowlisted skills.

**Architecture:** Repo-owned PowerShell modules are installed into CODEX_HOME\bin only after tests pass. Audit resolves exact candidates; Stage validates them in disposable homes; Apply performs one dependency-cohort transaction with snapshots and a journal; health failure rolls back the whole cohort and disables only Apply.

**Tech Stack:** PowerShell 7.5.4, .NET ZipArchive, npm CLI, Codex CLI, Git, JSON/TOML, Windows ScheduledTasks, assertion-based PowerShell tests.

All module paths below are exact: implementation modules live under `scripts/lib/codex-governance/`, entry points under `scripts/dev/`, tests under `scripts/tests/`, and the example manifest under `scripts/config/codex-governance/`.

## Global Constraints

- The updater never asks an unattended model to decide trust and never executes downloaded setup/install scripts.
- sources.allowlist.json and its SHA256 seal are foreground-only trust roots; scheduled jobs read them only.
- Candidate artifacts are exact versions/SHAs, archive hashes, staged tree hashes, capability diffs, and age-limited metadata.
- Locking, atomic JSON writes, cohort journaling, snapshot restore, and crash recovery are mandatory.
- Active Codex/Node processes in a target CLI tree cause deferred_active_process; they are never terminated.
- New hooks, MCP/connectors, destructive/open-world tools, permissions, scripts, path escapes, schema failures, or warning regressions stop the cohort.
- Apply is disabled after rollback failure; Audit remains available for diagnostics.

---

### Task 1: M1 - Common primitives and fake-home harness

**Files:** Create scripts/lib/codex-governance/Maintenance.Common.ps1, Maintenance.Transaction.ps1, scripts/dev/Invoke-CodexGovernanceMaintenance.ps1, and tests/test-codex-maintenance-common.ps1 plus tests/test-codex-maintenance-transaction.ps1.

**Interfaces:** Resolve-ContainedPath, Write-AtomicJson, Get-ContentTreeHash, Enter-MaintenanceLock, Write-JournalPhase, Resume-InterruptedTransaction. Runner parameters are Mode Audit|Apply|Recover|Verify, CodexHome absolute, and optional CandidatePath.

- [ ] Step 1: Write RED tests for traversal, rooted paths, symlink/junction escape, atomic replacement, lock contention, interrupted applying journal, and fake-home containment. Expected: missing functions or failed assertions.
- [ ] Step 2: Implement same-directory temporary files, flush-before-rename, File.Replace for existing files, same-volume rename for new files, a lock handle held for the run, and normalized-root containment checks.
- [ ] Step 3: Implement journal recovery for discovered -> pinned -> staged -> validated -> snapshotted -> applying -> verifying -> committed. Unfinished applying/verifying/rollback phases restore the recorded snapshot.
- [ ] Step 4: Run both test scripts with pwsh -NoProfile. Expected: every scenario passes and fake homes are removed in finally.

### Task 2: M2 - Foreground trust onboarding

**Files:** Create Maintenance.Trust.ps1, Initialize-CodexGovernanceTrust.ps1, test-codex-maintenance-trust.ps1, and sources.allowlist.example.json.

**Interfaces:** New-TrustedInventory, Get-CanonicalJsonBytes, Seal-Allowlist, Read-SealedAllowlist, Test-AllowlistOwnerAcl, Compare-CapabilityBaseline.

- [ ] Step 1: RED cases cover seal/owner/ACL mismatch, unknown source, moving-ref-only candidate, and an arbitrary command field. Each exits 1 without creating a candidate.
- [ ] Step 2: Implement source ID, kind, URI/path, ref policy, subpaths, validator IDs, cohort, CLI range, independent flag, native absolute paths, and capability baseline. Reject command strings.
- [ ] Step 3: Seal canonical UTF-8 JSON with stable property ordering, atomic seal write, expected owner SID, and ACL verification before every Audit/Apply.

### Task 3: M3 - CLI exact closure

**Files:** Create Maintenance.Cli.ps1, test-codex-maintenance-cli.ps1, and test-codex-maintenance-cli-rehearsal.ps1.

**Interfaces:** Get-CliCandidate, Stage-CliClosure, Test-CliLifecycleBaseline, Test-ActiveCliProcess, Invoke-CliRollbackRehearsal, Apply-CliClosure, Restore-CliClosure.

- [ ] Step 1: RED tests use a fake npm prefix and fail on lifecycle-script change, closure hash mismatch, active target process, or failed rehearsal.
- [ ] Step 2: Stage exact root/platform packages, registry integrity, tarballs, shims, and tree hashes in a disposable prefix; run new and old codex --version checks.
- [ ] Step 3: Return deferred_active_process without changing live hashes when an active executable resolves inside target tree; otherwise snapshot and atomically swap sibling trees with a journal.
- [ ] Step 4: Run CLI rehearsal with CurrentVersion 0.144.1 and CandidateVersion 0.144.1. Expected: closure hashes match after install/rollback and live prefix is unchanged.

### Task 4: M4 - Pinned marketplace/plugin cohort

**Files:** Create Maintenance.Plugin.ps1 and test-codex-maintenance-plugin.ps1.

**Interfaces:** Get-PluginCandidate, Stage-PinnedMarketplace, Get-PluginCapabilitySnapshot, Test-DeterministicPluginRebind, Apply-PluginCohort, Restore-PluginCohort.

- [ ] Step 1: RED tests reject non-40-character refs, resolved HEAD mismatch, hook/MCP/connector additions, disabled-plugin enablement, and unavailable rollback probe.
- [ ] Step 2: Stage in a child process with isolated CODEX_HOME, HOME, USERPROFILE, XDG_CACHE_HOME, APPDATA, and LOCALAPPDATA; run marketplace add with a full SHA, verify staged HEAD, and snapshot enabled state.
- [ ] Step 3: Enforce rebind gates; never fall back to moving-ref marketplace upgrade.

### Task 5: M5 - Pinned skills and content safety

**Files:** Create Maintenance.Skill.ps1 and test-codex-maintenance-skill.ps1.

**Interfaces:** Stage-PinnedSkillSource, Expand-ValidatedArchive, Get-SkillInventory, Test-SkillFrontmatter, Get-SkillCapabilitySnapshot, Apply-SkillSourceCohort, Restore-SkillSourceCohort.

- [ ] Step 1: RED archive tests reject rooted, parent, alternate-data-stream, symlink/junction escape paths, missing SKILL.md, duplicate names, local forks, plugin-managed skills, and source/hash mismatch.
- [ ] Step 2: Validate every archive entry before extraction with ZipArchive; validate frontmatter, license/provenance, intentional local diffs, script inventory, capability baseline, archive hash, and tree hash.
- [ ] Step 3: Stop on executable/code changes without a signed capability manifest; text/reference-only exact-SHA updates with unchanged capabilities use sibling staging, rename, and independent backups. Never execute downloaded scripts.

### Task 6: M6 - Orchestrator and health gates

**Files:** Modify Invoke-CodexGovernanceMaintenance.ps1; create Maintenance.Health.ps1 and test-codex-maintenance-health.ps1.

**Interfaces:** Invoke-MaintenanceAudit, Invoke-MaintenanceApply, Invoke-MaintenanceRecover, and Invoke-MaintenanceVerify return runId, mode, status, candidateIds, journalPath, health, rollback, and nextStep.

- [ ] Step 1: RED failure injections cover lock failure, stale candidate older than 24 hours, cohort member failure, warning regression, incomplete snapshot, and rollback failure.
- [ ] Step 2: Validate absolute tool paths, SID, ACL, fixed CODEX_HOME, sealed allowlist, candidate age, and cohort compatibility at startup; Audit writes immutable candidates; Apply accepts only recent validated candidates.
- [ ] Step 3: Compare strict doctor fail/warning baseline, MCP/profile/plugin health, and rollback completeness; any regression stops and reverses the whole cohort.
- [ ] Step 4: Back up the old updater and replace its live entry point with a fail-closed migration message or move it under bin\legacy; do not preserve Hook/Force behavior.

### Task 7: M7 - Scheduled Tasks and foreground installation

**Files:** Create Maintenance.ScheduledTasks.ps1, Register-CodexGovernanceMaintenanceTasks.ps1, test-codex-maintenance-scheduled-tasks.ps1, and run-codex-maintenance-tests.ps1.

**Interfaces:** New-CodexGovernanceTaskDefinition, Register-CodexGovernanceTask, Test-CodexGovernanceTask.

- [ ] Step 1: Test definitions without registration: absolute pwsh.exe -NoProfile -NonInteractive, fixed paths, current-user Interactive/Limited principal, StartWhenAvailable, IgnoreNew, and PT1H.
- [ ] Step 2: Implement Audit daily 02:30 and Apply Sunday 03:30 in Taipei Standard Time; registration is the final foreground action.
- [ ] Step 3: Run the complete harness. Expected: every scenario reports PASS, failed count 0.
- [ ] Step 4: Install to a fake home, run Audit, one Apply, and one rollback drill. Register Audit only after all tests; register Apply only after the drill and health report pass.

### Task 8: M8 - Acceptance and retention

**Files:** Read CODEX_HOME maintenance state/journal/candidates and create a redacted acceptance report.

- [ ] Step 1: Confirm reports contain no secrets, applied state contains exact version/SHA/hash, journals are complete, snapshots obey retention, and stale candidates are rejected.
- [ ] Step 2: Confirm Apply is disabled after rollback failure while Audit remains available; verify task state, one-instance behavior, and one-hour limit.
