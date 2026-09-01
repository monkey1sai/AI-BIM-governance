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

$gitEnvironmentFixtures = [ordered]@{
    GIT_CONFIG_PARAMETERS = "'remote.origin.url=C:/untrusted'"
    GIT_FUTURE_ROUTING_CONTROL = 'untrusted'
}
foreach ($entry in $gitEnvironmentFixtures.GetEnumerator()) {
    Set-Item -LiteralPath "Env:$($entry.Key)" -Value ([string]$entry.Value)
}
$savedGitEnvironment = Remove-GovernedGitRoutingEnvironment
try {
    foreach ($name in $gitEnvironmentFixtures.Keys) {
        Assert-True (-not (Test-Path -LiteralPath "Env:$name")) "all inherited Git variables must be scrubbed: $name"
    }
}
finally {
    Restore-GovernedGitRoutingEnvironment -Saved $savedGitEnvironment
}
foreach ($entry in $gitEnvironmentFixtures.GetEnumerator()) {
    Assert-Equal ([string]$entry.Value) ([string](Get-Item -LiteralPath "Env:$($entry.Key)").Value) "Git variable must be restored: $($entry.Key)"
    Remove-Item -LiteralPath "Env:$($entry.Key)"
}

$primaryEligible = Test-GovernedPrimaryCheckoutState `
    -BranchRef 'refs/heads/main' -Head 'abc123' -OriginMain 'abc123' -Dirty:$false
Assert-True $primaryEligible.Eligible 'clean aligned main checkout is eligible for creation'

$primaryBranchMismatch = Test-GovernedPrimaryCheckoutState `
    -BranchRef 'refs/heads/feature' -Head 'abc123' -OriginMain 'abc123' -Dirty:$false
Assert-Equal 'primary_checkout_not_main' $primaryBranchMismatch.Reason 'primary checkout branch mismatch reason'

$primaryDirty = Test-GovernedPrimaryCheckoutState `
    -BranchRef 'refs/heads/main' -Head 'abc123' -OriginMain 'abc123' -Dirty:$true
Assert-Equal 'primary_checkout_dirty' $primaryDirty.Reason 'primary checkout dirty reason'

$primaryBehind = Test-GovernedPrimaryCheckoutState `
    -BranchRef 'refs/heads/main' -Head 'abc123' -OriginMain 'def456' -Dirty:$false
Assert-Equal 'primary_checkout_not_aligned' $primaryBehind.Reason 'primary checkout alignment reason'

$preMutationFailure = New-GovernedWorktreeFailurePayload `
    -ErrorMessage 'primary_checkout_invariant_failed' `
    -MutationState 'not_started' `
    -Branch 'fix/example' `
    -Target 'C:\repo.worktrees\example'
Assert-True (-not [bool]$preMutationFailure.mutation_may_have_occurred) `
    'pre-mutation failures must report that no Git artifact mutation may have occurred'

$postAddFailure = New-GovernedWorktreeFailurePayload `
    -ErrorMessage 'worktree_owner_postcondition_failed' `
    -MutationState 'worktree_added' `
    -Branch 'fix/example' `
    -Target 'C:\repo.worktrees\example'
Assert-True ([bool]$postAddFailure.mutation_may_have_occurred) `
    'post-add failures must expose possible partial Git artifacts'
