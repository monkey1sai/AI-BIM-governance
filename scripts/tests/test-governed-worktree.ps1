Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$libraryPath = Join-Path $repoRoot 'scripts\lib\governed-worktree.ps1'

if (-not (Test-Path -LiteralPath $libraryPath -PathType Leaf)) {
    throw "governed worktree library is missing: $libraryPath"
}
. $libraryPath

function Assert-True {
    param([bool] $Condition, [string] $Message)
    if (-not $Condition) { throw "ASSERT TRUE FAILED: $Message" }
}

function Assert-Equal {
    param($Expected, $Actual, [string] $Message)
    if ($Expected -cne $Actual) {
        throw "ASSERT EQUAL FAILED: $Message (expected=$Expected actual=$Actual)"
    }
}

function Assert-ThrowsReason {
    param([scriptblock] $Action, [string] $Reason, [string] $Message)
    try {
        & $Action
        throw "ASSERT THROWS FAILED: $Message"
    }
    catch {
        if ($_.Exception.Message -notmatch [regex]::Escape($Reason)) {
            throw "ASSERT THROWS FAILED: $Message (actual=$($_.Exception.Message))"
        }
    }
}

$eligible = Test-GovernedWorktreeIdentityObservation -Observation ([pscustomobject]@{
    IsWindows    = $true
    IdentityName = 'DESKTOP-7VF1E3D\jacks'
    IdentitySid  = 'S-1-5-21-1-2-3-1001'
    ProfileSid   = 'S-1-5-21-1-2-3-1001'
    ProfilePath  = 'C:\Users\IOT'
    UserProfile  = 'C:\Users\IOT'
    IsElevated   = $false
    IsSandbox    = $false
})
Assert-True $eligible.Eligible 'matching non-elevated host profile must be eligible'
Assert-Equal 'eligible' $eligible.Reason 'eligible reason'

$sandbox = Test-GovernedWorktreeIdentityObservation -Observation ([pscustomobject]@{
    IsWindows    = $true
    IdentityName = 'DESKTOP-7VF1E3D\CodexSandboxOffline'
    IdentitySid  = 'S-1-5-21-1-2-3-1004'
    ProfileSid   = ''
    ProfilePath  = ''
    UserProfile  = 'C:\Users\IOT'
    IsElevated   = $false
    IsSandbox    = $true
})
Assert-True (-not $sandbox.Eligible) 'sandbox identity must be rejected'
Assert-Equal 'sandbox_identity' $sandbox.Reason 'sandbox rejection reason'

$elevated = Test-GovernedWorktreeIdentityObservation -Observation ([pscustomobject]@{
    IsWindows    = $true
    IdentityName = 'DESKTOP-7VF1E3D\jacks'
    IdentitySid  = 'S-1-5-21-1-2-3-1001'
    ProfileSid   = 'S-1-5-21-1-2-3-1001'
    ProfilePath  = 'C:\Users\IOT'
    UserProfile  = 'C:\Users\IOT'
    IsElevated   = $true
    IsSandbox    = $false
})
Assert-True (-not $elevated.Eligible) 'elevated token must be rejected'
Assert-Equal 'elevated_token' $elevated.Reason 'elevated rejection reason'

$mismatch = Test-GovernedWorktreeIdentityObservation -Observation ([pscustomobject]@{
    IsWindows    = $true
    IdentityName = 'DESKTOP-7VF1E3D\jacks'
    IdentitySid  = 'S-1-5-21-1-2-3-1001'
    ProfileSid   = 'S-1-5-21-1-2-3-9999'
    ProfilePath  = 'C:\Users\Other'
    UserProfile  = 'C:\Users\IOT'
    IsElevated   = $false
    IsSandbox    = $false
})
Assert-True (-not $mismatch.Eligible) 'profile SID mismatch must be rejected'
Assert-Equal 'profile_sid_mismatch' $mismatch.Reason 'profile mismatch reason'

$target = Get-GovernedWorktreeTarget -MainRoot 'C:\Repos\active\iot\AI-BIM-governance' -BranchName 'fix/host-owned-worktree-guard'
Assert-Equal 'C:\Repos\active\iot\AI-BIM-governance.worktrees\host-owned-worktree-guard' $target 'canonical sibling target'

Assert-ThrowsReason { Get-GovernedWorktreeTarget -MainRoot 'C:\repo' -BranchName 'feature/nope' } 'branch_name_invalid' 'unknown branch type must fail'
Assert-ThrowsReason { Get-GovernedWorktreeTarget -MainRoot 'C:\repo' -BranchName 'fix/nested/path' } 'branch_name_invalid' 'nested branch path must fail'
Assert-ThrowsReason { Get-GovernedWorktreeTarget -MainRoot 'C:\repo' -BranchName 'fix/../escape' } 'branch_name_invalid' 'path traversal must fail'

$porcelain = @(
    'worktree C:/repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree C:/repo.worktrees/feature',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/fix/feature',
    'locked retained',
    ''
) -join "`n"
$records = @(ConvertFrom-GitWorktreePorcelain -Text $porcelain)
Assert-Equal 2 $records.Count 'porcelain record count'
Assert-Equal 'C:/repo.worktrees/feature' $records[1].Path 'linked worktree path'
Assert-Equal 'refs/heads/fix/feature' $records[1].Branch 'linked branch'
Assert-True $records[1].Locked 'locked flag'
Assert-True (-not $records[1].Prunable) 'prunable defaults false'

$ready = Get-GovernedWorktreeRemovalReadiness -IsMain:$false -BoardAvailable:$true -GitAccessible:$true -Dirty:$false -Merged:$true -Active:$false -Locked:$false -Prunable:$false
Assert-True $ready.Ready 'clean merged inactive linked worktree can enter manual removal review'
Assert-Equal 'eligible_for_manual_review' $ready.Reason 'manual review reason'

