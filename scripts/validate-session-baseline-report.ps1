# scripts\validate-session-baseline-report.ps1
#
# Downstream reference gate for GPU session baseline reports
# (openspec/changes/gpu-session-baseline-and-idle-reclaim task 1.2).
#
# Judges one report produced by scripts\measure-session-baseline.ps1:
#   exit 0  -> the report is complete and MAY be referenced downstream
#   exit 1  -> the report SHALL NOT be referenced by SLO formalization or
#              admission parameter loaders (missing/unmeasured fingerprint
#              fields, inconsistent completeness claim, unknown schema, or an
#              unreadable/unparseable file)
#
# The structured verdict (gpu-session-baseline-report-validation/v1) is
# written to stdout as JSON in every case, so a caller can log WHY a report
# was refused. Fail-closed by design: any error reading or parsing the
# report is a refusal, never a crash without a verdict and never a pass.
#
# Core judgment lives in Test-SessionBaselineReportForDownstream in
# scripts\lib\measure-session-baseline.ps1; tests in
# scripts\tests\test-measure-session-baseline.ps1. Registered in
# scripts\script-registry.json.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $ReportPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\measure-session-baseline.ps1')

$verdict = $null
if (-not (Test-Path -LiteralPath $ReportPath -PathType Leaf)) {
    $verdict = [ordered]@{
        schema_version                    = 'gpu-session-baseline-report-validation/v1'
        report_schema_version             = $null
        eligible_for_downstream_reference = $false
        missing_fields                    = @()
        unmeasured_fields                 = @()
        inconsistencies                   = @()
        reasons                           = @("report file does not exist: $ReportPath")
        note                              = 'eligible_for_downstream_reference=false means SLO formalization and admission parameter loaders SHALL NOT reference this report (gpu-session-baseline spec, task 1.2); this verdict is fail-closed and never fabricates.'
    }
} else {
    $parsedReport = $null
    $parseError = $null
    try {
        $parsedReport = Get-Content -LiteralPath $ReportPath -Raw | ConvertFrom-Json
    } catch {
        $parseError = $_.Exception.Message
    }
    if ($null -ne $parseError) {
        $verdict = [ordered]@{
            schema_version                    = 'gpu-session-baseline-report-validation/v1'
            report_schema_version             = $null
            eligible_for_downstream_reference = $false
            missing_fields                    = @()
            unmeasured_fields                 = @()
            inconsistencies                   = @()
            reasons                           = @("report file is not valid JSON: $parseError")
            note                              = 'eligible_for_downstream_reference=false means SLO formalization and admission parameter loaders SHALL NOT reference this report (gpu-session-baseline spec, task 1.2); this verdict is fail-closed and never fabricates.'
        }
    } else {
        $verdict = Test-SessionBaselineReportForDownstream -Report $parsedReport
    }
}

$verdict | ConvertTo-Json -Depth 10
if ($verdict.eligible_for_downstream_reference -eq $true) { exit 0 }
exit 1
