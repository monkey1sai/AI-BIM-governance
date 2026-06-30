# Shared helpers for PR review agent reports.

Set-StrictMode -Version Latest

$Script:PrReviewGateStatuses = @('passed', 'warning', 'blocked', 'failed')
$Script:PrReviewRiskLevels = @('low', 'medium', 'high', 'critical')
$Script:RetiredRuntimeNames = @('_worker', '_bim-control', '_s3_storage', '_conversion-service', '_conversion-server')
$Script:RetiredRuntimeWiringPattern = '(working-directory|cwd|cd\s|Push-Location|Set-Location|Join-Path|Start-Process|npm|node|python|pytest|uvicorn|docker|compose|health|localhost|127\.0\.0\.1|port|start|run|service|dependency|required|endpoint|url|path)'

function ConvertTo-PrReviewPath {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path)

    $p = $Path
    # git core.quotepath (default on) wraps paths containing non-ASCII bytes in double quotes and
    # octal-escapes each byte, e.g. "docs/plans/...\345\211\215...md". Decode back to literal UTF-8 so
    # CJK-named files are classified correctly and never throw "Illegal characters in path" in path APIs.
    if ($p.Length -ge 2 -and $p[0] -eq '"' -and $p[$p.Length - 1] -eq '"') {
        $inner = $p.Substring(1, $p.Length - 2)
        $bytes = New-Object System.Collections.Generic.List[byte]
        $escapes = @{ 'a' = 7; 'b' = 8; 't' = 9; 'n' = 10; 'v' = 11; 'f' = 12; 'r' = 13; '"' = 34; '\' = 92 }
        $i = 0
        while ($i -lt $inner.Length) {
            if ($inner[$i] -eq '\' -and ($i + 1) -lt $inner.Length) {
                $next = [string]$inner[$i + 1]
                if (($i + 4) -le $inner.Length -and $inner.Substring($i + 1, 3) -match '^[0-7]{3}$') {
                    $bytes.Add([Convert]::ToByte($inner.Substring($i + 1, 3), 8))
                    $i += 4
                } elseif ($escapes.ContainsKey($next)) {
                    $bytes.Add([byte]$escapes[$next])
                    $i += 2
                } else {
                    $bytes.Add([byte][char]'\')
                    $i += 1
                }
            } else {
                $bytes.Add([byte][char]$inner[$i])
                $i += 1
            }
        }
        $p = [System.Text.Encoding]::UTF8.GetString($bytes.ToArray())
    }
    return ($p -replace '\\', '/').TrimStart('/')
}

function New-PrReviewIssue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Kind,
        [Parameter(Mandatory = $true)][string] $Message,
        [string] $Path = '',
        [string] $Severity = 'medium'
    )

    return [ordered]@{
        kind     = $Kind
        severity = $Severity
        path     = $Path
        message  = $Message
    }
}

function New-PrReviewCheck {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Owner,
        [Parameter(Mandatory = $true)][string] $Status,
        [string] $Command = '',
        [string] $Cwd = '',
        [int] $ExitCode = 0,
        [string] $Summary = '',
        [string] $EvidencePath = ''
    )

    return [ordered]@{
        name          = $Name
        owner         = $Owner
        status        = $Status
        command       = $Command
        cwd           = $Cwd
        exit_code     = $ExitCode
        summary       = $Summary
        evidence_path = $EvidencePath
    }
}

function Get-PrReviewPowerShell {
    [CmdletBinding()]
    param()

    $current = (Get-Process -Id $PID -ErrorAction SilentlyContinue).Path
    if (-not [string]::IsNullOrWhiteSpace($current) -and (Test-Path -LiteralPath $current)) {
        return $current
    }
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }
    return 'powershell.exe'
}

function ConvertFrom-PrReviewPorcelainStatus {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]] $Records)

    $paths = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $Records.Count; $i++) {
        $record = $Records[$i]
        if ([string]::IsNullOrWhiteSpace($record) -or $record.Length -lt 4) { continue }

        $statusCode = $record.Substring(0, 2)
        $pathText = $record.Substring(3)
        if ($statusCode -match '[RC]' -and ($i + 1) -lt $Records.Count) {
            [void]$paths.Add($pathText)
            $i++
            continue
        }
        [void]$paths.Add($pathText)
    }

    return @($paths.ToArray())
}

function Get-PrReviewAddedLinesForPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Path,
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    if ([string]::IsNullOrWhiteSpace($BaseSha) -or [string]::IsNullOrWhiteSpace($HeadSha)) {
        return @()
    }

    $safeRoot = $RepoRoot -replace '\\', '/'
    $mergeBase = (git -C $RepoRoot -c "safe.directory=$safeRoot" merge-base $BaseSha $HeadSha 2>$null | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($mergeBase)) { return @() }

    $diffLines = @(git -C $RepoRoot -c "safe.directory=$safeRoot" diff --unified=0 --no-ext-diff $mergeBase $HeadSha -- $Path 2>$null)
    if ($LASTEXITCODE -ne 0) { return @() }

    $added = New-Object System.Collections.Generic.List[string]
    foreach ($line in $diffLines) {
        if (-not $line.StartsWith('+')) { continue }
        if ($line.StartsWith('+++')) { continue }
        [void]$added.Add($line.Substring(1))
    }
    return @($added.ToArray())
}

function Test-PrReviewDeletedPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Path,
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    if ([string]::IsNullOrWhiteSpace($BaseSha) -or [string]::IsNullOrWhiteSpace($HeadSha)) {
        return $false
    }

    $safeRoot = $RepoRoot -replace '\\', '/'
    $mergeBase = (git -C $RepoRoot -c "safe.directory=$safeRoot" merge-base $BaseSha $HeadSha 2>$null | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($mergeBase)) { return $false }

    $statusLine = (git -C $RepoRoot -c "safe.directory=$safeRoot" diff --name-status --no-ext-diff $mergeBase $HeadSha -- $Path 2>$null | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($statusLine)) { return $false }

    $statusCode = ($statusLine -split "`t", 2)[0]
    return ($statusCode -eq 'D')
}

function Get-PrReviewChangedPathsFromGit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    $safeRoot = $RepoRoot -replace '\\', '/'
    $paths = @()
    if (-not [string]::IsNullOrWhiteSpace($BaseSha) -and -not [string]::IsNullOrWhiteSpace($HeadSha)) {
        $mergeBase = (git -C $RepoRoot -c "safe.directory=$safeRoot" merge-base $BaseSha $HeadSha 2>$null | Select-Object -First 1)
        if (-not [string]::IsNullOrWhiteSpace($mergeBase)) {
            $paths = @(git -C $RepoRoot -c "safe.directory=$safeRoot" diff --name-only $mergeBase $HeadSha 2>$null)
            if ($LASTEXITCODE -ne 0) {
                throw "Unable to resolve PR diff from merge base '$mergeBase' to head '$HeadSha'."
            }
        } else {
            $paths = @(git -C $RepoRoot -c "safe.directory=$safeRoot" diff --name-only "$BaseSha...$HeadSha" 2>$null)
            if ($LASTEXITCODE -ne 0) {
                throw "Unable to resolve PR diff range '$BaseSha...$HeadSha'."
            }
        }
        return @($paths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { ConvertTo-PrReviewPath $_ } | Sort-Object -Unique)
    }
    if ($paths.Count -eq 0) {
        $lineTerminators = [char[]]"`r`n"
        $statusOutput = git -C $RepoRoot -c "safe.directory=$safeRoot" status --porcelain=v1 -z -uall 2>$null | Out-String
        $statusRecords = @($statusOutput -split "`0" | ForEach-Object { $_.TrimEnd($lineTerminators) } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $paths = @(ConvertFrom-PrReviewPorcelainStatus -Records $statusRecords)
    }
    return @($paths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { ConvertTo-PrReviewPath $_ } | Sort-Object -Unique)
}

function Test-PrReviewRetiredRuntimeWiringReference {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Content,
        [Parameter(Mandatory = $true)][string] $RuntimeName
    )

    $escaped = [regex]::Escape($RuntimeName)
    foreach ($line in ($Content -split "`r?`n")) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match 'RetiredRuntimeNames|retired_runtime|Retired runtime|retired services|current runtime gates') { continue }
        if ($trimmed -notmatch $escaped) { continue }
        if ($trimmed -match "(^|[\s:=`"'])$escaped([/\\`"']|$)" -and $trimmed -match $Script:RetiredRuntimeWiringPattern) {
            return $true
        }
    }
    return $false
}

function Get-PrReviewOpenSpecChangeIds {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]] $ChangedPaths)

    $ids = New-Object System.Collections.Generic.HashSet[string]
    foreach ($path in $ChangedPaths) {
        $normalized = ConvertTo-PrReviewPath $path
        if ($normalized -match '^openspec/changes/archive/') { continue }
        if ($normalized -match '^openspec/changes/([^/]+)/') {
            [void]$ids.Add($Matches[1])
        }
    }
    return @($ids | Sort-Object)
}

