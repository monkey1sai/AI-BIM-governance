# scripts/tests/test-verify-all.ps1
# Verifies the canonical aggregate verifier's developer and pruned-deployment profiles.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$verifyScript = Join-Path $repoRoot 'scripts\verify-all.ps1'
. (Join-Path $PSScriptRoot 'test-helpers.ps1')
. (Join-Path $repoRoot 'scripts\lib\deploy-target-registry.ps1')

function Invoke-VerificationPlan {
    param(
        [Parameter(Mandatory = $true)][string] $Profile,
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string[]] $AdditionalArguments = @()
    )

    $output = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $verifyScript `
        -Profile $Profile -PlanOnly -RepoRoot $RepoRoot @AdditionalArguments 2>&1)
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output -join "`n")
    }
}

function Invoke-VerificationExecution {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string[]] $AdditionalArguments = @()
    )

    $output = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $verifyScript `
        -Profile 'Deployment' -RepoRoot $RepoRoot @AdditionalArguments 2>&1)
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output -join "`n")
    }
}

$sandbox = New-TestSandbox -Prefix 'verify-all-profile'
try {
    $developerPlan = Invoke-VerificationPlan -Profile 'Developer' -RepoRoot $repoRoot
    Assert-Equal 0 $developerPlan.ExitCode 'default developer profile plan is available'
    Assert-True ($developerPlan.Output -match '\[PLAN\] profile=developer') 'default profile identifies itself as developer'
    foreach ($target in @(
        'tests \(contracts\+fakes\)',
        'bim-review-coordinator',
        'web-viewer-sample',
        'bim-streaming-server'
    )) {
        Assert-True ($developerPlan.Output -match "\[EXECUTE\] $target") "developer profile retains complete target '$target'"
    }
    foreach ($policyGap in @(
        'bim-review-coordinator \[coordinator-lint\].*not_configured:tooling_absent',
        'bim-review-coordinator \[coordinator-changed-lines\].*not_configured:coverage_instrumentation_absent',
        'web-viewer-sample \[viewer-changed-lines\].*not_configured:coverage_instrumentation_absent'
    )) {
        Assert-True ($developerPlan.Output -match "\[OMIT\] $policyGap") "developer profile exposes policy gap '$policyGap'"
    }
    Assert-True ($developerPlan.Output -notmatch '\[EXECUTE\].*(coordinator-lint|coordinator-changed-lines|viewer-changed-lines)') 'not-configured policies never become no-op executions'

    foreach ($filter in @(
        @{ Arguments = @('-TsOnly'); Expected = @('bim-review-coordinator', 'web-viewer-sample'); Excluded = @('tests \(contracts\+fakes\)', 'bim-streaming-server') },
        @{ Arguments = @('-PyOnly'); Expected = @('tests \(contracts\+fakes\)'); Excluded = @('bim-review-coordinator', 'web-viewer-sample', 'bim-streaming-server') },
        @{ Arguments = @('-StreamingOnly'); Expected = @('bim-streaming-server'); Excluded = @('tests \(contracts\+fakes\)', 'bim-review-coordinator', 'web-viewer-sample') },
        @{ Arguments = @('-TsOnly', '-PyOnly'); Expected = @(); Excluded = @('tests \(contracts\+fakes\)', 'bim-review-coordinator', 'web-viewer-sample', 'bim-streaming-server') }
    )) {
        $filtered = Invoke-VerificationPlan -Profile 'Developer' -RepoRoot $repoRoot -AdditionalArguments $filter.Arguments
        Assert-Equal 0 $filtered.ExitCode "developer filter '$($filter.Arguments -join ' ')' exits zero"
        foreach ($target in $filter.Expected) {
            Assert-True ($filtered.Output -match "\[EXECUTE\] $target") "developer filter retains '$target'"
        }
        foreach ($target in $filter.Excluded) {
            Assert-True ($filtered.Output -notmatch "\[EXECUTE\] $target") "developer filter excludes '$target'"
        }
    }

    $jsonPlan = Invoke-VerificationPlan -Profile 'Developer' -RepoRoot $repoRoot -AdditionalArguments @('-Json')
    Assert-Equal 0 $jsonPlan.ExitCode 'PowerShell JSON plan exits zero'
    Assert-True ($jsonPlan.Output -notmatch '\[PLAN\]|\[EXECUTE\]') 'JSON plan contains no human log prefix'
    $jsonDocument = $jsonPlan.Output | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    $directJson = & (Get-Command node -ErrorAction Stop).Source `
        (Join-Path $repoRoot 'scripts\lib\verification-plan.mjs') `
        '--manifest' (Join-Path $repoRoot 'scripts\verification-manifest.json') `
        '--default-profile' 'developer'
    Assert-Equal 0 $LASTEXITCODE 'direct planner exits zero'
    $directDocument = $directJson | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    Assert-Equal ($directDocument | ConvertTo-Json -Depth 100 -Compress) `
        ($jsonDocument | ConvertTo-Json -Depth 100 -Compress) `
        'PowerShell and direct planner JSON are semantically identical'

    $affectedPlan = Invoke-VerificationPlan -Profile 'Developer' -RepoRoot $repoRoot `
        -AdditionalArguments @('-ChangedPath', 'governance-service/app.py')
    Assert-Equal 0 $affectedPlan.ExitCode 'affected-path plan exits zero'
    foreach ($target in @('tests \(contracts\+fakes\)', 'governance-service', 'secret pattern scan')) {
        Assert-True ($affectedPlan.Output -match "\[EXECUTE\] $target") "affected plan includes '$target'"
    }

    $unknownPlan = Invoke-VerificationPlan -Profile 'Developer' -RepoRoot $repoRoot `
        -AdditionalArguments @('-ChangedPath', 'new-unowned-service/file.xyz')
    Assert-Equal 2 $unknownPlan.ExitCode 'unknown path fails closed with planner exit two'
    Assert-True ($unknownPlan.Output -match 'unknown_path_fail_closed|fail_closed') 'unknown path reports a typed fail-closed reason'

    $deploymentRoot = Join-Path $sandbox 'pruned-deployment'
    foreach ($directory in @(
        'scripts',
        'docs\plans',
        'bim-review-coordinator',
        'web-viewer-sample',
        'bim-streaming-server\scripts\tests'
    )) {
        New-Item -ItemType Directory -Path (Join-Path $deploymentRoot $directory) -Force | Out-Null
    }
    'deploy entrypoint' | Set-Content -LiteralPath (Join-Path $deploymentRoot 'scripts\deploy.ps1') -Encoding ascii
    'retained production design token' | Set-Content -LiteralPath (Join-Path $deploymentRoot 'docs\plans\ai-bim-governance.css') -Encoding ascii
    'streaming contract entrypoint' | Set-Content -LiteralPath (Join-Path $deploymentRoot 'bim-streaming-server\scripts\tests\test-stage-loading-contract.ps1') -Encoding ascii
    & git -C $deploymentRoot init --quiet
    Assert-Equal 0 $LASTEXITCODE 'deployment fixture initializes a Git checkout'
    & git -C $deploymentRoot config user.name 'AI BIM Verification Fixture'
    & git -C $deploymentRoot config user.email 'fixture@example.invalid'
    & git -C $deploymentRoot add --all
    & git -C $deploymentRoot -c commit.gpgsign=false commit --quiet -m 'verification fixture'
    Assert-Equal 0 $LASTEXITCODE 'deployment fixture records an exact checkout revision'
    $deploymentRevision = (& git -C $deploymentRoot rev-parse HEAD).Trim()
    Assert-True ($deploymentRevision -match '^[0-9a-f]{40,64}$') 'deployment fixture exposes a full checkout revision'

    if ($IsWindows) {
        $localDeploymentPlan = Invoke-VerificationPlan -Profile 'Deployment' -RepoRoot $deploymentRoot
        Assert-Equal 0 $localDeploymentPlan.ExitCode 'default deployment profile still resolves the current platform target'
        Assert-True ($localDeploymentPlan.Output -match 'governance health — GET http://127\.0\.0\.1:49102/health') 'local Windows governance verification remains on loopback'
        Assert-True ($localDeploymentPlan.Output -match 'kit manager health — GET http://127\.0\.0\.1:8010/health') 'local Windows Kit Manager verification remains on loopback'
    }

    $inventoryPath = Join-Path $sandbox 'target.local.json'
    [pscustomobject]@{
        schema_version = 'deploy-target-private-inventory/v1'
        targets = @([pscustomobject]@{
            id = 'canonical-linux'
            connection = [pscustomobject]@{ host = 'deploy.example.invalid'; user = 'deploy-fixture' }
            deploy_root = '/srv/ai-bim/example-deploy'
            runtime_data_root = '/srv/ai-bim/example-runtime-data'
            public_host = '192.0.2.10'
            edge_site_id = 'site-example'
            host_native_bind_host = '192.0.2.1'
        })
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $inventoryPath -Encoding utf8

    $runtimeSignatureRoot = Join-Path $deploymentRoot 'scripts\.run'
    New-Item -ItemType Directory -Path $runtimeSignatureRoot -Force | Out-Null
    function Set-ValidDeploymentRuntimeSignatures {
        param([Parameter(Mandatory = $true)][string] $Root)

        [pscustomobject]@{
            bindHost = '127.0.0.1'
            port = 49101
            healthHost = '127.0.0.1'
            revision = $deploymentRevision
        } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $Root 'bim-streaming-conversion-service.params.json') -Encoding utf8
        [pscustomobject]@{
            host = '127.0.0.1'
            port = 8010
            kitControlUrl = ''
            revision = $deploymentRevision
        } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $Root 'kit-manager-api.params.json') -Encoding utf8
    }
    Set-ValidDeploymentRuntimeSignatures -Root $runtimeSignatureRoot

    $deploymentArguments = @('-TargetId', 'canonical-linux', '-InventoryPath', $inventoryPath)
    $deploymentPlan = Invoke-VerificationPlan -Profile 'Deployment' -RepoRoot $deploymentRoot `
        -AdditionalArguments $deploymentArguments
    Assert-Equal 0 $deploymentPlan.ExitCode 'deployment profile accepts the intentionally pruned fixture inventory'
    Assert-True ($deploymentPlan.Output -match '\[PLAN\] profile=deployment') 'deployment profile identifies itself explicitly'
    foreach ($target in @(
        'deployment required artifacts',
        'coordinator health',
        'governance health',
        'conversion health',
        'kit manager health',
        'viewer endpoint'
    )) {
        Assert-True ($deploymentPlan.Output -match "\[EXECUTE\] $target") "deployment profile executes retained target '$target'"
    }
    foreach ($target in @(
        'tests \(contracts\+fakes\)',
        'bim-review-coordinator \(full verify\)',
        'web-viewer-sample \(full verify\)',
        'bim-streaming-server stage-loading contract'
    )) {
        Assert-True ($deploymentPlan.Output -match "\[OMIT\] $target") "deployment profile explicitly records authoring-only omission '$target'"
    }
    foreach ($loopbackTarget in @(
        'coordinator health — GET http://127.0.0.1:8004/health',
        'viewer endpoint — GET http://127.0.0.1:5173/'
    )) {
        Assert-True ($deploymentPlan.Output -match [regex]::Escape($loopbackTarget)) "deployment profile keeps '$loopbackTarget' on loopback"
    }
    foreach ($hostNativeTarget in @(
        'governance health — GET http://<host-native-bind>:49102/health',
        'conversion health — GET http://<conversion-health>:49101/health',
        'kit manager health — GET http://<host-native-bind>:8010/health'
    )) {
        Assert-True ($deploymentPlan.Output -match [regex]::Escape($hostNativeTarget)) "deployment profile redacts '$hostNativeTarget' from private inventory"
    }
    Assert-True ($deploymentPlan.Output -notmatch '192\.0\.2\.1(?!\d)') 'deployment profile never publishes the private host-native bind address'
    Assert-True ($deploymentPlan.Output -notmatch 'governance health — GET http://127\.0\.0\.1:49102/health') 'governance verification never assumes loopback on canonical Linux'
    Assert-True ($deploymentPlan.Output -notmatch 'kit manager health — GET http://127\.0\.0\.1:8010/health') 'Kit Manager verification never assumes loopback on canonical Linux'
    $verifySource = Get-Content -LiteralPath $verifyScript -Raw
    foreach ($expectedKitManagerIdentity in @(
        "runtime_mode = 'hybrid-web-plane-host-native-kit'",
        'host_local_runtime_allowed = $true',
        "kit_instance_id = 'kit_local_001'",
        'kit_control_url = $expectedKitControlUrl'
    )) {
        Assert-True ($verifySource.Contains($expectedKitManagerIdentity)) "deployment verifier pins Kit Manager identity '$expectedKitManagerIdentity'"
    }
    Assert-True ($verifySource -match '\$actualValue -is \[bool\] -and \$actualValue -eq \$expectedValue') 'deployment verifier type-checks expected boolean identity values'
    Assert-True ($verifySource -match 'bim-streaming-conversion-service\.params\.json') 'deployment verifier consumes the effective conversion health host from the runtime signature'
    Assert-True ($verifySource -match 'kit-manager-api\.params\.json') 'deployment verifier consumes the effective Kit Manager control identity from the runtime signature'
    Assert-True ($verifySource -match 'Get-DeploymentCheckoutRevision') 'deployment verifier resolves the exact deployment checkout revision'
    Assert-True ($verifySource -match 'conversionRuntimeSignature\.revision -cne \$deploymentCheckoutRevision') 'deployment verifier rejects a conversion runtime from another revision'
    Assert-True ($verifySource -match 'kitManagerRuntimeSignature\.revision -cne \$deploymentCheckoutRevision') 'deployment verifier rejects a Kit Manager runtime from another revision'
    Assert-True ($verifySource -match 'kitControlUrl\)\.TrimEnd\(''\/''\)') 'deployment verifier compares the normalized child Kit control origin recorded by service settings'

    $verifyTokens = $null
    $verifyParseErrors = $null
    $verifyAst = [System.Management.Automation.Language.Parser]::ParseInput(
        $verifySource,
        [ref]$verifyTokens,
        [ref]$verifyParseErrors
    )
    Assert-Equal 0 @($verifyParseErrors).Count 'deployment verifier parses before HTTP identity execution tests'
    $httpEndpointFunctions = @($verifyAst.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -eq 'Test-DeploymentHttpEndpoint'
    }, $true))
    Assert-Equal 1 $httpEndpointFunctions.Count 'deployment verifier exposes exactly one HTTP identity function'
    . ([scriptblock]::Create($httpEndpointFunctions[0].Extent.Text))

    $script:deploymentHttpFixture = $null
    function Invoke-WebRequest {
        [CmdletBinding()]
        param(
            [Parameter(Mandatory = $true)][string] $Uri,
            [int] $TimeoutSec,
            [int] $MaximumRedirection,
            [switch] $NoProxy,
            [switch] $UseBasicParsing
        )
        if (-not [string]::IsNullOrWhiteSpace([string]$script:deploymentHttpFixture.ThrowMessage)) {
            throw [string]$script:deploymentHttpFixture.ThrowMessage
        }
        return [pscustomobject]@{
            StatusCode = [int]$script:deploymentHttpFixture.StatusCode
            Content = [string]$script:deploymentHttpFixture.Content
        }
    }

    $httpIdentityCases = @(
        @{
            Name = 'invalid JSON'
            Fixture = @{ StatusCode = 200; Content = 'not-json'; ThrowMessage = '' }
            ExpectedService = 'governance-service'
            ExpectedProperties = @{}
            ExpectedMessage = 'response was not valid JSON'
        },
        @{
            Name = 'non-ok status'
            Fixture = @{ StatusCode = 200; Content = '{"status":"degraded","service":"governance-service"}'; ThrowMessage = '' }
            ExpectedService = 'governance-service'
            ExpectedProperties = @{}
            ExpectedMessage = 'response status was not ok'
        },
        @{
            Name = 'wrong service identity'
            Fixture = @{ StatusCode = 200; Content = '{"status":"ok","service":"wrong-service"}'; ThrowMessage = '' }
            ExpectedService = 'governance-service'
            ExpectedProperties = @{}
            ExpectedMessage = 'response service identity did not match the expected role'
        },
        @{
            Name = 'mismatched Kit Manager identity'
            Fixture = @{
                StatusCode = 200
                Content = '{"status":"ok","runtime_mode":"hybrid-web-plane-host-native-kit","host_local_runtime_allowed":true,"kit_instance_id":"wrong-kit","kit_control_url":"http://localhost:49101"}'
                ThrowMessage = ''
            }
            ExpectedService = ''
            ExpectedProperties = @{
                runtime_mode = 'hybrid-web-plane-host-native-kit'
                host_local_runtime_allowed = $true
                kit_instance_id = 'kit_local_001'
                kit_control_url = 'http://localhost:49101'
            }
            ExpectedMessage = "response identity property 'kit_instance_id' did not match the expected value"
        }
    )
    foreach ($httpCase in $httpIdentityCases) {
        $script:deploymentHttpFixture = $httpCase.Fixture
        $httpFailure = ''
        try {
            Test-DeploymentHttpEndpoint -Name 'fixture health' -Uri 'http://127.0.0.1:49102/health' `
                -DisplayUri 'http://127.0.0.1:49102/health' -ExpectJson `
                -ExpectedService ([string]$httpCase.ExpectedService) `
                -ExpectedJsonProperties ([hashtable]$httpCase.ExpectedProperties)
        }
        catch {
            $httpFailure = $_.Exception.Message
        }
        Assert-True ($httpFailure -match [regex]::Escape([string]$httpCase.ExpectedMessage)) "deployment HTTP verifier rejects $($httpCase.Name)"
    }

    $privateHost = '192.0.2.123'
    $script:deploymentHttpFixture = @{
        StatusCode = 0
        Content = ''
        ThrowMessage = "connection to ${privateHost} refused"
    }
    $redactedFailure = ''
    try {
        Test-DeploymentHttpEndpoint -Name 'governance health' -Uri "http://${privateHost}:49102/health" `
            -DisplayUri 'http://<host-native-bind>:49102/health' -ExpectJson -ExpectedService 'governance-service'
    }
    catch {
        $redactedFailure = $_.Exception.Message
    }
    Assert-True ($redactedFailure -match [regex]::Escape('<host-native-bind>')) 'deployment HTTP failure uses the redacted display host'
    Assert-True (-not $redactedFailure.Contains($privateHost)) 'deployment HTTP failure never retains the private inventory host'
    Remove-Item Function:Invoke-WebRequest -Force
    Write-TestPass 'deployment HTTP JSON identity and redaction rejection matrix'

    $executionInventoryPath = Join-Path $sandbox 'execution-target.local.json'
    $executionDeployRoot = if ($IsWindows) { '/tmp/ai-bim-verify-execution-deploy' } else { $deploymentRoot }
    $executionRuntimeDataRoot = if ($IsWindows) {
        '/tmp/ai-bim-verify-execution-runtime'
    } else {
        Join-Path (Split-Path -Parent $deploymentRoot) 'execution-runtime-data'
    }
    [pscustomobject]@{
        schema_version = 'deploy-target-private-inventory/v1'
        targets = @([pscustomobject]@{
            id = 'canonical-linux'
            connection = [pscustomobject]@{ host = 'localhost'; user = 'deploy-fixture' }
            deploy_root = $executionDeployRoot
            runtime_data_root = $executionRuntimeDataRoot
            public_host = '127.0.0.2'
            edge_site_id = 'site-example'
            host_native_bind_host = '127.0.0.1'
        })
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $executionInventoryPath -Encoding utf8
    $validatedExecutionTarget = Get-DeployTarget -Id 'canonical-linux' -InventoryPath $executionInventoryPath
    Assert-Equal $executionDeployRoot ([string]$validatedExecutionTarget.deploy_root) 'execution fixture uses a valid canonical Linux deploy root'
    Assert-Equal $executionRuntimeDataRoot ([string]$validatedExecutionTarget.runtime_data_root) 'execution fixture keeps runtime data outside the deploy root'
    Assert-Equal '127.0.0.1' ([string]$validatedExecutionTarget.host_native_bind_host) 'execution fixture keeps the host-native bind address distinct from published endpoints'

    $executionArguments = @()
    if (-not $IsWindows) {
        $executionArguments = @('-InventoryPath', $executionInventoryPath)
    }

    $runtimeSignatureCases = @(
        @{
            Name = 'missing conversion signature'
            Expected = 'runtime signature is missing: bim-streaming-conversion-service\.params\.json'
            Mutate = { param($root) Remove-Item -LiteralPath (Join-Path $root 'bim-streaming-conversion-service.params.json') -Force }
        },
        @{
            Name = 'malformed conversion signature'
            Expected = 'runtime signature is invalid: bim-streaming-conversion-service\.params\.json'
            Mutate = { param($root) '{' | Set-Content -LiteralPath (Join-Path $root 'bim-streaming-conversion-service.params.json') -Encoding utf8 }
        },
        @{
            Name = 'wrong conversion port'
            Expected = 'conversion runtime signature has an unexpected port'
            Mutate = {
                param($root)
                [pscustomobject]@{ healthHost = '127.0.0.1'; port = 49102; revision = $deploymentRevision } |
                    ConvertTo-Json -Compress |
                    Set-Content -LiteralPath (Join-Path $root 'bim-streaming-conversion-service.params.json') -Encoding utf8
            }
        },
        @{
            Name = 'non-local conversion health host'
            Expected = 'not assigned to a local network interface'
            Mutate = {
                param($root)
                [pscustomobject]@{ healthHost = '192.0.2.99'; port = 49101; revision = $deploymentRevision } |
                    ConvertTo-Json -Compress |
                    Set-Content -LiteralPath (Join-Path $root 'bim-streaming-conversion-service.params.json') -Encoding utf8
            }
        },
        @{
            Name = 'wrong conversion revision'
            Expected = 'conversion runtime signature revision does not match the deployment checkout'
            Mutate = {
                param($root)
                [pscustomobject]@{ healthHost = '127.0.0.1'; port = 49101; revision = ('b' * 40) } |
                    ConvertTo-Json -Compress |
                    Set-Content -LiteralPath (Join-Path $root 'bim-streaming-conversion-service.params.json') -Encoding utf8
            }
        },
        @{
            Name = 'missing Kit Manager signature'
            Expected = 'runtime signature is missing: kit-manager-api\.params\.json'
            Mutate = { param($root) Remove-Item -LiteralPath (Join-Path $root 'kit-manager-api.params.json') -Force }
        },
        @{
            Name = 'malformed Kit Manager signature'
            Expected = 'runtime signature is invalid: kit-manager-api\.params\.json'
            Mutate = { param($root) '{' | Set-Content -LiteralPath (Join-Path $root 'kit-manager-api.params.json') -Encoding utf8 }
        },
        @{
            Name = 'wrong Kit Manager port'
            Expected = 'Kit Manager runtime signature has an unexpected port'
            Mutate = {
                param($root)
                [pscustomobject]@{ kitControlUrl = ''; port = 8011; revision = $deploymentRevision } |
                    ConvertTo-Json -Compress |
                    Set-Content -LiteralPath (Join-Path $root 'kit-manager-api.params.json') -Encoding utf8
            }
        },
        @{
            Name = 'wrong Kit Manager revision'
            Expected = 'Kit Manager runtime signature revision does not match the deployment checkout'
            Mutate = {
                param($root)
                [pscustomobject]@{ kitControlUrl = ''; port = 8010; revision = ('b' * 40) } |
                    ConvertTo-Json -Compress |
                    Set-Content -LiteralPath (Join-Path $root 'kit-manager-api.params.json') -Encoding utf8
            }
        }
    )
    foreach ($signatureCase in $runtimeSignatureCases) {
        Set-ValidDeploymentRuntimeSignatures -Root $runtimeSignatureRoot
        $mutateSignature = [scriptblock]$signatureCase.Mutate
        & $mutateSignature $runtimeSignatureRoot
        $executionResult = Invoke-VerificationExecution -RepoRoot $deploymentRoot -AdditionalArguments $executionArguments
        Assert-True ($executionResult.ExitCode -ne 0) "deployment execution rejects $($signatureCase.Name)"
        Assert-True ($executionResult.Output -match [string]$signatureCase.Expected) "deployment execution reports $($signatureCase.Name)"
    }
    Set-ValidDeploymentRuntimeSignatures -Root $runtimeSignatureRoot
    Write-TestPass 'deployment runtime signature rejection matrix'

    $verifyShell = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\verify-all.sh') -Raw
    Assert-True ($verifyShell -match '--profile') 'POSIX verifier mirror accepts an explicit deployment profile'
    Assert-True ($verifyShell -match '--plan-only') 'POSIX verifier mirror publishes the same profile inventory without executing it'
    Assert-True ($verifyShell -match '--target-id') 'POSIX verifier mirror accepts the deployment target selector'
    Assert-True ($verifyShell -match '--inventory-path') 'POSIX verifier mirror accepts the private inventory path selector'
    Assert-True ($verifyShell -match 'DEPLOYMENT_ARGS\+=\(-TargetId "\$TARGET_ID"\)') 'POSIX verifier mirror forwards the deployment target selector without eval'
    Assert-True ($verifyShell -match 'DEPLOYMENT_ARGS\+=\(-InventoryPath "\$INVENTORY_PATH"\)') 'POSIX verifier mirror forwards the private inventory path without eval'
    Assert-True ($verifyShell -match '--target-id requires a non-empty value') 'POSIX verifier rejects an explicitly empty target selector'
    Assert-True ($verifyShell -match '--inventory-path requires a non-empty value') 'POSIX verifier rejects an explicitly empty inventory selector'
    $bashPath = if ($IsWindows) {
        @(
            'C:\Program Files\Git\bin\bash.exe',
            'C:\Program Files\Git\usr\bin\bash.exe'
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
    else {
        (Get-Command bash -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    }
    if ([string]::IsNullOrWhiteSpace([string]$bashPath)) {
        throw 'POSIX verifier empty-selector regressions require bash'
    }
    $verifyShellPath = Join-Path $repoRoot 'scripts\verify-all.sh'
    $emptySelectorCases = @(
        @{ Name = 'target spaced'; Arguments = @('--profile', 'Deployment', '--plan-only', '--target-id', ''); Expected = '--target-id requires a non-empty value' },
        @{ Name = 'target equals'; Arguments = @('--profile', 'Deployment', '--plan-only', '--target-id='); Expected = '--target-id requires a non-empty value' },
        @{ Name = 'inventory spaced'; Arguments = @('--profile', 'Deployment', '--plan-only', '--inventory-path', ''); Expected = '--inventory-path requires a non-empty value' },
        @{ Name = 'inventory equals'; Arguments = @('--profile', 'Deployment', '--plan-only', '--inventory-path='); Expected = '--inventory-path requires a non-empty value' }
    )
    foreach ($emptySelectorCase in $emptySelectorCases) {
        $caseArguments = [string[]]$emptySelectorCase.Arguments
        $caseOutput = @(& $bashPath $verifyShellPath @caseArguments 2>&1)
        $caseExitCode = $LASTEXITCODE
        Assert-Equal 2 $caseExitCode "POSIX verifier rejects $($emptySelectorCase.Name) empty selector"
        Assert-True (($caseOutput -join [Environment]::NewLine) -match [regex]::Escape([string]$emptySelectorCase.Expected)) "POSIX verifier reports $($emptySelectorCase.Name) empty selector"
    }
    Assert-True ($verifyShell -match 'verification-runner\.mjs') 'POSIX verifier consumes the shared manifest runner'
    Assert-True ($verifyShell -notmatch '\beval\b') 'POSIX verifier never reconstructs manifest argv through eval'
    Assert-True ($verifyShell -match '\[ -n "\$SUBJECT" \] \|\| \[ -n "\$OUTCOME_OUT" \]') 'POSIX Deployment adapter rejects execution-outcome arguments it cannot forward'

    $runnerSource = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\lib\verification-runner.mjs') -Raw
    Assert-True ($runnerSource -match 'shell:\s*false') 'shared runner executes argv without a shell'

    Remove-Item -LiteralPath (Join-Path $deploymentRoot 'docs\plans\ai-bim-governance.css') -Force
    $missingArtifactPlan = Invoke-VerificationPlan -Profile 'Deployment' -RepoRoot $deploymentRoot `
        -AdditionalArguments $deploymentArguments
    Assert-True ($missingArtifactPlan.ExitCode -ne 0) 'deployment profile fails when a production-required retained artifact is missing'
    Assert-True ($missingArtifactPlan.Output -match 'deployment required artifact missing') 'deployment profile reports the missing production-required artifact'

    Write-TestPass 'verify-all profiles'
} catch {
    Write-TestFail 'verify-all profiles' $_.Exception.Message
    throw
} finally {
    Remove-TestSandbox -Path $sandbox
}

exit 0
