[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')
. (Join-Path $PSScriptRoot '..\lib\rebuild-test-deploy.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$testName = 'rebuild-test-deploy'
$sandbox = New-TestSandbox -Prefix $testName

try {
    $expected = 'D:\Users\deploy\AI-bim-geo'
    Assert-Equal $expected (Assert-TestDeployPath -Path $expected) 'fixed deployment path is accepted'
    Assert-Throws { Assert-TestDeployPath -Path 'D:\Users\deploy\AI-bim-geo2' } 'nearby deployment path is rejected'
    Assert-Throws { Assert-TestDeployPath -Path $sandbox } 'temporary sandbox path is rejected'

    $cleanupRoot = Join-Path $sandbox 'AI-bim-geo'
    $toolingDirNames = @('.codex', '.agents', '.agent', '.claude', '.cursor', '.windsurf', '.github\skills', '.github\prompts', 'docs', 'openspec', 'patches')
    New-Item -ItemType Directory -Path $cleanupRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot '.github\workflows') -Force | Out-Null
    foreach ($dirName in $toolingDirNames) {
        New-Item -ItemType Directory -Path (Join-Path $cleanupRoot "$dirName\content") -Force | Out-Null
    }
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot 'apps\kit-manager-web') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot 'scripts') -Force | Out-Null
    'root agent' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'AGENTS.md') -Encoding ascii
    'root claude' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'CLAUDE.md') -Encoding ascii
    'nested agent' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'apps\kit-manager-web\AGENTS.md') -Encoding ascii
    'workflow' | Set-Content -LiteralPath (Join-Path $cleanupRoot '.github\workflows\ci.yml') -Encoding ascii
    'deploy' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'scripts\deploy.ps1') -Encoding ascii

    Assert-Throws { Remove-TestDeployAgentTooling -DeploymentPath $cleanupRoot } 'temporary cleanup root requires explicit test escape'

    $removed = Remove-TestDeployAgentTooling -DeploymentPath $cleanupRoot -AllowNonFixedPathForTests
    Assert-True ($removed.Count -ge 4) 'agent/tooling paths are reported as removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'AGENTS.md'))) 'root AGENTS.md removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'CLAUDE.md'))) 'root CLAUDE.md removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'apps\kit-manager-web\AGENTS.md'))) 'nested AGENTS.md removed'
    foreach ($dirName in $toolingDirNames) {
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot $dirName))) "root $dirName removed"
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $cleanupRoot '.github\workflows\ci.yml')) '.github workflows kept'
    Assert-True (Test-Path -LiteralPath (Join-Path $cleanupRoot 'scripts\deploy.ps1')) 'deploy.ps1 kept'

    $calls = New-Object 'System.Collections.Generic.List[string]'
    $runner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:calls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
        if ($Arguments -contains 'fetch') {
            return [pscustomobject]@{ ExitCode = 23; Output = 'fetch failed' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $script:calls = $calls
    $mainRefSpec = '+refs/heads/main:refs/remotes/origin/main'
    $fetchFailureMessage = $null
    try {
        Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('fetch', 'origin', $mainRefSpec) -WorkingDirectory $cleanupRoot -CommandRunner $runner
    } catch {
        $fetchFailureMessage = $_.Exception.Message
    }
    Assert-True (-not [string]::IsNullOrWhiteSpace($fetchFailureMessage)) 'fetch failure is surfaced as a blocker'
    Assert-True ($fetchFailureMessage -match 'exit code 23') 'fetch failure includes exit code'
    Assert-True ($fetchFailureMessage -match 'fetch failed') 'fetch failure includes command output'
    Assert-True ($calls.Count -gt 0) 'fetch command was attempted'
    Assert-True ($calls[0] -match [regex]::Escape("git fetch origin $mainRefSpec")) 'fetch command updates origin/main ref'

    $okRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }
    $okResult = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('status', '--short') -WorkingDirectory $cleanupRoot -CommandRunner $okRunner
    Assert-Equal 0 $okResult.ExitCode 'successful command returns exit code'
    Assert-Equal 'ok' $okResult.Output 'successful command returns output'

    $stderrCmd = Join-Path $sandbox 'native-stderr-ok.cmd'
    "@echo off`r`necho native stderr ok 1>&2`r`nexit /b 0`r`n" | Set-Content -LiteralPath $stderrCmd -Encoding ascii
    $stderrResult = Invoke-TestDeployGitCommand -Tool 'cmd.exe' -Arguments @('/c', $stderrCmd) -WorkingDirectory $cleanupRoot
    Assert-Equal 0 $stderrResult.ExitCode 'native stderr command returns exit code zero'
    Assert-True ($stderrResult.Output -match 'native stderr ok') 'native stderr is captured without throwing'

    $rebuildRoot = Join-Path $sandbox 'rebuild-root'
    $rebuildDeployRoot = Join-Path $sandbox 'rebuild-deploy'
    New-Item -ItemType Directory -Path $rebuildRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $rebuildDeployRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $rebuildDeployRoot 'scripts') -Force | Out-Null
    'deploy' | Set-Content -LiteralPath (Join-Path $rebuildDeployRoot 'scripts\deploy.ps1') -Encoding ascii

    $rebuildCalls = New-Object 'System.Collections.Generic.List[string]'
    $rebuildRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:rebuildCalls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'https://example.invalid/AI-BIM-governance.git' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abc1234' }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq "fetch origin $mainRefSpec") {
            return [pscustomobject]@{ ExitCode = 23; Output = 'fetch failed' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $script:rebuildCalls = $rebuildCalls
    $deployWasCalled = $false
    $deployRunner = {
        param([string] $DeployRoot)
        $script:deployWasCalled = $true
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()

    $rebuildFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $rebuildDeployRoot -AllowNonFixedPathForTests -CommandRunner $rebuildRunner -DeployRunner $deployRunner | Out-Null
    } catch {
        $rebuildFailureMessage = $_.Exception.Message
    }
    Assert-True (-not [string]::IsNullOrWhiteSpace($rebuildFailureMessage)) 'rebuild fetch failure is surfaced'
    Assert-True ($rebuildFailureMessage -match 'exit code 23') 'rebuild fetch failure includes exit code'
    Assert-True ($rebuildFailureMessage -match 'fetch failed') 'rebuild fetch failure includes command output'
    Assert-True (($rebuildCalls -join "`n") -match [regex]::Escape("git fetch origin $mainRefSpec")) 'rebuild attempted explicit origin/main ref update'
    Assert-True (-not (($rebuildCalls -join "`n") -match 'git reset --hard origin/main')) 'rebuild stops before reset'
    Assert-True (-not (($rebuildCalls -join "`n") -match 'git clean -fdx')) 'rebuild stops before clean'
    Assert-True (-not $deployWasCalled) 'rebuild stops before deploy'

    $preserveRoot = Join-Path $sandbox 'preserve-root'
    New-Item -ItemType Directory -Path (Join-Path $preserveRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $preserveRoot 'scripts') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $preserveRoot 'bim-review-coordinator') -Force | Out-Null
    'deploy' | Set-Content -LiteralPath (Join-Path $preserveRoot 'scripts\deploy.ps1') -Encoding ascii
    'ROOT_REQUIRED=from-current-version' | Set-Content -LiteralPath (Join-Path $preserveRoot '.env.example') -Encoding ascii
    'COORD_REQUIRED=from-current-version' | Set-Content -LiteralPath (Join-Path $preserveRoot 'bim-review-coordinator\.env.example') -Encoding ascii
    'MINIO_WATCH_ENABLED=true' | Set-Content -LiteralPath (Join-Path $preserveRoot '.env.web-plane.host-kit.example') -Encoding ascii
    @(
        'ROOT_REQUIRED=already-filled-root',
        'ROOT_SECRET=keep-root'
    ) | Set-Content -LiteralPath (Join-Path $preserveRoot '.env') -Encoding ascii
    @(
        'COORD_REQUIRED=already-filled-coordinator',
        'INTERNAL_API_AUTH_TOKEN=keep-coordinator'
    ) | Set-Content -LiteralPath (Join-Path $preserveRoot 'bim-review-coordinator\.env') -Encoding ascii
    @(
        'MINIO_WATCH_ENABLED=true',
        'MINIO_WATCH_ENDPOINT=http://192.168.20.234:9000',
        'MINIO_WATCH_BUCKET=bim-control',
        'MINIO_WATCH_ACCESS_KEY=keep-access-key',
        'MINIO_WATCH_SECRET_KEY=keep-secret-key'
    ) | Set-Content -LiteralPath (Join-Path $preserveRoot '.env.web-plane.host-kit') -Encoding ascii

    $preserveCalls = New-Object 'System.Collections.Generic.List[string]'
    $cleanEvents = New-Object 'System.Collections.Generic.List[string]'
    $preserveRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:preserveCalls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'https://example.invalid/AI-BIM-governance.git' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abc1234' }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq 'clean -fdx') {
            foreach ($relativePath in @('.env', 'bim-review-coordinator\.env', '.env.web-plane.host-kit')) {
                Remove-Item -LiteralPath (Join-Path $WorkingDirectory $relativePath) -Force -ErrorAction Stop
            }
            $script:cleanEvents.Add('removed env files') | Out-Null
            return [pscustomobject]@{ ExitCode = 0; Output = 'removed env files' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abcdef123456' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $script:preserveCalls = $preserveCalls
    $script:cleanEvents = $cleanEvents
    $preserveDeployRunner = {
        param([string] $DeployRoot)
        $rootEnv = Get-Content -LiteralPath (Join-Path $DeployRoot '.env') -Raw
        $coordEnv = Get-Content -LiteralPath (Join-Path $DeployRoot 'bim-review-coordinator\.env') -Raw
        $hostKitEnv = Get-Content -LiteralPath (Join-Path $DeployRoot '.env.web-plane.host-kit') -Raw
        Assert-True ($rootEnv -match 'ROOT_SECRET=keep-root') 'root .env value restored before deploy'
        Assert-True ($coordEnv -match 'INTERNAL_API_AUTH_TOKEN=keep-coordinator') 'coordinator .env value restored before deploy'
        Assert-True ($hostKitEnv -match 'MINIO_WATCH_ACCESS_KEY=keep-access-key') 'MinIO access key restored before deploy'
        Assert-True ($hostKitEnv -match 'MINIO_WATCH_SECRET_KEY=keep-secret-key') 'MinIO secret key restored before deploy'
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()

    $preserveResult = Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $preserveRoot -AllowNonFixedPathForTests -CommandRunner $preserveRunner -DeployRunner $preserveDeployRunner
    Assert-True ($script:cleanEvents.Count -eq 1) 'mock clean removed env files before restore'
    Assert-Equal 3 $preserveResult.RestoredEnvFileCount 'rebuild restores current-version env files before deploy'

    $deployExitRoot = Join-Path $sandbox 'deploy-exit-root'
    New-Item -ItemType Directory -Path (Join-Path $deployExitRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $deployExitRoot 'scripts') -Force | Out-Null
    "exit 7`r`n" | Set-Content -LiteralPath (Join-Path $deployExitRoot 'scripts\deploy.ps1') -Encoding ascii
    $deployExitCalls = New-Object 'System.Collections.Generic.List[string]'
    $deployExitRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:deployExitCalls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'https://example.invalid/AI-BIM-governance.git' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abc1234' }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abcdef123456' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $script:deployExitCalls = $deployExitCalls

    $deployExitResult = Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $deployExitRoot -AllowNonFixedPathForTests -CommandRunner $deployExitRunner
    Assert-Equal 7 $deployExitResult.DeployExitCode 'deploy.ps1 exit code is returned without terminating caller'

    $wrapper = Join-Path $repoRoot 'scripts\dev\rebuild-test-deploy.ps1'
    Assert-True (Test-Path -LiteralPath $wrapper) 'wrapper exists'
    $wrapperText = Get-Content -LiteralPath $wrapper -Raw
    Assert-True ($wrapperText -match '\[switch\]\s+\$Build') 'wrapper exposes Build switch'
    $forbiddenWrapperToken = 'Dry' + 'Run'
    Assert-True ($wrapperText -notmatch [regex]::Escape($forbiddenWrapperToken)) 'wrapper does not expose forbidden token'

    Write-TestPass $testName
} catch {
    Write-TestFail $testName $_.Exception.Message
    throw
} finally {
    Remove-TestSandbox -Path $sandbox
}
