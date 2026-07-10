. "$PSScriptRoot/test-helpers.ps1"; . "$PSScriptRoot/../lib/codex-governance/Maintenance.Plugin.ps1"
$root=New-TestSandbox 'plugin'; try {
 $sha='0123456789abcdef0123456789abcdef01234567'; $pwsh=(Get-Command pwsh).Source
 $runner=Join-Path $root 'marketplace.ps1'; @'
param([string]$RequestFile,[string]$ResultFile)
$r=Get-Content -Raw $RequestFile|ConvertFrom-Json
if($env:CODEX_HOME -ne $r.stagedRepo -or $env:HOME -ne $r.stagedRepo){ exit 7 }
Set-Content (Join-Path $r.stagedRepo 'HEAD') $r.ref
@{status='ok';stagedRepo=$r.stagedRepo;sourceId=$r.sourceId;ref=$r.ref}|ConvertTo-Json|Set-Content $ResultFile
'@ | Set-Content $runner
 $git=Join-Path $root 'git.cmd'; [IO.File]::WriteAllText($git, "@echo off`r`ntype `"%2\\HEAD`"")
 $c=[pscustomobject]@{sourceId='demo';uri='fake://market';ref=$sha;refPolicy='pinned';enabledPlugins=@([pscustomobject]@{name='old';enabled=$false})}
 Assert-Throws {Get-PluginCandidate ([pscustomobject]@{sourceId='x';uri='u';ref='abc';refPolicy='pinned'})} 'reject short ref'
 $st=Stage-PinnedMarketplace $c $root -PwshExecutable $pwsh -MarketplaceScript $runner -GitExecutable $git; Assert-Equal $sha $st.ResolvedHead 'staged sha'; Assert-Equal $st.Staging $st.Environment.CODEX_HOME 'isolated env'
 $bad=Join-Path $root 'bad.ps1'; @'
param([string]$RequestFile,[string]$ResultFile)
$r=Get-Content -Raw $RequestFile|ConvertFrom-Json; Set-Content (Join-Path $r.stagedRepo 'HEAD') ('f'*40); @{status='ok';stagedRepo=$r.stagedRepo}|ConvertTo-Json|Set-Content $ResultFile
'@ | Set-Content $bad
 Assert-Throws {Stage-PinnedMarketplace $c $root -PwshExecutable $pwsh -MarketplaceScript $bad -GitExecutable $git} 'head mismatch'
 $badResult=Join-Path $root 'bad-result.ps1'; @'
param([string]$RequestFile,[string]$ResultFile)
$r=Get-Content -Raw $RequestFile|ConvertFrom-Json; @{status='ok';stagedRepo=(Join-Path $r.stagedRepo 'other');sourceId='wrong';ref=$r.ref}|ConvertTo-Json|Set-Content $ResultFile
'@ | Set-Content $badResult
 Assert-Throws {Stage-PinnedMarketplace $c $root -PwshExecutable $pwsh -MarketplaceScript $badResult -GitExecutable $git} 'result identity mismatch'
 $b=Get-PluginCapabilitySnapshot ([pscustomobject]@{hooks=@('h');mcp=@('m');connectors=@('c');permissions=@('p');enabledPlugins=$c.enabledPlugins}); $calls=[hashtable]::Synchronized(@{apply=0;restore=0})
 $r=Apply-PluginCohort $st $b $b -RollbackProbeAvailable -Apply {param($x) $calls.apply++}; Assert-Equal 1 $calls.apply 'apply callback'; Assert-Throws {Apply-PluginCohort $st $b $b -RollbackProbeAvailable} 'apply required'
 Restore-PluginCohort $r -Restore {param($x) $calls.restore++}|Out-Null; Assert-Equal 1 $calls.restore 'restore callback'; Assert-Throws {Restore-PluginCohort $r} 'restore required'
 Assert-Throws {Stage-PinnedMarketplace $c $root -PwshExecutable $pwsh -MarketplaceScript $runner -GitExecutable (Join-Path $root 'missing.cmd')} 'disabled state'
 Write-TestPass 'maintenance plugin'
} finally {Remove-TestSandbox $root}
