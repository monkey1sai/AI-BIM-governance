<#
.SYNOPSIS
Produces a deterministic, read-only OpenSpec lifecycle inventory and mismatch report.

.DESCRIPTION
P0-1a intentionally does not modify proposal.md, tasks.md, NOW.md, GitHub, git state,
or a machine ledger. Inventory and Reconcile execute the same observations; Inventory
always exits 0 when inputs are readable, while Reconcile exits 2 when mismatches exist.
Input or tool failures emit the same JSON envelope and exit 3.

.PARAMETER LedgerPath
Optional repository-contained JSON file conforming to
openspec-lifecycle-ledger.schema.json. No default ledger is created or inferred.

.PARAMETER OpenSpecListJsonPath
Optional repository-contained fixture captured from `openspec list --json`. When
omitted, OpenSpecExecutablePath and OpenSpecExecutableSha256 are required.

.PARAMETER OpenSpecExecutablePath
Explicit absolute path to a non-repository openspec executable or PowerShell shim.
The command rejects PATH discovery and requires OpenSpec 1.6.0.

.PARAMETER OpenSpecExecutableSha256
Expected lowercase or uppercase SHA-256 for OpenSpecExecutablePath.

.PARAMETER OpenSpecTrustedRoot
Base-controlled absolute directory that is allowed to contain the pinned OpenSpec
executable. UNC, device, repository-contained, temporary and reparse paths are rejected.

.PARAMETER NodeExecutablePath
Explicit absolute path to the Node runtime used by a pinned OpenSpec PowerShell shim.
Command mode never discovers Node through the ambient PATH.

.PARAMETER NodeExecutableSha256
Expected SHA-256 for NodeExecutablePath.

.PARAMETER NodeTrustedRoot
Base-controlled absolute directory that is allowed to contain the pinned Node runtime.

