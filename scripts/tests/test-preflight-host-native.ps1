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
    $runtimeLauncher = Join-Path $sandbox 'bim-streaming-server\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat'
    $kitExe = Join-Path $sandbox 'bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe'
    New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeLauncher) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $kitExe) -Force | Out-Null
    Set-Content -LiteralPath $runtimeLauncher -Value '@echo off'
    Set-Content -LiteralPath $kitExe -Value 'fake'

    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -PythonDependencyProbe { param($exe) @{ Status = 'OK'; Reason = ''; FastApi = '0.111.0'; Starlette = '0.37.2'; Uvicorn = '0.45.0' } } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }

    Assert-Equal 'OK' $result.venv 'venv OK'
    Assert-Equal 'OK' $result.pythonDependencies 'pythonDependencies OK'
    Assert-Equal 'OK' $result.kitLauncher 'kitLauncher OK'
    Assert-Equal 'OK' $result.kitRuntime 'kitRuntime OK'
    Assert-True ($result.kitBuildRequired -eq $false) 'kit build not required'
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
        -PythonDependencyProbe { param($exe) @{ Status = 'OK'; Reason = ''; FastApi = '0.111.0'; Starlette = '0.37.2'; Uvicorn = '0.45.0' } } `
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
        -PythonDependencyProbe { param($exe) @{ Status = 'OK'; Reason = ''; FastApi = '0.111.0'; Starlette = '0.37.2'; Uvicorn = '0.45.0' } } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }
    Assert-Equal 'MISSING_PATH' $result.kitLauncher 'Kit launcher MISSING_PATH'
    Write-TestPass 'Kit launcher missing flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 6: wrapper 存在但 _build runtime artifact 缺失 → NEEDS_BUILD
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $venvDir = Join-Path $sandbox '.venv\Scripts'
    New-Item -ItemType Directory -Path $venvDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $venvDir 'python.exe') -Value 'fake'
    $kitLauncher = Join-Path $sandbox 'bim-streaming-server\scripts\start-streaming-server.ps1'
    New-Item -ItemType Directory -Path (Split-Path -Parent $kitLauncher) -Force | Out-Null
    Set-Content -LiteralPath $kitLauncher -Value '# fake'

    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -PythonDependencyProbe { param($exe) @{ Status = 'OK'; Reason = ''; FastApi = '0.111.0'; Starlette = '0.37.2'; Uvicorn = '0.45.0' } } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }

    Assert-Equal 'OK' $result.kitLauncher 'Kit wrapper OK'
    Assert-Equal 'NEEDS_BUILD' $result.kitRuntime 'Kit runtime NEEDS_BUILD'
    Assert-True ($result.kitBuildRequired -eq $true) 'kit build required'
    Assert-True ($result.kitBuildReason -match 'streaming_launcher') 'missing launcher reason included'
    Assert-True ($result.kitBuildReason -match 'kit_exe') 'missing kit.exe reason included'
    Assert-Equal 'cd bim-streaming-server; .\repo.bat build' $result.kitBuildCommand 'build command hint'
    Assert-True ($result.ok -eq $false) 'overall false until build artifacts exist'
    Write-TestPass 'Kit runtime build requirement flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 7: Python service dependencies incompatible → INCOMPATIBLE
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $venvDir = Join-Path $sandbox '.venv\Scripts'
    New-Item -ItemType Directory -Path $venvDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $venvDir 'python.exe') -Value 'fake'

    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -PythonDependencyProbe { param($exe) @{ Status = 'INCOMPATIBLE'; Reason = 'starlette 1.1.0 incompatible with fastapi 0.111.0'; FastApi = '0.111.0'; Starlette = '1.1.0'; Uvicorn = '0.45.0' } } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }

    Assert-Equal 'INCOMPATIBLE' $result.pythonDependencies 'pythonDependencies INCOMPATIBLE'
    Assert-True ($result.pythonDependencyReason -match 'starlette 1\.1\.0') 'dependency reason includes starlette drift'
    Assert-True ($result.ok -eq $false) 'overall false when Python deps incompatible'
    Write-TestPass 'Python dependency incompatibility flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 8: Python service dependencies missing → MISSING
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $venvDir = Join-Path $sandbox '.venv\Scripts'
    New-Item -ItemType Directory -Path $venvDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $venvDir 'python.exe') -Value 'fake'

    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -PythonDependencyProbe { param($exe) @{ Status = 'MISSING'; Reason = 'missing fastapi'; FastApi = ''; Starlette = ''; Uvicorn = '' } } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }

    Assert-Equal 'MISSING' $result.pythonDependencies 'pythonDependencies MISSING'
    Assert-True ($result.pythonDependencyReason -match 'missing fastapi') 'dependency reason includes missing package'
    Assert-True ($result.ok -eq $false) 'overall false when Python deps missing'
    Write-TestPass 'Python dependency missing flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 9: real repo .venv dependency probe must survive Windows PowerShell native argument quoting
$realPy = Join-Path $repoRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $realPy -PathType Leaf) {
    $null = & $realPy -c 'import fastapi, starlette, uvicorn; print(1)' 2>&1
    if ($LASTEXITCODE -eq 0) {
        $result = Test-HostNativePythonDependencies -PythonExe $realPy
        Assert-Equal 'OK' $result.Status 'real .venv dependency probe OK'
        Assert-Equal '0.111.0' $result.FastApi 'real .venv fastapi baseline'
        Assert-Equal '0.37.2' $result.Starlette 'real .venv starlette baseline'
        Assert-Equal '0.45.0' $result.Uvicorn 'real .venv uvicorn baseline'
        Write-TestPass 'real .venv dependency probe'
    } else {
        Write-TestPass 'real .venv dependency probe skipped (packages unavailable)'
    }
} else {
    Write-TestPass 'real .venv dependency probe skipped (.venv missing)'
}

Write-Host "`n=== test-preflight-host-native.ps1: ALL PASSED ===" -ForegroundColor Green
