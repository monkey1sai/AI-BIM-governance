# scripts\tests\test-preflight-ports.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\preflight-ports.ps1'
. $modulePath

# Test 1: 全 FREE
$sandbox = New-TestSandbox -Prefix 'preflight-ports'
try {
    $result = Test-PortAvailability -RepoRoot $sandbox `
        -PortLookup { param($port) $null } `
        -ProcessNameLookup { param($procId) $null }
    Assert-True ($result.docker.Count -eq 2) 'docker has 2 ports'
    Assert-True ($result.hostNative.Count -eq 3) 'hostNative has 3 ports'
    foreach ($p in @($result.docker) + @($result.hostNative)) {
        Assert-Equal 'FREE' $p.status "port $($p.port) FREE"
    }
    Write-TestPass 'all ports free'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 2: :49100 被陌生 PID 佔(不在 PID file)
$sandbox = New-TestSandbox -Prefix 'preflight-ports-pid'
try {
    $runDir = Join-Path $sandbox 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    # 不寫任何 .pid 進去,模擬「不是我們的」
    $result = Test-PortAvailability -RepoRoot $sandbox `
        -PortLookup { param($port) if ($port -eq 49100) { 12345 } else { $null } } `
        -ProcessNameLookup { param($procId) if ($procId -eq 12345) { 'kit.exe' } else { $null } }

    $kit = $result.hostNative | Where-Object { $_.port -eq 49100 } | Select-Object -First 1
    Assert-Equal 'OCCUPIED' $kit.status '49100 OCCUPIED'
    Assert-Equal 12345 $kit.pid '49100 pid=12345'
    Assert-Equal 'kit.exe' $kit.name '49100 name=kit.exe'
    Assert-True ($kit.ourPidFile -eq $false) '49100 not in PID file'
    Write-TestPass 'stranger PID flagged ourPidFile=false'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 3: :49100 被「我們」(scripts\.run\bim-streaming-server.pid 內)佔
$sandbox = New-TestSandbox -Prefix 'preflight-ports-pid'
try {
    $runDir = Join-Path $sandbox 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $runDir 'bim-streaming-server.pid') -Value '12345'

    $result = Test-PortAvailability -RepoRoot $sandbox `
        -PortLookup { param($port) if ($port -eq 49100) { 12345 } else { $null } } `
        -ProcessNameLookup { param($procId) if ($procId -eq 12345) { 'powershell.exe' } else { $null } }

    $kit = $result.hostNative | Where-Object { $_.port -eq 49100 } | Select-Object -First 1
    Assert-True ($kit.ourPidFile -eq $true) '49100 in our PID file'
    Write-TestPass 'our PID flagged ourPidFile=true'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 4: spectator ports 會納入 host-native port audit
$sandbox = New-TestSandbox -Prefix 'preflight-ports-spectator'
try {
    $result = Test-PortAvailability -RepoRoot $sandbox `
        -ExtraHostNativePorts @(49110, 48008, 49110) `
        -PortLookup { param($port) if ($port -eq 49110) { 24680 } else { $null } } `
        -ProcessNameLookup { param($procId) if ($procId -eq 24680) { 'kit.exe' } else { $null } }

    Assert-True ($result.hostNative.Count -eq 5) 'hostNative includes unique spectator ports'
    $spectator = $result.hostNative | Where-Object { $_.port -eq 49110 } | Select-Object -First 1
    Assert-Equal 'OCCUPIED' $spectator.status 'spectator port occupied'
    Assert-Equal 24680 $spectator.pid 'spectator port pid'
    Write-TestPass 'spectator ports included in preflight'
}
finally { Remove-TestSandbox -Path $sandbox }

Write-Host "`n=== test-preflight-ports.ps1: ALL PASSED ===" -ForegroundColor Green