.EXAMPLE
$tool = 'C:\trusted\openspec.ps1'
$hash = (Get-FileHash -LiteralPath $tool -Algorithm SHA256).Hash
$node = 'C:\Program Files\nodejs\node.exe'
$nodeHash = (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash
pwsh -NoProfile -NonInteractive -File scripts/tests/reconcile-openspec-ledger.ps1 -Mode Inventory -OpenSpecExecutablePath $tool -OpenSpecExecutableSha256 $hash -OpenSpecTrustedRoot C:\trusted -NodeExecutablePath $node -NodeExecutableSha256 $nodeHash -NodeTrustedRoot 'C:\Program Files\nodejs'

.EXAMPLE
pwsh -NoProfile -NonInteractive -File scripts/tests/reconcile-openspec-ledger.ps1 -Mode Reconcile -LedgerPath artifacts/lifecycle-ledger.json -OpenSpecListJsonPath artifacts/openspec-list.json
#>
[CmdletBinding()]
param(
    [string] $Mode = 'Reconcile',
    [string] $RepoRoot = '',
    [string] $LedgerPath = '',
    [string] $OpenSpecListJsonPath = '',
    [string] $OpenSpecExecutablePath = '',
    [string] $OpenSpecExecutableSha256 = '',
    [string] $OpenSpecTrustedRoot = '',
    [string] $OpenSpecObservationOutputPath = '',
    [string] $NodeExecutablePath = '',
    [string] $NodeExecutableSha256 = '',
    [string] $NodeTrustedRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\lib\openspec-lifecycle.ps1')

$reportSchemaVersion = 'openspec-ledger-reconciliation-report/v1'
$ledgerSchemaPath = Join-Path $PSScriptRoot 'openspec-lifecycle-ledger.schema.json'
$requiredOpenSpecVersion = '1.6.0'
$maxInputBytes = 2097152
$pathComparison = if ($IsWindows) {
    [System.StringComparison]::OrdinalIgnoreCase
} else {
    [System.StringComparison]::Ordinal
}
$notEvaluated = @(
    'archive_history',
    'blocked_by_graph',
    'evidence_refs',
    'github_pr',
    'now_md',
    'spec_to_done_state',
    'subject_commit',
    'task_commits'
)

$modeValue = 'unknown'
$openSpecSourceKind = if ([string]::IsNullOrWhiteSpace($OpenSpecListJsonPath)) { 'command' } else { 'file' }
$openSpecAvailable = $false
$machineStateKind = if ([string]::IsNullOrWhiteSpace($LedgerPath)) { 'not_provided' } else { 'file' }
$machineStateAvailable = $false

function Throw-LedgerError {
    param(
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Message
    )

    $exception = [System.InvalidOperationException]::new($Message)
    $exception.Data['LedgerErrorCode'] = $Code
    throw $exception
}

function Read-BoundedRepositoryFile {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Label
    )

    try {
        $candidate = if ([System.IO.Path]::IsPathRooted($Path)) {
            [System.IO.Path]::GetFullPath($Path)
        } else {
            [System.IO.Path]::GetFullPath((Join-Path $Root $Path))
        }
    } catch {
        Throw-LedgerError -Code 'artifact_unreadable' -Message "$Label path is invalid."
    }

    if (-not (Test-OpenSpecContainedPath -Root $Root -Candidate $candidate)) {
        Throw-LedgerError -Code 'artifact_outside_repo' -Message "$Label must be a file inside RepoRoot."
    }
    $candidate = Assert-OpenSpecNoReparseComponents -Anchor $Root -Target $candidate -Label $Label `
        -UnreadableCode 'artifact_unreadable' -ReparseCode 'artifact_reparse_point' -LeafMustBeFile

    $item = Get-Item -LiteralPath $candidate -Force
    if ($item.Length -gt $maxInputBytes) {
        Throw-LedgerError -Code 'artifact_too_large' -Message "$Label exceeds the input-size limit."
    }

    $stream = [System.IO.FileStream]::new(
        $candidate,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read
    )
    try {
        [void](Assert-OpenSpecNoReparseComponents -Anchor $Root -Target $candidate -Label $Label `
            -UnreadableCode 'artifact_unreadable' -ReparseCode 'artifact_reparse_point' -LeafMustBeFile)
        Assert-OpenSpecHandleContained -Stream $stream -TrustedRoot $Root `
            -Code 'artifact_reparse_point' -Label $Label
        if ($stream.Length -gt $maxInputBytes) {
            Throw-LedgerError -Code 'artifact_too_large' -Message "$Label exceeds the input-size limit."
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
        } catch {
            Throw-LedgerError -Code 'artifact_unreadable' -Message "$Label is not valid text."
        } finally {
            $reader.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Assert-OpenSpecExecutable {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $ExpectedSha256,
        [Parameter(Mandatory = $true)][string] $TrustedRoot
    )

    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        Throw-LedgerError -Code 'tool_path_invalid' -Message 'OpenSpec executable path must be absolute.'
    }
    if ($ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$') {
        Throw-LedgerError -Code 'tool_hash_mismatch' -Message 'OpenSpec executable SHA-256 is invalid.'
    }

    try {
        $fullPath = [System.IO.Path]::GetFullPath($Path)
        $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
        $fullTrustedRoot = [System.IO.Path]::GetFullPath($TrustedRoot)
        $trustedPathRoot = [System.IO.Path]::GetPathRoot($fullTrustedRoot)
    } catch {
        Throw-LedgerError -Code 'tool_path_invalid' -Message 'OpenSpec executable path is invalid.'
    }
    if (Test-OpenSpecContainedPath -Root $Root -Candidate $fullPath) {
        Throw-LedgerError -Code 'tool_path_untrusted' -Message 'OpenSpec executable must be outside RepoRoot.'
    }
    if ($IsWindows -and (
        $fullPath.StartsWith('\\', [System.StringComparison]::Ordinal) -or
        $fullTrustedRoot.StartsWith('\\', [System.StringComparison]::Ordinal)
    )) {
        Throw-LedgerError -Code 'tool_path_untrusted' -Message 'UNC and device OpenSpec paths are not allowed.'
    }
    if (Test-OpenSpecContainedPath -Root $Root -Candidate $fullTrustedRoot) {
        Throw-LedgerError -Code 'tool_path_untrusted' -Message 'OpenSpec trusted root must be outside RepoRoot.'
    }
    $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (
        $fullTrustedRoot.Equals($temporaryRoot.TrimEnd('\', '/'), $pathComparison) -or
        (Test-OpenSpecContainedPath -Root $temporaryRoot -Candidate $fullTrustedRoot)
    ) {
        Throw-LedgerError -Code 'tool_path_untrusted' -Message 'OpenSpec trusted root must not be a temporary directory.'
    }
    [void](Assert-OpenSpecNoReparseComponents -Anchor $trustedPathRoot -Target $fullTrustedRoot `
        -Label 'OpenSpec trusted root' -UnreadableCode 'tool_path_invalid' `
        -ReparseCode 'tool_path_untrusted')
    if (-not (Test-OpenSpecContainedPath -Root $fullTrustedRoot -Candidate $fullPath)) {
        Throw-LedgerError -Code 'tool_path_untrusted' -Message 'OpenSpec executable is outside the base-controlled trusted root.'
    }
    $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
    if ($extension -notin @('', '.exe', '.ps1')) {
        Throw-LedgerError -Code 'tool_path_invalid' -Message 'OpenSpec executable type is not allowed.'
    }
    $fullPath = Assert-OpenSpecNoReparseComponents -Anchor $pathRoot -Target $fullPath `
        -Label 'OpenSpec executable' -UnreadableCode 'tool_path_invalid' `
        -ReparseCode 'tool_path_invalid' -LeafMustBeFile
    $actualHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
    if (-not $actualHash.Equals($ExpectedSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
        Throw-LedgerError -Code 'tool_hash_mismatch' -Message 'OpenSpec executable SHA-256 does not match the trusted value.'
    }
    return $fullPath
}

function Invoke-BoundedProcess {
    param(
        [Parameter(Mandatory = $true)][string] $FileName,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [int] $TimeoutMilliseconds = 30000,
        [int64] $MaxOutputBytes = 2097152,
        [hashtable] $Environment = $null
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FileName
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    if ($null -ne $Environment) {
        $startInfo.Environment.Clear()
        foreach ($entry in $Environment.GetEnumerator()) {
            $startInfo.Environment[[string]$entry.Key] = [string]$entry.Value
        }
    }
    foreach ($argument in $Arguments) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $stdoutBytes = [System.IO.MemoryStream]::new()
    $stderrBytes = [System.IO.MemoryStream]::new()
    try {
        try {
            if (-not $process.Start()) {
                Throw-LedgerError -Code 'tool_unavailable' -Message 'The OpenSpec process could not be started.'
            }
        } catch {
            if ($null -ne $_.Exception.Data['LedgerErrorCode']) { throw }
            Throw-LedgerError -Code 'tool_unavailable' -Message 'The OpenSpec process could not be started.'
        }

        $stdoutBuffer = [byte[]]::new(4096)
        $stderrBuffer = [byte[]]::new(4096)
        $stdoutTask = $process.StandardOutput.BaseStream.ReadAsync($stdoutBuffer, 0, $stdoutBuffer.Length)
        $stderrTask = $process.StandardError.BaseStream.ReadAsync($stderrBuffer, 0, $stderrBuffer.Length)
        $stdoutDone = $false
        $stderrDone = $false
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

        while (-not ($stdoutDone -and $stderrDone -and $process.HasExited)) {
            if (-not $stdoutDone -and $stdoutTask.IsCompleted) {
                $read = $stdoutTask.GetAwaiter().GetResult()
                if ($read -eq 0) {
                    $stdoutDone = $true
                } else {
                    $stdoutBytes.Write($stdoutBuffer, 0, $read)
                    $stdoutTask = $process.StandardOutput.BaseStream.ReadAsync($stdoutBuffer, 0, $stdoutBuffer.Length)
                }
            }
            if (-not $stderrDone -and $stderrTask.IsCompleted) {
                $read = $stderrTask.GetAwaiter().GetResult()
                if ($read -eq 0) {
                    $stderrDone = $true
                } else {
                    $stderrBytes.Write($stderrBuffer, 0, $read)
                    $stderrTask = $process.StandardError.BaseStream.ReadAsync($stderrBuffer, 0, $stderrBuffer.Length)
                }
            }
            if (($stdoutBytes.Length + $stderrBytes.Length) -gt $MaxOutputBytes) {
                if (-not $process.HasExited) { $process.Kill($true) }
                [void]$process.WaitForExit(5000)
                Throw-LedgerError -Code 'tool_output_too_large' -Message 'OpenSpec output exceeds the size limit.'
            }
            if ($stopwatch.ElapsedMilliseconds -gt $TimeoutMilliseconds) {
                if (-not $process.HasExited) { $process.Kill($true) }
                [void]$process.WaitForExit(5000)
                Throw-LedgerError -Code 'tool_timeout' -Message 'OpenSpec execution exceeded the time limit.'
            }
            if (-not ($stdoutDone -and $stderrDone -and $process.HasExited)) {
                Start-Sleep -Milliseconds 5
            }
        }
        $stopwatch.Stop()
        $process.WaitForExit()
        try {
            $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
            $stdout = $strictUtf8.GetString($stdoutBytes.ToArray())
            $stderr = $strictUtf8.GetString($stderrBytes.ToArray())
        } catch {
            Throw-LedgerError -Code 'tool_output_invalid' -Message 'OpenSpec output is not valid UTF-8.'
        }
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout   = $stdout
            Stderr   = $stderr
        }
    } finally {
        $stdoutBytes.Dispose()
        $stderrBytes.Dispose()
        $process.Dispose()
    }
}

function Invoke-OpenSpecList {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string] $ExecutablePath,
        [Parameter(Mandatory = $true)][string] $ExecutableSha256,
        [Parameter(Mandatory = $true)][string] $TrustedRoot,
        [Parameter(Mandatory = $true)][string] $NodePath,
        [Parameter(Mandatory = $true)][string] $NodeSha256,
        [Parameter(Mandatory = $true)][string] $NodeRoot
    )

    $trustedPath = Assert-OpenSpecExecutable -Root $Root -Path $ExecutablePath `
        -ExpectedSha256 $ExecutableSha256 -TrustedRoot $TrustedRoot
    $trustedNodePath = Assert-OpenSpecExecutable -Root $Root -Path $NodePath `
        -ExpectedSha256 $NodeSha256 -TrustedRoot $NodeRoot
    $expectedNodeName = if ($IsWindows) { 'node.exe' } else { 'node' }
    if (-not ([System.IO.Path]::GetFileName($trustedNodePath)).Equals(
        $expectedNodeName,
        $pathComparison
    )) {
        Throw-LedgerError -Code 'tool_path_invalid' -Message 'Pinned Node runtime has an unexpected filename.'
    }
    $prefixArguments = @()
    $processPath = $trustedPath
    if ([System.IO.Path]::GetExtension($trustedPath).Equals('.ps1', [System.StringComparison]::OrdinalIgnoreCase)) {
        $processPath = (Get-Process -Id $PID).Path
        $prefixArguments = @('-NoProfile', '-NonInteractive', '-File', $trustedPath)
    }

    if ($IsWindows) {
        $shimLocalNode = Join-Path (Split-Path -Parent $trustedPath) 'node.exe'
        if ((Test-Path -LiteralPath $shimLocalNode -PathType Leaf) -and
            -not ([System.IO.Path]::GetFullPath($shimLocalNode)).Equals($trustedNodePath, $pathComparison)) {
            Throw-LedgerError -Code 'tool_path_untrusted' `
                -Message 'An unpinned node.exe beside the OpenSpec shim would override the pinned runtime.'
        }
    }

    $pathEntries = [System.Collections.Generic.List[string]]::new()
    $pathEntries.Add((Split-Path -Parent $trustedNodePath))
    $pathEntries.Add($PSHOME)
    $pathEntries.Add([System.IO.Path]::GetFullPath($TrustedRoot))
    $windowsRoot = ''
    if ($IsWindows) {
        $windowsRoot = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Windows)
        if ([string]::IsNullOrWhiteSpace($windowsRoot) -or -not (Test-Path -LiteralPath $windowsRoot -PathType Container)) {
            Throw-LedgerError -Code 'tool_environment_invalid' -Message 'Trusted Windows system root could not be resolved.'
        }
        $windowsRoot = [System.IO.Path]::GetFullPath($windowsRoot)
        $pathEntries.Add((Join-Path $windowsRoot 'System32'))
    }
    $cleanEnvironment = @{
        CI       = 'true'
        NO_COLOR = '1'
        NODE     = $trustedNodePath
        PATH     = (($pathEntries | Select-Object -Unique) -join [System.IO.Path]::PathSeparator)
        TEMP     = [System.IO.Path]::GetTempPath()
        TMP      = [System.IO.Path]::GetTempPath()
    }
    if ($IsWindows) {
        $cleanEnvironment['SystemRoot'] = $windowsRoot
        $cleanEnvironment['WINDIR'] = $windowsRoot
        $cleanEnvironment['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'
    }

    [void](Assert-OpenSpecExecutable -Root $Root -Path $trustedNodePath `
        -ExpectedSha256 $NodeSha256 -TrustedRoot $NodeRoot)
    $versionResult = Invoke-BoundedProcess -FileName $processPath `
        -Arguments @($prefixArguments + '--version') -WorkingDirectory $Root `
        -TimeoutMilliseconds 10000 -MaxOutputBytes 65536 -Environment $cleanEnvironment
    if ($versionResult.ExitCode -ne 0) {
        Throw-LedgerError -Code 'tool_exit_nonzero' -Message 'OpenSpec version check returned a nonzero exit code.'
    }
    if ($versionResult.Stdout.Trim() -ne $requiredOpenSpecVersion) {
        Throw-LedgerError -Code 'tool_version_mismatch' -Message 'OpenSpec version does not match the pinned version.'
    }
    [void](Assert-OpenSpecExecutable -Root $Root -Path $trustedPath `
        -ExpectedSha256 $ExecutableSha256 -TrustedRoot $TrustedRoot)
    [void](Assert-OpenSpecExecutable -Root $Root -Path $trustedNodePath `
        -ExpectedSha256 $NodeSha256 -TrustedRoot $NodeRoot)

    $listResult = Invoke-BoundedProcess -FileName $processPath `
        -Arguments @($prefixArguments + @('list', '--json')) -WorkingDirectory $Root `
        -TimeoutMilliseconds 30000 -MaxOutputBytes $maxInputBytes -Environment $cleanEnvironment
    [void](Assert-OpenSpecExecutable -Root $Root -Path $trustedPath `
        -ExpectedSha256 $ExecutableSha256 -TrustedRoot $TrustedRoot)
    [void](Assert-OpenSpecExecutable -Root $Root -Path $trustedNodePath `
        -ExpectedSha256 $NodeSha256 -TrustedRoot $NodeRoot)
    if ($listResult.ExitCode -ne 0) {
        Throw-LedgerError -Code 'tool_exit_nonzero' -Message 'OpenSpec list returned a nonzero exit code.'
    }
    return $listResult.Stdout
}

function ConvertFrom-OpenSpecListJson {
    param(
        [Parameter(Mandatory = $true)][string] $Json,
        [Parameter(Mandatory = $true)][string] $ExpectedRoot
    )

    try {
        $document = $Json | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    } catch {
        Throw-LedgerError -Code 'tool_output_invalid' -Message 'OpenSpec list output is not valid JSON.'
    }

    if ($document -isnot [System.Management.Automation.PSCustomObject]) {
        Throw-LedgerError -Code 'tool_output_invalid' -Message 'OpenSpec list output root must be an object.'
    }
    $changesProperty = $document.PSObject.Properties['changes']
    $rootProperty = $document.PSObject.Properties['root']
    if (
        $null -eq $changesProperty -or
        $null -eq $rootProperty -or
        $document.changes -isnot [System.Array] -or
        $document.root -isnot [System.Management.Automation.PSCustomObject]
    ) {
        Throw-LedgerError -Code 'tool_output_invalid' -Message 'OpenSpec list output is missing required fields.'
    }
    if ($document.changes.Count -gt 500) {
        Throw-LedgerError -Code 'tool_output_invalid' -Message 'OpenSpec list contains too many changes.'
    }
    $returnedPathProperty = $document.root.PSObject.Properties['path']
    if ($null -eq $returnedPathProperty -or [string]::IsNullOrWhiteSpace([string]$document.root.path)) {
        Throw-LedgerError -Code 'tool_output_invalid' -Message 'OpenSpec list output is missing root.path.'
    }

    try {
        $returnedRoot = [System.IO.Path]::GetFullPath([string]$document.root.path).TrimEnd(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.IO.Path]::AltDirectorySeparatorChar
        )
        $normalizedExpected = [System.IO.Path]::GetFullPath($ExpectedRoot).TrimEnd(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.IO.Path]::AltDirectorySeparatorChar
        )
    } catch {
        Throw-LedgerError -Code 'tool_output_invalid' -Message 'OpenSpec list root.path is invalid.'
    }
    if (-not $returnedRoot.Equals($normalizedExpected, $pathComparison)) {
        Throw-LedgerError -Code 'tool_root_mismatch' -Message 'OpenSpec list output belongs to a different repository root.'
    }

    $byId = @{}
    foreach ($change in @($document.changes)) {
        if ($change -isnot [System.Management.Automation.PSCustomObject]) {
            Throw-LedgerError -Code 'tool_output_invalid' -Message 'An OpenSpec change must be an object.'
        }
        foreach ($requiredField in @('name', 'completedTasks', 'totalTasks', 'status')) {
            if ($null -eq $change.PSObject.Properties[$requiredField]) {
                Throw-LedgerError -Code 'tool_output_invalid' -Message 'An OpenSpec change is missing required fields.'
            }
        }
        $id = [string]$change.name
        if ($id -notmatch '^[a-z0-9][a-z0-9-]{0,127}$') {
            Throw-LedgerError -Code 'tool_output_invalid' -Message 'An OpenSpec change id is invalid.'
        }
        if ($byId.ContainsKey($id)) {
            Throw-LedgerError -Code 'tool_output_invalid' -Message 'OpenSpec list output contains duplicate change ids.'
        }

        $completed = 0L
        $total = 0L
        if (
            $change.completedTasks -isnot [long] -or
            $change.totalTasks -isnot [long] -or
            -not [long]::TryParse([string]$change.completedTasks, [ref]$completed) -or
            -not [long]::TryParse([string]$change.totalTasks, [ref]$total) -or
            $completed -lt 0 -or
            $total -lt 0 -or
            $completed -gt 1000000 -or
            $total -gt 1000000 -or
            $completed -gt $total -or
            [string]$change.status -notmatch '^[a-z][a-z0-9-]{0,63}$'
        ) {
            Throw-LedgerError -Code 'tool_output_invalid' -Message 'OpenSpec task status fields are invalid.'
        }

        $byId[$id] = [pscustomobject]@{
            Status    = [string]$change.status
            Completed = [int]$completed
            Total     = [int]$total
        }
    }
    return $byId
}

function ConvertFrom-MachineLedgerJson {
    param([Parameter(Mandatory = $true)][string] $Json)

    $schemaErrors = @()
    try {
        $schemaValid = Test-Json -Json $Json -SchemaFile $ledgerSchemaPath `
            -ErrorAction SilentlyContinue -ErrorVariable schemaErrors
    } catch {
        $schemaValid = $false
    }
    if (-not $schemaValid) {
        Throw-LedgerError -Code 'ledger_schema_invalid' -Message 'The machine ledger does not satisfy openspec-lifecycle-ledger/v1.'
    }

    try {
        $document = $Json | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    } catch {
        Throw-LedgerError -Code 'ledger_schema_invalid' -Message 'The machine ledger is not valid JSON.'
    }

    $byId = @{}
    foreach ($change in @($document.changes)) {
        $id = [string]$change.id
        if ($byId.ContainsKey($id)) {
            Throw-LedgerError -Code 'ledger_duplicate_id' -Message 'The machine ledger contains duplicate change ids.'
        }
        if ([int64]$change.task_ledger.completed -gt [int64]$change.task_ledger.total) {
            Throw-LedgerError -Code 'ledger_semantic_invalid' -Message 'Machine ledger completed tasks exceed total tasks.'
        }
        $byId[$id] = $change
    }
    return $byId
}

