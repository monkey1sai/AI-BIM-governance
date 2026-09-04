[CmdletBinding()]
param(
    [switch] $StreamingOnly,
    [switch] $TsOnly,
    [switch] $PyOnly,
    [switch] $ContinueOnError,
    [Alias('Profile')][ValidateSet('Developer', 'Deployment')][string] $VerifyProfile = 'Developer',
    [switch] $PlanOnly,
    [switch] $Json,
    [string[]] $ChangedPath = @(),
    [string] $BaseRef = '',
    [ValidateSet('', 'quick', 'pr', 'full')][string] $Tier = '',
    [switch] $Full,
    [ValidatePattern('^[0-9a-f]{40}$')][string] $Subject,
    [string] $OutcomeOut,
    [string] $TargetId = '',
    [string] $InventoryPath = '',
    [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

# 跨 repo verify 入口。Developer profile 依序跑完整開發 contract；
# Deployment profile 只驗證 canonical pruning contract 保留的 artifact 與已部署 runtime。

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$Python = Join-Path $RepoRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $Python)) { $Python = 'python' }
$PowerShell = (Get-Process -Id $PID -ErrorAction SilentlyContinue).Path
if ([string]::IsNullOrWhiteSpace($PowerShell) -or -not (Test-Path $PowerShell)) {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
        $PowerShell = $pwsh.Source
    }
    else {
        $PowerShell = 'powershell.exe'
    }
}

function Test-DeploymentRequiredArtifacts {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string[]] $RequiredRelativePaths
    )

    $missing = @(
        foreach ($relativePath in $RequiredRelativePaths) {
            if (-not (Test-Path -LiteralPath (Join-Path $Root $relativePath) -PathType Leaf)) {
                $relativePath
            }
        }
    )
    if ($missing.Count -gt 0) {
        throw "deployment required artifact missing: $($missing -join ', ')"
    }
}

function Test-DeploymentHttpEndpoint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Uri,
        [Parameter(Mandatory = $true)][string] $DisplayUri,
        [string] $ExpectedService = '',
        [string[]] $RequiredJsonProperties = @(),
        [hashtable] $ExpectedJsonProperties = @{},
        [switch] $ExpectJson
    )

    try {
        $webRequest = Get-Command Invoke-WebRequest -ErrorAction Stop
        if (-not $webRequest.Parameters.ContainsKey('NoProxy')) {
            throw 'PowerShell 7 Invoke-WebRequest with NoProxy support is required.'
        }
        $requestParameters = @{
            Uri = $Uri
            TimeoutSec = 10
            MaximumRedirection = 0
            NoProxy = $true
            ErrorAction = 'Stop'
        }
        if ($webRequest.Parameters.ContainsKey('UseBasicParsing')) {
            $requestParameters.UseBasicParsing = $true
        }
        $response = Invoke-WebRequest @requestParameters
        if ($response.StatusCode -ne 200) {
            throw "unexpected HTTP status $($response.StatusCode)"
        }
        if ($ExpectJson) {
            try { $body = $response.Content | ConvertFrom-Json -ErrorAction Stop }
            catch { throw 'response was not valid JSON' }
            if ([string]$body.status -cne 'ok') {
                throw 'response status was not ok'
            }
            if (-not [string]::IsNullOrWhiteSpace($ExpectedService) -and [string]$body.service -cne $ExpectedService) {
                throw 'response service identity did not match the expected role'
            }
            foreach ($propertyName in $RequiredJsonProperties) {
                if ($null -eq $body.PSObject.Properties[$propertyName]) {
                    throw "response was missing required identity property '$propertyName'"
                }
            }
            foreach ($propertyName in $ExpectedJsonProperties.Keys) {
                if ($null -eq $body.PSObject.Properties[$propertyName]) {
                    throw "response was missing expected identity property '$propertyName'"
                }
                $actualValue = $body.PSObject.Properties[$propertyName].Value
                $expectedValue = $ExpectedJsonProperties[$propertyName]
                $propertyMatches = if ($expectedValue -is [bool]) {
                    $actualValue -is [bool] -and $actualValue -eq $expectedValue
                }
                else {
                    [string]$actualValue -ceq [string]$expectedValue
                }
                if (-not $propertyMatches) {
                    throw "response identity property '$propertyName' did not match the expected value"
                }
            }
        }
    } catch {
        $safeMessage = [string]$_.Exception.Message
        if ($DisplayUri -cne $Uri) {
            $actualHost = ([uri]$Uri).Host
            $safeMessage = $safeMessage -replace [regex]::Escape($actualHost), '<host-native-bind>'
        }
        throw "deployment $Name check failed at ${DisplayUri}: $safeMessage"
    }
}

