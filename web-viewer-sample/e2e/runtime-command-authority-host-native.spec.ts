import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const enabled = process.env.E2E_HOST_NATIVE_RUNTIME_AUTHORITY === "1";
const coordinatorBase = process.env.E2E_COORDINATOR_BASE_URL || "";
const kitSignalPort = Number(process.env.E2E_KIT_SIGNAL_PORT || "0");
const kitMediaPort = Number(process.env.E2E_KIT_MEDIA_PORT || "0");
const stageUrlA = process.env.E2E_STAGE_URL_A || "";
const stageUrlB = process.env.E2E_STAGE_URL_B || "";
const runtimeId = process.env.E2E_KIT_RUNTIME_ID || "kit_runtime_authority_host_native";
const runtimePid = Number(process.env.E2E_KIT_PID || "0");
const controlDir = process.env.E2E_RUNTIME_AUTHORITY_CONTROL_DIR || "";
const evidenceRunId = process.env.E2E_RUNTIME_AUTHORITY_RUN_ID || "";
const controlNonce = process.env.E2E_RUNTIME_AUTHORITY_CONTROL_NONCE || "";
const originMainSha = process.env.E2E_ORIGIN_MAIN_SHA || "";
const denialStageStabilityMs = 750;
const processLogPaths = (process.env.E2E_RUNTIME_PROCESS_LOGS || "")
  .split(";")
  .map((value) => value.trim())
  .filter(Boolean);

// Keep this aligned with the pinned Playwright 1.61.1 Chromium defaults.
const playwrightChromiumDisabledFeatures = [
  "AvoidUnnecessaryBeforeUnloadCheckSync",
  "BoundaryEventDispatchTracksNodeRemoval",
  "DestroyProfileOnBrowserClose",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "HttpsUpgrades",
  "LensOverlay",
  "MediaRouter",
  "PaintHolding",
  "ThirdPartyStoragePartitioning",
  "Translate",
  "AutoDeElevate",
  "RenderDocument",
  "OptimizationHints",
  "msForceBrowserSignIn",
  "msEdgeUpdateLaunchServicesPreferredVersion",
];
const playwrightDisableFeaturesArg =
  `--disable-features=${playwrightChromiumDisabledFeatures.join(",")}`;
const hostNativeDisableFeaturesArg = `--disable-features=${[
  ...playwrightChromiumDisabledFeatures,
  "LocalNetworkAccessChecksWebSockets",
].join(",")}`;

test.use({
  trace: "off",
  screenshot: "off",
  video: "off",
  launchOptions: {
    // Headless Chromium cannot grant the localhost WebSocket LNA prompt.
    ignoreDefaultArgs: [playwrightDisableFeaturesArg],
    args: [hostNativeDisableFeaturesArg],
  },
});
test.skip(!enabled, "opt-in Windows host-native Kit/GPU runtime authority evidence");

type SafePayload = {
  result?: string;
  reason?: string;
  request_id?: string;
  rejection_id?: string;
  session_id?: string;
  retryable?: boolean;
  runtime_state?: string;
  detail_code?: string;
  url?: string;
  binding_revision_id?: string;
  prim_path?: string;
  loading_state?: string;
};

type SafeEvent = { event_type: string; payload: SafePayload };

type ControlMarker = {
  schema_version: "runtime-command-authority-control/v1";
  run_id: string;
  request_id: string;
  control_nonce: string;
  coordinator_stopped?: boolean;
};

type Lease = {
  lease_id: string;
  lease_token: string;
  expires_at: string;
};

type SessionFixture = {
  sessionId: string;
  artifactId: string;
  userCarrier: string;
  lease: Lease;
};

type StageAuthorization = {
  stage_binding_authorization_id: string;
  binding_revision_id: string;
  stage_composition: {
    primary: {
      artifact_id: string;
      role: "primary";
      load_order: number;
      usdc_url: string;
    };
    secondary_layers: Array<Record<string, unknown>>;
  };
};