function New-Mismatch {
    param(
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Reason,
        [Parameter(Mandatory = $true)][string] $ChangeId,
        [Parameter(Mandatory = $true)][string] $Field,
        [Parameter(Mandatory = $true)][string] $ExpectedSource,
        [AllowEmptyString()][string] $Expected,
        [Parameter(Mandatory = $true)][string] $ActualSource,
        [AllowEmptyString()][string] $Actual,
        [Parameter(Mandatory = $true)][string] $Message
    )

    return [ordered]@{
        code            = $Code
        reason          = $Reason
        change_id       = $ChangeId
        field           = $Field
        expected_source = $ExpectedSource
        expected        = $Expected
        actual_source   = $ActualSource
        actual          = $Actual
        message         = $Message
    }
}

function New-Sources {
    return [ordered]@{
        repository  = 'openspec/changes'
        openspec_cli = [ordered]@{
            kind      = if ($openSpecAvailable) { $openSpecSourceKind } else { 'unavailable' }
            available = $openSpecAvailable
        }
        machine_state = [ordered]@{
            kind      = $machineStateKind
            available = $machineStateAvailable
        }
        not_evaluated = $notEvaluated
    }
}

function Write-ReportAndExit {
    param(
        [Parameter(Mandatory = $true)] $Report,
        [Parameter(Mandatory = $true)][int] $ExitCode
    )

    [Console]::Out.WriteLine(($Report | ConvertTo-Json -Depth 20))
    exit $ExitCode
}

