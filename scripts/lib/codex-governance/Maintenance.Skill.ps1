Set-StrictMode -Version Latest

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
 $actual=Get-FileSha256 $ArchivePath; if($actual -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source/archive hash mismatch'}
 New-Item -ItemType Directory -Force -Path $StageRoot|Out-Null; $copy=Join-Path $StageRoot ([IO.Path]::GetFileName($ArchivePath)); Copy-Item $ArchivePath $copy -Force
 return [pscustomobject]@{ArchivePath=$copy;ArchiveSha256=$actual;StageRoot=$StageRoot}
}
function Expand-ValidatedArchive {
 param([Parameter(Mandatory)][string]$ArchivePath,[Parameter(Mandatory)][string]$Destination,[string]$ExpectedTreeHash)
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 New-Item -ItemType Directory -Force $Destination|Out-Null; $root=[IO.Path]::GetFullPath($Destination).TrimEnd('\')+'\'; $seen=@{}
 $zip=[IO.Compression.ZipFile]::OpenRead($ArchivePath); try { foreach($e in $zip.Entries){$n=$e.FullName -replace '/','\'; if([IO.Path]::IsPathRooted($n) -or $n -match '(^|\\)\.\.($|\\)' -or $n -match ':'){throw "Unsafe archive entry: $($e.FullName)"}; if($e.FullName -match '[\\/]$'){continue}; if($seen.ContainsKey($n.ToLowerInvariant())){throw "Duplicate archive entry: $n"}; $seen[$n.ToLowerInvariant()]=$true; $out=[IO.Path]::GetFullPath((Join-Path $Destination $n)); if(-not $out.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Archive entry escapes destination'}; $parent=Split-Path $out -Parent; New-Item -ItemType Directory -Force $parent|Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($e,$out,$false) } } finally {$zip.Dispose()}
 $skill=Join-Path $Destination 'SKILL.md'; if(-not (Test-Path $skill)){throw 'Archive missing SKILL.md'}; Test-SkillFrontmatter $skill|Out-Null; $tree=Get-ContentTreeHash $Destination; if($ExpectedTreeHash -and $tree -ne $ExpectedTreeHash.ToLowerInvariant()){throw 'Tree hash mismatch'}; return [pscustomobject]@{Destination=$Destination;TreeSha256=$tree;ArchiveSha256=(Get-FileSha256 $ArchivePath)}
}
function Apply-SkillSourceCohort {
 param([Parameter(Mandatory)][string]$StagedPath,[Parameter(Mandatory)][string]$TargetPath,[Parameter(Mandatory)]$Baseline,[Parameter(Mandatory)]$Actual,[switch]$SignedCapabilityManifest)
 $cap=Get-SkillCapabilitySnapshot $StagedPath; $changed=(@($cap.scriptInventory)-join '|') -ne (@($Baseline.scriptInventory)-join '|'); if($changed -and -not $SignedCapabilityManifest){throw 'Executable/code changes require signed capability manifest'}; Compare-Object ($Baseline|ConvertTo-Json -Compress) ($cap|ConvertTo-Json -Compress)|Out-Null
 $backup=$TargetPath+'.backup-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'); if(Test-Path $TargetPath){Copy-Item $TargetPath $backup -Recurse -Force}; $sibling=$TargetPath+'.staged-'+[guid]::NewGuid().ToString('N'); Copy-Item $StagedPath $sibling -Recurse -Force; if(Test-Path $TargetPath){Remove-Item $TargetPath -Recurse -Force}; Move-Item $sibling $TargetPath; return [pscustomobject]@{Status='applied';Backup=$backup;Capability=$cap}
}
function Restore-SkillSourceCohort { param([Parameter(Mandatory)][string]$TargetPath,[Parameter(Mandatory)][string]$BackupPath) if(-not (Test-Path $BackupPath)){throw 'Backup missing'}; if(Test-Path $TargetPath){Remove-Item $TargetPath -Recurse -Force}; Move-Item $BackupPath $TargetPath; return [pscustomobject]@{Status='restored'} }
