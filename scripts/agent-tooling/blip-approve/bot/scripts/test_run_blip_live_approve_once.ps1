[CmdletBinding()]
param([switch]$SafeOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourceBroker = Join-Path $PSScriptRoot 'run_blip_live_approve_once.ps1'
$sourceHelper = Join-Path $PSScriptRoot 'blip_review.py'
$sourceAuth = Join-Path $PSScriptRoot 'app_auth.py'
$sourcePacket = Join-Path $PSScriptRoot 'ship_gate_packet.py'
$sandboxRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("blip-broker-test-" + [Guid]::NewGuid().ToString('N'))
$runtimeRoot = Join-Path $sandboxRoot 'runtime'
$stateRoot = Join-Path $runtimeRoot 'state'
$appScriptsRoot = Join-Path $runtimeRoot 'app-scripts'
$pythonPath = Join-Path $runtimeRoot 'test-python.cmd'

function Assert-True {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw $Message }
}

function Get-ProductionFunctions {
    param([Parameter(Mandatory)][string[]]$Names)
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $sourceBroker, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw 'Could not parse production broker for extracted regression.' }
    $definitions = @()
    foreach ($functionName in $Names) {
        $definition = $ast.Find(
            {
                param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                    $node.Name -ceq $functionName
            },
            $true
        )
        if ($null -eq $definition) { throw "Production $functionName function is unavailable." }
        $definitions += $definition.Extent.Text
    }
    return $definitions
}

