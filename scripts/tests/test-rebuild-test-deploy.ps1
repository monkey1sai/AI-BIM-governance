[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')
. (Join-Path $PSScriptRoot '..\lib\rebuild-test-deploy.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$testName = 'rebuild-test-deploy'
$sandbox = New-TestSandbox -Prefix $testName

function New-DeployEdgeVolumeHarness {
    param(
        [Parameter(Mandatory = $true)][string] $DeployRoot,
        [Parameter(Mandatory = $true)][string] $SourceRepoRoot
    )

    $scriptsRoot = Join-Path $DeployRoot 'scripts'
    $libRoot = Join-Path $scriptsRoot 'lib'
    New-Item -ItemType Directory -Path $libRoot -Force | Out-Null

    $deploySourcePath = Join-Path $SourceRepoRoot 'scripts\deploy.ps1'
    $deployScript = Get-Content -LiteralPath $deploySourcePath -Raw
    $fixedRootLine = "`$script:FixedTestDeployRoot = 'D:\Users\deploy\AI-bim-geo'"
    $testRootLine = "`$script:FixedTestDeployRoot = '$DeployRoot'"
    $deployScript = $deployScript.Replace($fixedRootLine, $testRootLine)
    if ($deployScript -notmatch [regex]::Escape($testRootLine)) {
        throw 'New-DeployEdgeVolumeHarness: failed to rewrite FixedTestDeployRoot in deploy.ps1'
    }
    Set-Content -LiteralPath (Join-Path $scriptsRoot 'deploy.ps1') -Value $deployScript -Encoding ascii

    @'
function Write-DeployHeader {
    param([string] $Title)
}

function Write-DeployTag {
    param(
        [string] $Tag,
        [string] $Message,
        [string] $LogPath
    )
    return "$Tag $Message"
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'deploy-report.ps1') -Encoding ascii

    @'
function Test-DockerEnvironment {
    param([string] $RepoRoot)

    $realEnv = Join-Path $RepoRoot '.env.web-plane.host-kit'
    $exampleEnv = "$realEnv.example"
    $envFile = if (Test-Path -LiteralPath $realEnv) {
        '.env.web-plane.host-kit'
    } elseif (Test-Path -LiteralPath $exampleEnv) {
        '.env.web-plane.host-kit.example'
    } else {
        $null
    }

    return [pscustomobject]@{
        cliVersion    = '24.0.0'
        composeV2     = $true
        engineRunning = $true
        envFile       = $envFile
    }
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'preflight-docker.ps1') -Encoding ascii

    @'
function Test-HostNativeEnvironment {
    param([string] $RepoRoot)

    return [pscustomobject]@{
        venv                        = 'OK'
        kitLauncher                 = 'OK'
        nvidiaDriver                = 'OK'
        pythonDependencies          = 'OK'
        pythonDependencyFastApi     = '0.115.0'
        pythonDependencyStarlette   = '0.37.2'
        pythonDependencyUvicorn     = '0.30.6'
        pythonDependencyReason      = ''
        kitRuntime                  = 'OK'
        kitBuildRequired            = $false
        kitBuildReason              = ''
        kitBuildCommand             = ''
    }
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'preflight-host-native.ps1') -Encoding ascii

    @'
function Get-EnvExampleDefaultValue {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Key
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return ''
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*[:=]\s*(.*)$") {
            return $matches[1].Trim()
        }
    }

    return ''
}

function Test-EnvFiles {
    param([string] $RepoRoot)

    $envPath = Join-Path $RepoRoot '.env.web-plane.host-kit'
    $examplePath = "$envPath.example"

    return @([pscustomobject]@{
        file          = '.env.web-plane.host-kit'
        envExists     = (Test-Path -LiteralPath $envPath -PathType Leaf)
        exampleExists = (Test-Path -LiteralPath $examplePath -PathType Leaf)
        missing       = @()
    })
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'preflight-env.ps1') -Encoding ascii

    @'
function Test-PortAvailability {
    param(
        [string] $RepoRoot,
        [int] $KitSignalPort,
        [int] $KitMediaPort,
        [int[]] $ExtraHostNativePorts,
        [int[]] $ExtraHostNativeUdpPorts
    )

    return [pscustomobject]@{
        docker     = @()
        hostNative = @()
    }
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'preflight-ports.ps1') -Encoding ascii

    @'
function Test-VolumeAlignment {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $EnvFile
    )

    $envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
        $EnvFile
    } else {
        Join-Path $RepoRoot $EnvFile
    }

    $runtimeStorageRoot = Get-EnvExampleDefaultValue -Path $envPath -Key 'RUNTIME_STORAGE_ROOT'
    if ([string]::IsNullOrWhiteSpace($runtimeStorageRoot)) {
        return [pscustomobject]@{
            runtimeStorageRoot = ''
            leaf               = ''
            status             = 'MISSING_KEY'
        }
    }

    if (-not [System.IO.Path]::IsPathRooted($runtimeStorageRoot)) {
        $runtimeStorageRoot = Join-Path $RepoRoot $runtimeStorageRoot
    }

    $fullRoot = [System.IO.Path]::GetFullPath($runtimeStorageRoot)
    $leaf = Split-Path -Leaf $fullRoot

    return [pscustomobject]@{
        runtimeStorageRoot = $fullRoot
        leaf               = $leaf
        status             = $(if ($leaf -eq 'storage') { 'ALIGNED' } else { 'WRONG_LEAF' })
    }
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'preflight-volume-alignment.ps1') -Encoding ascii

    @'
