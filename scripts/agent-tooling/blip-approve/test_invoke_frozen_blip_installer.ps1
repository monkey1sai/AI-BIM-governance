[CmdletBinding()]
param([switch]$SafeOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$productionBootstrap = Join-Path $PSScriptRoot 'invoke_frozen_blip_installer.ps1'
$productionInstallerLauncher = Join-Path $PSScriptRoot 'invoke_protected_blip_installer_launcher.ps1'
$productionVerifier = Join-Path $PSScriptRoot 'invoke_protected_blip_installer.ps1'
$productionInstaller = Join-Path $PSScriptRoot 'install_blip_auto_approval.ps1'
$productionBuilder = Join-Path $PSScriptRoot 'build_blip_candidate.ps1'
$productionHarness = [System.IO.Path]::GetFullPath($PSCommandPath)
$sandboxRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    'blip-bootstrap-test-' + [Guid]::NewGuid().ToString('N')
)

function Assert-True {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw $Message }
}

function Get-AssignedLiteralStrings {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][string]$VariableName
    )
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $LiteralPath, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw "Production source does not parse: $LiteralPath" }
    $matches = @($ast.FindAll(
        {
            param($node)
            $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                $node.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
                $node.Left.VariablePath.UserPath -ceq $VariableName
        },
        $true
    ))
    if ($matches.Count -ne 1) {
        throw "Production source must assign exactly one literal inventory: $VariableName"
    }
    $values = @($matches[0].Right.FindAll(
        {
            param($node)
            $node -is [System.Management.Automation.Language.StringConstantExpressionAst]
        },
        $true
    ) | ForEach-Object { $_.Value })
    if ($values.Count -eq 0) { throw "Production inventory is empty: $VariableName" }
    return $values
}

