# scripts\dev\rebuild-test-deploy.ps1
# Build-only test deployment rebuild wrapper. The deployment launch path remains
# D:\Users\deploy\AI-bim-geo\scripts\deploy.ps1 -Build.

[CmdletBinding()]
param(
    [switch] $Build
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Build) {
    throw 'Usage: .\scripts\dev\rebuild-test-deploy.ps1 -Build'
}

. (Join-Path $PSScriptRoot '..\lib\rebuild-test-deploy.ps1')

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
