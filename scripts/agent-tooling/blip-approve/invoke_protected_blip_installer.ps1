[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [switch]$Apply,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$CandidateRoot,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedFreezeSha256,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedReviewedBuildManifestSha256,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedBootstrapSha256,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedVerifierSha256,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedInstallerLauncherSha256,

    [object]$InternalLauncherContext
)

Microsoft.PowerShell.Core\Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This internal verifier is not a public file entrypoint. The separately
# protected launcher reads it from a pinned stream, verifies its hash and AST,
# then invokes those bytes in the same clean process with a process-local proof.
$fixedPowerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
$fixedPowerShellDllPath = 'C:\Program Files\PowerShell\7\pwsh.dll'
$fixedPowerShellHash = 'A7AD362B22E0E289772CCCF78C7AF3B99E32F3084E675392E4A9FFDDF380BF05'
$fixedPowerShellVersion = '7.5.4.500'
$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
$fixedOwnerLogin = 'monkey1sai'
$fixedOwnerId = [long]26239865
$fixedReviewerLogin = 'monkey1sai-blip'
$fixedReviewerId = [long]311287868
$candidateRoot = [System.IO.Path]::GetFullPath($CandidateRoot).TrimEnd('\')
$verifierPath = $null
$packageRoot = $null
$installerLauncherPath = $null
$bootstrapPath = [System.IO.Path]::Combine($candidateRoot, 'invoke_frozen_blip_installer.ps1')
$reviewedManifestPath = [System.IO.Path]::Combine($candidateRoot, 'reviewed-build-manifest.json')
$verifierStream = $null
$bootstrapStream = $null
$reviewedManifestStream = $null
$installerLauncherStream = $null
$bootstrapBytes = $null
$reviewedManifestBytes = $null
$reviewedSourceFiles = @(
    'install_blip_auto_approval.ps1',
    'invoke_frozen_blip_installer.ps1',
    'scripts/lib/StructLog.psm1',
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
$reviewedRuntimeKeys = @(
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
$reviewedSignerKeys = @(
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

function Assert-NoReparseChain {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [switch]$LeafMustBeFile,
        [switch]$LeafMustBeDirectory
    )
    $full = [System.IO.Path]::GetFullPath($LiteralPath)
    if ($LeafMustBeFile -and -not [System.IO.File]::Exists($full)) {
        throw "Required verifier input is unavailable: $full"
    }
    if ($LeafMustBeDirectory -and -not [System.IO.Directory]::Exists($full)) {
        throw "Required candidate directory is unavailable: $full"
    }
    $root = [System.IO.Path]::GetPathRoot($full)
    $cursor = $full.TrimEnd('\')
    while ($true) {
        if (([System.IO.File]::GetAttributes($cursor) -band
            [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Verifier input resolves through a reparse point: $full"
        }
        if ($cursor.TrimEnd('\') -ceq $root.TrimEnd('\')) { break }
        $parent = [System.IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { throw "Verifier input has an invalid ancestor chain: $full" }
        $cursor = $parent.FullName
    }
    return $full
}

function Open-ExclusiveReadStream {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][long]$MaximumLength
    )
    $path = Assert-NoReparseChain -LiteralPath $LiteralPath -LeafMustBeFile
    $stream = [System.IO.FileStream]::new(
        $path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None, 65536, [System.IO.FileOptions]::SequentialScan
    )
    if ($stream.Length -le 0 -or $stream.Length -gt $MaximumLength) {
        $stream.Dispose()
        throw "Verifier input length is outside the protected bound: $path"
    }
    return $stream
}

function Assert-PinnedReadStream {
    param(
        [Parameter(Mandatory)][System.IO.FileStream]$Stream,
        [Parameter(Mandatory)][string]$ExpectedPath
    )
    if (-not $Stream.CanRead -or $Stream.SafeFileHandle.IsClosed -or
        [System.IO.Path]::GetFullPath($Stream.Name) -cne $ExpectedPath) {
        throw "The public launcher did not retain the expected protected stream: $ExpectedPath"
    }
    $writer = $null
    $blocked = $false
    try {
        $writer = [System.IO.FileStream]::new(
            $ExpectedPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::ReadWrite
        )
    }
    catch [System.IO.IOException] { $blocked = $true }
    finally { if ($null -ne $writer) { $writer.Dispose() } }
    if (-not $blocked) {
        throw "Protected launcher input is writable while pinned: $ExpectedPath"
    }
}

function Get-OpenStreamSha256 {
    param([Parameter(Mandatory)][System.IO.FileStream]$Stream)
    $position = $Stream.Position
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $Stream.Position = 0
        return [Convert]::ToHexString($sha.ComputeHash($Stream))
    }
    finally { $Stream.Position = $position; $sha.Dispose() }
}

function Read-OpenStreamBytes {
    param([Parameter(Mandatory)][System.IO.FileStream]$Stream)
    $bytes = [byte[]]::new([int]$Stream.Length)
    $Stream.Position = 0
    $offset = 0
    while ($offset -lt $bytes.Length) {
        $read = $Stream.Read($bytes, $offset, $bytes.Length - $offset)
        if ($read -le 0) { throw "Verifier input ended early: $($Stream.Name)" }
        $offset += $read
    }
    $Stream.Position = 0
    return ,$bytes
}

function Assert-ExactLauncherProcessCommandLine {
    $expected = @(
        $fixedPowerShellDllPath,
        '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $installerLauncherPath,
        '-Apply', '-CandidateRoot', $candidateRoot,
        '-ExpectedFreezeSha256', $ExpectedFreezeSha256.ToUpperInvariant(),
        '-ExpectedReviewedBuildManifestSha256',
        $ExpectedReviewedBuildManifestSha256.ToUpperInvariant(),
        '-ExpectedBootstrapSha256', $ExpectedBootstrapSha256.ToUpperInvariant(),
        '-ExpectedVerifierSha256', $ExpectedVerifierSha256.ToUpperInvariant(),
        '-ExpectedInstallerLauncherSha256',
        $ExpectedInstallerLauncherSha256.ToUpperInvariant()
    )
    $actual = [Environment]::GetCommandLineArgs()
    if ($actual.Count -ne $expected.Count) {
        throw 'The internal verifier is not running inside the exact protected launcher process.'
    }
    for ($index = 0; $index -lt $expected.Count; $index += 1) {
        if ($actual[$index] -cne $expected[$index]) {
            throw 'The internal verifier is not running inside the exact protected launcher process.'
        }
    }
}

function Assert-InternalLauncherContext {
    param([object]$Context)
    if ($null -eq $Context -or
        $Context -isnot [System.Management.Automation.PSCustomObject]) {
        throw 'The internal verifier requires a process-local protected launcher context.'
    }
    $expectedNames = @(
        'Schema', 'Capability', 'ProofEcho', 'CandidateRoot', 'FreezeSha256',
        'ReviewedBuildManifestSha256', 'BootstrapSha256',
        'InstallerLauncherPath', 'InstallerLauncherSha256', 'InstallerLauncherStream',
        'VerifierPath', 'VerifierSha256', 'VerifierStream', 'HostPid', 'HostPath'
    )
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($property in $Context.PSObject.Properties) {
        if (-not $seen.Add($property.Name) -or
            $expectedNames -cnotcontains $property.Name) {
            throw 'The internal protected launcher context schema is invalid.'
        }
    }
    if ($seen.Count -ne $expectedNames.Count) {
        throw 'The internal protected launcher context schema is invalid.'
    }
    foreach ($name in $expectedNames) {
        if (-not $seen.Contains($name)) {
            throw 'The internal protected launcher context schema is invalid.'
        }
    }
    if ($Context.Schema -cne 'blip-installer-launcher-context/v1' -or
        $null -eq $Context.Capability -or
        -not [object]::ReferenceEquals($Context.Capability, $Context.ProofEcho) -or
        $Context.CandidateRoot -cne $candidateRoot -or
        $Context.FreezeSha256 -cne $ExpectedFreezeSha256.ToUpperInvariant() -or
        $Context.ReviewedBuildManifestSha256 -cne
            $ExpectedReviewedBuildManifestSha256.ToUpperInvariant() -or
        $Context.BootstrapSha256 -cne $ExpectedBootstrapSha256.ToUpperInvariant() -or
        $Context.InstallerLauncherSha256 -cne
            $ExpectedInstallerLauncherSha256.ToUpperInvariant() -or
        $Context.VerifierSha256 -cne $ExpectedVerifierSha256.ToUpperInvariant() -or
        $Context.HostPid -ne [Environment]::ProcessId -or
        $Context.HostPath -cne $fixedPowerShellPath -or
        $Context.InstallerLauncherStream -isnot [System.IO.FileStream] -or
        $Context.VerifierStream -isnot [System.IO.FileStream]) {
        throw 'The internal protected launcher context proof is invalid.'
    }
    $contextLauncherPath = [System.IO.Path]::GetFullPath($Context.InstallerLauncherPath)
    $contextVerifierPath = [System.IO.Path]::GetFullPath($Context.VerifierPath)
    $contextPackageRoot = [System.IO.Path]::GetDirectoryName($contextVerifierPath)
    if ($contextLauncherPath -cne [System.IO.Path]::Combine(
            $contextPackageRoot, 'invoke_protected_blip_installer_launcher.ps1'
        ) -or
        $contextVerifierPath -cne [System.IO.Path]::Combine(
            $contextPackageRoot, 'invoke_protected_blip_installer.ps1'
        )) {
        throw 'The internal protected launcher context paths are invalid.'
    }
    return [pscustomobject]@{
        InstallerLauncherPath = $contextLauncherPath
        VerifierPath = $contextVerifierPath
        PackageRoot = $contextPackageRoot
    }
}

function Get-UniqueVerifierJsonProperty {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string]$Name
    )
    if ($Object.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw "Reviewed build manifest member is not an object: $Name"
    }
    $count = 0
    $match = [System.Text.Json.JsonElement]::new()
    foreach ($property in $Object.EnumerateObject()) {
        if ($property.Name -ceq $Name) { $count += 1; $match = $property.Value.Clone() }
    }
    if ($count -ne 1) {
        throw "Reviewed build manifest must contain exactly one property named $Name."
    }
    return $match
}

function Assert-ExactVerifierJsonProperties {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string[]]$ExpectedNames,
        [Parameter(Mandatory)][string]$Label
    )
    if ($Object.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw "$Label is not a JSON object."
    }
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($property in $Object.EnumerateObject()) {
        if (-not $seen.Add($property.Name)) { throw "$Label contains a duplicate property." }
        if ($ExpectedNames -cnotcontains $property.Name) { throw "$Label contains an unknown property." }
    }
    if ($seen.Count -ne $ExpectedNames.Count) { throw "$Label is missing a required property." }
    foreach ($name in $ExpectedNames) {
        if (-not $seen.Contains($name)) { throw "$Label is missing a required property." }
    }
}

function Assert-ExactVerifierStringMap {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string[]]$ExpectedNames,
        [Parameter(Mandatory)][string]$Pattern,
        [Parameter(Mandatory)][string]$Label
    )
    Assert-ExactVerifierJsonProperties -Object $Object -ExpectedNames $ExpectedNames -Label $Label
    foreach ($name in $ExpectedNames) {
        $value = Get-UniqueVerifierJsonProperty -Object $Object -Name $name
        if ($value.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $value.GetString() -notmatch $Pattern) {
            throw "$Label contains an invalid value for $name."
        }
    }
}

