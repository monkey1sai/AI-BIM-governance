[CmdletBinding()]
param(
    [string] $RepoRoot = '',
    [string] $BaseRef = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ProposalState {
    param([Parameter(Mandatory = $true)][string] $ChangeDirectory)

    $proposalPath = Join-Path $ChangeDirectory 'proposal.md'
    if (-not (Test-Path -LiteralPath $proposalPath -PathType Leaf)) {
        return [pscustomobject]@{
            Exists       = $false
            IsDeferred   = $false
            HasCondition = $false
            Content      = ''
        }
    }

    $content = Get-Content -LiteralPath $proposalPath -Raw
    return [pscustomobject]@{
        Exists       = $true
        IsDeferred   = $content -match '(?m)^>\s*\*\*Status:\s*deferred\b'
        HasCondition = $content -match '(重啟|解凍|thaw|closeout)'
        Content      = $content
    }
}

function Get-DiffTargetPaths {
    param([Parameter(Mandatory = $true)][string] $Against)

    # Compare the base commit directly with the current tree. This works both in
    # CI (where the PR diff is committed) and during a local pre-commit check.
    $lines = @(git diff --name-status -M $Against --)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to diff lifecycle state against $Against"
    }

    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $parts = @($line -split "`t")
        if ($parts[0] -match '^R\d+$') {
            if ($parts.Count -ge 3) { $parts[2] }
            continue
        }
        if ($parts.Count -ge 2 -and $parts[0] -ne 'D') { $parts[1] }
    }
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
} else {
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}

$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

Push-Location $RepoRoot
try {
    $changesRoot = Join-Path $RepoRoot 'openspec\changes'
    $archiveRoot = Join-Path $changesRoot 'archive'
    if (-not (Test-Path -LiteralPath $changesRoot -PathType Container)) {
        throw "OpenSpec changes root not found: $changesRoot"
    }

    $activeChanges = @(Get-ChildItem -LiteralPath $changesRoot -Directory | Where-Object Name -ne 'archive')
    $deferredChanges = [System.Collections.Generic.List[string]]::new()
    $nonDeferredChanges = [System.Collections.Generic.List[string]]::new()
    $capabilityOwners = @{}

    foreach ($change in $activeChanges) {
        $state = Get-ProposalState -ChangeDirectory $change.FullName
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

    if ($nonDeferredChanges.Count -gt 2) {
        $warnings.Add("existing non-deferred WIP is $($nonDeferredChanges.Count) > 2: $($nonDeferredChanges -join ', ')")
    }

    # A deferred marker is never valid in completed archive, including legacy entries.
    if (Test-Path -LiteralPath $archiveRoot -PathType Container) {
        foreach ($archived in Get-ChildItem -LiteralPath $archiveRoot -Directory) {
            $state = Get-ProposalState -ChangeDirectory $archived.FullName
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
            if (-not (Test-Path -LiteralPath $directory -PathType Container)) { continue }
            $state = Get-ProposalState -ChangeDirectory $directory
            if ($state.IsDeferred) {
                $failures.Add("new archive contains deferred marker: $archiveId")
            }
            $tasksPath = Join-Path $directory 'tasks.md'
            if (Test-Path -LiteralPath $tasksPath -PathType Leaf) {
                $unchecked = @(Select-String -LiteralPath $tasksPath -Pattern '^\s*- \[ \]' -CaseSensitive).Count
                if ($unchecked -gt 0) {
                    $failures.Add("new archive contains $unchecked unchecked tasks: $archiveId")
                }
            }
        }

        # Historical corrections may add a change path while the repo is already over WIP.
        # Such additions are safe only when the restored/new change is explicitly deferred.
        if ($nonDeferredChanges.Count -gt 2) {
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

                $state = Get-ProposalState -ChangeDirectory $directory
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
