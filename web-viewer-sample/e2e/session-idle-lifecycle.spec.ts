import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { io as connectSocket, type Socket } from "socket.io-client";
import {
  loadIsolatedStackConfig,
  requireReal,
  watchForbiddenRequests,
} from "./support/isolated-stack";

const isolated = loadIsolatedStackConfig();
const COORDINATOR = isolated?.coordinatorBaseUrl ?? "";

type CreatedSession = { session_id: string; trace_id: string };

async function createSession(request: APIRequestContext, suffix: string): Promise<CreatedSession> {
  const response = await request.post(`${COORDINATOR}/api/review-sessions`, {
    data: {
      project_id: `idle_e2e_${suffix}`,
      model_version_id: `idle_e2e_${suffix}`,
      created_by: "session-idle-lifecycle-e2e",
      artifact_bindings: [],
    },
  });
  requireReal(response.ok(), `session create failed: ${response.status()}`);
  const payload = await response.json() as Partial<CreatedSession>;
  requireReal(
    typeof payload.session_id === "string" && typeof payload.trace_id === "string",
    "session create response is missing canonical ids",
  );
  return payload as CreatedSession;
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), 5_000);
    socket.emit(event, payload, (ack: T) => {
      clearTimeout(timeout);
      resolve(ack);
    });
  });
}

async function joinObserver(session: CreatedSession): Promise<Socket> {
  const socket = connectSocket(`${COORDINATOR}/review`, {
    forceNew: true,
    transports: ["websocket"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("observer socket connect timed out")), 5_000);
    socket.once("connect", () => { clearTimeout(timeout); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timeout); reject(error); });
  });
  const ack = await emitAck<{ ok?: boolean }>(socket, "joinSession", {
    session_id: session.session_id,
    trace_id: session.trace_id,
    user_id: "idle-e2e-observer",
    display_name: "Idle E2E observer",
  });
  requireReal(ack.ok === true, "observer join was rejected");
  const readiness = await emitAck<{ ok?: boolean }>(socket, "streamReadiness", {
    session_id: session.session_id,
    trace_id: session.trace_id,
    ready: true,
  });
  requireReal(readiness.ok === true, "observer stream readiness was rejected");
  return socket;
}

async function openViewer(page: Page, session: CreatedSession): Promise<void> {
  await page.goto(`/?session=${encodeURIComponent(session.session_id)}&trace_id=${encodeURIComponent(session.trace_id)}&debug=1`);
  await expect(page.locator("body")).toContainText("Socket.IO trace 已驗證", { timeout: 15_000 });
}

test.describe("session idle lifecycle functional and semantic evidence", () => {
  test.skip(!isolated, "requires E2E_REQUIRE_REAL=1 isolated branch stack");
  if (!isolated) return;
  test.setTimeout(90_000);

  test("countdown, activity cancellation, heartbeat, successful keepalive, and expiry remain truthful", async ({ page, request }, testInfo) => {
    const forbidden = watchForbiddenRequests(page, isolated.coordinatorBaseUrl);
    const session = await createSession(request, "browser");
    const observer = await joinObserver(session);
    try {
      await openViewer(page, session);
      const countdown = page.getByTestId("session-idle-countdown-banner");
      await expect(countdown).toBeVisible({ timeout: 10_000 });

      await page.mouse.click(24, 24);
      await expect(countdown).toBeHidden({ timeout: 5_000 });

      await expect(countdown).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(5_100);
      await page.keyboard.press("A");
      await expect(countdown).toBeHidden({ timeout: 5_000 });

      await expect(countdown).toBeVisible({ timeout: 10_000 });
      const beforeHeartbeat = Number(await countdown.locator("strong").textContent());
      const heartbeat = await emitAck<{ ok?: boolean }>(observer, "heartbeat", {
        session_id: session.session_id,
        trace_id: session.trace_id,
      });
      expect(heartbeat.ok).toBe(true);
      await expect.poll(async () => Number(await countdown.locator("strong").textContent()), {
        timeout: 4_000,
      }).toBeLessThan(beforeHeartbeat);
      await expect(countdown).toBeVisible();

      await page.getByTestId("session-idle-keepalive-btn").click();
      await expect(page.getByTestId("session-idle-keepalive-error")).toBeHidden();
      await expect(countdown).toBeHidden({ timeout: 5_000 });
      await expect(countdown).toBeVisible({ timeout: 10_000 });

      const closedEvent = new Promise<Record<string, unknown>>((resolve) => observer.once("session:closed", resolve));
      await expect(page.getByTestId("session-idle-closed")).toContainText("閒置自動回收", { timeout: 15_000 });
      await expect(closedEvent).resolves.toMatchObject({
        session_id: session.session_id,
        trace_id: session.trace_id,
        reason: "inactivity",
      });
      const stored = await request.get(`${COORDINATOR}/api/review-sessions/${session.session_id}`);
      expect(stored.ok()).toBe(true);
      expect(await stored.json()).toMatchObject({ status: "closed" });
      const events = await request.get(`${COORDINATOR}/api/review-sessions/${session.session_id}/events`);
      expect(events.ok()).toBe(true);
      const eventPayload = JSON.stringify(await events.json());
      expect(eventPayload).toContain('"type":"sessionClosed"');
      expect(eventPayload).toContain('"reason":"inactivity"');
      forbidden.assertClean();
      await testInfo.attach("session-lifecycle-runtime-ids", {
        body: JSON.stringify({ session_id: session.session_id, trace_id: session.trace_id }),
        contentType: "application/json",
      });
    } finally {
      observer.disconnect();
    }
  });

  test("explicit keepalive reports failure when both browser transports are offline", async ({ page, request }) => {
    const session = await createSession(request, "offline_keepalive");
    try {
      await openViewer(page, session);
      const countdown = page.getByTestId("session-idle-countdown-banner");
      await expect(countdown).toBeVisible({ timeout: 10_000 });

      await page.context().setOffline(true);
      await page.getByTestId("session-idle-keepalive-btn").click();

      await expect(page.getByTestId("session-idle-keepalive-error")).toContainText("未獲 coordinator 確認");
      await expect(countdown).toBeVisible();
    } finally {
      await page.context().setOffline(false);
      await request.post(`${COORDINATOR}/api/review-sessions/${session.session_id}/close`, {
        data: { reason: "e2e-cleanup" },
      });
    }
  });

  test("continuous acknowledged activity prevents age-based reclamation", async ({ request }, testInfo) => {
    const session = await createSession(request, "continuous");
    const observer = await joinObserver(session);
    try {
      for (let index = 0; index < 12; index += 1) {
        const activity = await emitAck<{ ok?: boolean }>(observer, "userActivity", {
          session_id: session.session_id,
          trace_id: session.trace_id,
        });
        expect(activity.ok).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const stored = await request.get(`${COORDINATOR}/api/review-sessions/${session.session_id}`);
      expect(stored.ok()).toBe(true);
      expect(await stored.json()).toMatchObject({ status: "active" });
      const idle = await request.get(`${COORDINATOR}/api/review-sessions/${session.session_id}/idle-status`);
      expect(idle.ok()).toBe(true);
      expect(await idle.json()).toMatchObject({ is_counting_down: false });
      await testInfo.attach("continuous-activity-runtime-ids", {
        body: JSON.stringify({ session_id: session.session_id, trace_id: session.trace_id }),
        contentType: "application/json",
      });
    } finally {
      observer.disconnect();
      await request.post(`${COORDINATOR}/api/review-sessions/${session.session_id}/close`, {
        data: { reason: "e2e-cleanup" },
      });
    }
  });
});
