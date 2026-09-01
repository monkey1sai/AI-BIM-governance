Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$deployPath = Join-Path $RepoRoot 'scripts\deploy.ps1'
. (Join-Path $RepoRoot 'scripts\lib\platform\platform-adapter.ps1')
$deployBytes = [System.IO.File]::ReadAllBytes($deployPath)
if ($deployBytes.Count -lt 3 -or $deployBytes[0] -ne 0xEF -or $deployBytes[1] -ne 0xBB -or $deployBytes[2] -ne 0xBF) {
    throw 'deploy.ps1 must use a UTF-8 BOM so Windows PowerShell 5.1 does not decode non-ASCII strings through the active ANSI code page'
}
$deploy = Get-Content -Raw $deployPath
$launcher = Get-Content -Raw (Join-Path $RepoRoot 'scripts\lib\host-native-launcher.ps1')
$cadHardener = Get-Content -Raw (Join-Path $RepoRoot 'bim-streaming-server\scripts\harden-cad-extension-cache.py')
$cadAclLibrary = Get-Content -Raw (Join-Path $RepoRoot 'scripts\lib\cad-extension-cache-acl.ps1')
$kitGateway = Get-Content -Raw (Join-Path $RepoRoot 'services\kit-manager-api\app\kit_gateway.py')
$stopAll = Get-Content -Raw (Join-Path $RepoRoot 'scripts\stop-all.ps1')
$hostKitCompose = Get-Content -Raw (Join-Path $RepoRoot 'compose.host-kit.yml')
$runtimeManagerCompose = Get-Content -Raw (Join-Path $RepoRoot 'compose.runtime-manager.yml')
$hostKitExample = Get-Content -Raw (Join-Path $RepoRoot '.env.web-plane.host-kit.example')

function Assert-Contains {
    param([string] $Text, [string] $Pattern, [string] $Message)
    if ($Text -notmatch [regex]::Escape($Pattern)) {
        throw $Message
    }
}

