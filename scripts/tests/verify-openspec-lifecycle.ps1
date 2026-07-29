[CmdletBinding()]
param(
    [string] $RepoRoot = '',
    [string] $BaseRef = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\lib\openspec-lifecycle.ps1')

function Get-DiffTargetPaths {
    param([Parameter(Mandatory = $true)][string] $Against)

    # Disable rename detection and consume NUL-delimited output so both the old
    # and new side of a move are evaluated. Deleted archive evidence must remain
    # visible to the completion gate instead of disappearing from the path set.
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'git'
    $startInfo.WorkingDirectory = $RepoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    foreach ($argument in @('-c', 'core.quotepath=false', 'diff', '--name-only', '-z', '--no-renames', $Against, '--')) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw "Unable to start git diff against $Against"
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
            throw "Timed out diffing lifecycle state against $Against"
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult().Trim()
        if ($process.ExitCode -ne 0) {
            throw "Unable to diff lifecycle state against ${Against}: $stderr"
        }
        return @($stdout.Split([char]0, [System.StringSplitOptions]::RemoveEmptyEntries))
    } finally {
        $process.Dispose()
    }
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
} else {
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}

$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$wipLimit = 6

Push-Location -LiteralPath $RepoRoot
try {
    $changesRoot = Join-Path $RepoRoot 'openspec\changes'
    $archiveRoot = Join-Path $changesRoot 'archive'
    if (-not (Test-Path -LiteralPath $changesRoot -PathType Container)) {
        throw "OpenSpec changes root not found: $changesRoot"
    }
    [void](Assert-OpenSpecNoReparseComponents -Anchor $RepoRoot -Target $changesRoot `
        -Label 'openspec/changes' -UnreadableCode 'repository_unreadable' `
        -ReparseCode 'repository_reparse_point')

    $activeChanges = @(Get-ChildItem -LiteralPath $changesRoot -Directory | Where-Object Name -ne 'archive')
    $deferredChanges = [System.Collections.Generic.List[string]]::new()
    $nonDeferredChanges = [System.Collections.Generic.List[string]]::new()
    $capabilityOwners = @{}

    foreach ($change in $activeChanges) {
        $state = Get-OpenSpecProposalState -ChangeDirectory $change.FullName -TrustedRoot $RepoRoot
        if ($state.LifecycleStatus -eq 'invalid') {
            $failures.Add("active change has invalid lifecycle marker: $($change.Name)")
        }
        if ($state.IsDeferred) {
            $deferredChanges.Add($change.Name)
            if (-not $state.HasCondition) {
                $failures.Add("deferred change lacks thaw/restart/closeout condition: $($change.Name)")
            }
            continue
        }

        $nonDeferredChanges.Add($change.Name)
        $specRoot = Join-Path $change.FullName 'specs'
        if (-not (Test-Path -LiteralPath $specRoot -PathType Container)) { continue }
        [void](Assert-OpenSpecNoReparseComponents -Anchor $RepoRoot -Target $specRoot `
            -Label "OpenSpec specs for $($change.Name)" -UnreadableCode 'repository_unreadable' `
            -ReparseCode 'repository_reparse_point')
        foreach ($capability in Get-ChildItem -LiteralPath $specRoot -Directory) {
            if (-not $capabilityOwners.ContainsKey($capability.Name)) {
                $capabilityOwners[$capability.Name] = [System.Collections.Generic.List[string]]::new()
            }
            $capabilityOwners[$capability.Name].Add($change.Name)
        }
    }

    foreach ($entry in $capabilityOwners.GetEnumerator()) {
        if ($entry.Value.Count -gt 1) {
            $failures.Add("non-deferred capability has multiple owners: $($entry.Key) => $($entry.Value -join ', ')")
        }
    }

    if ($nonDeferredChanges.Count -gt $wipLimit) {
        $warnings.Add("existing non-deferred WIP is $($nonDeferredChanges.Count) > $($wipLimit): $($nonDeferredChanges -join ', ')")
    }

    # A deferred marker is never valid in completed archive, including legacy entries.
    if (Test-Path -LiteralPath $archiveRoot -PathType Container) {
        [void](Assert-OpenSpecNoReparseComponents -Anchor $RepoRoot -Target $archiveRoot `
            -Label 'OpenSpec archive' -UnreadableCode 'repository_unreadable' `
            -ReparseCode 'repository_reparse_point')
        foreach ($archived in Get-ChildItem -LiteralPath $archiveRoot -Directory) {
            $state = Get-OpenSpecProposalState -ChangeDirectory $archived.FullName -TrustedRoot $RepoRoot
            if ($state.IsDeferred) {
                $failures.Add("deferred change is stored in completed archive: $($archived.Name)")
            }
        }
    }

    $hasBase = -not [string]::IsNullOrWhiteSpace($BaseRef)
    if ($hasBase) {
        git rev-parse --verify "$BaseRef^{commit}" *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "BaseRef is not available locally: $BaseRef"
        }

        $targetPaths = @(Get-DiffTargetPaths -Against $BaseRef)
        $newArchiveIds = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $newChangeIds = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

        foreach ($path in $targetPaths) {
            $normalized = $path.Replace('\', '/')
            if ($normalized -match '^openspec/changes/archive/([^/]+)/') {
                [void] $newArchiveIds.Add($Matches[1])
                continue
            }
            if ($normalized -match '^openspec/changes/([^/]+)/') {
                [void] $newChangeIds.Add($Matches[1])
            }
        }

        foreach ($archiveId in $newArchiveIds) {
            $directory = Join-Path $archiveRoot $archiveId
            if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
                $failures.Add("affected archive directory is missing after delete or rename: $archiveId")
                continue
            }
            $state = Get-OpenSpecProposalState -ChangeDirectory $directory -TrustedRoot $RepoRoot
            if (-not $state.Exists) {
                $failures.Add("affected archive is missing proposal.md: $archiveId")
            }
            if ($state.IsDeferred) {
                $failures.Add("new archive contains deferred marker: $archiveId")
            }
            $taskLedger = Get-OpenSpecTaskLedger -ChangeDirectory $directory -TrustedRoot $RepoRoot
            if (-not $taskLedger.Exists) {
                $failures.Add("affected archive is missing tasks.md: $archiveId")
            } elseif ($taskLedger.Unchecked -gt 0) {
                $failures.Add("new archive contains $($taskLedger.Unchecked) unchecked tasks: $archiveId")
            } elseif ($taskLedger.UnsupportedCheckboxes -gt 0) {
                $failures.Add("new archive contains $($taskLedger.UnsupportedCheckboxes) unsupported task checkboxes: $archiveId")
            }
        }

        # Historical corrections may add a change path while the repo is already over WIP.
        # Such additions are safe only when the restored/new change is explicitly deferred.
        if ($nonDeferredChanges.Count -gt $wipLimit) {
            foreach ($changeId in $newChangeIds) {
                if ($changeId -eq 'archive') { continue }
                $directory = Join-Path $changesRoot $changeId
                if (-not (Test-Path -LiteralPath $directory -PathType Container)) { continue }

                $baseProposal = @(git ls-tree -r --name-only $BaseRef -- "openspec/changes/$changeId/proposal.md")
                if ($LASTEXITCODE -ne 0) {
                    throw "Unable to inspect $changeId at base $BaseRef"
                }
                $existedAtBase = $baseProposal.Count -gt 0
                if ($existedAtBase) { continue }

                $state = Get-OpenSpecProposalState -ChangeDirectory $directory -TrustedRoot $RepoRoot
                if (-not $state.IsDeferred) {
                    $failures.Add("new non-deferred change increases an already-over-budget WIP set: $changeId")
                }
            }
        }
    } else {
        $warnings.Add('BaseRef not supplied; changed-only archive completion checks were skipped')
    }

    foreach ($warning in $warnings) { Write-Warning $warning }
    if ($failures.Count -gt 0) {
        $failures | ForEach-Object { Write-Error $_ -ErrorAction Continue }
        throw "OpenSpec lifecycle verification failed with $($failures.Count) finding(s)."
    }

    Write-Output ("openspec lifecycle OK: non_deferred={0}; deferred={1}; base_ref={2}" -f `
        $nonDeferredChanges.Count, $deferredChanges.Count, $(if ($hasBase) { $BaseRef } else { '<none>' }))
} finally {
    Pop-Location
}
