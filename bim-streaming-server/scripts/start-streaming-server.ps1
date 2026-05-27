param(
    [string] $UsdPath = ".\bim-models\許良宇圖書館建築_2026.usd",

    [string] $TraceRoot = ".\logs\nvstreamer",

    [string] $InstanceId = "kit_local_001",

    [int] $SignalPort = 49100,

    [int] $StreamPort = 47998,

    [string] $PublicIp = "auto",

    [string[]] $SpectatorSignalPorts = @(),

    [string[]] $SpectatorStreamPorts = @(),

    [string] $PortableRoot = "",

    [switch] $NoWindow = $true,

    [switch] $SkipGpuCheck,

    [switch] $SkipAutoLoad,

    [switch] $ResetUser,

    [ValidateSet("", "error", "warning", "info", "debug", "verbose")]
    [string] $StreamSdkLogLevel = "",

    [switch] $PreflightOnly
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

function Initialize-WindowsRuntimeEnvironment {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $parts = $identity.Split("\", 2)
    if ($parts.Count -eq 2) {
        if ([string]::IsNullOrWhiteSpace($env:USERDOMAIN)) {
            $env:USERDOMAIN = $parts[0]
        }
        if ([string]::IsNullOrWhiteSpace($env:USERNAME)) {
            $env:USERNAME = $parts[1]
        }
    }

    if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
        $env:APPDATA = Join-Path $env:USERPROFILE "AppData\Roaming"
    }
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $env:LOCALAPPDATA = Join-Path $env:USERPROFILE "AppData\Local"
    }
    if ([string]::IsNullOrWhiteSpace($env:ProgramData)) {
        $env:ProgramData = "C:\ProgramData"
    }
    if ([string]::IsNullOrWhiteSpace($env:ALLUSERSPROFILE)) {
        $env:ALLUSERSPROFILE = "C:\ProgramData"
    }
    if ([string]::IsNullOrWhiteSpace($env:SystemRoot)) {
        $env:SystemRoot = "C:\WINDOWS"
    }
    if ([string]::IsNullOrWhiteSpace($env:windir)) {
        $env:windir = $env:SystemRoot
    }
    if ([string]::IsNullOrWhiteSpace($env:ComSpec)) {
        $env:ComSpec = Join-Path $env:SystemRoot "system32\cmd.exe"
    }
    if ([string]::IsNullOrWhiteSpace($env:COMPUTERNAME)) {
        $env:COMPUTERNAME = $env:USERDOMAIN
    }
}