function Assert-ReviewedManifestAuthority {
    param([Parameter(Mandatory)][byte[]]$Bytes)
    [void][System.Text.UTF8Encoding]::new($false, $true).GetString($Bytes)
    $document = [System.Text.Json.JsonDocument]::Parse([ReadOnlyMemory[byte]]::new($Bytes))
    try {
        $root = $document.RootElement
        Assert-ExactVerifierJsonProperties -Object $root -ExpectedNames @(
            'schema', 'source_commit', 'builder_launcher_sha256', 'builder_sha256',
            'installer_launcher_sha256', 'external_verifier_sha256',
            'source_files', 'runtime_source', 'runtime_signers'
        ) -Label 'Reviewed build manifest'
        $schema = Get-UniqueVerifierJsonProperty -Object $root -Name 'schema'
        $sourceCommit = Get-UniqueVerifierJsonProperty -Object $root -Name 'source_commit'
        $builderLauncherHash = Get-UniqueVerifierJsonProperty `
            -Object $root -Name 'builder_launcher_sha256'
        $builderHash = Get-UniqueVerifierJsonProperty -Object $root -Name 'builder_sha256'
        $installerLauncherHash = Get-UniqueVerifierJsonProperty `
            -Object $root -Name 'installer_launcher_sha256'
        $verifierHash = Get-UniqueVerifierJsonProperty -Object $root -Name 'external_verifier_sha256'
        if ($schema.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $schema.GetString() -cne 'blip-auto-approval-reviewed-build/v2' -or
            $sourceCommit.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $sourceCommit.GetString() -notmatch '^[0-9a-fA-F]{40}$' -or
            $sourceCommit.GetString() -eq ('0' * 40) -or
            $builderLauncherHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $builderLauncherHash.GetString() -notmatch '^[0-9a-fA-F]{64}$' -or
            $builderHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $builderHash.GetString() -notmatch '^[0-9a-fA-F]{64}$' -or
            $installerLauncherHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $installerLauncherHash.GetString().ToUpperInvariant() -cne
                $ExpectedInstallerLauncherSha256.ToUpperInvariant() -or
            $verifierHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $verifierHash.GetString().ToUpperInvariant() -cne
                $ExpectedVerifierSha256.ToUpperInvariant()) {
            throw 'Reviewed build manifest authority fields are invalid.'
        }
        $sourceObject = Get-UniqueVerifierJsonProperty -Object $root -Name 'source_files'
        Assert-ExactVerifierStringMap -Object $sourceObject -ExpectedNames $reviewedSourceFiles `
            -Pattern '^[0-9a-fA-F]{64}$' -Label 'Reviewed source_files'
        $bootstrapHash = Get-UniqueVerifierJsonProperty `
            -Object $sourceObject -Name 'invoke_frozen_blip_installer.ps1'
        if ($bootstrapHash.GetString().ToUpperInvariant() -cne
            $ExpectedBootstrapSha256.ToUpperInvariant()) {
            throw 'Reviewed build manifest does not authorize the candidate bootstrap.'
        }
        Assert-ExactVerifierStringMap `
            -Object (Get-UniqueVerifierJsonProperty -Object $root -Name 'runtime_source') `
            -ExpectedNames $reviewedRuntimeKeys -Pattern '^[0-9a-fA-F]{64}$' `
            -Label 'Reviewed runtime_source'
        Assert-ExactVerifierStringMap `
            -Object (Get-UniqueVerifierJsonProperty -Object $root -Name 'runtime_signers') `
            -ExpectedNames $reviewedSignerKeys -Pattern '^[0-9a-fA-F]{40}$' `
            -Label 'Reviewed runtime_signers'
        return $sourceCommit.GetString().ToLowerInvariant()
    }
    finally { $document.Dispose() }
}

