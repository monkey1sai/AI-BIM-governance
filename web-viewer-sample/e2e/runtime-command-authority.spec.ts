import { expect, test, type Frame, type FrameLocator, type Page } from "@playwright/test";
import { harnessRoute } from "./harnessRoute";

const VIEWER_BASE_URL =
  process.env.E2E_VIEWER_BASE_URL ||
  `http://127.0.0.1:${process.env.E2E_VIEWER_PORT || "5180"}`;
const VIEWER_ORIGIN = new URL(VIEWER_BASE_URL).origin;
const PARENT_ORIGIN = VIEWER_ORIGIN;

type RuntimeRejection = {
  rejected_event_type: string;
  reason: "lease_invalid";
  retryable: boolean;
  runtime_state: "unchanged" | "changed_unconfirmed";
  detail_code?: string;
};

type FakeKitControl = {
  rejectNext(rejection: RuntimeRejection): void;
  eventTypes(): string[];
};

async function viewerFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().map((candidate) => candidate.url()).join("\n")).toContain("harness=1");
  const frame = page.frames().find((candidate) => candidate.url().includes("harness=1"));
  if (!frame) throw new Error("viewer harness frame not found");
  return frame;
}

async function queueRejection(frame: Frame, rejection: RuntimeRejection): Promise<void> {
  await frame.evaluate((next) => {
    const control = (globalThis as typeof globalThis & { __AI_BIM_FAKE_KIT__?: FakeKitControl })
      .__AI_BIM_FAKE_KIT__;
    if (!control) throw new Error("FakeKit control is unavailable");
    control.rejectNext(next);
  }, rejection);
}

async function eventCount(frame: Frame, eventType: string): Promise<number> {
  return frame.evaluate((expected) => {
    const control = (globalThis as typeof globalThis & { __AI_BIM_FAKE_KIT__?: FakeKitControl })
      .__AI_BIM_FAKE_KIT__;
    if (!control) throw new Error("FakeKit control is unavailable");
    return control.eventTypes().filter((value) => value === expected).length;
  }, eventType);
}

