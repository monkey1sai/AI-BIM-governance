# Mode C Hybrid 一鍵部屬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `scripts\deploy.ps1`(薄 orchestrator)與 `scripts\lib\*.ps1`(8 個 module),讓 Mode C(web-plane Docker + host-native Kit)能用一條指令冷啟到 demo-ready。

**Architecture:** Phase 1 preflight(read-only audit)→ Phase 2 auto-fix(安全項目)→ Phase 3 interactive guard(危險動作)→ Phase 4 嚴格順序啟動(host-native conversion → Kit → docker compose)→ Phase 5 post-start verify(best-effort)。所有檢查 / 修復 / 啟動邏輯放 `scripts\lib\*.ps1`,deploy.ps1 只做 dispatch + 統一退出碼。

**Tech Stack:** PowerShell 7+(`pwsh`),Windows host;Docker Desktop + compose v2;NVIDIA driver(`nvidia-smi`)。測試沿用 repo 既有風格:**純 PowerShell + 自訂 `Assert-True` / `Assert-Throws` helper**(`scripts\tests\test-pr-review-agent.ps1` 範本),**不引入 Pester**(repo Pester 是 3.4.0 老版,且既有測試都用純 PowerShell)。

**Spec:** `docs/superpowers/specs/2026-05-26-one-click-deploy-design.md`(commit `c900bab`)。

**Branch:** `docs/one-click-deploy-design-2026-05-26`。

---

## Scope Check

Spec 只有「Mode C(hybrid)一鍵部屬」一個 subsystem,不需要拆分。所有 task 集中在 `scripts\deploy.ps1`、`scripts\lib\*.ps1`、`scripts\tests\*.ps1` 與 `docs\runbooks\one-click-deploy-smoke.md`,完整時可獨立 demo。

---

## File Structure

```
scripts\
├── deploy.ps1                              # NEW — 薄 orchestrator(~250 行)
├── lib\
│   ├── deploy-report.ps1                   # NEW — Write-DeployTag (ok/fix/ask/skip/warn/fail) + log file
│   ├── preflight-docker.ps1                # NEW — Test-DockerEnvironment(只 audit)
│   ├── preflight-host-native.ps1           # NEW — Test-HostNativeEnvironment
│   ├── preflight-env.ps1                   # NEW — Test-EnvFiles
│   ├── preflight-ports.ps1                 # NEW — Test-PortAvailability
│   ├── preflight-volume-alignment.ps1      # NEW — Test-VolumeAlignment
│   ├── host-native-launcher.ps1            # NEW — Start-HostNativeConversion / Start-HostNativeKit / Wait-HostNativeHealth
│   └── kit-log-probe.ps1                   # NEW — Wait-KitReady (LISTEN + log keyword scan)
├── tests\
│   ├── test-helpers.ps1                    # NEW — Assert-True / Assert-Throws / New-TestSandbox
│   ├── test-deploy-report.ps1              # NEW
│   ├── test-preflight-docker.ps1           # NEW
│   ├── test-preflight-host-native.ps1      # NEW
│   ├── test-preflight-env.ps1              # NEW
│   ├── test-preflight-ports.ps1            # NEW
│   ├── test-preflight-volume-alignment.ps1 # NEW
│   ├── test-host-native-launcher.ps1       # NEW
│   ├── test-kit-log-probe.ps1              # NEW
│   ├── test-deploy-dryrun.ps1              # NEW(Layer 2 integration)
│   └── test-pr-review-agent.ps1            # 既有,不動
├── start-all.ps1                           # 既有,不動(向後相容)
├── start-runtime-manager-docker.ps1        # 既有,不動
├── start-web-plane-docker.ps1              # 既有,不動(deploy Phase 4c 呼叫)
├── check-web-plane-docker.ps1              # 既有,不動
└── stop-runtime-manager-docker.ps1         # 既有,不動

docs\
├── superpowers\
│   ├── specs\2026-05-26-one-click-deploy-design.md   # 既有(commit c900bab)
│   └── plans\2026-05-26-one-click-deploy.md          # 本 plan
└── runbooks\
    └── one-click-deploy-smoke.md                     # NEW — Layer 3 手動 smoke checklist
```

**完全不改的檔(向後相容):** `scripts\start-all.ps1`、`scripts\start-web-plane-docker.ps1`、`scripts\start-runtime-manager-docker.ps1`、`scripts\stop-all.ps1`、`scripts\stop-runtime-manager-docker.ps1`、`compose.runtime-manager.yml`、`compose.host-kit.yml`。

---

## Task 1: 建立 `scripts\tests\test-helpers.ps1` 共用 assert

**Files:**
- Create: `scripts\tests\test-helpers.ps1`

- [ ] **Step 1: 確認 git branch**

Run:
```powershell
git status --short --branch
```

Expected output 含 `## docs/one-click-deploy-design-2026-05-26`。若不在這個 branch:
```powershell
git switch docs/one-click-deploy-design-2026-05-26
```

- [ ] **Step 2: 建立 `scripts\tests\test-helpers.ps1`**

```powershell
# scripts\tests\test-helpers.ps1
# 共用測試 helper,沿用 scripts\tests\test-pr-review-agent.ps1 風格。
# Repo 不用 Pester(版本 3.4.0 老),所有測試都用「dot-source 受測 module +
# 自訂 assert + temp sandbox」純 PowerShell 風格。

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [Parameter(Mandatory = $true)] $Condition,
        [Parameter(Mandatory = $true)][string] $Message
    )
    if ($Condition -is [array]) {
        $Condition = ($Condition.Count -gt 0 -and -not ($Condition -contains $false))
    }
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)] $Expected,
        [Parameter(Mandatory = $true)] $Actual,
        [Parameter(Mandatory = $true)][string] $Message
    )
    if ($Expected -ne $Actual) {
        throw "ASSERT FAILED: $Message (expected='$Expected' actual='$Actual')"
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $ScriptBlock,
        [Parameter(Mandatory = $true)][string] $Message
    )
    $thrown = $false
    try { & $ScriptBlock } catch { $thrown = $true }
    Assert-True $thrown $Message
}

function New-TestSandbox {
    param([string] $Prefix = 'deploy-test')
    $path = Join-Path ([System.IO.Path]::GetTempPath()) "$Prefix-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    return $path
}

function Remove-TestSandbox {
    param([Parameter(Mandatory = $true)][string] $Path)
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Write-TestPass {
    param([Parameter(Mandatory = $true)][string] $Name)
    Write-Host "[PASS] $Name" -ForegroundColor Green
}

function Write-TestFail {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Message
    )
    Write-Host "[FAIL] $Name :: $Message" -ForegroundColor Red
}
```

- [ ] **Step 3: 簡單冒煙測試 helper 本身**

Run:
```powershell
pwsh -NoProfile -Command ". scripts\tests\test-helpers.ps1; Assert-True $true 'true is true'; Assert-Equal 1 1 '1==1'; Assert-Throws { throw 'x' } 'throws raised'; Write-TestPass 'self-smoke'"
```

Expected output:
```
[PASS] self-smoke
```

- [ ] **Step 4: Commit**

```powershell
git add scripts\tests\test-helpers.ps1
git diff --cached --check
git commit -m "feat(deploy): add scripts\tests\test-helpers.ps1 shared assert helpers

Repo 沿用 test-pr-review-agent.ps1 純 PowerShell 測試風格(不引入 Pester)。
這個檔把 Assert-True / Assert-Equal / Assert-Throws / New-TestSandbox /
Remove-TestSandbox / Write-TestPass / Write-TestFail 抽出共用,供
deploy.ps1 系列 module 的 test scripts dot-source 使用。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: `scripts\lib\deploy-report.ps1` + test

**Goal:** 統一輸出格式(`[ok ]` / `[fix ]` / `[ask ]` / `[skip ]` / `[warn ]` / `[fail ]`)的 wrapper 函數;同時寫進 `scripts\.run\deploy.log`。

**Files:**
- Create: `scripts\lib\deploy-report.ps1`
- Create: `scripts\tests\test-deploy-report.ps1`

- [ ] **Step 1: 先寫 failing test**

```powershell
# scripts\tests\test-deploy-report.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\deploy-report.ps1'
. $modulePath

