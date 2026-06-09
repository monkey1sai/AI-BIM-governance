# Test Deploy Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a build-only test deployment rebuild workflow that resets `D:\Users\deploy\AI-bim-geo` to freshly fetched `origin/main`, removes agent/tooling files, and launches `scripts\deploy.ps1 -Build`.

**Architecture:** Add a testable PowerShell library under `scripts/lib/` and a build-only wrapper under `scripts/dev/`. The wrapper is the user口令 handler for rebuild preparation, while the canonical runtime entrypoint remains the deployment checkout's `scripts\deploy.ps1 -Build`.

**Tech Stack:** Windows PowerShell 5.1-compatible scripts, existing pure PowerShell `scripts/tests/*` test style, Git CLI, existing repo documentation.

---

## File Structure

- Create: `scripts/lib/rebuild-test-deploy.ps1`
  - Owns fixed-path validation, agent/tooling cleanup, git command execution, and rebuild orchestration functions.
- Create: `scripts/dev/rebuild-test-deploy.ps1`
  - Thin wrapper that requires `-Build`, imports the library, and invokes the fixed deployment rebuild.
- Create: `scripts/tests/test-rebuild-test-deploy.ps1`
  - Pure PowerShell tests using `scripts/tests/test-helpers.ps1`; no Pester dependency.
- Modify: `AGENTS.md`
  - Add the口令 rule: "請測試部署區重建" means run the build-only helper and then deployment `deploy.ps1 -Build`.
- Modify: `CLAUDE.md`
  - Mirror the root agent rule in the Claude entrypoint.
- Modify: `docs/agents/product-operability-and-script-contract.md`
  - Replace test deploy dry-run language with build-only behavior and risk controls.
- Modify: `docs/agents/sub-repo-verify-commands.md`
  - Add the exact command and blocker rules for test deployment rebuild.

---

### Task 1: Add Testable Rebuild Library

**Files:**
- Create: `scripts/lib/rebuild-test-deploy.ps1`
- Test: `scripts/tests/test-rebuild-test-deploy.ps1`

- [ ] **Step 1: Write failing tests for path safety and exclusion policy**

Create `scripts/tests/test-rebuild-test-deploy.ps1` with this initial content:

```powershell
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')
. (Join-Path $PSScriptRoot '..\lib\rebuild-test-deploy.ps1')

$testName = 'rebuild-test-deploy'
$sandbox = New-TestSandbox -Prefix $testName

try {
    $expected = 'D:\Users\deploy\AI-bim-geo'
    Assert-Equal $expected (Assert-TestDeployPath -Path $expected) 'fixed deployment path is accepted'
    Assert-Throws { Assert-TestDeployPath -Path 'D:\Users\deploy\AI-bim-geo2' } 'nearby deployment path is rejected'
    Assert-Throws { Assert-TestDeployPath -Path $sandbox } 'temporary sandbox path is rejected'

    $cleanupRoot = Join-Path $sandbox 'AI-bim-geo'
    New-Item -ItemType Directory -Path $cleanupRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot '.github\workflows') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot '.agent\skills\x') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot '.claude\workflows') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot 'apps\kit-manager-web') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot 'scripts') -Force | Out-Null
    'root agent' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'AGENTS.md') -Encoding ascii
    'root claude' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'CLAUDE.md') -Encoding ascii
    'nested agent' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'apps\kit-manager-web\AGENTS.md') -Encoding ascii
    'workflow' | Set-Content -LiteralPath (Join-Path $cleanupRoot '.github\workflows\ci.yml') -Encoding ascii
    'deploy' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'scripts\deploy.ps1') -Encoding ascii

    $removed = Remove-TestDeployAgentTooling -DeploymentPath $cleanupRoot
    Assert-True ($removed.Count -ge 4) 'agent/tooling paths are reported as removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'AGENTS.md'))) 'root AGENTS.md removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'CLAUDE.md'))) 'root CLAUDE.md removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'apps\kit-manager-web\AGENTS.md'))) 'nested AGENTS.md removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot '.agent'))) 'root .agent removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot '.claude'))) 'root .claude removed'
    Assert-True (Test-Path -LiteralPath (Join-Path $cleanupRoot '.github\workflows\ci.yml')) '.github workflows kept'
    Assert-True (Test-Path -LiteralPath (Join-Path $cleanupRoot 'scripts\deploy.ps1')) 'deploy.ps1 kept'

    Write-TestPass $testName
} catch {
    Write-TestFail $testName $_.Exception.Message
    throw
} finally {
    Remove-TestSandbox -Path $sandbox
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-rebuild-test-deploy.ps1
```

