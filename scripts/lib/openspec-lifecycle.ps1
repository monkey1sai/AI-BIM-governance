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

# Canonical task-checkbox counting. MUST stay behaviourally identical for ALL inputs (including
# non-ASCII) to `taskLedgerFromText` in scripts/lib/openspec-machine-truth.mjs — the two are
# implementations of one contract, cross-checked by the golden corpus
# scripts/tests/fixtures/task-ledger-parity.json. Spec (per line):
#   1. candidate = ^[ \t]*-[ \t]+\[<mark>\]<after?>
#   2. mark 長度 != 1        → 非 checkbox（`- []`、`- [WIP] foo`、`- [text](url)`）
#   3. after 為 `(`          → 非 checkbox（markdown link `- [x](url)`）
#   4. after 非空且非空白    → 畸形 checkbox（`- [x]done`）→ unsupported（fail-closed，不得靜默消失）
#   5. 否則 x/X→completed+total、空白→total、其餘單字元→unsupported
# 逐行解析是必要的：舊版 '(?m)…(?:\s+|$)' 的尾端貪婪 \s+ 會吃掉下一行縮排，使緊接的巢狀
# checkbox 從 Total 消失——未完成 task 因而可能通過 verify-openspec-lifecycle 的 archive gate。
# 明確列舉的空白字元集，等值於 JavaScript 的 \s。刻意不用 \s shorthand：.NET 的 \s 含
# U+0085 (NEL) 而 JS 的不含，用 shorthand 會讓兩套實作在該字元上分歧。全部以 \uXXXX 轉義
# 書寫，source 內不得出現不可見字元。
$script:OpenSpecCheckboxAfterWhitespacePattern =
    '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$'

function Measure-OpenSpecTaskCheckboxes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Text
    )

    $completed = 0
    $total = 0
    $unsupported = 0
    foreach ($line in ($Text -split "`r?`n")) {
        $match = [regex]::Match($line, '^[ \t]*-[ \t]+\[(?<mark>[^\]]*)\](?<after>.?)')
        if (-not $match.Success) { continue }
        $mark = $match.Groups['mark'].Value
        if ($mark.Length -ne 1) {
            # 長度 >= 2 且僅由空白與單一 x/X 組成者是「真 checkbox 的錯字」（`- [ x]`、`- [x ]`、
            # `- [  ]`），必須 fail-closed，否則又是一條靜默消失路徑。其餘（`- [ab]`、
            # `- [WIP] foo`、`- [text](url)`）是 prose，不計。長度 0（`- []`）不計。
            if ($mark.Length -ge 2 -and $mark -cmatch '^[ \t]*[xX]?[ \t]*$') { $unsupported++ }
            continue
        }
        # 比較一律用 ordinal：PowerShell 的 -eq/-ne 是 culture-sensitive 語言比較，任何
        # zero-collation-weight 字元（ZWSP U+200B、SOFT HYPHEN U+00AD、ZWJ U+200D、
        # VARIATION SELECTOR U+FE0F…）都會與空字串「相等」，畸形守衛因此被跳過而誤計為完成；
        # -cne 也修不了（僅 -ceq 能修 `(` 那條）。同理 -eq '(' 會讓 U+207D 等被當成 markdown link。
        # 空白類別寫成明確字元集而不用 \s：.NET 的 \s 含 U+0085(NEL)，JS 的 \s 不含，
        # 用 shorthand 會讓兩套實作在 327 個 BMP code point 上分歧。此集合等於 JS 的 \s。
        $after = $match.Groups['after'].Value
        if ($after.Length -ne 0) {
            if ([string]::Equals($after, '(', [System.StringComparison]::Ordinal)) { continue }
            if ($after -cnotmatch $script:OpenSpecCheckboxAfterWhitespacePattern) { $unsupported++; continue }
        }
        if ($mark -ceq 'x' -or $mark -ceq 'X') { $completed++; $total++ }
        elseif ($mark -ceq ' ') { $total++ }
        else { $unsupported++ }
    }

    return [pscustomobject]@{
        Completed   = $completed
        Total       = $total
        Unsupported = $unsupported
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
    $measured = Measure-OpenSpecTaskCheckboxes -Text $content

    return [pscustomobject]@{
        Exists                = $true
        Completed             = $measured.Completed
        Total                 = $measured.Total
        Unchecked             = $measured.Total - $measured.Completed
        UnsupportedCheckboxes = $measured.Unsupported
    }
}