async function apiJson<T>(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${coordinatorBase}${path}`, {
    method: init.method || "GET",
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers || {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) {
    throw new Error(`coordinator request failed with status ${response.status}`);
  }
  return await response.json() as T;
}

async function createSession(label: string, stageUrl: string): Promise<SessionFixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const artifactId = `artifact_host_${label}_${suffix}`;
  const created = await apiJson<{ session_id: string }>("/api/review-sessions", {
    method: "POST",
    body: {
      project_id: `project_host_${label}_${suffix}`,
      model_version_id: `version_host_${label}_${suffix}`,
      created_by: "host_native_authority_e2e",
      routing_policy: "same_instance",
      artifact_bindings: [{
        artifact_group_id: `group_host_${label}_${suffix}`,
        artifact_id: artifactId,
        artifact_role: "derived",
        url: stageUrl,
        mapping_url: null,
        load_order: 0,
        ready_status: "ready",
      }],
    },
  });
  const userCarrier = `host_native_user_${randomUUID()}`;
  const lease = await apiJson<Lease>(
    `/api/review-sessions/${encodeURIComponent(created.session_id)}/viewer-leases/claim`,
    {
      method: "POST",
      headers: { "X-User-Token": userCarrier },
      body: {
        viewer_id: `host_native_${label}_${suffix}`,
        requested_role: "primary",
        client_nonce: `host-native:${label}:${suffix}`,
      },
    },
  );
  return { sessionId: created.session_id, artifactId, userCarrier, lease };
}

async function preauthorize(fixture: SessionFixture): Promise<StageAuthorization> {
  return apiJson<StageAuthorization>(
    `/api/review-sessions/${encodeURIComponent(fixture.sessionId)}/stage-binding`,
    {
      method: "POST",
      headers: {
        "X-User-Token": fixture.userCarrier,
        "X-Viewer-Lease-Token": fixture.lease.lease_token,
      },
      body: {
        source_client_id: fixture.lease.lease_id,
        role: "primary",
        artifacts: [{ artifact_id: fixture.artifactId, role: "primary", load_order: 0 }],
      },
    },
  );
}

async function connectProbe(page: Page): Promise<void> {
  await page.route("**/e2e-host-native-runtime-authority", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0;background:#07111f;color:#e6f7ff;font:16px monospace">
        <video id="remote-video" autoplay muted playsinline style="width:100vw;height:70vh;object-fit:contain;background:#000"></video>
        <audio id="remote-audio" autoplay></audio>
        <pre id="probe-status" style="white-space:pre-wrap;padding:16px"></pre>
      </body></html>`,
    });
  });
  await page.goto("/e2e-host-native-runtime-authority");
  await page.evaluate(async ({ signalPort, mediaPort }) => {
    const modulePath = "/src/harness/streamer.ts";
    const { getStreamer } = await import(/* @vite-ignore */ modulePath) as {
      getStreamer: () => {
        connect: (props: unknown) => Promise<unknown>;
        sendMessage: (message: unknown) => Promise<unknown>;
        terminate: (force?: boolean) => unknown;
      };
    };
    const streamer = getStreamer();
    const probe = {
      streamer,
      starts: [] as Array<{ action?: string; status?: string }>,
      events: [] as SafeEvent[],
      stats: [] as Array<{ width?: number; height?: number }>,
    };
    const safeKeys = [
      "result",
      "reason",
      "request_id",
      "rejection_id",
      "session_id",
      "retryable",
      "runtime_state",
      "detail_code",
      "url",
      "binding_revision_id",
      "prim_path",
      "loading_state",
    ] as const;
    (globalThis as typeof globalThis & { __HOST_NATIVE_AUTHORITY_PROBE__?: typeof probe })
      .__HOST_NATIVE_AUTHORITY_PROBE__ = probe;

    await streamer.connect({
      streamSource: "direct",
      streamConfig: {
        videoElementId: "remote-video",
        audioElementId: "remote-audio",
        server: "127.0.0.1",
        signalingServer: "127.0.0.1",
        signalingPort: signalPort,
        mediaServer: "127.0.0.1",
        mediaPort,
        authenticate: false,
        maxReconnects: 2,
        nativeTouchEvents: true,
        onStart: (message: { action?: string; status?: string }) => {
          probe.starts.push({ action: message?.action, status: message?.status });
        },
        onStreamStats: (message: {
          stats?: { streamingResolutionWidth?: number; streamingResolutionHeight?: number };
        }) => {
          probe.stats.push({
            width: message?.stats?.streamingResolutionWidth,
            height: message?.stats?.streamingResolutionHeight,
          });
        },
        onCustomEvent: (message: { event_type?: string; payload?: unknown }) => {
          if (!message || typeof message.event_type !== "string") return;
          const raw = message.payload && typeof message.payload === "object"
            ? message.payload as Record<string, unknown>
            : {};
          const payload: SafePayload = {};
          for (const key of safeKeys) {
            const value = raw[key];
            if (typeof value === "string" || typeof value === "boolean") {
              (payload as Record<string, unknown>)[key] = value;
            }
          }
          probe.events.push({ event_type: message.event_type, payload });
        },
      },
    });
  }, { signalPort: kitSignalPort, mediaPort: kitMediaPort });

  await page.waitForFunction(() => {
    const probe = (globalThis as typeof globalThis & {
      __HOST_NATIVE_AUTHORITY_PROBE__?: { starts: Array<{ status?: string }> };
    }).__HOST_NATIVE_AUTHORITY_PROBE__;
    return probe?.starts.some((entry) => entry.status === "success") === true;
  }, undefined, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const video = document.getElementById("remote-video") as HTMLVideoElement | null;
    return Boolean(video && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2);
  }, undefined, { timeout: 60_000 });
}