Expected: FAIL because `scripts\lib\rebuild-test-deploy.ps1` does not exist.

- [ ] **Step 3: Create the minimal library functions**

Create `scripts/lib/rebuild-test-deploy.ps1` with this content:

```powershell
# scripts\lib\rebuild-test-deploy.ps1
# Test deployment rebuild helpers. The fixed deployment path is intentionally hard-coded
# so the helper cannot be repurposed into a generic destructive cleanup tool.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:FixedTestDeployPath = 'D:\Users\deploy\AI-bim-geo'

function Normalize-TestDeployPath {
    param([Parameter(Mandatory = $true)][string] $Path)
    return ([System.IO.Path]::GetFullPath($Path)).TrimEnd('\')
}

function Assert-TestDeployPath {
    param([Parameter(Mandatory = $true)][string] $Path)

    $normalized = Normalize-TestDeployPath -Path $Path
    $expected = Normalize-TestDeployPath -Path $script:FixedTestDeployPath
    if (-not [string]::Equals($normalized, $expected, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Deployment path must be exactly '$expected' (actual '$normalized')."
    }
    return $expected
}

function Get-TestDeployRootToolingDirs {
    return @('.codex', '.agents', '.agent', '.claude', '.cursor', '.windsurf')
}

function Remove-TestDeployAgentTooling {
    param([Parameter(Mandatory = $true)][string] $DeploymentPath)

    $root = Normalize-TestDeployPath -Path $DeploymentPath
    $removed = New-Object System.Collections.Generic.List[string]

    foreach ($fileName in @('AGENTS.md', 'CLAUDE.md')) {
        Get-ChildItem -LiteralPath $root -Recurse -Force -File -Filter $fileName |
            ForEach-Object {
                Remove-Item -LiteralPath $_.FullName -Force
                [void]$removed.Add($_.FullName)
            }
    }

    foreach ($dirName in Get-TestDeployRootToolingDirs) {
        $dir = Join-Path $root $dirName
        if (Test-Path -LiteralPath $dir) {
            Remove-Item -LiteralPath $dir -Recurse -Force
            [void]$removed.Add($dir)
        }
    }

    return @($removed)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-rebuild-test-deploy.ps1
```

Expected: PASS with `[PASS] rebuild-test-deploy`.

- [ ] **Step 5: Commit**

Run:

```powershell
git add scripts/lib/rebuild-test-deploy.ps1 scripts/tests/test-rebuild-test-deploy.ps1
git commit -m "test: 新增測試部署重建安全測試"
```

Expected: commit succeeds with only the library and test files staged.

---

### Task 2: Add Build-Only Rebuild Orchestration

**Files:**
- Modify: `scripts/lib/rebuild-test-deploy.ps1`
- Modify: `scripts/tests/test-rebuild-test-deploy.ps1`

- [ ] **Step 1: Add failing orchestration tests**

Append these tests inside the `try { ... }` block in `scripts/tests/test-rebuild-test-deploy.ps1`, after the cleanup assertions and before `Write-TestPass`:

```powershell
    $calls = New-Object System.Collections.Generic.List[string]
    $runner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:calls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
        if ($Arguments -contains 'fetch') {
            return [pscustomobject]@{ ExitCode = 23; Output = 'fetch failed' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $script:calls = $calls
    Assert-Throws {
        Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('fetch', 'origin', 'main') -WorkingDirectory $cleanupRoot -CommandRunner $runner
    } 'fetch failure is surfaced as a blocker'
    Assert-True ($calls[0] -match 'git fetch origin main') 'fetch command was attempted'

    $okRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }
    $okResult = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('status', '--short') -WorkingDirectory $cleanupRoot -CommandRunner $okRunner
    Assert-Equal 0 $okResult.ExitCode 'successful command returns exit code'
    Assert-Equal 'ok' $okResult.Output 'successful command returns output'
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-rebuild-test-deploy.ps1
```

