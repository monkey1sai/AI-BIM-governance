[CmdletBinding()]
param(
    [string] $EnvFile = "",
    [string] $ConversionJobId = "",
    [string] $ConversionApiBase = "",
    [int] $TimeoutSeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-HybridEnvFile {
    param([string] $Requested)
    if (-not [string]::IsNullOrWhiteSpace($Requested)) {
        if (-not (Test-Path -LiteralPath $Requested)) {
            throw "env_file_missing: $Requested"
        }
        return $Requested
    }
    if (Test-Path -LiteralPath ".env.web-plane.host-kit") {
        return ".env.web-plane.host-kit"
    }
    return ".env.web-plane.host-kit.example"
}

function Normalize-EnvValue {
    param([string] $Raw)
    $value = $Raw.Trim()
    if ($value.Length -eq 0) { return "" }
    $first = $value.Substring(0, 1)
    if ($first -eq '"' -or $first -eq "'") {
        if ($value.Length -ge 2 -and $value.EndsWith($first)) {
            return $value.Substring(1, $value.Length - 2)
        }
        return $value.Trim($first)
    }
    $comment = [regex]::Match($value, "\s+#")
    if ($comment.Success) {
        $value = $value.Substring(0, $comment.Index).TrimEnd()
    }
    return $value
}

function Read-EnvFile {
    param([string] $Path)
    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $values
    }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) { continue }
        $idx = $trimmed.IndexOf("=")
        if ($idx -le 0) { continue }
        $name = $trimmed.Substring(0, $idx).Trim()
        $value = Normalize-EnvValue -Raw $trimmed.Substring($idx + 1)
        $values[$name] = $value
    }
    return $values
}

function Value-OrDefault {
    param(
        [hashtable] $Values,
        [string] $Name,
        [string] $Default
    )
    $envValue = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue }
    if ($Values.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace([string]$Values[$Name])) {
        return [string]$Values[$Name]
    }
    return $Default
}

function Get-ComposeArgs {
    param([string] $ResolvedEnvFile)
    return @(
        "compose",
        "-f", "compose.runtime-manager.yml",
        "-f", "compose.host-kit.yml",
        "--env-file", $ResolvedEnvFile
    )
}

