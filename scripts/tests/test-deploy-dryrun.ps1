# scripts\tests\test-deploy-dryrun.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$deploy = Join-Path $repoRoot 'scripts\deploy.ps1'

# 跑 -DryRun 並抓 stdout
$output = & $deploy -DryRun 2>&1 | Out-String
$exitCode = $LASTEXITCODE

# Test 1: 退 0
Assert-Equal 0 $exitCode '-DryRun exit 0'
Write-TestPass '-DryRun exit 0'

# Test 2: 印 Phase 1 audit
Assert-True ($output -match 'Phase 1: Preflight') 'Phase 1 header printed'
Write-TestPass 'Phase 1 header'

# Test 3: 印 audit 結果(至少含 docker 系列)
Assert-True ($output -match '\[ok\s+\]|\[fix\s+\]|\[fail\s+\]') 'audit lines printed'
Write-TestPass 'audit lines'

# Test 4: Phase 2 標 DRY-RUN
Assert-True ($output -match 'DRY-RUN') 'DRY-RUN marker printed'
Write-TestPass 'DRY-RUN marker'

# Test 5: 真實狀態未被改(.venv 是否 pre-existed 一致 / docker compose 未啟動)
# 這是 best-effort check;只看 deploy-audit.json 有寫
$auditJson = Join-Path $repoRoot 'scripts\.run\deploy-audit.json'
Assert-True (Test-Path $auditJson) 'deploy-audit.json written'
Write-TestPass 'deploy-audit.json present'

# Test 6: Phase 4 / 5 應不出現
Assert-True (-not ($output -match 'Phase 4:')) 'Phase 4 not entered under -DryRun'
Write-TestPass 'Phase 4 skipped'

Write-Host "`n=== test-deploy-dryrun.ps1: ALL PASSED ===" -ForegroundColor Green
