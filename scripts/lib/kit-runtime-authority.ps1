# Kit runtime authority 接線(本機啟動路徑用)。
#
# Kit 的 RuntimeAuthorityClient(bim-streaming-server/.../messaging/runtime_authority.py)
# 只在 COORDINATOR_INTERNAL_API_BASE 是 origin-only loopback http(s) URL、且
# INTERNAL_API_AUTH_TOKEN 非空時才視為設定有效;否則每個 DataChannel trace 都被拒,
# stage 永遠載不起來。coordinator 則在 INTERNAL_API_AUTH_TOKEN 為空時退回
# 'dev-internal-token'(bim-review-coordinator/src/config.ts)。兩邊必須拿到同一個值,
# 而唯一能證明「同一個」的方式,是用 Kit 會送的 header 去問正在跑的 coordinator。
#
# 本檔不讀任何 .env,也不輸出 token;錯誤訊息只提變數名與 base。
# 必須維持 Windows PowerShell 5.1 相容:start-all 以 powershell.exe 啟動 Kit launcher。

$script:KitRuntimeAuthorityDevDefaultToken = 'dev-internal-token'
$script:KitRuntimeAuthorityProbePath = '/api/internal/structLog/health'

function ConvertTo-KitRuntimeAuthorityBase {
    # 與 Kit _is_loopback_base 同一套規則;回傳去掉前後空白與尾斜線的 origin。
    param([AllowNull()][AllowEmptyString()][string] $Value)

    $rule = 'COORDINATOR_INTERNAL_API_BASE must be an origin-only loopback http(s) URL ' +
        '(for example http://127.0.0.1:8004) without credentials, path, query, or fragment; ' +
        'Kit rejects every DataChannel trace otherwise.'
    $uri = $null
    if ([string]::IsNullOrWhiteSpace($Value) -or
        -not [uri]::TryCreate($Value.Trim(), [System.UriKind]::Absolute, [ref]$uri)) {
        throw $rule
    }
    $hostName = $uri.Host.Trim([char[]]'[]').ToLowerInvariant()
    $address = $null
    $isLoopback = ($hostName -eq 'localhost') -or
        ([System.Net.IPAddress]::TryParse($hostName, [ref]$address) -and [System.Net.IPAddress]::IsLoopback($address))
    if (-not ($uri.Scheme -eq 'http' -or $uri.Scheme -eq 'https') -or
        -not $isLoopback -or
        -not [string]::IsNullOrEmpty($uri.UserInfo) -or
        -not [string]::IsNullOrEmpty($uri.Query) -or
        -not [string]::IsNullOrEmpty($uri.Fragment) -or
        -not ($uri.AbsolutePath -eq '' -or $uri.AbsolutePath -eq '/')) {
        throw $rule
    }
    # 同 Kit 的 strip().rstrip("/");不用 GetLeftPart,.NET Framework 會把 [::1] 展開成全長位址。
    return $Value.Trim().TrimEnd('/')
}

function Resolve-KitRuntimeAuthority {
    # Base:operator 設定值,否則本機 coordinator origin。
    # Token:operator 設定值;否則 coordinator 自己的非 production 預設——它只有在
    # coordinator 也沒有私有值時才相符,是否相符交給 Assert-CoordinatorAcceptsKitToken 判定。
    param(
        [AllowNull()][AllowEmptyString()][string] $BaseValue,
        [AllowNull()][AllowEmptyString()][string] $TokenValue,
        [Parameter(Mandatory = $true)][int] $CoordinatorPort
    )

    $baseCandidate = if ([string]::IsNullOrEmpty($BaseValue)) { "http://127.0.0.1:$CoordinatorPort" } else { $BaseValue }
    $base = ConvertTo-KitRuntimeAuthorityBase -Value $baseCandidate

    if ([string]::IsNullOrEmpty($TokenValue)) {
        return [pscustomobject]@{
            Base = $base
            Token = $script:KitRuntimeAuthorityDevDefaultToken
            TokenSource = 'coordinator_dev_default'
        }
    }
    if ([string]::IsNullOrWhiteSpace($TokenValue)) {
        # coordinator 會沿用這個空白值並拒絕所有 internal 呼叫;Kit strip 後視為未設定。
        throw 'INTERNAL_API_AUTH_TOKEN is set but blank; set it to the coordinator internal token or remove it.'
    }
    return [pscustomobject]@{
        Base = $base
        Token = $TokenValue.Trim()
        TokenSource = 'operator_env'
    }
}