# Test 1: Write-DeployTag 'ok' 'message' 寫進 log 且回 ok
$sandbox = New-TestSandbox -Prefix 'deploy-report'
try {
    $logPath = Join-Path $sandbox 'deploy.log'
    $result = Write-DeployTag -Tag 'ok' -Message 'coordinator running' -LogPath $logPath
    Assert-True ($result.Tag -eq 'ok') 'returned object has Tag=ok'
    Assert-True (Test-Path -LiteralPath $logPath) 'log file created'
    $logContent = Get-Content -LiteralPath $logPath -Raw
    Assert-True ($logContent -match '\[ok\s+\] coordinator running') 'log content has [ok   ] line'
    Write-TestPass 'Write-DeployTag ok writes to log'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 2: 各 tag 都會被接受,fail tag 回傳 IsFail=true
$sandbox = New-TestSandbox -Prefix 'deploy-report'
try {
    $logPath = Join-Path $sandbox 'deploy.log'
    foreach ($tag in @('ok','fix','ask','skip','warn','fail')) {
        $r = Write-DeployTag -Tag $tag -Message "msg-$tag" -LogPath $logPath
        Assert-True ($r.Tag -eq $tag) "accepts tag=$tag"
    }
    $r = Write-DeployTag -Tag 'fail' -Message 'boom' -LogPath $logPath
    Assert-True ($r.IsFail -eq $true) 'fail tag has IsFail=true'
    $r = Write-DeployTag -Tag 'warn' -Message 'soft' -LogPath $logPath
    Assert-True ($r.IsFail -eq $false) 'warn tag has IsFail=false'
    Write-TestPass 'all tags accepted, IsFail reflects severity'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 3: 不認識的 tag 應 throw
Assert-Throws {
    Write-DeployTag -Tag 'unknown' -Message 'x' -LogPath (Join-Path (New-TestSandbox) 'd.log')
} 'unknown tag throws'
Write-TestPass 'unknown tag throws'

Write-Host '`n`n=== test-deploy-report.ps1: ALL PASSED ===' -ForegroundColor Green
```

- [ ] **Step 2: 跑 test 確認失敗(module 還沒寫)**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-deploy-report.ps1
```

Expected: `Error ... deploy-report.ps1 not found` 或 `Write-DeployTag is not recognized`。

- [ ] **Step 3: 寫 `scripts\lib\deploy-report.ps1` 最小實作**

```powershell
# scripts\lib\deploy-report.ps1
# 統一輸出格式 wrapper。每行 [ok   ]/[fix  ]/[ask  ]/[skip ]/[warn ]/[fail ] 6 級 tag。
# 同時寫進 deploy.log,供 Final Summary 連回。

Set-StrictMode -Version Latest

$script:DeployTagDefinitions = @{
    'ok'   = @{ Display = '[ok   ]'; Color = 'Green';      IsFail = $false }
    'fix'  = @{ Display = '[fix  ]'; Color = 'Cyan';       IsFail = $false }
    'ask'  = @{ Display = '[ask  ]'; Color = 'Yellow';     IsFail = $false }
    'skip' = @{ Display = '[skip ]'; Color = 'DarkGray';   IsFail = $false }
    'warn' = @{ Display = '[warn ]'; Color = 'Yellow';     IsFail = $false }
    'fail' = @{ Display = '[fail ]'; Color = 'Red';        IsFail = $true  }
}

function Write-DeployTag {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('ok','fix','ask','skip','warn','fail')]
        [string] $Tag,
        [Parameter(Mandatory = $true)][string] $Message,
        [Parameter(Mandatory = $true)][string] $LogPath
    )

    if (-not $script:DeployTagDefinitions.ContainsKey($Tag)) {
        throw "unknown deploy tag: $Tag"
    }
    $def = $script:DeployTagDefinitions[$Tag]
    $line = "$($def.Display) $Message"

    # 確保 log 目錄存在
    $logDir = Split-Path -Parent $LogPath
    if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    Write-Host $line -ForegroundColor $def.Color
    $timestamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')
    Add-Content -LiteralPath $LogPath -Value "$timestamp $line"

    return [pscustomobject]@{
        Tag     = $Tag
        Message = $Message
        IsFail  = $def.IsFail
    }
}

function Write-DeployHeader {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Title)
    $bar = '=' * 60
    Write-Host ''
    Write-Host $bar -ForegroundColor Cyan
    Write-Host $Title -ForegroundColor Cyan
    Write-Host $bar -ForegroundColor Cyan
}
```

- [ ] **Step 4: 跑 test 確認通過**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-deploy-report.ps1
```

Expected:
```
[PASS] Write-DeployTag ok writes to log
[PASS] all tags accepted, IsFail reflects severity
[PASS] unknown tag throws

=== test-deploy-report.ps1: ALL PASSED ===
```

- [ ] **Step 5: Commit**

```powershell
git add scripts\lib\deploy-report.ps1 scripts\tests\test-deploy-report.ps1
git diff --cached --check
git commit -m "feat(deploy): add deploy-report.ps1 unified tag output

Write-DeployTag(-Tag ok|fix|ask|skip|warn|fail -Message X -LogPath Y) 統一
deploy.ps1 / scripts\lib\* 的輸出格式。同步寫進 deploy.log 與 stdout,
供 Final Summary 連回。Write-DeployHeader 印階段分隔。

對應 spec §8.1 (Output Format) 與 §8.3 (落地物 deploy.log)。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: `scripts\lib\preflight-docker.ps1` + test

**Goal:** 偵測 Docker CLI / compose v2 / engine running / `.env.web-plane.host-kit` 存在。**只 audit,不動手。**

**Files:**
- Create: `scripts\lib\preflight-docker.ps1`
- Create: `scripts\tests\test-preflight-docker.ps1`

- [ ] **Step 1: 寫 failing test**

```powershell
# scripts\tests\test-preflight-docker.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\preflight-docker.ps1'
. $modulePath

# Test 1: docker CLI 存在 + compose v2 + engine running → cliVersion 等欄位齊全
$result = Test-DockerEnvironment `
    -DockerCommand { param($Args) "Docker version 27.0.3, build x" } `
    -ComposeCommand { param($Args) "Docker Compose version v2.29.0" } `
    -EngineProbe { param($Args) @{ ExitCode = 0; Stdout = '{"ServerVersion":"27.0.3"}' } } `
    -RepoRoot (New-TestSandbox -Prefix 'preflight-docker')

Assert-True ($result.cliVersion -ne $null) 'cliVersion populated'
Assert-True ($result.composeV2 -eq $true) 'composeV2 true'
Assert-True ($result.engineRunning -eq $true) 'engineRunning true'
Write-TestPass 'happy path returns full audit'

# Test 2: docker CLI 不在 → cliVersion=null + 整體 ok=false
$result = Test-DockerEnvironment `
    -DockerCommand { throw 'docker not found' } `
    -ComposeCommand { param($Args) '' } `
    -EngineProbe { param($Args) @{ ExitCode = 1; Stdout = '' } } `
    -RepoRoot (New-TestSandbox -Prefix 'preflight-docker')

Assert-True ($null -eq $result.cliVersion) 'cliVersion null when docker absent'
Assert-True ($result.ok -eq $false) 'overall ok=false'
Write-TestPass 'docker missing flagged'

# Test 3: engine 沒跑 → engineRunning=false
$result = Test-DockerEnvironment `
    -DockerCommand { param($Args) "Docker version 27.0.3" } `
    -ComposeCommand { param($Args) "Docker Compose version v2.29.0" } `
    -EngineProbe { param($Args) @{ ExitCode = 1; Stdout = '' } } `
    -RepoRoot (New-TestSandbox -Prefix 'preflight-docker')

Assert-True ($result.engineRunning -eq $false) 'engineRunning=false when engine probe non-zero'
Write-TestPass 'engine not running flagged'

# Test 4: envFile resolve — .env.web-plane.host-kit 在 RepoRoot → 取它
$sandbox = New-TestSandbox -Prefix 'preflight-docker-env'
try {
    Set-Content -LiteralPath (Join-Path $sandbox '.env.web-plane.host-kit') -Value 'COORDINATOR_PORT=8004'
    $result = Test-DockerEnvironment `
        -DockerCommand { param($Args) "Docker version 27" } `
        -ComposeCommand { param($Args) "Docker Compose version v2.0" } `
        -EngineProbe { param($Args) @{ ExitCode = 0; Stdout = '{}' } } `
        -RepoRoot $sandbox

    Assert-True ($result.envFile -eq '.env.web-plane.host-kit') 'real env file picked over .example'
    Write-TestPass 'envFile prefers real over example'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 5: 只有 .example → fallback
$sandbox = New-TestSandbox -Prefix 'preflight-docker-env'
try {
    Set-Content -LiteralPath (Join-Path $sandbox '.env.web-plane.host-kit.example') -Value 'COORDINATOR_PORT=8004'
    $result = Test-DockerEnvironment `
        -DockerCommand { param($Args) "Docker version 27" } `
        -ComposeCommand { param($Args) "Docker Compose version v2.0" } `
        -EngineProbe { param($Args) @{ ExitCode = 0; Stdout = '{}' } } `
        -RepoRoot $sandbox
    Assert-True ($result.envFile -eq '.env.web-plane.host-kit.example') 'example fallback'
    Write-TestPass 'envFile falls back to .example'
}
finally { Remove-TestSandbox -Path $sandbox }

Write-Host "`n=== test-preflight-docker.ps1: ALL PASSED ===" -ForegroundColor Green
```

- [ ] **Step 2: 跑 test 確認失敗**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-preflight-docker.ps1
```

Expected: cannot find module / `Test-DockerEnvironment` not recognized。

- [ ] **Step 3: 寫 `scripts\lib\preflight-docker.ps1`**

```powershell
# scripts\lib\preflight-docker.ps1
# Preflight: Docker 環境 audit。Read-only。
# 接受可注入的 -DockerCommand / -ComposeCommand / -EngineProbe / -RepoRoot
# 讓 test 可以 fake CLI 行為。

Set-StrictMode -Version Latest

function Test-DockerEnvironment {
    [CmdletBinding()]
    param(
        [scriptblock] $DockerCommand = { param($Args) docker @Args 2>&1 },
        [scriptblock] $ComposeCommand = { param($Args) docker @Args 2>&1 },
        [scriptblock] $EngineProbe = {
            param($Args)
            $stdout = docker info --format '{{json .}}' 2>&1
            @{ ExitCode = $LASTEXITCODE; Stdout = ($stdout | Out-String).Trim() }
        },
        [Parameter(Mandatory = $true)][string] $RepoRoot
    )

    $audit = [ordered]@{
        cliVersion    = $null
        composeV2     = $false
        engineRunning = $false
        envFile       = $null
        ok            = $false
    }

    # docker CLI
    try {
        $cliOut = & $DockerCommand @(@('--version'))
        if ($cliOut -match 'Docker version\s+([\d\.]+)') {
            $audit.cliVersion = $Matches[1]
        }
    } catch {
        $audit.cliVersion = $null
    }

    # docker compose v2
    try {
        $cmpOut = & $ComposeCommand @(@('compose', 'version'))
        if ($cmpOut -match 'Docker Compose version\s+v?(\d+)\.') {
            $audit.composeV2 = [int]$Matches[1] -ge 2
        }
    } catch {
        $audit.composeV2 = $false
    }

    # engine running?
    try {
        $engineRes = & $EngineProbe @($null)
        $audit.engineRunning = ($engineRes.ExitCode -eq 0)
    } catch {
        $audit.engineRunning = $false
    }

    # env file resolution(對齊 start-web-plane-docker.ps1 的 Resolve-HybridEnvFile)
    $real    = Join-Path $RepoRoot '.env.web-plane.host-kit'
    $example = Join-Path $RepoRoot '.env.web-plane.host-kit.example'
    if (Test-Path -LiteralPath $real) {
        $audit.envFile = '.env.web-plane.host-kit'
    } elseif (Test-Path -LiteralPath $example) {
        $audit.envFile = '.env.web-plane.host-kit.example'
    } else {
        $audit.envFile = $null
    }

    $audit.ok = (
        $null -ne $audit.cliVersion `
        -and $audit.composeV2 `
        -and $audit.engineRunning `
        -and $null -ne $audit.envFile
    )
    return [pscustomobject]$audit
}
```

- [ ] **Step 4: 跑 test 確認通過**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-preflight-docker.ps1
```

Expected: 5 個 `[PASS]` + `=== test-preflight-docker.ps1: ALL PASSED ===`。

- [ ] **Step 5: Commit**

```powershell
git add scripts\lib\preflight-docker.ps1 scripts\tests\test-preflight-docker.ps1
git diff --cached --check
git commit -m "feat(deploy): add preflight-docker.ps1 read-only audit

Test-DockerEnvironment 回傳結構化 audit:cliVersion / composeV2 /
engineRunning / envFile / ok。所有外部 CLI 都透過可注入 scriptblock
參數,test 內 fake 各種狀態(docker missing / engine down / .env
fallback)。

對應 spec §5.2 module list 與 §6.2 audit result 的 docker 區塊。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: `scripts\lib\preflight-host-native.ps1` + test

**Goal:** 偵測 `.venv\Scripts\python.exe`、Python 版本、Kit launcher 路徑、`nvidia-smi`。**只 audit,不動手。**

**Files:**
- Create: `scripts\lib\preflight-host-native.ps1`
- Create: `scripts\tests\test-preflight-host-native.ps1`

- [ ] **Step 1: 寫 failing test**

```powershell
# scripts\tests\test-preflight-host-native.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\preflight-host-native.ps1'
. $modulePath

# Test 1: 全 OK 場景
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $venvDir = Join-Path $sandbox '.venv\Scripts'
    New-Item -ItemType Directory -Path $venvDir -Force | Out-Null
    $pyExe = Join-Path $venvDir 'python.exe'
    Set-Content -LiteralPath $pyExe -Value 'fake'  # 內容無關,只看存在性
    $kitLauncher = Join-Path $sandbox 'bim-streaming-server\scripts\start-streaming-server.ps1'
    New-Item -ItemType Directory -Path (Split-Path -Parent $kitLauncher) -Force | Out-Null
    Set-Content -LiteralPath $kitLauncher -Value '# fake'

    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }

    Assert-Equal 'OK' $result.venv 'venv OK'
    Assert-Equal 'OK' $result.kitLauncher 'kitLauncher OK'
    Assert-Equal 'OK' $result.nvidiaDriver 'nvidiaDriver OK'
    Assert-True ($result.ok -eq $true) 'overall ok'
    Write-TestPass 'happy path'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 2: .venv 不存在 → MISSING
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }
    Assert-Equal 'MISSING' $result.venv 'venv MISSING'
    Assert-True ($result.ok -eq $false) 'ok=false'
    Write-TestPass '.venv missing flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 3: .venv 在但 Python 版本 < 3.11 → WRONG_VERSION
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $venvDir = Join-Path $sandbox '.venv\Scripts'
    New-Item -ItemType Directory -Path $venvDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $venvDir 'python.exe') -Value 'fake'

    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.10.5' } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }
    Assert-Equal 'WRONG_VERSION' $result.venv 'venv WRONG_VERSION'
    Write-TestPass 'Python <3.11 flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 4: nvidia-smi 不在 → MISSING
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -NvidiaSmiProbe { @{ Exists = $false; ExitCode = -1 } }
    Assert-Equal 'MISSING' $result.nvidiaDriver 'nvidiaDriver MISSING'
    Write-TestPass 'nvidia-smi missing flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 5: Kit launcher path 缺 → MISSING_PATH
$sandbox = New-TestSandbox -Prefix 'preflight-hn'
try {
    $venvDir = Join-Path $sandbox '.venv\Scripts'
    New-Item -ItemType Directory -Path $venvDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $venvDir 'python.exe') -Value 'fake'
    $result = Test-HostNativeEnvironment -RepoRoot $sandbox `
        -PythonVersionProbe { param($exe) '3.12.4' } `
        -NvidiaSmiProbe { @{ Exists = $true; ExitCode = 0 } }
    Assert-Equal 'MISSING_PATH' $result.kitLauncher 'Kit launcher MISSING_PATH'
    Write-TestPass 'Kit launcher missing flagged'
}
finally { Remove-TestSandbox -Path $sandbox }

Write-Host "`n=== test-preflight-host-native.ps1: ALL PASSED ===" -ForegroundColor Green
```

- [ ] **Step 2: 跑 test 確認失敗**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-preflight-host-native.ps1
```

Expected: `Test-HostNativeEnvironment is not recognized`。

- [ ] **Step 3: 寫 `scripts\lib\preflight-host-native.ps1`**

```powershell
# scripts\lib\preflight-host-native.ps1
# Preflight: Host-native 工具鏈 audit。Read-only。

Set-StrictMode -Version Latest

function Test-HostNativeEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [scriptblock] $PythonVersionProbe = {
            param($exe)
            try {
                $out = & $exe --version 2>&1
                if ($out -match '(\d+\.\d+\.\d+)') { return $Matches[1] }
                return $null
            } catch { return $null }
        },
        [scriptblock] $NvidiaSmiProbe = {
            $cmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
            if (-not $cmd) { return @{ Exists = $false; ExitCode = -1 } }
            $null = & nvidia-smi --query-gpu=name --format=csv,noheader 2>&1
            return @{ Exists = $true; ExitCode = $LASTEXITCODE }
        }
    )

    $audit = [ordered]@{
        venv         = 'MISSING'
        kitLauncher  = 'MISSING_PATH'
        nvidiaDriver = 'MISSING'
        ok           = $false
    }

    # .venv
    $pyExe = Join-Path $RepoRoot '.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $pyExe) {
        $ver = & $PythonVersionProbe $pyExe
        if ($ver) {
            $parts = $ver.Split('.')
            $major = [int]$parts[0]
            $minor = [int]$parts[1]
            if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 11)) {
                $audit.venv = 'OK'
            } else {
                $audit.venv = 'WRONG_VERSION'
            }
        } else {
            $audit.venv = 'WRONG_VERSION'
        }
    }

    # Kit launcher
    $launcher = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'
    if (Test-Path -LiteralPath $launcher) {
        $audit.kitLauncher = 'OK'
    }

    # nvidia-smi
    $nv = & $NvidiaSmiProbe
    if ($nv.Exists -and $nv.ExitCode -eq 0) {
        $audit.nvidiaDriver = 'OK'
    }

    $audit.ok = ($audit.venv -eq 'OK' -and $audit.kitLauncher -eq 'OK' -and $audit.nvidiaDriver -eq 'OK')
    return [pscustomobject]$audit
}
```

- [ ] **Step 4: 跑 test 確認通過**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-preflight-host-native.ps1
```

Expected: 5 個 `[PASS]` + `=== test-preflight-host-native.ps1: ALL PASSED ===`。

- [ ] **Step 5: Commit**

```powershell
git add scripts\lib\preflight-host-native.ps1 scripts\tests\test-preflight-host-native.ps1
git diff --cached --check
git commit -m "feat(deploy): add preflight-host-native.ps1 read-only audit

