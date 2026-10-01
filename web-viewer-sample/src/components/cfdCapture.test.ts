import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureCfdView, captureFilename, parseCfdCaptureOptions, type CfdCaptureFrame } from "./cfdCapture";
import { drawCfdHud, type CfdHudModel } from "./cfdHud";

vi.mock("./cfdHud", () => ({ drawCfdHud: vi.fn() }));
const hud: CfdHudModel = { revisionId: "rev", runId: "cfd_20261001T062133Z_158afc", windFrom: 22.5, modelBearing: 22.5,
  northLabel: "project north", validationLevel: "screening", purpose: "design_comparison_only", velocity: null, pressure: null };
let frame: CfdCaptureFrame | null;
let ownedStop: ReturnType<typeof vi.fn>;
let sourceStop: ReturnType<typeof vi.fn>;
let captureDescriptor: PropertyDescriptor | undefined;
class Recorder {
  static isTypeSupported(type: string) { return type.endsWith("vp8"); }
  state = "inactive";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["encoded frame"]) }); this.onstop?.(); }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  ownedStop = vi.fn(); sourceStop = vi.fn();
  const video = document.createElement("video");
  Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 }, readyState: { value: 3 },
    srcObject: { value: { getTracks: () => [{ stop: sourceStop }] } } });
  frame = { video, hud, heading: 0 };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["png"], { type: "image/png" })));
  captureDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "captureStream");
  Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", { configurable: true, value: () => ({ getTracks: () => [{ stop: ownedStop }] }) });
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (captureDescriptor) Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", captureDescriptor);
  else Reflect.deleteProperty(HTMLCanvasElement.prototype, "captureStream");
});

describe("CFD local capture", () => {
  it("rejects unbounded or malformed durations and uses no project name in filenames", () => {
    for (const durationSeconds of [0, 21, .5, NaN, "5"]) expect(parseCfdCaptureOptions({ format: "webm", durationSeconds })).toBeNull();
    expect(parseCfdCaptureOptions({ format: "png", durationSeconds: 5 })).toBeNull();
    expect(captureFilename(hud, "png", "2026-10-01T06:21:33.123Z")).toBe("cfd_2133Z_158afc_w22.5_20261001T062133123Z.png");
  });
  it("uses native video dimensions and the shared HUD painter for PNG", async () => {
    const result = await captureCfdView({ format: "png" }, () => frame, new AbortController().signal);
    expect(result).toMatchObject({ width: 1920, height: 1080 });
    expect(result.blob.type).toBe("image/png");
    expect(drawCfdHud).toHaveBeenCalledWith(expect.anything(), 1920, 1080, hud, 0, expect.any(String));
    expect(sourceStop).not.toHaveBeenCalled();
  });
  it("falls back to VP8 and stops only its canvas tracks", async () => {
    const pending = captureCfdView({ format: "webm", durationSeconds: 2 }, () => frame, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(result.blob.type).toBe("video/webm;codecs=vp8");
    expect(ownedStop).toHaveBeenCalledOnce(); expect(sourceStop).not.toHaveBeenCalled();
  });
  it("keeps recording across physical-time readbacks for the same run and binding", async () => {
    frame = { ...frame!, hud: { ...hud, temporal: { mode: "urans_sampled", physicalTimeSeconds: .5, sampleIndex: 0, sampleCount: 19 } } };
    const outcome = captureCfdView({ format: "webm", durationSeconds: 2 }, () => frame, new AbortController().signal)
      .then(() => true, () => false);
    await vi.advanceTimersByTimeAsync(500);
    frame = { ...frame!, hud: { ...frame!.hud, temporal: { ...frame!.hud.temporal!, physicalTimeSeconds: 1, sampleIndex: 1 } } };
    await vi.advanceTimersByTimeAsync(1500);
    expect(await outcome).toBe(true);
    expect(vi.mocked(drawCfdHud).mock.calls.some(call => call[3].temporal?.physicalTimeSeconds === 1)).toBe(true);
    expect(sourceStop).not.toHaveBeenCalled();
  });
  it("still cancels transient recording when its binding revision changes", async () => {
    frame = { ...frame!, hud: { ...hud, temporal: { mode: "urans_sampled", physicalTimeSeconds: .5, sampleIndex: 0, sampleCount: 19 } } };
    const pending = captureCfdView({ format: "webm", durationSeconds: 2 }, () => frame, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow("source_changed");
    frame = { ...frame!, hud: { ...frame!.hud, revisionId: "new" } };
    await vi.advanceTimersByTimeAsync(20); await rejected;
    expect(ownedStop).toHaveBeenCalledOnce(); expect(sourceStop).not.toHaveBeenCalled();
  });
  it("discards partial recording when the result identity changes", async () => {
    const pending = captureCfdView({ format: "webm", durationSeconds: 2 }, () => frame, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow("source_changed");
    frame = { ...frame!, hud: { ...hud, revisionId: "new" } };
    await vi.advanceTimersByTimeAsync(20); await rejected;
    expect(ownedStop).toHaveBeenCalledOnce(); expect(sourceStop).not.toHaveBeenCalled();
  });
  it("cancels recording and cleans owned tracks without returning a partial blob", async () => {
    const controller = new AbortController();
    const pending = captureCfdView({ format: "webm", durationSeconds: 20 }, () => frame, controller.signal);
    const rejected = expect(pending).rejects.toThrow("cancelled"); controller.abort(); await rejected;
    expect(ownedStop).toHaveBeenCalledOnce(); expect(sourceStop).not.toHaveBeenCalled();
  });
});
