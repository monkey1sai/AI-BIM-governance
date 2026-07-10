. "$PSScriptRoot/test-helpers.ps1"
. "$PSScriptRoot/../lib/codex-governance/Maintenance.Common.ps1"
$root = New-TestSandbox 'codex-common'
try {
  $inside = Resolve-ContainedPath -Root $root -Path (Join-Path $root 'a/b')
  Assert-True ($inside.StartsWith([IO.Path]::GetFullPath($root))) 'contained path'
  Assert-Throws { Resolve-ContainedPath -Root $root -Path (Join-Path $root '..\escape') } 'traversal rejected'
  Assert-Throws { Resolve-ContainedPath -Root $root -Path 'C:\Windows\system32' } 'rooted escape rejected'
  $json = Join-Path $root 'x.json'; Write-AtomicJson -Path $json -InputObject @{a=1}
  Assert-Equal 1 ((Get-Content $json -Raw | ConvertFrom-Json).a) 'atomic json'
  Set-Content (Join-Path $root 'one.txt') 'hello'; $h1=Get-ContentTreeHash -Root $root
  Set-Content (Join-Path $root 'one.txt') 'world'; $h2=Get-ContentTreeHash -Root $root
  Assert-True ($h1 -ne $h2) 'tree hash changes'
  $junctionTarget = New-TestSandbox 'codex-common-target'
  $junctionRoot = Join-Path $root 'junction-root'
  New-Item -ItemType Junction -Path $junctionRoot -Target $junctionTarget -Force | Out-Null
  Assert-Throws { Get-ContentTreeHash -Root $junctionRoot } 'reparse root rejected'
  Remove-TestSandbox $junctionTarget
  Write-TestPass 'maintenance common'
} finally { Remove-TestSandbox $root }