function Get-DeploymentRuntimeSignature {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string] $FileName,
        [Parameter(Mandatory = $true)][string[]] $RequiredProperties,
        [switch] $AllowMissing
    )

    $path = Join-Path $Root ("scripts\.run\{0}" -f $FileName)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        if ($AllowMissing) { return $null }
        throw "deployment runtime signature is missing: $FileName"
    }
    try {
        $signature = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "deployment runtime signature is invalid: $FileName"
    }
    foreach ($propertyName in $RequiredProperties) {
        if ($null -eq $signature.PSObject.Properties[$propertyName]) {
            throw "deployment runtime signature '$FileName' is missing property '$propertyName'"
        }
    }
    return $signature
}

function Get-DeploymentCheckoutRevision {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Root)

    $revisionOutput = @(& git -C $Root rev-parse --verify HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or $revisionOutput.Count -ne 1) {
        throw 'deployment checkout revision is unavailable.'
    }
    $revision = ([string]$revisionOutput[0]).Trim().ToLowerInvariant()
    if ($revision -notmatch '^[0-9a-f]{40,64}$') {
        throw 'deployment checkout revision is invalid.'
    }
    return $revision
}

function New-DeploymentHealthTarget {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Uri,
        [string] $DisplayUri = $Uri,
        [string] $ExpectedService = '',
        [string[]] $RequiredJsonProperties = @(),
        [hashtable] $ExpectedJsonProperties = @{},
        [switch] $ExpectJson
    )

    return @{
        Name = $Name
        Cwd = '.'
        Required = $true
        Detail = "GET $DisplayUri"
        Action = {
            Test-DeploymentHttpEndpoint -Name $Name -Uri $Uri -DisplayUri $DisplayUri `
                -ExpectedService $ExpectedService -RequiredJsonProperties $RequiredJsonProperties `
                -ExpectedJsonProperties $ExpectedJsonProperties -ExpectJson:$ExpectJson
        }.GetNewClosure()
    }
}

function ConvertTo-DeploymentUriHost {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $HostName)

    $address = $null
    if ([Net.IPAddress]::TryParse($HostName, [ref]$address) -and
        $address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) {
        return "[$HostName]"
    }
    return $HostName
}

function Assert-DeploymentHostNativeBindIsLocal {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $HostName)

    $expectedAddress = $null
    if (-not [Net.IPAddress]::TryParse($HostName, [ref]$expectedAddress)) {
        throw 'Deployment host_native_bind_host must resolve to an IP address.'
    }
    if ([Net.IPAddress]::IsLoopback($expectedAddress)) { return }

    $localAddresses = @(
        [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
            ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
            ForEach-Object { $_.Address }
    )
    if (@($localAddresses | Where-Object { $_.Equals($expectedAddress) }).Count -eq 0) {
        throw 'Deployment host_native_bind_host is not assigned to a local network interface.'
    }
}

