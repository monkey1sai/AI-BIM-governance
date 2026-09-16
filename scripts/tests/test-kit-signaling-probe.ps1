# scripts\tests\test-kit-signaling-probe.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\kit-signaling-probe.ps1'
. $modulePath

# Message shapes recorded against canonical-linux Kit 110.1 (2026-09-15): the
# server acks nothing itself, tags every message with ackid, announces the client
# and then itself via peer_info, and pushes the offer as a peer_msg whose msg is a
# JSON string.
$peer = 'peer-5076125100'
$msgSelfInfo = '{"ackid":1,"peer_info":{"connected":true,"id":3,"name":"' + $peer + '","peer_role":0,"version":2}}'
$msgServerInfo = '{"ackid":2,"peer_info":{"connected":true,"id":1,"name":"OneSdkServer-8726811140914326317","peer_role":0,"version":2}}'
$crlf = "`r`n"
$sdpVideo = "v=0${crlf}o=- 1 2 IN IP4 127.0.0.1${crlf}s=odrerir${crlf}m=audio 9 UDP/TLS/RTP/SAVPF 111${crlf}a=mid:0${crlf}m=video 9 UDP/TLS/RTP/SAVPF 96${crlf}a=mid:1${crlf}m=application 9 UDP/DTLS/SCTP webrtc-datachannel${crlf}"
$sdpAudioOnly = "v=0${crlf}o=- 1 2 IN IP4 127.0.0.1${crlf}s=odrerir${crlf}m=audio 9 UDP/TLS/RTP/SAVPF 111${crlf}a=mid:0${crlf}"
$msgOfferVideo = (@{ ackid = 3; peer_msg = @{ from = 1; msg = (@{ type = 'offer'; sdp = $sdpVideo } | ConvertTo-Json -Compress) } } | ConvertTo-Json -Compress -Depth 5)
$msgOfferAudioOnly = (@{ ackid = 3; peer_msg = @{ from = 1; msg = (@{ type = 'offer'; sdp = $sdpAudioOnly } | ConvertTo-Json -Compress) } } | ConvertTo-Json -Compress -Depth 5)
$msgHeartbeat = '{"hb":1}'

# Test 1: healthy sequence -> offer_with_video, one ack per ackid, server peer id learnt
$state = New-KitSignalingProbeState
$s1 = Update-KitSignalingProbeState -State $state -MessageText $msgSelfInfo -PeerId $peer
Assert-Equal 1 @($s1.Send).Count 'self peer_info is acked'
Assert-Equal '{"ack":1}' ([string]$s1.Send[0]) 'ack carries the ackid'
Assert-True (-not $s1.Done) 'peer_info alone is not a verdict'
Assert-Equal 3 $state.selfPeerId 'self peer id learnt from name match'
$s2 = Update-KitSignalingProbeState -State $state -MessageText $msgServerInfo -PeerId $peer
Assert-Equal 1 $state.serverPeerId 'server peer id learnt from the other peer_info'
$s3 = Update-KitSignalingProbeState -State $state -MessageText $msgOfferVideo -PeerId $peer
Assert-True $s3.Done 'offer ends the probe'
Assert-Equal 'offer_with_video' $state.result 'offer with m=video -> offer_with_video'
Assert-True $state.hasVideo 'hasVideo'
Assert-True $state.hasAudio 'hasAudio'
Assert-Equal 3 $state.maxAckId 'max ackid tracked'
Write-TestPass 'healthy signalling sequence yields offer_with_video'

# Test 2: audio-only offer (the 2026-09-03 failure shape) -> offer_without_video
$state = New-KitSignalingProbeState
$null = Update-KitSignalingProbeState -State $state -MessageText $msgServerInfo -PeerId $peer
$s = Update-KitSignalingProbeState -State $state -MessageText $msgOfferAudioOnly -PeerId $peer
Assert-True $s.Done 'audio-only offer still ends the probe'
Assert-Equal 'offer_without_video' $state.result 'offer without m=video -> offer_without_video'
Assert-True (-not $state.hasVideo) 'hasVideo false'
Write-TestPass 'audio-only offer is not ready'

# Test 3: heartbeat / duplicate ackid / malformed text never produce a verdict or a duplicate ack
$state = New-KitSignalingProbeState
$null = Update-KitSignalingProbeState -State $state -MessageText $msgServerInfo -PeerId $peer
$h = Update-KitSignalingProbeState -State $state -MessageText $msgHeartbeat -PeerId $peer
Assert-Equal 0 @($h.Send).Count 'heartbeat needs no ack'
$dup = Update-KitSignalingProbeState -State $state -MessageText $msgServerInfo -PeerId $peer
Assert-Equal 0 @($dup.Send).Count 'a replayed ackid is not acked twice'
$bad = Update-KitSignalingProbeState -State $state -MessageText 'not json {' -PeerId $peer
Assert-Equal 0 @($bad.Send).Count 'malformed message sends nothing'
Assert-Equal 1 $state.parseErrors 'malformed message counted'
Assert-True (-not $state.done) 'still no verdict'
Assert-Equal 'no_offer' $state.result 'result stays no_offer'
$err = Update-KitSignalingProbeState -State $state -MessageText '{"ackid":9,"error":"peerRemoved"}' -PeerId $peer
Assert-Equal 'peerRemoved' $state.lastError 'server error recorded'
Write-TestPass 'noise messages are ignored safely'