function ConvertTo-AbsolutePath {
    param([Parameter(Mandatory = $true)][string] $Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function Test-PortFree {
    param([Parameter(Mandatory = $true)][int] $Port)

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        $details = $listeners | ForEach-Object {
            "TCP $($_.LocalAddress):$($_.LocalPort) LISTENING $($_.OwningProcess)"
        }
        throw "Port $Port is already listening:`n$($details -join "`n")"
    }
}

function ConvertTo-PortList {
    param(
        [string[]] $Values,
        [string] $Name
    )

    $ports = @()
    foreach ($value in $Values) {
        foreach ($part in ($value -split ",")) {
            $trimmed = $part.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
            $port = 0
            if (-not [int]::TryParse($trimmed, [ref] $port)) {
                throw "$Name contains a non-integer port: $trimmed"
            }
            $ports += $port
        }
    }
    return $ports
}

function Resolve-PublicIp {
    param([string] $Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }

    $trimmed = $Value.Trim()
    if ($trimmed -ne "auto") {
        return $trimmed
    }

    $candidates = @()
    $interfaces = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()
    foreach ($interface in $interfaces) {
        if ($interface.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) {
            continue
        }
        if ($interface.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) {
            continue
        }

        $properties = $interface.GetIPProperties()
        $hasGateway = @(($properties.GatewayAddresses | Where-Object {
            $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
            $_.Address.ToString() -ne "0.0.0.0"
        })).Count -gt 0

        foreach ($address in $properties.UnicastAddresses) {
            $ip = $address.Address
            if ($ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
                continue
            }
            $ipString = $ip.ToString()
            if ($ipString -eq "0.0.0.0" -or $ipString.StartsWith("127.") -or $ipString.StartsWith("169.254.")) {
                continue
            }
            $candidates += [pscustomobject]@{
                Address = $ipString
                HasGateway = $hasGateway
                InterfaceName = $interface.Name
            }
        }
    }

    $selected = $candidates | Sort-Object -Property @{ Expression = "HasGateway"; Descending = $true }, InterfaceName | Select-Object -First 1
    if ($selected) {
        return $selected.Address
    }

    return ""
}

function Get-SpectatorEndpointSpecs {
    $signalPorts = @(ConvertTo-PortList -Values $SpectatorSignalPorts -Name "SpectatorSignalPorts")
    $streamPorts = @(ConvertTo-PortList -Values $SpectatorStreamPorts -Name "SpectatorStreamPorts")
    if ($signalPorts.Count -ne $streamPorts.Count) {
        throw "SpectatorSignalPorts and SpectatorStreamPorts must have the same number of entries."
    }

    $endpoints = @()
    for ($i = 0; $i -lt $signalPorts.Count; $i++) {
        $endpoints += [pscustomobject]@{
            Index = $i
            SignalingPort = [int]$signalPorts[$i]
            StreamPort = [int]$streamPorts[$i]
        }
    }
    return $endpoints
}

function Test-GpuReady {
    if ($SkipGpuCheck) {
        Write-Warning "Skipping GPU preflight check."
        return
    }

    $nvidiaSmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if (-not $nvidiaSmi) {
        throw "nvidia-smi was not found. Omniverse WebRTC streaming requires a working NVIDIA GPU driver."
    }

    $output = & $nvidiaSmi.Source 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw @"
NVIDIA GPU preflight failed.

Command:
    nvidia-smi

Output:
$($output -join "`n")

Run this server from an interactive desktop session where nvidia-smi and D3D12 can initialize the GPU.
"@
    }

    Write-Host "[preflight] nvidia-smi OK"
}

Initialize-WindowsRuntimeEnvironment
$SpectatorEndpointSpecs = @(Get-SpectatorEndpointSpecs)

$resolvedUsd = $null
if (-not $SkipAutoLoad) {
    $resolvedUsd = ConvertTo-AbsolutePath -Path $UsdPath
    if (-not (Test-Path -LiteralPath $resolvedUsd -PathType Leaf)) {
        throw "USD file not found: $resolvedUsd"
    }
}

$launcher = Join-Path $RepoRoot "_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat"
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "Streaming launcher not found: $launcher. Run .\repo.bat build first."
}

Test-PortFree -Port $SignalPort
Test-PortFree -Port $StreamPort
foreach ($endpoint in $SpectatorEndpointSpecs) {
    Test-PortFree -Port $endpoint.SignalingPort
    Test-PortFree -Port $endpoint.StreamPort
}
Test-GpuReady
$resolvedPublicIp = Resolve-PublicIp -Value $PublicIp

if ($PreflightOnly) {
    if ($SkipAutoLoad) {
        Write-Host "[preflight] auto-load disabled; browser/client must send openStageRequest"
    }
    else {
        Write-Host "[preflight] USD path OK: $resolvedUsd"
    }
    Write-Host "[preflight] ports OK: $SignalPort / $StreamPort are free"
    if (-not [string]::IsNullOrWhiteSpace($resolvedPublicIp)) {
        Write-Host "[preflight] publicIp: $resolvedPublicIp"
    }
    if ($SpectatorEndpointSpecs.Count -gt 0) {
        $spectatorSummary = ($SpectatorEndpointSpecs | ForEach-Object { "spectator[$($_.Index)]=$($_.SignalingPort)/$($_.StreamPort)" }) -join ", "
        Write-Host "[preflight] spectator ports OK: $spectatorSummary"
    }
    return
}

$resolvedTraceRoot = ConvertTo-AbsolutePath -Path $TraceRoot
New-Item -ItemType Directory -Force -Path $resolvedTraceRoot | Out-Null
$resolvedPortableRoot = $null
if (-not [string]::IsNullOrWhiteSpace($PortableRoot)) {
    $resolvedPortableRoot = ConvertTo-AbsolutePath -Path $PortableRoot
    New-Item -ItemType Directory -Force -Path $resolvedPortableRoot | Out-Null
}

