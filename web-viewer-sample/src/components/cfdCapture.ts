import { drawCfdHud, type CfdHudModel } from "./cfdHud";

export interface CfdCaptureOptions { format: "png" | "webm"; durationSeconds?: number }
export interface CfdCaptureResult { blob: Blob; filename: string; width: number; height: number }
export interface CfdCaptureFrame { video: HTMLVideoElement; hud: CfdHudModel; heading: number | null }

export function parseCfdCaptureOptions(value: unknown): CfdCaptureOptions | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.format === "png" && v.durationSeconds === undefined) return { format: "png" };
  if (v.format === "webm" && typeof v.durationSeconds === "number" && Number.isInteger(v.durationSeconds)
    && v.durationSeconds >= 1 && v.durationSeconds <= 20) return { format: "webm", durationSeconds: v.durationSeconds };
  return null;
}

export function captureFilename(hud: CfdHudModel, format: CfdCaptureOptions["format"], utc: string): string {
  return `cfd_${hud.runId.slice(-12)}_w${String(hud.windFrom).padStart(3, "0")}_${utc.replace(/[^0-9TZ]/g, "")}.${format}`;
}

/** Captures the actual remote video and the same painter as the visible HUD. No source stream tracks are owned here. */
export async function captureCfdView(options: CfdCaptureOptions, current: () => CfdCaptureFrame | null,
  signal: AbortSignal): Promise<CfdCaptureResult> {
  if (!parseCfdCaptureOptions(options)) throw new Error("invalid_capture_options");
  const initial = current();
  if (!initial) throw new Error("capture_unavailable");
  const { video, hud } = initial;
  const width = video.videoWidth, height = video.videoHeight;
  if (!width || !height || video.readyState < 2) throw new Error("video_frame_unavailable");
  // Solver time advances within one source; all other HUD/binding changes still invalidate capture.
  const sourceIdentity = (value: CfdHudModel) => JSON.stringify(value.temporal
    ? { ...value, temporal: { ...value.temporal, physicalTimeSeconds: null, sampleIndex: null } } : value);
  const identity = sourceIdentity(hud);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  const utc = new Date().toISOString();
  const check = () => {
    const frame = current();
    if (signal.aborted || !frame || frame.video !== video || sourceIdentity(frame.hud) !== identity
      || video.readyState < 2 || video.videoWidth !== width || video.videoHeight !== height) {
      throw new Error("capture_cancelled_or_source_changed");
    }
    return frame;
  };
  const paint = () => {
    const frame = check();
    ctx.drawImage(video, 0, 0, width, height);
    drawCfdHud(ctx, width, height, frame.hud, frame.heading, new Date().toISOString());
  };
  paint();
  let blob: Blob;
  if (options.format === "png") {
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value =>
      value ? resolve(value) : reject(new Error("png_encode_failed")), "image/png"));
    check();
  } else {
    if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") throw new Error("webm_unsupported");
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("webm_unsupported");
    const stream = canvas.captureStream(30);
    let animation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    try {
      blob = await new Promise<Blob>((resolve, reject) => {
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks: Blob[] = [];
        let bytes = 0, failed = false;
        const fail = (error: Error) => {
          if (failed) return;
          failed = true;
          try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* Preserve the original capture failure. */ }
          reject(error);
        };
        abort = () => fail(new Error("capture_cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        recorder.ondataavailable = event => {
          bytes += event.data.size;
          if (bytes > 128 * 1024 * 1024) { fail(new Error("capture_size_limit")); return; }
          if (!failed && event.data.size) chunks.push(event.data);
        };
        recorder.onerror = () => fail(new Error("webm_encode_failed"));
        recorder.onstop = () => {
          if (failed) return;
          try { check(); if (!bytes) throw new Error("empty_capture"); resolve(new Blob(chunks, { type: mimeType })); }
          catch (error) { fail(error instanceof Error ? error : new Error("capture_failed")); }
        };
        const tick = () => {
          if (failed || recorder.state === "inactive") return;
          try { paint(); animation = requestAnimationFrame(tick); }
          catch (error) { fail(error instanceof Error ? error : new Error("capture_failed")); }
        };
        try {
          check(); recorder.start(250); animation = requestAnimationFrame(tick);
          timer = setTimeout(() => {
            try { if (recorder.state !== "inactive") recorder.stop(); }
            catch { fail(new Error("webm_encode_failed")); }
          }, options.durationSeconds! * 1000);
        } catch (error) { fail(error instanceof Error ? error : new Error("capture_failed")); }
      });
    } finally {
      clearTimeout(timer); cancelAnimationFrame(animation); signal.removeEventListener("abort", abort);
      stream.getTracks().forEach(track => track.stop());
    }
  }
  return { blob, filename: captureFilename(hud, options.format, utc), width, height };
}
