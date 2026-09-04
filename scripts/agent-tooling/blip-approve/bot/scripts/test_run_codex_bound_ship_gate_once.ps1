[CmdletBinding()]
param([switch]$SafeOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourceRoot = $PSScriptRoot
$sourceWrapper = Join-Path $sourceRoot 'run_codex_bound_ship_gate_once.ps1'
$sandboxRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("blip-producer-test-" + [Guid]::NewGuid().ToString('N'))
$runtimeRoot = Join-Path $sandboxRoot 'runtime'
$stateRoot = Join-Path $runtimeRoot 'state'
$appScriptsRoot = Join-Path $runtimeRoot 'app-scripts'
$codexHome = Join-Path $runtimeRoot 'codex-home'
$secretRoot = Join-Path $runtimeRoot 'secrets'
$fakePrivateKey = Join-Path $secretRoot 'codex-private-key.pem'
$fakePython = Join-Path $runtimeRoot 'test-python.cmd'
$fakePythonScript = Join-Path $runtimeRoot 'fake-python.ps1'
$codexRuntimeRoot = Join-Path $runtimeRoot 'codex-runtime'
$codexBinRoot = Join-Path $codexRuntimeRoot 'bin'
$codexPathRoot = Join-Path $codexRuntimeRoot 'codex-path'
$codexResourcesRoot = Join-Path $codexRuntimeRoot 'codex-resources'
$fakeCodex = Join-Path $codexBinRoot 'codex.exe'
$fakeCodeModeHost = Join-Path $codexBinRoot 'codex-code-mode-host.exe'
$fakeRg = Join-Path $codexPathRoot 'rg.exe'
$fakeCommandRunner = Join-Path $codexResourcesRoot 'codex-command-runner.exe'
$fakeSandboxSetup = Join-Path $codexResourcesRoot 'codex-windows-sandbox-setup.exe'
$fakePackage = Join-Path $codexRuntimeRoot 'codex-package.json'
$modePath = Join-Path $runtimeRoot 'test-mode.txt'
$childLogPath = Join-Path $runtimeRoot 'child-log.txt'
$wrapperPath = Join-Path $runtimeRoot 'run_codex_bound_ship_gate_once.ps1'
$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'

function Assert-True {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw $Message }
}

function Invoke-WrapperBootstrapRootRegression {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $sourceWrapper, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw 'Could not parse production wrapper for root regression.' }
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
        $sourceWrapper, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw 'Could not parse production wrapper for trust regression.' }
    $definitions = @{}
    foreach ($name in @('Assert-SystemExecutableAcl', 'Assert-PinnedSigner')) {
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
        $definitions['Assert-SystemExecutableAcl'] + "`n" +
        $definitions['Assert-PinnedSigner'] + "`n" +
        "Assert-SystemExecutableAcl -LiteralPath 'C:\Program Files\Python312\python.exe'`n" +
        "Assert-PinnedSigner -LiteralPath 'C:\Program Files\Python312\python.exe' -ExpectedThumbprint '36168EE17C1A240517388540C903BB6717DD2563'"
    )
    & $probe
}

