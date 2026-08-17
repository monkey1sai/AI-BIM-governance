#requires -Version 7.0
<#
.SYNOPSIS
    Report-only Agent Governance Policy evaluation. Consumed by humans, not by any gate.

.DESCRIPTION
    This script exists so the policy module can be compared against the assertions it will
    eventually replace, before anything depends on its verdict. It is deliberately NOT wired into
    CI, scripts/verification-manifest.json, or scripts/verify-all.ps1: while no gate consumes its
    report it stays outside the mechanism surface (docs/agents/self-referential-bootstrap.md §2.1
    "明確排除"). The PR that wires it into a gate must, in that same PR, add the module, this
    script, and its test to Get-SelfReferentialMechanismPaths - that is the §2.1 upgrade rule, not
    an optional follow-up.

.PARAMETER BaseRef
    When supplied, also runs the ratchet: the rule document at this ref is compared against the
    working tree's, so a removed or downgraded rule is reported.

.PARAMETER Json
    Emit the verdict as JSON instead of a human-readable table.

.EXAMPLE
    pwsh -File scripts/dev/report-agent-governance-policy.ps1
    pwsh -File scripts/dev/report-agent-governance-policy.ps1 -BaseRef origin/main
#>
[CmdletBinding()]
param(
    [string] $RepoRoot = (Join-Path $PSScriptRoot '..\..'),
    [string] $RulesPath = 'scripts/agent-governance-rules.json',
    [string] $BaseRef = '',
    [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot '..\lib\agent-governance-policy.psm1') -Force

$resolvedRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$snapshot = New-AgentGovernanceSnapshot -RepoRoot $resolvedRoot

$rulesText = & $snapshot.ReadText $RulesPath ''
if ($null -eq $rulesText) {
    throw "report-agent-governance-policy: rule document '$RulesPath' not found under $resolvedRoot."
}
$rules = $rulesText | ConvertFrom-Json -AsHashtable

$verdict = Invoke-AgentGovernancePolicy -Snapshot $snapshot -Rules $rules

$ratchet = $null
if (-not [string]::IsNullOrWhiteSpace($BaseRef)) {
    $baseText = & $snapshot.ReadText $RulesPath $BaseRef
    if ($null -eq $baseText) {
        Write-Host "[ratchet] rule document is absent at $BaseRef; treating this as the document's introduction." -ForegroundColor Yellow
    } else {
        $ratchet = Test-AgentGovernancePolicyRatchet -BaseRules ($baseText | ConvertFrom-Json -AsHashtable) -HeadRules $rules
    }
}

if ($Json) {
    [pscustomobject]@{
        report_only = $true
        policy      = $verdict
        ratchet     = $ratchet
    } | ConvertTo-Json -Depth 12
    exit 0
}

Write-Host ''
Write-Host 'Agent Governance Policy - REPORT ONLY (no gate consumes this verdict)' -ForegroundColor Cyan
Write-Host ("  repo      : {0}" -f $resolvedRoot)
Write-Host ("  rules     : {0}" -f $RulesPath)
Write-Host ("  evaluated : {0} rules" -f $verdict.evaluated_count)
Write-Host ("  status    : {0}  ({1} error, {2} warning)" -f $verdict.status, $verdict.error_count, $verdict.warning_count) `
    -ForegroundColor $(if ($verdict.status -eq 'passed') { 'Green' } else { 'Red' })

foreach ($finding in $verdict.findings) {
    Write-Host ("  [{0}] {1}  {2}" -f $finding.severity, $finding.rule_id, $finding.detail) `
        -ForegroundColor $(if ($finding.severity -eq 'error') { 'Red' } else { 'Yellow' })
}

if ($null -ne $ratchet) {
    Write-Host ''
    Write-Host ("  ratchet vs {0}: {1} ({2} error)" -f $BaseRef, $ratchet.status, $ratchet.error_count) `
        -ForegroundColor $(if ($ratchet.status -eq 'passed') { 'Green' } else { 'Red' })
    foreach ($finding in $ratchet.findings) {
        Write-Host ("  [{0}] {1}  {2}" -f $finding.code, $finding.rule_id, $finding.detail) -ForegroundColor Red
    }
}

Write-Host ''
# Report-only: the exit code stays 0 even when findings exist, so that no caller can accidentally
# turn this into a gate before the wiring PR does it deliberately.
exit 0
