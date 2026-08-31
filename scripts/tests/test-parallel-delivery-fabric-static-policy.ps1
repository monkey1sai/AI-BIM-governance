$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath (Join-Path $root 'agent-contracts\parallel-delivery-fabric-ac-map.json'))) {
  throw 'missing AC map'
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'scripts\autonomous-codex-review-policy.json'))) {
  throw 'missing review policy'
}
node --test (Join-Path $root 'scripts\tests\parallel-delivery-fabric\test-static-policy.mjs')
if ($LASTEXITCODE -ne 0) { throw 'static policy tests failed' }
