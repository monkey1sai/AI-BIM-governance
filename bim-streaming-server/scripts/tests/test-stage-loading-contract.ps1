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
    "stage_composition",
    "artifact_bindings_single",
    "artifact_bindings_multi_layer_payload",
    "legacy_single_url",
    "primary_binding",
    "applied_primary",
    "secondary_bindings",
    "applied_secondary_layers",
    "skipped_secondary_layers",
    "loaded_bindings",
    "failed_bindings",
    "partial_load",
    "session_sublayer",
    "missing_paths",
    "fallback_paths",
    "Expected exactly one stage_composition.primary.",
    "No primary stage_composition.primary URL was provided.",
    "No loadable artifact binding URL was provided.",
    "_resolve_stage_request",
    "_compose_secondary_artifact_bindings",
    "_on_load_artifact_group"
)

foreach ($Token in $RequiredTokens) {
    if (-not $Source.Contains($Token)) {
        throw "stage_loading.py is missing required DataChannel contract token: $Token"
    }
}

if ($Source -notmatch "normalized\.sort\(key=lambda item: item\[""load_order""\]\)") {
    throw "stage_loading.py must sort artifact bindings by load_order before composing stage layers."
}

if ($Source -notmatch "session_layer\.subLayerPaths\.append\(layer\.identifier\)") {
    throw "stage_loading.py must compose secondary artifact bindings as session-layer sublayers."
}

Write-Host "[verify] stage loading DataChannel contract passed"