Assert-Contains $deploy '[switch] $SkipGovernance' 'deploy.ps1 must expose -SkipGovernance'
Assert-Contains $deploy '[int]    $GovernancePort = 49102' 'deploy.ps1 must expose -GovernancePort 49102'
Assert-Contains $deploy 'Start-HostNativeGovernance' 'deploy.ps1 must start governance through host-native launcher'
Assert-Contains $deploy 'HOST_GOVERNANCE_API_BASE' 'deploy.ps1 must inject coordinator governance base URL'
Assert-Contains $deploy "'HOST_GOVERNANCE_API_BASE'" 'deploy.ps1 must consider governance base URL in web-plane refresh inputs'
Assert-Contains $deploy "'A4_INTERNAL_CONTEXT_TOKEN'" 'deploy.ps1 must inject and refresh the A4 shared token without embedding it'
Assert-Contains $deploy 'A4InternalContextTokenFingerprint' 'governance runtime signature must react to A4 token rotation'
Assert-Contains $deploy "[Environment]::SetEnvironmentVariable('A4_CONVERSION_ARTIFACTS_HOST_ROOT'" 'deploy.ps1 must inject an absolute host-native artifacts namespace'
Assert-Contains $deploy "Join-Path `$RunDir 'web-plane.params.json'" 'deploy.ps1 must persist effective web-plane inputs separately'
Assert-Contains $deploy 'function New-WebPlaneRuntimeSignature' 'deploy.ps1 must build a secret-safe effective web-plane signature'
Assert-Contains $deploy 'Test-KitRuntimeSignatureMatches -Path $script:webPlaneRuntimeSignaturePath' 'deploy.ps1 must compare the effective web-plane signature before refresh'
Assert-Contains $deploy 'Set-KitRuntimeSignature -Path $script:webPlaneRuntimeSignaturePath' 'deploy.ps1 must persist the web-plane signature after reconcile'
Assert-Contains $deploy '-ArtifactsRoot $resolvedConversionArtifactsRoot' 'conversion runtime signature must track its effective output root'
Assert-Contains $deploy '$shouldRefreshWebPlane = $true' 'deploy.ps1 must force web-plane refresh for custom governance port'
Assert-Contains $deploy "if (-not `$SkipConversion -and (Get-PlatformName) -eq 'linux')" 'deploy.ps1 must keep the inode-replacing CAD entrypoint hardener on the Linux conversion path'
Assert-Contains $deploy 'harden-cad-extension-cache.py' 'deploy.ps1 must invoke the checked-in CAD cache hardener'
# #625: the runtime adapter enforces the same owner-private boundary on every
# platform, so the Windows conversion path must converge its NTFS DACLs instead
# of being skipped by the platform guard above.
Assert-Contains $deploy "if (-not `$SkipConversion -and (Get-PlatformName) -eq 'windows')" 'deploy.ps1 must harden the CAD extension cache on the Windows conversion path too (#625)'
Assert-Contains $deploy 'cad-extension-cache-acl.ps1' 'deploy.ps1 must import the Windows CAD extension cache ACL library'
Assert-Contains $deploy 'Invoke-CadExtensionCacheWindowsHardening' 'deploy.ps1 must converge the Windows CAD extension cache chain through the shared library'
Assert-Contains $cadAclLibrary 'RemoveAccessRuleSpecific' 'the Windows hardener must remove ACEs through the ACL object model, never icacls'
Assert-Contains $cadAclLibrary 'SetAccessRuleProtection($true, $true)' 'the Windows hardener must preserve inherited ACEs when it breaks inheritance'
Assert-Contains $cadAclLibrary 'FileSystemAclExtensions]::SetAccessControl' 'the Windows hardener must persist DACL-only writes without SeSecurityPrivilege'
Assert-Contains $cadAclLibrary 'GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])' 'the Windows hardener must enumerate rules positionally instead of through @()'
$cadAclCodeLines = @($cadAclLibrary -split '\r?\n' | Where-Object { $_.TrimStart() -notmatch '^#' })
if (@($cadAclCodeLines | Where-Object { $_ -match 'icacls' }).Count -gt 0) {
    throw 'the Windows hardener must not shell out to icacls: /remove:g reports success and does nothing for an unresolvable orphan SID'
}
Assert-Contains $deploy "Get-DeployEnvValue -Name 'STREAMING_CONVERSION_HOOPS_MAIN'" 'Linux deploy must reject an unpinned explicit HOOPS override'
if ($deploy -match 'GetUnixFileMode') {
    throw 'Linux deploy must remain compatible with the repository PowerShell 7 baseline'
}
Assert-Contains $deploy 'Invoke-HostNativeBoundedProcess' 'Linux deploy must launch the hardener through the launch-time containment boundary helper (#522)'
$boundaryLib = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'scripts/lib/host-native-job-boundary.ps1')
Assert-Contains $boundaryLib '[System.Diagnostics.ProcessStartInfo]::new()' 'the boundary helper must launch children through a process with a reliable ExitCode'
Assert-Contains $boundaryLib 'JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE' 'the boundary helper must set kill-on-close so a closed handle reaps the tree'
Assert-Contains $deploy '-TimeoutSec $TimeoutSec' 'Linux deploy must bound the CAD hardener process wait through the boundary helper'
Assert-Contains $deploy 'bounded.TerminationFailure' 'Linux deploy must fail closed when a timed-out CAD hardener process tree exit cannot be proven'
Assert-Contains $boundaryLib 'Stop-HostNativeProcessTreeAndWait -Process $process -TimeoutMs 5000' 'the boundary helper must keep the sweep fallback for platforms without Job Objects'
Assert-Contains $launcher 'function Stop-HostNativeProcessTreeAndWait' 'host-native launcher must expose the shared bounded process-tree terminator'
Assert-Contains $launcher '$Process.Kill($true)' 'bounded process-tree terminator must request descendant termination'
Assert-Contains $launcher '$Process.WaitForExit($TimeoutMs)' 'bounded process-tree terminator must wait for the parent exit'
Assert-Contains $launcher '-not $Process.HasExited' 'bounded process-tree terminator must prove the parent exited'
Assert-Contains $deploy '$bounded.ExitCode' 'Linux deploy must read the hardener process ExitCode from the boundary result'
Assert-Contains $deploy "[string]`$status.status -ceq 'passed'" 'Linux deploy must require the hardener passed JSON contract'
Assert-Contains $cadHardener 'harden_default_hoops_main_permissions' 'CAD cache hardener must reuse the adapter trust-boundary implementation'
Assert-Contains $cadHardener 'cad-extension-cache-hardening/v1' 'CAD cache hardener must emit the stable redacted result schema'
Assert-Contains $deploy 'coordinator-governance-files-tree' 'deploy.ps1 must verify coordinator to governance proxy'
Assert-Contains $launcher 'function Start-HostNativeGovernance' 'launcher must define Start-HostNativeGovernance'
Assert-Contains $launcher "-Name 'governance-service'" 'launcher must use governance-service PID/log name'
Assert-Contains $launcher "RUNTIME_MODE = 'hybrid-web-plane-host-native-kit'" 'host-native Kit Manager must publish the hybrid runtime identity'
Assert-Contains $launcher "HOST_LOCAL_RUNTIME_ALLOWED = 'true'" 'host-native Kit Manager must allow the host-local runtime authority'
Assert-Contains $launcher "KIT_INSTANCE_ID = 'kit_local_001'" 'host-native Kit Manager must target the launched Kit instance'
Assert-Contains $launcher 'KIT_CONTROL_URL = $normalizedKitControlUrl' 'host-native Kit Manager must use only a validated explicit control authority or the empty blocked state'
Assert-Contains $launcher 'function Test-HostNativeLocalAddress' 'host-native Kit Manager must verify that its conversion authority is local'
Assert-Contains $launcher 'KitControlUrl host must be loopback or an address assigned to this host.' 'host-native Kit Manager must reject remote Kit control targets'
Assert-Contains $launcher 'return $probe.ExitCode' 'host-native Kit Manager import probe must read a real process ExitCode from the boundary result'
Assert-Contains $deploy "Get-DeployEnvValue -Name 'KIT_CONTROL_URL'" 'deploy.ps1 must preserve an explicit Kit control authority instead of inventing conversion runtime routes'
Assert-Contains $deploy 'Resolve-HostNativeKitControlUrl' 'deploy.ps1 must canonicalize and validate Kit control identity before writing its runtime signature'
Assert-Contains $deploy '-KitControlUrl $resolvedKitControlUrl' 'deploy.ps1 must pass the explicit or empty Kit control authority to the child'
Assert-Contains $kitGateway 'blocked_runtime_control_unconfigured' 'an empty Kit control authority must produce an honest blocked state without network access'
Assert-Contains $deploy 'http://${resolvedConversionHealthHost}:49101/health' 'strict post-verify must probe the effective conversion health host'
Assert-Contains $stopAll 'governance-service' 'stop-all.ps1 must know governance-service'
Assert-Contains $stopAll 'if ($remaining.Count -gt 0)' 'stop-all.ps1 must fail closed when any expected listener remains'
Assert-Contains $stopAll 'owner-not-visible' 'stop-all.ps1 must report a listener whose PID is hidden'
Assert-Contains $stopAll 'exit 2' 'stop-all.ps1 must return nonzero when an expected listener remains'
Assert-Contains $deploy "'port','coordinator','8004'" 'deploy.ps1 must prove the current Compose coordinator publication before treating :8004 as owned'
Assert-Contains $deploy "'port','viewer','5173'" 'deploy.ps1 must prove the current Compose viewer publication before treating :5173 as owned'
Assert-Contains $deploy 'refusing an ownership-blind stop' 'deploy.ps1 must fail closed when an occupied listener PID is hidden'
Assert-Contains $hostKitCompose 'A4_TRUSTED_GOVERNANCE_ORIGINS: ${HOST_GOVERNANCE_API_BASE:-http://host.docker.internal:49102}' 'host-kit must explicitly allow only its configured governance bridge origin'
Assert-Contains $hostKitCompose 'A4_INTERNAL_CONTEXT_TOKEN: ${A4_INTERNAL_CONTEXT_TOKEN:-}' 'host-kit must pass the A4 token through environment substitution'
Assert-Contains $hostKitCompose ':/workspace/a4-conversion-artifacts:ro' 'host-kit must mount conversion artifacts read-only for mapping provenance'
Assert-Contains $hostKitCompose 'A4_CONVERSION_ARTIFACTS_HOST_ROOT: ${A4_CONVERSION_ARTIFACTS_HOST_ROOT:-}' 'host-kit must pass the separately resolved host namespace'
Assert-Contains $hostKitExample 'A4_INTERNAL_CONTEXT_TOKEN=' 'host-kit example must document an empty secret placeholder'
Assert-Contains $hostKitExample 'SESSION_IDLE_TIMEOUT_MS=' 'host-kit example must expose the optional coordinator idle timeout used by canonical deploy'

