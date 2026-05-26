# scripts\tests\test-deploy-report.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\deploy-report.ps1'
. $modulePath

# Test 1: Write-DeployTag 'ok' 'message' 寫進 log 且回 ok
$sandbox = New-TestSandbox -Prefix 'deploy-report'
try {
    $logPath = Join-Path $sandbox 'deploy.log'
    $result = Write-DeployTag -Tag 'ok' -Message 'coordinator running' -LogPath $logPath
    Assert-True ($result.Tag -eq 'ok') 'returned object has Tag=ok'
    Assert-True (Test-Path -LiteralPath $logPath) 'log file created'
    $logContent = Get-Content -LiteralPath $logPath -Raw
    Assert-True ($logContent -match '\[ok\s+\] coordinator running') 'log content has [ok   ] line'
    Write-TestPass 'Write-DeployTag ok writes to log'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 2: 各 tag 都會被接受,fail tag 回傳 IsFail=true
$sandbox = New-TestSandbox -Prefix 'deploy-report'
try {
    $logPath = Join-Path $sandbox 'deploy.log'
    foreach ($tag in @('ok','fix','ask','skip','warn','fail')) {
        $r = Write-DeployTag -Tag $tag -Message "msg-$tag" -LogPath $logPath
        Assert-True ($r.Tag -eq $tag) "accepts tag=$tag"
    }
    $r = Write-DeployTag -Tag 'fail' -Message 'boom' -LogPath $logPath
    Assert-True ($r.IsFail -eq $true) 'fail tag has IsFail=true'
    $r = Write-DeployTag -Tag 'warn' -Message 'soft' -LogPath $logPath
    Assert-True ($r.IsFail -eq $false) 'warn tag has IsFail=false'
    Write-TestPass 'all tags accepted, IsFail reflects severity'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 3: 不認識的 tag 應 throw
Assert-Throws {
    Write-DeployTag -Tag 'unknown' -Message 'x' -LogPath (Join-Path (New-TestSandbox) 'd.log')
} 'unknown tag throws'
Write-TestPass 'unknown tag throws'

Write-Host "`n=== test-deploy-report.ps1: ALL PASSED ===" -ForegroundColor Green
