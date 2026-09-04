[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installerPath = Join-Path $PSScriptRoot 'install_blip_auto_approval.ps1'
$bootstrapPath = Join-Path $PSScriptRoot 'invoke_frozen_blip_installer.ps1'
$skillPath = Join-Path $PSScriptRoot 'README.md'
$readmePath = Join-Path $PSScriptRoot 'bot\README.md'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$workflowPath = Join-Path $repoRoot 'docs\agents\github-workflow.md'
$claudeSkillPath = Join-Path $repoRoot '.claude\skills\blip-approve\SKILL.md'
$codexSkillPath = Join-Path $repoRoot '.codex\skills\blip-approve\SKILL.md'
$userWrapperPath = Join-Path $PSScriptRoot 'bot\scripts\run_blip_live_approve_once.ps1'
$appWrapperPath = Join-Path $PSScriptRoot 'bot\scripts\run_codex_bound_ship_gate_once.ps1'
$sandboxRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    'blip-installer-test-' + [Guid]::NewGuid().ToString('N')
)
$script:pinnedStreams = $null
$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
$fixedOwnerSid = [System.Security.Principal.SecurityIdentifier]::new(
    $fixedOwnerSidValue
)

function Assert-True {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw $Message }
}

function Get-ProductionFunction {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.ScriptBlockAst]$Ast,
        [Parameter(Mandatory)][string]$Name
    )
    $node = $Ast.Find(
        {
            param($candidate)
            $candidate -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                $candidate.Name -ceq $Name
        },
        $true
    )
    if ($null -eq $node) { throw "Production installer function is unavailable: $Name" }
    return $node.Extent.Text
}

function Invoke-WrapperModuleHijackRegression {
    param(
        [Parameter(Mandatory)][string]$WrapperPath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$CaseName
    )
    $caseRoot = Join-Path $sandboxRoot ("module-hijack-$CaseName")
    $moduleRoot = Join-Path $caseRoot 'modules'
    $moduleDir = Join-Path $moduleRoot 'Microsoft.PowerShell.Management'
    $sentinel = Join-Path $caseRoot 'hijack-executed.txt'
    New-Item -ItemType Directory -Path $moduleDir -Force | Out-Null
    $escapedSentinel = $sentinel.Replace("'", "''")
    @"
[System.IO.File]::WriteAllText('$escapedSentinel', 'untrusted module executed')
throw 'untrusted Microsoft.PowerShell.Management module executed'
"@ | Set-Content -LiteralPath (
        Join-Path $moduleDir 'Microsoft.PowerShell.Management.psm1'
    ) -Encoding utf8NoBOM
    @"
