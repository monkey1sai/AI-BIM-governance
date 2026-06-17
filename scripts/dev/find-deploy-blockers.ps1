$procs = Get-Process | Where-Object { $_.Path -like 'D:\Users\deploy\AI-bim-geo\*' } | Select-Object Id, ProcessName, Path
if ($procs) { $procs | Format-Table -AutoSize -Wrap | Out-String -Width 200 } else { Write-Output "(no process with Path under D:\Users\deploy\AI-bim-geo)" }
$handles = @()
foreach ($p in (Get-Process python, kit, node, nvstreamer -ErrorAction SilentlyContinue)) {
  if ($p.Path) { $handles += [pscustomobject]@{ Id = $p.Id; Name = $p.ProcessName; Path = $p.Path } }
}
Write-Output "--- python/kit/node/nvstreamer with paths ---"
$handles | Format-Table -AutoSize -Wrap | Out-String -Width 200