function Assert-ExactStringSequence {
    param(
        [Parameter(Mandatory)][string[]]$Actual,
        [Parameter(Mandatory)][string[]]$Expected,
        [Parameter(Mandatory)][string]$Label
    )
    Assert-True ($Actual.Count -eq $Expected.Count) "$Label count drifted."
    for ($index = 0; $index -lt $Expected.Count; $index += 1) {
        Assert-True ($Actual[$index] -ceq $Expected[$index]) `
            "$Label differs at index $index."
    }
}

function Invoke-BootstrapSignerEnvironmentRegression {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $productionBootstrap, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw 'Production bootstrap does not parse.' }
    $definition = $ast.Find(
        {
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                $node.Name -ceq 'Set-BootstrapSafeEnvironment'
        },
        $true
    )
    if ($null -eq $definition) {
        throw 'Production bootstrap lacks a testable fixed safe-environment boundary.'
    }
    $probe = @"
`$ErrorActionPreference = 'Stop'
$($definition.Extent.Text)
Set-BootstrapSafeEnvironment
`$PSModuleAutoLoadingPreference = 'None'
Import-Module -Name 'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1' -Force -ErrorAction Stop
Import-Module -Name 'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -Force -ErrorAction Stop
`$signature = Get-AuthenticodeSignature -LiteralPath 'C:\Program Files\PowerShell\7\pwsh.exe'
if (`$signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
    `$null -eq `$signature.SignerCertificate -or
    `$signature.SignerCertificate.Thumbprint -cne '3F56A45111684D454E231CFDC4DA5C8D370F9816') {
    throw ('bootstrap_signature_status=' + [string]`$signature.Status)
}
'bootstrap-signer-environment-ok'
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probe))
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = 'C:\Program Files\PowerShell\7\pwsh.exe'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded
    )) { [void]$start.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Could not start bootstrap signer regression.' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) {
            $process.Kill($true)
            $process.WaitForExit()
            throw 'Bootstrap signer regression timed out.'
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0 -or
            $stdout -notmatch '(?m)^bootstrap-signer-environment-ok\s*$') {
            throw "Bootstrap signer regression failed: $stderr"
        }
    }
    finally { $process.Dispose() }
}

function Get-BytesSha256 {
    param([Parameter(Mandatory)][byte[]]$Bytes)
    return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($Bytes))
}

function Invoke-FreezeV3SchemaRegression {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $productionBootstrap, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw 'Production bootstrap does not parse for v3 regression.' }
    $expectedSourceFiles = @(
        'install_blip_auto_approval.ps1',
        'invoke_frozen_blip_installer.ps1',
        'bot/bots.json',
        'bot/scripts/app_auth.py',
        'bot/scripts/bind_ship_attestation.py',
        'bot/scripts/blip_review.py',
        'bot/scripts/codex_ship_gate.py',
        'bot/scripts/collect_ship_gate_packet.py',
        'bot/scripts/post_review.py',
        'bot/scripts/run_blip_live_approve_once.ps1',
        'bot/scripts/run_codex_bound_ship_gate_once.ps1',
        'bot/scripts/ship_gate_packet.py'
    )
    $expectedRuntimeKeys = @(
        'runtime/pwsh.exe',
        'runtime/python.exe',
        'runtime/codex-package.json',
        'runtime/bin/codex.exe',
        'runtime/bin/codex-code-mode-host.exe',
        'runtime/codex-path/rg.exe',
        'runtime/codex-resources/codex-command-runner.exe',
        'runtime/codex-resources/codex-windows-sandbox-setup.exe',
        'runtime/psmodule/Microsoft.PowerShell.Management.psd1',
        'runtime/psmodule/Microsoft.PowerShell.Security.psd1',
        'runtime/psmodule/Security.types.ps1xml',
        'runtime/psmodule/Microsoft.PowerShell.Utility.psd1',
        'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll',
        'runtime/psmodule/Microsoft.PowerShell.Security.dll',
        'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll'
    )
    # Authenticode signer binding is publisher provenance layered on the runtime_source
    # SHA-256 pins. Upstream ripgrep ('runtime/codex-path/rg.exe') ships unsigned, so it
    # is hash-pinned only; see build_blip_candidate.ps1 for the full rationale.
    $expectedSignerKeys = @(
        'runtime/pwsh.exe',
        'runtime/python.exe',
        'runtime/bin/codex.exe',
        'runtime/bin/codex-code-mode-host.exe',
        'runtime/codex-resources/codex-command-runner.exe',
        'runtime/codex-resources/codex-windows-sandbox-setup.exe',
        'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll',
        'runtime/psmodule/Microsoft.PowerShell.Security.dll',
        'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll'
    )
    foreach ($inventory in @(
        [pscustomobject]@{
            Path = $productionBuilder; Variable = 'sourceFiles'; Expected = $expectedSourceFiles
            Label = 'builder source inventory'
        },
        [pscustomobject]@{
            Path = $productionVerifier; Variable = 'reviewedSourceFiles'; Expected = $expectedSourceFiles
            Label = 'verifier source inventory'
        },
        [pscustomobject]@{
            Path = $productionBootstrap; Variable = 'reviewedSourceFiles'; Expected = $expectedSourceFiles
            Label = 'bootstrap source inventory'
        },
        [pscustomobject]@{
            Path = $productionHarness; Variable = 'sourceKeys'; Expected = $expectedSourceFiles
            Label = 'bootstrap fixture source inventory'
        },
        [pscustomobject]@{
            Path = $productionBuilder; Variable = 'runtimeKeys'; Expected = $expectedRuntimeKeys
            Label = 'builder runtime inventory'
        },
        [pscustomobject]@{
            Path = $productionVerifier; Variable = 'reviewedRuntimeKeys'; Expected = $expectedRuntimeKeys
            Label = 'verifier runtime inventory'
        },
        [pscustomobject]@{
            Path = $productionBootstrap; Variable = 'reviewedRuntimeKeys'; Expected = $expectedRuntimeKeys
            Label = 'bootstrap runtime inventory'
        },
        [pscustomobject]@{
            Path = $productionHarness; Variable = 'runtimeKeys'; Expected = $expectedRuntimeKeys
            Label = 'bootstrap fixture runtime inventory'
        },
        [pscustomobject]@{
            Path = $productionBuilder; Variable = 'runtimeSignerKeys'; Expected = $expectedSignerKeys
            Label = 'builder signer inventory'
        },
        [pscustomobject]@{
            Path = $productionVerifier; Variable = 'reviewedSignerKeys'; Expected = $expectedSignerKeys
            Label = 'verifier signer inventory'
        },
        [pscustomobject]@{
            Path = $productionBootstrap; Variable = 'reviewedSignerKeys'; Expected = $expectedSignerKeys
            Label = 'bootstrap signer inventory'
        },
        [pscustomobject]@{
            Path = $productionHarness; Variable = 'signerKeys'; Expected = $expectedSignerKeys
            Label = 'bootstrap fixture signer inventory'
        }
    )) {
        Assert-ExactStringSequence `
            -Actual @(Get-AssignedLiteralStrings `
                -LiteralPath $inventory.Path -VariableName $inventory.Variable) `
            -Expected $inventory.Expected -Label $inventory.Label
    }
    $definitions = foreach ($name in @(
        'Get-UniqueJsonProperty', 'Assert-ExactJsonProperties',
        'Assert-ExactReviewedMapMatchesFreeze',
        'Assert-ReviewedManifestMatchesFreeze',
        'Assert-InstallerCommandResolution'
    )) {
        $definition = $ast.Find(
            {
                param($candidate)
                $candidate -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                    $candidate.Name -ceq $name
            },
            $true
        )
        if ($null -eq $definition) { throw "Production bootstrap lacks helper: $name" }
        $definition.Extent.Text
    }
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
        [pscustomobject]@{ Label = 'unknown'; Json = $valid.Replace('"runtime_source":{}}', '"runtime_source":{},"extra":1}') },
        [pscustomobject]@{ Label = 'missing'; Json = $valid.Replace('"source_commit":"' + ('a' * 40) + '",', '') },
        [pscustomobject]@{ Label = 'duplicate'; Json = $valid.Replace('{"schema":', '{"schema":"duplicate","schema":') }
    )) {
        $document = [System.Text.Json.JsonDocument]::Parse($case.Json)
        try {
            $rejected = $false
            try {
                Assert-ExactJsonProperties -Object $document.RootElement `
                    -ExpectedNames $expected -Label 'Candidate freeze'
            }
            catch { $rejected = $true }
            Assert-True $rejected "Frozen bootstrap accepted $($case.Label) v3 fields."
        }
        finally { $document.Dispose() }
    }
    $bootstrapText = Get-Content -Raw -LiteralPath $productionBootstrap
    $launcherText = Get-Content -Raw -LiteralPath $productionInstallerLauncher
    $verifierText = Get-Content -Raw -LiteralPath $productionVerifier
    Assert-True ($bootstrapText -match 'blip-auto-approval-candidate-freeze/v3' -and
        $bootstrapText -notmatch 'blip-auto-approval-candidate-freeze/v2') `
        'Frozen bootstrap does not exclusively accept candidate freeze v3.'
    foreach ($required in @(
        'ExpectedReviewedBuildManifestSha256',
        'ReviewedBuildManifestSha256',
        'ReviewedBuildManifestStream'
    )) {
        Assert-True ($bootstrapText -match $required -and $verifierText -match $required) `
            "Protected installer chain is missing reviewed-manifest invariant: $required"
    }
    Assert-True ($bootstrapText -match 'reviewed_build_manifest_sha256') `
        'Frozen bootstrap does not bind the reviewed manifest hash from candidate freeze v3.'
    Assert-True ($verifierText -match 'Open-ExclusiveReadStream[\s\S]+reviewedManifestPath' -and
        $verifierText -match 'blip-installer-root-loader/v4') `
        'Outer verifier does not lock and forward the reviewed build manifest.'
    Assert-True ($launcherText -match "'-NoLogo', '-NoProfile', '-NonInteractive', '-File'" -and
        $launcherText -match 'Set-LauncherSafeEnvironment' -and
        $launcherText -match '\[ScriptBlock\]::Create\(\$verifierText\)' -and
        $launcherText -match 'InternalLauncherContext' -and
        $launcherText -match 'Assert-ExactLauncherCommandLine' -and
        $launcherText -notmatch "(?im)\bProcessStartInfo\b|\bStart-Process\b|\.Arguments\s*=|InternalCleanSession|'-Command'|'-EncodedCommand'") `
        'Public installer launcher does not execute pinned verifier bytes in its clean process.'
    Assert-True ($verifierText -match 'Assert-ExactLauncherProcessCommandLine' -and
        $verifierText -match 'Assert-InternalLauncherContext' -and
        $verifierText -match 'blip-installer-launcher-context/v1' -and
        $verifierText -match 'must be loaded from pinned bytes by the protected launcher' -and
        $verifierText -notmatch 'InternalCleanSession|Invoke-CleanVerifierProcess') `
        'Internal verifier still exposes a file-based or caller-forgeable launcher bypass.'
    Assert-True ($bootstrapText -match 'Microsoft\.PowerShell\.Core\\Set-StrictMode' -and
        (Get-Content -Raw -LiteralPath $productionInstaller) -match
            'Microsoft\.PowerShell\.Core\\Set-StrictMode') `
        'Installer trust chain does not module-qualify the pre-guard Set-StrictMode call.'

    $installerTokens = $null
    $installerErrors = $null
    $installerAst = [System.Management.Automation.Language.Parser]::ParseFile(
        $productionInstaller, [ref]$installerTokens, [ref]$installerErrors
    )
    if ($installerErrors.Count -ne 0) { throw 'Production installer does not parse for command guard.' }
    Assert-InstallerCommandResolution -InstallerAst $installerAst
    function Get-Acl { throw 'shadowed_get_acl_executed' }
    try {
        $shadowRejected = $false
        try { Assert-InstallerCommandResolution -InstallerAst $installerAst }
        catch { $shadowRejected = $_.Exception.Message -match 'shadowed or untrusted: Get-Acl' }
        Assert-True $shadowRejected 'Installer command-resolution guard accepted a shadowed Get-Acl function.'
    }
    finally { Remove-Item -LiteralPath Function:\Get-Acl -Force }
    function Sort-Object { throw 'shadowed_sort_object_executed' }
    try {
        $sortRejected = $false
        try { Assert-InstallerCommandResolution -InstallerAst $installerAst }
        catch { $sortRejected = $_.Exception.Message -match 'shadowed or untrusted: Sort-Object' }
        Assert-True $sortRejected 'Installer command-resolution guard accepted a shadowed Sort-Object function.'
    }
    finally { Remove-Item -LiteralPath Function:\Sort-Object -Force }
    $badTokens = $null
    $badErrors = $null
    $badAst = [System.Management.Automation.Language.Parser]::ParseInput(
        'Invoke-Expression ''untrusted''', [ref]$badTokens, [ref]$badErrors
    )
    $outsideContractRejected = $false
    try { Assert-InstallerCommandResolution -InstallerAst $badAst }
    catch { $outsideContractRejected = $_.Exception.Message -match 'outside the exact command contract' }
    Assert-True $outsideContractRejected `
        'Installer command-resolution guard accepted an unreviewed command AST.'

    $directInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $directInfo.FileName = 'C:\Program Files\PowerShell\7\pwsh.exe'
    $directInfo.UseShellExecute = $false
    $directInfo.CreateNoWindow = $true
    $directInfo.RedirectStandardOutput = $true
    $directInfo.RedirectStandardError = $true
    $directInfo.Environment.Clear()
    foreach ($argument in @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $productionVerifier,
        '-Apply', '-CandidateRoot', $sandboxRoot,
        '-ExpectedFreezeSha256', ('0' * 64),
        '-ExpectedReviewedBuildManifestSha256', ('0' * 64),
        '-ExpectedBootstrapSha256', ('0' * 64),
        '-ExpectedVerifierSha256', ('0' * 64),
        '-ExpectedInstallerLauncherSha256', ('0' * 64)
    )) { [void]$directInfo.ArgumentList.Add($argument) }
    $directProcess = [System.Diagnostics.Process]::new()
    $directProcess.StartInfo = $directInfo
    try {
        if (-not $directProcess.Start()) { throw 'Could not start canonical direct-verifier regression.' }
        $directStdoutTask = $directProcess.StandardOutput.ReadToEndAsync()
        $directStderrTask = $directProcess.StandardError.ReadToEndAsync()
        if (-not $directProcess.WaitForExit(30000)) {
            $directProcess.Kill($true)
            $directProcess.WaitForExit()
            throw 'Canonical direct-verifier regression timed out.'
        }
        $directStdout = $directStdoutTask.GetAwaiter().GetResult()
        $directStderr = $directStderrTask.GetAwaiter().GetResult()
        Assert-True ($directProcess.ExitCode -ne 0 -and
            $directStderr -match 'must be loaded from pinned bytes by the protected launcher' -and
            [string]::IsNullOrWhiteSpace($directStdout)) `
            "Canonical direct verifier did not fail at the launcher boundary: $directStderr"
    }
    finally { $directProcess.Dispose() }
    $directLauncherRejected = $false
    try {
        & $productionInstallerLauncher -Apply `
            -CandidateRoot $sandboxRoot `
            -ExpectedFreezeSha256 ('0' * 64) `
            -ExpectedReviewedBuildManifestSha256 ('0' * 64) `
            -ExpectedBootstrapSha256 ('0' * 64) `
            -ExpectedVerifierSha256 ('0' * 64) `
            -ExpectedInstallerLauncherSha256 ('0' * 64)
    }
    catch {
        $directLauncherRejected = $_.Exception.Message -match 'exact clean contract'
    }
    Assert-True $directLauncherRejected `
        'Public installer launcher accepted execution from an existing caller session.'

    $authorityCandidate = New-TestCandidate `
        -Root (Join-Path $sandboxRoot 'safe-reviewed-authority')
    $verifierTokens = $null
    $verifierErrors = $null
    $verifierAst = [System.Management.Automation.Language.Parser]::ParseFile(
        $productionVerifier, [ref]$verifierTokens, [ref]$verifierErrors
    )
    if ($verifierErrors.Count -ne 0) { throw 'External verifier does not parse for authority regression.' }
    $verifierDefinitions = foreach ($name in @(
        'Assert-InternalLauncherContext',
        'Get-UniqueVerifierJsonProperty',
        'Assert-ExactVerifierJsonProperties',
        'Assert-ExactVerifierStringMap',
        'Assert-ReviewedManifestAuthority',
        'Read-BoundedUtf8Response',
        'Get-ProtectedPublicGitHubArrayPages',
        'Assert-MergedSourceCommit',
        'Assert-CountedApprovalForSource'
    )) {
        $definition = $verifierAst.Find(
            {
                param($candidate)
                $candidate -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                    $candidate.Name -ceq $name
            },
            $true
        )
        if ($null -eq $definition) { throw "External verifier lacks helper: $name" }
        $definition.Extent.Text
    }
    . ([ScriptBlock]::Create(($verifierDefinitions -join "`n")))
    $verifierText = Get-Content -Raw -LiteralPath $productionVerifier
    Assert-True ($verifierText.Contains('AllowAutoRedirect = $false')) `
        'External verifier permits merged-source GitHub requests to redirect.'
    Assert-True ($verifierText.Contains('ResponseHeadersRead')) `
        'External verifier buffers untrusted GitHub responses before applying the size limit.'
    Assert-True ($verifierText.Contains(
        '[StringComparer]::OrdinalIgnoreCase.Equals($packageRoot, $candidateRoot)'
    )) 'External verifier compares equivalent Windows roots case-sensitively.'
    Assert-True ($verifierText -notmatch 'Headers\.Authorization') `
        'External merged-source verification unexpectedly uses a credential.'
    $oversizedResponse = [System.IO.MemoryStream]::new([byte[]]::new(1048577), $false)
    try {
        $oversizedRejected = $false
        try {
            [void](Read-BoundedUtf8Response -Stream $oversizedResponse -MaximumBytes 1048576 `
                -Label 'Test response' -CancellationToken ([Threading.CancellationToken]::None))
        }
        catch { $oversizedRejected = $_.Exception.Message -match 'exceeds the protected size limit' }
        Assert-True $oversizedRejected `
            'External verifier accepted a chunked response beyond the protected byte limit.'
    }
    finally { $oversizedResponse.Dispose() }
    $invalidUtf8Response = [System.IO.MemoryStream]::new([byte[]](0xC3, 0x28), $false)
    try {
        $invalidUtf8Rejected = $false
        try {
            [void](Read-BoundedUtf8Response -Stream $invalidUtf8Response -MaximumBytes 1048576 `
                -Label 'Test response' -CancellationToken ([Threading.CancellationToken]::None))
        }
        catch [System.Text.DecoderFallbackException] { $invalidUtf8Rejected = $true }
        Assert-True $invalidUtf8Rejected `
            'External verifier accepted malformed UTF-8 response bytes.'
    }
    finally { $invalidUtf8Response.Dispose() }
    if ($null -eq ('BlipNeverCompletingReadStream' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

public sealed class BlipNeverCompletingReadStream : Stream
{
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override Task<int> ReadAsync(
        byte[] buffer, int offset, int count, CancellationToken cancellationToken)
    {
        var completion = new TaskCompletionSource<int>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        cancellationToken.Register(() => completion.TrySetCanceled(cancellationToken));
        return completion.Task;
    }
}
'@
    }
    $stalledResponse = [BlipNeverCompletingReadStream]::new()
    $deadline = [Threading.CancellationTokenSource]::new([TimeSpan]::FromMilliseconds(50))
    $deadlineWatch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $deadlineRejected = $false
        try {
            [void](Read-BoundedUtf8Response -Stream $stalledResponse -MaximumBytes 1048576 `
                -Label 'Test response' -CancellationToken $deadline.Token)
        }
        catch [OperationCanceledException] { $deadlineRejected = $true }
        Assert-True ($deadlineRejected -and $deadlineWatch.Elapsed -lt [TimeSpan]::FromSeconds(2)) `
            'External verifier did not cancel a stalled response body within the deadline.'
    }
    finally {
        $deadlineWatch.Stop()
        $deadline.Dispose()
        $stalledResponse.Dispose()
    }
    $fixedOwnerLogin = 'monkey1sai'
    $fixedOwnerId = [long]26239865
    $fixedReviewerLogin = 'monkey1sai-blip'
    $fixedReviewerId = [long]311287868
    $script:testMergedSource = 'c' * 40
    $script:testProtectedMain = 'd' * 40
    $script:testProtectedMainAfterEvidence = $script:testProtectedMain
    $script:testMainReadCount = 0
    $script:testMergeStatus = 'ahead'
    $script:testMergeCommit = 'e' * 40
    $script:testMergeBase = $script:testMergeCommit
    $script:testMergedPullNumber = 736
    $script:testMergedPullHead = $script:testMergedSource
    function New-TestAssociatedPullJson {
        param(
            [int]$Number = $script:testMergedPullNumber,
            [string]$HeadSha = $script:testMergedPullHead
        )
        return ([ordered]@{
            number = $Number
            head = [ordered]@{ sha = $HeadSha }
            merged_by = $null
        } | ConvertTo-Json -Compress -Depth 3)
    }
    function New-TestPullDetailJson {
        param(
            [int]$Number = $script:testMergedPullNumber,
            [string]$State = 'closed',
            [switch]$Unmerged,
            [string]$BaseRef = 'main',
            [string]$HeadSha = $script:testMergedPullHead,
            [string]$MergeSha = $script:testMergeCommit,
            [string]$MergerLogin = 'monkey1sai',
            [long]$MergerId = 26239865,
            [string]$MergerType = 'User'
        )
        return ([ordered]@{
            number = $Number
            state = $State
            merged = -not $Unmerged
            merged_at = if ($Unmerged) { $null } else { '2026-09-02T02:00:00Z' }
            merge_commit_sha = $MergeSha
            base = [ordered]@{ ref = $BaseRef }
            head = [ordered]@{ sha = $HeadSha }
            merged_by = if ($Unmerged) { $null } else {
                [ordered]@{ login = $MergerLogin; id = $MergerId; type = $MergerType }
            }
        } | ConvertTo-Json -Compress -Depth 4)
    }
    function New-TestBlipReviewJson {
        param(
            [string]$State = 'APPROVED',
            [string]$SubmittedAt = '2026-09-02T01:00:00Z',
            [long]$Id = 9001,
            [string]$CommitId = $script:testMergedPullHead,
            [string]$Login = 'monkey1sai-blip',
            [long]$UserId = 311287868,
            [string]$UserType = 'User',
            [AllowEmptyString()][string]$Body = '__canonical__'
        )
        if ($Body -ceq '__canonical__') {
            $Body = [ordered]@{
                kind = 'ai-bim-automated-approve-only'
                version = 1
                automated = $true
                repo = 'monkey1sai/AI-BIM-governance'
                prNumber = $script:testMergedPullNumber
                headOid = $script:testMergedSource
                baseOid = 'b' * 40
                action = 'approve-only'
            } | ConvertTo-Json -Compress
        }
        return ([ordered]@{
            id = $Id
            state = $State
            submitted_at = $SubmittedAt
            commit_id = $CommitId
            body = $Body
            user = [ordered]@{ login = $Login; id = $UserId; type = $UserType }
        } | ConvertTo-Json -Compress -Depth 4)
    }
    $script:testPullsJson = '[' + (New-TestAssociatedPullJson) + ']'
    $script:testPullsPage2Json = '[]'
    $script:testPullDetails = @{}
    $script:testPullDetails[$script:testMergedPullNumber] = New-TestPullDetailJson
    $script:testReviewsJson = '[' + (New-TestBlipReviewJson) + ']'
    $script:testReviewsPage2Json = '[]'
    function Invoke-ProtectedPublicGitHubGet {
        param([Parameter(Mandatory)][string]$RelativePath)
        if ($RelativePath -ceq '/repos/monkey1sai/AI-BIM-governance/commits/heads/main') {
            $mainSha = if (($script:testMainReadCount % 2) -eq 0) {
                $script:testProtectedMain
            } else { $script:testProtectedMainAfterEvidence }
            $script:testMainReadCount += 1
            return '{"sha":"' + $mainSha + '"}'
        }
        if ($RelativePath -match ('^/repos/monkey1sai/AI-BIM-governance/commits/' +
            $script:testMergedSource + '/pulls\?per_page=100&page=(?<Page>[12])$')) {
            if ($Matches.Page -ceq '1') { return $script:testPullsJson }
            return $script:testPullsPage2Json
        }
        if ($RelativePath -match '^/repos/monkey1sai/AI-BIM-governance/pulls/(?<Number>[1-9][0-9]{0,5})$') {
            $number = [int]$Matches.Number
            if (-not $script:testPullDetails.ContainsKey($number)) {
                throw "Unexpected pull detail: $RelativePath"
            }
            return $script:testPullDetails[$number]
        }
        if ($RelativePath -match ('^/repos/monkey1sai/AI-BIM-governance/pulls/' +
            $script:testMergedPullNumber + '/reviews\?per_page=100&page=(?<Page>[12])$')) {
            if ($Matches.Page -ceq '1') { return $script:testReviewsJson }
            return $script:testReviewsPage2Json
        }
        $expected = '/repos/monkey1sai/AI-BIM-governance/compare/' +
            $script:testMergeCommit + '...' + $script:testProtectedMain
        if ($RelativePath -cne $expected) { throw "Unexpected merged-source path: $RelativePath" }
        return '{"status":"' + $script:testMergeStatus + '","base_commit":{"sha":"' +
            $script:testMergeCommit + '"},"merge_base_commit":{"sha":"' +
            $script:testMergeBase + '"}}'
    }
    $reviewedDocument = [System.Text.Json.JsonDocument]::Parse(
        [System.IO.File]::ReadAllText($authorityCandidate.ReviewedManifestPath)
    )
    $freezeDocument = [System.Text.Json.JsonDocument]::Parse(
        [System.IO.File]::ReadAllText($authorityCandidate.FreezePath)
    )
    try {
        $reviewedSourceFiles = @(
            $reviewedDocument.RootElement.GetProperty('source_files').EnumerateObject() |
                ForEach-Object { $_.Name }
        )
        $reviewedRuntimeKeys = @(
            $reviewedDocument.RootElement.GetProperty('runtime_source').EnumerateObject() |
                ForEach-Object { $_.Name }
        )
        $reviewedSignerKeys = @(
            $reviewedDocument.RootElement.GetProperty('runtime_signers').EnumerateObject() |
                ForEach-Object { $_.Name }
        )
        $InternalLoaderContext = [pscustomobject]@{
            VerifierSha256 = $authorityCandidate.VerifierHash
            InstallerLauncherSha256 = $authorityCandidate.InstallerLauncherHash
        }
        $candidateRoot = $authorityCandidate.Root
        $ExpectedFreezeSha256 = $authorityCandidate.FreezeHash
        $ExpectedReviewedBuildManifestSha256 = $authorityCandidate.ReviewedManifestHash
        $ExpectedVerifierSha256 = $authorityCandidate.VerifierHash
        $ExpectedInstallerLauncherSha256 = $authorityCandidate.InstallerLauncherHash
        $ExpectedBootstrapSha256 = $authorityCandidate.BootstrapHash
        $fixedPowerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
        $launcherProofStream = [System.IO.FileStream]::new(
            $authorityCandidate.InstallerLauncherPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Read
        )
        $verifierProofStream = [System.IO.FileStream]::new(
            $authorityCandidate.VerifierPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Read
        )
        try {
            $proof = [object]::new()
            $launcherContext = [pscustomobject]@{
                Schema = 'blip-installer-launcher-context/v1'
                Capability = $proof
                ProofEcho = $proof
                CandidateRoot = $candidateRoot
                FreezeSha256 = $ExpectedFreezeSha256
                ReviewedBuildManifestSha256 = $ExpectedReviewedBuildManifestSha256
                BootstrapSha256 = $ExpectedBootstrapSha256
                InstallerLauncherPath = $authorityCandidate.InstallerLauncherPath
                InstallerLauncherSha256 = $ExpectedInstallerLauncherSha256
                InstallerLauncherStream = $launcherProofStream
                VerifierPath = $authorityCandidate.VerifierPath
                VerifierSha256 = $ExpectedVerifierSha256
                VerifierStream = $verifierProofStream
                HostPid = [Environment]::ProcessId
                HostPath = $fixedPowerShellPath
            }
            $launcherAuthority = Assert-InternalLauncherContext -Context $launcherContext
            Assert-True ($launcherAuthority.VerifierPath -ceq
                $authorityCandidate.VerifierPath) `
                'Internal verifier rejected a valid process-local launcher context.'
            $launcherContext.ProofEcho = [object]::new()
            $proofRejected = $false
            try { [void](Assert-InternalLauncherContext -Context $launcherContext) }
            catch { $proofRejected = $_.Exception.Message -match 'context proof is invalid' }
            Assert-True $proofRejected `
                'Internal verifier accepted a non-reference-equal launcher capability.'
            $launcherContext.ProofEcho = $proof
            $launcherContext | Add-Member -NotePropertyName Extra -NotePropertyValue $true
            $schemaRejected = $false
            try { [void](Assert-InternalLauncherContext -Context $launcherContext) }
            catch { $schemaRejected = $_.Exception.Message -match 'context schema is invalid' }
            Assert-True $schemaRejected `
                'Internal verifier accepted an unknown launcher-context field.'
        }
        finally {
            $verifierProofStream.Dispose()
            $launcherProofStream.Dispose()
        }
        $reviewedManifestBytes = [System.IO.File]::ReadAllBytes(
            $authorityCandidate.ReviewedManifestPath
        )
        $reviewedSourceCommit = Assert-ReviewedManifestAuthority -Bytes $reviewedManifestBytes
        Assert-True ($reviewedSourceCommit -ceq ('c' * 40)) `
            'External verifier did not preserve the exact reviewed source commit.'
        $mergedSourceCommit = Assert-MergedSourceCommit -SourceCommit $reviewedSourceCommit
        Assert-True ($mergedSourceCommit -ceq $reviewedSourceCommit) `
            'External verifier rejected a source commit reachable from protected main.'
        $script:testProtectedMainAfterEvidence = 'a' * 40
        $mainDriftRejected = $false
        try { [void](Assert-MergedSourceCommit -SourceCommit $reviewedSourceCommit) }
        catch { $mainDriftRejected = $_.Exception.Message -match 'changed during' }
        Assert-True $mainDriftRejected `
            'External verifier accepted protection evidence across protected-main drift.'
        $script:testProtectedMainAfterEvidence = $script:testProtectedMain
        $script:testMergeStatus = 'diverged'
        $mergeStatusRejected = $false
        try { [void](Assert-MergedSourceCommit -SourceCommit $reviewedSourceCommit) }
        catch { $mergeStatusRejected = $_.Exception.Message -match 'not reachable' }
        Assert-True $mergeStatusRejected `
            'External verifier accepted a reviewed source outside protected main ancestry.'
        $script:testMergeStatus = 'ahead'
        $script:testMergeBase = 'f' * 40
        $mergeBaseRejected = $false
        try { [void](Assert-MergedSourceCommit -SourceCommit $reviewedSourceCommit) }
        catch { $mergeBaseRejected = $_.Exception.Message -match 'not reachable' }
        Assert-True $mergeBaseRejected `
            'External verifier accepted a compare response with a different merge base.'
        $script:testMergeBase = $script:testMergeCommit
        $countedPullNumber = Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit
        Assert-True ($countedPullNumber -eq $script:testMergedPullNumber) `
            'External verifier rejected a merged source with a counted exact-head approval.'
        $script:testPullsJson = '[]'
        $noPullRejected = $false
        try { [void](Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit) }
        catch { $noPullRejected = $_.Exception.Message -match 'no exact-head pull request' }
        Assert-True $noPullRejected `
            'External verifier accepted an admin-pushed source with no merged pull request.'
        $script:testPullsJson = '[' + (New-TestAssociatedPullJson) + ',' +
            (New-TestAssociatedPullJson -Number 737) + ']'
        $script:testPullDetails[737] = New-TestPullDetailJson -Number 737
        $ambiguousRejected = $false
        try { [void](Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit) }
        catch { $ambiguousRejected = $_.Exception.Message -match 'ambiguous approval evidence' }
        Assert-True $ambiguousRejected `
            'External verifier accepted ambiguous merged pull-request evidence.'
        [void]$script:testPullDetails.Remove(737)
        $script:testPullsJson = '[' + (New-TestAssociatedPullJson) + ']'
        $script:testPullDetails[$script:testMergedPullNumber] = New-TestPullDetailJson -Unmerged
        $unmergedRejected = $false
        try { [void](Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit) }
        catch { $unmergedRejected = $_.Exception.Message -match 'no completed owner merge' }
        Assert-True $unmergedRejected `
            'External verifier accepted an unmerged pull request as merge provenance.'
        $script:testPullDetails[$script:testMergedPullNumber] = New-TestPullDetailJson `
            -MergerLogin 'other-owner' -MergerId 1
        $wrongMergerRejected = $false
        try { [void](Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit) }
        catch { $wrongMergerRejected = $_.Exception.Message -match 'no completed owner merge' }
        Assert-True $wrongMergerRejected `
            'External verifier accepted a merge performed by a non-fixed owner identity.'
        $script:testPullDetails[$script:testMergedPullNumber] = New-TestPullDetailJson
        $script:testReviewsJson = '[' + (New-TestBlipReviewJson) + ',' +
            (New-TestBlipReviewJson -State 'CHANGES_REQUESTED' -SubmittedAt '2026-09-02T02:00:00Z' -Id 9002) + ']'
        $supersededRejected = $false
        try { [void](Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit) }
        catch { $supersededRejected = $_.Exception.Message -match 'not a counted APPROVED' }
        Assert-True $supersededRejected `
            'External verifier accepted a superseded approval as the latest decisive review.'
        $script:testReviewsJson = '[' + (New-TestBlipReviewJson -CommitId ('a' * 40)) + ']'
        $unboundRejected = $false
        try { [void](Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit) }
        catch { $unboundRejected = $_.Exception.Message -match 'not bound to the exact reviewed source head' }
        Assert-True $unboundRejected `
            'External verifier accepted an approval not bound to the merged head.'
        $script:testReviewsJson = '[' + (New-TestBlipReviewJson -Login 'claude-tri-adversarial-bot[bot]' -UserId 1 -UserType 'Bot') + ']'
        $wrongIdentityRejected = $false
        try { [void](Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit) }
        catch { $wrongIdentityRejected = $_.Exception.Message -match 'not a counted APPROVED' }
        Assert-True $wrongIdentityRejected `
            'External verifier accepted a non-fixed-reviewer approval as counted.'
        $script:testReviewsJson = '[' + (New-TestBlipReviewJson -Body '') + ']'
        $bodyIndependentPullNumber = Assert-CountedApprovalForSource `
            -SourceCommit $reviewedSourceCommit
        Assert-True ($bodyIndependentPullNumber -eq $script:testMergedPullNumber) `
            'External verifier incorrectly treated mutable review body text as approval authority.'
        $script:testReviewsJson = '[' +
            (New-TestBlipReviewJson -SubmittedAt '2026-09-02T03:00:00Z') + ']'
        $postMergeRejected = $false
        try { [void](Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit) }
        catch { $postMergeRejected = $_.Exception.Message -match 'submitted after' }
        Assert-True $postMergeRejected `
            'External verifier accepted an approval submitted after the pull request merge.'

        $unrelatedPulls = foreach ($number in 1..100) {
            New-TestAssociatedPullJson -Number $number -HeadSha ('a' * 40)
        }
        $script:testPullsJson = '[' + ($unrelatedPulls -join ',') + ']'
        $script:testPullsPage2Json = '[' + (New-TestAssociatedPullJson) + ']'
        $script:testReviewsJson = '[' + (New-TestBlipReviewJson) + ']'
        $script:testReviewsPage2Json = '[]'
        $pagedPullNumber = Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit
        Assert-True ($pagedPullNumber -eq $script:testMergedPullNumber) `
            'External verifier ignored an exact-head pull request on a bounded second page.'

        $script:testPullsJson = '[' + (New-TestAssociatedPullJson) + ']'
        $script:testPullsPage2Json = '[]'
        $commentReviews = foreach ($id in 1..100) {
            New-TestBlipReviewJson -State 'COMMENTED' -Id $id -Login 'other-reviewer' -UserId 1
        }
        $script:testReviewsJson = '[' + ($commentReviews -join ',') + ']'
        $script:testReviewsPage2Json = '[' + (New-TestBlipReviewJson) + ']'
        $pagedReviewNumber = Assert-CountedApprovalForSource -SourceCommit $reviewedSourceCommit
        Assert-True ($pagedReviewNumber -eq $script:testMergedPullNumber) `
            'External verifier ignored a counted exact-head approval on a bounded second page.'
        $script:testReviewsJson = '[' + (New-TestBlipReviewJson) + ']'
        $script:testReviewsPage2Json = '[]'
        $ExpectedBootstrapSha256 = '0' * 64
        $bootstrapAuthorityRejected = $false
        try { Assert-ReviewedManifestAuthority -Bytes $reviewedManifestBytes }
        catch { $bootstrapAuthorityRejected = $_.Exception.Message -match 'does not authorize' }
        Assert-True $bootstrapAuthorityRejected `
            'External verifier accepted a bootstrap outside the reviewed manifest.'
        $ExpectedBootstrapSha256 = $authorityCandidate.BootstrapHash
        $ExpectedInstallerLauncherSha256 = '0' * 64
        $launcherAuthorityRejected = $false
        try { Assert-ReviewedManifestAuthority -Bytes $reviewedManifestBytes }
        catch { $launcherAuthorityRejected = $_.Exception.Message -match 'authority fields' }
        Assert-True $launcherAuthorityRejected `
            'External verifier accepted an installer launcher outside the reviewed manifest.'
        $ExpectedInstallerLauncherSha256 = $authorityCandidate.InstallerLauncherHash
        Assert-ReviewedManifestMatchesFreeze `
            -ReviewedRoot $reviewedDocument.RootElement -FreezeRoot $freezeDocument.RootElement
        $InternalLoaderContext.InstallerLauncherSha256 = '0' * 64
        $innerLauncherRejected = $false
        try {
            Assert-ReviewedManifestMatchesFreeze `
                -ReviewedRoot $reviewedDocument.RootElement -FreezeRoot $freezeDocument.RootElement
        }
        catch { $innerLauncherRejected = $_.Exception.Message -match 'identity differs' }
        Assert-True $innerLauncherRejected `
            'Trusted bootstrap accepted an installer launcher outside the reviewed manifest.'
        $InternalLoaderContext.InstallerLauncherSha256 = $authorityCandidate.InstallerLauncherHash
        $tamperedFreeze = Get-Content -Raw -LiteralPath $authorityCandidate.FreezePath |
            ConvertFrom-Json
        $tamperedFreeze.source_files.'bot/bots.json' = 'F' * 64
        $tamperedDocument = [System.Text.Json.JsonDocument]::Parse(
            ($tamperedFreeze | ConvertTo-Json -Depth 6 -Compress)
        )
        try {
            $tupleRejected = $false
            try {
                Assert-ReviewedManifestMatchesFreeze `
                    -ReviewedRoot $reviewedDocument.RootElement `
                    -FreezeRoot $tamperedDocument.RootElement
            }
            catch { $tupleRejected = $_.Exception.Message -match 'differs from candidate freeze' }
            Assert-True $tupleRejected `
                'Trusted bootstrap accepted source bytes outside the reviewed manifest.'
        }
        finally { $tamperedDocument.Dispose() }
    }
    finally { $freezeDocument.Dispose(); $reviewedDocument.Dispose() }
    Write-Output 'freeze-v3-safe-schema-regression-ok'
}

function New-TestCandidate {
    param(
        [Parameter(Mandatory)][string]$Root,
        [byte[]]$InstallerBytes = [System.Text.UTF8Encoding]::new($false).GetBytes(@'
[CmdletBinding()]
param(
    [Parameter(Mandatory)][switch]$Apply,
    [Parameter(Mandatory)][string]$ExpectedFreezeSha256,
    [Parameter(Mandatory)][string]$ExpectedInstallerSha256,
    [Parameter(Mandatory)][string]$ExpectedReviewedBuildManifestSha256,
    [Parameter(Mandatory)][string]$ExpectedBootstrapSha256,
    [Parameter(Mandatory)][string]$CandidateRoot,
    [Parameter(Mandatory)][object]$BootstrapContext
)
if (-not $Apply) { throw 'fake_apply_required' }
if ($BootstrapContext.Schema -cne 'blip-installer-bootstrap-context/v3' -or
    $BootstrapContext.ReviewedBuildManifestSha256 -cne
        $ExpectedReviewedBuildManifestSha256) {
    throw 'fake_context_invalid'
}
"FAKE_INSTALL_REACHED root=$CandidateRoot"
'@)
    )
    [System.IO.Directory]::CreateDirectory($Root) | Out-Null
    $bootstrapBytes = [System.IO.File]::ReadAllBytes($productionBootstrap)
    $bootstrapPath = Join-Path $Root 'invoke_frozen_blip_installer.ps1'
    $installerPath = Join-Path $Root 'install_blip_auto_approval.ps1'
    $freezePath = Join-Path $Root 'candidate-freeze.json'
    $reviewedManifestPath = Join-Path $Root 'reviewed-build-manifest.json'
    [System.IO.File]::WriteAllBytes($bootstrapPath, $bootstrapBytes)
    [System.IO.File]::WriteAllBytes($installerPath, $InstallerBytes)
    $bootstrapHash = Get-BytesSha256 -Bytes $bootstrapBytes
    $installerHash = Get-BytesSha256 -Bytes $InstallerBytes
    $installerLauncherHash = (Get-FileHash `
        -LiteralPath $productionInstallerLauncher -Algorithm SHA256
    ).Hash
    $verifierHash = (Get-FileHash -LiteralPath $productionVerifier -Algorithm SHA256).Hash
    $sourceKeys = @(
        'install_blip_auto_approval.ps1',
        'invoke_frozen_blip_installer.ps1',
        'bot/bots.json',
        'bot/scripts/app_auth.py',
        'bot/scripts/bind_ship_attestation.py',
        'bot/scripts/blip_review.py',
        'bot/scripts/codex_ship_gate.py',
        'bot/scripts/collect_ship_gate_packet.py',
        'bot/scripts/post_review.py',
        'bot/scripts/run_blip_live_approve_once.ps1',
        'bot/scripts/run_codex_bound_ship_gate_once.ps1',
        'bot/scripts/ship_gate_packet.py'
    )
    $runtimeKeys = @(
        'runtime/pwsh.exe',
        'runtime/python.exe',
        'runtime/codex-package.json',
        'runtime/bin/codex.exe',
        'runtime/bin/codex-code-mode-host.exe',
        'runtime/codex-path/rg.exe',
        'runtime/codex-resources/codex-command-runner.exe',
        'runtime/codex-resources/codex-windows-sandbox-setup.exe',
        'runtime/psmodule/Microsoft.PowerShell.Management.psd1',
        'runtime/psmodule/Microsoft.PowerShell.Security.psd1',
        'runtime/psmodule/Security.types.ps1xml',
        'runtime/psmodule/Microsoft.PowerShell.Utility.psd1',
        'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll',
        'runtime/psmodule/Microsoft.PowerShell.Security.dll',
        'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll'
    )
    # Authenticode signer binding is publisher provenance layered on the runtime_source
    # SHA-256 pins. Upstream ripgrep ('runtime/codex-path/rg.exe') ships unsigned, so it
    # is hash-pinned only; see build_blip_candidate.ps1 for the full rationale.
    $signerKeys = @(
        'runtime/pwsh.exe',
        'runtime/python.exe',
        'runtime/bin/codex.exe',
        'runtime/bin/codex-code-mode-host.exe',
        'runtime/codex-resources/codex-command-runner.exe',
        'runtime/codex-resources/codex-windows-sandbox-setup.exe',
        'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll',
        'runtime/psmodule/Microsoft.PowerShell.Security.dll',
        'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll'
    )
    $sourceMap = [ordered]@{}
    foreach ($key in $sourceKeys) { $sourceMap[$key] = 'A' * 64 }
    $sourceMap['invoke_frozen_blip_installer.ps1'] = $bootstrapHash
    $sourceMap['install_blip_auto_approval.ps1'] = $installerHash
    $runtimeMap = [ordered]@{}
    foreach ($key in $runtimeKeys) { $runtimeMap[$key] = 'B' * 64 }
    $signerMap = [ordered]@{}
    foreach ($key in $signerKeys) { $signerMap[$key] = 'C' * 40 }
    $reviewedManifest = [ordered]@{
        schema = 'blip-auto-approval-reviewed-build/v2'
        source_commit = 'c' * 40
        builder_launcher_sha256 = 'D' * 64
        builder_sha256 = 'E' * 64
        installer_launcher_sha256 = $installerLauncherHash
        external_verifier_sha256 = $verifierHash
        source_files = $sourceMap
        runtime_source = $runtimeMap
        runtime_signers = $signerMap
    } | ConvertTo-Json -Depth 6 -Compress
    [System.IO.File]::WriteAllText(
        $reviewedManifestPath,
        $reviewedManifest,
        [System.Text.UTF8Encoding]::new($false)
    )
    $reviewedManifestHash = (Get-FileHash `
        -LiteralPath $reviewedManifestPath -Algorithm SHA256
    ).Hash
    $freeze = [ordered]@{
        schema = 'blip-auto-approval-candidate-freeze/v3'
        build_profile = 'PRODUCTION'
        source_commit = 'c' * 40
        reviewed_build_manifest_sha256 = $reviewedManifestHash
        external_verifier_sha256 = $verifierHash
        source_files = $sourceMap
        runtime_source = $runtimeMap
    } | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText(
        $freezePath, $freeze, [System.Text.UTF8Encoding]::new($false)
    )
    return [pscustomobject]@{
        Root = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
        BootstrapPath = $bootstrapPath
        InstallerPath = $installerPath
        FreezePath = $freezePath
        ReviewedManifestPath = $reviewedManifestPath
        BootstrapHash = $bootstrapHash
        InstallerHash = $installerHash
        InstallerLauncherPath = [System.IO.Path]::GetFullPath($productionInstallerLauncher)
        InstallerLauncherHash = $installerLauncherHash
        VerifierPath = [System.IO.Path]::GetFullPath($productionVerifier)
        VerifierHash = $verifierHash
        ReviewedManifestHash = $reviewedManifestHash
        FreezeHash = (Get-FileHash -LiteralPath $freezePath -Algorithm SHA256).Hash
    }
}

function Invoke-TestRootLoader {
    param(
        [Parameter(Mandatory)][object]$Candidate,
        [string]$ExpectedFreezeSha256 = $Candidate.FreezeHash,
        [string]$ExpectedReviewedBuildManifestSha256 = $Candidate.ReviewedManifestHash,
        [string]$ExpectedBootstrapSha256 = $Candidate.BootstrapHash,
        [scriptblock]$MutateContext
    )
    $stream = [System.IO.FileStream]::new(
        $Candidate.BootstrapPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
    $installerLauncherStream = [System.IO.FileStream]::new(
        $Candidate.InstallerLauncherPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
    $verifierStream = [System.IO.FileStream]::new(
        $Candidate.VerifierPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
    $reviewedManifestStream = [System.IO.FileStream]::new(
        $Candidate.ReviewedManifestPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
    try {
        $bytes = [byte[]]::new([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
            if ($read -le 0) { throw 'test_bootstrap_short_read' }
            $offset += $read
        }
        if ((Get-BytesSha256 -Bytes $bytes) -cne $ExpectedBootstrapSha256) {
            throw 'test_root_loader_bootstrap_hash_mismatch'
        }
        $text = [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes)
        $tokens = $null
        $errors = $null
        [void][System.Management.Automation.Language.Parser]::ParseInput(
            $text, [ref]$tokens, [ref]$errors
        )
        if ($errors.Count -ne 0) { throw 'test_root_loader_bootstrap_parse_failed' }
        $capability = [object]::new()
        $context = [pscustomobject]@{
            Schema = 'blip-installer-root-loader/v4'
            Capability = $capability
            ProofEcho = $capability
            CandidateRoot = $Candidate.Root
            FreezeSha256 = $ExpectedFreezeSha256
            ReviewedBuildManifestSha256 = $ExpectedReviewedBuildManifestSha256
            ReviewedBuildManifestStream = $reviewedManifestStream
            BootstrapSha256 = $ExpectedBootstrapSha256
            BootstrapStream = $stream
            InstallerLauncherPath = $Candidate.InstallerLauncherPath
            InstallerLauncherSha256 = $Candidate.InstallerLauncherHash
            InstallerLauncherStream = $installerLauncherStream
            VerifierPath = $Candidate.VerifierPath
            VerifierSha256 = $Candidate.VerifierHash
            VerifierStream = $verifierStream
            HostPid = [Environment]::ProcessId
            HostPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
        }
        if ($null -ne $MutateContext) { & $MutateContext $context }
        $script = [ScriptBlock]::Create($text)
        return & $script `
            -CandidateRoot $Candidate.Root `
            -ExpectedFreezeSha256 $ExpectedFreezeSha256 `
            -ExpectedReviewedBuildManifestSha256 $ExpectedReviewedBuildManifestSha256 `
            -ExpectedBootstrapSha256 $ExpectedBootstrapSha256 `
            -InternalLoaderContext $context
    }
    finally {
        $reviewedManifestStream.Dispose()
        $verifierStream.Dispose()
        $installerLauncherStream.Dispose()
        $stream.Dispose()
    }
}

