import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { useViewportSlot, type ViewportSlotApi } from "./viewportSlot";
import type { CameraState } from "../cameraViewBridge";

let root: Root, box: HTMLDivElement;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
});
afterEach(() => { act(() => root.unmount()); box.remove(); });

const ortho: CameraState = { projection: "orthographic", position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0],
  targetDistance: 30, fovDeg: null, orthoHeight: 12 };
async function flush(n = 4) { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); }

it("invalidates the confirmed camera on reset_camera and frame_all, but not on other toolbar actions", async () => {
  let slot: ViewportSlotApi;
  function Probe() { slot = useViewportSlot()!; return null; }
  act(() => root.render(<ViewportSlotProvider><Probe /></ViewportSlotProvider>));
  const sendCameraView = vi.fn(() => Promise.resolve(
    { status: "applied" as const, clientRequestId: "c1", requestId: "r1", camera: ortho }));
  const queryCameraState = vi.fn(() => Promise.resolve(
    { status: "applied" as const, clientRequestId: "c1", requestId: "r1", camera: ortho }));
  const sendToolbarAction = vi.fn();
  act(() => {
    slot.registerHostActions?.({ sendCameraView, queryCameraState, sendToolbarAction });
    slot.setGate({ canSend: true, reason: "" });
  });

  // reset_camera invalidates a confirmed camera and forwards the action.
  act(() => { slot.sendCameraView?.({ action: "projection", projection: "orthographic" }); });
  await flush();
  expect(slot!.cameraViewState!.status).toBe("applied");
  act(() => { slot.sendToolbarAction("reset_camera"); });
  expect(slot!.cameraViewState!.status).toBe("unconfirmed");
  expect(sendToolbarAction).toHaveBeenCalledWith("reset_camera", undefined);

  // frame_all also invalidates a confirmed camera.
  act(() => { slot.sendCameraView?.({ action: "projection", projection: "orthographic" }); });
  await flush();
  expect(slot!.cameraViewState!.status).toBe("applied");
  act(() => { slot.sendToolbarAction("frame_all"); });
  expect(slot!.cameraViewState!.status).toBe("unconfirmed");
  expect(sendToolbarAction).toHaveBeenCalledWith("frame_all", undefined);

  // Other toolbar actions must not invalidate the confirmed camera.
  act(() => { slot.sendCameraView?.({ action: "projection", projection: "orthographic" }); });
  await flush();
  expect(slot!.cameraViewState!.status).toBe("applied");
  act(() => { slot.sendToolbarAction("toggle_fullscreen"); });
  expect(slot!.cameraViewState!.status).toBe("applied");
  expect(sendToolbarAction).toHaveBeenCalledWith("toggle_fullscreen", undefined);
});
