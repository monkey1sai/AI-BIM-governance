// Kit DataChannel message probe driver: real Chrome (headless) over raw CDP.
// No third-party dependencies - node:http, node:child_process, node:util and the
// platform WebSocket/fetch globals only (node >= 22). See README.md.
//
// Everything the run needs is either a CLI flag or a KIT_PROBE_* environment
// variable; nothing about the host is baked in. The page and the NVIDIA
// streaming library are served by a loopback-only static server started here,
// so no separate `python -m http.server` step and no vendored copy of the
// 700 KB library are needed.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKitProbeCdpRpc } from "../../lib/cdp-rpc.mjs";
import { recordStatsBefore } from "./stats-health.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..", "..", "..");

const { values: flags } = parseArgs({
  options: {
    mode: { type: "string" },
    label: { type: "string" },
    "out-dir": { type: "string" },
    "observe-sec": { type: "string" },
    "tail-observe-sec": { type: "string" },
    "ready-timeout-sec": { type: "string" },
    "signal-port": { type: "string" },
    server: { type: "string" },
    "http-port": { type: "string" },
    "cdp-port": { type: "string" },
    "chrome-path": { type: "string" },
    "session-id": { type: "string" },
    "trace-id": { type: "string" },
    "event-type": { type: "string" },
    "library-path": { type: "string" },
    "profile-dir": { type: "string" },
    "repo-root": { type: "string" },
    headed: { type: "boolean", default: false },
  },
  strict: true,
});

function text(flagName, envName, fallback) {
  const value = flags[flagName] ?? process.env[envName] ?? fallback;
  return value === undefined ? undefined : String(value);
}

function number(flagName, envName, fallback) {
  const raw = flags[flagName] ?? process.env[envName] ?? fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${flagName} / ${envName} must be a number; got ${JSON.stringify(raw)}`);
  }
  return value;
}

const repoRoot = path.resolve(text("repo-root", "KIT_PROBE_REPO_ROOT", defaultRepoRoot));
const mode = text("mode", "KIT_PROBE_MODE", "single");
const label = text("label", "KIT_PROBE_LABEL", mode);
const outDir = path.resolve(text("out-dir", "KIT_PROBE_OUT_DIR", path.join(repoRoot, "artifacts", "tmp", "kit-message-probe", "out")));
const observeSec = number("observe-sec", "KIT_PROBE_OBSERVE_SEC", 120);
const tailObserveSec = number("tail-observe-sec", "KIT_PROBE_TAIL_OBSERVE_SEC", 60);
const readyTimeoutSec = number("ready-timeout-sec", "KIT_PROBE_READY_TIMEOUT_SEC", 90);
const signalPort = number("signal-port", "KIT_PROBE_SIGNAL_PORT", 49131);
const server = text("server", "KIT_PROBE_SERVER", "127.0.0.1");
const httpPort = number("http-port", "KIT_PROBE_HTTP_PORT", 8799);
// 9333, not the 9223 that scripts/verify-runtime-e2e-cdp.mjs defaults to: two
// harnesses sharing a CDP port silently drive each other's browser.
const cdpPort = number("cdp-port", "KIT_PROBE_CDP_PORT", 9333);
const chromePath = text("chrome-path", "KIT_PROBE_CHROME_PATH", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const sessionId = text("session-id", "KIT_PROBE_SESSION_ID", "review_session_probe0001");
const traceId = text("trace-id", "KIT_PROBE_TRACE_ID", "");
const eventType = text("event-type", "KIT_PROBE_EVENT_TYPE", "loadingStateQuery");
const libraryPath = path.resolve(text(
  "library-path",
  "KIT_PROBE_LIBRARY_PATH",
  path.join(repoRoot, "web-viewer-sample", "node_modules", "@nvidia", "omniverse-webrtc-streaming-library", "dist", "omniverse-webrtc-streaming-library.js"),
));
const safeLabel = label.replace(/[^A-Za-z0-9_.-]/g, "_");
const profileDir = path.resolve(text("profile-dir", "KIT_PROBE_PROFILE_DIR", path.join(outDir, `chrome-${safeLabel}`)));
const outPath = path.join(outDir, `${safeLabel}.json`);
const probePagePath = path.join(scriptDir, "probe.html");

const MODES = /^(single|seq(\d+)?|burst(\d+)?|pipe(\d+)?)$/;
if (!MODES.test(mode)) {
  throw new Error(`--mode must be single, seq<N>, burst<N> or pipe<N>; got ${JSON.stringify(mode)}`);
}
function modeCount(prefix, fallback) {
  const parsed = Number(mode.slice(prefix.length));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const pageUrl = (() => {
  const url = new URL(`http://127.0.0.1:${httpPort}/`);
  url.searchParams.set("signalPort", String(signalPort));
  url.searchParams.set("server", server);
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("eventType", eventType);
  if (traceId) url.searchParams.set("traceId", traceId);
  return url.toString();
})();

