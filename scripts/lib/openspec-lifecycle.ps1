Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Throw-OpenSpecLifecycleError {
    param(
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Message
    )

    $exception = [System.IO.InvalidDataException]::new($Message)
    $exception.Data['LedgerErrorCode'] = $Code
    throw $exception
}

function Test-OpenSpecReparsePoint {
    param([Parameter(Mandatory = $true)] $Item)

    return (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Test-OpenSpecContainedPath {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string] $Candidate
    )

    $comparison = if ($IsWindows) {
        [System.StringComparison]::OrdinalIgnoreCase
    } else {
        [System.StringComparison]::Ordinal
    }
    $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $normalizedCandidate = [System.IO.Path]::GetFullPath($Candidate)
    $prefix = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
    return $normalizedCandidate.StartsWith($prefix, $comparison)
}

function Assert-OpenSpecNoReparseComponents {
    param(
        [Parameter(Mandatory = $true)][string] $Anchor,
        [Parameter(Mandatory = $true)][string] $Target,
        [Parameter(Mandatory = $true)][string] $Label,
        [Parameter(Mandatory = $true)][string] $UnreadableCode,
        [Parameter(Mandatory = $true)][string] $ReparseCode,
        [switch] $LeafMustBeFile
    )

    $anchorFull = [System.IO.Path]::GetFullPath($Anchor)
    $targetFull = [System.IO.Path]::GetFullPath($Target)
    $relative = [System.IO.Path]::GetRelativePath($anchorFull, $targetFull)
    if (
        [System.IO.Path]::IsPathRooted($relative) -or
        $relative -eq '..' -or
        $relative.StartsWith(('..' + [System.IO.Path]::DirectorySeparatorChar), [System.StringComparison]::Ordinal)
    ) {
        Throw-OpenSpecLifecycleError -Code $UnreadableCode -Message "$Label is outside its trusted path boundary."
    }

    $current = $anchorFull
    $segments = @($relative -split '[\\/]+' | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne '.'
    })
    $paths = @($anchorFull)
    foreach ($segment in $segments) {
        $current = Join-Path $current $segment
        $paths += $current
    }

    foreach ($component in $paths) {
        try {
            $item = Get-Item -LiteralPath $component -Force -ErrorAction Stop
        } catch {
            Throw-OpenSpecLifecycleError -Code $UnreadableCode -Message "$Label is not readable."
        }
        if (Test-OpenSpecReparsePoint -Item $item) {
            Throw-OpenSpecLifecycleError -Code $ReparseCode -Message "$Label must not traverse a reparse point."
        }
    }

    if ($LeafMustBeFile) {
        $leaf = Get-Item -LiteralPath $targetFull -Force
        if ($leaf.PSIsContainer) {
            Throw-OpenSpecLifecycleError -Code $UnreadableCode -Message "$Label must be a file."
        }
    }
    return $targetFull
}

