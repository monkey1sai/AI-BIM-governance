$ErrorActionPreference='Stop'; . (Join-Path $PSScriptRoot '..\lib\codex-governance\Maintenance.Trust.ps1')
$root=Join-Path $env:TEMP ('trust-test-'+[guid]::NewGuid()); New-Item -ItemType Directory $root|Out-Null
try { $allow=@{sources=@(@{sourceId='src';kind='git';uri='https://example.invalid/repo';refPolicy='pinned';subpaths=@();validatorIds=@('v1');cohort='stable';cliCompatibilityRange='>=1';independent=$true;nativeToolPaths=@();capabilityBaseline=@{a=1}})}; $allowPath=Join-Path $root 'allow.json'; $seal=Join-Path $root 'allow.json.seal'; $allow|ConvertTo-Json -Depth 10|Set-Content $allowPath -Encoding utf8; Seal-Allowlist $allowPath $seal|Out-Null;kind='git';uri='https://example.invalid/repo';refPolicy='pinned';subpaths=@();validatorIds=@('v1');cohort='stable';cliRange='>=1';independent=$true;nativePaths=@('C:\tool');capabilityBaseline=@{a=1}}
 $bad=@(@{name='seal';value=($base|ConvertTo-Json|ConvertFrom-Json); mutate={param($x);$x.refPolicy='moving'}},@{name='command';value=(($base|ConvertTo-Json|ConvertFrom-Json));mutate={param($x);$x|Add-Member command 'Get-Process'}})
 foreach($c in $bad){$x=$c.value;& $c.mutate $x; try {New-TrustedInventory $x $allow|Out-Null; throw "RED case passed: $($c.name)"} catch {if($_.Exception.Message -like 'RED case passed*'){throw}}}
 Write-Output 'PASS: maintenance trust fake sandbox' } finally { Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }




