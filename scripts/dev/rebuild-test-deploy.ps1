# scripts\dev\rebuild-test-deploy.ps1
# Single operator entrypoint for test-deployment rebuilds (decision D-10).
# The target defaults to the registry's canonical_target (remote-linux-181);
# -TargetId local-windows selects the on-demand Windows verification target (D-3).

[CmdletBinding()]
param(
    [switch] $Build,
    [string] $TargetId = '',
    [string] $IdentityFile = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Build) {
    throw 'Usage: .\scripts\dev\rebuild-test-deploy.ps1 -Build [-TargetId <registry id>] [-IdentityFile <ssh key>]'
}

. (Join-Path $PSScriptRoot '..\lib\rebuild-test-deploy.ps1')
. (Join-Path $PSScriptRoot '..\lib\remote-deploy-transport.ps1')

$operatorRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$target = if ([string]::IsNullOrWhiteSpace($TargetId)) { Get-DeployTarget -Canonical } else { Get-DeployTarget -Id $TargetId }

if ([string]$target.connection.type -eq 'ssh') {
    $result = Invoke-RemoteTestDeployRebuild -Target $target -OperatorRepoRoot $operatorRepoRoot -Build:$Build -IdentityFile $IdentityFile
    $lifecycleMessage = if ($result.ExitCode -eq 0) { 'remote test deployment rebuild completed' } else { 'remote test deployment rebuild failed' }
    $lifecycleLevel = if ($result.ExitCode -eq 0) { 'info' } else { 'error' }
    Write-TestDeployLifecycleLog -Message $lifecycleMessage -Level $lifecycleLevel -Data @{
        target_id = [string]$target.id
        deploy_exit_code = $result.ExitCode
        effective_env_snapshot = $result.SnapshotPath
    }
    exit $result.ExitCode
}

$result = Invoke-TestDeployRebuild -Build

$lifecycleMessage = if ($result.DeployExitCode -eq 0) {
    'test deployment rebuild completed'
} else {
    'test deployment rebuild failed'
}
$lifecycleLevel = if ($result.DeployExitCode -eq 0) { 'info' } else { 'error' }
Write-TestDeployLifecycleLog -Message $lifecycleMessage -Level $lifecycleLevel -Data @{
    deployment_path = $result.DeploymentPath
    previous_path = $result.PreviousPath
    origin_main_commit = $result.OriginMainCommit
    removed_agent_tooling_count = $result.RemovedAgentToolingCount
    restored_env_file_count = $result.RestoredEnvFileCount
    deploy_exit_code = $result.DeployExitCode
}

exit $result.DeployExitCode
