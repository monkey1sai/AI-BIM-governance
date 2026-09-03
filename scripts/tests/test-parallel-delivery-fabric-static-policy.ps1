$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath (Join-Path $root 'agent-contracts\parallel-delivery-fabric-ac-map.json'))) {
  throw 'missing AC map'
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'scripts\autonomous-codex-review-policy.json'))) {
  throw 'missing review policy'
}
$behavioralTests = @(Get-ChildItem -LiteralPath (Join-Path $root 'scripts\tests\parallel-delivery-fabric') -Filter '*.mjs' -File | Sort-Object Name | ForEach-Object FullName)
if ($behavioralTests.Count -eq 0) { throw 'Fabric behavioral tests are missing' }
node --test @behavioralTests (Join-Path $root 'scripts\tests\test-autonomous-codex-review-policy.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Fabric behavioral or policy tests failed' }

$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { $python = 'python' }
& $python -m pytest (Join-Path $root 'tests\test_parallel_delivery_fabric_schema.py') -q -p no:cacheprovider
if ($LASTEXITCODE -ne 0) { throw 'Fabric schema tests failed' }