Assert-Equal 'worktree_added' ([string]$postAddFailure.mutation_state) `
    'post-add failures preserve the exact mutation state'
Assert-Equal 'fix/example' ([string]$postAddFailure.branch) 'failure payload preserves branch identity'
Assert-Equal 'C:\repo.worktrees\example' ([string]$postAddFailure.target) 'failure payload preserves target identity'

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

$nestedSessionPath = Join-Path $repoRoot 'scripts\dev'
$siblingSessionPath = "${repoRoot}-sibling"
$activitySessions = @(
    [pscustomobject]@{ agent = 'exact'; status = 'active'; cwd = $repoRoot },
    [pscustomobject]@{ agent = 'nested'; status = 'idle'; cwd = $nestedSessionPath },
    [pscustomobject]@{ agent = 'ended'; status = 'ended'; cwd = $nestedSessionPath },
    [pscustomobject]@{ agent = 'sibling'; status = 'active'; cwd = $siblingSessionPath }
)
$activeAgents = @(Get-GovernedWorktreeActiveAgents -Sessions $activitySessions -WorktreePath $repoRoot)
Assert-Equal 2 $activeAgents.Count 'every non-ended exact or descendant session owns the worktree'
Assert-True ($activeAgents -contains 'exact') 'exact active session is detected'
Assert-True ($activeAgents -contains 'nested') 'idle descendant session is detected'
Assert-True ($activeAgents -notcontains 'ended') 'ended descendant session is ignored'
Assert-True ($activeAgents -notcontains 'sibling') 'sibling path is not treated as a descendant'

$ready = Get-GovernedWorktreeRemovalReadiness -IsMain:$false -BoardAvailable:$true -GitAccessible:$true -Dirty:$false -HeadAncestor:$true -Active:$false -Locked:$false -Prunable:$false -OwnerObservationsAvailable:$true -OwnersMatchCurrentIdentity:$true -IdentityEligible:$true
Assert-True $ready.Ready 'clean merged inactive linked worktree can enter manual removal review'
Assert-Equal 'eligible_for_manual_review' $ready.Reason 'manual review reason'

$identityRejected = Get-GovernedWorktreeRemovalReadiness -IsMain:$false -BoardAvailable:$true -GitAccessible:$true -Dirty:$false -HeadAncestor:$true -Active:$false -Locked:$false -Prunable:$false -OwnerObservationsAvailable:$true -OwnersMatchCurrentIdentity:$true -IdentityEligible:$false
Assert-True (-not $identityRejected.Ready) 'a rejected current identity must not enter removal review'
Assert-Equal 'current_identity_ineligible' $identityRejected.Reason 'rejected identity rejection reason'

$ownerUnknown = Get-GovernedWorktreeRemovalReadiness -IsMain:$false -BoardAvailable:$true -GitAccessible:$true -Dirty:$false -HeadAncestor:$true -Active:$false -Locked:$false -Prunable:$false -OwnerObservationsAvailable:$false -OwnersMatchCurrentIdentity:$false -IdentityEligible:$true
Assert-True (-not $ownerUnknown.Ready) 'unavailable owner observations must not enter removal review'
Assert-Equal 'owner_observation_unavailable' $ownerUnknown.Reason 'unavailable owner observation rejection reason'

$ownerMismatch = Get-GovernedWorktreeRemovalReadiness -IsMain:$false -BoardAvailable:$true -GitAccessible:$true -Dirty:$false -HeadAncestor:$true -Active:$false -Locked:$false -Prunable:$false -OwnerObservationsAvailable:$true -OwnersMatchCurrentIdentity:$false -IdentityEligible:$true
Assert-True (-not $ownerMismatch.Ready) 'mismatched owner SIDs must not enter removal review'
Assert-Equal 'owner_identity_mismatch' $ownerMismatch.Reason 'owner mismatch rejection reason'

$active = Get-GovernedWorktreeRemovalReadiness -IsMain:$false -BoardAvailable:$true -GitAccessible:$true -Dirty:$false -HeadAncestor:$true -Active:$true -Locked:$false -Prunable:$false -OwnerObservationsAvailable:$true -OwnersMatchCurrentIdentity:$true -IdentityEligible:$true
Assert-True (-not $active.Ready) 'active worktree must not enter removal review'
Assert-Equal 'active_writer' $active.Reason 'active writer rejection reason'

$boardUnknown = Get-GovernedWorktreeRemovalReadiness -IsMain:$false -BoardAvailable:$false -GitAccessible:$true -Dirty:$false -HeadAncestor:$true -Active:$false -Locked:$false -Prunable:$false -OwnerObservationsAvailable:$true -OwnersMatchCurrentIdentity:$true -IdentityEligible:$true
Assert-True (-not $boardUnknown.Ready) 'unknown board state must not enter removal review'
Assert-Equal 'board_status_unknown' $boardUnknown.Reason 'unknown board rejection reason'

$squashUnknown = Get-GovernedWorktreeRemovalReadiness -IsMain:$false -BoardAvailable:$true -GitAccessible:$true -Dirty:$false -HeadAncestor:$false -Active:$false -Locked:$false -Prunable:$false -OwnerObservationsAvailable:$true -OwnersMatchCurrentIdentity:$true -IdentityEligible:$true
Assert-True (-not $squashUnknown.Ready) 'non-ancestor worktree must stay in manual cross-check state'
Assert-Equal 'merge_requires_pr_or_branch_diff_crosscheck' $squashUnknown.Reason `
    'ancestry failure must not be presented as definitive not-merged evidence'

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
Assert-True ($cliSource -match "'fetch'\s*,\s*'origin'\s*,\s*'--prune'\s*,\s*'\+refs/heads/main:refs/remotes/origin/main'") `
    'create mode must explicitly fetch main even when remote.origin.fetch omits it'
Assert-True ($cliSource -match "'ls-remote'\s*,\s*'--exit-code'\s*,\s*'origin'\s*,\s*'refs/heads/main'") `
    'create mode must verify the fetched SHA against remote main'
