[CmdletBinding()]
param(
    [switch] $WithGpu
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-Http {
    param([string] $Name, [string] $Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) {
            Write-Host "[ok] $Name $Url" -ForegroundColor Green
            return
        }
        Write-Host "[fail] $Name HTTP $($r.StatusCode)" -ForegroundColor Red
    } catch {
        Write-Host "[blocked] $Name $Url :: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Test-Http "bim-control" "http://127.0.0.1:8001/health"
Test-Http "worker" "http://127.0.0.1:8005/health"
Test-Http "coordinator" "http://127.0.0.1:8004/health"
Test-Http "viewer" "http://127.0.0.1:5173"
Test-Http "kit-manager-api" "http://127.0.0.1:8010/health"
Test-Http "kit-manager-web" "http://127.0.0.1:5174"

if ($WithGpu) {
    Write-Host "[info] GPU container logs:" -ForegroundColor Cyan
    docker compose -f compose.runtime-manager.yml --env-file .env.runtime-manager.docker --profile gpu logs --tail 80 streaming-server
}
