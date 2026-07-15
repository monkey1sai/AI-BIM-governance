# Local PreToolUse auxiliary gate for `gh pr merge`.
# GitHub required checks remain the merge authority. This hook prevents an operator from merging the
# wrong checkout or bypassing the local desigin-system visual result for approved/mixed product UI.
# Functional/runtime evidence remains an independent required check; pixel evidence never replaces it.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Deny-DesignMerge {
    param([Parameter(Mandatory = $true)][string] $Reason)

    @{
        hookSpecificOutput = @{
            hookEventName = 'PreToolUse'
            permissionDecision = 'deny'
            permissionDecisionReason = "[browser-evidence-gate] $Reason"
        }
    } | ConvertTo-Json -Compress -Depth 6
    exit 0
}

$raw = ''
if ([Console]::IsInputRedirected) {
    try { $raw = [Console]::In.ReadToEnd() } catch { $raw = '' }
}
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

try {
    $payload = $raw | ConvertFrom-Json
    $command = [string]$payload.tool_input.command
} catch {
    Deny-DesignMerge 'PreToolUse payload 不是有效 JSON；無法安全判定 merge command。'
}
if ([string]::IsNullOrWhiteSpace($command)) {
    Deny-DesignMerge 'PreToolUse payload 缺少 tool_input.command；無法安全判定 merge command。'
}
$ghMergePattern = '(?i)\bgh(?:\.exe)?["'']?\s+pr\s+merge\b'
$mergeMatches = [regex]::Matches($command, $ghMergePattern)
if ($mergeMatches.Count -eq 0) { exit 0 }
$singleCommandPattern = '(?i)^\s*(?:(?:"[^"\r\n]*[\\/])|(?:[^\s;&|\r\n]*[\\/]))?gh(?:\.exe)?["'']?\s+pr\s+merge\b'
if ($mergeMatches.Count -ne 1 -or $command -notmatch $singleCommandPattern -or $command -match '&&|\|\||[;|]|[\r\n]') {
    Deny-DesignMerge 'gh pr merge 必須是單一、直接且可唯一綁定的命令；不得串接其他 shell command。'
}

$root = @(& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or $root.Count -ne 1 -or [string]::IsNullOrWhiteSpace($root[0])) {
    Deny-DesignMerge '無法解析目前 Git checkout；請從欲合併 PR 的 worktree 執行。'
}
$root = (Resolve-Path -LiteralPath $root[0]).Path
Set-Location -LiteralPath $root

$mergeMatch = $mergeMatches[0]
if (-not $mergeMatch.Success) {
    Deny-DesignMerge '無法定位 gh pr merge 參數；本機 hook 採 fail-closed。'
}
$tail = $command.Substring($mergeMatch.Index + $mergeMatch.Length)
$tokens = [System.Collections.Generic.List[string]]::new()
$argumentPattern = '(?<operator>&&|\|\||[;|])|(?<token>"(?:\\.|[^"])*"|''[^'']*''|[^\s;&|]+)'
foreach ($argumentMatch in [regex]::Matches($tail, $argumentPattern)) {
    if ($argumentMatch.Groups['operator'].Success) { break }
    $value = $argumentMatch.Groups['token'].Value
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) { $tokens.Add($value) }
}

