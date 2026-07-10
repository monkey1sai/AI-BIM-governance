$ErrorActionPreference='Stop'; . (Join-Path $PSScriptRoot '..\lib\codex-governance\Maintenance.Common.ps1'); . (Join-Path $PSScriptRoot '..\lib\codex-governance\Maintenance.Skill.ps1')
$tmp=Join-Path ([IO.Path]::GetTempPath()) ('skill-test-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $tmp|Out-Null
try {
 $src=Join-Path $tmp 'src'; New-Item -ItemType Directory $src|Out-Null; @"
---
name: fake
description: offline fixture
license: MIT
provenance: test-fixture
---
# Fake
"@ | Set-Content (Join-Path $src 'SKILL.md')
 $zip=Join-Path $tmp 'fake.zip'; [IO.Compression.ZipFile]::CreateFromDirectory($src,$zip); $sha=Get-FileHash $zip -Algorithm SHA256|% Hash; $stage=Join-Path $tmp 'stage'; Stage-PinnedSkillSource $zip $sha $stage|Out-Null; $expanded=Join-Path $tmp 'expanded'; Expand-ValidatedArchive $zip $expanded|Out-Null
 $inv=Get-SkillInventory $tmp @() @(); if(@($inv).Count -lt 1){throw 'inventory failed'}; $snap=Get-SkillCapabilitySnapshot $expanded; if(@($snap.scriptInventory).Count -ne 0){throw 'unexpected script'}
 try { $bad=Join-Path $tmp 'bad.zip'; $z=[IO.Compression.ZipFile]::Open($bad,[IO.Compression.ZipArchiveMode]::Create); $e=$z.CreateEntry('../escape.txt'); $z.Dispose(); Expand-ValidatedArchive $bad (Join-Path $tmp 'badout')|Out-Null; throw 'parent entry accepted' } catch {if($_.Exception.Message -eq 'parent entry accepted'){throw}}
 Write-Output 'PASS: maintenance skill offline fixtures'
} finally {Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue}
