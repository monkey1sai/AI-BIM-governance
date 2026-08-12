# scripts\measure-session-baseline.ps1
#
# GPU session baseline measurement harness
# (openspec/changes/gpu-session-baseline-and-idle-reclaim task 1.1).
#
# Captures, in one read-only pass:
#   - nvidia-smi GPU inventory (VRAM, utilization, MIG availability, consumer
#     RTX classification)
#   - a read-only WebRTC/coordinator health probe (GET /health, GET
#     /api/runtime/status against the coordinator at -CoordinatorUrl)
#   - the environment fingerprint required by the gpu-session-baseline spec
#     (GPU model, driver version, Kit version, fixture hash + size)
#
# This script never creates, joins, or closes a review session and never
# starts/stops any service, so it is safe to run against a live deployment
# area without disturbing it. TTFF and session-creation success rate cannot
# be honestly measured without a live session; unless supplied via -TtffMs /
# -SessionCreationSuccessRate (e.g. from a task 1.3 soak run), those fields
# are reported as null with measured:false and an explicit reason -- never
# fabricated.
#
# Registered in scripts\script-registry.json. Core logic lives in
# scripts\lib\measure-session-baseline.ps1 for unit testing; see
# scripts\tests\test-measure-session-baseline.ps1.

[CmdletBinding()]
param(
    [string] $OutputPath,
    [string] $CoordinatorUrl = 'http://127.0.0.1:8004',
    [string] $FixturePath,
    [Nullable[double]] $TtffMs,
    [Nullable[double]] $SessionCreationSuccessRate,
    [int] $ProbeTimeoutSec = 5,
    [switch] $SkipWebRtcProbe
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path

. (Join-Path $PSScriptRoot 'lib\measure-session-baseline.ps1')
Import-Module (Join-Path $PSScriptRoot 'lib\StructLog.psm1') -Force

$logger = New-StructLogger -Service 'scripts' -Component 'measure-session-baseline' -SkipEnvSnapshot
$logger | Write-StructLifecycle -Data @{ phase = 'start'; coordinator_url = $CoordinatorUrl; fixture_path = $FixturePath }

try {
    $report = Get-SessionBaselineReport `
        -CoordinatorUrl $CoordinatorUrl `
        -FixturePath $FixturePath `
        -TtffMs $TtffMs `
        -SessionCreationSuccessRate $SessionCreationSuccessRate `
        -RepoRoot $RepoRoot `
        -ProbeTimeoutSec $ProbeTimeoutSec `
        -SkipWebRtcProbe:$SkipWebRtcProbe

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        # Name the artifact after the report's own run_id (already computed
        # above, inside $report). A bare second-resolution timestamp collides
        # when two runs land in the same second, silently overwriting the
        # earlier report; run_id carries a per-run random suffix as well.
        $OutputPath = Join-Path $RepoRoot "artifacts\gpu-baseline\$($report.run_id).json"
    }
    $outDir = Split-Path -Parent $OutputPath
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }
    ($report | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $OutputPath -Encoding UTF8

    $logger | Write-StructLifecycle -Data @{
        phase = 'complete'
        output_path = $OutputPath
        environment_fingerprint_complete = $report.environment_fingerprint.complete
        gpu_inventory_measured = $report.gpu_inventory.measured
        webrtc_reachable = $report.webrtc_health_probe.reachable
    }
    Write-Host "[measure-session-baseline] report written to $OutputPath"
    if (-not $report.environment_fingerprint.complete) {
        Write-Warning '[measure-session-baseline] environment fingerprint is incomplete; this report SHALL NOT be used to set SLOs or admission parameters (see openspec gpu-session-baseline spec).'
    }
    return $report
} catch {
    $logger | Write-StructFatal -Msg 'measure-session-baseline failed' -ErrorRecord $_
    throw
}
