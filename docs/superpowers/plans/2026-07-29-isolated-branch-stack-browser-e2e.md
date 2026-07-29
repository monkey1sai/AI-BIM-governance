# Isolated Branch Stack Browser E2E Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 建立 repo-owned、fail-closed 的未 merge branch CPU governance／coordinator／browser operability 隔離驗證切片，讓每份 evidence 可由 manifest 綁定 worktree、HEAD、port、process identity 與真實 browser run。

**Architecture:** 一支 PowerShell launcher 只管理 governance 與 coordinator，將固定 base port 加上受限 offset 後寫入每 run 唯一的 stack manifest；任何輸入、port 或 ownership 不可信時，在 listener cleanup 與啟動之前停止。Playwright 讀同一 manifest 作 coordinator/viewer authority，viewer lifecycle 仍由 `webServer` 擁有，require-real consumer 以共用 guard 禁止 skip、env 跨 session 覆寫與保留 port request，並將 harness 狀態與 browser artifacts 寫入 evidence manifest。

**Tech Stack:** PowerShell 7、Windows CIM／`Start-Process`、FastAPI/uvicorn、Node.js 20/tsx、TypeScript 5、Vite 5、Playwright 1.61、Vitest 2、GitHub Actions、OpenSpec lifecycle ledger。

## Global Constraints

- 隔離 base ports 固定為 coordinator `8005`、governance `49103`、viewer `5180`；offset 只接受十進位整數 `0..4`。
- 保留集合固定含 `8004`、`49102`、`49101`、`8010`、`5173`、`5174`、`49100`、`49110..49150`；domain 與交集檢查必須先於任何 listener 查詢、cleanup 或 service start。
- `ChangeId` 與 `RunId` 必填且只能是安全單一路徑 segment；manifest 固定為 `artifacts/e2e/<change-id>/<run-id>/stack-manifest.json`，同名存在時不得覆寫、停止或啟動。
- cleanup 只允許 manifest PID、精確 process entrypoint/command line、creation identity 三者在 stop 前全部重驗相符的 backend；先驗完全部 backend，再停止任何一個 PID。
- launcher 只管理 governance/coordinator；viewer 只由 Playwright `webServer` 或同 manifest viewer port 上的明示 external server 管理。不得啟動 Kit、streaming server、WebRTC 或 GPU runtime。
- 被引用為 evidence 的 run 必須設 `E2E_REQUIRE_REAL=1` 與 `E2E_STACK_MANIFEST`；缺 manifest、錯 worktree/path/content/head、env mismatch、API/fixture/surface 缺失或保留 port request 都是 hard failure，不得 `test.skip`。
- browser 只呼叫 manifest coordinator；不得直連 governance internal port。harness build flag 與 query flag都要揭露，任一 fake control-plane harness 生效時不得宣稱 coordinator review socket／authority ack 真實。
- 本 change 不修改 A4 runtime/UI 實作、不修 A4 consumer failure、不碰 Kit/WebRTC/design baselines/deploy semantics，也不執行 `scripts/dev/rebuild-test-deploy.ps1`。
- 隔離 evidence 只證明 CPU governance/coordinator/browser operability；不得推論 design、deploy、Kit/WebRTC、first-frame、stage truth 或 DataChannel 通過。

---

### Task 1: Contract text and executable documentation guard

**Files:**
- Modify: `docs/agents/product-operability-and-script-contract.md`
- Modify: `scripts/SCRIPT_CONTRACT.md`
- Test: `scripts/tests/test-isolated-branch-stack.ps1` (create)

**Interfaces:**
- Consumes: P0 delta spec 的固定 port、offset、ownership、manifest 與 evidence scope。
- Produces: 文件 anchor `## 8. 隔離 branch stack 驗證`、contract entry `scripts/dev/start-isolated-branch-stack.ps1`，以及後續 launcher/browser tasks 共用的 PowerShell machine test。

- [ ] **Step 1: 寫下只檢查文件契約的 failing test**

```powershell
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
```

- [ ] **Step 2: 跑 RED，確認目前缺少正式 section 與 launcher contract**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: FAIL with `ASSERT FAILED: product contract has isolated stack section`；不得因其他 script exception 提前失敗。

- [ ] **Step 3: 寫入單一、可由 machine test 比對的產品契約文字**

```markdown
## 8. 隔離 branch stack 驗證

未 merge branch 的 CPU governance／coordinator／browser operability evidence MUST 在
`stack_kind=isolated_branch_stack` 的 repo-owned 隔離切片取得。base ports 為 coordinator
`8005`、governance `49103`、Playwright viewer `5180`；parallel offset 只接受整數 `0..4`。
部署區 `8004/49102/49101/8010/5173/5174` 與 Kit `49100/49110..49150` 全部保留。
非法 offset 與 resolved-port 交集必須在 listener 查詢、cleanup、啟動之前 fail closed。

launcher `scripts/dev/start-isolated-branch-stack.ps1` 的 `start|stop|status` 必須收到安全的
`ChangeId`、`RunId`，且只管理 governance/coordinator。manifest 位於
`artifacts/e2e/<change-id>/<run-id>/stack-manifest.json`；同名不得覆寫。停止 backend 前必須
同時重驗 manifest PID、完整 entrypoint/command line 與 process creation identity；任一 backend
不符時不得停止任何 process。viewer lifecycle 僅由 Playwright `webServer` 擁有。

引用 browser result 作 evidence 時必須設 `E2E_REQUIRE_REAL=1` 與 `E2E_STACK_MANIFEST`。
manifest path/content/worktree/HEAD、coordinator/viewer env 或保留 port request 不符時 hard fail；
不得以 conditional skip 計為通過。evidence 必須揭露 harness build/query flags、resolved ports、
base URLs、observed runtime IDs 與 screenshot/trace 路徑。

隔離 stack evidence 不得推論 design gate；不得推論 deploy path；不得推論 Kit/WebRTC、GPU、
first-frame、stage truth 或 DataChannel。這些 gate 仍各自由既有契約產生 evidence。
```

在 §3 Frontend Dual-Gate 的 MUST 清單增加下列一句，不複製第二份 port 表：

```markdown
- 未 merge branch 的 CPU governance／coordinator／browser operability evidence MUST 依 §8 隔離 stack 契約取得並標示 stack kind；Kit／WebRTC／GPU evidence 另走 host-native 契約。
```

- [ ] **Step 4: 登記 dev launcher 的角色與禁止邊界**

```markdown
### Isolated branch verification adapter

- `scripts/dev/start-isolated-branch-stack.ps1`：只供未 merge branch 的 CPU governance／coordinator
  browser evidence；`start|stop|status` 以每-run manifest 管理 backend，viewer 由 Playwright 管理。
  它不是 canonical operator entrypoint，不得取代 `deploy.ps1`、`verify-all.ps1` 或 `stop-all.ps1`，
  也不得啟動 Kit、streaming server、WebRTC 或 GPU runtime。
```

- [ ] **Step 5: 跑 GREEN 並確認只改文件與 machine test**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: PASS ending with `[test-isolated-branch-stack] contract assertions passed`。

- [ ] **Step 6: Commit Task 1**

```powershell
git add docs/agents/product-operability-and-script-contract.md scripts/SCRIPT_CONTRACT.md scripts/tests/test-isolated-branch-stack.ps1
git commit -m "docs: define isolated branch stack contract"
```

---

### Task 2: Fail-closed identifiers, offsets, ports, and manifest collision

**Files:**
- Create: `scripts/dev/start-isolated-branch-stack.ps1`
- Test: `scripts/tests/test-isolated-branch-stack.ps1` (modify)

**Interfaces:**
- Consumes: `-Action start|stop|status -ChangeId <segment> -RunId <segment> -Offset <0..4>`。
- Produces: `Assert-SafeStackSegment`, `Resolve-IsolatedStackPorts`, `Resolve-IsolatedStackManifestPath`, `Assert-IsolatedStackStartPreflight`；後續 lifecycle task 使用相同 resolved object。

- [ ] **Step 1: 擴充 failing tests，鎖住 offset `0/4`、非法值 pre-listener 與 manifest collision**

```powershell
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
Assert-Throws {
    Assert-IsolatedPortSetDisjoint -Ports ([pscustomobject]@{ coordinator=8004; governance=49103; viewer=5180 })
} 'reserved coordinator port rejected'

foreach ($bad in @('-1', '1.5', '5', '48', 'abc')) {
    $listenerCalls = 0
    Assert-Throws {
        Assert-IsolatedStackStartPreflight -RepoRoot $repoRoot -ChangeId 'change-a' -RunId 'run-a' `
            -OffsetInput $bad -ListenerLookup { param($port) $script:listenerCalls++; $null }
    } "offset $bad rejected"
    Assert-Equal 0 $listenerCalls "offset $bad rejected before listener lookup"
}

foreach ($badId in @('', '.', '..', 'a/b', 'a\b', 'a:b', ' leading')) {
    foreach ($field in @('ChangeId', 'RunId')) {
        Assert-Throws { Assert-SafeStackSegment -Name $field -Value $badId } "unsafe $field rejected: $badId"
    }
}

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
```

- [ ] **Step 2: 跑 RED，確認 launcher 尚不存在**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: FAIL because `scripts/dev/start-isolated-branch-stack.ps1` cannot be dot-sourced。

- [ ] **Step 3: 建立可 dot-source 測試、直接執行才 dispatch 的最小 launcher core**

```powershell
[CmdletBinding()]
param(
    [ValidateSet('start', 'stop', 'status')][string] $Action = 'status',
    [string] $ChangeId,
    [string] $RunId,
    [string] $Offset = '0'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:IsolatedStackPolicy = [ordered]@{
    base = [ordered]@{ coordinator = 8005; governance = 49103; viewer = 5180 }
    reserved = @(8004, 49102, 49101, 8010, 5173, 5174, 49100) + @(49110..49150)
}

function Assert-SafeStackSegment {
    param([string] $Name, [string] $Value)
    if ([string]::IsNullOrWhiteSpace($Value) -or
        $Value -in @('.', '..') -or
        $Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
        throw "$Name must be one safe path segment (1..64 chars: A-Z, a-z, 0-9, dot, underscore, dash)."
    }
}

function Resolve-IsolatedStackPorts {
    param([string] $OffsetInput)
    if ($OffsetInput -notmatch '^[0-4]$') {
        throw 'Offset must be one integer from 0 through 4.'
    }
    $resolvedOffset = [int]$OffsetInput
    $ports = [ordered]@{
        coordinator = $script:IsolatedStackPolicy.base.coordinator + $resolvedOffset
        governance = $script:IsolatedStackPolicy.base.governance + $resolvedOffset
        viewer = $script:IsolatedStackPolicy.base.viewer + $resolvedOffset
    }
    $resolved = [pscustomobject]$ports
    Assert-IsolatedPortSetDisjoint -Ports $resolved
    return $resolved
}

function Assert-IsolatedPortSetDisjoint {
    param($Ports)
    $conflicts = @(
        @($Ports.coordinator, $Ports.governance, $Ports.viewer) |
            Where-Object { $script:IsolatedStackPolicy.reserved -contains $_ }
    )
    if ($conflicts.Count -gt 0) {
        throw "Resolved ports intersect reserved ports: $($conflicts -join ',')."
    }
}

function Resolve-IsolatedStackManifestPath {
    param([string] $RepoRoot, [string] $ChangeId, [string] $RunId)
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    return Join-Path $RepoRoot "artifacts\e2e\$ChangeId\$RunId\stack-manifest.json"
}

function Assert-IsolatedStackStartPreflight {
    param(
        [string] $RepoRoot, [string] $ChangeId, [string] $RunId, [string] $OffsetInput,
        [scriptblock] $ListenerLookup = {
            param($port)
            Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
                Select-Object -First 1
        }
    )
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    $ports = Resolve-IsolatedStackPorts -OffsetInput $OffsetInput
    $manifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId
    if (Test-Path -LiteralPath $manifestPath) {
        throw "Manifest collision: $manifestPath"
    }
    foreach ($port in @($ports.coordinator, $ports.governance)) {
        $listener = & $ListenerLookup $port
        if ($null -ne $listener) {
            throw "Port $port is occupied; ownership is unknown. No process was stopped."
        }
    }
    [pscustomobject]@{ ports = $ports; manifest_path = $manifestPath; offset = [int]$OffsetInput }
}

```

Direct execution wiring is deliberately added only after Task 4 defines the complete dispatcher; Task 2 remains dot-sourceable and its commit does not expose a partial CLI。

- [ ] **Step 4: 跑 GREEN，確認非法輸入與 collision 都在 listener 前終止**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: PASS for offsets `0/4` and every invalid-input/collision assertion；test doubles observe zero listener calls。

- [ ] **Step 5: Commit Task 2**

```powershell
git add scripts/dev/start-isolated-branch-stack.ps1 scripts/tests/test-isolated-branch-stack.ps1
git commit -m "feat: validate isolated stack identity and ports"
```

---

### Task 3: Process identity and backend lifecycle primitives

**Files:**
- Modify: `scripts/dev/start-isolated-branch-stack.ps1`
- Test: `scripts/tests/test-isolated-branch-stack.ps1` (modify)

**Interfaces:**
- Consumes: Task 2 validated IDs/ports and Windows `Win32_Process` snapshots.
- Produces: `Resolve-IsolatedRuntime`, `Get-IsolatedProcessIdentity`, `Test-IsolatedProcessOwnership`, `Start-IsolatedBackend`, `Wait-IsolatedHealth`, `Stop-IsolatedBackends`, `Write-IsolatedJsonAtomic`.

- [ ] **Step 1: Add RED tests for exact identity and all-before-any-stop**

```powershell
$expected = [pscustomobject]@{ role='governance'; pid=4201; entrypoint='app:app'; command_line='python -m uvicorn app:app'; creation_identity='c1' }
$same = [pscustomobject]@{ role='governance'; pid=4201; entrypoint='app:app'; command_line='python -m uvicorn app:app'; creation_identity='c1' }
Assert-True (Test-IsolatedProcessOwnership -Expected $expected -Actual $same) 'exact identity accepted'
foreach ($field in @('pid','entrypoint','command_line','creation_identity')) {
    $changed = $same.PSObject.Copy()
    $changed.$field = if ($field -eq 'pid') { 9999 } else { "wrong-$field" }
    Assert-True (-not (Test-IsolatedProcessOwnership -Expected $expected -Actual $changed)) "$field mismatch rejected"
}

$stopped = [System.Collections.Generic.List[int]]::new()
$owned = @(
    [pscustomobject]@{ role='governance';pid=4201;entrypoint='app:app';command_line='gov';creation_identity='c1' },
    [pscustomobject]@{ role='coordinator';pid=4202;entrypoint='src/index.ts';command_line='coord';creation_identity='c2' }
)
Assert-Throws {
    Stop-IsolatedBackends -Processes $owned `
      -IdentityLookup { param($e) if($e.pid -eq 4201){$e}else{[pscustomobject]@{role='coordinator';pid=4202;entrypoint='wrong';command_line='coord';creation_identity='c2'}} } `
      -StopProcessFn { param($pid) $script:stopped.Add($pid) }
} 'one mismatch holds the entire stop'
Assert-Equal 0 $stopped.Count 'all identities validate before any stop'
```

- [ ] **Step 2: Run the ownership RED test**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: FAIL with `Test-IsolatedProcessOwnership is not recognized`.

- [ ] **Step 3: Add runtime and process snapshot functions**

```powershell
function Resolve-IsolatedRuntime {
    param([string] $RepoRoot)
    $pythonCandidates = @(
        (Join-Path $RepoRoot 'governance-service\.venv\Scripts\python.exe'),
        (Join-Path $RepoRoot '.venv\Scripts\python.exe'),
        'C:\Program Files\Python312\python.exe'
    )
    $pythonExe = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $pythonExe) { throw 'No supported host Python was found.' }
    $nodeExe = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    $tsxCli = Join-Path $RepoRoot 'bim-review-coordinator\node_modules\tsx\dist\cli.mjs'
    if (-not (Test-Path -LiteralPath $tsxCli -PathType Leaf)) { throw "Missing current-worktree tsx CLI: $tsxCli" }
    [pscustomobject]@{ python = $pythonExe; node = $nodeExe; tsx = $tsxCli }
}

