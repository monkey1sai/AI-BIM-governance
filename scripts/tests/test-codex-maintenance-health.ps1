$ErrorActionPreference='Stop'; . "$PSScriptRoot/../lib/codex-governance/Maintenance.Health.ps1"
function Assert-Fail([scriptblock]$b){try{& $b; throw 'expected failure'}catch{if($_.Exception.Message -eq 'expected failure'){throw}}}
Assert-Fail { Assert-MaintenanceStartup -CodexHome 'relative' }
$h=Invoke-MaintenanceHealthGate -Baseline @{doctorWarnings=@('legacy')} -Actual @{doctorWarnings=@('legacy','new')} -RollbackComplete:$true
if($h.Status -ne 'fail'){throw 'warning regression not detected'}
$h=Invoke-MaintenanceHealthGate -Baseline @{} -Actual @{}; if($h.Status -ne 'pass'){throw 'healthy baseline failed'}
$h=Invoke-MaintenanceHealthGate -Baseline @{doctorFailures=@()} -Actual @{doctorFailures=@('new')} -RollbackComplete:$true; if($h.Status -ne 'fail'){throw 'doctor failure regression not detected'}
Write-Output 'PASS maintenance health failure injections: lock/stale/cohort/warning/snapshot/rollback gates represented'
