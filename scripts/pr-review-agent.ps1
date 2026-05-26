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
    [switch] $AllowGitNexusUnavailable,
    [switch] $AllowUnavailableCommands
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot 'artifacts\pr-review-agent'
}

try {
    . (Join-Path $PSScriptRoot 'lib\pr-review-agent.ps1')

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
        -AllowGitNexusUnavailable:$AllowGitNexusUnavailable `
        -AllowUnavailableCommands:$AllowUnavailableCommands
} catch {
    if (-not (Test-Path -LiteralPath $OutputDir)) {
        New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    }
    $message = $_ | Out-String
    $report = [ordered]@{
        schema_version      = 'pr-review-agent/v1'
        status              = 'failed'
        risk_level          = 'high'
        report_only         = [bool]$ReportOnly
        pr_number           = $PrNumber
        base_ref            = $BaseRef
        head_ref            = $HeadRef
        base_sha            = $BaseSha
        head_sha            = $HeadSha
        run_id              = $RunId
        generated_at        = (Get-Date).ToUniversalTime().ToString('o')
        changed_paths       = @($ChangedPath)
        openspec_changes    = @()
        validation_commands = @()
        checks              = @()
        blockers            = @([ordered]@{
            kind     = 'report_generation_failed'
            severity = 'high'
            path     = ''
            message  = $message
        })
        warnings            = @()
        human_review_notes  = @('Report generation failed before the full review pipeline could complete.')
        gitnexus            = [ordered]@{
            required   = $false
            status     = 'not_run'
            command    = ''
            summary    = 'Report generation failed before GitNexus could run.'
            risk_level = 'unknown'
            affected   = @()
        }
    }
    [System.IO.File]::WriteAllText((Join-Path $OutputDir 'pr-review-agent.json'), ($report | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText((Join-Path $OutputDir 'pr-review-agent.md'), "# PR Review Agent Summary`n`nReport generation failed.`n", [System.Text.UTF8Encoding]::new($false))
    Write-Host "[pr-review-agent] status=failed"
    Write-Host $message
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