Assert-True ($cliSource -match '''ls-remote''\s*,\s*''--exit-code''\s*,\s*''origin''\s*,\s*"refs/heads/\$BranchName"') `
    'candidate branch existence must be checked against the remote, not a local tracking ref'
Assert-True ($cliSource -match "'worktree'\s*,\s*'add'\s*,\s*'-b'") 'create mode must use an explicit branch and worktree add'
Assert-True ($cliSource -match 'primary_checkout_invariant_failed') 'create mode must reject a dirty, non-main, or stale primary checkout'
Assert-True ($cliSource -match 'StructLog\.psm1') 'mutating create mode must use the repository structured logger'
Assert-True ($cliSource -match "\.tmp\\logs") 'structured logs must stay in the gitignored repository temp root'
Assert-True ($cliSource -match "'--no-optional-locks'") 'inventory Git commands must disable optional locks'
Assert-True ($cliSource -match "'status'.*-NoOptionalLocks") 'inventory status must not refresh a worktree index'
$explicitUntrackedStatusChecks = @([regex]::Matches(
    $cliSource,
    "'status'\s*,\s*'--porcelain=v1'\s*,\s*'-z'\s*,\s*'--untracked-files=all'"
))
Assert-Equal 3 $explicitUntrackedStatusChecks.Count `
    'primary, post-create, and inventory cleanliness checks must include all untracked files'
Assert-True ($cliSource -match 'Write-Error\s+\$_\s+-ErrorAction\s+Continue') `
    'human-readable failures must preserve the explicit governed HELD exit code'

$workflowPath = Join-Path $repoRoot 'docs\agents\github-workflow.md'
$workflowSource = Get-Content -Raw -LiteralPath $workflowPath
Assert-True ($workflowSource -match 'new-governed-worktree\.ps1') `
    'the canonical Windows worktree workflow must route through the governed helper'

$boardOverrideRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    "governed-worktree-board-override-$PID-$([guid]::NewGuid().ToString('N'))")
$boardOverrideSessions = Join-Path $boardOverrideRoot 'sessions'
New-Item -ItemType Directory -Path $boardOverrideSessions -Force | Out-Null
$unrelatedRepoRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    "governed-worktree-unrelated-repo-$PID-$([guid]::NewGuid().ToString('N'))")
$unrelatedBoardSessions = Join-Path $unrelatedRepoRoot '.agents\board\sessions'
New-Item -ItemType Directory -Path $unrelatedBoardSessions -Force | Out-Null
& git init --initial-branch=main $unrelatedRepoRoot 2>&1 | Out-Null
Assert-Equal 0 $LASTEXITCODE 'unrelated cwd fixture repository initializes'
$overrideSession = [ordered]@{
    agent = 'override-only'
    session = 'fixture'
    status = 'active'
    task = 'must-not-be-observed'
    cwd = $repoRoot
    branch = 'fixture'
    head = 'fixture'
    recentFiles = @()
    updatedAt = [DateTime]::UtcNow.ToString('o')
}
[System.IO.File]::WriteAllText(
    (Join-Path $boardOverrideSessions 'override-only--fixture.json'),
    ($overrideSession | ConvertTo-Json -Depth 4)
)
$unrelatedSession = [ordered]@{
    agent = 'unrelated-only'
    session = 'fixture'
    status = 'active'
    task = 'must-not-be-observed'
    cwd = $repoRoot
    branch = 'fixture'
    head = 'fixture'
    recentFiles = @()
    updatedAt = [DateTime]::UtcNow.ToString('o')
}
[System.IO.File]::WriteAllText(
    (Join-Path $unrelatedBoardSessions 'unrelated-only--fixture.json'),
    ($unrelatedSession | ConvertTo-Json -Depth 4)
)
$savedBoardOverride = $env:AGENTS_BOARD_DIR
$savedLocation = (Get-Location).Path
try {
    $env:AGENTS_BOARD_DIR = $boardOverrideRoot
    Set-Location -LiteralPath $unrelatedRepoRoot
    $inventoryText = @(& pwsh -NoProfile -NonInteractive -File $cliPath -Inventory -Json)
    if ($LASTEXITCODE -ne 0) { throw "inventory CLI failed: $($inventoryText -join [Environment]::NewLine)" }
}
finally {
    Set-Location -LiteralPath $savedLocation
    if ($null -eq $savedBoardOverride) { Remove-Item -LiteralPath 'Env:AGENTS_BOARD_DIR' -ErrorAction SilentlyContinue }
    else { $env:AGENTS_BOARD_DIR = $savedBoardOverride }
    Remove-Item -LiteralPath $boardOverrideRoot -Recurse -Force
    Remove-Item -LiteralPath $unrelatedRepoRoot -Recurse -Force
}
$inventory = ($inventoryText -join [Environment]::NewLine) | ConvertFrom-Json
Assert-Equal 'governed-worktree-inventory/v1' ([string]$inventory.schema_version) 'inventory schema'
Assert-True ([bool]$inventory.read_only) 'inventory must declare read-only behavior'
Assert-True ([bool]$inventory.board.available) 'inventory must observe the no-prune board status'
Assert-Equal 'origin/main' ([string]$inventory.merge_basis.ref) 'inventory declares its merge basis'
Assert-True ([bool]$inventory.merge_basis.available) 'current inventory observes the local origin/main tracking ref'
Assert-True (-not [bool]$inventory.merge_basis.refreshed) 'read-only inventory must not claim it fetched origin/main'
Assert-True (@($inventory.worktrees).Count -gt 0) 'inventory must include registered worktrees'
$currentRootKey = ConvertTo-GovernedPathKey -Path $repoRoot
$currentRows = @($inventory.worktrees | Where-Object {
    (ConvertTo-GovernedPathKey -Path ([string]$_.path)) -ceq $currentRootKey
})
Assert-Equal 1 $currentRows.Count 'inventory includes the current worktree exactly once'
Assert-True (@($currentRows[0].active_agents) -notcontains 'override-only') `
    'inventory ignores the inherited test-only board override'
Assert-True (@($currentRows[0].active_agents) -notcontains 'unrelated-only') `
    'inventory observes the canonical main checkout board instead of the caller cwd board'
$expectedGitMetadataPath = (& git -C $repoRoot rev-parse --path-format=absolute --absolute-git-dir).Trim()
Assert-Equal 0 $LASTEXITCODE 'current worktree Git metadata path resolves'
$actualGitMetadataPathKey = ConvertTo-GovernedPathKey -Path ([string]$currentRows[0].git_metadata_path)
Assert-Equal (ConvertTo-GovernedPathKey -Path $expectedGitMetadataPath) $actualGitMetadataPathKey `
    'inventory observes the actual linked-worktree Git directory'
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

$failureFixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    "governed-worktree-failure-$PID-$([guid]::NewGuid().ToString('N'))")
$failureFixtureRepo = Join-Path $failureFixtureRoot 'repo'
$failureFixtureOrigin = Join-Path $failureFixtureRoot 'origin.git'
$failureFixtureTarget = "${failureFixtureRepo}.worktrees\failure-log-contract"
try {
    New-Item -ItemType Directory -Path (Join-Path $failureFixtureRepo 'scripts\dev') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $failureFixtureRepo 'scripts\lib') -Force | Out-Null
    Copy-Item -LiteralPath $cliPath -Destination (Join-Path $failureFixtureRepo 'scripts\dev\new-governed-worktree.ps1')
    Copy-Item -LiteralPath $libraryPath -Destination (Join-Path $failureFixtureRepo 'scripts\lib\governed-worktree.ps1')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts\lib\StructLog.psm1') `
        -Destination (Join-Path $failureFixtureRepo 'scripts\lib\StructLog.psm1')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts\dev\agents-board.mjs') `
        -Destination (Join-Path $failureFixtureRepo 'scripts\dev\agents-board.mjs')
    [System.IO.File]::WriteAllText((Join-Path $failureFixtureRepo '.gitignore'), ".tmp/`n")

    & git init --initial-branch=main $failureFixtureRepo 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture repository initializes'
    & git -C $failureFixtureRepo config user.name 'Governed Worktree Test' 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture user name config'
    & git -C $failureFixtureRepo config user.email 'governed-worktree-test@example.invalid' 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture user email config'
    & git -C $failureFixtureRepo add . 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture stages source'
    & git -C $failureFixtureRepo commit -m 'fixture baseline' 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture creates baseline commit'
    & git init --bare --initial-branch=main $failureFixtureOrigin 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture bare origin initializes'
    & git -C $failureFixtureRepo remote add origin $failureFixtureOrigin 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture origin config'
    & git -C $failureFixtureRepo push --set-upstream origin main 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture pushes baseline'
    & git -C $failureFixtureRepo config remote.origin.fetch '+refs/heads/omitted:refs/remotes/origin/omitted' 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture narrows the configured fetch mapping'
    & git -C $failureFixtureRepo update-ref -d refs/remotes/origin/main 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture removes the pre-existing origin/main tracking ref'

    $failureFixtureCli = Join-Path $failureFixtureRepo 'scripts\dev\new-governed-worktree.ps1'
    $missingBasisOutput = @(& pwsh -NoProfile -NonInteractive -File `
        $failureFixtureCli -Inventory -Json)
    Assert-Equal 0 $LASTEXITCODE 'inventory remains available when origin/main is absent'
    $missingBasisInventory = ($missingBasisOutput -join [Environment]::NewLine) | ConvertFrom-Json
    Assert-True (-not [bool]$missingBasisInventory.merge_basis.available) `
        'inventory marks a missing origin/main tracking ref unavailable'
    Assert-Equal 'local_tracking_ref_unavailable' ([string]$missingBasisInventory.merge_basis.reason) `
        'inventory reports the exact missing merge-basis reason'
    Assert-True (@($missingBasisInventory.worktrees).Count -gt 0) `
        'inventory still returns worktree diagnostics without origin/main'
    Assert-True (-not [bool]$missingBasisInventory.worktrees[0].manual_removal_review.ready) `
        'missing merge basis keeps removal readiness held'

    $fsmonitorHook = Join-Path $failureFixtureRoot 'fsmonitor-warning.sh'
    [System.IO.File]::WriteAllText($fsmonitorHook, @'
#!/bin/sh
printf '%s\n' 'warning: governed fixture fsmonitor diagnostic' >&2
exit 1
'@)
    if (-not $IsWindows) {
        & chmod +x $fsmonitorHook
        Assert-Equal 0 $LASTEXITCODE 'fsmonitor fixture hook is executable'
    }
    & git -C $failureFixtureRepo config core.fsmonitor $fsmonitorHook 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture configures a noisy fsmonitor hook'
    $stderrInventoryOutput = @(& pwsh -NoProfile -NonInteractive -File $failureFixtureCli -Inventory -Json)
    Assert-Equal 0 $LASTEXITCODE 'inventory succeeds when clean status emits a stderr diagnostic'
    $stderrInventory = ($stderrInventoryOutput -join [Environment]::NewLine) | ConvertFrom-Json
    $stderrInventoryRows = @($stderrInventory.worktrees | Where-Object {
        (ConvertTo-GovernedPathKey -Path ([string]$_.path)) -ceq `
            (ConvertTo-GovernedPathKey -Path $failureFixtureRepo)
    })
    Assert-Equal 1 $stderrInventoryRows.Count 'stderr fixture inventory contains its main worktree'
    Assert-True (-not [bool]$stderrInventoryRows[0].dirty) `
        'successful Git stderr diagnostics are not parsed as porcelain status output'
    & git -C $failureFixtureRepo config --unset core.fsmonitor 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture removes the noisy fsmonitor hook'

    $uploadPackWrapper = Join-Path $failureFixtureRoot 'upload-pack-warning.sh'
    $uploadPackScript = @'
#!/bin/sh
printf '%s\n' 'warning: governed fixture transport diagnostic' >&2
exec git-upload-pack "$@"
'@
    [System.IO.File]::WriteAllText($uploadPackWrapper, $uploadPackScript)
    $uploadPackCommand = "sh '$($uploadPackWrapper.Replace("'", "'\\''"))'"
    & git -C $failureFixtureRepo config remote.origin.uploadpack $uploadPackCommand 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture configures a successful transport warning'
    & git -C $failureFixtureRepo config status.showUntrackedFiles no 2>&1 | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'failure fixture hides untracked files in inherited Git config'

    [System.IO.File]::WriteAllText((Join-Path $failureFixtureRepo 'dirty.marker'), 'dirty')
    $failureOutput = @(& pwsh -NoProfile -NonInteractive -File $failureFixtureCli `
        -BranchName 'fix/failure-log-contract' -Json)
    Assert-Equal 2 $LASTEXITCODE 'logged Create failure preserves the governed HELD exit code'
    $failurePayload = ($failureOutput -join [Environment]::NewLine) | ConvertFrom-Json
    Assert-Equal 'governed-worktree-error/v1' ([string]$failurePayload.schema_version) 'logged failure schema'
    $expectedFailureReason = if ($currentEligibility.Eligible) {
        'primary_checkout_invariant_failed: primary_checkout_dirty'
    }
    else {
        "worktree_identity_rejected: $($currentEligibility.Reason)"
    }
    Assert-Equal $expectedFailureReason ([string]$failurePayload.error) `
        'logged failure preserves the first observed held reason'
    Assert-Equal 'not_started' ([string]$failurePayload.mutation_state) `
        'pre-add failures report an unmutated Git artifact state'
    Assert-True (-not [bool]$failurePayload.mutation_may_have_occurred) `
        'pre-add failures report no possible partial branch or worktree'
    Assert-True (-not (Test-Path -LiteralPath $failureFixtureTarget)) 'logged failure creates no worktree target'
    & git -C $failureFixtureRepo show-ref --verify --quiet refs/heads/fix/failure-log-contract
    Assert-Equal 1 $LASTEXITCODE 'logged failure creates no branch'

    $humanFailureOutput = @(& pwsh -NoProfile -NonInteractive -File $failureFixtureCli `
        -BranchName 'fix/failure-log-contract' 2>&1)
    Assert-Equal 2 $LASTEXITCODE 'human-readable Create failure preserves the governed HELD exit code'
    Assert-True (($humanFailureOutput -join [Environment]::NewLine) -match [regex]::Escape($expectedFailureReason)) `
        'human-readable Create failure reports the first observed held reason'
    if ($currentEligibility.Eligible) {
        $fetchedOriginMain = (& git -C $failureFixtureRepo rev-parse refs/remotes/origin/main).Trim()
        Assert-Equal 0 $LASTEXITCODE 'explicit main refspec recreates origin/main despite narrowed fetch config'
        $fixtureHead = (& git -C $failureFixtureRepo rev-parse HEAD).Trim()
        Assert-Equal $fixtureHead $fetchedOriginMain 'explicitly fetched origin/main matches remote fixture HEAD'

        Remove-Item -LiteralPath (Join-Path $failureFixtureRepo 'dirty.marker')
        & git -C $failureFixtureRepo push origin 'HEAD:refs/heads/fix/remote-conflict' 2>&1 | Out-Null
        Assert-Equal 0 $LASTEXITCODE 'failure fixture creates a candidate branch only on the remote'
        & git -C $failureFixtureRepo show-ref --verify --quiet refs/remotes/origin/fix/remote-conflict
        Assert-Equal 1 $LASTEXITCODE 'narrowed fetch config leaves the candidate tracking ref absent locally'

        $remoteConflictTarget = "${failureFixtureRepo}.worktrees\remote-conflict"
        $remoteConflictOutput = @(& pwsh -NoProfile -NonInteractive -File $failureFixtureCli `
            -BranchName 'fix/remote-conflict' -Json)
        Assert-Equal 2 $LASTEXITCODE 'remote-only candidate branch is rejected'
        $remoteConflictPayload = ($remoteConflictOutput -join [Environment]::NewLine) | ConvertFrom-Json
        Assert-Equal 'worktree_remote_branch_already_exists' ([string]$remoteConflictPayload.error) `
            'remote-only candidate branch reports the exact conflict reason'
        Assert-Equal 'not_started' ([string]$remoteConflictPayload.mutation_state) `
            'remote conflict is rejected before worktree mutation'
        Assert-True (-not (Test-Path -LiteralPath $remoteConflictTarget)) `
            'remote conflict creates no worktree target'
        & git -C $failureFixtureRepo show-ref --verify --quiet refs/heads/fix/remote-conflict
        Assert-Equal 1 $LASTEXITCODE 'remote conflict creates no local branch'
    }
}
finally {
    $tempKey = ConvertTo-GovernedPathKey -Path ([System.IO.Path]::GetTempPath())
    $fixtureKey = ConvertTo-GovernedPathKey -Path $failureFixtureRoot
    Assert-True ($fixtureKey.StartsWith(
        $tempKey + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::Ordinal)) 'failure fixture cleanup stays inside the temp root'
    if (Test-Path -LiteralPath $failureFixtureRoot) {
        Remove-Item -LiteralPath $failureFixtureRoot -Recurse -Force
    }
}

Write-Host 'ALL TESTS PASSED' -ForegroundColor Green