function Read-BoundedUtf8Response {
    param(
        [Parameter(Mandatory)][System.IO.Stream]$Stream,
        [Parameter(Mandatory)][int]$MaximumBytes,
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][System.Threading.CancellationToken]$CancellationToken
    )
    $buffer = [byte[]]::new(65536)
    $output = [System.IO.MemoryStream]::new()
    try {
        while ($true) {
            $read = $Stream.ReadAsync(
                $buffer, 0, $buffer.Length, $CancellationToken
            ).GetAwaiter().GetResult()
            if ($read -eq 0) { break }
            if ($output.Length + $read -gt $MaximumBytes) {
                throw "$Label exceeds the protected size limit."
            }
            $output.Write($buffer, 0, $read)
        }
        if ($output.Length -eq 0) { throw "$Label is empty." }
        return [System.Text.UTF8Encoding]::new($false, $true).GetString($output.ToArray())
    }
    finally { $output.Dispose() }
}

function Invoke-ProtectedPublicGitHubGet {
    param([Parameter(Mandatory)][string]$RelativePath)
    if ($RelativePath -notmatch ('^/repos/monkey1sai/AI-BIM-governance/(commits/heads/main' +
        '|compare/[0-9a-f]{40}\.\.\.[0-9a-f]{40}' +
        '|commits/[0-9a-f]{40}/pulls\?per_page=100&page=(?:[1-9]|10)' +
        '|pulls/[1-9][0-9]{0,5}' +
        '|pulls/[1-9][0-9]{0,5}/reviews\?per_page=100&page=(?:[1-9]|10))$')) {
        throw 'Merged-source verification requested an unauthorized GitHub path.'
    }
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler, $true)
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Get,
        "https://api.github.com$RelativePath"
    )
    try {
        [void]$request.Headers.TryAddWithoutValidation('Accept', 'application/vnd.github+json')
        [void]$request.Headers.TryAddWithoutValidation('X-GitHub-Api-Version', '2022-11-28')
        [void]$request.Headers.TryAddWithoutValidation('User-Agent', 'blip-protected-installer/1.0')
        $response = $client.Send(
            $request,
            [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
        )
        try {
            if (-not $response.IsSuccessStatusCode) {
                throw "Merged-source GitHub verification failed with HTTP $([int]$response.StatusCode)."
            }
            $length = $response.Content.Headers.ContentLength
            if ($null -ne $length -and $length -gt 1048576) {
                throw 'Merged-source GitHub response exceeds the protected size limit.'
            }
            $contentStream = $response.Content.ReadAsStream()
            $bodyDeadline = [System.Threading.CancellationTokenSource]::new(
                [TimeSpan]::FromSeconds(60)
            )
            try {
                return Read-BoundedUtf8Response -Stream $contentStream -MaximumBytes 1048576 `
                    -Label 'Merged-source GitHub response' `
                    -CancellationToken $bodyDeadline.Token
            }
            finally {
                $bodyDeadline.Dispose()
                $contentStream.Dispose()
            }
        }
        finally { $response.Dispose() }
    }
    finally {
        $request.Dispose()
        $client.Dispose()
    }
}

