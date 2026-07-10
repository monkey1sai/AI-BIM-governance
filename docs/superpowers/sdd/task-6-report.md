# M6 report

Implemented `Maintenance.Health.ps1` and the Audit/Apply/Recover/Verify orchestrator. Reports include `runId`, `mode`, `status`, `candidateIds`, `journalPath`, `health`, `rollback`, and `nextStep`. Startup rejects relative CODEX_HOME/tool paths and validates sealed allowlists when configured; candidates older than 24 hours are rejected. Health gates compare doctor failures/warnings and MCP/profile/plugin summaries and fail on incomplete rollback.

Validation: PowerShell parser check, Audit smoke run, and `scripts/tests/test-codex-maintenance-health.ps1`.

Known gap: legacy updater migration is intentionally left to the installation/migration task; no live CODEX_HOME or scheduled task was modified.

Follow-up: startup now wires ToolPath/allowlist/SID, Audit/Apply validate trusted inventory, Apply snapshots before journaling, Recover handles absent journal.

Follow-up 2: partial trust arguments now fail closed; Verify writes apply-disabled.json and reports disabled=true on regression.
