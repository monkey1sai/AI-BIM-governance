# scripts\tests\test-preflight-docker.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\preflight-docker.ps1'
. $modulePath

# Test 1: docker CLI 存在 + compose v2 + engine running → cliVersion 等欄位齊全
$result = Test-DockerEnvironment `
    -DockerCommand { param($Args) "Docker version 27.0.3, build x" } `
    -ComposeCommand { param($Args) "Docker Compose version v2.29.0" } `
    -EngineProbe { param($Args) @{ ExitCode = 0; Stdout = '{"ServerVersion":"27.0.3"}' } } `
    -RepoRoot (New-TestSandbox -Prefix 'preflight-docker')

Assert-True ($result.cliVersion -ne $null) 'cliVersion populated'
Assert-True ($result.composeV2 -eq $true) 'composeV2 true'
Assert-True ($result.engineRunning -eq $true) 'engineRunning true'
Write-TestPass 'happy path returns full audit'

# Test 2: docker CLI 不在 → cliVersion=null + 整體 ok=false
$result = Test-DockerEnvironment `
    -DockerCommand { throw 'docker not found' } `
    -ComposeCommand { param($Args) '' } `
    -EngineProbe { param($Args) @{ ExitCode = 1; Stdout = '' } } `
    -RepoRoot (New-TestSandbox -Prefix 'preflight-docker')

Assert-True ($null -eq $result.cliVersion) 'cliVersion null when docker absent'
Assert-True ($result.ok -eq $false) 'overall ok=false'
Write-TestPass 'docker missing flagged'

# Test 3: engine 沒跑 → engineRunning=false
$result = Test-DockerEnvironment `
    -DockerCommand { param($Args) "Docker version 27.0.3" } `
    -ComposeCommand { param($Args) "Docker Compose version v2.29.0" } `
    -EngineProbe { param($Args) @{ ExitCode = 1; Stdout = '' } } `
    -RepoRoot (New-TestSandbox -Prefix 'preflight-docker')

Assert-True ($result.engineRunning -eq $false) 'engineRunning=false when engine probe non-zero'
Write-TestPass 'engine not running flagged'

# Test 4: envFile resolve — .env.web-plane.host-kit 在 RepoRoot → 取它
$sandbox = New-TestSandbox -Prefix 'preflight-docker-env'
try {
    Set-Content -LiteralPath (Join-Path $sandbox '.env.web-plane.host-kit') -Value 'COORDINATOR_PORT=8004'
    $result = Test-DockerEnvironment `
        -DockerCommand { param($Args) "Docker version 27" } `
        -ComposeCommand { param($Args) "Docker Compose version v2.0" } `
        -EngineProbe { param($Args) @{ ExitCode = 0; Stdout = '{}' } } `
        -RepoRoot $sandbox

    Assert-True ($result.envFile -eq '.env.web-plane.host-kit') 'real env file picked over .example'
    Write-TestPass 'envFile prefers real over example'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 5: 只有 .example → fallback
$sandbox = New-TestSandbox -Prefix 'preflight-docker-env'
try {
    Set-Content -LiteralPath (Join-Path $sandbox '.env.web-plane.host-kit.example') -Value 'COORDINATOR_PORT=8004'
    $result = Test-DockerEnvironment `
        -DockerCommand { param($Args) "Docker version 27" } `
        -ComposeCommand { param($Args) "Docker Compose version v2.0" } `
        -EngineProbe { param($Args) @{ ExitCode = 0; Stdout = '{}' } } `
        -RepoRoot $sandbox
    Assert-True ($result.envFile -eq '.env.web-plane.host-kit.example') 'example fallback'
    Write-TestPass 'envFile falls back to .example'
}
finally { Remove-TestSandbox -Path $sandbox }

Write-Host "`n=== test-preflight-docker.ps1: ALL PASSED ===" -ForegroundColor Green