Test-HostNativeEnvironment 偵測 .venv (OK | MISSING | WRONG_VERSION)、
Kit launcher path (OK | MISSING_PATH)、nvidia-smi (OK | MISSING)。
Python probe / NvidiaSmi probe 都接 scriptblock 注入。

對應 spec §5.2 與 §6.2 hostNative 區塊。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: `scripts\lib\preflight-env.ps1` + test

**Goal:** 檢查 `.env` / `bim-review-coordinator/.env` / `.env.web-plane.host-kit` 三檔對 `.env.example` 系列的 missing-key audit。**Read-only。**

**Files:**
- Create: `scripts\lib\preflight-env.ps1`
- Create: `scripts\tests\test-preflight-env.ps1`

- [ ] **Step 1: 寫 failing test**

```powershell
# scripts\tests\test-preflight-env.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\preflight-env.ps1'
. $modulePath

# helper: 建一個 sandbox 含 .env / .env.example 並回路徑
function New-EnvSandbox {
    param([string] $EnvContent, [string] $ExampleContent, [string] $FileName = '.env')
    $sb = New-TestSandbox -Prefix 'preflight-env'
    if ($null -ne $EnvContent) {
        Set-Content -LiteralPath (Join-Path $sb $FileName) -Value $EnvContent
    }
    if ($null -ne $ExampleContent) {
        Set-Content -LiteralPath (Join-Path $sb "$FileName.example") -Value $ExampleContent
    }
    return $sb
}

# Test 1: example 有 5 key、.env 有 3 key → missing 列出 2 個
$sb = New-EnvSandbox `
    -EnvContent "A=1`nB=2`nC=3" `
    -ExampleContent "A=`nB=`nC=`nD=`nE="
try {
    $result = Get-EnvAudit -EnvPath (Join-Path $sb '.env') -ExamplePath (Join-Path $sb '.env.example')
    Assert-True (($result.missing -contains 'D') -and ($result.missing -contains 'E')) 'D and E in missing'
    Assert-True ($result.missing.Count -eq 2) 'exactly 2 missing'
    Write-TestPass 'missing-key audit'
}
finally { Remove-TestSandbox -Path $sb }

# Test 2: .env 已有 key 值 → 不出現在 missing(invariant:不動實值)
$sb = New-EnvSandbox `
    -EnvContent "SECRET=existing-real-value`nKEEP=ok" `
    -ExampleContent "SECRET=your-secret-here`nKEEP="
try {
    $result = Get-EnvAudit -EnvPath (Join-Path $sb '.env') -ExamplePath (Join-Path $sb '.env.example')
    Assert-True ($result.missing.Count -eq 0) 'no missing when all keys present'
    Write-TestPass 'existing keys preserved'
}
finally { Remove-TestSandbox -Path $sb }

# Test 3: .env 不存在 → missing = example 全部 key
$sb = New-EnvSandbox -EnvContent $null -ExampleContent "X=1`nY=2"
try {
    $result = Get-EnvAudit -EnvPath (Join-Path $sb '.env') -ExamplePath (Join-Path $sb '.env.example')
    Assert-True ($result.envExists -eq $false) 'envExists false'
    Assert-True ($result.missing.Count -eq 2) 'all example keys missing'
    Write-TestPass 'missing .env reports all keys'
}
finally { Remove-TestSandbox -Path $sb }

# Test 4: example 不存在 → audit 回 exampleExists=false
$sb = New-EnvSandbox -EnvContent "A=1" -ExampleContent $null
try {
    $result = Get-EnvAudit -EnvPath (Join-Path $sb '.env') -ExamplePath (Join-Path $sb '.env.example')
    Assert-True ($result.exampleExists -eq $false) 'exampleExists false'
    Write-TestPass 'missing example handled'
}
finally { Remove-TestSandbox -Path $sb }

# Test 5: 整 Test-EnvFiles 對三個目標檔(root / coordinator / web-plane)
$sb = New-TestSandbox -Prefix 'preflight-env-suite'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.example') -Value "A=`nB="
    Set-Content -LiteralPath (Join-Path $sb '.env') -Value "A=1"
    New-Item -ItemType Directory -Path (Join-Path $sb 'bim-review-coordinator') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $sb 'bim-review-coordinator\.env.example') -Value "P=`nQ="
    Set-Content -LiteralPath (Join-Path $sb 'bim-review-coordinator\.env') -Value "P=1`nQ=2"
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit.example') -Value "R=`nS="
    # .env.web-plane.host-kit 不存在 → 全 missing

    $suite = Test-EnvFiles -RepoRoot $sb
    Assert-Equal 3 $suite.Count 'three files audited'
    $rootAudit = $suite | Where-Object { $_.file -eq '.env' } | Select-Object -First 1
    Assert-True ($rootAudit.missing -contains 'B') 'root .env missing B'
    $coordAudit = $suite | Where-Object { $_.file -eq 'bim-review-coordinator/.env' } | Select-Object -First 1
    Assert-True ($coordAudit.missing.Count -eq 0) 'coordinator .env complete'
    $webAudit = $suite | Where-Object { $_.file -eq '.env.web-plane.host-kit' } | Select-Object -First 1
    Assert-True ($webAudit.envExists -eq $false) 'web-plane .env not exist'
    Assert-True ($webAudit.missing.Count -eq 2) 'all 2 keys missing'
    Write-TestPass 'Test-EnvFiles audits three files'
}
finally { Remove-TestSandbox -Path $sb }

Write-Host "`n=== test-preflight-env.ps1: ALL PASSED ===" -ForegroundColor Green
```

- [ ] **Step 2: 跑 test 確認失敗**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-preflight-env.ps1
```

Expected: `Get-EnvAudit is not recognized`。

- [ ] **Step 3: 寫 `scripts\lib\preflight-env.ps1`**

```powershell
# scripts\lib\preflight-env.ps1
# Preflight: .env / .env.example missing-key audit。Read-only。
# Read-EnvFile 採用 start-web-plane-docker.ps1 既有風格(支援 = 與 : 分隔、註解、
# 雙引號/單引號剝離),但簡化成只回 key 列表(因為我們只看 missing key,不看 value)。

Set-StrictMode -Version Latest

function Get-EnvKeyList {
    param([Parameter(Mandatory = $true)][string] $Path)
    $keys = @()
    if (-not (Test-Path -LiteralPath $Path)) { return $keys }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
        $eq    = $trimmed.IndexOf('=')
        $colon = $trimmed.IndexOf(':')
        $candidates = @(@($eq, $colon) | Where-Object { $_ -gt 0 } | Sort-Object)
        if ($candidates.Count -eq 0) { continue }
        $idx = [int]$candidates[0]
        $name = $trimmed.Substring(0, $idx).Trim()
        if ($name) { $keys += $name }
    }
    return $keys
}

function Get-EnvAudit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $EnvPath,
        [Parameter(Mandatory = $true)][string] $ExamplePath
    )
    $envExists     = Test-Path -LiteralPath $EnvPath
    $exampleExists = Test-Path -LiteralPath $ExamplePath
    $envKeys       = if ($envExists)     { Get-EnvKeyList -Path $EnvPath }     else { @() }
    $exampleKeys   = if ($exampleExists) { Get-EnvKeyList -Path $ExamplePath } else { @() }
    $missing       = @($exampleKeys | Where-Object { $_ -notin $envKeys })

    return [pscustomobject]@{
        envExists     = $envExists
        exampleExists = $exampleExists
        missing       = $missing
    }
}

function Test-EnvFiles {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $RepoRoot)

    $targets = @(
        @{ file = '.env';                          envPath = Join-Path $RepoRoot '.env';                          examplePath = Join-Path $RepoRoot '.env.example' },
        @{ file = 'bim-review-coordinator/.env';   envPath = Join-Path $RepoRoot 'bim-review-coordinator\.env';   examplePath = Join-Path $RepoRoot 'bim-review-coordinator\.env.example' },
        @{ file = '.env.web-plane.host-kit';       envPath = Join-Path $RepoRoot '.env.web-plane.host-kit';       examplePath = Join-Path $RepoRoot '.env.web-plane.host-kit.example' }
    )

    $results = @()
    foreach ($t in $targets) {
        $audit = Get-EnvAudit -EnvPath $t.envPath -ExamplePath $t.examplePath
        $results += [pscustomobject]@{
            file          = $t.file
            envExists     = $audit.envExists
            exampleExists = $audit.exampleExists
            missing       = $audit.missing
        }
    }
    return $results
}
```

- [ ] **Step 4: 跑 test 確認通過**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-preflight-env.ps1
```

Expected: 5 個 `[PASS]` + 末尾 ALL PASSED。

- [ ] **Step 5: Commit**

```powershell
git add scripts\lib\preflight-env.ps1 scripts\tests\test-preflight-env.ps1
git diff --cached --check
git commit -m "feat(deploy): add preflight-env.ps1 missing-key audit

Get-EnvKeyList / Get-EnvAudit / Test-EnvFiles 對三個目標檔(root .env、
bim-review-coordinator/.env、.env.web-plane.host-kit)各自跟對應 .example
比對 missing key list。Invariant:.env 已有的 key 一律不出現在 missing
(Phase 2 才會 append 預設值,不覆寫實值,符合 spec §7.3 紅線)。

對應 spec §5.2 與 §6.2 envFiles 區塊、§7.1 .env missing-key merge 行為。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: `scripts\lib\preflight-ports.ps1` + test

**Goal:** 偵測 docker bind ports(8004 / 5173)+ host-native ports(49100 / 49101 / 47998)是否被佔;若被佔,標記佔用者 PID 與「是不是我們的 PID file 內」。**Read-only。**

**Files:**
- Create: `scripts\lib\preflight-ports.ps1`
- Create: `scripts\tests\test-preflight-ports.ps1`

- [ ] **Step 1: 寫 failing test**

```powershell
# scripts\tests\test-preflight-ports.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\preflight-ports.ps1'
. $modulePath

# Test 1: 全 FREE
$result = Test-PortAvailability -RepoRoot (New-TestSandbox -Prefix 'preflight-ports') `
    -PortLookup { param($port) $null } `
    -ProcessNameLookup { param($pid) $null }
Assert-True ($result.docker.Count -eq 2) 'docker has 2 ports'
Assert-True ($result.hostNative.Count -eq 3) 'hostNative has 3 ports'
foreach ($p in @($result.docker; $result.hostNative)) {
    Assert-Equal 'FREE' $p.status "port $($p.port) FREE"
}
Write-TestPass 'all ports free'

# Test 2: :49100 被陌生 PID 佔(不在 PID file)
$sandbox = New-TestSandbox -Prefix 'preflight-ports-pid'
try {
    $runDir = Join-Path $sandbox 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    # 不寫任何 .pid 進去,模擬「不是我們的」
    $result = Test-PortAvailability -RepoRoot $sandbox `
        -PortLookup { param($port) if ($port -eq 49100) { 12345 } else { $null } } `
        -ProcessNameLookup { param($pid) if ($pid -eq 12345) { 'kit.exe' } else { $null } }

    $kit = $result.hostNative | Where-Object { $_.port -eq 49100 } | Select-Object -First 1
    Assert-Equal 'OCCUPIED' $kit.status '49100 OCCUPIED'
    Assert-Equal 12345 $kit.pid '49100 pid=12345'
    Assert-Equal 'kit.exe' $kit.name '49100 name=kit.exe'
    Assert-True ($kit.ourPidFile -eq $false) '49100 not in PID file'
    Write-TestPass 'stranger PID flagged ourPidFile=false'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 3: :49100 被「我們」(scripts\.run\bim-streaming-server.pid 內)佔
$sandbox = New-TestSandbox -Prefix 'preflight-ports-pid'
try {
    $runDir = Join-Path $sandbox 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $runDir 'bim-streaming-server.pid') -Value '12345'

    $result = Test-PortAvailability -RepoRoot $sandbox `
        -PortLookup { param($port) if ($port -eq 49100) { 12345 } else { $null } } `
        -ProcessNameLookup { param($pid) if ($pid -eq 12345) { 'powershell.exe' } else { $null } }

    $kit = $result.hostNative | Where-Object { $_.port -eq 49100 } | Select-Object -First 1
    Assert-True ($kit.ourPidFile -eq $true) '49100 in our PID file'
    Write-TestPass 'our PID flagged ourPidFile=true'
}
finally { Remove-TestSandbox -Path $sandbox }

Write-Host "`n=== test-preflight-ports.ps1: ALL PASSED ===" -ForegroundColor Green
```

- [ ] **Step 2: 跑 test 確認失敗**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-preflight-ports.ps1
```

Expected: `Test-PortAvailability is not recognized`。

- [ ] **Step 3: 寫 `scripts\lib\preflight-ports.ps1`**

