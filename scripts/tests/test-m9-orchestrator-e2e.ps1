. "$PSScriptRoot/test-helpers.ps1"
$script = Join-Path $PSScriptRoot '../dev/Invoke-CodexGovernanceMaintenance.ps1'
$root = New-TestSandbox 'm9-orchestrator'
try {
  $candidate = Join-Path $root 'candidate.json'
  @{sourceId='m9-e2e'; Version='1'} | ConvertTo-Json | Set-Content $candidate
  # Dot-source in Audit mode to load orchestrator functions without applying.
  . $script -Mode Audit -CodexHome $root -CandidatePath $candidate | Out-Null
  $events = [System.Collections.Generic.List[string]]::new()
  $callbacks = @{}
  foreach($cohort in 'cli','plugin','skill') {
    $callbacks["Stage:$cohort"] = { param($c,$r) $events.Add("stage:$cohort"); [pscustomobject]@{Cohort=$cohort} }.GetNewClosure()
    $callbacks["Apply:$cohort"] = { param($s,$r) $events.Add("apply:$cohort"); [pscustomobject]@{Status='applied'} }.GetNewClosure()
    $callbacks["Rollback:$cohort"] = { param($r) $events.Add("rollback:$cohort") }.GetNewClosure()
  }
  $apply = Invoke-MaintenanceApply $root $candidate $null $callbacks
  Assert-Equal 'staged' $apply.status 'successful apply status'
  $verify = Invoke-MaintenanceVerify $root @{} @{} @{}
  Assert-Equal 'verified' $verify.status 'verify applied state'
  Assert-True (Test-Path (Join-Path $root 'applied-state.json')) 'applied state persisted'
  Assert-True (@($events | Where-Object {$_ -like 'stage:*'}).Count -eq 3) 'all stage callbacks'
  Assert-True (@($events | Where-Object {$_ -like 'apply:*'}).Count -eq 3) 'all apply callbacks'

  $failed = @{} + $callbacks
  $failed['Apply:plugin'] = { throw 'injected apply failure' }
  Assert-Throws { Invoke-MaintenanceApply $root $candidate $null $failed } 'failed apply propagates'
  Assert-True (Test-Path (Join-Path $root 'apply-disabled.json')) 'apply disabled marker'
  Assert-True (@($events | Where-Object {$_ -like 'rollback:*'}).Count -ge 3) 'rollback callbacks on failure'
  $audit = Invoke-MaintenanceAudit $root $candidate $null
  Assert-Equal 'audited' $audit.status 'audit after failure'

  1..7 | ForEach-Object { New-Item -ItemType Directory -Path (Join-Path $root ".snapshot-$($_)") | Out-Null }
  Get-ChildItem $root -Directory -Filter '.snapshot-*' | ForEach-Object { $_.LastWriteTimeUtc = [DateTime]::UtcNow.AddDays(-31) }
  Retain-MaintenanceSnapshots $root 5
  Assert-True (@(Get-ChildItem $root -Directory -Filter '.snapshot-*').Count -le 5) 'snapshot retention'
  Write-TestPass 'M9 orchestrator callback E2E'
} finally { Remove-TestSandbox $root }
