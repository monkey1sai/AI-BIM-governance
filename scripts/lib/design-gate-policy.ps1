#requires -Version 7.0
Set-StrictMode -Version Latest

function New-DesignGateError {
    param(
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Message
    )
    throw [System.InvalidOperationException]::new("${Code}: ${Message}")
}

function Get-DesignGatePolicySchemaPath {
    param([Parameter(Mandatory = $true)][string] $RepoRoot)
    return (Join-Path $RepoRoot 'scripts\tests\design-gate-policy.schema.json')
}

function Test-DesignGateClosedString {
    param(
        [Parameter(Mandatory = $true)][AllowNull()]$Node,
        [Parameter(Mandatory = $true)][string] $Pointer,
        [Parameter(Mandatory = $true)][string] $Expected
    )
    if ($Node -isnot [string]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be a string."
    }
    if ([string]$Node -cne $Expected) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be '$Expected'."
    }
}

function Test-DesignGateClosedBool {
    param(
        [Parameter(Mandatory = $true)]$Node,
        [Parameter(Mandatory = $true)][string] $Pointer,
        [Parameter(Mandatory = $true)][bool] $Expected
    )
    if ($Node -isnot [bool]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be a boolean."
    }
    if ([bool]$Node -ne $Expected) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be $Expected."
    }
}

function Test-DesignGateClosedNumber {
    param(
        [Parameter(Mandatory = $true)]$Node,
        [Parameter(Mandatory = $true)][string] $Pointer,
        [Parameter(Mandatory = $true)][double] $Expected
    )
    if ($Node -isnot [ValueType] -or $Node -is [bool] -or $Node -is [char]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be a number."
    }
    if ([double]$Node -ne $Expected) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be $Expected."
    }
}

