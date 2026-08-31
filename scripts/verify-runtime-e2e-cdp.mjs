import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { inspectReadiness, inspectRealE2E } from "./lib/runtime-e2e-readiness.mjs";
import { createRuntimeE2eCdpRpc } from "./lib/cdp-rpc.mjs";

const cwd = process.cwd();
const chromePath = process.env.RUNTIME_E2E_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const debugPort = Number(process.env.RUNTIME_E2E_CDP_PORT || 9223);
const evidenceDir = path.join(cwd, "docs", "verification", "evidence", "2026-05-08-runtime-e2e");
const profileDir = path.join(cwd, "scripts", ".run", "chrome-e2e-profile");
const streamTimeoutMs = Number(process.env.RUNTIME_E2E_STREAM_TIMEOUT_MS || 180000);
const singleOnly = process.env.RUNTIME_E2E_SINGLE_ONLY === "1";
const skipSingle = process.env.RUNTIME_E2E_SKIP_SINGLE === "1";
const separateBrowsers = process.env.RUNTIME_E2E_SEPARATE_BROWSERS === "1";
const sameKitOnly = process.env.RUNTIME_E2E_SAME_KIT_ONLY === "1";
const e2eRequireReal = process.env.E2E_REQUIRE_REAL === "1";
const e2eStackManifest = process.env.E2E_STACK_MANIFEST || "";
const directNoMedia = process.env.RUNTIME_E2E_DIRECT_NO_MEDIA === "1";
const e2eSkipObservation = process.env.E2E_SKIP === "1" || skipSingle || sameKitOnly || singleOnly || directNoMedia;
const e2eModeObservation = process.env.E2E_MODE || process.env.RUNTIME_E2E_MODE || "canonical";
const realE2EOptions = Object.freeze({
  requireReal: e2eRequireReal,
  e2eRequireReal,
  E2E_REQUIRE_REAL: e2eRequireReal,
  manifestPath: e2eStackManifest,
  manifestPresent: e2eStackManifest.trim().length > 0,
  skipped: e2eSkipObservation,
  mode: e2eModeObservation,
});
const startupRealE2E = inspectRealE2E(realE2EOptions);
if (e2eRequireReal && !startupRealE2E.ready) {
  throw new Error(`E2E_REQUIRE_REAL preflight failed: ${startupRealE2E.reason}`);
}