# Fake session factory: replays a scripted message list, records sends/close.
function New-FakeSession {
    param([string[]] $Messages, [switch] $FailConnect, [switch] $CloseAfterMessages)
    $fake = [pscustomobject]@{
        Queue        = [System.Collections.Generic.Queue[string]]::new()
        Sent         = [System.Collections.Generic.List[string]]::new()
        Closed       = $false
        Connected    = $false
        FailConnect  = [bool]$FailConnect
        CloseAfter   = [bool]$CloseAfterMessages
        ReceiveCalls = 0
    }
    foreach ($m in @($Messages)) { $fake.Queue.Enqueue($m) }
    $fake | Add-Member -MemberType ScriptMethod -Name Connect -Value {
        param($timeoutMs)
        if ($this.FailConnect) { throw [System.Net.WebSockets.WebSocketException]::new('Unable to connect to the remote server') }
        $this.Connected = $true
    }
    $fake | Add-Member -MemberType ScriptMethod -Name Receive -Value {
        param($timeoutMs)
        $this.ReceiveCalls++
        if ($this.Queue.Count -gt 0) { return $this.Queue.Dequeue() }
        if ($this.CloseAfter) { return $null }
        # Emulate a silent server: block for the remaining budget, then time out.
        Start-Sleep -Milliseconds ([Math]::Min([int]$timeoutMs, 1500))
        return $null
    }
    $fake | Add-Member -MemberType ScriptMethod -Name Send -Value { param($text, $timeoutMs) $this.Sent.Add([string]$text) }
    $fake | Add-Member -MemberType ScriptMethod -Name Close -Value { $this.Closed = $true }
    return $fake
}

# Test 4: Test-KitSignalingOffer with a healthy fake -> ready, acks sent, socket closed
$fake = New-FakeSession -Messages @($msgSelfInfo, $msgServerInfo, $msgOfferVideo)
$r = Test-KitSignalingOffer -HostName '127.0.0.1' -Port 49100 -TimeoutSec 5 -PeerId $peer -SessionFactory { param($uri) $fake }
Assert-True $r.ready 'healthy fake -> ready'
Assert-Equal 'checked' $r.probe 'probe checked'
Assert-Equal 'offer_with_video' $r.result 'result'
Assert-Equal 3 $fake.Sent.Count 'three acks sent'
Assert-True $fake.Closed 'session closed after verdict'
Assert-True ($r.uri -like 'ws://127.0.0.1:49100/sign_in?peer_id=peer-*&version=2') 'sign_in uri shape'
Write-TestPass 'Test-KitSignalingOffer ready path'

# Test 5: signalling alive but no offer (the 假活 Kit) -> no_offer within timeout, reason names peer_info
$fake = New-FakeSession -Messages @($msgSelfInfo, $msgServerInfo, $msgHeartbeat)
$r = Test-KitSignalingOffer -HostName '127.0.0.1' -Port 49100 -TimeoutSec 1 -PeerId $peer -SessionFactory { param($uri) $fake }
Assert-True (-not $r.ready) 'no offer -> not ready'
Assert-Equal 'no_offer' $r.result 'result no_offer'
Assert-True ($r.reason -like 'no_offer_within_1s*peer_info received*') "reason explains signalling-alive ($($r.reason))"
Assert-True $r.peerInfoSeen 'peer_info seen'
Assert-True $fake.Closed 'session closed on timeout'
Write-TestPass 'Test-KitSignalingOffer silent media layer -> no_offer'

# Test 6: server closes before an offer -> not ready, reason server_closed_before_offer
$fake = New-FakeSession -Messages @($msgSelfInfo) -CloseAfterMessages
$r = Test-KitSignalingOffer -HostName '127.0.0.1' -Port 49100 -TimeoutSec 5 -PeerId $peer -SessionFactory { param($uri) $fake }
Assert-True (-not $r.ready) 'server close -> not ready'
Assert-Equal 'server_closed_before_offer' $r.reason 'reason server_closed_before_offer'
Write-TestPass 'Test-KitSignalingOffer server close'

# Test 7: connect refused -> probe=connect_failed
$fake = New-FakeSession -Messages @() -FailConnect
$r = Test-KitSignalingOffer -HostName '127.0.0.1' -Port 49100 -TimeoutSec 5 -PeerId $peer -SessionFactory { param($uri) $fake }
Assert-True (-not $r.ready) 'connect failed -> not ready'
Assert-Equal 'connect_failed' $r.probe 'probe connect_failed'
Assert-True ($r.reason -like 'connect_failed:*') 'reason prefixed'
Write-TestPass 'Test-KitSignalingOffer connect failure'