$active = Get-GovernedWorktreeRemovalReadiness -IsMain:$false -BoardAvailable:$true -GitAccessible:$true -Dirty:$false -Merged:$true -Active:$true -Locked:$false -Prunable:$false
Assert-True (-not $active.Ready) 'active worktree must not enter removal review'
Assert-Equal 'active_writer' $active.Reason 'active writer rejection reason'

$boardUnknown = Get-GovernedWorktreeRemovalReadiness -IsMain:$false -BoardAvailable:$false -GitAccessible:$true -Dirty:$false -Merged:$true -Active:$false -Locked:$false -Prunable:$false
Assert-True (-not $boardUnknown.Ready) 'unknown board state must not enter removal review'
Assert-Equal 'board_status_unknown' $boardUnknown.Reason 'unknown board rejection reason'

$cliPath = Join-Path $repoRoot 'scripts\dev\new-governed-worktree.ps1'
if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
    throw "governed worktree CLI is missing: $cliPath"
}

$cliSource = Get-Content -Raw -LiteralPath $cliPath
foreach ($forbiddenPattern in @(
    'safe\.directory',
    'git\s+config\s+--global',
    '\bSet-Acl\b',
    '\btakeown(?:\.exe)?\b',
    '\bicacls(?:\.exe)?\b',
    "'worktree'\s*,\s*'remove'",
    "'worktree'\s*,\s*'prune'"
)) {
    Assert-True ($cliSource -notmatch $forbiddenPattern) "CLI must not contain forbidden operation: $forbiddenPattern"
}
Assert-True ($cliSource -match "'fetch'\s*,\s*'origin'\s*,\s*'--prune'") 'create mode must freshly fetch origin/main'
Assert-True ($cliSource -match "'worktree'\s*,\s*'add'\s*,\s*'-b'") 'create mode must use an explicit branch and worktree add'
Assert-True ($cliSource -match 'StructLog\.psm1') 'mutating create mode must use the repository structured logger'
Assert-True ($cliSource -match "\.tmp\\logs") 'structured logs must stay in the gitignored repository temp root'

$inventoryText = @(& pwsh -NoProfile -NonInteractive -File $cliPath -Inventory -Json)
if ($LASTEXITCODE -ne 0) { throw "inventory CLI failed: $($inventoryText -join [Environment]::NewLine)" }
$inventory = ($inventoryText -join [Environment]::NewLine) | ConvertFrom-Json
Assert-Equal 'governed-worktree-inventory/v1' ([string]$inventory.schema_version) 'inventory schema'
Assert-True ([bool]$inventory.read_only) 'inventory must declare read-only behavior'
Assert-True ([bool]$inventory.board.available) 'inventory must observe the no-prune board status'
Assert-Equal 'origin/main' ([string]$inventory.merge_basis.ref) 'inventory declares its merge basis'
Assert-True (-not [bool]$inventory.merge_basis.refreshed) 'read-only inventory must not claim it fetched origin/main'
Assert-True (@($inventory.worktrees).Count -gt 0) 'inventory must include registered worktrees'
$currentRootKey = ConvertTo-GovernedPathKey -Path $repoRoot
$currentRows = @($inventory.worktrees | Where-Object {
    (ConvertTo-GovernedPathKey -Path ([string]$_.path)) -ceq $currentRootKey
})
Assert-Equal 1 $currentRows.Count 'inventory includes the current worktree exactly once'
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$expectedOwnerMatch = (
    [string]$currentRows[0].root_filesystem_owner_sid -ceq $currentSid -and
    [string]$currentRows[0].git_metadata_owner_sid -ceq $currentSid
)
Assert-Equal $expectedOwnerMatch ([bool]$currentRows[0].owners_match_current_identity) 'inventory owner-match projection is truthful'

$plannedBranch = "fix/governed-worktree-plan-$PID"
$plannedTarget = Get-GovernedWorktreeTarget -MainRoot ([string]$inventory.main_root) -BranchName $plannedBranch
Assert-True (-not (Test-Path -LiteralPath $plannedTarget)) 'plan fixture target starts absent'
$planText = @(& pwsh -NoProfile -NonInteractive -File $cliPath -BranchName $plannedBranch -PlanOnly -Json)
$planPayload = ($planText -join [Environment]::NewLine) | ConvertFrom-Json
$currentEligibility = Test-GovernedWorktreeIdentityObservation -Observation (Get-GovernedWorktreeIdentityObservation)
if ($currentEligibility.Eligible) {
    Assert-Equal 0 $LASTEXITCODE 'eligible host plan exits successfully'
    Assert-Equal 'governed-worktree-create-plan/v1' ([string]$planPayload.schema_version) 'plan schema'
    Assert-Equal $plannedBranch ([string]$planPayload.branch) 'planned branch'
    Assert-Equal $plannedTarget ([string]$planPayload.target) 'planned target'
    Assert-True (-not [bool]$planPayload.mutated) 'plan mode must declare no mutation'
}
else {
    Assert-Equal 2 $LASTEXITCODE 'ineligible runner plan fails closed'
    Assert-Equal 'governed-worktree-error/v1' ([string]$planPayload.schema_version) 'held plan schema'
    Assert-Equal 'held' ([string]$planPayload.status) 'ineligible runner stays held'
    Assert-True (
        [string]$planPayload.error -match "worktree_identity_rejected: $([regex]::Escape($currentEligibility.Reason))"
    ) 'held plan reports the observed identity rejection reason'
}
Assert-True (-not (Test-Path -LiteralPath $plannedTarget)) 'plan mode must not create the target'

Write-Host 'ALL TESTS PASSED' -ForegroundColor Green
