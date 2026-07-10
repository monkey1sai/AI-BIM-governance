# Task 7 Report

Implemented the scheduled-task definitions and explicit foreground registration path.

- `Maintenance.ScheduledTasks.ps1` defines Audit (daily 02:30) and Apply (Sunday 03:30) using Taipei Standard Time metadata, absolute PowerShell paths, `-NoProfile -NonInteractive`, current-user Interactive/Limited principal, `StartWhenAvailable`, `IgnoreNew`, and `PT1H`.
- `Register-CodexGovernanceMaintenanceTasks.ps1` is the only registration entry point; tests only construct and validate definitions.
- Added focused definition test and aggregate maintenance harness.

Validation: `pwsh -NoProfile -NonInteractive -File scripts/dev/run-codex-maintenance-tests.ps1` passed with `failed count 0`.
