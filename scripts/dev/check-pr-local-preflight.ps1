[CmdletBinding()]
param(
    [int] $PrNumber = 0,
    [string] $Repo = 'monkey1sai/AI-BIM-governance',
    [ValidateSet('local', 'remote')]
    [string] $ChangedPathsSource = 'local',
    [switch] $SkipReviewAgent,
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
        $changedPathsPath,
        '-RepoRoot',
        $repoRootPath,
        '-BaseSha',
        'origin/main',
        '-HeadSha',
        'HEAD'
    ) -FailureMessage 'PR body evidence preflight failed.'

    $tempDir = Join-Path $repoRootPath '.tmp'
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $oldTemp = $env:TEMP
    $oldTmp = $env:TMP
    $env:TEMP = $tempDir
    $env:TMP = $tempDir

    if (-not $SkipReviewAgent) {
        Write-Host '[local-pr-preflight] running scripts/pr-review-agent.ps1 with local base/head'
        $baseSha = (& git -c "safe.directory=$repoRootPath" rev-parse origin/main).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($baseSha)) {
            throw 'Unable to resolve origin/main for local PR review agent.'
        }
        $headSha = (& git -c "safe.directory=$repoRootPath" rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($headSha)) {
            throw 'Unable to resolve HEAD for local PR review agent.'
        }
        Invoke-External -FilePath 'pwsh' -Arguments @(
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            (Join-Path $repoRootPath 'scripts\pr-review-agent.ps1'),
            '-BaseSha',
            $baseSha,
            '-HeadSha',
            $headSha,
            '-PrNumber',
            ([string]$PrNumber),
            '-RunId',
            'local-preflight',
            '-OutputDir',
            (Join-Path $outDir 'pr-review-agent'),
            '-PrBodyPath',
            $bodyPath,
            '-SkipGitNexus',
            '-AllowGitNexusUnavailable'
        ) -FailureMessage 'Local PR review agent failed.'
    }

    $frontendPattern = '^(web-viewer-sample/|apps/kit-manager-web/|bim-review-coordinator/(src|public)/|docs/plans/.*prototype\.html)'
    $hasFrontendPaths = [bool](@($changedPaths | Where-Object { $_ -match $frontendPattern } | Select-Object -First 1).Count)
    if ($hasFrontendPaths -and -not $SkipViewerVerify -and $SkipReviewAgent) {
        Write-Host '[local-pr-preflight] frontend paths detected; running web-viewer-sample npm run verify'
        Push-Location (Join-Path $repoRootPath 'web-viewer-sample')
        try {
            Invoke-External -FilePath 'npm' -Arguments @('run', 'verify') -FailureMessage 'web-viewer-sample npm run verify failed.'
        } finally {
            Pop-Location
        }
    } elseif ($hasFrontendPaths -and -not $SkipReviewAgent) {
        Write-Host '[local-pr-preflight] frontend paths detected; viewer verify is covered by local PR review agent'
    } elseif ($hasFrontendPaths) {
        Write-Host '[local-pr-preflight] frontend paths detected; viewer verify skipped by -SkipViewerVerify'
    } else {
        Write-Host '[local-pr-preflight] no frontend paths detected; viewer verify skipped'
    }

    $env:TEMP = $oldTemp
    $env:TMP = $oldTmp
    Write-Host "[local-pr-preflight] passed for PR #$PrNumber"
} finally {
    Pop-Location
}
