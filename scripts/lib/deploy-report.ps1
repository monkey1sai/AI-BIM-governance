# scripts\lib\deploy-report.ps1
# 統一輸出格式 wrapper。每行 [ok   ]/[fix  ]/[ask  ]/[skip ]/[warn ]/[fail ] 6 級 tag。
# 同時寫進 deploy.log,供 Final Summary 連回。

Set-StrictMode -Version Latest

$script:DeployTagDefinitions = @{
    'ok'   = @{ Display = '[ok   ]'; Color = 'Green';      IsFail = $false }
    'fix'  = @{ Display = '[fix  ]'; Color = 'Cyan';       IsFail = $false }
    'ask'  = @{ Display = '[ask  ]'; Color = 'Yellow';     IsFail = $false }
    'skip' = @{ Display = '[skip ]'; Color = 'DarkGray';   IsFail = $false }
    'warn' = @{ Display = '[warn ]'; Color = 'Yellow';     IsFail = $false }
    'fail' = @{ Display = '[fail ]'; Color = 'Red';        IsFail = $true  }
}

function Write-DeployTag {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('ok','fix','ask','skip','warn','fail')]
        [string] $Tag,
        [Parameter(Mandatory = $true)][string] $Message,
        [Parameter(Mandatory = $true)][string] $LogPath
    )

    if (-not $script:DeployTagDefinitions.ContainsKey($Tag)) {
        throw "unknown deploy tag: $Tag"
    }
    $def = $script:DeployTagDefinitions[$Tag]
    $line = "$($def.Display) $Message"

    # 確保 log 目錄存在
    $logDir = Split-Path -Parent $LogPath
    if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    Write-Host $line -ForegroundColor $def.Color
    $timestamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')
    Add-Content -LiteralPath $LogPath -Value "$timestamp $line"

    return [pscustomobject]@{
        Tag     = $Tag
        Message = $Message
        IsFail  = $def.IsFail
    }
}

function Write-DeployHeader {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Title)
    $bar = '=' * 60
    Write-Host ''
    Write-Host $bar -ForegroundColor Cyan
    Write-Host $Title -ForegroundColor Cyan
    Write-Host $bar -ForegroundColor Cyan
}
