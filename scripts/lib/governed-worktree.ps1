Set-StrictMode -Version Latest

function ConvertTo-GovernedPathKey {
    param([Parameter(Mandatory = $true)][string] $Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar)
    if ($IsWindows) { return $fullPath.ToUpperInvariant() }
    return $fullPath
}

function Test-GovernedWorktreeIdentityObservation {
    param([Parameter(Mandatory = $true)][pscustomobject] $Observation)

    if (-not [bool]$Observation.IsWindows) {
        return [pscustomobject]@{ Eligible = $false; Reason = 'windows_host_required' }
    }
    if ([bool]$Observation.IsSandbox -or [string]$Observation.IdentityName -match '(?i)\\CodexSandboxOffline$') {
        return [pscustomobject]@{ Eligible = $false; Reason = 'sandbox_identity' }
    }
    if ([bool]$Observation.IsElevated) {
        return [pscustomobject]@{ Eligible = $false; Reason = 'elevated_token' }
    }

    $identitySid = ([string]$Observation.IdentitySid).Trim()
    $profileSid = ([string]$Observation.ProfileSid).Trim()
    if ([string]::IsNullOrWhiteSpace($identitySid)) {
        return [pscustomobject]@{ Eligible = $false; Reason = 'identity_sid_missing' }
    }
    if ([string]::IsNullOrWhiteSpace($profileSid)) {
        return [pscustomobject]@{ Eligible = $false; Reason = 'profile_mapping_missing' }
    }
    if ($identitySid -cne $profileSid) {
        return [pscustomobject]@{ Eligible = $false; Reason = 'profile_sid_mismatch' }
    }

    $profilePath = ([string]$Observation.ProfilePath).Trim()
    $userProfile = ([string]$Observation.UserProfile).Trim()
    if ([string]::IsNullOrWhiteSpace($profilePath) -or [string]::IsNullOrWhiteSpace($userProfile)) {
        return [pscustomobject]@{ Eligible = $false; Reason = 'profile_path_missing' }
    }
    try {
        if ((ConvertTo-GovernedPathKey -Path $profilePath) -cne (ConvertTo-GovernedPathKey -Path $userProfile)) {
            return [pscustomobject]@{ Eligible = $false; Reason = 'profile_path_mismatch' }
        }
    }
    catch {
        return [pscustomobject]@{ Eligible = $false; Reason = 'profile_path_invalid' }
    }

    return [pscustomobject]@{ Eligible = $true; Reason = 'eligible' }
}

function Get-GovernedWorktreeIdentityObservation {
    if (-not $IsWindows) {
        return [pscustomobject]@{
            IsWindows = $false; IdentityName = ''; IdentitySid = ''; ProfileSid = ''
            ProfilePath = ''; UserProfile = ''; IsElevated = $false; IsSandbox = $false
        }
    }

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $identitySid = [string]$identity.User.Value
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    $isElevated = $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
    $profileSid = ''
    $profilePath = ''
    try {
        $profileKey = Join-Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' $identitySid
        $profile = Get-ItemProperty -LiteralPath $profileKey -ErrorAction Stop
        $profileSid = [string]$profile.PSChildName
        $profilePath = [Environment]::ExpandEnvironmentVariables([string]$profile.ProfileImagePath)
    }
    catch {
        $profileSid = ''
        $profilePath = ''
    }

    return [pscustomobject]@{
        IsWindows    = $true
        IdentityName = [string]$identity.Name
        IdentitySid  = $identitySid
        ProfileSid   = $profileSid
        ProfilePath  = $profilePath
        UserProfile  = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
        IsElevated   = [bool]$isElevated
        IsSandbox    = [string]$identity.Name -match '(?i)\\CodexSandboxOffline$'
    }
}

