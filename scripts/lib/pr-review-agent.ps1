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

function Get-PrReviewContractDiffLinesForPath {
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

    $contractLines = New-Object System.Collections.Generic.List[object]
    foreach ($line in $diffLines) {
        if ($line.StartsWith('+++') -or $line.StartsWith('---')) { continue }
        if ($line.StartsWith('+')) {
            [void]$contractLines.Add([pscustomobject]@{ operation = 'added'; text = $line.Substring(1) })
        } elseif ($line.StartsWith('-')) {
            [void]$contractLines.Add([pscustomobject]@{ operation = 'deleted'; text = $line.Substring(1) })
        }
    }
    return @($contractLines.ToArray())
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

function Test-PrReviewPathExistsAtBase {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Path,
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    # 無法取得 base（本機模式/淺 clone）時回 false，讓呼叫端落回保守分支（維持 blocker）。
    if ([string]::IsNullOrWhiteSpace($BaseSha) -or [string]::IsNullOrWhiteSpace($HeadSha)) {
        return $false
    }

    $safeRoot = $RepoRoot -replace '\\', '/'
    $mergeBase = (git -C $RepoRoot -c "safe.directory=$safeRoot" merge-base $BaseSha $HeadSha 2>$null | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($mergeBase)) { return $false }

    # 用 ls-tree 而非 cat-file -e：路徑不存在時 ls-tree 靜默回空（exit 0、無 stderr），
    # cat-file -e 會寫 stderr，在 Windows PowerShell 5.1 + EAP=Stop 下被包成 NativeCommandError 拋出。
    $entry = (git -C $RepoRoot -c "safe.directory=$safeRoot" ls-tree --name-only $mergeBase -- $Path 2>$null | Select-Object -First 1)
    return (-not [string]::IsNullOrWhiteSpace($entry))
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
        # behavior contract 變更的正式設計依據；視為 formal requirement evidence。
        # 注意:superpowers spec 非 OpenSpec 格式,不觸發 openspec validate
        # (Get-PrReviewValidationPlan 僅對 openspec/specs|changes/archive 路徑排 validate)。
        if ($normalized -match '^docs/superpowers/specs/.+\.md$') {
            return $true
        }
    }
    return $false
}

function Get-PrReviewMarkdownTableValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Body,
        [Parameter(Mandatory = $true)][string] $Label
    )

    $pattern = "(?im)^\|\s*$([regex]::Escape($Label))\s*\|\s*(.*?)\s*\|"
    $match = [regex]::Match($Body, $pattern)
    if (-not $match.Success) { return '' }
    return ($match.Groups[1].Value.Trim() -replace '^`|`$', '')
}

function Get-PrReviewChangeDeclaration {
    [CmdletBinding()]
    param([string] $BodyPath = '')

    $record = [ordered]@{
        change_lane               = ''
        behavior_contract_changed = ''
        requirement_source        = ''
    }
    if ([string]::IsNullOrWhiteSpace($BodyPath) -or -not (Test-Path -LiteralPath $BodyPath -PathType Leaf)) {
        return [pscustomobject]$record
    }

    $body = Get-Content -LiteralPath $BodyPath -Raw
    $record.change_lane = (Get-PrReviewMarkdownTableValue -Body $body -Label 'Change lane').Trim().ToUpperInvariant()
    $record.behavior_contract_changed = (Get-PrReviewMarkdownTableValue -Body $body -Label 'Behavior contract changed').Trim().ToLowerInvariant()
    $record.requirement_source = (Get-PrReviewMarkdownTableValue -Body $body -Label 'Requirement source').Trim()
    return [pscustomobject]$record
}