Expected: FAIL because `Invoke-TestDeployGitCommand` is not defined.

- [ ] **Step 3: Add command runner and rebuild function**

Append this code to `scripts/lib/rebuild-test-deploy.ps1`:

```powershell
function Invoke-TestDeployGitCommand {
    param(
        [Parameter(Mandatory = $true)][string] $Tool,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [scriptblock] $CommandRunner = $null
    )

    if ($null -ne $CommandRunner) {
        $result = & $CommandRunner $Tool $Arguments $WorkingDirectory
    } else {
        Push-Location $WorkingDirectory
        try {
            $output = & $Tool @Arguments 2>&1
            $result = [pscustomobject]@{
                ExitCode = $LASTEXITCODE
                Output = ($output -join [Environment]::NewLine)
            }
        } finally {
            Pop-Location
        }
    }

    if ($result.ExitCode -ne 0) {
        throw "$Tool $($Arguments -join ' ') failed with exit code $($result.ExitCode): $($result.Output)"
    }
    return $result
}

function Invoke-TestDeployRebuild {
    param(
        [Parameter(Mandatory = $true)][switch] $Build,
        [string] $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path,
        [string] $DeploymentPath = $script:FixedTestDeployPath,
        [scriptblock] $CommandRunner = $null,
        [scriptblock] $DeployRunner = $null
    )

    $deployRoot = Assert-TestDeployPath -Path $DeploymentPath

    $origin = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('remote', 'get-url', 'origin') -WorkingDirectory $RepoRoot -CommandRunner $CommandRunner
    $originUrl = $origin.Output.Trim()
    if ([string]::IsNullOrWhiteSpace($originUrl)) {
        throw 'Current repo origin URL is empty.'
    }

    if (-not (Test-Path -LiteralPath $deployRoot)) {
        New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null
    }

    $gitDir = Join-Path $deployRoot '.git'
    if (-not (Test-Path -LiteralPath $gitDir)) {
        $existing = @(Get-ChildItem -LiteralPath $deployRoot -Force -ErrorAction SilentlyContinue)
        if ($existing.Count -gt 0) {
            $existing | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
            Write-Host "[rebuild-test-deploy] rebuilt non-git deployment directory: $deployRoot"
        }
        Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('clone', $originUrl, $deployRoot) -WorkingDirectory $RepoRoot -CommandRunner $CommandRunner | Out-Null
    } else {
        $deployOrigin = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('remote', 'get-url', 'origin') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner
        if ($deployOrigin.Output.Trim() -ne $originUrl) {
            throw "Deployment checkout origin mismatch. expected='$originUrl' actual='$($deployOrigin.Output.Trim())'"
        }
    }

    $headBefore = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('rev-parse', '--short', 'HEAD') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner
    $statusBefore = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('status', '--short') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner
    if (-not [string]::IsNullOrWhiteSpace($statusBefore.Output)) {
        $changedCount = @($statusBefore.Output -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
        Write-Host "[rebuild-test-deploy] discarding deployment local changes count=$changedCount head=$($headBefore.Output.Trim())"
        Write-Host $statusBefore.Output
    }

    Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('fetch', 'origin', 'main') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner | Out-Null
    Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('reset', '--hard', 'origin/main') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner | Out-Null
    Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('clean', '-fdx') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner | Out-Null

    $removed = Remove-TestDeployAgentTooling -DeploymentPath $deployRoot
    $deployScript = Join-Path $deployRoot 'scripts\deploy.ps1'
    if (-not (Test-Path -LiteralPath $deployScript -PathType Leaf)) {
        throw "Deployment script missing after rebuild: $deployScript"
    }

    $commit = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('rev-parse', 'origin/main') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner

    if ($null -ne $DeployRunner) {
        $deployResult = & $DeployRunner $deployRoot
    } else {
        Push-Location $deployRoot
        try {
            & .\scripts\deploy.ps1 -Build
            $deployResult = [pscustomobject]@{ ExitCode = $LASTEXITCODE }
        } finally {
            Pop-Location
        }
    }

    return [pscustomobject]@{
        DeploymentPath = $deployRoot
        OriginMainCommit = $commit.Output.Trim()
        RemovedAgentToolingCount = @($removed).Count
        DeployExitCode = [int]$deployResult.ExitCode
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-rebuild-test-deploy.ps1
```