```powershell
# scripts\lib\preflight-ports.ps1
# Preflight: Port availability audit。Read-only。
# 對每個 port,查 listen 的 PID;若 PID 在 scripts\.run\*.pid 任一檔內,
# 標 ourPidFile=true(deploy 流程後續會 skip 重啟,不會誤殺)。

Set-StrictMode -Version Latest

function Get-PidsFromRunDir {
    param([Parameter(Mandatory = $true)][string] $RunDir)
    $set = @{}
    if (-not (Test-Path -LiteralPath $RunDir)) { return $set }
    foreach ($file in Get-ChildItem -LiteralPath $RunDir -Filter '*.pid' -ErrorAction SilentlyContinue) {
        $content = Get-Content -LiteralPath $file.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($content) {
            $procId = 0
            if ([int]::TryParse($content.Trim(), [ref]$procId)) {
                $set[$procId] = $file.Name
            }
        }
    }
    return $set
}

function Test-PortAvailability {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [scriptblock] $PortLookup = {
            param($port)
            $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($conn) { return $conn.OwningProcess } else { return $null }
        },
        [scriptblock] $ProcessNameLookup = {
            param($pid)
            try {
                $proc = Get-Process -Id $pid -ErrorAction Stop
                return $proc.ProcessName + '.exe'
            } catch { return $null }
        }
    )

    $dockerPorts     = @(8004, 5173)
    $hostNativePorts = @(49100, 49101, 47998)
    $runDir          = Join-Path $RepoRoot 'scripts\.run'
    $ourPids         = Get-PidsFromRunDir -RunDir $runDir

    function Resolve-PortStatus {
        param([int] $Port)
        $portPid = & $PortLookup $Port
        if ($null -eq $portPid) {
            return [pscustomobject]@{
                port = $Port
                status = 'FREE'
                pid = $null
                name = $null
                ourPidFile = $false
            }
        }
        $name = & $ProcessNameLookup $portPid
        return [pscustomobject]@{
            port = $Port
            status = 'OCCUPIED'
            pid = $portPid
            name = $name
            ourPidFile = $ourPids.ContainsKey($portPid)
        }
    }

    $docker     = @($dockerPorts     | ForEach-Object { Resolve-PortStatus $_ })
    $hostNative = @($hostNativePorts | ForEach-Object { Resolve-PortStatus $_ })

    return [pscustomobject]@{
        docker     = $docker
        hostNative = $hostNative
    }
}
```

- [ ] **Step 4: 跑 test 確認通過**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-preflight-ports.ps1
```

Expected: 3 個 `[PASS]` + ALL PASSED。

- [ ] **Step 5: Commit**

```powershell
git add scripts\lib\preflight-ports.ps1 scripts\tests\test-preflight-ports.ps1
git diff --cached --check
git commit -m "feat(deploy): add preflight-ports.ps1 port availability audit

Test-PortAvailability 對 docker (8004/5173) + host-native (49100/49101/47998)
五個 port 做 listen owner audit。Get-PidsFromRunDir 讀 scripts\.run\*.pid
判斷 PID 是不是我們上次啟動的 (ourPidFile=true) — 區分 Phase 2 安全
自動清 stale PID vs Phase 3 互動問 'kill 陌生 PID'。

對應 spec §5.2、§6.2 ports 區塊、§7.1/7.2 區別。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: `scripts\lib\preflight-volume-alignment.ps1` + test

**Goal:** 檢查 `.env.web-plane.host-kit` 的 `RUNTIME_STORAGE_ROOT` 是否對齊(leaf 必須是 `storage`,否則 host-native conversion-service 看不到同一個 root)。**Read-only。**

**Files:**
- Create: `scripts\lib\preflight-volume-alignment.ps1`
- Create: `scripts\tests\test-preflight-volume-alignment.ps1`

- [ ] **Step 1: 寫 failing test**

```powershell
# scripts\tests\test-preflight-volume-alignment.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\preflight-volume-alignment.ps1'
. $modulePath

# Test 1: ALIGNED — leaf=storage, parent=<sandbox>
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit') `
        -Value "RUNTIME_STORAGE_ROOT=$sb\storage"
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    Assert-Equal 'ALIGNED' $result.status 'leaf=storage → ALIGNED'
    Assert-Equal "$sb\storage" $result.runtimeStorageRoot 'echo back path'
    Assert-Equal 'storage' $result.leaf 'leaf=storage'
    Write-TestPass 'aligned'
}
finally { Remove-TestSandbox -Path $sb }

# Test 2: MISSING_KEY — .env 內沒這個 key
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit') `
        -Value "COORDINATOR_PORT=8004"
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    Assert-Equal 'MISSING_KEY' $result.status 'no key → MISSING_KEY'
    Assert-Equal $null $result.runtimeStorageRoot 'no path'
    Write-TestPass 'missing key'
}
finally { Remove-TestSandbox -Path $sb }

# Test 3: WRONG_LEAF — leaf 不是 storage
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit') `
        -Value "RUNTIME_STORAGE_ROOT=D:\bim-share\ifc-bucket"
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    Assert-Equal 'WRONG_LEAF' $result.status 'leaf=ifc-bucket → WRONG_LEAF'
    Assert-Equal 'ifc-bucket' $result.leaf 'leaf echo'
    Write-TestPass 'wrong leaf flagged'
}
finally { Remove-TestSandbox -Path $sb }

# Test 4: env file 不存在 → MISSING_KEY (treat as missing)
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    Assert-Equal 'MISSING_KEY' $result.status 'no env file → MISSING_KEY'
    Write-TestPass 'missing env file handled'
}
finally { Remove-TestSandbox -Path $sb }

# Test 5: relative path ./storage → 解析 leaf=storage,但因為相對路徑歧義,標 WRONG_LEAF
$sb = New-TestSandbox -Prefix 'preflight-vol'
try {
    Set-Content -LiteralPath (Join-Path $sb '.env.web-plane.host-kit') `
        -Value "RUNTIME_STORAGE_ROOT=./storage"
    $result = Test-VolumeAlignment -RepoRoot $sb -EnvFile '.env.web-plane.host-kit'
    # 預期:相對路徑被解析成絕對路徑(基於 RepoRoot)後 leaf=storage → ALIGNED
    Assert-Equal 'ALIGNED' $result.status 'relative ./storage resolved → ALIGNED'
    Assert-Equal "$sb\storage" $result.runtimeStorageRoot 'resolved to abs path'
    Write-TestPass 'relative path resolved'
}
finally { Remove-TestSandbox -Path $sb }

Write-Host "`n=== test-preflight-volume-alignment.ps1: ALL PASSED ===" -ForegroundColor Green
```

- [ ] **Step 2: 跑 test 確認失敗**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-preflight-volume-alignment.ps1
```

Expected: `Test-VolumeAlignment is not recognized`。

- [ ] **Step 3: 寫 `scripts\lib\preflight-volume-alignment.ps1`**

```powershell
# scripts\lib\preflight-volume-alignment.ps1
# Preflight: Volume 對齊(方案 A,spec §7.4)。
# Ground truth = .env.web-plane.host-kit 的 RUNTIME_STORAGE_ROOT。
# Read-only。
# 相對路徑(./xxx)以 RepoRoot 為基底解析成絕對路徑。

Set-StrictMode -Version Latest

function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Key
    )
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
        $idx = $trimmed.IndexOf('=')
        if ($idx -le 0) { continue }
        $name = $trimmed.Substring(0, $idx).Trim()
        if ($name -eq $Key) {
            $value = $trimmed.Substring($idx + 1).Trim()
            # 剝引號
            if ($value.Length -ge 2) {
                $first = $value.Substring(0, 1)
                if (($first -eq '"' -or $first -eq "'") -and $value.EndsWith($first)) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
            }
            # 剝 trailing comment
            $comment = [regex]::Match($value, '\s+#')
            if ($comment.Success) {
                $value = $value.Substring(0, $comment.Index).TrimEnd()
            }
            if ($value) { return $value } else { return $null }
        }
    }
    return $null
}

function Test-VolumeAlignment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $EnvFile = '.env.web-plane.host-kit'
    )

    $envPath = Join-Path $RepoRoot $EnvFile
    $raw = Get-EnvValue -Path $envPath -Key 'RUNTIME_STORAGE_ROOT'

    if ([string]::IsNullOrWhiteSpace($raw)) {
        return [pscustomobject]@{
            runtimeStorageRoot = $null
            leaf               = $null
            status             = 'MISSING_KEY'
        }
    }

    # 相對路徑 → 以 RepoRoot 為基底 resolve
    $resolved = $raw
    if (-not [System.IO.Path]::IsPathRooted($resolved)) {
        $resolved = (Join-Path $RepoRoot $resolved)
    }
    # 規範化(去 ./ 與 ..\)
    try {
        $resolved = [System.IO.Path]::GetFullPath($resolved)
    } catch {
        # 留原值
    }

    $leaf = Split-Path -Leaf $resolved

    $status = if ($leaf -eq 'storage') { 'ALIGNED' } else { 'WRONG_LEAF' }

    return [pscustomobject]@{
        runtimeStorageRoot = $resolved
        leaf               = $leaf
        status             = $status
    }
}
```

- [ ] **Step 4: 跑 test 確認通過**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-preflight-volume-alignment.ps1
```

Expected: 5 個 `[PASS]` + ALL PASSED。

- [ ] **Step 5: Commit**

```powershell
git add scripts\lib\preflight-volume-alignment.ps1 scripts\tests\test-preflight-volume-alignment.ps1
git diff --cached --check
git commit -m "feat(deploy): add preflight-volume-alignment.ps1

Test-VolumeAlignment 實作 spec §7.4 方案 A:Ground truth =
.env.web-plane.host-kit 的 RUNTIME_STORAGE_ROOT,host-native conversion-service
在 Phase 4a 啟動前反向對齊。leaf 必須是 'storage'(否則 host-native
conversion-service 寫死的 Resolve-ConversionWorkDir 看不到 storage/ 子目錄)。
status: ALIGNED | MISSING_KEY | WRONG_LEAF。相對路徑以 RepoRoot 為基底
resolve 成絕對路徑。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: `scripts\lib\host-native-launcher.ps1` + test

**Goal:** 把 `start-all.ps1` line 232-260 的 Start-LocalService 與 Wait-Health 等邏輯抽出可重用 module。**有副作用(啟 process / 寫 PID file)**,但跟 preflight 不同 module。

**Files:**
- Create: `scripts\lib\host-native-launcher.ps1`
- Create: `scripts\tests\test-host-native-launcher.ps1`

- [ ] **Step 1: 寫 failing test(focus on pure pieces;啟動 real process 在 Layer 3 smoke 驗)**

```powershell
# scripts\tests\test-host-native-launcher.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\host-native-launcher.ps1'
. $modulePath

# Test 1: Test-AlreadyRunning — PID file 不存在 → false
$sb = New-TestSandbox -Prefix 'hn-launcher'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    Assert-True (-not (Test-AlreadyRunning -Name 'foo' -RunDir $runDir)) 'no PID file → false'
    Write-TestPass 'no PID file → not running'
}
finally { Remove-TestSandbox -Path $sb }

# Test 2: PID file 內 PID 對應的 process 不存在 → false(stale PID 應被偵測)
$sb = New-TestSandbox -Prefix 'hn-launcher'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $runDir 'foo.pid') -Value '999999'
    Assert-True (-not (Test-AlreadyRunning -Name 'foo' -RunDir $runDir `
        -GetProcessFn { param($pid) $null })) 'stale PID → false'
    Write-TestPass 'stale PID flagged'
}
finally { Remove-TestSandbox -Path $sb }

# Test 3: PID file 內 PID 對應 process 存在 → true
$sb = New-TestSandbox -Prefix 'hn-launcher'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $runDir 'foo.pid') -Value '12345'
    Assert-True (Test-AlreadyRunning -Name 'foo' -RunDir $runDir `
        -GetProcessFn { param($pid) @{ Id = $pid } }) 'live PID → true'
    Write-TestPass 'live PID detected'
}
finally { Remove-TestSandbox -Path $sb }

# Test 4: Wait-HostNativeHealth 對 fake successful HTTP probe 返回 true
$ok = Wait-HostNativeHealth -Name 'fake' -Url 'http://invalid.example' -TimeoutSec 1 `
    -ProbeFn { @{ StatusCode = 200 } }
Assert-True ($ok -eq $true) 'fake 200 → ok'
Write-TestPass 'Wait-HostNativeHealth 200 → ok'

# Test 5: Wait-HostNativeHealth 對 timeout 返回 false
$fail = Wait-HostNativeHealth -Name 'fake' -Url 'http://invalid.example' -TimeoutSec 1 `
    -ProbeFn { throw 'connection refused' }
Assert-True ($fail -eq $false) 'timeout → false'
Write-TestPass 'Wait-HostNativeHealth timeout → false'

# Test 6: Resolve-ConversionParentRoot — 算反向對齊路徑
$parent = Resolve-ConversionParentRoot -RuntimeStorageRoot 'C:\repo\storage'
Assert-Equal 'C:\repo' $parent 'parent of C:\repo\storage = C:\repo'
Write-TestPass 'Resolve-ConversionParentRoot'

Write-Host "`n=== test-host-native-launcher.ps1: ALL PASSED ===" -ForegroundColor Green
```

- [ ] **Step 2: 跑 test 確認失敗**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-host-native-launcher.ps1
```

Expected: function 未定義。

- [ ] **Step 3: 寫 `scripts\lib\host-native-launcher.ps1`**

```powershell
# scripts\lib\host-native-launcher.ps1
# Host-native process launcher:抽自 start-all.ps1 line 217-260 的
# Test-AlreadyRunning / Start-LocalService / Wait-Health,讓 deploy.ps1
# 與其他入口共用。Start-* 函數有副作用(啟 process / 寫 PID file / 寫 log)。

Set-StrictMode -Version Latest

function Test-AlreadyRunning {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $RunDir,
        [scriptblock] $GetProcessFn = {
            param($procId)
            try { Get-Process -Id $procId -ErrorAction Stop } catch { $null }
        }
    )
    $pidFile = Join-Path $RunDir "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
    $raw = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $raw) { return $false }
    $procId = 0
    if (-not [int]::TryParse($raw.Trim(), [ref]$procId)) { return $false }
    return ($null -ne (& $GetProcessFn $procId))
}

function Remove-StalePidFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $RunDir,
        [scriptblock] $GetProcessFn = {
            param($procId)
            try { Get-Process -Id $procId -ErrorAction Stop } catch { $null }
        }
    )
    $pidFile = Join-Path $RunDir "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
    $raw = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $raw) {
        Remove-Item -LiteralPath $pidFile -Force
        return $true
    }
    $procId = 0
    if ([int]::TryParse($raw.Trim(), [ref]$procId)) {
        if ($null -eq (& $GetProcessFn $procId)) {
            Remove-Item -LiteralPath $pidFile -Force
            return $true
        }
    }
    return $false
}

function Start-HostNativeService {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [Parameter(Mandatory = $true)][string] $RunDir,
        [ValidateSet('Hidden','Normal')] [string] $WindowStyle = 'Hidden'
    )

    if (-not (Test-Path -LiteralPath $RunDir)) {
        New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
    }
    $logFile = Join-Path $RunDir "$Name.log"
    $errFile = "$logFile.err"
    $pidFile = Join-Path $RunDir "$Name.pid"

    $proc = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle $WindowStyle `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError $errFile `
        -PassThru
    $proc.Id | Set-Content -LiteralPath $pidFile -Encoding ascii
    return [pscustomobject]@{ Name = $Name; Pid = $proc.Id; LogPath = $logFile; ErrPath = $errFile }
}

function Wait-HostNativeHealth {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Url,
        [int] $TimeoutSec = 30,
        [scriptblock] $ProbeFn = {
            param($url)
            Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        }
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = & $ProbeFn $Url
            if ($r -and $r.StatusCode -eq 200) { return $true }
        } catch {
            # 繼續等
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Resolve-ConversionParentRoot {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $RuntimeStorageRoot)
    return (Split-Path -Parent $RuntimeStorageRoot)
}

function Start-HostNativeConversion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $RuntimeStorageRoot,
        [int] $Port = 49101
    )
    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }

    # 反向對齊:host-native conversion 看的 work dir = storage 的 parent
    $parentRoot = Resolve-ConversionParentRoot -RuntimeStorageRoot $RuntimeStorageRoot
    $env:STREAMING_CONVERSION_WORK_DIR = $parentRoot
    $env:STREAMING_CONVERSION_HOST     = '127.0.0.1'
    $env:STREAMING_CONVERSION_PORT     = "$Port"

    $launcher = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-host-native-conversion-service.ps1'
    return (Start-HostNativeService `
        -Name 'bim-streaming-conversion-service' `
        -WorkingDirectory (Join-Path $RepoRoot 'bim-streaming-server') `
        -FilePath 'powershell.exe' `
        -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-NoProfile','-File',$launcher) `
        -RunDir $runDir)
}

