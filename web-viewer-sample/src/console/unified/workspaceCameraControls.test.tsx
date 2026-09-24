import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { refusedViewerGate } from "../viewerGate";
import { OPEN_GATE } from "./__testdata__/viewerGates";
import { WorkspacePage } from "./WorkspacePage";
import { ViewportSlotContext, type ViewportSlotApi } from "./viewportSlot";
import { setLang } from "../i18n";
import type { CameraViewState } from "../../viewerCommandChannel/camera";

let container: HTMLDivElement, root: Root | null;
async function flush(n = 6) { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  setLang("zh");
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = null;
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); container.remove(); vi.restoreAllMocks(); });

function slot(overrides: Partial<ViewportSlotApi>): ViewportSlotApi {
  return {
    registerSlot: vi.fn(), slotEl: null, publish: vi.fn(), publishViewer: vi.fn(), viewerPublication: null,
    subscribeDock: vi.fn(() => vi.fn()), dockSubscription: null, publication: null,
    activeSessionId: "session_camera", setActiveSessionId: vi.fn(),
    gate: OPEN_GATE, setGate: vi.fn(), stageTree: [], setStageTree: vi.fn(),
    requestStageTree: vi.fn(), selectPrim: vi.fn(), sendToolbarAction: vi.fn(), registerHostActions: vi.fn(),
    ...overrides,
  };
}
async function render(api: ViewportSlotApi) {
  root = createRoot(container);
  await act(async () => { root!.render(<ViewportSlotContext.Provider value={api}><WorkspacePage initialDock="a1" /></ViewportSlotContext.Provider>); });
  await flush();
}
const q = <T extends Element>(selector: string) => container.querySelector<T>(selector)!;
const orthographic: CameraViewState = { status: "applied", camera: { projection: "orthographic", position: [0, 0, 1],
  direction: [0, 0, -1], up: [0, 1, 0], targetDistance: 1, fovDeg: null, orthoHeight: 5 } };

it("toolbar camera button opens the view tools and projection toggles to orthographic", async () => {
  const sendCameraView = vi.fn();
  await render(slot({ sendCameraView }));
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
  await render(slot({ sendCameraView, cameraViewState: orthographic }));
  const projection = q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]');
  expect(projection.getAttribute("aria-pressed")).toBe("true");
  await act(async () => { projection.click(); });
  expect(sendCameraView).toHaveBeenCalledWith({ action: "projection", projection: "perspective" });
});
it("fly tools send speed and read the camera", async () => {
  const sendFlySpeed = vi.fn(), refreshCameraState = vi.fn();
  await render(slot({ sendFlySpeed, refreshCameraState }));
  await act(async () => { q<HTMLButtonElement>('[data-testid="fly-speed-apply"]').click(); });
  await act(async () => { q<HTMLButtonElement>('[data-testid="fly-read-camera"]').click(); });
  expect(sendFlySpeed).toHaveBeenCalledWith(1);
  expect(refreshCameraState).toHaveBeenCalledTimes(1);
});
it("camera and projection buttons stay disabled while the viewer cannot receive commands", async () => {
  const sendCameraView = vi.fn();
  await render(slot({ sendCameraView, gate: refusedViewerGate("waiting_datachannel") }));
  expect(q<HTMLButtonElement>('[data-testid="ws-toolbar-camera-view"]').disabled).toBe(true);
  expect(q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]').disabled).toBe(true);
  expect(q<HTMLButtonElement>('[data-testid="camera-preset-top"]').disabled).toBe(true);
});
it("projection button waits while a camera command is pending", async () => {
  await render(slot({ sendCameraView: vi.fn(), cameraViewState: { status: "pending" } }));
  expect(q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]').disabled).toBe(true);
});