function Start-HostNativeConversion {
    param(
        [string] $RepoRoot,
        [string] $RuntimeStorageRoot,
        [string] $BindHost,
        [string] $PublicArtifactsUrl
    )

    $capturePath = [Environment]::GetEnvironmentVariable('TEST_CAPTURE_VOLUME_PATH', 'Process')
    if (-not [string]::IsNullOrWhiteSpace($capturePath)) {
        Set-Content -LiteralPath $capturePath -Value $RuntimeStorageRoot -Encoding ascii
    }

    $logPath = Join-Path $RepoRoot 'scripts\.run\mock-conversion.log'
    Set-Content -LiteralPath $logPath -Value 'conversion started' -Encoding ascii

    return [pscustomobject]@{
        Pid     = 4242
        LogPath = $logPath
    }
}

function Start-HostNativeGovernance {
    param([string] $RepoRoot, [int] $Port, [string] $DbPath, [string] $FileLibraryRoot)
    return [pscustomobject]@{ Pid = 4343; LogPath = (Join-Path $RepoRoot 'scripts\.run\mock-governance.log') }
}

function Start-HostNativeKit {
    param([string] $RepoRoot, [int] $SignalPort, [int] $StreamPort, [string] $PublicIp, [int[]] $SpectatorSignalPorts, [int[]] $SpectatorStreamPorts)
    return [pscustomobject]@{ Pid = 4444; LogPath = (Join-Path $RepoRoot 'scripts\.run\mock-kit.log') }
}

function Wait-HostNativeHealth {
    param([string] $Name, [string] $Url, [int] $TimeoutSec)
    return $true
}

function Test-AlreadyRunning {
    param([string] $Name, [string] $RunDir)
    return $false
}

function Stop-HostNativeService {
    param([string] $Name, [string] $RunDir)
}

function Set-KitRuntimeSignature {
    param([string] $Path, $Value)
    $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Path -Encoding ascii
}

function Test-KitRuntimeSignatureMatches {
    param([string] $Path, $Expected)
    return $false
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'host-native-launcher.ps1') -Encoding ascii

    @'