try {
    [System.IO.Directory]::CreateDirectory($sandboxRoot) | Out-Null
    Invoke-BootstrapSignerEnvironmentRegression
    Invoke-FreezeV3SchemaRegression
    if ($SafeOnly) {
        Write-Output 'installer-bootstrap-safe-tests-ok (schema, command resolution, canonical direct-verifier refusal, process-local launcher proof)'
        return
    }

    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier])
    $currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $isSandbox = $currentIdentity.User -eq $sandboxSid
    foreach ($group in $currentIdentity.Groups) {
        if ($group.Value -ceq $sandboxSid.Value) { $isSandbox = $true }
    }
    if ($isSandbox) {
        $sandboxCandidate = New-TestCandidate -Root (Join-Path $sandboxRoot 'sandbox-denial')
        $sandboxRejected = $false
        try { [void](Invoke-TestRootLoader -Candidate $sandboxCandidate) }
        catch { $sandboxRejected = $_.Exception.Message -match 'not the immutable owner SID' }
        Assert-True $sandboxRejected 'Production bootstrap did not reject a non-owner identity.'
        Write-Output 'installer-bootstrap-owner-tests-skipped: immutable owner-SID denial verified; run as owner for mutation-free binding matrix'
        return
    }

    $valid = New-TestCandidate -Root (Join-Path $sandboxRoot 'valid')
    $output = @(Invoke-TestRootLoader -Candidate $valid)
    Assert-True (
        @($output | Where-Object { $_ -like 'FAKE_INSTALL_REACHED*' }).Count -eq 1
    ) 'Verified in-memory bootstrap did not reach the bounded fake installer.'

    $lock = [System.IO.FileStream]::new(
        $valid.BootstrapPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
    try {
        $replacementBlocked = $false
        try { [System.IO.File]::WriteAllText($valid.BootstrapPath, 'replacement') }
        catch [System.IO.IOException] { $replacementBlocked = $true }
    Assert-True $replacementBlocked `
            'The root-loader bootstrap handle did not block replacement.'
    }
    finally { $lock.Dispose() }

    $changedBootstrap = New-TestCandidate -Root (Join-Path $sandboxRoot 'changed-bootstrap')
    [System.IO.File]::AppendAllText($changedBootstrap.BootstrapPath, '# changed')
    $changedBootstrapRejected = $false
    try { [void](Invoke-TestRootLoader -Candidate $changedBootstrap) }
    catch {
        $changedBootstrapRejected = $_.Exception.Message -match 'bootstrap_hash_mismatch'
    }
    Assert-True $changedBootstrapRejected `
        'The outer root loader accepted bootstrap bytes changed after authorization.'

    $changedInstaller = New-TestCandidate -Root (Join-Path $sandboxRoot 'changed-installer')
    [System.IO.File]::AppendAllText($changedInstaller.InstallerPath, '# changed')
    $changedInstallerRejected = $false
    try { [void](Invoke-TestRootLoader -Candidate $changedInstaller) }
    catch { $changedInstallerRejected = $_.Exception.Message -match 'installer bytes differ' }
    Assert-True $changedInstallerRejected `
        'Bootstrap accepted an installer changed after the freeze.'

    $changedFreeze = New-TestCandidate -Root (Join-Path $sandboxRoot 'changed-freeze')
    [System.IO.File]::AppendAllText($changedFreeze.FreezePath, ' ')
    $changedFreezeRejected = $false
    try { [void](Invoke-TestRootLoader -Candidate $changedFreeze) }
    catch { $changedFreezeRejected = $_.Exception.Message -match 'candidate freeze differs' }
    Assert-True $changedFreezeRejected `
        'Bootstrap accepted a freeze changed after owner authorization.'

    $changedManifest = New-TestCandidate -Root (Join-Path $sandboxRoot 'changed-reviewed-manifest')
    [System.IO.File]::AppendAllText($changedManifest.ReviewedManifestPath, ' ')
    $changedManifestRejected = $false
    try { [void](Invoke-TestRootLoader -Candidate $changedManifest) }
    catch { $changedManifestRejected = $_.Exception.Message -match 'reviewed build manifest bytes differ' }
    Assert-True $changedManifestRejected `
        'Bootstrap accepted a reviewed build manifest changed after owner authorization.'

    $invalidUtf8 = [byte[]](0xFF, 0xFE, 0xFD)
    $invalidCandidate = New-TestCandidate `
        -Root (Join-Path $sandboxRoot 'invalid-utf8') -InstallerBytes $invalidUtf8
    $invalidUtf8Rejected = $false
    try { [void](Invoke-TestRootLoader -Candidate $invalidCandidate) }
    catch {
        $errorCursor = $_.Exception
        while ($null -ne $errorCursor) {
            if ($errorCursor -is [System.Text.DecoderFallbackException]) {
                $invalidUtf8Rejected = $true
                break
            }
            $errorCursor = $errorCursor.InnerException
        }
    }
    Assert-True $invalidUtf8Rejected `
        'Bootstrap accepted a non-UTF-8 installer even though its hash was frozen.'

    $wrongProof = New-TestCandidate -Root (Join-Path $sandboxRoot 'wrong-proof')
    $wrongProofRejected = $false
    $stream = [System.IO.FileStream]::new(
        $wrongProof.BootstrapPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
    $installerLauncherStream = [System.IO.FileStream]::new(
        $wrongProof.InstallerLauncherPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
    $verifierStream = [System.IO.FileStream]::new(
        $wrongProof.VerifierPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
    $reviewedManifestStream = [System.IO.FileStream]::new(
        $wrongProof.ReviewedManifestPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
    try {
        $bytes = [System.IO.File]::ReadAllBytes($productionBootstrap)
        $script = [ScriptBlock]::Create(
            [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes)
        )
        $context = [pscustomobject]@{
            Schema = 'blip-installer-root-loader/v4'
            Capability = [object]::new()
            ProofEcho = [object]::new()
            CandidateRoot = $wrongProof.Root
            FreezeSha256 = $wrongProof.FreezeHash
            ReviewedBuildManifestSha256 = $wrongProof.ReviewedManifestHash
            ReviewedBuildManifestStream = $reviewedManifestStream
            BootstrapSha256 = $wrongProof.BootstrapHash
            BootstrapStream = $stream
            InstallerLauncherPath = $wrongProof.InstallerLauncherPath
            InstallerLauncherSha256 = $wrongProof.InstallerLauncherHash
            InstallerLauncherStream = $installerLauncherStream
            VerifierPath = $wrongProof.VerifierPath
            VerifierSha256 = $wrongProof.VerifierHash
            VerifierStream = $verifierStream
            HostPid = [Environment]::ProcessId
            HostPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
        }
        try {
            [void](& $script -CandidateRoot $wrongProof.Root `
                -ExpectedFreezeSha256 $wrongProof.FreezeHash `
                -ExpectedReviewedBuildManifestSha256 $wrongProof.ReviewedManifestHash `
                -ExpectedBootstrapSha256 $wrongProof.BootstrapHash `
                -InternalLoaderContext $context)
        }
        catch { $wrongProofRejected = $_.Exception.Message -match 'root-loader proof is invalid' }
    }
    finally {
        $reviewedManifestStream.Dispose()
        $verifierStream.Dispose()
        $installerLauncherStream.Dispose()
        $stream.Dispose()
    }
    Assert-True $wrongProofRejected 'Bootstrap accepted a non-identical process-local proof.'

    foreach ($contextCase in @(
        [pscustomobject]@{
            Name = 'wrong-host-pid'
            Mutator = { param($context) $context.HostPid += 1 }
        },
        [pscustomobject]@{
            Name = 'wrong-host-path'
            Mutator = { param($context) $context.HostPath = 'C:\untrusted\pwsh.exe' }
        },
        [pscustomobject]@{
            Name = 'extra-property'
            Mutator = { param($context) $context | Add-Member -NotePropertyName Extra -NotePropertyValue $true }
        }
    )) {
        $contextCandidate = New-TestCandidate `
            -Root (Join-Path $sandboxRoot $contextCase.Name)
        $contextRejected = $false
        try {
            [void](Invoke-TestRootLoader -Candidate $contextCandidate `
                -MutateContext $contextCase.Mutator)
        }
        catch { $contextRejected = $_.Exception.Message -match 'root-loader proof is invalid' }
        Assert-True $contextRejected `
            "Bootstrap accepted a mutated loader context: $($contextCase.Name)"
    }

    $junctionTarget = New-TestCandidate -Root (Join-Path $sandboxRoot 'junction-target')
    $junctionPath = Join-Path $sandboxRoot 'junction-root'
    New-Item -ItemType Junction -Path $junctionPath -Target $junctionTarget.Root | Out-Null
    $junctionCandidate = [pscustomobject]@{
        Root = [System.IO.Path]::GetFullPath($junctionPath).TrimEnd('\')
        BootstrapPath = Join-Path $junctionPath 'invoke_frozen_blip_installer.ps1'
        InstallerPath = Join-Path $junctionPath 'install_blip_auto_approval.ps1'
        FreezePath = Join-Path $junctionPath 'candidate-freeze.json'
        ReviewedManifestPath = Join-Path $junctionPath 'reviewed-build-manifest.json'
        BootstrapHash = $junctionTarget.BootstrapHash
        InstallerHash = $junctionTarget.InstallerHash
        InstallerLauncherPath = $junctionTarget.InstallerLauncherPath
        InstallerLauncherHash = $junctionTarget.InstallerLauncherHash
        VerifierPath = $junctionTarget.VerifierPath
        VerifierHash = $junctionTarget.VerifierHash
        ReviewedManifestHash = $junctionTarget.ReviewedManifestHash
        FreezeHash = $junctionTarget.FreezeHash
    }
    $junctionRejected = $false
    try { [void](Invoke-TestRootLoader -Candidate $junctionCandidate) }
    catch { $junctionRejected = $_.Exception.Message -match 'reparse point' }
    Assert-True $junctionRejected 'Bootstrap accepted a candidate root junction.'

    $directApplyRejected = $false
    try {
        & $productionInstaller -Apply `
            -CandidateRoot $valid.Root `
            -ExpectedFreezeSha256 ('0' * 64) `
            -ExpectedInstallerSha256 ('0' * 64) `
            -ExpectedReviewedBuildManifestSha256 ('0' * 64) `
            -ExpectedBootstrapSha256 ('0' * 64) `
            -BootstrapContext ([pscustomobject]@{})
    }
    catch { $directApplyRejected = $_.Exception.Message -match 'verified in-memory bootstrap' }
    Assert-True $directApplyRejected 'Direct file-based installer Apply did not fail closed.'

    Write-Output 'installer-bootstrap-tests-ok (exclusive handles, freeze/reviewed-manifest/self binding, strict UTF-8, proof, reparse, direct-Apply refusal)'
}
finally {
    if (Test-Path -LiteralPath $sandboxRoot) {
        try { Remove-Item -LiteralPath $sandboxRoot -Recurse -Force } catch { }
    }
}