function Test-PrReviewHasFormalOpenSpecEvidence {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]] $ChangedPaths)

    foreach ($path in $ChangedPaths) {
        $normalized = ConvertTo-PrReviewPath $path
        if ($normalized -match '^openspec/(specs|changes/archive)/') {
            return $true
        }
        # repo 自 #189 退役 OpenSpec,改用 superpowers spec(docs/superpowers/specs/*.md)作為
        # behavior/code/repo-boundary 變更的正式設計依據;視為等同 formal spec evidence(消 missing_openspec blocker)。
        # 注意:superpowers spec 非 OpenSpec 格式,不觸發 openspec validate
        # (Get-PrReviewValidationPlan 僅對 openspec/specs|changes/archive 路徑排 validate)。
        if ($normalized -match '^docs/superpowers/specs/.+\.md$') {
            return $true
        }
    }
    return $false
}

function Test-PrReviewPathIsDocsOnly {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path)

    $p = ConvertTo-PrReviewPath $Path
    if ($p -match '^(docs|openspec)/') { return $true }
    if ($p -match '^(README|AGENTS|CLAUDE|CODE_GOAL_DOCKER_KIT_MVP)\.md$') { return $true }
    if ($p -match '\.(md|txt|png|jpg|jpeg|svg|html)$') { return $true }
    return $false
}

function Test-PrReviewNeedsOpenSpec {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]] $ChangedPaths)

    foreach ($path in $ChangedPaths) {
        $p = ConvertTo-PrReviewPath $path
        if ($p -match '^openspec/changes/') { continue }
        if ($p -match '^(\.github/workflows|scripts|bim-review-coordinator|web-viewer-sample|bim-streaming-server|tests)/') {
            return $true
        }
        if ($p -in @('README.md', 'AGENTS.md') -or $p -eq 'docs/PROJECT_DEVELOPMENT_WORKFLOW.md') {
            return $true
        }
    }
    return $false
}

function Test-PrReviewNeedsGitNexus {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]] $ChangedPaths)

    foreach ($path in $ChangedPaths) {
        $p = ConvertTo-PrReviewPath $path
        if ($p -match '^(scripts|bim-review-coordinator|web-viewer-sample|bim-streaming-server|tests)/') {
            if ($p -notmatch '\.(md|txt|json|png|jpg|jpeg|svg|html)$') { return $true }
        }
        if ($p -match '^\.github/workflows/') { return $true }
    }
    return $false
}

