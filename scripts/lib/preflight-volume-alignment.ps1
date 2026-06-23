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
            if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
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

    $status = if ($leaf -ieq 'storage') { 'ALIGNED' } else { 'WRONG_LEAF' }

    return [pscustomobject]@{
        runtimeStorageRoot = $resolved
        leaf               = $leaf
        status             = $status
    }
}

# 把 RUNTIME_STORAGE_ROOT 正規化成 host 絕對路徑(正斜線),供 start-web-plane-docker.ps1
# 在跑 docker compose 前注入 process env。
#
# 為何必要:此值經 compose 透傳成容器內 STORAGE_HOST_ROOT,coordinator 寫進 ifc-ready
# dispatch payload 的 host_local_path,供 host-native streaming-server 從 host fs 直接讀。
# 相對值(如 ./storage)會被 conversion adapter(_try_local_path)對其 storage_root 二次
# 解析成 <storage_root>/storage/...(double-nest)→ 找不到檔 → fallback 到容器路徑 →
# 逃出 storage_root → 轉檔回 invalid_ifc_input(所有 ifc-ready 轉檔全失敗)。
# docker compose 變數插值「shell env 優先於 --env-file」,故注入此絕對值即覆蓋 .env 相對值。
# 正斜線:避免 Windows 磁碟機冒號(D:\)干擾 compose volume 短語法的 host:container 分隔。
function Resolve-AbsoluteStorageRoot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Raw
    )
    $value = $Raw.Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw 'RUNTIME_STORAGE_ROOT must not be empty.'
    }
    if (-not [System.IO.Path]::IsPathRooted($value)) {
        $value = Join-Path $RepoRoot $value
    }
    $value = [System.IO.Path]::GetFullPath($value)
    return ($value -replace '\\', '/')
}
