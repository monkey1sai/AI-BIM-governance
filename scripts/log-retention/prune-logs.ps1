<#
.SYNOPSIS
Prunes structured log daily directories older than the configured retention
window. Part of the cross-service-structured-log-baseline capability.

.DESCRIPTION
Walks <LogRoot>/<service>/<YYYY-MM-DD>/ and identifies any date directory
whose date is more than <RetentionDays> calendar days before today (UTC).
By default the script runs in -DryRun mode and only reports the candidate
directories — pass -Apply to actually delete.

The script NEVER deletes:
  - The LogRoot directory itself.
  - Any per-service directory (logs/<service>/).
  - A date directory that is exactly <RetentionDays> days old (boundary
    intentionally retained; only > RetentionDays is purged).
  - The _recovery/ helper directory (used by adapters when the main sink
    fails); operators may want to inspect it independently.

.PARAMETER LogRoot
Root directory containing per-service subfolders. Defaults to
<repo-root>/logs unless LOG_ROOT env is set.

.PARAMETER RetentionDays
Calendar days (UTC) to keep. Default 30 unless LOG_RETENTION_DAYS env is set.

.PARAMETER Apply
Actually delete candidate directories. Without this switch the script lists
deletions only.

.PARAMETER DryRun
Explicitly select report-only mode. This switch is mutually exclusive with
-Apply so a contradictory invocation cannot delete data.

.PARAMETER Quiet
Suppress per-directory log output. Summary line still emitted.

.EXAMPLE
.\prune-logs.ps1
Dry run against default LogRoot.

.EXAMPLE
.\prune-logs.ps1 -LogRoot D:\logs -RetentionDays 14 -Apply
Delete logs older than 14 days.
#>

[CmdletBinding()]
param(
    [string] $LogRoot,
    [int] $RetentionDays = 0,
    [switch] $Apply,
    [switch] $DryRun,
    [switch] $Quiet,
    # When set, prune using this 'today' (UTC) instead of the system clock.
    # Test-only: drives boundary checks deterministically.
    [datetime] $TodayUtc
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Apply -and $DryRun) {
    throw '-Apply and -DryRun are mutually exclusive.'
}

if (-not $LogRoot) {
    if ($env:LOG_ROOT) {
        $LogRoot = $env:LOG_ROOT
    } else {
        # Default: <repo-root>/logs (script lives at scripts/log-retention/).
        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
        $LogRoot = Join-Path $repoRoot 'logs'
    }
}
if ($RetentionDays -le 0) {
    $envValue = $env:LOG_RETENTION_DAYS
    if ($envValue -and ([int]::TryParse($envValue, [ref] ([int]$null)))) {
        $RetentionDays = [int] $envValue
    } else {
        $RetentionDays = 30
    }
}

if (-not $PSBoundParameters.ContainsKey('TodayUtc')) {
    $TodayUtc = (Get-Date).ToUniversalTime().Date
} else {
    $TodayUtc = $TodayUtc.ToUniversalTime().Date
}

$cutoff = $TodayUtc.AddDays(-1 * $RetentionDays)

if (-not (Test-Path -LiteralPath $LogRoot)) {
    Write-Host "log root not found, nothing to prune: $LogRoot"
    return [pscustomobject]@{
        log_root = $LogRoot
        cutoff_date = $cutoff.ToString('yyyy-MM-dd')
        retention_days = $RetentionDays
        candidate_count = 0
        deleted_count = 0
        skipped_count = 0
        applied = [bool] $Apply
    }
}

if (-not $Quiet) {
    Write-Host "structured-log retention sweep"
    Write-Host ("  log_root:       {0}" -f $LogRoot)
    Write-Host ("  today (UTC):    {0:yyyy-MM-dd}" -f $TodayUtc)
    Write-Host ("  retention_days: {0}" -f $RetentionDays)
    Write-Host ("  cutoff date:    older than {0:yyyy-MM-dd} (exclusive) is purged" -f $cutoff)
    Write-Host ("  mode:           {0}" -f ($(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })))
    Write-Host ""
}

$candidates = @()
$skipped = 0
$dateRegex = '^(\d{4})-(\d{2})-(\d{2})$'

Get-ChildItem -LiteralPath $LogRoot -Directory | ForEach-Object {
    $service = $_.Name
    $serviceDir = $_.FullName
    Get-ChildItem -LiteralPath $serviceDir -Directory | ForEach-Object {
        $entry = $_
        if ($entry.Name -eq '_recovery') {
            $script:skipped += 1
            if (-not $Quiet) { Write-Host ("  SKIP   {0}/{1} (recovery sink)" -f $service, $entry.Name) }
            return
        }
        if ($entry.Name -notmatch $dateRegex) {
            $script:skipped += 1
            if (-not $Quiet) { Write-Host ("  SKIP   {0}/{1} (not a YYYY-MM-DD)" -f $service, $entry.Name) }
            return
        }
        $entryDate = [datetime]::ParseExact($entry.Name, 'yyyy-MM-dd', $null)
        if ($entryDate -ge $cutoff) {
            if (-not $Quiet) { Write-Host ("  KEEP   {0}/{1}" -f $service, $entry.Name) }
            return
        }
        $script:candidates += [pscustomobject]@{
            service = $service
            date = $entry.Name
            path = $entry.FullName
            age_days = ($TodayUtc - $entryDate).Days
        }
    }
}

$deleted = 0
foreach ($c in $candidates) {
    if ($Apply) {
        try {
            Remove-Item -LiteralPath $c.path -Recurse -Force
            $deleted += 1
            if (-not $Quiet) { Write-Host ("  DELETE {0}/{1} (age={2}d)" -f $c.service, $c.date, $c.age_days) }
        } catch {
            Write-Host ("  ERROR  {0}/{1}: {2}" -f $c.service, $c.date, $_.Exception.Message) -ForegroundColor Red
        }
    } else {
        if (-not $Quiet) { Write-Host ("  WOULD  {0}/{1} (age={2}d)" -f $c.service, $c.date, $c.age_days) }
    }
}

if (-not $Quiet) {
    Write-Host ""
    Write-Host ("summary: candidates={0}, deleted={1}, skipped={2}" -f $candidates.Count, $deleted, $skipped)
}

return [pscustomobject]@{
    log_root = $LogRoot
    cutoff_date = $cutoff.ToString('yyyy-MM-dd')
    retention_days = $RetentionDays
    candidate_count = $candidates.Count
    deleted_count = $deleted
    skipped_count = $skipped
    applied = [bool] $Apply
    candidates = $candidates
}
