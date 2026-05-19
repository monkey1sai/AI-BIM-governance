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
#   external_ifc_ready_intake    — tests/contracts + tests/fakes pytest
#   coordinator_session_lifecycle— bim-review-coordinator npm verify
#                                  （含 external-ifc-ready / cloud-callback-outbox
#                                    / shadow-metadata / local-web-view 契約測試）
#   streaming_internal_conversion— bim-streaming-server conversion_authority pytest
#   cloud_callback_outbox        — outbox retry / dead-letter 契約（含於 coordinator verify）
#   runtime_image_kit_launcher   — 沿用 T0；GPU/Kit 阻塞 → deferred（不謊報）
#   single_kit_render / single_kit_multi_viewer / usd_stage_composition
#                                — Kit/GPU live evidence missing時維持 deferred/not_observed
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
$SmokeTempRoot = Join-Path $RepoRoot '.tmp\smoke'
New-Item -ItemType Directory -Path $SmokeTempRoot -Force | Out-Null
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
    $output = @()
    $previousErrorActionPreference = $ErrorActionPreference
    $previousTmp = $env:TMP
    $previousTemp = $env:TEMP
    $previousTmpDir = $env:TMPDIR
    try {
        $InvokeArgs = if ($CmdArgs.Length -gt 1) { $CmdArgs[1..($CmdArgs.Length - 1)] } else { @() }
        $ErrorActionPreference = "Continue"
        $env:TMP = $SmokeTempRoot
        $env:TEMP = $SmokeTempRoot
        $env:TMPDIR = $SmokeTempRoot
        $output = & $CmdArgs[0] @InvokeArgs 2>&1
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousErrorActionPreference
        $ok = ($exitCode -eq 0)
    } catch {
        $ok = $false
        $output = @($_)
    } finally {
        if ($previousErrorActionPreference) {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        $env:TMP = $previousTmp
        $env:TEMP = $previousTemp
        $env:TMPDIR = $previousTmpDir
        Pop-Location
    }
    $status = if ($ok) { 'passed' } else { 'failed' }
    $blocker = if ($ok) { '' } else { "tier command failed in $Cwd" }
    $detail = @{ output = (($output | ForEach-Object { "$_" }) -join "`n") }
    Add-SmokeTier -Record $Record -Tier $Tier -Status $status -Owner $Owner `
        -Blocker $blocker -NextCommand $NextCommand -Detail $detail | Out-Null
    return $status
}

# external platform contracts + test-only fakes（repo-root pytest）
$ExternalContractsStatus = Invoke-Tier -Tier 'external_ifc_ready_intake' -Owner 'scripts' -Cwd '.' `
    -CmdArgs @($Python, '-m', 'pytest', 'tests', '-q', '-p', 'no:cacheprovider') `
    -NextCommand 'python -m pytest tests -q'

# coordinator B-scheme intake（含 callback outbox / shadow / local-web-view 契約測試）
$CoordinatorStatus = Invoke-Tier -Tier 'coordinator_session_lifecycle' -Owner 'bim-review-coordinator' -Cwd 'bim-review-coordinator' `
    -CmdArgs @('npm', 'run', 'verify') -NextCommand 'cd bim-review-coordinator && npm run verify'

# streaming internal conversion authority
$StreamingStatus = Invoke-Tier -Tier 'streaming_internal_conversion' -Owner 'bim-streaming-server' -Cwd 'bim-streaming-server' `
    -CmdArgs @($Python, '-m', 'pytest', 'tests/test_conversion_authority_api.py', '-q', '-p', 'no:cacheprovider') `
    -NextCommand 'cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py -q -p no:cacheprovider'

# mapping quality 需要 streaming-owned quality evidence；本 smoke 不用 historical worker evidence 充當。
Add-SmokeTier -Record $Record -Tier 'mapping_quality' -Status 'not_observed' -Owner 'bim-streaming-server' `
    -Blocker 'no streaming-owned mapping-quality evidence collected by this API-only pass' `
    -NextCommand 'Run a real streaming conversion with quality metrics evidence when Kit/converter prerequisites are available' | Out-Null

# callback outbox tier 由 coordinator verify 的 cloud-callback-outbox.test.ts 覆蓋
$CallbackBlocker = if ($CoordinatorStatus -eq 'passed') { '' } else { 'covered coordinator verify did not pass; cloud_callback_outbox cannot be claimed passed' }
Add-SmokeTier -Record $Record -Tier 'cloud_callback_outbox' -Status $CoordinatorStatus -Owner 'bim-review-coordinator' `
    -Blocker $CallbackBlocker `
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
    $KitBlocker = if ($status -eq 'passed') { '' } else { 'GPU/Kit graphics-vulkan prerequisite unavailable (honest deferred; not passed)' }
    Add-SmokeTier -Record $Record -Tier 'runtime_image_kit_launcher' -Status $status -Owner 'bim-streaming-server' `
        -Blocker $KitBlocker `
        -NextCommand 'pwsh -File scripts/verify-runtime-kit-launcher.ps1' `
        -EvidencePaths @($t0) | Out-Null
}

Add-SmokeTier -Record $Record -Tier 'single_kit_render' -Status 'deferred' -Owner 'bim-streaming-server' `
    -Blocker 'Kit/GPU/WebRTC live render evidence not collected by this API-only pass' `
    -NextCommand 'pwsh -File scripts/verify-runtime-kit-launcher.ps1, then run browser/Kit render validation' | Out-Null
Add-SmokeTier -Record $Record -Tier 'single_kit_multi_viewer' -Status 'not_observed' -Owner 'web-viewer-sample' `
    -Blocker 'multi-viewer browser evidence not collected by this API-only pass' `
    -NextCommand 'Run multi-viewer browser validation after single Kit render is available' | Out-Null
Add-SmokeTier -Record $Record -Tier 'usd_stage_composition' -Status 'not_observed' -Owner 'bim-streaming-server' `
    -Blocker 'USD stage composition evidence not collected by this API-only pass' `
    -NextCommand 'Run stage composition validation with streaming-owned artifacts' | Out-Null

Save-SmokeEvidence -Record $Record -Path $EvidencePath | Out-Null
Write-SmokeTierSummary -Record $Record
Write-Host "[bscheme-smoke] evidence: $EvidencePath"
