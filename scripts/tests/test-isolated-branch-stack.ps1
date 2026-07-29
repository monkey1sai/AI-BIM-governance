. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$productContractPath = Join-Path $repoRoot 'docs\agents\product-operability-and-script-contract.md'
$scriptContractPath = Join-Path $repoRoot 'scripts\SCRIPT_CONTRACT.md'
$productContract = Get-Content -Raw -LiteralPath $productContractPath
$scriptContract = Get-Content -Raw -LiteralPath $scriptContractPath

Assert-True ($productContract -match '## 8\. 隔離 branch stack 驗證') 'product contract has isolated stack section'
foreach ($required in @('8005', '49103', '5180', '0\.\.4', 'E2E_STACK_MANIFEST', 'stack_kind=isolated_branch_stack')) {
    Assert-True ($productContract -match $required) "product contract contains $required"
}
foreach ($boundary in @('不得推論 design gate', '不得推論 deploy', '不得推論 Kit/WebRTC')) {
    Assert-True ($productContract -match [regex]::Escape($boundary)) "product contract contains boundary: $boundary"
}
Assert-True ($scriptContract -match 'scripts/dev/start-isolated-branch-stack\.ps1') 'script contract registers launcher'
Assert-True ($scriptContract -match 'Playwright.*viewer') 'script contract keeps viewer lifecycle in Playwright'

Write-Host '[test-isolated-branch-stack] contract assertions passed'