function Invoke-StrictMetadataSchemaRegression {
    $definitions = Get-ProductionFunctions -Names @(
        'Get-UniqueRuntimeJsonProperty',
        'Assert-ExactRuntimeJsonProperties',
        'Assert-ExactRuntimeHashObject',
        'ConvertFrom-StrictRuntimeMetadata'
    )
    . ([ScriptBlock]::Create(($definitions -join "`n")))
    $fileHash = 'A' * 64
    $runtimeHash = 'B' * 64
    $freezeHash = 'C' * 64
    $manifestHash = 'D' * 64
    $validManifest = [ordered]@{
        schema = 'blip-trusted-runtime-manifest/v1'
        files = [ordered]@{ file = $fileHash }
        runtime = [ordered]@{ runtime = $runtimeHash }
        candidate_freeze_sha256 = $freezeHash
        activation = 'OWNER_PEM_AND_CODEX_LOGIN_REQUIRED'
        installed_at = '2026-08-14T00:00:00.0000000+08:00'
    } | ConvertTo-Json -Depth 4 -Compress
    $validCompletion = [ordered]@{
        schema = 'blip-trusted-runtime-complete/v1'
        owner_sid = 'S-1-5-21-test'
        candidate_freeze_sha256 = $freezeHash
        manifest_sha256 = $manifestHash
        completed_at = '2026-08-14T00:00:00.0000000+08:00'
    } | ConvertTo-Json -Depth 3 -Compress
    [void](ConvertFrom-StrictRuntimeMetadata `
        -ManifestText $validManifest -CompletionText $validCompletion `
        -ExpectedFileNames @('file') -ExpectedRuntimeNames @('runtime'))

    function Assert-MetadataRejected {
        param(
            [Parameter(Mandatory)][string]$ManifestText,
            [Parameter(Mandatory)][string]$CompletionText,
            [Parameter(Mandatory)][string]$Label
        )
        $rejected = $false
        try {
            [void](ConvertFrom-StrictRuntimeMetadata `
                -ManifestText $ManifestText -CompletionText $CompletionText `
                -ExpectedFileNames @('file') -ExpectedRuntimeNames @('runtime'))
        }
        catch { $rejected = $true }
        Assert-True $rejected "$Label runtime metadata was accepted."
    }

    $manifestUnknown = $validManifest.Substring(0, $validManifest.Length - 1) + ',"unknown":true}'
    $manifestDuplicate = $validManifest.Substring(0, $validManifest.Length - 1) +
        ',"schema":"blip-trusted-runtime-manifest/v1"}'
    $filesExact = '"files":{"file":"' + $fileHash + '"}'
    $filesUnknown = '"files":{"file":"' + $fileHash + '","unknown":"' + $fileHash + '"}'
    $filesDuplicate = '"files":{"file":"' + $fileHash + '","file":"' + $fileHash + '"}'
    Assert-MetadataRejected -ManifestText $manifestUnknown -CompletionText $validCompletion -Label 'unknown manifest property'
    Assert-MetadataRejected -ManifestText $manifestDuplicate -CompletionText $validCompletion -Label 'duplicate manifest property'
    Assert-MetadataRejected -ManifestText ($validManifest.Replace($filesExact, $filesUnknown)) `
        -CompletionText $validCompletion -Label 'unknown manifest files property'
    Assert-MetadataRejected -ManifestText ($validManifest.Replace($filesExact, $filesDuplicate)) `
        -CompletionText $validCompletion -Label 'duplicate manifest files property'
    Assert-MetadataRejected -ManifestText ($validManifest.Replace(',"installed_at":"2026-08-14T00:00:00.0000000+08:00"', '')) `
        -CompletionText $validCompletion -Label 'missing manifest property'
    $completionUnknown = $validCompletion.Substring(0, $validCompletion.Length - 1) + ',"unknown":true}'
    $completionDuplicate = $validCompletion.Substring(0, $validCompletion.Length - 1) +
        ',"schema":"blip-trusted-runtime-complete/v1"}'
    Assert-MetadataRejected -ManifestText $validManifest -CompletionText $completionUnknown -Label 'unknown completion property'
    Assert-MetadataRejected -ManifestText $validManifest -CompletionText $completionDuplicate -Label 'duplicate completion property'
    Write-Output 'strict-runtime-metadata-regression-ok'
}

function Invoke-ApprovalCapabilityTupleRegression {
    $definitions = Get-ProductionFunctions -Names @('New-ApprovalCapability')
    . ([ScriptBlock]::Create(($definitions -join "`n")))
    $capabilityVersion = 'blip-approval-capability/v2'
    $repository = 'monkey1sai/AI-BIM-governance'
    $PrNumber = 511
    $ExpectedBaseSha = 'c' * 40
    $ExpectedHeadSha = 'a' * 40
    $reviewer = 'monkey1sai-blip'
    $ReviewMode = 'human_critical'
    $HumanCriticalOverride = [System.Management.Automation.SwitchParameter]$true
    $tokenBytes = $null
    $capabilityBytes = $null
    $capabilityId = $null
    $raw = New-ApprovalCapability -Token 'opaque-test-token'
    $encoded = $raw.Split('.')[0].Replace('-', '+').Replace('_', '/')
    $encoded = $encoded.PadRight($encoded.Length + ((4 - ($encoded.Length % 4)) % 4), '=')
    $payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
    $fields = $payload.Split("`n")
    Assert-True ($fields.Count -eq 12) 'Capability v2 field count is not exact.'
    Assert-True ($fields[0] -ceq 'blip-approval-capability/v2') 'Capability version is not v2.'
    Assert-True ($fields[7] -ceq 'human_critical') 'Capability review mode is not exact.'
    Assert-True ($fields[8] -ceq 'human_critical_override=true') 'Capability override is not tuple-bound.'
    if ($null -ne $script:tokenBytes) {
        [Array]::Clear($script:tokenBytes, 0, $script:tokenBytes.Length)
    }
    if ($null -ne $script:capabilityBytes) {
        [Array]::Clear($script:capabilityBytes, 0, $script:capabilityBytes.Length)
    }
}

function Invoke-WrapperBootstrapRootRegression {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $sourceBroker, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw 'Could not parse production broker for root regression.' }
    $definition = $ast.Find(
        {
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                $node.Name -ceq 'Assert-WrapperBootstrapPath'
        },
        $true
    )
    if ($null -eq $definition) { throw 'Production wrapper root validator is unavailable.' }
    $expected = 'C:\Program Files\PowerShell\7\pwsh.exe'
    $escapedExpected = $expected.Replace("'", "''")
    $probe = [ScriptBlock]::Create(
        $definition.Extent.Text + "`nAssert-WrapperBootstrapPath -LiteralPath '$escapedExpected' -LeafMustBeFile"
    )
    $actual = & $probe
    Assert-True ($actual -ceq $expected) 'Wrapper rejected a valid path through the drive root.'
}