const stamp = () => new Date().toISOString();
const say = (...parts) => console.log(`[${stamp()}]`, ...parts);

const consoleLines = [];
const statsSeries = [];
let rpc = null;

// --- static page server ----------------------------------------------------

// Fixed route table: the server can only ever hand out these two files, so a
// stray request can neither traverse the filesystem nor leak repo contents.
async function startPageServer() {
  const probeHtml = await fs.readFile(probePagePath);
  let libraryJs;
  try {
    libraryJs = await fs.readFile(libraryPath);
  } catch {
    throw new Error(`NVIDIA streaming library not found at ${libraryPath}. Run \`npm ci\` in web-viewer-sample, or pass --library-path.`);
  }
  const routes = new Map([
    ["/", { body: probeHtml, type: "text/html; charset=utf-8" }],
    ["/probe.html", { body: probeHtml, type: "text/html; charset=utf-8" }],
    ["/omniverse-webrtc-streaming-library.js", { body: libraryJs, type: "text/javascript; charset=utf-8" }],
  ]);

  const httpServer = createServer((req, res) => {
    const route = routes.get(new URL(req.url, "http://127.0.0.1").pathname);
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": route.type, "cache-control": "no-store" });
    res.end(route.body);
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", (error) => {
      reject(error.code === "EADDRINUSE"
        ? new Error(`HTTP port ${httpPort} is already in use. Pass --http-port to pick another.`)
        : error);
    });
    httpServer.listen(httpPort, "127.0.0.1", resolve);
  });
  return httpServer;
}

// --- CDP -------------------------------------------------------------------

function send(method, params = {}) {
  if (!rpc) {
    throw new Error("CDP session is not attached");
  }
  return rpc.send(method, params);
}

// DO NOT set replMode:true here. When Runtime.evaluate is given replMode:true
// together with awaitPromise:true, replMode silently wins: the still-pending
// Promise is returned and serialises as `{}` instead of the resolved value. Two
// separate harnesses have already read those empty objects as real observations
// - the second time it produced the phantom "tail-hold" that issue #671 had to
// retract. Every accessor on probe.html (__stats, __statsFull) is async, so this
// one flag decides whether the whole run measures anything at all.
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    replMode: false,
  });
  if (result.exceptionDetails) {
    throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails).slice(0, 500)}`);
  }
  return result.result?.value;
}

async function assertCdpPortFree() {
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    if (response.ok) {
      throw new Error(`CDP port ${cdpPort} is already serving a browser. Refusing to attach to a foreign browser; pass --cdp-port.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CDP port")) throw error;
    // Anything else means nothing is listening yet, which is what we want.
  }
}

async function launchChrome() {
  await fs.rm(profileDir, { recursive: true, force: true });
  await fs.mkdir(profileDir, { recursive: true });
  const chromeArgs = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    // Kit streams to a background tab for the whole silence window; without
    // these three Chrome throttles timers and the observation becomes an
    // artefact of the browser rather than of the transport.
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    pageUrl,
  ];
  if (!flags.headed) chromeArgs.unshift("--headless=new");
  return spawn(chromePath, chromeArgs, { stdio: "ignore" });
}

async function attachToPage() {
  const deadline = Date.now() + 40000;
  let target = null;
  while (!target && Date.now() < deadline) {
    await delay(1000);
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      target = list.find((entry) => entry.type === "page" && entry.url.startsWith(`http://127.0.0.1:${httpPort}/`));
    } catch {
      // Chrome has not opened its debugging endpoint yet.
    }
  }
  if (!target) {
    throw new Error(`No probe page target appeared on CDP port ${cdpPort} within 40s. Is ${chromePath} correct?`);
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  rpc = createKitProbeCdpRpc(socket, {
    requestTimeoutMs: readyTimeoutSec * 1000,
    onConsole(params) {
      const line = (params.args || [])
        .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || ""))
        .join(" ");
      consoleLines.push(`${new Date(params.timestamp).toISOString()} [${params.type}] ${line}`);
    },
  });
  await rpc.opened;
  await send("Runtime.enable");
}

// --- observation -----------------------------------------------------------