function Get-PrReviewPathGuardFindings {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string[]] $ChangedPaths,
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    $blockers = New-Object System.Collections.Generic.List[object]
    $warnings = New-Object System.Collections.Generic.List[object]
    foreach ($path in $ChangedPaths) {
        $p = ConvertTo-PrReviewPath $path
        $leaf = [System.IO.Path]::GetFileName($p)
        $isDeletedPath = Test-PrReviewDeletedPath -RepoRoot $RepoRoot -Path $p -BaseSha $BaseSha -HeadSha $HeadSha

        $isEnvExample = ($leaf -eq '.env.example' -or $leaf -match '^\.env\..*\.example$')
        $isEnvValue = ($leaf -eq '.env' -or ($leaf -match '^\.env\.' -and -not $isEnvExample))
        if ($isEnvValue) {
            if ($isDeletedPath) {
                [void]$warnings.Add((New-PrReviewIssue -Kind 'secret_path_deleted' -Severity 'medium' -Path $p -Message 'PR deletes a real environment file; verify secret rotation or incident remediation.'))
            } else {
                [void]$blockers.Add((New-PrReviewIssue -Kind 'secret_path' -Severity 'critical' -Path $p -Message 'PR modifies a real environment file; do not change secret values in repo.'))
            }
        } elseif ($isEnvExample) {
            [void]$warnings.Add((New-PrReviewIssue -Kind 'env_contract' -Severity 'medium' -Path $p -Message 'Environment example changed; human reviewer should check placeholder contract.'))
        }

        if ($p -match '(^|/)(id_rsa|id_ed25519|credentials|token|secret)(\.|/|$)' -or $p -match '\.(pem|p12|pfx|key)$') {
            if ($isDeletedPath) {
                [void]$warnings.Add((New-PrReviewIssue -Kind 'secret_path_deleted' -Severity 'medium' -Path $p -Message 'PR deletes a credential/private-key-like path; verify secret rotation or incident remediation.'))
            } else {
                [void]$blockers.Add((New-PrReviewIssue -Kind 'secret_path' -Severity 'critical' -Path $p -Message 'PR modifies a credential/private-key-like path. Secret values are not printed.'))
            }
        }

        if ($p -match '^(\.codex/skills|\.claude/skills/generated|\.gitnexus)(/|$)') {
            if ($isDeletedPath) {
                [void]$warnings.Add((New-PrReviewIssue -Kind 'generated_tooling_path_deleted' -Severity 'medium' -Path $p -Message 'PR deletes generated local tooling state; verify cleanup scope.'))
            } else {
                [void]$blockers.Add((New-PrReviewIssue -Kind 'generated_tooling_path' -Severity 'high' -Path $p -Message 'Generated local tooling state must not be committed as product source.'))
            }
        }

        foreach ($name in $Script:RetiredRuntimeNames) {
            $escaped = [regex]::Escape($name)
            if ($p -match "^$escaped(/|$)") {
                [void]$blockers.Add((New-PrReviewIssue -Kind 'retired_runtime_path' -Severity 'critical' -Path $p -Message "Retired runtime '$name' must not be reintroduced as a product folder."))
            }
        }

        if ($p -match '^(\.github/workflows|scripts)/' -and $p -notmatch '^scripts/tests/') {
            $fullPath = Join-Path $RepoRoot ($p -replace '/', [System.IO.Path]::DirectorySeparatorChar)
            if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
                $scanLines = if (-not [string]::IsNullOrWhiteSpace($BaseSha) -and -not [string]::IsNullOrWhiteSpace($HeadSha)) {
                    @(Get-PrReviewAddedLinesForPath -RepoRoot $RepoRoot -Path $p -BaseSha $BaseSha -HeadSha $HeadSha)
                } else {
                    @((Get-Content -LiteralPath $fullPath -Raw -ErrorAction SilentlyContinue) -split "`r?`n")
                }
                if (@($scanLines).Count -eq 0) { continue }
                $content = @($scanLines) -join "`n"
                foreach ($name in $Script:RetiredRuntimeNames) {
                    if (Test-PrReviewRetiredRuntimeWiringReference -Content $content -RuntimeName $name) {
                        [void]$blockers.Add((New-PrReviewIssue -Kind 'retired_runtime_reference' -Severity 'high' -Path $p -Message "Workflow/script references retired runtime '$name'; keep retired services out of current runtime gates."))
                        break
                    }
                }
            }
        }
    }

    return [pscustomobject]@{
        blockers = @($blockers.ToArray())
        warnings = @($warnings.ToArray())
    }
}

function New-PrReviewCommandPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Owner,
        [Parameter(Mandatory = $true)][string] $Cwd,
        [Parameter(Mandatory = $true)][string] $FileName,
        [Parameter(Mandatory = $true)][string[]] $Arguments
    )

    return [ordered]@{
        name      = $Name
        owner     = $Owner
        cwd       = $Cwd
        file_name = $FileName
        arguments = @($Arguments)
        command   = "$FileName $($Arguments -join ' ')"
    }
}

