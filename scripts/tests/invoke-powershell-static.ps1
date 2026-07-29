[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$findings = @(Invoke-ScriptAnalyzer -Path scripts -Recurse -Severity Error)
if ($findings.Count -gt 0) {
    $findings | Format-Table | Out-String | Write-Error
    exit 1
}
Write-Host '[invoke-powershell-static] passed'
