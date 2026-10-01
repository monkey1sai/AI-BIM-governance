import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayPresentationControls, presentationPrims } from "./OverlayPresentationControls";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";
import type { OverlayPlaybackReply, OverlayPlaybackState, OverlayVisibilityState } from "../../viewerCommandChannel/overlayControls";
import type { OverlayStyleState } from "../../viewerCommandChannel/overlayStyle";

const path = "/World/Overlays/Cfd/run_w000/FlowParticles";
const direction = { presentation: { version: 2, prims: [{ name: "FlowParticles", role: "particles" }] } };
let root: Root, box: HTMLDivElement;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
});
afterEach(() => { act(() => root.unmount()); box.remove(); vi.useRealTimers(); });
describe("overlay presentation controls", () => {
  const transient = { presentation: { version: 2, prims: [], animation: { mode: "urans_sampled" }, temporal: {
    mode: "urans_sampled", solver: "pimpleFoam", fixed_geometry: true, interpolation: "sample_hold",
    sample_times_s: [.5, 1, 1.5], output_interval_s: .5, requested_duration_s: 10, complete_requested_duration: false,
  } } };
  it("polls once per interval across port rerenders, stops on unmount and labels only the exact run/sample", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => ({ status: "unconfirmed" as const }));
    const render = (playback: OverlayPlaybackState) => act(() => root.render(<OverlayPresentationControls
      artifactId="cfd:cfd_loaded_run:w000" direction={transient} ready
      commands={fakeViewerCommandPort({ overlay_playback: send })} playback={playback} />));
    const reply = { status: "applied" as const, playing: false, rate: 1, timeSeconds: .5,
      runId: "cfd_loaded_run", sampleIndex: 1, physicalTimeSeconds: 1 };
    await act(async () => render(reply));
    expect(send).toHaveBeenCalledTimes(1);
    expect(box.textContent).toContain("物理時間 1.00 s");
    await act(async () => render({ ...reply, physicalTimeSeconds: .9 }));
    expect(box.textContent).not.toContain("物理時間 0.90");
    await act(async () => render({ ...reply, runId: "cfd_other_run" }));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(send).toHaveBeenCalledTimes(2);
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("does not overlap a pending query and exposes a transport failure without an automatic retry loop", async () => {
    vi.useFakeTimers();
    let fail!: (reason: Error) => void;
    const send = vi.fn(() => new Promise<OverlayPlaybackReply>((_, reject) => { fail = reject; }));
    await act(async () => root.render(<OverlayPresentationControls artifactId="cfd:cfd_loaded_run:w000"
      direction={transient} ready commands={fakeViewerCommandPort({ overlay_playback: send })} />));
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => fail(new Error("transport closed")));
    expect(box.textContent).toContain("物理時間讀取中斷");
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("queries authored transient visibility before showing a pressure legend, without writing visibility", async () => {
    const read = vi.fn(async () => ({ status: "unconfirmed" as const }));
    await act(async () => root.render(<OverlayPresentationControls artifactId="cfd:cfd_loaded_run:w000"
      direction={{ presentation: { ...transient.presentation, prims: [{ name: "BuildingSurfacePressure", role: "surface_pressure" }] } }}
      ready commands={fakeViewerCommandPort({ overlay_visibility: read })} />));
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith({ items: [{ primPath: "/World/Overlays/Cfd/cfd_loaded_run_w000/BuildingSurfacePressure" }] });
  });
  it("labels a declared visual ROI without changing the computation claim or inventing one for old results", () => {
    const commands = fakeViewerCommandPort({});
    const render = (source: string | null) => act(() => root.render(<OverlayPresentationControls artifactId="cfd:run:w000"
      direction={{ presentation: { ...direction.presentation, ...(source ? { visual_roi: {
        source, extent_m: [50, 60, 20], horizontal_margin_h: 1, top_margin_h: 0.25,
      } } : {}) } }} ready commands={commands} />));
    render("ifc_envelope");
    expect(box.textContent).toContain("聚焦建築主體");
    expect(box.textContent).toContain("計算域與行人雲圖統計不變");
    render("retained_geometry");
    expect(box.textContent).toContain("無主體分類");
    render(null);
    expect(box.querySelector('[data-testid="wind-visual-roi"]')).toBeNull();
  });
  it("shows sampled near-wall distance and waits for translucent material ACK before exposing the film", async () => {
    const nearPath = "/World/Overlays/Cfd/run_w000/NearWallWindSpeed";
    const style = vi.fn().mockResolvedValueOnce({ status: "error", reason: "rejected" })
      .mockResolvedValueOnce({ status: "applied", primPath: nearPath, displayOpacity: 0.35 });
    const visibility = vi.fn(async () => ({ status: "unconfirmed" as const }));
    const commands = fakeViewerCommandPort({ overlay_style: style, overlay_visibility: visibility });
    const presentation = { version: 2, prims: [{ name: "NearWallWindSpeed", role: "near_wall_speed" }] };
    const render = (metadata = true) => act(() => root.render(<OverlayPresentationControls artifactId="cfd:run:w000"
      direction={{ presentation: { ...presentation, ...(metadata ? { near_wall: {
        distance_m: 2, surface_cell_m: 1, reference: "computation_shell", interpolation: "cellPoint",
      } } : {}) } }} ready commands={commands} />));
    const show = () => box.querySelector<HTMLButtonElement>('[data-testid="wind-layer-show-NearWallWindSpeed"]')!;
    render();
    expect(box.textContent).toContain("距計算外殼 2.00 m");
    expect(box.textContent).toContain("非牆面速度");
    await act(async () => show().click());
    expect(style).toHaveBeenCalledWith({ primPath: nearPath, displayOpacity: 0.35 });
    expect(visibility).not.toHaveBeenCalled();
    await act(async () => show().click());
    expect(visibility).toHaveBeenCalledWith({ items: [{ primPath: nearPath, visible: true }] });
    render(false);
    expect(show().disabled).toBe(true);
    expect(box.textContent).toContain("缺少近壁取樣距離");
  });
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