function Get-PrReviewValidationPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string[]] $ChangedPaths,
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string[]] $OpenSpecChangeIds = @()
    )

    $plans = New-Object System.Collections.Generic.List[object]
    $ps = Get-PrReviewPowerShell
    $added = New-Object System.Collections.Generic.HashSet[string]
    if (($ChangedPaths | ForEach-Object { ConvertTo-PrReviewPath $_ }) -match '^(openspec/specs|openspec/changes/archive)/') {
        if ($added.Add('openspec:specs')) {
            [void]$plans.Add((New-PrReviewCommandPlan -Name 'openspec validate --specs --strict' -Owner 'openspec' -Cwd $RepoRoot -FileName 'openspec' -Arguments @('validate', '--specs', '--strict')))
        }
    }
    foreach ($changeId in $OpenSpecChangeIds) {
        if ($added.Add("openspec:$changeId")) {
            [void]$plans.Add((New-PrReviewCommandPlan -Name "openspec validate $changeId" -Owner 'openspec' -Cwd $RepoRoot -FileName 'openspec' -Arguments @('validate', $changeId)))
        }
    }

    foreach ($path in $ChangedPaths) {
        $p = ConvertTo-PrReviewPath $path
        if ($p -match '^bim-review-coordinator/' -and $added.Add('bim-review-coordinator')) {
            [void]$plans.Add((New-PrReviewCommandPlan -Name 'bim-review-coordinator verify' -Owner 'bim-review-coordinator' -Cwd (Join-Path $RepoRoot 'bim-review-coordinator') -FileName 'npm' -Arguments @('run', 'verify')))
        }
        if ($p -match '^web-viewer-sample/' -and $added.Add('web-viewer-sample')) {
            [void]$plans.Add((New-PrReviewCommandPlan -Name 'web-viewer-sample verify' -Owner 'web-viewer-sample' -Cwd (Join-Path $RepoRoot 'web-viewer-sample') -FileName 'npm' -Arguments @('run', 'verify')))
        }
        if ($p -match '^bim-streaming-server/' -and $added.Add('bim-streaming-server-api')) {
            [void]$plans.Add((New-PrReviewCommandPlan -Name 'bim-streaming-server conversion API tests' -Owner 'bim-streaming-server' -Cwd (Join-Path $RepoRoot 'bim-streaming-server') -FileName 'python' -Arguments @('-m', 'pytest', 'tests/test_conversion_authority_api.py', '-q')))
        }
        if ($p -match '^bim-streaming-server/' -and $added.Add('bim-streaming-server-stage')) {
            [void]$plans.Add((New-PrReviewCommandPlan -Name 'bim-streaming-server stage-loading contract' -Owner 'bim-streaming-server' -Cwd (Join-Path $RepoRoot 'bim-streaming-server') -FileName $ps -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/tests/test-stage-loading-contract.ps1')))
        }
        if ($p -match '^tests/' -and $added.Add('tests')) {
            [void]$plans.Add((New-PrReviewCommandPlan -Name 'root contracts and fakes tests' -Owner 'tests' -Cwd $RepoRoot -FileName 'python' -Arguments @('-m', 'pytest', 'tests', '-q', '-p', 'no:cacheprovider')))
        }
        if ($p -match '^scripts/' -and $added.Add('scripts')) {
            [void]$plans.Add((New-PrReviewCommandPlan -Name 'script-level PR review agent tests' -Owner 'scripts' -Cwd $RepoRoot -FileName $ps -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/tests/test-pr-review-agent.ps1')))
        }
    }

    return @($plans.ToArray())
}

function Invoke-PrReviewCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Plan,
        [switch] $SkipExecution
    )

    if ($SkipExecution) {
        return New-PrReviewCheck -Name $Plan.name -Owner $Plan.owner -Status 'skipped' -Command $Plan.command -Cwd $Plan.cwd -Summary 'Command execution skipped by dry-run fixture.'
    }

    if (-not (Get-Command $Plan.file_name -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath $Plan.file_name -PathType Leaf)) {
        return New-PrReviewCheck -Name $Plan.name -Owner $Plan.owner -Status 'skipped' -Command $Plan.command -Cwd $Plan.cwd -ExitCode 127 -Summary "Command not found on PATH: $($Plan.file_name)."
    }

    if (-not (Test-Path -LiteralPath $Plan.cwd -PathType Container)) {
        return New-PrReviewCheck -Name $Plan.name -Owner $Plan.owner -Status 'failed' -Command $Plan.command -Cwd $Plan.cwd -ExitCode 1 -Summary 'Working directory does not exist.'
    }

    Push-Location $Plan.cwd
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $commandArgs = @()
        foreach ($arg in @($Plan.arguments)) {
            $commandArgs += [string]$arg
        }
        $output = & $Plan.file_name @commandArgs 2>&1 | Out-String
        $exitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 0 }
    } catch {
        $output = $_ | Out-String
        $exitCode = 1
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }

    $status = if ($exitCode -eq 0) { 'passed' } else { 'failed' }
    $summary = ($output -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Last 8) -join "`n"
    if ([string]::IsNullOrWhiteSpace($summary)) { $summary = "exit_code=$exitCode" }
    return New-PrReviewCheck -Name $Plan.name -Owner $Plan.owner -Status $status -Command $Plan.command -Cwd $Plan.cwd -ExitCode $exitCode -Summary $summary
}

