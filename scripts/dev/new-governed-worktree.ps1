<#
.SYNOPSIS
Creates or inventories canonical sibling worktrees under verified Windows host identity.

.DESCRIPTION
Create mode accepts a feat/fix/chore/docs branch, refreshes origin/main, creates the
canonical sibling worktree, and verifies its branch, baseline, cleanliness, and
filesystem owner SID. It rejects sandbox identities, elevated tokens, and Windows
profile/SID mismatches before repository discovery.

Inventory mode is read-only. It reports branch, HEAD, owner, dirty/ancestry state,
parallel-session activity, and eligibility for later manual removal review. This
helper does not weaken Git trust, rewrite ACLs, or remove/prune worktrees.

.EXAMPLE
pwsh -NoProfile -File scripts/dev/new-governed-worktree.ps1 -Inventory -Json

.EXAMPLE
pwsh -NoProfile -File scripts/dev/new-governed-worktree.ps1 -BranchName fix/example -PlanOnly -Json

.EXAMPLE
pwsh -NoProfile -File scripts/dev/new-governed-worktree.ps1 -BranchName fix/example -Json
#>
[CmdletBinding(DefaultParameterSetName = 'Create', SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Create')][string] $BranchName,
    [Parameter(ParameterSetName = 'Create')][switch] $PlanOnly,
    [Parameter(Mandatory = $true, ParameterSetName = 'Inventory')][switch] $Inventory,
    [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ScriptRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $script:ScriptRoot 'scripts\lib\governed-worktree.ps1')
Import-Module -Force (Join-Path $script:ScriptRoot 'scripts\lib\StructLog.psm1')

function Invoke-GovernedStructuredLogWrite {
    param([Parameter(Mandatory = $true)][scriptblock] $Action)

    if (-not $Json) {
        [void](& $Action)
        return
    }

    $originalWriter = [Console]::Out
    $suppressedWriter = [System.IO.StringWriter]::new([Globalization.CultureInfo]::InvariantCulture)
    try {
        [Console]::SetOut($suppressedWriter)
        [void](& $Action)
    }
    finally {
        [Console]::SetOut($originalWriter)
        $suppressedWriter.Dispose()
    }
}

function Resolve-GovernedGitExecutable {
    $commands = @(Get-Command git.exe -All -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandType -eq [System.Management.Automation.CommandTypes]::Application
    })
    if ($commands.Count -eq 0) { throw 'git_executable_not_found' }
    return [string]$commands[0].Path
}

function Invoke-GovernedGit {
    param(
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ArgumentList,
        [switch] $NoOptionalLocks,
        [switch] $AllowFailure
    )

    $gitGlobalArguments = @()
    if ($NoOptionalLocks) { $gitGlobalArguments += '--no-optional-locks' }
    $output = @(& $script:GitExecutable @gitGlobalArguments -C $WorkingDirectory @ArgumentList 2>&1)
    $exitCode = $LASTEXITCODE
    $result = [pscustomobject]@{
        Success = $exitCode -eq 0
        ExitCode = [int]$exitCode
        Output = @($output | ForEach-Object { [string]$_ })
    }
    if (-not $result.Success -and -not $AllowFailure) {
        $operation = if ($ArgumentList.Count -gt 0) { $ArgumentList[0] } else { 'unknown' }
        $detail = (@($result.Output) | Select-Object -First 1)
        throw "git_${operation}_failed: $detail"
    }
    return $result
}

function Get-GovernedGitText {
    param(
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][string[]] $ArgumentList,
        [switch] $NoOptionalLocks
    )
    $result = Invoke-GovernedGit -WorkingDirectory $WorkingDirectory -ArgumentList $ArgumentList `
        -NoOptionalLocks:$NoOptionalLocks
    return (@($result.Output) -join [Environment]::NewLine).Trim()
}

function Resolve-GovernedMainRoot {
    param([switch] $NoOptionalLocks)

    $commonDirectory = Get-GovernedGitText -WorkingDirectory $script:ScriptRoot -ArgumentList @(
        'rev-parse', '--path-format=absolute', '--git-common-dir') -NoOptionalLocks:$NoOptionalLocks
    $resolvedCommon = [System.IO.Path]::GetFullPath($commonDirectory)
    if ([System.IO.Path]::GetFileName($resolvedCommon) -cne '.git') {
        throw 'git_common_directory_unexpected'
    }
    $mainRoot = [System.IO.Directory]::GetParent($resolvedCommon).FullName
    $topLevel = Get-GovernedGitText -WorkingDirectory $mainRoot -ArgumentList @(
        'rev-parse', '--show-toplevel') -NoOptionalLocks:$NoOptionalLocks
    if ((ConvertTo-GovernedPathKey -Path $topLevel) -cne (ConvertTo-GovernedPathKey -Path $mainRoot)) {
        throw 'main_worktree_resolution_mismatch'
    }
    return $mainRoot
}

function Get-GovernedBoardObservation {
    param([Parameter(Mandatory = $true)][string] $MainRoot)

    $boardScript = Join-Path $MainRoot 'scripts\dev\agents-board.mjs'
    $node = @(Get-Command node.exe -All -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandType -eq [System.Management.Automation.CommandTypes]::Application
    } | Select-Object -First 1)
    if ($node.Count -eq 0) {
        return [pscustomobject]@{ Available = $false; Reason = 'node_unavailable'; Sessions = @() }
    }
    if (-not (Test-Path -LiteralPath $boardScript -PathType Leaf)) {
        return [pscustomobject]@{ Available = $false; Reason = 'board_script_missing'; Sessions = @() }
    }
    $output = @(& $node[0].Path $boardScript status --json --no-prune 2>$null)
    if ($LASTEXITCODE -ne 0) {
        return [pscustomobject]@{ Available = $false; Reason = 'board_command_failed'; Sessions = @() }
    }
    try {
        $payload = (@($output) -join [Environment]::NewLine) | ConvertFrom-Json
        if ($null -eq $payload.PSObject.Properties['sessions']) { throw 'sessions_missing' }
        return [pscustomobject]@{ Available = $true; Reason = 'observed'; Sessions = @($payload.sessions) }
    }
    catch {
        return [pscustomobject]@{ Available = $false; Reason = 'board_output_invalid'; Sessions = @() }
    }
}

function Get-GovernedWorktreeInventory {
    param(
        [Parameter(Mandatory = $true)][string] $MainRoot,
        [Parameter(Mandatory = $true)][pscustomobject] $Identity
    )

    $porcelain = Get-GovernedGitText -WorkingDirectory $MainRoot -ArgumentList @(
        'worktree', 'list', '--porcelain') -NoOptionalLocks
    $records = @(ConvertFrom-GitWorktreePorcelain -Text $porcelain)
    $board = Get-GovernedBoardObservation -MainRoot $MainRoot
    $sessions = @($board.Sessions)
    $observedOriginMain = Get-GovernedGitText -WorkingDirectory $MainRoot -ArgumentList @(
        'rev-parse', 'origin/main') -NoOptionalLocks
    $mainKey = ConvertTo-GovernedPathKey -Path $MainRoot
    $rows = [System.Collections.Generic.List[object]]::new()

    foreach ($record in $records) {
        $worktreePath = [System.IO.Path]::GetFullPath([string]$record.Path)
        $worktreeKey = ConvertTo-GovernedPathKey -Path $worktreePath
        $isMain = $worktreeKey -ceq $mainKey
        $rootOwner = Get-GovernedPathOwnerObservation -Path $worktreePath
        $gitMetadataPathResult = Invoke-GovernedGit -WorkingDirectory $worktreePath -ArgumentList @(
            'rev-parse', '--path-format=absolute', '--absolute-git-dir') -NoOptionalLocks -AllowFailure
        $gitMetadataPath = if ($gitMetadataPathResult.Success) {
            (@($gitMetadataPathResult.Output) -join [Environment]::NewLine).Trim()
        }
        else { '' }
        $gitMetadataOwner = if ([string]::IsNullOrWhiteSpace($gitMetadataPath)) {
            [pscustomobject]@{ Available = $false; Name = ''; Sid = ''; Error = 'git_metadata_path_unavailable' }
        }
        else {
            Get-GovernedPathOwnerObservation -Path $gitMetadataPath
        }
        $status = Invoke-GovernedGit -WorkingDirectory $worktreePath -ArgumentList @(
            'status', '--porcelain=v1', '-z', '--untracked-files=all') -NoOptionalLocks -AllowFailure
        $gitAccessible = [bool]$status.Success
        $dirty = if ($gitAccessible) { (@($status.Output) -join '') -ne '' } else { $null }
        $mergedResult = Invoke-GovernedGit -WorkingDirectory $MainRoot -ArgumentList @(
            'merge-base', '--is-ancestor', [string]$record.Head, 'origin/main') -NoOptionalLocks -AllowFailure
        $headAncestor = if ($mergedResult.ExitCode -eq 0) { $true } elseif ($mergedResult.ExitCode -eq 1) { $false } else { $null }
        $activeAgents = @(Get-GovernedWorktreeActiveAgents -Sessions $sessions -WorktreePath $worktreePath)
        if (-not [bool]$board.Available) {
            $readiness = Get-GovernedWorktreeRemovalReadiness `
                -IsMain:$isMain `
                -BoardAvailable:$false `
                -GitAccessible:$gitAccessible `
                -Dirty:$false `
                -HeadAncestor:$false `
                -Active:$false `
                -Locked:([bool]$record.Locked) `
                -Prunable:([bool]$record.Prunable)
        }
        elseif ($null -eq $dirty) {
            $readiness = [pscustomobject]@{ Ready = $false; Reason = 'git_access_unknown' }
        }
        elseif ($null -eq $headAncestor) {
            $readiness = [pscustomobject]@{ Ready = $false; Reason = 'merge_status_unknown' }
        }
        else {
            $readiness = Get-GovernedWorktreeRemovalReadiness `
                -IsMain:$isMain `
                -BoardAvailable:$true `
                -GitAccessible:$gitAccessible `
                -Dirty:$dirty `
                -HeadAncestor:$headAncestor `
                -Active:($activeAgents.Count -gt 0) `
                -Locked:([bool]$record.Locked) `
                -Prunable:([bool]$record.Prunable)
        }
        $rows.Add([pscustomobject][ordered]@{
            path = $worktreePath
            branch = if ($null -eq $record.Branch) { $null } else { [string]$record.Branch }
            head = [string]$record.Head
            root_filesystem_owner_name = [string]$rootOwner.Name
            root_filesystem_owner_sid = [string]$rootOwner.Sid
            git_metadata_path = $gitMetadataPath
            git_metadata_owner_name = [string]$gitMetadataOwner.Name
            git_metadata_owner_sid = [string]$gitMetadataOwner.Sid
            owners_match_current_identity = if ($rootOwner.Available -and $gitMetadataOwner.Available) {
                $rootOwner.Sid -ceq $Identity.IdentitySid -and $gitMetadataOwner.Sid -ceq $Identity.IdentitySid
            }
            else { $null }
            git_accessible = $gitAccessible
            dirty = $dirty
            head_ancestor_of_origin_main = $headAncestor
            merge_assessment = if ($headAncestor -eq $true) {
                'head_ancestor_observed'
            }
            elseif ($headAncestor -eq $false) {
                'pr_or_branch_diff_crosscheck_required'
            }
            else { 'unknown' }
            active = if ([bool]$board.Available) { $activeAgents.Count -gt 0 } else { $null }
            active_agents = @($activeAgents)
            locked = [bool]$record.Locked
            prunable = [bool]$record.Prunable
            prunable_reason = [string]$record.PrunableReason
            manual_removal_review = [pscustomobject]@{
                ready = [bool]$readiness.Ready
                reason = [string]$readiness.Reason
            }
        })
    }

    $identityEligibility = Test-GovernedWorktreeIdentityObservation -Observation $Identity
    return [pscustomobject][ordered]@{
        schema_version = 'governed-worktree-inventory/v1'
        generated_at_utc = [DateTime]::UtcNow.ToString('o')
        read_only = $true
        main_root = $MainRoot
        identity = [pscustomobject]@{
            name = [string]$Identity.IdentityName
            sid = [string]$Identity.IdentitySid
            elevated = [bool]$Identity.IsElevated
            sandbox = [bool]$Identity.IsSandbox
            eligible_for_create = [bool]$identityEligibility.Eligible
            reason = [string]$identityEligibility.Reason
        }
        board = [pscustomobject]@{
            available = [bool]$board.Available
            reason = [string]$board.Reason
        }
        merge_basis = [pscustomobject]@{
            ref = 'origin/main'
            head = $observedOriginMain
            refreshed = $false
            source = 'local_tracking_ref'
        }
        worktrees = @($rows)
    }
}

function Write-GovernedPayload {
    param([Parameter(Mandatory = $true)][pscustomobject] $Payload)

    if ($Json) {
        $Payload | ConvertTo-Json -Depth 8
        return
    }
    if ([string]$Payload.schema_version -ceq 'governed-worktree-inventory/v1') {
        $Payload.worktrees | Format-Table path, branch, git_metadata_owner_name, git_accessible, dirty,
            head_ancestor_of_origin_main, active, @{Name = 'review'; Expression = { $_.manual_removal_review.reason }} -AutoSize
        return
    }
    $Payload | Format-List
}

$script:GitExecutable = Resolve-GovernedGitExecutable
$script:LifecycleLogger = $null
$script:MutationState = 'not_started'
$script:MutationBranch = if ($PSCmdlet.ParameterSetName -ceq 'Create') { $BranchName } else { $null }
$script:MutationTarget = $null
$savedGitEnvironment = Remove-GovernedGitRoutingEnvironment
try {
    $identity = Get-GovernedWorktreeIdentityObservation
    if ($PSCmdlet.ParameterSetName -ceq 'Create') {
        $eligibility = Test-GovernedWorktreeIdentityObservation -Observation $identity
        if (-not $eligibility.Eligible) { throw "worktree_identity_rejected: $($eligibility.Reason)" }
    }
    $mainRoot = Resolve-GovernedMainRoot -NoOptionalLocks:($PSCmdlet.ParameterSetName -ceq 'Inventory')

    if ($PSCmdlet.ParameterSetName -ceq 'Inventory') {
        Write-GovernedPayload -Payload (Get-GovernedWorktreeInventory -MainRoot $mainRoot -Identity $identity)
        exit 0
    }

    $target = Get-GovernedWorktreeTarget -MainRoot $mainRoot -BranchName $BranchName
    $script:MutationTarget = $target
    $localRef = Invoke-GovernedGit -WorkingDirectory $mainRoot -ArgumentList @(
        'show-ref', '--verify', '--quiet', "refs/heads/$BranchName") -AllowFailure
    if ($localRef.ExitCode -eq 0) { throw 'worktree_branch_already_exists' }
    if ($localRef.ExitCode -ne 1) { throw 'worktree_branch_probe_failed' }
    if (Test-Path -LiteralPath $target) { throw 'worktree_target_already_exists' }

    if ($PlanOnly) {
        $originMain = Get-GovernedGitText -WorkingDirectory $mainRoot -ArgumentList @('rev-parse', 'origin/main')
        Write-GovernedPayload -Payload ([pscustomobject][ordered]@{
            schema_version = 'governed-worktree-create-plan/v1'
            mutated = $false
            requires_fresh_fetch = $true
            main_root = $mainRoot
            branch = $BranchName
            target = $target
            observed_origin_main = $originMain
            identity_name = [string]$identity.IdentityName
            identity_sid = [string]$identity.IdentitySid
        })
        exit 0
    }

    if (-not $PSCmdlet.ShouldProcess($target, "create $BranchName from freshly fetched origin/main")) { exit 0 }
    $script:LifecycleLogger = New-StructLogger `
        -Service 'scripts' `
        -Component 'governed-worktree' `
        -LogRoot (Join-Path $mainRoot '.tmp\logs') `
        -SkipEnvSnapshot
    Invoke-GovernedStructuredLogWrite -Action {
        $script:LifecycleLogger | Write-StructLifecycle -Msg 'governed worktree creation started' -Data @{
            phase = 'start'
            subject_kind = 'git_worktree'
            subject_id = $BranchName
            target = $target
            baseline_ref = 'origin/main'
        } | Out-Null
    }
    [void](Invoke-GovernedGit -WorkingDirectory $mainRoot -ArgumentList @(
        'fetch', 'origin', '--prune', '+refs/heads/main:refs/remotes/origin/main'))
    $baseline = Get-GovernedGitText -WorkingDirectory $mainRoot -ArgumentList @(
        'rev-parse', 'refs/remotes/origin/main')
    $remoteMain = Get-GovernedGitText -WorkingDirectory $mainRoot -ArgumentList @(
        'ls-remote', '--exit-code', 'origin', 'refs/heads/main')
    $remoteMainMatches = @($remoteMain -split "\r?\n" | ForEach-Object {
        if ($_ -match '^(?<sha>[0-9a-fA-F]{40,64})\s+refs/heads/main$') {
            $Matches.sha
        }
    })
    $remoteMainSha = if ($remoteMainMatches.Count -eq 1) { [string]$remoteMainMatches[0] } else { '' }
    if ($remoteMainSha -notmatch '^[0-9a-fA-F]{40,64}$' -or $baseline -cne $remoteMainSha) {
        throw 'origin_main_fetch_verification_failed'
    }
    $primaryBranch = Get-GovernedGitText -WorkingDirectory $mainRoot -ArgumentList @('symbolic-ref', 'HEAD')
    $primaryHead = Get-GovernedGitText -WorkingDirectory $mainRoot -ArgumentList @('rev-parse', 'HEAD')
    $primaryStatus = Get-GovernedGitText -WorkingDirectory $mainRoot -ArgumentList @(
        'status', '--porcelain=v1', '-z', '--untracked-files=all')
    $primaryState = Test-GovernedPrimaryCheckoutState `
        -BranchRef $primaryBranch `
        -Head $primaryHead `
        -OriginMain $baseline `
        -Dirty:(-not [string]::IsNullOrEmpty($primaryStatus))
    if (-not $primaryState.Eligible) {
        throw "primary_checkout_invariant_failed: $($primaryState.Reason)"
    }
    $remoteRef = Invoke-GovernedGit -WorkingDirectory $mainRoot -ArgumentList @(
        'ls-remote', '--exit-code', 'origin', "refs/heads/$BranchName") -AllowFailure
    if ($remoteRef.ExitCode -eq 0) { throw 'worktree_remote_branch_already_exists' }
    if ($remoteRef.ExitCode -ne 2) { throw 'worktree_remote_branch_probe_failed' }

    $container = Split-Path -Parent $target
    if (Test-Path -LiteralPath $container) {
        $containerItem = Get-Item -LiteralPath $container -Force
        if (-not $containerItem.PSIsContainer) { throw 'worktree_container_not_directory' }
        if (($containerItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'worktree_container_reparse_point_rejected'
        }
    }
    else {
        New-Item -ItemType Directory -Path $container | Out-Null
    }

    $script:MutationState = 'worktree_add_started'
    [void](Invoke-GovernedGit -WorkingDirectory $mainRoot -ArgumentList @(
        'worktree', 'add', '-b', $BranchName, $target, 'origin/main'))
    $script:MutationState = 'worktree_added'
    $head = Get-GovernedGitText -WorkingDirectory $target -ArgumentList @('rev-parse', 'HEAD')
    $targetOriginMain = Get-GovernedGitText -WorkingDirectory $target -ArgumentList @('rev-parse', 'origin/main')
    $branch = Get-GovernedGitText -WorkingDirectory $target -ArgumentList @('symbolic-ref', 'HEAD')
    $status = Get-GovernedGitText -WorkingDirectory $target -ArgumentList @(
        'status', '--porcelain=v1', '-z', '--untracked-files=all')
    $rootOwner = Get-GovernedPathOwnerObservation -Path $target
    $gitMetadataPath = Get-GovernedGitText -WorkingDirectory $target -ArgumentList @(
        'rev-parse', '--path-format=absolute', '--absolute-git-dir')
    $gitMetadataOwner = Get-GovernedPathOwnerObservation -Path $gitMetadataPath
    if ($head -cne $baseline -or $targetOriginMain -cne $baseline) { throw 'worktree_baseline_postcondition_failed' }
    if ($branch -cne "refs/heads/$BranchName") { throw 'worktree_branch_postcondition_failed' }
    if (-not [string]::IsNullOrEmpty($status)) { throw 'worktree_clean_postcondition_failed' }
    if (-not $rootOwner.Available -or -not $gitMetadataOwner.Available) { throw 'worktree_owner_postcondition_unavailable' }
    if ($rootOwner.Sid -cne $identity.IdentitySid -or $gitMetadataOwner.Sid -cne $identity.IdentitySid) {
        throw 'worktree_owner_postcondition_failed'
    }
    $script:MutationState = 'postconditions_verified'

    Invoke-GovernedStructuredLogWrite -Action {
        $script:LifecycleLogger | Write-StructLifecycle -Msg 'governed worktree creation completed' -Data @{
            phase = 'closed'
            subject_kind = 'git_worktree'
            subject_id = $BranchName
            target = $target
            head = $head
            status = 'passed'
        } | Out-Null
    }

    Write-GovernedPayload -Payload ([pscustomobject][ordered]@{
        schema_version = 'governed-worktree-create-result/v1'
        mutated = $true
        main_root = $mainRoot
        branch = $BranchName
        target = $target
        head = $head
        origin_main = $baseline
        clean = $true
        root_filesystem_owner_name = [string]$rootOwner.Name
        root_filesystem_owner_sid = [string]$rootOwner.Sid
        git_metadata_path = $gitMetadataPath
        git_metadata_owner_name = [string]$gitMetadataOwner.Name
        git_metadata_owner_sid = [string]$gitMetadataOwner.Sid
    })
    exit 0
}
catch {
    if ($null -ne $script:LifecycleLogger) {
        $failure = $_
        Invoke-GovernedStructuredLogWrite -Action {
            $script:LifecycleLogger | Write-StructError -Msg 'governed worktree creation failed' `
                -ErrorRecord $failure.Exception -Data @{
                    phase = 'closed'
                    subject_kind = 'git_worktree'
                    subject_id = $BranchName
                    target = $script:MutationTarget
                    mutation_state = $script:MutationState
                    status = 'failed'
                } | Out-Null
        }
    }
    if ($Json) {
        New-GovernedWorktreeFailurePayload `
            -ErrorMessage $_.Exception.Message `
            -MutationState $script:MutationState `
            -Branch $script:MutationBranch `
            -Target $script:MutationTarget |
            ConvertTo-Json -Depth 4
    }
    else {
        Write-Error $_ -ErrorAction Continue
    }
    exit 2
}
finally {
    Restore-GovernedGitRoutingEnvironment -Saved $savedGitEnvironment
}
