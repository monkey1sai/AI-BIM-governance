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

    $libText = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\lib\rebuild-test-deploy.ps1') -Raw
    Assert-True ($libText -notmatch "Start-Process\s+-FilePath 'powershell\.exe'[^\r\n]*-Wait") 'rebuild deploy runner must not wait on deploy.ps1 process tree'

    $deployHelperRoot = Join-Path $sandbox 'deploy-helper'
    New-Item -ItemType Directory -Path $deployHelperRoot -Force | Out-Null
    $deployHelperProbes = New-Object 'System.Collections.Generic.List[object]'
    $deployHelperRunner = {
        param([string] $FilePath, [string[]] $ArgumentList, [string] $WorkingDirectory)
        $deployHelperProbes.Add([pscustomobject]@{
            FilePath = $FilePath
            ArgumentList = @($ArgumentList)
            WorkingDirectory = $WorkingDirectory
        }) | Out-Null
        return 0
    }.GetNewClosure()
    $deployHelperResult = Invoke-TestDeployScript -DeploymentRoot $deployHelperRoot -ProcessRunner $deployHelperRunner
    Assert-Equal 0 $deployHelperResult.ExitCode 'deploy helper returns direct deploy.ps1 exit code'
    Assert-Equal 1 $deployHelperProbes.Count 'deploy helper invokes process runner once'
    $deployHelperProbe = $deployHelperProbes[0]
    Assert-Equal 'powershell.exe' $deployHelperProbe.FilePath 'deploy helper uses Windows PowerShell'
    Assert-Equal $deployHelperRoot $deployHelperProbe.WorkingDirectory 'deploy helper runs inside deployment root'
    Assert-True (($deployHelperProbe.ArgumentList -join ' ') -match 'scripts\\deploy\.ps1') 'deploy helper invokes scripts\deploy.ps1'
    Assert-True ($deployHelperProbe.ArgumentList -contains '-Build') 'deploy helper preserves -Build'
    $nullExitResult = Invoke-TestDeployScript -DeploymentRoot $deployHelperRoot -ProcessRunner {
        param([string] $FilePath, [string[]] $ArgumentList, [string] $WorkingDirectory)
        return $null
    }
    Assert-Equal 1 $nullExitResult.ExitCode 'deploy helper treats missing exit code as failure'

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

    # Task 1A RED: transactional checkout preparation must never mutate the live
    # deployment until a complete standalone stage has passed provenance and
    # deploy-script validation.  These fixtures use real bytes/hashes; only Git,
    # service-stop, and deploy process boundaries are injected.
    $transactionOriginUrl = 'https://example.invalid/AI-BIM-governance.git'
    $transactionOriginCommit = 'fedcba9876543210fedcba9876543210fedcba98'
    $transactionFixturePaths = @(
        'live-sentinel.bin',
        '.env',
        'bim-review-coordinator\.env',
        '.env.web-plane.host-kit'
    )
    $transactionProvenanceMarker = '.task-1a-stage-provenance.txt'
    $transactionPathTrimChars = [char[]]@(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $newTransactionFixture = {
        param([Parameter(Mandatory = $true)][string] $Root)

        New-Item -ItemType Directory -Path (Join-Path $Root 'scripts') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $Root 'bim-review-coordinator') -Force | Out-Null
        [System.IO.File]::WriteAllBytes(
            (Join-Path $Root 'live-sentinel.bin'),
            [byte[]](0, 1, 2, 13, 10, 127, 128, 254, 255)
        )
        [System.IO.File]::WriteAllBytes(
            (Join-Path $Root '.env'),
            [System.Text.Encoding]::UTF8.GetBytes("ROOT_TOKEN=fixture-root`r`nUNICODE=交易式`r`n")
        )
        [System.IO.File]::WriteAllBytes(
            (Join-Path $Root 'bim-review-coordinator\.env'),
            [System.Text.Encoding]::UTF8.GetBytes("INTERNAL_API_AUTH_TOKEN=fixture-coordinator`n")
        )
        [System.IO.File]::WriteAllBytes(
            (Join-Path $Root '.env.web-plane.host-kit'),
            [System.Text.Encoding]::UTF8.GetBytes("MINIO_WATCH_ACCESS_KEY=fixture-access`r`nMINIO_WATCH_SECRET_KEY=fixture-secret`r`n")
        )

        # The legacy restore helper currently requires examples.  Keeping them in
        # the real fixture ensures a RED result cannot be blamed on fixture setup.
        [System.IO.File]::WriteAllBytes((Join-Path $Root '.env.example'), [byte[]](35, 10))
        [System.IO.File]::WriteAllBytes((Join-Path $Root 'bim-review-coordinator\.env.example'), [byte[]](35, 10))
        [System.IO.File]::WriteAllBytes((Join-Path $Root '.env.web-plane.host-kit.example'), [byte[]](35, 10))
        [System.IO.File]::WriteAllBytes(
            (Join-Path $Root 'scripts\deploy.ps1'),
            [System.Text.Encoding]::ASCII.GetBytes("exit 0`r`n")
        )
    }
    $getTransactionHashes = {
        param([Parameter(Mandatory = $true)][string] $Root)

        $hashes = [ordered]@{}
        foreach ($relativePath in $transactionFixturePaths) {
            $path = Join-Path $Root $relativePath
            $hashes[$relativePath] = if (Test-Path -LiteralPath $path -PathType Leaf) {
                (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
            } else {
                '<missing>'
            }
        }
        return $hashes
    }.GetNewClosure()
    $getTransactionBytesHash = {
        param([Parameter(Mandatory = $true)][byte[]] $Bytes)

        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace('-', '')
        } finally {
            $sha256.Dispose()
        }
    }
    $getTransactionLiveManifest = {
        param([Parameter(Mandatory = $true)][string] $Root)

        $canonicalRoot = ([System.IO.Path]::GetFullPath($Root)).TrimEnd($transactionPathTrimChars)
        $entries = New-Object 'System.Collections.Generic.List[string]'
        if (-not (Test-Path -LiteralPath $canonicalRoot -PathType Container)) {
            $entries.Add('__root__|missing|-|-') | Out-Null
        } else {
            $gitPath = Join-Path $canonicalRoot '.git'
            if (-not (Test-Path -LiteralPath $gitPath)) {
                $entries.Add('.git|missing|-|absent') | Out-Null
            }

            foreach ($item in @(Get-ChildItem -LiteralPath $canonicalRoot -Force -Recurse | Sort-Object FullName)) {
                $relativePath = $item.FullName.Substring($canonicalRoot.Length).TrimStart($transactionPathTrimChars)
                $entryType = if ($item.PSIsContainer) { 'directory' } else { 'file' }
                $hash = if ($item.PSIsContainer) { '-' } else { (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
                $marker = '-'
                if ($relativePath -ieq '.git') {
                    $marker = if ($item.PSIsContainer) {
                        'standalone-directory'
                    } else {
                        ([System.IO.File]::ReadAllText($item.FullName)).Trim().Replace("`r", '').Replace("`n", '')
                    }
                } elseif ($relativePath -ieq $transactionProvenanceMarker -and -not $item.PSIsContainer) {
                    $marker = ([System.IO.File]::ReadAllText($item.FullName)).Trim().Replace("`r", ';').Replace("`n", ';')
                }
                $entries.Add("$relativePath|$entryType|$hash|$marker") | Out-Null
            }
        }

        $serialized = @($entries.ToArray()) -join "`n"
        $serializedBytes = [System.Text.Encoding]::UTF8.GetBytes($serialized)
        return [pscustomobject]@{
            Entries = @($entries.ToArray())
            Serialized = $serialized
            Sha256 = (& $getTransactionBytesHash -Bytes $serializedBytes)
        }
    }.GetNewClosure()
    $assertTransactionManifestCoverage = {
        param(
            [Parameter(Mandatory = $true)] $Manifest,
            [Parameter(Mandatory = $true)][string] $ExpectedGitType
        )

        foreach ($relativePath in @($transactionFixturePaths + 'scripts\deploy.ps1')) {
            $prefix = "$relativePath|file|"
            $found = @($Manifest.Entries | Where-Object { $_.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) }).Count -eq 1
            Assert-True $found "Task 1A manifest precondition includes file metadata for $relativePath"
        }
        $gitPrefix = ".git|$ExpectedGitType|"
        $gitFound = @($Manifest.Entries | Where-Object { $_.StartsWith($gitPrefix, [System.StringComparison]::OrdinalIgnoreCase) }).Count -eq 1
        Assert-True $gitFound "Task 1A manifest precondition includes .git type/marker as $ExpectedGitType"
    }.GetNewClosure()
    $resolveTransactionCloneInvocation = {
        param(
            [Parameter(Mandatory = $true)][string[]] $Arguments,
            [Parameter(Mandatory = $true)][string] $ExpectedOrigin
        )

        $cloneIndex = -1
        for ($i = 0; $i -lt $Arguments.Count; $i++) {
            if ($Arguments[$i] -eq 'clone') {
                $cloneIndex = $i
                break
            }
        }
        if ($cloneIndex -lt 0) {
            throw "prepared-stage fake expected git clone, got '$($Arguments -join ' ')'"
        }

        $originIndex = -1
        for ($i = $cloneIndex + 1; $i -lt $Arguments.Count; $i++) {
            if ($Arguments[$i] -eq $ExpectedOrigin) {
                $originIndex = $i
                break
            }
        }
        if ($originIndex -lt 0 -or $originIndex + 1 -ge $Arguments.Count) {
            throw 'prepared-stage fake could not resolve clone origin and destination'
        }

        return [pscustomobject]@{
            Origin = [string]$Arguments[$originIndex]
            Target = [System.IO.Path]::GetFullPath([string]$Arguments[$originIndex + 1])
        }
    }
    $newPreparedTransactionStage = {
        param(
            [Parameter(Mandatory = $true)][string] $Target,
            [Parameter(Mandatory = $true)][string] $ScenarioRoot,
            [Parameter(Mandatory = $true)][string] $LiveRoot,
            [Parameter(Mandatory = $true)][string] $MarkerContent,
            [Parameter(Mandatory = $true)][bool] $IncludeDeployScript
        )

        # Fail closed before the first New-Item/WriteAllBytes.  The fake must never
        # make an unsafe production implementation less destructive by writing its
        # prepared checkout directly into live or below live.
        $canonicalTarget = ([System.IO.Path]::GetFullPath($Target)).TrimEnd($transactionPathTrimChars)
        $canonicalScenario = ([System.IO.Path]::GetFullPath($ScenarioRoot)).TrimEnd($transactionPathTrimChars)
        $canonicalLive = ([System.IO.Path]::GetFullPath($LiveRoot)).TrimEnd($transactionPathTrimChars)
        $scenarioPrefix = "$canonicalScenario$([System.IO.Path]::DirectorySeparatorChar)"
        $livePrefix = "$canonicalLive$([System.IO.Path]::DirectorySeparatorChar)"
        $targetInsideScenario = $canonicalTarget.StartsWith($scenarioPrefix, [System.StringComparison]::OrdinalIgnoreCase)
        $targetIsLive = $canonicalTarget.Equals($canonicalLive, [System.StringComparison]::OrdinalIgnoreCase)
        $targetInsideLive = $canonicalTarget.StartsWith($livePrefix, [System.StringComparison]::OrdinalIgnoreCase)
        if (-not $targetInsideScenario -or $targetIsLive -or $targetInsideLive) {
            throw "prepared-stage fake rejected unsafe target before filesystem write: target='$canonicalTarget' scenario='$canonicalScenario' live='$canonicalLive'"
        }

        New-Item -ItemType Directory -Path (Join-Path $canonicalTarget '.git') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $canonicalTarget 'scripts') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $canonicalTarget 'bim-review-coordinator') -Force | Out-Null
        [System.IO.File]::WriteAllBytes((Join-Path $canonicalTarget '.env.example'), [byte[]](35, 10))
        [System.IO.File]::WriteAllBytes((Join-Path $canonicalTarget 'bim-review-coordinator\.env.example'), [byte[]](35, 10))
        [System.IO.File]::WriteAllBytes((Join-Path $canonicalTarget '.env.web-plane.host-kit.example'), [byte[]](35, 10))
        $markerBytes = [System.Text.Encoding]::UTF8.GetBytes($MarkerContent)
        [System.IO.File]::WriteAllBytes((Join-Path $canonicalTarget $transactionProvenanceMarker), $markerBytes)
        if ($IncludeDeployScript) {
            [System.IO.File]::WriteAllBytes((Join-Path $canonicalTarget 'scripts\deploy.ps1'), [System.Text.Encoding]::ASCII.GetBytes("exit 0`r`n"))
        }

        return [pscustomobject]@{
            Root = $canonicalTarget
            MarkerHash = (& $getTransactionBytesHash -Bytes $markerBytes)
        }
    }.GetNewClosure()

    # Prove the prepared-stage fake itself fails closed with zero filesystem
    # mutation for each forbidden target class before it is used by RED cases.
    $preparedStageGuardScenario = Join-Path $sandbox 'transaction-prepared-stage-guard'
    $preparedStageGuardLive = Join-Path $preparedStageGuardScenario 'live'
    & $newTransactionFixture $preparedStageGuardLive
    $preparedStageGuardManifest = & $getTransactionLiveManifest $preparedStageGuardLive
    & $assertTransactionManifestCoverage -Manifest $preparedStageGuardManifest -ExpectedGitType 'missing'
    $preparedStageGuardCandidates = @(
        $preparedStageGuardLive,
        (Join-Path $preparedStageGuardLive 'unsafe-child-stage'),
        (Join-Path $sandbox 'transaction-prepared-stage-outside')
    )
    foreach ($unsafeTarget in $preparedStageGuardCandidates) {
        $guardFailure = $null
        try {
            & $newPreparedTransactionStage -Target $unsafeTarget -ScenarioRoot $preparedStageGuardScenario -LiveRoot $preparedStageGuardLive -MarkerContent 'guard-must-never-be-written' -IncludeDeployScript $false | Out-Null
        } catch {
            $guardFailure = $_.Exception.Message
        }
        Assert-True ($guardFailure -match 'rejected unsafe target before filesystem write') "prepared-stage fake rejects unsafe target before write: $unsafeTarget"
        $guardManifestAfter = & $getTransactionLiveManifest $preparedStageGuardLive
        Assert-Equal $preparedStageGuardManifest.Serialized $guardManifestAfter.Serialized "prepared-stage fake rejection leaves live manifest unchanged: $unsafeTarget"
        if (-not ([System.IO.Path]::GetFullPath($unsafeTarget)).Equals(([System.IO.Path]::GetFullPath($preparedStageGuardLive)), [System.StringComparison]::OrdinalIgnoreCase)) {
            Assert-True (-not (Test-Path -LiteralPath $unsafeTarget)) "prepared-stage fake creates no rejected target: $unsafeTarget"
        }
    }
    $transactionRedFailures = New-Object 'System.Collections.Generic.List[string]'
    $recordTransactionExpectation = {
        param(
            [Parameter(Mandatory = $true)][bool] $Condition,
            [Parameter(Mandatory = $true)][string] $Behavior,
            [Parameter(Mandatory = $true)][string] $Details
        )

        if (-not $Condition) {
            $transactionRedFailures.Add("$Behavior -- $Details") | Out-Null
        }
    }.GetNewClosure()

    # Task 1A.1: non-git live bytes survive a failed sibling-stage clone; no
    # service stop, live cutover, or deploy is allowed to begin.
    $nonGitScenarioRoot = Join-Path $sandbox 'transaction-non-git'
    $nonGitLiveRoot = Join-Path $nonGitScenarioRoot 'live'
    & $newTransactionFixture $nonGitLiveRoot
    $nonGitHashesBefore = & $getTransactionHashes $nonGitLiveRoot
    $nonGitManifestBefore = & $getTransactionLiveManifest $nonGitLiveRoot
    & $assertTransactionManifestCoverage -Manifest $nonGitManifestBefore -ExpectedGitType 'missing'
    $nonGitCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $nonGitStoppedServices = New-Object 'System.Collections.Generic.List[string]'
    $nonGitDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:nonGitCloneTargets = $nonGitCloneTargets
    $script:nonGitStoppedServices = $nonGitStoppedServices
    $script:nonGitDeployCalls = $nonGitDeployCalls
    $nonGitRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:nonGitCloneTargets.Add($cloneInvocation.Target) | Out-Null
            return [pscustomobject]@{ ExitCode = 91; Output = 'injected sibling stage clone failure' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $nonGitStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:nonGitStoppedServices.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $nonGitDeployRunner = {
        param([string] $DeployRoot)
        $script:nonGitDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $nonGitFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $nonGitLiveRoot -AllowNonFixedPathForTests -CommandRunner $nonGitRunner -DeployRunner $nonGitDeployRunner -ServiceStopper $nonGitStopper | Out-Null
    } catch {
        $nonGitFailureMessage = $_.Exception.Message
    }
    $nonGitHashesAfter = & $getTransactionHashes $nonGitLiveRoot
    $nonGitManifestAfter = & $getTransactionLiveManifest $nonGitLiveRoot
    & $recordTransactionExpectation (-not [string]::IsNullOrWhiteSpace($nonGitFailureMessage) -and $nonGitFailureMessage -match 'injected sibling stage clone failure') 'Task 1A.1 non-git clone failure is surfaced' "actual='$nonGitFailureMessage'"
    foreach ($relativePath in $transactionFixturePaths) {
        & $recordTransactionExpectation ($nonGitHashesAfter[$relativePath] -eq $nonGitHashesBefore[$relativePath]) 'Task 1A.1 non-git live bytes remain SHA256-identical' "path='$relativePath' before='$($nonGitHashesBefore[$relativePath])' after='$($nonGitHashesAfter[$relativePath])'"
    }
    & $recordTransactionExpectation ($nonGitManifestAfter.Serialized -ceq $nonGitManifestBefore.Serialized) 'Task 1A.1 clone failure leaves complete live inventory byte-identical' "beforeManifest='$($nonGitManifestBefore.Sha256)' afterManifest='$($nonGitManifestAfter.Sha256)'"
    $nonGitCanonicalScenario = ([System.IO.Path]::GetFullPath($nonGitScenarioRoot)).TrimEnd($transactionPathTrimChars)
    $nonGitCanonicalLive = ([System.IO.Path]::GetFullPath($nonGitLiveRoot)).TrimEnd($transactionPathTrimChars)
    $nonGitStageSafe = $false
    if ($nonGitCloneTargets.Count -eq 1) {
        $nonGitCandidate = $nonGitCloneTargets[0].TrimEnd($transactionPathTrimChars)
        $nonGitStageSafe = $nonGitCandidate.StartsWith("$nonGitCanonicalScenario$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase) -and
            -not $nonGitCandidate.Equals($nonGitCanonicalLive, [System.StringComparison]::OrdinalIgnoreCase) -and
            -not $nonGitCandidate.StartsWith("$nonGitCanonicalLive$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)
    }
    & $recordTransactionExpectation $nonGitStageSafe 'Task 1A.1 clone targets a safe sibling stage, not live' "targets='$($nonGitCloneTargets -join ',')' live='$nonGitLiveRoot'"
    & $recordTransactionExpectation ($nonGitStoppedServices.Count -eq 0) 'Task 1A.1 clone failure stops before service stop' "stopped='$($nonGitStoppedServices -join ',')'"
    & $recordTransactionExpectation ($nonGitDeployCalls.Count -eq 0) 'Task 1A.1 clone failure stops before deploy' "deployCalls=$($nonGitDeployCalls.Count)"

    # Task 1A.2: a stale linked-worktree gitfile is broken state, not a valid
    # checkout.  A prepared standalone stage may replace it while env hashes and
    # source provenance remain exact.
    $brokenGitfileScenarioRoot = Join-Path $sandbox 'transaction-broken-gitfile'
    $brokenGitfileLiveRoot = Join-Path $brokenGitfileScenarioRoot 'live'
    & $newTransactionFixture $brokenGitfileLiveRoot
    $missingLinkedGitDir = Join-Path $brokenGitfileScenarioRoot 'missing-linked-worktree-gitdir'
    [System.IO.File]::WriteAllBytes(
        (Join-Path $brokenGitfileLiveRoot '.git'),
        [System.Text.Encoding]::ASCII.GetBytes("gitdir: $missingLinkedGitDir`r`n")
    )
    $brokenGitfileHashesBefore = & $getTransactionHashes $brokenGitfileLiveRoot
    $transactionOriginUrlHash = & $getTransactionBytesHash -Bytes ([System.Text.Encoding]::UTF8.GetBytes($transactionOriginUrl))
    $brokenGitfileMarkerContent = "scenario=broken-gitfile`nmode=OriginMain`noriginUrlSha256=$transactionOriginUrlHash`ncommit=$transactionOriginCommit`n"
    $brokenGitfileExpectedMarkerHash = & $getTransactionBytesHash -Bytes ([System.Text.Encoding]::UTF8.GetBytes($brokenGitfileMarkerContent))
    $brokenGitfileCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $brokenGitfileCloneOrigins = New-Object 'System.Collections.Generic.List[string]'
    $brokenGitfilePreparedStages = New-Object 'System.Collections.Generic.List[object]'
    $brokenGitfileDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:brokenGitfileCloneTargets = $brokenGitfileCloneTargets
    $script:brokenGitfileCloneOrigins = $brokenGitfileCloneOrigins
    $script:brokenGitfilePreparedStages = $brokenGitfilePreparedStages
    $script:brokenGitfileDeployCalls = $brokenGitfileDeployCalls
    $brokenGitfileRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:brokenGitfileCloneOrigins.Add($cloneInvocation.Origin) | Out-Null
            $script:brokenGitfileCloneTargets.Add($cloneInvocation.Target) | Out-Null
            $preparedStage = & $newPreparedTransactionStage -Target $cloneInvocation.Target -ScenarioRoot $brokenGitfileScenarioRoot -LiveRoot $brokenGitfileLiveRoot -MarkerContent $brokenGitfileMarkerContent -IncludeDeployScript $true
            $script:brokenGitfilePreparedStages.Add($preparedStage) | Out-Null
            return [pscustomobject]@{ ExitCode = 0; Output = 'prepared standalone stage' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit.Substring(0, 7) }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $brokenGitfileDeployRunner = {
        param([string] $DeployRoot)
        $script:brokenGitfileDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $brokenGitfileFailureMessage = $null
    $brokenGitfileResult = $null
    try {
        $brokenGitfileResult = Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $brokenGitfileLiveRoot -AllowNonFixedPathForTests -CommandRunner $brokenGitfileRunner -DeployRunner $brokenGitfileDeployRunner -ServiceStopper $noopStopper
    } catch {
        $brokenGitfileFailureMessage = $_.Exception.Message
    }
    $brokenGitfileHashesAfter = & $getTransactionHashes $brokenGitfileLiveRoot
    $brokenGitfileActualCommit = if ($null -eq $brokenGitfileResult) { '<no result>' } else { [string]$brokenGitfileResult.OriginMainCommit }
    $brokenGitfileFinalMarkerPath = Join-Path $brokenGitfileLiveRoot $transactionProvenanceMarker
    $brokenGitfileFinalMarkerHash = if (Test-Path -LiteralPath $brokenGitfileFinalMarkerPath -PathType Leaf) {
        (Get-FileHash -LiteralPath $brokenGitfileFinalMarkerPath -Algorithm SHA256).Hash
    } else {
        '<missing>'
    }
    & $recordTransactionExpectation ([string]::IsNullOrWhiteSpace($brokenGitfileFailureMessage)) 'Task 1A.2 broken gitfile self-heals successfully' "actual='$brokenGitfileFailureMessage'"
    & $recordTransactionExpectation (Test-Path -LiteralPath (Join-Path $brokenGitfileLiveRoot '.git') -PathType Container) 'Task 1A.2 replacement is a standalone checkout' "live .git remains file=$((Test-Path -LiteralPath (Join-Path $brokenGitfileLiveRoot '.git') -PathType Leaf))"
    & $recordTransactionExpectation ($brokenGitfilePreparedStages.Count -eq 1) 'Task 1A.2 broken checkout is replaced from one validated sibling stage' "attemptedTargets='$($brokenGitfileCloneTargets -join ',')' preparedCount=$($brokenGitfilePreparedStages.Count)"
    & $recordTransactionExpectation ($brokenGitfileCloneOrigins.Count -eq 1 -and $brokenGitfileCloneOrigins[0] -eq $transactionOriginUrl) 'Task 1A.2 prepared stage uses caller source provenance' "origins='$($brokenGitfileCloneOrigins -join ',')'"
    & $recordTransactionExpectation ($brokenGitfileActualCommit -eq $transactionOriginCommit) 'Task 1A.2 result provenance matches origin/main' "actual='$brokenGitfileActualCommit'"
    & $recordTransactionExpectation ($brokenGitfileFinalMarkerHash -eq $brokenGitfileExpectedMarkerHash) 'Task 1A.2 prepared-stage provenance marker reaches final live checkout' "expected='$brokenGitfileExpectedMarkerHash' actual='$brokenGitfileFinalMarkerHash'"
    foreach ($relativePath in $transactionFixturePaths | Where-Object { $_ -ne 'live-sentinel.bin' }) {
        & $recordTransactionExpectation ($brokenGitfileHashesAfter[$relativePath] -eq $brokenGitfileHashesBefore[$relativePath]) 'Task 1A.2 preserved env remains SHA256-identical' "path='$relativePath' before='$($brokenGitfileHashesBefore[$relativePath])' after='$($brokenGitfileHashesAfter[$relativePath])'"
    }
    & $recordTransactionExpectation ($brokenGitfileDeployCalls.Count -eq 1 -and $brokenGitfileDeployCalls[0] -eq $brokenGitfileLiveRoot) 'Task 1A.2 deploy runs from replacement live checkout' "deployRoots='$($brokenGitfileDeployCalls -join ',')'"

    # Task 1A.3: a valid standalone checkout with the wrong origin is rejected
    # before staging, service stop, cutover, or deploy.
    $wrongOriginScenarioRoot = Join-Path $sandbox 'transaction-wrong-origin'
    $wrongOriginLiveRoot = Join-Path $wrongOriginScenarioRoot 'live'
    & $newTransactionFixture $wrongOriginLiveRoot
    New-Item -ItemType Directory -Path (Join-Path $wrongOriginLiveRoot '.git') -Force | Out-Null
    $wrongOriginManifestBefore = & $getTransactionLiveManifest $wrongOriginLiveRoot
    & $assertTransactionManifestCoverage -Manifest $wrongOriginManifestBefore -ExpectedGitType 'directory'
    $wrongOriginCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $wrongOriginStoppedServices = New-Object 'System.Collections.Generic.List[string]'
    $wrongOriginDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:wrongOriginCloneTargets = $wrongOriginCloneTargets
    $script:wrongOriginStoppedServices = $wrongOriginStoppedServices
    $script:wrongOriginDeployCalls = $wrongOriginDeployCalls
    $wrongOriginRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            $output = if ([System.IO.Path]::GetFullPath($WorkingDirectory) -eq [System.IO.Path]::GetFullPath($wrongOriginLiveRoot)) {
                'https://wrong.example.invalid/not-this-repo.git'
            } else {
                $transactionOriginUrl
            }
            return [pscustomobject]@{ ExitCode = 0; Output = $output }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:wrongOriginCloneTargets.Add($cloneInvocation.Target) | Out-Null
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $wrongOriginStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:wrongOriginStoppedServices.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $wrongOriginDeployRunner = {
        param([string] $DeployRoot)
        $script:wrongOriginDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $wrongOriginFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $wrongOriginLiveRoot -AllowNonFixedPathForTests -CommandRunner $wrongOriginRunner -DeployRunner $wrongOriginDeployRunner -ServiceStopper $wrongOriginStopper | Out-Null
    } catch {
        $wrongOriginFailureMessage = $_.Exception.Message
    }
    $wrongOriginManifestAfter = & $getTransactionLiveManifest $wrongOriginLiveRoot
    & $recordTransactionExpectation (-not [string]::IsNullOrWhiteSpace($wrongOriginFailureMessage) -and $wrongOriginFailureMessage -match 'origin mismatch') 'Task 1A.3 wrong live origin is rejected' "actual='$wrongOriginFailureMessage'"
    & $recordTransactionExpectation ($wrongOriginCloneTargets.Count -eq 0) 'Task 1A.3 wrong origin fails before staging' "targets='$($wrongOriginCloneTargets -join ',')'"
    & $recordTransactionExpectation ($wrongOriginStoppedServices.Count -eq 0) 'Task 1A.3 wrong origin fails before service stop' "stopped='$($wrongOriginStoppedServices -join ',')'"
    & $recordTransactionExpectation ($wrongOriginDeployCalls.Count -eq 0) 'Task 1A.3 wrong origin fails before deploy' "deployCalls=$($wrongOriginDeployCalls.Count)"
    & $recordTransactionExpectation ($wrongOriginManifestAfter.Serialized -ceq $wrongOriginManifestBefore.Serialized) 'Task 1A.3 wrong-origin rejection leaves complete live manifest identical' "beforeManifest='$($wrongOriginManifestBefore.Sha256)' afterManifest='$($wrongOriginManifestAfter.Sha256)'"

    # Task 1A.4: a successfully prepared stage without scripts/deploy.ps1 is
    # rejected while live is still untouched and before services are stopped.
    $missingDeployScenarioRoot = Join-Path $sandbox 'transaction-stage-missing-deploy'
    $missingDeployLiveRoot = Join-Path $missingDeployScenarioRoot 'live'
    & $newTransactionFixture $missingDeployLiveRoot
    $missingDeployManifestBefore = & $getTransactionLiveManifest $missingDeployLiveRoot
    & $assertTransactionManifestCoverage -Manifest $missingDeployManifestBefore -ExpectedGitType 'missing'
    $missingDeployMarkerContent = "scenario=missing-deploy`nmode=OriginMain`noriginUrlSha256=$transactionOriginUrlHash`ncommit=$transactionOriginCommit`n"
    $missingDeployExpectedMarkerHash = & $getTransactionBytesHash -Bytes ([System.Text.Encoding]::UTF8.GetBytes($missingDeployMarkerContent))
    $missingDeployCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $missingDeployPreparedStages = New-Object 'System.Collections.Generic.List[object]'
    $missingDeployStoppedServices = New-Object 'System.Collections.Generic.List[string]'
    $missingDeployDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:missingDeployCloneTargets = $missingDeployCloneTargets
    $script:missingDeployPreparedStages = $missingDeployPreparedStages
    $script:missingDeployStoppedServices = $missingDeployStoppedServices
    $script:missingDeployDeployCalls = $missingDeployDeployCalls
    $missingDeployRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:missingDeployCloneTargets.Add($cloneInvocation.Target) | Out-Null
            $preparedStage = & $newPreparedTransactionStage -Target $cloneInvocation.Target -ScenarioRoot $missingDeployScenarioRoot -LiveRoot $missingDeployLiveRoot -MarkerContent $missingDeployMarkerContent -IncludeDeployScript $false
            $script:missingDeployPreparedStages.Add($preparedStage) | Out-Null
            return [pscustomobject]@{ ExitCode = 0; Output = 'prepared stage intentionally missing scripts/deploy.ps1' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit.Substring(0, 7) }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $missingDeployStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:missingDeployStoppedServices.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $missingDeployDeployRunner = {
        param([string] $DeployRoot)
        $script:missingDeployDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $missingDeployFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $missingDeployLiveRoot -AllowNonFixedPathForTests -CommandRunner $missingDeployRunner -DeployRunner $missingDeployDeployRunner -ServiceStopper $missingDeployStopper | Out-Null
    } catch {
        $missingDeployFailureMessage = $_.Exception.Message
    }
    $missingDeployManifestAfter = & $getTransactionLiveManifest $missingDeployLiveRoot
    $missingDeployPreparedMarkerHash = if ($missingDeployPreparedStages.Count -eq 1) {
        [string]$missingDeployPreparedStages[0].MarkerHash
    } else {
        '<not-prepared>'
    }
    & $recordTransactionExpectation (-not [string]::IsNullOrWhiteSpace($missingDeployFailureMessage) -and $missingDeployFailureMessage -match 'deploy(ment)? script missing') 'Task 1A.4 missing stage deploy script is surfaced' "actual='$missingDeployFailureMessage'"
    & $recordTransactionExpectation ($missingDeployPreparedStages.Count -eq 1 -and $missingDeployPreparedMarkerHash -eq $missingDeployExpectedMarkerHash) 'Task 1A.4 deploy-script validation observes one safe marked sibling stage' "attemptedTargets='$($missingDeployCloneTargets -join ',')' preparedCount=$($missingDeployPreparedStages.Count) markerHash='$missingDeployPreparedMarkerHash'"
    & $recordTransactionExpectation ($missingDeployStoppedServices.Count -eq 0) 'Task 1A.4 missing deploy script fails before service stop' "stopped='$($missingDeployStoppedServices -join ',')'"
    & $recordTransactionExpectation ($missingDeployDeployCalls.Count -eq 0) 'Task 1A.4 missing deploy script fails before deploy' "deployCalls=$($missingDeployDeployCalls.Count)"
    & $recordTransactionExpectation ($missingDeployManifestAfter.Serialized -ceq $missingDeployManifestBefore.Serialized) 'Task 1A.4 missing deploy script leaves complete live manifest identical' "beforeManifest='$($missingDeployManifestBefore.Sha256)' afterManifest='$($missingDeployManifestAfter.Sha256)'"

    if ($transactionRedFailures.Count -gt 0) {
        throw "Task 1A wished-for RED behaviors unmet:$([Environment]::NewLine) - $($transactionRedFailures -join "$([Environment]::NewLine) - ")"
    }

    Write-TestPass $testName
} catch {
    Write-TestFail $testName $_.Exception.Message
    throw
} finally {
    Remove-TestSandbox -Path $sandbox
}
