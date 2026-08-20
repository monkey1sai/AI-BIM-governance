#requires -Version 7.0
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$validatorPath = Join-Path $repoRoot 'scripts\lib\design-gate-policy.ps1'
$schemaPath = Join-Path $repoRoot 'scripts\tests\design-gate-policy.schema.json'
$canonicalPath = Join-Path $repoRoot 'scripts\config\design-gate-policy.json'
$fixtureRoot = Join-Path $PSScriptRoot 'fixtures\design-gate-policy'

Assert-True (Test-Path -LiteralPath $validatorPath -PathType Leaf) 'scripts/lib/design-gate-policy.ps1 exists'
Assert-True (Test-Path -LiteralPath $schemaPath -PathType Leaf) 'scripts/tests/design-gate-policy.schema.json exists'
Assert-True (Test-Path -LiteralPath $canonicalPath -PathType Leaf) 'scripts/config/design-gate-policy.json exists'

. $validatorPath

function Assert-PolicyCode {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Action,
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $failed = $false
    $message = ''
    try {
        & $Action | Out-Null
    } catch {
        $failed = $true
        $message = [string]$_.Exception.Message
    }
    Assert-True $failed "$Context was expected to throw"
    Assert-True ($message.StartsWith("${Code}:", [System.StringComparison]::Ordinal)) `
        "$Context expected prefix '${Code}:' actual='$message'"
}

$canonicalBytes = [System.IO.File]::ReadAllBytes($canonicalPath)
Assert-True ($canonicalBytes.Length -gt 0 -and $canonicalBytes[0] -eq 0x7B) 'canonical policy is UTF-8 without BOM'
$canonicalRaw = [System.Text.Encoding]::UTF8.GetString($canonicalBytes)
Assert-True ($canonicalRaw -notmatch '"policy_digest"') 'canonical policy does not contain policy_digest'
Assert-True ($canonicalRaw | Test-Json -SchemaFile $schemaPath) 'canonical policy satisfies the closed schema'

$validRaw = Get-Content -LiteralPath (Join-Path $fixtureRoot 'valid.json') -Raw -Encoding utf8
Assert-True ($validRaw | Test-Json -SchemaFile $schemaPath) 'valid fixture satisfies the closed schema'
$canonicalHash = (Get-FileHash -LiteralPath $canonicalPath -Algorithm SHA256).Hash
$validHash = (Get-FileHash -LiteralPath (Join-Path $fixtureRoot 'valid.json') -Algorithm SHA256).Hash
Assert-Equal $canonicalHash $validHash 'valid fixture is byte-identical to the canonical policy'

foreach ($case in @(
    @{ File = 'missing-key.json'; Why = 'missing required key' },
    @{ File = 'unknown-key.json'; Why = 'unknown key' },
    @{ File = 'unsupported-schema.json'; Why = 'unsupported schema_version' },
    @{ File = 'wrong-type.json'; Why = 'wrong type' },
    @{ File = 'policy-digest.json'; Why = 'self-referential policy_digest' },
    @{ File = 'duplicate-source-id.json'; Why = 'duplicate source_id' },
    @{ File = 'duplicate-source-path.json'; Why = 'duplicate path' },
    @{ File = 'duplicate-source-role.json'; Why = 'duplicate source_role' },
    @{ File = 'malformed.json'; Why = 'malformed JSON' }
)) {
    $json = Get-Content -LiteralPath (Join-Path $fixtureRoot $case.File) -Raw -Encoding utf8
    $schemaOk = $false
    try { $schemaOk = $json | Test-Json -SchemaFile $schemaPath } catch { $schemaOk = $false }
    Assert-True (-not $schemaOk) "schema rejects $($case.Why)"
}

$policy = Test-DesignGatePolicy -PolicyPath $canonicalPath -SchemaPath $schemaPath
Assert-Equal 'design-gate-policy/v1' ([string]$policy.schema_version) 'schema_version'
$sources = @($policy.sources)
Assert-Equal 2 $sources.Count 'exactly two sources'
Assert-Equal 'ai-bim-frontend-backend-design' ([string]$sources[0].source_id) 'source 0 id'
Assert-Equal 'docs/plans/AI-BIM 前後端設計文件.dc.html' ([string]$sources[0].path) 'source 0 path'
Assert-Equal 'architecture_behavior' ([string]$sources[0].source_role) 'source 0 role'
Assert-Equal 'ai-bim-console-hifi' ([string]$sources[1].source_id) 'source 1 id'
Assert-Equal 'docs/plans/AI-BIM Console Hi-Fi.dc.html' ([string]$sources[1].path) 'source 1 path'
Assert-Equal 'console_hifi_visual' ([string]$sources[1].source_role) 'source 1 role'

$eng = $policy.engineering
Assert-Equal 'windows' ([string]$eng.platform) 'platform'
Assert-Equal 'chromium' ([string]$eng.browser) 'browser'
Assert-Equal 'windows-2025' ([string]$eng.ci_runner_label) 'ci_runner_label'
Assert-Equal '20.20.2' ([string]$eng.node_version) 'node_version'
Assert-Equal '10.9.4' ([string]$eng.npm_version) 'npm_version'
Assert-Equal '1.61.1' ([string]$eng.playwright_version) 'playwright_version'
Assert-Equal '1228' ([string]$eng.chromium_revision) 'chromium_revision'
Assert-Equal '149.0.7827.55' ([string]$eng.chromium_version) 'chromium_version'
Assert-True ([double]$eng.device_scale_factor -eq 1) 'DPR1'
Assert-Equal 'zh-TW' ([string]$eng.locale) 'locale'
Assert-Equal 'Asia/Taipei' ([string]$eng.timezone) 'timezone'
Assert-True ([bool]$eng.fonts_ready_required) 'fonts_ready_required'
Assert-True ([bool]$eng.animations_disabled) 'animations_disabled'
$viewportIds = @($eng.viewports | ForEach-Object { [string]$_.id })
Assert-True (($viewportIds -join '|') -eq '1440x900|1920x1080') 'viewport ids'
Assert-True ([double]$eng.pixelmatch_color_threshold -eq 0.1) 'pixelmatch 0.1'
Assert-True (-not [bool]$eng.include_antialiasing) 'anti-aliasing excluded'
Assert-True ([double]$eng.max_diff_pixel_ratio -eq 0.01) 'max diff 0.01'
Assert-True ([double]$eng.semantic_parity_required -eq 1) 'semantic parity equals 1'
Assert-True (-not [bool]$policy.full_completion_eligibility.allow_when_any_route_is_reference_missing) 'full-completion denies reference_missing'
Assert-True (-not [bool]$policy.full_completion_eligibility.allow_when_routes_without_approved_pixel_reference_nonempty) 'full-completion denies nonempty missing-pixel list'

Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'missing.json') -SchemaPath $schemaPath } 'policy.missing' 'absent file'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'malformed.json') -SchemaPath $schemaPath } 'policy.unparsed' 'malformed JSON'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'policy-digest.json') -SchemaPath $schemaPath } 'policy.digest_forbidden' 'policy_digest'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'unknown-key.json') -SchemaPath $schemaPath } 'policy.unknown_key' 'unknown key'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'missing-key.json') -SchemaPath $schemaPath } 'policy.missing_key' 'missing key'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'unsupported-schema.json') -SchemaPath $schemaPath } 'policy.schema_version_unsupported' 'unsupported schema'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'wrong-type.json') -SchemaPath $schemaPath } 'policy.wrong_type' 'wrong type'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'duplicate-source-id.json') -SchemaPath $schemaPath } 'policy.duplicate_source_id' 'duplicate id'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'duplicate-source-path.json') -SchemaPath $schemaPath } 'policy.duplicate_source_path' 'duplicate path'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'duplicate-source-role.json') -SchemaPath $schemaPath } 'policy.duplicate_source_role' 'duplicate role'

$validatorText = Get-Content -LiteralPath $validatorPath -Raw -Encoding utf8
Assert-True ($validatorText -notmatch 'design-system-reference\.manifest\.json') 'policy validator does not read the manifest as authority'
Assert-True ($validatorText -notmatch 'policy_digest\s*=') 'validator does not invent a self-referential digest'

Write-Host '[test-design-gate-policy] passed — canonical policy plus closed-schema fail-closed fixtures'
