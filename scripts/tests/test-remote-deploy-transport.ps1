[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Action,
        [Parameter(Mandatory = $true)][string] $MessagePattern,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $failed = $false
    try { & $Action } catch {
        $failed = $true
        if ($_.Exception.Message -notmatch $MessagePattern) {
            throw "ASSERT FAILED: $Context threw, but message '$($_.Exception.Message)' does not match '$MessagePattern'."
        }
    }
    Assert-True $failed "$Context was expected to throw."
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $repoRoot 'scripts/lib/deploy-target-registry.ps1')
. (Join-Path $repoRoot 'scripts/lib/remote-deploy-transport.ps1')

# --- env parsing and layering -------------------------------------------------------
$base = @"
# comment line
PUBLIC_HOST=192.168.20.181
KIT_STREAM_SERVER=192.168.20.181
A4_INTERNAL_CONTEXT_TOKEN=super-secret-value
EMPTY_OK=

not-a-valid-line
1BAD_KEY=nope
"@
$override = @"
KIT_STREAM_SERVER=10.0.0.9
LOCAL_ONLY_FLAG=1
"@

$merge = Merge-DeployTargetEnvLayers -BaseContent $base -OverrideContent $override
Assert-True ($merge.Values['KIT_STREAM_SERVER'] -eq '10.0.0.9') 'override must win per key'
Assert-True ($merge.Values['PUBLIC_HOST'] -eq '192.168.20.181') 'base-only keys must survive'
Assert-True ($merge.Values['LOCAL_ONLY_FLAG'] -eq '1') 'override-only keys must be appended'
Assert-True ($merge.Values['EMPTY_OK'] -eq '') 'empty values are legal'
Assert-True (-not $merge.Values.Contains('1BAD_KEY')) 'invalid key names are ignored'
Assert-True (@($merge.OverriddenKeys) -contains 'KIT_STREAM_SERVER') 'overridden keys are reported'
Assert-True (@($merge.OverrideOnlyKeys) -contains 'LOCAL_ONLY_FLAG') 'override-only keys are reported'
Assert-True (@($merge.Values.Keys)[0] -eq 'PUBLIC_HOST') 'base key order is preserved'

$emptyMerge = Merge-DeployTargetEnvLayers -BaseContent '' -OverrideContent ''
Assert-True (@($emptyMerge.Values.Keys).Count -eq 0) 'empty layers merge to empty'

$roundtrip = ConvertTo-DeployEnvContent -Values $merge.Values
Assert-True ($roundtrip -match '(?m)^KIT_STREAM_SERVER=10\.0\.0\.9$') 'serialized content carries merged values'

# --- effective-env snapshot masking -------------------------------------------------
$snapshot = New-DeployTargetEnvSnapshot -Values $merge.Values -TargetId 'remote-linux-181' -OverriddenKeys $merge.OverriddenKeys
Assert-True ([string]$snapshot.schema_version -eq 'deploy-target-env-snapshot/v1') 'snapshot schema version'
$tokenEntry = @($snapshot.entries | Where-Object { $_.key -eq 'A4_INTERNAL_CONTEXT_TOKEN' })[0]
Assert-True ([bool]$tokenEntry.secret) 'token key must be classified secret'
Assert-True ($tokenEntry.fingerprint -match '^[0-9a-f]{8}$') 'secret entry carries an 8-hex fingerprint'
Assert-True ($null -eq $tokenEntry.PSObject.Properties['value']) 'secret entry must not carry the value'
Assert-True ([int]$tokenEntry.length -eq 'super-secret-value'.Length) 'secret entry records only the length'
$hostEntry = @($snapshot.entries | Where-Object { $_.key -eq 'PUBLIC_HOST' })[0]
Assert-True (-not [bool]$hostEntry.secret) 'public host is not secret'
Assert-True ([string]$hostEntry.value -eq '192.168.20.181') 'non-secret entry carries the clear value'
$snapshotJson = $snapshot | ConvertTo-Json -Depth 6
Assert-True ($snapshotJson -notmatch 'super-secret-value') 'serialized snapshot must never contain a secret value'

$snapshot2 = New-DeployTargetEnvSnapshot -Values $merge.Values -TargetId 'remote-linux-181'
$fp1 = @($snapshot.entries | Where-Object { $_.key -eq 'A4_INTERNAL_CONTEXT_TOKEN' })[0].fingerprint
$fp2 = @($snapshot2.entries | Where-Object { $_.key -eq 'A4_INTERNAL_CONTEXT_TOKEN' })[0].fingerprint
Assert-True ($fp1 -eq $fp2) 'fingerprint must be deterministic'

