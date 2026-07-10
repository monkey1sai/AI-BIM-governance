. "$PSScriptRoot/test-helpers.ps1"; . "$PSScriptRoot/../lib/codex-governance/Maintenance.Plugin.ps1"
$root=New-TestSandbox 'plugin'; try {
 $sha='0123456789abcdef0123456789abcdef01234567'; $c=[pscustomobject]@{sourceId='demo';uri='fake://market';ref=$sha;refPolicy='pinned';enabledPlugins=@([pscustomobject]@{name='old';enabled=$false})}
 Assert-Throws {Get-PluginCandidate ([pscustomobject]@{sourceId='x';uri='u';ref='abc';refPolicy='pinned'})} 'reject short ref'
 $st=Stage-PinnedMarketplace $c $root -MarketplaceAdd {param($u,$r,$s) Set-Content (Join-Path $s 'HEAD') $r} -ResolveHead {param($s) Get-Content (Join-Path $s 'HEAD')}; Assert-Equal $sha $st.ResolvedHead 'staged sha'
 Assert-Throws {Stage-PinnedMarketplace $c $root -MarketplaceAdd {param($u,$r,$s) } -ResolveHead { 'ffffffffffffffffffffffffffffffffffffffff' }} 'head mismatch'
 $b=Get-PluginCapabilitySnapshot ([pscustomobject]@{hooks=@('h');mcp=@('m');connectors=@('c');permissions=@('p');enabledPlugins=$c.enabledPlugins})
 $a=Get-PluginCapabilitySnapshot ([pscustomobject]@{hooks=@('h','new');mcp=@('m');connectors=@('c');permissions=@('p');enabledPlugins=$c.enabledPlugins}); Assert-Throws {Test-DeterministicPluginRebind $b $a -RollbackProbeAvailable} 'hook expansion'
 $a=Get-PluginCapabilitySnapshot ([pscustomobject]@{hooks=@('h');mcp=@('m');connectors=@('c');permissions=@('p');enabledPlugins=@([pscustomobject]@{name='old';enabled=$true})}); Assert-Throws {Test-DeterministicPluginRebind $b $a -RollbackProbeAvailable} 'disabled enablement'; Assert-Throws {Test-DeterministicPluginRebind $b $b} 'rollback unavailable'
 $r=Apply-PluginCohort $st $b $b -RollbackProbeAvailable; Assert-Equal 'applied' $r.Status 'apply'; Write-TestPass 'maintenance plugin'
} finally {Remove-TestSandbox $root}