async function sendCommand(page: Page, eventType: string, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ eventType: nextEventType, payload: nextPayload }) => {
    const probe = (globalThis as typeof globalThis & {
      __HOST_NATIVE_AUTHORITY_PROBE__?: {
        streamer: { sendMessage: (message: unknown) => Promise<unknown> };
      };
    }).__HOST_NATIVE_AUTHORITY_PROBE__;
    if (!probe) throw new Error("host-native probe is unavailable");
    // Mirror production semantics: Window.tsx sends with `void AppStream.sendMessage(...)`
    // and never awaits the returned promise. On the host-native WebRTC path that promise
    // does not settle, so awaiting it here hung every run at the FIRST command for the
    // full 300s test timeout while video frames were already arriving - the harness, not
    // the product, was the thing that was broken. Delivery is still verified: every caller
    // waits on the observed response event, not on this promise.
    void probe.streamer.sendMessage({ event_type: nextEventType, payload: nextPayload });
  }, { eventType, payload });
}

async function safeEvents(page: Page, requestId?: string): Promise<SafeEvent[]> {
  return page.evaluate((expectedRequestId) => {
    const probe = (globalThis as typeof globalThis & {
      __HOST_NATIVE_AUTHORITY_PROBE__?: { events: SafeEvent[] };
    }).__HOST_NATIVE_AUTHORITY_PROBE__;
    const events = probe?.events || [];
    return expectedRequestId
      ? events.filter((event) => event.payload.request_id === expectedRequestId)
      : events;
  }, requestId);
}

function controlMarkerPath(name: string): string {
  if (!controlDir) throw new Error("E2E_RUNTIME_AUTHORITY_CONTROL_DIR is required");
  return join(controlDir, name);
}

async function writeControlMarker(name: string, marker: ControlMarker): Promise<void> {
  await writeFile(controlMarkerPath(name), `${JSON.stringify(marker)}\n`, { encoding: "utf8", flag: "wx" });
}