Expected: PASS with `[PASS] rebuild-test-deploy`.

- [ ] **Step 5: Commit**

Run:

```powershell
git add scripts/lib/rebuild-test-deploy.ps1 scripts/tests/test-rebuild-test-deploy.ps1
git commit -m "feat: 實作測試部署重建流程"
```

Expected: commit succeeds with only the rebuild library and its test staged.

---

### Task 3: Add Build-Only Dev Wrapper

**Files:**
- Create: `scripts/dev/rebuild-test-deploy.ps1`
- Modify: `scripts/tests/test-rebuild-test-deploy.ps1`

- [ ] **Step 1: Add failing wrapper checks**

Append these checks inside `scripts/tests/test-rebuild-test-deploy.ps1`, after the orchestration tests and before `Write-TestPass`:

```powershell
    $wrapper = Join-Path $repoRoot 'scripts\dev\rebuild-test-deploy.ps1'
    Assert-True (Test-Path -LiteralPath $wrapper) 'wrapper exists'
    $wrapperText = Get-Content -LiteralPath $wrapper -Raw
    Assert-True ($wrapperText -match '\[switch\]\s+\$Build') 'wrapper exposes Build switch'
    Assert-True ($wrapperText -notmatch 'DryRun') 'wrapper does not expose DryRun'
```

Add `$repoRoot` near the top of the test file after imports:

```powershell
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-rebuild-test-deploy.ps1
```

Expected: FAIL because `scripts\dev\rebuild-test-deploy.ps1` does not exist.

- [ ] **Step 3: Create the wrapper**

Create directory and file:

```powershell
New-Item -ItemType Directory -Path scripts\dev -Force | Out-Null
```

Create `scripts/dev/rebuild-test-deploy.ps1` with this content:

```powershell
# scripts\dev\rebuild-test-deploy.ps1
# Build-only test deployment rebuild wrapper. The deployment launch path remains
# D:\Users\deploy\AI-bim-geo\scripts\deploy.ps1 -Build.

[CmdletBinding()]
param(
    [switch] $Build
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Build) {
    throw 'Usage: .\scripts\dev\rebuild-test-deploy.ps1 -Build'
}

. (Join-Path $PSScriptRoot '..\lib\rebuild-test-deploy.ps1')

$result = Invoke-TestDeployRebuild -Build

Write-Host "[rebuild-test-deploy] deployment_path=$($result.DeploymentPath)"
Write-Host "[rebuild-test-deploy] origin_main_commit=$($result.OriginMainCommit)"
Write-Host "[rebuild-test-deploy] removed_agent_tooling_count=$($result.RemovedAgentToolingCount)"
Write-Host "[rebuild-test-deploy] deploy_exit_code=$($result.DeployExitCode)"

exit $result.DeployExitCode
```

- [ ] **Step 4: Run tests**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-rebuild-test-deploy.ps1
```

Expected: PASS with `[PASS] rebuild-test-deploy`.

- [ ] **Step 5: Verify no dry-run syntax exists**

Run:

```powershell
rg -n "DryRun|dry-run|rebuild-test-deploy\.ps1 -DryRun" scripts\dev\rebuild-test-deploy.ps1 scripts\lib\rebuild-test-deploy.ps1 scripts\tests\test-rebuild-test-deploy.ps1
```

Expected: no matches and exit code 1.

- [ ] **Step 6: Commit**

Run:

```powershell
git add scripts/dev/rebuild-test-deploy.ps1 scripts/tests/test-rebuild-test-deploy.ps1
git commit -m "feat: 新增測試部署重建入口"
```

Expected: commit succeeds with only the wrapper and test update staged.

---

### Task 4: Update Agent Governance Docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/agents/product-operability-and-script-contract.md`
- Modify: `docs/agents/sub-repo-verify-commands.md`

