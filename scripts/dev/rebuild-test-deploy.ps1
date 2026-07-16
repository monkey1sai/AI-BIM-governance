# scripts\dev\rebuild-test-deploy.ps1
# Build-only test deployment rebuild wrapper. The deployment launch path remains
# D:\Users\deploy\AI-bim-geo\scripts\deploy.ps1 -Build.

[CmdletBinding()]
param(
    [switch] $Build,
    [string] $ExpectedMainSha = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Build) {
    throw 'Usage: .\scripts\dev\rebuild-test-deploy.ps1 -Build'
}

. (Join-Path $PSScriptRoot '..\lib\rebuild-test-deploy.ps1')

$result = Invoke-TestDeployRebuild -Build -ExpectedMainSha $ExpectedMainSha

Write-Host "[rebuild-test-deploy] deployment_path=$($result.DeploymentPath)"
Write-Host "[rebuild-test-deploy] origin_main_commit=$($result.OriginMainCommit)"
Write-Host "[rebuild-test-deploy] removed_agent_tooling_count=$($result.RemovedAgentToolingCount)"
Write-Host "[rebuild-test-deploy] restored_env_file_count=$($result.RestoredEnvFileCount)"
Write-Host "[rebuild-test-deploy] deploy_exit_code=$($result.DeployExitCode)"

exit $result.DeployExitCode
