[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')
. (Join-Path $PSScriptRoot '..\lib\openspec-lifecycle.ps1')

$commandPath = Join-Path $PSScriptRoot 'reconcile-openspec-ledger.ps1'
$verifierPath = Join-Path $PSScriptRoot 'verify-openspec-lifecycle.ps1'
$ledgerSchemaPath = Join-Path $PSScriptRoot 'openspec-lifecycle-ledger.schema.json'
$reportSchemaPath = Join-Path $PSScriptRoot 'openspec-ledger-reconciliation-report.schema.json'
$pwshPath = (Get-Process -Id $PID).Path
$nodePath = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$nodeHash = (Get-FileHash -LiteralPath $nodePath -Algorithm SHA256).Hash
$nodeTrustedRoot = Split-Path -Parent $nodePath
$sourceRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$subjectCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

# --- PowerShell half of the two-implementation task-checkbox parity contract -------------------
# The JS half is scripts/tests/test-task-ledger-parser-parity.mjs, asserting the SAME corpus
# against taskLedgerFromText. Neither half alone proves parity; both must pass. Before
# 2026-07-30 nothing in the repo checked that the two parsers agreed, and four latent
# divergences existed — including one where the PowerShell pattern's trailing greedy \s+ ate the
# next line's indentation and dropped a nested unchecked task from Total, which could let an
# incomplete change slip through the new-archive gate in verify-openspec-lifecycle.ps1.
$parityCorpusPath = Join-Path $PSScriptRoot 'fixtures\task-ledger-parity.json'
Assert-True (Test-Path -LiteralPath $parityCorpusPath -PathType Leaf) 'task-ledger parity corpus exists'
$parityCorpus = Get-Content -LiteralPath $parityCorpusPath -Raw -Encoding utf8 | ConvertFrom-Json
Assert-Equal 'task-ledger-parity/v1' $parityCorpus.schema_version 'parity corpus schema version'
# Vacuity guard: a truncated corpus would make every assertion below pass without checking anything.
Assert-True (@($parityCorpus.cases).Count -ge 20) "parity corpus retains at least 20 cases (actual: $(@($parityCorpus.cases).Count))"
foreach ($parityRequiredId in @(
    'regression-nested-after-empty-checked',
    'regression-nested-after-trailing-space-open',
    'regression-no-space-after-bracket',
    'regression-multichar-mark',
    'tilde-stays-unsupported',
    'after-zero-width-and-invisible-is-unsupported',
    'after-nel-is-unsupported-not-whitespace',
    'after-paren-lookalikes-are-unsupported',
    'after-unicode-whitespace-still-counts',
    'mark-typo-is-unsupported'
)) {
    Assert-True (@($parityCorpus.cases | Where-Object { $_.id -eq $parityRequiredId }).Count -eq 1) "parity corpus keeps regression case '$parityRequiredId'"
}
foreach ($parityCase in $parityCorpus.cases) {
    $measured = Measure-OpenSpecTaskCheckboxes -Text $parityCase.text
    Assert-Equal ([int]$parityCase.expected.completed)   ([int]$measured.Completed)   "parity[$($parityCase.id)] completed"
    Assert-Equal ([int]$parityCase.expected.total)       ([int]$measured.Total)       "parity[$($parityCase.id)] total"
    Assert-Equal ([int]$parityCase.expected.unsupported) ([int]$measured.Unsupported) "parity[$($parityCase.id)] unsupported"
    Assert-True ($measured.Completed -le $measured.Total) "parity[$($parityCase.id)] completed does not exceed total"
}
# ----------------------------------------------------------------------------------------------

function Write-Utf8Text {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Value
    )

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Set-Content -LiteralPath $Path -Value $Value -Encoding utf8NoBOM -NoNewline
}

function Write-JsonDocument {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)] $Document
    )

    Write-Utf8Text -Path $Path -Value ($Document | ConvertTo-Json -Depth 20)
}

function New-MachineChange {
    param(
        [Parameter(Mandatory = $true)][string] $Id,
        [Parameter(Mandatory = $true)][string] $Status,
        [Parameter(Mandatory = $true)][int] $Completed,
        [Parameter(Mandatory = $true)][int] $Total
    )

    return [ordered]@{
        id             = $Id
        status         = $Status
        owner          = 'agent-governance'
        current_slice  = 'p0-1a'
        blocked_by     = @()
        last_verified  = '2026-07-28T00:00:00Z'
        task_ledger    = [ordered]@{
            completed = $Completed
            total     = $Total
        }
        evidence_refs  = @('local-fixture')
        subject_commit = $subjectCommit
        archive_debt    = $null
    }
}

function Write-OpenSpecFixture {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][object[]] $Changes
    )

    Write-JsonDocument -Path $Path -Document ([ordered]@{
        changes = $Changes
        root    = [ordered]@{
            path   = $Root
            source = 'nearest'
        }
    })
}

function Invoke-Reconciler {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [string] $Mode = 'Reconcile',
        [string] $Ledger = '',
        [string] $OpenSpecList = '',
        [string] $OpenSpecExecutable = '',
        [string] $OpenSpecExecutableSha256 = '',
        [string] $OpenSpecTrustedRoot = '',
        [string] $OpenSpecObservationOutput = '',
        [string] $NodeExecutable = $nodePath,
        [string] $NodeExecutableSha256 = $nodeHash,
        [string] $NodeTrustedRoot = $nodeTrustedRoot
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $pwshPath
    $startInfo.WorkingDirectory = $Root
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    foreach ($argument in @(
        '-NoProfile',
        '-NonInteractive',
        '-File',
        $commandPath,
        '-Mode',
        $Mode,
        '-RepoRoot',
        $Root
    )) {
        [void]$startInfo.ArgumentList.Add($argument)
    }
    if (-not [string]::IsNullOrWhiteSpace($Ledger)) {
        [void]$startInfo.ArgumentList.Add('-LedgerPath')
        [void]$startInfo.ArgumentList.Add($Ledger)
    }
    if (-not [string]::IsNullOrWhiteSpace($OpenSpecList)) {
        [void]$startInfo.ArgumentList.Add('-OpenSpecListJsonPath')
        [void]$startInfo.ArgumentList.Add($OpenSpecList)
    }
    if (-not [string]::IsNullOrWhiteSpace($OpenSpecExecutable)) {
        [void]$startInfo.ArgumentList.Add('-OpenSpecExecutablePath')
        [void]$startInfo.ArgumentList.Add($OpenSpecExecutable)
    }
    if (-not [string]::IsNullOrWhiteSpace($OpenSpecExecutableSha256)) {
        [void]$startInfo.ArgumentList.Add('-OpenSpecExecutableSha256')
        [void]$startInfo.ArgumentList.Add($OpenSpecExecutableSha256)
    }
    if (-not [string]::IsNullOrWhiteSpace($OpenSpecObservationOutput)) {
        [void]$startInfo.ArgumentList.Add('-OpenSpecObservationOutputPath')
        [void]$startInfo.ArgumentList.Add($OpenSpecObservationOutput)
    }
    if (-not [string]::IsNullOrWhiteSpace($OpenSpecExecutable)) {
        if ([string]::IsNullOrWhiteSpace($OpenSpecTrustedRoot)) {
            $OpenSpecTrustedRoot = Split-Path -Parent $OpenSpecExecutable
        }
        [void]$startInfo.ArgumentList.Add('-OpenSpecTrustedRoot')
        [void]$startInfo.ArgumentList.Add($OpenSpecTrustedRoot)
        [void]$startInfo.ArgumentList.Add('-NodeExecutablePath')
        [void]$startInfo.ArgumentList.Add($NodeExecutable)
        [void]$startInfo.ArgumentList.Add('-NodeExecutableSha256')
        [void]$startInfo.ArgumentList.Add($NodeExecutableSha256)
        [void]$startInfo.ArgumentList.Add('-NodeTrustedRoot')
        [void]$startInfo.ArgumentList.Add($NodeTrustedRoot)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        Assert-True ($process.Start()) 'reconciliation child process starts'
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(60000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
            throw 'ASSERT FAILED: reconciliation child process exceeded 60 seconds'
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
        $stderr = $stderrTask.GetAwaiter().GetResult().Trim()
        $document = $null
        try {
            $document = $stdout | ConvertFrom-Json -Depth 100 -ErrorAction Stop
        } catch {
            throw "ASSERT FAILED: child stdout is not one JSON document: $($_.Exception.Message)"
        }
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout   = $stdout
            Stderr   = $stderr
            Document = $document
        }
    } finally {
        $process.Dispose()
    }
}

