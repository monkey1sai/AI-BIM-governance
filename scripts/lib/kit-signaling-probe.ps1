# scripts\lib\kit-signaling-probe.ps1
# Media-side readiness for a host-native Kit: does the livestream server actually
# OFFER a video track to a signalling client?
#
# Why the log/port gate was not enough (canonical-linux, 2026-09-07 .. 2026-09-15):
# a Kit that came up straight after its predecessor was SIGKILLed or crashed passed
# ':49100 LISTEN + app ready + Started primary stream server' every time, and 2 of
# the last 5 such Kits never sent a single WebRTC offer for the rest of their life
# - browsers saw peer_info and heartbeats, never an SDP, and every viewer stopped
# at "WebRTC 串流未建立". The coordinator only notices after two viewer leases.
#
# What a healthy Kit does (measured against the omniverse-webrtc-streaming-library
# 5.18 client flow and a live Kit): the client opens
#   ws://<host>:<signal port>/sign_in?peer_id=peer-<10 digits>&version=2
# and, unprompted, the server sends {peer_info} for the client, {peer_info} for
# itself ("OneSdkServer-…"), then {peer_msg:{from,msg}} whose msg is
# {"type":"offer","sdp":"…m=video…"} - all within ~50 ms. Every server message
# carries an ackid the client must answer with {"ack":<id>}; {hb} is a heartbeat.
# A dead media layer never produces the offer (or produces one without m=video).
#
# This module keeps the protocol decision pure (Update-KitSignalingProbeState) so
# the deploy gate is testable without sockets, and wraps the real WebSocket in
# Test-KitSignalingOffer with an injectable session factory. Windows PowerShell
# 5.1 and PowerShell 7 both ship System.Net.WebSockets.ClientWebSocket.

Set-StrictMode -Version Latest

function New-KitSignalingPeerId {
    # Same shape the browser library generates: 'peer-' + 10 digits.
    [CmdletBinding()]
    param()
    $digits = ''
    for ($i = 0; $i -lt 10; $i++) { $digits += [string](Get-Random -Minimum 0 -Maximum 10) }
    if ($digits[0] -eq '0') { $digits = '1' + $digits.Substring(1) }
    return "peer-$digits"
}

function New-KitSignalingProbeState {
    [CmdletBinding()]
    param()
    return [pscustomobject]@{
        result       = 'no_offer'
        done         = $false
        peerInfoSeen = $false
        selfPeerId   = $null
        serverPeerId = $null
        maxAckId     = 0
        hasVideo     = $false
        hasAudio     = $false
        messageCount = 0
        parseErrors  = 0
        lastError    = $null
    }
}

function Update-KitSignalingProbeState {
    # Folds one server message into $State and returns what the client must send
    # back (acks) plus whether the probe has reached a verdict. Pure: no sockets.
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $State,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $MessageText,
        [string] $PeerId = ''
    )
    $State.messageCount++
    $send = @()
    $parsed = $null
    try { $parsed = $MessageText | ConvertFrom-Json -ErrorAction Stop } catch { $parsed = $null }
    if ($null -eq $parsed -or -not ($parsed -is [System.Management.Automation.PSCustomObject])) {
        $State.parseErrors++
        return [pscustomobject]@{ Send = @($send); Done = [bool]$State.done }
    }
    $names = @($parsed.PSObject.Properties.Name)
    if ($names -contains 'ackid') {
        $ackId = 0
        if ([int]::TryParse([string]$parsed.ackid, [ref]$ackId) -and $ackId -gt $State.maxAckId) {
            $State.maxAckId = $ackId
            $send += (@{ ack = $ackId } | ConvertTo-Json -Compress)
        }
    }
    if ($names -contains 'peer_info' -and $null -ne $parsed.peer_info) {
        $State.peerInfoSeen = $true
        $info = $parsed.peer_info
        $infoNames = @($info.PSObject.Properties.Name)
        $infoName = if ($infoNames -contains 'name') { [string]$info.name } else { '' }
        $infoId = if ($infoNames -contains 'id') { $info.id } else { $null }
        if ($PeerId -and $infoName -eq $PeerId) { $State.selfPeerId = $infoId }
        elseif ($null -eq $State.serverPeerId) { $State.serverPeerId = $infoId }
    }
    if ($names -contains 'error' -and $null -ne $parsed.error) {
        $State.lastError = [string]$parsed.error
    }
    if ($names -contains 'peer_msg' -and $null -ne $parsed.peer_msg) {
        $peerMsg = $parsed.peer_msg
        $inner = $null
        $msgNames = @($peerMsg.PSObject.Properties.Name)
        if ($msgNames -contains 'msg') {
            try { $inner = [string]$peerMsg.msg | ConvertFrom-Json -ErrorAction Stop } catch { $inner = $null }
        }
        if ($null -ne $inner -and (@($inner.PSObject.Properties.Name) -contains 'type') -and [string]$inner.type -eq 'offer') {
            $sdp = if (@($inner.PSObject.Properties.Name) -contains 'sdp') { [string]$inner.sdp } else { '' }
            $State.hasVideo = [bool]($sdp -match '(?m)^m=video')
            $State.hasAudio = [bool]($sdp -match '(?m)^m=audio')
            $State.result = if ($State.hasVideo) { 'offer_with_video' } else { 'offer_without_video' }
            $State.done = $true
        }
    }
    return [pscustomobject]@{ Send = @($send); Done = [bool]$State.done }
}

