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
$script:predecessorFenceStreams = $null
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
Assert-True ($text -match '\[System\.IO\.Directory\]::Move\(\$trustedRoot, \$previousRoot\)' -and
    $text -match 'Restore-PreviousRuntime' -and
    $text -match 'blip-runtime-upgrade-transaction/v1') `
    'Production installer lacks journaled predecessor publication and deterministic rollback.'
Assert-True ($text -match "source_commit = '23489c37a54719df8e024e6f822b8b2e7179d4d8'" -and
    $text -match "manifest_sha256 = '7DE394C9E7695B996B20719B46D671D97C982659D868566A33C3C3A61252B0EE'") `
    'Production upgrade is not ratcheted to the exact installed predecessor tuple.'
Assert-True ($text -match 'Candidate source commit must advance beyond the exact allowed predecessor' -and
    $text -match 'Pattern = ''\^v1\\\.stage-'' \+ \$journalId \+ ''\$''') `
    'Production upgrade does not reject predecessor replay or cross-transaction journal paths.'
Assert-True ($text -match 'Move-PreservedRuntimeDirectories' -and
    $text -notmatch 'Copy-PreservedTree') `
    'Production upgrade does not preserve mutable state by same-volume directory moves.'
Assert-True ($text -match '\[System\.IO\.FileShare\]::Delete') `
    'Production upgrade lacks a legacy-runtime read fence compatible with directory rename.'
Assert-True ($text -match 'Another protected runtime install or recovery transaction is active' -and
    $text -match '\[System\.IO\.FileShare\]::None') `
    'Production upgrade lacks a product-wide exclusive transaction lock.'
Assert-True ($text -match 'Protect-RuntimeTree' -and
    $text -notmatch 'Protect-Tree -LiteralPath \$stageRoot' -and
    $text -notmatch 'Protect-Tree -LiteralPath \$trustedRoot') `
    'Production upgrade can temporarily expose owner-only Codex login state.'
Assert-True ($text -match '\[System\.IO\.File\]::Move\(\$completionStagePath, \$completionPath\)\s+\$activationCommitted = \$true' -and
    $text -notmatch '\$previousPublished -and -not \$installCompleted' -and
    $text -match '\[System\.IO\.Directory\]::Exists\(\$previousRoot\)') `
    'Production upgrade can roll back an activated generation or trusts a volatile publish flag.'
Assert-True ($text -match 'target_manifest_sha256' -and
    $text -match 'target_candidate_freeze_sha256' -and
    $text -match "ValidateSet\('initial', 'upgrade'\)" -and
    $text -match '\[System\.IO\.File\]::Move\(\$completionStagePath, \$completionPath\)') `
    'Install/recovery journal is not target-bound or activation is not atomically published.'
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
Assert-True ($text -match "schema = 'blip-trusted-runtime-complete/v2'") `
    'Production installer no longer writes a post-verification completion marker.'
Assert-True ($text -match 'Incomplete published runtime was quarantined') `
    'Production installer no longer quarantines a failed post-publish runtime.'
Assert-True ($text -match 'New-OwnerOnlyFileSecurity[\s\S]+Assert-OwnerOnlyAcl -LiteralPaths @\(\$upgradeLockPath\)') `
    'Persistent upgrade lock is not created and verified with owner-only ACL.'
Assert-True ($text.Contains("'.upgrade-transaction-' + `$upgradeTransactionId + '.tmp'") -and
    $text -match 'New-OwnerOnlyFileSecurity[\s\S]+Flush\(\$true\)[\s\S]+\[System\.IO\.File\]::Move\(\$journalStagePath, \$upgradeTransactionPath\)' -and
    $text -match '\$journalStageCreated = \$true[\s\S]+if \(\$journalStageCreated -and -not \$journalPublished' -and
    $text -match 'try \{ \[System\.IO\.File\]::Delete\(\$journalStagePath\) \}[\s\S]+catch \{ \}' -and
    $text -match 'Assert-OwnerOnlyAcl -LiteralPaths @\(\$upgradeTransactionPath\)') `
    'Transaction journal is not atomically published with an owner-only ACL.'
Assert-True ($text -match 'function Protect-UpgradeJournalOwnerOnly[\s\S]+Assert-OwnerOnlyAcl[\s\S]+Assert-ProtectedAcl[\s\S]+Set-ExactFileSystemSecurity[\s\S]+New-OwnerOnlyFileSecurity[\s\S]+Assert-OwnerOnlyAcl') `
    'Legacy transaction journals are not migrated from the exact protected ACL to owner-only.'
Assert-True ($text -match '\(New-OwnerOnlyFileSecurity\)[\s\S]+Assert-OwnerOnlyAcl -LiteralPaths @\(\$completionStagePath\)[\s\S]+File\]::Move\(\$completionStagePath, \$completionPath\)[\s\S]+Protect-CompletionMarkerRuntimeReadable') `
    'Completion staging is not owner-only until atomic publication and ACL normalization.'
Assert-True ($text -match 'function Recover-CommittedUpgradeArchive[\s\S]+upgrade-complete-\[0-9a-f\][\s\S]+Assert-ActivationCommitMarker' -and
    $text -match 'if \(-not \[System\.IO\.File\]::Exists\(\$upgradeTransactionPath\)\)[\s\S]+Recover-CommittedUpgradeArchive') `
    'Post-archive committed recovery is not recognized for the same authorized candidate.'
