Set-StrictMode -Version Latest

function Invoke-MaintenanceHealthGate {
 param([hashtable]$Baseline=@{},[hashtable]$Actual=@{},[bool]$RollbackComplete=$true)
 $fail=@(); $warn=@()
 foreach($k in @('doctorFailures','mcp','profiles','plugins')) {
  if($Baseline.ContainsKey($k) -and $Actual.ContainsKey($k)) {
   $a=($Actual[$k]|ConvertTo-Json -Compress); $b=($Baseline[$k]|ConvertTo-Json -Compress)
   if($k -eq 'doctorFailures' -and @($Actual[$k]).Count -gt @($Baseline[$k]).Count){$fail += "$k regression"}
   elseif($a -ne $b){$warn += "$k regression"}
  }
 }
 if($Baseline.ContainsKey('doctorWarnings') -and $Actual.ContainsKey('doctorWarnings') -and @($Actual.doctorWarnings).Count -gt @($Baseline.doctorWarnings).Count){$fail += 'doctor warning regression'}
 if($RollbackComplete -eq $false){$fail += 'rollback incomplete'}
 $doctor=if($Actual.ContainsKey('doctor')){$Actual.doctor}else{$null}; $mcp=if($Actual.ContainsKey('mcp')){$Actual.mcp}else{$null}; $profiles=if($Actual.ContainsKey('profiles')){$Actual.profiles}else{$null}; $plugins=if($Actual.ContainsKey('plugins')){$Actual.plugins}else{$null}
 [pscustomobject]@{Status=if($fail.Count){'fail'}elseif($warn.Count){'warning'}else{'pass'};Failures=$fail;Warnings=$warn;Doctor=$doctor;Mcp=$mcp;Profiles=$profiles;Plugins=$plugins;RollbackComplete=[bool]$RollbackComplete}
}

function Assert-MaintenanceStartup {
 param([Parameter(Mandatory)][string]$CodexHome,[string[]]$ToolPath,[string]$ExpectedSid,[string]$AllowlistPath,[string]$SealPath)
 if(-not [IO.Path]::IsPathRooted($CodexHome)){throw 'CODEX_HOME must be absolute'}
 if($env:CODEX_HOME -and ([IO.Path]::GetFullPath($env:CODEX_HOME) -ne [IO.Path]::GetFullPath($CodexHome))){throw 'CODEX_HOME mismatch'}
 foreach($p in @($ToolPath|Where-Object {$_})){if(-not [IO.Path]::IsPathRooted($p)){throw "Tool path must be absolute: $p"}}
 if($ExpectedSid -and $AllowlistPath -and $SealPath){ . "$PSScriptRoot/Maintenance.Trust.ps1"; Read-SealedAllowlist $AllowlistPath $SealPath $ExpectedSid | Out-Null }
 [pscustomobject]@{Status='pass';CodexHome=[IO.Path]::GetFullPath($CodexHome)}
}