function Wait-KitReady {
    param([string] $LogPath, [int] $SignalPort, [int] $TimeoutSec)
    return [pscustomobject]@{
        ready          = $true
        listenPort     = $SignalPort
        matchedKeyword = 'mock-ready'
    }
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'kit-log-probe.ps1') -Encoding ascii
}

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
        if ($commandText -eq 'clean -fdx -e bim-streaming-server/_build/**/logs/**') {
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
    Assert-True (@($preserveCalls | Where-Object { $_ -match [regex]::Escape('clean -fdx -e bim-streaming-server/_build/**/logs/**') }).Count -ge 1) 'git clean excludes chronic Kit runtime-log lock path'

    $dryRunEdgeRoot = Join-Path $sandbox 'dry-run-edge-runtime-data'
    $dryRunDeployRoot = Join-Path $sandbox 'dry-run-artifact-contract-root'
    New-Item -ItemType Directory -Path (Join-Path $dryRunDeployRoot '.git') -Force | Out-Null
    New-DeployEdgeVolumeHarness -DeployRoot $dryRunDeployRoot -SourceRepoRoot $repoRoot
    @(
        'RUNTIME_STORAGE_ROOT=./storage',
        'MINIO_WATCH_ENABLED=true'
    ) | Set-Content -LiteralPath (Join-Path $dryRunDeployRoot '.env.web-plane.host-kit.example') -Encoding ascii

    $dryRunEdgeRootBackup = [Environment]::GetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', $dryRunEdgeRoot, 'Process')
        $dryRunProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\deploy.ps1', '-DryRun', '-SkipDocker', '-SkipGovernance', '-SkipKit', '-PublicHost', '127.0.0.1') -WorkingDirectory $dryRunDeployRoot -NoNewWindow -Wait -PassThru

        Assert-Equal 0 $dryRunProcess.ExitCode 'deploy dry-run exits successfully'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $dryRunEdgeRoot 'storage'))) 'deploy dry-run does not create external storage root'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $dryRunEdgeRoot 'artifacts'))) 'deploy dry-run does not create external artifact root'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $dryRunEdgeRoot 'ledgers'))) 'deploy dry-run does not create external ledger root'
    } finally {
        [Environment]::SetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', $dryRunEdgeRootBackup, 'Process')
    }

    $artifactRoot = Join-Path $sandbox 'edge-runtime-data'
    $artifactSentinel = Join-Path $artifactRoot 'ledgers\sentinel.txt'
    New-Item -ItemType Directory -Path (Split-Path -Parent $artifactSentinel) -Force | Out-Null
    'keep-me' | Set-Content -LiteralPath $artifactSentinel -Encoding ascii
    $artifactDeployRoot = Join-Path $sandbox 'artifact-contract-root'
    New-Item -ItemType Directory -Path (Join-Path $artifactDeployRoot '.git') -Force | Out-Null
    New-DeployEdgeVolumeHarness -DeployRoot $artifactDeployRoot -SourceRepoRoot $repoRoot
    @(
        'RUNTIME_STORAGE_ROOT=./storage',
        'MINIO_WATCH_ENABLED=true'
    ) | Set-Content -LiteralPath (Join-Path $artifactDeployRoot '.env.web-plane.host-kit.example') -Encoding ascii

    $artifactEnvNames = @(
        'EDGE_SITE_ID',
        'EDGE_RUNTIME_DATA_ROOT',
        'RUNTIME_STORAGE_ROOT',
        'STORAGE_HOST_ROOT',
        'STREAMING_CONVERSION_ARTIFACTS_ROOT',
        'CONVERSION_LEDGER_STORE_PATH',
        'ARTIFACT_HEALTH_LEDGER_STORE_PATH'
    )
    $artifactEnvBackup = @{}
    foreach ($name in $artifactEnvNames) {
        $artifactEnvBackup[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }

    try {
        [Environment]::SetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', $artifactRoot, 'Process')
        [Environment]::SetEnvironmentVariable('RUNTIME_STORAGE_ROOT', (Join-Path $artifactDeployRoot 'storage'), 'Process')
        [Environment]::SetEnvironmentVariable('STORAGE_HOST_ROOT', (Join-Path $artifactDeployRoot 'storage'), 'Process')
        [Environment]::SetEnvironmentVariable('CONVERSION_LEDGER_STORE_PATH', (Join-Path $artifactDeployRoot 'ledgers\conversion-ledger.json'), 'Process')
        [Environment]::SetEnvironmentVariable('ARTIFACT_HEALTH_LEDGER_STORE_PATH', (Join-Path $artifactDeployRoot 'ledgers\artifact-health-ledger.json'), 'Process')
        $capturedVolumePath = Join-Path $sandbox 'captured-conversion-volume.txt'
        [Environment]::SetEnvironmentVariable('TEST_CAPTURE_VOLUME_PATH', $capturedVolumePath, 'Process')

        $artifactRunner = {
            param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
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

        $artifactDeployRunner = {
            param([string] $DeployRoot)
            Assert-True (Test-Path -LiteralPath (Join-Path $artifactRoot 'storage') -PathType Container) 'rebuild creates external storage root'
            Assert-True (Test-Path -LiteralPath (Join-Path $artifactRoot 'artifacts') -PathType Container) 'rebuild creates external artifact root'
            Assert-True (Test-Path -LiteralPath (Join-Path $artifactRoot 'ledgers') -PathType Container) 'rebuild creates external ledger root'
            Assert-True (Test-Path -LiteralPath $artifactSentinel -PathType Leaf) 'external ledger sentinel survives rebuild helper'
            Assert-True (-not (Test-Path -LiteralPath (Join-Path $DeployRoot 'ledgers\sentinel.txt'))) 'deployment checkout does not absorb external ledger sentinel'
            $deployProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\deploy.ps1', '-Build', '-SkipDocker', '-SkipGovernance', '-SkipKit', '-PublicHost', '127.0.0.1') -WorkingDirectory $DeployRoot -NoNewWindow -Wait -PassThru
            Assert-Equal 0 $deployProcess.ExitCode 'deploy harness exits successfully'
            Assert-True (Test-Path -LiteralPath (Join-Path $DeployRoot '.env.web-plane.host-kit') -PathType Leaf) 'deploy copies missing host-kit env from example'
            Assert-True (Test-Path -LiteralPath $capturedVolumePath -PathType Leaf) 'conversion harness captures runtime storage root'
            $capturedVolume = (Get-Content -LiteralPath $capturedVolumePath -Raw).Trim()
            Assert-Equal (Join-Path $artifactRoot 'storage') $capturedVolume 'host-native conversion keeps edge runtime storage root after env repair'
            Assert-True ($capturedVolume -ne (Join-Path $DeployRoot 'storage')) 'host-native conversion does not fall back to deploy checkout storage'
            return [pscustomobject]@{ ExitCode = $deployProcess.ExitCode }
        }.GetNewClosure()

        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $artifactDeployRoot -AllowNonFixedPathForTests -CommandRunner $artifactRunner -DeployRunner $artifactDeployRunner | Out-Null
    } finally {
        foreach ($name in $artifactEnvNames) {
            [Environment]::SetEnvironmentVariable($name, $artifactEnvBackup[$name], 'Process')
        }
        [Environment]::SetEnvironmentVariable('TEST_CAPTURE_VOLUME_PATH', $null, 'Process')
    }

    $cleanFailureRoot = Join-Path $sandbox 'clean-failure-root'
    New-Item -ItemType Directory -Path (Join-Path $cleanFailureRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanFailureRoot 'scripts') -Force | Out-Null
    'deploy' | Set-Content -LiteralPath (Join-Path $cleanFailureRoot 'scripts\deploy.ps1') -Encoding ascii
    'MINIO_WATCH_ENABLED=true' | Set-Content -LiteralPath (Join-Path $cleanFailureRoot '.env.web-plane.host-kit.example') -Encoding ascii
    @(
        'MINIO_WATCH_ENABLED=true',
        'MINIO_WATCH_ACCESS_KEY=keep-after-failed-clean',
        'MINIO_WATCH_SECRET_KEY=keep-secret-after-failed-clean'
    ) | Set-Content -LiteralPath (Join-Path $cleanFailureRoot '.env.web-plane.host-kit') -Encoding ascii

    $cleanFailureCalls = New-Object 'System.Collections.Generic.List[string]'
    $cleanFailureRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:cleanFailureCalls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
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
        if ($commandText -eq 'clean -fdx -e bim-streaming-server/_build/**/logs/**') {
            Remove-Item -LiteralPath (Join-Path $WorkingDirectory '.env.web-plane.host-kit') -Force -ErrorAction SilentlyContinue
            return [pscustomobject]@{ ExitCode = 42; Output = 'locked governance log' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $script:cleanFailureCalls = $cleanFailureCalls
    $cleanFailureDeployWasCalled = $false
    $cleanFailureDeployRunner = {
        param([string] $DeployRoot)
        $script:cleanFailureDeployWasCalled = $true
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()

    $cleanFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $cleanFailureRoot -AllowNonFixedPathForTests -CommandRunner $cleanFailureRunner -DeployRunner $cleanFailureDeployRunner | Out-Null
    } catch {
        $cleanFailureMessage = $_.Exception.Message
    }
    Assert-True (-not [string]::IsNullOrWhiteSpace($cleanFailureMessage)) 'clean failure is surfaced'
    Assert-True ($cleanFailureMessage -match 'locked governance log') 'clean failure includes command output'
    Assert-True (-not $cleanFailureDeployWasCalled) 'clean failure stops before deploy'
    $restoredHostKitEnv = Get-Content -LiteralPath (Join-Path $cleanFailureRoot '.env.web-plane.host-kit') -Raw
    Assert-True ($restoredHostKitEnv -match 'MINIO_WATCH_ACCESS_KEY=keep-after-failed-clean') 'MinIO access key restored after failed clean'
    Assert-True ($restoredHostKitEnv -match 'MINIO_WATCH_SECRET_KEY=keep-secret-after-failed-clean') 'MinIO secret key restored after failed clean'

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

    # Batch 1 (a)+(b): pre-clean stop of all three deploy-zone services, each recorded
    # BEFORE the clean event in one shared ordered log (ServiceStopper + CommandRunner
    # write to the same list).
    $stopOrderRoot = Join-Path $sandbox 'stop-order-root'
    New-Item -ItemType Directory -Path (Join-Path $stopOrderRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $stopOrderRoot 'scripts') -Force | Out-Null
    'deploy' | Set-Content -LiteralPath (Join-Path $stopOrderRoot 'scripts\deploy.ps1') -Encoding ascii

    $stopOrderLog = New-Object 'System.Collections.Generic.List[string]'
    $script:stopOrderLog = $stopOrderLog
    $stopOrderRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'clean -fdx -e bim-streaming-server/_build/**/logs/**') { $script:stopOrderLog.Add('clean') | Out-Null }
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

    $stoppedServices = New-Object 'System.Collections.Generic.List[string]'
    $script:stoppedServices = $stoppedServices
    $stopOrderStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:stopOrderLog.Add("stop:$ServiceName") | Out-Null
        $script:stoppedServices.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $stopOrderDeployRunner = {
        param([string] $DeployRoot)
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()

    Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $stopOrderRoot -AllowNonFixedPathForTests -CommandRunner $stopOrderRunner -DeployRunner $stopOrderDeployRunner -ServiceStopper $stopOrderStopper | Out-Null

    foreach ($svc in @('bim-streaming-server', 'bim-streaming-conversion-service', 'governance-service')) {
        Assert-True ($stoppedServices -contains $svc) "pre-clean stop invoked for $svc"
    }
    $cleanIndex = $stopOrderLog.IndexOf('clean')
    Assert-True ($cleanIndex -ge 0) 'clean event recorded in shared ordered log'
    foreach ($svc in @('bim-streaming-server', 'bim-streaming-conversion-service', 'governance-service')) {
        $stopIndex = $stopOrderLog.IndexOf("stop:$svc")
        Assert-True (($stopIndex -ge 0) -and ($stopIndex -lt $cleanIndex)) "stop of $svc precedes clean in shared ordered log"
    }

    # Batch 1 (c): first `git clean -fdx` throws a transient EINVAL, second succeeds ->
    # Invoke-TestDeployRebuild retries, reaches deploy, returns DeployExitCode (no throw).
    $retryRoot = Join-Path $sandbox 'clean-retry-root'
    New-Item -ItemType Directory -Path (Join-Path $retryRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $retryRoot 'scripts') -Force | Out-Null
    'deploy' | Set-Content -LiteralPath (Join-Path $retryRoot 'scripts\deploy.ps1') -Encoding ascii

    $retryCleanCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:retryCleanCalls = $retryCleanCalls
    $retryRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
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
        if ($commandText -eq 'clean -fdx -e bim-streaming-server/_build/**/logs/**') {
            $script:retryCleanCalls.Add('clean') | Out-Null
            if ($script:retryCleanCalls.Count -eq 1) {
                return [pscustomobject]@{ ExitCode = 1; Output = "warning: failed to remove 'bim-streaming-server/_build/.../logs/Kit/kit.log': Invalid argument" }
            }
            return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abcdef123456' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $retryDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:retryDeployCalls = $retryDeployCalls
    $retryDeployRunner = {
        param([string] $DeployRoot)
        $script:retryDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $noopStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
    }.GetNewClosure()

    $retryResult = Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $retryRoot -AllowNonFixedPathForTests -CommandRunner $retryRunner -DeployRunner $retryDeployRunner -ServiceStopper $noopStopper
    Assert-Equal 2 $retryCleanCalls.Count 'git clean -fdx retried after transient Invalid argument failure'
    Assert-True ($retryDeployCalls.Count -eq 1) 'rebuild reaches deploy after clean retry succeeds'
    Assert-Equal 0 $retryResult.DeployExitCode 'rebuild returns deploy exit code after clean retry'

    $wrapper = Join-Path $repoRoot 'scripts\dev\rebuild-test-deploy.ps1'
    Assert-True (Test-Path -LiteralPath $wrapper) 'wrapper exists'
    $wrapperText = Get-Content -LiteralPath $wrapper -Raw
    Assert-True ($wrapperText -match '\[switch\]\s+\$Build') 'wrapper exposes Build switch'
    $forbiddenWrapperToken = 'Dry' + 'Run'
    Assert-True ($wrapperText -notmatch [regex]::Escape($forbiddenWrapperToken)) 'wrapper does not expose forbidden token'

    # F2: restore 逐檔獨立、收集失敗、不中途 abort
    $restoreRoot = Join-Path $sandbox 'restore-partial-failure'
    New-Item -ItemType Directory -Path $restoreRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $restoreRoot 'sub') -Force | Out-Null
    # 建立 .example 檔（Restore 需要此檔存在才會嘗試還原）
    'FIRST=placeholder' | Set-Content -LiteralPath (Join-Path $restoreRoot '.env.first.example') -Encoding ascii
    'SECOND=placeholder' | Set-Content -LiteralPath (Join-Path $restoreRoot '.env.second.example') -Encoding ascii
    'THIRD=placeholder' | Set-Content -LiteralPath (Join-Path $restoreRoot 'sub\.env.third.example') -Encoding ascii

    # 建立一個被鎖定（無法寫入）的目標路徑以模擬第一個 entry WriteAllBytes 失敗
    $lockedPath = Join-Path $restoreRoot '.env.first'
    'OLD=content' | Set-Content -LiteralPath $lockedPath -Encoding ascii
    $lockedFile = [System.IO.File]::Open($lockedPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $firstBytes = [System.Text.Encoding]::UTF8.GetBytes('FIRST=restored')
        $secondBytes = [System.Text.Encoding]::UTF8.GetBytes('SECOND=restored')
        $thirdBytes = [System.Text.Encoding]::UTF8.GetBytes('THIRD=restored')

        $partialSnapshot = @(
            [pscustomobject]@{ RelativePath = '.env.first';     Bytes = $firstBytes  }
            [pscustomobject]@{ RelativePath = '.env.second';    Bytes = $secondBytes }
            [pscustomobject]@{ RelativePath = 'sub\.env.third'; Bytes = $thirdBytes  }
        )

        $restoreFailureMessage = $null
        try {
            Restore-TestDeployEnvSnapshot -DeploymentPath $restoreRoot -Snapshot $partialSnapshot | Out-Null
        } catch {
            $restoreFailureMessage = $_.Exception.Message
        }

        Assert-True (-not [string]::IsNullOrWhiteSpace($restoreFailureMessage)) 'partial restore: failure is surfaced as a throw'
        Assert-True ($restoreFailureMessage -match '\.env\.first') 'partial restore: error message contains failing entry path'
        Assert-True (Test-Path -LiteralPath (Join-Path $restoreRoot '.env.second')) 'partial restore: second entry is still written despite first failure'
        $secondContent = Get-Content -LiteralPath (Join-Path $restoreRoot '.env.second') -Raw
        Assert-True ($secondContent -match 'SECOND=restored') 'partial restore: second entry content is correct'
        Assert-True (Test-Path -LiteralPath (Join-Path $restoreRoot 'sub\.env.third')) 'partial restore: third entry is still written despite first failure'
        $thirdContent = Get-Content -LiteralPath (Join-Path $restoreRoot 'sub\.env.third') -Raw
        Assert-True ($thirdContent -match 'THIRD=restored') 'partial restore: third entry content is correct'
    } finally {
        $lockedFile.Dispose()
    }

    Write-TestPass $testName
} catch {
    Write-TestFail $testName $_.Exception.Message
    throw
} finally {
    Remove-TestSandbox -Path $sandbox
}
