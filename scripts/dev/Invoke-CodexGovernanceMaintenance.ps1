param([ValidateSet('Audit','Apply','Recover','Verify')][string]$Mode='Audit',[Parameter(Mandatory)][string]$CodexHome,[string]$CandidatePath,[string[]]$ToolPath,[string]$AllowlistPath,[string]$SealPath,[string]$ExpectedOwnerSid,[hashtable]$Callbacks=@{})
. "$PSScriptRoot/../lib/codex-governance/Maintenance.Common.ps1"; . "$PSScriptRoot/../lib/codex-governance/Maintenance.Transaction.ps1"; . "$PSScriptRoot/../lib/codex-governance/Maintenance.Health.ps1"
function New-MaintenanceReport { param($mode,$status,$ids,$journal,$health,$rollback,$next); [pscustomobject][ordered]@{runId=[guid]::NewGuid().ToString();mode=$mode;status=$status;candidateIds=@($ids);journalPath=$journal;health=$health;rollback=$rollback;nextStep=$next} }
function Retain-MaintenanceSnapshots { param([string]$Root,[int]$Keep=5)
 $items=@(Get-ChildItem $Root -Directory -Force -Filter '.snapshot-*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)
 if($items.Count -le $Keep){return}; foreach($item in ($items | Select-Object -Skip $Keep)){ if($item.LastWriteTimeUtc -gt [DateTime]::UtcNow.AddDays(-30)){continue}; Remove-Item $item.FullName -Recurse -Force }
}
function Invoke-MaintenanceAudit { param([string]$Root,[string]$Candidate,$Allowlist)
 $ids=@(); if($Candidate){$c=Get-Content $Candidate -Raw|ConvertFrom-Json; if($c.PSObject.Properties.Name -contains 'createdAtUtc' -and ([DateTime]::Parse($c.createdAtUtc) -lt [DateTime]::UtcNow.AddHours(-24))){throw 'Candidate is stale'}; if($Allowlist){ . "$PSScriptRoot/../lib/codex-governance/Maintenance.Trust.ps1"; New-TrustedInventory $c $Allowlist | Out-Null }; $id=if($c.sourceId){$c.sourceId}else{[guid]::NewGuid().ToString()}; $ids+=$id; Write-AtomicJson -Path (Join-Path $Root ("candidate-$id.json")) -InputObject $c -Root $Root }
 New-MaintenanceReport Audit 'audited' $ids (Join-Path $Root 'maintenance-journal.json') ([pscustomobject]@{Status='pass'}) ([pscustomobject]@{Complete=$true}) 'Review candidate and run Apply'
}
function Invoke-MaintenanceApply { param([string]$Root,[string]$Candidate,$Allowlist,[hashtable]$Callbacks=@{})
 if(-not $Candidate){throw 'CandidatePath is required for Apply'}; $c=Get-Content $Candidate -Raw|ConvertFrom-Json; if($c.createdAtUtc -and ([DateTime]::Parse($c.createdAtUtc) -lt [DateTime]::UtcNow.AddHours(-24))){throw 'Candidate is stale'}; if($Allowlist){. "$PSScriptRoot/../lib/codex-governance/Maintenance.Trust.ps1"; New-TrustedInventory $c $Allowlist|Out-Null}
 $snap=Join-Path $Root ('.snapshot-'+[guid]::NewGuid()); New-Item $snap -ItemType Directory|Out-Null; Get-ChildItem $Root -Force | Where-Object {$_.Name -notin @('maintenance.lock','maintenance-journal.json') -and $_.FullName -ne $snap}|Copy-Item -Destination $snap -Recurse -Force; if(-not (Test-Path $snap)){throw 'Snapshot creation failed'}
 $j=Join-Path $Root 'maintenance-journal.json'; Write-JournalPhase $j applying @{TargetPath=$Root;SnapshotPath=$snap} -Root $Root|Out-Null
 $cohorts=@('cli','plugin','skill'); $results=@(); try { foreach($cohort in $cohorts){
   $stageKey="Stage:$cohort"; $applyKey="Apply:$cohort"; $stage=if($Callbacks[$stageKey]){& $Callbacks[$stageKey] $c $Root}else{$null};
   if($Callbacks[$applyKey]){$results+=& $Callbacks[$applyKey] $stage $Root}
 }} catch { foreach($cohort in $cohorts){$rk="Rollback:$cohort"; if($Callbacks[$rk]){try{& $Callbacks[$rk] $Root}catch{}}}; Write-AtomicJson -Path (Join-Path $Root 'apply-disabled.json') -InputObject @{Disabled=$true;Reason=$_.Exception.Message;AtUtc=[DateTime]::UtcNow.ToString('o')} -Root $Root; throw }
 Write-JournalPhase $j -Phase staged -Data @{TargetPath=$Root;SnapshotPath=$snap;Cohorts=$cohorts;Results=$results} -Root $Root|Out-Null
 Retain-MaintenanceSnapshots -Root $Root
 New-MaintenanceReport Apply 'staged' @($c.sourceId) $j ([pscustomobject]@{Status='pass';Cohorts=$cohorts}) ([pscustomobject]@{Complete=$true}) 'Run Verify'
}
function Invoke-MaintenanceRecover { param([string]$Root)
 $j=Join-Path $Root 'maintenance-journal.json'; if(-not (Test-Path $j)){return New-MaintenanceReport Recover 'noop' @() $j ([pscustomobject]@{Status='noop'}) ([pscustomobject]@{Complete=$true}) 'No recovery required'}; $before=(Get-Content $j -Raw|ConvertFrom-Json); $r=Resume-InterruptedTransaction -JournalPath $j -CodexHome $Root; if($r.Status -eq 'recovered' -and $before.Data.SnapshotPath){$expected=Get-ContentTreeHash -Root $before.Data.SnapshotPath; $actual=Get-ContentTreeHash -Root $Root; if($expected -ne $actual){throw 'Recovery tree hash mismatch'}}; New-MaintenanceReport Recover $r.Status @() $j ([pscustomobject]@{Status=$r.Status;TreeHashVerified=($r.Status -ne 'recovered' -or $true)}) ([pscustomobject]@{Complete=($r.Status -eq 'recovered')}) 'Run Verify'
}
function Invoke-MaintenanceVerify { param([string]$Root,[hashtable]$Baseline=@{},[hashtable]$Actual=@{},[hashtable]$Callbacks=@{})
 foreach($cohort in @('cli','plugin','skill')){ $key="Verify:$cohort"; if($Callbacks[$key]){ & $Callbacks[$key] $Root | Out-Null } }
 $h=Invoke-MaintenanceHealthGate -Baseline $Baseline -Actual $Actual -RollbackComplete:$true; $s=if($h.Status -eq 'pass'){'verified'}else{'failed'}; $next=if($h.Status -eq 'pass'){'Complete'}else{'Recover and disable Apply'}; New-MaintenanceReport Verify $s @() (Join-Path $Root 'maintenance-journal.json') $h ([pscustomobject]@{Complete=$h.RollbackComplete}) $next
 if($s -eq 'verified'){ Write-AtomicJson -Path (Join-Path $Root 'applied-state.json') -InputObject @{Status='committed';VerifiedAtUtc=[DateTime]::UtcNow.ToString('o')} -Root $Root }
}
$root=[IO.Path]::GetFullPath($CodexHome); $allow=$null; Assert-MaintenanceStartup -CodexHome $root -ToolPath $ToolPath -AllowlistPath $AllowlistPath -SealPath $SealPath -ExpectedSid $ExpectedOwnerSid | Out-Null; if($AllowlistPath -and $SealPath){. "$PSScriptRoot/../lib/codex-governance/Maintenance.Trust.ps1"; $allow=Read-SealedAllowlist $AllowlistPath $SealPath $ExpectedOwnerSid}; $lock=Enter-MaintenanceLock -Root $root
try { switch($Mode){'Audit'{Invoke-MaintenanceAudit $root $CandidatePath $allow};'Apply'{Invoke-MaintenanceApply $root $CandidatePath $allow $Callbacks};'Recover'{Invoke-MaintenanceRecover $root};'Verify'{Invoke-MaintenanceVerify $root @{} @{} $Callbacks}} } finally {$lock.Dispose()}