async function installEmbeddedParent(page: Page): Promise<{
  viewer: FrameLocator;
  frame: Frame;
  setActiveRevision: (revision: string) => void;
}> {
  let activeRevision: string | null = null;
  const statusRoute = `${PARENT_ORIGIN}/api/review-sessions/**/viewer-leases/status`;

  await page.route(statusRoute, async (route) => {
    const headers = await route.request().allHeaders();
    if (headers["x-user-token"] !== "[redacted]") {
      throw new Error("controlled status resync did not provide the public redacted carrier");
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stage_binding: {
          transaction_status: activeRevision ? "active" : "executing",
          active_binding_revision: activeRevision,
          last_good_binding_revision: activeRevision,
        },
      }),
    });
  });

  await page.route(`${PARENT_ORIGIN}/e2e/runtime-command-parent`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html>
        <html><body style="margin:0;background:#0b1220">
          <script>
            window.__vg01Messages = [];
            window.addEventListener("message", (event) => {
              const iframe = document.getElementById("viewer-frame");
              if (event.origin === ${JSON.stringify(VIEWER_ORIGIN)} && event.source === iframe.contentWindow) {
                window.__vg01Messages.push(event.data);
              }
            });
            window.__deliverViewerAuthority = () => {
              const iframe = document.getElementById("viewer-frame");
              window.__viewerAuthority ||= {
                leaseToken: "lease_" + crypto.randomUUID(),
                userToken: "[redacted]",
              };
              iframe.contentWindow.postMessage({
                protocol: "vg01",
                type: "viewer_lease_token",
                token: window.__viewerAuthority.leaseToken,
                user_token: window.__viewerAuthority.userToken,
              }, ${JSON.stringify(VIEWER_ORIGIN)});
            };
          </script>
          <iframe
            id="viewer-frame"
            title="runtime-authority-viewer"
            style="width:1440px;height:900px;border:0"
            src="${VIEWER_ORIGIN}${harnessRoute({
              harnessAuthority: "1",
              coordinatorApiBase: PARENT_ORIGIN,
            })}"
          ></iframe>
        </body></html>`,
    });
  });

  await page.goto(`${PARENT_ORIGIN}/e2e/runtime-command-parent`);
  const viewer = page.frameLocator("#viewer-frame");
  const frame = await viewerFrame(page);
  await expect(viewer.getByTestId("harness-viewport-label")).toContainText("stream ready", { timeout: 25_000 });
  await page.waitForFunction(() => (
    (window as typeof window & { __vg01Messages?: Array<{ type?: string }> }).__vg01Messages ?? []
  ).some((message) => message.type === "viewer_ready"));

  return {
    viewer,
    frame,
    setActiveRevision: (revision) => { activeRevision = revision; },
  };
}

test.describe("runtime command authority controlled browser evidence", () => {
  test("visible authority rejection is one-shot and only an explicit retry mutates", async ({ page }, testInfo) => {
    await page.goto(harnessRoute());
    const label = page.getByTestId("harness-viewport-label");
    await expect(label).toContainText("stage:", { timeout: 25_000 });
    const frame = await viewerFrame(page);

    await queueRejection(frame, {
      rejected_event_type: "focusPrimRequest",
      reason: "lease_invalid",
      retryable: true,
      runtime_state: "unchanged",
      detail_code: "authority_unavailable",
    });

    await page.getByText("Building", { exact: true }).click();
    await expect(page.getByTestId("runtime-command-rejection")).toBeVisible();
    await expect(page.getByTestId("runtime-authority-unavailable")).toContainText("操作授權服務暫時不可用");
    await expect(label).toContainText("stage: harness://stage/World/sample-building.usd");
    expect(await eventCount(frame, "focusPrimRequest")).toBe(1);
    await page.waitForTimeout(500);
    await expect(label).toContainText("stage: harness://stage/World/sample-building.usd");
    expect(await eventCount(frame, "focusPrimRequest")).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("authority-rejection.png"), fullPage: true });

    // Tree selection is additive; clear the prior Building selection so focus
    // follows the explicit retry target instead of the first Set entry.
    await page.getByText("Building", { exact: true }).click();
    await page.getByText("Site", { exact: true }).click();
    await expect(label).toContainText("focus: /World/Site");
    await expect(page.getByTestId("runtime-command-rejection")).toBeHidden();
    expect(await eventCount(frame, "focusPrimRequest")).toBe(2);
  });

  test("late trusted authority opens once; changed-unconfirmed blocks until authenticated resync", async ({ page }, testInfo) => {
    const embedded = await installEmbeddedParent(page);
    const label = embedded.viewer.getByTestId("harness-viewport-label");

    await page.waitForTimeout(500);
    expect(await eventCount(embedded.frame, "openStageRequest")).toBe(0);

    await page.evaluate(() => {
      (window as typeof window & { __deliverViewerAuthority?: () => void }).__deliverViewerAuthority?.();
    });
    await expect(label).toContainText("stage:", { timeout: 15_000 });
    expect(await eventCount(embedded.frame, "openStageRequest")).toBe(1);

    await page.evaluate(() => {
      (window as typeof window & { __deliverViewerAuthority?: () => void }).__deliverViewerAuthority?.();
    });
    await page.waitForTimeout(500);
    expect(await eventCount(embedded.frame, "openStageRequest")).toBe(1);

    await embedded.viewer.getByTestId("nav-issues").click();
    await embedded.viewer.getByTestId("binding-select-artifact_h_building").check();
    await embedded.viewer.getByTestId("binding-primary-artifact_h_building").check();
    await embedded.viewer.getByTestId("binding-apply").click();

    const successfulLifecycle = embedded.viewer
      .getByTestId("runtime-command-lifecycle-entry")
      .filter({ hasText: "composeStageRequest" })
      .last();
    await expect(successfulLifecycle).toContainText("pending → executing → terminal");
    await expect(successfulLifecycle).toContainText("success");

    await queueRejection(embedded.frame, {
      rejected_event_type: "composeStageRequest",
      reason: "lease_invalid",
      retryable: false,
      runtime_state: "changed_unconfirmed",
      detail_code: "completion_unconfirmed",
    });
    await page.waitForTimeout(5);
    await embedded.viewer.getByTestId("binding-apply").click();

    const rejection = embedded.viewer.getByTestId("runtime-command-rejection");
    await expect(rejection).toContainText("stage 已變更但尚未由 coordinator 證實");
    await expect(embedded.viewer.getByTestId("runtime-command-resync")).toBeVisible();

    const blockedRevision = await page.waitForFunction(() => {
      const messages = (window as typeof window & {
        __vg01Messages?: Array<{ type?: string; status?: string; binding_revision_id?: string }>;
      }).__vg01Messages ?? [];
      return messages.find((message) => (
        message.type === "stage_loaded"
        && message.status === "unproven"
        && typeof message.binding_revision_id === "string"
      ))?.binding_revision_id ?? null;
    }).then((handle) => handle.jsonValue());
    if (typeof blockedRevision !== "string") throw new Error("unproven binding revision was not observed");

    await embedded.viewer.getByTestId("nav-model").click();
    await embedded.viewer.getByText("Building", { exact: true }).click();
    await page.waitForTimeout(250);
    expect(await eventCount(embedded.frame, "focusPrimRequest")).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("changed-unconfirmed-blocked.png"), fullPage: true });

    embedded.setActiveRevision(blockedRevision);
    await embedded.viewer.getByTestId("runtime-command-resync").click();
    await expect(rejection).toBeHidden();

    await embedded.viewer.getByText("Building", { exact: true }).click();
    await embedded.viewer.getByText("Site", { exact: true }).click();
    await expect(label).toContainText("focus: /World/Site");
    expect(await eventCount(embedded.frame, "focusPrimRequest")).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("changed-unconfirmed-resync.png"), fullPage: true });
  });
});
