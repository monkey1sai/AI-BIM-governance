$ErrorActionPreference='Stop'; . "$PSScriptRoot/../lib/codex-governance/Maintenance.ScheduledTasks.ps1"
$root=[IO.Path]::GetFullPath((Join-Path $env:TEMP 'codex-maintenance-tests')); New-Item -ItemType Directory -Force $root|Out-Null
foreach($mode in 'Audit','Apply') {
 $d=New-CodexGovernanceTaskDefinition $mode $root (Join-Path $root 'tools') 'C:\Program Files\PowerShell\7\pwsh.exe' $root
 if(-not (Test-CodexGovernanceTask $d)){throw "$mode definition failed"}
 if(-not [IO.Path]::IsPathRooted($d.Action.Execute) -or $d.Action.Execute -notmatch 'pwsh\.exe$'){throw 'absolute pwsh missing'}
 if($d.Action.Arguments -notmatch '-NoProfile' -or $d.Action.Arguments -notmatch '-NonInteractive' -or $d.Action.Arguments -notmatch '-CodexHome'){throw 'action contract missing'}
 if($d.Action.Arguments -notmatch 'Invoke-CodexGovernanceMaintenance\.ps1'){throw 'script path missing'}
 if($d.Trigger.TimeZone -ne 'Taipei Standard Time'){throw 'timezone missing'}
 if($mode -eq 'Audit' -and ($d.Trigger.Schedule -ne 'Daily' -or $d.Trigger.StartBoundary.Hour -ne 2 -or $d.Trigger.StartBoundary.Minute -ne 30)){throw 'audit trigger failed'}
 if($mode -eq 'Apply' -and ($d.Trigger.DaysOfWeek -ne 'Sunday' -or $d.Trigger.StartBoundary.Hour -ne 3 -or $d.Trigger.StartBoundary.Minute -ne 30)){throw 'apply trigger failed'}
}
# This test intentionally never calls Register-CodexGovernanceTask.
Write-Output 'PASS maintenance scheduled task definitions (registration not invoked)'
