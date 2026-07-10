Set-StrictMode -Version Latest

function ConvertTo-CanonicalObject {
 param([Parameter(Mandatory)]$InputObject)
 if($null -eq $InputObject){ return $null }
 if($InputObject -is [System.Collections.IDictionary]) { $o=[ordered]@{}; foreach($k in ($InputObject.Keys|Sort-Object {[string]$_})){ $o[[string]$k]=ConvertTo-CanonicalObject $InputObject[$k] }; return $o }
 if($InputObject -is [System.Collections.IEnumerable] -and $InputObject -isnot [string]) { return @($InputObject|ForEach-Object { ConvertTo-CanonicalObject $_ }) }
 if(@($InputObject.PSObject.Properties).Count -gt 0 -and $InputObject -isnot [ValueType] -and $InputObject -isnot [string]) { $o=[ordered]@{}; foreach($p in ($InputObject.PSObject.Properties|Sort-Object Name)){ $o[$p.Name]=ConvertTo-CanonicalObject $p.Value }; return $o }
 return $InputObject
}
function Get-CanonicalJsonBytes {
 param([Parameter(Mandatory)]$InputObject)
 $json=(ConvertTo-CanonicalObject $InputObject)|ConvertTo-Json -Depth 50 -Compress
 return (New-Object Text.UTF8Encoding($false)).GetBytes($json)
}
function Seal-Allowlist {
 param([Parameter(Mandatory)][string]$AllowlistPath,[Parameter(Mandatory)][string]$SealPath)
 $obj=Get-Content -LiteralPath $AllowlistPath -Raw|ConvertFrom-Json
 $bytes=Get-CanonicalJsonBytes $obj
 $tmp=$null;$sealTmp=$null;$canonTmp=$null
 try { $tmp=$AllowlistPath+'.'+[guid]::NewGuid().ToString('N')+'.tmp'; $sealTmp=$SealPath+'.'+[guid]::NewGuid().ToString('N')+'.tmp'; $canonTmp=$AllowlistPath+'.canonical.tmp'; [IO.File]::WriteAllBytes($tmp,$bytes); $hash=([Security.Cryptography.SHA256]::Create()).ComputeHash($bytes); $seal=([BitConverter]::ToString($hash)-replace '-','').ToLowerInvariant(); [IO.File]::WriteAllText($sealTmp,$seal,(New-Object Text.UTF8Encoding($false))); Move-Item $tmp $AllowlistPath -Force; Move-Item $sealTmp $SealPath -Force } finally { if($tmp){Remove-Item $tmp -Force -ErrorAction SilentlyContinue}; if($sealTmp){Remove-Item $sealTmp -Force -ErrorAction SilentlyContinue}; if($canonTmp){Remove-Item $canonTmp -Force -ErrorAction SilentlyContinue} }
 return $seal
}
function Test-AllowlistOwnerAcl {
 param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][ValidatePattern('^S-\d-\d+(-\d+)+$')][string]$ExpectedOwnerSid)
 if(-not (Test-Path -LiteralPath $Path)){ throw "Allowlist missing: $Path" }
 $acl=Get-Acl -LiteralPath $Path
 if(([string]$acl.Owner) -notmatch [regex]::Escape($ExpectedOwnerSid)){ throw "Allowlist owner mismatch" }
 foreach($r in $acl.Access){ if($r.AccessControlType -eq 'Allow' -and ([string]$r.IdentityReference -notmatch [regex]::Escape($ExpectedOwnerSid))){ throw "Allowlist ACL grants unexpected principal" } }
 return $true
}
function Read-SealedAllowlist {
 param([Parameter(Mandatory)][string]$AllowlistPath,[Parameter(Mandatory)][string]$SealPath,[Parameter(Mandatory)][string]$ExpectedOwnerSid)
 Test-AllowlistOwnerAcl -Path $AllowlistPath -ExpectedOwnerSid $ExpectedOwnerSid | Out-Null; Test-AllowlistOwnerAcl -Path $SealPath -ExpectedOwnerSid $ExpectedOwnerSid | Out-Null
 $obj=Get-Content $AllowlistPath -Raw|ConvertFrom-Json; $actual=([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash((Get-CanonicalJsonBytes $obj)))-replace '-','').ToLowerInvariant(); $expected=(Get-Content $SealPath -Raw).Trim(); if($actual -ne $expected){throw 'Allowlist seal mismatch'}; return $obj
}
function Compare-CapabilityBaseline { param([Parameter(Mandatory)]$Expected,[Parameter(Mandatory)]$Actual); if((ConvertTo-CanonicalObject $Expected|ConvertTo-Json -Compress) -ne (ConvertTo-CanonicalObject $Actual|ConvertTo-Json -Compress)){throw 'Capability baseline mismatch'}; return $true }
function New-TrustedInventory {
 param([Parameter(Mandatory)]$Candidate,[Parameter(Mandatory)]$Allowlist)
 $required='sourceId','kind','uri','refPolicy','subpaths','validatorIds','cohort','cliCompatibilityRange','independent','capabilityBaseline','nativeToolPaths'; $allowed=$required+'sourceSha256'; $names=@($Candidate.PSObject.Properties.Name); if(@($required|Where-Object {$_ -notin $names})){throw 'Missing required field'}; if(@($names|Where-Object {$_ -notin $allowed})){throw 'Unknown field'}
 $source=@($Allowlist.sources|Where-Object {$_.sourceId -eq $Candidate.sourceId})|Select-Object -First 1; if(-not $source){throw 'Unknown source'}
 foreach($p in 'kind','uri','refPolicy','cohort','cliCompatibilityRange'){if([string]$Candidate.$p -ne [string]$source.$p){throw "Source $p mismatch"}}
 if($Candidate.refPolicy -ne 'pinned'){throw 'Moving refs are not allowed'}; if($Candidate.sourceSha256 -and $Candidate.sourceSha256 -ne $source.sourceSha256){throw 'Source SHA mismatch'}; if((ConvertTo-CanonicalObject $Candidate.capabilityBaseline|ConvertTo-Json -Compress) -ne (ConvertTo-CanonicalObject $source.capabilityBaseline|ConvertTo-Json -Compress)){throw 'Capability baseline mismatch'}; if(-not $Candidate.independent -or -not @($Candidate.validatorIds).Count -or (@($Candidate.validatorIds)|Where-Object {$_ -notmatch '^[A-Za-z0-9._:-]+$'})){throw 'Invalid validator IDs or independence'}
 return $Candidate
}
