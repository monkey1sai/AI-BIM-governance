import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { refusedViewerGate } from "../viewerGate";
import { OPEN_GATE } from "./__testdata__/viewerGates";
import { fakeViewerHostActions, fakeViewportSlot } from "./__testdata__/viewportSlot";
import { WorkspacePage } from "./WorkspacePage";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { ViewportSlotContext, useViewportSlot, type ViewportSlotApi } from "./viewportSlot";
import { setLang } from "../i18n";
import type { CameraState, CameraViewState } from "../../viewerCommandChannel/camera";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";

let container: HTMLDivElement, root: Root | null;
async function flush(n = 6) { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  setLang("zh");
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = null;
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); container.remove(); vi.restoreAllMocks(); });

/** 相機（視角與讀取共用）回報 `camera`，其餘指令為 idle。 */
function slot(overrides: Partial<ViewportSlotApi>, camera: CameraViewState = { status: "idle" }): ViewportSlotApi {
  const commandState = (command: string) => (command === "camera_view" || command === "camera_state" ? camera : { status: "idle" });
  return fakeViewportSlot({
    activeSessionId: "session_camera", gate: OPEN_GATE, commandState: commandState as ViewportSlotApi["commandState"],
    ...overrides,
  });
}
async function render(api: ViewportSlotApi) {
  root = createRoot(container);
  await act(async () => { root!.render(<ViewportSlotContext.Provider value={api}><WorkspacePage initialDock="a1" /></ViewportSlotContext.Provider>); });
  await flush();
}
const q = <T extends Element>(selector: string) => container.querySelector<T>(selector)!;
const orthographicCamera: CameraState = { projection: "orthographic", position: [0, 0, 1],
  direction: [0, 0, -1], up: [0, 1, 0], targetDistance: 1, fovDeg: null, orthoHeight: 5 };
const orthographic: CameraViewState = { status: "applied", camera: orthographicCamera };

it("toolbar camera button opens the view tools and projection toggles to orthographic", async () => {
  const sendCameraView = vi.fn();
  await render(slot({ commands: fakeViewerCommandPort({ camera_view: sendCameraView }) }));
  const cameraButton = q<HTMLButtonElement>('[data-testid="ws-toolbar-camera-view"]');
  expect(cameraButton.disabled).toBe(false);
  await act(async () => { cameraButton.click(); });
  expect(q<HTMLDetailsElement>('[data-uc="ws-camera-view"]').open).toBe(true);
  const projection = q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]');
  expect(projection.getAttribute("aria-pressed")).toBe("false");
  await act(async () => { projection.click(); });
  expect(sendCameraView).toHaveBeenCalledWith({ action: "projection", projection: "orthographic" });
  await act(async () => { q<HTMLButtonElement>('[data-testid="camera-preset-front"]').click(); });
  expect(sendCameraView).toHaveBeenLastCalledWith({ action: "preset", view: "front", scope: "building" });
});
it("projection toggles back to perspective after an orthographic readback", async () => {
  const sendCameraView = vi.fn();
  await render(slot({ commands: fakeViewerCommandPort({ camera_view: sendCameraView }) }, orthographic));
  const projection = q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]');
  expect(projection.getAttribute("aria-pressed")).toBe("true");
  await act(async () => { projection.click(); });
  expect(sendCameraView).toHaveBeenCalledWith({ action: "projection", projection: "perspective" });
});
it("fly tools send speed and read the camera", async () => {
  const setFlySpeed = vi.fn(), readCamera = vi.fn();
  await render(slot({ commands: fakeViewerCommandPort({ fly_navigation: setFlySpeed, camera_state: readCamera }) }));
  await act(async () => { q<HTMLButtonElement>('[data-testid="fly-speed-apply"]').click(); });
  await act(async () => { q<HTMLButtonElement>('[data-testid="fly-read-camera"]').click(); });
  expect(setFlySpeed).toHaveBeenCalledWith(1);
  expect(readCamera).toHaveBeenCalledTimes(1);
});
it("camera and projection buttons stay disabled while the viewer cannot receive commands", async () => {
  await render(slot({ gate: refusedViewerGate("waiting_datachannel") }));
  expect(q<HTMLButtonElement>('[data-testid="ws-toolbar-camera-view"]').disabled).toBe(true);
  expect(q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]').disabled).toBe(true);
  expect(q<HTMLButtonElement>('[data-testid="camera-preset-top"]').disabled).toBe(true);
});
it("projection button waits while a camera command is pending", async () => {
  await render(slot({}, { status: "pending" }));
  expect(q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]').disabled).toBe(true);
});
it("building and whole-model views invalidate the confirmed camera and send their toolbar action; other buttons do not", async () => {
  let api!: ViewportSlotApi;
  function Probe() { api = useViewportSlot()!; return null; }
  root = createRoot(container);
  await act(async () => { root!.render(<ViewportSlotProvider><Probe /><WorkspacePage initialDock="a1" /></ViewportSlotProvider>); });
  await flush();
  const host = fakeViewerHostActions({ commands: fakeViewerCommandPort({
    camera_view: async () => ({ status: "applied", clientRequestId: "c1", requestId: "r1", camera: orthographicCamera }),
  }) });
  await act(async () => {
    api.registerHostActions(host);
    api.setActiveSessionId("session_camera");
    api.setGate(OPEN_GATE);
  });
  const confirmCamera = async () => {
    await act(async () => { q<HTMLButtonElement>('[data-testid="camera-preset-top"]').click(); });
    await flush();
    expect(api.commandState("camera_view").status).toBe("applied");
  };
  await confirmCamera();
  await act(async () => { q<HTMLButtonElement>('[data-testid="ws-toolbar-reset"]').click(); });
  expect(api.commandState("camera_view").status).toBe("unconfirmed");
  expect(host.sendToolbarAction).toHaveBeenLastCalledWith("reset_camera");
  await confirmCamera();
  await act(async () => { q<HTMLButtonElement>('[data-testid="ws-toolbar-frame-all"]').click(); });
  expect(api.commandState("camera_view").status).toBe("unconfirmed");
  expect(host.sendToolbarAction).toHaveBeenLastCalledWith("frame_all");
  await confirmCamera();
  await act(async () => {
    q<HTMLButtonElement>('[data-testid="ws-toolbar-camera-view"]').click();
    q<HTMLButtonElement>('[data-testid="ws-toolbar-fullscreen"]').click();
    api.hostActions!.sendToolbarAction("toggle_fullscreen");
  });
  expect(api.commandState("camera_view").status).toBe("applied");
  expect(host.sendToolbarAction).toHaveBeenLastCalledWith("toggle_fullscreen");
});
