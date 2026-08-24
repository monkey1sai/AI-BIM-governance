#requires -Version 7.0
<#
.SYNOPSIS
    Adjudicating gate over the Agent Governance Policy rule document.

.DESCRIPTION
    Evaluates every rule in scripts/agent-governance-rules.json against the working tree through
    scripts/lib/agent-governance-policy.psm1, and — when a base ref is supplied — runs the rule
    ratchet so a removed or severity-downgraded rule fails closed unless its retirement is
    declared.

    This is the wiring PR's counterpart to scripts/dev/report-agent-governance-policy.ps1: the
    report stays exit-0 by design, THIS script is the adjudicator. Per
    docs/agents/self-referential-bootstrap.md §2.1, the PR that introduced this consumer also
    registered the module, this script, and its behaviour suite as mechanism paths.

    Warnings fail too: like tests/test_observed_architecture.py's canonical assertions, a stale
    rule must force a cleanup rather than sit amber forever.

.PARAMETER BaseRef
    Git ref of the PR base. When supplied and the rule document exists there, the head document
    must pass Test-AgentGovernancePolicyRatchet against it. When absent (push builds), only the
    policy evaluation runs.
#>
[CmdletBinding()]
param(
    [string] $RepoRoot = (Join-Path $PSScriptRoot '..\..'),
    [string] $RulesPath = 'scripts/agent-governance-rules.json',
    [string] $BaseRef = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot '..\lib\agent-governance-policy.psm1') -Force

$resolvedRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$snapshot = New-AgentGovernanceSnapshot -RepoRoot $resolvedRoot

$rulesText = & $snapshot.ReadText $RulesPath ''
if ($null -eq $rulesText) {
    Write-Host "[verify-governance-policy] FAIL rule document '$RulesPath' not found under $resolvedRoot" -ForegroundColor Red
    exit 1
}
$rules = $rulesText | ConvertFrom-Json -AsHashtable

$verdict = Invoke-AgentGovernancePolicy -Snapshot $snapshot -Rules $rules
foreach ($finding in $verdict.findings) {
    Write-Host ("  [{0}] {1}  {2}" -f $finding.severity, $finding.rule_id, $finding.detail) `
        -ForegroundColor $(if ($finding.severity -eq 'error') { 'Red' } else { 'Yellow' })
}
Write-Host ("[verify-governance-policy] policy: {0} rules, {1} error, {2} warning" -f `
    $verdict.evaluated_count, $verdict.error_count, $verdict.warning_count)

$failed = ($verdict.error_count -gt 0 -or $verdict.warning_count -gt 0)

if (-not [string]::IsNullOrWhiteSpace($BaseRef)) {
    $baseText = & $snapshot.ReadText $RulesPath $BaseRef
    if ($null -eq $baseText) {
        # The document's own introduction: no base copy exists, so there is nothing to ratchet.
        Write-Host "[verify-governance-policy] ratchet: rule document absent at $BaseRef (introduction)"
    } else {
        $ratchet = Test-AgentGovernancePolicyRatchet -BaseRules ($baseText | ConvertFrom-Json -AsHashtable) -HeadRules $rules
        foreach ($finding in $ratchet.findings) {
            Write-Host ("  [{0}] {1}  {2}" -f $finding.code, $finding.rule_id, $finding.detail) -ForegroundColor Red
        }
        Write-Host ("[verify-governance-policy] ratchet vs {0}: {1} error" -f $BaseRef, $ratchet.error_count)
        if ($ratchet.error_count -gt 0) { $failed = $true }
    }
}

if ($failed) {
    Write-Host '[verify-governance-policy] FAILED' -ForegroundColor Red
    exit 1
}
Write-Host '[verify-governance-policy] passed' -ForegroundColor Green
exit 0
