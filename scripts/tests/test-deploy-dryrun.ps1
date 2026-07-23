# scripts\tests\test-deploy-dryrun.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$deploy = Join-Path $repoRoot 'scripts\deploy.ps1'
$hostKitExample = Join-Path $repoRoot '.env.web-plane.host-kit.example'
$deployTopologyEnvNames = @(
    'PUBLIC_HOST',
    'VIEWER_BIND_HOST',
    'KIT_SIGNALING_HOST',
    'KIT_MEDIA_HOST',
    'WEB_VIEWER_COORDINATOR_API_BASE',
    'WEB_VIEWER_COORDINATOR_SOCKET_URL',
    'VIEWER_PUBLIC_BASE_URL',
    'COORDINATOR_PUBLIC_BASE_URL',
    'STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL',
    'COORDINATOR_INTERNAL_API_BASE',
    'INTERNAL_API_AUTH_TOKEN',
    'A4_INTERNAL_CONTEXT_TOKEN',
    'STREAMING_CONVERSION_ARTIFACTS_ROOT',
    'A4_CONVERSION_ARTIFACTS_HOST_ROOT'
)
$originalDeployTopologyEnv = @{}
foreach ($name in $deployTopologyEnvNames) {
    $originalDeployTopologyEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {

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
$audit = Get-Content -LiteralPath $auditJson -Raw | ConvertFrom-Json
Assert-Equal 49102 $audit.runtime.governancePort 'default governance port is 49102'
Assert-Equal $false $audit.runtime.governanceSkipped 'default governance is not skipped'
Assert-Equal 'http://host.docker.internal:49102' $audit.runtime.governanceApiBaseForDocker 'default Docker governance base URL'
$resolvedStreamingArtifactsRoot = [Environment]::GetEnvironmentVariable('STREAMING_CONVERSION_ARTIFACTS_ROOT', 'Process')
$resolvedA4HostArtifactsRoot = [Environment]::GetEnvironmentVariable('A4_CONVERSION_ARTIFACTS_HOST_ROOT', 'Process')
Assert-True ([System.IO.Path]::IsPathRooted($resolvedA4HostArtifactsRoot)) 'A4 governance mapping root is absolute in the host namespace'
Assert-Equal $resolvedStreamingArtifactsRoot $resolvedA4HostArtifactsRoot 'A4 host mapping root matches host-native conversion output root'
Write-TestPass 'governance dry-run audit defaults'

# Test 6: Phase 4 / 5 應不出現
Assert-True (-not ($output -match 'Phase 4:')) 'Phase 4 not entered under -DryRun'
Write-TestPass 'Phase 4 skipped'
$skipGovernanceOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $deploy -DryRun -SkipGovernance *>&1 | Out-String
Assert-True (-not ($skipGovernanceOutput -match 'Phase 4:')) 'Phase 4 not entered under -DryRun -SkipGovernance'
$skipGovernanceAudit = Get-Content -LiteralPath $auditJson -Raw | ConvertFrom-Json
Assert-Equal $true $skipGovernanceAudit.runtime.governanceSkipped 'governance skip state recorded in dry-run audit'
Assert-Equal '' $skipGovernanceAudit.runtime.governanceApiBaseForDocker 'skipped governance has no Docker base URL'
Write-TestPass 'governance skip dry-run audit'
$customGovernanceOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $deploy -DryRun -GovernancePort 49103 *>&1 | Out-String
Assert-True (-not ($customGovernanceOutput -match 'Phase 4:')) 'Phase 4 not entered under -DryRun -GovernancePort'
$customGovernanceAudit = Get-Content -LiteralPath $auditJson -Raw | ConvertFrom-Json
Assert-Equal 49103 $customGovernanceAudit.runtime.governancePort 'custom governance port recorded in dry-run audit'
Assert-Equal 'http://host.docker.internal:49103' $customGovernanceAudit.runtime.governanceApiBaseForDocker 'custom Docker governance base URL'
Write-TestPass 'custom governance port dry-run audit'

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
    foreach ($name in $deployTopologyEnvNames) {
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
Assert-Equal '0.0.0.0' $defaultHostAudit.runtime.conversionBindHost 'default LAN conversion binds all interfaces'
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
Assert-Equal '0.0.0.0' $lanAudit.runtime.conversionBindHost 'LAN conversion binds all interfaces'
Assert-Equal 'http://192.168.10.105:49101/artifacts' $lanAudit.runtime.conversionPublicArtifactsUrl 'LAN artifact URL derived from PUBLIC_HOST'
Assert-True ($lanAudit.runtime.corsOrigins -match 'http://192\.168\.10\.105:5173') 'LAN viewer origin added to coordinator CORS origins'
Assert-True ($lanAudit.runtime.allowedStageHosts -match '192\.168\.10\.105:49101') 'LAN public artifact host added to Kit stage allowlist'
Assert-Equal 49200 $lanAudit.runtime.kitSignalPort 'primary Kit signal port from env file'
Assert-Equal 48200 $lanAudit.runtime.kitMediaPort 'primary Kit media port from env file'
Remove-Item -LiteralPath $lanEnv -ErrorAction SilentlyContinue
Write-TestPass 'LAN env derives public artifacts URL and stage allowlist'

# Test 10: clean env (no BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS) falls back to 49101 default, never retired :8005
Clear-DeployTopologyEnv
$cleanStageEnv = Join-Path $repoRoot 'scripts\.run\deploy-clean-stage-test.env'
Set-Content -LiteralPath $cleanStageEnv -Encoding ascii -Value @(
    'KIT_SIGNALING_PORT=49220',
    'KIT_MEDIA_PORT=48220',
    'RUNTIME_STORAGE_ROOT=C:\tmp\ai-bim-governance-clean-stage-test\storage'
)
$cleanStageOutput = & $deploy -DryRun -EnvFile $cleanStageEnv *>&1 | Out-String
$cleanStageExit = $LASTEXITCODE
Assert-Equal 0 $cleanStageExit 'clean stage-host env dry-run exit 0'
$cleanStageAudit = Get-Content -LiteralPath $auditJson -Raw | ConvertFrom-Json
Assert-True ($cleanStageAudit.runtime.allowedStageHosts -notmatch '8005') 'clean env drops retired :8005 from stage allowlist'
Assert-True ($cleanStageAudit.runtime.allowedStageHosts -match '127\.0\.0\.1:49101') 'clean env falls back to 127.0.0.1:49101 stage host'
Remove-Item -LiteralPath $cleanStageEnv -ErrorAction SilentlyContinue
Write-TestPass 'clean env stage allowlist drops :8005 and keeps 49101 default'

# Test 11: host-native Kit authority derives a loopback base and never serializes the raw token
Clear-DeployTopologyEnv
$authorityToken = "authority-$([guid]::NewGuid().ToString('N'))"
$a4ContextToken = "a4-context-$([guid]::NewGuid().ToString('N'))"
$authorityEnv = Join-Path $repoRoot 'scripts\.run\deploy-runtime-authority-test.env'
Set-Content -LiteralPath $authorityEnv -Encoding ascii -Value @(
    'COORDINATOR_PORT=48124',
    "INTERNAL_API_AUTH_TOKEN=$authorityToken",
    "A4_INTERNAL_CONTEXT_TOKEN=$a4ContextToken",
    'RUNTIME_STORAGE_ROOT=C:\tmp\ai-bim-governance-runtime-authority-test\storage'
)
$authorityOutput = & $deploy -DryRun -EnvFile $authorityEnv *>&1 | Out-String
$authorityExit = $LASTEXITCODE
$authorityAuditRaw = Get-Content -LiteralPath $auditJson -Raw
$authorityAudit = $authorityAuditRaw | ConvertFrom-Json
$deployLog = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\.run\deploy.log') -Raw -ErrorAction SilentlyContinue
$kitSignaturePath = Join-Path $repoRoot 'scripts\.run\bim-streaming-server.params.json'
$kitSignature = Get-Content -LiteralPath $kitSignaturePath -Raw -ErrorAction SilentlyContinue
$authoritySurfaces = $authorityOutput + "`n" + $authorityAuditRaw + "`n" + $deployLog + "`n" + $kitSignature
Assert-Equal 0 $authorityExit 'runtime authority dry-run exit 0'
Assert-Equal 'http://127.0.0.1:48124' $authorityAudit.runtime.coordinatorInternalApiBase 'runtime authority base derives from coordinator port'
Assert-Equal $true $authorityAudit.runtime.runtimeAuthorityPrivateTokenConfigured 'private runtime authority token configured state is audited'
Assert-Equal 'private_configuration' $authorityAudit.runtime.runtimeAuthorityTokenSource 'runtime authority token source is classified without its value'
Assert-True (-not $authoritySurfaces.Contains($authorityToken)) 'runtime authority token absent from output, audit, log, and signature artifacts'
Assert-True (-not $authoritySurfaces.Contains($a4ContextToken)) 'A4 context token absent from output, audit, log, and signature artifacts'
Remove-Item -LiteralPath $authorityEnv -ErrorAction SilentlyContinue
Clear-DeployTopologyEnv
Write-TestPass 'host-native Kit authority loopback derivation and secret-safe audit'

# Test 12: non-loopback internal authority base fails closed without echoing the token
$invalidAuthorityToken = "authority-$([guid]::NewGuid().ToString('N'))"
$invalidAuthorityEnv = Join-Path $repoRoot 'scripts\.run\deploy-runtime-authority-invalid-test.env'
$invalidAuthorityOut = Join-Path $repoRoot 'scripts\.run\deploy-runtime-authority-invalid-test.out.log'
$invalidAuthorityErr = Join-Path $repoRoot 'scripts\.run\deploy-runtime-authority-invalid-test.err.log'
Set-Content -LiteralPath $invalidAuthorityEnv -Encoding ascii -Value @(
    'COORDINATOR_INTERNAL_API_BASE=http://192.0.2.10:8004',
    "INTERNAL_API_AUTH_TOKEN=$invalidAuthorityToken",
    'RUNTIME_STORAGE_ROOT=C:\tmp\ai-bim-governance-runtime-authority-invalid-test\storage'
)
$invalidAuthorityProc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$deploy,'-DryRun','-EnvFile',$invalidAuthorityEnv) `
    -RedirectStandardOutput $invalidAuthorityOut `
    -RedirectStandardError $invalidAuthorityErr `
    -Wait -PassThru -WindowStyle Hidden
$invalidAuthorityOutput = ((Get-Content -LiteralPath $invalidAuthorityOut -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $invalidAuthorityErr -Raw -ErrorAction SilentlyContinue))
Assert-True ($invalidAuthorityProc.ExitCode -ne 0) 'non-loopback runtime authority base exits non-zero'
Assert-True ($invalidAuthorityOutput -match 'origin-only loopback') 'non-loopback runtime authority base reports a generic validation error'
Assert-True (-not $invalidAuthorityOutput.Contains($invalidAuthorityToken)) 'invalid runtime authority configuration does not echo the token'
Remove-Item -LiteralPath $invalidAuthorityEnv, $invalidAuthorityOut, $invalidAuthorityErr -ErrorAction SilentlyContinue
Write-TestPass 'non-loopback runtime authority base rejected without secret disclosure'

# A configured A4 token must meet the coordinator boundary without being echoed.
$shortA4Token = 's7x'
$shortA4Env = Join-Path $repoRoot 'scripts\.run\deploy-a4-token-short-test.env'
$shortA4Out = Join-Path $repoRoot 'scripts\.run\deploy-a4-token-short-test.out.log'
$shortA4Err = Join-Path $repoRoot 'scripts\.run\deploy-a4-token-short-test.err.log'
Set-Content -LiteralPath $shortA4Env -Encoding ascii -Value @(
    "A4_INTERNAL_CONTEXT_TOKEN=$shortA4Token",
    'RUNTIME_STORAGE_ROOT=C:\tmp\ai-bim-governance-a4-token-test\storage'
)
$shortA4Proc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$deploy,'-DryRun','-EnvFile',$shortA4Env) `
    -RedirectStandardOutput $shortA4Out `
    -RedirectStandardError $shortA4Err `
    -Wait -PassThru -WindowStyle Hidden
$shortA4Output = ((Get-Content -LiteralPath $shortA4Out -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $shortA4Err -Raw -ErrorAction SilentlyContinue))
Assert-True ($shortA4Proc.ExitCode -ne 0) 'short configured A4 token exits non-zero'
Assert-True ($shortA4Output -match 'blank .* or between 16 and 4096 characters') 'short configured A4 token reports generic validation error'
Assert-True (-not $shortA4Output.Contains($shortA4Token)) 'short configured A4 token is not echoed'
Remove-Item -LiteralPath $shortA4Env, $shortA4Out, $shortA4Err -ErrorAction SilentlyContinue
Write-TestPass 'short A4 context token rejected without secret disclosure'

$longA4Token = 'x' * 4097
$longA4Env = Join-Path $repoRoot 'scripts\.run\deploy-a4-token-long-test.env'
$longA4Out = Join-Path $repoRoot 'scripts\.run\deploy-a4-token-long-test.out.log'
$longA4Err = Join-Path $repoRoot 'scripts\.run\deploy-a4-token-long-test.err.log'
Set-Content -LiteralPath $longA4Env -Encoding ascii -Value @(
    "A4_INTERNAL_CONTEXT_TOKEN=$longA4Token",
    'RUNTIME_STORAGE_ROOT=C:\tmp\ai-bim-governance-a4-token-test\storage'
)
$longA4Proc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$deploy,'-DryRun','-EnvFile',$longA4Env) `
    -RedirectStandardOutput $longA4Out `
    -RedirectStandardError $longA4Err `
    -Wait -PassThru -WindowStyle Hidden
$longA4Output = ((Get-Content -LiteralPath $longA4Out -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $longA4Err -Raw -ErrorAction SilentlyContinue))
Assert-True ($longA4Proc.ExitCode -ne 0) 'long configured A4 token exits non-zero'
Assert-True ($longA4Output -match 'blank .* or between 16 and 4096 characters') 'long configured A4 token reports generic validation error'
Assert-True (-not $longA4Output.Contains($longA4Token)) 'long configured A4 token is not echoed'
Remove-Item -LiteralPath $longA4Env, $longA4Out, $longA4Err -ErrorAction SilentlyContinue
Write-TestPass 'long A4 context token rejected without secret disclosure'

# Test 13: token rotation changes the ignored Kit runtime signature without storing raw tokens
$parserTokens = $null
$parserErrors = $null
$deployAst = [System.Management.Automation.Language.Parser]::ParseFile($deploy, [ref]$parserTokens, [ref]$parserErrors)
Assert-Equal 0 @($parserErrors).Count 'deploy.ps1 parses before extracting signature helpers'
$authorityHelpers = @($deployAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -in @(
            'Get-DeployEnvValue',
            'Resolve-HostNameOnly',
            'Test-LoopbackHost',
            'Resolve-CoordinatorInternalApiBase',
            'Get-DeploySecretFingerprint',
            'New-KitRuntimeSignature'
        )
}, $true) | Sort-Object { $_.Extent.StartOffset })
Assert-Equal 6 $authorityHelpers.Count 'runtime authority validation and signature helpers found'
foreach ($authorityHelper in $authorityHelpers) {
    . ([scriptblock]::Create($authorityHelper.Extent.Text))
}
$signatureTokenA = "authority-$([guid]::NewGuid().ToString('N'))"
$signatureTokenB = "authority-$([guid]::NewGuid().ToString('N'))"
$signatureCommon = @{
    PublicHost = '127.0.0.1'
    SignalPort = 49100
    StreamPort = 47998
    SpectatorSignalPorts = @(49110)
    SpectatorStreamPorts = @(48008)
    AllowedStageHosts = '127.0.0.1:49101'
    CoordinatorInternalApiBase = 'http://127.0.0.1:8004'
}
$signatureA = New-KitRuntimeSignature @signatureCommon -RuntimeAuthorityTokenFingerprint (Get-DeploySecretFingerprint -Value $signatureTokenA)
$signatureB = New-KitRuntimeSignature @signatureCommon -RuntimeAuthorityTokenFingerprint (Get-DeploySecretFingerprint -Value $signatureTokenB)
Assert-True ($signatureA -ne $signatureB) 'runtime authority token rotation changes Kit runtime signature'
Assert-True (-not $signatureA.Contains($signatureTokenA)) 'Kit runtime signature excludes first raw token'
Assert-True (-not $signatureB.Contains($signatureTokenB)) 'Kit runtime signature excludes rotated raw token'
Write-TestPass 'runtime authority token rotation changes secret-safe Kit signature'

$governanceSignatureHelper = @($deployAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'New-GovernanceRuntimeSignature'
}, $true))
Assert-Equal 1 $governanceSignatureHelper.Count 'governance signature helper found'
. ([scriptblock]::Create($governanceSignatureHelper[0].Extent.Text))
$a4SignatureTokenA = "a4-context-$([guid]::NewGuid().ToString('N'))"
$a4SignatureTokenB = "a4-context-$([guid]::NewGuid().ToString('N'))"
$governanceSignatureCommon = @{
    Port = 49102
    DbPath = 'C:\edge\governance.db'
    FileLibraryRoot = 'C:\edge\storage'
}
$governanceSignatureA = New-GovernanceRuntimeSignature @governanceSignatureCommon -A4InternalContextTokenFingerprint (Get-DeploySecretFingerprint -Value $a4SignatureTokenA)
$governanceSignatureB = New-GovernanceRuntimeSignature @governanceSignatureCommon -A4InternalContextTokenFingerprint (Get-DeploySecretFingerprint -Value $a4SignatureTokenB)
Assert-True ($governanceSignatureA -ne $governanceSignatureB) 'A4 token rotation changes governance runtime signature'
Assert-True (-not $governanceSignatureA.Contains($a4SignatureTokenA)) 'governance signature excludes first raw A4 token'
Assert-True (-not $governanceSignatureB.Contains($a4SignatureTokenB)) 'governance signature excludes rotated raw A4 token'
Write-TestPass 'A4 token rotation changes secret-safe governance signature'

# Test 14: internal authority base accepts loopback origins only and never echoes rejected input
$authorityValidationEnv = Join-Path $repoRoot 'scripts\.run\deploy-runtime-authority-validation-not-present.env'
$invalidAuthorityBases = @(
    'http://host.docker.internal:8004',
    'http://0.0.0.0:8004',
    'http://192.0.2.10:8004',
    'http://user@127.0.0.1:8004',
    'http://127.0.0.1:8004/internal',
    'http://127.0.0.1:8004?mode=internal',
    'http://127.0.0.1:8004#internal',
    'ftp://127.0.0.1:8004'
)
foreach ($invalidAuthorityBase in $invalidAuthorityBases) {
    [Environment]::SetEnvironmentVariable('COORDINATOR_INTERNAL_API_BASE', $invalidAuthorityBase, 'Process')
    $validationError = $null
    try {
        Resolve-CoordinatorInternalApiBase -EnvFile $authorityValidationEnv -CoordinatorPort 8004 | Out-Null
    } catch {
        $validationError = $_.Exception.Message
    }
    Assert-True (-not [string]::IsNullOrWhiteSpace($validationError)) 'invalid runtime authority origin is rejected'
    Assert-True (-not $validationError.Contains($invalidAuthorityBase)) 'invalid runtime authority origin is not echoed'
}
foreach ($validAuthorityBase in @('http://127.0.0.1:8004', 'http://localhost:8004', 'http://[::1]:8004')) {
    [Environment]::SetEnvironmentVariable('COORDINATOR_INTERNAL_API_BASE', $validAuthorityBase, 'Process')
    $resolvedAuthorityBase = Resolve-CoordinatorInternalApiBase -EnvFile $authorityValidationEnv -CoordinatorPort 8004
    Assert-True (Test-LoopbackHost -HostName ([uri]$resolvedAuthorityBase).Host) 'valid loopback runtime authority origin is accepted'
}
Clear-DeployTopologyEnv
Write-TestPass 'runtime authority origin validation covers loopback and rejected URL surfaces'

# Test 15: host-kit test deployment profile opts into MinIO watch without committing credentials
$hostKitExampleText = Get-Content -LiteralPath $hostKitExample -Raw
Assert-True ($hostKitExampleText -match '(?m)^COORDINATOR_INTERNAL_API_BASE=\r?$') 'host-kit example keeps coordinator internal base placeholder empty'
Assert-True ($hostKitExampleText -match '(?m)^INTERNAL_API_AUTH_TOKEN=\r?$') 'host-kit example keeps internal API token empty'
Assert-True ($hostKitExampleText -match '(?m)^A4_INTERNAL_CONTEXT_TOKEN=\r?$') 'host-kit example keeps A4 context token empty'
Assert-True ($hostKitExampleText -match '(?m)^RUNTIME_STORAGE_ROOT=\./storage\r?$') 'host-kit example has deployable runtime storage root'
Assert-True ($hostKitExampleText -match '(?m)^MINIO_WATCH_ENABLED=true\r?$') 'host-kit example enables MinIO watch by default for test deployment'
Assert-True ($hostKitExampleText -match '(?m)^MINIO_WATCH_ENDPOINT=http://192\.168\.20\.234:9000\r?$') 'host-kit example points at test MinIO endpoint'
Assert-True ($hostKitExampleText -match '(?m)^MINIO_WATCH_BUCKET=bim-control\r?$') 'host-kit example points at bim-control bucket'
Assert-True ($hostKitExampleText -match '(?m)^MINIO_WATCH_ACCESS_KEY=\r?$') 'host-kit example keeps MinIO access key empty'
Assert-True ($hostKitExampleText -match '(?m)^MINIO_WATCH_SECRET_KEY=\r?$') 'host-kit example keeps MinIO secret key empty'
Write-TestPass 'host-kit runtime authority placeholders and MinIO watch deployment defaults'

Write-Host "`n=== test-deploy-dryrun.ps1: ALL PASSED ===" -ForegroundColor Green
} finally {
    foreach ($name in $deployTopologyEnvNames) {
        [Environment]::SetEnvironmentVariable($name, $originalDeployTopologyEnv[$name], 'Process')
    }
    foreach ($testArtifact in @(
        'deploy-collision-test.out.log',
        'deploy-collision-test.err.log',
        'deploy-default-host-test.env',
        'deploy-lan-test.env',
        'deploy-clean-stage-test.env',
        'deploy-runtime-authority-test.env',
        'deploy-runtime-authority-invalid-test.env',
        'deploy-runtime-authority-invalid-test.out.log',
        'deploy-runtime-authority-invalid-test.err.log',
        'deploy-a4-token-short-test.env',
        'deploy-a4-token-short-test.out.log',
        'deploy-a4-token-short-test.err.log'
    )) {
        Remove-Item -LiteralPath (Join-Path $repoRoot "scripts\.run\$testArtifact") -ErrorAction SilentlyContinue
    }
}
