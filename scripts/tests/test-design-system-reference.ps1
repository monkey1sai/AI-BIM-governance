Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$validator = Join-Path $PSScriptRoot 'verify-design-system-reference.ps1'
$manifestPath = Join-Path $repoRoot 'docs\plans\design-system-reference.manifest.json'
$captureScript = Join-Path $repoRoot 'web-viewer-sample\scripts\capture-design-system-reference.mjs'

function Invoke-Validator {
    param([Parameter(Mandatory = $true)][string] $CandidateManifest)
    & $validator -RepoRoot $repoRoot -ManifestPath $CandidateManifest
}

function Assert-Rejected {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Mutation,
        [Parameter(Mandatory = $true)][string] $ExpectedPattern
    )

    $candidate = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    & $Mutation $candidate
    $path = Join-Path $script:tempRoot "candidate-$([guid]::NewGuid().ToString('N')).json"
    $candidate | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $path -Encoding utf8
    $caught = $null
    try {
        Invoke-Validator -CandidateManifest $path
    } catch {
        $caught = $_.Exception.Message
    }
    if ($null -eq $caught -or $caught -notmatch $ExpectedPattern) {
        throw "Expected design reference rejection matching '$ExpectedPattern'; actual='$caught'."
    }
}

$script:tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "design-reference-test-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $script:tempRoot | Out-Null
try {
    Invoke-Validator -CandidateManifest $manifestPath

    Assert-Rejected -ExpectedPattern 'max_diff_pixel_ratio' -Mutation {
        param($candidate)
        $candidate.fidelity_contract.max_diff_pixel_ratio = 0.02
    }
    Assert-Rejected -ExpectedPattern 'platform must be windows' -Mutation {
        param($candidate)
        $candidate.fidelity_contract.platform = 'linux'
    }
    Assert-Rejected -ExpectedPattern 'baseline hash mismatch' -Mutation {
        param($candidate)
        $candidate.screens[0].baselines.'1440x900'.sha256 = ('0' * 64)
        $descriptors = @()
        foreach ($screen in $candidate.screens) {
            foreach ($viewport in $candidate.fidelity_contract.viewports) {
                $baseline = $screen.baselines.PSObject.Properties[[string]$viewport.id].Value
                $absolute = Join-Path $repoRoot ([string]$baseline.path).Replace('/', '\')
                $descriptors += [pscustomobject]@{ path = $baseline.path; bytes = (Get-Item $absolute).Length; sha256 = $baseline.sha256 }
            }
        }
        # The validator must reject the file hash before the aggregate digest matters.
        $candidate.baseline_snapshot_sha256 = ('1' * 64)
    }
    Assert-Rejected -ExpectedPattern 'both mapped and reference_missing' -Mutation {
        param($candidate)
        $candidate.routes_without_approved_pixel_reference += '#home'
    }
    Assert-Rejected -ExpectedPattern 'non-rendering repository/cache state' -Mutation {
        param($candidate)
        $candidate.source.files[0].path = '.git/config'
    }
    Assert-Rejected -ExpectedPattern 'design-doc.html must be pinned' -Mutation {
        param($candidate)
        $candidate.source.files = @($candidate.source.files | Where-Object path -ne 'design-doc.html')
    }
    Assert-Rejected -ExpectedPattern 'baseline escaped' -Mutation {
        param($candidate)
        $candidate.screens[0].baselines.'1440x900'.path = 'docs/plans/design-system-baseline/../../TARGET-contracts.md'
    }
    Assert-Rejected -ExpectedPattern 'reused by more than one screen' -Mutation {
        param($candidate)
        $candidate.screens[1].baselines.'1440x900' = $candidate.screens[0].baselines.'1440x900'
    }
    Assert-Rejected -ExpectedPattern 'route_inventory' -Mutation {
        param($candidate)
        $candidate.route_inventory = @($candidate.route_inventory | Where-Object route -ne '#viewer')
    }
    Assert-Rejected -ExpectedPattern 'external semantic-result input' -Mutation {
        param($candidate)
        $candidate.semantic_contract.external_result_input_allowed = $true
    }
    Assert-Rejected -ExpectedPattern 'external functional/runtime result input' -Mutation {
        param($candidate)
        $candidate.functional_runtime_contract.external_result_input_allowed = $true
    }
    Assert-Rejected -ExpectedPattern 'dependency lock SHA-256' -Mutation {
        param($candidate)
        $property = $candidate.fidelity_contract.PSObject.Properties['dependency_lock_sha256']
        if ($null -eq $property) {
            $candidate.fidelity_contract | Add-Member -NotePropertyName dependency_lock_sha256 -NotePropertyValue ('0' * 64)
        } else {
            $candidate.fidelity_contract.dependency_lock_sha256 = ('0' * 64)
        }
    }
    Assert-Rejected -ExpectedPattern 'resolved visual dependency versions' -Mutation {
        param($candidate)
        $candidate.fidelity_contract.dependency_tree_status = 'locked_npm_ci'
    }

    $symlinkSource = Join-Path $script:tempRoot 'symlink-source'
    $outsideSource = Join-Path $script:tempRoot 'outside-source'
    New-Item -ItemType Directory -Force -Path $symlinkSource, $outsideSource | Out-Null
    Set-Content -LiteralPath (Join-Path $symlinkSource 'design-doc.html') -Value '<!doctype html><title>fixture</title>' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $outsideSource 'outside.html') -Value '<!doctype html><title>outside</title>' -Encoding utf8
    $linkPath = Join-Path $symlinkSource 'linked-outside'
    if ($IsWindows) {
        New-Item -ItemType Junction -Path $linkPath -Target $outsideSource | Out-Null
    } else {
        New-Item -ItemType SymbolicLink -Path $linkPath -Target $outsideSource | Out-Null
    }

    $nodeExe = (Get-Command node -ErrorAction Stop).Source
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $nodeExe
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    [void]$startInfo.ArgumentList.Add($captureScript)
    $startInfo.Environment['DESIGN_SYSTEM_REFERENCE_ROOT'] = $symlinkSource
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $combinedOutput = "$stdout`n$stderr"
    if ($process.ExitCode -eq 0 -or $combinedOutput -notmatch 'Symbolic links are not allowed') {
        throw "Expected design source symlink rejection; exit=$($process.ExitCode); output=$combinedOutput"
    }
} finally {
    Remove-Item -LiteralPath $script:tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host '[test-design-system-reference] passed — positive manifest plus threshold/hash/route/cache negative cases'
