Set-StrictMode -Version Latest
. "$PSScriptRoot/Maintenance.Common.ps1"
. "$PSScriptRoot/Maintenance.Transaction.ps1"

function Get-CliCandidate {
 param([Parameter(Mandatory)]$Candidate)
 if($Candidate -is [string]) { $Candidate = Get-Content $Candidate -Raw | ConvertFrom-Json }
 if(-not $Candidate.Version){ throw 'Candidate Version is required' }
 if(-not $Candidate.Packages -or @($Candidate.Packages).Count -eq 0){ throw 'Packages closure is required' }
 foreach($p in @($Candidate.Packages)){if(-not $p.name -or -not $p.integrity){throw 'Every closure package requires name and integrity'} }
 if(-not $Candidate.ClosureHash){
   if($Candidate.Packages){ $json=$Candidate.Packages|ConvertTo-Json -Depth 20 -Compress; $Candidate | Add-Member -NotePropertyName ClosureHash -NotePropertyValue (([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($json))|% ToString x2)-join '') }
   else { throw 'Candidate ClosureHash or Packages is required' }
 }
 return $Candidate
}

function Stage-CliClosure {
 param([Parameter(Mandatory)]$Candidate,[Parameter(Mandatory)][string]$Prefix,[string]$Staging,[string]$OldVersion,[string]$NewVersion)
 $c=Get-CliCandidate $Candidate; if(-not $Staging){$Staging=Join-Path (Split-Path $Prefix -Parent) (".cli-stage-"+[guid]::NewGuid().ToString('N'))}; New-Item -ItemType Directory -Force $Staging | Out-Null
 $source=if($c.PSObject.Properties.Name -contains 'SourcePath' -and $c.SourcePath){$c.SourcePath}else{$Prefix}; if(Test-Path $source){Copy-Item (Join-Path $source '*') $Staging -Recurse -Force -ErrorAction SilentlyContinue}
 $m=[ordered]@{Version=$c.Version;ClosureHash=$c.ClosureHash;Packages=$c.Packages;StagedAt=[DateTime]::UtcNow.ToString('o')}; Write-AtomicJson -Path (Join-Path $Staging 'cli-closure.json') -InputObject $m -Root $Staging
 $actual=Get-ContentTreeHash $Staging; if(($c.PSObject.Properties.Name -contains 'TreeHash') -and $c.TreeHash -and $c.TreeHash -ne $actual){throw 'Staged closure tree hash mismatch'}; [pscustomobject]@{Prefix=$Prefix;Staging=$Staging;Version=$c.Version;ClosureHash=$c.ClosureHash;TreeHash=$actual;OldVersion=$OldVersion;NewVersion=$NewVersion}
}

function Test-CliLifecycleBaseline {
 param([Parameter(Mandatory)][string]$Prefix,[Parameter(Mandatory)]$Candidate)
 $c=Get-CliCandidate $Candidate; $manifest=Join-Path $Prefix 'cli-closure.json'; if(-not (Test-Path $manifest)){throw 'Missing CLI closure manifest'}; $m=Get-Content $manifest -Raw|ConvertFrom-Json
 if($m.ClosureHash -ne $c.ClosureHash){throw 'CLI closure hash mismatch'}
 $ml=if($m.PSObject.Properties.Name -contains 'LifecycleScript'){$m.LifecycleScript}else{$null}; $cl=if($c.PSObject.Properties.Name -contains 'LifecycleScript'){$c.LifecycleScript}else{$null}
 if(($ml|ConvertTo-Json -Compress) -ne ($cl|ConvertTo-Json -Compress)){throw 'Lifecycle-script change is not allowed'}
 [pscustomobject]@{Status='pass';ClosureHash=$m.ClosureHash}
}

