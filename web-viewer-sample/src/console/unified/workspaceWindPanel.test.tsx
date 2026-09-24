// WorkspacePage 接到風環境面板的四條線（docs/architecture/viewport-slot-adr.md 2026-09-24 修訂）：真 provider，
// 面板換成記下 props 的替身。面板拿 slot 的 commands 與 host 的 applyStageBinding；overlayStyleState 讀 overlay 狀態，
// invalidateOverlayStyle 只讓 overlay family 失效。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const windPanelProps = vi.hoisted(() => vi.fn());

vi.mock("./WindEnvironmentPanel", () => ({
  WindEnvironmentPanel: (props: Record<string, unknown>) => { windPanelProps(props); return null; },
}));

import { setLang } from "../i18n";
import { spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";
import { OPEN_GATE } from "./__testdata__/viewerGates";
import { fakeViewerHostActions } from "./__testdata__/viewportSlot";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import type { WindEnvironmentPanelProps } from "./WindEnvironmentPanel";
import { WorkspacePage } from "./WorkspacePage";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { useViewportSlot, type ViewportSlotApi } from "./viewportSlot";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";
import type { CameraReply, FlyReply } from "../../viewerCommandChannel/camera";
import type { OverlayStyleInput, OverlayStyleReply } from "../../viewerCommandChannel/overlayStyle";
import type { SectionInput, SectionReply } from "../../viewerCommandChannel/sectionPlane";

const OVERLAY: OverlayStyleInput = { primPath: "/World/Overlays/Cfd/cfd_20260921T070000Z_ui0001/PedestrianWind_1p5m", displayOpacity: 0.4 };
const OVERLAY_APPLIED: OverlayStyleReply = { status: "applied", clientRequestId: "c1", requestId: "r1", ...OVERLAY };
const SECTION: SectionInput = { enabled: true, axis: "z", direction: 1, position: 2 };
const SECTION_APPLIED: SectionReply = { status: "applied", clientRequestId: "c2", requestId: "r2", effective: SECTION };
const CAMERA_APPLIED: CameraReply = { status: "applied", clientRequestId: "c3", requestId: "r3", camera: { projection: "perspective",
  position: [0, 0, 30], direction: [0, 0, -1], up: [0, 1, 0], targetDistance: 30, fovDeg: 40, orthoHeight: null } };
const FLY_APPLIED: FlyReply = { status: "applied", clientRequestId: "c4", requestId: "r4", speed: 3 };
const MEASURED = { status: "result", distanceMetres: 2.3 } as const;

let container: HTMLDivElement, root: Root | null, api: ViewportSlotApi;
async function flush(n = 6) { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); }
function Probe() { api = useViewportSlot()!; return null; }
/** 面板最近一次 render 收到的 props。 */
const panel = () => windPanelProps.mock.calls[windPanelProps.mock.calls.length - 1][0] as WindEnvironmentPanelProps;

beforeEach(() => {
  setLang("zh");
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  coordinatorStatusStore.reset();
  spyCoordinatorEndpointsOffline();
  windPanelProps.mockClear();
  container = document.createElement("div"); document.body.appendChild(container); root = null;
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); container.remove(); vi.restoreAllMocks(); });

async function renderWorkspace() {
  root = createRoot(container);
  await act(async () => { root!.render(<ViewportSlotProvider><Probe /><WorkspacePage initialDock="a1" /></ViewportSlotProvider>); });
  await flush();
}
/** 註冊 command port 對四種指令都回 applied 的 host，並開啟指令閘門。 */
async function registerOpenHost(host = fakeViewerHostActions({ commands: fakeViewerCommandPort({
  overlay_style: async () => OVERLAY_APPLIED,
  section_plane: async () => SECTION_APPLIED,
  camera_view: async () => CAMERA_APPLIED,
  fly_navigation: async () => FLY_APPLIED,
}) })) {
  await act(async () => {
    api.registerHostActions(host);
    api.setActiveSessionId("review_session_wind");
    api.setGate(OPEN_GATE);
  });
  return host;
}

it("gives the wind panel the slot's commands and the registered host's applyStageBinding", async () => {
  await renderWorkspace();
  expect(panel().commands).toBe(api.commands);
  expect(panel().applyStageBinding).toBeUndefined();
  const host = await registerOpenHost();
  expect(panel().commands).toBe(api.commands);
  expect(panel().applyStageBinding).toBe(host.applyStageBinding);
});

it("feeds the wind panel the overlay style state, not another family's", async () => {
  await renderWorkspace();
  await registerOpenHost();
  expect(panel().overlayStyleState).toEqual({ status: "idle" });
  await act(async () => { await panel().commands!.send("overlay_style", OVERLAY); });
  expect(api.commandState("section_plane")).toEqual({ status: "idle" });
  expect(panel().overlayStyleState).toEqual(OVERLAY_APPLIED);
  await act(async () => { await api.commands.send("section_plane", SECTION); });
  expect(panel().overlayStyleState).toEqual(OVERLAY_APPLIED);
});

it("lets the wind panel invalidate only the overlay family, leaving the other families and the measurement confirmed", async () => {
  await renderWorkspace();
  await registerOpenHost();
  await act(async () => {
    await api.commands.send("overlay_style", OVERLAY);
    await api.commands.send("section_plane", SECTION);
    await api.commands.send("camera_view", { action: "preset", view: "top", scope: "building" });
    await api.commands.send("fly_navigation", 3);
  });
  act(() => { api.setMeasurementState(MEASURED); });
  expect(panel().overlayStyleState).toEqual(OVERLAY_APPLIED);
  act(() => { panel().invalidateOverlayStyle!(); });
  expect(panel().overlayStyleState).toEqual({ status: "unconfirmed" });
  expect(api.commandState("overlay_style")).toEqual({ status: "unconfirmed" });
  expect(api.commandState("section_plane")).toEqual(SECTION_APPLIED);
  expect(api.commandState("camera_view")).toEqual(CAMERA_APPLIED);
  expect(api.commandState("fly_navigation")).toEqual(FLY_APPLIED);
  expect(api.measurementState).toEqual(MEASURED);
});
