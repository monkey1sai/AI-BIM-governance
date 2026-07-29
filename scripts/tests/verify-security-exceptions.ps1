[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
& node (Join-Path $repoRoot 'scripts\lib\security-exceptions-cli.mjs') `
    (Join-Path $repoRoot 'scripts\verification-manifest.json') `
    (Join-Path $repoRoot 'scripts\security-exceptions.json')
exit $LASTEXITCODE