function Invoke-LifecycleVerifier {
    param([Parameter(Mandatory = $true)][string] $Root)

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $pwshPath
    $startInfo.WorkingDirectory = $Root
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    foreach ($argument in @(
        '-NoProfile',
        '-NonInteractive',
        '-File',
        $verifierPath,
        '-RepoRoot',
        $Root
    )) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        Assert-True ($process.Start()) 'lifecycle verifier child process starts'
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
            throw 'ASSERT FAILED: lifecycle verifier child process exceeded 30 seconds'
        }
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout   = $stdoutTask.GetAwaiter().GetResult().Trim()
            Stderr   = $stderrTask.GetAwaiter().GetResult().Trim()
        }
    } finally {
        $process.Dispose()
    }
}

function Assert-ReportContract {
    param(
        [Parameter(Mandatory = $true)] $Result,
        [Parameter(Mandatory = $true)][string] $Message
    )

    Assert-True ([string]::IsNullOrEmpty($Result.Stderr)) "$Message emits no stderr"
    $schemaErrors = @()
    $schemaValid = Test-Json -Json $Result.Stdout -SchemaFile $reportSchemaPath `
        -ErrorAction SilentlyContinue -ErrorVariable schemaErrors
    Assert-True $schemaValid "$Message satisfies report schema"
}

function Get-FixtureSnapshot {
    param([Parameter(Mandatory = $true)][string] $Root)

    $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force | ForEach-Object {
        [ordered]@{
            path   = [System.IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\', '/')
            length = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    } | Sort-Object path)
    return ($files | ConvertTo-Json -Depth 5 -Compress)
}

Assert-True (Test-Path -LiteralPath $commandPath -PathType Leaf) 'reconciliation command exists'
Assert-True (Test-Path -LiteralPath $verifierPath -PathType Leaf) 'lifecycle verifier exists'
Assert-True ((Get-Content -LiteralPath $ledgerSchemaPath -Raw | Test-Json) -eq $true) 'machine ledger schema is valid JSON'
Assert-True ((Get-Content -LiteralPath $reportSchemaPath -Raw | Test-Json) -eq $true) 'report schema is valid JSON'

$sandbox = New-TestSandbox -Prefix 'openspec-ledger'
$trustedToolBin = ''
$outsideTrustedToolBin = ''
try {
    $repoRoot = Join-Path $sandbox 'repo [ledger]&safe'
    $changesRoot = Join-Path $repoRoot 'openspec\changes'
    $alphaRoot = Join-Path $changesRoot 'change-alpha'
    $zetaRoot = Join-Path $changesRoot 'change-zeta'
    New-Item -ItemType Directory -Path $alphaRoot, $zetaRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $repoRoot 'docs\plans') -Force | Out-Null

    $activeProposal = @'
# Change proposal

## Why

Fixture proposal.
'@
    Write-Utf8Text -Path (Join-Path $alphaRoot 'proposal.md') -Value $activeProposal
    Write-Utf8Text -Path (Join-Path $zetaRoot 'proposal.md') -Value $activeProposal
    Write-Utf8Text -Path (Join-Path $alphaRoot 'tasks.md') -Value "- [x] completed`n- [ ] pending`n"
    Write-Utf8Text -Path (Join-Path $zetaRoot 'tasks.md') -Value "- [ ] pending`n"
    Write-Utf8Text -Path (Join-Path $repoRoot 'docs\plans\NOW.md') -Value 'DECOY: this file must remain unread and unchanged.'

    $openSpecPath = Join-Path $repoRoot 'openspec-list.json'
    $ledgerPath = Join-Path $repoRoot 'ledger.json'
    $baseOpenSpecChanges = @(
        [ordered]@{
            name           = 'change-zeta'
            completedTasks = 0
            totalTasks     = 1
            lastModified   = '2099-01-01T00:00:00.000Z'
            status         = 'in-progress'
        },
        [ordered]@{
            name           = 'change-alpha'
            completedTasks = 1
            totalTasks     = 2
            lastModified   = '2000-01-01T00:00:00.000Z'
            status         = 'in-progress'
        }
    )
    $baseLedgerChanges = @(
        (New-MachineChange -Id 'change-zeta' -Status 'active' -Completed 0 -Total 1),
        (New-MachineChange -Id 'change-alpha' -Status 'active' -Completed 1 -Total 2)
    )
    Write-OpenSpecFixture -Path $openSpecPath -Root $repoRoot -Changes $baseOpenSpecChanges
    Write-JsonDocument -Path $ledgerPath -Document ([ordered]@{
        schema_version = 'openspec-lifecycle-ledger/v1'
        changes       = $baseLedgerChanges
    })

    # Matched fixture: all three sources agree and the report is schema-valid.
    $matched = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-ReportContract -Result $matched -Message 'matched reconcile'
    Assert-Equal 0 $matched.ExitCode 'matched reconcile exits zero'
    Assert-Equal 'consistent' $matched.Document.outcome 'matched reconcile reports consistent'
    Assert-Equal 0 $matched.Document.summary.mismatches 'matched reconcile has no mismatches'
    Assert-True ((@($matched.Document.inventory | ForEach-Object id) -join ',') -eq 'change-alpha,change-zeta') 'inventory is ordinally sorted'
    $machineView = $matched.Document.inventory[0].machine_state
    Assert-True ($null -eq $machineView.PSObject.Properties['owner']) 'report does not echo machine owner'
    Assert-True ($null -eq $machineView.PSObject.Properties['evidence_refs']) 'report does not echo evidence references'
    Assert-Equal 1 $machineView.evidence_ref_count 'report exposes only evidence reference count'

    # Archive history is deliberately outside the active-state reconciliation
    # contract: an archived machine row must not become a false active-directory
    # mismatch when the archive tree is not being reconciled.
    $archivedMachineLedgerPath = Join-Path $repoRoot 'archived-machine-ledger.json'
    Write-JsonDocument -Path $archivedMachineLedgerPath -Document ([ordered]@{
        schema_version = 'openspec-lifecycle-ledger/v1'
        changes       = @(
            $baseLedgerChanges + (New-MachineChange -Id 'change-archived' -Status 'archived' -Completed 0 -Total 0)
        )
    })
    $archivedMachineResult = Invoke-Reconciler -Root $repoRoot -Ledger $archivedMachineLedgerPath -OpenSpecList $openSpecPath
    Assert-ReportContract -Result $archivedMachineResult -Message 'archived machine row reconcile'
    Assert-Equal 0 $archivedMachineResult.ExitCode 'archived machine rows do not fail active-state reconciliation'
    Assert-Equal 'consistent' $archivedMachineResult.Document.outcome 'archived machine rows preserve a consistent active-state report'
    Assert-True (@($archivedMachineResult.Document.inventory | ForEach-Object id) -notcontains 'change-archived') 'archived machine rows are excluded from the active-state inventory'

    # Existing archive vocabulary stays compatible, while any deferred marker remains fail-closed.
    $archiveFixtureRoot = Join-Path $changesRoot 'archive\2026-07-28-adopted-fixture'
    New-Item -ItemType Directory -Path $archiveFixtureRoot -Force | Out-Null
    $adoptedArchiveProposal = @'
# Adopted archive fixture

> **Status: adopted 2026-07-28** — completed governance decision.

## Why

Archive compatibility fixture.
'@
    Write-Utf8Text -Path (Join-Path $archiveFixtureRoot 'proposal.md') -Value $adoptedArchiveProposal
    $adoptedArchiveResult = Invoke-LifecycleVerifier -Root $repoRoot
    Assert-Equal 0 $adoptedArchiveResult.ExitCode "adopted archive status remains compatible with lifecycle verification; stderr=$($adoptedArchiveResult.Stderr)"

    $deferredArchiveProposal = @'
> **Status: deferred 2026-07-28** — first marker.
> **Status: adopted 2026-07-28** — duplicate marker.

# Deferred archive fixture

## Why

Archive rejection fixture.
'@
    Write-Utf8Text -Path (Join-Path $archiveFixtureRoot 'proposal.md') -Value $deferredArchiveProposal
    $deferredArchiveResult = Invoke-LifecycleVerifier -Root $repoRoot
    Assert-Equal 1 $deferredArchiveResult.ExitCode 'archive containing any deferred marker fails closed'
    Write-Utf8Text -Path (Join-Path $archiveFixtureRoot 'proposal.md') -Value $adoptedArchiveProposal

    # The PowerShell parser mirrors the canonical JS lifecycle vocabulary: an adopted
    # proposal is completed while preserving the repository marker for diagnostics.
    Write-Utf8Text -Path (Join-Path $alphaRoot 'proposal.md') -Value $adoptedArchiveProposal
    try {
        $activeAdoptedState = Get-OpenSpecProposalState -ChangeDirectory $alphaRoot -TrustedRoot $repoRoot
        Assert-Equal 'adopted' $activeAdoptedState.RawStatus 'adopted marker preserves raw proposal status'
        Assert-Equal 'completed' $activeAdoptedState.LifecycleStatus 'adopted marker normalizes to completed'
        Assert-True (-not $activeAdoptedState.IsDeferred) 'adopted marker is not deferred'
    } finally {
        Write-Utf8Text -Path (Join-Path $alphaRoot 'proposal.md') -Value $activeProposal
    }

    $noLedgerInventory = Invoke-Reconciler -Root $repoRoot -Mode Inventory -OpenSpecList $openSpecPath
    $noLedgerReconcile = Invoke-Reconciler -Root $repoRoot -Mode Reconcile -OpenSpecList $openSpecPath
    Assert-Equal 0 $noLedgerInventory.ExitCode 'inventory without machine state remains report-only'
    Assert-Equal 2 $noLedgerReconcile.ExitCode 'reconcile without machine state fails closed'
    Assert-Equal 2 @($noLedgerReconcile.Document.mismatches | Where-Object reason -eq 'machine_state_missing').Count 'missing machine state is explicit per active change'
    Assert-Equal (($noLedgerInventory.Document.mismatches | ConvertTo-Json -Depth 10 -Compress)) `
        (($noLedgerReconcile.Document.mismatches | ConvertTo-Json -Depth 10 -Compress)) `
        'inventory and reconcile still share one no-ledger mismatch set'

    $invalidSemanticLedgerPath = Join-Path $repoRoot 'invalid-semantic-ledger.json'
    Write-JsonDocument -Path $invalidSemanticLedgerPath -Document ([ordered]@{
        schema_version = 'openspec-lifecycle-ledger/v1'
        changes       = @(
            (New-MachineChange -Id 'change-alpha' -Status 'active' -Completed 3 -Total 2),
            (New-MachineChange -Id 'change-zeta' -Status 'active' -Completed 0 -Total 1)
        )
    })
    $invalidSemanticLedger = Invoke-Reconciler -Root $repoRoot -Ledger $invalidSemanticLedgerPath -OpenSpecList $openSpecPath
    Assert-ReportContract -Result $invalidSemanticLedger -Message 'invalid ledger task semantics'
    Assert-Equal 3 $invalidSemanticLedger.ExitCode 'completed tasks above total tasks is an input error'
    Assert-Equal 'ledger_semantic_invalid' $invalidSemanticLedger.Document.errors[0].code 'invalid ledger task semantics is explicit'

    # CLI order and lastModified are non-authoritative and must not change output.
    $deterministicBaseline = $matched.Stdout
    $reorderedOpenSpec = @(
        [ordered]@{
            name           = 'change-alpha'
            completedTasks = 1
            totalTasks     = 2
            lastModified   = '2030-12-31T23:59:59.999Z'
            status         = 'in-progress'
        },
        [ordered]@{
            name           = 'change-zeta'
            completedTasks = 0
            totalTasks     = 1
            lastModified   = '1999-01-01T00:00:00.000Z'
            status         = 'in-progress'
        }
    )
    Write-OpenSpecFixture -Path $openSpecPath -Root $repoRoot -Changes $reorderedOpenSpec
    $deterministicRepeat = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal $deterministicBaseline $deterministicRepeat.Stdout 'entry order and lastModified do not affect report'

    # OpenSpec 1.6 represents a directory-backed deferred proposal as in-progress.
    # The explicit proposal prologue remains authoritative, so this is not a mismatch.
    $deferredProposal = @'
> **Status: deferred 2026-07-28** — thaw when fixture is ready.

# Change proposal

## Why

Fixture proposal.
'@
    Write-Utf8Text -Path (Join-Path $zetaRoot 'proposal.md') -Value $deferredProposal
    $deferredLedgerChanges = @(
        (New-MachineChange -Id 'change-alpha' -Status 'active' -Completed 1 -Total 2),
        (New-MachineChange -Id 'change-zeta' -Status 'deferred' -Completed 0 -Total 1)
    )
    Write-JsonDocument -Path $ledgerPath -Document ([ordered]@{
        schema_version = 'openspec-lifecycle-ledger/v1'
        changes       = $deferredLedgerChanges
    })
    $inventoryResult = Invoke-Reconciler -Root $repoRoot -Mode Inventory -Ledger $ledgerPath -OpenSpecList $openSpecPath
    $reconcileResult = Invoke-Reconciler -Root $repoRoot -Mode Reconcile -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-ReportContract -Result $inventoryResult -Message 'inventory deferred representation'
    Assert-ReportContract -Result $reconcileResult -Message 'reconcile deferred representation'
    Assert-Equal 0 $inventoryResult.ExitCode 'inventory accepts the deferred CLI representation'
    Assert-Equal 0 $reconcileResult.ExitCode 'reconcile accepts the deferred CLI representation'
    Assert-Equal 'inventoried' $inventoryResult.Document.outcome 'inventory outcome remains inventoried'
    Assert-Equal 'consistent' $reconcileResult.Document.outcome 'reconcile outcome accepts the deferred CLI representation'
    Assert-Equal 0 @($inventoryResult.Document.mismatches).Count 'inventory has no deferred lifecycle mismatch'
    Assert-Equal 0 @($reconcileResult.Document.mismatches).Count 'reconcile has no deferred lifecycle mismatch'
    $lifecycleMismatch = @($reconcileResult.Document.mismatches | Where-Object {
        $_.code -eq 'lifecycle' -and
        $_.reason -eq 'lifecycle_unrepresented' -and
        $_.change_id -eq 'change-zeta' -and
        $_.field -eq 'lifecycle.status'
    })
    Assert-Equal 0 $lifecycleMismatch.Count 'deferred proposal prologue accepts the OpenSpec in-progress representation'

    $deferredProposedProposal = @'
> **Status: deferred-proposed 2026-07-28** — thaw when fixture is ready.

# Change proposal

## Why

Fixture proposal.
'@
    Write-Utf8Text -Path (Join-Path $zetaRoot 'proposal.md') -Value $deferredProposedProposal
    $deferredProposedResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal 0 $deferredProposedResult.ExitCode 'deferred-proposed accepts the deferred CLI representation'
    $deferredProposedInventory = $deferredProposedResult.Document.inventory |
        Where-Object id -eq 'change-zeta' | Select-Object -First 1
    Assert-Equal 'deferred' $deferredProposedInventory.repository.proposal_status 'deferred-proposed normalizes to deferred'
    Assert-Equal 'deferred-proposed' $deferredProposedInventory.repository.proposal_raw_status 'raw deferred-proposed marker is preserved'

    $duplicateDeferredProposal = @'
> **Status: deferred 2026-07-28** — first marker.
> **Status: deferred-proposed 2026-07-28** — duplicate marker.

# Change proposal

## Why

Fixture proposal.
'@
    Write-Utf8Text -Path (Join-Path $zetaRoot 'proposal.md') -Value $duplicateDeferredProposal
    $duplicateProposalState = Get-OpenSpecProposalState -ChangeDirectory $zetaRoot -TrustedRoot $repoRoot
    Assert-Equal 'invalid' $duplicateProposalState.LifecycleStatus 'duplicate lifecycle markers are invalid'
    Assert-True $duplicateProposalState.IsDeferred 'duplicate deferred markers remain fail-closed for the archive gate'
    $duplicateMarkerResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal 2 $duplicateMarkerResult.ExitCode 'duplicate lifecycle markers exit two'
    Assert-Equal 1 @($duplicateMarkerResult.Document.mismatches | Where-Object reason -eq 'invalid_marker').Count 'duplicate marker emits invalid_marker mismatch'

    $longRawStatus = [string]::new('s', 129)
    Write-Utf8Text -Path (Join-Path $zetaRoot 'proposal.md') -Value "> **Status: $longRawStatus** — invalid boundary fixture.`n`n# Change proposal`n`n## Why`n`nFixture proposal.`n"
    $longRawStatusResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-ReportContract -Result $longRawStatusResult -Message 'long proposal status'
    Assert-Equal 2 $longRawStatusResult.ExitCode 'overlong proposal status is a lifecycle mismatch'
    $longRawStatusInventory = $longRawStatusResult.Document.inventory |
        Where-Object id -eq 'change-zeta' | Select-Object -First 1
    Assert-Equal 128 $longRawStatusInventory.repository.proposal_raw_status.Length 'raw proposal status is bounded to the report contract'

    # Status-looking prose after the first H2 is not a lifecycle marker.
    $bodyMarkerProposal = @'
# Change proposal

## Why

> **Status: deferred 2026-07-28** — historical prose only.
'@
    Write-Utf8Text -Path (Join-Path $zetaRoot 'proposal.md') -Value $bodyMarkerProposal
    Write-JsonDocument -Path $ledgerPath -Document ([ordered]@{
        schema_version = 'openspec-lifecycle-ledger/v1'
        changes       = $baseLedgerChanges
    })
    $bodyMarkerResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal 0 $bodyMarkerResult.ExitCode 'body-only marker is not treated as deferred'
    $zetaInventory = $bodyMarkerResult.Document.inventory | Where-Object id -eq 'change-zeta' | Select-Object -First 1
    Assert-Equal 'active' $zetaInventory.repository.proposal_status 'body-only marker leaves lifecycle active'

    Write-Utf8Text -Path (Join-Path $alphaRoot 'tasks.md') -Value "- [x]`n- [ ]`n"
    $bareTaskState = Get-OpenSpecTaskLedger -ChangeDirectory $alphaRoot -TrustedRoot $repoRoot
    Assert-Equal 2 $bareTaskState.Total 'bare task checkboxes are counted'
    Assert-Equal 1 $bareTaskState.Unchecked 'bare unchecked task remains visible to archive gate'
    $bareTaskResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal 0 $bareTaskResult.ExitCode 'bare task checkboxes reconcile by count'
    Write-Utf8Text -Path (Join-Path $alphaRoot 'tasks.md') -Value "- [x] completed`n- [ ] pending`n"

    # Task count differences use a closed taxonomy and exact field.
    $taskMismatchOpenSpec = @(
        [ordered]@{
            name = 'change-alpha'; completedTasks = 0; totalTasks = 2; status = 'in-progress'
        },
        [ordered]@{
            name = 'change-zeta'; completedTasks = 0; totalTasks = 1; status = 'in-progress'
        }
    )
    Write-OpenSpecFixture -Path $openSpecPath -Root $repoRoot -Changes $taskMismatchOpenSpec
    $taskMismatchResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal 2 $taskMismatchResult.ExitCode 'task count mismatch exits two'
    $taskMismatch = @($taskMismatchResult.Document.mismatches | Where-Object {
        $_.code -eq 'task_counts' -and
        $_.reason -eq 'completed_mismatch' -and
        $_.change_id -eq 'change-alpha' -and
        $_.field -eq 'task_ledger.completed'
    })
    Assert-Equal 1 $taskMismatch.Count 'task count mismatch identifies exact change and field'

    $totalMismatchOpenSpec = @(
        [ordered]@{
            name = 'change-alpha'; completedTasks = 1; totalTasks = 3; status = 'in-progress'
        },
        [ordered]@{
            name = 'change-zeta'; completedTasks = 0; totalTasks = 1; status = 'in-progress'
        }
    )
    Write-OpenSpecFixture -Path $openSpecPath -Root $repoRoot -Changes $totalMismatchOpenSpec
    $totalMismatchResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal 2 $totalMismatchResult.ExitCode 'total task mismatch exits two'
    $totalMismatch = @($totalMismatchResult.Document.mismatches | Where-Object {
        $_.code -eq 'task_counts' -and
        $_.reason -eq 'total_mismatch' -and
        $_.change_id -eq 'change-alpha' -and
        $_.field -eq 'task_ledger.total'
    })
    Assert-Equal 1 $totalMismatch.Count 'total task mismatch identifies exact change and field'

    Write-OpenSpecFixture -Path $openSpecPath -Root $repoRoot -Changes $reorderedOpenSpec
    Write-Utf8Text -Path (Join-Path $alphaRoot 'tasks.md') -Value "- [x] completed`n- [ ] pending`n- [~] unsupported`n"
    $unsupportedCheckboxResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal 2 $unsupportedCheckboxResult.ExitCode 'unsupported checkbox exits two'
    $unsupportedCheckbox = @($unsupportedCheckboxResult.Document.mismatches | Where-Object {
        $_.code -eq 'task_counts' -and
        $_.reason -eq 'unsupported_checkbox' -and
        $_.change_id -eq 'change-alpha'
    })
    Assert-Equal 1 $unsupportedCheckbox.Count 'unsupported checkbox uses task_counts taxonomy'
    Write-Utf8Text -Path (Join-Path $alphaRoot 'tasks.md') -Value "- [x] completed`n- [ ] pending`n"

    # Missing local artifacts, CLI entries, and supplied machine state stay in change_presence.
    Write-OpenSpecFixture -Path $openSpecPath -Root $repoRoot -Changes $reorderedOpenSpec
    $missingRoot = Join-Path $changesRoot 'change-missing'
    New-Item -ItemType Directory -Path $missingRoot -Force | Out-Null
    $presenceResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal 2 $presenceResult.ExitCode 'presence divergence exits two'
    $missingReasons = @($presenceResult.Document.mismatches | Where-Object change_id -eq 'change-missing' | ForEach-Object reason)
    foreach ($reason in @('proposal_missing', 'tasks_missing', 'openspec_entry_missing', 'machine_state_missing')) {
        Assert-True ($missingReasons -contains $reason) "presence report includes $reason"
    }
    Remove-Item -LiteralPath $missingRoot -Force

    $extraOpenSpec = @(
        $reorderedOpenSpec[0],
        $reorderedOpenSpec[1],
        [ordered]@{
            name = 'change-orphan'; completedTasks = 0; totalTasks = 0; status = 'no-tasks'
        }
    )
    Write-OpenSpecFixture -Path $openSpecPath -Root $repoRoot -Changes $extraOpenSpec
    $extraOpenSpecResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal 2 $extraOpenSpecResult.ExitCode 'extra OpenSpec entry exits two'
    $extraMismatch = @($extraOpenSpecResult.Document.mismatches | Where-Object {
        $_.code -eq 'change_presence' -and
        $_.reason -eq 'directory_missing' -and
        $_.change_id -eq 'change-orphan'
    })
    Assert-Equal 1 $extraMismatch.Count 'extra OpenSpec entry identifies the missing directory'
    Write-OpenSpecFixture -Path $openSpecPath -Root $repoRoot -Changes $reorderedOpenSpec

    # Invalid machine state and invalid OpenSpec output are input/tool errors (exit 3), not mismatches.
    $invalidLedgerPath = Join-Path $repoRoot 'invalid-ledger.json'
    $invalidChange = New-MachineChange -Id 'change-alpha' -Status 'active' -Completed 1 -Total 2
    [void]$invalidChange.Remove('owner')
    Write-JsonDocument -Path $invalidLedgerPath -Document ([ordered]@{
        schema_version = 'openspec-lifecycle-ledger/v1'
        changes       = @($invalidChange)
    })
    $invalidLedgerResult = Invoke-Reconciler -Root $repoRoot -Ledger $invalidLedgerPath -OpenSpecList $openSpecPath
    Assert-ReportContract -Result $invalidLedgerResult -Message 'invalid ledger'
    Assert-Equal 3 $invalidLedgerResult.ExitCode 'invalid ledger exits three'
    Assert-Equal 'ledger_schema_invalid' $invalidLedgerResult.Document.errors[0].code 'invalid ledger has closed error code'
    Assert-Equal 0 $invalidLedgerResult.Document.summary.mismatches 'input error is not a ledger mismatch'

    $unknownStatusPath = Join-Path $repoRoot 'unknown-status-ledger.json'
    $unknownStatusChanges = @(
        (New-MachineChange -Id 'change-alpha' -Status 'paused' -Completed 1 -Total 2),
        (New-MachineChange -Id 'change-zeta' -Status 'active' -Completed 0 -Total 1)
    )
    Write-JsonDocument -Path $unknownStatusPath -Document ([ordered]@{
        schema_version = 'openspec-lifecycle-ledger/v1'
        changes       = $unknownStatusChanges
    })
    $unknownStatusResult = Invoke-Reconciler -Root $repoRoot -Ledger $unknownStatusPath -OpenSpecList $openSpecPath
    Assert-Equal 3 $unknownStatusResult.ExitCode 'unknown machine status fails closed'
    Assert-Equal 'ledger_schema_invalid' $unknownStatusResult.Document.errors[0].code 'unknown machine status is a schema error'

    $duplicateLedgerPath = Join-Path $repoRoot 'duplicate-ledger.json'
    Write-JsonDocument -Path $duplicateLedgerPath -Document ([ordered]@{
        schema_version = 'openspec-lifecycle-ledger/v1'
        changes       = @(
            (New-MachineChange -Id 'change-alpha' -Status 'active' -Completed 1 -Total 2),
            (New-MachineChange -Id 'change-alpha' -Status 'active' -Completed 1 -Total 2)
        )
    })
    $duplicateLedgerResult = Invoke-Reconciler -Root $repoRoot -Ledger $duplicateLedgerPath -OpenSpecList $openSpecPath
    Assert-Equal 3 $duplicateLedgerResult.ExitCode 'duplicate machine ids fail closed'
    Assert-Equal 'ledger_duplicate_id' $duplicateLedgerResult.Document.errors[0].code 'duplicate machine ids are explicit'

    $wrongRootPath = Join-Path $repoRoot 'wrong-root.json'
    Write-OpenSpecFixture -Path $wrongRootPath -Root (Join-Path $sandbox 'different-root') -Changes $reorderedOpenSpec
    $wrongRootResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $wrongRootPath
    Assert-ReportContract -Result $wrongRootResult -Message 'wrong root'
    Assert-Equal 3 $wrongRootResult.ExitCode 'wrong OpenSpec root exits three'
    Assert-Equal 'tool_root_mismatch' $wrongRootResult.Document.errors[0].code 'wrong root is explicit'

    $duplicatePath = Join-Path $repoRoot 'duplicate-list.json'
    Write-OpenSpecFixture -Path $duplicatePath -Root $repoRoot -Changes @($reorderedOpenSpec[0], $reorderedOpenSpec[0])
    $duplicateResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $duplicatePath
    Assert-Equal 3 $duplicateResult.ExitCode 'duplicate OpenSpec ids exit three'
    Assert-Equal 'tool_output_invalid' $duplicateResult.Document.errors[0].code 'duplicate OpenSpec ids are invalid tool output'

    $oversizeTaskCountPath = Join-Path $repoRoot 'oversize-task-count-list.json'
    $oversizeTaskCountChanges = @(
        [ordered]@{
            name = 'change-alpha'; completedTasks = 1000001; totalTasks = 1000001; status = 'in-progress'
        },
        $reorderedOpenSpec[1]
    )
    Write-OpenSpecFixture -Path $oversizeTaskCountPath -Root $repoRoot -Changes $oversizeTaskCountChanges
    $oversizeTaskCountResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $oversizeTaskCountPath
    Assert-ReportContract -Result $oversizeTaskCountResult -Message 'oversize OpenSpec task count'
    Assert-Equal 3 $oversizeTaskCountResult.ExitCode 'OpenSpec task count above report maximum exits three'
    Assert-Equal 'tool_output_invalid' $oversizeTaskCountResult.Document.errors[0].code 'OpenSpec task count maximum is enforced'

    $invalidShapeDocuments = @(
        [ordered]@{
            changes = $reorderedOpenSpec[0]
            root    = [ordered]@{ path = $repoRoot; source = 'nearest' }
        },
        [ordered]@{
            changes = $null
            root    = [ordered]@{ path = $repoRoot; source = 'nearest' }
        },
        [ordered]@{
            changes = $reorderedOpenSpec
            root    = 'not-an-object'
        }
    )
    for ($shapeIndex = 0; $shapeIndex -lt $invalidShapeDocuments.Count; $shapeIndex++) {
        $invalidShapePath = Join-Path $repoRoot "invalid-shape-$shapeIndex.json"
        Write-JsonDocument -Path $invalidShapePath -Document $invalidShapeDocuments[$shapeIndex]
        $invalidShapeResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $invalidShapePath
        Assert-ReportContract -Result $invalidShapeResult -Message "invalid OpenSpec shape $shapeIndex"
        Assert-Equal 3 $invalidShapeResult.ExitCode "invalid OpenSpec shape $shapeIndex exits three"
        Assert-Equal 'tool_output_invalid' $invalidShapeResult.Document.errors[0].code "invalid OpenSpec shape $shapeIndex is a tool error"
    }

    $invalidModeResult = Invoke-Reconciler -Root $repoRoot -Mode 'Rewrite' -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-ReportContract -Result $invalidModeResult -Message 'invalid mode'
    Assert-Equal 3 $invalidModeResult.ExitCode 'invalid mode exits three'
    Assert-Equal 'invalid_argument' $invalidModeResult.Document.errors[0].code 'invalid mode is explicit'

    $outsideLedgerPath = Join-Path $sandbox 'outside-ledger.json'
    Write-JsonDocument -Path $outsideLedgerPath -Document ([ordered]@{
        schema_version = 'openspec-lifecycle-ledger/v1'
        changes       = $baseLedgerChanges
    })
    $outsideLedgerResult = Invoke-Reconciler -Root $repoRoot -Ledger $outsideLedgerPath -OpenSpecList $openSpecPath
    Assert-Equal 3 $outsideLedgerResult.ExitCode 'outside ledger path exits three'
    Assert-Equal 'artifact_outside_repo' $outsideLedgerResult.Document.errors[0].code 'outside ledger path is rejected'

    $oversizeLedgerPath = Join-Path $repoRoot 'oversize-ledger.json'
    Write-Utf8Text -Path $oversizeLedgerPath -Value ([string]::new('x', 2097153))
    $oversizeLedgerResult = Invoke-Reconciler -Root $repoRoot -Ledger $oversizeLedgerPath -OpenSpecList $openSpecPath
    Assert-ReportContract -Result $oversizeLedgerResult -Message 'oversize ledger'
    Assert-Equal 3 $oversizeLedgerResult.ExitCode 'oversize ledger exits three'
    Assert-Equal 'artifact_too_large' $oversizeLedgerResult.Document.errors[0].code 'oversize ledger is bounded'

    $outsideDirectory = Join-Path $sandbox 'outside junction target'
    New-Item -ItemType Directory -Path $outsideDirectory -Force | Out-Null
    $outsideChangeDirectory = Join-Path $outsideDirectory 'change-junction'
    New-Item -ItemType Directory -Path $outsideChangeDirectory -Force | Out-Null
    Write-Utf8Text -Path (Join-Path $outsideChangeDirectory 'proposal.md') -Value $activeProposal
    Write-Utf8Text -Path (Join-Path $outsideChangeDirectory 'tasks.md') -Value "- [ ] outside`n"
    $activeChangeJunction = Join-Path $changesRoot 'change-junction'
    try {
        New-Item -ItemType Junction -Path $activeChangeJunction -Target $outsideChangeDirectory -Force | Out-Null
        $activeJunctionResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath -OpenSpecList $openSpecPath
        Assert-ReportContract -Result $activeJunctionResult -Message 'active change junction'
        Assert-Equal 3 $activeJunctionResult.ExitCode 'active change junction exits three'
        Assert-Equal 'repository_reparse_point' $activeJunctionResult.Document.errors[0].code 'active change junction is rejected before artifact read'
        $verifierJunctionResult = Invoke-LifecycleVerifier -Root $repoRoot
        Assert-Equal 1 $verifierJunctionResult.ExitCode 'lifecycle verifier rejects an active change junction'
    } finally {
        if ([System.IO.Directory]::Exists($activeChangeJunction)) {
            [System.IO.Directory]::Delete($activeChangeJunction)
        }
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $outsideChangeDirectory 'proposal.md') -PathType Leaf) 'active junction rejection does not modify its target'

    $junctionLedgerPath = Join-Path $outsideDirectory 'ledger.json'
    Write-JsonDocument -Path $junctionLedgerPath -Document ([ordered]@{
        schema_version = 'openspec-lifecycle-ledger/v1'
        changes       = $baseLedgerChanges
    })
    $junctionPath = Join-Path $repoRoot 'linked inputs'
    try {
        New-Item -ItemType Junction -Path $junctionPath -Target $outsideDirectory -Force | Out-Null
        $junctionResult = Invoke-Reconciler -Root $repoRoot `
            -Ledger (Join-Path $junctionPath 'ledger.json') -OpenSpecList $openSpecPath
        Assert-ReportContract -Result $junctionResult -Message 'ancestor junction'
        Assert-Equal 3 $junctionResult.ExitCode 'ancestor junction exits three'
        Assert-Equal 'artifact_reparse_point' $junctionResult.Document.errors[0].code 'ancestor junction is rejected before read'
    } finally {
        if ([System.IO.Directory]::Exists($junctionPath)) {
            [System.IO.Directory]::Delete($junctionPath)
        }
    }
    Assert-True (Test-Path -LiteralPath $junctionLedgerPath -PathType Leaf) 'junction rejection does not modify its target'

    # Command mode requires an explicit, non-repository executable plus version/hash pin.
    # PATH poison and a fake gh would leave markers if discovered or called.
    $trustedToolBin = Join-Path (Split-Path -Parent $sourceRepoRoot) `
        "trusted-openspec-$([Guid]::NewGuid().ToString('N'))"
    $outsideTrustedToolBin = Join-Path (Split-Path -Parent $sourceRepoRoot) `
        "outside-openspec-$([Guid]::NewGuid().ToString('N'))"
    $pathPoisonBin = Join-Path $repoRoot 'fixture bin'
    New-Item -ItemType Directory -Path $trustedToolBin, $outsideTrustedToolBin, $pathPoisonBin -Force | Out-Null
    $fakeOpenSpecPath = Join-Path $trustedToolBin 'openspec.ps1'
    $ghMarker = Join-Path $repoRoot 'gh-was-called.txt'
    $pathOpenSpecMarker = Join-Path $repoRoot 'path-openspec-was-called.txt'
    $pathNodeMarker = Join-Path $repoRoot 'path-node-was-called.txt'
    $fakeOpenSpec = @'
if (-not [string]::IsNullOrWhiteSpace($env:OPEN_SPEC_SECRET_FIXTURE)) {
    exit 98
}
if (-not [string]::IsNullOrWhiteSpace($env:ComSpec)) {
    exit 97
}
if ($args.Count -eq 1 -and $args[0] -eq '--version') {
    Write-Output '1.6.0'
    exit 0
}
$runtimeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or $runtimeVersion -notmatch '^v\d+\.') {
    exit 96
}
[Console]::Error.WriteLine('benign fixture warning')
[ordered]@{
    changes = @(
        [ordered]@{ name = 'change-alpha'; completedTasks = 1; totalTasks = 2; status = 'in-progress' },
        [ordered]@{ name = 'change-zeta'; completedTasks = 0; totalTasks = 1; status = 'in-progress' }
    )
    root = [ordered]@{ path = (Get-Location).Path; source = 'nearest' }
} | ConvertTo-Json -Depth 8
exit 0
'@
    Write-Utf8Text -Path $fakeOpenSpecPath -Value $fakeOpenSpec
    $fakeGh = "Set-Content -LiteralPath '$($ghMarker.Replace("'", "''"))' -Value called`nexit 99`n"
    Write-Utf8Text -Path (Join-Path $pathPoisonBin 'gh.ps1') -Value $fakeGh
    $pathPoisonOpenSpec = "Set-Content -LiteralPath '$($pathOpenSpecMarker.Replace("'", "''"))' -Value called`nexit 99`n"
    $pathPoisonOpenSpecPath = Join-Path $pathPoisonBin 'openspec.ps1'
    Write-Utf8Text -Path $pathPoisonOpenSpecPath -Value $pathPoisonOpenSpec
    $pathPoisonNode = "@echo off`r`n> `"$pathNodeMarker`" echo called`r`nexit /b 99`r`n"
    Write-Utf8Text -Path (Join-Path $pathPoisonBin 'node.cmd') -Value $pathPoisonNode

    $originalPath = $env:PATH
    $originalSecretFixture = $env:OPEN_SPEC_SECRET_FIXTURE
    try {
        $env:PATH = $pathPoisonBin + [System.IO.Path]::PathSeparator + $originalPath
        $env:OPEN_SPEC_SECRET_FIXTURE = 'present'
        $fakeHash = (Get-FileHash -LiteralPath $fakeOpenSpecPath -Algorithm SHA256).Hash
        $warningResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $fakeOpenSpecPath -OpenSpecExecutableSha256 $fakeHash
        Assert-ReportContract -Result $warningResult -Message 'benign tool warning'
        Assert-Equal 0 $warningResult.ExitCode 'benign OpenSpec stderr does not fail reconciliation'
        Assert-True (-not (Test-Path -LiteralPath $ghMarker)) 'reconciliation never invokes GitHub tooling'
        Assert-True (-not (Test-Path -LiteralPath $pathOpenSpecMarker)) 'reconciliation never discovers OpenSpec through PATH'
        Assert-True (-not (Test-Path -LiteralPath $pathNodeMarker)) 'reconciliation never discovers Node through ambient PATH'

        $capturedObservation = Join-Path $repoRoot 'captured-openspec-list.json'
        $captureResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $fakeOpenSpecPath -OpenSpecExecutableSha256 $fakeHash `
            -OpenSpecObservationOutput $capturedObservation
        Assert-Equal 0 $captureResult.ExitCode 'actual pinned CLI observation can be captured after validation'
        $captured = Get-Content -Raw -LiteralPath $capturedObservation | ConvertFrom-Json -Depth 20
        Assert-Equal 2 @($captured.changes).Count 'captured observation preserves the validated CLI payload'

        $outsideToolPath = Join-Path $outsideTrustedToolBin 'openspec.ps1'
        Write-Utf8Text -Path $outsideToolPath -Value $fakeOpenSpec
        $outsideToolHash = (Get-FileHash -LiteralPath $outsideToolPath -Algorithm SHA256).Hash
        $outsideTrustedRootResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $outsideToolPath -OpenSpecExecutableSha256 $outsideToolHash `
            -OpenSpecTrustedRoot $trustedToolBin
        Assert-Equal 3 $outsideTrustedRootResult.ExitCode 'tool outside base-controlled trusted root exits three'
        Assert-Equal 'tool_path_untrusted' $outsideTrustedRootResult.Document.errors[0].code `
            'tool outside trusted root is rejected'

        $temporaryToolBin = Join-Path $sandbox 'temporary tool bin'
        $temporaryToolPath = Join-Path $temporaryToolBin 'openspec.ps1'
        Write-Utf8Text -Path $temporaryToolPath -Value $fakeOpenSpec
        $temporaryToolHash = (Get-FileHash -LiteralPath $temporaryToolPath -Algorithm SHA256).Hash
        $temporaryToolResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $temporaryToolPath -OpenSpecExecutableSha256 $temporaryToolHash
        Assert-Equal 3 $temporaryToolResult.ExitCode 'temporary trusted root exits three'
        Assert-Equal 'tool_path_untrusted' $temporaryToolResult.Document.errors[0].code `
            'temporary trusted root is rejected'

        $pathPoisonHash = (Get-FileHash -LiteralPath $pathPoisonOpenSpecPath -Algorithm SHA256).Hash
        $untrustedToolResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $pathPoisonOpenSpecPath -OpenSpecExecutableSha256 $pathPoisonHash
        Assert-Equal 3 $untrustedToolResult.ExitCode 'repo-contained executable exits three'
        Assert-Equal 'tool_path_untrusted' $untrustedToolResult.Document.errors[0].code 'repo-contained executable is rejected'

        $missingToolPinResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath
        Assert-Equal 3 $missingToolPinResult.ExitCode 'command mode without explicit tool pin exits three'
        Assert-Equal 'tool_path_required' $missingToolPinResult.Document.errors[0].code 'missing tool pin is explicit'

        Write-Utf8Text -Path $fakeOpenSpecPath -Value "if (`$args[0] -eq '--version') { Write-Output '1.6.0'; exit 0 }`n[Console]::Error.WriteLine('failure')`nexit 9`n"
        $fakeHash = (Get-FileHash -LiteralPath $fakeOpenSpecPath -Algorithm SHA256).Hash
        $nonzeroResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $fakeOpenSpecPath -OpenSpecExecutableSha256 $fakeHash
        Assert-ReportContract -Result $nonzeroResult -Message 'nonzero tool'
        Assert-Equal 3 $nonzeroResult.ExitCode 'nonzero OpenSpec exits three'
        Assert-Equal 'tool_exit_nonzero' $nonzeroResult.Document.errors[0].code 'nonzero OpenSpec is explicit'

        Write-Utf8Text -Path $fakeOpenSpecPath -Value "if (`$args[0] -eq '--version') { Write-Output '1.6.0'; exit 0 }`nWrite-Output 'not-json'`nexit 0`n"
        $fakeHash = (Get-FileHash -LiteralPath $fakeOpenSpecPath -Algorithm SHA256).Hash
        $invalidJsonResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $fakeOpenSpecPath -OpenSpecExecutableSha256 $fakeHash
        Assert-ReportContract -Result $invalidJsonResult -Message 'invalid tool JSON'
        Assert-Equal 3 $invalidJsonResult.ExitCode 'invalid OpenSpec JSON exits three'
        Assert-Equal 'tool_output_invalid' $invalidJsonResult.Document.errors[0].code 'invalid OpenSpec JSON is explicit'

        Write-Utf8Text -Path $fakeOpenSpecPath -Value "if (`$args[0] -eq '--version') { Write-Output '1.6.0'; exit 0 }`n[Console]::Out.Write([string]::new('x', 2098000))`nexit 0`n"
        $fakeHash = (Get-FileHash -LiteralPath $fakeOpenSpecPath -Algorithm SHA256).Hash
        $oversizeToolResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $fakeOpenSpecPath -OpenSpecExecutableSha256 $fakeHash
        Assert-ReportContract -Result $oversizeToolResult -Message 'oversize tool output'
        Assert-Equal 3 $oversizeToolResult.ExitCode 'oversize OpenSpec output exits three'
        Assert-Equal 'tool_output_too_large' $oversizeToolResult.Document.errors[0].code 'OpenSpec output limit is executable'

        Write-Utf8Text -Path $fakeOpenSpecPath -Value "if (`$args[0] -eq '--version') { Start-Sleep -Seconds 12; Write-Output '1.6.0'; exit 0 }`nexit 0`n"
        $fakeHash = (Get-FileHash -LiteralPath $fakeOpenSpecPath -Algorithm SHA256).Hash
        $timeoutToolResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $fakeOpenSpecPath -OpenSpecExecutableSha256 $fakeHash
        Assert-ReportContract -Result $timeoutToolResult -Message 'tool timeout'
        Assert-Equal 3 $timeoutToolResult.ExitCode 'timed-out OpenSpec exits three'
        Assert-Equal 'tool_timeout' $timeoutToolResult.Document.errors[0].code 'OpenSpec timeout is executable'

        Write-Utf8Text -Path $fakeOpenSpecPath -Value "if (`$args[0] -eq '--version') { Write-Output '9.9.9'; exit 0 }`nexit 0`n"
        $fakeHash = (Get-FileHash -LiteralPath $fakeOpenSpecPath -Algorithm SHA256).Hash
        $wrongVersionResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $fakeOpenSpecPath -OpenSpecExecutableSha256 $fakeHash
        Assert-Equal 3 $wrongVersionResult.ExitCode 'wrong OpenSpec version exits three'
        Assert-Equal 'tool_version_mismatch' $wrongVersionResult.Document.errors[0].code 'wrong OpenSpec version is explicit'

        $wrongHashResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $fakeOpenSpecPath `
            -OpenSpecExecutableSha256 '0000000000000000000000000000000000000000000000000000000000000000'
        Assert-Equal 3 $wrongHashResult.ExitCode 'wrong OpenSpec hash exits three'
        Assert-Equal 'tool_hash_mismatch' $wrongHashResult.Document.errors[0].code 'wrong OpenSpec hash is explicit'

        $wrongNodeHashResult = Invoke-Reconciler -Root $repoRoot -Ledger $ledgerPath `
            -OpenSpecExecutable $fakeOpenSpecPath -OpenSpecExecutableSha256 $fakeHash `
            -NodeExecutableSha256 '0000000000000000000000000000000000000000000000000000000000000000'
        Assert-Equal 3 $wrongNodeHashResult.ExitCode 'wrong Node hash exits three'
        Assert-Equal 'tool_hash_mismatch' $wrongNodeHashResult.Document.errors[0].code 'wrong Node hash is explicit'
    } finally {
        $env:PATH = $originalPath
        $env:OPEN_SPEC_SECRET_FIXTURE = $originalSecretFixture
    }

    # The diagnostic is read-only: no fixture file, NOW decoy, or git-shaped state changes.
    Write-OpenSpecFixture -Path $openSpecPath -Root $repoRoot -Changes $reorderedOpenSpec
    $snapshotBefore = Get-FixtureSnapshot -Root $repoRoot
    $readOnlyResult = Invoke-Reconciler -Root $repoRoot -Mode Inventory -Ledger $ledgerPath -OpenSpecList $openSpecPath
    Assert-Equal 0 $readOnlyResult.ExitCode 'read-only inventory exits zero'
    $snapshotAfter = Get-FixtureSnapshot -Root $repoRoot
    Assert-Equal $snapshotBefore $snapshotAfter 'inventory leaves the complete fixture tree unchanged'
} finally {
    Remove-TestSandbox -Path $sandbox
    foreach ($toolDirectory in @($trustedToolBin, $outsideTrustedToolBin)) {
        if (-not [string]::IsNullOrWhiteSpace($toolDirectory) -and (Test-Path -LiteralPath $toolDirectory)) {
            Remove-Item -LiteralPath $toolDirectory -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# introduction-resolved-subject-binding tasks 4.9: a sentinel row passes the
# strict ledger JSON schema; any other subject_binding value is refused; the
# reconciler's evaluation logic keeps subject_commit (and the sentinel) out of
# its evaluated surface by construction.
$sentinelRow = New-MachineChange -Id 'sentinel-row' -Status 'active' -Completed 1 -Total 2
$sentinelRow['subject_binding'] = 'introduction'
$sentinelLedger = [ordered]@{
    schema_version = 'openspec-lifecycle-ledger/v1'
    changes        = @($sentinelRow)
} | ConvertTo-Json -Depth 8
$sentinelErrors = @()
$sentinelValid = Test-Json -Json $sentinelLedger -SchemaFile $ledgerSchemaPath `
    -ErrorAction SilentlyContinue -ErrorVariable sentinelErrors
Assert-True $sentinelValid 'ledger schema accepts a subject_binding sentinel row'
$badRow = New-MachineChange -Id 'sentinel-bad' -Status 'active' -Completed 1 -Total 2
$badRow['subject_binding'] = 'commit'
$badLedger = [ordered]@{
    schema_version = 'openspec-lifecycle-ledger/v1'
    changes        = @($badRow)
} | ConvertTo-Json -Depth 8
$badValid = Test-Json -Json $badLedger -SchemaFile $ledgerSchemaPath -ErrorAction SilentlyContinue
Assert-True (-not $badValid) 'ledger schema refuses a non-introduction subject_binding value'

Write-Host '[test-openspec-ledger-reconciliation] all assertions passed'
