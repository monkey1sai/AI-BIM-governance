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
Assert-True ($scriptContract -match 'manifest process ownership') 'script contract documents live manifest ownership binding'
Assert-True ($scriptContract -match 'atomic no-clobber') 'script contract documents evidence publication boundary'

$wrapperSource = Get-Content -Raw -LiteralPath $wrapperPath
Assert-True (
    $wrapperSource -match 'StructLog\.psm1' -and $wrapperSource -match 'Import-Module -Force \$structLogPath'
) 'seed wrapper imports the repository StructLog module'
Assert-True ($wrapperSource -match '\[switch\]\s*\$DryRun') 'seed wrapper exposes DryRun'
Assert-True ($wrapperSource -notmatch 'Write-Output') 'seed wrapper uses structured lifecycle logging instead of bare completion output'
Assert-True ($wrapperSource -match 'Invoke-IsolatedBranchStack -Action status') 'seed wrapper reuses launcher manifest/process status gate'

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

    $localhostOutput = (& pwsh -NoProfile -NonInteractive -File $wrapperPath `
        -CoordinatorBaseUrl 'http://localhost:8005' -ChangeId 'change-a' -RunId 'seed-dry-run' -DryRun 2>&1 | Out-String)
    Assert-True ($LASTEXITCODE -ne 0) 'wrapper rejects localhost alias that cannot exactly match canonical manifest authority'
    Assert-True ($localhostOutput -match 'canonical 127\.0\.0\.1') 'wrapper explains canonical manifest host requirement'

    & {
        . $wrapperPath -CoordinatorBaseUrl 'http://127.0.0.1:8005' `
            -ChangeId 'change-a' -RunId 'seed-binding-test' -DryRun | Out-Null

        $activeResolver = {
            param($Launcher, $Root, $BoundChange, $BoundRun)
            $null = $Launcher
            if ($BoundChange -cne 'change-a' -or $BoundRun -cne 'stack-run-a') {
                throw 'binding resolver received the wrong identity'
            }
            [pscustomobject]@{
                status = 'active'
                coordinator_base_url = 'http://127.0.0.1:8005'
                coordinator_owned = $true
                coordinator_ready = $true
                manifest_path = (Join-Path $Root 'artifacts\e2e\change-a\stack-run-a\stack-manifest.json')
            }
        }
        $binding = Assert-IsolatedSeedStackBinding -BaseUrl 'http://127.0.0.1:8005' `
            -RepoRoot $repoRoot -StackChangeId 'change-a' -StackRunId 'stack-run-a' `
            -BindingResolver $activeResolver
        Assert-Equal 'active' $binding.status 'active owned manifest binding is accepted'

        $mismatchResolver = {
            [pscustomobject]@{
                status = 'active'
                coordinator_base_url = 'http://127.0.0.1:8006'
                coordinator_owned = $true
                coordinator_ready = $true
                manifest_path = 'stack-manifest.json'
            }
        }
        $mismatchRejected = $false
        try {
            $null = Assert-IsolatedSeedStackBinding -BaseUrl 'http://127.0.0.1:8005' `
                -RepoRoot $repoRoot -StackChangeId 'change-a' -StackRunId 'stack-run-a' `
                -BindingResolver $mismatchResolver
        }
        catch {
            $mismatchRejected = $true
            Assert-True ($_.Exception.Message -match '未綁定') 'manifest base mismatch explains binding rejection'
        }
        Assert-True $mismatchRejected 'listener in isolated port range is rejected when manifest base differs'

        $degradedResolver = {
            [pscustomobject]@{
                status = 'degraded'
                coordinator_base_url = 'http://127.0.0.1:8005'
                coordinator_owned = $false
                coordinator_ready = $false
                manifest_path = 'stack-manifest.json'
            }
        }
        $degradedRejected = $false
        try {
            $null = Assert-IsolatedSeedStackBinding -BaseUrl 'http://127.0.0.1:8005' `
                -RepoRoot $repoRoot -StackChangeId 'change-a' -StackRunId 'stack-run-a' `
                -BindingResolver $degradedResolver
        }
        catch {
            $degradedRejected = $true
            Assert-True ($_.Exception.Message -match '不是 active') 'degraded manifest status explains rejection'
        }
        Assert-True $degradedRejected 'degraded or unowned listener is rejected before seeding'

        $unownedResolver = {
            [pscustomobject]@{
                status = 'active'
                coordinator_base_url = 'http://127.0.0.1:8005'
                coordinator_owned = $false
                coordinator_ready = $true
                manifest_path = 'stack-manifest.json'
            }
        }
        $unownedRejected = $false
        try {
            $null = Assert-IsolatedSeedStackBinding -BaseUrl 'http://127.0.0.1:8005' `
                -RepoRoot $repoRoot -StackChangeId 'change-a' -StackRunId 'stack-run-a' `
                -BindingResolver $unownedResolver
        }
        catch {
            $unownedRejected = $true
            Assert-True ($_.Exception.Message -match 'ownership') 'unowned active listener explains ownership rejection'
        }
        Assert-True $unownedRejected 'active status cannot bypass coordinator listener ownership gate'
    }
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
Assert-Equal 'http://127.0.0.1:49103' $isolatedCoordinatorEnv.STREAMING_CONVERSION_API_BASE 'isolated coordinator dispatch cannot fall back to deployment streaming :49101'

$testLogger | Write-StructInfo -Msg 'contract assertions passed' -Data @{ assertions = 'isolated-seed-wrapper' }
