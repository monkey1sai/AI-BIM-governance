param([Parameter(Mandatory)][string]$CodexHome,[Parameter(Mandatory)][string]$ToolPath,[string]$PwshPath='C:\Program Files\PowerShell\7\pwsh.exe',[switch]$AuditOnly)
. "$PSScriptRoot/../lib/codex-governance/Maintenance.ScheduledTasks.ps1"
$defs=@(New-CodexGovernanceTaskDefinition Audit $CodexHome $ToolPath $PwshPath $PSScriptRoot)
if(-not $AuditOnly){$defs += New-CodexGovernanceTaskDefinition Apply $CodexHome $ToolPath $PwshPath $PSScriptRoot}
foreach($d in $defs){if(-not (Test-CodexGovernanceTask $d)){throw "Invalid task definition: $($d.TaskName)"}; Register-CodexGovernanceTask $d}
