# Regression guard for the retired automated User/PAT approval entrypoint.
$ErrorActionPreference = 'Stop'
$wrapper = Join-Path $PSScriptRoot 'run_blip_live_approve_once.ps1'
$source = Get-Content -Raw -LiteralPath $wrapper
$retirementMarker = 'HELD_AUTOMATED_APPROVAL_RETIRED'
$throwIndex = $source.IndexOf('throw $retirementReason', [StringComparison]::Ordinal)
$tokenIndex = $source.IndexOf('$reviewerTokenEnvPath', [StringComparison]::Ordinal)

if ($throwIndex -lt 0) {
    throw 'Retired wrapper does not fail closed.'
}
if ($tokenIndex -ge 0 -and $throwIndex -gt $tokenIndex) {
    throw 'Retired wrapper can reach reviewer token handling before refusal.'
}

$output = & 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -NonInteractive -File $wrapper `
    -PrNumber 1 `
    -ExpectedBaseSha ('a' * 40) `
    -ExpectedHeadSha ('b' * 40) `
    -ReviewMode focused_semantic 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -eq 0) {
    throw 'Retired wrapper unexpectedly succeeded.'
}
if (($output | Out-String) -notmatch $retirementMarker) {
    throw "Retired wrapper did not return $retirementMarker."
}

Write-Output 'PASS: automated approval wrapper refuses before token handling.'