function readinessOptions(overrides = {}) {
  const mode = e2eModeObservation.toLowerCase() === "canonical"
    ? (overrides.mode ?? e2eModeObservation)
    : e2eModeObservation;
  return {
    ...overrides,
    ...realE2EOptions,
    skipped: e2eSkipObservation || overrides.skipped === true,
    mode,
  };
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

const primaryEndpoint = {
  kitInstanceId: process.env.RUNTIME_E2E_PRIMARY_KIT_ID || "kit_local_001",
  streamRole: "primary",
  signalingServer: process.env.RUNTIME_E2E_PRIMARY_SIGNALING_SERVER || "127.0.0.1",
  mediaServer: process.env.RUNTIME_E2E_PRIMARY_MEDIA_SERVER || "127.0.0.1",
  signalingPort: numberEnv("RUNTIME_E2E_PRIMARY_SIGNALING_PORT", 49100),
  mediaPort: numberEnv("RUNTIME_E2E_PRIMARY_MEDIA_PORT", 0),
};
const spectatorEndpoint = {
  kitInstanceId: process.env.RUNTIME_E2E_SPECTATOR_KIT_ID || "kit_local_001_spectator_0",
  streamRole: "spectator",
  signalingServer: process.env.RUNTIME_E2E_SPECTATOR_SIGNALING_SERVER || "127.0.0.1",
  mediaServer: process.env.RUNTIME_E2E_SPECTATOR_MEDIA_SERVER || "127.0.0.1",
  signalingPort: numberEnv("RUNTIME_E2E_SPECTATOR_SIGNALING_PORT", 49110),
  mediaPort: numberEnv("RUNTIME_E2E_SPECTATOR_MEDIA_PORT", 0),
};

const sessions = {
  single: process.env.RUNTIME_E2E_SINGLE_SESSION || "review_session_d79240f69977",
  multi: process.env.RUNTIME_E2E_MULTI_SESSION || "review_session_f64d11922fd0",
  sameKit: process.env.RUNTIME_E2E_SAME_KIT_SESSION || process.env.RUNTIME_E2E_MULTI_SESSION || "review_session_f64d11922fd0",
};

function pageUrl(sessionId, endpoint, userId, displayName) {
  const url = new URL("http://127.0.0.1:5173/");
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("streamTimeoutMs", String(streamTimeoutMs));
  if (endpoint?.kitInstanceId) {
    url.searchParams.set("kitInstanceId", endpoint.kitInstanceId);
  }
  if (endpoint?.streamRole) {
    url.searchParams.set("streamRole", endpoint.streamRole);
  }
  if (endpoint?.signalingPort || process.env.RUNTIME_E2E_DIRECT_NO_MEDIA === "1") {
    url.searchParams.set("signalingServer", endpoint?.signalingServer || "127.0.0.1");
    url.searchParams.set("mediaServer", endpoint?.mediaServer || "127.0.0.1");
    url.searchParams.set("signalingPort", String(endpoint?.signalingPort || 49100));
    url.searchParams.set("mediaPort", String(endpoint?.mediaPort ?? 0));
  }
  if (userId) {
    url.searchParams.set("userId", userId);
  }
  if (displayName) {
    url.searchParams.set("displayName", displayName);
  }
  return url.toString();
}

async function waitForJson(url, timeoutMs = 20000, init = undefined) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

class CdpPage {
  constructor(wsUrl, options = {}) {
    this.wsUrl = wsUrl;
    this.ws = new WebSocket(wsUrl);
    this.rpc = createRuntimeE2eCdpRpc(this.ws, {
      requestTimeoutMs: options.requestTimeoutMs ?? streamTimeoutMs,
    });
  }

  get pending() {
    return this.rpc.pending;
  }

  get events() {
    return this.rpc.events;
  }

  get console() {
    return this.rpc.console;
  }

  send(method, params = {}) {
    return this.rpc.send(method, params);
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result?.value;
  }

  async screenshot(filePath, clip = null) {
    const params = {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    };
    if (clip) {
      params.clip = {
        x: Math.max(0, clip.x),
        y: Math.max(0, clip.y),
        width: Math.max(1, clip.width),
        height: Math.max(1, clip.height),
        scale: 1,
      };
    }
    const result = await this.send("Page.captureScreenshot", {
      ...params,
    });
    await fs.writeFile(filePath, Buffer.from(result.data, "base64"));
  }

  close() {
    this.rpc.close();
  }
}

async function createPage(url, port = debugPort) {
  const target = await waitForJson(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    20000,
    { method: "PUT" },
  );
  const page = new CdpPage(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Log.enable");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.send("Page.bringToFront");
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: 720,
    y: 490,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: 720,
    y: 490,
    button: "left",
    clickCount: 1,
  });
  return page;
}