function Invoke-RealPythonTrustRegression {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $sourceBroker, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw 'Could not parse production broker for trust regression.' }
    $definitions = @{}
    foreach ($name in @('Assert-PinnedSystemExecutable', 'Assert-SystemProtectedProgramData')) {
        $definition = $ast.Find(
            {
                param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                    $node.Name -ceq $name
            },
            $true
        )
        if ($null -eq $definition) { throw "Production $name function is unavailable." }
        $definitions[$name] = $definition.Extent.Text
    }
    $probe = [ScriptBlock]::Create(
        $definitions['Assert-PinnedSystemExecutable'] + "`n" +
        $definitions['Assert-SystemProtectedProgramData'] + "`n" +
        "Assert-SystemProtectedProgramData`n" +
        "Assert-PinnedSystemExecutable -LiteralPath 'C:\Program Files\PowerShell\7\pwsh.exe' -ExpectedThumbprint '3F56A45111684D454E231CFDC4DA5C8D370F9816'`n" +
        "Assert-PinnedSystemExecutable -LiteralPath 'C:\Program Files\Python312\python.exe' -ExpectedThumbprint '36168EE17C1A240517388540C903BB6717DD2563'"
    )
    & $probe
}

function Set-TestProtectedAcl {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [switch]$OmitSandboxDeny
    )
    $current = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $sid = $current.User
    $isDirectory = Test-Path -LiteralPath $LiteralPath -PathType Container
    if ($isDirectory) {
        $acl = [System.Security.AccessControl.DirectorySecurity]::new()
        $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    else {
        $acl = [System.Security.AccessControl.FileSecurity]::new()
        $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
    }
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    $acl.AddAccessRule($rule)
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier])
    $writeMask = [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    $denyRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $sandboxSid,
        $writeMask,
        [System.Security.AccessControl.InheritanceFlags]::None,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Deny
    )
    if (-not $OmitSandboxDeny) { $acl.AddAccessRule($denyRule) }
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $sandboxSid,
        [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    ))
    Set-Acl -LiteralPath $LiteralPath -AclObject $acl
}

function Clear-StateRoot {
    if (Test-Path -LiteralPath $stateRoot) {
        Get-ChildItem -Force -LiteralPath $stateRoot | Remove-Item -Recurse -Force
        return
    }
    New-Item -ItemType Directory -Path $stateRoot | Out-Null
    Set-TestProtectedAcl -LiteralPath $stateRoot
}