function Get-IsolatedProcessIdentity {
    param(
        [int] $Pid,
        [string] $Entrypoint,
        [scriptblock] $ProcessLookup = { param($id) Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop }
    )
    $process = & $ProcessLookup $Pid
    if ($null -eq $process) { throw "Process $Pid is not running." }
    $commandLine = [string]$process.CommandLine
    if (-not $commandLine.Contains($Entrypoint, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Process $Pid command line does not contain exact entrypoint $Entrypoint."
    }
    [pscustomobject]@{
        pid = [int]$process.ProcessId
        entrypoint = $Entrypoint
        command_line = $commandLine
        creation_identity = [string]$process.CreationDate
        executable_path = [string]$process.ExecutablePath
    }
}

function Test-IsolatedProcessOwnership {
    param($Expected, $Actual)
    $null -ne $Actual `
      -and [int]$Expected.pid -eq [int]$Actual.pid `
      -and [string]$Expected.entrypoint -ceq [string]$Actual.entrypoint `
      -and [string]$Expected.command_line -ceq [string]$Actual.command_line `
      -and [string]$Expected.creation_identity -ceq [string]$Actual.creation_identity
}
```

- [ ] **Step 4: Add the no-watcher backend starter**

```powershell
function Start-IsolatedBackend {
    param(
        [string] $Role, [string] $WorkingDirectory, [string] $Executable,
        [string[]] $Arguments, [hashtable] $Environment, [string] $RunDirectory,
        [string] $Entrypoint,
        [scriptblock] $StartProcessFn = {
            param($exe,$args,$cwd,$envMap,$stdout,$stderr)
            Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $cwd `
              -Environment $envMap -WindowStyle Hidden -PassThru `
              -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        },
        [scriptblock] $IdentityLookup = { param($pid,$entry) Get-IsolatedProcessIdentity -Pid $pid -Entrypoint $entry }
    )
    New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null
    $stdout = Join-Path $RunDirectory "$Role.stdout.log"
    $stderr = Join-Path $RunDirectory "$Role.stderr.log"
    $process = & $StartProcessFn $Executable $Arguments $WorkingDirectory $Environment $stdout $stderr
    $identity = & $IdentityLookup ([int]$process.Id) $Entrypoint
    $identity | Add-Member role $Role
    $identity | Add-Member stdout_path $stdout
    $identity | Add-Member stderr_path $stderr
    $identity
}
```

- [ ] **Step 5: Add health, ownership stop, and atomic JSON functions**

```powershell
function Wait-IsolatedHealth {
    param(
        [string] $Url, [int] $TimeoutSeconds = 45,
        [scriptblock] $Probe = { param($uri) Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $uri }
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try { if ((& $Probe $Url).StatusCode -eq 200) { return $true } } catch {}
        Start-Sleep -Milliseconds 500
    }
    $false
}

function Stop-IsolatedBackends {
    param(
        [object[]] $Processes,
        [scriptblock] $IdentityLookup = { param($e) Get-IsolatedProcessIdentity -Pid ([int]$e.pid) -Entrypoint ([string]$e.entrypoint) },
        [scriptblock] $StopProcessFn = { param($pid) Stop-Process -Id $pid -Force -ErrorAction Stop }
    )
    $verified = foreach ($expected in $Processes) {
        $actual = & $IdentityLookup $expected
        if (-not (Test-IsolatedProcessOwnership -Expected $expected -Actual $actual)) {
            throw "Ownership mismatch for $($expected.role) PID $($expected.pid); no process was stopped."
        }
        $expected
    }
    foreach ($process in @($verified | Sort-Object { [array]::IndexOf($Processes, $_) } -Descending)) {
        & $StopProcessFn ([int]$process.pid)
    }
}

function Write-IsolatedJsonAtomic {
    param([string] $Path, $Value, [switch] $NoClobber)
    if ($NoClobber -and (Test-Path -LiteralPath $Path)) { throw "Manifest collision: $Path" }
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = Join-Path $directory ".stack-manifest.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
        [System.IO.File]::Move($temporary, $Path, -not $NoClobber)
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}
```

- [ ] **Step 6: Run GREEN and static analysis**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: PASS for every identity mismatch and all-before-any-stop assertion.

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\invoke-powershell-static.ps1`

Expected: PASS ending `[invoke-powershell-static] passed`.

- [ ] **Step 7: Commit Task 3**

```powershell
git add scripts/dev/start-isolated-branch-stack.ps1 scripts/tests/test-isolated-branch-stack.ps1
git commit -m "feat: add isolated backend ownership primitives"
```

---

### Task 4: Complete start/status/stop dispatcher and rollback

**Files:**
- Modify: `scripts/dev/start-isolated-branch-stack.ps1`
- Test: `scripts/tests/test-isolated-branch-stack.ps1` (modify)

**Interfaces:**
- Consumes: Tasks 2–3 functions.
- Produces: complete `Invoke-IsolatedBranchStack` dispatcher; successful start writes `isolated-branch-stack/v1`; status reports live `{ owned, ready }` per backend without stopping; stop performs all-before-any-stop then atomically updates the manifest.

- [ ] **Step 1: Add RED tests for second-start failure rollback and stop atomicity**

```powershell
$startedRoles = [System.Collections.Generic.List[string]]::new()
$stoppedPids = [System.Collections.Generic.List[int]]::new()
Assert-Throws {
    Invoke-IsolatedBranchStack -Action start -ChangeId 'change-a' -RunId 'run-a' -OffsetInput '0' `
      -RepoRoot $sandbox `
      -PreflightFn { param($root,$change,$run,$offset) [pscustomobject]@{offset=0;ports=[pscustomobject]@{coordinator=8005;governance=49103;viewer=5180};manifest_path=(Join-Path $root 'artifacts\e2e\change-a\run-a\stack-manifest.json')} } `
      -RuntimeResolver { param($root) [pscustomobject]@{python='python';node='node';tsx='tsx.mjs'} } `
      -StartBackendFn { param($spec) $script:startedRoles.Add($spec.role); if($spec.role -eq 'coordinator'){throw 'coordinator start failed'}; [pscustomobject]@{role='governance';pid=4101;entrypoint='app:app';command_line='gov';creation_identity='c1'} } `
      -HealthFn { param($url) $true } `
      -IdentityLookup { param($e) $e } `
      -StopProcessFn { param($pid) $script:stoppedPids.Add($pid) } `
      -HeadShaFn { param($root) 'a' * 40 }
} 'second backend failure rolls back first backend'
Assert-Equal 'governance,coordinator' ($startedRoles -join ',') 'start order'
Assert-Equal '4101' ($stoppedPids -join ',') 'only this-run owned first backend stopped'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $sandbox 'artifacts\e2e\change-a\run-a\stack-manifest.json'))) 'failed start writes no success manifest'

$statusManifest = [ordered]@{
    schema_version='isolated-branch-stack/v1';stack_kind='isolated_branch_stack';change_id='change-a';run_id='run-status'
    worktree_root=$sandbox;offset=0
    ports=[ordered]@{coordinator=8005;governance=49103;viewer=5180}
    base_urls=[ordered]@{coordinator='http://127.0.0.1:8005';governance='http://127.0.0.1:49103';viewer='http://127.0.0.1:5180'}
    lifecycle_owners=[ordered]@{governance='repo_launcher';coordinator='repo_launcher';viewer='playwright_webserver'}
    viewer=[ordered]@{expected_port=5180;owner='playwright_webserver';managed_by_launcher=$false}
    processes=@(
        [pscustomobject]@{role='governance';pid=4101;entrypoint='app:app';command_line='gov';creation_identity='c1'},
        [pscustomobject]@{role='coordinator';pid=4102;entrypoint='src/index.ts';command_line='coord';creation_identity='c2'}
    )
}
$statusPath = Resolve-IsolatedStackManifestPath -RepoRoot $sandbox -ChangeId 'change-a' -RunId 'run-status'
Write-IsolatedJsonAtomic -Path $statusPath -Value $statusManifest -NoClobber
$status = Invoke-IsolatedBranchStack -Action status -ChangeId 'change-a' -RunId 'run-status' -OffsetInput '0' -RepoRoot $sandbox `
    -IdentityLookup { param($expected) $expected } `
    -HealthFn { param($url) -not $url.EndsWith(':8005/health') }
$governanceStatus = @($status.backend | Where-Object role -eq 'governance')[0]
$coordinatorStatus = @($status.backend | Where-Object role -eq 'coordinator')[0]
Assert-True ($governanceStatus.owned -and $governanceStatus.ready) 'owned healthy governance is ready'
Assert-True ($coordinatorStatus.owned -and -not $coordinatorStatus.ready) 'owned coordinator with failed live health is not ready'
```

- [ ] **Step 2: Run dispatcher RED**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: FAIL because `Invoke-IsolatedBranchStack` does not accept the dispatcher seams or status lacks live `ready` state.

- [ ] **Step 3: Add manifest reader and builder**

```powershell
function Read-IsolatedStackManifest {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Stack manifest not found: $Path" }
    Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -Depth 12
}

function Assert-IsolatedStackManifestIdentity {
    param($Manifest,[string]$RepoRoot,[string]$ChangeId,[string]$RunId,[string]$OffsetInput)
    if ([string]$Manifest.change_id -cne $ChangeId -or [string]$Manifest.run_id -cne $RunId) {
        throw 'Manifest change/run identity mismatch.'
    }
    $expectedRoot = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')
    $actualRoot = [IO.Path]::GetFullPath([string]$Manifest.worktree_root).TrimEnd('\')
    if (-not $actualRoot.Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Manifest worktree identity mismatch.'
    }
    $ports = Resolve-IsolatedStackPorts -OffsetInput $OffsetInput
    if ([int]$Manifest.offset -ne [int]$OffsetInput -or
        [int]$Manifest.ports.coordinator -ne $ports.coordinator -or
        [int]$Manifest.ports.governance -ne $ports.governance -or
        [int]$Manifest.ports.viewer -ne $ports.viewer) {
        throw 'Manifest offset/port identity mismatch.'
    }
}

function New-IsolatedStackManifest {
    param([string]$RepoRoot,[string]$ChangeId,[string]$RunId,$Preflight,[string]$HeadSha,[object[]]$Processes)
    [ordered]@{
        schema_version='isolated-branch-stack/v1'; stack_kind='isolated_branch_stack'
        change_id=$ChangeId; run_id=$RunId; worktree_root=$RepoRoot; offset=$Preflight.offset
        ports=$Preflight.ports
        base_urls=[ordered]@{
            coordinator="http://127.0.0.1:$($Preflight.ports.coordinator)"
            governance="http://127.0.0.1:$($Preflight.ports.governance)"
            viewer="http://127.0.0.1:$($Preflight.ports.viewer)"
        }
        head_sha=$HeadSha; started_at=[DateTime]::UtcNow.ToString('o'); stopped_at=$null
        backend_ready=[ordered]@{governance=$true;coordinator=$true}
        lifecycle_owners=[ordered]@{governance='repo_launcher';coordinator='repo_launcher';viewer='playwright_webserver'}
        viewer=[ordered]@{expected_port=$Preflight.ports.viewer;owner='playwright_webserver';managed_by_launcher=$false}
        processes=$Processes
    }
}
```

- [ ] **Step 4: Implement live status as one independently tested function**

```powershell
function Get-IsolatedStackStatus {
    param($Manifest,[string]$ManifestPath,[scriptblock]$IdentityLookup,[scriptblock]$HealthFn)
    $backend = foreach ($expected in @($Manifest.processes)) {
        $actual = $null
        try { $actual = & $IdentityLookup $expected } catch {}
        $owned = Test-IsolatedProcessOwnership -Expected $expected -Actual $actual
        $ready = $false
        if ($owned) {
            $healthUrl = "$($Manifest.base_urls.($expected.role))/health"
            try { $ready = [bool](& $HealthFn $healthUrl) } catch { $ready = $false }
        }
        [pscustomobject]@{ role=$expected.role;pid=$expected.pid;owned=$owned;ready=$ready }
    }
    [pscustomobject]@{stack_kind=$Manifest.stack_kind;backend=@($backend);viewer=$Manifest.viewer;manifest_path=$ManifestPath}
}
```

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: the status RED case turns GREEN: governance is `{owned:true,ready:true}` and coordinator is `{owned:true,ready:false}` when only its live health probe fails。

- [ ] **Step 5: Implement stop as one all-before-any-stop function**

```powershell
function Stop-IsolatedStackRun {
    param($Manifest,[string]$ManifestPath,[scriptblock]$IdentityLookup,[scriptblock]$StopProcessFn)
    if ($Manifest.stopped_at) { return [pscustomobject]@{status='already_stopped';manifest_path=$ManifestPath} }
    Stop-IsolatedBackends -Processes @($Manifest.processes) -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn
    $Manifest.stopped_at=[DateTime]::UtcNow.ToString('o')
    $Manifest.backend_ready.governance=$false
    $Manifest.backend_ready.coordinator=$false
    Write-IsolatedJsonAtomic -Path $ManifestPath -Value $Manifest
    [pscustomobject]@{status='stopped';manifest_path=$ManifestPath}
}
```

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: stop identity mismatch leaves every PID running; valid stop verifies both identities first and atomically adds `stopped_at`。

- [ ] **Step 6: Implement start and rollback as one backend-only function**

```powershell
function Start-IsolatedStackRun {
    param($RepoRoot,$ChangeId,$RunId,$Preflight,$Runtime,$StartBackendFn,$HealthFn,$IdentityLookup,$StopProcessFn,$HeadShaFn)
    $runDirectory=Split-Path -Parent $Preflight.manifest_path
    $started=[System.Collections.Generic.List[object]]::new()
    try {
        $governanceSpec=@{
            Role='governance';WorkingDirectory=(Join-Path $RepoRoot 'governance-service');Executable=$Runtime.python
            Arguments=@('-m','uvicorn','app:app','--host','127.0.0.1','--port',"$($Preflight.ports.governance)")
            Environment=@{GOV_PORT="$($Preflight.ports.governance)"};RunDirectory=$runDirectory;Entrypoint='app:app'
        }
        $governance=& $StartBackendFn $governanceSpec
        $started.Add($governance)
        if(-not (& $HealthFn "http://127.0.0.1:$($Preflight.ports.governance)/health")){throw 'governance health failed'}

        $indexPath=Join-Path $RepoRoot 'bim-review-coordinator\src\index.ts'
        $coordinatorSpec=@{
            Role='coordinator';WorkingDirectory=(Join-Path $RepoRoot 'bim-review-coordinator');Executable=$Runtime.node
            Arguments=@($Runtime.tsx,$indexPath)
            Environment=@{
                PORT="$($Preflight.ports.coordinator)";HOST='127.0.0.1'
                GOVERNANCE_API_BASE="http://127.0.0.1:$($Preflight.ports.governance)"
                COORDINATOR_PUBLIC_BASE_URL="http://127.0.0.1:$($Preflight.ports.coordinator)"
                VIEWER_PUBLIC_BASE_URL="http://127.0.0.1:$($Preflight.ports.viewer)"
                CORS_ORIGINS="http://127.0.0.1:$($Preflight.ports.viewer)"
            }
            RunDirectory=$runDirectory;Entrypoint=$indexPath
        }
        $coordinator=& $StartBackendFn $coordinatorSpec
        $started.Add($coordinator)
        if(-not (& $HealthFn "http://127.0.0.1:$($Preflight.ports.coordinator)/health")){throw 'coordinator health failed'}

        $head=& $HeadShaFn $RepoRoot
        if($head -notmatch '^[0-9a-f]{40}$'){throw 'HEAD identity is not a 40-character commit SHA'}
        $manifest=New-IsolatedStackManifest -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Preflight $Preflight -HeadSha $head -Processes @($started)
        Write-IsolatedJsonAtomic -Path $Preflight.manifest_path -Value $manifest -NoClobber
        [pscustomobject]@{status='started';manifest_path=$Preflight.manifest_path;manifest=$manifest}
    } catch {
        if($started.Count -gt 0){Stop-IsolatedBackends -Processes @($started) -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn}
        throw
    }
}
```

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: governance/start/health and coordinator/start/health failures each roll back only exact this-run identities and write no success manifest。

- [ ] **Step 7: Add the small action dispatcher**

```powershell
function Invoke-IsolatedBranchStack {
    param(
        [ValidateSet('start','status','stop')][string]$Action,
        [string]$ChangeId,[string]$RunId,[string]$OffsetInput='0',
        [string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
        [scriptblock]$PreflightFn={param($root,$change,$run,$offset) Assert-IsolatedStackStartPreflight -RepoRoot $root -ChangeId $change -RunId $run -OffsetInput $offset},
        [scriptblock]$RuntimeResolver={param($root) Resolve-IsolatedRuntime -RepoRoot $root},
        [scriptblock]$StartBackendFn={param($spec) Start-IsolatedBackend @spec},
        [scriptblock]$HealthFn={param($url) Wait-IsolatedHealth -Url $url},
        [scriptblock]$IdentityLookup={param($e) Get-IsolatedProcessIdentity -Pid ([int]$e.pid) -Entrypoint ([string]$e.entrypoint)},
        [scriptblock]$StopProcessFn={param($pid) Stop-Process -Id $pid -Force -ErrorAction Stop},
        [scriptblock]$HeadShaFn={param($root) (& git -C $root rev-parse HEAD).Trim()}
    )
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    $manifestPath=Resolve-IsolatedStackManifestPath -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId

    if($Action -in @('status','stop')){
        $manifest=Read-IsolatedStackManifest -Path $manifestPath
        Assert-IsolatedStackManifestIdentity -Manifest $manifest -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -OffsetInput $OffsetInput
        if($Action -eq 'status'){return Get-IsolatedStackStatus -Manifest $manifest -ManifestPath $manifestPath -IdentityLookup $IdentityLookup -HealthFn $HealthFn}
        return Stop-IsolatedStackRun -Manifest $manifest -ManifestPath $manifestPath -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn
    }

    $preflight=& $PreflightFn $RepoRoot $ChangeId $RunId $OffsetInput
    $runtime=& $RuntimeResolver $RepoRoot
    Start-IsolatedStackRun -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Preflight $preflight -Runtime $runtime `
      -StartBackendFn $StartBackendFn -HealthFn $HealthFn -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn -HeadShaFn $HeadShaFn
}
```

- [ ] **Step 8: Wire direct script execution to the dispatcher**

```powershell
if ($MyInvocation.InvocationName -ne '.') {
    Invoke-IsolatedBranchStack -Action $Action -ChangeId $ChangeId -RunId $RunId -OffsetInput $Offset
}
```

- [ ] **Step 9: Run GREEN dispatcher tests**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: PASS for start order, governance-health rollback, coordinator-start rollback, coordinator-health rollback, success manifest collision, status viewer ownership, change/run/worktree/offset identity mismatch, stop all-before-any-stop, and atomic `stopped_at` update.

- [ ] **Step 10: Run static analysis**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\invoke-powershell-static.ps1`