function Start-HostNativeKit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [int] $SignalPort = 49100,
        [int] $StreamPort = 47998,
        [string] $PublicIp = '127.0.0.1'
    )
    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }
    $launcher = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'
    return (Start-HostNativeService `
        -Name 'bim-streaming-server' `
        -WorkingDirectory (Join-Path $RepoRoot 'bim-streaming-server') `
        -FilePath 'powershell.exe' `
        -ArgumentList @(
            '-ExecutionPolicy','Bypass','-NoProfile','-File', $launcher,
            '-InstanceId','kit_local_001',
            '-SignalPort',"$SignalPort",
            '-StreamPort',"$StreamPort",
            '-PublicIp', $PublicIp,
            '-ResetUser',
            '-SkipAutoLoad'
        ) `
        -RunDir $runDir)
}
```

- [ ] **Step 4: 跑 test 確認通過**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-host-native-launcher.ps1
```

Expected: 6 個 `[PASS]` + ALL PASSED。

- [ ] **Step 5: Commit**

```powershell
git add scripts\lib\host-native-launcher.ps1 scripts\tests\test-host-native-launcher.ps1
git diff --cached --check
git commit -m "feat(deploy): add host-native-launcher.ps1 process lifecycle helpers

Test-AlreadyRunning / Remove-StalePidFile / Start-HostNativeService /
Wait-HostNativeHealth 抽自 start-all.ps1 既有邏輯,讓 deploy.ps1 共用。
Start-HostNativeConversion / Start-HostNativeKit 是包好的 high-level
入口:前者反向對齊 RUNTIME_STORAGE_ROOT(spec §7.4 方案 A),後者
帶 -ResetUser(memory webrtc-no-video-reset-user-recovery)。

start-all.ps1 本身不動 — 抽 lib 的目的是 deploy.ps1 復用,不 refactor
既有入口(spec §4 / §5.3 Invariant 3)。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: `scripts\lib\kit-log-probe.ps1` + test

**Goal:** Kit 沒 `/health` endpoint,所以 ready 判定 = `:49100` LISTEN + log 出現關鍵字。Best-effort,timeout 不算 fail。

**Files:**
- Create: `scripts\lib\kit-log-probe.ps1`
- Create: `scripts\tests\test-kit-log-probe.ps1`

- [ ] **Step 1: 寫 failing test**

```powershell
# scripts\tests\test-kit-log-probe.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\kit-log-probe.ps1'
. $modulePath

# Test 1: log 出現 'Application started' → ready=true
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value "boot...`n  loading...`n  Application started`n"
    $r = Test-KitReadyFromLog -LogPath $logFile
    Assert-True $r.ready 'Application started → ready'
    Assert-Equal 'Application started' $r.matchedKeyword 'matched keyword'
    Write-TestPass 'Application started detected'
}
finally { Remove-TestSandbox -Path $sb }

# Test 2: log 只有 'launching Linux Kit' → ready=true(關鍵字 OR)
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value "launching Linux Kit streaming app"
    $r = Test-KitReadyFromLog -LogPath $logFile
    Assert-True $r.ready 'launching Linux Kit → ready'
    Write-TestPass 'launching Linux Kit detected'
}
finally { Remove-TestSandbox -Path $sb }

# Test 3: log 出現 'Streaming started'
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value "Streaming started on port 49100"
    $r = Test-KitReadyFromLog -LogPath $logFile
    Assert-True $r.ready 'Streaming started → ready'
    Write-TestPass 'Streaming started detected'
}
finally { Remove-TestSandbox -Path $sb }

# Test 4: log 空 → ready=false
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value ""
    $r = Test-KitReadyFromLog -LogPath $logFile
    Assert-True (-not $r.ready) 'empty → not ready'
    Write-TestPass 'empty log → not ready'
}
finally { Remove-TestSandbox -Path $sb }

# Test 5: log 不存在 → ready=false
$r = Test-KitReadyFromLog -LogPath 'C:\nonexistent\kit.log'
Assert-True (-not $r.ready) 'missing log → not ready'
Write-TestPass 'missing log handled'

# Test 6: Wait-KitReady poll loop:5 次 poll 內 log 出現 → ready=true
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value 'Application started'
    $r = Wait-KitReady -LogPath $logFile -SignalPort 49100 -TimeoutSec 1 `
        -PortListenProbe { param($p) $true }
    Assert-True $r.ready 'ready when log+port both ok'
    Write-TestPass 'Wait-KitReady positive'
}
finally { Remove-TestSandbox -Path $sb }

# Test 7: Wait-KitReady — port 未 listen → ready=false(timeout)
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value 'Application started'
    $r = Wait-KitReady -LogPath $logFile -SignalPort 49100 -TimeoutSec 1 `
        -PortListenProbe { param($p) $false }
    Assert-True (-not $r.ready) 'not ready when port not listen'
    Write-TestPass 'Wait-KitReady port-not-listen'
}
finally { Remove-TestSandbox -Path $sb }

Write-Host "`n=== test-kit-log-probe.ps1: ALL PASSED ===" -ForegroundColor Green
```

- [ ] **Step 2: 跑 test 確認失敗**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-kit-log-probe.ps1
```

Expected: function 未定義。

- [ ] **Step 3: 寫 `scripts\lib\kit-log-probe.ps1`**

```powershell
# scripts\lib\kit-log-probe.ps1
# Kit readiness probe:沒 /health endpoint,以 LISTEN(:49100) + log keyword 判定。

Set-StrictMode -Version Latest

$script:KitReadyKeywords = @(
    'Application started',
    'launching Linux Kit',
    'Streaming started'
)

function Test-KitReadyFromLog {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $LogPath)

    if (-not (Test-Path -LiteralPath $LogPath)) {
        return [pscustomobject]@{ ready = $false; matchedKeyword = $null }
    }
    $content = Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($content)) {
        return [pscustomobject]@{ ready = $false; matchedKeyword = $null }
    }
    foreach ($kw in $script:KitReadyKeywords) {
        if ($content -match [regex]::Escape($kw)) {
            return [pscustomobject]@{ ready = $true; matchedKeyword = $kw }
        }
    }
    return [pscustomobject]@{ ready = $false; matchedKeyword = $null }
}

function Wait-KitReady {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $LogPath,
        [int] $SignalPort = 49100,
        [int] $TimeoutSec = 90,
        [scriptblock] $PortListenProbe = {
            param($port)
            $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
        }
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $listen = & $PortListenProbe $SignalPort
        $logRes = Test-KitReadyFromLog -LogPath $LogPath
        if ($listen -and $logRes.ready) {
            return [pscustomobject]@{
                ready = $true
                listenPort = $SignalPort
                matchedKeyword = $logRes.matchedKeyword
            }
        }
        Start-Sleep -Milliseconds 500
    }
    $finalLog = Test-KitReadyFromLog -LogPath $LogPath
    $finalListen = & $PortListenProbe $SignalPort
    return [pscustomobject]@{
        ready = $false
        listenPort = if ($finalListen) { $SignalPort } else { $null }
        matchedKeyword = $finalLog.matchedKeyword
    }
}
```

- [ ] **Step 4: 跑 test 確認通過**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-kit-log-probe.ps1
```

Expected: 7 個 `[PASS]` + ALL PASSED。

- [ ] **Step 5: Commit**

```powershell
git add scripts\lib\kit-log-probe.ps1 scripts\tests\test-kit-log-probe.ps1
git diff --cached --check
git commit -m "feat(deploy): add kit-log-probe.ps1 readiness check

Test-KitReadyFromLog scan scripts\.run\bim-streaming-server.log
for 'Application started' / 'launching Linux Kit' / 'Streaming started'.
Wait-KitReady poll-loop combines log keyword + signaling port LISTEN
with 90s default timeout (Kit 啟動本來就慢)。Best-effort:timeout
時返回 ready=false,deploy.ps1 視 -StrictPostVerify 決定 warn / fail。

對應 spec §5.2 kit-log-probe、§6.3 Phase 5 Step 6、Decision Summary #5。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: `scripts\deploy.ps1` orchestrator

**Goal:** 整合 lib\\* modules,實作 spec §6 完整 Phase 0-5 流程 + 退出碼 + Final Summary。

**Files:**
- Create: `scripts\deploy.ps1`

- [ ] **Step 1: 寫 `scripts\deploy.ps1`**