function Write-Manifest {
    param(
        [Parameter(Mandatory)][bool]$ValidBrokerHash,
        [string]$BrokerPathOverride,
        [string]$AuthPathOverride
    )
    $manifestBrokerPath = if ([string]::IsNullOrWhiteSpace($BrokerPathOverride)) {
        Join-Path $runtimeRoot 'run_blip_live_approve_once.ps1'
    }
    else { $BrokerPathOverride }
    $manifestAuthPath = if ([string]::IsNullOrWhiteSpace($AuthPathOverride)) {
        Join-Path $runtimeRoot 'app_auth.py'
    }
    else { $AuthPathOverride }
    $brokerHash = if ($ValidBrokerHash) {
        (Get-FileHash -LiteralPath $manifestBrokerPath -Algorithm SHA256).Hash
    }
    else { '0' * 64 }
    $manifest = [ordered]@{
        schema = 'blip-trusted-runtime-manifest/v1'
        files = [ordered]@{
            'run_blip_live_approve_once.ps1' = $brokerHash
            'blip_review.py' = (Get-FileHash -LiteralPath (Join-Path $runtimeRoot 'blip_review.py') -Algorithm SHA256).Hash
            'app_auth.py' = (Get-FileHash -LiteralPath $manifestAuthPath -Algorithm SHA256).Hash
            'run_codex_bound_ship_gate_once.ps1' = '1' * 64
            'bind_ship_attestation.py' = '2' * 64
            'bots.json' = '3' * 64
            'app-scripts/collect_ship_gate_packet.py' = '4' * 64
            'app-scripts/codex_ship_gate.py' = '5' * 64
            'app-scripts/ship_gate_packet.py' = (Get-FileHash -LiteralPath (Join-Path $appScriptsRoot 'ship_gate_packet.py') -Algorithm SHA256).Hash
            'app-scripts/post_review.py' = '6' * 64
            'app-scripts/app_auth.py' = '7' * 64
        }
        runtime = [ordered]@{
            'runtime/pwsh.exe' = (Get-FileHash -LiteralPath 'C:\Program Files\PowerShell\7\pwsh.exe' -Algorithm SHA256).Hash
            'runtime/python.exe' = (Get-FileHash -LiteralPath $pythonPath -Algorithm SHA256).Hash
            'runtime/codex-package.json' = '1' * 64
            'runtime/bin/codex.exe' = '2' * 64
            'runtime/bin/codex-code-mode-host.exe' = '3' * 64
            'runtime/codex-path/rg.exe' = '4' * 64
            'runtime/codex-resources/codex-command-runner.exe' = '5' * 64
            'runtime/codex-resources/codex-windows-sandbox-setup.exe' = '6' * 64
            'runtime/psmodule/Microsoft.PowerShell.Management.psd1' = '8E46BAD04C1CFF740C317630160BDA1D82F5287EE42BCFEAC952A05D68998FA0'
            'runtime/psmodule/Microsoft.PowerShell.Security.psd1' = 'BD6B6DA1CE41C6F25C991148BCB14AE17EE216091AB4BAEB154E0C03993D886F'
            'runtime/psmodule/Security.types.ps1xml' = 'D438B0D9D1579DD9090AADEA18C34A3BDEDDD198951642E92521060473BF8998'
            'runtime/psmodule/Microsoft.PowerShell.Utility.psd1' = '0A19BF1917DFC626670EE86FFC6F9E3EDF00E2BED1A7CF4A05F29F3380A2A482'
            'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll' = '2ED60F0A518438E62ADD07BD70DF476D5A997F1C249D34C29F1A41E59251DF72'
            'runtime/psmodule/Microsoft.PowerShell.Security.dll' = 'C7088E44293774224BB2545D057BA11267EFFCF55CA7F80B2F1BD9DFBC914B82'
            'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll' = '1F02E95C5C3FE82723298AC594BD91439A0E1E0A3901581998B5A88D1A31A010'
        }
        candidate_freeze_sha256 = 'F' * 64
        activation = 'OWNER_PEM_AND_CODEX_LOGIN_REQUIRED'
        installed_at = '2026-08-12T00:00:00.0000000+08:00'
    }
    $manifestPath = Join-Path $runtimeRoot 'manifest.json'
    $manifestExists = Test-Path -LiteralPath $manifestPath
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
    if (-not $manifestExists) { Set-TestProtectedAcl -LiteralPath $manifestPath }
    Write-CompletionMarker
}

function Write-CompletionMarker {
    $manifestPath = Join-Path $runtimeRoot 'manifest.json'
    $completionPath = Join-Path $runtimeRoot 'install-complete.json'
    $completionExists = Test-Path -LiteralPath $completionPath
    [ordered]@{
        schema = 'blip-trusted-runtime-complete/v1'
        owner_sid = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
        candidate_freeze_sha256 = 'F' * 64
        manifest_sha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
        completed_at = '2026-08-12T00:00:00+08:00'
    } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $completionPath -Encoding utf8NoBOM
    if (-not $completionExists) { Set-TestProtectedAcl -LiteralPath $completionPath }
}