try {
    switch ($Mode.ToLowerInvariant()) {
        'inventory' { $modeValue = 'inventory' }
        'reconcile' { $modeValue = 'reconcile' }
        default {
            Throw-LedgerError -Code 'invalid_argument' -Message 'Mode must be Inventory or Reconcile.'
        }
    }

    $usesOpenSpecFixture = -not [string]::IsNullOrWhiteSpace($OpenSpecListJsonPath)
    $hasExecutableInput = -not [string]::IsNullOrWhiteSpace($OpenSpecExecutablePath) -or
        -not [string]::IsNullOrWhiteSpace($OpenSpecExecutableSha256) -or
        -not [string]::IsNullOrWhiteSpace($OpenSpecTrustedRoot) -or
        -not [string]::IsNullOrWhiteSpace($NodeExecutablePath) -or
        -not [string]::IsNullOrWhiteSpace($NodeExecutableSha256) -or
        -not [string]::IsNullOrWhiteSpace($NodeTrustedRoot)
    if ($usesOpenSpecFixture -and $hasExecutableInput) {
        Throw-LedgerError -Code 'invalid_argument' -Message 'Choose either an OpenSpec fixture or a pinned executable, not both.'
    }
    if ($usesOpenSpecFixture -and -not [string]::IsNullOrWhiteSpace($OpenSpecObservationOutputPath)) {
        Throw-LedgerError -Code 'invalid_argument' -Message 'OpenSpec observation output is only available for an actual pinned CLI observation.'
    }
    if (-not $usesOpenSpecFixture -and (
        [string]::IsNullOrWhiteSpace($OpenSpecExecutablePath) -or
        [string]::IsNullOrWhiteSpace($OpenSpecExecutableSha256) -or
        [string]::IsNullOrWhiteSpace($OpenSpecTrustedRoot) -or
        [string]::IsNullOrWhiteSpace($NodeExecutablePath) -or
        [string]::IsNullOrWhiteSpace($NodeExecutableSha256) -or
        [string]::IsNullOrWhiteSpace($NodeTrustedRoot)
    )) {
        Throw-LedgerError -Code 'tool_path_required' -Message 'Command mode requires explicit OpenSpec and Node paths, SHA-256 values, and base-controlled trusted roots.'
    }

    if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
        $RepoRoot = Join-Path $PSScriptRoot '..\..'
    }
    try {
        $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot -ErrorAction Stop).Path
        $rootItem = Get-Item -LiteralPath $RepoRoot -Force -ErrorAction Stop
    } catch {
        Throw-LedgerError -Code 'repo_root_invalid' -Message 'RepoRoot is not a readable directory.'
    }
    if (-not $rootItem.PSIsContainer -or (Test-OpenSpecReparsePoint -Item $rootItem)) {
        Throw-LedgerError -Code 'repo_root_invalid' -Message 'RepoRoot is not a directory.'
    }

    $changesRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot 'openspec\changes'))
    [void](Assert-OpenSpecNoReparseComponents -Anchor $RepoRoot -Target $changesRoot `
        -Label 'openspec/changes' -UnreadableCode 'repository_unreadable' `
        -ReparseCode 'repository_reparse_point')
    $changesRootItem = Get-Item -LiteralPath $changesRoot -Force
    if (-not $changesRootItem.PSIsContainer) {
        Throw-LedgerError -Code 'repository_unreadable' -Message 'openspec/changes is not a directory.'
    }

    $activeDirectories = @(Get-ChildItem -LiteralPath $changesRoot -Directory -Force | Where-Object {
        $_.Name -ne 'archive'
    })
    if ($activeDirectories.Count -gt 500) {
        Throw-LedgerError -Code 'repository_unreadable' -Message 'The repository contains too many active OpenSpec changes.'
    }
    $repositoryById = @{}
    foreach ($directory in $activeDirectories) {
        [void](Assert-OpenSpecNoReparseComponents -Anchor $RepoRoot -Target $directory.FullName `
            -Label 'Active change directory' -UnreadableCode 'repository_unreadable' `
            -ReparseCode 'repository_reparse_point')
        $id = $directory.Name
        if ($id -notmatch '^[a-z0-9][a-z0-9-]{0,127}$') {
            Throw-LedgerError -Code 'repository_unreadable' -Message 'An active change directory has an invalid id.'
        }
        $proposal = Get-OpenSpecProposalState -ChangeDirectory $directory.FullName -TrustedRoot $RepoRoot
        $tasks = Get-OpenSpecTaskLedger -ChangeDirectory $directory.FullName -TrustedRoot $RepoRoot
        $repositoryById[$id] = [pscustomobject]@{
            Proposal = $proposal
            Tasks    = $tasks
        }
    }

    if (-not $usesOpenSpecFixture) {
        $openSpecJson = Invoke-OpenSpecList -Root $RepoRoot `
            -ExecutablePath $OpenSpecExecutablePath -ExecutableSha256 $OpenSpecExecutableSha256 `
            -TrustedRoot $OpenSpecTrustedRoot -NodePath $NodeExecutablePath `
            -NodeSha256 $NodeExecutableSha256 -NodeRoot $NodeTrustedRoot
    } else {
        $openSpecJson = Read-BoundedRepositoryFile -Root $RepoRoot `
            -Path $OpenSpecListJsonPath -Label 'OpenSpec list fixture'
    }
    $openSpecById = ConvertFrom-OpenSpecListJson -Json $openSpecJson -ExpectedRoot $RepoRoot
    if (-not [string]::IsNullOrWhiteSpace($OpenSpecObservationOutputPath)) {
        $observationPath = if ([IO.Path]::IsPathRooted($OpenSpecObservationOutputPath)) {
            [IO.Path]::GetFullPath($OpenSpecObservationOutputPath)
        } else {
            [IO.Path]::GetFullPath((Join-Path $RepoRoot $OpenSpecObservationOutputPath))
        }
        if (-not (Test-OpenSpecContainedPath -Root $RepoRoot -Candidate $observationPath)) {
            Throw-LedgerError -Code 'artifact_path_invalid' -Message 'OpenSpec observation output must stay inside RepoRoot.'
        }
        $observationParent = Split-Path -Parent $observationPath
        if (-not (Test-Path -LiteralPath $observationParent -PathType Container) -or (Test-Path -LiteralPath $observationPath)) {
            Throw-LedgerError -Code 'artifact_path_invalid' -Message 'OpenSpec observation output parent must exist and output must be new.'
        }
        [void](Assert-OpenSpecNoReparseComponents -Anchor $RepoRoot -Target $observationParent `
            -Label 'OpenSpec observation output parent' -UnreadableCode 'artifact_path_invalid' `
            -ReparseCode 'artifact_reparse_point')
        [IO.File]::WriteAllText($observationPath, $openSpecJson, [Text.UTF8Encoding]::new($false))
    }
    $openSpecAvailable = $true

    $machineById = @{}
    if (-not [string]::IsNullOrWhiteSpace($LedgerPath)) {
        $ledgerJson = Read-BoundedRepositoryFile -Root $RepoRoot -Path $LedgerPath -Label 'Machine ledger'
        $machineById = ConvertFrom-MachineLedgerJson -Json $ledgerJson
        $machineStateAvailable = $true
    }

    $idSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($id in $repositoryById.Keys) { [void]$idSet.Add([string]$id) }
    foreach ($id in $openSpecById.Keys) { [void]$idSet.Add([string]$id) }
    foreach ($id in $machineById.Keys) {
        if ([string]$machineById[$id].status -ne 'archived') {
            [void]$idSet.Add([string]$id)
        }
    }
    if ($idSet.Count -gt 1000) {
        Throw-LedgerError -Code 'inventory_too_large' -Message 'The reconciled change inventory exceeds the report limit.'
    }
    $ids = [string[]]@($idSet)
    [Array]::Sort($ids, [System.StringComparer]::Ordinal)

    $inventory = [System.Collections.Generic.List[object]]::new()
    $mismatches = [System.Collections.Generic.List[object]]::new()

    foreach ($id in $ids) {
        $hasRepository = $repositoryById.ContainsKey($id)
        $hasOpenSpec = $openSpecById.ContainsKey($id)
        $hasMachine = $machineById.ContainsKey($id)

        $repoObservation = if ($hasRepository) {
            $repo = $repositoryById[$id]
            [ordered]@{
                location            = 'active'
                proposal_status     = [string]$repo.Proposal.LifecycleStatus
                proposal_raw_status = if ($null -eq $repo.Proposal.RawStatus) { $null } else { [string]$repo.Proposal.RawStatus }
                proposal_exists     = [bool]$repo.Proposal.Exists
                tasks_exists        = [bool]$repo.Tasks.Exists
                task_ledger         = if ($repo.Tasks.Exists) {
                    [ordered]@{
                        completed = [int]$repo.Tasks.Completed
                        total     = [int]$repo.Tasks.Total
                    }
                } else { $null }
            }
        } else {
            [ordered]@{
                location            = 'missing'
                proposal_status     = 'missing'
                proposal_raw_status = $null
                proposal_exists     = $false
                tasks_exists        = $false
                task_ledger         = $null
            }
        }

        $openSpecObservation = if ($hasOpenSpec) {
            $openSpec = $openSpecById[$id]
            [ordered]@{
                present     = $true
                status      = [string]$openSpec.Status
                task_ledger = [ordered]@{
                    completed = [int]$openSpec.Completed
                    total     = [int]$openSpec.Total
                }
            }
        } else {
            [ordered]@{
                present     = $false
                status      = $null
                task_ledger = $null
            }
        }

        $machineObservation = if ($hasMachine) {
            $machine = $machineById[$id]
            [ordered]@{
                present                 = $true
                status                  = [string]$machine.status
                owner_present           = -not [string]::IsNullOrWhiteSpace([string]$machine.owner)
                current_slice_present   = $null -ne $machine.current_slice
                blocked_by_count        = @($machine.blocked_by).Count
                last_verified_present   = -not [string]::IsNullOrWhiteSpace([string]$machine.last_verified)
                task_ledger             = [ordered]@{
                    completed = [int]$machine.task_ledger.completed
                    total     = [int]$machine.task_ledger.total
                }
                evidence_ref_count      = @($machine.evidence_refs).Count
                subject_commit_present  = -not [string]::IsNullOrWhiteSpace([string]$machine.subject_commit)
            }
        } else {
            [ordered]@{
                present                 = $false
                status                  = $null
                owner_present           = $false
                current_slice_present   = $false
                blocked_by_count        = 0
                last_verified_present   = $false
                task_ledger             = $null
                evidence_ref_count      = 0
                subject_commit_present  = $false
            }
        }

        $inventory.Add([ordered]@{
            id            = $id
            repository    = $repoObservation
            openspec_cli  = $openSpecObservation
            machine_state = $machineObservation
        })

        if (-not $hasRepository) {
            $observedSources = @()
            if ($hasOpenSpec) { $observedSources += 'openspec_cli' }
            if ($hasMachine) { $observedSources += 'machine_state' }
            $mismatches.Add((New-Mismatch -Code 'change_presence' -Reason 'directory_missing' `
                -ChangeId $id -Field 'repository.location' -ExpectedSource 'repository' `
                -Expected 'active' -ActualSource ($observedSources -join ',') -Actual 'missing' `
                -Message 'A reported change has no active repository directory.'))
            continue
        }

        $repo = $repositoryById[$id]
        if (-not $repo.Proposal.Exists) {
            $mismatches.Add((New-Mismatch -Code 'change_presence' -Reason 'proposal_missing' `
                -ChangeId $id -Field 'repository.proposal' -ExpectedSource 'repository_contract' `
                -Expected 'present' -ActualSource 'repository' -Actual 'missing' `
                -Message 'The active change has no proposal.md.'))
        }
        if (-not $repo.Tasks.Exists) {
            $mismatches.Add((New-Mismatch -Code 'change_presence' -Reason 'tasks_missing' `
                -ChangeId $id -Field 'repository.tasks' -ExpectedSource 'repository_contract' `
                -Expected 'present' -ActualSource 'repository' -Actual 'missing' `
                -Message 'The active change has no tasks.md.'))
        }
        if (-not $hasOpenSpec) {
            $mismatches.Add((New-Mismatch -Code 'change_presence' -Reason 'openspec_entry_missing' `
                -ChangeId $id -Field 'openspec_cli.present' -ExpectedSource 'repository' `
                -Expected 'present' -ActualSource 'openspec_cli' -Actual 'missing' `
                -Message 'The active change is missing from openspec list output.'))
        }
        if (-not $hasMachine) {
            $mismatches.Add((New-Mismatch -Code 'change_presence' -Reason 'machine_state_missing' `
                -ChangeId $id -Field 'machine_state.present' -ExpectedSource 'repository' `
                -Expected 'present' -ActualSource 'machine_state' -Actual 'missing' `
                -Message 'The active change has no machine lifecycle state.'))
        }

        if ($repo.Proposal.Exists -and $repo.Proposal.LifecycleStatus -eq 'invalid') {
            $mismatches.Add((New-Mismatch -Code 'lifecycle' -Reason 'invalid_marker' `
                -ChangeId $id -Field 'repository.proposal_status' -ExpectedSource 'repository_contract' `
                -Expected 'active|deferred' -ActualSource 'proposal' -Actual ([string]$repo.Proposal.RawStatus) `
                -Message 'The proposal prologue contains an unsupported or duplicate lifecycle marker.'))
        }
        if (
            $repo.Proposal.Exists -and
            $repo.Proposal.LifecycleStatus -eq 'deferred' -and
            $hasOpenSpec -and
            $openSpecById[$id].Status -notin @('deferred', 'deferred-proposed')
        ) {
            $mismatches.Add((New-Mismatch -Code 'lifecycle' -Reason 'lifecycle_unrepresented' `
                -ChangeId $id -Field 'lifecycle.status' -ExpectedSource 'proposal' `
                -Expected 'deferred' -ActualSource 'openspec_cli' -Actual ([string]$openSpecById[$id].Status) `
                -Message 'OpenSpec CLI task status does not represent the proposal deferred lifecycle.'))
        }
        if ($hasMachine -and $repo.Proposal.Exists) {
            $machineStatus = [string]$machineById[$id].status
            $machineLifecycleMismatch = (
                $repo.Proposal.LifecycleStatus -eq 'deferred' -and $machineStatus -ne 'deferred'
            ) -or (
                $repo.Proposal.LifecycleStatus -eq 'active' -and $machineStatus -in @('deferred', 'archived')
            )
            if ($machineLifecycleMismatch) {
                $mismatches.Add((New-Mismatch -Code 'lifecycle' -Reason 'lifecycle_disagreement' `
                    -ChangeId $id -Field 'machine_state.status' -ExpectedSource 'proposal' `
                    -Expected ([string]$repo.Proposal.LifecycleStatus) -ActualSource 'machine_state' `
                    -Actual $machineStatus -Message 'Machine lifecycle state disagrees with the proposal lifecycle.'))
            }
        }

        if ($repo.Tasks.Exists -and $repo.Tasks.UnsupportedCheckboxes -gt 0) {
            $mismatches.Add((New-Mismatch -Code 'task_counts' -Reason 'unsupported_checkbox' `
                -ChangeId $id -Field 'repository.task_ledger' -ExpectedSource 'task_contract' `
                -Expected '[ ]|[x]' -ActualSource 'tasks' `
                -Actual ([string]$repo.Tasks.UnsupportedCheckboxes) `
                -Message 'tasks.md contains unsupported checkbox markers.'))
        }
        if ($repo.Tasks.Exists -and $hasOpenSpec) {
            $openSpec = $openSpecById[$id]
            if ($repo.Tasks.Completed -ne $openSpec.Completed) {
                $mismatches.Add((New-Mismatch -Code 'task_counts' -Reason 'completed_mismatch' `
                    -ChangeId $id -Field 'task_ledger.completed' -ExpectedSource 'tasks' `
                    -Expected ([string]$repo.Tasks.Completed) -ActualSource 'openspec_cli' `
                    -Actual ([string]$openSpec.Completed) -Message 'Completed task counts disagree.'))
            }
            if ($repo.Tasks.Total -ne $openSpec.Total) {
                $mismatches.Add((New-Mismatch -Code 'task_counts' -Reason 'total_mismatch' `
                    -ChangeId $id -Field 'task_ledger.total' -ExpectedSource 'tasks' `
                    -Expected ([string]$repo.Tasks.Total) -ActualSource 'openspec_cli' `
                    -Actual ([string]$openSpec.Total) -Message 'Total task counts disagree.'))
            }
        }
        if ($repo.Tasks.Exists -and $hasMachine) {
            $machineTasks = $machineById[$id].task_ledger
            if ($repo.Tasks.Completed -ne [int]$machineTasks.completed) {
                $mismatches.Add((New-Mismatch -Code 'task_counts' -Reason 'completed_mismatch' `
                    -ChangeId $id -Field 'machine_state.task_ledger.completed' -ExpectedSource 'tasks' `
                    -Expected ([string]$repo.Tasks.Completed) -ActualSource 'machine_state' `
                    -Actual ([string]$machineTasks.completed) -Message 'Machine completed task count disagrees with tasks.md.'))
            }
            if ($repo.Tasks.Total -ne [int]$machineTasks.total) {
                $mismatches.Add((New-Mismatch -Code 'task_counts' -Reason 'total_mismatch' `
                    -ChangeId $id -Field 'machine_state.task_ledger.total' -ExpectedSource 'tasks' `
                    -Expected ([string]$repo.Tasks.Total) -ActualSource 'machine_state' `
                    -Actual ([string]$machineTasks.total) -Message 'Machine total task count disagrees with tasks.md.'))
            }
        }
    }

    $outcome = if ($modeValue -eq 'inventory') {
        'inventoried'
    } elseif ($mismatches.Count -gt 0) {
        'ledger_mismatch'
    } else {
        'consistent'
    }
    $report = [ordered]@{
        schema_version = $reportSchemaVersion
        mode           = $modeValue
        outcome        = $outcome
        sources        = New-Sources
        summary        = [ordered]@{
            changes   = $inventory.Count
            mismatches = $mismatches.Count
            errors    = 0
        }
        inventory      = @($inventory)
        mismatches     = @($mismatches)
        errors         = @()
    }
    $exitCode = if ($modeValue -eq 'reconcile' -and $mismatches.Count -gt 0) { 2 } else { 0 }
    Write-ReportAndExit -Report $report -ExitCode $exitCode
} catch {
    $errorCode = 'unexpected_failure'
    $errorMessage = 'Unexpected reconciliation failure.'
    if ($null -ne $_.Exception.Data['LedgerErrorCode']) {
        $errorCode = [string]$_.Exception.Data['LedgerErrorCode']
        $errorMessage = $_.Exception.Message
    }
    $errorReport = [ordered]@{
        schema_version = $reportSchemaVersion
        mode           = $modeValue
        outcome        = 'input_error'
        sources        = New-Sources
        summary        = [ordered]@{
            changes   = 0
            mismatches = 0
            errors    = 1
        }
        inventory      = @()
        mismatches     = @()
        errors         = @(
            [ordered]@{
                code    = $errorCode
                message = $errorMessage
            }
        )
    }
    Write-ReportAndExit -Report $errorReport -ExitCode 3
}
