[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$StageLoadingPath = Resolve-Path (Join-Path $ScriptRoot "..\..\source\extensions\ezplus.bim_review_stream.messaging\ezplus\bim_review_stream\messaging\stage_loading.py")
$Source = Get-Content -Path $StageLoadingPath -Raw

$RequiredTokens = @(
    "loadArtifactGroupRequest",
    "loadArtifactGroupResult",
    "artifact_bindings",
    "artifact_bindings_load_order",
    "missing_paths",
    "fallback_paths",
    "No loadable artifact binding URL was provided.",
    "_resolve_stage_request",
    "_on_load_artifact_group"
)

foreach ($Token in $RequiredTokens) {
    if (-not $Source.Contains($Token)) {
        throw "stage_loading.py is missing required DataChannel contract token: $Token"
    }
}

if ($Source -notmatch "normalized\.sort\(key=lambda item: item\[""load_order""\]\)") {
    throw "stage_loading.py must sort artifact bindings by load_order before selecting a URL."
}

Write-Host "[verify] stage loading DataChannel contract passed"