$clearUserSite = $launcher.IndexOf('Remove-Item Env:PYTHONNOUSERSITE')
$importCheck = $launcher.IndexOf('import ifcopenshell, fastapi, uvicorn')
if ($clearUserSite -lt 0 -or $importCheck -lt 0 -or $clearUserSite -gt $importCheck) {
    throw 'launcher must clear PYTHONNOUSERSITE before governance import sanity check'
}

$parserTokens = $null
$parserErrors = $null
$deployAst = [System.Management.Automation.Language.Parser]::ParseInput($deploy, [ref]$parserTokens, [ref]$parserErrors)
if (@($parserErrors).Count -ne 0) {
    throw 'deploy.ps1 must parse before governance static inspection'
}
$kitControlAssignments = @($deployAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$resolvedKitControlUrl'
}, $true))
if ($kitControlAssignments.Count -ne 1) {
    throw 'deploy.ps1 must assign resolvedKitControlUrl exactly once'
}
function Get-DeployEnvValue {
    param($Name, $EnvFile, $Default)
    return 'malformed-manager-only-url'
}
function Resolve-HostNativeKitControlUrl {
    param($KitControlUrl)
    throw 'Kit control resolver must not run when Kit Manager is skipped.'
}
$SkipKitManager = $true
$resolvedEnvFile = ''
$resolvedKitControlUrl = $null
. ([scriptblock]::Create($kitControlAssignments[0].Extent.Text))
if ($resolvedKitControlUrl -cne '') {
    throw 'SkipKitManager must bypass manager-only URL resolution and use an empty runtime identity'
}
$launcherParserTokens = $null
$launcherParserErrors = $null
$launcherAst = [System.Management.Automation.Language.Parser]::ParseInput($launcher, [ref]$launcherParserTokens, [ref]$launcherParserErrors)
if (@($launcherParserErrors).Count -ne 0) {
    throw 'host-native-launcher.ps1 must parse before governance static inspection'
}
$terminatorFunction = @($launcherAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Stop-HostNativeProcessTreeAndWait'
}, $true))
if ($terminatorFunction.Count -ne 1) {
    throw 'host-native-launcher.ps1 must define exactly one Stop-HostNativeProcessTreeAndWait helper'
}
. ([scriptblock]::Create($terminatorFunction[0].Extent.Text))
$hardenerFunction = @($deployAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Invoke-CadExtensionCacheHardener'
}, $true))
if ($hardenerFunction.Count -ne 1) {
    throw 'deploy.ps1 must define exactly one Invoke-CadExtensionCacheHardener helper'
}
# The hardener now routes through the launch-time containment boundary (#522);
# give the extracted extent its dependency the same way deploy.ps1 does.
. (Join-Path $repoRoot 'scripts/lib/host-native-job-boundary.ps1')
. ([scriptblock]::Create($hardenerFunction[0].Extent.Text))
$hardenerSandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-bim-invalid-hardener-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $hardenerSandbox -Force | Out-Null
    $invalidInterpreter = Join-Path $hardenerSandbox ($(if ($IsWindows) { 'invalid.exe' } else { 'invalid-python' }))
    $fixtureScript = Join-Path $hardenerSandbox 'fixture.py'
    [System.IO.File]::WriteAllText($invalidInterpreter, 'not an executable image')
    [System.IO.File]::WriteAllText($fixtureScript, 'print("unexpected")')
    $invalidResult = Invoke-CadExtensionCacheHardener `
        -PythonPath $invalidInterpreter `
        -ScriptPath $fixtureScript `
        -StreamingRepoRoot $hardenerSandbox
    if ($invalidResult.ExitCode -ne -1 -or $invalidResult.StatusValid) {
        throw 'invalid or non-executable hardener interpreter must fail closed'
    }

    $fixturePython = Resolve-PlatformSystemPython
    if ([string]::IsNullOrWhiteSpace($fixturePython)) {
        throw 'hardener wrapper regression fixtures require a working Python 3.11+ interpreter'
    }
    $validStatus = '{"schema_version":"cad-extension-cache-hardening/v1","status":"passed"}'
    $validFixture = Join-Path $hardenerSandbox 'valid.py'
    [System.IO.File]::WriteAllText($validFixture, "print('$validStatus')`n")
    $validResult = Invoke-CadExtensionCacheHardener `
        -PythonPath $fixturePython `
        -ScriptPath $validFixture `
        -StreamingRepoRoot $hardenerSandbox
    if ($validResult.ExitCode -ne 0 -or -not $validResult.StatusValid) {
        throw 'exact hardener success contract must be accepted'
    }

    $hungFixture = Join-Path $hardenerSandbox 'hung.py'
    $hungPidFile = Join-Path $hardenerSandbox 'hung-pids.json'
    $hungSource = @'
import json
import os
import pathlib
import subprocess
import sys
import time

repo_root = pathlib.Path(sys.argv[sys.argv.index("--repo-root") + 1])
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
(repo_root / "hung-pids.json").write_text(
    json.dumps([os.getpid(), child.pid]), encoding="utf-8"
)
time.sleep(30)
'@
    [System.IO.File]::WriteAllText($hungFixture, $hungSource)
    $hungStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $hungResult = Invoke-CadExtensionCacheHardener `
        -PythonPath $fixturePython `
        -ScriptPath $hungFixture `
        -StreamingRepoRoot $hardenerSandbox `
        -TimeoutSec 1
    $hungStopwatch.Stop()
    if ($hungResult.ExitCode -ne -1 -or $hungResult.StatusValid) {
        throw 'timed-out hardener process must fail closed'
    }
    if ($hungStopwatch.Elapsed.TotalSeconds -ge 10) {
        throw 'timed-out hardener process must return within the bounded cleanup window'
    }
    if (-not (Test-Path -LiteralPath $hungPidFile -PathType Leaf)) {
        throw 'timed-out hardener fixture must record its parent and child PIDs'
    }
    $hungPids = @(Get-Content -Raw -LiteralPath $hungPidFile | ConvertFrom-Json)
    foreach ($processId in $hungPids) {
        $remainingProcess = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
        for ($attempt = 0; $null -ne $remainingProcess -and $attempt -lt 20; $attempt++) {
            Start-Sleep -Milliseconds 100
            $remainingProcess = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
        }
        if ($null -ne $remainingProcess) {
            throw "timed-out hardener process tree left PID $processId running"
        }
    }

    $wrongSchemaStatus = '{"schema_version":"wrong","status":"passed"}'
    $failedStatus = '{"schema_version":"cad-extension-cache-hardening/v1","status":"failed"}'
    $malformedSuccessCases = @(
        @{
            Name = 'stderr'
            Source = "import sys`nprint('$validStatus')`nprint('unexpected stderr', file=sys.stderr)`n"
        },
        @{
            Name = 'multiple stdout lines'
            Source = "print('$validStatus')`nprint('unexpected second line')`n"
        },
        @{ Name = 'invalid JSON'; Source = "print('not-json')`n" },
        @{ Name = 'wrong schema'; Source = "print('$wrongSchemaStatus')`n" },
        @{ Name = 'failed status'; Source = "print('$failedStatus')`n" }
    )
    foreach ($fixtureCase in $malformedSuccessCases) {
        $caseScript = Join-Path $hardenerSandbox (([string]$fixtureCase.Name -replace '[^A-Za-z0-9]+', '-') + '.py')
        [System.IO.File]::WriteAllText($caseScript, [string]$fixtureCase.Source)
        $caseResult = Invoke-CadExtensionCacheHardener `
            -PythonPath $fixturePython `
            -ScriptPath $caseScript `
            -StreamingRepoRoot $hardenerSandbox
        if ($caseResult.ExitCode -ne 0 -or $caseResult.StatusValid) {
            throw "hardener wrapper must reject exit-zero $($fixtureCase.Name) output"
        }
    }
}
finally {
    if (Test-Path -LiteralPath $hardenerSandbox) {
        Remove-Item -LiteralPath $hardenerSandbox -Recurse -Force
    }
}

$cadHardeningPhases = @($deployAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.IfStatementAst] -and
        $node.Extent.Text.TrimStart().StartsWith("if (-not `$SkipConversion -and (Get-PlatformName) -eq 'linux')", [System.StringComparison]::Ordinal)
}, $true))
if ($cadHardeningPhases.Count -ne 1) {
    throw 'deploy.ps1 must expose exactly one Linux CAD hardening phase block'
}
if (-not $IsWindows) {
    $cadPhaseSandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-bim-cad-phase-{0}" -f [guid]::NewGuid().ToString('N'))
    try {
        $streamingScripts = Join-Path $cadPhaseSandbox 'bim-streaming-server/scripts'
        New-Item -ItemType Directory -Path $streamingScripts -Force | Out-Null
        $fixtureHardener = Join-Path $streamingScripts 'harden-cad-extension-cache.py'
        [System.IO.File]::WriteAllText($fixtureHardener, '# fixture hardener')
        $phaseSourcePath = Join-Path $cadPhaseSandbox 'cad-hardening-phase.ps1'
        [System.IO.File]::WriteAllText($phaseSourcePath, $cadHardeningPhases[0].Extent.Text)
        $fixtureRunnerPath = Join-Path $cadPhaseSandbox 'invoke-cad-hardening-phase.ps1'
        $fixtureRunnerSource = @'
param(
    [Parameter(Mandatory = $true)][string] $RepoRoot,
    [Parameter(Mandatory = $true)][string] $PhaseSourcePath,
    [Parameter(Mandatory = $true)][string] $PythonPath,
    [AllowEmptyString()][string] $ConfiguredHoopsMain = '',
    [int] $HardenerExitCode = 0,
    [ValidateSet('true', 'false')][string] $HardenerStatusValid = 'true'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$SkipConversion = $false
$resolvedEnvFile = ''
$LogPath = Join-Path $RepoRoot 'phase.log'
$script:fixturePythonPath = $PythonPath
$script:fixtureConfiguredHoopsMain = $ConfiguredHoopsMain
$script:fixtureHardenerExitCode = $HardenerExitCode
$script:fixtureHardenerStatusValid = $HardenerStatusValid -ceq 'true'
function Get-PlatformName { return 'linux' }
function Get-DeployEnvValue {
    param($Name, $EnvFile, $Default)
    return $script:fixtureConfiguredHoopsMain
}
function Resolve-PlatformVenvPython {
    param($VenvRoot)
    return $script:fixturePythonPath
}
function Invoke-CadExtensionCacheHardener {
    param($PythonPath, $ScriptPath, $StreamingRepoRoot)
    [pscustomobject]@{
        PythonPath = $PythonPath
        ScriptPath = $ScriptPath
        StreamingRepoRoot = $StreamingRepoRoot
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $RepoRoot 'hardener-call.json') -Encoding utf8
    return [pscustomobject]@{
        ExitCode = $script:fixtureHardenerExitCode
        StatusValid = $script:fixtureHardenerStatusValid
        StatusJson = '{"schema_version":"cad-extension-cache-hardening/v1","status":"passed"}'
    }
}
function Write-DeployTag {
    param($Tag, $Message, $LogPath)
    "$Tag|$Message" | Add-Content -LiteralPath (Join-Path $RepoRoot 'phase-trace.txt')
}
function Print-FinalSummary {
    param($ExitCode, $FailedPhase)
    Write-Output "SUMMARY_EXIT=$ExitCode PHASE=$FailedPhase"
}
. ([scriptblock]::Create([System.IO.File]::ReadAllText($PhaseSourcePath)))
Write-Output 'PHASE_CONTINUED'
'@
        [System.IO.File]::WriteAllText($fixtureRunnerPath, $fixtureRunnerSource)
        $fixturePythonCommand = Resolve-PlatformSystemPython
        if ([string]::IsNullOrWhiteSpace($fixturePythonCommand)) {
            throw 'Linux CAD phase regression fixtures require a working Python 3.11+ interpreter'
        }
        $fixturePython = [string](Get-Command -Name $fixturePythonCommand -CommandType Application -ErrorAction Stop | Select-Object -First 1).Path
        if ([string]::IsNullOrWhiteSpace($fixturePython) -or -not (Test-Path -LiteralPath $fixturePython -PathType Leaf)) {
            throw 'Linux CAD phase regression fixtures require an absolute Python interpreter path'
        }
        $phaseCases = @(
            @{
                Name = 'explicit HOOPS override'
                ConfiguredHoopsMain = '/tmp/unpinned-hoops-main.py'
                HardenerExitCode = 0
                HardenerStatusValid = 'true'
                ExpectedExitCode = 2
                ExpectedTrace = 'Explicit STREAMING_CONVERSION_HOOPS_MAIN is not supported'
                ExpectHardenerCall = $false
                ExpectContinuation = $false
            },
            @{
                Name = 'malformed hardener result'
                ConfiguredHoopsMain = ''
                HardenerExitCode = 0
                HardenerStatusValid = 'false'
                ExpectedExitCode = 2
                ExpectedTrace = 'CAD extension cache permission hardening failed'
                ExpectHardenerCall = $true
                ExpectContinuation = $false
            },
            @{
                Name = 'exact hardener success'
                ConfiguredHoopsMain = ''
                HardenerExitCode = 0
                HardenerStatusValid = 'true'
                ExpectedExitCode = 0
                ExpectedTrace = 'CAD extension cache entrypoint permissions hardened'
                ExpectHardenerCall = $true
                ExpectContinuation = $true
            }
        )
        foreach ($phaseCase in $phaseCases) {
            foreach ($artifactName in @('hardener-call.json', 'phase-trace.txt', 'phase.log')) {
                Remove-Item -LiteralPath (Join-Path $cadPhaseSandbox $artifactName) -Force -ErrorAction SilentlyContinue
            }
            $phaseOutput = @(& (Get-Process -Id $PID).Path -NoProfile -NonInteractive -File $fixtureRunnerPath `
                -RepoRoot $cadPhaseSandbox `
                -PhaseSourcePath $phaseSourcePath `
                -PythonPath $fixturePython `
                -ConfiguredHoopsMain ([string]$phaseCase.ConfiguredHoopsMain) `
                -HardenerExitCode ([int]$phaseCase.HardenerExitCode) `
                -HardenerStatusValid ([string]$phaseCase.HardenerStatusValid) 2>&1)
            $phaseExitCode = $LASTEXITCODE
            $phaseOutputText = $phaseOutput -join "`n"
            if ($phaseExitCode -ne [int]$phaseCase.ExpectedExitCode) {
                throw "Linux CAD phase '$($phaseCase.Name)' exit code mismatch: expected=$($phaseCase.ExpectedExitCode) actual=$phaseExitCode output=$phaseOutputText"
            }
            $tracePath = Join-Path $cadPhaseSandbox 'phase-trace.txt'
            $traceText = if (Test-Path -LiteralPath $tracePath) { Get-Content -LiteralPath $tracePath -Raw } else { '' }
            if ($traceText -notmatch [regex]::Escape([string]$phaseCase.ExpectedTrace)) {
                throw "Linux CAD phase '$($phaseCase.Name)' did not report its expected phase result"
            }
            $continued = $phaseOutputText -match 'PHASE_CONTINUED'
            if ($continued -ne [bool]$phaseCase.ExpectContinuation) {
                throw "Linux CAD phase '$($phaseCase.Name)' continuation mismatch"
            }
            $hardenerCallPath = Join-Path $cadPhaseSandbox 'hardener-call.json'
            if ((Test-Path -LiteralPath $hardenerCallPath -PathType Leaf) -ne [bool]$phaseCase.ExpectHardenerCall) {
                throw "Linux CAD phase '$($phaseCase.Name)' hardener call mismatch"
            }
            if ($phaseCase.ExpectHardenerCall) {
                $hardenerCall = Get-Content -LiteralPath $hardenerCallPath -Raw | ConvertFrom-Json -ErrorAction Stop
                if ([string]$hardenerCall.PythonPath -cne $fixturePython -or
                    [string]$hardenerCall.ScriptPath -cne $fixtureHardener -or
                    [string]$hardenerCall.StreamingRepoRoot -cne (Join-Path $cadPhaseSandbox 'bim-streaming-server')) {
                    throw "Linux CAD phase '$($phaseCase.Name)' did not preserve exact helper arguments"
                }
            }
            if ($phaseCase.ExpectContinuation) {
                $phaseLog = Get-Content -LiteralPath (Join-Path $cadPhaseSandbox 'phase.log') -Raw
                if ($phaseLog -notmatch 'cad-extension-cache-hardening/v1') {
                    throw 'Linux CAD phase success did not retain the structured hardener status'
                }
            }
            elseif ($phaseOutputText -notmatch 'SUMMARY_EXIT=2 PHASE=Phase 2 \(CAD extension cache hardening\)') {
                throw "Linux CAD phase '$($phaseCase.Name)' did not preserve exit-2 phase reporting"
            }
        }
        Write-Host 'PASS Linux CAD hardening deploy-phase execution matrix'
    }
    finally {
        if (Test-Path -LiteralPath $cadPhaseSandbox) {
            Remove-Item -LiteralPath $cadPhaseSandbox -Recurse -Force
        }
    }
}

# #625: the Windows conversion path owes the same fail-closed treatment. The
# hardening itself is fixture-tested in scripts/tests/test-cad-extension-cache-acl.ps1;
# this matrix pins how the deploy phase reacts to each status it can return.
$windowsCadPhases = @($deployAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.IfStatementAst] -and
        $node.Extent.Text.TrimStart().StartsWith("if (-not `$SkipConversion -and (Get-PlatformName) -eq 'windows')", [System.StringComparison]::Ordinal)
}, $true))
if ($windowsCadPhases.Count -ne 1) {
    throw 'deploy.ps1 must expose exactly one Windows CAD hardening phase block'
}
$windowsPhaseSandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-bim-cad-win-phase-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $windowsPhaseSandbox -Force | Out-Null
    $windowsPhaseSourcePath = Join-Path $windowsPhaseSandbox 'cad-hardening-phase-windows.ps1'
    [System.IO.File]::WriteAllText($windowsPhaseSourcePath, $windowsCadPhases[0].Extent.Text)
    $windowsRunnerPath = Join-Path $windowsPhaseSandbox 'invoke-cad-hardening-phase-windows.ps1'
    $windowsRunnerSource = @'