- [ ] **Step 1: Update root `AGENTS.md`**

Replace the existing test deploy bullet with this exact text:

```markdown
- 當使用者要求「請測試部署區重建」或同義口令時，agent MUST 執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`；該 helper 會用 freshly fetched `origin/main` 重建 deployment checkout `D:\Users\deploy\AI-bim-geo`、排除 agent/tooling 檔案，並從部署區執行 `.\scripts\deploy.ps1 -Build`。禁止使用 `-DryRun`、禁止使用 stale `origin/main`、禁止改用當前 worktree 或 sub-repo 啟動命令。
```

- [ ] **Step 2: Update `CLAUDE.md` mirror**

Replace the existing test deploy bullet with this exact text:

```markdown
- 測試部署區重建口令固定執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`；helper 必須從 freshly fetched `origin/main` 重建 `D:\Users\deploy\AI-bim-geo`，排除 agent/tooling 檔案後由部署區執行 `.\scripts\deploy.ps1 -Build`。禁止 `-DryRun`。
```

- [ ] **Step 3: Update `docs/agents/product-operability-and-script-contract.md`**

In the "測試驗證部署環境" section, replace the block with:

```markdown
測試驗證部署環境：

- Deployment checkout 固定為 `D:\Users\deploy\AI-bim-geo`。
- 當使用者要求「請測試部署區重建」或同義口令時，MUST 從目前 repo 執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`。
- Helper MUST freshly fetch `origin main`；fetch 失敗時停止，不得使用 stale `origin/main`。
- Helper MUST 在 reset 前回報 deployment checkout local changes 摘要；重建口令代表部署區可被 reset / clean。
- Helper MUST 排除所有層級 `AGENTS.md` / `CLAUDE.md`，以及 root `.codex/`、`.agents/`、`.agent/`、`.claude/`、`.cursor/`、`.windsurf/`；MUST 保留 `.github/workflows/`。
- Helper 完成清理後 MUST 從 `D:\Users\deploy\AI-bim-geo` 執行 `.\scripts\deploy.ps1 -Build` 並回報 exit code / log path。
- 禁止 `-DryRun`；若 sandbox 需要寫入 `D:\Users\deploy\AI-bim-geo` 的 approval，agent 必須針對 build-only rebuild command 申請，不得改用其他路徑或 dry-run 替代。
```

- [ ] **Step 4: Update `docs/agents/sub-repo-verify-commands.md`**

Replace the test deployment command block with:

````markdown
測試部署區重建固定使用 build-only helper：

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

Helper 會重建 `D:\Users\deploy\AI-bim-geo` 並在部署區執行：

```powershell
cd D:\Users\deploy\AI-bim-geo
.\scripts\deploy.ps1 -Build
```

禁止 `-DryRun`。若 fetch `origin main` 失敗、approval 被拒、或清理後缺少 `scripts\deploy.ps1`，回報 blocker 並停止；不得部署 stale code。
````

- [ ] **Step 5: Verify docs contain the command and no helper dry-run**

Run:

```powershell
rg -n "rebuild-test-deploy\.ps1 -Build|禁止 `-DryRun`|stale `origin/main`" AGENTS.md CLAUDE.md docs/agents/product-operability-and-script-contract.md docs/agents/sub-repo-verify-commands.md
rg -n "rebuild-test-deploy\.ps1 -DryRun" AGENTS.md CLAUDE.md docs/agents/product-operability-and-script-contract.md docs/agents/sub-repo-verify-commands.md
```

Expected: first command finds the updated rules; second command has no matches and exit code 1.

- [ ] **Step 6: Commit**

Run:

```powershell
git add AGENTS.md CLAUDE.md docs/agents/product-operability-and-script-contract.md docs/agents/sub-repo-verify-commands.md
git commit -m "docs: 更新測試部署重建治理規則"
```

Expected: commit succeeds with only governance docs staged.

---

### Task 5: Validate And Run Build-Only Rebuild

**Files:**
- Validate: `scripts/lib/rebuild-test-deploy.ps1`
- Validate: `scripts/dev/rebuild-test-deploy.ps1`
- Validate: `scripts/tests/test-rebuild-test-deploy.ps1`
- Validate: agent governance docs

- [ ] **Step 1: Run script unit tests**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-rebuild-test-deploy.ps1
```

