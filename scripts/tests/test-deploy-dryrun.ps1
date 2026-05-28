# scripts\tests\test-deploy-dryrun.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$deploy = Join-Path $repoRoot 'scripts\deploy.ps1'

# 跑 -DryRun 並抓所有 stream(Write-Host 走 Information stream,要 *>&1 才能 capture)
$output = & $deploy -DryRun *>&1 | Out-String
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

# Test 7: spectator ports must not collide with primary Kit ports
$collisionOut = Join-Path $repoRoot 'scripts\.run\deploy-collision-test.out.log'
$collisionErr = Join-Path $repoRoot 'scripts\.run\deploy-collision-test.err.log'
$collisionProc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$deploy,'-DryRun','-SpectatorCount','1','-KitSpectatorSignalPortStart','49100') `
    -RedirectStandardOutput $collisionOut `
    -RedirectStandardError $collisionErr `
    -Wait -PassThru -WindowStyle Hidden
$collisionOutput = ((Get-Content -LiteralPath $collisionOut -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $collisionErr -Raw -ErrorAction SilentlyContinue))
$collisionExit = $collisionProc.ExitCode
Remove-Item -LiteralPath $collisionOut, $collisionErr -ErrorAction SilentlyContinue
Assert-True ($collisionExit -ne 0) 'spectator/primary collision exits non-zero'
Assert-True ($collisionOutput -match 'conflicts with primary Kit signaling port') 'spectator/primary collision message'
Write-TestPass 'spectator primary collision rejected'

function Clear-DeployTopologyEnv {
    foreach ($name in @(
        'PUBLIC_HOST',
        'VIEWER_BIND_HOST',
        'KIT_SIGNALING_HOST',
        'KIT_MEDIA_HOST',
        'WEB_VIEWER_COORDINATOR_API_BASE',
        'WEB_VIEWER_COORDINATOR_SOCKET_URL',
        'VIEWER_PUBLIC_BASE_URL',
        'COORDINATOR_PUBLIC_BASE_URL',
        'STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL'
    )) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
}

# Test 8: default PUBLIC_HOST derives LAN demo topology when env file omits it
Clear-DeployTopologyEnv
$defaultHostEnv = Join-Path $repoRoot 'scripts\.run\deploy-default-host-test.env'
Set-Content -LiteralPath $defaultHostEnv -Encoding ascii -Value @(
    'KIT_SIGNALING_PORT=49210',
    'KIT_MEDIA_PORT=48210',
    'RUNTIME_STORAGE_ROOT=C:\tmp\ai-bim-governance-default-host-test\storage'
)
$defaultHostOutput = & $deploy -DryRun -EnvFile $defaultHostEnv *>&1 | Out-String
$defaultHostExit = $LASTEXITCODE
Assert-Equal 0 $defaultHostExit 'default LAN host dry-run exit 0'
$defaultHostAudit = Get-Content -LiteralPath $auditJson -Raw | ConvertFrom-Json
Assert-Equal '192.168.10.105' $defaultHostAudit.runtime.publicHost 'default PUBLIC_HOST is LAN demo IP'
Assert-Equal 'http://192.168.10.105:8004' $defaultHostAudit.runtime.coordinatorPublicUrl 'default coordinator URL uses LAN demo IP'
Assert-Equal 'http://192.168.10.105:5173' $defaultHostAudit.runtime.viewerPublicUrl 'default viewer URL uses LAN demo IP'
Assert-Equal 'http://192.168.10.105:49101/artifacts' $defaultHostAudit.runtime.conversionPublicArtifactsUrl 'default artifact URL uses LAN demo IP'
Assert-True ($defaultHostAudit.runtime.corsOrigins -match 'http://192\.168\.10\.105:5173') 'default LAN viewer origin added to coordinator CORS origins'
Remove-Item -LiteralPath $defaultHostEnv -ErrorAction SilentlyContinue
Write-TestPass 'default PUBLIC_HOST derives LAN demo topology'

# Test 9: LAN PUBLIC_HOST from env file derives artifact URLs over loopback defaults
Clear-DeployTopologyEnv
$lanEnv = Join-Path $repoRoot 'scripts\.run\deploy-lan-test.env'
Set-Content -LiteralPath $lanEnv -Encoding ascii -Value @(
    'PUBLIC_HOST=192.168.10.105',
    'KIT_SIGNALING_PORT=49200',
    'KIT_MEDIA_PORT=48200',
    'STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL=http://127.0.0.1:49101/artifacts',
    'RUNTIME_STORAGE_ROOT=C:\tmp\ai-bim-governance-test\storage'
)
$lanOutput = & $deploy -DryRun -EnvFile $lanEnv *>&1 | Out-String
$lanExit = $LASTEXITCODE
Assert-Equal 0 $lanExit 'LAN env dry-run exit 0'
$lanAudit = Get-Content -LiteralPath $auditJson -Raw | ConvertFrom-Json
Assert-Equal 'http://192.168.10.105:49101/artifacts' $lanAudit.runtime.conversionPublicArtifactsUrl 'LAN artifact URL derived from PUBLIC_HOST'
Assert-True ($lanAudit.runtime.corsOrigins -match 'http://192\.168\.10\.105:5173') 'LAN viewer origin added to coordinator CORS origins'
Assert-True ($lanAudit.runtime.allowedStageHosts -match '192\.168\.10\.105:49101') 'LAN public artifact host added to Kit stage allowlist'
Assert-Equal 49200 $lanAudit.runtime.kitSignalPort 'primary Kit signal port from env file'
Assert-Equal 48200 $lanAudit.runtime.kitMediaPort 'primary Kit media port from env file'
Remove-Item -LiteralPath $lanEnv -ErrorAction SilentlyContinue
Write-TestPass 'LAN env derives public artifacts URL and stage allowlist'

Write-Host "`n=== test-deploy-dryrun.ps1: ALL PASSED ===" -ForegroundColor Green