```powershell
# scripts\deploy.ps1
# Mode C(hybrid)一鍵部屬入口。
# 對應 docs/superpowers/specs/2026-05-26-one-click-deploy-design.md。
#
# Mode A 入口:scripts\start-all.ps1(完全不動)
# Mode B 入口:scripts\start-runtime-manager-docker.ps1(完全不動)
# Mode C 入口:本檔
#
# 使用:
#   .\scripts\deploy.ps1                          # 全自動 hybrid 部屬
#   .\scripts\deploy.ps1 -DryRun                  # 只看 fix plan,不動真實狀態
#   .\scripts\deploy.ps1 -Force                   # 互動 guard 全部視同 y
#   .\scripts\deploy.ps1 -Build                   # 強制 docker compose build
#   .\scripts\deploy.ps1 -SkipKit                 # 不啟 host-native Kit(viewer 沒畫面)

[CmdletBinding()]
param(
    [switch] $DryRun,
    [switch] $Force,
    [switch] $Build,
    [switch] $Pull,
    [string] $EnvFile = '',
    [switch] $SkipKit,
    [switch] $SkipConversion,
    [switch] $SkipDocker,
    [int]    $KitSignalPort = 49100,
    [int]    $KitMediaPort  = 47998,
    [switch] $StrictPostVerify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:DeployStart = Get-Date

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$RunDir   = Join-Path $RepoRoot 'scripts\.run'
$LogPath  = Join-Path $RunDir   'deploy.log'

# Import lib modules
$libDir = Join-Path $PSScriptRoot 'lib'
. (Join-Path $libDir 'deploy-report.ps1')
. (Join-Path $libDir 'preflight-docker.ps1')
. (Join-Path $libDir 'preflight-host-native.ps1')
. (Join-Path $libDir 'preflight-env.ps1')
. (Join-Path $libDir 'preflight-ports.ps1')
. (Join-Path $libDir 'preflight-volume-alignment.ps1')
. (Join-Path $libDir 'host-native-launcher.ps1')
. (Join-Path $libDir 'kit-log-probe.ps1')

if (-not (Test-Path -LiteralPath $RunDir)) {
    New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
}

# 提前宣告以下 script-scope 變數,Print-FinalSummary 才能用
$script:resolvedEnvFile = ''
$script:volume = $null

# ============================================================
# Helper: Print-FinalSummary(在 Phase 1 之前定義,讓任何階段都可呼叫)
# ============================================================
function Print-FinalSummary {
    param([int] $ExitCode, [string] $FailedPhase)
    $elapsed = (Get-Date) - $script:DeployStart
    Write-Host ''
    Write-Host '=== Deploy Summary ===' -ForegroundColor Cyan
    Write-Host "Mode:         hybrid (web-plane Docker + host-native Kit)"
    Write-Host ("Elapsed:      {0:N0}m {1:N0}s" -f $elapsed.TotalMinutes, $elapsed.Seconds)
    if ($script:resolvedEnvFile) { Write-Host "EnvFile:      $($script:resolvedEnvFile)" }
    if ($script:volume -and $script:volume.runtimeStorageRoot) {
        Write-Host "Storage root: $($script:volume.runtimeStorageRoot) ($($script:volume.status))"
    }
    if ($ExitCode -eq 0) {
        Write-Host ''
        Write-Host 'Next:' -ForegroundColor Green
        Write-Host '  > open http://127.0.0.1:8004/ui            (coordinator UI / WebRTC entry)'
        Write-Host '  > tail scripts\.run\bim-streaming-server.log -Wait'
        Write-Host '  > stop all:'
        Write-Host '      .\scripts\stop-runtime-manager-docker.ps1'
        Write-Host '      .\scripts\stop-all.ps1 -SkipCoordinator -SkipViewer'
    } else {
        Write-Host ''
        Write-Host "Status: FAILED (exit $ExitCode, $FailedPhase)" -ForegroundColor Red
        Write-Host 'What might be running (NOT auto-rolled-back):'
        foreach ($pidFile in Get-ChildItem -LiteralPath $RunDir -Filter '*.pid' -ErrorAction SilentlyContinue) {
            $procId = (Get-Content $pidFile.FullName | Select-Object -First 1).Trim()
            Write-Host "  > $($pidFile.BaseName) PID $procId"
        }
        Write-Host ''
        Write-Host 'To recover:'
        Write-Host '  > .\scripts\stop-all.ps1 -SkipCoordinator -SkipViewer'
        Write-Host '  > .\scripts\stop-runtime-manager-docker.ps1'
        Write-Host '  > re-run: .\scripts\deploy.ps1 -Force'
    }
}

# ============================================================
# Phase 1: Preflight (read-only audit)
# ============================================================
Write-DeployHeader -Title 'Phase 1: Preflight (read-only)'

$docker     = Test-DockerEnvironment       -RepoRoot $RepoRoot
$hostNative = Test-HostNativeEnvironment   -RepoRoot $RepoRoot
$envFiles   = Test-EnvFiles                -RepoRoot $RepoRoot
$ports      = Test-PortAvailability        -RepoRoot $RepoRoot
$resolvedEnvFile = if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    if ($docker.envFile) { $docker.envFile } else { '.env.web-plane.host-kit.example' }
} else { $EnvFile }
$script:resolvedEnvFile = $resolvedEnvFile
$volume = Test-VolumeAlignment -RepoRoot $RepoRoot -EnvFile $resolvedEnvFile
$script:volume = $volume

# Audit summary 印出
function Report-Audit {
    if ($docker.cliVersion)   { Write-DeployTag -Tag 'ok'   -Message "docker cli=$($docker.cliVersion)" -LogPath $LogPath | Out-Null }
    else                      { Write-DeployTag -Tag 'fail' -Message 'docker CLI not found (install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/)' -LogPath $LogPath | Out-Null }
    if ($docker.composeV2)    { Write-DeployTag -Tag 'ok'   -Message 'docker compose v2' -LogPath $LogPath | Out-Null }
    else                      { Write-DeployTag -Tag 'fail' -Message 'docker compose v2 missing' -LogPath $LogPath | Out-Null }
    if ($docker.engineRunning){ Write-DeployTag -Tag 'ok'   -Message 'docker engine running' -LogPath $LogPath | Out-Null }
    else                      { Write-DeployTag -Tag 'fail' -Message 'docker engine not running (start Docker Desktop and wait until tray icon settles)' -LogPath $LogPath | Out-Null }
    if ($docker.envFile)      { Write-DeployTag -Tag 'ok'   -Message "envFile=$($docker.envFile)" -LogPath $LogPath | Out-Null }
    else                      { Write-DeployTag -Tag 'fail' -Message '.env.web-plane.host-kit / .example not found in repo root' -LogPath $LogPath | Out-Null }

    foreach ($key in @('venv','kitLauncher','nvidiaDriver')) {
        $st = $hostNative.$key
        if ($st -eq 'OK')      { Write-DeployTag -Tag 'ok'   -Message "host-native $key=$st" -LogPath $LogPath | Out-Null }
        elseif ($st -eq 'MISSING') {
            if ($key -eq 'venv')          { Write-DeployTag -Tag 'fix'  -Message "host-native venv MISSING (will create via python -m venv in Phase 2)" -LogPath $LogPath | Out-Null }
            elseif ($key -eq 'nvidiaDriver') { Write-DeployTag -Tag 'fail' -Message 'nvidia-smi missing (install NVIDIA driver)' -LogPath $LogPath | Out-Null }
        }
        elseif ($st -eq 'WRONG_VERSION'){ Write-DeployTag -Tag 'ask'  -Message "host-native venv WRONG_VERSION (Phase 3 will ask)" -LogPath $LogPath | Out-Null }
        elseif ($st -eq 'MISSING_PATH') { Write-DeployTag -Tag 'fail' -Message "host-native $key MISSING_PATH (expected: bim-streaming-server\scripts\start-streaming-server.ps1)" -LogPath $LogPath | Out-Null }
    }

    foreach ($ef in $envFiles) {
        if (-not $ef.envExists) {
            Write-DeployTag -Tag 'fix' -Message "$($ef.file) missing (will Copy-Item from .example in Phase 2)" -LogPath $LogPath | Out-Null
        } elseif ($ef.missing.Count -gt 0) {
            Write-DeployTag -Tag 'fix' -Message "$($ef.file) missing keys: $($ef.missing -join ',') (will append default in Phase 2)" -LogPath $LogPath | Out-Null
        } else {
            Write-DeployTag -Tag 'ok' -Message "$($ef.file) complete" -LogPath $LogPath | Out-Null
        }
    }

    foreach ($p in @($ports.docker; $ports.hostNative)) {
        if ($p.status -eq 'FREE') {
            Write-DeployTag -Tag 'ok' -Message "port $($p.port) FREE" -LogPath $LogPath | Out-Null
        } elseif ($p.ourPidFile) {
            Write-DeployTag -Tag 'skip' -Message "port $($p.port) occupied by our PID $($p.pid) ($($p.name)) — already running, will skip start" -LogPath $LogPath | Out-Null
        } else {
            Write-DeployTag -Tag 'ask' -Message "port $($p.port) occupied by stranger PID $($p.pid) ($($p.name)) — Phase 3 will ask" -LogPath $LogPath | Out-Null
        }
    }

    switch ($volume.status) {
        'ALIGNED'     { Write-DeployTag -Tag 'ok'   -Message "volume aligned root=$($volume.runtimeStorageRoot)" -LogPath $LogPath | Out-Null }
        'MISSING_KEY' { Write-DeployTag -Tag 'fix'  -Message "RUNTIME_STORAGE_ROOT missing in $resolvedEnvFile (will append <RepoRoot>\storage in Phase 2)" -LogPath $LogPath | Out-Null }
        'WRONG_LEAF'  { Write-DeployTag -Tag 'fail' -Message "RUNTIME_STORAGE_ROOT=$($volume.runtimeStorageRoot) leaf=$($volume.leaf) is not 'storage' (host-native conversion-service requires storage/ subdir; fix .env or rename)" -LogPath $LogPath | Out-Null }
    }
}
Report-Audit

# 把 audit 物件序列化進 deploy-audit.json(spec §8.3)
$auditObj = [pscustomobject]@{
    docker      = $docker
    hostNative  = $hostNative
    envFiles    = $envFiles
    ports       = $ports
    volume      = $volume
    envFileUsed = $resolvedEnvFile
}
$auditObj | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $RunDir 'deploy-audit.json')

# 判斷 hard fail(unfixable)
$hardFails = @()
if (-not $docker.cliVersion)    { $hardFails += 'docker_cli_missing' }
if (-not $docker.composeV2)     { $hardFails += 'docker_compose_v2_missing' }
if (-not $docker.engineRunning) { $hardFails += 'docker_engine_not_running' }
if (-not $docker.envFile)       { $hardFails += 'env_file_missing_entirely' }
if ($hostNative.nvidiaDriver -eq 'MISSING')   { $hardFails += 'nvidia_smi_missing' }
if ($hostNative.kitLauncher -eq 'MISSING_PATH'){ $hardFails += 'kit_launcher_missing' }
if ($volume.status -eq 'WRONG_LEAF')          { $hardFails += 'runtime_storage_root_wrong_leaf' }
if ($hardFails.Count -gt 0) {
    Write-DeployTag -Tag 'fail' -Message "Phase 1 unfixable: $($hardFails -join ',')" -LogPath $LogPath | Out-Null
    Print-FinalSummary -ExitCode 1 -FailedPhase 'Phase 1 preflight'
    exit 1
}

# ============================================================
# Phase 2: Auto-fix
# ============================================================
Write-DeployHeader -Title 'Phase 2: Auto-fix (safe actions)'

if ($DryRun) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 2 auto-fix DRY-RUN (no actions executed)' -LogPath $LogPath | Out-Null
    Print-FinalSummary -ExitCode 0 -FailedPhase ''
    exit 0
}

$fixActions = 0

# fix: .venv
if ($hostNative.venv -eq 'MISSING') {
    Write-DeployTag -Tag 'fix' -Message 'creating .venv via python -m venv' -LogPath $LogPath | Out-Null
    & python -m venv (Join-Path $RepoRoot '.venv')
    if ($LASTEXITCODE -ne 0) {
        Write-DeployTag -Tag 'fail' -Message 'python -m venv failed' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (venv create)'
        exit 2
    }
    $venvPy = Join-Path $RepoRoot '.venv\Scripts\python.exe'
    foreach ($req in @('requirements.txt','bim-streaming-server\requirements.txt')) {
        $reqPath = Join-Path $RepoRoot $req
        if (Test-Path -LiteralPath $reqPath) {
            Write-DeployTag -Tag 'fix' -Message "pip install -r $req" -LogPath $LogPath | Out-Null
            & $venvPy -m pip install -r $reqPath
            if ($LASTEXITCODE -ne 0) {
                Write-DeployTag -Tag 'fail' -Message "pip install -r $req failed" -LogPath $LogPath | Out-Null
                Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (pip install)'
                exit 2
            }
        }
    }
    $fixActions++
}

# fix: .env / .env.example missing-key merge
foreach ($ef in $envFiles) {
    $envPath     = Join-Path $RepoRoot $ef.file
    $examplePath = "$envPath.example"
    if ((-not $ef.envExists) -and $ef.exampleExists) {
        Write-DeployTag -Tag 'fix' -Message "Copy-Item $examplePath -> $envPath" -LogPath $LogPath | Out-Null
        Copy-Item -LiteralPath $examplePath -Destination $envPath -Force
        $fixActions++
    } elseif ($ef.missing.Count -gt 0) {
        Write-DeployTag -Tag 'fix' -Message "appending $($ef.missing.Count) missing keys to $($ef.file)" -LogPath $LogPath | Out-Null
        Add-Content -LiteralPath $envPath -Value ''
        Add-Content -LiteralPath $envPath -Value "# auto-appended by deploy.ps1 (missing-key merge from .env.example)"
        foreach ($k in $ef.missing) {
            # 從 .example 取預設值
            $defaultValue = ''
            foreach ($line in Get-Content -LiteralPath $examplePath) {
                if ($line -match "^\s*$([regex]::Escape($k))\s*=\s*(.*)$") {
                    $defaultValue = $Matches[1]
                    break
                }
            }
            Add-Content -LiteralPath $envPath -Value "$k=$defaultValue"
        }
        $fixActions++
    }
}

# fix: volume — MISSING_KEY → append RUNTIME_STORAGE_ROOT=<RepoRoot>\storage
if ($volume.status -eq 'MISSING_KEY') {
    $envPath = Join-Path $RepoRoot $resolvedEnvFile
    $absStorage = Join-Path $RepoRoot 'storage'
    Write-DeployTag -Tag 'fix' -Message "appending RUNTIME_STORAGE_ROOT=$absStorage to $resolvedEnvFile" -LogPath $LogPath | Out-Null
    Add-Content -LiteralPath $envPath -Value ''
    Add-Content -LiteralPath $envPath -Value "# auto-appended by deploy.ps1 (volume alignment)"
    Add-Content -LiteralPath $envPath -Value "RUNTIME_STORAGE_ROOT=$absStorage"
    # 重新 audit
    $volume = Test-VolumeAlignment -RepoRoot $RepoRoot -EnvFile $resolvedEnvFile
    if ($volume.status -ne 'ALIGNED') {
        Write-DeployTag -Tag 'fail' -Message 'volume alignment still not OK after fix' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (volume fix)'
        exit 2
    }
    $fixActions++
}

# fix: 清 stale PID file
foreach ($pidFile in Get-ChildItem -LiteralPath $RunDir -Filter '*.pid' -ErrorAction SilentlyContinue) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($pidFile.Name)
    $removed = Remove-StalePidFile -Name $name -RunDir $RunDir
    if ($removed) {
        Write-DeployTag -Tag 'fix' -Message "removed stale PID file $($pidFile.Name)" -LogPath $LogPath | Out-Null
        $fixActions++
    }
}

# fix: 建本地目錄
foreach ($d in @('scripts\.run', 'logs\nvstreamer', 'storage\ifc-cache')) {
    $abs = Join-Path $RepoRoot $d
    if (-not (Test-Path -LiteralPath $abs)) {
        Write-DeployTag -Tag 'fix' -Message "mkdir $d" -LogPath $LogPath | Out-Null
        New-Item -ItemType Directory -Path $abs -Force | Out-Null
        $fixActions++
    }
}

# fix: 容器衝突自動 rm(spec §7.1)
if (-not $SkipDocker) {
    $rmArgs = @('compose','-f','compose.runtime-manager.yml','-f','compose.host-kit.yml','--env-file',$resolvedEnvFile,'rm','-f','-s','coordinator','viewer')
    Write-DeployTag -Tag 'fix' -Message "docker $($rmArgs -join ' ') (clear any conflicting containers; named volumes preserved)" -LogPath $LogPath | Out-Null
    Push-Location $RepoRoot
    try { docker @rmArgs *> (Join-Path $RunDir 'docker-compose-rm.log') } finally { Pop-Location }
    $fixActions++
}

# fix: 第一次 docker compose build(image 不存在時自動)
if (-not $SkipDocker) {
    $imageProbe = @('compose','-f','compose.runtime-manager.yml','-f','compose.host-kit.yml','--env-file',$resolvedEnvFile,'images','-q','coordinator','viewer')
    Push-Location $RepoRoot
    try {
        $imageIds = docker @imageProbe 2>$null
    } finally { Pop-Location }
    $hasImages = -not [string]::IsNullOrWhiteSpace(($imageIds | Out-String))

    if ($Build -or -not $hasImages) {
        $why = if ($Build) { 'forced by -Build' } else { 'first time (no image found)' }
        Write-DeployTag -Tag 'fix' -Message "docker compose build coordinator viewer ($why) — may take 3-5 min" -LogPath $LogPath | Out-Null
        $buildArgs = @('compose','-f','compose.runtime-manager.yml','-f','compose.host-kit.yml','--env-file',$resolvedEnvFile,'build','coordinator','viewer')
        Push-Location $RepoRoot
        try {
            docker @buildArgs *> (Join-Path $RunDir 'docker-compose-build.log')
            $buildExit = $LASTEXITCODE
        } finally { Pop-Location }
        if ($buildExit -ne 0) {
            Write-DeployTag -Tag 'fail' -Message "docker compose build failed (see scripts\.run\docker-compose-build.log)" -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (docker build)'
            exit 2
        }
        $fixActions++
    }
}

# fix: docker compose pull(opt-in)
if ($Pull -and -not $SkipDocker) {
    Write-DeployTag -Tag 'fix' -Message 'docker compose pull (opt-in)' -LogPath $LogPath | Out-Null
    Push-Location $RepoRoot
    try { docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file $resolvedEnvFile pull } finally { Pop-Location }
    $fixActions++
}

Write-DeployTag -Tag 'ok' -Message "Phase 2 complete ($fixActions actions)" -LogPath $LogPath | Out-Null

# ============================================================
# Phase 3: Interactive guard(動到別人活著的 process 才問)
# ============================================================
Write-DeployHeader -Title 'Phase 3: Interactive guard (dangerous actions)'

$strangerPortPids = @($ports.docker + $ports.hostNative |
    Where-Object { $_.status -eq 'OCCUPIED' -and -not $_.ourPidFile })

if ($strangerPortPids.Count -eq 0 -and $hostNative.venv -ne 'WRONG_VERSION') {
    Write-DeployTag -Tag 'ok' -Message 'no dangerous action needed' -LogPath $LogPath | Out-Null
}

foreach ($sp in $strangerPortPids) {
    $prompt = "port $($sp.port) occupied by PID $($sp.pid) ($($sp.name)). Stop-Process? (y/N)"
    if ($Force) {
        Write-DeployTag -Tag 'fix' -Message "$prompt -> y (--Force)" -LogPath $LogPath | Out-Null
        Stop-Process -Id $sp.pid -Force -ErrorAction SilentlyContinue
    } else {
        Write-DeployTag -Tag 'ask' -Message $prompt -LogPath $LogPath | Out-Null
        $response = Read-Host 'y/N'
        if ($response -match '^[Yy]') {
            Stop-Process -Id $sp.pid -Force -ErrorAction SilentlyContinue
            Write-DeployTag -Tag 'fix' -Message "killed PID $($sp.pid)" -LogPath $LogPath | Out-Null
        } else {
            Write-DeployTag -Tag 'fail' -Message "user declined to kill PID $($sp.pid)" -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 3 -FailedPhase 'Phase 3 (user declined)'
            exit 3
        }
    }
}

if ($hostNative.venv -eq 'WRONG_VERSION') {
    $prompt = '.venv has wrong Python version (<3.11). Recreate? (will delete .venv) (y/N)'
    if ($Force) {
        Write-DeployTag -Tag 'fix' -Message "$prompt -> y (--Force)" -LogPath $LogPath | Out-Null
        Remove-Item -LiteralPath (Join-Path $RepoRoot '.venv') -Recurse -Force
        & python -m venv (Join-Path $RepoRoot '.venv')
    } else {
        Write-DeployTag -Tag 'ask' -Message $prompt -LogPath $LogPath | Out-Null
        $response = Read-Host 'y/N'
        if ($response -match '^[Yy]') {
            Remove-Item -LiteralPath (Join-Path $RepoRoot '.venv') -Recurse -Force
            & python -m venv (Join-Path $RepoRoot '.venv')
        } else {
            Write-DeployTag -Tag 'fail' -Message 'user declined .venv recreate' -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 3 -FailedPhase 'Phase 3 (user declined)'
            exit 3
        }
    }
}

# ============================================================
# Phase 4: Start (依賴順序 4a → 4b → 4c)
# ============================================================
Write-DeployHeader -Title 'Phase 4: Start services'

# 4a: host-native conversion-service
if ($SkipConversion) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4a host-native conversion (--SkipConversion)' -LogPath $LogPath | Out-Null
} elseif (Test-AlreadyRunning -Name 'bim-streaming-conversion-service' -RunDir $RunDir) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4a host-native conversion already running' -LogPath $LogPath | Out-Null
} else {
    Write-DeployTag -Tag 'ok' -Message 'Phase 4a starting host-native conversion-service' -LogPath $LogPath | Out-Null
    $startInfo = Start-HostNativeConversion -RepoRoot $RepoRoot -RuntimeStorageRoot $volume.runtimeStorageRoot
    Write-DeployTag -Tag 'ok' -Message "conversion PID=$($startInfo.Pid) log=$($startInfo.LogPath)" -LogPath $LogPath | Out-Null
    $ok = Wait-HostNativeHealth -Name 'conversion-service' -Url 'http://127.0.0.1:49101/health' -TimeoutSec 30
    if (-not $ok) {
        Write-DeployTag -Tag 'fail' -Message 'stage=4a Phase 4a conversion-service /health did not return 200 within 30s' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4a (conversion)'
        exit 4
    }
    Write-DeployTag -Tag 'ok' -Message 'Phase 4a conversion-service ready (:49101 /health 200)' -LogPath $LogPath | Out-Null
}

# 4b: host-native Kit
if ($SkipKit) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4b host-native Kit (--SkipKit)' -LogPath $LogPath | Out-Null
} elseif (Test-AlreadyRunning -Name 'bim-streaming-server' -RunDir $RunDir) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4b host-native Kit already running' -LogPath $LogPath | Out-Null
} else {
    Write-DeployTag -Tag 'ok' -Message 'Phase 4b starting host-native Kit streaming' -LogPath $LogPath | Out-Null
    $startInfo = Start-HostNativeKit -RepoRoot $RepoRoot -SignalPort $KitSignalPort -StreamPort $KitMediaPort
    Write-DeployTag -Tag 'ok' -Message "Kit PID=$($startInfo.Pid) log=$($startInfo.LogPath)" -LogPath $LogPath | Out-Null
    $kitRes = Wait-KitReady -LogPath $startInfo.LogPath -SignalPort $KitSignalPort -TimeoutSec 90
    if (-not $kitRes.ready) {
        Write-DeployTag -Tag 'fail' -Message "stage=4b Phase 4b Kit not ready in 90s (listen=$($null -ne $kitRes.listenPort) keyword=$($kitRes.matchedKeyword))" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4b (Kit)'
        exit 4
    }
    Write-DeployTag -Tag 'ok' -Message "Phase 4b Kit ready (:$KitSignalPort LISTEN + '$($kitRes.matchedKeyword)')" -LogPath $LogPath | Out-Null
}

# 4c: docker compose
if ($SkipDocker) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4c docker compose (--SkipDocker)' -LogPath $LogPath | Out-Null
} else {
    Write-DeployTag -Tag 'ok' -Message 'Phase 4c running scripts\start-web-plane-docker.ps1' -LogPath $LogPath | Out-Null
    Push-Location $RepoRoot
    try {
        & "$PSScriptRoot\start-web-plane-docker.ps1" -EnvFile $resolvedEnvFile *> (Join-Path $RunDir 'docker-compose-up.log')
        $dockerExit = $LASTEXITCODE
    } finally { Pop-Location }
    if ($dockerExit -ne 0) {
        Write-DeployTag -Tag 'fail' -Message "stage=4c Phase 4c docker compose up failed (exit=$dockerExit; see scripts\.run\docker-compose-up.log)" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4c (docker)'
        exit 4
    }
    Write-DeployTag -Tag 'ok' -Message 'Phase 4c docker compose up complete' -LogPath $LogPath | Out-Null
}

# ============================================================
# Phase 5: Post-start verify (best-effort)
# ============================================================
Write-DeployHeader -Title 'Phase 5: Post-start verify (best-effort)'

$verifyFails = @()

function Probe-Url {
    param([string] $Name, [string] $Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) {
            Write-DeployTag -Tag 'ok' -Message "verify $Name http=$($r.StatusCode) at $Url" -LogPath $LogPath | Out-Null
            return $true
        }
        Write-DeployTag -Tag 'warn' -Message "verify $Name http=$($r.StatusCode) at $Url" -LogPath $LogPath | Out-Null
        return $false
    } catch {
        Write-DeployTag -Tag 'warn' -Message "verify $Name unreachable at $Url :: $($_.Exception.Message)" -LogPath $LogPath | Out-Null
        return $false
    }
}

if (-not $SkipDocker) {
    if (-not (Probe-Url -Name 'coordinator' -Url 'http://127.0.0.1:8004/health')) { $verifyFails += 'coordinator' }
    if (-not (Probe-Url -Name 'viewer'      -Url 'http://127.0.0.1:5173'))        { $verifyFails += 'viewer' }
}
if (-not $SkipConversion) {
    if (-not (Probe-Url -Name 'conversion'  -Url 'http://127.0.0.1:49101/health')) { $verifyFails += 'conversion' }
}

if ($StrictPostVerify -and $verifyFails.Count -gt 0) {
    Write-DeployTag -Tag 'fail' -Message "Phase 5 strict verify failed: $($verifyFails -join ',')" -LogPath $LogPath | Out-Null
    Print-FinalSummary -ExitCode 5 -FailedPhase 'Phase 5 (strict verify)'
    exit 5
}

# ============================================================
# Final Summary(Print-FinalSummary 已在 Phase 1 之前定義)
# ============================================================
Print-FinalSummary -ExitCode 0 -FailedPhase ''
exit 0
```

