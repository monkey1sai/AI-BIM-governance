[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'scripts\lib\production-boundary-contract.ps1')
$tempRoot = Join-Path $repoRoot "artifacts\tmp\production-boundary-$([Guid]::NewGuid().ToString('N'))"

try {
    New-Item -ItemType Directory -Path (Join-Path $tempRoot 'web-viewer-sample\src') -Force | Out-Null
    Push-Location $tempRoot
    try {
        git init -q
        git config user.email 'boundary-contract@example.invalid'
        git config user.name 'Boundary Contract Test'
        Set-Content -LiteralPath 'web-viewer-sample\src\client.ts' -Value 'export const endpoint = "http://127.0.0.1:8004";' -Encoding utf8
        Set-Content -LiteralPath 'compose.runtime-manager.yml' -Value 'VITE_COORDINATOR_API_BASE: http://127.0.0.1:8004' -Encoding utf8
        git add .
        git commit -q -m 'base'
        $baseSha = (git rev-parse HEAD).Trim()
        Add-Content -LiteralPath 'web-viewer-sample\src\client.ts' -Value @(
            'export const forbidden = "http://127.0.0.1:49102";',
            'export const fakePayload = {',
            '  "mock":',
            '  true,',
            '  "allow_fake_mapping":',
            '  true,',
            '  "fake_mapping_count":',
            '  1',
            '};'
        ) -Encoding utf8
        Set-Content -LiteralPath 'compose.runtime-manager.yml' -Value 'VITE_COORDINATOR_API_BASE: http://127.0.0.1:8010' -Encoding utf8
        git add .
        git commit -q -m 'bad internal route'
        $headSha = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }

    $failed = $false
    $failureMessage = ''
    try { Assert-ProductionBoundaryDiff -RepoRoot $tempRoot -BaseSha $baseSha -HeadSha $headSha } catch {
        $failed = $true
        $failureMessage = $_.Exception.Message
    }
    Assert-True $failed 'a browser route to a 49xxx listener fails the production boundary diff gate'
    Assert-True ($failureMessage -match '"mock"') 'multiline quoted JSON mock=true fails the production boundary diff gate'
    Assert-True ($failureMessage -match '"allow_fake_mapping"') 'multiline quoted JSON allow_fake_mapping=true fails the production boundary diff gate'
    Assert-True ($failureMessage -match '"fake_mapping_count"') 'multiline quoted JSON fake_mapping_count>0 fails the production boundary diff gate'
    Assert-True ($failureMessage -match 'VITE_COORDINATOR_API_BASE') 'Compose browser configuration cannot point directly at :8010'

    $backendRoot = Join-Path $tempRoot 'backend-case'
    New-Item -ItemType Directory -Path (Join-Path $backendRoot 'bim-review-coordinator\src') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $backendRoot 'governance-service\tests') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $backendRoot 'web-viewer-sample\src') -Force | Out-Null
    Push-Location $backendRoot
    try {
        git init -q
        git config user.email 'boundary-contract@example.invalid'
        git config user.name 'Boundary Contract Test'
        Set-Content -LiteralPath 'bim-review-coordinator\src\internal.ts' -Value 'export const name = "coordinator";' -Encoding utf8
        git add .
        git commit -q -m 'base'
        $backendBase = (git rev-parse HEAD).Trim()
        Add-Content -LiteralPath 'bim-review-coordinator\src\internal.ts' -Value 'export const upstream = "http://127.0.0.1:49102";' -Encoding utf8
        Set-Content -LiteralPath 'governance-service\tests\test_fake_fixture.py' -Value 'fixture = {"mock": true}' -Encoding utf8
        Set-Content -LiteralPath 'web-viewer-sample\src\client.spec.ts' -Value 'const fixture = {"mock": true};' -Encoding utf8
        git add .
        git commit -q -m 'safe backend loopback and test-only fake fixture'
        $backendHead = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }
    $previousDifferentOwner = $env:GIT_TEST_ASSUME_DIFFERENT_OWNER
    try {
        $env:GIT_TEST_ASSUME_DIFFERENT_OWNER = '1'
        Assert-ProductionBoundaryDiff -RepoRoot $backendRoot -BaseSha $backendBase -HeadSha $backendHead
    } finally {
        if ($null -eq $previousDifferentOwner) {
            Remove-Item Env:GIT_TEST_ASSUME_DIFFERENT_OWNER -ErrorAction SilentlyContinue
        } else {
            $env:GIT_TEST_ASSUME_DIFFERENT_OWNER = $previousDifferentOwner
        }
    }

    $mergeBaseRoot = Join-Path $tempRoot 'merge-base-case'
    New-Item -ItemType Directory -Path (Join-Path $mergeBaseRoot 'web-viewer-sample\src') -Force | Out-Null
    Push-Location $mergeBaseRoot
    try {
        git init -q
        git config user.email 'boundary-contract@example.invalid'
        git config user.name 'Boundary Contract Test'
        Set-Content -LiteralPath 'web-viewer-sample\src\legacy.ts' -Value 'export const legacy = "http://127.0.0.1:49102";' -Encoding utf8
        git add .
        git commit -q -m 'common ancestor with legacy route'
        git switch -q -c feature
        Set-Content -LiteralPath 'web-viewer-sample\src\safe.ts' -Value 'export const endpoint = "http://127.0.0.1:8004";' -Encoding utf8
        git add .
        git commit -q -m 'safe feature change'
        $featureHead = (git rev-parse HEAD).Trim()
        git switch -q master
        Remove-Item -LiteralPath 'web-viewer-sample\src\legacy.ts'
        git add .
        git commit -q -m 'base branch removes legacy route'
        $advancedBase = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }
    Assert-ProductionBoundaryDiff -RepoRoot $mergeBaseRoot -BaseSha $advancedBase -HeadSha $featureHead

    $postImageRoot = Join-Path $tempRoot 'post-image-case'
    New-Item -ItemType Directory -Path (Join-Path $postImageRoot 'web-viewer-sample\src') -Force | Out-Null
    Push-Location $postImageRoot
    try {
        git init -q
        git config user.email 'boundary-contract@example.invalid'
        git config user.name 'Boundary Contract Test'
        Set-Content -LiteralPath 'web-viewer-sample\src\config.ts' -Value @(
            'export const config = {',
            '  "mock":',
            '  false',
            '};'
        ) -Encoding utf8
        Set-Content -LiteralPath 'compose.runtime-manager.yml' -Value @(
            'VITE_COORDINATOR_API_BASE: >-',
            '  http://127.0.0.1:8004'
        ) -Encoding utf8
        git add .
        git commit -q -m 'safe post-image base'
        $postImageBase = (git rev-parse HEAD).Trim()
        (Get-Content -Raw 'web-viewer-sample\src\config.ts').Replace('  false', '  true') |
            Set-Content -LiteralPath 'web-viewer-sample\src\config.ts' -Encoding utf8
        (Get-Content -Raw 'compose.runtime-manager.yml').Replace(':8004', ':8010') |
            Set-Content -LiteralPath 'compose.runtime-manager.yml' -Encoding utf8
        git add .
        git commit -q -m 'context-only boundary violations'
        $postImageHead = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }
    $postImageFailed = $false
    $postImageMessage = ''
    try { Assert-ProductionBoundaryDiff -RepoRoot $postImageRoot -BaseSha $postImageBase -HeadSha $postImageHead } catch {
        $postImageFailed = $true
        $postImageMessage = $_.Exception.Message
    }
    Assert-True $postImageFailed 'post-image guard catches violations whose key line is unchanged context'
    Assert-True ($postImageMessage -match '"mock"') 'post-image guard catches false-to-true under an unchanged mock key'
    Assert-True ($postImageMessage -match 'VITE_COORDINATOR_API_BASE') 'post-image guard catches folded Compose VITE internal URL'

    $swapRoot = Join-Path $tempRoot 'swap-case'
    New-Item -ItemType Directory -Path (Join-Path $swapRoot 'web-viewer-sample\src') -Force | Out-Null
    Push-Location $swapRoot
    try {
        git init -q
        git config user.email 'boundary-contract@example.invalid'
        git config user.name 'Boundary Contract Test'
        Set-Content -LiteralPath 'web-viewer-sample\src\config.ts' -Value @(
            'export const legacy = {',
            '  "mock":',
            '  true',
            '};',
            'export const production = {',
            '  "mock":',
            '  false',
            '};'
        ) -Encoding utf8
        git add .
        git commit -q -m 'legacy fake remains isolated'
        $swapBase = (git rev-parse HEAD).Trim()
        $swapped = (Get-Content -Raw 'web-viewer-sample\src\config.ts').Replace('  true', '  TEMP').Replace('  false', '  true').Replace('  TEMP', '  false')
        Set-Content -LiteralPath 'web-viewer-sample\src\config.ts' -Value $swapped -Encoding utf8
        git add .
        git commit -q -m 'move fake behavior into production object'
        $swapHead = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }
    $swapFailed = $false
    try { Assert-ProductionBoundaryDiff -RepoRoot $swapRoot -BaseSha $swapBase -HeadSha $swapHead } catch {
        $swapFailed = $true
    }
    Assert-True $swapFailed 'moving an existing fake=true value to a different unchanged key location fails the guard'

    $sameHunkSwapRoot = Join-Path $tempRoot 'same-hunk-swap-case'
    New-Item -ItemType Directory -Path (Join-Path $sameHunkSwapRoot 'web-viewer-sample\src') -Force | Out-Null
    Push-Location $sameHunkSwapRoot
    try {
        git init -q
        git config user.email 'boundary-contract@example.invalid'
        git config user.name 'Boundary Contract Test'
        Set-Content -LiteralPath 'web-viewer-sample\src\config.ts' -Value @(
            'export const settings = {',
            '  legacy: { "mock":',
            '    true },',
            '  production: { "mock":',
            '    false }',
            '};'
        ) -Encoding utf8
        git add .
        git commit -q -m 'adjacent legacy fake remains isolated'
        $sameHunkSwapBase = (git rev-parse HEAD).Trim()
        $sameHunkSwapped = (Get-Content -Raw 'web-viewer-sample\src\config.ts').Replace('    true },', '    TEMP },').Replace('    false }', '    true }').Replace('    TEMP },', '    false },')
        Set-Content -LiteralPath 'web-viewer-sample\src\config.ts' -Value $sameHunkSwapped -Encoding utf8
        git add .
        git commit -q -m 'move adjacent fake behavior into production object'
        $sameHunkSwapHead = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }
    $sameHunkSwapFailed = $false
    try { Assert-ProductionBoundaryDiff -RepoRoot $sameHunkSwapRoot -BaseSha $sameHunkSwapBase -HeadSha $sameHunkSwapHead } catch {
        $sameHunkSwapFailed = $true
    }
    Assert-True $sameHunkSwapFailed 'moving fake=true between adjacent multiline keys in one diff hunk fails the guard'

    $schemaPath = Join-Path $repoRoot 'tests\contracts\element-mapping-provenance.schema.json'
    $valid = '{"mapping_provenance":"converter_verified","mock":false,"allow_fake_mapping":false,"summary":{"fake_mapping_count":0},"items":[]}'
    $invalid = '{"mock":false,"allow_fake_mapping":false,"summary":{"fake_mapping_count":0},"items":[]}'
    Assert-True ($valid | Test-Json -SchemaFile $schemaPath -ErrorAction SilentlyContinue) 'verified mapping provenance satisfies the schema'
    Assert-True (-not ($invalid | Test-Json -SchemaFile $schemaPath -ErrorAction SilentlyContinue)) 'mapping without provenance fails the schema'

    $kitClient = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'apps\kit-manager-web\src\api\KitManagerClient.ts')
    $kitPage = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'apps\kit-manager-web\src\components\KitManagerPage.tsx')
    $coordinator = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'bim-review-coordinator\src\app.ts')
    $governance = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'governance-service\app.py')
    $compose = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'compose.runtime-manager.yml')
    Assert-True ($kitClient -match '/api/kit/health' -and $kitClient -match '/api/kit/usdc') 'kit-manager browser client uses coordinator proxy paths'
    Assert-True ($kitClient -match '"x-operator-token": token') 'kit-manager mutation requests carry operator authorization'
    Assert-True ($kitPage -match 'const apiBase = import\.meta\.env\.VITE_COORDINATOR_API_BASE \|\| "http://127\.0\.0\.1:8004"') 'kit-manager browser default is the coordinator, never :8010'
    Assert-True ($kitPage -match 'type="password"' -and $kitPage -match 'useState\(""\)') 'operator token is entered at runtime and is not compiled into the browser bundle'
    Assert-True ($coordinator -match 'app\.get\("/api/kit/health"' -and $coordinator -match 'app\.get\("/api/kit/usdc"') 'coordinator owns the required kit proxy allowlist'
    Assert-True ($governance -match 'uvicorn\.run\(app, host="127\.0\.0\.1", port=int\(os\.environ\.get\("GOV_PORT", "49102"\)\)\)') 'governance service remains loopback-only on its 49xxx port'
    Assert-True ($compose -match 'KIT_MANAGER_API_BASE: http://kit-manager-api:8010') 'Compose coordinator reaches kit-manager-api by service DNS'
    Assert-True ($compose -match 'CORS_ORIGINS:.*5174') 'Compose coordinator explicitly allows the Kit Manager browser origin'
    Assert-True ($compose -match '"127\.0\.0\.1:8010:8010"' -and $compose -notmatch '(?m)^\s*-\s*"8010:8010"\s*$') 'Compose does not publish kit-manager-api on LAN interfaces'
    Assert-True ($compose -match '"127\.0\.0\.1:\$\{KIT_CONTROL_PORT:-49101\}:\$\{KIT_CONTROL_PORT:-49101\}/tcp"') 'Compose keeps the 49101 control listener loopback-only'
    Assert-True ($compose -match '"127\.0\.0\.1:5174:80"') 'Compose keeps the static Kit Manager web surface loopback-only'
    Assert-True ($compose -match '(?s)kit-manager-web:.*?build:.*?args:.*?VITE_COORDINATOR_API_BASE:') 'Compose passes Vite browser settings at image build time'
    Assert-True ($compose -notmatch 'KIT_MANAGER_CORS_ORIGINS: \$\{KIT_MANAGER_CORS_ORIGINS:-\*\}') 'Compose does not default kit-manager-api to wildcard CORS'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host '[test-production-boundary-contract] all assertions passed'
