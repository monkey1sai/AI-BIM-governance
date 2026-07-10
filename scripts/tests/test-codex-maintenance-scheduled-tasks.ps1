$ErrorActionPreference='Stop'; . "$PSScriptRoot/../lib/codex-governance/Maintenance.ScheduledTasks.ps1"
$root=[IO.Path]::GetFullPath((Join-Path $env:TEMP 'codex-maintenance-tests')); New-Item -ItemType Directory -Force $root|Out-Null
foreach($mode in 'Audit','Apply') { $d=New-CodexGovernanceTaskDefinition $mode $root (Join-Path $root 'tools') 'C:\Program Files\PowerShell\7\pwsh.exe' $root; if(-not (Test-CodexGovernanceTask $d)){throw "$mode definition failed"}; if($d.Action.Arguments -notmatch 'NoProfile|NonInteractive'){throw 'flags missing'}; if($mode -eq 'Apply' -and $d.Trigger.DaysOfWeek -ne 'Sunday'){throw 'weekly trigger failed'} }
Write-Output 'PASS maintenance scheduled task definitions (registration not invoked)'
