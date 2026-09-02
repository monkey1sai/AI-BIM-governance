[CmdletBinding()]
param([switch]$SafeOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourceHelper = Join-Path $PSScriptRoot 'provision_blip_protection_admin_token.ps1'
$sourceBroker = Join-Path $PSScriptRoot 'bot\scripts\run_blip_live_approve_once.ps1'

function Assert-True {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw $Message }
}

function Get-DefinedFunctions {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][string[]]$Names
    )
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $LiteralPath, [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -ne 0) { throw "Source does not parse: $LiteralPath" }
    $definitions = @()
    foreach ($name in $Names) {
        $definition = $ast.Find(
            {
                param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                    $node.Name -ceq $name
            },
            $true
        )
        if ($null -eq $definition) { throw "Source lacks function ${name}: $LiteralPath" }
        $definitions += $definition.Extent.Text
    }
    return $definitions
}

$helperTokens = $null
$helperErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
    $sourceHelper, [ref]$helperTokens, [ref]$helperErrors
)
Assert-True ($helperErrors.Count -eq 0) 'Provisioning helper does not parse.'
$helperText = Get-Content -Raw -LiteralPath $sourceHelper
Assert-True ($helperText -match "Read-Host -Prompt 'Enter blip-protection-admin-token' -AsSecureString") `
    'Provisioning helper lost its masked credential prompt.'
Assert-True ($helperText.Contains('[System.IO.FileMode]::CreateNew')) `
    'Provisioning helper no longer refuses to overwrite an existing credential file.'
Assert-True ($helperText -notmatch '(?i)Write-(Output|Host|Information)[^\r\n]*plainToken') `
    'Provisioning helper appears to print the credential.'
Assert-True ($helperText.Contains('SetAccessRuleProtection($true, $false)')) `
    'Provisioning helper no longer writes a protected (non-inherited) ACL.'
Write-Output 'provision-safe-tests-ok (parse, masked prompt, no overwrite, no echo, protected ACL)'
if ($SafeOnly) { return }

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentSid = $identity.User.Value
try {
    $sandboxSidValue = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier]).Value
}
catch {
    Write-Output 'provision-acl-tests-skipped (CodexSandboxUsers group unavailable)'
    return
}
if (@($identity.Groups | ForEach-Object { $_.Value }) -contains $sandboxSidValue) {
    throw 'This ACL integration test must run from the owner-controlled non-sandbox process.'
}

# Test scope substitutes the current account for the fixed owner SID so the
# extracted production functions can be exercised without the real owner
# environment; the broker remains the runtime authority.
$fixedOwnerSidValue = $currentSid
$fixedOwnerSid = [System.Security.Principal.SecurityIdentifier]::new($currentSid)
. ([ScriptBlock]::Create((Get-DefinedFunctions -LiteralPath $sourceHelper -Names @(
    'Get-SandboxSid',
    'Assert-FixedOwnerIdentity',
    'New-OwnerOnlyTokenFileSecurity',
    'Assert-ProvisionedTokenAcl'
)) -join "`n"))
$secretRoot = $null
. ([ScriptBlock]::Create((Get-DefinedFunctions -LiteralPath $sourceBroker -Names @(
    'Assert-ProtectedSecretAcl'
)) -join "`n"))

$sandboxDir = Join-Path ([System.IO.Path]::GetTempPath()) `
    ('blip-provision-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $sandboxDir | Out-Null
try {
    # Regression for the reported finding: a normally created file inherits its
    # parent's ACEs and the broker must reject it.
    $inheritedPath = Join-Path $sandboxDir 'inherited-token.txt'
    Set-Content -LiteralPath $inheritedPath -Value ('x' * 40) -Encoding ascii
    $inheritedRejected = $false
    try { Assert-ProtectedSecretAcl -LiteralPaths @($inheritedPath) }
    catch { $inheritedRejected = $true }
    Assert-True $inheritedRejected `
        'Broker secret-ACL gate accepted a normally created (inherited-ACL) credential file.'

    # A file provisioned with the helper security descriptor must pass the
    # broker gate end to end.
    $provisionedPath = Join-Path $sandboxDir 'provisioned-token.txt'
    $security = New-OwnerOnlyTokenFileSecurity
    $stream = [System.IO.FileSystemAclExtensions]::Create(
        [System.IO.FileInfo]::new($provisionedPath),
        [System.IO.FileMode]::CreateNew,
        ([System.Security.AccessControl.FileSystemRights]::WriteData -bor
            [System.Security.AccessControl.FileSystemRights]::ReadPermissions),
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough,
        $security
    )
    try {
        $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(('y' * 40) + "`n")
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    finally { $stream.Dispose() }
    Assert-ProvisionedTokenAcl -LiteralPath $provisionedPath
    Assert-ProtectedSecretAcl -LiteralPaths @($provisionedPath)

    Write-Output 'provision-acl-tests-ok (inherited rejected, provisioned accepted by broker gate)'
}
finally {
    if (Test-Path -LiteralPath $sandboxDir) { Remove-Item -LiteralPath $sandboxDir -Recurse -Force }
}