function Test-PrReviewRequirementSourceIsFormal {
    [CmdletBinding()]
    param([string] $RequirementSource = '')

    if ([string]::IsNullOrWhiteSpace($RequirementSource)) { return $false }
    $normalized = ($RequirementSource -replace '`', '').Trim().ToLowerInvariant()
    if ($normalized -eq 'not applicable') { return $false }
    return $normalized -match '^(issue|docs/plans|superpowers spec|existing contract)(\b|\s*:|/)'
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

function Get-PrReviewBehaviorContractSignals {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string[]] $ChangedPaths,
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    $signals = New-Object System.Collections.Generic.List[object]
    $seen = New-Object System.Collections.Generic.HashSet[string]
    foreach ($path in $ChangedPaths) {
        $p = ConvertTo-PrReviewPath $path
        if ($p -match '^(tests?|docs|openspec)/' -or $p -match '\.(md|txt|png|jpg|jpeg|svg)$') { continue }
        $diffLines = @(Get-PrReviewContractDiffLinesForPath -RepoRoot $RepoRoot -Path $p -BaseSha $BaseSha -HeadSha $HeadSha)
        foreach ($operation in @('added', 'deleted')) {
            $changedLines = @($diffLines | Where-Object { $_.operation -eq $operation } | ForEach-Object { $_.text })
            if ($changedLines.Count -eq 0) { continue }
            $changed = $changedLines -join "`n"

            $signalKinds = @()
            if ($changed -match '(?im)(@(?:app|router)\.(?:get|post|put|patch|delete)\s*\(|@(?:Get|Post|Put|Patch|Delete)\s*\(|\b(?:app|router|server)\.(?:get|post|put|patch|delete)\s*\(|\bMap(?:Get|Post|Put|Patch|Delete)\s*\()') {
                $signalKinds += 'public_api'
            }
            if ($changed -match '(?im)(<Route\b[^>]*\bpath=|createBrowserRouter\s*\(|\b(?:path|route|hash)\s*:\s*[''"](?:/|#))') {
                $signalKinds += 'user_facing_route'
            }
            if ($changed -match '(?im)(\bopenapi\s*:|"\$schema"\s*:|\b(?:request|response|event)[A-Za-z0-9_]*Schema\b|\b(?:CREATE|ALTER|DROP)\s+TABLE\b|\b(?:ADD|DROP|ALTER)\s+COLUMN\b)') {
                $signalKinds += 'schema_or_migration'
            }
            if ($p -match '(^|/)(?:schemas?|contracts?|events?)(/|$|\.)' -and
                $changed -match '(?im)^\s*(?:export\s+)?(?:interface|type|enum)\s+[A-Za-z0-9_]+|^\s*(?:required|properties)\s*:') {
                $signalKinds += 'schema_or_event_contract'
            }
            if ($p -match '(^|/)(?:compose[^/]*\.ya?ml|scripts/deploy\.ps1|migrations?|auth|security)(/|$|\.)' -and
                $changed -match '(?im)^\s*(?:services|ports|permissions|roles?|scopes?|authentication|authorization)\s*:|\b(?:CREATE|ALTER|DROP)\s+TABLE\b') {
                $signalKinds += 'runtime_deploy_security_boundary'
            }

            foreach ($kind in $signalKinds) {
                $key = "$kind|$operation|$p"
                if ($seen.Add($key)) {
                    [void]$signals.Add([pscustomobject]@{
                        kind = $kind
                        operation = $operation
                        path = $p
                        evidence = "High-confidence $operation-line contract signal."
                    })
                }
            }
        }
    }
    return @($signals.ToArray())
}

