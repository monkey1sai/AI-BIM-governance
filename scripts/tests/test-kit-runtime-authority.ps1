# scripts\tests\test-kit-runtime-authority.ps1
# Kit runtime authority 接線(scripts/lib/kit-runtime-authority.ps1)與本機啟動路徑的回歸測試。
# 回歸對象:start-all 沒把 COORDINATOR_INTERNAL_API_BASE / INTERNAL_API_AUTH_TOKEN 交給 Kit,
# Kit 的 RuntimeAuthorityClient 判定設定無效,每個 DataChannel trace 都被拒。
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'scripts\lib\kit-runtime-authority.ps1')
$hostExe = (Get-Process -Id $PID).Path

# 以 raw TCP 回應 HTTP 的 fake coordinator:/health 恆 200;/api/internal/* 只在
# X-Internal-Token 等於 AcceptedToken 時 200,否則 401(同 coordinator 的 internal auth gate)。
function Start-FakeCoordinator {
    param([Parameter(Mandatory = $true)][string] $AcceptedToken)

    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $shell = [powershell]::Create()
    [void]$shell.AddScript({
        param($Listener, $AcceptedToken)
        while ($true) {
            try { $client = $Listener.AcceptTcpClient() } catch { break }
            try {
                $stream = $client.GetStream()
                $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
                $requestLine = $reader.ReadLine()
                $headerToken = $null
                while ($true) {
                    $line = $reader.ReadLine()
                    if ([string]::IsNullOrEmpty($line)) { break }
                    $separator = $line.IndexOf(':')
                    if ($separator -gt 0 -and $line.Substring(0, $separator).Trim() -ieq 'X-Internal-Token') {
                        $headerToken = $line.Substring($separator + 1).Trim()
                    }
                }
                $path = ([string]$requestLine -split ' ')[1]
                if ($path -eq '/health') { $status = '200 OK' }
                elseif ($path.StartsWith('/api/internal/')) {
                    $status = if ($headerToken -ceq $AcceptedToken) { '200 OK' } else { '401 Unauthorized' }
                }
                else { $status = '404 Not Found' }
                $body = '{}'
                $bytes = [System.Text.Encoding]::ASCII.GetBytes(
                    "HTTP/1.1 $status`r`nContent-Type: application/json`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n$body")
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.Flush()
            }
            catch { }
            finally { $client.Close() }
        }
    }).AddArgument($listener).AddArgument($AcceptedToken)
    $handle = $shell.BeginInvoke()
    return [pscustomobject]@{
        Listener = $listener
        Shell = $shell
        Handle = $handle
        Base = "http://127.0.0.1:$($listener.LocalEndpoint.Port)"
    }
}

function Stop-FakeCoordinator {
    param([Parameter(Mandatory = $true)] $Fake)
    $Fake.Listener.Stop()
    try { [void]$Fake.Shell.EndInvoke($Fake.Handle) } catch { }
    $Fake.Shell.Dispose()
}

function Get-ClosedLoopbackPort {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $probe.Start()
    $port = $probe.LocalEndpoint.Port
    $probe.Stop()
    return $port
}

# 在子行程跑腳本;只為該子行程設定 authority env,結束後還原本行程。
function Invoke-ScriptWithAuthorityEnv {
    param(
        [Parameter(Mandatory = $true)][string] $ScriptPath,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [AllowNull()][string] $Base,
        [AllowNull()][string] $Token
    )
    $savedBase = $env:COORDINATOR_INTERNAL_API_BASE
    $savedToken = $env:INTERNAL_API_AUTH_TOKEN
    # Windows PowerShell 5.1 在 Stop 下會把子行程 stderr 轉成終止錯誤;這裡要收集而非中斷。
    $savedPreference = $ErrorActionPreference
    try {
        $env:COORDINATOR_INTERNAL_API_BASE = $Base
        $env:INTERNAL_API_AUTH_TOKEN = $Token
        $ErrorActionPreference = 'Continue'
        $output = & $hostExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1 | Out-String
        return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
    }
    finally {
        $ErrorActionPreference = $savedPreference
        $env:COORDINATOR_INTERNAL_API_BASE = $savedBase
        $env:INTERNAL_API_AUTH_TOKEN = $savedToken
    }
}

function Get-ThrownMessage {
    param([Parameter(Mandatory = $true)][scriptblock] $ScriptBlock)
    try { & $ScriptBlock } catch { return $_.Exception.Message }
    return $null
}

