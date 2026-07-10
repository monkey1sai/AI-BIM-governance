. "$PSScriptRoot/test-helpers.ps1"
$script = Join-Path $PSScriptRoot '../dev/Invoke-CodexGovernanceMaintenance.ps1'
$root = New-TestSandbox 'm9-orchestrator'
try {
  Set-Content (Join-Path $root 'live-state.txt') 'pre-apply'
  $candidate = Join-Path $root 'candidate.json'
  @{sourceId='m9-e2e'; Version='1'} | ConvertTo-Json | Set-Content $candidate
  # Dot-source in Audit mode to load orchestrator functions without applying.
  . $script -Mode Audit -CodexHome $root -CandidatePath $candidate | Out-Null
  $events = [System.Collections.Generic.List[string]]::new()
  $callbacks = @{}
  foreach($cohort in 'cli','plugin','skill') {
    $callbacks["Stage:$cohort"] = { param($c,$r) $events.Add("stage:$cohort"); [pscustomobject]@{Cohort=$cohort} }.GetNewClosure()
    $callbacks["Apply:$cohort"] = { param($s,$r) $events.Add("apply:$cohort"); if($cohort -eq 'cli'){Set-Content (Join-Path $r 'live-state.txt') 'post-apply'}; [pscustomobject]@{Status='applied'} }.GetNewClosure()
    $callbacks["Rollback:$cohort"] = { param($r) $events.Add("rollback:$cohort") }.GetNewClosure()
  }
  $apply = Invoke-MaintenanceApply $root $candidate $null $callbacks
  Assert-Equal 'staged' $apply.status 'successful apply status'
  $verify = Invoke-MaintenanceVerify $root @{} @{} @{}
  Assert-Equal 'verified' $verify.status 'verify applied state'
  Assert-True (Test-Path (Join-Path $root 'applied-state.json')) 'applied state persisted'
  Assert-True (@($events | Where-Object {$_ -like 'stage:*'}).Count -eq 3) 'all stage callbacks'
  Assert-True (@($events | Where-Object {$_ -like 'apply:*'}).Count -eq 3) 'all apply callbacks'
  Assert-Equal 'post-apply' (Get-Content (Join-Path $root 'live-state.txt') -Raw).Trim() 'apply changed live target'

  # Production topology: Apply records TargetPath as Root and creates .snapshot-* below it.
  $stagedJournal = Get-Content (Join-Path $root 'maintenance-journal.json') -Raw | ConvertFrom-Json
  $snapshotPath = [string]$stagedJournal.Data.SnapshotPath
  Assert-Equal ([IO.Path]::GetFullPath($root)) ([IO.Path]::GetFullPath([string]$stagedJournal.Data.TargetPath)) 'journal target is maintenance root'
  Assert-True ([IO.Path]::GetFullPath($snapshotPath).StartsWith(([IO.Path]::GetFullPath($root) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) 'snapshot is inside maintenance root'
  $snapshotHash = Get-ContentTreeHash -Root $snapshotPath
  $recoveryData = @{
    TargetPath = [string]$stagedJournal.Data.TargetPath
    SnapshotPath = $snapshotPath
    SnapshotTreeHash = $snapshotHash
  }
  Write-JournalPhase -JournalPath (Join-Path $root 'maintenance-journal.json') -Phase applying -Data $recoveryData -Root $root | Out-Null
  $recover = Invoke-MaintenanceRecover $root
  Assert-Equal 'recovered' $recover.status 'successful recover status'
  Assert-Equal 'pre-apply' (Get-Content (Join-Path $root 'live-state.txt') -Raw).Trim() 'pre-Apply content restored'
  Assert-Equal $snapshotHash (Get-ContentTreeHash -Root $root) 'post-restore tree hash matches recorded snapshot hash'
  Assert-True (-not (Test-Path (Join-Path $root 'applied-state.json'))) 'post-Apply state removed by recovery'
  $committedJournal = Get-Content (Join-Path $root 'maintenance-journal.json') -Raw | ConvertFrom-Json
  Assert-Equal 'committed' $committedJournal.Phase 'journal committed after integrity verification'
  Assert-True ($stagedJournal.Data.PSObject.Properties.Name -contains 'SnapshotTreeHash') 'Apply journal records snapshot tree hash'
  Assert-Equal $snapshotHash ([string]$stagedJournal.Data.SnapshotTreeHash) 'recorded snapshot hash is exact'

  # Deterministic integrity failure: alter the snapshot after Apply recorded its hash.
  $secondApply = Invoke-MaintenanceApply $root $candidate $null $callbacks
  Assert-Equal 'staged' $secondApply.status 'second apply status'
  $mismatchJournal = Get-Content (Join-Path $root 'maintenance-journal.json') -Raw | ConvertFrom-Json
  $mismatchSnapshot = [string]$mismatchJournal.Data.SnapshotPath
  Set-Content (Join-Path $mismatchSnapshot 'integrity-tamper.txt') 'tampered after snapshot hash was recorded'
  $preRecoveryHash = Get-ContentTreeHash -Root $root
  $preRecoveryLiveState = (Get-Content (Join-Path $root 'live-state.txt') -Raw).Trim()
  $mismatchData = @{
    TargetPath = [string]$mismatchJournal.Data.TargetPath
    SnapshotPath = $mismatchSnapshot
    SnapshotTreeHash = [string]$mismatchJournal.Data.SnapshotTreeHash
  }
  Write-JournalPhase -JournalPath (Join-Path $root 'maintenance-journal.json') -Phase applying -Data $mismatchData -Root $root | Out-Null
  $mismatchError = $null
  try { Invoke-MaintenanceRecover $root | Out-Null } catch { $mismatchError = $_.Exception.Message }
  Assert-Equal 'Recorded snapshot tree hash mismatch' $mismatchError 'tree-hash mismatch fails closed'
  Assert-Equal $preRecoveryHash (Get-ContentTreeHash -Root $root) 'failed recovery leaves target tree unchanged'
  Assert-Equal $preRecoveryLiveState (Get-Content (Join-Path $root 'live-state.txt') -Raw).Trim() 'failed recovery leaves live content unchanged'
  $failedRecoveryJournal = Get-Content (Join-Path $root 'maintenance-journal.json') -Raw | ConvertFrom-Json
  Assert-Equal 'applying' $failedRecoveryJournal.Phase 'failed recovery journal is not falsely committed'

  $failed = @{} + $callbacks
  $failed['Apply:plugin'] = { throw 'injected apply failure' }
  Assert-Throws { Invoke-MaintenanceApply $root $candidate $null $failed } 'failed apply propagates'
  Assert-True (Test-Path (Join-Path $root 'apply-disabled.json')) 'apply disabled marker'
  Assert-True (@($events | Where-Object {$_ -like 'rollback:*'}).Count -ge 3) 'rollback callbacks on failure'
  $audit = Invoke-MaintenanceAudit $root $candidate $null
  Assert-Equal 'audited' $audit.status 'audit after failure'

  1..7 | ForEach-Object { New-Item -ItemType Directory -Path (Join-Path $root ".snapshot-$($_)") | Out-Null }
  Get-ChildItem $root -Directory -Filter '.snapshot-*' | ForEach-Object { $_.LastWriteTimeUtc = [DateTime]::UtcNow.AddDays(-31) }
  Retain-MaintenanceSnapshots $root 5
  Assert-True (@(Get-ChildItem $root -Directory -Filter '.snapshot-*').Count -le 5) 'snapshot retention'
  Write-TestPass 'M9 orchestrator callback E2E'
} finally { Remove-TestSandbox $root }
