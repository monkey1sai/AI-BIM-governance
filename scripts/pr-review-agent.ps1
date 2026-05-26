[CmdletBinding()]
param(
    [string[]] $ChangedPath,
    [string] $BaseRef = $env:GITHUB_BASE_REF,
    [string] $HeadRef = $env:GITHUB_HEAD_REF,
    [string] $BaseSha = '',
    [string] $HeadSha = '',
    [string] $PrNumber = $env:PR_NUMBER,
    [string] $RunId = $env:GITHUB_RUN_ID,
    [string] $OutputDir,
    [switch] $ReportOnly,
    [switch] $SkipCommandExecution,
    [switch] $SkipGitNexus,
    [switch] $AllowGitNexusUnavailable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot 'artifacts\pr-review-agent'
}

. (Join-Path $PSScriptRoot 'lib\pr-review-agent.ps1')

try {
    $result = Invoke-PrReviewAgent `
        -RepoRoot $RepoRoot `
        -ChangedPaths $ChangedPath `
        -BaseRef $BaseRef `
        -HeadRef $HeadRef `
        -BaseSha $BaseSha `
        -HeadSha $HeadSha `
        -PrNumber $PrNumber `
        -RunId $RunId `
        -OutputDir $OutputDir `
        -ReportOnly:$ReportOnly `
        -SkipCommandExecution:$SkipCommandExecution `
        -SkipGitNexus:$SkipGitNexus `
        -AllowGitNexusUnavailable:$AllowGitNexusUnavailable
} catch {
    if (-not (Test-Path -LiteralPath $OutputDir)) {
        New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    }
    $report = [ordered]@{
        schema_version = 'pr-review-agent/v1'
        status         = 'failed'
        risk_level     = 'high'
        generated_at   = (Get-Date).ToUniversalTime().ToString('o')
        blockers       = @((New-PrReviewIssue -Kind 'report_generation_failed' -Severity 'high' -Message ($_ | Out-String)))
        warnings       = @()
        checks         = @()
    }
    [System.IO.File]::WriteAllText((Join-Path $OutputDir 'pr-review-agent.json'), ($report | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText((Join-Path $OutputDir 'pr-review-agent.md'), "# PR Review Agent Summary`n`nReport generation failed.`n", [System.Text.UTF8Encoding]::new($false))
    Write-Host "[pr-review-agent] status=failed"
    Write-Host ($_ | Out-String)
    if (-not $ReportOnly) { exit 1 }
    exit 0
}

$status = $result.report.status
$risk = $result.report.risk_level
Write-Host "[pr-review-agent] status=$status risk=$risk"
Write-Host "[pr-review-agent] json=$($result.json_path)"
Write-Host "[pr-review-agent] markdown=$($result.markdown_path)"

if (-not $ReportOnly -and $status -in @('blocked', 'failed')) {
    exit 1
}
exit 0
