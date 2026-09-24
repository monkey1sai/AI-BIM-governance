// Viewport Slot 的 viewer 指令狀態（docs/architecture/viewport-slot-adr.md §3）：registry 每個一問一答指令跑同一組行為，
// host 註冊的是假的 command port；family 分組、量測與 host actions 另外驗證。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { refusedViewerGate } from "../viewerGate";
import { MAPPING_STALE_GATE, OPEN_GATE } from "./__testdata__/viewerGates";
import { fakeViewerHostActions } from "./__testdata__/viewportSlot";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { useViewportSlot, type ViewportSlotApi } from "./viewportSlot";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";
import type { CameraState } from "../../viewerCommandChannel/camera";
import {
  VIEWER_COMMAND_REQUESTS, type CorrelatedViewerCommand, type ViewerCommandFamily, type ViewerCommandInputs, type ViewerCommandReplies,
} from "../../viewerCommandChannel/registry";

const camera: CameraState = { projection: "perspective", position: [0, 0, 30], direction: [0, 0, -1], up: [0, 1, 0],
  targetDistance: 30, fovDeg: 40, orthoHeight: null };
const OVERLAY_PRIM = "/World/Overlays/Cfd/cfd_20260921T070000Z_ui0001/PedestrianWind_1p5m";

/** 每個指令一筆：合法輸入、不合法輸入（沒有則為 undefined）、host 回覆的成功結果。 */
const CASES: { [C in CorrelatedViewerCommand]: { input: ViewerCommandInputs[C]; invalid?: unknown; applied: ViewerCommandReplies[C] } } = {
  camera_view: { input: { action: "preset", view: "top", scope: "building" }, invalid: { action: "preset", view: "up", scope: "building" },
    applied: { status: "applied", clientRequestId: "c1", requestId: "r1", camera } },
  camera_state: { input: null, applied: { status: "applied", clientRequestId: "c1", requestId: "r1", camera } },
  fly_navigation: { input: 3, invalid: 0, applied: { status: "applied", clientRequestId: "c1", requestId: "r1", speed: 3 } },
  overlay_style: { input: { primPath: OVERLAY_PRIM, displayOpacity: 0.4 }, invalid: { primPath: "/World/Elements/Wall", displayOpacity: 0.4 },
    applied: { status: "applied", clientRequestId: "c1", requestId: "r1", primPath: OVERLAY_PRIM, displayOpacity: 0.4 } },
  section_plane: { input: { enabled: true, axis: "z", direction: 1, position: 2 }, invalid: { enabled: true, axis: "q", direction: 1, position: 2 },
    applied: { status: "applied", clientRequestId: "c1", requestId: "r1", effective: { enabled: true, axis: "z", direction: 1, position: 2 } } },
};
const COMMANDS = Object.keys(VIEWER_COMMAND_REQUESTS) as CorrelatedViewerCommand[];
const FAMILIES = [...new Set(COMMANDS.map(command => VIEWER_COMMAND_REQUESTS[command].family))];

type Handler = (input: unknown) => Promise<unknown>;
let root: Root, box: HTMLDivElement, slot: ViewportSlotApi;
function Probe() { slot = useViewportSlot()!; return null; }
async function flush(n = 4) { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); }
/** host 的 command port 只回應給了 handler 的指令，其餘回 unavailable。 */
function registerHost(handlers: Partial<Record<CorrelatedViewerCommand, Handler>>, controlMeasurement?: () => boolean) {
  const commands = fakeViewerCommandPort(handlers as Parameters<typeof fakeViewerCommandPort>[0], controlMeasurement);
  act(() => { slot.registerHostActions(fakeViewerHostActions({ commands })); });
}
const send = <C extends CorrelatedViewerCommand>(command: C, input: unknown = CASES[command].input) =>
  slot.commands.send(command, input as ViewerCommandInputs[C]);
const never = () => new Promise<never>(() => {});

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
  act(() => root.render(<ViewportSlotProvider><Probe /></ViewportSlotProvider>));
});
afterEach(() => { act(() => root.unmount()); box.remove(); });