function Test-KitSignalingClientWebSocketAvailable {
    [CmdletBinding()]
    param()
    try { $null = [System.Net.WebSockets.ClientWebSocket]; return $true } catch { return $false }
}

function New-KitSignalingWebSocketSession {
    # Thin wrapper over ClientWebSocket exposing Connect / Receive / Send / Close
    # as script methods so Test-KitSignalingOffer can be driven by a fake in tests.
    # Receive returns the next complete text message, or $null when the server
    # closed the socket or the per-call timeout elapsed.
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Uri
    )
    $session = [pscustomobject]@{
        Uri    = $Uri
        Socket = [System.Net.WebSockets.ClientWebSocket]::new()
        Buffer = [byte[]]::new(262144)
    }
    $session | Add-Member -MemberType ScriptMethod -Name Connect -Value {
        param([int] $timeoutMs)
        $cts = [System.Threading.CancellationTokenSource]::new([int]$timeoutMs)
        try { $this.Socket.ConnectAsync([Uri]$this.Uri, $cts.Token).GetAwaiter().GetResult() | Out-Null }
        finally { $cts.Dispose() }
    }
    $session | Add-Member -MemberType ScriptMethod -Name Receive -Value {
        param([int] $timeoutMs)
        if ($this.Socket.State -ne [System.Net.WebSockets.WebSocketState]::Open) { return $null }
        $cts = [System.Threading.CancellationTokenSource]::new([Math]::Max(1, [int]$timeoutMs))
        $text = [System.Text.StringBuilder]::new()
        try {
            do {
                $segment = [System.ArraySegment[byte]]::new($this.Buffer)
                $result = $this.Socket.ReceiveAsync($segment, $cts.Token).GetAwaiter().GetResult()
                if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { return $null }
                [void]$text.Append([System.Text.Encoding]::UTF8.GetString($this.Buffer, 0, $result.Count))
            } while (-not $result.EndOfMessage)
        } catch [System.OperationCanceledException] {
            return $null
        } catch {
            if ($_.Exception -is [System.AggregateException] -and $_.Exception.InnerException -is [System.OperationCanceledException]) { return $null }
            throw
        } finally { $cts.Dispose() }
        return $text.ToString()
    }
    $session | Add-Member -MemberType ScriptMethod -Name Send -Value {
        param([string] $text, [int] $timeoutMs)
        $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$text)
        $cts = [System.Threading.CancellationTokenSource]::new([Math]::Max(1, [int]$timeoutMs))
        try { $this.Socket.SendAsync([System.ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult() | Out-Null }
        finally { $cts.Dispose() }
    }
    $session | Add-Member -MemberType ScriptMethod -Name Close -Value {
        try {
            if ($this.Socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
                $cts = [System.Threading.CancellationTokenSource]::new(3000)
                try { $this.Socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'probe done', $cts.Token).GetAwaiter().GetResult() | Out-Null }
                finally { $cts.Dispose() }
            }
        } catch { }
        try { $this.Socket.Dispose() } catch { }
    }
    return $session
}

