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
    $prRefsRaw = @(& gh pr view $PrNumber --repo $Repo --json baseRefOid,headRefOid)
    if ($LASTEXITCODE -ne 0 -or $prRefsRaw.Count -eq 0) {
        throw "Unable to resolve PR #$PrNumber base/head commit IDs."
    }
    $prRefs = ($prRefsRaw -join "`n") | ConvertFrom-Json
    $baseSha = [string]$prRefs.baseRefOid
    $headSha = [string]$prRefs.headRefOid
    if ($baseSha -notmatch '^[0-9a-f]{40}$' -or $headSha -notmatch '^[0-9a-f]{40}$') {
        throw "PR #$PrNumber returned invalid base/head commit IDs."
    }
    $localHead = (& git -c "safe.directory=$repoRootPath" rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $localHead -ne $headSha) {
        throw "Local HEAD '$localHead' does not match PR #$PrNumber head '$headSha'. Check out the exact PR head before preflight."
    }
    & git -c "safe.directory=$repoRootPath" cat-file -e "${baseSha}^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "PR #$PrNumber base commit '$baseSha' is unavailable locally; fetch it before preflight."
    }

    $outDir = Join-Path $repoRootPath ".tmp\pr-local-preflight\pr-$PrNumber"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $changedPathsPath = Join-Path $outDir 'changed-paths.txt'
    $bodyPath = Join-Path $outDir 'pr-body.md'

    $localChangedPaths = @(& git -c "safe.directory=$repoRootPath" diff --no-renames --name-only "$baseSha...$headSha")
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to compute rename-safe local changed paths for PR #$PrNumber."
    }
    if ($ChangedPathsSource -eq 'local') {
        Write-Host "[local-pr-preflight] changed paths source: local PR base...head ($baseSha...$headSha)"
        $changedPaths = $localChangedPaths
    } else {
        Write-Host "[local-pr-preflight] changed paths source: remote PR #$PrNumber union rename-safe local base...head"
        $remoteChangedPaths = @(& gh pr diff $PrNumber --repo $Repo --name-only)
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to fetch PR #$PrNumber changed paths."
        }
        $changedPaths = @($localChangedPaths + $remoteChangedPaths | Where-Object { $_ } | Sort-Object -Unique)
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
        $baseSha,
        '-HeadSha',
        $headSha
    ) -FailureMessage 'PR body evidence preflight failed.'

    $tempDir = Join-Path $repoRootPath '.tmp'
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $oldTemp = $env:TEMP
    $oldTmp = $env:TMP
    $env:TEMP = $tempDir
    $env:TMP = $tempDir

    if (-not $SkipReviewAgent) {
        Write-Host '[local-pr-preflight] running scripts/pr-review-agent.ps1 with PR-bound base/head'
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

    . (Join-Path $repoRootPath 'scripts\lib\design-system-gate.ps1')
    $designScope = Get-DesignSystemChangeScope `
        -RepoRoot $repoRootPath `
        -ChangedPaths @($changedPaths) `
        -BaseSha $baseSha `
        -HeadSha $headSha
    if ($designScope.status -like '*_fail_closed') {
        throw "Design scope failed closed: status=$($designScope.status); unknown=$($designScope.unknown_paths -join ', '); reference-authority=$($designScope.reference_authority_paths -join ', ')"
    }
    $hasFrontendPaths = [bool]$designScope.frontend_product
    $hasDesignGatePaths = @($designScope.gate_infrastructure_paths).Count -gt 0
    $hasKitManagerPaths = @($designScope.reference_missing_surface_ids) -contains 'kit-manager-web'
    if (($hasFrontendPaths -or $hasDesignGatePaths) -and -not $SkipViewerVerify) {
        Write-Host '[local-pr-preflight] validating pinned desigin-system manifest and golden screenshots'
        Invoke-External -FilePath 'pwsh' -Arguments @(
            '-NoProfile',
            '-NonInteractive',
            '-File',
            (Join-Path $repoRootPath 'scripts\tests\verify-design-system-reference.ps1'),
            '-RepoRoot',
            $repoRootPath
        ) -FailureMessage 'desigin-system reference gate failed.'
    }
    if ($hasFrontendPaths -and [bool]$designScope.visual_required -and -not $SkipViewerVerify) {
        Write-Host "[local-pr-preflight] running current-checkout semantic/pixel gate for scope=$($designScope.status)"
        Push-Location (Join-Path $repoRootPath 'web-viewer-sample')
        try {
            Invoke-External -FilePath 'npm' -Arguments @('run', 'test:visual:design-system') -FailureMessage 'design-system Playwright producer failed.'
        } finally {
            Pop-Location
        }
        $visualResultArguments = @(
            '-NoProfile',
            '-NonInteractive',
            '-File',
            (Join-Path $repoRootPath 'scripts\tests\verify-design-system-visual-result.ps1'),
            '-RepoRoot',
            $repoRootPath,
            '-ResultPath',
            (Join-Path $repoRootPath 'artifacts\e2e\design-system-visual-result.json'),
            '-RequiredScreenIds'
        ) + @($designScope.required_screen_ids | ForEach-Object { [string]$_ }) + @(
            '-TargetCommit',
            $headSha,
            '-AllowUntrackedArtifacts'
        )
        Invoke-External -FilePath 'pwsh' -Arguments $visualResultArguments -FailureMessage 'design-system visual result validation failed.'
    }
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
        if (-not [bool]$designScope.visual_required) {
            Write-Host "[local-pr-preflight] scope=$($designScope.status); no pixel result is fabricated and full completion remains forbidden"
        }
    } elseif ($hasFrontendPaths) {
        Write-Host '[local-pr-preflight] frontend paths detected; viewer verify skipped by -SkipViewerVerify'
    } else {
        Write-Host '[local-pr-preflight] no frontend paths detected; viewer verify skipped'
    }

    if ($hasFrontendPaths -and -not $SkipViewerVerify -and $hasKitManagerPaths) {
        Write-Host '[local-pr-preflight] Kit Manager frontend changed; running npm run build'
        Push-Location (Join-Path $repoRootPath 'apps\kit-manager-web')
        try {
            Invoke-External -FilePath 'npm' -Arguments @('run', 'build') -FailureMessage 'kit-manager-web npm run build failed.'
        } finally {
            Pop-Location
        }
    }

    $env:TEMP = $oldTemp
    $env:TMP = $oldTmp
    Write-Host "[local-pr-preflight] passed for PR #$PrNumber"
} finally {
    Pop-Location
}
