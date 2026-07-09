[CmdletBinding()]
param(
    [int] $PrNumber = 0,
    [string] $Repo = 'monkey1sai/AI-BIM-governance',
    [ValidateSet('local', 'remote')]
    [string] $ChangedPathsSource = 'local',
    [switch] $SkipViewerVerify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string] $FilePath,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [string] $FailureMessage = 'External command failed.'
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage Exit code: $LASTEXITCODE"
    }
}

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')
$repoRootPath = $repoRoot.Path

Push-Location $repoRootPath
try {
    if ($PrNumber -le 0) {
        $resolvedPr = (& gh pr view --repo $Repo --json number --jq '.number')
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($resolvedPr)) {
            throw 'Unable to resolve current branch PR. Pass -PrNumber explicitly.'
        }
        $PrNumber = [int]$resolvedPr.Trim()
    }

    $outDir = Join-Path $repoRootPath ".tmp-pr-local-preflight\pr-$PrNumber"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $changedPathsPath = Join-Path $outDir 'changed-paths.txt'
    $bodyPath = Join-Path $outDir 'pr-body.md'

    if ($ChangedPathsSource -eq 'local') {
        Write-Host '[local-pr-preflight] changed paths source: local origin/main...HEAD'
        $changedPaths = (& git -c "safe.directory=$repoRootPath" diff --name-only origin/main...HEAD)
        if ($LASTEXITCODE -ne 0) {
            throw 'Unable to compute local changed paths from origin/main...HEAD.'
        }
    } else {
        Write-Host "[local-pr-preflight] changed paths source: remote PR #$PrNumber"
        $changedPaths = (& gh pr diff $PrNumber --repo $Repo --name-only)
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to fetch PR #$PrNumber changed paths."
        }
    }
    $changedPaths | Set-Content -LiteralPath $changedPathsPath -Encoding utf8

    $body = (& gh pr view $PrNumber --repo $Repo --json body --jq '.body')
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to fetch PR #$PrNumber body."
    }
    $body | Set-Content -LiteralPath $bodyPath -Encoding utf8

    Invoke-External -FilePath 'pwsh' -Arguments @(
        '-NoProfile',
        '-File',
        (Join-Path $repoRootPath 'scripts\tests\check-pr-body-evidence.ps1'),
        '-BodyPath',
        $bodyPath,
        '-ChangedPathsPath',
        $changedPathsPath
    ) -FailureMessage 'PR body evidence preflight failed.'

    $frontendPattern = '^(web-viewer-sample/|apps/kit-manager-web/|bim-review-coordinator/(src|public)/|docs/plans/.*prototype\.html)'
    $hasFrontendPaths = [bool](@($changedPaths | Where-Object { $_ -match $frontendPattern } | Select-Object -First 1).Count)
    if ($hasFrontendPaths -and -not $SkipViewerVerify) {
        Write-Host '[local-pr-preflight] frontend paths detected; running web-viewer-sample npm run verify'
        $tempDir = Join-Path $repoRootPath '.tmp'
        New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
        $oldTemp = $env:TEMP
        $oldTmp = $env:TMP
        $env:TEMP = $tempDir
        $env:TMP = $tempDir
        Push-Location (Join-Path $repoRootPath 'web-viewer-sample')
        try {
            Invoke-External -FilePath 'npm' -Arguments @('run', 'verify') -FailureMessage 'web-viewer-sample npm run verify failed.'
        } finally {
            Pop-Location
            $env:TEMP = $oldTemp
            $env:TMP = $oldTmp
        }
    } elseif ($hasFrontendPaths) {
        Write-Host '[local-pr-preflight] frontend paths detected; viewer verify skipped by -SkipViewerVerify'
    } else {
        Write-Host '[local-pr-preflight] no frontend paths detected; viewer verify skipped'
    }

    Write-Host "[local-pr-preflight] passed for PR #$PrNumber"
} finally {
    Pop-Location
}
