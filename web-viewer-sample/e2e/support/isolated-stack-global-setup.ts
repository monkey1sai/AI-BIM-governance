import { execFileSync } from "node:child_process";
import { request, type FullConfig } from "@playwright/test";
import {
  assertIsolatedWorktreeClean,
  assertIsolatedBackendProcessSnapshot,
  beginIsolatedEvidenceInvocation,
  requireIsolatedStackConfig,
  requireIsolatedEvidenceGeneration,
  requireReal,
  type IsolatedBackendProcessRecord,
  type IsolatedBackendProcessSnapshot,
  type IsolatedStackConfig,
} from "./isolated-stack";

const WINDOWS_BACKEND_SNAPSHOT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$expectedPid = [int]$env:E2E_ISOLATED_SNAPSHOT_EXPECTED_PID
$port = [int]$env:E2E_ISOLATED_SNAPSHOT_PORT
$entrypoint = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($env:E2E_ISOLATED_SNAPSHOT_ENTRYPOINT_B64)
)
function Get-CreationIdentity($value) {
  if ($value -is [datetime]) { return $value.ToUniversalTime().ToString('o') }
  return [string]$value
}
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$expectedPid" -ErrorAction Stop
if ($null -eq $process) { throw "manifest process $expectedPid is not running" }
if (-not ([string]$process.CommandLine).Contains($entrypoint, [StringComparison]::OrdinalIgnoreCase)) {
  throw "manifest process $expectedPid no longer contains its exact entrypoint"
}
$listeners = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object {
  [int]$_.LocalPort -eq $port -and [string]$_.State -eq 'Listen'
})
if ($listeners.Count -ne 1) { throw "expected exactly one listener on port $port" }
$listenerPid = [int]$listeners[0].OwningProcess
$lineage = [System.Collections.Generic.List[object]]::new()
$currentPid = $listenerPid
foreach ($depth in 0..31) {
  if ($currentPid -le 0) { break }
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$currentPid" -ErrorAction Stop
  if ($null -eq $current) { throw "listener lineage process $currentPid is not running" }
  $parentPid = [int]$current.ParentProcessId
  $lineage.Add([ordered]@{
    pid = [int]$current.ProcessId
    parent_pid = $parentPid
    creation_identity = Get-CreationIdentity $current.CreationDate
  })
  if ($currentPid -eq $expectedPid -or $parentPid -eq $currentPid) { break }
  $currentPid = $parentPid
}
$processAgain = Get-CimInstance Win32_Process -Filter "ProcessId=$expectedPid" -ErrorAction Stop
if ($null -eq $processAgain -or
    [string]$processAgain.CommandLine -cne [string]$process.CommandLine -or
    (Get-CreationIdentity $processAgain.CreationDate) -cne (Get-CreationIdentity $process.CreationDate) -or
    [string]$processAgain.ExecutablePath -cne [string]$process.ExecutablePath) {
  throw "manifest process $expectedPid changed during identity verification"
}
$listenersAgain = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object {
  [int]$_.LocalPort -eq $port -and [string]$_.State -eq 'Listen'
})
if ($listenersAgain.Count -ne 1 -or [int]$listenersAgain[0].OwningProcess -ne $listenerPid) {
  throw "listener on port $port changed during identity verification"
}
foreach ($node in $lineage) {
  $currentAgain = Get-CimInstance Win32_Process -Filter "ProcessId=$($node.pid)" -ErrorAction Stop
  if ($null -eq $currentAgain -or
      [int]$currentAgain.ParentProcessId -ne [int]$node.parent_pid -or
      (Get-CreationIdentity $currentAgain.CreationDate) -cne [string]$node.creation_identity) {
    throw "listener lineage process $($node.pid) changed during identity verification"
  }
}
[ordered]@{
  process = [ordered]@{
    pid = [int]$process.ProcessId
    command_line = [string]$process.CommandLine
    creation_identity = Get-CreationIdentity $process.CreationDate
    executable_path = [string]$process.ExecutablePath
  }
  listener_pid = $listenerPid
  listener_lineage = @($lineage)
} | ConvertTo-Json -Depth 4 -Compress
`;

export function captureWindowsBackendSnapshot(
  isolated: IsolatedStackConfig,
  role: IsolatedBackendProcessRecord["role"],
): IsolatedBackendProcessSnapshot {
  requireReal(process.platform === "win32", "isolated backend identity verification requires Windows");
  const processRecord = isolated.manifest.processes.find(candidate => candidate.role === role);
  requireReal(processRecord, `manifest is missing the ${role} process identity`);
  const output = execFileSync("pwsh", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    WINDOWS_BACKEND_SNAPSHOT_SCRIPT,
  ], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      E2E_ISOLATED_SNAPSHOT_EXPECTED_PID: String(processRecord.pid),
      E2E_ISOLATED_SNAPSHOT_PORT: String(isolated.manifest.ports[role]),
      E2E_ISOLATED_SNAPSHOT_ENTRYPOINT_B64: Buffer.from(processRecord.entrypoint, "utf8").toString("base64"),
    },
  });
  return JSON.parse(output) as IsolatedBackendProcessSnapshot;
}

export function assertLiveIsolatedBackendOwnership(isolated: IsolatedStackConfig): void {
  for (const role of ["governance", "coordinator"] as const) {
    assertIsolatedBackendProcessSnapshot(isolated.manifest, role, captureWindowsBackendSnapshot(isolated, role));
  }
}

export default async function isolatedStackGlobalSetup(fullConfig: FullConfig): Promise<void> {
  if (process.env.E2E_REQUIRE_REAL !== "1") return;
  const isolated = requireIsolatedStackConfig();
  const invocationGeneration = requireIsolatedEvidenceGeneration(fullConfig.metadata);
  const finishInvocationSetup = beginIsolatedEvidenceInvocation(isolated, invocationGeneration);
  let setupSucceeded = false;
  try {
    assertIsolatedWorktreeClean(isolated);
    const client = await request.newContext();
    try {
      const coordinator = await client.get(`${isolated.coordinatorBaseUrl}/health`);
      if (!coordinator.ok()) {
        throw new Error(`coordinator probe failed: ${coordinator.status()} ${isolated.coordinatorBaseUrl}/health`);
      }
      assertLiveIsolatedBackendOwnership(isolated);
    } finally {
      await client.dispose();
    }
    setupSucceeded = true;
  } finally {
    finishInvocationSetup(setupSucceeded);
  }
}
