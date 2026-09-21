# scripts\tests\test-deploy-cfd-solver.ps1
# CFD S4：canonical deploy 的 CFD_* env 解析、fail-closed 驗證、映像 digest 釘住與 process env 套用。
# 沿用 test-helpers.ps1 的 dot-source + 自訂 assert 風格；docker 以 stub scriptblock 注入，不碰真 engine。
. (Join-Path $PSScriptRoot 'test-helpers.ps1')
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'scripts\lib\cfd-solver-deploy.ps1')

function New-EnvReader {
    param([hashtable] $Values)
    return { param($Name, $Default) if ($Values.ContainsKey($Name)) { $Values[$Name] } else { $Default } }.GetNewClosure()
}

# ---------------------------------------------------------------------------
# Test 1: no CFD keys -> disabled, pinned defaults, derived /cfd-artifacts origin
# ---------------------------------------------------------------------------
$resolved = Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{}) -ConversionPublicArtifactsUrl 'http://192.0.2.10:49101/artifacts'
Assert-Equal 'false' $resolved.CFD_ENABLED 'CFD stays disabled without CFD_ENABLED'
Assert-Equal 'opencfd/openfoam-default:2412' $resolved.CFD_IMAGE 'default solver image'
Assert-Equal 'sha256:1ba02114b1c025c370f2e269a07677c16c9bea8d990fcd75ac8378aff9d41b50' $resolved.CFD_IMAGE_DIGEST 'default pinned digest'
Assert-Equal '4' $resolved.CFD_N_PROCS 'conservative default n_procs (Kit shares the CPU, R-A1)'
Assert-Equal '16' $resolved.CFD_MAX_DIRECTIONS 'default max directions'
Assert-Equal 'http://192.0.2.10:49101/cfd-artifacts' $resolved.CFD_PUBLIC_ARTIFACTS_URL 'derived from the /artifacts origin like the coordinator'
Assert-Equal '' $resolved.CFD_ARTIFACTS_ROOT 'no CFD_ARTIFACTS_ROOT -> service default (<artifacts root>/cfd)'

# ---------------------------------------------------------------------------
# Test 2: explicit values pass through; truthy spellings normalise
# ---------------------------------------------------------------------------
$resolved = Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{
    CFD_ENABLED = 'Yes'; CFD_N_PROCS = ' 6 '; CFD_MAX_DIRECTIONS = '8'; CFD_PUBLIC_ARTIFACTS_URL = 'https://edge.example/cfd-artifacts'
    CFD_IMAGE_DIGEST = ''
}) -ConversionPublicArtifactsUrl 'http://ignored:49101/artifacts'
Assert-Equal 'true' $resolved.CFD_ENABLED 'yes -> true'
Assert-Equal '6' $resolved.CFD_N_PROCS 'trimmed integer'
Assert-Equal '8' $resolved.CFD_MAX_DIRECTIONS 'explicit max directions'
Assert-Equal 'https://edge.example/cfd-artifacts' $resolved.CFD_PUBLIC_ARTIFACTS_URL 'explicit public URL wins over derivation'
Assert-Equal '' $resolved.CFD_IMAGE_DIGEST 'empty digest is allowed (unpinned) but stays empty, not defaulted'
Assert-Equal '' (Get-CfdPublicArtifactsUrl -ConversionPublicArtifactsUrl '') 'no origin -> no derived URL'
Assert-Equal 'http://h:49101/cfd-artifacts' (Get-CfdPublicArtifactsUrl -ConversionPublicArtifactsUrl 'http://h:49101') 'origin without /artifacts'

# ---------------------------------------------------------------------------
# Test 3: invalid values fail closed
# ---------------------------------------------------------------------------
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_ENABLED = 'maybe' }) } 'ambiguous CFD_ENABLED throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_N_PROCS = '0' }) } 'n_procs below 1 throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_N_PROCS = 'eight' }) } 'non-integer n_procs throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_MAX_DIRECTIONS = '17' }) } 'max directions above 16 throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_IMAGE_DIGEST = 'sha256:abc' }) } 'malformed digest throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_IMAGE = 'opencfd/openfoam-default:2412 && rm -rf /' }) } 'image reference with shell metacharacters throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_ARTIFACTS_ROOT = 'relative/cfd' }) } 'relative CFD_ARTIFACTS_ROOT throws'
if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_ARTIFACTS_ROOT = 'C:cfd' }) } 'drive-relative CFD_ARTIFACTS_ROOT (C:cfd) throws'
    Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_ARTIFACTS_ROOT = 'im-runtime\cfd' }) } 'root-relative CFD_ARTIFACTS_ROOT (\cfd) throws'
}
$absRoot = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'D:\bim-runtime\cfd' } else { '/srv/bim-runtime/cfd' }
Assert-Equal $absRoot (Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_ARTIFACTS_ROOT = $absRoot })).CFD_ARTIFACTS_ROOT 'absolute CFD_ARTIFACTS_ROOT passes through'

