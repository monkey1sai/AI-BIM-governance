[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$hookPath = Join-Path $repoRoot 'scripts/hooks/require-gstack-evidence.ps1'
$script:PsExe = (Get-Process -Id $PID).Path
if (-not (Test-Path -LiteralPath $hookPath -PathType Leaf) -or [string]::IsNullOrWhiteSpace($script:PsExe)) {
    throw '[test-require-gstack-evidence] hook or current PowerShell executable is unavailable.'
}

function Invoke-EvidenceHookRaw {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $Payload)

    $stdout = $Payload | & $script:PsExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $hookPath 2>$null
    return ($stdout | Out-String).Trim()
}

function Invoke-EvidenceHook {
    param([Parameter(Mandatory = $true)][string] $Command)

    $payload = @{ tool_name = 'Bash'; tool_input = @{ command = $Command } } | ConvertTo-Json -Compress
    return Invoke-EvidenceHookRaw -Payload $payload
}

function Assert-Denied {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $Output, [Parameter(Mandatory = $true)][string] $Message)
    if ($Output -notmatch '"permissionDecision"\s*:\s*"deny"') { throw "ASSERT FAILED: $Message" }
}

function Assert-Allowed {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $Output, [Parameter(Mandatory = $true)][string] $Message)
    if ($Output -match '"permissionDecision"\s*:\s*"deny"') { throw "ASSERT FAILED: $Message — $Output" }
}

$mustAllow = @(
    'cd web-viewer-sample && npx playwright test e2e/foo.spec.ts',
    'cd web-viewer-sample && npm run verify',
    'git commit -m "fix: something"',
    'git push origin feature-branch',
    'gh pr create --title x --body-file y.md',
    'gh pr checks 336',
    'gh pr view 336 --json mergeable'
)
foreach ($command in $mustAllow) {
    Assert-Allowed -Output (Invoke-EvidenceHook -Command $command) -Message "non-merge command must not deadlock: $command"
}
Assert-Allowed -Output (Invoke-EvidenceHookRaw -Payload '') -Message 'manual invocation with no stdin remains a no-op'
Assert-Denied -Output (Invoke-EvidenceHookRaw -Payload '{malformed-json') -Message 'malformed redirected hook payload must fail closed'
Assert-Denied -Output (Invoke-EvidenceHookRaw -Payload '{"tool_name":"Bash","tool_input":{}}') -Message 'hook payload without tool_input.command must fail closed'


