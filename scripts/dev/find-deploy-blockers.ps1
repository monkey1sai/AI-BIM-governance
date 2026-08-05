# Lists processes holding paths under the current platform's deploy target root
# (scripts/deploy-target-registry.json), plus the usual runtime suspects.
. (Join-Path $PSScriptRoot '..\lib\deploy-target-registry.ps1')
$deployRoot = [string](Get-DeployTargetForCurrentPlatform).deploy_root
$deployWildcard = Join-Path $deployRoot '*'
$procs = Get-Process | Where-Object { $_.Path -like $deployWildcard } | Select-Object Id, ProcessName, Path
if ($procs) { $procs | Format-Table -AutoSize -Wrap | Out-String -Width 200 } else { Write-Output "(no process with Path under $deployRoot)" }
$handles = @()
foreach ($p in (Get-Process python, kit, node, nvstreamer -ErrorAction SilentlyContinue)) {
  if ($p.Path) { $handles += [pscustomobject]@{ Id = $p.Id; Name = $p.ProcessName; Path = $p.Path } }
}
Write-Output "--- python/kit/node/nvstreamer with paths ---"
$handles | Format-Table -AutoSize -Wrap | Out-String -Width 200