function Invoke-FixedPythonIsolationRegression {
    $code = @'
import importlib.util
import sys

assert not any("site-packages" in value.lower() for value in sys.path), sys.path
spec = importlib.util.spec_from_file_location("protected_app_auth_probe", sys.argv[1])
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert "jwt" not in module.__dict__
print("fixed-python-isolation-ok")
'@
    $output = & 'C:\Program Files\Python312\python.exe' -I -S -B -c $code `
        (Join-Path $sourceRoot 'app_auth.py') 2>&1
    if ($LASTEXITCODE -ne 0 -or @($output | Where-Object { $_ -ceq 'fixed-python-isolation-ok' }).Count -ne 1) {
        throw "Fixed Python isolation regression failed: $($output -join ' ')"
    }
}

function Invoke-AppJwtRegression {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $sourceWrapper, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw 'Could not parse production wrapper for JWT regression.' }
    $definitions = @{}
    foreach ($name in @('ConvertTo-Base64Url', 'New-FixedAppJwt')) {
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
    $probe = @"
`$ErrorActionPreference = 'Stop'
`$appId = '4445344'
$($definitions['ConvertTo-Base64Url'])
$($definitions['New-FixedAppJwt'])
`$rsa = [System.Security.Cryptography.RSA]::Create(2048)
`$pemChars = `$null
try {
    `$pemChars = `$rsa.ExportPkcs8PrivateKeyPem().ToCharArray()
    `$jwt = New-FixedAppJwt -PemChars `$pemChars
    `$parts = `$jwt.Split('.')
    if (`$parts.Count -ne 3) { throw 'JWT segment count mismatch.' }
    function Decode-Part([string]`$value) {
        `$padded = `$value.Replace('-', '+').Replace('_', '/')
        while ((`$padded.Length % 4) -ne 0) { `$padded += '=' }
        return [Convert]::FromBase64String(`$padded)
    }
    `$header = [Text.Encoding]::UTF8.GetString((Decode-Part `$parts[0])) | ConvertFrom-Json
    `$payload = [Text.Encoding]::UTF8.GetString((Decode-Part `$parts[1])) | ConvertFrom-Json
    `$verified = `$rsa.VerifyData(
        [Text.Encoding]::ASCII.GetBytes(`$parts[0] + '.' + `$parts[1]),
        (Decode-Part `$parts[2]),
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1
    )
    if (`$header.alg -cne 'RS256' -or `$payload.iss -cne '4445344' -or
        ([int64]`$payload.exp - [int64]`$payload.iat) -ne 600 -or -not `$verified) {
        throw 'JWT claims or RS256 signature mismatch.'
    }
    'app-jwt-regression-ok'
}

finally {
    if (`$pemChars) { [Array]::Clear(`$pemChars, 0, `$pemChars.Length) }
    `$rsa.Dispose()
}
"@
    $output = & ([ScriptBlock]::Create($probe))
    if (@($output | Where-Object { $_ -ceq 'app-jwt-regression-ok' }).Count -ne 1) {
        throw 'App JWT regression did not emit its success marker.'
    }
}

function Get-ProductionFunctions {
    param([Parameter(Mandatory)][string[]]$Names)
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $sourceWrapper, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw 'Could not parse production wrapper for extracted regression.' }
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
        schema = 'blip-trusted-runtime-manifest/v2'
        source_commit = 'c' * 40
        files = [ordered]@{ file = $fileHash }
        runtime = [ordered]@{ runtime = $runtimeHash }
        candidate_freeze_sha256 = $freezeHash
        activation = 'OWNER_PEM_AND_CODEX_LOGIN_REQUIRED'
        installed_at = '2026-08-14T00:00:00.0000000+08:00'
    } | ConvertTo-Json -Depth 4 -Compress
    $validCompletion = [ordered]@{
        schema = 'blip-trusted-runtime-complete/v2'
        owner_sid = 'S-1-5-21-test'
        candidate_freeze_sha256 = $freezeHash
        manifest_sha256 = $manifestHash
        completed_at = '2026-08-14T00:00:00.0000000+08:00'
    } | ConvertTo-Json -Depth 3 -Compress
    $parsed = ConvertFrom-StrictRuntimeMetadata `
        -ManifestText $validManifest -CompletionText $validCompletion `
        -ExpectedFileNames @('file') -ExpectedRuntimeNames @('runtime')
    Assert-True ($parsed.Manifest.schema -ceq 'blip-trusted-runtime-manifest/v2') `
        'Strict runtime metadata parser rejected a valid exact schema.'

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

    Assert-MetadataRejected `
        -ManifestText ($validManifest.Replace('manifest/v2', 'manifest/v1')) `
        -CompletionText $validCompletion -Label 'predecessor manifest schema'
    Assert-MetadataRejected -ManifestText $validManifest `
        -CompletionText ($validCompletion.Replace('complete/v2', 'complete/v1')) `
        -Label 'predecessor completion schema'
    $manifestUnknown = $validManifest.Substring(0, $validManifest.Length - 1) + ',"unknown":true}'
    $manifestDuplicate = $validManifest.Substring(0, $validManifest.Length - 1) +
        ',"schema":"blip-trusted-runtime-manifest/v2"}'
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
    Assert-MetadataRejected -ManifestText ($validManifest.Replace(',"source_commit":"' + ('c' * 40) + '"', '')) `
        -CompletionText $validCompletion -Label 'missing source commit'
    Assert-MetadataRejected -ManifestText ($validManifest.Replace(('c' * 40), ('C' * 40))) `
        -CompletionText $validCompletion -Label 'non-canonical source commit'
    $completionUnknown = $validCompletion.Substring(0, $validCompletion.Length - 1) + ',"unknown":true}'
    $completionDuplicate = $validCompletion.Substring(0, $validCompletion.Length - 1) +
        ',"schema":"blip-trusted-runtime-complete/v2"}'
    Assert-MetadataRejected -ManifestText $validManifest -CompletionText $completionUnknown -Label 'unknown completion property'
    Assert-MetadataRejected -ManifestText $validManifest -CompletionText $completionDuplicate -Label 'duplicate completion property'
    Write-Output 'strict-runtime-metadata-regression-ok'
}

function Invoke-AppReviewLockRegression {
    [string]$definition = Get-ProductionFunctions -Names @('Open-ExclusiveAppReviewLock')
    . ([ScriptBlock]::Create($definition))
    $lockRoot = Join-Path $sandboxRoot 'review-lock-regression'
    New-Item -ItemType Directory -Path $lockRoot | Out-Null
    $first = Open-ExclusiveAppReviewLock `
        -StateRoot $lockRoot -Repository 'monkey1sai/AI-BIM-governance' -PrNumber 511
    try {
        $secondRejected = $false
        try {
            $second = Open-ExclusiveAppReviewLock `
                -StateRoot $lockRoot -Repository 'monkey1sai/AI-BIM-governance' -PrNumber 511
            $second.Dispose()
        }
        catch { $secondRejected = $true }
        Assert-True $secondRejected 'Concurrent App review lock acquisition was accepted.'
    }
    finally { $first.Dispose() }
    $afterRelease = Open-ExclusiveAppReviewLock `
        -StateRoot $lockRoot -Repository 'monkey1sai/AI-BIM-governance' -PrNumber 511
    $afterRelease.Dispose()
    Write-Output 'app-review-lock-regression-ok'
}

function Invoke-GateTimeoutBudgetRegression {
    [string]$definition = Get-ProductionFunctions -Names @('Get-ProtectedGateCommandTimeoutSec')
    . ([ScriptBlock]::Create($definition))
    Assert-True (
        (Get-ProtectedGateCommandTimeoutSec -AgentTimeoutSec 300 -Jobs 1) -eq 8700
    ) 'Worst-case jobs=1 gate timeout budget is truncated.'
    Assert-True (
        (Get-ProtectedGateCommandTimeoutSec -AgentTimeoutSec 300 -Jobs 4) -eq 3300
    ) 'Default jobs=4 gate timeout budget drifted.'
    Assert-True (
        (Get-ProtectedGateCommandTimeoutSec -AgentTimeoutSec 60 -Jobs 8) -eq 780
    ) 'Fast jobs=8 gate timeout budget is invalid.'
    $sourceText = Get-Content -Raw -LiteralPath $sourceWrapper
    Assert-True ($sourceText -match '-CommandTimeoutSec \$gateCommandTimeoutSec') `
        'Gate child does not consume the computed timeout budget.'
    Write-Output 'gate-timeout-budget-regression-ok'
}

function Invoke-ProtectedTokenResponseRegression {
    [string]$definition = Get-ProductionFunctions -Names @(
        'ConvertFrom-ProtectedInstallationTokenResponse'
    )
    . ([ScriptBlock]::Create($definition))
    $now = [DateTimeOffset]::Parse('2026-08-12T12:00:00Z')
    $fakeToken = 'test_only_installation_token_123456'
    function Get-ResponseBytes {
        param(
            [string]$Repository = 'monkey1sai/AI-BIM-governance',
            [hashtable]$Permissions = @{ contents = 'read'; pull_requests = 'write'; metadata = 'read' },
            [DateTimeOffset]$ExpiresAt = $now.AddMinutes(60),
            [string]$Token = $fakeToken,
            [int]$RepositoryCount = 1
        )
        $repositories = @()
        for ($index = 0; $index -lt $RepositoryCount; $index++) {
            $repositories += @{ full_name = $Repository }
        }
        return [Text.Encoding]::UTF8.GetBytes((
            [ordered]@{
                token = $Token
                expires_at = $ExpiresAt.ToString('o')
                permissions = $Permissions
                repositories = $repositories
            } | ConvertTo-Json -Depth 5 -Compress
        ))
    }
    function Assert-Rejected {
        param([Parameter(Mandatory)][byte[]]$Bytes, [Parameter(Mandatory)][string]$Label)
        $rejected = $false
        try {
            [void](ConvertFrom-ProtectedInstallationTokenResponse `
                -ResponseBytes $Bytes -Now $now -ExpectedRepository 'monkey1sai/AI-BIM-governance')
        }
        catch {
            $rejected = $true
            Assert-True (-not $_.Exception.Message.Contains($fakeToken)) "$Label leaked the fake token."
        }
        Assert-True $rejected "$Label was accepted."
    }
    $valid = ConvertFrom-ProtectedInstallationTokenResponse `
        -ResponseBytes (Get-ResponseBytes) -Now $now `
        -ExpectedRepository 'monkey1sai/AI-BIM-governance'
    Assert-True ($valid -ceq $fakeToken) 'Valid protected installation-token metadata was rejected.'
    foreach ($boundary in @(5, 70)) {
        $value = ConvertFrom-ProtectedInstallationTokenResponse `
            -ResponseBytes (Get-ResponseBytes -ExpiresAt $now.AddMinutes($boundary)) `
            -Now $now -ExpectedRepository 'monkey1sai/AI-BIM-governance'
        Assert-True ($value -ceq $fakeToken) "Expiry boundary $boundary minutes was rejected."
    }
    Assert-Rejected -Bytes (Get-ResponseBytes -Repository 'Monkey1sai/AI-BIM-governance') -Label 'wrong-case repo'
    Assert-Rejected -Bytes (Get-ResponseBytes -RepositoryCount 2) -Label 'multiple repos'
    Assert-Rejected -Bytes (Get-ResponseBytes -Permissions @{ contents = 'read'; pull_requests = 'write'; checks = 'read' }) -Label 'extra permission'
    Assert-Rejected -Bytes (Get-ResponseBytes -Permissions @{ contents = 'read'; pull_requests = 'read' }) -Label 'weak pull request permission'
    Assert-Rejected -Bytes (Get-ResponseBytes -ExpiresAt $now.AddSeconds(299)) -Label 'short expiry'
    Assert-Rejected -Bytes (Get-ResponseBytes -ExpiresAt $now.AddMinutes(70).AddSeconds(1)) -Label 'long expiry'
    Assert-Rejected -Bytes ([Text.Encoding]::UTF8.GetBytes('{"token":')) -Label 'malformed JSON'
    Assert-Rejected -Bytes ([byte[]]::new(65537)) -Label 'oversized response'
    Write-Output 'protected-token-response-regression-ok'
}

function Invoke-ProtectedHttpBodyRegression {
    $definitions = Get-ProductionFunctions -Names @(
        'Read-BoundedHttpContentBytes', 'Read-ProtectedInstallationTokenHttpResponse'
    )
    . ([ScriptBlock]::Create(($definitions -join "`n")))
    $fakeToken = 'test_only_http_body_token_123456'

    function New-StreamContent {
        param([Parameter(Mandatory)][int]$Length, [AllowNull()][Nullable[long]]$DeclaredLength)
        [byte[]]$bytes = [byte[]]::new($Length)
        if ($Length -gt 0) { [Array]::Fill[byte]($bytes, 0x61) }
        $content = [System.Net.Http.StreamContent]::new([System.IO.MemoryStream]::new($bytes, $false))
        $content.Headers.ContentLength = $DeclaredLength
        return $content
    }

    $exact = New-StreamContent -Length 65536 -DeclaredLength $null
    try {
        $bytes = Read-BoundedHttpContentBytes -Content $exact -MaxBytes 65536
        Assert-True ($bytes.Length -eq 65536) 'Headerless 65,536-byte response was rejected.'
    }
    finally { $exact.Dispose() }

    foreach ($case in @(
        @{ Label = 'headerless 65,537'; Content = (New-StreamContent -Length 65537 -DeclaredLength $null) },
        @{ Label = 'falsely small header'; Content = (New-StreamContent -Length 65537 -DeclaredLength 1) },
        @{ Label = 'declared oversized'; Content = (New-StreamContent -Length 1 -DeclaredLength 65537) }
    )) {
        $rejected = $false
        try { [void](Read-BoundedHttpContentBytes -Content $case.Content -MaxBytes 65536) }
        catch { $rejected = $_.Exception.Message -match 'protected size limit' }
        finally { $case.Content.Dispose() }
        Assert-True $rejected "$($case.Label) response was not rejected."
    }

    $nullContentRejected = $false
    try { [void](Read-BoundedHttpContentBytes -Content $null -MaxBytes 65536) }
    catch { $nullContentRejected = $_.Exception.Message -ceq 'GitHub installation-token response content is unavailable.' }
    Assert-True $nullContentRejected 'Null installation-token response content did not fail closed.'

    $response = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode]::BadRequest)
    $response.Content = [System.Net.Http.StringContent]::new($fakeToken)
    try {
        $non201Rejected = $false
        try { [void](Read-ProtectedInstallationTokenHttpResponse -Response $response) }
        catch {
            $non201Rejected = $_.Exception.Message -ceq 'GitHub installation-token request failed with HTTP 400.'
            Assert-True (-not $_.Exception.Message.Contains($fakeToken)) 'Non-201 error leaked response content.'
        }
        Assert-True $non201Rejected 'Non-201 installation-token response was accepted.'
    }
    finally { $response.Dispose() }

    $nullResponseRejected = $false
    try { [void](Read-ProtectedInstallationTokenHttpResponse -Response $null) }
    catch { $nullResponseRejected = $_.Exception.Message -ceq 'GitHub installation-token request returned no response.' }
    Assert-True $nullResponseRejected 'Null installation-token HTTP response did not fail closed.'

    $productionText = Get-Content -Raw -LiteralPath $sourceWrapper
    Assert-True ($productionText -notmatch '\.ContentLength\.HasValue') `
        'PowerShell 7.5-incompatible nullable ContentLength access remains in production source.'
    Write-Output 'protected-http-body-regression-ok'
}

function Invoke-ProtectedRequestRegression {
    $definitions = Get-ProductionFunctions -Names @('New-ProtectedInstallationTokenRequest')
    . ([ScriptBlock]::Create(
        "`$installationId = '150304409'`n" + ($definitions -join "`n")
    ))
    $jwt = ('a' * 24) + '.' + ('b' * 24) + '.' + ('c' * 24)
    $request = New-ProtectedInstallationTokenRequest -Jwt $jwt
    try {
        Assert-True ($request.Method.Method -ceq 'POST') 'Installation-token request method drifted.'
        Assert-True (
            $request.RequestUri.AbsoluteUri -ceq
                'https://api.github.com/app/installations/150304409/access_tokens'
        ) 'Installation-token request endpoint drifted.'
        Assert-True ($request.Headers.Authorization.Scheme -ceq 'Bearer') 'JWT authorization scheme drifted.'
        Assert-True ($request.Headers.Authorization.Parameter -ceq $jwt) 'JWT authorization value drifted.'
        $body = $request.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        Assert-True (@($body.repositories).Count -eq 1 -and $body.repositories[0] -ceq 'AI-BIM-governance') `
            'Installation-token request repository scope drifted.'
        Assert-True ($body.permissions.contents -ceq 'read' -and $body.permissions.pull_requests -ceq 'write') `
            'Installation-token request permission scope drifted.'
        Assert-True (@($body.permissions.PSObject.Properties).Count -eq 2) `
            'Installation-token request acquired an unexpected permission.'
    }
    finally { $request.Dispose() }
    Write-Output 'protected-token-request-regression-ok'
}

function Set-TestProtectedAcl {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [switch]$OmitSandboxDeny,
        [switch]$AllowUsersRead,
        [switch]$OwnerOnly
    )
    $current = [System.Security.Principal.WindowsIdentity]::GetCurrent()
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
    $acl.SetOwner($current.User)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $current.User,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    ))
    if (-not $OmitSandboxDeny) {
        $sandboxSid = ([System.Security.Principal.NTAccount]::new(
            [Environment]::MachineName + '\CodexSandboxUsers'
        )).Translate([System.Security.Principal.SecurityIdentifier])
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $sandboxSid,
            $(if ($OwnerOnly) {
                [System.Security.AccessControl.FileSystemRights]::FullControl
            }
            else {
                [System.Security.AccessControl.FileSystemRights]::WriteData -bor
                    [System.Security.AccessControl.FileSystemRights]::AppendData -bor
                    [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
                    [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
                    [System.Security.AccessControl.FileSystemRights]::Delete -bor
                    [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
                    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
                    [System.Security.AccessControl.FileSystemRights]::TakeOwnership
            }),
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Deny
        ))
        if (-not $OwnerOnly) {
            $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
                $sandboxSid,
                [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
                $inheritance,
                [System.Security.AccessControl.PropagationFlags]::None,
                [System.Security.AccessControl.AccessControlType]::Allow
            ))
        }
    }
    if ($AllowUsersRead) {
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),
            [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        ))
    }
    Set-Acl -LiteralPath $LiteralPath -AclObject $acl
}

function Invoke-ProtectedSecretAclRegression {
    param([Parameter(Mandatory)][string]$TestRoot)
    $definitions = Get-ProductionFunctions -Names @(
        'Assert-ProtectedOwnerAcl', 'Assert-ProtectedSecretAcl',
        'Assert-ProtectedCredentialFileAcl', 'Open-ProtectedPrivateKeyStream'
    )
    $secretRoot = Join-Path $TestRoot 'secret-acl'
    $keyPath = Join-Path $secretRoot 'dummy.pem'
    New-Item -ItemType Directory -Path $secretRoot | Out-Null
    [IO.File]::WriteAllText($keyPath, 'dummy-secret-free-key-bytes')
    Set-TestProtectedAcl -LiteralPath $secretRoot -OwnerOnly
    Set-TestProtectedAcl -LiteralPath $keyPath -OwnerOnly
    . ([ScriptBlock]::Create(($definitions -join "`n")))

    Assert-ProtectedSecretAcl -LiteralPaths @($secretRoot, $keyPath)
    $stream = Open-ProtectedPrivateKeyStream -LiteralPath $keyPath
    try {
        Assert-True ($stream.CanRead -and -not $stream.CanWrite) `
            'Protected private-key stream access mode drifted.'
        $secondOpenBlocked = $false
        try {
            $second = [IO.FileStream]::new(
                $keyPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read
            )
            $second.Dispose()
        }
        catch [IO.IOException] { $secondOpenBlocked = $true }
        Assert-True $secondOpenBlocked 'Protected private-key stream no longer uses FileShare.None.'
    }
    finally { $stream.Dispose() }
    $afterDispose = [IO.FileStream]::new(
        $keyPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read
    )
    $afterDispose.Dispose()

    $missingDenyPath = Join-Path $secretRoot 'missing-deny.pem'
    [IO.File]::WriteAllText($missingDenyPath, 'dummy-missing-deny')
    Set-TestProtectedAcl -LiteralPath $missingDenyPath -OmitSandboxDeny -OwnerOnly
    $missingDenyRejected = $false
    try { Assert-ProtectedSecretAcl -LiteralPaths @($missingDenyPath) }
    catch { $missingDenyRejected = $true }
    Assert-True $missingDenyRejected 'Secret key without sandbox denial was accepted.'

    $untrustedReadPath = Join-Path $secretRoot 'untrusted-read.pem'
    [IO.File]::WriteAllText($untrustedReadPath, 'dummy-untrusted-read')
    Set-TestProtectedAcl -LiteralPath $untrustedReadPath -AllowUsersRead -OwnerOnly
    $untrustedReadRejected = $false
    try { Assert-ProtectedSecretAcl -LiteralPaths @($untrustedReadPath) }
    catch { $untrustedReadRejected = $true }
    Assert-True $untrustedReadRejected 'Secret key with Builtin Users read access was accepted.'

    $loginHome = Join-Path $TestRoot 'login-home'
    New-Item -ItemType Directory -Path $loginHome | Out-Null
    Set-TestProtectedAcl -LiteralPath $loginHome -OwnerOnly
    $inheritedAuth = Join-Path $loginHome 'auth.json'
    [IO.File]::WriteAllText($inheritedAuth, '{}')
    Assert-True (-not (Get-Acl -LiteralPath $inheritedAuth).AreAccessRulesProtected) `
        'Credential fixture did not inherit its protected parent ACL.'
    Assert-ProtectedCredentialFileAcl -LiteralPath $inheritedAuth -ProtectedParent $loginHome

    $inheritedSecretRoot = Join-Path $TestRoot 'inherited-secret'
    New-Item -ItemType Directory -Path $inheritedSecretRoot | Out-Null
    Set-TestProtectedAcl -LiteralPath $inheritedSecretRoot -OwnerOnly
    $inheritedPem = Join-Path $inheritedSecretRoot 'key.pem'
    [IO.File]::WriteAllText($inheritedPem, 'dummy-inherited-key')
    $secretRoot = $inheritedSecretRoot
    $inheritedStream = Open-ProtectedPrivateKeyStream -LiteralPath $inheritedPem
    $inheritedStream.Dispose()
    Write-Output 'protected-secret-acl-regression-ok'
}

function Invoke-TokenFailureBeforeChildRegression {
    param([Parameter(Mandatory)][string]$TestRoot)
    [string]$definition = Get-ProductionFunctions -Names @('Invoke-PinnedPython')
    $sentinel = Join-Path $TestRoot 'unexpected-child-start.txt'
    $fakeChild = Join-Path $TestRoot 'must-not-start.cmd'
    $cmd = '@echo started>"' + $sentinel + '"'
    Set-Content -LiteralPath $fakeChild -Value $cmd -Encoding ascii
    $pythonPath = $fakeChild
    $trustedRoot = $TestRoot
    $protectedTokenEnv = 'BLIP_PROTECTED_CODEX_INSTALLATION_TOKEN'
    $protectedAppIdEnv = 'BLIP_PROTECTED_CODEX_APP_ID'
    $protectedInstallationIdEnv = 'BLIP_PROTECTED_CODEX_INSTALLATION_ID'
    $appId = '4445344'
    $installationId = '150304409'
    function Get-ProtectedInstallationToken { throw 'synthetic-token-acquisition-failure' }
    . ([ScriptBlock]::Create($definition))
    $failedClosed = $false
    try { [void](Invoke-PinnedPython -Arguments @('ignored.py') -WithGitHubToken) }
    catch {
        $failedClosed = $_.Exception.Message -ceq 'synthetic-token-acquisition-failure'
    }
    Assert-True $failedClosed 'Token acquisition failure did not propagate fail-closed.'
    Assert-True (-not (Test-Path -LiteralPath $sentinel)) `
        'Python child started after protected token acquisition failed.'
    Write-Output 'token-failure-before-child-regression-ok'
}

function Write-Manifest {
    param([Parameter(Mandatory)][string]$ActiveWrapperPath, [switch]$BadWrapperHash)
    $files = [ordered]@{
        'run_blip_live_approve_once.ps1' = 'A' * 64
        'blip_review.py' = 'B' * 64
        'app_auth.py' = 'C' * 64
        'run_codex_bound_ship_gate_once.ps1' = if ($BadWrapperHash) { '0' * 64 } else {
            (Get-FileHash -LiteralPath $ActiveWrapperPath -Algorithm SHA256).Hash
        }
        'bind_ship_attestation.py' = (Get-FileHash -LiteralPath (Join-Path $runtimeRoot 'bind_ship_attestation.py') -Algorithm SHA256).Hash
        'app-scripts/collect_ship_gate_packet.py' = (Get-FileHash -LiteralPath (Join-Path $appScriptsRoot 'collect_ship_gate_packet.py') -Algorithm SHA256).Hash
        'app-scripts/codex_ship_gate.py' = (Get-FileHash -LiteralPath (Join-Path $appScriptsRoot 'codex_ship_gate.py') -Algorithm SHA256).Hash
        'app-scripts/ship_gate_packet.py' = (Get-FileHash -LiteralPath (Join-Path $appScriptsRoot 'ship_gate_packet.py') -Algorithm SHA256).Hash
        'app-scripts/post_review.py' = (Get-FileHash -LiteralPath (Join-Path $appScriptsRoot 'post_review.py') -Algorithm SHA256).Hash
        'app-scripts/app_auth.py' = (Get-FileHash -LiteralPath (Join-Path $appScriptsRoot 'app_auth.py') -Algorithm SHA256).Hash
        'bots.json' = (Get-FileHash -LiteralPath (Join-Path $runtimeRoot 'bots.json') -Algorithm SHA256).Hash
    }
    $manifest = [ordered]@{
        schema = 'blip-trusted-runtime-manifest/v2'
        source_commit = 'c' * 40
        files = $files
        runtime = [ordered]@{
            'runtime/pwsh.exe' = (Get-FileHash -LiteralPath 'C:\Program Files\PowerShell\7\pwsh.exe' -Algorithm SHA256).Hash
            'runtime/python.exe' = (Get-FileHash -LiteralPath $fakePython -Algorithm SHA256).Hash
            'runtime/codex-package.json' = (Get-FileHash -LiteralPath $fakePackage -Algorithm SHA256).Hash
            'runtime/bin/codex.exe' = (Get-FileHash -LiteralPath $fakeCodex -Algorithm SHA256).Hash
            'runtime/bin/codex-code-mode-host.exe' = (Get-FileHash -LiteralPath $fakeCodeModeHost -Algorithm SHA256).Hash
            'runtime/codex-path/rg.exe' = (Get-FileHash -LiteralPath $fakeRg -Algorithm SHA256).Hash
            'runtime/codex-resources/codex-command-runner.exe' = (Get-FileHash -LiteralPath $fakeCommandRunner -Algorithm SHA256).Hash
            'runtime/codex-resources/codex-windows-sandbox-setup.exe' = (Get-FileHash -LiteralPath $fakeSandboxSetup -Algorithm SHA256).Hash
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
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
    [ordered]@{
        schema = 'blip-trusted-runtime-complete/v2'
        owner_sid = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
        candidate_freeze_sha256 = 'F' * 64
        manifest_sha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
        completed_at = '2026-08-12T00:00:00+08:00'
    } | ConvertTo-Json -Depth 3 | Set-Content `
        -LiteralPath (Join-Path $runtimeRoot 'install-complete.json') -Encoding utf8NoBOM
}

function Invoke-WrapperCase {
    param([Parameter(Mandatory)][string]$Mode, [Parameter(Mandatory)][int]$ExpectedExit)
    Set-Content -LiteralPath $modePath -Value $Mode -Encoding utf8NoBOM
    $global:LASTEXITCODE = $null
    & $wrapperPath -PrNumber 511 -AgentTimeoutSec 60 -Jobs 1
    Assert-True ($LASTEXITCODE -eq $ExpectedExit) "Mode $Mode expected exit $ExpectedExit, got $LASTEXITCODE"
}

try {
    Invoke-WrapperBootstrapRootRegression
    New-Item -ItemType Directory -Path $sandboxRoot | Out-Null
    Invoke-FixedPythonIsolationRegression
    Invoke-AppJwtRegression
    Invoke-StrictMetadataSchemaRegression
    Invoke-AppReviewLockRegression
    Invoke-GateTimeoutBudgetRegression
    Invoke-ProtectedTokenResponseRegression
    Invoke-ProtectedHttpBodyRegression
    Invoke-ProtectedRequestRegression
    Invoke-TokenFailureBeforeChildRegression -TestRoot $sandboxRoot
    if ($SafeOnly) {
        $safeText = (Get-Content -Raw -LiteralPath $sourceWrapper).Replace("`r`n", "`n")
        $safeTokens = $null
        $safeErrors = $null
        $safeAst = [System.Management.Automation.Language.Parser]::ParseFile(
            $sourceWrapper, [ref]$safeTokens, [ref]$safeErrors
        )
        Assert-True ($safeErrors.Count -eq 0) 'Protected App wrapper does not parse.'
        Assert-True ($safeText -match "DefaultParameterSetName = 'Review'") `
            'Review parameter set is not the wrapper default.'
        Assert-True ($safeText -match "ParameterSetName = 'TokenHealth'") `
            'TokenHealth is not isolated in its own parameter set.'
        Assert-True ($safeText -match 'if \(\$TokenHealth\)[\s\S]+BLIP_TOKEN_HEALTH=OK[\s\S]+exit 0') `
            'TokenHealth does not have a fixed early success exit.'
        Assert-True ($safeText -match [regex]::Escape(
            "$" + "credentialRequired = if (`$PSCmdlet.ParameterSetName -ceq 'Review')"
        )) 'TokenHealth still includes the Codex credential path in its required-path set.'
        Assert-True ($safeText -match [regex]::Escape(
            "if (`$PSCmdlet.ParameterSetName -ceq 'Review') {`n        Assert-ProtectedSecretAcl"
        )) 'TokenHealth still performs the Codex credential ACL checks.'
        $phaseCalls = @($safeAst.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                    $node.GetCommandName() -ceq 'Invoke-PinnedPython'
            },
            $true
        ) | ForEach-Object { $_.Extent.Text })
        Assert-True ($phaseCalls.Count -eq 4) 'Protected App wrapper does not have exactly four Python phases.'
        foreach ($phase in @(
            @{ Name = 'collector'; Path = '$collectorPath'; Token = $true },
            @{ Name = 'model gate'; Path = '$gatePath'; Token = $false },
            @{ Name = 'binder'; Path = '$binderPath'; Token = $true },
            @{ Name = 'poster'; Path = '$postArguments'; Token = $true }
        )) {
            $matches = @($phaseCalls | Where-Object { $_.Contains($phase.Path) })
            Assert-True ($matches.Count -eq 1) "$($phase.Name) Python phase is missing or duplicated."
            Assert-True (($matches[0] -match '-WithGitHubToken') -eq $phase.Token) `
                "$($phase.Name) token phase classification drifted."
        }
        Write-Output 'producer-wrapper-safe-tests-ok (bounded response, token isolation primitives, parameter sets)'
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
    New-Item -ItemType Directory -Path $runtimeRoot, $stateRoot, $appScriptsRoot, $codexHome, $secretRoot,
        $codexRuntimeRoot, $codexBinRoot, $codexPathRoot, $codexResourcesRoot | Out-Null
    Invoke-ProtectedSecretAclRegression -TestRoot $sandboxRoot
    $wrapperText = Get-Content -Raw -LiteralPath $sourceWrapper
    $parseTokens = $null
    $parseErrors = $null
    $wrapperAst = [System.Management.Automation.Language.Parser]::ParseInput(
        $wrapperText, [ref]$parseTokens, [ref]$parseErrors
    )
    if ($parseErrors.Count -ne 0) { throw 'Production wrapper could not be parsed for isolated token stub.' }
    $tokenFunction = $wrapperAst.Find(
        {
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                $node.Name -ceq 'Get-ProtectedInstallationToken'
        },
        $true
    )
    if ($null -eq $tokenFunction) { throw 'Production token broker function is unavailable.' }
    $wrapperText = $wrapperText.Replace(
        $tokenFunction.Extent.Text,
        "function Get-ProtectedInstallationToken { return 'test-protected-installation-token' }"
    )
    $protectedAssignments = @'
$protectedRoot = 'C:\ProgramData\AI-BIM-governance'
$protectedBase = Join-Path $protectedRoot 'blip-approve'
'@
    if ($wrapperText.IndexOf($protectedAssignments, [StringComparison]::Ordinal) -lt 0) {
        throw 'Production protected-root assignments changed; isolated harness cannot patch them safely.'
    }
    $wrapperText = $wrapperText.Replace(
        $protectedAssignments,
        "`$protectedRoot = `$trustedRoot`r`n`$protectedBase = `$trustedRoot"
    )
    $pythonAssignment = "`$pythonPath = 'C:\Program Files\Python312\python.exe'"
    if ($wrapperText.IndexOf($pythonAssignment, [StringComparison]::Ordinal) -lt 0) {
        throw 'Production wrapper executable pins changed; isolated test copy cannot patch them safely.'
    }
    $wrapperText = $wrapperText.Replace($pythonAssignment, "`$pythonPath = Join-Path `$trustedRoot 'test-python.cmd'")
    $pythonAclCall = '    Assert-SystemExecutableAcl -LiteralPath $pythonPath'
    $signatureBlock = @'
    Assert-PinnedSigner -LiteralPath $pythonPath -ExpectedThumbprint '36168EE17C1A240517388540C903BB6717DD2563'
    foreach ($signedCodexPath in @(
        $codexPath, $codexCodeModeHostPath, $codexCommandRunnerPath, $codexSandboxSetupPath
    )) {
        Assert-PinnedSigner -LiteralPath $signedCodexPath -ExpectedThumbprint '8B0ADFB840E141DAD3044D2B5AC819873DDE3590'
    }
'@
    if ($wrapperText.IndexOf($pythonAclCall, [StringComparison]::Ordinal) -lt 0 -or
        $wrapperText.IndexOf($signatureBlock, [StringComparison]::Ordinal) -lt 0) {
        throw 'Production wrapper signer/ACL checks changed; isolated harness cannot patch them safely.'
    }
    $wrapperText = $wrapperText.Replace($pythonAclCall, '    # Isolated fake interpreter; production validates system ACL.')
    $wrapperText = $wrapperText.Replace($signatureBlock, '    # Isolated fake runtime; production validates pinned Authenticode signers.')
    Set-Content -LiteralPath $wrapperPath -Value $wrapperText -Encoding utf8NoBOM

    Copy-Item -LiteralPath (Join-Path $sourceRoot 'bind_ship_attestation.py') -Destination $runtimeRoot
    foreach ($name in @(
        'collect_ship_gate_packet.py', 'codex_ship_gate.py', 'ship_gate_packet.py',
        'post_review.py', 'app_auth.py'
    )) {
        Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $appScriptsRoot
    }
    Copy-Item -LiteralPath (Join-Path $sourceRoot '..\bots.json') -Destination $runtimeRoot
    Set-Content -LiteralPath (Join-Path $codexHome 'auth.json') -Value '{}' -Encoding utf8NoBOM
    Set-Content -LiteralPath $fakePrivateKey -Value 'test-only key placeholder' -Encoding utf8NoBOM
    foreach ($fakeRuntimeFile in @(
        $fakePackage, $fakeCodex, $fakeCodeModeHost, $fakeRg, $fakeCommandRunner, $fakeSandboxSetup
    )) { Set-Content -LiteralPath $fakeRuntimeFile -Value "test-only $([IO.Path]::GetFileName($fakeRuntimeFile))" -Encoding utf8NoBOM }
    Set-Content -LiteralPath $modePath -Value 'valid' -Encoding utf8NoBOM

    $fakeCmd = '@"C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -NonInteractive -File "%~dp0fake-python.ps1" %*'
    Set-Content -LiteralPath $fakePython -Value $fakeCmd -Encoding ascii
    $fakeScript = @'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptPath = [string]$args[3]
$toolArgs = @($args[4..($args.Count - 1)])
function Get-Value([string]$Name) {
    $index = [Array]::IndexOf($toolArgs, $Name)
    if ($index -lt 0 -or $index + 1 -ge $toolArgs.Count) { throw "Missing $Name" }
    return [string]$toolArgs[$index + 1]
}
$mode = (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'test-mode.txt')).Trim()
$name = [IO.Path]::GetFileName($scriptPath)
$tokenExpected = $name -in @('collect_ship_gate_packet.py', 'bind_ship_attestation.py', 'post_review.py')
if ($tokenExpected) {
    if ($env:BLIP_PROTECTED_CODEX_INSTALLATION_TOKEN -cne 'test-protected-installation-token' -or
        $env:BLIP_PROTECTED_CODEX_APP_ID -cne '4445344' -or
        $env:BLIP_PROTECTED_CODEX_INSTALLATION_ID -cne '150304409') {
        throw "Protected token handoff is absent or malformed for $name."
    }
}
elseif (-not [string]::IsNullOrEmpty($env:BLIP_PROTECTED_CODEX_INSTALLATION_TOKEN) -or
    -not [string]::IsNullOrEmpty($env:BLIP_PROTECTED_CODEX_APP_ID) -or
    -not [string]::IsNullOrEmpty($env:BLIP_PROTECTED_CODEX_INSTALLATION_ID)) {
    throw "Token-bearing environment reached token-free child $name."
}
Remove-Item Env:BLIP_PROTECTED_CODEX_INSTALLATION_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:BLIP_PROTECTED_CODEX_APP_ID -ErrorAction SilentlyContinue
Remove-Item Env:BLIP_PROTECTED_CODEX_INSTALLATION_ID -ErrorAction SilentlyContinue
Add-Content -LiteralPath (Join-Path $PSScriptRoot 'child-log.txt') -Value $name -Encoding utf8NoBOM
if ($name -ceq 'collect_ship_gate_packet.py') {
    $out = Get-Value '--out-dir'
    $stamp = Get-Value '--stamp'
    $pr = Get-Value '--pr'
    $packet = Join-Path $out "codex-gate-packet-pr-$pr-$stamp.json"
    Set-Content -LiteralPath $packet -Value '{}' -Encoding utf8NoBOM
    "BLIP_GATE_PACKET=$packet"
    'BLIP_GATE_PACKET_BASE=cccccccccccccccccccccccccccccccccccccccc'
    'BLIP_GATE_PACKET_HEAD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    exit 0
}
if ($name -ceq 'codex_ship_gate.py') {
    $out = Get-Value '--out-dir'
    $stamp = Get-Value '--stamp'
    $pr = Get-Value '--pr'
    $md = Join-Path $out "codex-tri-pr-$pr-$stamp.md"
    $json = Join-Path $out "codex-tri-pr-$pr-$stamp.json"
    $verdict = if ($mode -ceq 'request-changes') { 'NO-SHIP' } elseif ($mode -ceq 'held') { 'HELD' } else { 'SHIP' }
    $event = if ($verdict -ceq 'NO-SHIP') { 'request_changes' } else { 'comment' }
    Set-Content -LiteralPath $md -Value "# gate`n`nVERDICT: $verdict`n" -Encoding utf8NoBOM
    Set-Content -LiteralPath $json -Value '{}' -Encoding utf8NoBOM
    "TRI_GATE_EVENT=$event"
    if ($mode -ceq 'duplicate-gate-marker') { "TRI_GATE_EVENT=$event" }
    "TRI_GATE_VERDICT=$verdict"
    'TRI_GATE_HEAD_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    "TRI_GATE_MARKDOWN=$md"
    "TRI_GATE_JSON=$json"
    exit 0
}
if ($name -ceq 'bind_ship_attestation.py') {
    $out = Get-Value '--out'
    $verdict = if ($mode -ceq 'request-changes') { 'NO-SHIP' } elseif ($mode -ceq 'held') { 'HELD' } else { 'SHIP' }
    Set-Content -LiteralPath $out -Value "# verified gate`n`nVERDICT: $verdict`n" -Encoding utf8NoBOM
    'BLIP_TUPLE_VERIFIED=true'
    'BLIP_TUPLE_BASE=cccccccccccccccccccccccccccccccccccccccc'
    'BLIP_TUPLE_HEAD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    'BLIP_TUPLE_CHANGED_FILES_SHA256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    'BLIP_TUPLE_DIFF_SHA256=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    "BLIP_TUPLE_VERDICT=$verdict"
    'BLIP_ATTESTATION_REVIEW_MODE=focused_semantic'
    "BLIP_VERIFIED_REPORT=$out"
    exit 0
}
if ($name -ceq 'post_review.py') {
    $event = (Get-Value '--event').ToUpperInvariant()
    "repo=monkey1sai/AI-BIM-governance pr=#511 event=$event dry_run=True"
    if ($mode -ceq 'malformed-post') { 'POST_REVIEW_RESULT malformed'; exit 0 }
    "POST_REVIEW_RESULT event=$event dry_run=True"
    exit 0
}
throw "Unexpected fake Python target: $name"
'@
    Set-Content -LiteralPath $fakePythonScript -Value $fakeScript -Encoding utf8NoBOM

    Write-Manifest -ActiveWrapperPath $wrapperPath
    foreach ($path in @(
        $runtimeRoot, $stateRoot, $appScriptsRoot,
        $codexRuntimeRoot, $codexBinRoot, $codexPathRoot, $codexResourcesRoot,
        $wrapperPath, (Join-Path $runtimeRoot 'manifest.json'),
        (Join-Path $runtimeRoot 'install-complete.json'),
        (Join-Path $runtimeRoot 'bind_ship_attestation.py'),
        (Join-Path $appScriptsRoot 'collect_ship_gate_packet.py'),
        (Join-Path $appScriptsRoot 'codex_ship_gate.py'),
        (Join-Path $appScriptsRoot 'ship_gate_packet.py'),
        (Join-Path $appScriptsRoot 'post_review.py'),
        (Join-Path $appScriptsRoot 'app_auth.py'),
        (Join-Path $runtimeRoot 'bots.json'), $fakePython,
        $fakePackage, $fakeCodex, $fakeCodeModeHost, $fakeRg, $fakeCommandRunner, $fakeSandboxSetup
    )) { Set-TestProtectedAcl -LiteralPath $path }
    foreach ($path in @($codexHome, (Join-Path $codexHome 'auth.json'), $secretRoot, $fakePrivateKey)) {
        Set-TestProtectedAcl -LiteralPath $path -OwnerOnly
    }

    if (Test-Path -LiteralPath $childLogPath) { Remove-Item -LiteralPath $childLogPath -Force }
    $global:LASTEXITCODE = $null
    $healthOutput = @(& $wrapperPath -TokenHealth 6>&1)
    Assert-True ($LASTEXITCODE -eq 0) "TokenHealth expected exit 0, got $LASTEXITCODE"
    Assert-True (@($healthOutput | Where-Object { "$_" -ceq 'BLIP_TOKEN_HEALTH=OK' }).Count -eq 1) `
        'TokenHealth did not emit its fixed non-secret success marker.'
    Assert-True (-not (Test-Path -LiteralPath $childLogPath)) `
        'TokenHealth started a collector, model, binder, or post child.'
    $parameterConflictRejected = $false
    try { & $wrapperPath -TokenHealth -PrNumber 511 2>$null }
    catch { $parameterConflictRejected = $true }
    Assert-True $parameterConflictRejected 'TokenHealth accepted a PR-number/review parameter combination.'

    Invoke-WrapperCase -Mode valid -ExpectedExit 0
    Invoke-WrapperCase -Mode request-changes -ExpectedExit 0
    Invoke-WrapperCase -Mode held -ExpectedExit 0
    Invoke-WrapperCase -Mode malformed-post -ExpectedExit 1
    Invoke-WrapperCase -Mode duplicate-gate-marker -ExpectedExit 1

    Write-Manifest -ActiveWrapperPath $wrapperPath -BadWrapperHash
    Invoke-WrapperCase -Mode valid -ExpectedExit 1

    $badAuthPath = Join-Path $codexHome 'bad-auth.json'
    Set-Content -LiteralPath $badAuthPath -Value '{}' -Encoding utf8NoBOM
    Set-TestProtectedAcl -LiteralPath $badAuthPath -OmitSandboxDeny -OwnerOnly
    $badWrapperPath = Join-Path $runtimeRoot 'bad-acl-wrapper.ps1'
    $badText = (Get-Content -Raw -LiteralPath $wrapperPath).Replace(
        "`$codexAuthPath = Join-Path `$codexHome 'auth.json'",
        "`$codexAuthPath = Join-Path `$codexHome 'bad-auth.json'"
    )
    Set-Content -LiteralPath $badWrapperPath -Value $badText -Encoding utf8NoBOM
    Set-TestProtectedAcl -LiteralPath $badWrapperPath
    Write-Manifest -ActiveWrapperPath $badWrapperPath
    $global:LASTEXITCODE = $null
    & $badWrapperPath -PrNumber 511 -AgentTimeoutSec 60 -Jobs 1
    Assert-True ($LASTEXITCODE -eq 1) 'Protected-but-no-deny App path did not fail closed'

    Write-Output 'producer-wrapper-tests-ok (bounded response, token health, phase isolation, 8 wrapper cases)'
}
finally {
    if (Test-Path -LiteralPath $sandboxRoot) { Remove-Item -LiteralPath $sandboxRoot -Recurse -Force }
}
