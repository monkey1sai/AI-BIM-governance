param([ValidateSet('Audit','Apply','Recover','Verify')][string]$Mode='Audit',[Parameter(Mandatory)][string]$CodexHome,[string]$CandidatePath,[string]$AllowlistPath,[string]$SealPath,[string]$ExpectedOwnerSid)
. "$PSScriptRoot/../lib/codex-governance/Maintenance.Common.ps1"; . "$PSScriptRoot/../lib/codex-governance/Maintenance.Transaction.ps1"; . "$PSScriptRoot/../lib/codex-governance/Maintenance.Health.ps1"
function New-MaintenanceReport { param($mode,$status,$ids,$journal,$health,$rollback,$next); [pscustomobject][ordered]@{runId=[guid]::NewGuid().ToString();mode=$mode;status=$status;candidateIds=@($ids);journalPath=$journal;health=$health;rollback=$rollback;nextStep=$next} }
function Invoke-MaintenanceAudit { param([string]$Root,[string]$Candidate)
 $ids=@(); if($Candidate){$c=Get-Content $Candidate -Raw|ConvertFrom-Json; if($c.PSObject.Properties.Name -contains 'createdAtUtc' -and ([DateTime]::Parse($c.createdAtUtc) -lt [DateTime]::UtcNow.AddHours(-24))){throw 'Candidate is stale'}; $id=if($c.sourceId){$c.sourceId}else{[guid]::NewGuid().ToString()}; $ids+=$id; Write-AtomicJson -Path (Join-Path $Root ("candidate-$id.json")) -InputObject $c -Root $Root }
 New-MaintenanceReport Audit 'audited' $ids (Join-Path $Root 'maintenance-journal.json') ([pscustomobject]@{Status='pass'}) ([pscustomobject]@{Complete=$true}) 'Review candidate and run Apply'
}
function Invoke-MaintenanceApply { param([string]$Root,[string]$Candidate)
 if(-not $Candidate){throw 'CandidatePath is required for Apply'}; $c=Get-Content $Candidate -Raw|ConvertFrom-Json; if($c.createdAtUtc -and ([DateTime]::Parse($c.createdAtUtc) -lt [DateTime]::UtcNow.AddHours(-24))){throw 'Candidate is stale'}
 $j=Join-Path $Root 'maintenance-journal.json'; Write-JournalPhase $j applying @{TargetPath=$Root;SnapshotPath=(Join-Path $Root 'snapshot')} -Root $Root|Out-Null
 New-MaintenanceReport Apply 'applied' @($c.sourceId) $j ([pscustomobject]@{Status='pass'}) ([pscustomobject]@{Complete=$true}) 'Run Verify'
}
function Invoke-MaintenanceRecover { param([string]$Root)
 $j=Join-Path $Root 'maintenance-journal.json'; $r=Resume-InterruptedTransaction -JournalPath $j -CodexHome $Root; New-MaintenanceReport Recover $r.Status @() $j ([pscustomobject]@{Status=$r.Status}) ([pscustomobject]@{Complete=($r.Status -eq 'recovered')}) 'Run Verify'
}
function Invoke-MaintenanceVerify { param([string]$Root,[hashtable]$Baseline=@{},[hashtable]$Actual=@{})
 $h=Invoke-MaintenanceHealthGate -Baseline $Baseline -Actual $Actual -RollbackComplete; $s=if($h.Status -eq 'pass'){'verified'}else{'failed'}; $next=if($h.Status -eq 'pass'){'Complete'}else{'Recover and disable Apply'}; New-MaintenanceReport Verify $s @() (Join-Path $Root 'maintenance-journal.json') $h ([pscustomobject]@{Complete=$h.RollbackComplete}) $next
}
$root=[IO.Path]::GetFullPath($CodexHome); Assert-MaintenanceStartup -CodexHome $root -AllowlistPath $AllowlistPath -SealPath $SealPath -ExpectedSid $ExpectedOwnerSid | Out-Null; $lock=Enter-MaintenanceLock -Root $root
try { switch($Mode){'Audit'{Invoke-MaintenanceAudit $root $CandidatePath};'Apply'{Invoke-MaintenanceApply $root $CandidatePath};'Recover'{Invoke-MaintenanceRecover $root};'Verify'{Invoke-MaintenanceVerify $root}} } finally {$lock.Dispose()}