# Test 1: 未設任何 env -> 預設 loopback base 與 coordinator 非 production 預設 token
$authority = Resolve-KitRuntimeAuthority -BaseValue $null -TokenValue $null -CoordinatorPort 8004
Assert-Equal 'http://127.0.0.1:8004' $authority.Base 'default base is the local coordinator origin'
Assert-Equal 'dev-internal-token' $authority.Token 'default token mirrors the coordinator non-production fallback'
Assert-Equal 'coordinator_dev_default' $authority.TokenSource 'default token source is reported'
Write-TestPass 'unset env resolves to the coordinator defaults'

# Test 2: operator 設定的 token 優先,並比照 Kit/coordinator 去掉前後空白
$authority = Resolve-KitRuntimeAuthority -BaseValue 'http://localhost:8004/' -TokenValue '  operator-token  ' -CoordinatorPort 8004
Assert-Equal 'http://localhost:8004' $authority.Base 'loopback base is normalized to its origin'
Assert-Equal 'operator-token' $authority.Token 'operator token is used (trimmed like Kit does)'
Assert-Equal 'operator_env' $authority.TokenSource 'operator token source is reported'
Write-TestPass 'operator env wins and is normalized'

# Test 3: 空白 token 讓 coordinator 與 Kit 都失效 -> 必須大聲失敗
$message = Get-ThrownMessage { Resolve-KitRuntimeAuthority -BaseValue $null -TokenValue '   ' -CoordinatorPort 8004 }
Assert-True ($null -ne $message) 'whitespace-only token is rejected'
Assert-True ($message -match 'INTERNAL_API_AUTH_TOKEN') 'blank token error names the variable'
Write-TestPass 'blank operator token fails loudly'

# Test 4: Kit 只接受 origin-only loopback base;其他形狀全部拒絕
foreach ($bad in @(
        'http://192.168.20.181:8004',
        'http://127.0.0.1:8004/api',
        'http://user:pw@127.0.0.1:8004',
        'http://127.0.0.1:8004/?x=1',
        'http://127.0.0.1:8004/#frag',
        'ftp://127.0.0.1:8004',
        'not a url')) {
    $message = Get-ThrownMessage { Resolve-KitRuntimeAuthority -BaseValue $bad -TokenValue 'operator-token' -CoordinatorPort 8004 }
    Assert-True ($null -ne $message) "base '$bad' is rejected"
    Assert-True ($message -match 'COORDINATOR_INTERNAL_API_BASE') "error for '$bad' names the variable"
}
Assert-Equal 'http://[::1]:8004' (Resolve-KitRuntimeAuthority -BaseValue 'http://[::1]:8004' -TokenValue 't' -CoordinatorPort 8004).Base 'IPv6 loopback accepted'
Write-TestPass 'non-loopback or non-origin bases are refused'

# Test 5-7: 對真 HTTP 端點驗 token(與 Kit 送同一個 X-Internal-Token header)
$fake = Start-FakeCoordinator -AcceptedToken 'coordinator-token'
try {
    $probe = Test-CoordinatorInternalToken -Base $fake.Base -Token 'coordinator-token'
    Assert-Equal 'accepted' $probe.Verdict 'matching token is accepted'
    Assert-Equal 200 $probe.StatusCode 'accepted status code'
    Write-TestPass 'coordinator accepts the matching token'

    $probe = Test-CoordinatorInternalToken -Base $fake.Base -Token 'other-token'
    Assert-Equal 'rejected' $probe.Verdict 'mismatching token is rejected'
    Assert-Equal 401 $probe.StatusCode 'rejected status code'
    Write-TestPass 'coordinator rejects a different token'

    $mismatch = [pscustomobject]@{ Base = $fake.Base; Token = 'secret-kit-value'; TokenSource = 'coordinator_dev_default' }
    $message = Get-ThrownMessage { Assert-CoordinatorAcceptsKitToken -Authority $mismatch }
    Assert-True ($null -ne $message) 'rejected token throws'
    Assert-True ($message -match 'rejected') 'rejection message says rejected'
    Assert-True ($message -match 'INTERNAL_API_AUTH_TOKEN') 'rejection message tells the operator which variable to set'
    Assert-True ($message -notmatch 'secret-kit-value') 'rejection message never contains the token'
    Write-TestPass 'rejected token fails loudly without echoing the token'

    $match = [pscustomobject]@{ Base = $fake.Base; Token = 'coordinator-token'; TokenSource = 'operator_env' }
    Assert-CoordinatorAcceptsKitToken -Authority $match
    Write-TestPass 'accepted token passes the agreement check'
}
finally { Stop-FakeCoordinator -Fake $fake }