function Get-PrReviewGovernedLaneReasons {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string[]] $ChangedPaths,
        [object[]] $BehaviorSignals = @()
    )

    $reasons = New-Object System.Collections.Generic.HashSet[string]
    if (@($BehaviorSignals).Count -gt 0) { [void]$reasons.Add('behavior_contract_signal') }

    $serviceRoots = New-Object System.Collections.Generic.HashSet[string]
    foreach ($path in $ChangedPaths) {
        $p = ConvertTo-PrReviewPath $path
        if ($p -match '^(bim-review-coordinator|bim-streaming-server|governance-service|web-viewer-sample)/') {
            [void]$serviceRoots.Add($Matches[1])
        } elseif ($p -match '^(apps/kit-manager-web|services/kit-manager-api)/') {
            [void]$serviceRoots.Add($Matches[1])
        }

        if ($p -match '^bim-streaming-server/') {
            [void]$reasons.Add('kit_webrtc_gpu_runtime')
        }
        if ($p -match '^(scripts/deploy\.ps1|scripts/dev/rebuild-test-deploy\.ps1|scripts/lib/(?:preflight|deploy|host-native|rebuild)|infra/docker/|compose[^/]*\.ya?ml)') {
            [void]$reasons.Add('deploy_runtime_boundary')
        }
        if ($p -match '(^|/)(?:migrations?|auth|security|permissions?)(/|$|\.)') {
            [void]$reasons.Add('migration_auth_security')
        }
        if ($p -match '^scripts/.*(?:delete|destroy|drop|purge|reset|remove).*\.ps1$') {
            [void]$reasons.Add('destructive_script')
        }
    }
    if ($serviceRoots.Count -ge 2) { [void]$reasons.Add('cross_service') }
    return @($reasons | Sort-Object)
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
            } elseif ($p -in @(
                '.codex/skills/ai-bim-fast-fix/SKILL.md',
                '.codex/skills/ai-bim-bounded-change/SKILL.md',
                '.codex/skills/spec-to-done/agents/openai.yaml'
            )) {
                [void]$warnings.Add((New-PrReviewIssue -Kind 'repo_governance_skill' -Severity 'medium' -Path $p -Message 'PR adds or updates an explicitly allowlisted repo governance skill artifact; verify routing scope and rollback.'))
            } elseif (Test-PrReviewPathExistsAtBase -RepoRoot $RepoRoot -Path $p -BaseSha $BaseSha -HeadSha $HeadSha) {
                # merge-base 已追蹤＝#212 授權納管的鏡像檔（如 .codex/skills adapter）：修改降為
                # 人工複核 warning。新增路徑（或無 base 可判定）仍走 blocker，防塞入新生成物。
                [void]$warnings.Add((New-PrReviewIssue -Kind 'generated_tooling_path_modified' -Severity 'medium' -Path $p -Message 'PR modifies already-tracked tooling mirror state; human reviewer should verify adapter-sync scope.'))
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
        $riskMatch = [regex]::Match($output, '(?im)\brisk(?:_level)?\s*[:=]\s*(low|medium|high|critical)\b')
        if ($riskMatch.Success) { $record.risk_level = $riskMatch.Groups[1].Value.ToLowerInvariant() }
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
        [switch] $SimulateGitNexusFailure,
        [string] $PrBodyPath = '',
        [string] $ChangeLane = '',
        [string] $BehaviorContractChanged = '',
        [string] $RequirementSource = ''
    )

    if ([string]::IsNullOrWhiteSpace($RunId)) { $RunId = [Guid]::NewGuid().ToString('N') }
    if (-not $ChangedPaths -or $ChangedPaths.Count -eq 0) {
        $ChangedPaths = Get-PrReviewChangedPathsFromGit -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
    } else {
        $ChangedPaths = @($ChangedPaths | ForEach-Object { ConvertTo-PrReviewPath $_ } | Sort-Object -Unique)
    }

    $declaration = Get-PrReviewChangeDeclaration -BodyPath $PrBodyPath
    if ([string]::IsNullOrWhiteSpace($ChangeLane)) { $ChangeLane = $declaration.change_lane }
    if ([string]::IsNullOrWhiteSpace($BehaviorContractChanged)) { $BehaviorContractChanged = $declaration.behavior_contract_changed }
    if ([string]::IsNullOrWhiteSpace($RequirementSource)) { $RequirementSource = $declaration.requirement_source }
    $ChangeLane = $ChangeLane.Trim().ToUpperInvariant()
    $BehaviorContractChanged = $BehaviorContractChanged.Trim().ToLowerInvariant()

    $openSpecChangeIds = @(Get-PrReviewOpenSpecChangeIds -ChangedPaths $ChangedPaths)
    $guards = Get-PrReviewPathGuardFindings -ChangedPaths $ChangedPaths -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
    $blockers = New-Object System.Collections.Generic.List[object]
    $warnings = New-Object System.Collections.Generic.List[object]
    foreach ($b in @($guards.blockers)) { [void]$blockers.Add($b) }
    foreach ($w in @($guards.warnings)) { [void]$warnings.Add($w) }

    $hasFormalOpenSpecEvidence = Test-PrReviewHasFormalOpenSpecEvidence -ChangedPaths $ChangedPaths
    $hasFormalRequirement = $openSpecChangeIds.Count -gt 0 -or $hasFormalOpenSpecEvidence -or (Test-PrReviewRequirementSourceIsFormal -RequirementSource $RequirementSource)
    $behaviorSignals = @(Get-PrReviewBehaviorContractSignals -ChangedPaths $ChangedPaths -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha)
    $governedLaneReasons = @(Get-PrReviewGovernedLaneReasons -ChangedPaths $ChangedPaths -BehaviorSignals $behaviorSignals)
    if (($BehaviorContractChanged -eq 'yes' -or $ChangeLane -in @('G', 'S')) -and -not $hasFormalRequirement) {
        [void]$blockers.Add((New-PrReviewIssue -Kind 'missing_formal_requirement' -Severity 'high' -Message 'Behavior-changing or Governed/Spec-to-Done work requires Requirement source: issue, docs/plans, superpowers spec, or existing contract.'))
    }
    if ([string]::IsNullOrWhiteSpace($BehaviorContractChanged) -and $behaviorSignals.Count -gt 0) {
        [void]$blockers.Add((New-PrReviewIssue -Kind 'behavior_declaration_missing' -Severity 'high' -Message 'Diff-line analysis found behavior-contract signals, but Behavior contract changed was not declared. Pass PR body metadata or explicit review parameters.'))
    }
    if ($BehaviorContractChanged -eq 'no' -and $behaviorSignals.Count -gt 0) {
        $signalSummary = @($behaviorSignals | ForEach-Object { "$($_.operation):$($_.kind):$($_.path)" }) -join ', '
        [void]$blockers.Add((New-PrReviewIssue -Kind 'behavior_contract_mismatch' -Severity 'high' -Message "PR declares no behavior contract change, but diff-line analysis found: $signalSummary"))
    }
    if ($ChangeLane -in @('F', 'B') -and ($BehaviorContractChanged -eq 'yes' -or $governedLaneReasons.Count -gt 0)) {
        $reasonSummary = if ($governedLaneReasons.Count -gt 0) { $governedLaneReasons -join ', ' } else { 'behavior_contract_declared_changed' }
        [void]$blockers.Add((New-PrReviewIssue -Kind 'governed_lane_mismatch' -Severity 'high' -Message "Lane $ChangeLane is below the required Lane G minimum: $reasonSummary."))
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
    if ($ChangeLane -in @('F', 'B') -and $gitnexus.risk_level -in @('high', 'critical')) {
        [void]$blockers.Add((New-PrReviewIssue -Kind 'gitnexus_lane_mismatch' -Severity 'high' -Message "GitNexus risk is $($gitnexus.risk_level); Lane G is required."))
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
    if ($BehaviorContractChanged -eq 'no' -and $behaviorSignals.Count -eq 0) { [void]$humanNotes.Add('Behavior contract declared unchanged; changed paths alone did not trigger a formal-spec blocker.') }
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
        change_lane         = $ChangeLane
        behavior_contract_changed = $BehaviorContractChanged
        requirement_source  = $RequirementSource
        behavior_contract_signals = @($behaviorSignals)
        governed_lane_reasons = @($governedLaneReasons)
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