function Test-CoordinatorInternalToken {
    # 用 Kit 同款 X-Internal-Token 打唯讀 internal endpoint;回傳 Verdict 為
    # accepted / rejected / unexpected_status / unreachable。
    param(
        [Parameter(Mandatory = $true)][string] $Base,
        [Parameter(Mandatory = $true)][string] $Token,
        [int] $TimeoutSeconds = 3
    )

    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.UseProxy = $false
    $client = New-Object System.Net.Http.HttpClient -ArgumentList $handler
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
    try {
        $request = [System.Net.Http.HttpRequestMessage]::new(
            [System.Net.Http.HttpMethod]::Get, ($Base.TrimEnd('/') + $script:KitRuntimeAuthorityProbePath))
        [void]$request.Headers.TryAddWithoutValidation('X-Internal-Token', $Token)
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        $response.Dispose()
    }
    catch {
        return [pscustomobject]@{ Verdict = 'unreachable'; StatusCode = $null }
    }
    finally {
        $client.Dispose()
    }

    $verdict = if ($status -ge 200 -and $status -lt 300) { 'accepted' }
    elseif ($status -eq 401 -or $status -eq 403) { 'rejected' }
    else { 'unexpected_status' }
    return [pscustomobject]@{ Verdict = $verdict; StatusCode = $status }
}

function Assert-CoordinatorAcceptsKitToken {
    param(
        [Parameter(Mandatory = $true)] $Authority,
        [int] $TimeoutSeconds = 3
    )

    $probe = Test-CoordinatorInternalToken -Base $Authority.Base -Token $Authority.Token -TimeoutSeconds $TimeoutSeconds
    $endpoint = $Authority.Base + $script:KitRuntimeAuthorityProbePath
    switch ($probe.Verdict) {
        'accepted' { return }
        'rejected' {
            if ($Authority.TokenSource -eq 'operator_env') {
                throw ("Kit runtime authority: coordinator at $($Authority.Base) rejected the INTERNAL_API_AUTH_TOKEN " +
                    "from this shell (HTTP $($probe.StatusCode)). The running coordinator uses a different value, " +
                    'usually because it was started earlier or from another shell. Run scripts\stop-all.ps1 and ' +
                    'start again from this shell so both processes inherit the same value. Refusing to start Kit.')
            }
            throw ("Kit runtime authority: coordinator at $($Authority.Base) rejected its non-production default " +
                "internal token (HTTP $($probe.StatusCode)), so its effective INTERNAL_API_AUTH_TOKEN comes from its own " +
                'configuration (for example bim-review-coordinator/.env). Set $env:INTERNAL_API_AUTH_TOKEN in this ' +
                'shell to that same value, run scripts\stop-all.ps1, then start again. Refusing to start Kit.')
        }
        'unexpected_status' {
            throw ("Kit runtime authority: $endpoint answered HTTP $($probe.StatusCode); " +
                'COORDINATOR_INTERNAL_API_BASE may not point at bim-review-coordinator. Refusing to start Kit.')
        }
        default {
            throw ("Kit runtime authority: no HTTP response from $endpoint, so the Kit token cannot be verified. " +
                'Start bim-review-coordinator (or fix COORDINATOR_INTERNAL_API_BASE) and retry. Refusing to start Kit.')
        }
    }
}

function Assert-KitRuntimeAuthorityEnvironment {
    # Kit launcher 自身的檢查:它不知道 coordinator 用哪個值,但空 token 或非 loopback base
    # 保證 Kit 拒絕所有 DataChannel trace,必定與任何 coordinator 不一致。
    param(
        [AllowNull()][AllowEmptyString()][string] $BaseValue,
        [AllowNull()][AllowEmptyString()][string] $TokenValue
    )

    [void](ConvertTo-KitRuntimeAuthorityBase -Value $BaseValue)
    if ([string]::IsNullOrWhiteSpace($TokenValue)) {
        throw ('INTERNAL_API_AUTH_TOKEN is empty; Kit would reject every DataChannel trace. Set it to the same ' +
            'value bim-review-coordinator uses (scripts\start-all.ps1 does this and verifies it).')
    }
}