Expected: PASS ending `[invoke-powershell-static] passed`.

- [ ] **Step 11: Commit Task 4**

```powershell
git add scripts/dev/start-isolated-branch-stack.ps1 scripts/tests/test-isolated-branch-stack.ps1
git commit -m "feat: dispatch isolated branch stack lifecycle"
```

---

### Task 5: Manifest-authoritative Playwright configuration

**Files:**
- Create: `web-viewer-sample/e2e/support/isolated-stack.ts`
- Create: `web-viewer-sample/e2e/support/isolated-stack-global-setup.ts`
- Modify: `web-viewer-sample/playwright.config.ts`
- Modify: `web-viewer-sample/vitest.config.ts`
- Test: `web-viewer-sample/e2e/support/isolated-stack.test.ts` (create)

**Interfaces:**
- Consumes: Task 4 `isolated-branch-stack/v1` manifest and env `E2E_REQUIRE_REAL`, `E2E_STACK_MANIFEST`, optional compatibility assertions `E2E_COORDINATOR_BASE_URL`, `E2E_VIEWER_PORT`, `E2E_VIEWER_BASE_URL`, `E2E_VIEWER_HARNESS_BUILD`。
- Produces: `parseStandaloneViewerPort()` and `loadIsolatedStackConfig()` returning manifest-authoritative `{ manifestPath, runDir, coordinatorBaseUrl, governanceBaseUrl, viewerPort, viewerOrigin, harnessBuildFlag, manifest }`; default export global setup probes externally owned endpoints before any spec。

- [ ] **Step 1: 建立完整 fixture 與 table-driven failing unit test**

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadIsolatedStackConfig, parseStandaloneViewerPort } from "./isolated-stack";

const roots: string[] = [];

