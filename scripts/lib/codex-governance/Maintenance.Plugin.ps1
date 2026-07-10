Set-StrictMode -Version Latest

function Get-PluginCandidate { param([Parameter(Mandatory)]$Candidate)
  if(-not $Candidate.sourceId -or -not $Candidate.uri){ throw 'Plugin candidate requires sourceId and uri' }
  if([string]$Candidate.ref -notmatch '^[0-9a-fA-F]{40}$'){ throw 'Marketplace ref must be a full 40-character SHA' }
  if([string]$Candidate.refPolicy -ne 'pinned'){ throw 'Moving-ref marketplace upgrades are not allowed' }
  return $Candidate
}

function Stage-PinnedMarketplace {
 param([Parameter(Mandatory)]$Candidate,[Parameter(Mandatory)][string]$CodexHome,[Parameter(Mandatory)][string]$PwshExecutable,[Parameter(Mandatory)][string]$MarketplaceScript,[string]$GitExecutable='git')
 $c=Get-PluginCandidate $Candidate; if(-not [IO.Path]::IsPathRooted($CodexHome)){throw 'CodexHome must be absolute'}
 if($PSVersionTable.PSVersion.Major -lt 7){throw 'PowerShell 7 or newer is required for child process execution'}
 if(-not [IO.Path]::IsPathRooted($PwshExecutable) -or -not (Test-Path -LiteralPath $PwshExecutable)){throw 'PwshExecutable must be an existing absolute path'}
 if(-not [IO.Path]::IsPathRooted($MarketplaceScript) -or -not (Test-Path -LiteralPath $MarketplaceScript)){throw 'MarketplaceScript must be an existing absolute path'}
 $stage=Join-Path ([IO.Path]::GetFullPath($CodexHome)) ('plugin-stage-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $stage -Force|Out-Null
 $envs=@{CODEX_HOME=$stage;HOME=$stage;USERPROFILE=$stage;XDG_CACHE_HOME=(Join-Path $stage 'cache');APPDATA=(Join-Path $stage 'appdata');LOCALAPPDATA=(Join-Path $stage 'localappdata')}; $envs.Values|ForEach-Object {New-Item -ItemType Directory -Path $_ -Force|Out-Null}
 $request=Join-Path $stage 'marketplace-request.json'; $result=Join-Path $stage 'marketplace-result.json'; [ordered]@{sourceId=$c.sourceId;uri=$c.uri;ref=$c.ref;refPolicy=$c.refPolicy;stagedRepo=$stage}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $request -Encoding UTF8
 $psi=[Diagnostics.ProcessStartInfo]::new(); $psi.FileName=$PwshExecutable; $psi.WorkingDirectory=$stage; $psi.UseShellExecute=$false; $psi.RedirectStandardOutput=$false; $psi.RedirectStandardError=$false; @('-NoProfile','-NonInteractive','-File',$MarketplaceScript,'-RequestFile',$request,'-ResultFile',$result)|ForEach-Object {[void]$psi.ArgumentList.Add($_)}; $psi.Environment.Clear(); foreach($e in $envs.GetEnumerator()){$psi.Environment[$e.Key]=$e.Value}; $pathDirs=@([IO.Path]::GetDirectoryName($PwshExecutable),[IO.Path]::GetDirectoryName($GitExecutable)); $psi.Environment['PATH']=(($pathDirs|Where-Object {$_}|Select-Object -Unique)-join [IO.Path]::PathSeparator); $p=[Diagnostics.Process]::Start($psi); $p.WaitForExit(); if($p.ExitCode -ne 0){throw "Marketplace child failed (exit $($p.ExitCode))"}; if(-not (Test-Path $result)){throw 'Marketplace child did not produce result JSON'}; $child=Get-Content -Raw $result|ConvertFrom-Json; if([string]$child.status -ne 'ok' -or [IO.Path]::GetFullPath([string]$child.stagedRepo) -ne [IO.Path]::GetFullPath($stage) -or [string]$child.sourceId -ne [string]$c.sourceId -or [string]$child.ref -ne [string]$c.ref){throw 'Marketplace child result is invalid'}
 $before=@($Candidate.enabledPlugins); $head=[string](& $GitExecutable -C $stage rev-parse HEAD 2>$null).Trim(); if($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-fA-F]{40}$' -or $head.ToLowerInvariant() -ne $c.ref.ToLowerInvariant()){throw 'Staged marketplace HEAD mismatch'}
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
function Apply-PluginCohort { param([Parameter(Mandatory)]$Stage,[Parameter(Mandatory)]$Baseline,[Parameter(Mandatory)]$Actual,[Parameter(Mandatory)][scriptblock]$Apply,[switch]$RollbackProbeAvailable)
 Test-DeterministicPluginRebind $Baseline $Actual -RollbackProbeAvailable:$RollbackProbeAvailable | Out-Null
 & $Apply $Stage; return [pscustomobject]@{Status='applied';Staging=$Stage.Staging;Snapshot=$Baseline}
}
function Restore-PluginCohort { param([Parameter(Mandatory)]$Transaction,[Parameter(Mandatory)][scriptblock]$Restore)
 & $Restore $Transaction.Snapshot; return [pscustomobject]@{Status='restored'}
}