async function waitForControlMarker(
  name: string,
  requestId: string,
  timeoutMs = 90_000,
): Promise<ControlMarker> {
  const deadline = Date.now() + timeoutMs;
  do {
    const marker = await readFile(controlMarkerPath(name), "utf8")
      .then((content) => JSON.parse(content) as ControlMarker)
      .catch(() => null);
    if (
      marker?.schema_version === "runtime-command-authority-control/v1"
      && marker.run_id === evidenceRunId
      && marker.request_id === requestId
      && marker.control_nonce === controlNonce
    ) return marker;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for runner marker ${name}`);
}

async function waitForEvent(
  page: Page,
  requestId: string,
  eventTypes: string[],
  timeout = 30_000,
): Promise<SafeEvent> {
  await page.waitForFunction(
    ({ expectedRequestId, expectedEventTypes }) => {
      const probe = (globalThis as typeof globalThis & {
        __HOST_NATIVE_AUTHORITY_PROBE__?: { events: SafeEvent[] };
      }).__HOST_NATIVE_AUTHORITY_PROBE__;
      return probe?.events.some((event) => (
        event.payload.request_id === expectedRequestId
        && expectedEventTypes.includes(event.event_type)
      )) === true;
    },
    { expectedRequestId: requestId, expectedEventTypes: eventTypes },
    { timeout },
  );
  const events = await safeEvents(page, requestId);
  const match = events.find((event) => eventTypes.includes(event.event_type));
  if (!match) throw new Error(`terminal not found for ${requestId}`);
  return match;
}

async function observedStageUrl(page: Page): Promise<string> {
  const before = (await safeEvents(page)).filter((event) => event.event_type === "loadingStateResponse").length;
  await sendCommand(page, "loadingStateQuery", {});
  await page.waitForFunction((previousCount) => {
    const probe = (globalThis as typeof globalThis & {
      __HOST_NATIVE_AUTHORITY_PROBE__?: { events: SafeEvent[] };
    }).__HOST_NATIVE_AUTHORITY_PROBE__;
    return (probe?.events.filter((event) => event.event_type === "loadingStateResponse").length || 0) > previousCount;
  }, before, { timeout: 15_000 });
  const responses = (await safeEvents(page)).filter((event) => event.event_type === "loadingStateResponse");
  return responses.at(-1)?.payload.url || "";
}

async function assertStageStable(
  page: Page,
  expectedStage: string,
  settleMs = denialStageStabilityMs,
): Promise<string> {
  const deadline = Date.now() + settleMs;
  let observedStage = "";
  do {
    observedStage = await observedStageUrl(page);
    expect(observedStage).toBe(expectedStage);
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) await page.waitForTimeout(Math.min(100, remainingMs));
  } while (Date.now() < deadline);
  const finalStage = await observedStageUrl(page);
  expect(finalStage).toBe(expectedStage);
  return finalStage;
}

function commandPayload(
  fixture: SessionFixture,
  requestId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    request_id: requestId,
    role: "primary",
    source_client_id: fixture.lease.lease_id,
    viewer_lease_token: fixture.lease.lease_token,
    session_id: fixture.sessionId,
    ...extra,
  };
}

function safeTerminal(event: SafeEvent): SafeEvent {
  return { event_type: event.event_type, payload: { ...event.payload } };
}

test("host-native Kit enforces runtime authority and preserves stage truth", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  expect(coordinatorBase).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(kitSignalPort).toBeGreaterThan(0);
  expect(kitMediaPort).toBeGreaterThan(0);
  expect(stageUrlA).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  expect(stageUrlB).toMatch(/^http:\/\/localhost:\d+\//);
  expect(controlDir).not.toBe("");
  expect(evidenceRunId).toMatch(/^[a-z0-9-]+$/);
  expect(controlNonce).toMatch(/^[0-9a-f]{32}$/);
  expect(originMainSha).toMatch(/^[0-9a-f]{40}$/);

  const expiring = await createSession("expired", stageUrlA);

  await connectProbe(page);
  const video = await page.locator("#remote-video").evaluate((element) => {
    const media = element as HTMLVideoElement;
    return { width: media.videoWidth, height: media.videoHeight, readyState: media.readyState };
  });
  expect(video.width).toBeGreaterThan(0);
  expect(video.height).toBeGreaterThan(0);

  // Deliberately expire this one lease before minting the leases that must remain
  // usable for the subsequent mismatch, replay, and outage checks. Probe traffic
  // does not renew a viewer lease, so creating all four at once would exhaust them.
  const denialEvidence: Record<string, {
    terminal: SafeEvent;
    observed_stage_before: string;
    observed_stage_after: string;
  }> = {};
  const expiresAtMs = Date.parse(expiring.lease.expires_at);
  const expiryWaitMs = Math.max(0, expiresAtMs - Date.now() + 1_000);
  if (expiryWaitMs > 0) await page.waitForTimeout(expiryWaitMs);
  const expiredRequestId = `host_expired_${randomUUID()}`;
  const expiredStageBefore = await observedStageUrl(page);
  await sendCommand(page, "focusPrimRequest", commandPayload(expiring, expiredRequestId, { prim_path: "/World" }));
  const expiredTerminal = await waitForEvent(page, expiredRequestId, ["commandRejected"]);
  expect(expiredTerminal.payload).toMatchObject({
    reason: "lease_invalid",
    detail_code: "lease_expired",
    runtime_state: "unchanged",
    retryable: false,
  });
  const expiredStageAfter = await assertStageStable(page, expiredStageBefore);
  expect(expiredStageAfter).toBe(expiredStageBefore);
  denialEvidence.expired = {
    terminal: safeTerminal(expiredTerminal),
    observed_stage_before: expiredStageBefore,
    observed_stage_after: expiredStageAfter,
  };

  const primary = await createSession("primary", stageUrlA);
  const wrongSession = await createSession("wrong_session", stageUrlB);
  const released = await createSession("released", stageUrlA);
  const secrets = [
    primary.userCarrier,
    primary.lease.lease_token,
    wrongSession.userCarrier,
    wrongSession.lease.lease_token,
    released.userCarrier,
    released.lease.lease_token,
    expiring.userCarrier,
    expiring.lease.lease_token,
  ];

  const initialAuthorization = await preauthorize(primary);
  const initialRequestId = `host_stage_${randomUUID()}`;
  const stageStartedAt = performance.now();
  await sendCommand(page, "loadArtifactGroupRequest", commandPayload(primary, initialRequestId, {
    stage_binding_authorization_id: initialAuthorization.stage_binding_authorization_id,
    binding_revision_id: initialAuthorization.binding_revision_id,
    stage_composition: initialAuthorization.stage_composition,
    url: initialAuthorization.stage_composition.primary.usdc_url,
  }));
  const initialTerminal = await waitForEvent(page, initialRequestId, ["openedStageResult", "commandRejected"], 60_000);
  const initialStageMs = performance.now() - stageStartedAt;
  expect(initialTerminal.event_type).toBe("openedStageResult");
  expect(initialTerminal.payload.result).toBe("success");
  const baselineStage = await observedStageUrl(page);
  expect(baselineStage).toBe(stageUrlA);

  const latencySamples: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const requestId = `host_focus_${index}_${randomUUID()}`;
    const startedAt = performance.now();
    await sendCommand(page, "focusPrimRequest", commandPayload(primary, requestId, { prim_path: "/World" }));
    const terminal = await waitForEvent(page, requestId, ["focusPrimResult", "commandRejected"]);
    expect(terminal.event_type).toBe("focusPrimResult");
    expect(terminal.payload.result).toBe("success");
    latencySamples.push(performance.now() - startedAt);
  }
  const orderedLatencies = [...latencySamples].sort((left, right) => left - right);
  const p95Ms = orderedLatencies[Math.ceil(orderedLatencies.length * 0.95) - 1];
  expect(p95Ms).toBeLessThan(500);

  const forgedRequestId = `host_forged_${randomUUID()}`;
  const forgedStageBefore = await observedStageUrl(page);
  expect(forgedStageBefore).toBe(baselineStage);
  await sendCommand(page, "focusPrimRequest", {
    ...commandPayload(primary, forgedRequestId, { prim_path: "/World" }),
    viewer_lease_token: "forged-host-native-lease",
  });
  const forgedTerminal = await waitForEvent(page, forgedRequestId, ["commandRejected"]);
  expect(forgedTerminal.payload).toMatchObject({ reason: "lease_invalid", runtime_state: "unchanged", retryable: false });
  const forgedStageAfter = await assertStageStable(page, baselineStage);
  denialEvidence.forged = {
    terminal: safeTerminal(forgedTerminal),
    observed_stage_before: forgedStageBefore,
    observed_stage_after: forgedStageAfter,
  };

  const wrongSourceRequestId = `host_wrong_source_${randomUUID()}`;
  const wrongSourceStageBefore = await observedStageUrl(page);
  expect(wrongSourceStageBefore).toBe(baselineStage);
  await sendCommand(page, "focusPrimRequest", {
    ...commandPayload(primary, wrongSourceRequestId, { prim_path: "/World" }),
    source_client_id: "viewer_lease_wrong_source_host_native",
  });
  const wrongSourceTerminal = await waitForEvent(page, wrongSourceRequestId, ["commandRejected"]);
  expect(wrongSourceTerminal.payload).toMatchObject({
    reason: "unauthorized_source_client",
    runtime_state: "unchanged",
    retryable: false,
  });
  const wrongSourceStageAfter = await assertStageStable(page, baselineStage);
  denialEvidence.wrong_source = {
    terminal: safeTerminal(wrongSourceTerminal),
    observed_stage_before: wrongSourceStageBefore,
    observed_stage_after: wrongSourceStageAfter,
  };

  await apiJson(
    `/api/review-sessions/${encodeURIComponent(released.sessionId)}/viewer-leases/${encodeURIComponent(released.lease.lease_id)}/release`,
    {
      method: "POST",
      headers: { "X-Viewer-Lease-Token": released.lease.lease_token },
      body: { reason: "host-native authority e2e" },
    },
  );
  const releasedRequestId = `host_released_${randomUUID()}`;
  const releasedStageBefore = await observedStageUrl(page);
  expect(releasedStageBefore).toBe(baselineStage);
  await sendCommand(page, "focusPrimRequest", commandPayload(released, releasedRequestId, { prim_path: "/World" }));
  const releasedTerminal = await waitForEvent(page, releasedRequestId, ["commandRejected"]);
  expect(releasedTerminal.payload).toMatchObject({
    reason: "lease_invalid",
    detail_code: "lease_released",
    runtime_state: "unchanged",
    retryable: false,
  });
  const releasedStageAfter = await assertStageStable(page, baselineStage);
  denialEvidence.released = {
    terminal: safeTerminal(releasedTerminal),
    observed_stage_before: releasedStageBefore,
    observed_stage_after: releasedStageAfter,
  };

  const wrongSessionAuthorization = await preauthorize(wrongSession);
  const wrongSessionRequestId = `host_wrong_session_${randomUUID()}`;
  const wrongSessionStageBefore = await observedStageUrl(page);
  expect(wrongSessionStageBefore).toBe(baselineStage);
  await sendCommand(page, "openStageRequest", commandPayload(primary, wrongSessionRequestId, {
    stage_binding_authorization_id: wrongSessionAuthorization.stage_binding_authorization_id,
    binding_revision_id: wrongSessionAuthorization.binding_revision_id,
    stage_composition: wrongSessionAuthorization.stage_composition,
    url: wrongSessionAuthorization.stage_composition.primary.usdc_url,
  }));
  const wrongSessionTerminal = await waitForEvent(page, wrongSessionRequestId, ["commandRejected"]);
  expect(wrongSessionTerminal.payload).toMatchObject({
    reason: "invalid_payload",
    detail_code: "stage_transaction_mismatch",
    runtime_state: "unchanged",
  });
  const wrongSessionStageAfter = await assertStageStable(page, baselineStage);
  denialEvidence.direct_open_wrong_session = {
    terminal: safeTerminal(wrongSessionTerminal),
    observed_stage_before: wrongSessionStageBefore,
    observed_stage_after: wrongSessionStageAfter,
  };

  const tamperAuthorization = await preauthorize(primary);
  const tamperedComposition = structuredClone(tamperAuthorization.stage_composition);
  tamperedComposition.primary.usdc_url = stageUrlB;
  const tamperRequestId = `host_composition_tamper_${randomUUID()}`;
  const tamperStageBefore = await observedStageUrl(page);
  expect(tamperStageBefore).toBe(baselineStage);
  await sendCommand(page, "loadArtifactGroupRequest", commandPayload(primary, tamperRequestId, {
    stage_binding_authorization_id: tamperAuthorization.stage_binding_authorization_id,
    binding_revision_id: tamperAuthorization.binding_revision_id,
    stage_composition: tamperedComposition,
    url: stageUrlB,
  }));
  const tamperTerminal = await waitForEvent(page, tamperRequestId, ["commandRejected"]);
  expect(tamperTerminal.payload).toMatchObject({
    reason: "invalid_payload",
    detail_code: "stage_transaction_mismatch",
    runtime_state: "unchanged",
  });
  const tamperStageAfter = await assertStageStable(page, baselineStage);
  denialEvidence.composition_tamper = {
    terminal: safeTerminal(tamperTerminal),
    observed_stage_before: tamperStageBefore,
    observed_stage_after: tamperStageAfter,
  };

  const replayAuthorization = await preauthorize(primary);
  const replayRequestIds = [
    `host_concurrent_replay_a_${randomUUID()}`,
    `host_concurrent_replay_b_${randomUUID()}`,
  ];
  const replayPayloads = replayRequestIds.map((requestId) => commandPayload(primary, requestId, {
      stage_binding_authorization_id: replayAuthorization.stage_binding_authorization_id,
      binding_revision_id: replayAuthorization.binding_revision_id,
      stage_composition: replayAuthorization.stage_composition,
      url: replayAuthorization.stage_composition.primary.usdc_url,
  }));
  await page.evaluate(async ({ eventType, payloads }) => {
    const probe = (globalThis as typeof globalThis & {
      __HOST_NATIVE_AUTHORITY_PROBE__?: {
        streamer: { sendMessage: (message: unknown) => Promise<unknown> };
      };
    }).__HOST_NATIVE_AUTHORITY_PROBE__;
    if (!probe) throw new Error("host-native probe is unavailable");
    await Promise.all(payloads.map((payload) => probe.streamer.sendMessage({ event_type: eventType, payload })));
  }, { eventType: "loadArtifactGroupRequest", payloads: replayPayloads });
  await page.waitForFunction((requestIds) => {
    const probe = (globalThis as typeof globalThis & {
      __HOST_NATIVE_AUTHORITY_PROBE__?: { events: SafeEvent[] };
    }).__HOST_NATIVE_AUTHORITY_PROBE__;
    return requestIds.every((requestId) => (probe?.events || []).some((event) => (
      event.payload.request_id === requestId
      && (event.event_type === "openedStageResult" || event.event_type === "commandRejected")
    )));
  }, replayRequestIds, { timeout: 60_000 });
  const replayEventsByRequest = await Promise.all(replayRequestIds.map((requestId) => safeEvents(page, requestId)));
  const replayTerminalsByRequest = replayEventsByRequest.map((events) => events.filter((event) => (
    event.event_type === "openedStageResult" || event.event_type === "commandRejected"
  )));
  for (const terminals of replayTerminalsByRequest) expect(terminals).toHaveLength(1);
  const replayEvents = replayEventsByRequest.flat();
  const replaySuccess = replayEvents.filter((event) => (
    event.event_type === "openedStageResult" && event.payload.result === "success"
  ));
  const replayRejections = replayEvents.filter((event) => event.event_type === "commandRejected");
  const replayAccepted = replayEvents.filter((event) => (
    event.event_type === "loadArtifactGroupResult" && event.payload.result === "accepted"
  ));
  expect(replaySuccess).toHaveLength(1);
  expect(replayAccepted).toHaveLength(1);
  expect(replayRejections).toHaveLength(1);
  expect(await assertStageStable(page, baselineStage)).toBe(baselineStage);

  for (const [name, evidence] of Object.entries(denialEvidence)) {
    expect(evidence.observed_stage_after).toBe(evidence.observed_stage_before);
    if (name !== "expired") {
      expect(evidence.observed_stage_before).toBe(baselineStage);
      expect(evidence.observed_stage_after).toBe(baselineStage);
    }
  }

  const outageRequestId = `host_outage_${randomUUID()}`;
  await writeControlMarker("outage-ready.json", {
    schema_version: "runtime-command-authority-control/v1",
    run_id: evidenceRunId,
    request_id: outageRequestId,
    control_nonce: controlNonce,
  });
  const outageGo = await waitForControlMarker("outage-go.json", outageRequestId);
  expect(outageGo.coordinator_stopped).toBe(true);
  await sendCommand(page, "focusPrimRequest", commandPayload(primary, outageRequestId, { prim_path: "/World" }));
  const outageTerminal = await waitForEvent(page, outageRequestId, ["commandRejected"], 30_000);
  expect(outageTerminal.payload).toMatchObject({
    reason: "lease_invalid",
    detail_code: "authority_unavailable",
    runtime_state: "unchanged",
    retryable: true,
  });
  const outageStage = await observedStageUrl(page);
  expect(outageStage).toBe(baselineStage);

  const result = {
    schema_version: "runtime-command-authority-host-native-evidence/v1",
    observed_at: new Date().toISOString(),
    post_merge_corrective: true,
    origin_main_sha: originMainSha,
    runner_control: {
      run_id: evidenceRunId,
      outage_handshake: "deployment-owned-coordinator",
    },
    runtime: {
      runtime_id: runtimeId,
      process_id: runtimePid || null,
      signaling_port: kitSignalPort,
      media_port: kitMediaPort,
      first_frame: video,
      observed_stage_url: baselineStage,
      initial_stage_request_id: initialRequestId,
      initial_binding_revision_id: initialAuthorization.binding_revision_id,
      initial_stage_terminal: safeTerminal(initialTerminal),
      initial_stage_terminal_ms: Number(initialStageMs.toFixed(2)),
    },
    latency: {
      sample_count: latencySamples.length,
      p95_ms: Number(p95Ms.toFixed(2)),
      threshold_ms: 500,
    },
    sessions: {
      primary: primary.sessionId,
      wrong_session: wrongSession.sessionId,
      released: released.sessionId,
      expired: expiring.sessionId,
    },
    denials: denialEvidence,
    concurrent_replay: {
      request_ids: replayRequestIds,
      binding_revision_id: replayAuthorization.binding_revision_id,
      accepted_count: replayAccepted.length,
      success_terminal_count: replaySuccess.length,
      rejection_terminal_count: replayRejections.length,
      terminals: replayTerminalsByRequest.map((terminals) => safeTerminal(terminals[0])),
      observed_stage_url: baselineStage,
    },
    outage: {
      request_id: outageRequestId,
      terminal: safeTerminal(outageTerminal),
      observed_stage_url: outageStage,
    },
    zero_mutation_proof: {
      baseline_stage_url: baselineStage,
      all_pre_mutation_denials_preserved_stage: true,
      outage_preserved_stage: true,
    },
    artifact_policy: {
      playwright_trace: "disabled_to_avoid_bearer_capture",
      raw_tokens_persisted: false,
    },
  };
  const serialized = JSON.stringify(result, null, 2);
  for (const secret of secrets) expect(serialized.includes(secret)).toBe(false);

  for (const logPath of processLogPaths) {
    const logText = await readFile(logPath, "utf8").catch(() => "");
    for (const secret of secrets) expect(logText.includes(secret)).toBe(false);
  }

  const status = page.locator("#probe-status");
  await status.evaluate((element, evidence) => {
    element.textContent = [
      "HOST-NATIVE KIT / WEBRTC / DATACHANNEL AUTHORITY — PASS",
      `runtime=${evidence.runtime.runtime_id} pid=${evidence.runtime.process_id ?? "unknown"}`,
      `first-frame=${evidence.runtime.first_frame.width}x${evidence.runtime.first_frame.height}`,
      `stage=${evidence.runtime.observed_stage_url}`,
      `focus P95=${evidence.latency.p95_ms} ms / ${evidence.latency.threshold_ms} ms`,
      `denials=${Object.keys(evidence.denials).join(", ")}, outage`,
      `concurrent replay: accepted=${evidence.concurrent_replay.accepted_count} success=${evidence.concurrent_replay.success_terminal_count} rejected=${evidence.concurrent_replay.rejection_terminal_count}`,
      "raw tokens persisted=false; trace disabled",
    ].join("\n");
  }, result);
  await writeFile(testInfo.outputPath("runtime-command-authority-host-native.json"), `${serialized}\n`, "utf8");
  await writeControlMarker("outage-complete.json", {
    schema_version: "runtime-command-authority-control/v1",
    run_id: evidenceRunId,
    request_id: outageRequestId,
    control_nonce: controlNonce,
  });
  await page.screenshot({
    path: testInfo.outputPath("runtime-command-authority-host-native.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    const probe = (globalThis as typeof globalThis & {
      __HOST_NATIVE_AUTHORITY_PROBE__?: { streamer: { terminate: (force?: boolean) => unknown } };
    }).__HOST_NATIVE_AUTHORITY_PROBE__;
    probe?.streamer.terminate(false);
  });
});