function Get-ProtectedPublicGitHubArrayPages {
    param(
        [Parameter(Mandatory)][string]$RelativePath,
        [Parameter(Mandatory)][string]$Label
    )
    $items = [System.Collections.Generic.List[System.Text.Json.JsonElement]]::new()
    foreach ($page in 1..10) {
        $document = [System.Text.Json.JsonDocument]::Parse(
            (Invoke-ProtectedPublicGitHubGet `
                -RelativePath "${RelativePath}?per_page=100&page=$page")
        )
        try {
            if ($document.RootElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) {
                throw "$Label response is not a JSON array."
            }
            $pageCount = $document.RootElement.GetArrayLength()
            foreach ($item in $document.RootElement.EnumerateArray()) {
                [void]$items.Add($item.Clone())
            }
            if ($pageCount -lt 100) { return $items.ToArray() }
        }
        finally { $document.Dispose() }
    }
    throw "$Label pagination exceeded the protected page limit."
}

function Assert-MergedSourceCommit {
    param([Parameter(Mandatory)][string]$SourceCommit)
    $source = $SourceCommit.ToLowerInvariant()
    if ($source -notmatch '^[0-9a-f]{40}$' -or $source -ceq ('0' * 40)) {
        throw 'Merged-source verification received an invalid source commit.'
    }
    $mainDocument = $null
    $finalMainDocument = $null
    $compareDocument = $null
    try {
        $mainDocument = [System.Text.Json.JsonDocument]::Parse(
            (Invoke-ProtectedPublicGitHubGet `
                -RelativePath '/repos/monkey1sai/AI-BIM-governance/commits/heads/main')
        )
        $mainSha = Get-UniqueVerifierJsonProperty -Object $mainDocument.RootElement -Name 'sha'
        if ($mainSha.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $mainSha.GetString() -notmatch '^[0-9a-fA-F]{40}$') {
            throw 'Protected main response has no valid exact commit.'
        }
        $main = $mainSha.GetString().ToLowerInvariant()
        $approvalEvidence = Assert-CountedApprovalForSource `
            -SourceCommit $source -PassThruEvidence
        $mergeCommit = $approvalEvidence.MergeCommit
        $finalMainDocument = [System.Text.Json.JsonDocument]::Parse(
            (Invoke-ProtectedPublicGitHubGet `
                -RelativePath '/repos/monkey1sai/AI-BIM-governance/commits/heads/main')
        )
        $finalMainSha = Get-UniqueVerifierJsonProperty `
            -Object $finalMainDocument.RootElement -Name 'sha'
        if ($finalMainSha.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $finalMainSha.GetString() -notmatch '^[0-9a-fA-F]{40}$' -or
            $finalMainSha.GetString().ToLowerInvariant() -cne $main) {
            throw 'Protected main changed during merged-source verification.'
        }
        $compareDocument = [System.Text.Json.JsonDocument]::Parse(
            (Invoke-ProtectedPublicGitHubGet `
                -RelativePath "/repos/monkey1sai/AI-BIM-governance/compare/$mergeCommit...$main")
        )
        $status = Get-UniqueVerifierJsonProperty -Object $compareDocument.RootElement -Name 'status'
        $base = Get-UniqueVerifierJsonProperty -Object $compareDocument.RootElement -Name 'base_commit'
        $mergeBase = Get-UniqueVerifierJsonProperty -Object $compareDocument.RootElement -Name 'merge_base_commit'
        $baseSha = Get-UniqueVerifierJsonProperty -Object $base -Name 'sha'
        $mergeBaseSha = Get-UniqueVerifierJsonProperty -Object $mergeBase -Name 'sha'
        if ($status.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $status.GetString() -cnotin @('ahead', 'identical') -or
            $baseSha.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $baseSha.GetString().ToLowerInvariant() -cne $mergeCommit -or
            $mergeBaseSha.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $mergeBaseSha.GetString().ToLowerInvariant() -cne $mergeCommit) {
            throw 'Reviewed pull request merge commit is not reachable from the current protected main branch.'
        }
        return $source
    }
    finally {
        if ($null -ne $compareDocument) { $compareDocument.Dispose() }
        if ($null -ne $finalMainDocument) { $finalMainDocument.Dispose() }
        if ($null -ne $mainDocument) { $mainDocument.Dispose() }
    }
}

