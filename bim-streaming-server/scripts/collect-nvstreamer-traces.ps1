param(
    [string] $TraceRoot = ".\logs\nvstreamer"
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

function ConvertTo-AbsolutePath {
    param([Parameter(Mandatory = $true)][string] $Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

$resolvedTraceRoot = ConvertTo-AbsolutePath -Path $TraceRoot
New-Item -ItemType Directory -Force -Path $resolvedTraceRoot | Out-Null

$rootTraces = @(Get-ChildItem -LiteralPath $RepoRoot -File -Filter "*-NvStreamer.etl")
if ($rootTraces.Count -eq 0) {
    Write-Host "[nvstreamer] no root ETL traces found"
    Write-Host "[nvstreamer] trace root: $resolvedTraceRoot"
    return
}

$moved = 0
$skipped = 0
foreach ($trace in $rootTraces) {
    $destination = Join-Path $resolvedTraceRoot $trace.Name
    try {
        Move-Item -LiteralPath $trace.FullName -Destination $destination -Force
        $moved += 1
    }
    catch {
        $skipped += 1
        Write-Warning "Skipped '$($trace.Name)': $($_.Exception.Message)"
    }
}

Write-Host "[nvstreamer] moved traces : $moved"
Write-Host "[nvstreamer] skipped      : $skipped"
Write-Host "[nvstreamer] trace root   : $resolvedTraceRoot"
