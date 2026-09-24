import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const repo = path.resolve("..");
const output = path.join(repo, "docs/evidence/a1-delivery/receipt-states");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const states = ["loading", "pending", "delivered", "dead_letter", "error", "missing", "incomplete"];
const observations: Record<string, unknown>[] = [];

for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`receipt reference/current ${viewport.width}x${viewport.height}`, async ({ page, browser }) => {
    await mkdir(output, { recursive: true });
    await page.setViewportSize(viewport);
    const captures: Record<string, { path: string; sha256: string }> = {};
    const textByState = new Map<string, string>();
    const requests: { method: string; path: string }[] = [];
    page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) {
      requests.push({ method: request.method(), path: new URL(request.url()).pathname + new URL(request.url()).search });
    } });
    for (const surface of ["reference", "current"]) {
      await page.goto(`/e2e/support/a1-outbox-preview.html?surface=${surface}&capture=${Date.now()}`);
      for (const state of states) {
        const frame = page.frameLocator(`iframe[title="${state}"]`);
        const button = frame.getByRole("button", { name: "重新查詢遞送狀態" });
        await expect(button).toBeVisible();
        if (state === "loading") await expect(button).toBeDisabled();
        else await expect(button).toBeEnabled();
        const note = frame.locator(".ec-note");
        if (surface === "reference") textByState.set(state, await note.innerText());
        else {
          await expect(note).toHaveText(textByState.get(state)!, { useInnerText: true });
          expect(await note.innerText()).toBe(textByState.get(state));
        }
      }
      const file = `${viewport.width}x${viewport.height}-${surface}.png`;
      const bytes = await page.screenshot({ path: path.join(output, file), fullPage: true, animations: "disabled" });
      captures[surface] = { path: `docs/evidence/a1-delivery/receipt-states/${file}`, sha256: hash(bytes) };
    }
    const reference = PNG.sync.read(await readFile(path.join(repo, captures.reference.path)));
    const current = PNG.sync.read(await readFile(path.join(repo, captures.current.path)));
    expect([current.width, current.height]).toEqual([reference.width, reference.height]);
    const fidelity = JSON.parse(await readFile(path.join(repo, "docs/plans/design-system-reference.manifest.json"), "utf8")).fidelity_contract;
    const changedPixels = pixelmatch(reference.data, current.data, undefined, current.width, current.height, { threshold: fidelity.pixelmatch_color_threshold });
    const changedRatio = changedPixels / (current.width * current.height);
    expect(changedRatio, "state references must meet the existing design tolerance").toBeLessThanOrEqual(fidelity.max_diff_pixel_ratio);
    const beforeRetry = requests.length;
    const errorFrame = page.frameLocator('iframe[title="error"]');
    await errorFrame.getByRole("button", { name: "重新查詢遞送狀態" }).click();
    await expect(errorFrame.locator(".ec-note")).toContainText("尚未確認送達");
    expect(requests.slice(beforeRetry)).toEqual([{ method: "GET", path: "/api/callback-outbox/summary?limit=200" }]);
    expect(requests).toHaveLength(states.length + 1);
    expect(requests.every(request => request.method === "GET")).toBe(true);
    observations.push({ viewport, browser: browser.version(), dpr: await page.evaluate(() => devicePixelRatio),
      captures, changed_pixels: changedPixels, changed_pixel_ratio: changedRatio, max_diff_pixel_ratio: fidelity.max_diff_pixel_ratio,
      states, retry: "one GET summary; no POST", requests });
  });
}

test.afterAll(async () => {
  const files = ["web-viewer-sample/src/console/A1OutboxStatus.tsx", "web-viewer-sample/src/coordinatorClient/client.ts",
    "web-viewer-sample/src/coordinatorClient/transport.ts", "web-viewer-sample/src/coordinatorClient/routes.ts",
    "docs/plans/AI-BIM Console Hi-Fi.dc.html", "web-viewer-sample/e2e/support/a1-outbox-preview.tsx",
    "web-viewer-sample/e2e/support/a1-outbox-preview.config.ts", "web-viewer-sample/e2e/a1-outbox-design.spec.ts"];
  const source = await Promise.all(files.map(async file => ({ path: file, sha256: hash(await readFile(path.join(repo, file))) })));
  await writeFile(path.join(output, "../receipt-state-reference.json"), JSON.stringify({
    schema_version: 1, kind: "supplemental-a1-receipt-design-evidence", reference_anchor: "a1-delivery-state-reference",
    scope: "7 authored state references vs production A1OutboxStatus; design-only loopback coordinator fixture",
    limitations: "Does not extend the existing 13-screen required pixel runner or prove real cloud/Kit delivery.",
    subject_head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    subject_note: "Source hashes identify the rendered working-tree files; subject_head is their parent until committed.",
    source_sha256: source, observations,
  }, null, 2) + "\n");
});
