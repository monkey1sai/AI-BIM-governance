. "$PSScriptRoot/test-helpers.ps1"; . "$PSScriptRoot/../lib/codex-governance/Maintenance.Cli.ps1"
$root=New-TestSandbox 'cli'; try {
 $prefix=Join-Path $root 'prefix'; New-Item -ItemType Directory $prefix|Out-Null; Set-Content (Join-Path $prefix 'codex.exe') 'fake'; $c=[pscustomobject]@{Version='0.144.1';ClosureHash='abc';Packages=@(@{name='codex';integrity='sha512-x'})}; Write-AtomicJson -Path (Join-Path $prefix 'cli-closure.json') -InputObject @{Version='0.144.1';ClosureHash='abc'} -Root $prefix
 Assert-Equal 'pass' (Test-CliLifecycleBaseline $prefix $c).Status 'baseline'; Assert-Throws {Test-CliLifecycleBaseline $prefix ([pscustomobject]@{Version='0.144.1';ClosureHash='bad'})} 'hash mismatch'
 $stage=Stage-CliClosure $c $prefix; Assert-True (Test-Path (Join-Path $stage.Staging 'cli-closure.json')) 'staged closure'; $r=Invoke-CliRollbackRehearsal $prefix $stage.Staging '0.144.1' '0.144.1'; Assert-Equal 'pass' $r.Status 'rehearsal'; $a=Apply-CliClosure $prefix $stage.Staging $c; Assert-Equal 'applied' $a.Status 'apply'; Restore-CliClosure $prefix $a.SnapshotPath|Out-Null; Write-TestPass 'maintenance cli'
} finally {Remove-TestSandbox $root}
