import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const enabled = process.env.E2E_HOST_NATIVE_RUNTIME_AUTHORITY === "1";
const coordinatorBase = process.env.E2E_COORDINATOR_BASE_URL || "";
const coordinatorPid = Number(process.env.E2E_COORDINATOR_PID || "0");
const kitSignalPort = Number(process.env.E2E_KIT_SIGNAL_PORT || "0");
const kitMediaPort = Number(process.env.E2E_KIT_MEDIA_PORT || "0");
const stageUrlA = process.env.E2E_STAGE_URL_A || "";
const stageUrlB = process.env.E2E_STAGE_URL_B || "";
const runtimeId = process.env.E2E_KIT_RUNTIME_ID || "kit_runtime_authority_host_native";
const runtimePid = Number(process.env.E2E_KIT_PID || "0");
const processLogPaths = (process.env.E2E_RUNTIME_PROCESS_LOGS || "")
  .split(";")
  .map((value) => value.trim())
  .filter(Boolean);

test.use({ trace: "off", screenshot: "off", video: "off" });
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
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof body.detail === "string" ? body.detail : "no_detail";
    throw new Error(`coordinator ${path} -> ${response.status} ${detail}`);
  }
  return body as T;
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
    await probe.streamer.sendMessage({ event_type: nextEventType, payload: nextPayload });
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
  test.setTimeout(240_000);
  expect(coordinatorBase).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(coordinatorPid).toBeGreaterThan(0);
  expect(kitSignalPort).toBeGreaterThan(0);
  expect(kitMediaPort).toBeGreaterThan(0);
  expect(stageUrlA).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  expect(stageUrlB).toMatch(/^http:\/\/localhost:\d+\//);

  const primary = await createSession("primary", stageUrlA);
  const wrongSession = await createSession("wrong_session", stageUrlB);
  const released = await createSession("released", stageUrlA);
  const expiring = await createSession("expired", stageUrlA);
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

  await connectProbe(page);
  const video = await page.locator("#remote-video").evaluate((element) => {
    const media = element as HTMLVideoElement;
    return { width: media.videoWidth, height: media.videoHeight, readyState: media.readyState };
  });
  expect(video.width).toBeGreaterThan(0);
  expect(video.height).toBeGreaterThan(0);

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

  const denialEvidence: Record<string, { terminal: SafeEvent; observed_stage_url: string }> = {};
  const forgedRequestId = `host_forged_${randomUUID()}`;
  await sendCommand(page, "focusPrimRequest", {
    ...commandPayload(primary, forgedRequestId, { prim_path: "/World" }),
    viewer_lease_token: "forged-host-native-lease",
  });
  const forgedTerminal = await waitForEvent(page, forgedRequestId, ["commandRejected"]);
  expect(forgedTerminal.payload).toMatchObject({ reason: "lease_invalid", runtime_state: "unchanged", retryable: false });
  denialEvidence.forged = { terminal: safeTerminal(forgedTerminal), observed_stage_url: await observedStageUrl(page) };

  const wrongSourceRequestId = `host_wrong_source_${randomUUID()}`;
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
  denialEvidence.wrong_source = {
    terminal: safeTerminal(wrongSourceTerminal),
    observed_stage_url: await observedStageUrl(page),
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
  await sendCommand(page, "focusPrimRequest", commandPayload(released, releasedRequestId, { prim_path: "/World" }));
  const releasedTerminal = await waitForEvent(page, releasedRequestId, ["commandRejected"]);
  expect(releasedTerminal.payload).toMatchObject({
    reason: "lease_invalid",
    detail_code: "lease_released",
    runtime_state: "unchanged",
    retryable: false,
  });
  denialEvidence.released = {
    terminal: safeTerminal(releasedTerminal),
    observed_stage_url: await observedStageUrl(page),
  };

  const expiresAtMs = Date.parse(expiring.lease.expires_at);
  const expiryWaitMs = Math.max(0, expiresAtMs - Date.now() + 1_000);
  if (expiryWaitMs > 0) await page.waitForTimeout(expiryWaitMs);
  const expiredRequestId = `host_expired_${randomUUID()}`;
  await sendCommand(page, "focusPrimRequest", commandPayload(expiring, expiredRequestId, { prim_path: "/World" }));
  const expiredTerminal = await waitForEvent(page, expiredRequestId, ["commandRejected"]);
  expect(expiredTerminal.payload).toMatchObject({
    reason: "lease_invalid",
    detail_code: "lease_expired",
    runtime_state: "unchanged",
    retryable: false,
  });
  denialEvidence.expired = {
    terminal: safeTerminal(expiredTerminal),
    observed_stage_url: await observedStageUrl(page),
  };

  const wrongSessionAuthorization = await preauthorize(wrongSession);
  const wrongSessionRequestId = `host_wrong_session_${randomUUID()}`;
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
  denialEvidence.direct_open_wrong_session = {
    terminal: safeTerminal(wrongSessionTerminal),
    observed_stage_url: await observedStageUrl(page),
  };

  const tamperAuthorization = await preauthorize(primary);
  const tamperedComposition = structuredClone(tamperAuthorization.stage_composition);
  tamperedComposition.primary.usdc_url = stageUrlB;
  const tamperRequestId = `host_composition_tamper_${randomUUID()}`;
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
  denialEvidence.composition_tamper = {
    terminal: safeTerminal(tamperTerminal),
    observed_stage_url: await observedStageUrl(page),
  };

  const replayAuthorization = await preauthorize(primary);
  const replayRequestId = `host_concurrent_replay_${randomUUID()}`;
  const replayPayload = commandPayload(primary, replayRequestId, {
    stage_binding_authorization_id: replayAuthorization.stage_binding_authorization_id,
    binding_revision_id: replayAuthorization.binding_revision_id,
    stage_composition: replayAuthorization.stage_composition,
    url: replayAuthorization.stage_composition.primary.usdc_url,
  });
  await page.evaluate(async ({ eventType, payload }) => {
    const probe = (globalThis as typeof globalThis & {
      __HOST_NATIVE_AUTHORITY_PROBE__?: {
        streamer: { sendMessage: (message: unknown) => Promise<unknown> };
      };
    }).__HOST_NATIVE_AUTHORITY_PROBE__;
    if (!probe) throw new Error("host-native probe is unavailable");
    await Promise.all([
      probe.streamer.sendMessage({ event_type: eventType, payload }),
      probe.streamer.sendMessage({ event_type: eventType, payload }),
    ]);
  }, { eventType: "loadArtifactGroupRequest", payload: replayPayload });
  await page.waitForFunction((requestId) => {
    const probe = (globalThis as typeof globalThis & {
      __HOST_NATIVE_AUTHORITY_PROBE__?: { events: SafeEvent[] };
    }).__HOST_NATIVE_AUTHORITY_PROBE__;
    const terminals = (probe?.events || []).filter((event) => (
      event.payload.request_id === requestId
      && (event.event_type === "openedStageResult" || event.event_type === "commandRejected")
    ));
    return terminals.length >= 2;
  }, replayRequestId, { timeout: 60_000 });
  const replayEvents = await safeEvents(page, replayRequestId);
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
  expect(await observedStageUrl(page)).toBe(baselineStage);

  for (const evidence of Object.values(denialEvidence)) {
    expect(evidence.observed_stage_url).toBe(baselineStage);
  }

  process.kill(coordinatorPid);
  await expect.poll(async () => {
    try {
      await fetch(`${coordinatorBase}/health`, { signal: AbortSignal.timeout(500) });
      return "listening";
    } catch {
      return "stopped";
    }
  }, { timeout: 15_000 }).toBe("stopped");
  const outageRequestId = `host_outage_${randomUUID()}`;
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
      request_id: replayRequestId,
      binding_revision_id: replayAuthorization.binding_revision_id,
      accepted_count: replayAccepted.length,
      success_terminal_count: replaySuccess.length,
      rejection_terminal_count: replayRejections.length,
      rejection: safeTerminal(replayRejections[0]),
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
  for (const secret of secrets) expect(serialized).not.toContain(secret);

  for (const logPath of processLogPaths) {
    const logText = await readFile(logPath, "utf8").catch(() => "");
    for (const secret of secrets) expect(logText).not.toContain(secret);
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
