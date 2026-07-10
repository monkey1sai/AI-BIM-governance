. "$PSScriptRoot/test-helpers.ps1"
. "$PSScriptRoot/../lib/codex-governance/Maintenance.Common.ps1"
. "$PSScriptRoot/../lib/codex-governance/Maintenance.Transaction.ps1"
$root=New-TestSandbox 'codex-txn'; try {
  $lock=Enter-MaintenanceLock -Root $root
  Assert-Throws { Enter-MaintenanceLock -Root $root } 'lock contention'
  $target=Join-Path $root 'target'; $snapshot=Join-Path $root 'snapshot'; New-Item -ItemType Directory $target,$snapshot | Out-Null
  Set-Content (Join-Path $snapshot 'original.txt') 'snapshot'; Set-Content (Join-Path $target 'original.txt') 'changed'; Set-Content (Join-Path $target 'extra.txt') 'remove'
  $j=Join-Path $root 'journal.json'; Write-JournalPhase -JournalPath $j -Phase applying -Data @{SnapshotPath=$snapshot; TargetPath=$target}
  $r=Resume-InterruptedTransaction -JournalPath $j
  Assert-Equal 'recovered' $r.Status 'recovery status'; Assert-Equal 'snapshot' (Get-Content (Join-Path $target 'original.txt') -Raw).Trim() 'snapshot restored'; Assert-True (-not (Test-Path (Join-Path $target 'extra.txt'))) 'stale target content removed'
  $bad=Join-Path $root 'bad-journal.json'; Write-JournalPhase -JournalPath $bad -Phase applying -Data @{SnapshotPath=(Join-Path $root 'missing'); TargetPath=$target}
  Assert-Throws { Resume-InterruptedTransaction -JournalPath $bad } 'missing snapshot fails closed'
  $lock.Dispose(); Write-TestPass 'maintenance transaction'
} finally { if($lock){$lock.Dispose()}; Remove-TestSandbox $root }
