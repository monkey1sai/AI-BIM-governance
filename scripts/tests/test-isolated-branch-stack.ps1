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

$launcherPath = Join-Path $repoRoot 'scripts\dev\start-isolated-branch-stack.ps1'
. $launcherPath

$p0 = Resolve-IsolatedStackPorts -OffsetInput '0'
Assert-Equal 8005 $p0.coordinator 'offset 0 coordinator'
Assert-Equal 49103 $p0.governance 'offset 0 governance'
Assert-Equal 5180 $p0.viewer 'offset 0 viewer'
$p4 = Resolve-IsolatedStackPorts -OffsetInput '4'
Assert-Equal 8009 $p4.coordinator 'offset 4 coordinator'
Assert-Equal 49107 $p4.governance 'offset 4 governance'
Assert-Equal 5184 $p4.viewer 'offset 4 viewer'
$reservedPorts = @(8004, 49102, 49101, 8010, 5173, 5174, 49100) + @(49110..49150)
foreach ($reservedPort in $reservedPorts) {
    Assert-Throws {
        Assert-IsolatedPortSetDisjoint -Ports ([pscustomobject]@{ coordinator=$reservedPort; governance=49103; viewer=5180 })
    } "reserved port $reservedPort rejected"
}

foreach ($bad in @('-1', '1.5', '5', '48', 'abc')) {
    $listenerCalls = 0
    Assert-Throws {
        Assert-IsolatedStackStartPreflight -RepoRoot $repoRoot -ChangeId 'change-a' -RunId 'run-a' `
            -OffsetInput $bad -ListenerLookup { param($port) $script:listenerCalls++; $null }
    } "offset $bad rejected"
    Assert-Equal 0 $listenerCalls "offset $bad rejected before listener lookup"
}

foreach ($badId in @('', '.', '..', 'a/b', 'a\b', 'a:b', ' leading', 'NUL', 'con.txt', 'COM1', 'LPT9.log', 'change-a.')) {
    foreach ($field in @('ChangeId', 'RunId')) {
        Assert-Throws { Assert-SafeStackSegment -Name $field -Value $badId } "unsafe $field rejected: $badId"
    }
}

foreach ($badId in @('NUL', 'con.txt', 'COM1', 'LPT9.log', 'change-a.')) {
    foreach ($field in @('ChangeId', 'RunId')) {
        $listenerCalls = 0
        $changeId = if ($field -eq 'ChangeId') { $badId } else { 'change-a' }
        $runId = if ($field -eq 'RunId') { $badId } else { 'run-a' }
        Assert-Throws {
            Assert-IsolatedStackStartPreflight -RepoRoot $repoRoot -ChangeId $changeId -RunId $runId `
                -OffsetInput '0' -ListenerLookup { param($port) $script:listenerCalls++; $null }
        } "unsafe $field rejected before listener lookup: $badId"
        Assert-Equal 0 $listenerCalls "unsafe $field rejected before listener lookup: $badId"
    }
}

$directExecutionOutput = (& pwsh -NoProfile -NonInteractive -File $launcherPath -Action status 2>&1 | Out-String)
Assert-True ($LASTEXITCODE -ne 0) 'direct launcher execution fails before Task 4 dispatcher'
Assert-True ($directExecutionOutput -match [regex]::Escape('Direct execution is unavailable until the Task 4 dispatcher is implemented.')) `
    'direct launcher execution reports dispatcher guard'

$sandbox = New-TestSandbox -Prefix 'isolated-stack-collision'
try {
    $manifest = Resolve-IsolatedStackManifestPath -RepoRoot $sandbox -ChangeId 'change-a' -RunId 'run-a'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $manifest) | Out-Null
    '{}' | Set-Content -LiteralPath $manifest
    $listenerCalls = 0
    Assert-Throws {
        Assert-IsolatedStackStartPreflight -RepoRoot $sandbox -ChangeId 'change-a' -RunId 'run-a' `
            -OffsetInput '0' -ListenerLookup { param($port) $script:listenerCalls++; $null }
    } 'manifest collision rejected'
    Assert-Equal '{}' (Get-Content -Raw -LiteralPath $manifest).Trim() 'collision does not overwrite manifest'
    Assert-Equal 0 $listenerCalls 'collision rejected before listener lookup'
}
finally { Remove-TestSandbox -Path $sandbox }

Write-Host '[test-isolated-branch-stack] contract assertions passed'
