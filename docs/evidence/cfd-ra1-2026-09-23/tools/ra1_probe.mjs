// R-A1 single trial on 181 (building-energy-cfd-p2-contract.md §6 R-A1): real Chrome opens the unified console, selects
// the review session, starts 3D and measures
//   * first_frame_ms  : start click (or session select when the lease is auto-claimed) → viewer `first_frame` postMessage
//   * stage_loaded_ms : same origin → `stage_loaded`
//   * ACK round trip  : N sequential `camera_state` requests posted to the viewer iframe exactly like the console does;
//                       the viewer forwards each as Kit DataChannel `cameraStateRequest` and replies `camera_state_result`
//   * fps / dropped   : requestVideoFrameCallback count and getVideoPlaybackQuality over a fixed window in the viewer frame
// Copy into web-viewer-sample/e2e/ before running (Playwright resolves from there); do not commit the copy.
// Env: E2E_COORDINATOR_BASE_URL, CFD_E2E_SESSION_ID, RA1_LABEL, RA1_TRIAL, RA1_OUT, RA1_RUN_ID (optional), RA1_ACK_N,
//      RA1_FPS_WINDOW_S. Writes <RA1_OUT>/<label>-<trial>.json; exit 1 on failure (JSON still written with `error`).
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const COORD = process.env.E2E_COORDINATOR_BASE_URL;
if (!COORD) throw new Error("set E2E_COORDINATOR_BASE_URL (coordinator origin, e.g. http://<canonical-host>:8004)");
const SESSION_ID = process.env.CFD_E2E_SESSION_ID;
if (!SESSION_ID) throw new Error("set CFD_E2E_SESSION_ID (an active review session on that coordinator)");
const LABEL = process.env.RA1_LABEL || "idle-before";
const TRIAL = Number(process.env.RA1_TRIAL || "1");
const OUT = process.env.RA1_OUT || path.resolve(process.cwd(), "../artifacts/e2e/cfd-ra1-181");
const RUN_ID = process.env.RA1_RUN_ID || "";
const ACK_N = Number(process.env.RA1_ACK_N || "30");
const FPS_WINDOW_S = Number(process.env.RA1_FPS_WINDOW_S || "10");
fs.mkdirSync(OUT, { recursive: true });

