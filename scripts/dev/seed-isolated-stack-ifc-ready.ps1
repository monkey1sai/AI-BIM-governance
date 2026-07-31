#requires -Version 5.1
<#
.SYNOPSIS
    對隔離 branch stack 的 coordinator 灌入一筆來自真實 MinIO 的 IFC-ready job。

.DESCRIPTION
    a4-console-convergence Task 4.0。`start-isolated-branch-stack.ps1` 對 coordinator 明示
    MINIO_WATCH_ENABLED=false 且 store/storage 綁 per-run 目錄，隔離 stack 因此永遠沒有
    download_status="downloaded" 的 job，A4 browser E2E 的 preflight 會在開瀏覽器前就 fail。

    本 wrapper 呼叫 coordinator 內的 seedIsolatedIfcReadyCli，顯式重放一次 MinIO watcher tick：
    list 真 bucket → presign → POST /api/external/ifc-ready → coordinator 真的下載 bytes。

    這不是 canonical operator entrypoint，不得取代 deploy.ps1，也不會啟動或停止任何服務；
    stack 生命週期仍由 start-isolated-branch-stack.ps1 擁有。

.PARAMETER CoordinatorBaseUrl
    隔離 stack 的 coordinator base（loopback，port 8005..8009）。打到部署區 :8004 會被 fail closed 拒絕。

.PARAMETER ChangeId
    evidence 歸屬的 OpenSpec change id。

.PARAMETER RunId
    本次 seeding 的 run id；與 evidence 目錄同名。

.PARAMETER RequiredKey
    指定要 seed 的 MinIO object key。省略時以字典序挑第一個合規約物件（可重現）。

.PARAMETER OutPath
    seed 結果 JSON 落點；省略則只印出 job id。

.PARAMETER EnvFile
    MinIO 連線設定檔（`MINIO_WATCH_*`）。worktree 內沒有 untracked 的 .env，跨 worktree 執行時
    必須明示指向可用設定檔；省略時沿用 coordinator 目錄的 .env。憑證一律不進 tracked 檔。

.PARAMETER DryRun
    只驗證本機路徑並輸出將執行的安全 invocation 摘要；不載入 env、不連 MinIO、不呼叫 coordinator。

.EXAMPLE
    pwsh -NoProfile -File scripts/dev/seed-isolated-stack-ifc-ready.ps1 `
        -CoordinatorBaseUrl http://127.0.0.1:8005 `
        -ChangeId a4-console-convergence -RunId seed-20260730-0001 `
        -OutPath artifacts/e2e/a4-console-convergence/seed-20260730-0001/seed-result.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $CoordinatorBaseUrl,
    [Parameter(Mandatory)][string] $ChangeId,
    [Parameter(Mandatory)][string] $RunId,
    [string] $RequiredKey,
    [string] $OutPath,
    [string] $EnvFile,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$structLogPath = Join-Path $repoRoot 'scripts\lib\StructLog.psm1'
Import-Module -Force $structLogPath

function New-IsolatedSeedLifecycleData {
    param(
        [string] $StructRunId,
        [ValidateSet('start','closed')][string] $Phase,
        [string] $Status
    )
    $data = @{
        phase = $Phase
        subject_kind = 'script_run'
        subject_id = $StructRunId
        change_id = $ChangeId
        seed_run_id = $RunId
        dry_run = [bool]$DryRun
    }
    if ($Status) { $data.status = $Status }
    return $data
}

function Assert-IsolatedSeedWrapperTarget {
    param([string] $BaseUrl)
    $target = $null
    if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$target)) {
        throw 'CoordinatorBaseUrl 必須是 absolute URL。'
    }
    if ($target.Scheme -cne 'http') { throw 'CoordinatorBaseUrl 必須使用 http scheme。' }
    if (-not [string]::IsNullOrEmpty($target.UserInfo)) { throw 'CoordinatorBaseUrl 不得包含 URL credentials。' }
    if (@('127.0.0.1', 'localhost') -notcontains $target.Host.ToLowerInvariant()) {
        throw 'CoordinatorBaseUrl 必須是 loopback host。'
    }
    if ($target.IsDefaultPort -or $target.Port -notin 8005..8009) {
        throw 'CoordinatorBaseUrl port 必須在 isolated coordinator 範圍 8005..8009。'
    }
}

$logRoot = Join-Path $repoRoot 'artifacts\e2e\_launcher\structured-logs'
$logger = New-StructLogger -Service 'scripts' -Component 'isolated-stack-ifc-ready-seed' `
    -LogRoot $logRoot -SkipEnvSnapshot
$startData = New-IsolatedSeedLifecycleData -StructRunId $logger.RunId -Phase start
$logger | Write-StructLifecycle -Msg 'isolated stack IFC-ready seeding started' -Data $startData | Out-Null

try {
$null = Assert-IsolatedSeedWrapperTarget -BaseUrl $CoordinatorBaseUrl
$coordinatorRoot = Join-Path $repoRoot 'bim-review-coordinator'
if (-not (Test-Path -LiteralPath $coordinatorRoot)) {
    throw "找不到 coordinator 目錄：$coordinatorRoot"
}

$cliArgs = @(
    'tsx', 'src/tools/seedIsolatedIfcReadyCli.ts',
    '--coordinator-base-url', $CoordinatorBaseUrl,
    '--change-id', $ChangeId,
    '--run-id', $RunId
)
if ($RequiredKey) { $cliArgs += @('--required-key', $RequiredKey) }
if ($EnvFile) {
    if (-not (Test-Path -LiteralPath $EnvFile)) { throw "找不到 EnvFile：$EnvFile" }
    $cliArgs += @('--env-file', (Resolve-Path -LiteralPath $EnvFile).Path)
}
if ($OutPath) {
    # 相對路徑以 repo root 為基準解析：呼叫端通常從 repo root 給 artifacts/e2e/... 這種路徑，
    # 但 CLI 的 cwd 是 coordinator 子目錄，直接沿用會把 evidence 寫進錯的地方。
    $resolvedOut = if ([IO.Path]::IsPathRooted($OutPath)) { $OutPath } else { Join-Path $repoRoot $OutPath }
    $cliArgs += @('--out', $resolvedOut)
}

if ($DryRun) {
    $dryRunRecord = [ordered]@{
        status = 'dry_run'
        command = 'npx'
        arguments = $cliArgs
        working_directory = $coordinatorRoot
    }
    $dryRunRecord | ConvertTo-Json -Depth 4 -Compress
}
else {
    Push-Location $coordinatorRoot
    try {
        & npx @cliArgs
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($exitCode -ne 0) {
        throw "seed 失敗（exit $exitCode）"
    }
}

$completionStatus = if ($DryRun) { 'dry_run' } else { 'completed' }
$completionData = New-IsolatedSeedLifecycleData -StructRunId $logger.RunId -Phase closed -Status $completionStatus
$logger | Write-StructLifecycle -Msg 'isolated stack IFC-ready seeding completed' -Data $completionData | Out-Null
}
catch {
    $failureData = New-IsolatedSeedLifecycleData -StructRunId $logger.RunId -Phase closed -Status failed
    $logger | Write-StructLifecycle -Msg 'isolated stack IFC-ready seeding failed' -Data $failureData -Level error | Out-Null
    $logger | Write-StructError -Msg 'isolated stack IFC-ready seeding failed' -ErrorRecord $_ -Data @{
        change_id = $ChangeId
        seed_run_id = $RunId
        dry_run = [bool]$DryRun
    } | Out-Null
    throw
}