function fixture() {
  const worktreeRoot = mkdtempSync(path.join(tmpdir(), "isolated-stack-"));
  roots.push(worktreeRoot);
  const changeId = "isolated-branch-stack-browser-e2e";
  const runId = "unit-r1";
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  const runDir = path.join(worktreeRoot, "artifacts", "e2e", changeId, runId);
  const manifestPath = path.join(runDir, "stack-manifest.json");
  mkdirSync(runDir, { recursive: true });
  const manifest = {
    schema_version: "isolated-branch-stack/v1",
    stack_kind: "isolated_branch_stack",
    change_id: changeId,
    run_id: runId,
    worktree_root: worktreeRoot,
    head_sha: headSha,
    started_at: "2026-07-30T00:00:00.000Z",
    offset: 0,
    ports: { coordinator: 8005, governance: 49103, viewer: 5180 },
    base_urls: {
      coordinator: "http://127.0.0.1:8005",
      governance: "http://127.0.0.1:49103",
      viewer: "http://127.0.0.1:5180",
    },
    backend_ready: { governance: true, coordinator: true },
    lifecycle_owners: {
      governance: "repo_launcher",
      coordinator: "repo_launcher",
      viewer: "playwright_webserver",
    },
    processes: {},
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { worktreeRoot, manifestPath, manifest, headSha };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("loadIsolatedStackConfig", () => {
  it("requires the manifest before Playwright starts", () => {
    expect(() => loadIsolatedStackConfig({ env: { E2E_REQUIRE_REAL: "1" } })).toThrow(/E2E_STACK_MANIFEST is required/);
  });

  it("accepts only the exact worktree/path/content/head identity", () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath },
    });
    expect(config).not.toBeNull();
    expect(config.coordinatorBaseUrl).toBe("http://127.0.0.1:8005");
    expect(config.viewerPort).toBe(5180);
  });

  it.each([
    ["path/content identity", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, run_id: "unit-r2" }), /path\/content identity/],
    ["change identity", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, change_id: "other-change" }), /path\/content identity/],
    ["worktree identity", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, worktree_root: path.dirname(value.worktreeRoot) }), /worktree identity/],
    ["head identity", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, head_sha: "f".repeat(40) }), /head identity/],
    ["offset domain", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, offset: 5 }), /offset must be an integer from 0 through 4/],
    ["base plus offset port mapping", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, offset: 1 }), /base\+offset port mapping/],
    ["reserved port", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, ports: { ...value.manifest.ports, coordinator: 8004 } }), /reserved port 8004/],
    ["reserved viewer", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, ports: { ...value.manifest.ports, viewer: 5173 }, base_urls: { ...value.manifest.base_urls, viewer: "http://127.0.0.1:5173" } }), /reserved port 5173/],
    ["backend readiness", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, backend_ready: { governance: true, coordinator: false } }), /backends are not ready/],
    ["lifecycle ownership", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, lifecycle_owners: { ...value.manifest.lifecycle_owners, viewer: "launcher" } }), /lifecycle ownership/],
    ["base URL mismatch", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, base_urls: { ...value.manifest.base_urls, coordinator: "http://127.0.0.1:8006" } }), /base URL.*ports/],
  ])("rejects %s", (_label, mutate, expected) => {
    const value = fixture();
    writeFileSync(value.manifestPath, JSON.stringify(mutate(value)));
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath },
    })).toThrow(expected);
  });

  it("rejects a manifest outside this worktree artifacts/e2e", () => {
    const value = fixture();
    const outside = path.join(value.worktreeRoot, "outside.json");
    writeFileSync(outside, JSON.stringify(value.manifest));
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: outside },
    })).toThrow(/inside this worktree artifacts\/e2e/);
  });

  it.each([
    [{ E2E_COORDINATOR_BASE_URL: "http://127.0.0.1:8006" }, /coordinator env\/manifest mismatch/],
    [{ E2E_VIEWER_PORT: "5181" }, /viewer env\/manifest mismatch/],
    [{ E2E_VIEWER_BASE_URL: "http://127.0.0.1:5181" }, /viewer base env\/manifest mismatch/],
  ])("rejects compatibility env that points to another valid offset", (extra, expected) => {
    const value = fixture();
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath, ...extra },
    })).toThrow(expected);
  });

  it.each(["0", "65536", "abc", "5180.5"])("rejects invalid standalone viewer port %s", raw => {
    expect(() => parseStandaloneViewerPort(raw)).toThrow(/standalone viewer port/);
  });

  it("requires external-viewer harness disclosure", () => {
    const value = fixture();
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath, E2E_DISABLE_WEBSERVER: "1" },
    })).toThrow(/E2E_VIEWER_HARNESS_BUILD=0\|1/);
  });
});
```

Fixture setup 必須寫出完整 manifest，另各有 path outside `artifacts/e2e`、path/content ChangeId/RunId mismatch、`worktree_root` mismatch、`head_sha` mismatch、reserved coordinator/viewer port 負例。

- [ ] **Step 2: 跑 RED，確認 module 尚不存在**

Run: `Push-Location web-viewer-sample`

Run: `npx vitest run e2e/support/isolated-stack.test.ts`

Run: `Pop-Location`

Expected: FAIL with `Failed to load url ./isolated-stack`。

- [ ] **Step 3: 實作 parser types、reserved set 與 standalone port function**

```typescript
import { readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const RESERVED_PORTS = new Set([8004, 49102, 49101, 8010, 5173, 5174, 49100, ...Array.from({ length: 41 }, (_, index) => 49110 + index)]);

export type IsolatedStackManifest = {
  schema_version: "isolated-branch-stack/v1";
  stack_kind: "isolated_branch_stack";
  change_id: string;
  run_id: string;
  worktree_root: string;
  head_sha: string;
  started_at: string;
  offset: number;
  ports: { coordinator: number; governance: number; viewer: number };
  base_urls: { coordinator: string; governance: string; viewer: string };
  backend_ready: { governance: boolean; coordinator: boolean };
  lifecycle_owners: { governance: string; coordinator: string; viewer: "playwright_webserver" };
};

export type IsolatedStackConfig = {
  manifestPath: string;
  runDir: string;
  coordinatorBaseUrl: string;
  governanceBaseUrl: string;
  viewerPort: number;
  viewerOrigin: string;
  harnessBuildFlag: boolean;
  manifest: IsolatedStackManifest;
};

export function parseStandaloneViewerPort(raw: string): number {
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`invalid standalone viewer port: ${raw}`);
  return port;
}
```

Run: `Push-Location web-viewer-sample`

Run: `npx vitest run e2e/support/isolated-stack.test.ts`

Expected: standalone port tests pass while manifest loader cases remain RED。

Run: `Pop-Location`

- [ ] **Step 4: 實作唯一 manifest loader 與 require-real wrapper**

```typescript

export function loadIsolatedStackConfig(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  headSha?: string;
} = {}): IsolatedStackConfig | null {
  const env = options.env ?? process.env;
  if (env.E2E_REQUIRE_REAL !== "1") return null;
  if (!env.E2E_STACK_MANIFEST) throw new Error("E2E_STACK_MANIFEST is required in require-real mode");

  const worktreeRoot = realpathSync(options.cwd ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const manifestPath = realpathSync(path.resolve(env.E2E_STACK_MANIFEST));
  const artifactRoot = path.join(worktreeRoot, "artifacts", "e2e") + path.sep;
  if (!manifestPath.startsWith(artifactRoot)) throw new Error("E2E_STACK_MANIFEST must stay inside this worktree artifacts/e2e");

  const relative = path.relative(artifactRoot, manifestPath).split(path.sep);
  if (relative.length !== 3 || relative[2] !== "stack-manifest.json") {
    throw new Error("E2E_STACK_MANIFEST path must be <change-id>/<run-id>/stack-manifest.json");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as IsolatedStackManifest;
  const headSha = options.headSha ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreeRoot, encoding: "utf8" }).trim();
  if (manifest.change_id !== relative[0] || manifest.run_id !== relative[1]) throw new Error("manifest path/content identity mismatch");
  if (realpathSync(manifest.worktree_root) !== worktreeRoot) throw new Error("manifest worktree identity mismatch");
  if (manifest.head_sha !== headSha) throw new Error("manifest head identity mismatch");
  if (manifest.schema_version !== "isolated-branch-stack/v1" || manifest.stack_kind !== "isolated_branch_stack") throw new Error("unsupported isolated stack manifest");
  if (!manifest.backend_ready.governance || !manifest.backend_ready.coordinator) throw new Error("isolated backends are not ready");
  if (manifest.lifecycle_owners.governance !== "repo_launcher" || manifest.lifecycle_owners.coordinator !== "repo_launcher" || manifest.lifecycle_owners.viewer !== "playwright_webserver") throw new Error("unexpected lifecycle ownership");

  if (!Number.isSafeInteger(manifest.offset) || manifest.offset < 0 || manifest.offset > 4) {
    throw new Error("manifest offset must be an integer from 0 through 4");
  }
  const expectedPorts = {
    coordinator: 8005 + manifest.offset,
    governance: 49103 + manifest.offset,
    viewer: 5180 + manifest.offset,
  };
  if (JSON.stringify(manifest.ports) !== JSON.stringify(expectedPorts)) {
    throw new Error("manifest ports violate fixed base+offset port mapping");
  }
  for (const port of Object.values(manifest.ports)) if (RESERVED_PORTS.has(port)) throw new Error(`manifest resolves to reserved port ${port}`);
  const expectedBaseUrls = {
    coordinator: `http://127.0.0.1:${manifest.ports.coordinator}`,
    governance: `http://127.0.0.1:${manifest.ports.governance}`,
    viewer: `http://127.0.0.1:${manifest.ports.viewer}`,
  };
  if (JSON.stringify(manifest.base_urls) !== JSON.stringify(expectedBaseUrls)) throw new Error("manifest base URL does not match resolved ports");
  const coordinatorBaseUrl = expectedBaseUrls.coordinator;
  const viewerPort = manifest.ports.viewer;
  const viewerOrigin = `http://127.0.0.1:${viewerPort}`;
  if (env.E2E_COORDINATOR_BASE_URL && env.E2E_COORDINATOR_BASE_URL !== coordinatorBaseUrl) throw new Error("coordinator env/manifest mismatch");
  if (env.E2E_VIEWER_PORT && env.E2E_VIEWER_PORT !== String(viewerPort)) throw new Error("viewer env/manifest mismatch");
  if (env.E2E_VIEWER_BASE_URL && new URL(env.E2E_VIEWER_BASE_URL).origin !== viewerOrigin) throw new Error("viewer base env/manifest mismatch");
  const externalViewer = env.E2E_DISABLE_WEBSERVER === "1";
  if (externalViewer && !["0", "1"].includes(env.E2E_VIEWER_HARNESS_BUILD ?? "")) throw new Error("E2E_VIEWER_HARNESS_BUILD=0|1 is required for an external viewer");
  return {
    manifestPath,
    runDir: path.dirname(manifestPath),
    coordinatorBaseUrl,
    governanceBaseUrl: expectedBaseUrls.governance,
    viewerPort,
    viewerOrigin,
    harnessBuildFlag: externalViewer ? env.E2E_VIEWER_HARNESS_BUILD === "1" : false,
    manifest,
  };
}

export function requireIsolatedStackConfig(): IsolatedStackConfig {
  const config = loadIsolatedStackConfig();
  if (!config) throw new Error("E2E_REQUIRE_REAL=1 is required by this spec");
  return config;
}
```

- [ ] **Step 5: 跑 manifest loader GREEN**

Run: `Push-Location web-viewer-sample`

Run: `npx vitest run e2e/support/isolated-stack.test.ts`

Expected: every exact path/content/worktree/head/readiness/ownership/reserved/env case passes。

Run: `Pop-Location`

- [ ] **Step 6: 實作 external viewer global setup 的兩個 health probes**

Create `web-viewer-sample/e2e/support/isolated-stack-global-setup.ts`:

```typescript
import { request } from "@playwright/test";
import { requireIsolatedStackConfig } from "./isolated-stack";

export default async function isolatedStackGlobalSetup(): Promise<void> {
  if (process.env.E2E_REQUIRE_REAL !== "1") return;
  const isolated = requireIsolatedStackConfig();
  const client = await request.newContext();
  try {
    if (process.env.E2E_DISABLE_WEBSERVER === "1") {
      const viewer = await client.get(isolated.viewerOrigin);
      if (!viewer.ok()) throw new Error(`external viewer probe failed: ${viewer.status()} ${isolated.viewerOrigin}`);
    }
    const coordinator = await client.get(`${isolated.coordinatorBaseUrl}/health`);
    if (!coordinator.ok()) throw new Error(`coordinator probe failed: ${coordinator.status()} ${isolated.coordinatorBaseUrl}/health`);
  } finally {
    await client.dispose();
  }
}
```

- [ ] **Step 7: 讓 Playwright config 在 require-real mode 只使用 manifest authority**

```typescript
import { loadIsolatedStackConfig, parseStandaloneViewerPort } from "./e2e/support/isolated-stack";

const isolated = loadIsolatedStackConfig();
const viewerPort = isolated?.viewerPort ?? parseStandaloneViewerPort(process.env.E2E_VIEWER_PORT ?? "5180");
const viewerOrigin = isolated?.viewerOrigin ?? `http://127.0.0.1:${viewerPort}`;
const viewerBaseUrl = isolated?.viewerOrigin ?? process.env.E2E_VIEWER_BASE_URL ?? viewerOrigin;
const coordinatorBaseUrl = isolated?.coordinatorBaseUrl ?? process.env.E2E_COORDINATOR_BASE_URL ?? "http://127.0.0.1:8005";
const webServer = process.env.E2E_DISABLE_WEBSERVER === "1" ? [] : [{
  command: `npm run dev -- --host 127.0.0.1 --port ${viewerPort} --strictPort`,
  url: viewerOrigin,
  reuseExistingServer: false,
  timeout: 120_000,
  env: {
    VITE_VIEWER_HARNESS: isolated ? "0" : "1",
    VITE_COORDINATOR_API_BASE: coordinatorBaseUrl,
    VITE_ALLOWED_COORDINATOR_ORIGINS: [coordinatorBaseUrl, viewerOrigin].join(","),
  },
}];