param(
    [Parameter(Mandatory = $true)][string] $RepoRoot,
    [Parameter(Mandatory = $true)][string] $PhaseSourcePath,
    [ValidateSet('passed', 'skipped', 'failed', 'none')][string] $HardenerStatus = 'passed',
    [AllowEmptyString()][string] $ConfiguredHoopsMain = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$SkipConversion = $false
$resolvedEnvFile = ''
$LogPath = Join-Path $RepoRoot 'phase.log'
$script:fixtureStatus = $HardenerStatus
$script:fixtureConfiguredHoopsMain = $ConfiguredHoopsMain
function Get-PlatformName { return 'windows' }
function Get-DeployEnvValue {
    param($Name, $EnvFile, $Default)
    return $script:fixtureConfiguredHoopsMain
}
function Invoke-CadExtensionCacheWindowsHardening {
    param($StreamingRepoRoot, $ConfiguredHoopsMain)
    [pscustomobject]@{
        StreamingRepoRoot = $StreamingRepoRoot
        ConfiguredHoopsMain = $ConfiguredHoopsMain
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $RepoRoot 'windows-hardener-call.json') -Encoding utf8
    if ($script:fixtureStatus -ceq 'none') { return $null }
    return [pscustomobject]@{
        Status = $script:fixtureStatus
        ReasonKind = 'fixture_reason_kind'
        Diagnostic = 'fixture diagnostic naming the failing level and SIDs'
        StatusJson = '{"schema_version":"cad-extension-cache-windows-hardening/v1","status":"' + $script:fixtureStatus + '"}'
    }
}
function Write-DeployTag {
    param($Tag, $Message, $LogPath)
    "$Tag|$Message" | Add-Content -LiteralPath (Join-Path $RepoRoot 'phase-trace.txt')
}
function Print-FinalSummary {
    param($ExitCode, $FailedPhase)
    Write-Output "SUMMARY_EXIT=$ExitCode PHASE=$FailedPhase"
}
. ([scriptblock]::Create([System.IO.File]::ReadAllText($PhaseSourcePath)))
Write-Output 'PHASE_CONTINUED'
'@
    [System.IO.File]::WriteAllText($windowsRunnerPath, $windowsRunnerSource)
    $windowsPhaseCases = @(
        @{
            Name = 'unconverged chain'
            HardenerStatus = 'failed'
            ConfiguredHoopsMain = ''
            ExpectedExitCode = 2
            ExpectedTrace = 'fail|CAD extension cache permission hardening failed (fixture_reason_kind)'
            ExpectContinuation = $false
        },
        @{
            Name = 'nothing to converge (uncached package or explicit override)'
            HardenerStatus = 'skipped'
            ConfiguredHoopsMain = 'C:\explicit\hoops_main.py'
            ExpectedExitCode = 0
            ExpectedTrace = 'skip|CAD extension cache hardening skipped (fixture_reason_kind)'
            ExpectContinuation = $true
        },
        @{
            Name = 'converged chain'
            HardenerStatus = 'passed'
            ConfiguredHoopsMain = ''
            ExpectedExitCode = 0
            ExpectedTrace = 'ok|CAD extension cache entrypoint permissions hardened'
            ExpectContinuation = $true
        },
        @{
            # A hardener that cannot run at all must never fall through to the
            # success tag; an unmatched status is a failure, not a pass.
            Name = 'hardener unavailable'
            HardenerStatus = 'none'
            ConfiguredHoopsMain = ''
            ExpectedExitCode = 2
            ExpectedTrace = 'fail|CAD extension cache permission hardening failed (hardener_unavailable)'
            ExpectContinuation = $false
        }
    )
    foreach ($windowsCase in $windowsPhaseCases) {
        foreach ($artifactName in @('windows-hardener-call.json', 'phase-trace.txt', 'phase.log')) {
            Remove-Item -LiteralPath (Join-Path $windowsPhaseSandbox $artifactName) -Force -ErrorAction SilentlyContinue
        }
        $windowsOutput = @(& (Get-Process -Id $PID).Path -NoProfile -NonInteractive -File $windowsRunnerPath `
            -RepoRoot $windowsPhaseSandbox `
            -PhaseSourcePath $windowsPhaseSourcePath `
            -HardenerStatus ([string]$windowsCase.HardenerStatus) `
            -ConfiguredHoopsMain ([string]$windowsCase.ConfiguredHoopsMain) 2>&1)
        $windowsExitCode = $LASTEXITCODE
        $windowsOutputText = $windowsOutput -join "`n"
        if ($windowsExitCode -ne [int]$windowsCase.ExpectedExitCode) {
            throw "Windows CAD phase '$($windowsCase.Name)' exit code mismatch: expected=$($windowsCase.ExpectedExitCode) actual=$windowsExitCode output=$windowsOutputText"
        }
        $windowsTracePath = Join-Path $windowsPhaseSandbox 'phase-trace.txt'
        $windowsTrace = if (Test-Path -LiteralPath $windowsTracePath) { Get-Content -LiteralPath $windowsTracePath -Raw } else { '' }
        if ($windowsTrace -notmatch [regex]::Escape([string]$windowsCase.ExpectedTrace)) {
            throw "Windows CAD phase '$($windowsCase.Name)' did not report its expected phase result: $windowsTrace"
        }
        $windowsContinued = $windowsOutputText -match 'PHASE_CONTINUED'
        if ($windowsContinued -ne [bool]$windowsCase.ExpectContinuation) {
            throw "Windows CAD phase '$($windowsCase.Name)' continuation mismatch"
        }
        $windowsCallPath = Join-Path $windowsPhaseSandbox 'windows-hardener-call.json'
        if (-not (Test-Path -LiteralPath $windowsCallPath -PathType Leaf)) {
            throw "Windows CAD phase '$($windowsCase.Name)' must always consult the hardener"
        }
        $windowsCall = Get-Content -LiteralPath $windowsCallPath -Raw | ConvertFrom-Json -ErrorAction Stop
        if ([string]$windowsCall.StreamingRepoRoot -cne (Join-Path $windowsPhaseSandbox 'bim-streaming-server')) {
            throw "Windows CAD phase '$($windowsCase.Name)' must pass the streaming repo root that owns the pinned manifest"
        }
        if ([string]$windowsCall.ConfiguredHoopsMain -cne [string]$windowsCase.ConfiguredHoopsMain) {
            throw "Windows CAD phase '$($windowsCase.Name)' must forward the configured HOOPS override verbatim"
        }
        $windowsPhaseLogPath = Join-Path $windowsPhaseSandbox 'phase.log'
        if ([string]$windowsCase.HardenerStatus -ceq 'none') {
            if (Test-Path -LiteralPath $windowsPhaseLogPath) {
                throw "Windows CAD phase '$($windowsCase.Name)' must not invent a structured status when the hardener returned none"
            }
        }
        else {
            $windowsPhaseLog = Get-Content -LiteralPath $windowsPhaseLogPath -Raw
            if ($windowsPhaseLog -notmatch 'cad-extension-cache-windows-hardening/v1') {
                throw "Windows CAD phase '$($windowsCase.Name)' must retain the structured hardener status in the deploy log"
            }
        }
    }
    Write-Host 'PASS Windows CAD hardening deploy-phase execution matrix'
}
finally {
    if (Test-Path -LiteralPath $windowsPhaseSandbox) {
        Remove-Item -LiteralPath $windowsPhaseSandbox -Recurse -Force
    }
}

