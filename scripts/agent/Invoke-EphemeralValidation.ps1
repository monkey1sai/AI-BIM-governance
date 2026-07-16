[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $ControllerRepo,
    [Parameter(Mandatory = $true)][string] $GitRepo,
    [Parameter(Mandatory = $true)][string] $BaseSha,
    [Parameter(Mandatory = $true)][string] $CommitSha,
    [Parameter(Mandatory = $true)][int] $PullRequestNumber,
    [Parameter(Mandatory = $true)][string] $RunId,
    [Parameter(Mandatory = $true)][int] $Attempt,
    [Parameter(Mandatory = $true)][string] $InvocationId,
    [Parameter(Mandatory = $true)][string] $WorkspaceRoot,
    [Parameter(Mandatory = $true)][string] $EvidenceRoot,
    [string] $TaskContractPath = '',
    [string] $Profile = '',
    [string] $FetchRef = '',
    [string] $StorageRoot = '',
    [string] $RuntimeHarness = '',
    [string] $ProfilesPath = '',
    [switch] $TestMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$controller = (Resolve-Path -LiteralPath $ControllerRepo).Path
$candidateRepo = (Resolve-Path -LiteralPath $GitRepo).Path

function Test-PathWithin {
    param([Parameter(Mandatory = $true)][string] $Candidate, [Parameter(Mandatory = $true)][string] $Parent)

    $candidateFull = [IO.Path]::GetFullPath($Candidate).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    if ($candidateFull.Equals($parentFull, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    $prefix = $parentFull + [IO.Path]::DirectorySeparatorChar
    return $candidateFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

if (-not $TestMode -and ((Test-PathWithin -Candidate $candidateRepo -Parent $controller) -or
        (Test-PathWithin -Candidate $controller -Parent $candidateRepo))) {
    throw 'Candidate Git metadata and trusted controller must not contain one another.'
}

$modulePath = Join-Path $controller 'scripts\lib\StructLog.psm1'
Import-Module -Force $modulePath
$logger = New-StructLogger -Service 'scripts' -Component 'ephemeral-validation' -SkipEnvSnapshot

if ([string]::IsNullOrWhiteSpace($ProfilesPath)) {
    $ProfilesPath = Join-Path $controller 'scripts\agent\validation-profiles.json'
}
elseif (-not $TestMode) {
    throw '-ProfilesPath override is allowed only with -TestMode.'
}

$pythonCandidates = @(
    (Join-Path $controller '.venv\Scripts\python.exe'),
    (Join-Path $controller '.venv\bin\python')
)
$python = $pythonCandidates |
    Where-Object { [IO.Path]::IsPathFullyQualified($_) -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    ForEach-Object { (Resolve-Path -LiteralPath $_).Path } |
    Select-Object -First 1
if (-not $python) {
    $hostPythonNames = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        @('python.exe', 'python3.exe')
    } else {
        @('python3', 'python')
    }
    foreach ($pathEntry in ($env:PATH -split [IO.Path]::PathSeparator)) {
        if ([string]::IsNullOrWhiteSpace($pathEntry) -or -not [IO.Path]::IsPathFullyQualified($pathEntry)) {
            continue
        }
        foreach ($name in $hostPythonNames) {
            $candidate = Join-Path ([IO.Path]::GetFullPath($pathEntry)) $name
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                $python = (Resolve-Path -LiteralPath $candidate).Path
                break
            }
        }
        if ($python) { break }
    }
}
if (-not $python -or -not [IO.Path]::IsPathFullyQualified($python)) {
    throw 'A trusted absolute host Python executable could not be resolved.'
}

$arguments = @(
    (Join-Path $controller 'scripts\agent\ephemeral_validation.py'),
    '--controller-repo', $controller,
    '--git-repo', $candidateRepo,
    '--base-sha', $BaseSha,
    '--candidate-sha', $CommitSha,
    '--pr-number', [string]$PullRequestNumber,
    '--run-id', $RunId,
    '--attempt', [string]$Attempt,
    '--invocation-id', $InvocationId,
    '--workspace-root', $WorkspaceRoot,
    '--evidence-root', $EvidenceRoot,
    '--profiles-path', $ProfilesPath
)
if (-not [string]::IsNullOrWhiteSpace($TaskContractPath)) { $arguments += @('--task-contract', $TaskContractPath) }
if (-not [string]::IsNullOrWhiteSpace($Profile)) { $arguments += @('--profile', $Profile) }
if (-not [string]::IsNullOrWhiteSpace($FetchRef)) { $arguments += @('--fetch-ref', $FetchRef) }
if (-not [string]::IsNullOrWhiteSpace($StorageRoot)) { $arguments += @('--storage-root', $StorageRoot) }
if (-not [string]::IsNullOrWhiteSpace($RuntimeHarness)) { $arguments += @('--runtime-harness', $RuntimeHarness) }
if ($TestMode) { $arguments += '--test-mode' }

$logger | Write-StructLifecycle -Msg 'ephemeral validation started' -Data @{
    phase = 'start'
    pr_number = $PullRequestNumber
    run_id = $RunId
    attempt = $Attempt
    profile = if ($Profile) { $Profile } else { 'from-task-contract' }
    candidate_sha = $CommitSha
}

& $python @arguments
$exitCode = $LASTEXITCODE

$logger | Write-StructLifecycle -Msg 'ephemeral validation finished' -Data @{
    phase = 'finish'
    pr_number = $PullRequestNumber
    run_id = $RunId
    attempt = $Attempt
    exit_code = $exitCode
}
exit $exitCode