export default defineConfig({
  globalSetup: isolated ? "./e2e/support/isolated-stack-global-setup.ts" : undefined,
  outputDir: isolated ? path.join(isolated.runDir, "playwright-output") : "test-results",
  use: { baseURL: viewerBaseUrl, trace: isolated ? "off" : "retain-on-failure", screenshot: "only-on-failure" },
  webServer,
});
```

Add `import path from "node:path"` and preserve all other existing config fields. In require-real mode, `testInfo.outputPath()` now resolves below the same run directory, so the evidence writer can enforce containment。`E2E_DISABLE_WEBSERVER=1` still uses the manifest viewer port, and `E2E_VIEWER_HARNESS_BUILD` must be explicit for later evidence disclosure。

- [ ] **Step 8: 將 Vitest include 擴至共用 E2E helper test，跑 GREEN 與 typecheck**

```typescript
test: {
  environment: "jsdom",
  globals: true,
  include: ["src/**/*.{test,spec}.{ts,tsx}", "e2e/support/**/*.test.ts"],
},
```

Run: `Push-Location web-viewer-sample`

Expected: current directory becomes `web-viewer-sample`。

Run: `npx vitest run e2e/support/isolated-stack.test.ts`

Expected: PASS for valid manifest and every path/content/head/env/reserved-port negative case。

Run: `npm run typecheck`

Expected: PASS with zero TypeScript errors。

Run: `Pop-Location`

Expected: returns to repository root。

- [ ] **Step 9: Commit Task 5**

```powershell
git add web-viewer-sample/e2e/support/isolated-stack.ts web-viewer-sample/e2e/support/isolated-stack-global-setup.ts web-viewer-sample/e2e/support/isolated-stack.test.ts web-viewer-sample/playwright.config.ts web-viewer-sample/vitest.config.ts
git commit -m "feat: bind Playwright to isolated stack manifest"
```

---

### Task 6: Evidence writer, forbidden-request watcher, and harness disclosure

**Files:**
- Modify: `web-viewer-sample/e2e/support/isolated-stack.ts`
- Test: `web-viewer-sample/e2e/support/isolated-stack.test.ts` (modify)

**Interfaces:**
- Consumes: Task 5 `IsolatedStackConfig`, Playwright `Page`, and caller-supplied observations whose artifact paths were created with `testInfo.outputPath()`。
- Produces: `requireReal`, `watchForbiddenRequests`, `classifyHarnessUse`, and typed atomic `writeIsolatedEvidenceManifest(config, observation)`; evidence identity comes only from the current manifest。

- [ ] **Step 1: 先寫 guard、harness 與 typed evidence merge 的 failing tests**

```typescript
function sampleObservation(config: IsolatedStackConfig): BrowserEvidenceObservation {
  const screenshotPath = path.join(config.runDir, "a4-success.png");
  const tracePath = path.join(config.runDir, "a4-success-trace.zip");
  writeFileSync(screenshotPath, "png-fixture");
  writeFileSync(tracePath, "trace-fixture");
  return {
    testId: "a4-success",
    route: "#semantic-search",
    mainButtons: ["a4-refresh-sources", "a4-run"],
    fixture: "downloaded ifc_ready_job_id selected from real coordinator",
    backendApi: "POST /api/governance/search/model/for-ifc-ready/job-1",
    observedRuntimeIds: { ifc_ready_job_id: "job-1" },
    visibleStates: ["success"],
    screenshotPaths: [screenshotPath],
    tracePath,
    harness: { buildFlag: false, queryFlag: false, realControlPlaneEligible: true },
  };
}

it("records every reserved-port browser request", () => {
  const guard = createForbiddenRequestGuard();
  guard.observe("http://127.0.0.1:8004/api/runtime/status");
  guard.observe("http://127.0.0.1:49102/api/search");
  expect(() => guard.assertClean()).toThrow(/8004.*49102/);
});

it.each([
  [{ buildFlag: false, queryFlag: false }, true],
  [{ buildFlag: true, queryFlag: false }, true],
  [{ buildFlag: true, queryFlag: true }, false],
])("discloses harness flags and real-control-plane eligibility", (flags, eligible) => {
  expect(classifyHarnessUse(flags)).toEqual({ ...flags, realControlPlaneEligible: eligible });
});

it("requires all real prerequisites without skip semantics", () => {
  expect(() => requireReal(false, "fixture missing")).toThrow("fixture missing");
});

it("atomically merges observations only for the same run identity", async () => {
  const value = fixture();
  const config = loadIsolatedStackConfig({
    cwd: value.worktreeRoot,
    headSha: value.headSha,
    env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath },
  })!;
  const observation = sampleObservation(config);
  const output = await writeIsolatedEvidenceManifest(config, observation);
  await writeIsolatedEvidenceManifest(config, { ...observation, visibleStates: ["loading", "success", "retry"] });
  const evidence = JSON.parse(readFileSync(output, "utf8"));
  expect(evidence.observations).toHaveLength(1);
  expect(evidence.observations[0].visible_states).toContain("retry");
  expect(evidence.execution_window.started_at).toBe(value.manifest.started_at);
  expect(Date.parse(evidence.execution_window.finished_at)).toBeGreaterThanOrEqual(Date.parse(value.manifest.started_at));
  expect(readdirSync(config.runDir).filter(name => name.includes(".tmp-"))).toEqual([]);
});

it("preserves original bytes on evidence identity mismatch", async () => {
  const value = fixture();
  const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
  const output = path.join(config.runDir, "evidence-manifest.json");
  const original = JSON.stringify({ schema_version: "isolated-branch-browser-evidence/v1", stack_kind: "isolated_branch_stack", change_id: "other", run_id: "other", head_sha: "f".repeat(40), observations: [] });
  writeFileSync(output, original);
  await expect(writeIsolatedEvidenceManifest(config, sampleObservation(config))).rejects.toThrow(/evidence identity mismatch/);
  expect(readFileSync(output, "utf8")).toBe(original);
});

it("rejects evidence artifacts outside the current run directory", async () => {
  const value = fixture();
  const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
  await expect(writeIsolatedEvidenceManifest(config, { ...sampleObservation(config), screenshotPaths: [path.join(value.worktreeRoot, "outside.png")] })).rejects.toThrow(/artifact path must stay inside current run/);
});

it("rejects a contained screenshot or trace path that does not exist", async () => {
  const value = fixture();
  const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
  const observation = sampleObservation(config);
  rmSync(observation.tracePath!, { force: true });
  await expect(writeIsolatedEvidenceManifest(config, observation)).rejects.toThrow(/artifact does not exist/);
});
```

Add `readFileSync` and `readdirSync` to the existing Node `fs` imports and import the two evidence types from `./isolated-stack`。The factory creates both required artifact files inside the current run; no undeclared fixture global is used。

- [ ] **Step 2: 跑 RED，確認 helper exports 尚未存在**

Run: `Push-Location web-viewer-sample`

Run: `npx vitest run e2e/support/isolated-stack.test.ts`

Run: `Pop-Location`

Expected: FAIL with missing export `createForbiddenRequestGuard` or `classifyHarnessUse`。

- [ ] **Step 3: 實作 request watcher、require-real 與 harness disclosure**

```typescript
export function requireReal(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[require-real] ${message}`);
}

export function createForbiddenRequestGuard() {
  const violations: string[] = [];
  return {
    observe(rawUrl: string) {
      const url = new URL(rawUrl);
      if (RESERVED_PORTS.has(Number(url.port))) violations.push(rawUrl);
    },
    assertClean() {
      if (violations.length) throw new Error(`browser requested reserved ports: ${violations.join(", ")}`);
    },
    violations,
  };
}

export function watchForbiddenRequests(page: Page) {
  const guard = createForbiddenRequestGuard();
  page.on("request", request => guard.observe(request.url()));
  return guard;
}

export function classifyHarnessUse(flags: { buildFlag: boolean; queryFlag: boolean }) {
  return { ...flags, realControlPlaneEligible: !(flags.buildFlag && flags.queryFlag) };
}
```

- [ ] **Step 4: 實作 typed observation 與 artifact path validator**

```typescript
import { existsSync, renameSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";

export type HarnessDisclosure = {
  buildFlag: boolean;
  queryFlag: boolean;
  realControlPlaneEligible: boolean;
};

export type BrowserEvidenceObservation = {
  testId: string;
  route: string;
  mainButtons: string[];
  fixture: string;
  backendApi: string;
  observedRuntimeIds: Record<string, string>;
  visibleStates: string[];
  screenshotPaths: string[];
  tracePath: string | null;
  harness: HarnessDisclosure;
};

function relativeRunArtifact(runDir: string, candidate: string): string {
  const absolute = path.resolve(candidate);
  const relative = path.relative(runDir, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`artifact path must stay inside current run: ${candidate}`);
  if (!existsSync(absolute)) throw new Error(`evidence artifact does not exist: ${candidate}`);
  return relative.split(path.sep).join("/");
}
```

Run: `Push-Location web-viewer-sample`

Run: `npx vitest run e2e/support/isolated-stack.test.ts`

Expected: guard/harness/path cases pass while the missing writer export remains RED。

Run: `Pop-Location`

- [ ] **Step 5: 實作 atomic same-run evidence writer**

```typescript

export async function writeIsolatedEvidenceManifest(
  config: IsolatedStackConfig,
  observation: BrowserEvidenceObservation,
): Promise<string> {
  const output = path.join(config.runDir, "evidence-manifest.json");
  const identity = {
    schema_version: "isolated-branch-browser-evidence/v1",
    stack_kind: config.manifest.stack_kind,
    change_id: config.manifest.change_id,
    run_id: config.manifest.run_id,
    head_sha: config.manifest.head_sha,
  };
  const existing = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : { ...identity, observations: [] };
  for (const key of ["schema_version", "stack_kind", "change_id", "run_id", "head_sha"] as const) {
    if (existing[key] !== identity[key]) throw new Error(`evidence identity mismatch: ${key}`);
  }
  const normalized = {
    test_id: observation.testId,
    route: observation.route,
    main_buttons: observation.mainButtons,
    fixture: observation.fixture,
    backend_api: observation.backendApi,
    observed_runtime_ids: observation.observedRuntimeIds,
    visible_states: observation.visibleStates,
    harness: observation.harness,
    artifacts: {
      screenshots: observation.screenshotPaths.map(candidate => relativeRunArtifact(config.runDir, candidate)),
      trace: observation.tracePath ? relativeRunArtifact(config.runDir, observation.tracePath) : null,
    },
  };
  const observations = [...(existing.observations ?? []).filter((item: { test_id: string }) => item.test_id !== normalized.test_id), normalized]
    .sort((left, right) => left.test_id.localeCompare(right.test_id));
  const evidence = {
    ...identity,
    resolved_ports: config.manifest.ports,
    base_urls: { coordinator: config.coordinatorBaseUrl, governance: config.governanceBaseUrl, viewer: config.viewerOrigin },
    execution_window: { started_at: config.manifest.started_at, finished_at: new Date().toISOString() },
    observations,
    scope: { cpu_browser_operability: "observed", design: "not_claimed", deploy: "not_claimed", kit_webrtc: "not_claimed" },
  };
  const temporary = `${output}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameSync(temporary, output);
  return output;
}
```

- [ ] **Step 6: 跑 GREEN 與 typecheck**

Run: `Push-Location web-viewer-sample`

Expected: current directory becomes `web-viewer-sample`。

Run: `npx vitest run e2e/support/isolated-stack.test.ts src/harness/fakeReviewSocket.test.ts src/harness/fakeStreamer.test.ts`

Expected: PASS；harness matrix 清楚區分 build-only carrier 與 build+query fake control plane。

Run: `npm run typecheck`

Expected: PASS with zero TypeScript errors。

Run: `Pop-Location`

Expected: returns to repository root。

- [ ] **Step 7: Commit Task 6**

```powershell
git add web-viewer-sample/e2e/support/isolated-stack.ts web-viewer-sample/e2e/support/isolated-stack.test.ts
git commit -m "test: write isolated browser evidence atomically"
```

---

### Task 7: A4 require-real browser consumer

**Files:**
- Test: `web-viewer-sample/e2e/support/isolated-stack.test.ts` (modify)
- Test: `web-viewer-sample/e2e/a4-closeout.spec.ts` (modify)

**Interfaces:**
- Consumes: Task 6 helpers, existing `#semantic-search` UI and real coordinator A4 endpoints。
- Produces: hard-fail A4 loading/success/failure/retry coverage, forbidden-port assertion, and one typed evidence observation; it does not modify `A4SemanticSearchPage.tsx`。