function Assert-DeploymentKitControlUrlIsLocal {
    # SEC-004: the recorded Kit control origin was compared against the /health
    # payload and nothing else. Port and revision equality only prove checkout
    # identity, so a REMOTE origin agreed between a drifted signature and a
    # drifted service passed silently. The canonical launcher refuses remote
    # targets, but this verifier is deliberately an independent layer: it
    # re-implements the launcher's rule (Resolve-HostNativeKitControlUrl) rather
    # than importing the mechanism it is supposed to check, exactly as
    # Assert-DeploymentHostNativeBindIsLocal re-implements
    # Test-HostNativeLocalAddress.
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $Url)

    # Empty is the honest unconfigured/blocked runtime-control state.
    if ([string]::IsNullOrWhiteSpace($Url)) { return }

    $controlUri = $null
    if (-not [uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$controlUri) -or
        $controlUri.Scheme -ne 'http' -or
        [string]::IsNullOrWhiteSpace($controlUri.Host) -or
        -not [string]::IsNullOrWhiteSpace($controlUri.UserInfo) -or
        -not [string]::IsNullOrWhiteSpace($controlUri.Query) -or
        -not [string]::IsNullOrWhiteSpace($controlUri.Fragment) -or
        -not ($controlUri.AbsolutePath -eq '' -or $controlUri.AbsolutePath -eq '/')) {
        throw 'Deployment Kit control URL must be an origin-only absolute HTTP URL without credentials, path, query, or fragment.'
    }

    $normalizedHost = $controlUri.Host.Trim().Trim([char[]]'[]').ToLowerInvariant()
    # localhost MUST be accepted: the launcher canonicalises
    # http://localhost:49101 through, so rejecting it here would make the
    # verifier contradict the mechanism it verifies.
    if ($normalizedHost -eq 'localhost') { return }

    $controlAddress = $null
    if (-not [Net.IPAddress]::TryParse($normalizedHost, [ref]$controlAddress)) {
        # No DNS resolution: a DNS answer is not proof that the control authority
        # is bound to this host, and resolving here would accept rebinding.
        throw 'Deployment Kit control URL host must be loopback or an address assigned to this host.'
    }
    if ([Net.IPAddress]::IsLoopback($controlAddress)) { return }

    $localAddresses = @(
        [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
            ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
            ForEach-Object { $_.Address }
    )
    if (@($localAddresses | Where-Object { $_.Equals($controlAddress) }).Count -eq 0) {
        throw 'Deployment Kit control URL host must be loopback or an address assigned to this host.'
    }
}

if ($VerifyProfile -eq 'Deployment' -and ($StreamingOnly -or $TsOnly -or $PyOnly)) {
    throw 'Deployment profile does not accept StreamingOnly, TsOnly, or PyOnly filters.'
}
if ($VerifyProfile -eq 'Developer' -and
    (-not [string]::IsNullOrWhiteSpace($TargetId) -or -not [string]::IsNullOrWhiteSpace($InventoryPath))) {
    throw 'TargetId and InventoryPath are supported only by the Deployment profile.'
}
if ($VerifyProfile -eq 'Deployment' -and -not $PlanOnly -and -not [string]::IsNullOrWhiteSpace($TargetId)) {
    throw 'TargetId is supported only with PlanOnly; executing Deployment verification resolves the current platform and RepoRoot.'
}

function Invoke-VerificationPlannerProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $NodePath,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $NodePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    foreach ($argument in $Arguments) { [void]$startInfo.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw 'Verification planner process could not be started.' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
            throw 'Verification planner process timed out.'
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        if ($stdout.Length + $stderr.Length -gt 4194304) {
            throw 'Verification planner output exceeded the size limit.'
        }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
    } finally {
        $process.Dispose()
    }
}
if ($Json -and -not $PlanOnly) {
    throw 'Json output is supported only with PlanOnly.'
}
# A tiered run executes a subset of the plan and is therefore never commit-bound evidence.
if (-not [string]::IsNullOrWhiteSpace($Tier) -and -not [string]::IsNullOrWhiteSpace($OutcomeOut)) {
    throw 'Tier cannot be combined with OutcomeOut: a tiered run is not verification evidence.'
}
if (-not [string]::IsNullOrWhiteSpace($OutcomeOut) -and ($PlanOnly -or $Json -or [string]::IsNullOrWhiteSpace($Subject))) {
    throw 'OutcomeOut requires an executing Developer run and a full lowercase Subject commit.'
}
if ($VerifyProfile -eq 'Deployment' -and ($Json -or $ChangedPath.Count -gt 0 -or $Full -or
    -not [string]::IsNullOrWhiteSpace($BaseRef) -or -not [string]::IsNullOrWhiteSpace($Tier) -or
    -not [string]::IsNullOrWhiteSpace($Subject) -or -not [string]::IsNullOrWhiteSpace($OutcomeOut))) {
    throw 'Deployment is a legacy_profile_not_migrated adapter and does not accept Json, ChangedPath, BaseRef, Tier, Full, Subject, or OutcomeOut.'
}
if (($ChangedPath.Count -gt 0 -or $Full -or -not [string]::IsNullOrWhiteSpace($BaseRef)) -and ($StreamingOnly -or $TsOnly -or $PyOnly)) {
    throw 'ChangedPath/BaseRef/Full dispatch cannot be combined with legacy Developer filters.'
}