// Compact one getStats() report into a single row of the time series.
function compact(sample) {
  const row = { at: sample.at };
  for (const pc of sample.pcs || []) {
    for (const entry of pc.rows || []) {
      if (entry.type === "data-channel") {
        row.dc = row.dc || {};
        row.dc[entry.label || entry.id] = {
          st: entry.state, mSent: entry.messagesSent, mRecv: entry.messagesReceived,
          bSent: entry.bytesSent, bRecv: entry.bytesReceived,
        };
      } else if (entry.type === "transport") {
        row.tr = {
          pSent: entry.packetsSent, pRecv: entry.packetsReceived,
          bSent: entry.bytesSent, bRecv: entry.bytesReceived, dtls: entry.dtlsState,
        };
      } else if (entry.type === "candidate-pair") {
        row.cp = {
          pSent: entry.packetsSent, pRecv: entry.packetsReceived,
          bSent: entry.bytesSent, bRecv: entry.bytesReceived,
          rtt: entry.currentRoundTripTime, reqSent: entry.requestsSent, respRecv: entry.responsesReceived,
        };
      }
    }
    row.conn = pc.conn;
    row.ice = pc.ice;
  }
  return row;
}

async function sampleStats() {
  try {
    statsSeries.push(compact(await evaluate("__stats()")));
  } catch (error) {
    statsSeries.push({ at: Date.now(), error: String(error).slice(0, 200) });
  }
}

// Silence window: nothing is sent to Kit. getStats and state reads are page-local.
async function observe(seconds, tag) {
  const marks = [];
  for (let elapsed = 1; elapsed <= seconds; elapsed += 1) {
    await delay(1000);
    await sampleStats();
    if (elapsed % 5 === 0 || elapsed === 1) {
      const state = await evaluate('({count: __T.count, raw: __raw.length, rids: __T.events.map((e) => (e.payload && (e.payload.request_id || e.payload.rejection_id)) || "?")})');
      marks.push({ tag, elapsedSec: elapsed, count: state.count, rawCount: state.raw, rids: state.rids });
      if (elapsed % 15 === 0 || elapsed === 1) {
        say(`${tag} +${elapsed}s count=${state.count} raw=${state.raw} rids=${JSON.stringify(state.rids)}`);
      }
    }
  }
  return marks;
}

async function sendAndWait(rid, timeoutMs) {
  await evaluate(`__send(${JSON.stringify(rid)})`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const at = await evaluate(`__arrived(${JSON.stringify(rid)})`);
    if (at) return at;
    await delay(25);
  }
  return null;
}

async function waitForStreamReady() {
  const deadline = Date.now() + readyTimeoutSec * 1000;
  while (Date.now() < deadline) {
    const state = await evaluate("globalThis.__T ? {ready: __T.ready, failed: __T.failed} : null");
    if (state?.ready) return { ready: true, failed: null };
    if (state?.failed) return { ready: false, failed: state.failed };
    await delay(1000);
  }
  return { ready: false, failed: `stream did not become ready within ${readyTimeoutSec}s` };
}

// --- run -------------------------------------------------------------------

function buildLatencyTable(snapshot) {
  const sentAt = Object.fromEntries(snapshot.sent.map((entry) => [entry.request_id, entry.at]));
  const arrivals = {};
  for (const event of snapshot.events) {
    if (!event.rid) continue;
    (arrivals[event.rid] = arrivals[event.rid] || []).push(event.at);
  }
  return snapshot.sent.map((entry) => ({
    rid: entry.request_id,
    sent_rel_ms: entry.at - snapshot.t0,
    arr_rel_ms: (arrivals[entry.request_id] || []).map((at) => at - snapshot.t0),
    latency_ms: (arrivals[entry.request_id] || []).map((at) => at - sentAt[entry.request_id]),
    arrived: (arrivals[entry.request_id] || []).length > 0,
  }));
}