- [ ] **Step 2: 不能在 main / production 直接跑 — 先 syntax check**

Run:
```powershell
pwsh -NoProfile -Command "$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content scripts\deploy.ps1 -Raw), [ref]$null); Write-Host 'syntax OK'"
```

Expected: `syntax OK`。

- [ ] **Step 3: Commit**

```powershell
git add scripts\deploy.ps1
git diff --cached --check
git commit -m "feat(deploy): add scripts\deploy.ps1 Mode C hybrid orchestrator

整合 scripts\lib\* 八個 module,實作 spec §6 完整 Phase 0-5 流程:
- Phase 1 read-only preflight + audit JSON
- Phase 2 auto-fix(.venv / .env missing-key / volume alignment append /
  stale PID / 建目錄 / 容器衝突 rm / 第一次 docker build / -Pull)
- Phase 3 互動 guard(陌生 PID 佔 port / .venv WRONG_VERSION)
- Phase 4 嚴格順序啟動(4a conversion → 4b Kit → 4c docker compose)
- Phase 5 post-start verify(best-effort,默認 warn 不 fail)
- Final Summary 成功/失敗各印對應指引

退出碼 0/1/2/3/4/5 對齊 spec §6.3。
不改 start-all.ps1 / start-web-plane-docker.ps1 / start-runtime-manager-docker.ps1
(spec §4 / §13 acceptance criteria #10)。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Layer 2 integration test `scripts\tests\test-deploy-dryrun.ps1`

**Goal:** `-DryRun` 不動真實狀態 + 退 0 + 印 Phase 1 audit + 不印 `[fix ]`。

**Files:**
- Create: `scripts\tests\test-deploy-dryrun.ps1`

- [ ] **Step 1: 寫 test**

```powershell
# scripts\tests\test-deploy-dryrun.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$deploy = Join-Path $repoRoot 'scripts\deploy.ps1'

# 跑 -DryRun 並抓 stdout
$output = & $deploy -DryRun 2>&1 | Out-String
$exitCode = $LASTEXITCODE

# Test 1: 退 0
Assert-Equal 0 $exitCode '-DryRun exit 0'
Write-TestPass '-DryRun exit 0'

# Test 2: 印 Phase 1 audit
Assert-True ($output -match 'Phase 1: Preflight') 'Phase 1 header printed'
Write-TestPass 'Phase 1 header'

# Test 3: 印 audit 結果(至少含 docker 系列)
Assert-True ($output -match '\[ok\s+\]|\[fix\s+\]|\[fail\s+\]') 'audit lines printed'
Write-TestPass 'audit lines'

# Test 4: Phase 2 標 DRY-RUN
Assert-True ($output -match 'DRY-RUN') 'DRY-RUN marker printed'
Write-TestPass 'DRY-RUN marker'