$selectorCandidates = [System.Collections.Generic.List[string]]::new()
$repoSelector = ''
$valueOptions = @('--author-email', '--body', '-b', '--body-file', '-F', '--match-head-commit', '--subject', '-t', '--repo', '-R')
$flagOptions = @('--admin', '--auto', '--disable-auto', '--delete-branch', '--merge', '--rebase', '--squash')
for ($index = 0; $index -lt $tokens.Count; $index++) {
    $token = $tokens[$index]
    if ($token -match '^--(?<name>author-email|body|body-file|match-head-commit|subject|repo)=(?<value>.*)$') {
        if ($Matches.name -eq 'repo') {
            if ([string]::IsNullOrWhiteSpace($Matches.value)) { Deny-DesignMerge '--repo 缺少值。' }
            $repoSelector = $Matches.value
        }
        continue
    }
    if ($token -match '^-R(?<value>.+)$') {
        $repoSelector = $Matches.value
        continue
    }
    if ($token -in $valueOptions) {
        if ($index + 1 -ge $tokens.Count -or $tokens[$index + 1].StartsWith('-')) {
            Deny-DesignMerge "gh pr merge option '$token' 缺少值。"
        }
        $index++
        if ($token -in @('--repo', '-R')) { $repoSelector = $tokens[$index] }
        continue
    }
    if ($token -in $flagOptions) { continue }
    if ($token.StartsWith('-')) {
        Deny-DesignMerge "無法安全解析 gh pr merge option '$token'；本機 hook 採 fail-closed。"
    }
    $selectorCandidates.Add($token)
}
if ($selectorCandidates.Count -gt 1) {
    Deny-DesignMerge "gh pr merge 有多個可能的 PR selector：$($selectorCandidates -join ', ')。"
}
$selector = if ($selectorCandidates.Count -eq 1) { $selectorCandidates[0] } else { '' }
$ghArguments = @('pr', 'view')
if (-not [string]::IsNullOrWhiteSpace($selector)) { $ghArguments += $selector }
if (-not [string]::IsNullOrWhiteSpace($repoSelector)) { $ghArguments += @('--repo', $repoSelector) }
$ghArguments += @('--json', 'baseRefOid,headRefOid')
$prRaw = @(& gh @ghArguments 2>$null)
if ($LASTEXITCODE -ne 0 -or $prRaw.Count -eq 0) {
    Deny-DesignMerge '無法解析 gh pr merge 的目標 PR；本機 hook 採 fail-closed。'
}
try { $pr = ($prRaw -join "`n") | ConvertFrom-Json } catch { Deny-DesignMerge '目標 PR metadata 不是合法 JSON。' }
$baseSha = [string]$pr.baseRefOid
$headSha = [string]$pr.headRefOid
if ($baseSha -notmatch '^[0-9a-f]{40}$' -or $headSha -notmatch '^[0-9a-f]{40}$') {
    Deny-DesignMerge '目標 PR 缺少完整 base/head commit SHA。'
}

$localHead = @(& git -c "safe.directory=$root" rev-parse HEAD 2>$null)
if ($LASTEXITCODE -ne 0 -or $localHead.Count -ne 1 -or $localHead[0].Trim() -ne $headSha) {
    Deny-DesignMerge "目前 checkout HEAD 與目標 PR head 不同；expected=$headSha。"
}
$changed = @(& git -c "safe.directory=$root" diff --no-renames --name-only "${baseSha}...${headSha}" 2>$null)
if ($LASTEXITCODE -ne 0) {
    Deny-DesignMerge '無法計算目標 PR 的 base...head changed paths。'
}

$scopeLibrary = Join-Path $root 'scripts/lib/design-system-gate.ps1'
if (-not (Test-Path -LiteralPath $scopeLibrary -PathType Leaf)) {
    Deny-DesignMerge 'design-system scope library 不存在。'
}
try {
    . $scopeLibrary
    $scope = Get-DesignSystemChangeScope -RepoRoot $root -ChangedPaths $changed -BaseSha $baseSha -HeadSha $headSha
} catch {
    Deny-DesignMerge "design scope 解析失敗：$($_.Exception.Message)"
}
if ($scope.status -like '*_fail_closed') {
    Deny-DesignMerge "design scope 採 fail-closed：status=$($scope.status)；unknown=$($scope.unknown_paths -join ', ')；reference-authority=$($scope.reference_authority_paths -join ', ')。"
}
if (-not [bool]$scope.frontend_product) { exit 0 }
if (-not [bool]$scope.visual_required) {
    # Pure reference-missing product work may merge only as honest partial work. The remote PR-body
    # and functional/runtime required checks still enforce no full-completion claim and real evidence.
    exit 0
}

$validator = Join-Path $root 'scripts/tests/verify-design-system-visual-result.ps1'
$resultPath = Join-Path $root 'artifacts/e2e/design-system-visual-result.json'
if (-not (Test-Path -LiteralPath $validator -PathType Leaf) -or -not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
    Deny-DesignMerge "approved/mixed frontend scope '$($scope.status)' 缺 canonical local visual result：$resultPath。"
}
try {
    $validationOutput = @(& $validator `
        -RepoRoot $root `
        -ResultPath $resultPath `
        -RequiredScreenIds @($scope.required_screen_ids) `
        -TargetCommit $headSha `
        -MaxAgeHours 24 `
        -AllowUntrackedArtifacts 2>&1)
} catch {
    Deny-DesignMerge "desigin-system visual gate 執行失敗：$($_.Exception.Message)。functional/runtime gate 仍須另外通過。"
}
if ($LASTEXITCODE -ne 0) {
    $detail = (($validationOutput | Select-Object -Last 1) | Out-String).Trim()
    Deny-DesignMerge "desigin-system visual gate 未通過：$detail。functional/runtime gate 仍須另外通過。"
}

exit 0