async function run(result) {
  const readiness = await waitForStreamReady();
  result.ready = readiness.ready;
  result.failed = readiness.failed;
  say(`mode=${mode} label=${label} ready=${result.ready} failed=${result.failed}`);
  if (!result.ready) return false;

  await delay(3000);
  recordStatsBefore(result, await evaluate("__statsFull()"));

  if (mode === "single") {
    say(`sending ONE command ${safeLabel}-01, then total silence`);
    await evaluate(`__send(${JSON.stringify(`${safeLabel}-01`)})`);
    result.marks = await observe(observeSec, "SINGLE");
  } else if (mode.startsWith("seq")) {
    const count = modeCount("seq", 10);
    const seq = [];
    for (let i = 1; i <= count; i += 1) {
      const rid = `${safeLabel}-${String(i).padStart(2, "0")}`;
      const sentAt = Date.now();
      const at = await sendAndWait(rid, i === count ? 1000 : 30000);
      seq.push({ rid, arrivedAt: at, waitedMs: at ? null : Date.now() - sentAt });
      say(`seq ${rid} arrived=${at !== null}`);
      if (at === null && i < count) say(`seq stalled at ${rid} - continuing anyway`);
    }
    result.seq = seq;
    say(`${count}th sent; now total silence`);
    result.marks = await observe(observeSec, "SEQ-TAIL");
  } else if (mode.startsWith("pipe")) {
    // True pipeline burst: one tight synchronous JS loop, zero gap, zero await.
    const count = modeCount("pipe", 6);
    say(`pipelining ${count} commands back-to-back (no gap), then total silence`);
    result.pipeSend = await evaluate(`(() => { const t = Date.now(); for (let i = 1; i <= ${count}; i += 1) __send('p-' + String(i).padStart(2, '0')); return { n: __T.sent.length, spanMs: Date.now() - t }; })()`);
    say(`pipeline sent=${JSON.stringify(result.pipeSend)}`);
    result.marks = await observe(observeSec, "PIPE");
    result.missingAfterT1 = await evaluate(`(${count} - new Set(__T.events.map((e) => e.payload && e.payload.request_id).filter(Boolean)).size)`);
    if (result.missingAfterT1 > 0) {
      say(`${result.missingAfterT1} response(s) still missing -> T2 unblock probe`);
      result.snapshotT1 = await evaluate("__snapshot()");
      await evaluate('__send("t2-unblock")');
      result.marks2 = await observe(tailObserveSec, "T2");
    } else {
      say("all responses arrived; T2 unblock probe not needed");
    }
  } else {
    const count = modeCount("burst", 3);
    say(`sending burst of ${count} (1s apart), then total silence`);
    for (let i = 1; i <= count; i += 1) {
      if (i > 1) await delay(1000);
      await evaluate(`__send(${JSON.stringify(`t1-${String(i).padStart(2, "0")}`)})`);
    }
    result.marks = await observe(observeSec, "T1");
    result.snapshotT1 = await evaluate("__snapshot()");
    result.t1EndedAt = stamp();
    say("T1 window closed. Sending t2-unblock.");
    await evaluate('__send("t2-unblock")');
    result.marks2 = await observe(tailObserveSec, "T2");
  }

  result.snapshot = await evaluate("__snapshot()");
  result.statsAfter = await evaluate("__statsFull()");
  result.statsSeries = statsSeries;
  result.table = buildLatencyTable(result.snapshot);
  return true;
}

let httpServer = null;
let chrome = null;
const result = {
  schemaVersion: 1,
  mode,
  label,
  params: {
    signalPort, server, httpPort, cdpPort, sessionId, traceId: traceId || null, eventType,
    observeSec, tailObserveSec, readyTimeoutSec, headed: Boolean(flags.headed),
    libraryPath, probePagePath, outPath,
  },
  startedAt: stamp(),
  ready: false,
  failed: null,
  seq: null,
  marks: null,
  marks2: null,
  snapshot: null,
};

try {
  await fs.mkdir(outDir, { recursive: true });
  await assertCdpPortFree();
  httpServer = await startPageServer();
  say(`probe page served at ${pageUrl}`);
  chrome = await launchChrome();
  await attachToPage();
  const completed = await run(result);
  if (!completed) process.exitCode = 1;
} catch (error) {
  result.error = String(error);
  process.exitCode = 1;
  say(`FAILED ${result.error}`);
} finally {
  result.endedAt = stamp();
  result.console = consoleLines;
  if (result.statsSeries === undefined && statsSeries.length > 0) result.statsSeries = statsSeries;
  try {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(result, null, 1), "utf8");
    say(`wrote ${outPath}`);
  } catch (writeError) {
    say(`could not write ${outPath}: ${writeError}`);
    process.exitCode = 1;
  }
  console.log(`PROBE_RESULT ${JSON.stringify({
    mode, label, ready: result.ready, failed: result.failed, error: result.error ?? null,
    count: result.snapshot?.count ?? null,
    rawCount: result.snapshot?.raw?.length ?? null,
    byType: result.snapshot?.byType ?? null,
    table: result.table ?? null,
    statsHealth: result.statsHealth ?? null,
    outPath,
  })}`);
  try { rpc?.close(); } catch { /* already closed */ }
  try { chrome?.kill(); } catch { /* already gone */ }
  // closeAllConnections() first: a keep-alive socket Chrome has not released yet
  // would otherwise keep close() pending and hang the teardown indefinitely.
  try { httpServer?.closeAllConnections(); } catch { /* older runtime, or already closed */ }
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await delay(1500);
  process.exit(process.exitCode ?? 0);
}