Expected: PASS with `[PASS] rebuild-test-deploy`.

- [ ] **Step 2: Run whitespace validation**

Run:

```powershell
git diff --check -- scripts/lib/rebuild-test-deploy.ps1 scripts/dev/rebuild-test-deploy.ps1 scripts/tests/test-rebuild-test-deploy.ps1 AGENTS.md CLAUDE.md docs/agents/product-operability-and-script-contract.md docs/agents/sub-repo-verify-commands.md
```

Expected: no whitespace errors.

- [ ] **Step 3: Run build-only rebuild**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\dev\rebuild-test-deploy.ps1 -Build
```

Expected:

- If sandbox blocks writes to `D:\Users\deploy\AI-bim-geo`, rerun the same command with escalation approval.
- If `git fetch origin main` fails, stop and report the fetch failure as blocker.
- If deploy exits nonzero, report deployment failure with `origin_main_commit`, `deploy_exit_code`, and the relevant `scripts\.run\deploy.log` path.
- If deploy exits zero, report that the environment was rebuilt from freshly fetched `origin/main` and launched through `D:\Users\deploy\AI-bim-geo\scripts\deploy.ps1 -Build`.

- [ ] **Step 4: Verify deployment checkout exclusions**

Run after Step 3 succeeds through rebuild cleanup:

```powershell
Test-Path -LiteralPath 'D:\Users\deploy\AI-bim-geo\.github\workflows'
Get-ChildItem -LiteralPath 'D:\Users\deploy\AI-bim-geo' -Recurse -Force -File -Filter AGENTS.md
Get-ChildItem -LiteralPath 'D:\Users\deploy\AI-bim-geo' -Recurse -Force -File -Filter CLAUDE.md
Test-Path -LiteralPath 'D:\Users\deploy\AI-bim-geo\.agent'
Test-Path -LiteralPath 'D:\Users\deploy\AI-bim-geo\.claude'
Test-Path -LiteralPath 'D:\Users\deploy\AI-bim-geo\scripts\deploy.ps1'
```

Expected:

- `.github\workflows` returns `True` when present in `origin/main`.
- AGENTS / CLAUDE file searches return no paths.
- `.agent` and `.claude` return `False`.
- `scripts\deploy.ps1` returns `True`.

- [ ] **Step 5: Final scope check**

Run:

```powershell
git status --short
git log --oneline -5
```

Expected:

- Source repo has only intentional implementation changes.
- Deployment checkout changes are not staged or committed in source repo.

- [ ] **Step 6: Commit validation-related fixes if any**

If Step 1-5 required small source fixes, stage only those files and commit:

```powershell
git add scripts/lib/rebuild-test-deploy.ps1 scripts/dev/rebuild-test-deploy.ps1 scripts/tests/test-rebuild-test-deploy.ps1 AGENTS.md CLAUDE.md docs/agents/product-operability-and-script-contract.md docs/agents/sub-repo-verify-commands.md
git commit -m "fix: 強化測試部署重建驗證"
```

Expected: no commit is created when there are no additional source changes.

---

## Self-Review

Spec coverage:

- Build-only execution is covered by Task 3 wrapper checks and Task 4 docs.
- Fixed deployment path and exact-path safety are covered by Task 1 tests and library.
- Agent/tooling exclusion policy is covered by Task 1 tests and Task 4 docs.
- Fresh `origin/main` fetch and stale-code blocker are covered by Task 2 orchestration and Task 4 docs.
- Local deployment changes discard reporting is covered by Task 2 orchestration.
- Broken `origin/main` deploy code handling is covered by Task 5 reporting requirements.

Placeholder scan:

- The plan contains no unfinished marker text and no dry-run execution path.

Type consistency:

- Function names are consistent across tasks: `Assert-TestDeployPath`, `Remove-TestDeployAgentTooling`, `Invoke-TestDeployGitCommand`, `Invoke-TestDeployRebuild`.
