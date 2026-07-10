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
 $tmp=$SealPath+'.'+[guid]::NewGuid().ToString('N')+'.tmp'; [IO.File]::WriteAllBytes($tmp,$bytes)
 try { $hash=([Security.Cryptography.SHA256]::Create()).ComputeHash($bytes); $seal=([BitConverter]::ToString($hash)-replace '-','').ToLowerInvariant(); $sealTmp="$tmp.seal"; [IO.File]::WriteAllText($sealTmp,$seal,(New-Object Text.UTF8Encoding($false))); $canonTmp="$AllowlistPath.canonical.tmp"; Move-Item $tmp $canonTmp -Force; Move-Item $sealTmp $SealPath -Force; Move-Item $canonTmp $AllowlistPath -Force } finally { Remove-Item $tmp,$sealTmp,$canonTmp -Force -ErrorAction SilentlyContinue }
 return $seal
}
function Test-AllowlistOwnerAcl {
 param([Parameter(Mandatory)][string]$Path,[string]$ExpectedOwnerSid)
 if(-not (Test-Path -LiteralPath $Path)){ throw "Allowlist missing: $Path" }
 $acl=Get-Acl -LiteralPath $Path
 if($ExpectedOwnerSid -and ([string]$acl.Owner -notmatch [regex]::Escape($ExpectedOwnerSid))){ throw "Allowlist owner mismatch" }
 if($ExpectedOwnerSid){ foreach($r in $acl.Access){ if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference -notmatch '^(BUILTIN\\Administrators|NT AUTHORITY\\SYSTEM|'+[regex]::Escape($ExpectedOwnerSid)+')$'){ throw "Allowlist ACL grants unexpected principal" } } }
 return $true
}
function Read-SealedAllowlist {
 param([Parameter(Mandatory)][string]$AllowlistPath,[Parameter(Mandatory)][string]$SealPath,[string]$ExpectedOwnerSid)
 Test-AllowlistOwnerAcl -Path $AllowlistPath -ExpectedOwnerSid $ExpectedOwnerSid | Out-Null; Test-AllowlistOwnerAcl -Path $SealPath -ExpectedOwnerSid $ExpectedOwnerSid | Out-Null
 $obj=Get-Content $AllowlistPath -Raw|ConvertFrom-Json; $actual=([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash((Get-CanonicalJsonBytes $obj)))-replace '-','').ToLowerInvariant(); $expected=(Get-Content $SealPath -Raw).Trim(); if($actual -ne $expected){throw 'Allowlist seal mismatch'}; return $obj
}
function Compare-CapabilityBaseline { param([Parameter(Mandatory)]$Expected,[Parameter(Mandatory)]$Actual); if((ConvertTo-CanonicalObject $Expected|ConvertTo-Json -Compress) -ne (ConvertTo-CanonicalObject $Actual|ConvertTo-Json -Compress)){throw 'Capability baseline mismatch'}; return $true }
function New-TrustedInventory {
 param([Parameter(Mandatory)]$Candidate,[Parameter(Mandatory)]$Allowlist)
 if($Candidate.PSObject.Properties.Name -contains 'command'){throw 'Command fields are not allowed'}
 $source=@($Allowlist.sources|Where-Object {$_.id -eq $Candidate.sourceId})|Select-Object -First 1; if(-not $source){throw 'Unknown source'}
 if($Candidate.refPolicy -eq 'moving'){throw 'Moving refs are not allowed'}
 if(-not $Candidate.validatorIds -or @($Candidate.validatorIds).Count -eq 0 -or (@($Candidate.validatorIds)|Where-Object {$_ -notmatch '^[A-Za-z0-9._:-]+$'})){throw 'Invalid validator ID'}
 foreach($p in 'sourceId','kind','uri','refPolicy','validatorIds','cohort','cliRange','independent','nativePaths'){if(-not ($Candidate.PSObject.Properties.Name -contains $p)){throw "Missing field: $p"}}
 return [pscustomobject]@{sourceId=$Candidate.sourceId;kind=$Candidate.kind;uri=$Candidate.uri;refPolicy=$Candidate.refPolicy;subpaths=@($Candidate.subpaths);validatorIds=@($Candidate.validatorIds);cohort=$Candidate.cohort;cliRange=$Candidate.cliRange;independent=[bool]$Candidate.independent;nativePaths=@($Candidate.nativePaths);capabilityBaseline=$Candidate.capabilityBaseline}
}