# Test 8: ClientWebSocket unavailable -> probe=unavailable, never touches the factory
$touched = $false
$r = Test-KitSignalingOffer -HostName '127.0.0.1' -Port 49100 -TimeoutSec 5 -SessionFactory { param($uri) $script:touched = $true; throw 'must not be called' } -AvailabilityProbe { $false }
Assert-Equal 'unavailable' $r.probe 'probe unavailable'
Assert-True (-not $r.ready) 'unavailable is not ready'
Assert-True (-not $touched) 'factory untouched'
Write-TestPass 'Test-KitSignalingOffer unavailable host'

# Test 9: real ClientWebSocket session against a closed port -> connect_failed quickly (no fake)
$r = Test-KitSignalingOffer -HostName '127.0.0.1' -Port 1 -TimeoutSec 5
Assert-Equal 'connect_failed' $r.probe 'closed port -> connect_failed'
Write-TestPass 'real session connect refusal'

# Gate orchestration ------------------------------------------------------------
function New-ProbeResult { param([bool] $Ready, [string] $Probe = 'checked', [string] $Result = 'no_offer', [string] $Reason = 'x')
    [pscustomobject]@{ ready = $Ready; probe = $Probe; result = $Result; reason = $Reason; elapsedMs = 7; messageCount = 2; serverPeerId = 1 } }

# Test 10: ready on first probe -> no restart
$restarts = 0; $logs = @()
$g = Invoke-KitMediaReadinessGate -Attempts 2 -ProbeFn { param($a) New-ProbeResult -Ready $true -Result 'offer_with_video' -Reason '' } -RestartFn { param($a) $script:restarts++; $true } -LogFn { param($t, $m) $script:logs += "$t|$m" }
Assert-True $g.ready 'gate ready'
Assert-Equal 1 $g.attempts 'one attempt'
Assert-Equal 0 $restarts 'no restart'
Assert-True (@($logs | Where-Object { $_ -like 'ok|*passed on attempt 1*' }).Count -eq 1) 'ok log written'
Write-TestPass 'gate passes without restart'

# Test 11: fail, restart, pass -> ready after 2 attempts with exactly one restart
$restarts = 0; $logs = @(); $script:probeCalls = 0
$g = Invoke-KitMediaReadinessGate -Attempts 2 -ProbeFn { param($a) $script:probeCalls++; if ($a -eq 1) { New-ProbeResult -Ready $false } else { New-ProbeResult -Ready $true -Result 'offer_with_video' -Reason '' } } -RestartFn { param($a) $script:restarts++; $true } -LogFn { param($t, $m) $script:logs += "$t|$m" }
Assert-True $g.ready 'ready after relaunch'
Assert-Equal 2 $g.attempts 'two attempts'
Assert-Equal 1 $restarts 'one restart'
Assert-Equal 2 $probeCalls 'two probes'
Assert-True (@($logs | Where-Object { $_ -like 'fail|*attempt 1/2*' }).Count -eq 1) 'first failure logged'
Assert-True (@($logs | Where-Object { $_ -like 'fix|*relaunching*' }).Count -eq 1) 'relaunch logged'
Write-TestPass 'gate recovers with one relaunch'

# Test 12: fail twice -> not ready, reason media_offer_missing, only Attempts-1 restarts
$restarts = 0
$g = Invoke-KitMediaReadinessGate -Attempts 2 -ProbeFn { param($a) New-ProbeResult -Ready $false } -RestartFn { param($a) $script:restarts++; $true }
Assert-True (-not $g.ready) 'not ready'
Assert-Equal 'media_offer_missing' $g.reason 'reason'
Assert-Equal 1 $restarts 'restart count bounded by attempts'
Assert-Equal 2 @($g.results).Count 'both probe results kept'
Write-TestPass 'gate fails closed after bounded attempts'

# Test 13: restart failure aborts the gate without a second probe
$script:probeCalls = 0
$g = Invoke-KitMediaReadinessGate -Attempts 3 -ProbeFn { param($a) $script:probeCalls++; New-ProbeResult -Ready $false } -RestartFn { param($a) $false }
Assert-True (-not $g.ready) 'not ready'
Assert-Equal 'restart_failed' $g.reason 'reason restart_failed'
Assert-Equal 1 $probeCalls 'no probe after failed restart'
Write-TestPass 'gate aborts when relaunch fails'

# Test 14: unavailable probe -> advisory pass, no restart
$restarts = 0; $logs = @()
$g = Invoke-KitMediaReadinessGate -Attempts 2 -ProbeFn { param($a) New-ProbeResult -Ready $false -Probe 'unavailable' -Reason 'client_websocket_unavailable' } -RestartFn { param($a) $script:restarts++; $true } -LogFn { param($t, $m) $script:logs += "$t|$m" }
Assert-True $g.ready 'advisory ready'
Assert-True $g.advisory 'advisory flag'
Assert-Equal 0 $restarts 'no restart'
Assert-True (@($logs | Where-Object { $_ -like 'warn|*advisory*' }).Count -eq 1) 'warn logged'
Write-TestPass 'gate degrades to advisory when the probe cannot run'

Write-Host 'test-kit-signaling-probe.ps1: all tests passed'