Assert-True ($text -match 'function Protect-UpgradeArchiveOwnerOnly[\s\S]+Assert-OwnerOnlyAcl[\s\S]+Assert-ProtectedAcl[\s\S]+Set-ExactFileSystemSecurity' -and
    $text -match 'target_candidate_freeze_sha256 -ceq[\s\S]+Matching committed upgrade archive has an invalid predecessor tuple') `
    'Historical completion archives are not ACL-migrated and filtered before current predecessor validation.'
$mainFlowStart = $text.IndexOf('$freeze = $freezeText | ConvertFrom-Json', [StringComparison]::Ordinal)
$recoveryCallIndex = $text.IndexOf('$recoveryResult = Recover-InterruptedUpgrade', $mainFlowStart, [StringComparison]::Ordinal)
$runtimeOpenIndex = $text.IndexOf('$stream = Open-PinnedReadStream -LiteralPath $entry.Value', $mainFlowStart, [StringComparison]::Ordinal)
Assert-True ($mainFlowStart -ge 0 -and $recoveryCallIndex -gt $mainFlowStart -and
    $runtimeOpenIndex -gt $recoveryCallIndex) `
    'Apply flow validates mutable runtime inputs before processing an existing recovery journal.'
Assert-True ($text -match '-OperationOut \(\[ref\]\$recoveryOperation\)[\s\S]+Set-RecoveryAttemptMode[\s\S]+-UpgradeAttempted \(\[ref\]\$upgradeAttempted\)') `
    'Recovery errors can still lose the journal operation mode before outer catch handling.'
Assert-True ($text -match 'Directory\]::Exists\(\$journalFailed\)[\s\S]+Move-UpgradeJournal[\s\S]+already quarantined') `
    'Initial quarantine recovery is not idempotent after the directory move.'
