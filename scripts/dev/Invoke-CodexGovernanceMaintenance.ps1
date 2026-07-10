param([ValidateSet('Audit','Apply','Recover','Verify')][string]$Mode='Audit',[Parameter(Mandatory)][string]$CodexHome,[string]$CandidatePath)
. "$PSScriptRoot/../lib/codex-governance/Maintenance.Common.ps1"; . "$PSScriptRoot/../lib/codex-governance/Maintenance.Transaction.ps1"
$home=[IO.Path]::GetFullPath($CodexHome); $lock=Enter-MaintenanceLock -Root $home
try { $journal=Join-Path $home 'maintenance-journal.json'; if($Mode -eq 'Recover' -and (Test-Path $journal)){ Resume-InterruptedTransaction -JournalPath $journal } else {[pscustomobject]@{Mode=$Mode;CodexHome=$home;CandidatePath=$CandidatePath}} } finally {$lock.Dispose()}
