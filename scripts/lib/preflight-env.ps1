# scripts\lib\preflight-env.ps1
# Preflight: .env / .env.example missing-key audit。Read-only。
# Get-EnvKeyList 採用 start-web-plane-docker.ps1 既有風格(支援 = 與 : 分隔、註解、
# 雙引號/單引號剝離),但簡化成只回 key 列表(因為我們只看 missing key,不看 value)。

Set-StrictMode -Version Latest

function Get-EnvKeyList {
    param([Parameter(Mandatory = $true)][string] $Path)
    $keys = @()
    if (-not (Test-Path -LiteralPath $Path)) { return $keys }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
        $eq    = $trimmed.IndexOf('=')
        $colon = $trimmed.IndexOf(':')
        $candidates = @(@($eq, $colon) | Where-Object { $_ -gt 0 } | Sort-Object)
        if ($candidates.Count -eq 0) { continue }
        $idx = [int]$candidates[0]
        $name = $trimmed.Substring(0, $idx).Trim()
        if ($name) { $keys += $name }
    }
    return $keys
}

function Get-EnvExampleDefaultValue {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Key
    )
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $escapedKey = [regex]::Escape($Key)
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match "^\s*$escapedKey\s*[:=]\s*(.*)$") {
            $value = $Matches[1].Trim()
            if (
                $value.Length -ge 2 -and
                (
                    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                    ($value.StartsWith("'") -and $value.EndsWith("'"))
                )
            ) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }
    return ''
}

function Get-EnvAudit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $EnvPath,
        [Parameter(Mandatory = $true)][string] $ExamplePath
    )
    $envExists     = Test-Path -LiteralPath $EnvPath
    $exampleExists = Test-Path -LiteralPath $ExamplePath
    $envKeys       = if ($envExists)     { Get-EnvKeyList -Path $EnvPath }     else { @() }
    $exampleKeys   = if ($exampleExists) { Get-EnvKeyList -Path $ExamplePath } else { @() }
    $missing       = @($exampleKeys | Where-Object { $_ -notin $envKeys })

    return [pscustomobject]@{
        envExists     = $envExists
        exampleExists = $exampleExists
        missing       = $missing
    }
}

function Test-EnvFiles {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $RepoRoot)

    $targets = @(
        @{ file = '.env';                          envPath = Join-Path $RepoRoot '.env';                          examplePath = Join-Path $RepoRoot '.env.example' },
        @{ file = 'bim-review-coordinator/.env';   envPath = Join-Path $RepoRoot 'bim-review-coordinator\.env';   examplePath = Join-Path $RepoRoot 'bim-review-coordinator\.env.example' },
        @{ file = '.env.web-plane.host-kit';       envPath = Join-Path $RepoRoot '.env.web-plane.host-kit';       examplePath = Join-Path $RepoRoot '.env.web-plane.host-kit.example' }
    )

    $results = @()
    foreach ($t in $targets) {
        $audit = Get-EnvAudit -EnvPath $t.envPath -ExamplePath $t.examplePath
        $results += [pscustomobject]@{
            file          = $t.file
            envExists     = $audit.envExists
            exampleExists = $audit.exampleExists
            missing       = $audit.missing
        }
    }
    return $results
}