const result = { schema: "cfd-ra1-trial/v1", label: LABEL, trial: TRIAL, session_id: SESSION_ID, started_utc: new Date().toISOString() };
const runStatus = async (request) => {
  if (!RUN_ID) return null;
  try {
    const body = await (await request.get(`${COORD}/api/cfd/runs/${RUN_ID}`)).json();
    return { status: body.status?.status ?? body.ledger?.status ?? null, directions_done: body.ledger?.directions_done ?? null };
  } catch (error) { return { error: String(error) }; }
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.addInitScript(() => {
  if (window.top !== window) return;
  window.__ra1 = [];
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object" || data.protocol !== "vg01") return;
    window.__ra1.push({ t: performance.now(), type: data.type, clientRequestId: data.clientRequestId ?? null, status: data.status ?? null, origin: event.origin });
  });
});
const page = await context.newPage();
// Record the viewer lease role: a claim made while a previous primary lease is still inside its 45 s TTL becomes a
// spectator, which is not what R-A1 measures. Only trials with lease_primary === true count.
page.on("response", async (response) => {
  if (/\/viewer-leases\/claim$/.test(new URL(response.url()).pathname) && response.request().method() === "POST") {
    try {
      const body = await response.json();
      result.lease_claim_status = response.status();
      result.lease_primary = body.primary ?? (body.lease?.role === "primary");
    } catch { result.lease_claim_status = response.status(); }
  }
});
try {
  result.run_at_start = await runStatus(page.request);
  await page.goto(`${COORD}/ui/#a1`, { waitUntil: "domcontentloaded" });
  const advanced = page.getByTestId("a1-review-advanced");
  await advanced.waitFor({ timeout: 60_000 });
  if (!(await advanced.evaluate((el) => el.open))) await advanced.locator("summary").first().click();
  const sessionSelect = page.getByTestId("a1-session-select");
  await sessionSelect.waitFor({ timeout: 60_000 });
  await page.waitForFunction(([el, id]) => Array.from(el.options).some((o) => o.value === id), [await sessionSelect.elementHandle(), SESSION_ID], { timeout: 60_000 });

  let t0 = await page.evaluate(() => performance.now());
  await sessionSelect.selectOption(SESSION_ID);
  result.start_mode = "auto_on_session_select";
  const manualStart = page.locator("[data-testid$='-manual-start']").first();
  // locator.isVisible() does not wait; the start button renders a few seconds after the session is selected.
  if (await manualStart.waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false)) {
    t0 = await page.evaluate(() => performance.now());
    await manualStart.click();
    result.start_mode = "manual_start_click";
  }
  const waitFor = async (type, timeoutMs) => {
    const handle = await page.waitForFunction((wanted) => window.__ra1.find((m) => m.type === wanted) ?? null, type, { timeout: timeoutMs, polling: 50 });
    return handle.jsonValue();
  };
  const firstFrame = await waitFor("first_frame", 90_000);
  result.first_frame_ms = Math.round(firstFrame.t - t0);
  const stageLoaded = await waitFor("stage_loaded", 120_000).catch(() => null);
  result.stage_loaded_ms = stageLoaded ? Math.round(stageLoaded.t - t0) : null;
  result.stage_loaded_status = stageLoaded?.status ?? null;
  await page.waitForTimeout(3_000);

  // Viewer iframe: the console posts { protocol: "vg01", ...msg } with the viewer origin as targetOrigin.
  const iframeSrc = await page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll("iframe"));
    const viewer = frames.find((f) => f.src && /viewer|:5173|\/viewer|open/.test(f.src)) ?? frames.find((f) => f.src);
    return viewer ? viewer.src : null;
  });
  result.viewer_origin_kind = iframeSrc ? (new URL(iframeSrc).port === "5173" ? "viewer:5173" : "other") : null;
  if (!iframeSrc) throw new Error("viewer iframe not found");

  const ack = await page.evaluate(async ({ n, label, trial, src }) => {
    const origin = new URL(src).origin;
    const frame = Array.from(document.querySelectorAll("iframe")).find((f) => f.src === src);
    const samples = [];
    for (let i = 1; i <= n; i += 1) {
      const id = `ra1_${label}_${trial}_${i}`;
      const t = performance.now();
      frame.contentWindow.postMessage({ protocol: "vg01", type: "camera_state", clientRequestId: id }, origin);
      const reply = await new Promise((resolve) => {
        const deadline = performance.now() + 5000;
        const tick = () => {
          const hit = window.__ra1.find((m) => m.type === "camera_state_result" && m.clientRequestId === id);
          if (hit) resolve(hit);
          else if (performance.now() > deadline) resolve(null);
          else setTimeout(tick, 2);
        };
        tick();
      });
      samples.push(reply ? { ms: Math.round((reply.t - t) * 10) / 10, status: reply.status } : { ms: null, status: "timeout" });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return samples;
  }, { n: ACK_N, label: LABEL, trial: TRIAL, src: iframeSrc });
  // Viewer reply status vocabulary: "applied" (Kit replied) | "unconfirmed" | "error"; only "applied" is a Kit ACK.
  const okMs = ack.filter((s) => s.status === "applied" && s.ms !== null).map((s) => s.ms).sort((a, b) => a - b);
  const pct = (p) => (okMs.length ? okMs[Math.min(okMs.length - 1, Math.floor(p * (okMs.length - 1) + 0.5))] : null);
  result.ack = {
    n: ack.length, ok: okMs.length, statuses: ack.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {}),
    median_ms: pct(0.5), p95_ms: pct(0.95), max_ms: okMs.length ? okMs[okMs.length - 1] : null, min_ms: okMs.length ? okMs[0] : null,
  };

  const viewerFrame = page.frames().find((f) => f.url() === iframeSrc) ?? page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(new URL(iframeSrc).origin));
  if (!viewerFrame) throw new Error("viewer frame not attached");
  result.video = await viewerFrame.evaluate(async (windowS) => {
    const video = document.querySelector("video");
    if (!video) return { error: "no video element" };
    const q0 = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    let callbacks = 0;
    let stop = false;
    if (video.requestVideoFrameCallback) {
      const onFrame = () => { callbacks += 1; if (!stop) video.requestVideoFrameCallback(onFrame); };
      video.requestVideoFrameCallback(onFrame);
    }
    await new Promise((resolve) => setTimeout(resolve, windowS * 1000));
    stop = true;
    const q1 = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    return {
      width: video.videoWidth, height: video.videoHeight, ready_state: video.readyState, window_s: windowS,
      rvfc_fps: Math.round((callbacks / windowS) * 10) / 10,
      quality_fps: q0 && q1 ? Math.round(((q1.totalVideoFrames - q0.totalVideoFrames) / windowS) * 10) / 10 : null,
      dropped_frames: q0 && q1 ? q1.droppedVideoFrames - q0.droppedVideoFrames : null,
    };
  }, FPS_WINDOW_S);
  result.stream_disconnects = await page.evaluate(() => window.__ra1.filter((m) => m.type === "stream_state").length);
  result.run_at_end = await runStatus(page.request);
} catch (error) {
  result.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
  process.exitCode = 1;
} finally {
  result.finished_utc = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, `${LABEL}-${TRIAL}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
}
