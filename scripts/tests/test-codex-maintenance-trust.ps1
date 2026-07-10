$ErrorActionPreference='Stop'; . (Join-Path $PSScriptRoot '..\lib\codex-governance\Maintenance.Trust.ps1')
$allow=@{sources=@(@{sourceId='src';kind='git';uri='https://example.invalid/repo';refPolicy='pinned';cohort='stable';cliCompatibilityRange='>=1';sourceSha256='abc';capabilityBaseline=@{a=1}})}
$base=[pscustomobject]@{sourceId='src';kind='git';uri='https://example.invalid/repo';refPolicy='pinned';subpaths=@();validatorIds=@('v1');cohort='stable';cliCompatibilityRange='>=1';independent=$true;nativeToolPaths=@();capabilityBaseline=@{a=1};sourceSha256='abc'}
$ok=New-TrustedInventory $base $allow; if($ok.sourceId -ne 'src'){throw 'valid candidate rejected'}
try {$x=$base|Select-Object *; $x|Add-Member command 'bad'; New-TrustedInventory $x $allow|Out-Null; throw 'command accepted'} catch {if($_.Exception.Message -eq 'command accepted'){throw}}
try {$x=$base|Select-Object *; $x.refPolicy='moving'; New-TrustedInventory $x $allow|Out-Null; throw 'moving ref accepted'} catch {if($_.Exception.Message -eq 'moving ref accepted'){throw}}
Write-Output 'PASS: maintenance trust fake sandbox'
