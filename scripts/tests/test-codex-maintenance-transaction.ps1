. "$PSScriptRoot/test-helpers.ps1"
. "$PSScriptRoot/../lib/codex-governance/Maintenance.Common.ps1"
. "$PSScriptRoot/../lib/codex-governance/Maintenance.Transaction.ps1"
$root=New-TestSandbox 'codex-txn'; try {
  $lock=Enter-MaintenanceLock -Root $root
  Assert-Throws { Enter-MaintenanceLock -Root $root } 'lock contention'
  $j=Join-Path $root 'journal.json'; Write-JournalPhase -JournalPath $j -Phase applying -Data @{SnapshotPath=(Join-Path $root 'snap.txt'); TargetPath=(Join-Path $root 'target.txt')}
  Set-Content (Join-Path $root 'snap.txt') 'snapshot'; Set-Content (Join-Path $root 'target.txt') 'changed'
  $r=Resume-InterruptedTransaction -JournalPath $j
  Assert-Equal 'recovered' $r.Status 'recovery status'; Assert-Equal 'snapshot' (Get-Content (Join-Path $root 'target.txt') -Raw).Trim() 'snapshot restored'
  $lock.Dispose(); Write-TestPass 'maintenance transaction'
} finally { if($lock){$lock.Dispose()}; Remove-TestSandbox $root }
