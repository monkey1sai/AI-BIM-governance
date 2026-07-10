$ErrorActionPreference = 'Stop'
$harness = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../dev/run-codex-maintenance-tests.ps1'))
$ps5 = Get-Command powershell.exe -ErrorAction SilentlyContinue
if ($null -ne $ps5) {
    $output = & $ps5.Source -NoProfile -NonInteractive -File $harness 2>&1
    if ($LASTEXITCODE -eq 0) { throw 'PowerShell 5 invocation unexpectedly passed' }
    if (($output -join "`n") -notmatch 'PowerShell 7 or newer is required') { throw 'PowerShell 5 rejection was not explicit' }
}
$ps7 = (Get-Command pwsh.exe -ErrorAction Stop).Source
$output = & $ps7 -NoProfile -NonInteractive -File $harness 2>&1
if ($LASTEXITCODE -ne 0) { throw "PowerShell 7 harness failed with exit code $LASTEXITCODE" }
if (($output -join "`n") -notmatch 'passed count 9; failed count 0') { throw 'PowerShell 7 did not report all nine maintenance tests' }
Write-Output 'PASS maintenance harness PowerShell version and exit-code contract'
