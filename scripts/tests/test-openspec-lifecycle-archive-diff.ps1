[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$verifierPath = Join-Path $PSScriptRoot 'verify-openspec-lifecycle.ps1'
$pwshPath = (Get-Process -Id $PID).Path

function Write-FixtureFile {
    param([Parameter(Mandatory = $true)][string] $Path, [Parameter(Mandatory = $true)][string] $Value)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Set-Content -LiteralPath $Path -Value $Value -Encoding utf8NoBOM -NoNewline
}

function New-ArchiveRepository {
    $root = New-TestSandbox -Prefix 'openspec-archive-diff'
    $archive = Join-Path $root 'openspec\changes\archive\2026-07-28-alpha'
    Write-FixtureFile -Path (Join-Path $archive 'proposal.md') `
        -Value "> **Status: adopted 2026-07-28** — completed fixture.`n"
    Write-FixtureFile -Path (Join-Path $archive 'tasks.md') -Value "- [x] completed`n"

    git -C $root init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'fixture git init failed' }
    git -C $root config user.email 'fixture@example.invalid'
    git -C $root config user.name 'Archive Fixture'
    git -C $root config core.autocrlf false
    git -C $root add --all
    git -C $root commit --quiet -m 'fixture baseline'
    if ($LASTEXITCODE -ne 0) { throw 'fixture baseline commit failed' }
    return $root
}

function Invoke-ArchiveVerifier {
    param([Parameter(Mandatory = $true)][string] $Root)
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $pwshPath
    $startInfo.WorkingDirectory = $Root
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    foreach ($argument in @(
        '-NoProfile', '-NonInteractive', '-File', $verifierPath,
        '-RepoRoot', $Root, '-BaseRef', 'HEAD'
    )) {
        [void]$startInfo.ArgumentList.Add($argument)
    }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        Assert-True ($process.Start()) 'archive verifier starts'
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
            throw 'archive verifier timed out'
        }
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout   = $stdoutTask.GetAwaiter().GetResult()
            Stderr   = $stderrTask.GetAwaiter().GetResult()
        }
    } finally {
        $process.Dispose()
    }
}

$sandboxes = [System.Collections.Generic.List[string]]::new()
try {
    $deleteRoot = New-ArchiveRepository
    $sandboxes.Add($deleteRoot)
    $baseline = Invoke-ArchiveVerifier -Root $deleteRoot
    Assert-Equal 0 $baseline.ExitCode "complete archive baseline passes; stderr=$($baseline.Stderr)"
    Remove-Item -LiteralPath (Join-Path $deleteRoot 'openspec\changes\archive\2026-07-28-alpha\tasks.md') -Force
    $deleted = Invoke-ArchiveVerifier -Root $deleteRoot
    Assert-True ($deleted.ExitCode -ne 0) 'deleting archived tasks fails closed'
    Assert-True ($deleted.Stderr -match 'affected archive is missing tasks\.md: 2026-07-28-alpha') `
        'deletion identifies the exact affected archive'

    $renameRoot = New-ArchiveRepository
    $sandboxes.Add($renameRoot)
    Move-Item -LiteralPath (Join-Path $renameRoot 'openspec\changes\archive\2026-07-28-alpha') `
        -Destination (Join-Path $renameRoot 'openspec\changes\archive\2026-07-28-renamed-alpha')
    $renamed = Invoke-ArchiveVerifier -Root $renameRoot
    Assert-True ($renamed.ExitCode -ne 0) 'renaming an archive cannot hide the deleted source path'
    Assert-True ($renamed.Stderr -match 'affected archive directory is missing after delete or rename: 2026-07-28-alpha') `
        'rename evaluates the old archive path'

    $unsupportedRoot = New-ArchiveRepository
    $sandboxes.Add($unsupportedRoot)
    Write-FixtureFile -Path (Join-Path $unsupportedRoot 'openspec\changes\archive\2026-07-28-alpha\tasks.md') `
        -Value "- [-] unsupported marker`n"
    $unsupported = Invoke-ArchiveVerifier -Root $unsupportedRoot
    Assert-True ($unsupported.ExitCode -ne 0) 'unsupported task checkboxes fail closed for an affected archive'
    Assert-True ($unsupported.Stderr -match 'new archive contains 1 unsupported task checkboxes: 2026-07-28-alpha') `
        'unsupported checkbox failure identifies the exact archive'

    Write-TestPass 'OpenSpec archive deletion, rename, and checkbox diff gate'
} catch {
    Write-TestFail 'OpenSpec archive deletion, rename, and checkbox diff gate' $_.Exception.Message
    exit 1
} finally {
    foreach ($sandbox in $sandboxes) { Remove-TestSandbox -Path $sandbox }
}
