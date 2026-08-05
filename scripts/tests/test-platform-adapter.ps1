[CmdletBinding()]
param()

# Cross-platform ownership-primitive tests (plan B2/B3). This suite is the
# executable equivalence evidence: the SAME assertions must pass on Windows
# (CIM CreationDate identity) and Linux (/proc starttime identity).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $repoRoot 'scripts/lib/platform/platform-adapter.ps1')
. (Join-Path $repoRoot 'scripts/lib/deploy-target-registry.ps1')

$platform = Get-PlatformName
Assert-True ($platform -in @('windows', 'linux')) "platform must resolve (got '$platform')"

# --- self identity: non-null, stable, self-matching --------------------------------
$self1 = Get-PlatformProcessIdentity -ProcessId $PID
$self2 = Get-PlatformProcessIdentity -ProcessId $PID
Assert-True ($null -ne $self1) 'self identity must resolve'
Assert-True (-not [string]::IsNullOrEmpty([string]$self1.BirthToken)) 'self identity must carry a birth token'
Assert-True (Test-PlatformProcessIdentityMatch -Reference $self1 -Current $self2) 'self identity must be stable across reads'

# --- child process: enumeration, distinct identity, death detection ----------------
$child = if ($platform -eq 'windows') {
    Start-Process -FilePath 'pwsh' -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep 60') -PassThru -WindowStyle Hidden
} else {
    Start-Process -FilePath 'pwsh' -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep 60') -PassThru
}
try {
    Start-Sleep -Milliseconds 500
    $children = @(Get-PlatformChildProcessIds -ParentProcessId $PID)
    Assert-True ($child.Id -in $children) "spawned child $($child.Id) must appear in child enumeration (got: $($children -join ', '))"

    $childIdentity = Get-PlatformProcessIdentity -ProcessId $child.Id
    Assert-True ($null -ne $childIdentity) 'child identity must resolve'
    Assert-True (-not (Test-PlatformProcessIdentityMatch -Reference $self1 -Current $childIdentity)) 'child identity must not match self'

    # identity survives while alive
    $childIdentity2 = Get-PlatformProcessIdentity -ProcessId $child.Id
    Assert-True (Test-PlatformProcessIdentityMatch -Reference $childIdentity -Current $childIdentity2) 'child identity must be stable while alive'
} finally {
    Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue
}
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline -and $null -ne (Get-PlatformProcessIdentity -ProcessId $child.Id)) { Start-Sleep -Milliseconds 200 }
Assert-True ($null -eq (Get-PlatformProcessIdentity -ProcessId $child.Id)) 'dead child identity must resolve to null'
Assert-True (-not (Test-PlatformProcessIdentityMatch -Reference $childIdentity -Current (Get-PlatformProcessIdentity -ProcessId $child.Id))) 'match against dead process must be false'

# --- tcp listener ownership --------------------------------------------------------
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
try {
    $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    $ownerPid = Get-PlatformTcpListenerPid -Port $port
    Assert-True ($ownerPid -eq $PID) "listener on :$port must be owned by this process (got: $ownerPid)"
} finally {
    $listener.Stop()
}
Start-Sleep -Milliseconds 300
Assert-True ($null -eq (Get-PlatformTcpListenerPid -Port $port)) 'closed listener port must resolve to null owner'

# --- system interpreter used to CREATE a venv --------------------------------------
# Distinct from the interpreter inside it. The remote had python3 only, and a bare
# `& python` silently no-opped venv creation on the first real Linux deploy, so this
# must never return a name the shell cannot actually run.
$systemPython = Resolve-PlatformSystemPython
Assert-True ($null -ne $systemPython) 'a usable system python must resolve on this platform'
Assert-True ($null -ne (Get-Command -Name $systemPython -ErrorAction SilentlyContinue)) "resolved system python '$systemPython' must be a resolvable command"
Assert-True (((& $systemPython -c 'import sys; print(sys.version_info >= (3, 11))' 2>&1 | Out-String).Trim()) -eq 'True') 'resolved system python must be 3.11+'
Assert-True ($systemPython -in @('python', 'python3')) "system python must be one of the probed candidates (got: $systemPython)"

# --- path/launch resolution driven by the real registry ----------------------------
$venvPython = Resolve-PlatformVenvPython -VenvRoot '/repo/.venv'
if ($platform -eq 'windows') {
    Assert-True ($venvPython -match 'Scripts[\\/]python\.exe$') 'windows venv python shape'
} else {
    Assert-True ($venvPython -match 'bin/python$') 'linux venv python shape'
}

$privateTempRoot = Join-Path ([IO.Path]::GetTempPath()) "ai-bim-platform-inventory-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $privateTempRoot -Force | Out-Null
try {
    $inventoryPath = Join-Path $privateTempRoot 'target.local.json'
    @{
        schema_version = 'deploy-target-private-inventory/v1'
        targets = @(@{
            id = 'canonical-linux'
            connection = @{ host = 'deploy.example.invalid'; user = 'deploy-fixture' }
            deploy_root = '/srv/ai-bim/example-deploy'
            runtime_data_root = '/srv/ai-bim/example-runtime-data'
            public_host = '192.0.2.10'
            edge_site_id = 'site-example'
            host_native_bind_host = '192.0.2.1'
        })
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $inventoryPath -Encoding utf8
    $linuxTarget = Get-DeployTarget -Id 'canonical-linux' -InventoryPath $inventoryPath
    $linuxLaunch = Resolve-DeployTargetKitLaunch -Target $linuxTarget
    Assert-True ($linuxLaunch.LauncherPath -eq '/srv/ai-bim/example-deploy/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh') "linux launcher path (got: $($linuxLaunch.LauncherPath))"
    Assert-True ('--no-window' -in @($linuxLaunch.Arguments)) 'linux launch must carry --no-window (F-1)'
} finally {
    Remove-Item -LiteralPath $privateTempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$windowsTarget = Get-DeployTarget -Id 'local-windows'
$windowsLaunch = Resolve-DeployTargetKitLaunch -Target $windowsTarget
Assert-True ($windowsLaunch.LauncherPath -eq 'D:\Users\deploy\AI-bim-geo\bim-streaming-server\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat') "windows launcher path (got: $($windowsLaunch.LauncherPath))"
Assert-True (@($windowsLaunch.Arguments).Count -eq 0) 'windows launch takes no extra args'

Write-Host "[test-platform-adapter] all assertions passed on $platform"
