# scripts\tests\test-preflight-env.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\preflight-env.ps1'
. $modulePath

# helper: 建一個 sandbox 含 .env / .env.example 並回路徑
# 注意:[string] cast 會把 $null 轉成 "",所以用 IsNullOrEmpty 區分「沒給」vs「給空字串」
function New-EnvSandbox {
    param([string] $EnvContent, [string] $ExampleContent, [string] $FileName = '.env')
    $sb = New-TestSandbox -Prefix 'preflight-env'
    if (-not [string]::IsNullOrEmpty($EnvContent)) {
        Set-Content -LiteralPath (Join-Path $sb $FileName) -Value $EnvContent
    }
    if (-not [string]::IsNullOrEmpty($ExampleContent)) {
        Set-Content -LiteralPath (Join-Path $sb "$FileName.example") -Value $ExampleContent
    }
    return $sb
}

# Test 1: example 有 5 key、.env 有 3 key → missing 列出 2 個
$sb = New-EnvSandbox `
    -EnvContent "A=1`nB=2`nC=3" `
    -ExampleContent "A=`nB=`nC=`nD=`nE="
try {
    $result = Get-EnvAudit -EnvPath (Join-Path $sb '.env') -ExamplePath (Join-Path $sb '.env.example')
    Assert-True (($result.missing -contains 'D') -and ($result.missing -contains 'E')) 'D and E in missing'
    Assert-True ($result.missing.Count -eq 2) 'exactly 2 missing'
    Write-TestPass 'missing-key audit'
}
finally { Remove-TestSandbox -Path $sb }

# Test 2: .env 已有 key 值 → 不出現在 missing(invariant:不動實值)
$sb = New-EnvSandbox `
    -EnvContent "SECRET=existing-real-value`nKEEP=ok" `
    -ExampleContent "SECRET=your-secret-here`nKEEP="
try {
    $result = Get-EnvAudit -EnvPath (Join-Path $sb '.env') -ExamplePath (Join-Path $sb '.env.example')
    Assert-True ($result.missing.Count -eq 0) 'no missing when all keys present'
    Write-TestPass 'existing keys preserved'
}
finally { Remove-TestSandbox -Path $sb }

# Test 3: .env 不存在 → missing = example 全部 key
$sb = New-EnvSandbox -EnvContent $null -ExampleContent "X=1`nY=2"
try {
    $result = Get-EnvAudit -EnvPath (Join-Path $sb '.env') -ExamplePath (Join-Path $sb '.env.example')
    Assert-True ($result.envExists -eq $false) 'envExists false'
    Assert-True ($result.missing.Count -eq 2) 'all example keys missing'
    Write-TestPass 'missing .env reports all keys'
}
finally { Remove-TestSandbox -Path $sb }

# Test 4: example 不存在 → audit 回 exampleExists=false
$sb = New-EnvSandbox -EnvContent "A=1" -ExampleContent $null
try {
    $result = Get-EnvAudit -EnvPath (Join-Path $sb '.env') -ExamplePath (Join-Path $sb '.env.example')
    Assert-True ($result.exampleExists -eq $false) 'exampleExists false'
    Write-TestPass 'missing example handled'
}
finally { Remove-TestSandbox -Path $sb }

# Test 5: 整 Test-EnvFiles 對三個目標檔(root / coordinator / web-plane)
$sb = New-TestSandbox -Prefix 'preflight-env-suite'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.example') -Value "A=`nB="
    Set-Content -LiteralPath (Join-Path $sb '.env') -Value "A=1"
    New-Item -ItemType Directory -Path (Join-Path $sb 'bim-review-coordinator') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $sb 'bim-review-coordinator\.env.example') -Value "P=`nQ="
    Set-Content -LiteralPath (Join-Path $sb 'bim-review-coordinator\.env') -Value "P=1`nQ=2"
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit.example') -Value "R=`nS="
    # .env.web-plane.host-kit 不存在 → 全 missing

    $suite = Test-EnvFiles -RepoRoot $sb
    Assert-Equal 3 $suite.Count 'three files audited'
    $rootAudit = $suite | Where-Object { $_.file -eq '.env' } | Select-Object -First 1
    Assert-True ($rootAudit.missing -contains 'B') 'root .env missing B'
    $coordAudit = $suite | Where-Object { $_.file -eq 'bim-review-coordinator/.env' } | Select-Object -First 1
    Assert-True ($coordAudit.missing.Count -eq 0) 'coordinator .env complete'
    $webAudit = $suite | Where-Object { $_.file -eq '.env.web-plane.host-kit' } | Select-Object -First 1
    Assert-True ($webAudit.envExists -eq $false) 'web-plane .env not exist'
    Assert-True ($webAudit.missing.Count -eq 2) 'all 2 keys missing'
    Write-TestPass 'Test-EnvFiles audits three files'
}
finally { Remove-TestSandbox -Path $sb }

Write-Host "`n=== test-preflight-env.ps1: ALL PASSED ===" -ForegroundColor Green
