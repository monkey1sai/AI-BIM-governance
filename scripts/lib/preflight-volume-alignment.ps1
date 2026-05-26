# scripts\lib\preflight-volume-alignment.ps1
# Preflight: Volume 對齊(方案 A,spec §7.4)。
# Ground truth = .env.web-plane.host-kit 的 RUNTIME_STORAGE_ROOT。
# Read-only。
# 相對路徑(./xxx)以 RepoRoot 為基底解析成絕對路徑。

Set-StrictMode -Version Latest

function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Key
    )
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
        $idx = $trimmed.IndexOf('=')
        if ($idx -le 0) { continue }
        $name = $trimmed.Substring(0, $idx).Trim()
        if ($name -eq $Key) {
            $value = $trimmed.Substring($idx + 1).Trim()
            # 剝引號
            if ($value.Length -ge 2) {
                $first = $value.Substring(0, 1)
                if (($first -eq '"' -or $first -eq "'") -and $value.EndsWith($first)) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
            }
            # 剝 trailing comment
            $comment = [regex]::Match($value, '\s+#')
            if ($comment.Success) {
                $value = $value.Substring(0, $comment.Index).TrimEnd()
            }
            if ($value) { return $value } else { return $null }
        }
    }
    return $null
}

function Test-VolumeAlignment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $EnvFile = '.env.web-plane.host-kit'
    )

    $envPath = Join-Path $RepoRoot $EnvFile
    $raw = Get-EnvValue -Path $envPath -Key 'RUNTIME_STORAGE_ROOT'

    if ([string]::IsNullOrWhiteSpace($raw)) {
        return [pscustomobject]@{
            runtimeStorageRoot = $null
            leaf               = $null
            status             = 'MISSING_KEY'
        }
    }

    # 相對路徑 → 以 RepoRoot 為基底 resolve
    $resolved = $raw
    if (-not [System.IO.Path]::IsPathRooted($resolved)) {
        $resolved = (Join-Path $RepoRoot $resolved)
    }
    # 規範化(去 ./ 與 ..\)
    try {
        $resolved = [System.IO.Path]::GetFullPath($resolved)
    } catch {
        # 留原值
    }

    $leaf = Split-Path -Leaf $resolved

    $status = if ($leaf -eq 'storage') { 'ALIGNED' } else { 'WRONG_LEAF' }

    return [pscustomobject]@{
        runtimeStorageRoot = $resolved
        leaf               = $leaf
        status             = $status
    }
}
