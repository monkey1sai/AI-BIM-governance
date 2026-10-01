import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayPresentationControls, presentationPrims } from "./OverlayPresentationControls";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";
import type { OverlayPlaybackState, OverlayVisibilityState } from "../../viewerCommandChannel/overlayControls";
import type { OverlayStyleState } from "../../viewerCommandChannel/overlayStyle";

const path = "/World/Overlays/Cfd/run_w000/FlowParticles";
const direction = { presentation: { version: 2, prims: [{ name: "FlowParticles", role: "particles" }] } };
let root: Root, box: HTMLDivElement;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
});
afterEach(() => { act(() => root.unmount()); box.remove(); });
describe("overlay presentation controls", () => {
  it("styles only the declared pressure layer and never reports another layer's opacity as confirmed", async () => {
    const pressurePath = "/World/Overlays/Cfd/run_w000/BuildingSurfacePressure";
    const send = vi.fn(async () => ({ status: "unconfirmed" as const }));
    const commands = fakeViewerCommandPort({ overlay_style: send });
    const pressureDirection = { presentation: { version: 2, prims: [{ name: "BuildingSurfacePressure", role: "surface_pressure" }] } };
    const render = (state: OverlayStyleState, ready = true, present = true) => act(() => root.render(
      <OverlayPresentationControls artifactId="cfd:run:w000" direction={pressureDirection} ready={ready} commands={commands}
        styleState={state} visibility={{ status: "applied", items: [{ primPath: pressurePath, present, visible: true }] }} />));
    const slider = () => box.querySelector<HTMLInputElement>('[data-testid="wind-pressure-opacity-slider"]')!;
    const status = () => box.querySelector('[data-testid="wind-pressure-opacity-status"]')!.textContent;
    render({ status: "idle" });
    await act(async () => { [...box.querySelectorAll("button")].find(button => button.textContent === "半透明 0.35")!.click(); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ primPath: pressurePath, displayOpacity: 0.35 });
    expect(status()).toContain("尚未確認");
    render({ status: "applied", primPath: "/World/Overlays/Cfd/run_w000/PedestrianWind_1p5m", displayOpacity: 0.6 });
    expect(status()).toContain("尚未確認");
    render({ status: "applied", primPath: pressurePath, displayOpacity: 0.35 });
    expect(status()).toContain("Kit 已套用壓力透明度 0.35");
    render({ status: "pending" });
    expect(slider().disabled).toBe(true);
    render({ status: "unconfirmed" }, false);
    expect(slider().disabled).toBe(true);
    expect(status()).toContain("尚未確認");
    render({ status: "idle" }, true, false);
    expect(slider().disabled).toBe(true);
  });
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