const readinessExpression = `(() => {
  const video = document.getElementById("remote-video");
  const text = document.body ? document.body.innerText : "";
  if (video) {
    video.muted = true;
    video.playsInline = true;
    if (video.paused) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    }
  }
  let pixelStats = null;
  let pixelError = null;
  try {
    if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(320, video.videoWidth);
      canvas.height = Math.min(180, video.videoHeight);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonZero = 0;
      let nonBlack = 0;
      let sum = 0;
      let samples = 0;
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r || g || b) nonZero++;
        if (r > 8 || g > 8 || b > 8) nonBlack++;
        sum += r + g + b;
        samples++;
      }
      pixelStats = {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        samples,
        nonZero,
        nonBlack,
        avgRgb: Number((sum / Math.max(samples * 3, 1)).toFixed(2)),
      };
    }
  } catch (error) {
    pixelError = String(error && error.message || error);
  }
  return {
    href: location.href,
    title: document.title,
    readyState: video ? video.readyState : -1,
    networkState: video ? video.networkState : -1,
    paused: video ? video.paused : null,
    currentTime: video ? Number(video.currentTime.toFixed(2)) : 0,
    videoWidth: video ? video.videoWidth : 0,
    videoHeight: video ? video.videoHeight : 0,
    srcObject: !!(video && video.srcObject),
    bodyHasReviewModelReady: text.includes("可審查模型") && text.includes("已就緒"),
    bodyHasDataChannelReply: text.includes("DataChannel 已回應"),
    bodyHasUsdcPanel: text.includes("USD / USDC 成果檔"),
    bodyHasArtifactUrl: text.includes("library_2026.usdc") || text.includes(".usdc"),
    bodyHasMakePickableResponse: text.includes("makePrimsPickableResponse"),
    bodyHasSpectatorReady: text.includes("旁觀串流已連線"),
    bodyHasModelLoaded: text.includes("模型已載入"),
    bodyHasOpenedStageResult: text.includes("openedStageResult"),
    bodyHasLoadingStateResponse: text.includes("loadingStateResponse"),
    bodyHasSocketConnected: text.includes("Socket.IO 已連線"),
    bodyHasWaitingText: text.includes("等待串流") || text.includes("正在載入"),
    bodyPreview: text.slice(0, 1500),
    pixelStats,
    pixelError,
  };
})()`;

async function waitForRuntimeReady(page, label, options = {}) {
  const deadline = Date.now() + streamTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(readinessExpression);
    const inspection = inspectReadiness(last, page.console, readinessOptions(options));
    last.matchedEvidence = inspection.matchedEvidence;
    if (inspection.ready) {
      return last;
    }
    await sleep(1000);
  }
  const consoleTail = page.console.map((event) => ({
    type: event.type,
    args: (event.args || []).map((arg) => arg.value || arg.description || arg.type),
  })).slice(-80);
  throw new Error(`${label} did not become runtime-ready: ${JSON.stringify({ last, consoleTail }, null, 2)}`);
}

async function videoClip(page) {
  return await page.evaluate(`(() => {
    const video = document.getElementById("remote-video");
    if (!video) return null;
    const rect = video.getBoundingClientRect();
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    const width = Math.min(rect.width, window.innerWidth - x);
    const height = Math.min(rect.height, window.innerHeight - y);
    if (width < 1 || height < 1) return null;
    return { x, y, width, height };
  })()`);
}

async function zoomViewport(page) {
  const rect = await videoClip(page);
  if (!rect) {
    return null;
  }
  const x = rect.x + rect.width * 0.55;
  const y = rect.y + rect.height * 0.5;
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  for (let i = 0; i < 8; i += 1) {
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: 0,
      deltaY: -650,
    });
    await sleep(200);
  }
  return rect;
}

async function captureScenario(name, url, screenshotName, port = debugPort, options = {}) {
  const page = await createPage(url, port);
  const screenshot = path.join(evidenceDir, screenshotName);
  const viewportScreenshot = screenshot.replace(/\.png$/, "-viewport.png");
  try {
    const state = await waitForRuntimeReady(page, name, options);
    if (options.postReadyDelayMs) {
      await sleep(options.postReadyDelayMs);
    }
    await zoomViewport(page);
    await sleep(2500);
    await page.screenshot(screenshot);
    const clip = await videoClip(page);
    if (clip) {
      await page.screenshot(viewportScreenshot, clip);
    }
    const consoleEvents = page.console.map((event) => ({
      type: event.type,
      args: (event.args || []).map((arg) => arg.value || arg.description || arg.type),
    })).slice(-80);
    return { name, url, screenshot, viewportScreenshot, state, consoleEvents };
  } catch (error) {
    await page.screenshot(screenshot.replace(/\.png$/, "-blocked.png"));
    throw error;
  } finally {
    page.close();
  }
}