function Test-Http {
    param([string] $Tier, [string] $Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) {
            Write-Host "[ok] $Tier $Url http_status=$($r.StatusCode)" -ForegroundColor Green
            return $true
        }
        Write-Host "[fail] $Tier $Url http_status=$($r.StatusCode)" -ForegroundColor Red
        return $false
    }
    catch {
        Write-Host "[blocked] $Tier $Url :: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

function Test-TcpPort {
    param([string] $Tier, [string] $HostName, [int] $Port)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync($HostName, $Port)
        if (-not $task.Wait($TimeoutSeconds * 1000)) {
            Write-Host "[blocked] $Tier ${HostName}:$Port timeout not_observed" -ForegroundColor Yellow
            return $false
        }
        Write-Host "[ok] $Tier ${HostName}:$Port tcp_connect" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "[blocked] $Tier ${HostName}:$Port :: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Classify-BridgeFailure {
    param([string] $Output)
    if ($Output -match "ENOTFOUND|Name or service not known|Could not resolve") { return "dns" }
    if ($Output -match "ECONNREFUSED|actively refused|Connection refused") { return "bind-host-or-service-down" }
    if ($Output -match "ETIMEDOUT|timed out|EHOSTUNREACH|ENETUNREACH") { return "route-or-firewall" }
    return "unknown"
}

function Get-OptionalPropertyValue {
    param([object] $InputObject, [string] $Name)
    if ($null -eq $InputObject) { return $null }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-ArtifactUrl {
    param([object] $Artifacts, [string] $Role)
    $artifact = Get-OptionalPropertyValue -InputObject $Artifacts -Name $Role
    return Get-OptionalPropertyValue -InputObject $artifact -Name "url"
}

function Test-ContainerToHostConversion {
    param([string[]] $ComposeArgs, [string] $HostBridgeProfile)
    $probeJs = @'
const base = (process.env.STREAMING_CONVERSION_API_BASE || process.env.CONVERSION_API_BASE || "").replace(/\/+$/, "");
if (!base) {
  console.error(JSON.stringify({ ok: false, error: "missing_conversion_base" }));
  process.exit(2);
}
fetch(base + "/health", { signal: AbortSignal.timeout(5000) })
  .then(async (res) => {
    const text = await res.text();
    let body = {};
    try { body = JSON.parse(text); } catch (_) {}
    if (!res.ok) {
      console.error(JSON.stringify({ ok: false, base, status: res.status, body }));
      process.exit(3);
    }
    console.log(JSON.stringify({
      ok: true,
      base,
      authority: body.authority || null,
      role: body.role || null
    }));
  })
  .catch((err) => {
    console.error(JSON.stringify({ ok: false, base, error: err && err.message ? err.message : String(err) }));
    process.exit(4);
  });
'@
    $execArgs = $ComposeArgs + @("exec", "-T", "coordinator", "node", "-e", $probeJs)
    $output = docker @execArgs 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[ok] container_to_host_conversion profile=$HostBridgeProfile $($output | Select-Object -First 1)" -ForegroundColor Green
        return $true
    }
    $kind = Classify-BridgeFailure -Output ($output -join "`n")
    Write-Host "[blocked] container_to_host_conversion profile=$HostBridgeProfile blocker=$kind" -ForegroundColor Yellow
    Write-Host "        next: start host conversion service or adjust HOST_CONVERSION_API_BASE / bind host / firewall" -ForegroundColor Yellow
    return $false
}

function Test-RuntimeVisibleArtifactRefs {
    param([string] $BaseUrl, [string] $JobId)
    if ([string]::IsNullOrWhiteSpace($JobId)) {
        Write-Host "[info] runtime_visible_artifact_refs not_observed no_conversion_job_id" -ForegroundColor Cyan
        return
    }
    try {
        $result = Invoke-RestMethod -Method Get -Uri "$($BaseUrl.TrimEnd('/'))/api/conversions/$JobId/result" -TimeoutSec $TimeoutSeconds
    }
    catch {
        Write-Host "[blocked] runtime_visible_artifact_refs result_unreachable :: $($_.Exception.Message)" -ForegroundColor Yellow
        return
    }
    if ($result.status -notin @("succeeded", "succeeded_with_warnings")) {
        Write-Host "[blocked] runtime_visible_artifact_refs conversion_status=$($result.status)" -ForegroundColor Yellow
        return
    }
    $artifacts = Get-OptionalPropertyValue -InputObject $result -Name "artifacts"
    $refs = @(
        @{ name = "model.usdc"; value = Get-ArtifactUrl -Artifacts $artifacts -Role "model_usdc" },
        @{ name = "element_mapping.json"; value = Get-ArtifactUrl -Artifacts $artifacts -Role "element_mapping" },
        @{ name = "entity_index.json"; value = Get-ArtifactUrl -Artifacts $artifacts -Role "entity_index" },
        @{ name = "metadata.json"; value = Get-ArtifactUrl -Artifacts $artifacts -Role "metadata" }
    )
    foreach ($ref in $refs) {
        if ([string]::IsNullOrWhiteSpace([string]$ref.value)) {
            Write-Host "[blocked] runtime_visible_artifact_refs missing=$($ref.name)" -ForegroundColor Yellow
            continue
        }
        [void](Test-Http -Tier "runtime_visible_artifact_refs:$($ref.name)" -Url ([string]$ref.value))
    }
}

$resolvedEnvFile = Resolve-HybridEnvFile -Requested $EnvFile
$envValues = Read-EnvFile -Path $resolvedEnvFile
$hostBridgeProfile = Value-OrDefault -Values $envValues -Name "HOST_BRIDGE_PROFILE" -Default "windows-docker-desktop"
$coordinatorPort = Value-OrDefault -Values $envValues -Name "COORDINATOR_PORT" -Default "8004"
$viewerPort = Value-OrDefault -Values $envValues -Name "VIEWER_PORT" -Default "5173"
$kitHost = Value-OrDefault -Values $envValues -Name "KIT_SIGNALING_HOST" -Default "127.0.0.1"
$kitPortRaw = Value-OrDefault -Values $envValues -Name "KIT_SIGNALING_PORT" -Default "49100"
$kitPort = 49100
$parsedKitPort = 0
if ([int]::TryParse($kitPortRaw, [ref]$parsedKitPort)) {
    $kitPort = $parsedKitPort
}

if ([string]::IsNullOrWhiteSpace($ConversionApiBase)) {
    $ConversionApiBase = Value-OrDefault -Values $envValues -Name "STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL" -Default "http://127.0.0.1:49101/artifacts"
    $ConversionApiBase = $ConversionApiBase -replace "/artifacts/?$", ""
}

Write-Host "[info] hybrid_mode=web-plane-docker-host-native-kit" -ForegroundColor Cyan
Write-Host "[info] env_file=$resolvedEnvFile" -ForegroundColor Cyan
Write-Host "[info] host_bridge_profile=$hostBridgeProfile" -ForegroundColor Cyan

$composeArgs = Get-ComposeArgs -ResolvedEnvFile $resolvedEnvFile
[void](Test-Http -Tier "docker_web_plane_health:coordinator" -Url "http://127.0.0.1:$coordinatorPort/health")
[void](Test-Http -Tier "docker_web_plane_health:viewer" -Url "http://127.0.0.1:$viewerPort")
[void](Test-ContainerToHostConversion -ComposeArgs $composeArgs -HostBridgeProfile $hostBridgeProfile)
[void](Test-TcpPort -Tier "host_native_kit_probe" -HostName $kitHost -Port $kitPort)
Test-RuntimeVisibleArtifactRefs -BaseUrl $ConversionApiBase -JobId $ConversionJobId

Write-Host "[info] note=hybrid checks do not prove Docker GPU Kit readiness or browser visual render" -ForegroundColor Cyan
