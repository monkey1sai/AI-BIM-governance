import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayPresentationControls, presentationPrims } from "./OverlayPresentationControls";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";
import type { OverlayPlaybackState, OverlayVisibilityState } from "../../viewerCommandChannel/overlayControls";

const path = "/World/Overlays/Cfd/run_w000/FlowParticles";
const direction = { presentation: { version: 2, prims: [{ name: "FlowParticles", role: "particles" }] } };
let root: Root, box: HTMLDivElement;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
});
afterEach(() => { act(() => root.unmount()); box.remove(); });
describe("overlay presentation controls", () => {
  it("keeps old results free of undeclared modes and ignores unknown or nested prims", () => {
    expect(presentationPrims({})).toEqual([]);
    expect(presentationPrims({ presentation: { version: 2, prims: [
      { name: "Injected/Child", role: "particles" }, { name: "Other", role: "unknown" },
      ...direction.presentation.prims, ...direction.presentation.prims,
    ] } })).toEqual(direction.presentation.prims);
  });
  it("shows only readback; resets confirmation on invalidation and disables absent layers", async () => {
    const send = vi.fn(async () => ({ status: "unconfirmed" as const }));
    const commands = fakeViewerCommandPort({ overlay_playback: send, overlay_visibility: send });
    const render = (visibility: OverlayVisibilityState, playback: OverlayPlaybackState, ready = true) => act(() => root.render(
      <OverlayPresentationControls artifactId="cfd:run:w000" direction={direction} commands={commands}
        ready={ready} visibility={visibility} playback={playback} />));
    render({ status: "idle" }, { status: "idle" });
    const rate = () => box.querySelector<HTMLSelectElement>('[data-testid="wind-playback-rate"]')!;
    expect(rate().value).toBe("");
    await act(async () => { box.querySelector<HTMLButtonElement>('[data-testid="wind-playback-play"]')!.click(); });
    expect(send).toHaveBeenCalledWith({ action: "play" });
    expect(rate().value).toBe("");
    render({ status: "applied", items: [{ primPath: path, visible: false, present: false }] },
      { status: "applied", playing: false, rate: 4, timeSeconds: 0.5 });
    expect(rate().value).toBe("4");
    expect(box.querySelector<HTMLButtonElement>('[data-testid="wind-layer-show-FlowParticles"]')!.disabled).toBe(true);
    render({ status: "unconfirmed" }, { status: "unconfirmed" }, false);
    expect(rate().value).toBe("");
    expect([...box.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
    expect(box.textContent).toContain("示意動畫");
  });
});
