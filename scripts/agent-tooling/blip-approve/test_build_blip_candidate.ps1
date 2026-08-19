[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packageRoot = $PSScriptRoot
$builder = Join-Path $packageRoot 'build_blip_candidate.ps1'
$builderLauncher = Join-Path $packageRoot 'invoke_protected_blip_candidate_builder.ps1'
$installerLauncher = Join-Path $packageRoot 'invoke_protected_blip_installer_launcher.ps1'
$verifier = Join-Path $packageRoot 'invoke_protected_blip_installer.ps1'
$installer = Join-Path $packageRoot 'install_blip_auto_approval.ps1'
$innerBootstrap = Join-Path $packageRoot 'invoke_frozen_blip_installer.ps1'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    'blip-candidate-builder-test-' + [Guid]::NewGuid().ToString('N')
)
$runtimeRoot = Join-Path $testRoot 'runtime-fixture'
$candidateOne = Join-Path $testRoot 'candidate-one'
$candidateTwo = Join-Path $testRoot 'candidate-two'
$junctionParent = $null
# Rule (2) ancestor-ACL coverage has to live directly under a real drive root,
# because every path under the user profile carries profile ACEs by design.
$ancestorProbeRoot = $null

function Assert-True {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Parses {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile(
        $LiteralPath, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw "PowerShell parse failed: $LiteralPath" }
}

function Assert-ExactNames {
    param(
        [Parameter(Mandatory)][string[]]$Actual,
        [Parameter(Mandatory)][string[]]$Expected,
        [Parameter(Mandatory)][string]$Label
    )
    $actualSorted = @($Actual | Sort-Object)
    $expectedSorted = @($Expected | Sort-Object)
    Assert-True ($actualSorted.Count -eq $expectedSorted.Count) "$Label count differs."
    for ($index = 0; $index -lt $expectedSorted.Count; $index += 1) {
        Assert-True ($actualSorted[$index] -ceq $expectedSorted[$index]) "$Label differs."
    }
}

function Get-BuilderLiteralArray {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.ScriptBlockAst]$Ast,
        [Parameter(Mandatory)][string]$Name
    )
    $assignments = @($Ast.FindAll(
        {
            param($candidate)
            $candidate -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                $candidate.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
                $candidate.Left.VariablePath.UserPath -ceq $Name
        },
        $true
    ))
    if ($assignments.Count -ne 1) {
        throw "Candidate builder must assign exactly one literal inventory: $Name"
    }
    return @($assignments[0].Right.FindAll(
        {
            param($candidate)
            $candidate -is [System.Management.Automation.Language.StringConstantExpressionAst]
        },
        $true
    ) | ForEach-Object { $_.Value })
}

function New-ProtectedProbeDirectory {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][System.Security.Principal.SecurityIdentifier]$Owner,
        [Parameter(Mandatory)][string[]]$AllowFullControlSids,
        [AllowEmptyCollection()][string[]]$AllowReplacementSids = @()
    )
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner($Owner)
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sid in $AllowFullControlSids) {
        $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            [System.Security.Principal.SecurityIdentifier]::new($sid),
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        ))
    }
    foreach ($sid in $AllowReplacementSids) {
        $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            [System.Security.Principal.SecurityIdentifier]::new($sid),
            [System.Security.AccessControl.FileSystemRights]::Delete,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        ))
    }
    [void][System.IO.FileSystemAclExtensions]::CreateDirectory($security, $LiteralPath)
}

function Get-BuilderFunction {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.ScriptBlockAst]$Ast,
        [Parameter(Mandatory)][string]$Name
    )
    $definition = $Ast.Find(
        {
            param($candidate)
            $candidate -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                $candidate.Name -ceq $Name
        },
        $true
    )
    if ($null -eq $definition) { throw "Candidate builder function is unavailable: $Name" }
    return $definition.Extent.Text
}