describe("every registered viewer command through the Viewport Slot", () => {
  it("is covered by this suite", () => {
    expect([...COMMANDS].sort()).toEqual(Object.keys(CASES).sort());
  });

  describe.each(COMMANDS)("%s", command => {
    const { input, invalid, applied } = CASES[command];
    const family = VIEWER_COMMAND_REQUESTS[command].family;

    it("goes pending, sends once through the host port and stores the reply", async () => {
      const handler = vi.fn<Handler>(async () => applied);
      registerHost({ [command]: handler });
      act(() => slot.setGate(OPEN_GATE));
      expect(slot.commandState(command)).toEqual({ status: "idle" });
      let reply!: Promise<unknown>;
      act(() => { reply = send(command); });
      expect(slot.commandState(command)).toEqual({ status: "pending" });
      await flush();
      expect(slot.commandState(command)).toEqual(applied);
      await expect(reply).resolves.toEqual(applied);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(input);
    });

    it("refuses invalid input without sending", async () => {
      if (invalid === undefined) return;
      const handler = vi.fn<Handler>(async () => applied);
      registerHost({ [command]: handler });
      act(() => slot.setGate(OPEN_GATE));
      let reply!: Promise<unknown>;
      act(() => { reply = send(command, invalid); });
      await expect(reply).resolves.toEqual({ status: "error", reason: "invalid" });
      expect(slot.commandState(command)).toEqual({ status: "error", reason: "invalid" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("answers unavailable while the command gate is closed or no host is registered", async () => {
      const handler = vi.fn<Handler>(async () => applied);
      registerHost({ [command]: handler });
      act(() => slot.setGate(refusedViewerGate("waiting_datachannel")));
      let reply!: Promise<unknown>;
      act(() => { reply = send(command); });
      await expect(reply).resolves.toEqual({ status: "error", reason: "unavailable" });
      expect(slot.commandState(command)).toEqual({ status: "error", reason: "unavailable" });
      act(() => { slot.registerHostActions(null); slot.setGate(OPEN_GATE); });
      act(() => { reply = send(command); });
      await expect(reply).resolves.toEqual({ status: "error", reason: "unavailable" });
      expect(slot.commandState(command)).toEqual({ status: "error", reason: "unavailable" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("answers busy to a second send while its family is pending", async () => {
      const handler = vi.fn<Handler>(never);
      registerHost({ [command]: handler });
      act(() => slot.setGate(OPEN_GATE));
      let second!: Promise<unknown>;
      act(() => { void send(command); second = send(command); });
      await flush();
      await expect(second).resolves.toEqual({ status: "error", reason: "busy" });
      expect(slot.commandState(command)).toEqual({ status: "pending" });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("drops a late reply once its family is invalidated", async () => {
      let resolve!: (reply: unknown) => void;
      registerHost({ [command]: () => new Promise(done => { resolve = done; }) });
      act(() => slot.setGate(OPEN_GATE));
      let reply!: Promise<unknown>;
      act(() => { reply = send(command); });
      await flush();
      act(() => slot.invalidateCommands(family));
      expect(slot.commandState(command)).toEqual({ status: "unconfirmed" });
      await act(async () => { resolve(applied); });
      await flush();
      expect(slot.commandState(command)).toEqual({ status: "unconfirmed" });
      await expect(reply).resolves.toEqual({ status: "unconfirmed" });
    });

    it("keeps sending while only batch highlights are refused and discards a reply after a session change", async () => {
      let resolve!: (reply: unknown) => void;
      const handler = vi.fn<Handler>(() => new Promise(done => { resolve = done; }));
      registerHost({ [command]: handler });
      act(() => { slot.setActiveSessionId("review_session_one"); slot.setGate(MAPPING_STALE_GATE); });
      act(() => { void send(command); void send(command); });
      await flush();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(slot.commandState(command)).toEqual({ status: "pending" });
      act(() => slot.setActiveSessionId("review_session_two"));
      await act(async () => { resolve(applied); });
      await flush();
      expect(slot.commandState(command)).toEqual({ status: "unconfirmed" });
    });

    it("maps a thrown send to a transport error", async () => {
      registerHost({ [command]: async () => { throw new Error("private"); } });
      act(() => slot.setGate(OPEN_GATE));
      let reply!: Promise<unknown>;
      act(() => { reply = send(command); });
      await flush();
      expect(slot.commandState(command)).toEqual({ status: "error", reason: "transport" });
      await expect(reply).resolves.toEqual({ status: "error", reason: "transport" });
    });

    it("is invalidated by its own family, by every family and by a closed gate, but not by another family", async () => {
      registerHost({ [command]: async () => applied });
      act(() => slot.setGate(OPEN_GATE));
      const confirm = async () => {
        act(() => { void send(command); });
        await flush();
        expect(slot.commandState(command)).toEqual(applied);
      };
      await confirm();
      for (const other of FAMILIES.filter(candidate => candidate !== family)) act(() => slot.invalidateCommands(other));
      expect(slot.commandState(command)).toEqual(applied);
      act(() => slot.invalidateCommands(family));
      expect(slot.commandState(command)).toEqual({ status: "unconfirmed" });
      await confirm();
      act(() => slot.invalidateCommands());
      expect(slot.commandState(command)).toEqual({ status: "unconfirmed" });
      await confirm();
      act(() => slot.setGate(refusedViewerGate("waiting_first_frame")));
      expect(slot.commandState(command)).toEqual({ status: "unconfirmed" });
    });
  });
});

describe("viewer command families", () => {
  it("camera view and camera state share one state and one request; fly, overlay style and section stay separate", async () => {
    const handlers = Object.fromEntries(COMMANDS.map(command => [command, vi.fn<Handler>(never)])) as Record<CorrelatedViewerCommand, Mock<Handler>>;
    registerHost(handlers);
    act(() => slot.setGate(OPEN_GATE));
    act(() => { void send("camera_view"); });
    expect(slot.commandState("camera_state")).toEqual({ status: "pending" });
    let busy!: Promise<unknown>;
    act(() => { busy = send("camera_state"); });
    await expect(busy).resolves.toEqual({ status: "error", reason: "busy" });
    act(() => { void send("fly_navigation"); void send("overlay_style"); void send("section_plane"); });
    await flush();
    expect(COMMANDS.filter(command => handlers[command].mock.calls.length > 0).sort())
      .toEqual(["camera_view", "fly_navigation", "overlay_style", "section_plane"]);
    const families: ViewerCommandFamily[] = ["camera", "fly", "overlay", "section"];
    expect([...FAMILIES].sort()).toEqual(families);
    for (const command of ["fly_navigation", "overlay_style", "section_plane"] as const) {
      expect(slot.commandState(command)).toEqual({ status: "pending" });
    }
  });

  it("invalidating every family also marks the measurement unconfirmed; invalidating one family does not", () => {
    act(() => slot.setMeasurementState({ status: "result", distanceMetres: 2.3 }));
    for (const family of FAMILIES) act(() => slot.invalidateCommands(family));
    expect(slot.measurementState).toEqual({ status: "result", distanceMetres: 2.3 });
    act(() => slot.invalidateCommands());
    expect(slot.measurementState).toEqual({ status: "unconfirmed" });
  });
});

describe("measurement control", () => {
  it("starts only through an open command gate, and reports a refused control as unavailable", () => {
    const control = vi.fn(() => true);
    registerHost({}, control);
    expect(slot.controlMeasurement("start")).toBe(false);
    expect(slot.commands.controlMeasurement("start")).toBe(false);
    expect(control).not.toHaveBeenCalled();
    expect(slot.controlMeasurement("cancel")).toBe(true);
    act(() => slot.setGate(OPEN_GATE));
    expect(slot.commands.controlMeasurement("start")).toBe(true);
    expect(control).toHaveBeenCalledWith("start");
    control.mockReturnValue(false);
    act(() => { expect(slot.controlMeasurement("clear")).toBe(false); });
    expect(slot.measurementState).toEqual({ status: "error", reason: "unavailable" });
  });
});

describe("host actions", () => {
  it("are exposed as registered; replacing them keeps confirmed state, unregistering invalidates every command", async () => {
    registerHost({ section_plane: async () => CASES.section_plane.applied });
    act(() => slot.setGate(OPEN_GATE));
    act(() => { void send("section_plane"); });
    await flush();
    expect(slot.commandState("section_plane")).toEqual(CASES.section_plane.applied);
    const replacement = fakeViewerHostActions();
    act(() => slot.registerHostActions(replacement));
    expect(slot.hostActions).toBe(replacement);
    expect(slot.commandState("section_plane")).toEqual(CASES.section_plane.applied);
    act(() => slot.registerHostActions(null));
    expect(slot.hostActions).toBeNull();
    expect(slot.commandState("section_plane")).toEqual({ status: "unconfirmed" });
  });
});
