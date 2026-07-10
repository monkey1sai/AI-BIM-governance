Set-StrictMode -Version Latest
function Resolve-ContainedPath {
 param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$Path)
 $r=[IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)+'\'
 $p=[IO.Path]::GetFullPath($Path)
 if($p -ne $r.TrimEnd('\') -and -not $p.StartsWith($r,[StringComparison]::OrdinalIgnoreCase)){ throw "Path escapes root: $Path" }
 return $p
}
function Write-AtomicJson {
 param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)]$InputObject)
 $dir=Split-Path -Parent $Path; New-Item -ItemType Directory -Force $dir | Out-Null
 $tmp=Join-Path $dir ('.'+[IO.Path]::GetFileName($Path)+'.'+[guid]::NewGuid().ToString('N')+'.tmp')
 try { $json=$InputObject|ConvertTo-Json -Depth 20; [IO.File]::WriteAllText($tmp,$json,(New-Object Text.UTF8Encoding($false))); if(Test-Path $Path){$bak=$Path+'.bak'; [IO.File]::Replace($tmp,$Path,$bak); Remove-Item $bak -Force -ErrorAction SilentlyContinue}else{[IO.File]::Move($tmp,$Path)} } finally { if(Test-Path $tmp){Remove-Item $tmp -Force -ErrorAction SilentlyContinue} }
}
function Get-ContentTreeHash {
 param([Parameter(Mandatory)][string]$Root)
 $sha=[Security.Cryptography.SHA256]::Create(); $bytes=New-Object IO.MemoryStream
 try { Get-ChildItem -LiteralPath $Root -File -Recurse | Sort-Object FullName | ForEach-Object { $rel=$_.FullName.Substring(([IO.Path]::GetFullPath($Root)).Length); $b=[Text.Encoding]::UTF8.GetBytes($rel+'`n');$bytes.Write($b,0,$b.Length);$fb=[IO.File]::ReadAllBytes($_.FullName);$bytes.Write($fb,0,$fb.Length) }; return ([BitConverter]::ToString($sha.ComputeHash($bytes.ToArray())) -replace '-','').ToLowerInvariant() } finally {$bytes.Dispose();$sha.Dispose()}
}