# --- remote rebuild script generation ----------------------------------------------
$remoteTarget = Get-DeployTarget -Id 'remote-linux-181'
$script = New-RemoteRebuildScript -Target $remoteTarget -Build

Assert-True ($script.Contains("git fetch origin '+refs/heads/main:refs/remotes/origin/main'")) 'script must freshly fetch with the contract refspec'
Assert-True ($script.Contains('git clone "$REPO_URL" "$DEPLOY_ROOT"')) 'script must clone when the checkout is missing'
Assert-True ($script.Contains('https://github.com/monkey1sai/AI-BIM-governance.git')) 'clone must use the zero-credential https url'
Assert-True ($script.Contains('git reset --hard refs/remotes/origin/main')) 'script must reset to fresh origin/main'
Assert-True ($script.Contains("git clean -fd -e '.env*'")) 'clean must preserve env files'
Assert-True ($script.Contains('restore exec bits (F-2)')) 'linux target script must restore exec bits'
Assert-True ($script.Contains('scripts/deploy.ps1 -Build')) 'build flag must run deploy.ps1 -Build'
Assert-True ($script.Contains('/home/bimdeploy/AI-bim-geo-data/env.local') -or $script.Contains('DATA_ROOT=''/home/bimdeploy/AI-bim-geo-data''')) 'override layer must live under the runtime data root, outside git clean reach'
Assert-True ($script.Contains('Merge-DeployTargetEnvLayers')) 'remote merge must call the shared lib function (single implementation)'
Assert-True ($script.Contains('/transport-lib.ps1')) 'remote merge must use the operator-shipped lib copy, never assume the checkout has it (pre-merge branches never do)'
Assert-True (-not $script.Contains("`r")) 'script must be LF-only'
Assert-True (-not ($script -match '\{\{[A-Z_]+\}\}')) 'no unreplaced template placeholders'

$scriptNoBuild = New-RemoteRebuildScript -Target $remoteTarget
Assert-True (-not $scriptNoBuild.Contains('scripts/deploy.ps1 -Build')) 'without -Build the script must not run the build'

$windowsTarget = Get-DeployTarget -Id 'local-windows'
Assert-Throws -Context 'script generation for a non-ssh target' -MessagePattern 'not an ssh target' -Action {
    New-RemoteRebuildScript -Target $windowsTarget
}

# --- ssh argument shape -------------------------------------------------------------
$sshArguments = Get-RemoteDeploySshArguments -Target $remoteTarget
Assert-True (($sshArguments -join ' ').Contains('BatchMode=yes')) 'ssh must run in batch mode (no interactive prompts)'
Assert-True ($sshArguments[-1] -eq 'bimdeploy@192.168.20.181') 'ssh endpoint must come from the registry'
$sshWithKey = Get-RemoteDeploySshArguments -Target $remoteTarget -IdentityFile 'C:/keys/bim'
Assert-True (($sshWithKey -join ' ').Contains('-i C:/keys/bim')) 'identity file must be honored'

# --- dispatch dry run ---------------------------------------------------------------
$tempRoot = Join-Path $repoRoot "artifacts/tmp/remote-transport-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    Assert-Throws -Context 'dispatch without the operator canonical env file' -MessagePattern 'canonical env file not found' -Action {
        Invoke-RemoteTestDeployRebuild -Target $remoteTarget -OperatorRepoRoot $tempRoot -DryRun
    }

    Set-Content -LiteralPath (Join-Path $tempRoot ([string]$remoteTarget.env_file)) -Value "PUBLIC_HOST=192.168.20.181`n" -Encoding utf8
    $dry = Invoke-RemoteTestDeployRebuild -Target $remoteTarget -OperatorRepoRoot $tempRoot -Build -DryRun
    Assert-True ($dry.SshArguments[-1] -eq 'bimdeploy@192.168.20.181') 'dry run must expose the ssh endpoint'
    Assert-True ($dry.PushCommand.Contains('/home/bimdeploy/AI-bim-geo/.env.web-plane.host-kit.base')) 'base env must land beside the effective env with the .base suffix'
    Assert-True ($dry.LibPushCommand.Contains('/home/bimdeploy/AI-bim-geo-data/transport-lib.ps1')) 'transport lib must be shipped to the runtime data root'
    Assert-True ($dry.Script.Contains('deploy.ps1 -Build')) 'dry run script must include the build step'

    Write-Host '[test-remote-deploy-transport] all assertions passed'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
