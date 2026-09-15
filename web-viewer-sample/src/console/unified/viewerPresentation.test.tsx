import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelpHint } from "../components";
import { MockViewport } from "../viewer/MockViewport";
import { useViewerFullscreen } from "./useViewerFullscreen";

function Harness() {
  const viewer = useViewerFullscreen();
  return <div className="uc-root"><header><button>background</button></header><div data-uc="page-root">
    <div ref={viewer.workspaceRef}>
      <button ref={viewer.buttonRef} aria-pressed={viewer.expanded} onClick={() => { void (viewer.expanded ? viewer.exit() : viewer.enter()); }}>fullscreen</button>
    </div>
    <iframe title="stable-viewer" src="about:blank" />
  </div></div>;
}

describe("viewer-first presentation (no GPU evidence)", () => {
  it("workspace stream fills the available height without the legacy auto-height override", () => {
    const css = readFileSync(resolve(process.cwd(), "src/console/unified/operator-workflow.css"), "utf8");
    const legacy = css.indexOf('.uc-root [data-uc="viewport"] .op-viewer-stream {');
    const workspace = css.indexOf('.uc-root [data-uc="viewport"] > .op-viewer-stream {');
    expect(legacy).toBeGreaterThanOrEqual(0);
    expect(workspace).toBeGreaterThan(legacy);
    expect(css.slice(workspace, css.indexOf("}", workspace))).toContain("height: 100% !important");
    const viewerCss = readFileSync(resolve(process.cwd(), "src/console/viewer/viewer.css"), "utf8");
    expect(viewerCss).toContain('.gv-stage[data-presentation="workspace"] #main-div { height: 100%;');
    expect(viewerCss).toContain('.gv-stage[data-presentation="workspace"] #remote-video { position: absolute; display: block; object-fit: contain; object-position: center; }');
    // Source guard only: real iframe/video dimensions are verified in the browser.
  });
  let container: HTMLDivElement;
  let root: Root;
  let previousAct: unknown;
  beforeEach(() => {
    previousAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove(); vi.restoreAllMocks();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = previousAct;
  });
  async function mount() { await act(async () => root.render(<Harness />)); }
  const target = () => container.querySelector<HTMLElement>("[data-uc='page-root']")!;
  const button = () => container.querySelector<HTMLButtonElement>("[aria-pressed]")!;
  async function click() { await act(async () => button().click()); }

  it("fills the app, restores on Escape, and never replaces the sibling iframe", async () => {
    await mount(); const iframe = container.querySelector("iframe");
    await click();
    expect(target().dataset.viewerExpanded).toBe("true");
    expect(container.querySelector("header")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector("iframe")).toBe(iframe);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(target().dataset.viewerExpanded).toBeUndefined();
    expect(container.querySelector("header")?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(button());
    await click(); await click();
    expect(target().dataset.viewerExpanded).toBeUndefined();
    expect(container.querySelector("iframe")).toBe(iframe);
  });
  it("does not request native fullscreen and cleans the ancestor when the workspace leaves", async () => {
    await mount(); const ancestor = target();
    const request = vi.fn(); ancestor.requestFullscreen = request;
    await click();
    expect(request).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    expect(ancestor.dataset.viewerExpanded).toBeUndefined();
  });
  it("help starts closed, has a hover title, opens on click and closes on Escape", async () => {
    await act(async () => root.render(<HelpHint label="Help" text="Model identity is verified separately." />));
    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    expect(details.open).toBe(false);
    expect(summary.title).toBe("Model identity is verified separately.");
    await act(async () => summary.click());
    expect(details.open).toBe(true);
    await act(async () => summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });
  it("no-frame viewer keeps diagnostics closed without claiming real rendering", async () => {
    await act(async () => root.render(<MockViewport />));
    expect(container.querySelector<HTMLDetailsElement>("[data-testid='viewer-waiting-details']")?.open).toBe(false);
    expect(container.querySelector(".gv-waiting-status")?.textContent).toContain("尚未收到真實視訊幀");
    expect(container.querySelector("video")).toBeNull();
  });
});
