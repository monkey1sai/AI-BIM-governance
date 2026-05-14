[CmdletBinding()]
param(
    [string] $CoordinatorUrl = "http://127.0.0.1:8004",
    [int] $TimeoutSeconds = 15,
    [string] $EvidencePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'lib\smoke-evidence.ps1')

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$SocketClientModule = Join-Path $RepoRoot "web-viewer-sample\node_modules\socket.io-client\build\cjs\index.js"
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $RepoRoot 'docs\verification\2026-05-14-stabilize-demo-runtime-readiness\smoke-review-socket-evidence.json'
}

$Record = New-SmokeEvidenceRecord -Command $MyInvocation.MyCommand.Path -Cwd (Get-Location).Path -Context @{
    coordinator_url    = $CoordinatorUrl
    socket_client_path = $SocketClientModule
}

function Save-Evidence {
    Save-SmokeEvidence -Record $Record -Path $EvidencePath | Out-Null
    Write-SmokeTierSummary -Record $Record
    Write-Host "[smoke] evidence: $EvidencePath"
}

if (-not (Test-Path -LiteralPath $SocketClientModule)) {
    Add-SmokeTier -Record $Record -Tier 'socket_io_collaboration' -Status 'blocked' -Owner 'bim-review-coordinator' `
        -Blocker "socket.io-client not found at $SocketClientModule" `
        -NextCommand "Run 'npm install' in web-viewer-sample, then rerun this script"
    Save-Evidence
    throw "socket.io-client not found at $SocketClientModule. Run npm install in web-viewer-sample first."
}

$env:COORDINATOR_URL = $CoordinatorUrl
$env:SOCKET_IO_CLIENT_MODULE = $SocketClientModule
$env:SOCKET_SMOKE_TIMEOUT_MS = [string]($TimeoutSeconds * 1000)

$script = @'
const { io } = require(process.env.SOCKET_IO_CLIENT_MODULE);

const baseUrl = process.env.COORDINATOR_URL;
const timeoutMs = Number(process.env.SOCKET_SMOKE_TIMEOUT_MS || "15000");

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

function connectClient(name) {
  const socket = io(`${baseUrl}/review`, {
    transports: ["websocket", "polling"],
    reconnection: false,
  });
  return withTimeout(
    new Promise((resolve, reject) => {
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    }),
    `${name} connect`,
  );
}

function emitAck(socket, event, payload) {
  return withTimeout(
    new Promise((resolve) => {
      socket.emit(event, payload, (ack) => resolve(ack));
    }),
    `${event} ack`,
  );
}

function waitFor(socket, event, predicate = () => true) {
  return withTimeout(
    new Promise((resolve) => {
      const handler = (payload) => {
        if (predicate(payload)) {
          socket.off(event, handler);
          resolve(payload);
        }
      };
      socket.on(event, handler);
    }),
    `${event} broadcast`,
  );
}

