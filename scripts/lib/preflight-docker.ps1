# scripts\lib\preflight-docker.ps1
# Preflight: Docker 環境 audit。Read-only。
# 接受可注入的 -DockerCommand / -ComposeCommand / -EngineProbe / -RepoRoot
# 讓 test 可以 fake CLI 行為。

Set-StrictMode -Version Latest

function Test-DockerEnvironment {
    [CmdletBinding()]
    param(
        [scriptblock] $DockerCommand = { param($ArgList) docker @ArgList 2>&1 },
        [scriptblock] $ComposeCommand = { param($ArgList) docker @ArgList 2>&1 },
        [scriptblock] $EngineProbe = {
            param($ArgList)
            $stdout = docker info --format '{{json .}}' 2>&1
            @{ ExitCode = $LASTEXITCODE; Stdout = ($stdout | Out-String).Trim() }
        },
        [Parameter(Mandatory = $true)][string] $RepoRoot
    )

    $audit = [ordered]@{
        cliVersion    = $null
        composeV2     = $false
        engineRunning = $false
        envFile       = $null
        ok            = $false
    }

    # docker CLI
    try {
        # 強制 to string:真 docker CLI 回 array of lines,-match 在 array 上不 populate $Matches
        $cliOut = (& $DockerCommand @(@('--version'))) | Out-String
        if ($cliOut -match 'Docker version\s+([\d\.]+)') {
            $audit.cliVersion = $Matches[1]
        }
    } catch {
        $audit.cliVersion = $null
    }

    # docker compose v2
    try {
        $cmpOut = (& $ComposeCommand @(@('compose', 'version'))) | Out-String
        if ($cmpOut -match 'Docker Compose version\s+v?(\d+)\.') {
            $audit.composeV2 = [int]$Matches[1] -ge 2
        }
    } catch {
        $audit.composeV2 = $false
    }

    # engine running?
    try {
        $engineRes = & $EngineProbe @($null)
        $audit.engineRunning = ($engineRes.ExitCode -eq 0)
    } catch {
        $audit.engineRunning = $false
    }

    # env file resolution(對齊 start-web-plane-docker.ps1 的 Resolve-HybridEnvFile)
    $real    = Join-Path $RepoRoot '.env.web-plane.host-kit'
    $example = Join-Path $RepoRoot '.env.web-plane.host-kit.example'
    if (Test-Path -LiteralPath $real) {
        $audit.envFile = '.env.web-plane.host-kit'
    } elseif (Test-Path -LiteralPath $example) {
        $audit.envFile = '.env.web-plane.host-kit.example'
    } else {
        $audit.envFile = $null
    }

    $audit.ok = (
        $null -ne $audit.cliVersion `
        -and $audit.composeV2 `
        -and $audit.engineRunning `
        -and $null -ne $audit.envFile
    )
    return [pscustomobject]$audit
}