# ---------------------------------------------------------------------------
# Test 4: Set-CfdProcessEnvironment sets and clears keys
# ---------------------------------------------------------------------------
$saved = @{}
foreach ($key in @('CFD_ENABLED', 'CFD_IMAGE', 'CFD_IMAGE_DIGEST', 'CFD_N_PROCS', 'CFD_MAX_DIRECTIONS', 'CFD_ARTIFACTS_ROOT', 'CFD_PUBLIC_ARTIFACTS_URL')) { $saved[$key] = [Environment]::GetEnvironmentVariable($key) }
try {
    [Environment]::SetEnvironmentVariable('CFD_PUBLIC_ARTIFACTS_URL', 'http://stale/cfd-artifacts')
    [Environment]::SetEnvironmentVariable('CFD_ARTIFACTS_ROOT', 'X:\stale\cfd')
    Set-CfdProcessEnvironment -CfdEnvironment ([ordered]@{ CFD_ENABLED = 'true'; CFD_IMAGE = 'img:tag'; CFD_IMAGE_DIGEST = ''; CFD_N_PROCS = '4'; CFD_MAX_DIRECTIONS = '16'; CFD_PUBLIC_ARTIFACTS_URL = '' })
    Assert-Equal 'true' ([Environment]::GetEnvironmentVariable('CFD_ENABLED')) 'CFD_ENABLED applied'
    Assert-Equal 'img:tag' ([Environment]::GetEnvironmentVariable('CFD_IMAGE')) 'CFD_IMAGE applied'
    Assert-True ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('CFD_IMAGE_DIGEST'))) 'empty digest removed'
    Assert-True ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('CFD_PUBLIC_ARTIFACTS_URL'))) 'stale public URL cleared'
    Assert-True ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('CFD_ARTIFACTS_ROOT'))) 'stale artifacts root cleared even when the key is absent from the map'
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
}

# ---------------------------------------------------------------------------
# Test 5: Ensure-CfdSolverImage — present + digest match: no pull
# ---------------------------------------------------------------------------
$digest = 'sha256:' + ('a' * 64)
$calls = New-Object System.Collections.ArrayList
$stubPresent = {
    param($ArgList)
    [void]$calls.Add(($ArgList -join ' '))
    if ($ArgList[0] -eq 'image') { return @{ ExitCode = 0; Stdout = "opencfd/openfoam-default@$digest" } }
    return @{ ExitCode = 0; Stdout = '' }
}.GetNewClosure()
$info = Ensure-CfdSolverImage -Image 'opencfd/openfoam-default:2412' -Digest $digest -DockerCommand $stubPresent
Assert-Equal $false $info.pulled 'no pull when the pinned digest is already present'
Assert-Equal $digest $info.digest_actual 'actual digest reported'
Assert-True (@($calls | Where-Object { $_ -like 'pull *' }).Count -eq 0) 'docker pull not invoked'

# ---------------------------------------------------------------------------
# Test 6: missing image -> pull by digest, tag, re-inspect
# ---------------------------------------------------------------------------
$calls = New-Object System.Collections.ArrayList
$state = @{ present = $false }
$stubMissing = {
    param($ArgList)
    [void]$calls.Add(($ArgList -join ' '))
    switch ($ArgList[0]) {
        'image' { if ($state.present) { return @{ ExitCode = 0; Stdout = "opencfd/openfoam-default@$digest" } } else { return @{ ExitCode = 1; Stdout = 'Error: No such image' } } }
        'pull'  { $state.present = $true; return @{ ExitCode = 0; Stdout = 'Status: Downloaded' } }
        default { return @{ ExitCode = 0; Stdout = '' } }
    }
}.GetNewClosure()
$info = Ensure-CfdSolverImage -Image 'opencfd/openfoam-default:2412' -Digest $digest -DockerCommand $stubMissing
Assert-Equal $true $info.pulled 'pulled when missing'
Assert-True (@($calls | Where-Object { $_ -eq "pull opencfd/openfoam-default@$digest" }).Count -eq 1) 'pull addressed by digest'
Assert-True (@($calls | Where-Object { $_ -eq "tag opencfd/openfoam-default@$digest opencfd/openfoam-default:2412" }).Count -eq 1) 'pulled digest re-tagged with the configured tag'

# ---------------------------------------------------------------------------
# Test 7: digest mismatch -> throw (never deploy an unpinned solver); pull failure -> throw
# ---------------------------------------------------------------------------
$stubWrong = { param($ArgList) if ($ArgList[0] -eq 'image') { return @{ ExitCode = 0; Stdout = ('opencfd/openfoam-default@sha256:' + ('b' * 64)) } }; return @{ ExitCode = 0; Stdout = '' } }
Assert-Throws { Ensure-CfdSolverImage -Image 'opencfd/openfoam-default:2412' -Digest $digest -DockerCommand $stubWrong } 'digest mismatch throws'
$stubPullFail = { param($ArgList) if ($ArgList[0] -eq 'image') { return @{ ExitCode = 1; Stdout = 'No such image' } }; return @{ ExitCode = 1; Stdout = 'pull access denied' } }
Assert-Throws { Ensure-CfdSolverImage -Image 'opencfd/openfoam-default:2412' -Digest $digest -DockerCommand $stubPullFail } 'pull failure throws'
# Unpinned (empty digest): present image passes, missing image pulls by tag.
$info = Ensure-CfdSolverImage -Image 'opencfd/openfoam-default:2412' -Digest '' -DockerCommand $stubWrong
Assert-Equal $false $info.pulled 'unpinned present image accepted'

Write-Host '[test-deploy-cfd-solver] passed'
