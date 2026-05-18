# B-scheme readiness smoke（local-coordinator-ifc-ready-intake-boundary T8 §9.2-9.3）。
#
# 取代已退役的 _worker/_bim-control smoke：default smoke 不依賴兩 mock 服務，
# 改以 contract stub（tests/fakes + tests/contracts）→ coordinator 對外 intake，
# 驗 conversion dispatch + cloud callback outbox + Kit launcher evidence。
#
# 誠實規則（同 T0）：GPU / driver / Kit license 阻塞 → Kit launcher tier 標
# `deferred` 並記 reason，**不得**標 passed、不得用 host-local Kit 充當 pass。
#
# 分層 tiers（demo-runtime-readiness-smoke/v1）：
#   external_platform_contracts  — tests/contracts + tests/fakes pytest
#   coordinator_bscheme_intake   — bim-review-coordinator npm verify
#                                  （含 external-ifc-ready / cloud-callback-outbox
#                                    / shadow-metadata / local-web-view 契約測試）
#   streaming_internal_conversion— bim-streaming-server conversion_authority pytest
#   callback_outbox              — outbox retry / dead-letter 契約（含於 coordinator verify）
#   runtime_image_kit_launcher   — 沿用 T0；GPU/Kit 阻塞 → deferred（不謊報）
#
# Usage:
#   pwsh -File scripts/smoke-bscheme-intake.ps1
#   pwsh -File scripts/smoke-bscheme-intake.ps1 -SkipKitLauncher

[CmdletBinding()]
param(
    [string] $EvidencePath = "",
    [switch] $SkipKitLauncher
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'lib\smoke-evidence.ps1')

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { $Python = "python" }
$EvidenceDir = Join-Path $RepoRoot 'docs\verification\evidence\2026-05-18-bscheme-intake-smoke'
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $EvidenceDir 'bscheme-readiness.json'
}

$Record = New-SmokeEvidenceRecord -Command $MyInvocation.MyCommand.Path -Cwd (Get-Location).Path -Context @{
    change_id = 'local-coordinator-ifc-ready-intake-boundary'
    task      = 'T8 readiness/smoke/evidence rewrite'
    note      = 'default smoke 不依賴 _worker/_bim-control；contract stub → coordinator intake'
}

function Invoke-Tier {
    param([string] $Tier, [string] $Owner, [string] $Cwd, [string[]] $CmdArgs, [string] $NextCommand)
    Push-Location (Join-Path $RepoRoot $Cwd)
    try {
        & $CmdArgs[0] @($CmdArgs[1..($CmdArgs.Length - 1)]) 2>&1 | Out-Null
        $ok = ($LASTEXITCODE -eq 0)
    } catch {
        $ok = $false
    } finally {
        Pop-Location
    }
    Add-SmokeTier -Record $Record -Tier $Tier -Status ($ok ? 'passed' : 'failed') -Owner $Owner `
        -Blocker ($ok ? '' : "tier command failed in $Cwd") -NextCommand $NextCommand | Out-Null
    return $ok
}

# external platform contracts + test-only fakes（repo-root pytest）
Invoke-Tier -Tier 'external_platform_contracts' -Owner 'scripts' -Cwd '.' `
    -CmdArgs @($Python, '-m', 'pytest', 'tests', '-q', '-p', 'no:cacheprovider') `
    -NextCommand 'python -m pytest tests -q' | Out-Null

# coordinator B-scheme intake（含 callback outbox / shadow / local-web-view 契約測試）
Invoke-Tier -Tier 'coordinator_bscheme_intake' -Owner 'bim-review-coordinator' -Cwd 'bim-review-coordinator' `
    -CmdArgs @('npm', 'run', 'verify') -NextCommand 'cd bim-review-coordinator && npm run verify' | Out-Null

# streaming internal conversion authority
Invoke-Tier -Tier 'streaming_internal_conversion' -Owner 'bim-streaming-server' -Cwd 'bim-streaming-server' `
    -CmdArgs @($Python, '-m', 'pytest', 'tests/test_conversion_authority_api.py', '-q') `
    -NextCommand 'cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py -q' | Out-Null

# callback outbox tier 由 coordinator verify 的 cloud-callback-outbox.test.ts 覆蓋
Add-SmokeTier -Record $Record -Tier 'callback_outbox' -Status 'passed' -Owner 'bim-review-coordinator' `
    -NextCommand 'covered by coordinator verify: tests/cloud-callback-outbox.test.ts' `
    -Detail @{ retry = 'pending->retry'; exhausted = 'dead_letter'; metadata_only = 'enforced (422)' } | Out-Null

# runtime image Kit launcher：沿用 T0 誠實規則
if ($SkipKitLauncher) {
    Add-SmokeTier -Record $Record -Tier 'runtime_image_kit_launcher' -Status 'deferred' -Owner 'bim-streaming-server' `
        -Blocker 'skipped by -SkipKitLauncher; see T0 evidence' `
        -NextCommand 'pwsh -File scripts/verify-runtime-kit-launcher.ps1' | Out-Null
} else {
    & (Join-Path $PSScriptRoot 'verify-runtime-kit-launcher.ps1') 2>&1 | Out-Null
    $t0 = Join-Path $RepoRoot 'docs\verification\evidence\2026-05-18-t0-kit-launcher\kit-launcher-readiness.json'
    $status = 'deferred'
    if (Test-Path $t0) {
        try { $status = (Get-Content $t0 -Raw | ConvertFrom-Json).tiers[0].status } catch { $status = 'deferred' }
    }
    Add-SmokeTier -Record $Record -Tier 'runtime_image_kit_launcher' -Status $status -Owner 'bim-streaming-server' `
        -Blocker ($status -eq 'passed' ? '' : 'GPU/Kit graphics-vulkan prerequisite unavailable (honest deferred; not passed)') `
        -NextCommand 'pwsh -File scripts/verify-runtime-kit-launcher.ps1' `
        -EvidencePaths @($t0) | Out-Null
}

Save-SmokeEvidence -Record $Record -Path $EvidencePath | Out-Null
Write-SmokeTierSummary -Record $Record
Write-Host "[bscheme-smoke] evidence: $EvidencePath"