- [ ] **Step 1: 加入 A4 source guard RED test**

```typescript
it("keeps A4 require-real without legacy skip gates", () => {
  const source = readFileSync(path.join(process.cwd(), "e2e", "a4-closeout.spec.ts"), "utf8");
  expect(source).not.toMatch(/A4_E2E_REQUIRE_REAL|test\.skip|function unavailable/);
  expect(source).toContain("requireIsolatedStackConfig");
  expect(source).toContain("watchForbiddenRequests");
});
```

- [ ] **Step 2: 跑 RED，確認 legacy skip gate 仍存在**

Run: `Push-Location web-viewer-sample`

Expected: current directory becomes `web-viewer-sample`。

Run: `npx vitest run e2e/support/isolated-stack.test.ts`

Expected: FAIL on `A4_E2E_REQUIRE_REAL`, `test.skip`, or `function unavailable`。

Run: `Pop-Location`

Expected: returns to repository root。

- [ ] **Step 3: Replace A4 imports, authority, prerequisites, and explicit tracing lifecycle**

```typescript
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import {
  classifyHarnessUse,
  requireIsolatedStackConfig,
  requireReal,
  watchForbiddenRequests,
  writeIsolatedEvidenceManifest,
} from "./support/isolated-stack";

const isolated = requireIsolatedStackConfig();
const COORDINATOR = isolated.coordinatorBaseUrl;
const REQUIRED_JOB_ID = process.env.A4_E2E_IFC_READY_JOB_ID ?? "";
let forbiddenGuard: ReturnType<typeof watchForbiddenRequests>;
let jobId = "";
let tracePath = "";
let traceActive = false;

async function finishEvidence(
  page: Page,
  testInfo: TestInfo,
  testId: string,
  visibleStates: string[],
  backendApi: string,
): Promise<void> {
  const screenshotPath = testInfo.outputPath(`${testId}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.context().tracing.stop({ path: tracePath });
  traceActive = false;
  const harness = classifyHarnessUse({
    buildFlag: isolated.harnessBuildFlag,
    queryFlag: new URL(page.url()).searchParams.get("harness") === "1",
  });
  requireReal(harness.realControlPlaneEligible, "harness build+query fake control plane is not real evidence");
  await writeIsolatedEvidenceManifest(isolated, {
    testId,
    route: "#semantic-search",
    mainButtons: ["a4-refresh-sources", "a4-run"],
    fixture: "downloaded ifc_ready_job_id selected from real coordinator",
    backendApi,
    observedRuntimeIds: { ifc_ready_job_id: jobId },
    visibleStates,
    screenshotPaths: [screenshotPath],
    tracePath,
    harness,
  });
}

test.beforeEach(async ({ page, request }, testInfo) => {
  forbiddenGuard = watchForbiddenRequests(page);
  tracePath = testInfo.outputPath(`${testInfo.title.replace(/[^A-Za-z0-9_-]+/g, "-")}-trace.zip`);
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  traceActive = true;
  const health = await request.get(`${COORDINATOR}/health`);
  requireReal(health.ok(), `coordinator health failed: ${health.status()}`);
  const proxy = await request.get(`${COORDINATOR}/api/governance/search/llm-status`);
  requireReal(proxy.ok(), `governance search proxy failed: ${proxy.status()}`);
  const listResponse = await request.get(`${COORDINATOR}/api/external/ifc-ready?limit=50`);
  requireReal(listResponse.ok(), `IFC-ready list failed: ${listResponse.status()}`);
  const list = await listResponse.json() as { items?: Array<{ ifc_ready_job_id: string; download_status?: string }> };
  const downloaded = (list.items ?? []).filter(item => item.download_status === "downloaded");
  const selected = REQUIRED_JOB_ID ? downloaded.find(item => item.ifc_ready_job_id === REQUIRED_JOB_ID) : downloaded[0];
  requireReal(selected, REQUIRED_JOB_ID ? `required downloaded job is missing: ${REQUIRED_JOB_ID}` : "no downloaded IFC-ready job is available");
  jobId = selected.ifc_ready_job_id;
});

