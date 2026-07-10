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
 if(($d.PSObject.Properties.Name -contains 'SnapshotTreeHash') -and [string]$d.SnapshotTreeHash -and [string]$d.SnapshotTreeHash -ne $snapshotHash){throw 'Recorded snapshot tree hash mismatch'}
 $recordedHash=if(($d.PSObject.Properties.Name -contains 'SnapshotTreeHash') -and [string]$d.SnapshotTreeHash){[string]$d.SnapshotTreeHash}else{$snapshotHash}
 $restoreStage=Join-Path $targetPath ('.recovery-stage-'+[guid]::NewGuid().ToString('N'))
 $verifyStage=Join-Path $targetPath ('.recovery-verify-'+[guid]::NewGuid().ToString('N'))
 $targetPrefix=[IO.Path]::GetFullPath($targetPath).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
 $snapshotInsideTarget=[IO.Path]::GetFullPath($snapshotPath).StartsWith($targetPrefix,[StringComparison]::OrdinalIgnoreCase)
 try {
  New-Item -ItemType Directory -Path $restoreStage -ErrorAction Stop | Out-Null
  foreach($item in @(Get-ChildItem -LiteralPath $snapshotPath -Force)){ Copy-Item -LiteralPath $item.FullName -Destination $restoreStage -Recurse -Force -ErrorAction Stop }
  if((Get-ContentTreeHash -Root $restoreStage) -ne $recordedHash){throw 'Staged recovery tree hash mismatch'}
  foreach($item in @(Get-ChildItem -LiteralPath $targetPath -Force)){
   $full=[IO.Path]::GetFullPath($item.FullName)
   if($item.Name -in @('maintenance.lock','maintenance-journal.json') -or $full -eq [IO.Path]::GetFullPath($restoreStage) -or ($snapshotInsideTarget -and $full -eq [IO.Path]::GetFullPath($snapshotPath))){continue}
   Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop
  }
  foreach($item in @(Get-ChildItem -LiteralPath $restoreStage -Force)){ Copy-Item -LiteralPath $item.FullName -Destination $targetPath -Recurse -Force -ErrorAction Stop }
  New-Item -ItemType Directory -Path $verifyStage -ErrorAction Stop | Out-Null
  foreach($item in @(Get-ChildItem -LiteralPath $targetPath -Force)){
   $full=[IO.Path]::GetFullPath($item.FullName)
   if($item.Name -in @('maintenance.lock','maintenance-journal.json') -or $full -eq [IO.Path]::GetFullPath($restoreStage) -or $full -eq [IO.Path]::GetFullPath($verifyStage) -or ($snapshotInsideTarget -and $full -eq [IO.Path]::GetFullPath($snapshotPath))){continue}
   Copy-Item -LiteralPath $item.FullName -Destination $verifyStage -Recurse -Force -ErrorAction Stop
  }
  if((Get-ContentTreeHash -Root $verifyStage) -ne $recordedHash){throw 'Restored snapshot tree hash mismatch'}
  Remove-Item -LiteralPath $verifyStage -Recurse -Force -ErrorAction Stop
  Remove-Item -LiteralPath $restoreStage -Recurse -Force -ErrorAction Stop
  if($snapshotInsideTarget){Remove-Item -LiteralPath $snapshotPath -Recurse -Force -ErrorAction Stop}
  if((Get-ContentTreeHash -Root $targetPath) -ne $recordedHash){throw 'Recovery tree hash mismatch'}
 } finally {
  if(Test-Path -LiteralPath $verifyStage){Remove-Item -LiteralPath $verifyStage -Recurse -Force -ErrorAction SilentlyContinue}
  if(Test-Path -LiteralPath $restoreStage){Remove-Item -LiteralPath $restoreStage -Recurse -Force -ErrorAction SilentlyContinue}
 }
 Write-JournalPhase -JournalPath $JournalPath -Phase committed -Data @{} -Root $CodexHome | Out-Null
 return [pscustomobject]@{Status='recovered';Phase=$j.Phase;TreeHash=$recordedHash;TreeHashVerified=$true}
}