function Test-DesignGatePolicy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $PolicyPath,
        [Parameter(Mandatory = $true)][string] $SchemaPath
    )

    if (-not (Test-Path -LiteralPath $PolicyPath -PathType Leaf)) {
        New-DesignGateError -Code 'policy.missing' -Message "policy file is absent: $PolicyPath"
    }

    $raw = Get-Content -LiteralPath $PolicyPath -Raw -Encoding utf8
    $document = $null
    try {
        $document = $raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    } catch {
        New-DesignGateError -Code 'policy.unparsed' -Message "policy is not valid JSON: $PolicyPath"
    }
    if ($document -isnot [System.Collections.IDictionary]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'policy root must be an object.'
    }

    if ($document.ContainsKey('policy_digest')) {
        New-DesignGateError -Code 'policy.digest_forbidden' -Message 'policy_digest is forbidden; closed policy has no self-referential digest.'
    }

    $allowedTop = @('schema_version', 'sources', 'engineering', 'full_completion_eligibility')
    foreach ($key in @($document.Keys)) {
        if ($key -notin $allowedTop) {
            New-DesignGateError -Code 'policy.unknown_key' -Message "unknown policy key '$key'."
        }
    }
    foreach ($required in $allowedTop) {
        if (-not $document.ContainsKey($required)) {
            New-DesignGateError -Code 'policy.missing_key' -Message "missing required policy key '$required'."
        }
    }

    if ($document['schema_version'] -isnot [string]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'schema_version must be a string.'
    }
    if ([string]$document['schema_version'] -cne 'design-gate-policy/v1') {
        New-DesignGateError -Code 'policy.schema_version_unsupported' -Message "unsupported schema_version '$($document['schema_version'])'."
    }

    $sources = $document['sources']
    if ($sources -isnot [System.Collections.IEnumerable] -or $sources -is [string]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'sources must be an array.'
    }
    $sourceList = @($sources)
    if ($sourceList.Count -ne 2) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'sources must contain exactly two registry entries.'
    }

    $ids = New-Object System.Collections.Generic.List[string]
    $paths = New-Object System.Collections.Generic.List[string]
    $roles = New-Object System.Collections.Generic.List[string]
    $allowedPairs = @(
        @{ source_id = 'ai-bim-frontend-backend-design'; path = 'docs/plans/AI-BIM 前後端設計文件.dc.html'; source_role = 'architecture_behavior' }
        @{ source_id = 'ai-bim-console-hifi'; path = 'docs/plans/AI-BIM Console Hi-Fi.dc.html'; source_role = 'console_hifi_visual' }
    )
    $sourceKeys = @('source_id', 'path', 'source_role')
    foreach ($entry in $sourceList) {
        if ($entry -isnot [System.Collections.IDictionary]) {
            New-DesignGateError -Code 'policy.wrong_type' -Message 'each sources[] entry must be an object.'
        }
        if ($entry.ContainsKey('policy_digest')) {
            New-DesignGateError -Code 'policy.digest_forbidden' -Message 'policy_digest is forbidden on sources[].'
        }
        foreach ($key in @($entry.Keys)) {
            if ($key -notin $sourceKeys) {
                New-DesignGateError -Code 'policy.unknown_key' -Message "unknown sources[] key '$key'."
            }
        }
        foreach ($required in $sourceKeys) {
            if (-not $entry.ContainsKey($required)) {
                New-DesignGateError -Code 'policy.missing_key' -Message "sources[] missing '$required'."
            }
            if ($entry[$required] -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$entry[$required])) {
                New-DesignGateError -Code 'policy.wrong_type' -Message "sources[].$required must be a non-empty string."
            }
        }
        $ids.Add([string]$entry['source_id'])
        $paths.Add([string]$entry['path'])
        $roles.Add([string]$entry['source_role'])
    }
    if ((@($ids | Group-Object | Where-Object Count -gt 1).Count) -gt 0) {
        New-DesignGateError -Code 'policy.duplicate_source_id' -Message 'source_id values must be unique.'
    }
    if ((@($paths | Group-Object | Where-Object Count -gt 1).Count) -gt 0) {
        New-DesignGateError -Code 'policy.duplicate_source_path' -Message 'source path values must be unique.'
    }
    if ((@($roles | Group-Object | Where-Object Count -gt 1).Count) -gt 0) {
        New-DesignGateError -Code 'policy.duplicate_source_role' -Message 'source_role values must be unique.'
    }
    foreach ($entry in $sourceList) {
        $matched = $false
        foreach ($pair in $allowedPairs) {
            if ([string]$entry['source_id'] -ceq $pair.source_id -and [string]$entry['path'] -ceq $pair.path -and [string]$entry['source_role'] -ceq $pair.source_role) {
                $matched = $true
            }
        }
        if (-not $matched) {
            New-DesignGateError -Code 'policy.wrong_type' -Message ("sources[] pairing '{0}' / '{1}' / '{2}' is not in the closed registry." -f $entry['source_id'], $entry['path'], $entry['source_role'])
        }
    }

    $engineering = $document['engineering']
    if ($engineering -isnot [System.Collections.IDictionary]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'engineering must be an object.'
    }
    $engineeringKeys = @(
        'platform', 'browser', 'ci_runner_label', 'node_version', 'npm_version',
        'playwright_version', 'chromium_revision', 'chromium_version', 'device_scale_factor',
        'locale', 'timezone', 'fonts_ready_required', 'animations_disabled', 'viewports',
        'pixelmatch_color_threshold', 'include_antialiasing', 'max_diff_pixel_ratio',
        'semantic_parity_required'
    )
    foreach ($key in @($engineering.Keys)) {
        if ($key -eq 'policy_digest') {
            New-DesignGateError -Code 'policy.digest_forbidden' -Message 'policy_digest is forbidden on engineering.'
        }
        if ($key -notin $engineeringKeys) {
            New-DesignGateError -Code 'policy.unknown_key' -Message "unknown engineering key '$key'."
        }
    }
    foreach ($required in $engineeringKeys) {
        if (-not $engineering.ContainsKey($required)) {
            New-DesignGateError -Code 'policy.missing_key' -Message "engineering missing '$required'."
        }
    }
    Test-DesignGateClosedString -Node $engineering['platform'] -Pointer 'engineering.platform' -Expected 'windows'
    Test-DesignGateClosedString -Node $engineering['browser'] -Pointer 'engineering.browser' -Expected 'chromium'
    Test-DesignGateClosedString -Node $engineering['ci_runner_label'] -Pointer 'engineering.ci_runner_label' -Expected 'windows-2025'
    Test-DesignGateClosedString -Node $engineering['node_version'] -Pointer 'engineering.node_version' -Expected '20.20.2'
    Test-DesignGateClosedString -Node $engineering['npm_version'] -Pointer 'engineering.npm_version' -Expected '10.9.4'
    Test-DesignGateClosedString -Node $engineering['playwright_version'] -Pointer 'engineering.playwright_version' -Expected '1.61.1'
    Test-DesignGateClosedString -Node $engineering['chromium_revision'] -Pointer 'engineering.chromium_revision' -Expected '1228'
    Test-DesignGateClosedString -Node $engineering['chromium_version'] -Pointer 'engineering.chromium_version' -Expected '149.0.7827.55'
    Test-DesignGateClosedNumber -Node $engineering['device_scale_factor'] -Pointer 'engineering.device_scale_factor' -Expected 1
    Test-DesignGateClosedString -Node $engineering['locale'] -Pointer 'engineering.locale' -Expected 'zh-TW'
    Test-DesignGateClosedString -Node $engineering['timezone'] -Pointer 'engineering.timezone' -Expected 'Asia/Taipei'
    Test-DesignGateClosedBool -Node $engineering['fonts_ready_required'] -Pointer 'engineering.fonts_ready_required' -Expected $true
    Test-DesignGateClosedBool -Node $engineering['animations_disabled'] -Pointer 'engineering.animations_disabled' -Expected $true
    Test-DesignGateClosedNumber -Node $engineering['pixelmatch_color_threshold'] -Pointer 'engineering.pixelmatch_color_threshold' -Expected 0.1
    Test-DesignGateClosedBool -Node $engineering['include_antialiasing'] -Pointer 'engineering.include_antialiasing' -Expected $false
    Test-DesignGateClosedNumber -Node $engineering['max_diff_pixel_ratio'] -Pointer 'engineering.max_diff_pixel_ratio' -Expected 0.01
    Test-DesignGateClosedNumber -Node $engineering['semantic_parity_required'] -Pointer 'engineering.semantic_parity_required' -Expected 1

    $viewports = $engineering['viewports']
    if ($viewports -isnot [System.Collections.IEnumerable] -or $viewports -is [string]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'engineering.viewports must be an array.'
    }
    $viewportList = @($viewports)
    if ($viewportList.Count -ne 2) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'engineering.viewports must contain exactly two entries.'
    }
    $expectedViewports = @(
        @{ id = '1440x900'; width = 1440; height = 900 }
        @{ id = '1920x1080'; width = 1920; height = 1080 }
    )
    for ($i = 0; $i -lt 2; $i++) {
        $viewport = $viewportList[$i]
        if ($viewport -isnot [System.Collections.IDictionary]) {
            New-DesignGateError -Code 'policy.wrong_type' -Message 'each viewport must be an object.'
        }
        foreach ($key in @($viewport.Keys)) {
            if ($key -notin @('id', 'width', 'height')) {
                New-DesignGateError -Code 'policy.unknown_key' -Message "unknown viewport key '$key'."
            }
        }
        foreach ($required in @('id', 'width', 'height')) {
            if (-not $viewport.ContainsKey($required)) {
                New-DesignGateError -Code 'policy.missing_key' -Message "viewport missing '$required'."
            }
        }
        Test-DesignGateClosedString -Node $viewport['id'] -Pointer "engineering.viewports[$i].id" -Expected $expectedViewports[$i].id
        Test-DesignGateClosedNumber -Node $viewport['width'] -Pointer "engineering.viewports[$i].width" -Expected $expectedViewports[$i].width
        Test-DesignGateClosedNumber -Node $viewport['height'] -Pointer "engineering.viewports[$i].height" -Expected $expectedViewports[$i].height
    }

    $eligibility = $document['full_completion_eligibility']
    if ($eligibility -isnot [System.Collections.IDictionary]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'full_completion_eligibility must be an object.'
    }
    $eligibilityKeys = @(
        'allow_when_any_route_is_reference_missing',
        'allow_when_routes_without_approved_pixel_reference_nonempty'
    )
    foreach ($key in @($eligibility.Keys)) {
        if ($key -eq 'policy_digest') {
            New-DesignGateError -Code 'policy.digest_forbidden' -Message 'policy_digest is forbidden on full_completion_eligibility.'
        }
        if ($key -notin $eligibilityKeys) {
            New-DesignGateError -Code 'policy.unknown_key' -Message "unknown full_completion_eligibility key '$key'."
        }
    }
    foreach ($required in $eligibilityKeys) {
        if (-not $eligibility.ContainsKey($required)) {
            New-DesignGateError -Code 'policy.missing_key' -Message "full_completion_eligibility missing '$required'."
        }
        Test-DesignGateClosedBool -Node $eligibility[$required] -Pointer "full_completion_eligibility.$required" -Expected $false
    }

    if (-not (Test-Path -LiteralPath $SchemaPath -PathType Leaf)) {
        New-DesignGateError -Code 'policy.missing' -Message "schema file is absent: $SchemaPath"
    }
    if (-not ($raw | Test-Json -SchemaFile $SchemaPath -ErrorAction SilentlyContinue)) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "policy does not satisfy closed schema $SchemaPath"
    }

    return ($raw | ConvertFrom-Json)
}