$args = @()
if ($NoWindow) {
    $args += "--no-window"
}
if ($resolvedPortableRoot) {
    $args += "--portable-root"
    $args += $resolvedPortableRoot
}
if ($ResetUser) {
    $args += "--reset-user"
}
if ([string]::IsNullOrWhiteSpace($env:BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS)) {
    $env:BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS = "127.0.0.1:8005,localhost:8005,127.0.0.1:49101,localhost:49101"
}
$sourceExtensions = Join-Path $RepoRoot "source\extensions"
if (Test-Path -LiteralPath $sourceExtensions -PathType Container) {
    $args += "--ext-folder"
    $args += $sourceExtensions
}
if (-not [string]::IsNullOrWhiteSpace($StreamSdkLogLevel)) {
    $args += "--/log/channels/omni.kit.livestream.streamsdk=$StreamSdkLogLevel"
}
$args += "--/exts/omni.kit.livestream.app/primaryStream/streamType=webrtc"
$args += "--/exts/omni.kit.livestream.app/primaryStream/signalPort=$SignalPort"
$args += "--/exts/omni.kit.livestream.app/primaryStream/streamPort=$StreamPort"
if (-not [string]::IsNullOrWhiteSpace($resolvedPublicIp)) {
    $args += "--/exts/omni.kit.livestream.app/primaryStream/publicIp=$resolvedPublicIp"
}
foreach ($endpoint in $SpectatorEndpointSpecs) {
    $args += "--/exts/omni.kit.livestream.app/spectatorStream/$($endpoint.Index)/streamType=webrtc"
    $args += "--/exts/omni.kit.livestream.app/spectatorStream/$($endpoint.Index)/signalPort=$($endpoint.SignalingPort)"
    $args += "--/exts/omni.kit.livestream.app/spectatorStream/$($endpoint.Index)/streamPort=$($endpoint.StreamPort)"
    if (-not [string]::IsNullOrWhiteSpace($resolvedPublicIp)) {
        $args += "--/exts/omni.kit.livestream.app/spectatorStream/$($endpoint.Index)/publicIp=$resolvedPublicIp"
    }
}
if (-not $SkipAutoLoad) {
    $kitPath = $resolvedUsd.Replace("\", "/")
    $args += "--/app/auto_load_usd=$kitPath"
}

Write-Host "[streaming] launcher: $launcher"
Write-Host "[streaming] instance: $InstanceId"
if ($SkipAutoLoad) {
    Write-Host "[streaming] USD     : auto-load disabled"
}
else {
    Write-Host "[streaming] USD     : $kitPath"
}
Write-Host "[streaming] traces  : $resolvedTraceRoot"
if ($resolvedPortableRoot) {
    Write-Host "[streaming] portable: $resolvedPortableRoot"
}
Write-Host "[streaming] ports   : $SignalPort / $StreamPort"
if (-not [string]::IsNullOrWhiteSpace($resolvedPublicIp)) {
    Write-Host "[streaming] publicIp: $resolvedPublicIp"
}
if ($SpectatorEndpointSpecs.Count -gt 0) {
    $spectatorSummary = ($SpectatorEndpointSpecs | ForEach-Object { "spectator[$($_.Index)]=$($_.SignalingPort)/$($_.StreamPort)" }) -join ", "
    Write-Host "[streaming] spect.  : $spectatorSummary"
}
if ($ResetUser) {
    Write-Host "[streaming] reset   : user settings will be reset"
}
if (-not [string]::IsNullOrWhiteSpace($StreamSdkLogLevel)) {
    Write-Host "[streaming] logs    : omni.kit.livestream.streamsdk=$StreamSdkLogLevel"
}
Write-Host "[streaming] starting Kit. Press Ctrl+C to stop."

Push-Location -LiteralPath $resolvedTraceRoot
try {
    & $launcher @args
}
finally {
    Pop-Location
}