function Test-ActiveCliProcess {
 param([Parameter(Mandatory)][string]$TargetRoot,[string]$Executable='codex.exe')
 $root=[IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')+'\'
 foreach($p in (Get-Process -ErrorAction SilentlyContinue)){try{$path=$p.Path;if($path -and $path.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -and ([IO.Path]::GetFileName($path) -ieq $Executable)){return [pscustomobject]@{Active=$true;ProcessId=$p.Id;Path=$path}}}catch{}}
 [pscustomobject]@{Active=$false}
}

function Invoke-CliRollbackRehearsal {
 param([Parameter(Mandatory)][string]$Prefix,[Parameter(Mandatory)][string]$Staging,[Parameter(Mandatory)][string]$CurrentVersion,[Parameter(Mandatory)][string]$CandidateVersion)
 $before=Get-ContentTreeHash $Prefix; $snapshot=Join-Path (Split-Path $Prefix -Parent) ('.rehearsal-snapshot-'+[guid]::NewGuid().ToString('N')); Copy-Item $Prefix $snapshot -Recurse -Force; try { $r=Apply-CliClosure -Prefix $Prefix -Staging $Staging -Candidate ([pscustomobject]@{Version=$CandidateVersion;Packages=@(@{name='rehearsal';integrity='x'});ClosureHash='rehearsal'}); Restore-CliClosure -Prefix $Prefix -SnapshotPath $snapshot|Out-Null; $after=Get-ContentTreeHash $Prefix; $staged=Get-ContentTreeHash $Staging; if($before -ne $after){throw 'Rollback rehearsal hash mismatch'}; [pscustomobject]@{Status='pass';CurrentVersion=$CurrentVersion;CandidateVersion=$CandidateVersion;BeforeHash=$before;AfterHash=$after;StagedHash=$staged} } finally {if(Test-Path $snapshot){Remove-Item $snapshot -Recurse -Force}}
}

function Apply-CliClosure {
 param([Parameter(Mandatory)][string]$Prefix,[Parameter(Mandatory)][string]$Staging,[Parameter(Mandatory)]$Candidate)
 $active=Test-ActiveCliProcess -TargetRoot $Prefix; if($active.Active){return [pscustomobject]@{Status='deferred_active_process';ProcessId=$active.ProcessId;Path=$active.Path}}
 $c=Get-CliCandidate $Candidate; $stagedHash=Get-ContentTreeHash $Staging; if(($c.PSObject.Properties.Name -contains 'TreeHash') -and $c.TreeHash -and $c.TreeHash -ne $stagedHash){throw 'Staged closure tree hash mismatch'}
 $parent=Split-Path $Prefix -Parent; $name=Split-Path $Prefix -Leaf; $snapshot=Join-Path $parent (".$name.snapshot-"+[guid]::NewGuid().ToString('N')); Copy-Item $Prefix $snapshot -Recurse -Force
 $journal=Join-Path $Prefix 'maintenance-journal.json'; Write-JournalPhase -JournalPath $journal -Phase applying -Data @{SnapshotPath=$snapshot;TargetPath=$Prefix} -Root $Prefix | Out-Null
 $sibling=$Prefix+'.next'; if(Test-Path $sibling){Remove-Item $sibling -Recurse -Force}; Copy-Item $Staging $sibling -Recurse -Force; Rename-Item $Prefix ($name+'.old-'+[guid]::NewGuid().ToString('N')); Rename-Item $sibling $name; Write-JournalPhase -JournalPath (Join-Path $Prefix 'maintenance-journal.json') -Phase committed -Data @{} -Root $Prefix | Out-Null
 [pscustomobject]@{Status='applied';SnapshotPath=$snapshot;Prefix=$Prefix;ClosureHash=(Get-CliCandidate $Candidate).ClosureHash}
}

function Restore-CliClosure {
 param([Parameter(Mandatory)][string]$Prefix,[Parameter(Mandatory)][string]$SnapshotPath)
 if(-not (Test-Path $SnapshotPath)){throw 'Missing CLI snapshot'}; $tmp=$Prefix+'.rollback'; if(Test-Path $tmp){Remove-Item $tmp -Recurse -Force}; Copy-Item $SnapshotPath $tmp -Recurse -Force; $old=$Prefix+'.failed'; if(Test-Path $Prefix){Rename-Item $Prefix (Split-Path $old -Leaf)}; Rename-Item $tmp (Split-Path $Prefix -Leaf); [pscustomobject]@{Status='rolled_back';Prefix=$Prefix}
}