# -BaseRef <ref>: derive changed paths with the exact command CI runs (ci.yml changes job),
# so the local plan and the CI plan are computed from identical input.
$derivedBaseSha = ''
if (-not [string]::IsNullOrWhiteSpace($BaseRef)) {
    if ($ChangedPath.Count -gt 0 -or $Full) {
        throw 'BaseRef cannot be combined with ChangedPath or Full.'
    }
    $git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $git) { throw 'Git is required to derive changed paths from BaseRef.' }
    $resolved = @(& $git.Source -C $RepoRoot --no-optional-locks rev-parse --verify --quiet "$BaseRef^{commit}" 2>$null)
    $derivedBaseSha = [string]($resolved -join '')
    if ($LASTEXITCODE -ne 0 -or $derivedBaseSha -notmatch '^[0-9a-f]{40}$') {
        throw "BaseRef does not resolve to a commit: $BaseRef"
    }
    $previousEncoding = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $rawDiff = @(& $git.Source -C $RepoRoot -c core.quotepath=false --no-optional-locks diff --no-renames --name-only -z "$derivedBaseSha...HEAD")
        $diffExitCode = $LASTEXITCODE
    }
    finally {
        [Console]::OutputEncoding = $previousEncoding
    }
    if ($diffExitCode -ne 0) { throw "BaseRef diff failed for $BaseRef...HEAD" }
    $ChangedPath = @(([string]($rawDiff -join '')).Split([char]0, [System.StringSplitOptions]::RemoveEmptyEntries))
    if ($ChangedPath.Count -eq 0) {
        throw "BaseRef $BaseRef produced no changed paths relative to HEAD; nothing to verify."
    }
}

$Targets = @()
$OmittedTargets = @()
$publishInventory = $PlanOnly -or $VerifyProfile -eq 'Deployment'