$refreshFunction = @($deployAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Test-WebPlaneRefreshRequired'
}, $true))
if ($refreshFunction.Count -ne 1) {
    throw 'deploy.ps1 must define exactly one Test-WebPlaneRefreshRequired helper'
}
$refreshFunctionText = $refreshFunction[0].Extent.Text
if ($refreshFunctionText -match "'A4_INTERNAL_CONTEXT_TOKEN'" -or $refreshFunctionText -match "'A4_CONVERSION_ARTIFACTS_HOST_ROOT'") {
    throw 'script-derived A4 values must use effective signatures, not presence-only web-plane refresh triggers'
}

$dockerFailureIndex = $deploy.IndexOf('if ($dockerExit -ne 0)')
$webPlaneSignatureSaveIndex = $deploy.IndexOf('Set-KitRuntimeSignature -Path $script:webPlaneRuntimeSignaturePath')
if ($dockerFailureIndex -lt 0 -or $webPlaneSignatureSaveIndex -le $dockerFailureIndex) {
    throw 'web-plane signature must be persisted only after docker compose succeeds'
}

# #640: Phase 4c must consult the orphan gate BEFORE it launches a Kit, and it
# must refuse rather than adopt or race the holder. The observation that a
# previous instance is still holding the streaming ports already existed in
# Phase 1's audit output; what was missing was any path from that observation to
# the start decision, so a dead launcher plus a live Kit child produced a second
# Kit that deadlocked with no listener and no log of its own.
Assert-Contains $launcher 'function Get-HostNativeOrphanListener' 'host-native launcher must expose the orphaned-listener detector'
Assert-Contains $launcher 'function Get-HostNativeServiceListenPorts' 'host-native launcher must expose the recorded port claim'
Assert-Contains $deploy '$kitOrphan = Get-HostNativeOrphanListener' 'deploy.ps1 must run the orphaned-Kit gate on the start path'
Assert-Contains $deploy '-ExpectedPorts (@($resolvedKitSignalPort) + @($resolvedSpectatorSignalPorts))' 'the orphaned-Kit gate must cover every signal port this run intends to use'
Assert-Contains $deploy 'stage=4c Phase 4c refusing to start a second Kit' 'deploy.ps1 must fail closed instead of starting a second Kit'
Assert-Contains $deploy 'Stop it first with scripts/stop-all.ps1, then re-run this deploy' 'the orphaned-Kit refusal must name the executable remedy'
Assert-Contains $deploy "Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4c (orphaned Kit holds the streaming ports)'" 'the orphaned-Kit refusal must exit through the Phase 4 failure summary'
$kitOrphanGateIndex = $deploy.IndexOf('$kitOrphan = Get-HostNativeOrphanListener')
$kitStartIndex = $deploy.IndexOf('$startInfo = Start-HostNativeKit')
if ($kitOrphanGateIndex -lt 0 -or $kitStartIndex -lt 0 -or $kitStartIndex -le $kitOrphanGateIndex) {
    throw 'deploy.ps1 must evaluate the orphaned-Kit gate before Start-HostNativeKit, not after'
}