@{
    RootModule = 'Microsoft.PowerShell.Management.psm1'
    ModuleVersion = '999.0.0'
    GUID = 'b1fd17f6-2e66-4b31-9f00-4cbec2091072'
    FunctionsToExport = @('Join-Path')
    CmdletsToExport = @()
    VariablesToExport = @()
    AliasesToExport = @()
}
"@ | Set-Content -LiteralPath (
        Join-Path $moduleDir 'Microsoft.PowerShell.Management.psd1'
    ) -Encoding utf8NoBOM

    $probeInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $probeInfo.FileName = 'C:\Program Files\PowerShell\7\pwsh.exe'
    $probeInfo.UseShellExecute = $false
    $probeInfo.CreateNoWindow = $true
    $probeInfo.RedirectStandardOutput = $true
    $probeInfo.RedirectStandardError = $true
    $escapedModuleRoot = $moduleRoot.Replace("'", "''")
    $probeCommand = "`$env:PSModulePath = '$escapedModuleRoot;' + `$env:PSModulePath; [void](Join-Path 'probe' 'child')"
    $probeEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probeCommand))
    foreach ($argument in @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $probeEncoded
    )) { [void]$probeInfo.ArgumentList.Add($argument) }
    $probe = [System.Diagnostics.Process]::new()
    $probe.StartInfo = $probeInfo
    try {
        if (-not $probe.Start()) { throw 'Could not start the module-hijack sensitivity probe.' }
        $probeStdout = $probe.StandardOutput.ReadToEndAsync().GetAwaiter().GetResult()
        $probeStderr = $probe.StandardError.ReadToEndAsync().GetAwaiter().GetResult()
        $probe.WaitForExit()
        $probeExitCode = $probe.ExitCode
    }
    finally { $probe.Dispose() }
    Assert-True (Test-Path -LiteralPath $sentinel) `
        ("The module-hijack regression fixture cannot trigger vulnerable Join-Path auto-loading. exit={0}; stdout={1}; stderr={2}" -f $probeExitCode, $probeStdout.Trim(), $probeStderr.Trim())
    Remove-Item -LiteralPath $sentinel -Force

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'C:\Program Files\PowerShell\7\pwsh.exe'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $escapedWrapperPath = $WrapperPath.Replace("'", "''")
    $renderedArguments = [System.Collections.Generic.List[string]]::new()
    for ($index = 0; $index -lt $Arguments.Count; $index += 2) {
        $parameterName = $Arguments[$index]
        $parameterValue = $Arguments[$index + 1].Replace("'", "''")
        $renderedArguments.Add("$parameterName '$parameterValue'")
    }
    $wrapperCommand = "`$env:PSModulePath = '$escapedModuleRoot;' + `$env:PSModulePath; & '$escapedWrapperPath' $($renderedArguments -join ' ')"
    $wrapperEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($wrapperCommand))
    foreach ($argument in @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $wrapperEncoded
    )) {
        [void]$startInfo.ArgumentList.Add($argument)
    }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw "Could not start $CaseName wrapper regression." }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(20000)) {
            $process.Kill($true)
            $process.WaitForExit()
            throw "$CaseName wrapper module-hijack regression timed out."
        }
        [void]$stdoutTask.GetAwaiter().GetResult()
        [void]$stderrTask.GetAwaiter().GetResult()
        Assert-True ($process.ExitCode -ne 0) `
            "$CaseName editable wrapper unexpectedly reached a successful live path."
        Assert-True (-not (Test-Path -LiteralPath $sentinel)) `
            "$CaseName wrapper executed an untrusted pre-validation PowerShell module."
    }
    finally { $process.Dispose() }
}

function Invoke-StrictFreezeSchemaRegression {
    param([Parameter(Mandatory)][System.Management.Automation.Language.ScriptBlockAst]$InstallerAst)
    $definitions = @(
        Get-ProductionFunction -Ast $InstallerAst -Name 'Get-UniqueJsonProperty'
        Get-ProductionFunction -Ast $InstallerAst -Name 'Assert-ExactJsonProperties'
        Get-ProductionFunction -Ast $InstallerAst -Name 'Assert-ExactHashObject'
    )
    . ([ScriptBlock]::Create(($definitions -join "`n")))
    $expected = @(
        'schema', 'build_profile', 'source_commit',
        'reviewed_build_manifest_sha256', 'external_verifier_sha256',
        'source_files', 'runtime_source'
    )
    $hash = 'A' * 64
    $valid = '{"schema":"blip-auto-approval-candidate-freeze/v3",' +
        '"build_profile":"PRODUCTION","source_commit":"' + ('a' * 40) + '",' +
        '"reviewed_build_manifest_sha256":"' + $hash + '",' +
        '"external_verifier_sha256":"' + $hash + '",' +
        '"source_files":{},"runtime_source":{}}'
    foreach ($case in @(
        @{ Json = $valid.Replace('"runtime_source":{}}', '"runtime_source":{},"extra":1}'); Label = 'unknown' },
        @{ Json = $valid.Replace('"source_commit":"' + ('a' * 40) + '",', ''); Label = 'missing' },
        @{ Json = $valid.Replace('{"schema":', '{"schema":"x","schema":'); Label = 'duplicate' }
    )) {
        $document = [System.Text.Json.JsonDocument]::Parse($case.Json)
        try {
            $rejected = $false
            try {
                Assert-ExactJsonProperties -Object $document.RootElement `
                    -ExpectedNames $expected -Label 'fixture'
            }
            catch { $rejected = $_.Exception.Message -match $case.Label }
            Assert-True $rejected "Strict freeze schema accepted $($case.Label) fields."
        }
        finally { $document.Dispose() }
    }
    $hashJson = '{"one":"' + ('A' * 64) + '"}'
    $hashDocument = [System.Text.Json.JsonDocument]::Parse($hashJson)
    try {
        Assert-ExactHashObject -Object $hashDocument.RootElement -ExpectedNames @('one') -Label 'hash fixture'
    }
    finally { $hashDocument.Dispose() }
    Write-Output 'strict-freeze-schema-regression-ok'
}

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $installerPath, [ref]$tokens, [ref]$errors
)
if ($errors.Count -ne 0) { throw 'Production installer does not parse.' }
$text = Get-Content -Raw -LiteralPath $installerPath
$bootstrapText = Get-Content -Raw -LiteralPath $bootstrapPath
Invoke-StrictFreezeSchemaRegression -InstallerAst $ast

Assert-True ($text -notmatch '(?im)^\s*Copy-Item\b') `
    'Production installer must never reopen frozen sources through Copy-Item.'
Assert-True ($text -notmatch '(?im)^\s*Set-Acl\b') `
    'Production installer must not route protected-tree DACL writes through Set-Acl.'
Assert-True ($text -match 'FileSystemAclExtensions\]::CreateDirectory') `
    'Production installer does not atomically create its protected directories with a DACL.'
Assert-True ($text -match '\[System\.IO\.Directory\]::Move\(\$stageRoot, \$trustedRoot\)') `
    'Production installer lacks the single atomic live-runtime publish.'
Assert-True ($text -match 'Trusted runtime v1 already exists; this initial installer never replaces it') `
    'Production installer no longer refuses in-place replacement.'
Assert-True ($text -match "ParameterSetName = 'Apply', Mandatory") `
    'Production Apply no longer requires an explicit immutable freeze hash.'
Assert-True ($text -match 'blip-auto-approval-candidate-freeze/v3') `
    'Production installer does not require the reviewed-provenance freeze v3 schema.'
Assert-True ($text -match 'ExpectedReviewedBuildManifestSha256' -and
    $text -match 'ReviewedBuildManifestStream') `
    'Production installer does not preserve the reviewed build manifest hash/stream binding.'
Assert-True ($text -match 'blip-installer-bootstrap-context/v3' -and
    $text -match 'InstallerLauncherPath' -and
    $text -match 'InstallerLauncherSha256' -and
    $text -match 'InstallerLauncherStream' -and
    $bootstrapText -match 'blip-installer-root-loader/v4') `
    'Production installer chain does not preserve the protected installer launcher provenance.'
Assert-True ($text -match 'Microsoft\.PowerShell\.Core\\Set-StrictMode' -and
    $bootstrapText -match 'Microsoft\.PowerShell\.Core\\Set-StrictMode' -and
    $bootstrapText -match "'Sort-Object' = 'Microsoft.PowerShell.Utility'" -and
    $bootstrapText -match "'Write-Output' = 'Microsoft.PowerShell.Utility'") `
    'Production installer command-resolution boundary is incomplete.'
Assert-True ($text -match '\(Get-OpenStreamSha256 -Stream \$reviewedManifestStream\) -cne[\s\S]+\$reviewedManifestElement\.GetString\(\)' -and
    $text -match '\$Apply -and \$reviewedManifestElement\.GetString\(\) -cne[\s\S]+\$ExpectedReviewedBuildManifestSha256') `
    'Production installer does not compare candidate manifest stream, freeze field, and Apply authority.'
Assert-True ($text -match 'verified in-memory bootstrap') `
    'Production Apply no longer refuses ordinary file-based execution.'
Assert-True ($text -match "fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'") `
    'Production installer no longer pins the immutable owner SID.'
Assert-True ($text -match "source_files\.PSObject\.Properties\['install_blip_auto_approval\.ps1'\]") `
    'Production Apply no longer binds the executing installer to the freeze.'
Assert-True ($text -match "schema = 'blip-trusted-runtime-complete/v1'") `
    'Production installer no longer writes a post-verification completion marker.'
Assert-True ($text -match 'Incomplete published runtime was quarantined') `
    'Production installer no longer quarantines a failed post-publish runtime.'
Assert-True ($text -match '\(\$Apply -and \$freezeVerifierSha256 -cne \$BootstrapContext\.VerifierSha256\)') `
    'Audit still dereferences a missing bootstrap verifier context.'
foreach ($moduleRuntimeKey in @(
    'runtime/psmodule/Microsoft.PowerShell.Management.psd1',
    'runtime/psmodule/Microsoft.PowerShell.Security.psd1',
    'runtime/psmodule/Security.types.ps1xml',
    'runtime/psmodule/Microsoft.PowerShell.Utility.psd1',
    'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll',
    'runtime/psmodule/Microsoft.PowerShell.Security.dll',
    'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll'
)) {
    Assert-True ($text.Contains("'$moduleRuntimeKey'")) `
        "Production installer does not freeze PowerShell dependency: $moduleRuntimeKey"
}
Assert-True ($text -match "StartsWith\('runtime/psmodule/'") `
    'PowerShell trust inputs would be copied into the installed Codex runtime.'

$skillText = Get-Content -Raw -LiteralPath $skillPath
$readmeText = Get-Content -Raw -LiteralPath $readmePath
$workflowText = Get-Content -Raw -LiteralPath $workflowPath
$claudeSkillText = Get-Content -Raw -LiteralPath $claudeSkillPath
$codexSkillText = Get-Content -Raw -LiteralPath $codexSkillPath
foreach ($document in @($skillText, $readmeText, $workflowText, $claudeSkillText, $codexSkillText)) {
    Assert-True ($document.Contains('C:\Users\IOT\.grok\github-bot\.env.blip')) `
        'A broker policy document lost the fixed counted-reviewer credential path.'
}
foreach ($document in @($claudeSkillText, $codexSkillText)) {
    Assert-True ($document -match '(?is)-NonInteractive\s+-File\s+[^\r\n]*(?<!test_)run_blip_live_approve_once\.ps1') `
        'A runbook skill no longer requires the non-interactive protected User broker.'
}
Assert-True ($skillText -match 'ACTIVATION.*HELD' -and
    $skillText -match 'live GitHub mutation' -and
    $skillText -match 'ProgramData') `
    'Package README does not preserve the explicit activation/live/install hold.'
Assert-True ($workflowText -match 'broker source package' -and $workflowText -match 'HELD') `
    'Repo workflow does not distinguish persisted source from held activation.'
Assert-True ($readmeText -notmatch 'sandbox 完全無存取') `
    'README still overstates runtime sandbox denial instead of RX/no-write.'
Assert-True ($workflowText -notmatch 'ProgramData root 對 sandbox 完全拒絕存取') `
    'Repo workflow still overstates runtime sandbox denial instead of RX/no-write.'

$functions = @(
    'Open-PinnedReadStream', 'Get-OpenStreamSha256', 'Copy-PinnedStream',
    'Get-SandboxSid', 'Assert-FixedOwnerIdentity', 'Get-ProtectedWriteMask',
    'New-ProtectedDirectorySecurity', 'New-ProtectedFileSecurity',
    'New-OwnerOnlyDirectorySecurity', 'New-OwnerOnlyFileSecurity',
    'Set-ExactFileSystemSecurity', 'Assert-ProtectedAcl', 'Assert-OwnerOnlyAcl',
    'Protect-Tree', 'Protect-OwnerOnlyTree'
) | ForEach-Object { Get-ProductionFunction -Ast $ast -Name $_ }
$probe = [ScriptBlock]::Create(($functions -join "`n"))

try {
    New-Item -ItemType Directory -Path $sandboxRoot | Out-Null
    Invoke-WrapperModuleHijackRegression -WrapperPath $userWrapperPath -CaseName 'user' -Arguments @(
        '-PrNumber', '511',
        '-ExpectedBaseSha', ('c' * 40),
        '-ExpectedHeadSha', ('a' * 40),
        '-ReviewMode', 'focused_semantic'
    )
    Invoke-WrapperModuleHijackRegression -WrapperPath $appWrapperPath -CaseName 'app' -Arguments @(
        '-PrNumber', '511', '-AgentTimeoutSec', '60', '-Jobs', '1'
    )
    $source = Join-Path $sandboxRoot 'source.bin'
    $target = Join-Path $sandboxRoot 'target.bin'
    [System.IO.File]::WriteAllBytes($source, [Text.Encoding]::UTF8.GetBytes('owner-approved-bytes'))
    $script:pinnedStreams = [System.Collections.Generic.List[System.IO.FileStream]]::new()
    . $probe

    $stream = Open-PinnedReadStream -LiteralPath $source
    $expected = Get-OpenStreamSha256 -Stream $stream
    $mutationBlocked = $false
    try { [System.IO.File]::WriteAllText($source, 'post-freeze replacement') }
    catch [System.IO.IOException] { $mutationBlocked = $true }
    Assert-True $mutationBlocked 'Pinned source remained writable after immutable preflight.'

    Copy-PinnedStream -Source $stream -Target $target -ExpectedSha256 $expected
    Assert-True (
        (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ceq $expected
    ) 'Copied bytes differ from the pinned source hash.'

    $badTarget = Join-Path $sandboxRoot 'bad-target.bin'
    $badHashRejected = $false
    try { Copy-PinnedStream -Source $stream -Target $badTarget -ExpectedSha256 ('0' * 64) }
    catch { $badHashRejected = $true }
    Assert-True $badHashRejected 'Staging accepted bytes outside the immutable freeze.'

    foreach ($open in $script:pinnedStreams) { $open.Dispose() }
    $script:pinnedStreams.Clear()

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $sandboxSid = Get-SandboxSid
    if (@($identity.Groups | ForEach-Object { $_.Value }) -contains $sandboxSid.Value) {
        Write-Output 'installer-owner-acl-test-skipped: current process is intentionally sandboxed'
    }
    else {
        $security = New-ProtectedDirectorySecurity
        $protected = Join-Path $sandboxRoot 'protected'
        [void][System.IO.FileSystemAclExtensions]::CreateDirectory($security, $protected)
        $acl = Get-Acl -LiteralPath $protected
        Assert-True $acl.AreAccessRulesProtected 'Atomic protected directory unexpectedly inherits ACLs.'
        $aclOwnerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        Assert-True (
            $aclOwnerSid -ceq 'S-1-5-21-2135046472-1977311562-3864793309-1001'
        ) 'Atomic protected directory is not owned by the immutable owner SID.'
        $denied = [System.Security.AccessControl.FileSystemRights]0
        $allowed = [System.Security.AccessControl.FileSystemRights]0
        $writeMask = Get-ProtectedWriteMask
        foreach ($rule in $acl.Access) {
            try {
                $sid = $rule.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch { continue }
            if ($sid -ceq $sandboxSid.Value -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                -not $rule.IsInherited) {
                $denied = $denied -bor
                    ($rule.FileSystemRights -band $writeMask)
            }
            if ($sid -ceq $sandboxSid.Value -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
                -not $rule.IsInherited) {
                $allowed = $allowed -bor $rule.FileSystemRights
            }
        }
        Assert-True (
            ($denied -band $writeMask) -eq $writeMask
        ) 'Atomic protected runtime directory lacks the complete sandbox write denial.'
        Assert-True (
            ($allowed -band [System.Security.AccessControl.FileSystemRights]::ReadAndExecute) -eq
                [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
        ) 'Atomic protected runtime directory lacks sandbox read/execute access.'

        $existingTree = Join-Path $sandboxRoot 'existing-tree'
        $existingChild = Join-Path $existingTree 'child'
        [IO.Directory]::CreateDirectory($existingChild) | Out-Null
        [IO.File]::WriteAllText((Join-Path $existingChild 'payload.txt'), 'payload')
        Protect-Tree -LiteralPath $existingTree
        Assert-ProtectedAcl -LiteralPaths @(
            $existingTree, $existingChild, (Join-Path $existingChild 'payload.txt')
        )

        $ownerOnly = Join-Path $sandboxRoot 'owner-only'
        [void][System.IO.FileSystemAclExtensions]::CreateDirectory(
            (New-OwnerOnlyDirectorySecurity), $ownerOnly
        )
        $ownerAcl = Get-Acl -LiteralPath $ownerOnly
        $ownerDenied = [System.Security.AccessControl.FileSystemRights]0
        foreach ($rule in $ownerAcl.Access) {
            try {
                $sid = $rule.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch { continue }
            if ($sid -ceq $sandboxSid.Value -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny) {
                $ownerDenied = $ownerDenied -bor $rule.FileSystemRights
            }
        }
        Assert-True (
            ($ownerDenied -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq
                [System.Security.AccessControl.FileSystemRights]::FullControl
        ) 'Owner-only credential directory lacks the complete sandbox denial.'

        $existingOwnerTree = Join-Path $sandboxRoot 'existing-owner-tree'
        [IO.Directory]::CreateDirectory($existingOwnerTree) | Out-Null
        [IO.File]::WriteAllText((Join-Path $existingOwnerTree 'credential.json'), '{}')
        Protect-OwnerOnlyTree -LiteralPath $existingOwnerTree
        Assert-OwnerOnlyAcl -LiteralPaths @(
            $existingOwnerTree, (Join-Path $existingOwnerTree 'credential.json')
        )
    }
    Write-Output 'installer-tests-ok (self-bound bootstrap contract, fixed owner-only env token docs, pinned source, runtime RX/no-write, owner-only credential ACL)'
}
finally {
    if ($null -ne $script:pinnedStreams) {
        foreach ($open in $script:pinnedStreams) { try { $open.Dispose() } catch { } }
    }
    if (Test-Path -LiteralPath $sandboxRoot) {
        try { Remove-Item -LiteralPath $sandboxRoot -Recurse -Force } catch { }
    }
}
