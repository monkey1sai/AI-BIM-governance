[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pattern = 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{50,}|xox[baprs]-[A-Za-z0-9-]+'
$matchedFiles = @(& git grep -IlE $pattern -- . ':(exclude)*.example' ':(exclude)package-lock.json')
$exitCode = $LASTEXITCODE
if ($exitCode -eq 0) {
    Write-Error "Potential secret pattern found in these files; values are redacted:`n$($matchedFiles -join [Environment]::NewLine)"
    exit 1
}
if ($exitCode -ne 1) { exit $exitCode }
Write-Host '[scan-secret-patterns] passed'
