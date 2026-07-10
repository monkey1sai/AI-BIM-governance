Set-StrictMode -Version Latest
function Enter-MaintenanceLock {
 param([Parameter(Mandatory)][string]$Root)
 New-Item -ItemType Directory -Force $Root | Out-Null; $path=Join-Path $Root 'maintenance.lock'
 try { return [IO.File]::Open($path,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) } catch { throw 'Maintenance lock is already held' }
}
function Write-JournalPhase {
 param([Parameter(Mandatory)][string]$JournalPath,[Parameter(Mandatory)][ValidateSet('discovered','pinned','staged','validated','snapshotted','applying','verifying','committed')][string]$Phase,[hashtable]$Data=@{},[string]$Root)
 if(-not $Root){$Root=Split-Path -Parent $JournalPath}; Resolve-ContainedPath -Root $Root -Path $JournalPath | Out-Null
 $o=[ordered]@{Phase=$Phase;Timestamp=[DateTime]::UtcNow.ToString('o');Data=$Data}; Write-AtomicJson -Path $JournalPath -InputObject $o -Root $Root; return [pscustomobject]$o
}
function Resume-InterruptedTransaction {
 param([Parameter(Mandatory)][string]$JournalPath,[string]$CodexHome)
 if(-not $CodexHome){$CodexHome=Split-Path -Parent $JournalPath}; Resolve-ContainedPath -Root $CodexHome -Path $JournalPath | Out-Null
 $j=Get-Content $JournalPath -Raw|ConvertFrom-Json; if(-not $j.Phase -or $j.Phase -notin @('discovered','pinned','staged','validated','snapshotted','applying','verifying','committed')){throw 'Invalid journal schema'}; if($j.Phase -notin @('applying','verifying')){return [pscustomobject]@{Status='noop';Phase=$j.Phase}}
 $d=$j.Data; if(-not $d.SnapshotPath -or -not $d.TargetPath -or -not (Test-Path $d.SnapshotPath)){throw 'Missing snapshot; recovery aborted'}; Resolve-ContainedPath -Root $CodexHome -Path $d.SnapshotPath | Out-Null; Resolve-ContainedPath -Root $CodexHome -Path $d.TargetPath | Out-Null; Copy-Item $d.SnapshotPath $d.TargetPath -Force
 Write-JournalPhase -JournalPath $JournalPath -Phase committed -Data @{} -Root $CodexHome | Out-Null
 return [pscustomobject]@{Status='recovered';Phase=$j.Phase}
}