$source = Get-Content -LiteralPath $hookPath -Raw
foreach ($requiredMarker in @(
    'IsInputRedirected',
    'gh\s+pr\s+merge',
    'baseRefOid,headRefOid',
    'design-system-gate\.ps1',
    'verify-design-system-visual-result\.ps1',
    'AllowUntrackedArtifacts',
    'RequiredScreenIds'
)) {
    if ($source -notmatch $requiredMarker) { throw "[test-require-gstack-evidence] hook marker missing: $requiredMarker" }
}
if ($source -match 'DESIGN_SYSTEM_VISUAL_RESULT_PATH') {
    throw '[test-require-gstack-evidence] canonical local result path must not be replaceable by an environment override.'
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "gstack-hook-test-$([guid]::NewGuid().ToString('N'))"
$oldPath = $env:PATH
$oldBase = $env:FAKE_PR_BASE_SHA
$oldHead = $env:FAKE_PR_HEAD_SHA
$oldExpectedSelector = $env:FAKE_EXPECT_SELECTOR
$oldExpectedRepo = $env:FAKE_EXPECT_REPO
$oldValidatorThrow = $env:FAKE_VALIDATOR_THROW
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    Push-Location $tempRoot
    try {
        git init -q
        git config user.email 'hook-test@example.invalid'
        git config user.name 'Hook Test'
        New-Item -ItemType Directory -Path 'docs/plans' -Force | Out-Null
        New-Item -ItemType Directory -Path 'scripts/lib' -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/plans/design-system-reference.manifest.json') -Destination 'docs/plans/design-system-reference.manifest.json'
        Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts/lib/design-system-gate.ps1') -Destination 'scripts/lib/design-system-gate.ps1'
        Set-Content -LiteralPath 'README.md' -Value 'base' -Encoding utf8
        git add .
        git commit -q -m 'base with design manifest'
        $baseSha = (git rev-parse HEAD).Trim()
        git update-ref refs/remotes/origin/main HEAD

        git checkout -q -b feature
        New-Item -ItemType Directory -Path 'web-viewer-sample/src' -Force | Out-Null
        Set-Content -LiteralPath 'web-viewer-sample/src/Foo.tsx' -Value 'export const Foo = () => null;' -Encoding utf8
        git add .
        git commit -q -m 'mixed frontend change'
        $featureHead = (git rev-parse HEAD).Trim()

        New-Item -ItemType Directory -Path 'bin' -Force | Out-Null
        @'
$argList = @($args | ForEach-Object { [string]$_ })
if (-not [string]::IsNullOrWhiteSpace($env:FAKE_EXPECT_SELECTOR) -and $env:FAKE_EXPECT_SELECTOR -notin $argList) { exit 41 }
if (-not [string]::IsNullOrWhiteSpace($env:FAKE_EXPECT_REPO)) {
    $repoValue = ''
    for ($index = 0; $index -lt $argList.Count - 1; $index++) {
        if ($argList[$index] -eq '--repo') { $repoValue = $argList[$index + 1]; break }
    }
    if ($repoValue -ne $env:FAKE_EXPECT_REPO) { exit 42 }
}
@{
    baseRefOid = $env:FAKE_PR_BASE_SHA
    headRefOid = $env:FAKE_PR_HEAD_SHA
} | ConvertTo-Json -Compress
'@ | Set-Content -LiteralPath 'bin/gh.ps1' -Encoding utf8
        $env:PATH = (Join-Path $tempRoot 'bin') + [System.IO.Path]::PathSeparator + $oldPath
        $env:FAKE_PR_BASE_SHA = $baseSha
        $env:FAKE_PR_HEAD_SHA = $featureHead

        $playwrightProbe = Invoke-EvidenceHook -Command 'npx playwright test e2e/foo.spec.ts'
        Assert-Allowed -Output $playwrightProbe -Message 'evidence-producing command remains allowed with a frontend diff'

        $missingResultProbe = Invoke-EvidenceHook -Command 'gh pr merge 336 --squash'
        Assert-Denied -Output $missingResultProbe -Message 'mixed frontend merge without canonical result is denied'

        $env:FAKE_PR_HEAD_SHA = $baseSha
        $wrongCheckoutProbe = Invoke-EvidenceHook -Command 'gh pr merge 336 --squash'
        Assert-Denied -Output $wrongCheckoutProbe -Message 'merge target not matching current checkout is denied'
        $env:FAKE_PR_HEAD_SHA = $featureHead

        New-Item -ItemType Directory -Path 'scripts/tests' -Force | Out-Null
        New-Item -ItemType Directory -Path 'artifacts/e2e' -Force | Out-Null
        @'
param(
    [string] $RepoRoot,
    [string] $ResultPath,
    [string[]] $RequiredScreenIds,
    [string] $TargetCommit,
    [int] $MaxAgeHours,
    [switch] $AllowUntrackedArtifacts
)
if ($env:FAKE_VALIDATOR_THROW -eq '1') { throw 'synthetic validator failure' }
if (-not $AllowUntrackedArtifacts -or $RequiredScreenIds.Count -ne 13 -or $TargetCommit -ne $env:FAKE_PR_HEAD_SHA) { exit 9 }
exit 0
'@ | Set-Content -LiteralPath 'scripts/tests/verify-design-system-visual-result.ps1' -Encoding utf8
        Set-Content -LiteralPath 'artifacts/e2e/design-system-visual-result.json' -Value '{}' -Encoding utf8
        $validResultProbe = Invoke-EvidenceHook -Command 'gh pr merge 336 --squash'
        Assert-Allowed -Output $validResultProbe -Message 'mixed frontend merge passes when canonical commit-bound validator succeeds'
        $env:FAKE_VALIDATOR_THROW = '1'
        $validatorThrowProbe = Invoke-EvidenceHook -Command 'gh pr merge 336 --squash'
        Assert-Denied -Output $validatorThrowProbe -Message 'validator exception fails closed with structured deny JSON'
        $env:FAKE_VALIDATOR_THROW = $null

        $env:FAKE_EXPECT_SELECTOR = '456'
        $env:FAKE_EXPECT_REPO = 'owner/example'
        $flagFirstProbe = Invoke-EvidenceHook -Command 'gh pr merge --squash 456 --repo owner/example'
        Assert-Allowed -Output $flagFirstProbe -Message 'flag-before-selector merge remains bound to the explicit cross-repo PR target'
        $ghExeProbe = Invoke-EvidenceHook -Command 'gh.exe pr merge --squash 456 --repo owner/example'
        Assert-Allowed -Output $ghExeProbe -Message 'Windows gh.exe alias is governed by the same target binding'
        $absoluteGhExeProbe = Invoke-EvidenceHook -Command '"C:\Program Files\GitHub CLI\gh.exe" pr merge --squash 456 --repo owner/example'
        Assert-Allowed -Output $absoluteGhExeProbe -Message 'quoted absolute gh.exe path is governed by the same target binding'
        $chainedMergeProbe = Invoke-EvidenceHook -Command 'gh pr merge 456 --squash && gh pr merge 999 --squash'
        Assert-Denied -Output $chainedMergeProbe -Message 'multiple merge targets in one shell command fail closed'
        $env:FAKE_EXPECT_SELECTOR = $null
        $env:FAKE_EXPECT_REPO = $null

        git checkout -q -b partial $baseSha
        New-Item -ItemType Directory -Path 'apps/kit-manager-web/src' -Force | Out-Null
        Set-Content -LiteralPath 'apps/kit-manager-web/src/App.tsx' -Value 'export const App = () => null;' -Encoding utf8
        git add .
        git commit -q -m 'reference-missing partial change'
        $partialHead = (git rev-parse HEAD).Trim()
        $env:FAKE_PR_HEAD_SHA = $partialHead
        Remove-Item -LiteralPath 'artifacts/e2e/design-system-visual-result.json' -Force
        $partialProbe = Invoke-EvidenceHook -Command 'gh pr merge 337 --squash'
        Assert-Allowed -Output $partialProbe -Message 'pure reference-missing partial work does not fabricate a pixel result'
    } finally {
        Pop-Location
    }
} finally {
    $env:PATH = $oldPath
    $env:FAKE_PR_BASE_SHA = $oldBase
    $env:FAKE_PR_HEAD_SHA = $oldHead
    $env:FAKE_EXPECT_SELECTOR = $oldExpectedSelector
    $env:FAKE_EXPECT_REPO = $oldExpectedRepo
    $env:FAKE_VALIDATOR_THROW = $oldValidatorThrow
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "[test-require-gstack-evidence] passed — $($mustAllow.Count) non-merge commands plus target/scope/result deny-allow cases"