function Get-OpenSpecFinalWindowsPath {
    param([Parameter(Mandatory = $true)][System.IO.FileStream] $Stream)

    if (-not $IsWindows) { return $null }
    if ($null -eq ([System.Management.Automation.PSTypeName]'OpenSpecFileNative').Type) {
        Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class OpenSpecFileNative
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetFinalPathNameByHandle(
        SafeFileHandle file,
        StringBuilder path,
        uint pathLength,
        uint flags);
}
'@
    }

    $builder = [System.Text.StringBuilder]::new(32768)
    $length = [OpenSpecFileNative]::GetFinalPathNameByHandle(
        $Stream.SafeFileHandle,
        $builder,
        [uint32]$builder.Capacity,
        0
    )
    if ($length -eq 0 -or $length -ge $builder.Capacity) {
        Throw-OpenSpecLifecycleError -Code 'repository_reparse_point' `
            -Message 'Unable to verify the physical OpenSpec artifact path.'
    }

    $path = $builder.ToString()
    if ($path.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return '\\' + $path.Substring(8)
    }
    if ($path.StartsWith('\\?\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $path.Substring(4)
    }
    return $path
}

function Assert-OpenSpecHandleContained {
    param(
        [Parameter(Mandatory = $true)][System.IO.FileStream] $Stream,
        [Parameter(Mandatory = $true)][string] $TrustedRoot,
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Label
    )

    $finalPath = Get-OpenSpecFinalWindowsPath -Stream $Stream
    if ($null -ne $finalPath -and -not (Test-OpenSpecContainedPath -Root $TrustedRoot -Candidate $finalPath)) {
        Throw-OpenSpecLifecycleError -Code $Code -Message "$Label resolved outside its trusted root."
    }
}

function Read-OpenSpecLifecycleFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $TrustedRoot,
        [int64] $MaxBytes = 2097152
    )

    $Path = Assert-OpenSpecNoReparseComponents -Anchor $TrustedRoot -Target $Path `
        -Label 'OpenSpec artifact' -UnreadableCode 'repository_unreadable' `
        -ReparseCode 'repository_reparse_point' -LeafMustBeFile
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Length -gt $MaxBytes) {
        Throw-OpenSpecLifecycleError -Code 'repository_artifact_too_large' `
            -Message 'OpenSpec artifact exceeds the read-size limit.'
    }

    $stream = [System.IO.FileStream]::new(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read
    )
    try {
        [void](Assert-OpenSpecNoReparseComponents -Anchor $TrustedRoot -Target $Path `
            -Label 'OpenSpec artifact' -UnreadableCode 'repository_unreadable' `
            -ReparseCode 'repository_reparse_point' -LeafMustBeFile)
        Assert-OpenSpecHandleContained -Stream $stream -TrustedRoot $TrustedRoot `
            -Code 'repository_reparse_point' -Label 'OpenSpec artifact'
        if ($stream.Length -gt $MaxBytes) {
            Throw-OpenSpecLifecycleError -Code 'repository_artifact_too_large' `
                -Message 'OpenSpec artifact exceeds the read-size limit.'
        }
        $reader = [System.IO.StreamReader]::new(
            $stream,
            [System.Text.UTF8Encoding]::new($false, $true),
            $true,
            4096,
            $true
        )
        try {
            return $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Get-OpenSpecProposalState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $ChangeDirectory,
        [Parameter(Mandatory = $true)][string] $TrustedRoot
    )

    [void](Assert-OpenSpecNoReparseComponents -Anchor $TrustedRoot -Target $ChangeDirectory `
        -Label 'OpenSpec change directory' -UnreadableCode 'repository_unreadable' `
        -ReparseCode 'repository_reparse_point')
    $proposalPath = Join-Path $ChangeDirectory 'proposal.md'
    if (-not (Test-Path -LiteralPath $proposalPath -PathType Leaf)) {
        return [pscustomobject]@{
            Exists         = $false
            IsDeferred     = $false
            HasCondition   = $false
            LifecycleStatus = 'missing'
            RawStatus      = $null
            MarkerCount    = 0
        }
    }

    $content = Read-OpenSpecLifecycleFile -Path $proposalPath -TrustedRoot $TrustedRoot
    $prologue = @([regex]::Split($content, '(?m)^##\s+', 2))[0]
    $markers = @([regex]::Matches(
        $prologue,
        '(?im)^>\s*\*\*Status:\s*(?<status>[a-z][a-z0-9-]*)\b[^\r\n]*'
    ))

    $statusValues = @($markers | ForEach-Object {
        $_.Groups['status'].Value.ToLowerInvariant()
    })
    $rawStatus = $null
    $lifecycleStatus = 'active'
    if ($markers.Count -eq 1) {
        $rawStatus = $statusValues[0]
        switch ($statusValues[0]) {
            'active' { $lifecycleStatus = 'active' }
            'deferred' { $lifecycleStatus = 'deferred' }
            'deferred-proposed' { $lifecycleStatus = 'deferred' }
            default { $lifecycleStatus = 'invalid' }
        }
    } elseif ($markers.Count -gt 1) {
        $rawStatus = $statusValues -join ','
        $lifecycleStatus = 'invalid'
    }
    if ($null -ne $rawStatus -and $rawStatus.Length -gt 128) {
        $rawStatus = $rawStatus.Substring(0, 128)
    }

    $hasDeferredMarker = @($statusValues | Where-Object {
        $_ -in @('deferred', 'deferred-proposed')
    }).Count -gt 0
    return [pscustomobject]@{
        Exists          = $true
        IsDeferred      = $lifecycleStatus -eq 'deferred' -or $hasDeferredMarker
        HasCondition    = $content -match '(重啟|解凍|thaw|closeout)'
        LifecycleStatus = $lifecycleStatus
        RawStatus       = $rawStatus
        MarkerCount     = $markers.Count
    }
}

function Get-OpenSpecTaskLedger {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $ChangeDirectory,
        [Parameter(Mandatory = $true)][string] $TrustedRoot
    )

    [void](Assert-OpenSpecNoReparseComponents -Anchor $TrustedRoot -Target $ChangeDirectory `
        -Label 'OpenSpec change directory' -UnreadableCode 'repository_unreadable' `
        -ReparseCode 'repository_reparse_point')
    $tasksPath = Join-Path $ChangeDirectory 'tasks.md'
    if (-not (Test-Path -LiteralPath $tasksPath -PathType Leaf)) {
        return [pscustomobject]@{
            Exists                = $false
            Completed             = 0
            Total                 = 0
            Unchecked             = 0
            UnsupportedCheckboxes = 0
        }
    }

    $content = Read-OpenSpecLifecycleFile -Path $tasksPath -TrustedRoot $TrustedRoot
    $checkboxes = @([regex]::Matches(
        $content,
        '(?m)^\s*-\s+\[(?<mark>[ xX])\](?:\s+|$)'
    ))
    $completed = @($checkboxes | Where-Object {
        $_.Groups['mark'].Value -match '[xX]'
    }).Count
    $unsupported = @([regex]::Matches(
        $content,
        '(?m)^\s*-\s+\[(?<mark>[^\]\r\n]+)\](?:\s+|$)'
    ) | Where-Object {
        $_.Groups['mark'].Value -notmatch '^[ xX]$'
    }).Count

    return [pscustomobject]@{
        Exists                = $true
        Completed             = $completed
        Total                 = $checkboxes.Count
        Unchecked             = $checkboxes.Count - $completed
        UnsupportedCheckboxes = $unsupported
    }
}