$kitBuildIndex = $deploy.IndexOf('Invoke-KitRepoBuild')
$cadHardeningIndex = $deploy.IndexOf('harden-cad-extension-cache.py')
$envMergeIndex = $deploy.IndexOf('# fix: .env / .env.example missing-key merge')
if ($kitBuildIndex -lt 0 -or $cadHardeningIndex -le $kitBuildIndex -or $envMergeIndex -le $cadHardeningIndex) {
    throw 'CAD cache hardening must run after the Kit build gate and before later deployment phases'
}

# The Phase 2 missing-key merge can BOTH append a missing KIT_CONTROL_URL and
# repoint $resolvedEnvFile from the .example to the real env file. Resolving the
# Kit control authority (or sealing it into the Kit Manager runtime signature)
# before that block leaves the current run starting the child with the stale
# pre-merge value and persisting a signature that claims the repaired state —
# a blocked runtime-control state that looks configured.
$kitControlResolveIndex = $deploy.IndexOf('$resolvedKitControlUrl = if ($SkipKitManager)')
$kitManagerSignatureIndex = $deploy.IndexOf('$kitManagerRuntimeSignature = New-KitManagerRuntimeSignature')
if ($kitControlResolveIndex -lt 0) {
    throw 'deploy.ps1 must resolve the Kit control authority through the SkipKitManager-aware assignment'
}
if ($kitManagerSignatureIndex -lt 0) {
    throw 'deploy.ps1 must build the Kit Manager runtime signature from the resolved control authority'
}
if ($kitControlResolveIndex -le $envMergeIndex) {
    throw 'deploy.ps1 must resolve the Kit control authority AFTER the .env missing-key merge so a repaired KIT_CONTROL_URL takes effect in the same run'
}
if ($kitManagerSignatureIndex -le $envMergeIndex) {
    throw 'deploy.ps1 must build the Kit Manager runtime signature AFTER the .env missing-key merge so it never persists the stale pre-merge control authority'
}
if ($kitManagerSignatureIndex -le $kitControlResolveIndex) {
    throw 'deploy.ps1 must resolve the Kit control authority before sealing it into the Kit Manager runtime signature'
}
$kitManagerStartIndex = $deploy.IndexOf('Start-HostNativeKitManager -RepoRoot $RepoRoot -Port 8010 -KitControlUrl $resolvedKitControlUrl')
if ($kitManagerStartIndex -le $kitManagerSignatureIndex) {
    throw 'deploy.ps1 must start the host-native Kit Manager with the post-merge control authority'
}