function Invoke-PrReviewGitNexus {
    [CmdletBinding()]
    param(
        [switch] $NeedsGitNexus,
        [switch] $SkipGitNexus,
        [switch] $AllowUnavailable,
        [switch] $SimulateUnavailable,
        [switch] $SimulateFailure,
        [string] $RepoName = ''
    )

    $record = [ordered]@{
        required      = [bool]$NeedsGitNexus
        status        = 'not_required'
        command       = ''
        summary       = ''
        risk_level    = 'none'
        affected      = @()
    }

    if (-not $NeedsGitNexus) { return [pscustomobject]$record }
    if ($SkipGitNexus) {
        $record.status = if ($AllowUnavailable) { 'warning' } else { 'unavailable' }
        $record.summary = 'GitNexus execution skipped by caller.'
        return [pscustomobject]$record
    }
    if ($SimulateUnavailable) {
        $record.status = 'unavailable'
        $record.summary = 'GitNexus unavailable simulated by test fixture.'
        return [pscustomobject]$record
    }
    if ($SimulateFailure) {
        $record.status = 'failed'
        $record.summary = 'GitNexus failed simulated by test fixture.'
        return [pscustomobject]$record
    }

    $cmd = Get-Command gitnexus -ErrorAction SilentlyContinue
    if (-not $cmd) {
        $record.status = 'unavailable'
        $record.summary = 'gitnexus CLI not found on PATH.'
        return [pscustomobject]$record
    }

    if ([string]::IsNullOrWhiteSpace($RepoName)) { $RepoName = 'AI-BIM-governance' }
    $record.command = "gitnexus detect-changes --repo `"$RepoName`""
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & gitnexus detect-changes --repo $RepoName 2>&1 | Out-String
        $exitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 0 }
        $record.summary = ($output -split "`r?`n" | Where-Object { $_ } | Select-Object -First 20) -join "`n"
        if ($exitCode -eq 0) {
            $record.status = 'passed'
        } elseif (Test-PrReviewGitNexusUnavailableMessage -Summary $record.summary) {
            $record.status = 'unavailable'
        } else {
            $record.status = 'failed'
        }
    } catch {
        $record.status = 'failed'
        $record.summary = $_ | Out-String
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return [pscustomobject]$record
}

function Test-PrReviewGitNexusUnavailableMessage {
    [CmdletBinding()]
    param([string] $Summary)

    return $Summary -match 'Repository ".+" not found|Available:|not indexed|No indexed repositories found|Run:\s*gitnexus analyze|registry entry .* was not added'
}

function Get-PrReviewRiskLevel {
    [CmdletBinding()]
    param(
        [object[]] $Blockers,
        [object[]] $Warnings,
        [object[]] $Checks,
        $GitNexus
    )

    foreach ($blocker in @($Blockers)) {
        if ($blocker.severity -eq 'critical') { return 'critical' }
    }
    foreach ($check in @($Checks)) {
        if ($check.status -eq 'failed') { return 'high' }
    }
    if ($GitNexus.required -and $GitNexus.status -in @('unavailable', 'failed')) { return 'high' }
    if (@($Blockers).Count -gt 0) { return 'high' }
    if (@($Warnings).Count -gt 0) { return 'medium' }
    return 'low'
}

function ConvertTo-PrReviewMarkdown {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] $Report)

    $lines = New-Object System.Collections.Generic.List[string]
    [void]$lines.Add('# PR Review Agent Summary')
    [void]$lines.Add('')
    [void]$lines.Add("| Field | Value |")
    [void]$lines.Add("|---|---|")
    [void]$lines.Add('| Status | `' + $Report.status + '` |')
    [void]$lines.Add('| Risk | `' + $Report.risk_level + '` |')
    [void]$lines.Add('| PR | `' + $Report.pr_number + '` |')
    [void]$lines.Add('| Head | `' + $Report.head_ref + '` / `' + $Report.head_sha + '` |')
    [void]$lines.Add('| Base | `' + $Report.base_ref + '` / `' + $Report.base_sha + '` |')
    [void]$lines.Add('')
    [void]$lines.Add('## Blockers')
    if (@($Report.blockers).Count -eq 0) {
        [void]$lines.Add('- None')
    } else {
        foreach ($b in $Report.blockers) { [void]$lines.Add("- [$($b.severity)] $($b.path) $($b.message)") }
    }
    [void]$lines.Add('')
    [void]$lines.Add('## Warnings')
    if (@($Report.warnings).Count -eq 0) {
        [void]$lines.Add('- None')
    } else {
        foreach ($w in $Report.warnings) { [void]$lines.Add("- [$($w.severity)] $($w.path) $($w.message)") }
    }
    [void]$lines.Add('')
    [void]$lines.Add('## Validation Commands')
    if (@($Report.validation_commands).Count -eq 0) {
        [void]$lines.Add('- None selected')
    } else {
        foreach ($cmd in $Report.validation_commands) { [void]$lines.Add('- `' + $cmd + '`') }
    }
    [void]$lines.Add('')
    [void]$lines.Add('## Checks')
    if (@($Report.checks).Count -eq 0) {
        [void]$lines.Add('- None')
    } else {
        foreach ($check in $Report.checks) { [void]$lines.Add('- `' + $check.status + '` ' + $check.name + ' (' + $check.owner + ')') }
    }
    [void]$lines.Add('')
    [void]$lines.Add('## Human Review Notes')
    if (@($Report.human_review_notes).Count -eq 0) {
        [void]$lines.Add('- None')
    } else {
        foreach ($note in $Report.human_review_notes) { [void]$lines.Add("- $note") }
    }
    return ($lines -join "`n") + "`n"
}