function Test-KitSignalingOffer {
    # One signalling handshake against a Kit: connect, ack every server message,
    # and wait up to $TimeoutSec for a peer_msg offer that carries m=video.
    #
    # Result fields:
    #   ready   - $true only for probe='checked' AND result='offer_with_video'
    #   probe   - 'checked' | 'unavailable' (no ClientWebSocket type on this host)
    #             | 'connect_failed' (TCP/HTTP upgrade refused)
    #   result  - 'offer_with_video' | 'offer_without_video' | 'no_offer'
    #   reason  - short machine reason for a non-ready result
    [CmdletBinding()]
    param(
        [string] $HostName = '127.0.0.1',
        [int] $Port = 49100,
        [ValidateRange(1, 600)][int] $TimeoutSec = 20,
        [string] $PeerId = '',
        [scriptblock] $SessionFactory = {
            param($uri)
            New-KitSignalingWebSocketSession -Uri $uri
        },
        [scriptblock] $AvailabilityProbe = { Test-KitSignalingClientWebSocketAvailable }
    )
    if ([string]::IsNullOrWhiteSpace($PeerId)) { $PeerId = New-KitSignalingPeerId }
    $uri = "ws://${HostName}:${Port}/sign_in?peer_id=$PeerId&version=2"
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $state = New-KitSignalingProbeState
    $timeoutMs = [int]$TimeoutSec * 1000
    $report = {
        param([string] $probe, [string] $reason)
        [pscustomobject]@{
            ready        = [bool]($probe -eq 'checked' -and $state.result -eq 'offer_with_video')
            probe        = $probe
            result       = $state.result
            reason       = $reason
            hasVideo     = [bool]$state.hasVideo
            hasAudio     = [bool]$state.hasAudio
            peerInfoSeen = [bool]$state.peerInfoSeen
            serverPeerId = $state.serverPeerId
            messageCount = [int]$state.messageCount
            elapsedMs    = [int]$watch.ElapsedMilliseconds
            peerId       = $PeerId
            uri          = $uri
        }
    }
    if (-not [bool](& $AvailabilityProbe)) {
        return (& $report 'unavailable' 'client_websocket_unavailable')
    }
    $session = $null
    try {
        $session = & $SessionFactory $uri
        try { $session.Connect($timeoutMs) }
        catch {
            $detail = $_.Exception.Message
            if ($_.Exception.InnerException) { $detail = $_.Exception.InnerException.Message }
            return (& $report 'connect_failed' "connect_failed: $detail")
        }
        while (-not $state.done) {
            $remaining = $timeoutMs - [int]$watch.ElapsedMilliseconds
            if ($remaining -le 0) { break }
            $message = $session.Receive($remaining)
            if ($null -eq $message) {
                if ([int]$watch.ElapsedMilliseconds -ge $timeoutMs) { break }
                return (& $report 'checked' 'server_closed_before_offer')
            }
            $step = Update-KitSignalingProbeState -State $state -MessageText ([string]$message) -PeerId $PeerId
            foreach ($outgoing in @($step.Send)) { $session.Send([string]$outgoing, 5000) }
        }
    } finally {
        if ($null -ne $session) { try { $session.Close() } catch { } }
    }
    $reason = switch ($state.result) {
        'offer_with_video' { '' }
        'offer_without_video' { 'offer_without_video_track' }
        default {
            if ($state.lastError) { "no_offer_within_${TimeoutSec}s (server error: $($state.lastError))" }
            elseif ($state.peerInfoSeen) { "no_offer_within_${TimeoutSec}s (signalling alive: peer_info received, media layer silent)" }
            else { "no_offer_within_${TimeoutSec}s (no peer_info either)" }
        }
    }
    return (& $report 'checked' $reason)
}

function Invoke-KitMediaReadinessGate {
    # Probe -> (restart -> probe) up to $Attempts times. RestartFn owns stop /
    # release / cool-down / relaunch / log-gate and returns $true when the
    # relaunched Kit passed the log-side readiness again; a $false aborts the
    # gate immediately (the deploy must not keep cycling a Kit it cannot even
    # bring to LISTEN). A probe that cannot run at all ('unavailable') is
    # reported as advisory and does not fail the deploy - it is an extra witness
    # on hosts whose PowerShell lacks ClientWebSocket, not the only one.
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][scriptblock] $ProbeFn,
        [Parameter(Mandatory = $true)][scriptblock] $RestartFn,
        [ValidateRange(1, 10)][int] $Attempts = 2,
        [scriptblock] $LogFn = { param($tag, $message) }
    )
    $results = @()
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $probe = & $ProbeFn $attempt
        $results += $probe
        if ([string]$probe.probe -eq 'unavailable') {
            & $LogFn 'warn' "Phase 4c Kit media gate advisory only: $($probe.reason)"
            return [pscustomobject]@{ ready = $true; advisory = $true; attempts = $attempt; reason = 'probe_unavailable'; results = @($results) }
        }
        if ([bool]$probe.ready) {
            & $LogFn 'ok' "Phase 4c Kit media gate passed on attempt ${attempt}: offer with video track in $($probe.elapsedMs)ms (server peer $($probe.serverPeerId))"
            return [pscustomobject]@{ ready = $true; advisory = $false; attempts = $attempt; reason = ''; results = @($results) }
        }
        & $LogFn 'fail' "Phase 4c Kit media gate attempt ${attempt}/${Attempts}: $($probe.result) ($($probe.reason)) after $($probe.elapsedMs)ms, $($probe.messageCount) message(s)"
        if ($attempt -lt $Attempts) {
            & $LogFn 'fix' "Phase 4c relaunching host-native Kit (attempt $($attempt + 1)/${Attempts}) because the media layer never offered video"
            $restarted = $false
            try { $restarted = [bool](& $RestartFn $attempt) } catch { & $LogFn 'fail' "Phase 4c Kit relaunch threw: $($_.Exception.Message)"; $restarted = $false }
            if (-not $restarted) {
                return [pscustomobject]@{ ready = $false; advisory = $false; attempts = $attempt; reason = 'restart_failed'; results = @($results) }
            }
        }
    }
    return [pscustomobject]@{ ready = $false; advisory = $false; attempts = $Attempts; reason = 'media_offer_missing'; results = @($results) }
}
