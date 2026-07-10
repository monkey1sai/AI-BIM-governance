Set-StrictMode -Version Latest
function Enter-MaintenanceLock {
 param([Parameter(Mandatory)][string]$Root)
 New-Item -ItemType Directory -Force $Root | Out-Null; $path=Join-Path $Root 'maintenance.lock'
 try { return [IO.File]::Open($path,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) } catch { throw 'Maintenance lock is already held' }
}
function Write-JournalPhase {
 param([Parameter(Mandatory)][string]$JournalPath,[Parameter(Mandatory)][ValidateSet('discovered','pinned','staged','validated','snapshotted','applying','verifying','rolling_back','committed')][string]$Phase,[hashtable]$Data=@{},[string]$Root)
 if(-not $Root){$Root=Split-Path -Parent $JournalPath}; Resolve-ContainedPath -Root $Root -Path $JournalPath | Out-Null
 $o=[ordered]@{Phase=$Phase;Timestamp=[DateTime]::UtcNow.ToString('o');Data=$Data}; Write-AtomicJson -Path $JournalPath -InputObject $o -Root $Root; return [pscustomobject]$o
}
function Resume-InterruptedTransaction {
 param([Parameter(Mandatory)][string]$JournalPath,[string]$CodexHome)
 if(-not $CodexHome){$CodexHome=Split-Path -Parent $JournalPath}; Resolve-ContainedPath -Root $CodexHome -Path $JournalPath | Out-Null
 $j=Get-Content $JournalPath -Raw|ConvertFrom-Json; if(-not $j.Phase -or $j.Phase -notin @('discovered','pinned','staged','validated','snapshotted','applying','verifying','rolling_back','committed')){throw 'Invalid journal schema'}; if($j.Phase -notin @('applying','verifying','rolling_back')){return [pscustomobject]@{Status='noop';Phase=$j.Phase}}
 $d=$j.Data; if(-not $d -or -not ($d.PSObject.Properties.Name -contains 'SnapshotPath') -or -not ($d.PSObject.Properties.Name -contains 'TargetPath') -or -not [IO.Path]::IsPathRooted([string]$d.SnapshotPath) -or -not [IO.Path]::IsPathRooted([string]$d.TargetPath)){throw 'Invalid journal Data: absolute SnapshotPath and TargetPath required'}
 $snapshotPath=Resolve-ContainedPath -Root $CodexHome -Path ([string]$d.SnapshotPath); $targetPath=Resolve-ContainedPath -Root $CodexHome -Path ([string]$d.TargetPath)
 if(-not (Test-Path -LiteralPath $snapshotPath -PathType Container)){throw 'Missing or invalid snapshot; recovery aborted'}
 if(-not (Test-Path -LiteralPath $targetPath -PathType Container)){throw 'Missing or invalid target; recovery aborted'}
 $snapshotHash=Get-ContentTreeHash -Root $snapshotPath
 foreach($item in @(Get-ChildItem -LiteralPath $targetPath -Force)){ if($item.Name -notin @('maintenance.lock','maintenance-journal.json')){ Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop } }
 foreach($item in @(Get-ChildItem -LiteralPath $snapshotPath -Force)){ Copy-Item -LiteralPath $item.FullName -Destination $targetPath -Recurse -Force -ErrorAction Stop }
 if((Get-ContentTreeHash -Root $targetPath) -ne $snapshotHash){throw 'Restored snapshot tree hash mismatch'}
 Write-JournalPhase -JournalPath $JournalPath -Phase committed -Data @{} -Root $CodexHome | Out-Null
 return [pscustomobject]@{Status='recovered';Phase=$j.Phase}
}
