Set-StrictMode -Version Latest

function Get-PluginCandidate { param([Parameter(Mandatory)]$Candidate)
  if(-not $Candidate.sourceId -or -not $Candidate.uri){ throw 'Plugin candidate requires sourceId and uri' }
  if([string]$Candidate.ref -notmatch '^[0-9a-fA-F]{40}$'){ throw 'Marketplace ref must be a full 40-character SHA' }
  if([string]$Candidate.refPolicy -ne 'pinned'){ throw 'Moving-ref marketplace upgrades are not allowed' }
  return $Candidate
}

function Stage-PinnedMarketplace {
 param([Parameter(Mandatory)]$Candidate,[Parameter(Mandatory)][string]$CodexHome,[scriptblock]$MarketplaceAdd,[scriptblock]$ResolveHead)
 $c=Get-PluginCandidate $Candidate; if(-not [IO.Path]::IsPathRooted($CodexHome)){throw 'CodexHome must be absolute'}
 $stage=Join-Path ([IO.Path]::GetFullPath($CodexHome)) ('plugin-stage-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $stage -Force|Out-Null
 $envs=@{CODEX_HOME=$stage;HOME=$stage;USERPROFILE=$stage;XDG_CACHE_HOME=(Join-Path $stage 'cache');APPDATA=(Join-Path $stage 'appdata');LOCALAPPDATA=(Join-Path $stage 'localappdata')}; $envs.Values|ForEach-Object {New-Item -ItemType Directory -Path $_ -Force|Out-Null}
 $before=@($Candidate.enabledPlugins); if($MarketplaceAdd){ & $MarketplaceAdd $c.uri $c.ref $stage } else { throw 'MarketplaceAdd callback is required for offline-safe staging' }
 $head=if($ResolveHead){[string](& $ResolveHead $stage)}else{[string]$Candidate.resolvedHead}; if($head -notmatch '^[0-9a-fA-F]{40}$' -or $head.ToLowerInvariant() -ne $c.ref.ToLowerInvariant()){throw 'Staged marketplace HEAD mismatch'}
 [pscustomobject]@{Staging=$stage;Environment=$envs;ResolvedHead=$head;EnabledPlugins=$before;Candidate=$c}
}

function Get-PluginCapabilitySnapshot { param([Parameter(Mandatory)]$PluginState)
 $names='hooks','mcp','connectors','permissions','enabledPlugins'; $o=[ordered]@{}; foreach($n in $names){$o[$n]=@($PluginState.$n)}; return [pscustomobject]$o
}
function Test-DeterministicPluginRebind { param([Parameter(Mandatory)]$Baseline,[Parameter(Mandatory)]$Actual,[switch]$RollbackProbeAvailable)
 foreach($n in 'hooks','mcp','connectors','permissions'){ $b=@($Baseline.$n);$a=@($Actual.$n); if(@($a|Where-Object {$_ -notin $b}).Count){throw "Plugin capability expansion blocked: $n"} }
 $disabled=@($Baseline.enabledPlugins|Where-Object {$_ -is [object] -and $_.enabled -eq $false}|ForEach-Object name); $enabled=@($Actual.enabledPlugins|Where-Object {$_.enabled -eq $true}|ForEach-Object name); if(@($enabled|Where-Object {$_ -in $disabled}).Count){throw 'Disabled plugin enablement blocked'}
 if(-not $RollbackProbeAvailable){throw 'Rollback probe unavailable'}; return [pscustomobject]@{Status='pass';Deterministic=$true}
}
function Apply-PluginCohort { param([Parameter(Mandatory)]$Stage,[Parameter(Mandatory)]$Baseline,[Parameter(Mandatory)]$Actual,[switch]$RollbackProbeAvailable)
 Test-DeterministicPluginRebind $Baseline $Actual -RollbackProbeAvailable:$RollbackProbeAvailable | Out-Null; return [pscustomobject]@{Status='applied';Staging=$Stage.Staging;Snapshot=$Baseline}
}
function Restore-PluginCohort { param([Parameter(Mandatory)]$Transaction,[scriptblock]$Restore)
 if($Restore){& $Restore $Transaction.Snapshot}; return [pscustomobject]@{Status='restored'}
}