# The Phase 2 copy still has to materialize the canonical env for the default
# deployment path, but it must not replace an operator-selected -EnvFile. Run
# only that loop in a sandbox so this regression is proved without starting any
# runtime or depending on Docker preflight.
$envMergeLoops = @($deployAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.ForEachStatementAst] -and
        $node.Extent.Text -match 'Copy-Item\s+-LiteralPath\s+\$examplePath'
}, $true))
if ($envMergeLoops.Count -ne 1) {
    throw 'deploy.ps1 must expose exactly one Phase 2 env merge loop'
}
function Invoke-EnvMergeFixture {
    param(
        [Parameter(Mandatory = $true)][string] $LoopText,
        [Parameter(Mandatory = $true)][string] $FixtureRoot,
        [Parameter(Mandatory = $true)][string] $InitialResolvedEnvFile,
        [Parameter(Mandatory = $true)][bool] $ResolvedEnvFileIsExplicit
    )
    function Write-DeployTag { param($Tag, $Message, $LogPath) }
    function Test-VolumeAlignment { param($RepoRoot, $EnvFile); [pscustomobject]@{ status = 'ALIGNED' } }
    function Resolve-DeployVolumeState { param($Volume, $EdgeRuntimeContract); $Volume }

    $RepoRoot = $FixtureRoot
    $LogPath = Join-Path $FixtureRoot 'deploy.log'
    $edgeRuntimeContract = $null
    $envFiles = @([pscustomobject]@{
            file          = '.env.web-plane.host-kit'
            envExists     = $false
            exampleExists = $true
            missing       = @()
        })
    $resolvedEnvFile = $InitialResolvedEnvFile
    $script:resolvedEnvFile = $InitialResolvedEnvFile
    $resolvedEnvFileIsExplicit = $ResolvedEnvFileIsExplicit
    $volume = [pscustomobject]@{ status = 'ALIGNED' }
    $fixActions = 0
    . ([scriptblock]::Create($LoopText))
    return [pscustomobject]@{
        Resolved       = $resolvedEnvFile
        ScriptResolved = $script:resolvedEnvFile
        Copied         = Test-Path -LiteralPath (Join-Path $FixtureRoot '.env.web-plane.host-kit') -PathType Leaf
        FixActions     = $fixActions
    }
}
$envMergeSandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-bim-explicit-env-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $envMergeSandbox -Force | Out-Null
    [System.IO.File]::WriteAllText(
        (Join-Path $envMergeSandbox '.env.web-plane.host-kit.example'),
        "KIT_CONTROL_URL=`n"
    )
    [System.IO.File]::WriteAllText(
        (Join-Path $envMergeSandbox 'custom.env'),
        "KIT_CONTROL_URL=http://127.0.0.1:49100/control`n"
    )

    $explicitEnvResult = Invoke-EnvMergeFixture `
        -LoopText $envMergeLoops[0].Extent.Text `
        -FixtureRoot $envMergeSandbox `
        -InitialResolvedEnvFile 'custom.env' `
        -ResolvedEnvFileIsExplicit $true
    if (-not $explicitEnvResult.Copied -or $explicitEnvResult.FixActions -ne 1) {
        throw 'Phase 2 must still materialize the missing canonical env when an explicit env file is selected'
    }
    if ($explicitEnvResult.Resolved -cne 'custom.env' -or $explicitEnvResult.ScriptResolved -cne 'custom.env') {
        throw 'Phase 2 must preserve an explicitly selected -EnvFile after materializing the canonical fallback'
    }

    Remove-Item -LiteralPath (Join-Path $envMergeSandbox '.env.web-plane.host-kit') -Force
    $fallbackEnvResult = Invoke-EnvMergeFixture `
        -LoopText $envMergeLoops[0].Extent.Text `
        -FixtureRoot $envMergeSandbox `
        -InitialResolvedEnvFile '.env.web-plane.host-kit.example' `
        -ResolvedEnvFileIsExplicit $false
    if ($fallbackEnvResult.Resolved -cne '.env.web-plane.host-kit' -or $fallbackEnvResult.ScriptResolved -cne '.env.web-plane.host-kit') {
        throw 'Phase 2 must repoint the automatic .example fallback after materializing the canonical env'
    }
} finally {
    Remove-Item -LiteralPath $envMergeSandbox -Recurse -Force -ErrorAction SilentlyContinue
}

