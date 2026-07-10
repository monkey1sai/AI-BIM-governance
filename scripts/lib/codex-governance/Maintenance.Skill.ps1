Set-StrictMode -Version Latest

function Assert-SkillPath { param([string]$Root,[string]$Path)
 if(-not [IO.Path]::IsPathRooted($Root) -or -not [IO.Path]::IsPathRooted($Path)){throw 'Absolute paths required'}
 $full=[IO.Path]::GetFullPath($Path); $base=[IO.Path]::GetFullPath($Root).TrimEnd('\')+'\'; if(-not ($full.Equals($base.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($base,[StringComparison]::OrdinalIgnoreCase))){throw 'Path escapes root'}
 $cursor=$full; while($cursor -and ($cursor.Equals($base.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase) -or $cursor.StartsWith($base,[StringComparison]::OrdinalIgnoreCase))){$i=Get-Item -LiteralPath $cursor -Force -ErrorAction SilentlyContinue; if($i -and (($i.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0)){throw "Reparse point not allowed: $cursor"}; $next=Split-Path $cursor -Parent; if($next -eq $cursor){break}; $cursor=$next}
 return $full
}

function Get-FileSha256 { param([Parameter(Mandatory)][string]$Path) if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){throw "File missing: $Path"}; return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Test-SkillFrontmatter {
 param([Parameter(Mandatory)][string]$Path)
 $text=Get-Content -LiteralPath $Path -Raw
 if($text -notmatch '(?ms)^---\s*\r?\n(?<fm>.*?)\r?\n---\s*\r?\n'){throw 'SKILL.md frontmatter missing'}
 $fm=$Matches.fm; foreach($k in 'name','description','license','provenance'){if($fm -notmatch "(?m)^$k\s*:"){throw "SKILL.md frontmatter missing $k"}}
 if($fm -notmatch '(?m)^license\s*:\s*[^\s]+'){throw 'License is empty'}
 if($fm -notmatch '(?m)^provenance\s*:\s*[^\s]+'){throw 'Provenance is empty'}
 return [pscustomobject]@{Frontmatter=$fm;Sha256=(Get-FileSha256 $Path)}
}
function Get-SkillCapabilitySnapshot {
 param([Parameter(Mandatory)][string]$Root)
 if(-not (Test-Path $Root)){throw "Skill root missing: $Root"}; $files=@(Get-ChildItem -LiteralPath $Root -Recurse -File -Force)
 $scripts=@($files|Where-Object {$_.Extension -in '.ps1','.psm1','.psd1','.py','.js','.ts','.sh','.bat','.cmd','.exe'}|ForEach-Object {$_.FullName.Substring([IO.Path]::GetFullPath($Root).Length).TrimStart('\','/')})|Sort-Object
 $caps=[ordered]@{scriptInventory=@($scripts);entrypoints=@($files|Where-Object {$_.Name -match '^(SKILL|README)\.'}|ForEach-Object {$_.Name}|Sort-Object);fileCount=$files.Count}
 return [pscustomobject]$caps
}
function Get-SkillInventory {
 param([Parameter(Mandatory)][string]$SkillsRoot,[string[]]$LocalRoots=@(),[string[]]$PluginRoots=@())
 $items=@(); if(Test-Path $SkillsRoot){foreach($d in @(Get-ChildItem $SkillsRoot -Directory -Force)){$items += [pscustomobject]@{Name=$d.Name;Path=$d.FullName;Kind='managed'}}}
 foreach($r in $LocalRoots){if(Test-Path $r){foreach($d in @(Get-ChildItem $r -Directory -Force)){$items += [pscustomobject]@{Name=$d.Name;Path=$d.FullName;Kind='local'}}}}
 foreach($r in $PluginRoots){if(Test-Path $r){foreach($d in @(Get-ChildItem $r -Directory -Force)){$items += [pscustomobject]@{Name=$d.Name;Path=$d.FullName;Kind='plugin'}}}}
 $dupes=@($items|Group-Object Name|Where-Object Count -gt 1); if($dupes){throw "Duplicate skill names: $($dupes.Name -join ', ')"}; return @($items)
}
function Stage-PinnedSkillSource {
 param([Parameter(Mandatory)][string]$ArchivePath,[Parameter(Mandatory)][string]$ExpectedSha256,[Parameter(Mandatory)][string]$StageRoot)
 $ArchivePath=Assert-SkillPath ([IO.Path]::GetFullPath((Split-Path $ArchivePath -Parent))) $ArchivePath; $StageRoot=[IO.Path]::GetFullPath($StageRoot); Assert-SkillPath $StageRoot $StageRoot|Out-Null
 $actual=Get-FileSha256 $ArchivePath; if($actual -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source/archive hash mismatch'}
 New-Item -ItemType Directory -Force -Path $StageRoot|Out-Null; $copy=Join-Path $StageRoot ([IO.Path]::GetFileName($ArchivePath)); Assert-SkillPath $StageRoot $copy|Out-Null; Copy-Item $ArchivePath $copy -Force
 return [pscustomobject]@{ArchivePath=$copy;ArchiveSha256=$actual;StageRoot=$StageRoot}
}
function Expand-ValidatedArchive {
 param([Parameter(Mandatory)][string]$ArchivePath,[Parameter(Mandatory)][string]$Destination,[string]$ExpectedTreeHash)
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $Destination=[IO.Path]::GetFullPath($Destination); if(Test-Path $Destination){Assert-SkillPath $Destination $Destination|Out-Null}; $root=$Destination.TrimEnd('\')+'\'; $seen=@{}; $zip=[IO.Compression.ZipFile]::OpenRead($ArchivePath)
 try { foreach($e in $zip.Entries){$n=$e.FullName -replace '/','\'; $ext=[int]$e.ExternalAttributes; if([IO.Path]::IsPathRooted($n) -or $n -match '(^|\\)\.\.($|\\)' -or $n -match ':' -or (($ext -band 0xA0000000) -ne 0)){throw "Unsafe archive entry: $($e.FullName)"}; if($e.FullName -match '[\\/]$'){continue}; if($seen.ContainsKey($n.ToLowerInvariant())){throw "Duplicate archive entry: $n"}; $seen[$n.ToLowerInvariant()]=$true; $out=[IO.Path]::GetFullPath((Join-Path $Destination $n)); if(-not $out.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Archive entry escapes destination'} } } finally {$zip.Dispose()}
 New-Item -ItemType Directory -Force $Destination|Out-Null; try { $zip=[IO.Compression.ZipFile]::OpenRead($ArchivePath); try { foreach($e in $zip.Entries){$n=$e.FullName -replace '/','\'; if($e.FullName -match '[\\/]$'){continue}; $out=[IO.Path]::GetFullPath((Join-Path $Destination $n)); $parent=Split-Path $out -Parent; New-Item -ItemType Directory -Force $parent|Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($e,$out,$false) } } finally {$zip.Dispose()} }
 catch { Remove-Item $Destination -Recurse -Force -ErrorAction SilentlyContinue; throw }
 try { $skill=Join-Path $Destination 'SKILL.md'; if(-not (Test-Path $skill)){throw 'Archive missing SKILL.md'}; Test-SkillFrontmatter $skill|Out-Null; $tree=Get-ContentTreeHash $Destination; if($ExpectedTreeHash -and $tree -ne $ExpectedTreeHash.ToLowerInvariant()){throw 'Tree hash mismatch'}; return [pscustomobject]@{Destination=$Destination;TreeSha256=$tree;ArchiveSha256=(Get-FileSha256 $ArchivePath)} } catch { Remove-Item $Destination -Recurse -Force -ErrorAction SilentlyContinue; throw }
}
function Apply-SkillSourceCohort {
 param([Parameter(Mandatory)][string]$StagedPath,[Parameter(Mandatory)][string]$TargetPath,[Parameter(Mandatory)]$Baseline,[Parameter(Mandatory)]$Actual,[switch]$SignedCapabilityManifest)
 $StagedPath=[IO.Path]::GetFullPath($StagedPath); $TargetPath=[IO.Path]::GetFullPath($TargetPath); Assert-SkillPath $StagedPath $StagedPath|Out-Null; Assert-SkillPath ([IO.Path]::GetFullPath((Split-Path $TargetPath -Parent))) $TargetPath|Out-Null
 $cap=Get-SkillCapabilitySnapshot $StagedPath; $changed=(@($cap.scriptInventory)-join '|') -ne (@($Baseline.scriptInventory)-join '|'); if($changed){if(-not $SignedCapabilityManifest -or -not $Actual -or -not $Actual.scriptInventory){throw 'Executable/code changes require signed capability manifest'}; if((@($Actual.scriptInventory)-join '|') -ne (@($cap.scriptInventory)-join '|')){throw 'Capability manifest does not match actual'}}
 $backup=$TargetPath+'.backup-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'); $sibling=$TargetPath+'.staged-'+[guid]::NewGuid().ToString('N'); try { if(Test-Path $TargetPath){Copy-Item $TargetPath $backup -Recurse -Force}; Copy-Item $StagedPath $sibling -Recurse -Force; if(Test-Path $TargetPath){Remove-Item $TargetPath -Recurse -Force}; Move-Item $sibling $TargetPath; return [pscustomobject]@{Status='applied';Backup=$backup;Capability=$cap} } catch { Remove-Item $sibling -Recurse -Force -ErrorAction SilentlyContinue; if(Test-Path $backup){Remove-Item $backup -Recurse -Force -ErrorAction SilentlyContinue}; throw }
}
function Restore-SkillSourceCohort { param([Parameter(Mandatory)][string]$TargetPath,[Parameter(Mandatory)][string]$BackupPath) $TargetPath=[IO.Path]::GetFullPath($TargetPath); $BackupPath=[IO.Path]::GetFullPath($BackupPath); Assert-SkillPath (Split-Path $TargetPath -Parent) $TargetPath|Out-Null; Assert-SkillPath (Split-Path $BackupPath -Parent) $BackupPath|Out-Null; if(-not (Test-Path $BackupPath)){throw 'Backup missing'}; if(Test-Path $TargetPath){Remove-Item $TargetPath -Recurse -Force}; Move-Item $BackupPath $TargetPath; return [pscustomobject]@{Status='restored'} }