function Invoke-BrokerCase {
    param(
        [Parameter(Mandatory)][string]$MarkerMode,
        [Parameter(Mandatory)][bool]$ValidManifest,
        [Parameter(Mandatory)][int]$ExpectedExit,
        [Parameter(Mandatory)][string]$ExpectedStatus,
        [string]$ReviewMode = 'focused_semantic',
        [switch]$HumanCriticalOverride
    )
    Clear-StateRoot
    $fakePython = (@(
        '@echo off',
        "if `"$MarkerMode`"==`"valid`" (",
        '  echo [blip] APPROVAL_RESULT review_id=4242 state=APPROVED head=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa url=https://github.com/monkey1sai/AI-BIM-governance/pull/511#pullrequestreview-4242 automated=true',
        '  exit /b 0',
        ')',
        "if `"$MarkerMode`"==`"malformed`" (",
        '  echo [blip] helper exited without a validated marker',
        '  exit /b 0',
        ')',
        'echo fake child failure 1>&2',
        'exit /b 7'
    ) -join "`r`n")
    Set-Content -LiteralPath $pythonPath -Value $fakePython -Encoding utf8NoBOM
    Write-Manifest -ValidBrokerHash $ValidManifest
    $global:LASTEXITCODE = $null
    $invokeParameters = @{
        PrNumber = 511
        ExpectedBaseSha = 'c' * 40
        ExpectedHeadSha = 'a' * 40
        ReviewMode = $ReviewMode
    }
    if ($HumanCriticalOverride.IsPresent) { $invokeParameters.HumanCriticalOverride = $true }
    & (Join-Path $runtimeRoot 'run_blip_live_approve_once.ps1') @invokeParameters
    Assert-True ($LASTEXITCODE -eq $ExpectedExit) "Expected exit $ExpectedExit, got $LASTEXITCODE"
    $results = @(Get-ChildItem -LiteralPath $stateRoot -Filter 'blip-live-approve-pr511-*.json')
    Assert-True ($results.Count -eq 1) "Expected one result JSON, got $($results.Count)"
    $result = Get-Content -Raw -LiteralPath $results[0].FullName | ConvertFrom-Json
    Assert-True ($result.status -ceq $ExpectedStatus) "Expected status $ExpectedStatus, got $($result.status)"
    Assert-True ($result.stdout -notmatch 'opaque-test-token') 'Token leaked into stdout result'
    Assert-True ($result.stderr -notmatch 'opaque-test-token') 'Token leaked into stderr result'
    Assert-True ($result.review_mode -ceq $ReviewMode.ToLowerInvariant()) `
        'Review mode was not persisted canonically.'
    Assert-True (
        [bool]$result.human_critical_override -eq $HumanCriticalOverride.IsPresent
    ) 'Human-critical override was not persisted exactly.'
    return $result
}

try {
    Invoke-WrapperBootstrapRootRegression
    Invoke-StrictMetadataSchemaRegression
    Invoke-ApprovalCapabilityTupleRegression
    if ($SafeOnly) {
        $tokens = $null
        $errors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile(
            $sourceBroker, [ref]$tokens, [ref]$errors
        )
        Assert-True ($errors.Count -eq 0) 'Counted-approval wrapper does not parse.'
        $safeText = Get-Content -Raw -LiteralPath $sourceBroker
        Assert-True ($safeText -match "Read-Host -Prompt 'Enter BLIP_GITHUB_TOKEN' -AsSecureString") `
            'Counted-approval wrapper lost its masked replacement-token prompt.'
        Assert-True ($safeText -notmatch '(?i)gpt-|--model|CODEX_HOME') `
            'Counted-approval wrapper is no longer model-free.'
        Assert-True ($safeText -match "'--approve', '--live'") `
            'Counted-approval wrapper can no longer be proven approve-only.'
        Assert-True ($safeText -match "'--human-critical-override'") `
            'Counted-approval wrapper does not bind the human-critical override to the child CLI.'
        Assert-True ($safeText.Contains('secrets\blip-protection-attestation.v1.txt')) `
            'Counted-approval wrapper lost the owner protection attestation input.'
        Assert-True ($safeText.Contains('$startInfo.Environment[$protectionAttestationEnvironmentName] = $protectionAttestation')) `
            'Counted-approval wrapper no longer injects the owner protection attestation.'
        Write-Output 'broker-safe-tests-ok (parse, v2 tuple, masked prompt, model-free, approve-only, protection attestation)'
        return
    }

    $testIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $testSandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier]).Value
    if (@($testIdentity.Groups | ForEach-Object { $_.Value }) -contains $testSandboxSid) {
        throw 'This ACL integration test must run from the owner-controlled non-sandbox process.'
    }
    Invoke-RealPythonTrustRegression
    New-Item -ItemType Directory -Path $runtimeRoot, $stateRoot, $appScriptsRoot | Out-Null
    $attestationDir = Join-Path $sandboxRoot 'secrets'
    New-Item -ItemType Directory -Path $attestationDir | Out-Null
    $attestationPath = Join-Path $attestationDir 'blip-protection-attestation.v1.txt'
    Set-Content -LiteralPath $attestationPath -Value ('dGVzdA' + '.' + ('a' * 64)) -Encoding ascii
    $brokerText = Get-Content -Raw -LiteralPath $sourceBroker
    $pythonAssignment = "`$pythonPath = 'C:\Program Files\Python312\python.exe'"
    if ($brokerText.IndexOf($pythonAssignment, [StringComparison]::Ordinal) -lt 0) {
        throw 'Production broker fixed Python assignment changed; isolated harness cannot patch it safely.'
    }
    $brokerText = $brokerText.Replace($pythonAssignment, "`$pythonPath = Join-Path `$trustedRoot 'test-python.cmd'")
    $pythonTrustCall = @'
    Assert-PinnedSystemExecutable -LiteralPath $pythonPath `
        -ExpectedThumbprint '36168EE17C1A240517388540C903BB6717DD2563'
'@
    if ($brokerText.IndexOf($pythonTrustCall, [StringComparison]::Ordinal) -lt 0) {
        throw 'Production broker Python trust call changed; isolated harness cannot patch it safely.'
    }
    $brokerText = $brokerText.Replace($pythonTrustCall, '    # Isolated harness uses a generated fake child; production signer/ACL checks remain unchanged.')
    $promptBlock = @'
    $secureToken = Read-Host -Prompt 'Enter BLIP_GITHUB_TOKEN' -AsSecureString
    if ($null -eq $secureToken -or $secureToken.Length -eq 0) { throw 'No token was entered.' }
    $tokenBstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $plainToken = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenBstr)
    if ([string]::IsNullOrWhiteSpace($plainToken)) { throw 'No token was entered.' }
'@
    if ($brokerText.IndexOf($promptBlock, [StringComparison]::Ordinal) -lt 0) {
        throw 'Production broker token prompt changed; isolated harness cannot patch it safely.'
    }
    $brokerText = $brokerText.Replace($promptBlock, "    `$plainToken = 'opaque-test-token'`r`n")
    Set-Content -LiteralPath (Join-Path $runtimeRoot 'run_blip_live_approve_once.ps1') -Value $brokerText -Encoding utf8NoBOM
    Copy-Item -LiteralPath $sourceHelper -Destination (Join-Path $runtimeRoot 'blip_review.py')
    Copy-Item -LiteralPath $sourceAuth -Destination (Join-Path $runtimeRoot 'app_auth.py')
    Copy-Item -LiteralPath $sourcePacket -Destination (Join-Path $appScriptsRoot 'ship_gate_packet.py')
    $badAclPath = Join-Path $runtimeRoot 'bad-acl-auth.py'
    Copy-Item -LiteralPath $sourceAuth -Destination $badAclPath
    Set-TestProtectedAcl -LiteralPath $badAclPath -OmitSandboxDeny
    $badBrokerText = $brokerText.Replace(
        "`$authHelperPath = Join-Path `$trustedRoot 'app_auth.py'",
        "`$authHelperPath = Join-Path `$trustedRoot 'bad-acl-auth.py'"
    )
    $badBrokerPath = Join-Path $runtimeRoot 'bad-acl-broker.ps1'
    Set-Content -LiteralPath $badBrokerPath -Value $badBrokerText -Encoding utf8NoBOM
    Set-TestProtectedAcl -LiteralPath $badBrokerPath
    Set-Content -LiteralPath $pythonPath -Value '@echo off' -Encoding utf8NoBOM
    foreach ($path in @(
        $runtimeRoot,
        $stateRoot,
        $appScriptsRoot,
        $pythonPath,
        (Join-Path $runtimeRoot 'run_blip_live_approve_once.ps1'),
        (Join-Path $runtimeRoot 'blip_review.py'),
        (Join-Path $runtimeRoot 'app_auth.py'),
        (Join-Path $appScriptsRoot 'ship_gate_packet.py')
    )) { Set-TestProtectedAcl -LiteralPath $path }

    $valid = Invoke-BrokerCase -MarkerMode valid -ValidManifest $true -ExpectedExit 0 -ExpectedStatus approve_succeeded
    Assert-True ($valid.review_id -eq 4242) 'Validated marker review id was not persisted'
    Assert-True ($valid.expected_head_sha -ceq ('a' * 40)) 'Expected head was not persisted'

    $human = Invoke-BrokerCase -MarkerMode valid -ValidManifest $true `
        -ExpectedExit 0 -ExpectedStatus approve_succeeded `
        -ReviewMode human_critical -HumanCriticalOverride
    Assert-True ([bool]$human.human_critical_override) 'Human-critical override was not recorded.'

    $humanCasing = Invoke-BrokerCase -MarkerMode valid -ValidManifest $true `
        -ExpectedExit 0 -ExpectedStatus approve_succeeded `
        -ReviewMode HUMAN_CRITICAL -HumanCriticalOverride
    Assert-True ($humanCasing.review_mode -ceq 'human_critical') `
        'PowerShell/Python review-mode casing was not canonicalized.'

    $missingOverride = Invoke-BrokerCase -MarkerMode valid -ValidManifest $true `
        -ExpectedExit 1 -ExpectedStatus broker_failed -ReviewMode human_critical
    Assert-True ($missingOverride.stderr -match 'requires -HumanCriticalOverride') `
        'Human-critical mode without an override did not fail closed.'

    $machineOverride = Invoke-BrokerCase -MarkerMode valid -ValidManifest $true `
        -ExpectedExit 1 -ExpectedStatus broker_failed -HumanCriticalOverride
    Assert-True ($machineOverride.stderr -match 'forbidden for machine') `
        'Machine mode accepted a human-critical override.'

    $malformed = Invoke-BrokerCase -MarkerMode malformed -ValidManifest $true -ExpectedExit 1 -ExpectedStatus approve_failed
    Assert-True ($malformed.stderr -match 'required validated APPROVAL_RESULT marker') 'Malformed marker did not fail closed'

    $manifestFailure = Invoke-BrokerCase -MarkerMode valid -ValidManifest $false -ExpectedExit 1 -ExpectedStatus broker_failed
    Assert-True ($manifestFailure.stderr -match 'broker hash') 'Manifest mismatch did not fail before child execution'

    Rename-Item -LiteralPath $attestationPath -NewName 'blip-protection-attestation.v1.txt.bak'
    $missingAttestation = Invoke-BrokerCase -MarkerMode valid -ValidManifest $true -ExpectedExit 1 -ExpectedStatus broker_failed
    Assert-True ($missingAttestation.stderr -match 'protection attestation') `
        'Missing owner protection attestation did not fail closed before child execution'
    Rename-Item -LiteralPath ($attestationPath + '.bak') -NewName 'blip-protection-attestation.v1.txt'

    Set-Content -LiteralPath $attestationPath -Value 'not-an-attestation' -Encoding ascii
    $malformedAttestation = Invoke-BrokerCase -MarkerMode valid -ValidManifest $true -ExpectedExit 1 -ExpectedStatus broker_failed
    Assert-True ($malformedAttestation.stderr -match 'protection attestation is malformed') `
        'Malformed owner protection attestation did not fail closed before child execution'
    Set-Content -LiteralPath $attestationPath -Value ('dGVzdA' + '.' + ('a' * 64)) -Encoding ascii

    Clear-StateRoot
    Write-Manifest -ValidBrokerHash $true `
        -BrokerPathOverride $badBrokerPath -AuthPathOverride $badAclPath
    & $badBrokerPath -PrNumber 511 -ExpectedBaseSha ('c' * 40) `
        -ExpectedHeadSha ('a' * 40) -ReviewMode focused_semantic
    Assert-True ($LASTEXITCODE -eq 1) 'Missing sandbox deny ACL did not fail closed'
    $aclResult = Get-ChildItem -LiteralPath $stateRoot -Filter 'blip-live-approve-pr511-*.json' | Select-Object -First 1
    Assert-True ($null -ne $aclResult) 'Missing sandbox deny ACL did not write a broker failure result'
    $aclPayload = Get-Content -Raw -LiteralPath $aclResult.FullName | ConvertFrom-Json
    Assert-True ($aclPayload.stderr -match 'complete explicit write denial') 'Missing deny failure was not attributable'

    Write-Output 'broker-tests-ok (11 cases including v2 tuple, protection attestation, and real Python trust)'
}
finally {
    if (Test-Path -LiteralPath $sandboxRoot) { Remove-Item -LiteralPath $sandboxRoot -Recurse -Force }
}