if ($VerifyProfile -eq 'Deployment') {
    # The deployment checkout intentionally prunes authoring/tooling scripts;
    # load the verifier's contract from this canonical script directory.
    . (Join-Path $PSScriptRoot 'lib\rebuild-test-deploy.ps1')
    . (Join-Path $PSScriptRoot 'lib\deploy-target-registry.ps1')
    $pruningContract = Get-TestDeployPruningContract
    $requiredArtifacts = @('scripts\deploy.ps1') + @($pruningContract.PreservedProductionFiles)
    Test-DeploymentRequiredArtifacts -Root $RepoRoot -RequiredRelativePaths $requiredArtifacts
    $deploymentCheckoutRevision = Get-DeploymentCheckoutRevision -Root $RepoRoot

    $deploymentTarget = if (-not [string]::IsNullOrWhiteSpace($TargetId)) {
        Get-DeployTarget -Id $TargetId -InventoryPath $InventoryPath
    }
    else {
        Get-DeployTargetForCurrentPlatform -RepoRoot $RepoRoot -InventoryPath $InventoryPath
    }
    $hostNativeUriHost = ConvertTo-DeploymentUriHost -HostName ([string]$deploymentTarget.host_native_bind_host)
    $privateTarget = Test-DeployTargetPrivateInventoryRequired -Target $deploymentTarget
    $hostNativeDisplayHost = if ($privateTarget) { '<host-native-bind>' } else { $hostNativeUriHost }
    $conversionRuntimeSignature = Get-DeploymentRuntimeSignature `
        -Root $RepoRoot `
        -FileName 'bim-streaming-conversion-service.params.json' `
        -RequiredProperties @('healthHost', 'port', 'revision') `
        -AllowMissing:$PlanOnly
    $conversionHealthHost = if ($null -ne $conversionRuntimeSignature) {
        [string]$conversionRuntimeSignature.healthHost
    }
    else {
        '127.0.0.1'
    }
    if ($null -ne $conversionRuntimeSignature -and [int]$conversionRuntimeSignature.port -ne 49101) {
        throw 'deployment conversion runtime signature has an unexpected port.'
    }
    if ($null -ne $conversionRuntimeSignature -and [string]$conversionRuntimeSignature.revision -cne $deploymentCheckoutRevision) {
        throw 'deployment conversion runtime signature revision does not match the deployment checkout.'
    }
    $conversionUriHost = ConvertTo-DeploymentUriHost -HostName $conversionHealthHost
    $conversionDisplayHost = if ($privateTarget) { '<conversion-health>' } else { $conversionUriHost }
    $kitManagerRuntimeSignature = Get-DeploymentRuntimeSignature `
        -Root $RepoRoot `
        -FileName 'kit-manager-api.params.json' `
        -RequiredProperties @('kitControlUrl', 'port', 'revision') `
        -AllowMissing:$PlanOnly
    if ($null -ne $kitManagerRuntimeSignature -and [int]$kitManagerRuntimeSignature.port -ne 8010) {
        throw 'deployment Kit Manager runtime signature has an unexpected port.'
    }
    if ($null -ne $kitManagerRuntimeSignature -and [string]$kitManagerRuntimeSignature.revision -cne $deploymentCheckoutRevision) {
        throw 'deployment Kit Manager runtime signature revision does not match the deployment checkout.'
    }
    $expectedKitControlUrl = if ($null -ne $kitManagerRuntimeSignature) {
        ([string]$kitManagerRuntimeSignature.kitControlUrl).TrimEnd('/')
    }
    else {
        ''
    }
    if (-not $PlanOnly) {
        Assert-DeploymentHostNativeBindIsLocal -HostName ([string]$deploymentTarget.host_native_bind_host)
        Assert-DeploymentHostNativeBindIsLocal -HostName $conversionHealthHost
        Assert-DeploymentKitControlUrlIsLocal -Url $expectedKitControlUrl
    }

    $Targets += @{
        Name = 'deployment required artifacts'
        Cwd = '.'
        Required = $true
        Detail = ($requiredArtifacts -join ', ')
        Action = {
            Test-DeploymentRequiredArtifacts -Root $RepoRoot -RequiredRelativePaths $requiredArtifacts
        }.GetNewClosure()
    }
    $Targets += New-DeploymentHealthTarget -Name 'coordinator health' -Uri 'http://127.0.0.1:8004/health' `
        -ExpectJson -ExpectedService 'bim-review-coordinator'
    $Targets += New-DeploymentHealthTarget -Name 'governance health' -Uri "http://${hostNativeUriHost}:49102/health" `
        -DisplayUri "http://${hostNativeDisplayHost}:49102/health" -ExpectJson -ExpectedService 'governance-service'
    $Targets += New-DeploymentHealthTarget -Name 'conversion health' -Uri "http://${conversionUriHost}:49101/health" `
        -DisplayUri "http://${conversionDisplayHost}:49101/health" -ExpectJson -ExpectedService 'host-native-conversion-authority'
    $Targets += New-DeploymentHealthTarget -Name 'kit manager health' -Uri "http://${hostNativeUriHost}:8010/health" `
        -DisplayUri "http://${hostNativeDisplayHost}:8010/health" -ExpectJson -ExpectedJsonProperties @{
            runtime_mode = 'hybrid-web-plane-host-native-kit'
            host_local_runtime_allowed = $true
            kit_instance_id = 'kit_local_001'
            kit_control_url = $expectedKitControlUrl
        }
    $Targets += New-DeploymentHealthTarget -Name 'viewer endpoint' -Uri 'http://127.0.0.1:5173/'
    $OmittedTargets += @(
        @{ Name = 'tests (contracts+fakes)'; Reason = 'authoring contracts are intentionally pruned from deployment checkout' },
        @{ Name = 'bim-review-coordinator (full verify)'; Reason = 'developer suite requires root contract fixtures outside deployment profile' },
        @{ Name = 'web-viewer-sample (full verify)'; Reason = 'developer suite requires authoring fixtures and host dependencies absent after canonical cleanup' },
        @{ Name = 'bim-streaming-server stage-loading contract'; Reason = 'source-level contract suite is retained for developer and CI profiles, not deployed runtime verification' }
    )
}
else {
    $manifestPath = Join-Path $RepoRoot 'scripts\verification-manifest.json'
    $plannerPath = Join-Path $RepoRoot 'scripts\lib\verification-plan.mjs'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $plannerPath -PathType Leaf)) {
        throw 'Developer verification manifest or planner is missing.'
    }
    $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $node) { throw 'Node.js is required to read the verification manifest.' }

    $plannerArgs = @($plannerPath, '--manifest', $manifestPath)
    if ($ChangedPath.Count -gt 0 -or $Full) {
        foreach ($path in $ChangedPath) { $plannerArgs += @('--path', $path) }
        if ($Full) { $plannerArgs += '--full' }
        if (-not [string]::IsNullOrWhiteSpace($derivedBaseSha)) { $plannerArgs += @('--base', $derivedBaseSha) }
    }
    else {
        $developerProfile = if ($StreamingOnly) {
            'developer-streaming'
        } elseif ($TsOnly -and $PyOnly) {
            'developer-none'
        } elseif ($TsOnly) {
            'developer-ts'
        } elseif ($PyOnly) {
            'developer-py'
        } else {
            'developer'
        }
        $plannerArgs += @('--default-profile', $developerProfile)
    }

    if (-not [string]::IsNullOrWhiteSpace($OutcomeOut)) {
        $runnerPath = Join-Path $RepoRoot 'scripts\lib\verification-runner.mjs'
        if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) { throw 'Developer verification runner is missing.' }
        $runnerArgs = @($runnerPath, '--repo-root', $RepoRoot) + @($plannerArgs | Select-Object -Skip 1) + @('--subject', $Subject, '--outcome-out', $OutcomeOut)
        if ($ContinueOnError) { $runnerArgs += '--continue-on-error' }
        & $node.Source @runnerArgs
        exit $LASTEXITCODE
    }

    $plannerResult = Invoke-VerificationPlannerProcess -NodePath $node.Source `
        -Arguments $plannerArgs -WorkingDirectory $RepoRoot
    $plannerExitCode = $plannerResult.ExitCode
    $planJson = $plannerResult.Stdout.TrimEnd("`r", "`n")
    if ([string]::IsNullOrWhiteSpace($planJson)) {
        throw 'Verification planner returned no JSON document.'
    }
    if ($Json) {
        [Console]::Out.WriteLine($planJson)
        exit $plannerExitCode
    }
    try {
        $PlanDocument = $planJson | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    } catch {
        throw 'Verification planner returned invalid JSON.'
    }
    if ($plannerExitCode -ne 0) {
        Write-Host "[FAIL] planner result=$($PlanDocument.result) — unknown_paths=$(@($PlanDocument.unknown_paths) -join ',')" -ForegroundColor Red
        foreach ($errorItem in @($PlanDocument.errors)) {
            Write-Host "[FAIL] planner $($errorItem.code) — $($errorItem.message)" -ForegroundColor Red
        }
        exit $plannerExitCode
    }

    # Optional local tier selection over the canonical plan (sidecar scripts/verification-tier-policy.json;
    # CI never reads it). A dispatch=full plan (self-change of the verification mechanism) forces full.
    $tierAllowedClasses = $null
    $TierEffective = ''
    if (-not [string]::IsNullOrWhiteSpace($Tier)) {
        $tierPolicyPath = Join-Path $RepoRoot 'scripts\verification-tier-policy.json'
        if (-not (Test-Path -LiteralPath $tierPolicyPath -PathType Leaf)) { throw 'Verification tier policy is missing.' }
        $tierPolicy = Get-Content -LiteralPath $tierPolicyPath -Raw | ConvertFrom-Json -Depth 20 -ErrorAction Stop
        if ($tierPolicy.schema_version -ne 'verification-tier-policy/v1' -or $tierPolicy.authority -ne 'local_selection_only' -or $tierPolicy.tiered_run_is_evidence -ne $false) {
            throw 'Verification tier policy is not the expected local-selection-only v1 document.'
        }
        $TierEffective = if ($tierPolicy.full_when_dispatch_full -and $PlanDocument.dispatch -eq 'full') { 'full' } else { $Tier }
        $tierAllowedClasses = @($tierPolicy.tiers.$TierEffective.evidence_classes | ForEach-Object { [string]$_ })
    }

    foreach ($plannedTarget in @($PlanDocument.targets | Where-Object { $_.required })) {
        $plannedGates = @($plannedTarget.gates)
        foreach ($gate in $plannedGates) {
            if (-not $gate.configured) {
                $omittedName = [string]$plannedTarget.display_name
                if ($plannedGates.Count -gt 1) { $omittedName = "$omittedName [$($gate.id)]" }
                $OmittedTargets += @{ Name = $omittedName; Reason = "not_configured:$($gate.not_configured_reason)" }
                continue
            }
            if ($null -ne $tierAllowedClasses) {
                $gateClass = [string]$gate.evidence_class
                # Unknown class fails closed by RUNNING the gate, never by silently skipping it.
                if ($gateClass -in @('fast', 'contract', 'slow', 'security') -and $gateClass -notin $tierAllowedClasses) {
                    $omittedName = [string]$plannedTarget.display_name
                    if ($plannedGates.Count -gt 1) { $omittedName = "$omittedName [$($gate.id)]" }
                    $OmittedTargets += @{ Name = $omittedName; Reason = "tier_deselected:$gateClass" }
                    continue
                }
            }
            $command = switch ([string]$gate.command.executable) {
                'python' { $Python }
                'pwsh' { $PowerShell }
                default { [string]$gate.command.executable }
            }
            $name = [string]$plannedTarget.display_name
            if ($plannedGates.Count -gt 1) { $name = "$name [$($gate.id)]" }
            $Targets += @{
                Name = $name
                Cmd = $command
                Args = @($gate.command.args | ForEach-Object { [string]$_ })
                Cwd = [string]$gate.cwd
                Required = $PlanDocument.dispatch -ne 'profile'
                Reason = [string]$plannedTarget.reason
            }
        }
    }
}

if ($publishInventory) {
    if ($VerifyProfile -eq 'Developer' -and $null -ne $PlanDocument -and $PlanDocument.dispatch -ne 'profile') {
        Write-Host "[PLAN] dispatch=$($PlanDocument.dispatch) result=$($PlanDocument.result)" -ForegroundColor Cyan
    }
    if (-not [string]::IsNullOrWhiteSpace($Tier)) {
        if ($TierEffective -ne $Tier) { Write-Host "[TIER] requested=$Tier effective=$TierEffective — plan_dispatch_full_self_change" -ForegroundColor Cyan }
        else { Write-Host "[TIER] $TierEffective (not evidence)" -ForegroundColor Cyan }
    }
    else {
        Write-Host "[PLAN] profile=$($VerifyProfile.ToLowerInvariant())" -ForegroundColor Cyan
    }
    foreach ($target in $Targets) {
        $detail = if ($target.ContainsKey('Detail')) { $target.Detail } else { "$($target.Cmd) $($target.Args -join ' ')" }
        Write-Host "[EXECUTE] $($target.Name) — $detail"
    }
    foreach ($omitted in $OmittedTargets) {
        Write-Host "[OMIT] $($omitted.Name) — $($omitted.Reason)" -ForegroundColor Yellow
    }
    if ($PlanOnly) { exit 0 }
}

$Failures = @()
$Passed = @()

foreach ($t in $Targets) {
    $cwd = Join-Path $RepoRoot $t.Cwd
    if (-not (Test-Path $cwd)) {
        if ($t.Required) {
            $Failures += $t.Name
            Write-Host "[FAIL] $($t.Name) — required directory not found at $cwd" -ForegroundColor Red
            if (-not $ContinueOnError) { break }
        }
        else {
            Write-Host "[SKIP] $($t.Name) — directory not found at $cwd" -ForegroundColor Yellow
        }
        continue
    }
    $detail = if ($t.ContainsKey('Detail')) { $t.Detail } else { "$($t.Cmd) $($t.Args -join ' ')" }
    Write-Host "`n==> [$($t.Name)] $detail" -ForegroundColor Cyan
    Push-Location $cwd
    try {
        if ($t.ContainsKey('Action')) {
            & $t.Action
            $code = 0
        }
        else {
            & $t.Cmd @($t.Args)
            $code = $LASTEXITCODE
        }
    } catch {
        Write-Host "  exception: $_" -ForegroundColor Red
        $code = 1
    } finally {
        Pop-Location
    }
    if ($code -ne 0) {
        $Failures += $t.Name
        Write-Host "[FAIL] $($t.Name) (exit $code)" -ForegroundColor Red
        if (-not $ContinueOnError) { break }
    } else {
        $Passed += $t.Name
        Write-Host "[OK]   $($t.Name)" -ForegroundColor Green
    }
}

Write-Host "`n======================================"
Write-Host "Passed:  $($Passed -join ', ')"
Write-Host "Failed:  $($Failures -join ', ')"
Write-Host '======================================'

if ($Failures.Count -gt 0) { exit 1 } else { exit 0 }
