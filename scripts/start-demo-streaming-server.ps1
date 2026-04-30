[CmdletBinding()]
param(
    [switch] $SkipGpuCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$StreamingRoot = Join-Path $RepoRoot "bim-streaming-server"

$args = @("-SkipAutoLoad", "-ResetUser", "-StreamSdkLogLevel", "info")
if ($SkipGpuCheck) {
    $args += "-SkipGpuCheck"
}

Write-Host "[demo-streaming] starting Kit with reset-user recovery settings"
Write-Host "[demo-streaming] command: bim-streaming-server\scripts\start-streaming-server.ps1 $($args -join ' ')"

Push-Location -LiteralPath $StreamingRoot
try {
    & ".\scripts\start-streaming-server.ps1" @args
}
finally {
    Pop-Location
}
