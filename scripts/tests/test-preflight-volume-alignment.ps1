# scripts\tests\test-preflight-volume-alignment.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\preflight-volume-alignment.ps1'
. $modulePath

# Test 1: ALIGNED — leaf=storage, parent=<sandbox>
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit') `
        -Value "RUNTIME_STORAGE_ROOT=$sb\storage"
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    Assert-Equal 'ALIGNED' $result.status 'leaf=storage → ALIGNED'
    Assert-Equal "$sb\storage" $result.runtimeStorageRoot 'echo back path'
    Assert-Equal 'storage' $result.leaf 'leaf=storage'
    Write-TestPass 'aligned'
}
finally { Remove-TestSandbox -Path $sb }

# Test 2: MISSING_KEY — .env 內沒這個 key
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit') `
        -Value "COORDINATOR_PORT=8004"
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    Assert-Equal 'MISSING_KEY' $result.status 'no key → MISSING_KEY'
    Assert-True ($null -eq $result.runtimeStorageRoot) 'no path'
    Write-TestPass 'missing key'
}
finally { Remove-TestSandbox -Path $sb }

# Test 3: WRONG_LEAF — leaf 不是 storage
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit') `
        -Value "RUNTIME_STORAGE_ROOT=D:\bim-share\ifc-bucket"
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    Assert-Equal 'WRONG_LEAF' $result.status 'leaf=ifc-bucket → WRONG_LEAF'
    Assert-Equal 'ifc-bucket' $result.leaf 'leaf echo'
    Write-TestPass 'wrong leaf flagged'
}
finally { Remove-TestSandbox -Path $sb }

# Test 4: env file 不存在 → MISSING_KEY (treat as missing)
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    Assert-Equal 'MISSING_KEY' $result.status 'no env file → MISSING_KEY'
    Write-TestPass 'missing env file handled'
}
finally { Remove-TestSandbox -Path $sb }

# Test 5: Windows path leaf 大小寫不敏感,Storage 也視為 aligned
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit') `
        -Value "RUNTIME_STORAGE_ROOT=$sb\Storage"
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    Assert-Equal 'ALIGNED' $result.status 'leaf=Storage → ALIGNED'
    Assert-Equal 'Storage' $result.leaf 'leaf preserves input case'
    Write-TestPass 'case-insensitive storage leaf'
}
finally { Remove-TestSandbox -Path $sb }

# Test 6: relative path ./storage → 解析 leaf=storage,基於 RepoRoot
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit') `
        -Value "RUNTIME_STORAGE_ROOT=./storage"
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    Assert-Equal 'ALIGNED' $result.status 'relative ./storage resolved → ALIGNED'
    Assert-Equal "$sb\storage" $result.runtimeStorageRoot 'resolved to abs path'
    Write-TestPass 'relative path resolved'
}
finally { Remove-TestSandbox -Path $sb }

Write-Host "`n=== test-preflight-volume-alignment.ps1: ALL PASSED ===" -ForegroundColor Green