(async () => {
  const session = await postJson("/api/review-sessions", {
    project_id: "project_demo_001",
    model_version_id: "version_demo_001",
    created_by: "socket_smoke_user_a",
    mode: "single_kit_shared_state",
    options: { auto_allocate_kit: true },
  });

  const clientA = await connectClient("clientA");
  const clientB = await connectClient("clientB");

  try {
    const joinedA = emitAck(clientA, "joinSession", {
      session_id: session.session_id,
      user_id: "socket_smoke_user_a",
      display_name: "Socket Smoke A",
    });
    const joinedB = emitAck(clientB, "joinSession", {
      session_id: session.session_id,
      user_id: "socket_smoke_user_b",
      display_name: "Socket Smoke B",
    });
    const presenceForB = waitFor(clientB, "presenceUpdated", (payload) => payload?.participants?.length >= 2);
    const [ackA, ackB] = await Promise.all([joinedA, joinedB]);
    if (!ackA?.ok || !ackB?.ok) throw new Error(`joinSession ack failed: ${JSON.stringify({ ackA, ackB })}`);
    await presenceForB;

    const highlightSeenByB = waitFor(clientB, "highlightRequest", (payload) => payload?.issue_id === "ISSUE-DEMO-001");
    const highlightAck = await emitAck(clientA, "highlightRequest", {
      session_id: session.session_id,
      actor_id: "socket_smoke_user_a",
      issue_id: "ISSUE-DEMO-001",
      items: [
        {
          prim_path: "/World",
          ifc_guid: "2VJ3sK9L000fake001",
          color: [1, 0, 0, 1],
          label: "Socket smoke：多人高亮廣播",
          source: "socket_smoke",
        },
      ],
    });
    if (!highlightAck?.ok) throw new Error(`highlightRequest ack failed: ${JSON.stringify(highlightAck)}`);
    await highlightSeenByB;

    const selectionSeenByB = waitFor(clientB, "selectionUpdate", (payload) => payload?.selected_paths?.includes("/World"));
    const selectionAck = await emitAck(clientA, "selectionUpdate", {
      session_id: session.session_id,
      actor_id: "socket_smoke_user_a",
      selected_paths: ["/World"],
    });
    if (!selectionAck?.ok) throw new Error(`selectionUpdate ack failed: ${JSON.stringify(selectionAck)}`);
    await selectionSeenByB;

    const annotationSeenByB = waitFor(clientB, "annotationCreated", (payload) => payload?.saved?.session_id === session.session_id);
    const annotationAck = await emitAck(clientA, "annotationCreate", {
      session_id: session.session_id,
      actor_id: "socket_smoke_user_a",
      text: "Socket smoke annotation",
      target: {
        usd_prim_path: "/World",
        ifc_guid: "2VJ3sK9L000fake001",
      },
    });
    if (!annotationAck?.ok) throw new Error(`annotationCreate ack failed: ${JSON.stringify(annotationAck)}`);
    await annotationSeenByB;

    const heartbeatAck = await emitAck(clientA, "heartbeat", {
      session_id: session.session_id,
      actor_id: "socket_smoke_user_a",
    });
    if (!heartbeatAck?.ok) throw new Error(`heartbeat ack failed: ${JSON.stringify(heartbeatAck)}`);

    console.log(`[socket-smoke] passed session=${session.session_id}`);
  } finally {
    clientA.disconnect();
    clientB.disconnect();
  }
})().catch((error) => {
  console.error(`[socket-smoke] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
'@

$nodeProcess = $null
$nodeOutput = $null
try {
    $nodeOutput = $script | & node 2>&1
    $exitCode = $LASTEXITCODE
    $output = ($nodeOutput | Out-String).Trim()
    if ($exitCode -eq 0) {
        $sessionMatch = [regex]::Match($output, 'session=([A-Za-z0-9_]+)')
        $sessionId = if ($sessionMatch.Success) { $sessionMatch.Groups[1].Value } else { $null }
        Add-SmokeTier -Record $Record -Tier 'socket_io_collaboration' -Status 'passed' -Owner 'bim-review-coordinator' `
            -Ids @{ session_id = $sessionId } `
            -Detail @{
                events_verified = @('joinSession', 'presenceUpdated', 'highlightRequest', 'selectionUpdate', 'annotationCreate', 'heartbeat')
                note            = 'Socket.IO success MUST NOT be treated as WebRTC video, DataChannel stage load, or browser visual success.'
            }
    } else {
        Add-SmokeTier -Record $Record -Tier 'socket_io_collaboration' -Status 'failed' -Owner 'bim-review-coordinator' `
            -Blocker $output `
            -NextCommand 'Inspect bim-review-coordinator Socket.IO handlers and rerun'
        Save-Evidence
        throw "Socket.IO smoke failed: $output"
    }
} catch {
    if (-not ($Record.tiers | Where-Object { $_.tier -eq 'socket_io_collaboration' })) {
        Add-SmokeTier -Record $Record -Tier 'socket_io_collaboration' -Status 'failed' -Owner 'bim-review-coordinator' `
            -Blocker $_.Exception.Message
    }
    Save-Evidence
    throw
}

# Explicit reminder tiers — Socket.IO success does NOT imply WebRTC or browser
Add-SmokeTier -Record $Record -Tier 'kit_webrtc_readiness' -Status 'not_observed' -Owner 'bim-streaming-server' `
    -Blocker 'This socket smoke does not probe WebRTC video, DataChannel stage load, or Kit signaling' `
    -NextCommand 'Run scripts/smoke-review-session.ps1 or scripts/run-single-kit-demo.ps1 for Kit readiness evidence'

Add-SmokeTier -Record $Record -Tier 'browser_visual_evidence' -Status 'not_observed' -Owner 'web-viewer-sample' `
    -Blocker 'This socket smoke does not open the viewer or capture screenshots' `
    -NextCommand 'Manually open http://127.0.0.1:5173 and capture viewport evidence for the relevant session'

Save-Evidence