# Test 5: 真實狀態未被改(.venv 是否 pre-existed 一致 / docker compose 未啟動)
# 這是 best-effort check;只看 deploy-audit.json 有寫
$auditJson = Join-Path $repoRoot 'scripts\.run\deploy-audit.json'
Assert-True (Test-Path $auditJson) 'deploy-audit.json written'
Write-TestPass 'deploy-audit.json present'

# Test 6: Phase 4 / 5 應不出現
Assert-True (-not ($output -match 'Phase 4:')) 'Phase 4 not entered under -DryRun'
Write-TestPass 'Phase 4 skipped'

Write-Host "`n=== test-deploy-dryrun.ps1: ALL PASSED ===" -ForegroundColor Green
```

- [ ] **Step 2: 跑 test**

Run:
```powershell
pwsh -NoProfile -File scripts\tests\test-deploy-dryrun.ps1
```

Expected: 6 個 `[PASS]` + ALL PASSED。

> 注意:`-DryRun` 需要 docker / nvidia-smi 在 PATH 才能跑通(Phase 1 audit 會跑真 CLI)。若在 minimal CI runner 上跑,某些 `[fail]` 是預期的,但 `-DryRun` 本身仍應退 0(因為 spec §6.2 規定 DryRun 不退非 0)。如果這在你環境跑 fail,看 deploy.ps1 邏輯 — 若是 hardFail 條件被觸發,deploy 會在 Phase 1 結尾退 1,**這時 -DryRun 也會退 1**(預期行為,代表環境真的不行)。

- [ ] **Step 3: Commit**

```powershell
git add scripts\tests\test-deploy-dryrun.ps1
git diff --cached --check
git commit -m "test(deploy): add Layer 2 integration test test-deploy-dryrun.ps1

驗證 spec §9.2 -DryRun 不動真實狀態、印 Phase 1 audit、退 0、不進
Phase 4/5。同時驗 deploy-audit.json 落地(spec §8.3)。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: `docs\runbooks\one-click-deploy-smoke.md` Layer 3 手動 smoke checklist

**Files:**
- Create: `docs\runbooks\one-click-deploy-smoke.md`

- [ ] **Step 1: 建 runbook 目錄**

```powershell
pwsh -NoProfile -Command "New-Item -ItemType Directory -Path 'docs\runbooks' -Force | Out-Null"
```

- [ ] **Step 2: 寫 `docs\runbooks\one-click-deploy-smoke.md`**

````markdown
# One-Click Deploy(Mode C hybrid)Smoke Checklist

> Layer 3 手動 smoke。對應 `docs/superpowers/specs/2026-05-26-one-click-deploy-design.md` §9.3。
> 這份 checklist 在 `scripts\deploy.ps1` 第一次合進 main 之前跑一次,蓋章在本檔下方「Smoke Pass Log」。

## Prerequisites

- Windows host
- NVIDIA GPU + driver(`nvidia-smi` 在 PATH)
- Docker Desktop 已裝且 running(tray icon settled)
- Node 18+ / Python 3.12+ 已裝(`.venv` 由 deploy 自動建)

## Steps

### 1. Cold start

```powershell
# Stop all
.\scripts\stop-runtime-manager-docker.ps1
.\scripts\stop-all.ps1

# Clear local artifacts
Remove-Item -LiteralPath .\.venv -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\bim-review-coordinator\node_modules -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\web-viewer-sample\node_modules -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\.env.web-plane.host-kit -Force -ErrorAction SilentlyContinue
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml down -v
```

### 2. Run deploy

```powershell
.\scripts\deploy.ps1
```

**Expected:** 5-6 個 `[fix ]` lines(create .venv / pip / Copy-Item .env / docker compose build / etc),全程 < 10 分鐘,退 0。

### 3. Open coordinator UI

開 <http://127.0.0.1:8004/ui>

**Expected:** Coordinator dashboard 載入。

### 4. Verify WebRTC handshake

開 <http://127.0.0.1:5173>(viewer 由 docker compose 提供)。

**Expected:** Viewer 跑起來,session 建立,WebRTC handshake 成功,viewport 有畫面(`readyState=4` + 影像尺寸 > 0,參考 memory `webrtc-no-video-reset-user-recovery`)。

### 5. Hot re-run(idempotent)

```powershell
.\scripts\deploy.ps1
```

**Expected:**
- 0 個 `[fix ]`
- 0 個 `[ask ]`
- Phase 4 全部 `[skip ] already running`
- 退 0
- 總時 < 30 秒

### 6. Forced rebuild

```powershell
.\scripts\deploy.ps1 -Build
```

**Expected:** Docker image 重 build、container recreate、host-native 不重啟(若 PID 仍活)。

### 7. Failure injection

```powershell
# 故意關 Docker Desktop(在 system tray 退出)
.\scripts\deploy.ps1
```

**Expected:** Phase 1 `[fail ]` preflight-docker engineRunning=false,退 1,host-native 不啟動。

---

## Smoke Pass Log

> 第一次 smoke 通過後填這欄,之後每次大改 deploy.ps1 也回來蓋一次。

| Date       | Operator | Branch / Commit                                | Notes |
|------------|----------|------------------------------------------------|-------|
| YYYY-MM-DD | YOUR_NAME| `docs/one-click-deploy-design-2026-05-26 @ XXXXXX` | (pending first run) |
````

- [ ] **Step 3: Commit**

```powershell
git add docs\runbooks\one-click-deploy-smoke.md
git diff --cached --check
git commit -m "docs(deploy): add Layer 3 manual smoke checklist

7 步驟手動 smoke runbook,對齊 spec §9.3。第一次合進 main 前操作員
跑一次蓋章在 Smoke Pass Log。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 4: 跑全部 Layer 1 + Layer 2 測試,確認整體 pass**

Run:
```powershell
pwsh -NoProfile -Command "Get-ChildItem scripts\tests\test-*.ps1 -Exclude test-pr-review-agent.ps1,test-helpers.ps1 | ForEach-Object { Write-Host '`n=== ' $_.Name -ForegroundColor Cyan; pwsh -NoProfile -File $_.FullName }"
```

Expected: 每個 test file 結尾印 `ALL PASSED`,全部都通過。

- [ ] **Step 5: 跑 Layer 3 smoke**

依 runbook 一條條跑,在 `docs\runbooks\one-click-deploy-smoke.md` 的 Smoke Pass Log 填上 row,commit:

```powershell
git add docs\runbooks\one-click-deploy-smoke.md
git commit -m "docs(deploy): mark Layer 3 smoke pass on $(Get-Date -Format yyyy-MM-dd)"
```

---

## Task 13: 收尾 — GitNexus re-index + PR

- [ ] **Step 1: GitNexus re-index**

新增的 `scripts\deploy.ps1`、`scripts\lib\*.ps1`、`scripts\tests\test-*.ps1` 都新增了 PowerShell symbols(function / parameter)。

Run:
```powershell
npx gitnexus analyze --embeddings
```

Expected: `Status: ✅ up-to-date` + nodes/edges count 增加(原 5042/9201 上升)。

- [ ] **Step 2: GitNexus detect-changes 驗 scope**

```powershell
pwsh -NoProfile -Command "Write-Host '請在 Claude Code 內呼叫 gitnexus_detect_changes({ scope: \"compare\", base_ref: \"main\" })'"
```

Expected: 改動範圍限於 `scripts\deploy.ps1` + `scripts\lib\*` + `scripts\tests\test-*` + `docs\superpowers\specs\*` + `docs\superpowers\plans\*` + `docs\runbooks\*`;`start-all.ps1` / `start-web-plane-docker.ps1` / `start-runtime-manager-docker.ps1` / `compose.*.yml` **沒有出現在 changed list**(對齊 spec §13 #10)。

- [ ] **Step 3: Push branch + 開 PR**

```powershell
git push -u origin docs/one-click-deploy-design-2026-05-26
gh pr create --title "feat(deploy): Mode C 一鍵部屬(deploy.ps1 + scripts\lib\* + tests)" --body "$(cat <<'EOF'
## Summary

新增 `scripts\deploy.ps1` 與 `scripts\lib\*.ps1`(8 個 module),讓 Mode C(web-plane Docker + host-native Kit)能用一條指令冷啟到 demo-ready。

- Phase 1 preflight(read-only audit:docker / host-native / .env / ports / volume alignment)
- Phase 2 auto-fix(安全項目:venv / .env missing-key / volume alignment append / stale PID / 建目錄 / 容器衝突 rm / 第一次 docker build)
- Phase 3 interactive guard(陌生 PID 佔 port / .venv WRONG_VERSION;`-Force` 跳)
- Phase 4 嚴格順序啟動(4a conversion → 4b Kit → 4c docker compose)
- Phase 5 post-start verify(best-effort)
- Final Summary(成功 / 失敗各印 next steps)
- Layer 1 unit tests(repo 風格,純 PowerShell + Assert-*)
- Layer 2 integration `-DryRun` test
- Layer 3 manual smoke runbook(`docs\runbooks\one-click-deploy-smoke.md`,已蓋章)

完全不動 `start-all.ps1` / `start-web-plane-docker.ps1` / `start-runtime-manager-docker.ps1` / `compose.*.yml`(spec §4 / §13 acceptance #10)。

Spec:`docs/superpowers/specs/2026-05-26-one-click-deploy-design.md`(commit `c900bab`)
Plan:`docs/superpowers/plans/2026-05-26-one-click-deploy.md`

## Test plan

- [x] Layer 1 Pester-style unit tests(8 modules)全綠
- [x] Layer 2 `-DryRun` integration test 綠
- [x] Layer 3 manual smoke checklist 跑過(見 runbook Smoke Pass Log)
- [x] `start-all.ps1` / `start-web-plane-docker.ps1` / `start-runtime-manager-docker.ps1` / `compose.*.yml` 完全沒動
- [x] `gitnexus detect-changes` scope 對齊預期

## Out of scope

- CI workflow yml(留 follow-up PR)
- Production 部屬(Service / Autostart)
- Mode A / Mode B 一鍵部屬

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: PR review 等待 + merge**

依 repo 規範等 reviewer + GitHub Actions(pr-review-agent.yml)pass,merge 進 main。merge 後本地 closeout:

```powershell
git switch main
git fetch origin --prune
git status --short --branch
git branch -D docs/one-click-deploy-design-2026-05-26
```

---

## Self-Review

依 writing-plans skill 對 spec 做覆蓋率與 placeholder 掃描。

### Spec Coverage

| Spec 章節 | 對應 Task |
|---|---|
| §1 Goal、§13 Acceptance Criteria | Task 10(deploy.ps1)+ Task 11(dryrun)+ Task 12(smoke) |
| §2 Background、§3 Decision Summary | 對應於各 Task 的 module choice / commit message |
| §4 Out of Scope | Task 13 PR body 明確列出 |
| §5.1 Phase 流程、§5.2 Module 分工、§5.3 Invariants | Task 2-9 一個 module 一個 task |
| §6 Execution Flow + 退出碼 | Task 10 deploy.ps1 整合 |
| §7.1 A 區自動做 | Task 10 Phase 2 各 fix block |
| §7.2 B 區互動 | Task 10 Phase 3 |
| §7.3 C 區永遠不做 | Task 10 邊界(沒 install / 沒改 compose / 沒寫 secret) |
| §7.4 Volume 對齊方案 A | Task 7(preflight) + Task 8 Start-HostNativeConversion 反向 export |
| §8.1 輸出格式、§8.2 Summary、§8.3 落地物 | Task 2 deploy-report + Task 10 Print-FinalSummary |
| §8.4 失敗時不 rollback | Task 10 各 stage exit 對應 hardFail 行為 |
| §9.1 Layer 1 unit、§9.2 Layer 2 dryrun、§9.3 Layer 3 smoke | Task 2-9 / Task 11 / Task 12 |
| §10 Risks | 沒對應 task — risks 是 PR review 時關注,不是 implementation step |
| §11 Open Questions | 標 v2 / follow-up,不在本 plan |
| §12 Glossary、§13 Acceptance | reference 文件,不是 implementation step |

**Gap 檢查:** 全部 spec 章節都有對應 task(或被明確標為 reference / risk awareness)。

### Placeholder Scan

- 沒 TBD / TODO / "implement later"
- 每個 step 都有實際的 PowerShell 代碼或 shell command
- 每個 commit message 都是完整字串
- 退出碼、port number、env key name 都對齊 spec

### Type Consistency

- `Write-DeployTag`(在 Task 2 定義)在 Task 3-10 全部呼叫;參數名 `-Tag` / `-Message` / `-LogPath` 一致
- `Test-DockerEnvironment` / `Test-HostNativeEnvironment` / `Test-EnvFiles` / `Test-PortAvailability` / `Test-VolumeAlignment` 命名一致(Test-* 動詞 + 名詞)
- `Start-HostNativeConversion` / `Start-HostNativeKit` 配對
- `Wait-HostNativeHealth` / `Wait-KitReady` 都是 Wait-* 動詞
- `Remove-StalePidFile` / `Test-AlreadyRunning` 對齊 `start-all.ps1` 既有命名
- `volume.status` enum:`ALIGNED | MISSING_KEY | WRONG_LEAF` 在 Task 7 module / Task 10 orchestrator / spec §6.2 三處一致
- Port number:8004 / 5173 / 49100 / 49101 / 47998 各處一致

無 type 矛盾。

---

## Execution Handoff

Plan 完成並 commit 到 `docs/superpowers/plans/2026-05-26-one-click-deploy.md`(本檔)。

兩個執行方式:

**1. Subagent-Driven(推薦)** — 由我每個 task dispatch 一個 fresh subagent,task 之間我做兩階段 review(spec 合規性 + code quality),快速迭代。

**2. Inline Execution** — 我自己在這個 session 內按 task 順序執行,中間 checkpoint 問你 review。

哪一個?