try {
    $runtimeFiles = @(
        'pwsh.exe',
        'python.exe',
        'codex-package.json',
        'bin/codex.exe',
        'bin/codex-code-mode-host.exe',
        'codex-path/rg.exe',
        'codex-resources/codex-command-runner.exe',
        'codex-resources/codex-windows-sandbox-setup.exe',
        'psmodule/Microsoft.PowerShell.Management.psd1',
        'psmodule/Microsoft.PowerShell.Security.psd1',
        'psmodule/Security.types.ps1xml',
        'psmodule/Microsoft.PowerShell.Utility.psd1',
        'psmodule/Microsoft.PowerShell.Commands.Management.dll',
        'psmodule/Microsoft.PowerShell.Security.dll',
        'psmodule/Microsoft.PowerShell.Commands.Utility.dll'
    )
    $sourceFiles = @(
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
    $runtimeKeys = @($runtimeFiles | ForEach-Object { 'runtime/' + $_ })
    # Authenticode signer binding is publisher provenance layered on the runtime_source
    # SHA-256 pins. Upstream ripgrep ('runtime/codex-path/rg.exe') ships unsigned, so it
    # is hash-pinned only; see build_blip_candidate.ps1 for the full rationale.
    $runtimeSignerKeys = @(
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
    foreach ($relative in $runtimeFiles) {
        $path = Join-Path $runtimeRoot $relative.Replace('/', '\')
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($path)) | Out-Null
        [System.IO.File]::WriteAllText(
            $path, "fixture:$relative`n", [System.Text.UTF8Encoding]::new($false)
        )
    }

    Assert-Parses -LiteralPath $builder
    Assert-Parses -LiteralPath $builderLauncher
    Assert-Parses -LiteralPath $installerLauncher
    Assert-Parses -LiteralPath $verifier
    Assert-Parses -LiteralPath $installer
    Assert-Parses -LiteralPath $innerBootstrap

    $builderTokens = $null
    $builderErrors = $null
    $builderAst = [System.Management.Automation.Language.Parser]::ParseFile(
        $builder, [ref]$builderTokens, [ref]$builderErrors
    )
    if ($builderErrors.Count -ne 0) { throw 'Candidate builder AST is unavailable.' }

    $builderText = Get-Content -Raw -LiteralPath $builder
    Assert-True ($builderText -match 'FileSystemAclExtensions\]::CreateDirectory') `
        'Candidate builder does not atomically create its protected output root with a DACL.'
    Assert-True ($builderText -match 'function New-SafeCandidateParent') `
        'Candidate builder does not validate every target parent chain.'
    Assert-True ($builderText -match 'FileMode\]::CreateNew') `
        'Candidate builder does not exclusively create candidate files.'
    Assert-True ($builderText -match 'Read-ReviewedBuildManifest -LiteralPath') `
        'Production candidate builder does not consume the reviewed build manifest.'
    Assert-True ($builderText -match 'Runtime signer differs from the independently reviewed manifest') `
        'Production candidate builder does not bind all reviewed runtime signers.'
    $launcherText = Get-Content -Raw -LiteralPath $builderLauncher
    foreach ($required in @(
        "'-NoProfile'", "'-NonInteractive'", 'UseShellExecute = \$false',
        'ExpectedReviewedBuildManifestSha256', 'Open-PinnedReadStream',
        'startInfo.Environment.Clear\(\)'
    )) {
        Assert-True ($launcherText -match $required) `
            "Protected candidate builder launcher is missing invariant: $required"
    }
    Assert-True ($launcherText -match [regex]::Escape(
        '$fixedPowerShellPath = ''C:\Program Files\PowerShell\7\pwsh.exe'''
    )) 'Protected builder launcher does not use the exact reviewed PowerShell path.'
    Assert-True ($launcherText -match (
        "'-NoLogo', '-NoProfile', '-NonInteractive', '-File', " + [regex]::Escape('$builderPath') +
        ",[\s\S]+ '-OutputDirectory', " + [regex]::Escape('$outputRoot') +
        ", '-Production',[\s\S]+ '-ReviewedBuildManifestPath', " + [regex]::Escape('$manifestPath')
    )) `
        'Protected builder launcher argument order is not exact.'
    Assert-True ($launcherText -notmatch '(?im)\bStart-Process\b|\.Arguments\s*=|-Command|-EncodedCommand') `
        'Protected builder launcher retains a string-command or PATH-resolved execution surface.'
    $installerLauncherText = Get-Content -Raw -LiteralPath $installerLauncher
    foreach ($required in @(
        "'-NoLogo', '-NoProfile', '-NonInteractive', '-File', .*launcherPath",
        'Assert-ExactLauncherCommandLine', 'ExpectedInstallerLauncherSha256',
        'Set-LauncherSafeEnvironment', 'Read-OpenStreamBytes',
        '\[ScriptBlock\]::Create\(\$verifierText\)', 'InternalLauncherContext',
        'Open-PinnedReadStream'
    )) {
        Assert-True ($installerLauncherText -match $required) `
            "Protected installer launcher is missing invariant: $required"
    }
    Assert-True ($installerLauncherText -notmatch `
        '(?im)\bProcessStartInfo\b|\bStart-Process\b|\.Arguments\s*=|InternalCleanSession|''-Command''|''-EncodedCommand''') `
        'Protected installer launcher retains a bypass or string-command execution surface.'
    foreach ($binding in @(
        'reviewedBuild\.BuilderSha256',
        'reviewedBuild\.BuilderLauncherSha256',
        'reviewedBuild\.InstallerLauncherSha256',
        'reviewedBuild\.ExternalVerifierSha256',
        'reviewedBuild\.SourceFiles\[\$relative\]',
        'reviewedBuild\.RuntimeSource\[\$key\]',
        'reviewedBuild\.RuntimeSigners\[\$key\]',
        'SignatureStatus\]::Valid',
        'reviewedManifestSha256'
    )) {
        Assert-True ($builderText -match $binding) `
            "Candidate builder lacks reviewed provenance comparison: $binding"
    }

    $junctionTarget = Join-Path $testRoot 'junction-target'
    $junctionParent = Join-Path $testRoot 'junction-parent'
    [System.IO.Directory]::CreateDirectory($junctionTarget) | Out-Null
    [void](New-Item -ItemType Junction -Path $junctionParent -Target $junctionTarget)
    $junctionRejected = $false
    try {
        & $builder -OutputDirectory (Join-Path $junctionParent 'candidate') `
            -TestOnly -TestRuntimeRoot $runtimeRoot | Out-Null
    }
    catch {
        $junctionRejected = $_.Exception.Message -match 'reparse point'
    }
    Assert-True $junctionRejected 'Candidate builder accepted an output ancestor junction.'

    $outputOne = @(& $builder -OutputDirectory $candidateOne -TestOnly -TestRuntimeRoot $runtimeRoot)
    $outputTwo = @(& $builder -OutputDirectory $candidateTwo -TestOnly -TestRuntimeRoot $runtimeRoot)

    $freezeOnePath = Join-Path $candidateOne 'candidate-freeze.json'
    $freezeTwoPath = Join-Path $candidateTwo 'candidate-freeze.json'
    $freezeOneBytes = [System.IO.File]::ReadAllBytes($freezeOnePath)
    $freezeTwoBytes = [System.IO.File]::ReadAllBytes($freezeTwoPath)
    Assert-True ([System.Linq.Enumerable]::SequenceEqual[byte]($freezeOneBytes, $freezeTwoBytes)) `
        'Two builds from identical inputs produced different freeze bytes.'
    $freeze = Get-Content -Raw -LiteralPath $freezeOnePath | ConvertFrom-Json
    $candidateAcl = Get-Acl -LiteralPath $candidateOne
    Assert-True $candidateAcl.AreAccessRulesProtected `
        'Candidate root unexpectedly inherited a replaceable ACL.'
    Assert-True ($freeze.schema -ceq 'blip-auto-approval-candidate-freeze/v3') `
        'Candidate freeze schema is not v3.'
    Assert-ExactNames `
        -Actual @($freeze.PSObject.Properties.Name) `
        -Expected @(
            'schema', 'build_profile', 'source_commit',
            'reviewed_build_manifest_sha256', 'external_verifier_sha256',
            'source_files', 'runtime_source'
        ) `
        -Label 'Candidate freeze top-level properties'
    Assert-True ($freeze.build_profile -ceq 'TEST_ONLY') 'Test-only candidate lost its non-installable profile.'
    Assert-True ([string]$freeze.source_commit -ceq ('0' * 40)) `
        'Test-only freeze unexpectedly claims a reviewed source commit.'
    Assert-True ([string]$freeze.reviewed_build_manifest_sha256 -ceq ('0' * 64)) `
        'Test-only freeze unexpectedly claims a reviewed build manifest.'
    Assert-True (@($freeze.runtime_source.PSObject.Properties).Count -eq $runtimeFiles.Count) `
        'Candidate freeze runtime inventory is incomplete.'
    Assert-ExactNames -Actual @($freeze.source_files.PSObject.Properties.Name) `
        -Expected $sourceFiles -Label 'Candidate source inventory'
    Assert-ExactNames -Actual @($freeze.runtime_source.PSObject.Properties.Name) `
        -Expected $runtimeKeys -Label 'Candidate runtime inventory'
    foreach ($key in $runtimeKeys) {
        $fixturePath = Join-Path $runtimeRoot $key.Substring('runtime/'.Length).Replace('/', '\')
        $expectedRuntimeHash = (Get-FileHash -LiteralPath $fixturePath -Algorithm SHA256).Hash
        $actualRuntimeHash = [string]$freeze.runtime_source.PSObject.Properties[$key].Value
        Assert-True ($actualRuntimeHash -ceq $expectedRuntimeHash) `
            "Candidate runtime hash mismatch: $key"
    }
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $candidateOne 'invoke_protected_blip_installer.ps1'))) `
        'Candidate incorrectly contains its external protected verifier.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $candidateOne 'build_blip_candidate.ps1'))) `
        'Candidate incorrectly contains its builder authority.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $candidateOne 'invoke_protected_blip_candidate_builder.ps1'))) `
        'Candidate incorrectly contains its protected builder launcher authority.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $candidateOne 'invoke_protected_blip_installer_launcher.ps1'))) `
        'Candidate incorrectly contains its protected installer launcher authority.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $candidateOne 'reviewed-build-manifest.json'))) `
        'Test-only candidate incorrectly claims an independently reviewed manifest.'
    Assert-True (@(Get-ChildItem -Recurse -File -LiteralPath $candidateOne | Where-Object {
        $_.Name -like 'test_*'
    }).Count -eq 0) 'Candidate incorrectly contains executable test files.'

    $expectedVerifierHash = (Get-FileHash -LiteralPath $verifier -Algorithm SHA256).Hash
    Assert-True ([string]$freeze.external_verifier_sha256 -ceq $expectedVerifierHash) `
        'Freeze does not bind the separately protected verifier source hash.'
    foreach ($property in @($freeze.source_files.PSObject.Properties)) {
        $candidatePath = Join-Path $candidateOne $property.Name.Replace('/', '\')
        Assert-True ((Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash -ceq
            [string]$property.Value) "Candidate source hash mismatch: $($property.Name)"
    }

    $manifestFunctions = @(
        'Assert-RegularNonReparseFile',
        'Get-UniqueReviewedJsonProperty',
        'Assert-ExactReviewedJsonProperties',
        'Get-ReviewedStringMap',
        'Read-ReviewedBuildManifest'
    ) | ForEach-Object { Get-BuilderFunction -Ast $builderAst -Name $_ }
    . ([ScriptBlock]::Create(($manifestFunctions -join "`n")))
    $sourceMap = [ordered]@{}
    foreach ($name in $sourceFiles) { $sourceMap[$name] = 'aB' * 32 }
    $runtimeMap = [ordered]@{}
    foreach ($name in $runtimeKeys) { $runtimeMap[$name] = 'cD' * 32 }
    $signerMap = [ordered]@{}
    foreach ($name in $runtimeSignerKeys) { $signerMap[$name] = 'eF' * 20 }
    $validManifest = [ordered]@{
        schema = 'blip-auto-approval-reviewed-build/v2'
        source_commit = 'a' * 40
        builder_launcher_sha256 = 'bC' * 32
        builder_sha256 = 'dE' * 32
        installer_launcher_sha256 = 'aB' * 32
        external_verifier_sha256 = 'fA' * 32
        source_files = $sourceMap
        runtime_source = $runtimeMap
        runtime_signers = $signerMap
    }
    $validManifestJson = $validManifest | ConvertTo-Json -Depth 6 -Compress
    $manifestFixturePath = Join-Path $testRoot 'reviewed-build-manifest-fixture.json'

    function Assert-ReviewedManifestRejected {
        param(
            [Parameter(Mandatory)][string]$Json,
            [Parameter(Mandatory)][string]$Label
        )
        [System.IO.File]::WriteAllText(
            $manifestFixturePath, $Json, [System.Text.UTF8Encoding]::new($false)
        )
        $rejected = $false
        try { [void](Read-ReviewedBuildManifest -LiteralPath $manifestFixturePath) }
        catch { $rejected = $true }
        Assert-True $rejected "Reviewed manifest accepted invalid case: $Label"
    }

    [System.IO.File]::WriteAllText(
        $manifestFixturePath, $validManifestJson, [System.Text.UTF8Encoding]::new($false)
    )
    $parsedManifest = Read-ReviewedBuildManifest -LiteralPath $manifestFixturePath
    Assert-True ($parsedManifest.BuilderLauncherSha256 -ceq ('BC' * 32)) `
        'Reviewed manifest did not normalize mixed-case SHA-256 values.'
    Assert-True ($parsedManifest.InstallerLauncherSha256 -ceq ('AB' * 32)) `
        'Reviewed manifest did not bind the installer launcher hash.'
    Assert-True ($parsedManifest.RuntimeSigners[$runtimeSignerKeys[0]] -ceq ('EF' * 20)) `
        'Reviewed manifest did not normalize mixed-case signer thumbprints.'

    $unknownTop = $validManifest | ConvertTo-Json -Depth 6 | ConvertFrom-Json
    $unknownTop | Add-Member -NotePropertyName extra -NotePropertyValue $true
    Assert-ReviewedManifestRejected -Json ($unknownTop | ConvertTo-Json -Depth 6 -Compress) `
        -Label 'unknown top-level property'
    $missingTop = $validManifest | ConvertTo-Json -Depth 6 | ConvertFrom-Json
    $missingTop.PSObject.Properties.Remove('source_commit')
    Assert-ReviewedManifestRejected -Json ($missingTop | ConvertTo-Json -Depth 6 -Compress) `
        -Label 'missing top-level property'
    Assert-ReviewedManifestRejected `
        -Json ($validManifestJson.Replace(
            '{"schema":', '{"schema":"duplicate","schema":'
        )) -Label 'duplicate top-level property'

    foreach ($mapCase in @(
        [pscustomobject]@{ Name = 'source_files'; Keys = $sourceFiles; Width = 64 },
        [pscustomobject]@{ Name = 'runtime_source'; Keys = $runtimeKeys; Width = 64 },
        [pscustomobject]@{ Name = 'runtime_signers'; Keys = $runtimeSignerKeys; Width = 40 }
    )) {
        $firstKey = $mapCase.Keys[0]
        $unknownNested = $validManifest | ConvertTo-Json -Depth 6 | ConvertFrom-Json
        $unknownNested.$($mapCase.Name) | Add-Member `
            -NotePropertyName 'unexpected/key' -NotePropertyValue ('A' * $mapCase.Width)
        Assert-ReviewedManifestRejected `
            -Json ($unknownNested | ConvertTo-Json -Depth 6 -Compress) `
            -Label "unknown $($mapCase.Name) key"
        $missingNested = $validManifest | ConvertTo-Json -Depth 6 | ConvertFrom-Json
        $missingNested.$($mapCase.Name).PSObject.Properties.Remove($firstKey)
        Assert-ReviewedManifestRejected `
            -Json ($missingNested | ConvertTo-Json -Depth 6 -Compress) `
            -Label "missing $($mapCase.Name) key"
        $needle = '"' + $mapCase.Name + '":{'
        $duplicatePrefix = $needle + '"' + $firstKey + '":"' + ('A' * $mapCase.Width) + '",'
        Assert-ReviewedManifestRejected `
            -Json ($validManifestJson.Replace($needle, $duplicatePrefix)) `
            -Label "duplicate $($mapCase.Name) key"
    }
    $invalidHash = $validManifest | ConvertTo-Json -Depth 6 | ConvertFrom-Json
    $invalidHash.builder_sha256 = 'G' * 64
    Assert-ReviewedManifestRejected -Json ($invalidHash | ConvertTo-Json -Depth 6 -Compress) `
        -Label 'non-hex builder hash'
    $invalidCommit = $validManifest | ConvertTo-Json -Depth 6 | ConvertFrom-Json
    $invalidCommit.source_commit = 'A' * 39
    Assert-ReviewedManifestRejected -Json ($invalidCommit | ConvertTo-Json -Depth 6 -Compress) `
        -Label 'invalid source commit width'
    $zeroCommit = $validManifest | ConvertTo-Json -Depth 6 | ConvertFrom-Json
    $zeroCommit.source_commit = '0' * 40
    Assert-ReviewedManifestRejected -Json ($zeroCommit | ConvertTo-Json -Depth 6 -Compress) `
        -Label 'zero source commit'

    Assert-ExactNames `
        -Actual @(Get-BuilderLiteralArray -Ast $builderAst -Name 'runtimeSignerKeys') `
        -Expected $runtimeSignerKeys -Label 'Builder runtime signer inventory'
    Assert-ExactNames `
        -Actual @(Get-BuilderLiteralArray -Ast $builderAst -Name 'runtimeKeys') `
        -Expected $runtimeKeys -Label 'Builder runtime source inventory'
    Assert-True ($runtimeSignerKeys.Count -eq 9) `
        'Reviewed signer inventory is not the exact nine-entry contract.'
    Assert-True ($runtimeSignerKeys -cnotcontains 'runtime/codex-path/rg.exe') `
        'Unsigned upstream ripgrep must not be bound by an unobtainable Authenticode signer.'
    Assert-True ($runtimeKeys -ccontains 'runtime/codex-path/rg.exe') `
        'Unsigned upstream ripgrep lost its runtime_source SHA-256 pin.'

    $ancestorFunctions = @(
        'Get-NormalizedAncestorPath',
        'Test-LocalDriveRootPath',
        'Get-ReplacementRightsMask',
        'Assert-TrustedAncestorChain'
    ) | ForEach-Object { Get-BuilderFunction -Ast $builderAst -Name $_ }
    . ([ScriptBlock]::Create(($ancestorFunctions -join "`n")))

    # A bare 'C:' is drive-relative: Get-Acl would silently inspect the process
    # working directory instead of the drive root, so the ancestor walk must
    # normalize it back to the root form.
    Assert-True ((Get-NormalizedAncestorPath -LiteralPath 'C:') -ceq 'C:\') `
        'Ancestor walk did not normalize a bare drive specifier to the drive root.'
    Assert-True ((Get-NormalizedAncestorPath -LiteralPath 'C:\') -ceq 'C:\') `
        'Ancestor walk did not preserve the drive root form.'
    Assert-True ((Get-NormalizedAncestorPath -LiteralPath 'C:\Users\') -ceq 'C:\Users') `
        'Ancestor walk did not trim a non-root trailing separator.'
    Assert-True (Test-LocalDriveRootPath -LiteralPath 'C:\') `
        'Drive root was not recognized as the undeletable ancestor.'
    foreach ($nonRoot in @('C:\Users', 'C:', '\\server\share', '\\server\share\dir')) {
        Assert-True (-not (Test-LocalDriveRootPath -LiteralPath $nonRoot)) `
            "Rule (2) exemption incorrectly covers a deletable or renameable ancestor: $nonRoot"
    }

    $probeIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $probeTrusted = @($probeIdentity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
    $ancestorProbeRoot = Join-Path (
        [System.IO.Path]::GetPathRoot([System.IO.Path]::GetTempPath())
    ) ('blip-ancestor-probe-' + [Guid]::NewGuid().ToString('N'))
    New-ProtectedProbeDirectory -LiteralPath $ancestorProbeRoot `
        -Owner $probeIdentity.User -AllowFullControlSids $probeTrusted
    # Positive: a step0-shaped owner-protected parent whose only remaining
    # ancestor is the drive root must pass the production ancestor contract.
    Assert-TrustedAncestorChain -LiteralPath $ancestorProbeRoot -TrustedSids $probeTrusted
    # Negative: the drive-root exemption must not leak to intermediate
    # ancestors. 'Everyone' with Delete on a middle directory still fails.
    $untrustedMiddle = Join-Path $ancestorProbeRoot 'untrusted-middle'
    New-ProtectedProbeDirectory -LiteralPath $untrustedMiddle `
        -Owner $probeIdentity.User -AllowFullControlSids $probeTrusted `
        -AllowReplacementSids @('S-1-1-0')
    $untrustedLeaf = Join-Path $untrustedMiddle 'leaf'
    New-ProtectedProbeDirectory -LiteralPath $untrustedLeaf `
        -Owner $probeIdentity.User -AllowFullControlSids $probeTrusted
    $ancestorRejected = $false
    try { Assert-TrustedAncestorChain -LiteralPath $untrustedLeaf -TrustedSids $probeTrusted }
    catch { $ancestorRejected = $_.Exception.Message -match 'replacement rights on candidate output ancestor' }
    Assert-True $ancestorRejected `
        'Ancestor chain accepted an intermediate directory an untrusted SID can delete.'

    $installerText = Get-Content -Raw -LiteralPath $installer
    $innerText = Get-Content -Raw -LiteralPath $innerBootstrap
    Assert-True ($installerText -match "build_profile[\s\S]+PRODUCTION") `
        'Installer does not reject a non-production candidate profile.'
    Assert-True ($innerText -match "build_profile[\s\S]+PRODUCTION") `
        'Inner bootstrap does not reject a non-production candidate profile.'
    Assert-True ($outputOne -contains 'BLIP_CANDIDATE_PROFILE=TEST_ONLY') `
        'Builder did not emit the fixed test-only profile marker.'
    Assert-True ($outputOne -contains ('BLIP_REVIEWED_BUILD_MANIFEST_SHA256=' + ('0' * 64))) `
        'Test-only builder output did not preserve the zero reviewed-manifest sentinel.'
    Assert-True ($outputOne -contains ('BLIP_CANDIDATE_SOURCE_COMMIT=' + ('0' * 40))) `
        'Test-only builder output did not preserve the zero source-commit sentinel.'
    Assert-True (@($outputOne | Where-Object { $_ -match 'TOKEN|PASSWORD|PRIVATE.KEY' }).Count -eq 0) `
        'Builder output unexpectedly contains a secret-like label.'
    Write-Output 'candidate-builder-tests-ok (deterministic v3 freeze, inert candidate, reviewed provenance guards)'
}
finally {
    if ($null -ne $junctionParent -and (Test-Path -LiteralPath $junctionParent)) {
        Remove-Item -LiteralPath $junctionParent -Force
    }
    if ($null -ne $ancestorProbeRoot -and (Test-Path -LiteralPath $ancestorProbeRoot)) {
        Remove-Item -LiteralPath $ancestorProbeRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