function Invoke-PrReviewAgent {
    [CmdletBinding()]
    param(
        [string] $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path,
        [string[]] $ChangedPaths,
        [string] $BaseRef = $env:GITHUB_BASE_REF,
        [string] $HeadRef = $env:GITHUB_HEAD_REF,
        [string] $BaseSha = '',
        [string] $HeadSha = '',
        [string] $PrNumber = $env:PR_NUMBER,
        [string] $RunId = $env:GITHUB_RUN_ID,
        [string] $OutputDir = (Join-Path (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path 'artifacts\pr-review-agent'),
        [switch] $ReportOnly,
        [switch] $SkipCommandExecution,
        [switch] $SkipGitNexus,
        [switch] $AllowGitNexusUnavailable,
        [switch] $AllowUnavailableCommands,
        [switch] $SimulateGitNexusUnavailable,
        [switch] $SimulateGitNexusFailure
    )

    if ([string]::IsNullOrWhiteSpace($RunId)) { $RunId = [Guid]::NewGuid().ToString('N') }
    if (-not $ChangedPaths -or $ChangedPaths.Count -eq 0) {
        $ChangedPaths = Get-PrReviewChangedPathsFromGit -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
    } else {
        $ChangedPaths = @($ChangedPaths | ForEach-Object { ConvertTo-PrReviewPath $_ } | Sort-Object -Unique)
    }

    $openSpecChangeIds = @(Get-PrReviewOpenSpecChangeIds -ChangedPaths $ChangedPaths)
    $guards = Get-PrReviewPathGuardFindings -ChangedPaths $ChangedPaths -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
    $blockers = New-Object System.Collections.Generic.List[object]
    $warnings = New-Object System.Collections.Generic.List[object]
    foreach ($b in @($guards.blockers)) { [void]$blockers.Add($b) }
    foreach ($w in @($guards.warnings)) { [void]$warnings.Add($w) }

    $hasFormalOpenSpecEvidence = Test-PrReviewHasFormalOpenSpecEvidence -ChangedPaths $ChangedPaths
    if ((Test-PrReviewNeedsOpenSpec -ChangedPaths $ChangedPaths) -and $openSpecChangeIds.Count -eq 0 -and -not $hasFormalOpenSpecEvidence) {
        [void]$blockers.Add((New-PrReviewIssue -Kind 'missing_openspec' -Severity 'high' -Message 'Behavior, workflow, code, or repo-boundary changes require an OpenSpec change id or documented exception.'))
    }

    $plans = @(Get-PrReviewValidationPlan -ChangedPaths $ChangedPaths -RepoRoot $RepoRoot -OpenSpecChangeIds $openSpecChangeIds)
    $checks = New-Object System.Collections.Generic.List[object]
    foreach ($plan in $plans) {
        $check = Invoke-PrReviewCommand -Plan $plan -SkipExecution:$SkipCommandExecution
        [void]$checks.Add($check)
        if ($check.status -eq 'failed') {
            [void]$blockers.Add((New-PrReviewIssue -Kind 'validation_failed' -Severity 'high' -Path $check.cwd -Message "Required validation failed: $($check.name)."))
        } elseif ($check.status -eq 'skipped' -and $check.exit_code -eq 127) {
            if ($AllowUnavailableCommands) {
                [void]$warnings.Add((New-PrReviewIssue -Kind 'validation_unavailable' -Severity 'medium' -Path $check.cwd -Message "Validation command unavailable: $($check.name). $($check.summary)"))
            } else {
                [void]$blockers.Add((New-PrReviewIssue -Kind 'validation_unavailable' -Severity 'high' -Path $check.cwd -Message "Required validation command unavailable: $($check.name). $($check.summary)"))
            }
        }
    }

    $needsGitNexus = Test-PrReviewNeedsGitNexus -ChangedPaths $ChangedPaths
    $gitnexus = Invoke-PrReviewGitNexus -NeedsGitNexus:$needsGitNexus -SkipGitNexus:$SkipGitNexus -AllowUnavailable:$AllowGitNexusUnavailable -SimulateUnavailable:$SimulateGitNexusUnavailable -SimulateFailure:$SimulateGitNexusFailure -RepoName 'AI-BIM-governance'
    if ($needsGitNexus -and $AllowGitNexusUnavailable -and $gitnexus.status -eq 'unavailable') {
        $gitnexus.status = 'warning'
    }
    if ($needsGitNexus -and $gitnexus.status -eq 'failed') {
        [void]$blockers.Add((New-PrReviewIssue -Kind 'gitnexus_failed' -Severity 'high' -Message "GitNexus detect changes executed but failed. $($gitnexus.summary)"))
    } elseif ($needsGitNexus -and $gitnexus.status -eq 'unavailable' -and -not $AllowGitNexusUnavailable) {
        [void]$blockers.Add((New-PrReviewIssue -Kind 'gitnexus_unavailable' -Severity 'high' -Message "GitNexus detect changes is required for code/script changes but status is '$($gitnexus.status)'."))
    } elseif ($needsGitNexus -and $gitnexus.status -ne 'passed') {
        [void]$warnings.Add((New-PrReviewIssue -Kind 'gitnexus_warning' -Severity 'medium' -Message "GitNexus detect changes did not pass: $($gitnexus.status)."))
    }

    $optionalAiSkipped = [string]::IsNullOrWhiteSpace($env:PR_REVIEW_AGENT_REQUIRE_AI)
    if (-not $optionalAiSkipped -and [string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) {
        [void]$blockers.Add((New-PrReviewIssue -Kind 'ai_adapter_unavailable' -Severity 'high' -Message 'PR_REVIEW_AGENT_REQUIRE_AI is set but OPENAI_API_KEY is unavailable.'))
    }

    $blockerArray = @($blockers.ToArray())
    $warningArray = @($warnings.ToArray())
    $checkArray = @($checks.ToArray())
    $risk = Get-PrReviewRiskLevel -Blockers $blockerArray -Warnings $warningArray -Checks $checkArray -GitNexus $gitnexus
    $hasFailedCheck = @($checkArray | Where-Object { $_.status -eq 'failed' }).Count -gt 0
    $status = if ($hasFailedCheck) {
        'failed'
    } elseif ($blockerArray.Count -gt 0) {
        'blocked'
    } elseif ($warningArray.Count -gt 0) {
        'warning'
    } else {
        'passed'
    }

    $humanNotes = New-Object System.Collections.Generic.List[string]
    if ($ReportOnly) { [void]$humanNotes.Add('Report-only mode is enabled; this run should not be treated as merge approval.') }
    if ($openSpecChangeIds.Count -gt 0) { [void]$humanNotes.Add("OpenSpec changes detected: $($openSpecChangeIds -join ', ')") }
    if ($hasFormalOpenSpecEvidence -and $openSpecChangeIds.Count -eq 0) { [void]$humanNotes.Add('OpenSpec archive or formal spec evidence detected; active change-id validation was skipped.') }
    if ($ChangedPaths.Count -eq 0) { [void]$humanNotes.Add('No changed paths were detected; verify base/head configuration.') }
    if ($optionalAiSkipped) { [void]$humanNotes.Add('Optional AI adapter is not required by policy and was skipped.') }

    $report = [ordered]@{
        schema_version      = 'pr-review-agent/v1'
        status              = $status
        risk_level          = $risk
        report_only         = [bool]$ReportOnly
        pr_number           = $PrNumber
        base_ref            = $BaseRef
        head_ref            = $HeadRef
        base_sha            = $BaseSha
        head_sha            = $HeadSha
        run_id              = $RunId
        generated_at        = (Get-Date).ToUniversalTime().ToString('o')
        changed_paths       = @($ChangedPaths)
        openspec_changes    = @($openSpecChangeIds)
        validation_commands = @($plans | ForEach-Object { $_.command })
        checks              = $checkArray
        blockers            = $blockerArray
        warnings            = $warningArray
        human_review_notes  = @($humanNotes)
        gitnexus            = $gitnexus
    }

    if (-not (Test-Path -LiteralPath $OutputDir)) {
        New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    }
    $jsonPath = Join-Path $OutputDir 'pr-review-agent.json'
    $markdownPath = Join-Path $OutputDir 'pr-review-agent.md'
    $json = $report | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($jsonPath, $json, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($markdownPath, (ConvertTo-PrReviewMarkdown -Report $report), [System.Text.UTF8Encoding]::new($false))

    return [pscustomobject]@{
        report        = $report
        json_path     = $jsonPath
        markdown_path = $markdownPath
    }
}
