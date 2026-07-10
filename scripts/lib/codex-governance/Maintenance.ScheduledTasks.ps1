Set-StrictMode -Version Latest

function New-CodexGovernanceTaskDefinition {
    param(
        [Parameter(Mandatory)][ValidateSet('Audit','Apply')][string]$Mode,
        [Parameter(Mandatory)][string]$CodexHome,
        [Parameter(Mandatory)][string]$ToolPath,
        [string]$PwshPath = 'C:\Program Files\PowerShell\7\pwsh.exe',
        [string]$WorkingDirectory = $PSScriptRoot
    )
    foreach ($p in @($CodexHome,$ToolPath,$PwshPath,$WorkingDirectory)) { if (-not [IO.Path]::IsPathRooted($p)) { throw "Path must be absolute: $p" } }
    $script = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../dev/Invoke-CodexGovernanceMaintenance.ps1'))
    $name = "CodexGovernance-$Mode"
    $start = if ($Mode -eq 'Audit') { [datetime]::Today.AddHours(2).AddMinutes(30) } else { [datetime]::Today.AddHours(3).AddMinutes(30) }
    [pscustomobject][ordered]@{
        TaskName=$name; Mode=$Mode; Action=[pscustomobject]@{Execute=$PwshPath; Arguments="-NoProfile -NonInteractive -File `"$script`" -Mode $Mode -CodexHome `"$CodexHome`" -ToolPath `"$ToolPath`""; WorkingDirectory=$WorkingDirectory}
        Trigger=[pscustomobject]@{Schedule=$(if($Mode -eq 'Audit'){'Daily'}else{'Weekly'}); StartBoundary=$start; DaysOfWeek=$(if($Mode -eq 'Audit'){$null}else{'Sunday'}); TimeZone='Taipei Standard Time'}
        Principal=[pscustomobject]@{UserId="$env:USERDOMAIN\$env:USERNAME"; LogonType='Interactive'; RunLevel='Limited'}
        Settings=[pscustomobject]@{StartWhenAvailable=$true; MultipleInstances='IgnoreNew'; ExecutionTimeLimit='PT1H'; DisallowStartIfOnBatteries=$false; StopIfGoingOnBatteries=$false}
    }
}

function Register-CodexGovernanceTask {
    param([Parameter(Mandatory)]$Definition)
    if (-not $Definition.Action.Execute -or -not [IO.Path]::IsPathRooted($Definition.Action.Execute)) { throw 'Task action executable must be absolute' }
    $action = New-ScheduledTaskAction -Execute $Definition.Action.Execute -Argument $Definition.Action.Arguments -WorkingDirectory $Definition.Action.WorkingDirectory
    $trigger = if ($Definition.Mode -eq 'Audit') { New-ScheduledTaskTrigger -Daily -At $Definition.Trigger.StartBoundary } else { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $Definition.Trigger.StartBoundary }
    $principal = New-ScheduledTaskPrincipal -UserId $Definition.Principal.UserId -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    Register-ScheduledTask -TaskName $Definition.TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
}

function Test-CodexGovernanceTask {
    param([Parameter(Mandatory)]$Definition)
    $checks = @(
        ([IO.Path]::IsPathRooted($Definition.Action.Execute)),
        ($Definition.Action.Execute -match 'pwsh\.exe$'),
        ($Definition.Action.Arguments -match '-NoProfile'),
        ($Definition.Action.Arguments -match '-NonInteractive'),
        ($Definition.Principal.LogonType -eq 'Interactive'),
        ($Definition.Principal.RunLevel -eq 'Limited'),
        ($Definition.Settings.StartWhenAvailable -eq $true),
        ($Definition.Settings.MultipleInstances -eq 'IgnoreNew'),
        ($Definition.Settings.ExecutionTimeLimit -eq 'PT1H'),
        ($Definition.Trigger.TimeZone -eq 'Taipei Standard Time')
    )
    [bool]($checks -notcontains $false)
}