test.afterEach(async ({ page }) => {
  try {
    forbiddenGuard.assertClean();
  } finally {
    if (traceActive) {
      await page.context().tracing.stop({ path: tracePath });
      traceActive = false;
    }
  }
});
```

Remove `A4_E2E_REQUIRE_REAL`, `REQUIRE_REAL`, `unavailable()`, every conditional `test.skip`, and old screenshot paths. Keep the two existing viewport descriptors. Playwright built-in trace is off in isolated mode from Task 5; every recorded test starts and stops its own trace, and unexpected test failure is still stopped in `afterEach`。

- [ ] **Step 4: Add the exact loading-state test**

```typescript
test("shows real IFC-ready loading state", async ({ page }, testInfo) => {
  let releaseList!: () => void;
  const listGate = new Promise<void>(resolve => { releaseList = resolve; });
  await page.route("**/api/external/ifc-ready**", async route => {
    await listGate;
    await route.continue();
  });
  await page.goto("/#semantic-search");
  await expect(page.getByTestId("a4-semantic-search-page")).toBeVisible();
  await expect(page.getByTestId("a4-source-loading")).toBeVisible();
  await expect(page.getByTestId("a4-run")).toBeDisabled();
  releaseList();
  await expect(page.getByTestId("a4-job-select")).toHaveValue(jobId);
  await page.unroute("**/api/external/ifc-ready**");
  await finishEvidence(page, testInfo, `a4-real-loading-${viewport.label}`, ["loading"], "GET /api/external/ifc-ready?limit=50");
});
```

- [ ] **Step 5: Add the exact failure/retry test**

```typescript
test("shows list failure then retries the real API", async ({ page }, testInfo) => {
  let firstList = true;
  await page.route("**/api/external/ifc-ready**", async route => {
    if (firstList) {
      firstList = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.goto("/#semantic-search");
  await expect(page.getByTestId("a4-load-err")).toBeVisible();
  await page.unroute("**/api/external/ifc-ready**");
  await page.getByTestId("a4-refresh-sources").click();
  await expect(page.getByTestId("a4-job-select")).toHaveValue(jobId);
  await expect(page.getByTestId("a4-run")).toBeEnabled();
  await finishEvidence(page, testInfo, `a4-real-failure-retry-${viewport.label}`, ["failure", "retry"], "GET /api/external/ifc-ready?limit=50");
});
```

- [ ] **Step 6: Add the exact success test and evidence write**

```typescript
test("runs A4 against the real coordinator", async ({ page }, testInfo) => {
  await page.goto("/#semantic-search");
  await expect(page.getByTestId("a4-job-select")).toHaveValue(jobId);
  await page.getByTestId("a4-mode-deterministic").click();
  await page.getByTestId("a4-query-input").fill("IfcDoor");
  let releaseSearch!: () => void;
  const searchGate = new Promise<void>(resolve => { releaseSearch = resolve; });
  await page.route("**/api/governance/search/model/for-ifc-ready/**", async route => {
    await searchGate;
    await route.continue();
  });
  const responsePromise = page.waitForResponse(response =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === `/api/governance/search/model/for-ifc-ready/${jobId}`,
  );
  await page.getByTestId("a4-run").click();
  await expect(page.getByTestId("a4-run")).toContainText("執行中");
  releaseSearch();
  const response = await responsePromise;
  requireReal(response.ok(), `A4 search failed: ${response.status()}`);
  await page.unroute("**/api/governance/search/model/for-ifc-ready/**");
  await expect(page.getByTestId("a4-results-table")).toBeVisible();
  await expect(page.getByTestId("a4-results-table").locator("tbody tr").first().locator("td").nth(1)).toHaveText("IfcDoor");
  await expect(page.getByTestId("a4-job-select")).toHaveValue(jobId);
  await finishEvidence(page, testInfo, `a4-real-success-${viewport.label}`, ["success"], `POST /api/governance/search/model/for-ifc-ready/${jobId}`);
});
```

These identifiers are verified in current source: `a4-semantic-search-page`, `a4-source-loading`, `a4-load-err`, `a4-refresh-sources`, `a4-job-select`, `a4-mode-deterministic`, `a4-query-input`, `a4-run`, and `a4-results-table`。
Replace the two old A4 test bodies with these three tests inside each existing viewport describe; do not retain duplicate legacy screenshots or skip-gated variants。

- [ ] **Step 7: Run GREEN source guard and typecheck**

Run: `Push-Location web-viewer-sample`

Expected: current directory becomes `web-viewer-sample`。

Run: `npx vitest run e2e/support/isolated-stack.test.ts`

Expected: PASS including the A4 no-skip source guard。

Run: `npm run typecheck`

Expected: PASS with zero TypeScript errors。

Run: `Pop-Location`

Expected: returns to repository root。

- [ ] **Step 8: Commit Task 7**

```powershell
git add web-viewer-sample/e2e/support/isolated-stack.test.ts web-viewer-sample/e2e/a4-closeout.spec.ts
git commit -m "test: require real A4 browser behavior"
```

---

### Task 8: A3 require-real browser consumer

**Files:**
- Test: `web-viewer-sample/e2e/support/isolated-stack.test.ts` (modify)
- Test: `web-viewer-sample/e2e/a3-federated-session-chain.spec.ts` (modify)

**Interfaces:**
- Consumes: Task 6 helpers, existing A3 federation fixtures and real coordinator/governance routes。
- Produces: hard-fail A3 setup and per-test forbidden-port coverage without changing federation product code。

- [ ] **Step 1: 加入 A3 source guard RED test**

```typescript
it("keeps A3 require-real without skip semantics or coordinator UI bundle probing", () => {
  const source = readFileSync(path.join(process.cwd(), "e2e", "a3-federated-session-chain.spec.ts"), "utf8");
  expect(source).not.toMatch(/test\.skip|dist-ui|:8004|49102/);
  expect(source).toContain("requireIsolatedStackConfig");
  expect(source).toContain('page.goto("/#/federation")');
});
```

- [ ] **Step 2: 跑 RED，確認 A3 conditional skips 或 coordinator bundle probe 仍存在**

Run: `Push-Location web-viewer-sample`

Expected: current directory becomes `web-viewer-sample`。

Run: `npx vitest run e2e/support/isolated-stack.test.ts`

Expected: FAIL on `test.skip`, `dist-ui`, or missing isolated helper import。

Run: `Pop-Location`

Expected: returns to repository root。

- [ ] **Step 3: Replace imports, authority, fixture checks, and the three skip gates exactly**

Replace the old header/setup through `beforeEach` with:

```typescript
import { existsSync } from "node:fs";
import { test, expect, type APIRequestContext, type Locator } from "@playwright/test";
import {
  requireIsolatedStackConfig,
  requireReal,
  watchForbiddenRequests,
} from "./support/isolated-stack";

const isolated = requireIsolatedStackConfig();
const COORDINATOR = isolated.coordinatorBaseUrl;
const A3_USD_DIR = process.env.E2E_A3_USD_DIR || "C:/Repos/active/iot/AI-BIM-governance/storage/e2e-a3";
const ARCH_USD = `${A3_USD_DIR}/arch.usdc`;
const STR_USD = `${A3_USD_DIR}/str.usdc`;
const USD_INPUT_PROMPT = "member .usd / .usdc 路徑（conversion 產出）";

async function cleanupCreatedSession(request: APIRequestContext, sessionId: string): Promise<void> {
  try {
    const response = await request.post(
      `${COORDINATOR}/api/review-sessions/${encodeURIComponent(sessionId)}/close`,
      { data: { reason: "e2e a3-federated-session-chain cleanup" }, timeout: 15_000 },
    );
    console.log(`[a3-e2e] cleanup: close ${sessionId} -> HTTP ${response.status()}`);
  } catch (error) {
    console.log(`[a3-e2e] cleanup: close ${sessionId} failed; manual cleanup required: ${String(error)}`);
  }
}

test.describe("A3 federation to session real backend chain", () => {
  test.setTimeout(240_000);
  let createdSessionId: string | null = null;
  let forbiddenGuard: ReturnType<typeof watchForbiddenRequests>;

  test.beforeEach(async ({ request, page }) => {
    createdSessionId = null;
    forbiddenGuard = watchForbiddenRequests(page);
    requireReal(existsSync(ARCH_USD), `missing A3 fixture: ${ARCH_USD}`);
    requireReal(existsSync(STR_USD), `missing A3 fixture: ${STR_USD}`);

    const health = await request.get(`${COORDINATOR}/health`, { timeout: 10_000 }).catch(() => null);
    requireReal(health?.ok(), `coordinator is unavailable: ${COORDINATOR}/health`);

    const governance = await request.post(`${COORDINATOR}/api/governance/federated-sets`, {
      data: { name: `e2e_a3_gate_${Date.now()}` },
      timeout: 10_000,
    }).catch(() => null);
    requireReal(governance !== null && governance.ok(), "governance federated-set proxy is unavailable");
    const gateBody = await governance.json() as { set_id?: unknown };
    requireReal(typeof gateBody.set_id === "string" && gateBody.set_id.length > 0, "governance gate returned no set_id");

    await page.goto("/#/federation");
    const usdInputs = page.getByPlaceholder(USD_INPUT_PROMPT);
    await usdInputs.first().waitFor({ state: "visible", timeout: 15_000 });
    requireReal(await usdInputs.count() === 2, "#/federation did not render two member USD inputs");
  });
```

This is the exact replacement for all three prior skip gates: health uses `requireReal`, governance proxy uses `requireReal`, and the browser surface uses the manifest viewer plus a hard locator assertion. Remove the old coordinator `dist-ui` bundle scan and its header instructions。

- [ ] **Step 4: Replace the cleanup hook and fixture path uses exactly**

```typescript
test.afterEach(async ({ request }) => {
  try {
    forbiddenGuard.assertClean();
  } finally {
    if (createdSessionId) {
      const sessionId = createdSessionId;
      createdSessionId = null;
      await cleanupCreatedSession(request, sessionId);
    }
  }
});
```

Delete the old `afterEach` body so cleanup runs once. In the existing test body replace `${A3_USD_DIR}/arch.usdc` with `ARCH_USD` and `${A3_USD_DIR}/str.usdc` with `STR_USD`; preserve every existing prepare/validate/build/review-room/session/viewer/spectator assertion and the assignment `createdSessionId = sessionId`。Every seed, build, descriptor, stream-config, and session response continues to fail through its existing UI/response assertion; none may return early or skip。

- [ ] **Step 5: Run GREEN source guard and typecheck**

Run: `Push-Location web-viewer-sample`

Expected: current directory becomes `web-viewer-sample`。

Run: `npx vitest run e2e/support/isolated-stack.test.ts`

Expected: PASS including A3 hard-fail source guard。

Run: `npm run typecheck`

Expected: PASS with zero TypeScript errors。

Run: `Pop-Location`

Expected: returns to repository root。

- [ ] **Step 6: Commit Task 8**

```powershell
git add web-viewer-sample/e2e/support/isolated-stack.test.ts web-viewer-sample/e2e/a3-federated-session-chain.spec.ts
git commit -m "test: require real A3 browser behavior"
```

---

### Task 9: Registry and CI machine gate

**Files:**
- Modify: `scripts/script-registry.json`
- Modify: `.github/workflows/agent-governance.yml`
- Test: `scripts/tests/test-isolated-branch-stack.ps1` (modify)
- Test: `scripts/tests/test-agent-governance-check.ps1` (modify)

**Interfaces:**
- Consumes: Tasks 1–8 launcher, docs, helpers, and consumer source guards。
- Produces: registry entry `isolated-branch-verifier` and a required `agent-governance` step invoking the script test on Windows PowerShell 7。

- [ ] **Step 1: 加上 registry/workflow drift failing assertions**

```powershell
$registry = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'scripts\script-registry.json') | ConvertFrom-Json
$entry = @($registry.scripts | Where-Object path -eq 'scripts/dev/start-isolated-branch-stack.ps1')
Assert-Equal 1 $entry.Count 'launcher registered exactly once'
Assert-Equal 'isolated-branch-verifier' $entry[0].role 'launcher role'

$workflow = Get-Content -Raw -LiteralPath (Join-Path $repoRoot '.github\workflows\agent-governance.yml')
Assert-True ($workflow -match 'scripts/tests/test-isolated-branch-stack\.ps1') 'agent-governance runs isolated stack machine test'
```

- [ ] **Step 2: 跑 RED，確認 registry 與 workflow 尚未登記**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: FAIL with `launcher registered exactly once`。

- [ ] **Step 3: 新增精確 registry entry**

```json
{
  "path": "scripts/dev/start-isolated-branch-stack.ps1",
  "role": "isolated-branch-verifier",
  "owner": "scripts",
  "notes": "Backend-only branch evidence adapter; Playwright owns viewer lifecycle. Not a canonical operator entrypoint."
}
```

- [ ] **Step 4: 在 `agent-governance` workflow 新增 Windows pwsh step**

```yaml
      - name: Verify isolated branch stack contract
        shell: pwsh
        run: pwsh -NoProfile -NonInteractive -File scripts/tests/test-isolated-branch-stack.ps1
```

在 `test-agent-governance-check.ps1` 新增相同 path 的 static assertion，讓 workflow step 被刪除時本機 gate 立即紅。

- [ ] **Step 5: 明確裁定 aggregate verifier 不納入 branch-only launcher**

Run: `git diff --exit-code -- scripts/verification-manifest.json scripts/verify-all.ps1`

Expected: exit `0`；理由寫入 PR body：這是 branch evidence harness，由 `agent-governance` machine test enforce，不是 operator golden path，不新增 `verify-all` capability。

- [ ] **Step 6: 跑 GREEN 與既有 governance regression**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: PASS including port/doc/registry/workflow drift checks。

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-agent-governance-check.ps1`

Expected: PASS；dead-link、line-budget 與 workflow assertions全部保持綠燈。

- [ ] **Step 7: Commit Task 9**

```powershell
git add scripts/script-registry.json scripts/tests/test-isolated-branch-stack.ps1 scripts/tests/test-agent-governance-check.ps1 .github/workflows/agent-governance.yml
git commit -m "ci: gate isolated branch stack contract"
```

---

### Task 10: First real A4 consumer as one run transaction

**Files:**
- Create: `(Join-Path $runDir 'stack-manifest.json')` when backend start succeeds
- Create: `(Join-Path $runDir 'evidence-manifest.json')` only on a passing consumer run
- Create: `(Join-Path $runDir 'consumer-result.json')`
- Create: `(Join-Path $runDir 'deployment-listeners-before.json')`
- Create: `(Join-Path $runDir 'deployment-listeners-during.json')` when backend start succeeds
- Create: `(Join-Path $runDir 'deployment-listeners-after.json')`
- Create: `(Join-Path $runDir 'browser-artifacts.zip')` when Playwright produced output
- Test: `web-viewer-sample/e2e/a4-closeout.spec.ts` (execute without source edits)

**Interfaces:**
- Consumes: Task 4 launcher, Task 7 A4 spec, and absolute main-workspace `C:\Repos\active\iot\AI-BIM-governance\storage` IFC data。
- Produces: one collision-safe caller-generated run ID, three deployment listener snapshots, pass or exact known-gap result, bounded browser artifact archive, and unconditional stop attempt。Every execution generates a new ID, including retries after a known gap。

- [ ] **Step 1: Prove require-real is fail closed before any server starts**

```powershell
$savedManifest = $env:E2E_STACK_MANIFEST
$env:E2E_REQUIRE_REAL = '1'
Remove-Item Env:E2E_STACK_MANIFEST -ErrorAction SilentlyContinue
Push-Location web-viewer-sample
try {
    npx playwright test e2e/a4-closeout.spec.ts --project=chromium
    if ($LASTEXITCODE -eq 0) { throw 'require-real unexpectedly accepted a missing manifest' }
}
finally {
    Pop-Location
    if ($null -ne $savedManifest) { $env:E2E_STACK_MANIFEST = $savedManifest }
}
```

Expected: Playwright exits non-zero with `E2E_STACK_MANIFEST is required in require-real mode`; report has zero skipped tests。

- [ ] **Step 2: Verify the explicit main-workspace storage source before creating the run**

```powershell
$storageRoot = 'C:\Repos\active\iot\AI-BIM-governance\storage'
if (-not (Test-Path -LiteralPath $storageRoot -PathType Container)) {
    throw "KNOWN_GAP missing main-workspace storage root: $storageRoot"
}
$ifcFiles = @(Get-ChildItem -LiteralPath $storageRoot -Filter '*.ifc' -File -Recurse)
if ($ifcFiles.Count -eq 0) {
    throw "KNOWN_GAP no IFC fixture under main-workspace storage root: $storageRoot"
}
```

Expected: at least one IFC file exists. Failure is an exact environment known gap; do not copy a fake fixture into the worktree。

- [ ] **Step 3: Construct the unique run and transaction helpers in one PowerShell session**

Open one PowerShell session at repo root and keep that same session through Steps 3–6. `$runId` and `$runDir` are assigned once; no later command reconstructs their path:

```powershell
$changeId = 'isolated-branch-stack-browser-e2e'
$runId = ('p1-consumer-{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmssfff'),([guid]::NewGuid().ToString('N').Substring(0,8)))
$runDir = Join-Path (Get-Location) "artifacts/e2e/$changeId/$runId"
$manifestPath = Join-Path $runDir 'stack-manifest.json'
$storageRoot = 'C:\Repos\active\iot\AI-BIM-governance\storage'
$started = $false
$consumerStatus = 'known_gap'
$consumerError = $null

function Write-ListenerSnapshot([string]$Path) {
    $snapshot = @(8004, 49102) | ForEach-Object {
        $port = $_
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        [ordered]@{
            port = $port
            pids = @($listeners | ForEach-Object OwningProcess | Sort-Object -Unique)
        }
    }
    $snapshot | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8NoBOM -LiteralPath $Path
}
```

Expected: `$runId` contains timestamp plus GUID suffix and `$runDir` is the only run-directory source. A second attempt creates a different run automatically。

- [ ] **Step 4: Execute start, real browser, capture, and exact stop as one try/finally transaction**

Continue in the same PowerShell session:

```powershell

if (Test-Path -LiteralPath $runDir) { throw "run directory collision: $runDir" }
New-Item -ItemType Directory -Path $runDir | Out-Null
Write-ListenerSnapshot (Join-Path $runDir 'deployment-listeners-before.json')

try {
    $env:BIM_FILE_LIBRARY_ROOT = $storageRoot
    $env:STORAGE_HOST_ROOT = $storageRoot
    $env:RUNTIME_STORAGE_ROOT = $storageRoot
    pwsh -NoProfile -NonInteractive -File .\scripts\dev\start-isolated-branch-stack.ps1 -Action start -ChangeId $changeId -RunId $runId -Offset 0
    if ($LASTEXITCODE -ne 0) { throw "isolated launcher start failed with exit $LASTEXITCODE" }
    $started = $true
    Write-ListenerSnapshot (Join-Path $runDir 'deployment-listeners-during.json')

    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if (-not $manifest.backend_ready.governance -or -not $manifest.backend_ready.coordinator) { throw 'isolated manifest is not backend-ready' }
    if ($manifest.lifecycle_owners.viewer -ne 'playwright_webserver') { throw 'viewer lifecycle owner is not Playwright' }
    $jobs = Invoke-RestMethod -Uri "$($manifest.base_urls.coordinator)/api/external/ifc-ready?limit=50" -Method Get
    $downloaded = @($jobs.items | Where-Object download_status -eq 'downloaded')
    if ($downloaded.Count -eq 0) { throw 'KNOWN_GAP coordinator exposes no downloaded ifc_ready_job_id from main-workspace storage' }

    $env:E2E_REQUIRE_REAL = '1'
    $env:E2E_STACK_MANIFEST = (Resolve-Path -LiteralPath $manifestPath).Path
    $env:E2E_VIEWER_HARNESS_BUILD = '0'
    Remove-Item Env:E2E_COORDINATOR_BASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:E2E_VIEWER_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:E2E_VIEWER_BASE_URL -ErrorAction SilentlyContinue
    Push-Location web-viewer-sample
    try {
        npx playwright test e2e/a4-closeout.spec.ts --project=chromium
        if ($LASTEXITCODE -ne 0) { throw "A4 consumer failed with exit $LASTEXITCODE" }
    }
    finally {
        Pop-Location
    }
    if (-not (Test-Path -LiteralPath (Join-Path $runDir 'evidence-manifest.json'))) { throw 'A4 passed without evidence-manifest.json' }
    $consumerStatus = 'passed'
}
catch {
    $consumerError = $_.Exception.Message
}
finally {
    if ($started) {
        pwsh -NoProfile -NonInteractive -File .\scripts\dev\start-isolated-branch-stack.ps1 -Action stop -ChangeId $changeId -RunId $runId -Offset 0
        if ($LASTEXITCODE -ne 0) {
            $errorParts = @($consumerError, "launcher stop failed with exit $LASTEXITCODE") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
            $consumerError = $errorParts -join ' | '
        }
    }
    Write-ListenerSnapshot (Join-Path $runDir 'deployment-listeners-after.json')
    [ordered]@{
        schema_version = 'isolated-branch-consumer-result/v1'
        change_id = $changeId
        run_id = $runId
        status = $consumerStatus
        known_gap = $consumerError
    } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $runDir 'consumer-result.json')
    $playwrightOutput = Join-Path $runDir 'playwright-output'
    if (Test-Path -LiteralPath $playwrightOutput) {
        Compress-Archive -Path (Join-Path $playwrightOutput '*') -DestinationPath (Join-Path $runDir 'browser-artifacts.zip')
    }
}

if ($consumerStatus -ne 'passed') { Write-Warning $consumerError }
```

Expected pass: manifest resolves `8005/49103/5180`; viewer owner is `playwright_webserver`; A4 observes loading/success/failure/retry and a real downloaded `ifc_ready_job_id`; evidence JSON and `browser-artifacts.zip` exist; launcher stop updates `stopped_at`。Expected known gap: `consumer-result.json` records the exact environment or existing A4 failure, failure artifacts are preserved, and stop was still attempted; do not modify A4 product code or weaken require-real。

- [ ] **Step 5: Verify deployment listener invariance and manifest stop state**

```powershell
$before = Get-Content -Raw -LiteralPath (Join-Path $runDir 'deployment-listeners-before.json') | ConvertFrom-Json
$after = Get-Content -Raw -LiteralPath (Join-Path $runDir 'deployment-listeners-after.json') | ConvertFrom-Json
if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) { throw 'deployment listeners changed after isolated stop' }
$duringPath = Join-Path $runDir 'deployment-listeners-during.json'
if (Test-Path -LiteralPath $duringPath) {
    $during = Get-Content -Raw -LiteralPath $duringPath | ConvertFrom-Json
    if (($before | ConvertTo-Json -Compress) -ne ($during | ConvertTo-Json -Compress)) { throw 'deployment listeners changed during isolated run' }
}
if (Test-Path -LiteralPath $manifestPath) {
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if ($started -and -not $manifest.stopped_at) { throw 'manifest missing stopped_at after stop' }
}
```

Expected: deployment `8004/49102` PID sets are identical before/during/after and `stopped_at` is populated。

- [ ] **Step 6: Commit Task 10 from the same `$runDir` variables**

Continue in the same PowerShell session; build the add list from files that the transaction actually produced:

```powershell
$candidateFiles = @(
    (Join-Path $runDir 'stack-manifest.json'),
    (Join-Path $runDir 'consumer-result.json'),
    (Join-Path $runDir 'deployment-listeners-before.json'),
    (Join-Path $runDir 'deployment-listeners-during.json'),
    (Join-Path $runDir 'deployment-listeners-after.json')
    (Join-Path $runDir 'evidence-manifest.json'),
    (Join-Path $runDir 'browser-artifacts.zip')
)
$evidenceFiles = @($candidateFiles | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
git add -f -- $evidenceFiles
$commitMessage = if ($consumerStatus -eq 'passed') { 'test: record isolated A4 browser evidence' } else { 'test: record isolated A4 known gap' }
git commit -m $commitMessage
```

The PR body uses the actual `$runId` printed by this session and points to the committed archive when it exists; `evidence-manifest.json` gives each verified screenshot/trace member path on pass。`Full completion claimed=no` unless all separately required design and Kit/WebRTC gates also exist。

---

### Task 11: Classify consumer evidence in OpenSpec tasks

**Files:**
- None (read-only classification; Task 13 applies the projection atomically)

**Interfaces:**
- Consumes: actual commits and the dynamic Task 10 `consumer-result.json`。
- Produces: an evidence-honest pass/known-gap checkbox decision for Task 13; no file mutation or commit。

- [ ] **Step 1: Classify implementation and machine-gate tasks supported by current-session evidence**

Record that 1.1–4.3 are eligible only when their owning commits and checks exist. Do not edit `tasks.md` yet and do not treat plan text as evidence。

- [ ] **Step 2: Mark exactly one consumer branch**

On Task 10 pass, classify 5.1, 5.2, 5.3, and 5.5 as eligible and 5.4 as ineligible。On known gap, classify 5.1 and 5.5 as eligible only when their snapshots exist, 5.4 as eligible for the recorded handoff, and 5.2/5.3 as ineligible。A failure archive is not success evidence。

- [ ] **Step 3: Read the dynamic result and state the exact branch**

Run: `Get-Content -Raw -LiteralPath (Join-Path $runDir 'consumer-result.json')`

Expected: one exact `status=passed` or `status=known_gap` object whose `run_id` equals the same-session `$runId`; carry this decision into Task 13。

---

### Task 12: Final local gates

**Files:**
- None (read-only verification task)

**Interfaces:**
- Consumes: complete local diff and Task 11 checkbox state。
- Produces: exact local gate results for Task 13; this task creates no commit and does not depend on a future PR job。

- [ ] **Step 1: Validate this change**

Run: `npx openspec validate isolated-branch-stack-browser-e2e --strict`

Expected: PASS。

- [ ] **Step 2: Validate all OpenSpec changes**

Run: `npx openspec validate --all --strict`

Expected: PASS; otherwise record the exact unrelated change/error and leave the all-change gate unverified。

- [ ] **Step 3: Run isolated launcher tests**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-isolated-branch-stack.ps1`

Expected: PASS including live status `{owned,ready}`, rollback, collision, ownership, docs, registry, and workflow cases。

- [ ] **Step 4: Run governance machine tests**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-agent-governance-check.ps1`

Expected: PASS。

- [ ] **Step 5: Run PowerShell static tests**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\invoke-powershell-static.ps1`

Expected: PASS。

- [ ] **Step 6: Run viewer typecheck**

Run: `npm --prefix web-viewer-sample run typecheck`

Expected: PASS with zero TypeScript errors。

- [ ] **Step 7: Run affected viewer tests**

Run: `npm exec --prefix web-viewer-sample -- vitest run e2e/support/isolated-stack.test.ts src/harness/fakeReviewSocket.test.ts src/harness/fakeStreamer.test.ts`

Expected: PASS including artifact-existence, manifest, harness, and A4/A3 source guards。

- [ ] **Step 8: Run operator-path dry-run regression**

Run: `.\scripts\deploy.ps1 -DryRun`

Expected: exit `0`; report `Deploy path verification=not claimed`。

- [ ] **Step 9: Run secret scan**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\scan-secret-patterns.ps1`

Expected: PASS without echoing secret values。

- [ ] **Step 10: Run whitespace check**

Run: `git diff --check`

Expected: no output and exit `0`。

- [ ] **Step 11: Run GitNexus CLI-only impact**

Run: `node .gitnexus/run.cjs impact unavailable -d upstream -r AI-BIM-governance`

Expected: exact report or UNKNOWN because the local helper was removed; preserve the output. Pre-edit evidence was LOW with zero callers; FTS extension warnings are availability warnings only。

- [ ] **Step 12: Run GitNexus CLI-only changed-scope analysis**

Run: `node .gitnexus/run.cjs detect-changes --scope compare --base-ref main`

Expected: scope is limited to this plan's files. Report HIGH plus mitigation; stop for CRITICAL sign-off; label stale/linked-worktree/unavailable output accurately。

---

### Task 13: Lifecycle ledger, NOW, tasks, and metrics closeout

**Files:**
- Modify: `openspec/changes/isolated-branch-stack-browser-e2e/tasks.md`
- Modify: `openspec/lifecycle-ledger.json`
- Modify: `docs/plans/NOW.md`
- Test: `scripts/tests/test-ai-coding-metrics.mjs` (execute only)

**Interfaces:**
- Consumes: Task 11 evidence classification and Task 12 exact local gate results。
- Produces: strict tasks → ledger → NOW → metrics projection; PR-only 6.5–6.7 remain for P6。

- [ ] **Step 1: Mark only locally completed closeout tasks**

Apply Task 11's eligible 1.1–5.5 checkboxes now。Check 6.1 only if both OpenSpec commands have the recorded required result。Check 6.3 only if GitNexus output is acceptable under the documented unavailable gate。Check 6.4 only if dry-run, whitespace, secret, and status checks passed。Leave 6.5–6.7 unchecked because PR body and current CI link do not exist locally。

- [ ] **Step 2: Prove projection is RED before updating ledger**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\verify-openspec-lifecycle.ps1`

Expected: FAIL because checked tasks are ahead of the ledger projection。

- [ ] **Step 3: Update ledger first**

Count checked/total tasks from `tasks.md`; update only this change's `task_ledger`, the Task 10 evidence commit SHA as `subject_commit`, `last_verified`, and evidence references in `openspec/lifecycle-ledger.json`。Do not alter unrelated entries。

- [ ] **Step 4: Update NOW from the ledger, then mark 6.2**

Project the ledger's active count and exact progress into `docs/plans/NOW.md`, preserving the disclosed 2026-07-29 override。Only after ledger and NOW agree, check OpenSpec 6.2, then update the ledger count and NOW progress once more in that order。

- [ ] **Step 5: Run lifecycle and metrics GREEN**

Run: `pwsh -NoProfile -NonInteractive -File .\scripts\tests\verify-openspec-lifecycle.ps1`

Expected: PASS。

Run: `node scripts/tests/test-ai-coding-metrics.mjs`

Expected: PASS with `active-change-wip` dynamically derived from the ledger。

- [ ] **Step 6: Commit Task 13 tracked closeout files only**

```powershell
git add openspec/changes/isolated-branch-stack-browser-e2e/tasks.md openspec/lifecycle-ledger.json docs/plans/NOW.md
git commit -m "chore: close isolated stack lifecycle evidence"
```

---

### Task 14: PR machine-truth and current CI handoff for P6

**Files:**
- None (external PR handoff; no local commit)

**Interfaces:**
- Consumes: dynamic Task 10 run ID, committed evidence, Task 12 local results, and the future PR's current CI runs。
- Produces: P6 instructions only。This task is not a local implementation pass criterion and does not block Task 13's honest partial projection。

- [ ] **Step 1: Populate literal PR machine-truth labels from the dynamic run**

Read the committed `consumer-result.json`, `stack-manifest.json`, and passing `evidence-manifest.json` when present。Provide: `Frontend route=#semantic-search`; `Main button(s) tested=a4-refresh-sources,a4-run`; fixture; backend API; observed `ifc_ready_job_id`; visible states; exact E2E command; archive path; `stack_kind`; resolved ports; manifest path; HEAD; actual run ID; known gaps。

- [ ] **Step 2: Add explicit non-claims**

State `Design gate status=not claimed by isolated stack`, `Deploy path verification=not claimed`, `Kit/WebRTC first-frame/stage/DataChannel=not observed`, and `Full completion claimed=no` unless separately required gates exist。Confirm design manifest, baselines, and R-A1 authority were untouched。

- [ ] **Step 3: Obtain current PR CI links during P6**

After the PR exists, record the current design job result and run link。Historical context may state `13033cb` failure in run `30440400040`, PR #429 commit `2b9573e` recheck success, `bfcc433` historical snapshot, and fresh-branch baseline `deb5af552022c3ee171e3174f59c9f1e3dfb5936`; none is current evidence。

- [ ] **Step 4: Complete PR-only OpenSpec items later in P6**

Link `proposal.md` for adjacent-gap/U-state context without expanding this change。Only after the literal PR fields, current job link, and proposal summary exist may P6 check 6.5–6.7 and rerun the Task 13 projection sequence in a separate closeout commit。

---

## Plan self-review map

- Port `0..4`、`5/48/negative/non-integer` pre-listener refusal：Task 2。
- ChangeId/RunId、safe segment、manifest collision/no overwrite：Task 2。
- PID + exact entrypoint/command line + creation identity、all-before-any-stop：Task 3。
- Backend-only launcher、rollback、live status `{owned,ready}`、no watcher、Playwright viewer ownership：Tasks 3–4。
- `E2E_STACK_MANIFEST` worktree/path/content/head identity：Task 5。
- Manifest coordinator/viewer authority、env mismatch even another valid offset：Task 5。
- Require-real、no skip、forbidden reserved-port watcher：Tasks 6–8。
- Harness disclosure RED → implementation → GREEN：Tasks 5–7。
- Typed evidence signature、complete factory、same-run identity、existing artifact containment、atomic merge：Task 6。
- Explicit per-test tracing with built-in trace disabled and real trace-file validation：Tasks 5–7。
- Script registry/contract/docs/workflow/machine check：Tasks 1 and 9。
- Evidence-honest partial/full task state：Task 11。
- Independent final local gates：Task 12。
- Metrics/lifecycle ledger/NOW strict order and tracked-only closeout commit：Task 13。
- PR machine truth and current CI link deferred to P6：Task 14。
- Route → buttons → fixture → real coordinator API → observed runtime ID → loading/success/failure/retry：Tasks 7 and 10。
- Main-workspace storage preflight、dynamic collision-safe run ID、single-session transaction、three listener snapshots、unconditional stop：Task 10。
- A4 failure becomes known gap without A4 repair：Task 10。
- Isolation evidence does not claim Kit/design/deploy；deploy `-DryRun` remains regression-only：Tasks 10、12、14。