# Test 8: coordinator 不在 -> unreachable,且 assert 大聲失敗
$closedBase = "http://127.0.0.1:$(Get-ClosedLoopbackPort)"
$probe = Test-CoordinatorInternalToken -Base $closedBase -Token 'coordinator-token' -TimeoutSeconds 2
Assert-Equal 'unreachable' $probe.Verdict 'closed port is unreachable'
$message = Get-ThrownMessage {
    Assert-CoordinatorAcceptsKitToken -Authority ([pscustomobject]@{ Base = $closedBase; Token = 'x'; TokenSource = 'operator_env' }) -TimeoutSeconds 2
}
Assert-True ($null -ne $message -and $message -match [regex]::Escape($closedBase)) 'unreachable message names the probed base'
Write-TestPass 'unreachable coordinator fails loudly'

# Test 9: Kit launcher 自身的 env 檢查(Kit 規則:空 token 或非 loopback base = 設定無效)
Assert-KitRuntimeAuthorityEnvironment -BaseValue 'http://127.0.0.1:8004' -TokenValue 'coordinator-token'
$message = Get-ThrownMessage { Assert-KitRuntimeAuthorityEnvironment -BaseValue '' -TokenValue 'secret-kit-value' }
Assert-True ($null -ne $message -and $message -match 'COORDINATOR_INTERNAL_API_BASE') 'missing base is refused'
Assert-True ($message -notmatch 'secret-kit-value') 'launcher message never contains the token'
$message = Get-ThrownMessage { Assert-KitRuntimeAuthorityEnvironment -BaseValue 'http://127.0.0.1:8004' -TokenValue '' }
Assert-True ($null -ne $message -and $message -match 'INTERNAL_API_AUTH_TOKEN') 'missing token is refused'
Write-TestPass 'launcher env check mirrors Kit configuration_valid'

# Test 10: start-all 在 coordinator 拒絕 token 時不啟動 Kit,且 exit != 0
$startAll = Join-Path $repoRoot 'scripts\start-all.ps1'
$startAllArguments = @('-SkipCoordinator', '-SkipViewer', '-SkipConversionService', '-KitHost', '127.0.0.1', '-HealthTimeoutSeconds', '5')
$fake = Start-FakeCoordinator -AcceptedToken 'coordinator-token'
try {
    $run = Invoke-ScriptWithAuthorityEnv -ScriptPath $startAll -Arguments $startAllArguments -Base $fake.Base -Token 'secret-kit-value'
}
finally { Stop-FakeCoordinator -Fake $fake }
Assert-True ($run.ExitCode -ne 0) "start-all exits non-zero when the coordinator rejects the token (exit=$($run.ExitCode))"
Assert-True ($run.Output -match 'rejected') 'start-all reports the rejection'
Assert-True ($run.Output -notmatch '\[start\] bim-streaming-server') 'start-all does not launch Kit'
Assert-True ($run.Output -notmatch 'secret-kit-value') 'start-all never echoes the token'
Write-TestPass 'start-all refuses to launch Kit on token disagreement'

# Test 11: start-all 對非 loopback base 在啟動任何服務前就失敗
$run = Invoke-ScriptWithAuthorityEnv -ScriptPath $startAll -Arguments $startAllArguments -Base 'http://192.168.20.181:8004' -Token 'coordinator-token'
Assert-True ($run.ExitCode -ne 0) 'start-all exits non-zero for a non-loopback base'
Assert-True ($run.Output -match 'COORDINATOR_INTERNAL_API_BASE') 'start-all names the bad variable'
Assert-True ($run.Output -notmatch '\[start\]') 'no service is started'
Write-TestPass 'start-all refuses a non-loopback runtime authority base'

# Test 12: start-streaming-server 沒有 authority env 時,在碰 Kit build/port 前就失敗
$streamingLauncher = Join-Path $repoRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'
$run = Invoke-ScriptWithAuthorityEnv -ScriptPath $streamingLauncher -Arguments @('-SkipAutoLoad', '-SkipGpuCheck') -Base $null -Token $null
Assert-True ($run.ExitCode -ne 0) 'Kit launcher exits non-zero without runtime authority env'
Assert-True ($run.Output -match 'COORDINATOR_INTERNAL_API_BASE') 'Kit launcher names the missing variable'
Assert-True ($run.Output -notmatch 'Streaming launcher not found') 'authority check runs before build/port checks'
Write-TestPass 'Kit launcher refuses to start without runtime authority env'
