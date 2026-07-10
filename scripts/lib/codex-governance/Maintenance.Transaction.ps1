Set-StrictMode -Version Latest
function Enter-MaintenanceLock {
 param([Parameter(Mandatory)][string]$Root)
 New-Item -ItemType Directory -Force $Root | Out-Null; $path=Join-Path $Root 'maintenance.lock'
 try { return [IO.File]::Open($path,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) } catch { throw 'Maintenance lock is already held' }
}
function Write-JournalPhase {
 param([Parameter(Mandatory)][string]$JournalPath,[Parameter(Mandatory)][ValidateSet('discovered','pinned','staged','validated','snapshotted','applying','verifying','committed')][string]$Phase,[hashtable]$Data=@{})
 $o=[ordered]@{Phase=$Phase;Timestamp=[DateTime]::UtcNow.ToString('o');Data=$Data}; Write-AtomicJson -Path $JournalPath -InputObject $o; return [pscustomobject]$o
}
function Resume-InterruptedTransaction {
 param([Parameter(Mandatory)][string]$JournalPath)
 $j=Get-Content $JournalPath -Raw|ConvertFrom-Json; if($j.Phase -notin @('applying','verifying')){return [pscustomobject]@{Status='noop';Phase=$j.Phase}}
 $d=$j.Data; if($d.SnapshotPath -and $d.TargetPath -and (Test-Path $d.SnapshotPath)){ Copy-Item $d.SnapshotPath $d.TargetPath -Force }
 Write-JournalPhase -JournalPath $JournalPath -Phase committed -Data @{} | Out-Null
 return [pscustomobject]@{Status='recovered';Phase=$j.Phase}
}
