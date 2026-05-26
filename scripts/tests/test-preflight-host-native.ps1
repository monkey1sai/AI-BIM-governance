# scripts\tests\test-preflight-host-native.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\preflight-host-native.ps1'
. $modulePath

# Test 1: 全 OK 場景
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $venvDir = Join-Path $sandbox '.venv\Scripts'
    New-Item -ItemType Directory -Path $venvDir -Force | Out-Null
    $pyExe = Join-Path $venvDir 'python.exe'
    Set-Content -LiteralPath $pyExe -Value 'fake'  # 內容無關,只看存在性
    $kitLauncher = Join-Path $sandbox 'bim-streaming-server\scripts\start-streaming-server.ps1'
    New-Item -ItemType Directory -Path (Split-Path -Parent $kitLauncher) -Force | Out-Null
    Set-Content -LiteralPath $kitLauncher -Value '# fake'

    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }

    Assert-Equal 'OK' $result.venv 'venv OK'
    Assert-Equal 'OK' $result.kitLauncher 'kitLauncher OK'
    Assert-Equal 'OK' $result.nvidiaDriver 'nvidiaDriver OK'
    Assert-True ($result.ok -eq $true) 'overall ok'
    Write-TestPass 'happy path'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 2: .venv 不存在 → MISSING
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }
    Assert-Equal 'MISSING' $result.venv 'venv MISSING'
    Assert-True ($result.ok -eq $false) 'ok=false'
    Write-TestPass '.venv missing flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 3: .venv 在但 Python 版本 < 3.11 → WRONG_VERSION
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $venvDir = Join-Path $sandbox '.venv\Scripts'
    New-Item -ItemType Directory -Path $venvDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $venvDir 'python.exe') -Value 'fake'

    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.10.5' } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }
    Assert-Equal 'WRONG_VERSION' $result.venv 'venv WRONG_VERSION'
    Write-TestPass 'Python <3.11 flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 4: nvidia-smi 不在 → MISSING
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -NvidiaSmiProbe { @{ Exists = $false; ExitCode = -1 } }
    Assert-Equal 'MISSING' $result.nvidiaDriver 'nvidiaDriver MISSING'
    Write-TestPass 'nvidia-smi missing flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 5: Kit launcher path 缺 → MISSING_PATH
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $venvDir = Join-Path $sandbox '.venv\Scripts'
    New-Item -ItemType Directory -Path $venvDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $venvDir 'python.exe') -Value 'fake'
    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }
    Assert-Equal 'MISSING_PATH' $result.kitLauncher 'Kit launcher MISSING_PATH'
    Write-TestPass 'Kit launcher missing flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

Write-Host "`n=== test-preflight-host-native.ps1: ALL PASSED ===" -ForegroundColor Green