Assert-True ($text -match "return \[pscustomobject\]@\{[\s\S]+Status = 'committed'[\s\S]+Operation = 'upgrade'" -and
    $text -match '\$recoveryResult = Recover-InterruptedUpgrade[\s\S]+recovery=committed[\s\S]+return') `
    'Committed runtime recovery does not return an observable successful installer result.'
Assert-True ($text -match "'scripts/lib/StructLog\.psm1'" -and
    $bootstrapText -match "'scripts/lib/StructLog\.psm1'" -and
    $bootstrapText -match 'Open-ExclusiveFrozenFile[\s\S]+StructLog module bytes differ from the immutable freeze' -and
    $text -match 'Write-InstallerStructWarning' -and
    $text -match 'Write-StructWarn' -and
    $text -match "Write-InstallerStructInformation -Event 'committed_recovery_completed'" -and
    $text -match 'Write-StructInfo') `
    'Upgrade/recovery warnings are not routed through the frozen canonical StructLog module.'
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
Assert-True ($skillText -match '\| candidate source files \| 13 \|' -and
    $skillText -match '\| bootstrap-context v3 fields \| 22 \|') `
    'Protected build/install README inventory counts are stale.'
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
    'Get-QuiesceDenyMask', 'New-QuiescedFileSecurity',
    'Set-ExactFileSystemSecurity', 'Assert-ProtectedAcl', 'Assert-OwnerOnlyAcl',
    'Protect-Tree', 'Protect-OwnerOnlyTree', 'Protect-RuntimeTree',
    'Assert-NoReparseTree', 'Assert-ExistingTrustedRuntime',
    'Open-PredecessorRuntimeFence', 'Close-PredecessorRuntimeFence',
    'Assert-SuccessorGenerationPivots',
    'Assert-QuiescedPredecessorFiles', 'Protect-QuiescedPredecessorRuntime',
    'Move-PreservedRuntimeDirectories',
    'Restore-PreviousRuntime', 'Write-ProtectedUpgradeJournal', 'Move-UpgradeJournal',
    'Protect-UpgradeJournalOwnerOnly', 'Set-RecoveryAttemptMode',
    'Protect-CompletionMarkerRuntimeReadable', 'Recover-CommittedUpgradeArchive',
    'Protect-UpgradeArchiveOwnerOnly',
    'Open-UpgradeLock', 'Recover-InterruptedUpgrade',
    'Test-TargetActivationMarkerPublished',
    'Write-InstallerStructRecord', 'Write-InstallerStructWarning'
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
    $script:predecessorFenceStreams = [System.Collections.Generic.List[System.IO.FileStream]]::new()
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

    $upgradeOld = Join-Path $sandboxRoot 'upgrade-old'
    $upgradeStage = Join-Path $sandboxRoot 'upgrade-stage'
    foreach ($path in @(
        (Join-Path $upgradeOld 'state\nested'),
        (Join-Path $upgradeOld 'codex-home'),
        (Join-Path $upgradeOld 'artifacts'),
        $upgradeStage
    )) {
        [void][System.IO.Directory]::CreateDirectory($path)
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $upgradeOld 'state\nested\result.json'), 'state-bytes'
    )
    [System.IO.File]::WriteAllText(
        (Join-Path $upgradeOld 'codex-home\auth.json'), 'owner-login-bytes'
    )
    [System.IO.File]::WriteAllText(
        (Join-Path $upgradeOld 'artifacts\review.json'), 'artifact-bytes'
    )
    Move-PreservedRuntimeDirectories -SourceRoot $upgradeOld -DestinationRoot $upgradeStage
    Assert-True (
        [System.IO.File]::ReadAllText(
            (Join-Path $upgradeStage 'state\nested\result.json')
        ) -ceq 'state-bytes'
    ) 'Upgrade did not byte-preserve state by directory move.'
    Assert-True (
        [System.IO.File]::ReadAllText(
            (Join-Path $upgradeStage 'codex-home\auth.json')
        ) -ceq 'owner-login-bytes'
    ) 'Upgrade did not byte-preserve owner-only Codex login state.'
    Protect-RuntimeTree -LiteralPath $upgradeStage
    Assert-OwnerOnlyAcl -LiteralPaths @(
        (Join-Path $upgradeStage 'codex-home'),
        (Join-Path $upgradeStage 'codex-home\auth.json')
    )
    $upgradeTrusted = Join-Path $sandboxRoot 'upgrade-trusted'
    $upgradeFailed = Join-Path $sandboxRoot 'upgrade-failed'
    $missingStage = Join-Path $sandboxRoot 'upgrade-stage-missing'
    [System.IO.Directory]::Move($upgradeStage, $upgradeTrusted)
    Restore-PreviousRuntime -Trusted $upgradeTrusted -Previous $upgradeOld `
        -Failed $upgradeFailed -Stage $missingStage
    Assert-True (
        [System.IO.File]::ReadAllText(
            (Join-Path $upgradeTrusted 'state\nested\result.json')
        ) -ceq 'state-bytes' -and
        [System.IO.File]::ReadAllText(
            (Join-Path $upgradeTrusted 'codex-home\auth.json')
        ) -ceq 'owner-login-bytes' -and
        [System.IO.Directory]::Exists($upgradeFailed)
    ) 'Upgrade rollback did not restore the predecessor and its mutable directories.'

    $fenceRoot = Join-Path $sandboxRoot 'fence-runtime'
    [void][System.IO.Directory]::CreateDirectory($fenceRoot)
    foreach ($name in @('manifest.json', 'install-complete.json', 'wrapper.ps1')) {
        [System.IO.File]::WriteAllText((Join-Path $fenceRoot $name), $name)
    }
    $script:trustedRoot = $fenceRoot
    $fenceManifest = [pscustomobject]@{
        files = [pscustomobject]@{ 'wrapper.ps1' = ('A' * 64) }
        runtime = [pscustomobject]@{}
    }
    $activeReader = [System.IO.FileStream]::new(
        (Join-Path $fenceRoot 'manifest.json'), [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read
    )
    $activeRejected = $false
    try { Open-PredecessorRuntimeFence -Manifest $fenceManifest }
    catch [System.IO.IOException] { $activeRejected = $true }
    finally {
        $activeReader.Dispose()
        Close-PredecessorRuntimeFence
    }
    Assert-True $activeRejected 'Legacy runtime fence did not reject an active operation.'
    Open-PredecessorRuntimeFence -Manifest $fenceManifest
    $newReaderRejected = $false
    try {
        $unexpectedReader = [System.IO.FileStream]::new(
            (Join-Path $fenceRoot 'wrapper.ps1'), [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read
        )
        $unexpectedReader.Dispose()
    }
    catch [System.IO.IOException] { $newReaderRejected = $true }
    Assert-True $newReaderRejected 'Legacy runtime fence allowed a new runtime reader.'
    Protect-QuiescedPredecessorRuntime
    Close-PredecessorRuntimeFence
    $postFenceReaderRejected = $false
    try {
        $unexpectedReader = [System.IO.FileStream]::new(
            (Join-Path $fenceRoot 'wrapper.ps1'), [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read
        )
        $unexpectedReader.Dispose()
    }
    catch [System.UnauthorizedAccessException] { $postFenceReaderRejected = $true }
    Assert-True $postFenceReaderRejected `
        'Quiesced predecessor became readable after the fence handles were released.'
    $fenceMoved = Join-Path $sandboxRoot 'fence-runtime-moved'
    [System.IO.Directory]::Move($fenceRoot, $fenceMoved)
    Assert-True ([System.IO.Directory]::Exists($fenceMoved)) `
        'Quiesced legacy runtime did not permit same-volume directory rename.'
    Protect-Tree -LiteralPath $fenceMoved

    $script:upgradeLockPath = Join-Path $sandboxRoot 'upgrade.lock'
    $script:upgradeLockStream = $null
    $legacyLockStream = [System.IO.FileSystemAclExtensions]::Create(
        [System.IO.FileInfo]::new($script:upgradeLockPath),
        [System.IO.FileMode]::CreateNew,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough,
        (New-ProtectedFileSecurity)
    )
    $legacyLockStream.Dispose()
    Assert-ProtectedAcl -LiteralPaths @($script:upgradeLockPath)
    Open-UpgradeLock
    Assert-OwnerOnlyAcl -LiteralPaths @($script:upgradeLockPath)
    $parallelInstallerRejected = $false
    try {
        $unexpectedLock = [System.IO.FileStream]::new(
            $script:upgradeLockPath, [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None
        )
        $unexpectedLock.Dispose()
    }
    catch [System.IO.IOException] { $parallelInstallerRejected = $true }
    Assert-True $parallelInstallerRejected `
        'Protected upgrade lock allowed a concurrent installer transaction.'
    $script:upgradeLockStream.Dispose()
    $script:upgradeLockStream = $null

    $legacyJournal = Join-Path $sandboxRoot 'legacy-upgrade-transaction.json'
    $legacyJournalStream = [System.IO.FileSystemAclExtensions]::Create(
        [System.IO.FileInfo]::new($legacyJournal),
        [System.IO.FileMode]::CreateNew,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough,
        (New-ProtectedFileSecurity)
    )
    $legacyJournalStream.Dispose()
    Assert-ProtectedAcl -LiteralPaths @($legacyJournal)
    $script:upgradeTransactionPath = $legacyJournal
    Protect-UpgradeJournalOwnerOnly
    Assert-OwnerOnlyAcl -LiteralPaths @($legacyJournal)

    $upgradeMode = $false
    Set-RecoveryAttemptMode -Operation upgrade -UpgradeAttempted ([ref]$upgradeMode)
    Assert-True $upgradeMode 'Recovery error handling did not retain upgrade mode.'
    $initialMode = $false
    Set-RecoveryAttemptMode -Operation initial -UpgradeAttempted ([ref]$initialMode)
    Assert-True (-not $initialMode) 'Initial recovery was incorrectly reported as upgrade mode.'

    $completionAclRoot = Join-Path $sandboxRoot 'completion-acl'
    [void][System.IO.Directory]::CreateDirectory($completionAclRoot)
    $script:completionPath = Join-Path $completionAclRoot 'install-complete.json'
    $completionAclStream = [System.IO.FileSystemAclExtensions]::Create(
        [System.IO.FileInfo]::new($script:completionPath),
        [System.IO.FileMode]::CreateNew,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough,
        (New-OwnerOnlyFileSecurity)
    )
    $completionAclStream.Dispose()
    Assert-OwnerOnlyAcl -LiteralPaths @($script:completionPath)
    Protect-CompletionMarkerRuntimeReadable
    Assert-ProtectedAcl -LiteralPaths @($script:completionPath)

    $legacyArchivePath = Join-Path $completionAclRoot (
        'upgrade-complete-' + ([Guid]::NewGuid().ToString('N')) + '.json'
    )
    $legacyArchiveStream = [System.IO.FileSystemAclExtensions]::Create(
        [System.IO.FileInfo]::new($legacyArchivePath),
        [System.IO.FileMode]::CreateNew,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough,
        (New-ProtectedFileSecurity)
    )
    $legacyArchiveStream.Dispose()
    Assert-ProtectedAcl -LiteralPaths @($legacyArchivePath)
    Protect-UpgradeArchiveOwnerOnly -LiteralPath $legacyArchivePath
    Assert-OwnerOnlyAcl -LiteralPaths @($legacyArchivePath)

    $journalRoot = Join-Path $sandboxRoot 'atomic-journal'
    [void][System.IO.Directory]::CreateDirectory($journalRoot)
    $script:productRoot = [System.IO.Path]::GetFullPath($journalRoot)
    $script:upgradeTransactionId = '0123456789abcdef0123456789abcdef'
    $script:trustedRoot = Join-Path $script:productRoot 'v1'
    $script:stageRoot = Join-Path $script:productRoot ("v1.stage-$($script:upgradeTransactionId)")
    $script:previousRoot = Join-Path $script:productRoot ("v1.previous-$($script:upgradeTransactionId)")
    $script:failedRoot = Join-Path $script:productRoot ("v1.failed-$($script:upgradeTransactionId)")
    $script:upgradeTransactionPath = Join-Path $script:productRoot 'upgrade-transaction.json'
    $script:allowedPredecessor = [ordered]@{ manifest_sha256 = ('A' * 64) }
    Write-ProtectedUpgradeJournal -Operation initial -TargetSourceCommit ('b' * 40) `
        -TargetManifestSha256 ('C' * 64) -TargetCandidateFreezeSha256 ('D' * 64)
    $journalStagePath = Join-Path $script:productRoot (
        ".upgrade-transaction-$($script:upgradeTransactionId).tmp"
    )
    Assert-True ([System.IO.File]::Exists($script:upgradeTransactionPath) -and
        -not [System.IO.File]::Exists($journalStagePath)) `
        'Journal publication left a partial active path or retained its temporary file.'
    Assert-OwnerOnlyAcl -LiteralPaths @($script:upgradeTransactionPath)
    $publishedJournal = [System.IO.File]::ReadAllText($script:upgradeTransactionPath)
    $duplicatePublishRejected = $false
    try {
        Write-ProtectedUpgradeJournal -Operation initial -TargetSourceCommit ('e' * 40) `
            -TargetManifestSha256 ('F' * 64) -TargetCandidateFreezeSha256 ('1' * 64)
    }
    catch [System.IO.IOException] { $duplicatePublishRejected = $true }
    Assert-True ($duplicatePublishRejected -and
        [System.IO.File]::ReadAllText($script:upgradeTransactionPath) -ceq $publishedJournal -and
        -not [System.IO.File]::Exists($journalStagePath)) `
        'Atomic journal publish overwrote the active journal or retained a failed temporary file.'
    [System.IO.File]::WriteAllText($journalStagePath, 'pre-existing-stage')
    $preExistingStageRejected = $false
    try {
        Write-ProtectedUpgradeJournal -Operation initial -TargetSourceCommit ('e' * 40) `
            -TargetManifestSha256 ('F' * 64) -TargetCandidateFreezeSha256 ('1' * 64)
    }
    catch [System.IO.IOException] { $preExistingStageRejected = $true }
    Assert-True ($preExistingStageRejected -and
        [System.IO.File]::ReadAllText($journalStagePath) -ceq 'pre-existing-stage') `
        'Failed journal creation deleted a temporary file not created by this transaction.'
    Remove-Item -LiteralPath $journalStagePath -Force

    $script:installerStructLogger = $null
    $script:productRoot = $sandboxRoot
    $script:candidateRoot = $sandboxRoot
    $script:upgradeTransactionId = 'logger-failure-regression'
    function New-StructLogger { throw 'injected_struct_logger_failure' }
    $loggingFailureMaskedPrimaryFlow = $false
    try {
        Write-InstallerStructWarning -Event 'test_event' -Message 'primary recovery warning' `
            -WarningAction SilentlyContinue
        $loggingFailureMaskedPrimaryFlow = $false
    }
    catch { $loggingFailureMaskedPrimaryFlow = $true }
    finally { Remove-Item -LiteralPath Function:\New-StructLogger -Force }
    Assert-True (-not $loggingFailureMaskedPrimaryFlow) `
        'Structured logger initialization failure escaped and could mask the primary install error.'

    $recoveryProductRoot = Join-Path $sandboxRoot 'committed-recovery'
    $recoveryId = [Guid]::NewGuid().ToString('N')
    $script:productRoot = [System.IO.Path]::GetFullPath($recoveryProductRoot)
    $script:trustedRoot = Join-Path $script:productRoot 'v1'
    $script:upgradeTransactionPath = Join-Path $script:productRoot 'upgrade-transaction.json'
    $committedTransactionPath = $script:upgradeTransactionPath
    $recoveryArchive = Join-Path $script:productRoot ("upgrade-recovered-$recoveryId.json")
    $script:allowedPredecessor = [ordered]@{ manifest_sha256 = ('A' * 64) }
    $recoveryPrevious = Join-Path $script:productRoot ("v1.previous-$recoveryId")
    $recoveryStage = Join-Path $script:productRoot ("v1.stage-$recoveryId")
    $recoveryFailed = Join-Path $script:productRoot ("v1.failed-$recoveryId")
    New-Item -ItemType Directory -Path $script:trustedRoot, $recoveryPrevious | Out-Null
    Set-Content -LiteralPath (Join-Path $script:trustedRoot 'install-complete.json') `
        -Value '{}' -NoNewline
    [ordered]@{
        schema = 'blip-runtime-upgrade-transaction/v1'
        transaction_id = $recoveryId
        operation = 'upgrade'
        trusted_root = $script:trustedRoot
        stage_root = $recoveryStage
        previous_root = $recoveryPrevious
        failed_root = $recoveryFailed
        predecessor_manifest_sha256 = $script:allowedPredecessor.manifest_sha256
        target_source_commit = ('b' * 40)
        target_manifest_sha256 = ('C' * 64)
        target_candidate_freeze_sha256 = ('D' * 64)
        created_at = '2026-09-04T00:00:00.000Z'
    } | ConvertTo-Json | Set-Content -LiteralPath $script:upgradeTransactionPath -NoNewline
    $originalAssertProtectedAcl = (Get-Command Assert-ProtectedAcl).ScriptBlock
    $originalAssertOwnerOnlyAcl = (Get-Command Assert-OwnerOnlyAcl).ScriptBlock
    $originalRestorePreviousRuntime = (Get-Command Restore-PreviousRuntime).ScriptBlock
    $originalProtectRuntimeTree = (Get-Command Protect-RuntimeTree).ScriptBlock
    $originalAssertExistingTrustedRuntime = (Get-Command Assert-ExistingTrustedRuntime).ScriptBlock
    function Assert-ProtectedAcl { param([string[]]$LiteralPaths) [void]$LiteralPaths }
    function Assert-OwnerOnlyAcl { param([string[]]$LiteralPaths) [void]$LiteralPaths }
    function Assert-ExactJsonProperties {
        param([object]$Object, [string[]]$ExpectedNames, [string]$Label)
        [void]$Object
        [void]$ExpectedNames
        [void]$Label
    }
    function Assert-ActivationCommitMarker {
        param(
            [string]$ExpectedSourceCommit,
            [string]$ExpectedManifestSha256,
            [string]$ExpectedCandidateFreezeSha256
        )
        [void]$ExpectedSourceCommit
        [void]$ExpectedManifestSha256
        [void]$ExpectedCandidateFreezeSha256
    }
    function Move-UpgradeJournal {
        param([Parameter(Mandatory)][string]$Destination)
        [System.IO.File]::Move($script:upgradeTransactionPath, $Destination)
    }
    try {
        $committedRecovery = Recover-InterruptedUpgrade `
            -ExpectedTargetSourceCommit ('b' * 40) `
            -ExpectedTargetCandidateFreezeSha256 ('D' * 64)
        $archivedId = [Guid]::NewGuid().ToString('N')
        $script:productRoot = [System.IO.Path]::GetFullPath(
            (Join-Path $sandboxRoot 'post-archive-recovery')
        )
        $script:trustedRoot = Join-Path $script:productRoot 'v1'
        $script:completionPath = Join-Path $script:trustedRoot 'install-complete.json'
        $script:upgradeTransactionPath = Join-Path $script:productRoot 'upgrade-transaction.json'
        $archivedPrevious = Join-Path $script:productRoot ("v1.previous-$archivedId")
        New-Item -ItemType Directory -Path $script:productRoot, $script:trustedRoot | Out-Null
        $historicalId = [Guid]::NewGuid().ToString('N')
        [ordered]@{
            schema = 'blip-runtime-upgrade-transaction/v1'
            transaction_id = $historicalId
            operation = 'upgrade'
            trusted_root = $script:trustedRoot
            stage_root = Join-Path $script:productRoot ("v1.stage-$historicalId")
            previous_root = Join-Path $script:productRoot ("v1.previous-$historicalId")
            failed_root = Join-Path $script:productRoot ("v1.failed-$historicalId")
            predecessor_manifest_sha256 = ('B' * 64)
            target_source_commit = ('e' * 40)
            target_manifest_sha256 = ('F' * 64)
            target_candidate_freeze_sha256 = ('1' * 64)
            created_at = '2026-09-03T00:00:00.000Z'
        } | ConvertTo-Json | Set-Content -LiteralPath (
            Join-Path $script:productRoot "upgrade-complete-$historicalId.json"
        ) -NoNewline
        [ordered]@{
            schema = 'blip-runtime-upgrade-transaction/v1'
            transaction_id = $archivedId
            operation = 'upgrade'
            trusted_root = $script:trustedRoot
            stage_root = Join-Path $script:productRoot ("v1.stage-$archivedId")
            previous_root = $archivedPrevious
            failed_root = Join-Path $script:productRoot ("v1.failed-$archivedId")
            predecessor_manifest_sha256 = $script:allowedPredecessor.manifest_sha256
            target_source_commit = ('b' * 40)
            target_manifest_sha256 = ('C' * 64)
            target_candidate_freeze_sha256 = ('D' * 64)
            created_at = '2026-09-04T00:00:00.000Z'
        } | ConvertTo-Json | Set-Content -LiteralPath (
            Join-Path $script:productRoot "upgrade-complete-$archivedId.json"
        ) -NoNewline
        $archivedRecovery = Recover-InterruptedUpgrade `
            -ExpectedTargetSourceCommit ('b' * 40) `
            -ExpectedTargetCandidateFreezeSha256 ('D' * 64)
        Assert-True ($archivedRecovery.Status -ceq 'committed' -and
            $archivedRecovery.Operation -ceq 'upgrade' -and
            $archivedRecovery.PreviousRoot -ceq $archivedPrevious) `
            'Committed archive was not recognized after the active journal was removed.'
        foreach ($mismatchOperation in @('initial', 'upgrade')) {
            $mismatchId = [Guid]::NewGuid().ToString('N')
            $script:productRoot = [System.IO.Path]::GetFullPath(
                (Join-Path $sandboxRoot "mismatch-$mismatchOperation")
            )
            $script:trustedRoot = Join-Path $script:productRoot 'v1'
            $script:upgradeTransactionPath = Join-Path $script:productRoot 'upgrade-transaction.json'
            $mismatchPrevious = Join-Path $script:productRoot ("v1.previous-$mismatchId")
            $mismatchStage = Join-Path $script:productRoot ("v1.stage-$mismatchId")
            $mismatchFailed = Join-Path $script:productRoot ("v1.failed-$mismatchId")
            New-Item -ItemType Directory -Path $script:trustedRoot | Out-Null
            if ($mismatchOperation -ceq 'upgrade') {
                New-Item -ItemType Directory -Path $mismatchPrevious | Out-Null
            }
            Set-Content -LiteralPath (Join-Path $script:trustedRoot 'install-complete.json') `
                -Value '{}' -NoNewline
            [ordered]@{
                schema = 'blip-runtime-upgrade-transaction/v1'
                transaction_id = $mismatchId
                operation = $mismatchOperation
                trusted_root = $script:trustedRoot
                stage_root = $mismatchStage
                previous_root = $mismatchPrevious
                failed_root = $mismatchFailed
                predecessor_manifest_sha256 = if ($mismatchOperation -ceq 'upgrade') {
                    $script:allowedPredecessor.manifest_sha256
                }
                else { 'NONE' }
                target_source_commit = ('b' * 40)
                target_manifest_sha256 = ('C' * 64)
                target_candidate_freeze_sha256 = ('D' * 64)
                created_at = '2026-09-04T00:00:00.000Z'
            } | ConvertTo-Json | Set-Content `
                -LiteralPath $script:upgradeTransactionPath -NoNewline
            $mismatchRejected = $false
            try {
                [void](Recover-InterruptedUpgrade `
                    -ExpectedTargetSourceCommit ('e' * 40) `
                    -ExpectedTargetCandidateFreezeSha256 ('F' * 64))
            }
            catch {
                $mismatchRejected = $_.Exception.Message -match 'different candidate'
            }
            Assert-True $mismatchRejected `
                "Committed $mismatchOperation recovery accepted a different requested candidate."
            Assert-True (-not [System.IO.File]::Exists($script:upgradeTransactionPath) -and
                [System.IO.File]::Exists((Join-Path $script:productRoot ("upgrade-recovered-$mismatchId.json")))) `
                "Committed $mismatchOperation mismatch did not archive its journal."
        }

        $quarantineId = [Guid]::NewGuid().ToString('N')
        $script:productRoot = [System.IO.Path]::GetFullPath(
            (Join-Path $sandboxRoot 'initial-quarantine-idempotence')
        )
        $script:trustedRoot = Join-Path $script:productRoot 'v1'
        $script:upgradeTransactionPath = Join-Path $script:productRoot 'upgrade-transaction.json'
        $quarantineStage = Join-Path $script:productRoot ("v1.stage-$quarantineId")
        $quarantinePrevious = Join-Path $script:productRoot ("v1.previous-$quarantineId")
        $quarantineFailed = Join-Path $script:productRoot ("v1.failed-$quarantineId")
        New-Item -ItemType Directory -Path $script:productRoot, $quarantineFailed | Out-Null
        [ordered]@{
            schema = 'blip-runtime-upgrade-transaction/v1'
            transaction_id = $quarantineId
            operation = 'initial'
            trusted_root = $script:trustedRoot
            stage_root = $quarantineStage
            previous_root = $quarantinePrevious
            failed_root = $quarantineFailed
            predecessor_manifest_sha256 = 'NONE'
            target_source_commit = ('b' * 40)
            target_manifest_sha256 = ('C' * 64)
            target_candidate_freeze_sha256 = ('D' * 64)
            created_at = '2026-09-04T00:00:00.000Z'
        } | ConvertTo-Json | Set-Content -LiteralPath $script:upgradeTransactionPath -NoNewline
        $alreadyQuarantinedRejected = $false
        try {
            [void](Recover-InterruptedUpgrade `
                -ExpectedTargetSourceCommit ('b' * 40) `
                -ExpectedTargetCandidateFreezeSha256 ('D' * 64))
        }
        catch {
            $alreadyQuarantinedRejected = $_.Exception.Message -match 'already quarantined'
        }
        Assert-True ($alreadyQuarantinedRejected -and
            -not [System.IO.File]::Exists($script:upgradeTransactionPath) -and
            [System.IO.File]::Exists((Join-Path $script:productRoot ("upgrade-recovered-$quarantineId.json")))) `
            'Initial quarantine recovery was not idempotent after the directory move.'

        function Restore-PreviousRuntime {
            param([string]$Trusted, [string]$Previous, [string]$Failed, [string]$Stage)
            [void]$Trusted
            [void]$Previous
            [void]$Failed
            [void]$Stage
        }
        function Protect-RuntimeTree { param([string]$LiteralPath) [void]$LiteralPath }
        function Assert-ExistingTrustedRuntime { return [pscustomobject]@{} }
        $operationId = [Guid]::NewGuid().ToString('N')
        $script:productRoot = [System.IO.Path]::GetFullPath(
            (Join-Path $sandboxRoot 'recovery-operation-output')
        )
        $script:trustedRoot = Join-Path $script:productRoot 'v1'
        $script:upgradeTransactionPath = Join-Path $script:productRoot 'upgrade-transaction.json'
        $operationStage = Join-Path $script:productRoot ("v1.stage-$operationId")
        $operationPrevious = Join-Path $script:productRoot ("v1.previous-$operationId")
        $operationFailed = Join-Path $script:productRoot ("v1.failed-$operationId")
        New-Item -ItemType Directory -Path $script:productRoot, $operationPrevious | Out-Null
        [ordered]@{
            schema = 'blip-runtime-upgrade-transaction/v1'
            transaction_id = $operationId
            operation = 'upgrade'
            trusted_root = $script:trustedRoot
            stage_root = $operationStage
            previous_root = $operationPrevious
            failed_root = $operationFailed
            predecessor_manifest_sha256 = $script:allowedPredecessor.manifest_sha256
            target_source_commit = ('b' * 40)
            target_manifest_sha256 = ('C' * 64)
            target_candidate_freeze_sha256 = ('D' * 64)
            created_at = '2026-09-04T00:00:00.000Z'
        } | ConvertTo-Json | Set-Content -LiteralPath $script:upgradeTransactionPath -NoNewline
        $reportedOperation = ''
        $rollbackRetryRequested = $false
        try {
            [void](Recover-InterruptedUpgrade `
                -ExpectedTargetSourceCommit ('b' * 40) `
                -ExpectedTargetCandidateFreezeSha256 ('D' * 64) `
                -OperationOut ([ref]$reportedOperation))
        }
        catch {
            $rollbackRetryRequested = $_.Exception.Message -match 'rolled back'
        }
        Assert-True ($rollbackRetryRequested -and $reportedOperation -ceq 'upgrade') `
            'Recovery did not preserve upgrade mode for the outer error handler.'
    }
    finally {
        Set-Item -LiteralPath Function:\Assert-ProtectedAcl -Value $originalAssertProtectedAcl
        Set-Item -LiteralPath Function:\Assert-OwnerOnlyAcl -Value $originalAssertOwnerOnlyAcl
        Set-Item -LiteralPath Function:\Restore-PreviousRuntime -Value $originalRestorePreviousRuntime
        Set-Item -LiteralPath Function:\Protect-RuntimeTree -Value $originalProtectRuntimeTree
        Set-Item -LiteralPath Function:\Assert-ExistingTrustedRuntime -Value $originalAssertExistingTrustedRuntime
        Remove-Item -LiteralPath Function:\Assert-ExactJsonProperties -Force
        Remove-Item -LiteralPath Function:\Assert-ActivationCommitMarker -Force
        Remove-Item -LiteralPath Function:\Move-UpgradeJournal -Force
    }
    Assert-True ($committedRecovery.Status -ceq 'committed' -and
        $committedRecovery.Operation -ceq 'upgrade' -and
        $committedRecovery.PreviousRoot -ceq $recoveryPrevious) `
        'Committed upgrade recovery did not return observable success.'
    Assert-True (-not [System.IO.File]::Exists($committedTransactionPath) -and
        [System.IO.File]::Exists($recoveryArchive)) `
        'Committed upgrade recovery did not archive its journal.'

    $predecessorPivotHash = 'A' * 64
    $predecessorPivots = [pscustomobject]@{ files = [pscustomobject]@{
        'blip_review.py' = $predecessorPivotHash
        'run_codex_bound_ship_gate_once.ps1' = $predecessorPivotHash
    } }
    $successorPivots = [ordered]@{
        'blip_review.py' = ('B' * 64)
        'run_codex_bound_ship_gate_once.ps1' = ('C' * 64)
    }
    Assert-SuccessorGenerationPivots `
        -PredecessorManifest $predecessorPivots -SuccessorFileHashes $successorPivots
    $cachedPivotRejected = $false
    $successorPivots['blip_review.py'] = $predecessorPivotHash
    try {
        Assert-SuccessorGenerationPivots `
            -PredecessorManifest $predecessorPivots -SuccessorFileHashes $successorPivots
    }
    catch { $cachedPivotRejected = $true }
    Assert-True $cachedPivotRejected `
        'Upgrade accepted a successor that cannot stop a cached old User wrapper.'
    $successorPivots['blip_review.py'] = 'B' * 64
    $successorPivots['run_codex_bound_ship_gate_once.ps1'] = $predecessorPivotHash
    $cachedAppPivotRejected = $false
    try {
        Assert-SuccessorGenerationPivots `
            -PredecessorManifest $predecessorPivots -SuccessorFileHashes $successorPivots
    }
    catch { $cachedAppPivotRejected = $true }
    Assert-True $cachedAppPivotRejected `
        'Upgrade accepted a successor that cannot stop a cached old App wrapper.'

    $script:completionPath = Join-Path $sandboxRoot 'activation-commit.json'
    $script:previousRoot = Join-Path $sandboxRoot 'activation-previous'
    [System.IO.File]::WriteAllText($script:completionPath, 'fault-after-atomic-move')
    Assert-True (Test-TargetActivationMarkerPublished -IsUpgrade $false) `
        'Initial install would quarantine a target after its activation marker was published.'
    Assert-True (-not (Test-TargetActivationMarkerPublished -IsUpgrade $true)) `
        'Upgrade mistook the predecessor marker for a successor activation commit.'
    [void][System.IO.Directory]::CreateDirectory($script:previousRoot)
    Assert-True (Test-TargetActivationMarkerPublished -IsUpgrade $true) `
        'Upgrade would restore the predecessor after the successor activation marker was published.'

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