function Get-GovernedWorktreeTarget {
    param(
        [Parameter(Mandatory = $true)][string] $MainRoot,
        [Parameter(Mandatory = $true)][string] $BranchName
    )

    $match = [regex]::Match($BranchName, '^(feat|fix|chore|docs)/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$')
    if (-not $match.Success) { throw 'branch_name_invalid' }
    if (-not [System.IO.Path]::IsPathFullyQualified($MainRoot)) { throw 'main_root_not_absolute' }

    $resolvedMain = [System.IO.Path]::GetFullPath($MainRoot).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar)
    $container = "${resolvedMain}.worktrees"
    $target = Join-Path $container $match.Groups[2].Value
    if (-not (ConvertTo-GovernedPathKey -Path $target).StartsWith(
        (ConvertTo-GovernedPathKey -Path $container) + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::Ordinal)) {
        throw 'worktree_target_outside_container'
    }
    return $target
}

function ConvertFrom-GitWorktreePorcelain {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $Text)

    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($block in @($Text.Trim() -split '(?:\r?\n){2,}')) {
        if ([string]::IsNullOrWhiteSpace($block)) { continue }
        $record = [ordered]@{
            Path = ''
            Head = ''
            Branch = $null
            Locked = $false
            Prunable = $false
            PrunableReason = ''
        }
        foreach ($line in @($block -split '\r?\n')) {
            $separator = $line.IndexOf(' ')
            $key = if ($separator -lt 0) { $line } else { $line.Substring(0, $separator) }
            $value = if ($separator -lt 0) { '' } else { $line.Substring($separator + 1) }
            switch ($key) {
                'worktree' { $record.Path = $value }
                'HEAD' { $record.Head = $value }
                'branch' { $record.Branch = $value }
                'detached' { $record.Branch = $null }
                'locked' { $record.Locked = $true }
                'prunable' { $record.Prunable = $true; $record.PrunableReason = $value }
            }
        }
        if ([string]::IsNullOrWhiteSpace($record.Path) -or [string]::IsNullOrWhiteSpace($record.Head)) {
            throw 'worktree_porcelain_record_incomplete'
        }
        $records.Add([pscustomobject]$record)
    }
    return @($records)
}

function Get-GovernedWorktreeRemovalReadiness {
    param(
        [Parameter(Mandatory = $true)][bool] $IsMain,
        [Parameter(Mandatory = $true)][bool] $BoardAvailable,
        [Parameter(Mandatory = $true)][bool] $GitAccessible,
        [Parameter(Mandatory = $true)][bool] $Dirty,
        [Parameter(Mandatory = $true)][bool] $Merged,
        [Parameter(Mandatory = $true)][bool] $Active,
        [Parameter(Mandatory = $true)][bool] $Locked,
        [Parameter(Mandatory = $true)][bool] $Prunable
    )

    if ($IsMain) { return [pscustomobject]@{ Ready = $false; Reason = 'main_worktree' } }
    if (-not $BoardAvailable) { return [pscustomobject]@{ Ready = $false; Reason = 'board_status_unknown' } }
    if ($Active) { return [pscustomobject]@{ Ready = $false; Reason = 'active_writer' } }
    if ($Locked) { return [pscustomobject]@{ Ready = $false; Reason = 'worktree_locked' } }
    if ($Prunable) { return [pscustomobject]@{ Ready = $false; Reason = 'prunable_requires_exact_inspection' } }
    if (-not $GitAccessible) { return [pscustomobject]@{ Ready = $false; Reason = 'git_access_unknown' } }
    if ($Dirty) { return [pscustomobject]@{ Ready = $false; Reason = 'worktree_dirty' } }
    if (-not $Merged) { return [pscustomobject]@{ Ready = $false; Reason = 'not_merged_into_origin_main' } }
    return [pscustomobject]@{ Ready = $true; Reason = 'eligible_for_manual_review' }
}

function Get-GovernedPathOwnerObservation {
    param([Parameter(Mandatory = $true)][string] $Path)

    try {
        $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
        return [pscustomobject]@{
            Available = $true
            Name = [string]$acl.Owner
            Sid = [string]$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
            Error = ''
        }
    }
    catch {
        return [pscustomobject]@{ Available = $false; Name = ''; Sid = ''; Error = $_.Exception.Message }
    }
}