# Hybrid mode must not start a CONTAINERISED kit-manager-api. `compose up
# coordinator viewer` used to pull it in through coordinator's depends_on, and
# that service publishes 127.0.0.1:8010 - the same port deploy.ps1 Phase 4c-2
# gives the host-native kit-manager. Linux refuses the second bind (Phase 4d died
# with "address already in use"); Windows only tolerated it because SO_REUSEADDR
# lets a second socket take the same addr:port, leaving it undefined which one
# actually answered :8010.
if ($hostKitCompose -notmatch 'depends_on:\s*!override\s*\[\]') {
    throw 'compose.host-kit.yml must clear coordinator depends_on (!override []) so hybrid mode does not start the containerised kit-manager-api on the host-native :8010'
}
if ($hostKitCompose -notmatch 'KIT_MANAGER_API_BASE:\s*\$\{HOST_KIT_MANAGER_API_BASE:-http://host\.docker\.internal:8010\}') {
    throw 'compose.host-kit.yml must route the coordinator to the HOST-NATIVE kit-manager (host.docker.internal:8010); clearing depends_on without this would leave it with no kit-manager at all'
}
if ($runtimeManagerCompose -notmatch 'SESSION_IDLE_TIMEOUT_MS:\s*\$\{SESSION_IDLE_TIMEOUT_MS:-\}') {
    throw 'compose.runtime-manager.yml must forward the optional SESSION_IDLE_TIMEOUT_MS policy into the deployed coordinator'
}

$legacyCleanupStart = $deploy.IndexOf('$legacyKitManagerRmArgs')
$legacyCleanupEnd = $deploy.IndexOf('# fix: 第一次 docker compose build', $legacyCleanupStart)
if ($legacyCleanupStart -lt 0 -or $legacyCleanupEnd -le $legacyCleanupStart) {
    throw 'deploy.ps1 must retain the bounded legacy kit-manager cleanup block'
}
$legacyCleanup = $deploy.Substring($legacyCleanupStart, $legacyCleanupEnd - $legacyCleanupStart)
Assert-Contains $legacyCleanup "'rm','-f','-s','kit-manager-api'" 'legacy cleanup must remove only the precise Compose kit-manager-api service'
if ($legacyCleanup -match "'down'|--remove-orphans") {
    throw 'legacy kit-manager cleanup must not broaden into compose down or orphan removal'
}
$kitManagerPreflightWiring = [regex]::Matches($deploy, 'if \(-not \$SkipKitManager\) \{ \$extraHostNativePorts \+= 8010 \}')
if ($kitManagerPreflightWiring.Count -ne 2) {
    throw 'deploy.ps1 must include host-native kit-manager port 8010 in both the initial and Phase 3 port audits'
}

[scriptblock]::Create($deploy) | Out-Null
[scriptblock]::Create($launcher) | Out-Null
[scriptblock]::Create($stopAll) | Out-Null
Write-Host 'PASS deploy governance static checks'