function scenarioProfileDir(name) {
  const safeName = name.replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(cwd, "scripts", ".run", `chrome-e2e-profile-${safeName}`);
}

async function launchChrome(port, profile) {
  await fs.rm(profile, { recursive: true, force: true });
  await fs.mkdir(profile, { recursive: true });
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
    "--allow-insecure-localhost",
    "--window-size=1440,980",
    "about:blank",
  ], {
    detached: false,
    stdio: "ignore",
  });
  await waitForJson(`http://127.0.0.1:${port}/json/version`, 30000);
  return chrome;
}

async function captureScenarioInDedicatedBrowser(name, url, screenshotName, port, options = {}) {
  const chrome = await launchChrome(port, scenarioProfileDir(name));
  try {
    return await captureScenario(name, url, screenshotName, port, options);
  } finally {
    chrome.kill();
  }
}

await fs.mkdir(evidenceDir, { recursive: true });
let chrome = null;

try {
  if (!separateBrowsers) {
    chrome = await launchChrome(debugPort, profileDir);
  }

  const single = (skipSingle || sameKitOnly) ? null : (separateBrowsers
    ? await captureScenarioInDedicatedBrowser(
      "single-kit",
      pageUrl(sessions.single, primaryEndpoint, "runtime_single_user", "Runtime Single"),
      `single-kit-${sessions.single}-${primaryEndpoint.kitInstanceId}.png`,
      debugPort,
    )
    : await captureScenario(
    "single-kit",
    pageUrl(sessions.single, primaryEndpoint, "runtime_single_user", "Runtime Single"),
    `single-kit-${sessions.single}-${primaryEndpoint.kitInstanceId}.png`,
  ));

  const sameKitScenarios = singleOnly ? [] : await Promise.all([
    separateBrowsers ? captureScenarioInDedicatedBrowser(
      "same-kit-primary",
      pageUrl(sessions.sameKit, primaryEndpoint, "runtime_samekit_primary", "Runtime Primary"),
      `same-kit-${sessions.sameKit}-${primaryEndpoint.kitInstanceId}-primary.png`,
      debugPort + 1,
    ) : captureScenario(
      "same-kit-primary",
      pageUrl(sessions.sameKit, primaryEndpoint, "runtime_samekit_primary", "Runtime Primary"),
      `same-kit-${sessions.sameKit}-${primaryEndpoint.kitInstanceId}-primary.png`,
    ),
    separateBrowsers ? captureScenarioInDedicatedBrowser(
      "same-kit-spectator",
      pageUrl(sessions.sameKit, spectatorEndpoint, "runtime_samekit_spectator", "Runtime Spectator"),
      `same-kit-${sessions.sameKit}-${spectatorEndpoint.kitInstanceId}-spectator.png`,
      debugPort + 2,
      { requireDataChannel: false, requireStageSuccess: false, postReadyDelayMs: 10000 },
    ) : captureScenario(
      "same-kit-spectator",
      pageUrl(sessions.sameKit, spectatorEndpoint, "runtime_samekit_spectator", "Runtime Spectator"),
      `same-kit-${sessions.sameKit}-${spectatorEndpoint.kitInstanceId}-spectator.png`,
      debugPort,
      { requireDataChannel: false, requireStageSuccess: false, postReadyDelayMs: 10000 },
    ),
  ]);

  const summary = {
    captured_at: new Date().toISOString(),
    debugPort,
    endpoints: {
      primary: primaryEndpoint,
      spectator: spectatorEndpoint,
    },
    sessions,
    scenarios: [...(single ? [single] : []), ...sameKitScenarios],
  };
  const summaryPath = path.join(evidenceDir, "runtime-e2e-browser-summary.json");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify({ summaryPath, screenshots: summary.scenarios.map((item) => item.screenshot), readiness: summary.scenarios.map((item) => ({ name: item.name, state: item.state })) }, null, 2));
} finally {
  if (chrome) {
    chrome.kill();
  }
}
