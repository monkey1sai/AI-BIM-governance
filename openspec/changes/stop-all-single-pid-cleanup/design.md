# Design: stop-all-single-pid-cleanup

## Context

`stop-all.ps1` runs under `Set-StrictMode -Version Latest`. In Windows PowerShell, `Get-ChildItem` assigned to a variable may be `$null`, a scalar object, or an array depending on result count. Accessing `.Count` on a scalar `FileInfo` is not valid under strict mode.

PR #215 added `governance-service` to `stop-all.ps1`, and post-merge cleanup produced exactly one stale pid file. The script stopped the process but then printed:

```text
The property 'Count' cannot be found on this object.
```

## Decision

Use PowerShell array wrapping at the source:

```powershell
$pidFiles = @(Get-ChildItem -Path $RunDir -Filter "*.pid" -ErrorAction SilentlyContinue)
```

This preserves existing behavior for zero and many pid files while making the one-file case safe.

## Verification

- Parser / syntax check for `scripts/stop-all.ps1`.
- `scripts/tests/test-stop-all-single-pid.ps1`.
- `npx openspec validate stop-all-single-pid-cleanup --strict`.
