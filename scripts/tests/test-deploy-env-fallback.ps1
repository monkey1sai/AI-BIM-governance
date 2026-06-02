# scripts\tests\test-deploy-env-fallback.ps1
# 固化 #23 既有行為:web-plane env file 解析的 dev/demo fallback 與 missing 防呆。
#   - deploy.ps1 / check-web-plane-docker.ps1 在「只有 .example 存在」時 fallback 並發 Write-Warning。
#   - deploy.ps1 在「連 .example 都不存在」時 throw env_file_missing(不把不存在的 --env-file 往後傳)。
#   - check-web-plane-docker.ps1 是 diagnostic 工具:missing real env 只發 Warning + degrade,
#     但既有「明確 -EnvFile 指到不存在檔」語義仍 throw env_file_missing。
# 沿用 test-helpers.ps1 的 dot-source + 自訂 assert + temp sandbox 風格;不依賴 Pester。
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$dockerModule = Join-Path $repoRoot 'scripts\lib\preflight-docker.ps1'
. $dockerModule

$checkScript = Join-Path $repoRoot 'scripts\check-web-plane-docker.ps1'

# 不啟動真 docker engine / probe 的 stub,只讓 Test-DockerEnvironment 跑到 env file 解析段。
# (engine probe 回非 0 → engineRunning=$false;cli/compose 給空 → 也不影響 envFile 欄位。)
$stubDocker  = { param($ArgList) '' }
$stubCompose = { param($ArgList) '' }
$stubEngine  = { param($ArgList) @{ ExitCode = 1; Stdout = '' } }

function Invoke-DockerEnvAudit {
    param([string] $RepoRoot)
    return Test-DockerEnvironment `
        -DockerCommand $stubDocker `
        -ComposeCommand $stubCompose `
        -EngineProbe $stubEngine `
        -RepoRoot $RepoRoot
}

# ---------------------------------------------------------------------------
# Test 1: 只有 .example → Test-DockerEnvironment.envFile = '.env.web-plane.host-kit.example'
# 這正是 deploy.ps1 L444-457 走「Write-Warning + fallback」分支的輸入條件。
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'deploy-env-fallback-example-only'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit.example') -Value "PUBLIC_HOST=127.0.0.1"
    $audit = Invoke-DockerEnvAudit -RepoRoot $sb
    Assert-Equal '.env.web-plane.host-kit.example' $audit.envFile 'example-only resolves to .example (deploy.ps1 fallback branch input)'
    Write-TestPass 'docker env audit: example-only -> .example'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# Test 2: 連 .example 都無 → Test-DockerEnvironment.envFile = $null
# 這正是 deploy.ps1 L444-457 走「throw env_file_missing」分支的輸入條件。
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'deploy-env-fallback-none'
try {
    $audit = Invoke-DockerEnvAudit -RepoRoot $sb
    Assert-True ($null -eq $audit.envFile) 'no env file at all resolves to $null (deploy.ps1 throw branch input)'
    Write-TestPass 'docker env audit: none -> $null'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# Test 3: real .env 存在 → envFile = '.env.web-plane.host-kit'(no warning / no throw 分支)
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'deploy-env-fallback-real'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit') -Value "PUBLIC_HOST=127.0.0.1"
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit.example') -Value "PUBLIC_HOST=127.0.0.1"
    $audit = Invoke-DockerEnvAudit -RepoRoot $sb
    Assert-Equal '.env.web-plane.host-kit' $audit.envFile 'real env preferred over .example'
    Write-TestPass 'docker env audit: real -> .env.web-plane.host-kit'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# Test 4: check-web-plane-docker.ps1 在「只有 .example」時發 Write-Warning。
# 用子行程在 sandbox cwd 跑(該 script 的 env 解析是 cwd-relative),3>&1 把 warning stream
# 併入 stdout 後捕捉。-TimeoutSeconds 1 讓後續 probe 快速 blocked,不卡測試。
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'check-web-plane-warn'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit.example') -Value "PUBLIC_HOST=127.0.0.1`nCOORDINATOR_PORT=8004`nVIEWER_PORT=5173"
    $cmd = "Set-Location -LiteralPath '$sb'; & '$checkScript' -TimeoutSeconds 1 3>&1"
    $warnOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String
    Assert-True ($warnOutput -match 'falling back to \.example') 'check-web-plane-docker.ps1 warns on .example fallback'
    Write-TestPass 'check-web-plane-docker.ps1: warning on .example fallback'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# Test 5: check-web-plane-docker.ps1 既有語義:明確 -EnvFile 指到不存在檔 → throw env_file_missing。
# (固化 Resolve-HybridEnvFile 既有 throw,不因本輪改動退化。)
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'check-web-plane-explicit-missing'
try {
    $missingEnv = Join-Path $sb 'does-not-exist.env'
    $cmd = "& '$checkScript' -EnvFile '$missingEnv' -TimeoutSeconds 1"
    $explicitOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String
    $explicitExit = $LASTEXITCODE
    Assert-True ($explicitExit -ne 0) 'explicit missing -EnvFile exits non-zero'
    Assert-True ($explicitOutput -match 'env_file_missing') 'explicit missing -EnvFile throws env_file_missing'
    Write-TestPass 'check-web-plane-docker.ps1: explicit missing -EnvFile throws'
}
finally { Remove-TestSandbox -Path $sb }

Write-Host "`n=== test-deploy-env-fallback.ps1: ALL PASSED ===" -ForegroundColor Green
