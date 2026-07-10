$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Error "PowerShell 7 or newer is required; refusing to run maintenance tests (found $($PSVersionTable.PSVersion))."
    exit 2
}

$tests = @(Get-ChildItem "$PSScriptRoot/../tests/test-codex-maintenance-*.ps1" | Sort-Object Name)
$failed = 0
foreach ($test in $tests) {
    & $test.FullName
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    if ($exitCode -ne 0) {
        Write-Error "[$($test.Name)] failed with exit code $exitCode"
        $failed++
    }
}
if ($failed -ne 0) {
    Write-Error "failed count $failed"
    exit 1
}
Write-Output "passed count $($tests.Count); failed count 0"
