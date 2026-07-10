Set-StrictMode -Version Latest
function Resolve-ContainedPath {
 param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$Path)
 $r=[IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)+'\'
 $p=[IO.Path]::GetFullPath($Path)
 if($p -ne $r.TrimEnd('\') -and -not $p.StartsWith($r,[StringComparison]::OrdinalIgnoreCase)){ throw "Path escapes root: $Path" }
 $item=Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
 if($item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){ throw "Reparse point not allowed: $Path" }
 $cursor=$p; while($cursor -and $cursor.StartsWith($r,[StringComparison]::OrdinalIgnoreCase)){ $node=Get-Item -LiteralPath $cursor -Force -ErrorAction SilentlyContinue; if($node -and (($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw "Reparse parent not allowed: $cursor"}; $next=Split-Path $cursor -Parent; if($next -eq $cursor){break}; $cursor=$next }
 return $p
}
function Write-AtomicJson {
 param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)]$InputObject,[string]$Root)
 if($Root){ Resolve-ContainedPath -Root $Root -Path $Path | Out-Null }
 $dir=Split-Path -Parent $Path; New-Item -ItemType Directory -Force $dir | Out-Null
 $tmp=Join-Path $dir ('.'+[IO.Path]::GetFileName($Path)+'.'+[guid]::NewGuid().ToString('N')+'.tmp')
 try { $json=$InputObject|ConvertTo-Json -Depth 20; $fs=[IO.File]::Open($tmp,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None); try {$b=(New-Object Text.UTF8Encoding($false)).GetBytes($json);$fs.Write($b,0,$b.Length);$fs.Flush($true)} finally {$fs.Dispose()}; if(Test-Path $Path){$bak=$Path+'.bak'; [IO.File]::Replace($tmp,$Path,$bak); Remove-Item $bak -Force -ErrorAction SilentlyContinue}else{[IO.File]::Move($tmp,$Path)} } finally { if(Test-Path $tmp){Remove-Item $tmp -Force -ErrorAction SilentlyContinue} }
}
function Get-ContentTreeHash {
 param([Parameter(Mandatory)][string]$Root)
 $rootItem=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
 if(($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){ throw "Reparse point not allowed: $Root" }
 $sha=[Security.Cryptography.SHA256]::Create(); $bytes=New-Object IO.MemoryStream
 try { $files=New-Object Collections.Generic.List[object]; $stack=New-Object Collections.Generic.Stack[string]; $stack.Push([IO.Path]::GetFullPath($Root)); while($stack.Count){$dir=$stack.Pop(); foreach($d in (Get-ChildItem -LiteralPath $dir -Directory -Force)){if(($d.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw "Reparse directory not allowed: $($d.FullName)"};$stack.Push($d.FullName)}; foreach($f in (Get-ChildItem -LiteralPath $dir -File -Force)){if($f.Name -notin @('maintenance.lock','maintenance-journal.json') -and $f.Name -notlike '*.tmp' -and (($f.Attributes -band [IO.FileAttributes]::ReparsePoint)-eq 0)){$files.Add($f)}} }; foreach($f in ($files|Sort-Object FullName)){ $rel=$f.FullName.Substring(([IO.Path]::GetFullPath($Root)).Length); $b=[Text.Encoding]::UTF8.GetBytes($rel+"`n");$bytes.Write($b,0,$b.Length);$fb=[IO.File]::ReadAllBytes($f.FullName);$bytes.Write($fb,0,$fb.Length) }; return ([BitConverter]::ToString($sha.ComputeHash($bytes.ToArray())) -replace '-','').ToLowerInvariant() } finally {$bytes.Dispose();$sha.Dispose()}
}
