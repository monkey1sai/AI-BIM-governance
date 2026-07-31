[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'test-helpers.ps1')
Import-Module -Force (Join-Path $PSScriptRoot '..\lib\StructLog.psm1')

$testLogger = New-StructLogger -Service 'scripts' -Component 'test-isolated-stack-ifc-ready-seed' `
    -SkipEnvSnapshot -InMemoryOnly
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$wrapperPath = Join-Path $repoRoot 'scripts\dev\seed-isolated-stack-ifc-ready.ps1'
$launcherPath = Join-Path $repoRoot 'scripts\dev\start-isolated-branch-stack.ps1'

$scriptContract = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'scripts\SCRIPT_CONTRACT.md')
$scriptRegistry = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'scripts\script-registry.json') | ConvertFrom-Json
$registryEntries = @($scriptRegistry.scripts | Where-Object path -eq 'scripts/dev/seed-isolated-stack-ifc-ready.ps1')
Assert-Equal 1 $registryEntries.Count 'isolated stack seed wrapper has exactly one registry entry'
Assert-Equal 'dev-tool' $registryEntries[0].role 'isolated stack seed wrapper registry role'
Assert-True ($scriptContract -match [regex]::Escape('scripts/dev/seed-isolated-stack-ifc-ready.ps1')) 'script contract registers seed wrapper'
Assert-True ($scriptContract -match [regex]::Escape('-DryRun')) 'script contract documents side-effect-free DryRun'

$wrapperSource = Get-Content -Raw -LiteralPath $wrapperPath
Assert-True (
    $wrapperSource -match 'StructLog\.psm1' -and $wrapperSource -match 'Import-Module -Force \$structLogPath'
) 'seed wrapper imports the repository StructLog module'
Assert-True ($wrapperSource -match '\[switch\]\s*\$DryRun') 'seed wrapper exposes DryRun'
Assert-True ($wrapperSource -notmatch 'Write-Output') 'seed wrapper uses structured lifecycle logging instead of bare completion output'

$sandbox = New-TestSandbox -Prefix 'isolated-seed-wrapper'
try {
    $envFile = Join-Path $sandbox 'operator env with spaces.env'
    New-Item -ItemType File -Path $envFile -Force | Out-Null
    $outPath = Join-Path $sandbox 'evidence with spaces\seed result.json'
    $requiredKey = 'tenant-a/root/main/version-a/model.ifc'
    $dryRunOutput = (& pwsh -NoProfile -NonInteractive -File $wrapperPath `
        -CoordinatorBaseUrl 'http://127.0.0.1:8005' -ChangeId 'change-a' -RunId 'seed-dry-run' `
        -RequiredKey $requiredKey -EnvFile $envFile -OutPath $outPath -DryRun 2>&1 | Out-String)
    Assert-Equal 0 $LASTEXITCODE 'seed wrapper DryRun exits successfully without MinIO or coordinator access'
    $jsonLine = @($dryRunOutput -split "`r?`n" | Where-Object { $_ -match '^\s*\{"status":"dry_run"' })[-1]
    $dryRunRecord = $jsonLine | ConvertFrom-Json
    Assert-Equal 'dry_run' $dryRunRecord.status 'DryRun emits a machine-readable invocation summary'
    Assert-Equal 'npx' $dryRunRecord.command 'DryRun identifies the npx command'
    Assert-Equal (Join-Path $repoRoot 'bim-review-coordinator') $dryRunRecord.working_directory 'DryRun resolves coordinator cwd'
    $arguments = @($dryRunRecord.arguments)
    $envIndex = [Array]::IndexOf($arguments, '--env-file')
    $outIndex = [Array]::IndexOf($arguments, '--out')
    $keyIndex = [Array]::IndexOf($arguments, '--required-key')
    Assert-True ($envIndex -ge 0) 'DryRun forwards --env-file'
    Assert-Equal (Resolve-Path -LiteralPath $envFile).Path $arguments[$envIndex + 1] 'DryRun canonicalizes EnvFile with spaces'
    Assert-True ($outIndex -ge 0) 'DryRun forwards --out'
    Assert-Equal $outPath $arguments[$outIndex + 1] 'DryRun preserves absolute OutPath with spaces'
    Assert-True ($keyIndex -ge 0) 'DryRun forwards --required-key'
    Assert-Equal $requiredKey $arguments[$keyIndex + 1] 'DryRun preserves RequiredKey as one argument'

    $unsafeOutput = (& pwsh -NoProfile -NonInteractive -File $wrapperPath `
        -CoordinatorBaseUrl 'http://127.0.0.1:8004' -ChangeId 'change-a' -RunId 'seed-dry-run' -DryRun 2>&1 | Out-String)
    Assert-True ($LASTEXITCODE -ne 0) 'DryRun rejects deployment coordinator port before any side effect'
    Assert-True ($unsafeOutput -match '8005\.\.8009') 'DryRun explains the isolated coordinator port boundary'
}
finally {
    Remove-TestSandbox -Path $sandbox
}

. $launcherPath
$isolatedCoordinatorEnv = New-IsolatedBackendEnvironment -Role coordinator `
    -StateLayout ([pscustomobject]@{
        coordinator_root = 'C:\isolated\coordinator'
        fixture_root = 'C:\isolated\fixtures'
    }) `
    -Ports ([pscustomobject]@{ coordinator = 8005; governance = 49103; viewer = 5180 })
Assert-Equal 'false' $isolatedCoordinatorEnv.MINIO_WATCH_ENABLED 'isolated coordinator keeps background MinIO watcher disabled'
Assert-Equal 'true' $isolatedCoordinatorEnv.IFC_DOWNLOAD_STRICT 'isolated coordinator rejects placeholder download success'
Assert-Equal 'dev-webhook-secret' $isolatedCoordinatorEnv.EXTERNAL_INTAKE_WEBHOOK_SECRET 'isolated coordinator secret matches seed tool constant'

$testLogger | Write-StructInfo -Msg 'contract assertions passed' -Data @{ assertions = 'isolated-seed-wrapper' }