function Assert-CountedApprovalForSource {
    # Git ancestry alone also accepts an admin push or a temporary protection
    # bypass, so the reviewed source must additionally be the merge product of
    # exactly one pull request whose latest decisive fixed-reviewer review is a
    # counted APPROVED bound to that pull request's exact merged head.
    param(
        [Parameter(Mandatory)][string]$SourceCommit,
        [switch]$PassThruEvidence
    )
    $source = $SourceCommit.ToLowerInvariant()
    if ($source -notmatch '^[0-9a-f]{40}$' -or $source -ceq ('0' * 40)) {
        throw 'Counted-approval verification received an invalid source commit.'
    }
    $associatedPulls = Get-ProtectedPublicGitHubArrayPages `
        -RelativePath "/repos/monkey1sai/AI-BIM-governance/commits/$source/pulls" `
        -Label 'Merged-source pull-request listing'
    $candidateNumbers = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($pull in $associatedPulls) {
        if ($pull.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
            throw 'Merged-source pull-request entry is malformed.'
        }
        $head = Get-UniqueVerifierJsonProperty -Object $pull -Name 'head'
        if ($head.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
            throw 'Merged-source pull-request head is malformed.'
        }
        $headSha = Get-UniqueVerifierJsonProperty -Object $head -Name 'sha'
        if ($headSha.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $headSha.GetString() -notmatch '^[0-9a-fA-F]{40}$') {
            throw 'Merged-source pull-request head is malformed.'
        }
        if ($headSha.GetString().ToLowerInvariant() -cne $source) { continue }
        $number = Get-UniqueVerifierJsonProperty -Object $pull -Name 'number'
        [int]$pullNumber = 0
        if ($number.ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or
            -not $number.TryGetInt32([ref]$pullNumber) -or
            $pullNumber -lt 1 -or $pullNumber -gt 999999) {
            throw 'Merged-source pull request number is invalid.'
        }
        [void]$candidateNumbers.Add($pullNumber)
    }
    if ($candidateNumbers.Count -eq 0) {
        throw 'Reviewed source commit has no exact-head pull request; counted-approval provenance is absent.'
    }

    $qualifiedPulls = [System.Collections.Generic.List[object]]::new()
    foreach ($pullNumber in $candidateNumbers) {
        $detailDocument = [System.Text.Json.JsonDocument]::Parse(
            (Invoke-ProtectedPublicGitHubGet `
                -RelativePath "/repos/monkey1sai/AI-BIM-governance/pulls/$pullNumber")
        )
        try {
            $detail = $detailDocument.RootElement
            if ($detail.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
                throw 'Merged-source pull-request detail is malformed.'
            }
            $number = Get-UniqueVerifierJsonProperty -Object $detail -Name 'number'
            $state = Get-UniqueVerifierJsonProperty -Object $detail -Name 'state'
            $merged = Get-UniqueVerifierJsonProperty -Object $detail -Name 'merged'
            $mergedAt = Get-UniqueVerifierJsonProperty -Object $detail -Name 'merged_at'
            $mergeCommit = Get-UniqueVerifierJsonProperty -Object $detail -Name 'merge_commit_sha'
            $base = Get-UniqueVerifierJsonProperty -Object $detail -Name 'base'
            $baseRef = Get-UniqueVerifierJsonProperty -Object $base -Name 'ref'
            $head = Get-UniqueVerifierJsonProperty -Object $detail -Name 'head'
            $headSha = Get-UniqueVerifierJsonProperty -Object $head -Name 'sha'
            $mergedBy = Get-UniqueVerifierJsonProperty -Object $detail -Name 'merged_by'
            if ($mergedBy.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { continue }
            $mergedByLogin = Get-UniqueVerifierJsonProperty -Object $mergedBy -Name 'login'
            $mergedById = Get-UniqueVerifierJsonProperty -Object $mergedBy -Name 'id'
            $mergedByType = Get-UniqueVerifierJsonProperty -Object $mergedBy -Name 'type'
            [int]$detailNumber = 0
            [long]$mergerId = 0
            [DateTimeOffset]$mergedAtValue = [DateTimeOffset]::MinValue
            if ($number.ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or
                -not $number.TryGetInt32([ref]$detailNumber) -or $detailNumber -ne $pullNumber -or
                $state.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $state.GetString() -cne 'closed' -or
                $merged.ValueKind -ne [System.Text.Json.JsonValueKind]::True -or
                $mergedAt.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                -not [DateTimeOffset]::TryParse(
                    $mergedAt.GetString(), [Globalization.CultureInfo]::InvariantCulture,
                    [Globalization.DateTimeStyles]::RoundtripKind, [ref]$mergedAtValue
                ) -or
                $mergeCommit.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $mergeCommit.GetString() -notmatch '^[0-9a-fA-F]{40}$' -or
                $baseRef.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $baseRef.GetString() -cne 'main' -or
                $headSha.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $headSha.GetString().ToLowerInvariant() -cne $source -or
                $mergedByLogin.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $mergedByLogin.GetString() -cne $fixedOwnerLogin -or
                $mergedById.ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or
                -not $mergedById.TryGetInt64([ref]$mergerId) -or $mergerId -ne $fixedOwnerId -or
                $mergedByType.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $mergedByType.GetString() -cne 'User') { continue }
            [void]$qualifiedPulls.Add([pscustomobject]@{
                Number = $detailNumber
                MergeCommit = $mergeCommit.GetString().ToLowerInvariant()
                MergedAt = $mergedAtValue
            })
        }
        finally { $detailDocument.Dispose() }
    }
    if ($qualifiedPulls.Count -eq 0) {
        throw 'Reviewed source has no completed owner merge into protected main.'
    }
    if ($qualifiedPulls.Count -ne 1) {
        throw 'Multiple pull requests claim the exact reviewed source; refusing ambiguous approval evidence.'
    }
    $mergedPull = $qualifiedPulls[0]
    $reviews = Get-ProtectedPublicGitHubArrayPages `
        -RelativePath "/repos/monkey1sai/AI-BIM-governance/pulls/$($mergedPull.Number)/reviews" `
        -Label 'Merged-source review listing'
    [DateTimeOffset]$latestSubmitted = [DateTimeOffset]::MinValue
    [long]$latestReviewId = -1
    $latestState = ''
    $latestCommit = ''
    foreach ($review in $reviews) {
        if ($review.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
            throw 'Merged-source review entry is malformed.'
        }
        $state = Get-UniqueVerifierJsonProperty -Object $review -Name 'state'
        if ($state.ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
            throw 'Merged-source review state is malformed.'
        }
        $stateValue = $state.GetString()
        if ($stateValue -cnotin @('APPROVED', 'CHANGES_REQUESTED', 'DISMISSED')) { continue }
        $user = Get-UniqueVerifierJsonProperty -Object $review -Name 'user'
        if ($user.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { continue }
        $login = Get-UniqueVerifierJsonProperty -Object $user -Name 'login'
        if ($login.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $login.GetString() -cne $fixedReviewerLogin) { continue }
        $userId = Get-UniqueVerifierJsonProperty -Object $user -Name 'id'
        $userType = Get-UniqueVerifierJsonProperty -Object $user -Name 'type'
        [long]$userIdValue = 0
        if ($userId.ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or
            -not $userId.TryGetInt64([ref]$userIdValue) -or
            $userIdValue -ne $fixedReviewerId -or
            $userType.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $userType.GetString() -cne 'User') {
            throw 'Merged-source fixed-reviewer identity is malformed.'
        }
        $submitted = Get-UniqueVerifierJsonProperty -Object $review -Name 'submitted_at'
        $reviewIdElement = Get-UniqueVerifierJsonProperty -Object $review -Name 'id'
        $commitId = Get-UniqueVerifierJsonProperty -Object $review -Name 'commit_id'
        [DateTimeOffset]$submittedValue = [DateTimeOffset]::MinValue
        [long]$reviewIdValue = 0
        if ($submitted.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            -not [DateTimeOffset]::TryParse(
                $submitted.GetString(), [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::RoundtripKind, [ref]$submittedValue
            ) -or
            $reviewIdElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or
            -not $reviewIdElement.TryGetInt64([ref]$reviewIdValue) -or
            $commitId.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $commitId.GetString() -notmatch '^[0-9a-fA-F]{40}$') {
            throw 'Merged-source fixed-reviewer review evidence is malformed.'
        }
        if ($submittedValue -gt $latestSubmitted -or
            ($submittedValue -eq $latestSubmitted -and $reviewIdValue -gt $latestReviewId)) {
            $latestSubmitted = $submittedValue
            $latestReviewId = $reviewIdValue
            $latestState = $stateValue
            $latestCommit = $commitId.GetString().ToLowerInvariant()
        }
    }
    if ($latestState -cne 'APPROVED') {
        throw 'The latest decisive fixed-reviewer review on the merged pull request is not a counted APPROVED.'
    }
    if ($latestCommit -cne $source) {
        throw 'The counted APPROVED review is not bound to the exact reviewed source head.'
    }
    if ($latestSubmitted -gt $mergedPull.MergedAt) {
        throw 'The counted exact-head approval was submitted after the pull request merge.'
    }
    # GitHub permits an existing review summary body to be edited without changing
    # submitted_at. The body therefore remains broker output/audit metadata, not
    # installation authority; exact reviewer/state/commit/time are the immutable proof.
    $evidence = [pscustomobject]@{
        Number = $mergedPull.Number
        MergeCommit = $mergedPull.MergeCommit
        MergedAt = $mergedPull.MergedAt
    }
    if ($PassThruEvidence) { return $evidence }
    return $evidence.Number
}

try {
    if (-not $Apply) { throw 'Protected installation requires the explicit -Apply capability.' }
    if (-not [string]::IsNullOrEmpty($PSCommandPath) -or
        -not [string]::IsNullOrEmpty($PSScriptRoot)) {
        throw 'The internal verifier must be loaded from pinned bytes by the protected launcher.'
    }
    $launcherAuthority = Assert-InternalLauncherContext -Context $InternalLauncherContext
    $installerLauncherPath = $launcherAuthority.InstallerLauncherPath
    $verifierPath = $launcherAuthority.VerifierPath
    $packageRoot = $launcherAuthority.PackageRoot
    $installerLauncherStream = $InternalLauncherContext.InstallerLauncherStream
    $verifierStream = $InternalLauncherContext.VerifierStream
    Assert-ExactLauncherProcessCommandLine
    if ($ExecutionContext.SessionState.LanguageMode -ne
        [System.Management.Automation.PSLanguageMode]::FullLanguage) {
        throw 'The protected verifier requires an unmodified FullLanguage owner process.'
    }
    if ([System.IO.Path]::GetFullPath([Environment]::ProcessPath) -cne $fixedPowerShellPath -or
        [System.Diagnostics.FileVersionInfo]::GetVersionInfo($fixedPowerShellPath).FileVersion -cne
            $fixedPowerShellVersion) {
        throw 'The protected verifier host differs from the reviewed PowerShell host.'
    }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The protected verifier identity is not the immutable owner SID.'
    }
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier])
    foreach ($group in $identity.Groups) {
        if ($group.Value -ceq $sandboxSid.Value) {
            throw 'The protected verifier cannot run as a CodexSandboxUsers member.'
        }
    }
    if ($packageRoot.StartsWith($candidateRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        [StringComparer]::OrdinalIgnoreCase.Equals($packageRoot, $candidateRoot)) {
        throw 'The protected verifier and launcher must be outside the candidate directory.'
    }
    [void](Assert-NoReparseChain -LiteralPath $candidateRoot -LeafMustBeDirectory)
    [void](Assert-NoReparseChain -LiteralPath $fixedPowerShellPath -LeafMustBeFile)
    [void](Assert-NoReparseChain -LiteralPath $installerLauncherPath -LeafMustBeFile)
    [void](Assert-NoReparseChain -LiteralPath $verifierPath -LeafMustBeFile)

    $hostStream = [System.IO.FileStream]::new(
        $fixedPowerShellPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read
    )
    try {
        if ((Get-OpenStreamSha256 -Stream $hostStream) -cne $fixedPowerShellHash) {
            throw 'The protected verifier host hash differs from the reviewed host.'
        }
    }
    finally { $hostStream.Dispose() }

    Assert-PinnedReadStream -Stream $installerLauncherStream `
        -ExpectedPath $installerLauncherPath
    if ((Get-OpenStreamSha256 -Stream $installerLauncherStream) -cne
        $ExpectedInstallerLauncherSha256.ToUpperInvariant()) {
        throw 'The protected installer launcher differs from the explicitly authorized hash.'
    }
    Assert-PinnedReadStream -Stream $verifierStream -ExpectedPath $verifierPath
    if ((Get-OpenStreamSha256 -Stream $verifierStream) -cne
        $ExpectedVerifierSha256.ToUpperInvariant()) {
        throw 'The running external verifier differs from the explicitly authorized hash.'
    }
    $bootstrapStream = Open-ExclusiveReadStream -LiteralPath $bootstrapPath -MaximumLength 1048576
    if ((Get-OpenStreamSha256 -Stream $bootstrapStream) -cne
        $ExpectedBootstrapSha256.ToUpperInvariant()) {
        throw 'The candidate bootstrap differs from the explicitly authorized hash.'
    }
    $reviewedManifestStream = Open-ExclusiveReadStream `
        -LiteralPath $reviewedManifestPath -MaximumLength 1048576
    if ((Get-OpenStreamSha256 -Stream $reviewedManifestStream) -cne
        $ExpectedReviewedBuildManifestSha256.ToUpperInvariant()) {
        throw 'The candidate reviewed build manifest differs from the explicitly authorized hash.'
    }
    $reviewedManifestBytes = Read-OpenStreamBytes -Stream $reviewedManifestStream
    $reviewedSourceCommit = Assert-ReviewedManifestAuthority -Bytes $reviewedManifestBytes
    [void](Assert-MergedSourceCommit -SourceCommit $reviewedSourceCommit)
    $bootstrapBytes = Read-OpenStreamBytes -Stream $bootstrapStream
    $bootstrapText = [System.Text.UTF8Encoding]::new($false, $true).GetString($bootstrapBytes)
    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput(
        $bootstrapText, [ref]$tokens, [ref]$parseErrors
    )
    if ($parseErrors.Count -ne 0 -or $null -eq $ast.ParamBlock) {
        throw 'The authorized candidate bootstrap is not a valid parameterized PowerShell script.'
    }
    $parameterNames = [System.Collections.Generic.List[string]]::new()
    foreach ($parameter in $ast.ParamBlock.Parameters) {
        $parameterNames.Add($parameter.Name.VariablePath.UserPath)
    }
    $contractMatches = $parameterNames.Count -eq 5
    foreach ($required in @(
        'CandidateRoot', 'ExpectedFreezeSha256',
        'ExpectedReviewedBuildManifestSha256', 'ExpectedBootstrapSha256',
        'InternalLoaderContext'
    )) {
        if ($parameterNames -cnotcontains $required) { $contractMatches = $false }
    }
    if (-not $contractMatches) {
        throw 'The authorized candidate bootstrap parameter contract is invalid.'
    }

    $capability = [object]::new()
    $context = [pscustomobject]@{
        Schema = 'blip-installer-root-loader/v4'
        Capability = $capability
        ProofEcho = $capability
        CandidateRoot = $candidateRoot
        FreezeSha256 = $ExpectedFreezeSha256.ToUpperInvariant()
        ReviewedBuildManifestSha256 = $ExpectedReviewedBuildManifestSha256.ToUpperInvariant()
        ReviewedBuildManifestStream = $reviewedManifestStream
        BootstrapSha256 = $ExpectedBootstrapSha256.ToUpperInvariant()
        BootstrapStream = $bootstrapStream
        InstallerLauncherPath = $installerLauncherPath
        InstallerLauncherSha256 = $ExpectedInstallerLauncherSha256.ToUpperInvariant()
        InstallerLauncherStream = $installerLauncherStream
        VerifierPath = $verifierPath
        VerifierSha256 = $ExpectedVerifierSha256.ToUpperInvariant()
        VerifierStream = $verifierStream
        HostPid = [Environment]::ProcessId
        HostPath = $fixedPowerShellPath
    }
    $script = [ScriptBlock]::Create($bootstrapText)
    & $script `
        -CandidateRoot $candidateRoot `
        -ExpectedFreezeSha256 $ExpectedFreezeSha256.ToUpperInvariant() `
        -ExpectedReviewedBuildManifestSha256 $ExpectedReviewedBuildManifestSha256.ToUpperInvariant() `
        -ExpectedBootstrapSha256 $ExpectedBootstrapSha256.ToUpperInvariant() `
        -InternalLoaderContext $context
}
finally {
    if ($null -ne $bootstrapBytes) {
        [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($bootstrapBytes)
    }
    if ($null -ne $reviewedManifestBytes) {
        [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($reviewedManifestBytes)
    }
    if ($null -ne $reviewedManifestStream) { $reviewedManifestStream.Dispose() }
    if ($null -ne $bootstrapStream) { $bootstrapStream.Dispose() }
}
