import { afterEach, describe, expect, it, vi } from "vitest";
import { createViewerCommandParentSide, forwardViewerCommandPort, type ParentSidePorts, type ViewerCommandPort } from "./parentSide";
import { VIEWER_COMMAND_REQUESTS, type CorrelatedViewerCommand, type ViewerCommandInputs } from "./registry";
import type { ViewerCommandRequest } from "./viewerEmbedProtocol";

const camera = { projection: "perspective", position: [0, 0, 30], direction: [0, 0, -1], up: [0, 1, 0],
  targetDistance: 30, fovDeg: 40, orthoHeight: null };

/** 每個指令一筆：合法輸入、不合法輸入（沒有則為 undefined）、成功回覆的額外欄位。 */
const CASES: { [C in CorrelatedViewerCommand]: { input: ViewerCommandInputs[C]; invalid?: unknown; applied: Record<string, unknown> } } = {
  camera_view: { input: { action: "preset", view: "top", scope: "building" }, invalid: { action: "preset", view: "up", scope: "building" }, applied: { camera } },
  camera_state: { input: null, applied: { camera } },
  fly_navigation: { input: 3, invalid: 0, applied: { speed: 3 } },
  overlay_style: { input: { primPath: "/World/Overlays/Cfd/cfd_20260921T070000Z_ui0001/PedestrianWind_1p5m", displayOpacity: 0.4 }, invalid: { primPath: "/World/Elements/Wall", displayOpacity: 0.4 },
    applied: { primPath: "/World/Overlays/Cfd/cfd_20260921T070000Z_ui0001/PedestrianWind_1p5m", displayOpacity: 0.4 } },
  section_plane: { input: { enabled: true, axis: "z", direction: 1, position: 2 }, invalid: { enabled: true, axis: "q", direction: 1, position: 2 },
    applied: { effective: { enabled: true, axis: "z", direction: 1, position: 2 } } },
};
const COMMANDS = Object.keys(VIEWER_COMMAND_REQUESTS) as CorrelatedViewerCommand[];

function setup({ ready = true, postThrows = false } = {}) {
  let next = 0;
  const posted: ViewerCommandRequest[] = [];
  const ports = {
    ready: vi.fn(() => ready),
    post: vi.fn((message: ViewerCommandRequest) => { if (postThrows) throw new Error("gone"); posted.push(message); }),
    newId: vi.fn(() => `client_${++next}`),
    onInvalidated: vi.fn(),
    onMeasurementState: vi.fn(),
  } satisfies ParentSidePorts;
  const side = createViewerCommandParentSide(ports);
  const send = <C extends CorrelatedViewerCommand>(command: C, input: unknown = CASES[command].input) =>
    side.port.send(command, input as ViewerCommandInputs[C]);
  const reply = (command: CorrelatedViewerCommand, fields: Record<string, unknown>) =>
    side.acceptViewerMessage({ type: VIEWER_COMMAND_REQUESTS[command].replyType, ...fields });
  return { ports, side, send, reply, posted };
}
afterEach(() => { vi.useRealTimers(); });

describe("every registered console-side command", () => {
  it("is covered by this suite", () => {
    expect([...COMMANDS].sort()).toEqual(Object.keys(CASES).sort());
  });

  describe.each(COMMANDS)("%s", command => {
    it("posts its vg01 request with a fresh clientRequestId and settles only on the matching reply", async () => {
      const s = setup();
      const pending = s.send(command);
      expect(s.posted[0]).toMatchObject({ type: command, clientRequestId: "client_1" });
      expect(s.reply(command, { status: "applied", clientRequestId: "someone_else", requestId: "r0", ...CASES[command].applied })).toBe(true);
      s.reply(command, { status: "applied", clientRequestId: "client_1", requestId: "r1", ...CASES[command].applied });
      await expect(pending).resolves.toMatchObject({ status: "applied", clientRequestId: "client_1" });
    });

    it("refuses invalid input without posting", async () => {
      const invalid = CASES[command].invalid;
      if (invalid === undefined) return;
      const s = setup();
      await expect(s.send(command, invalid)).resolves.toEqual({ status: "error", reason: "invalid" });
      expect(s.ports.post).not.toHaveBeenCalled();
    });

    it("answers unavailable before the viewer is ready", async () => {
      const s = setup({ ready: false });
      await expect(s.send(command)).resolves.toEqual({ status: "error", reason: "unavailable" });
      expect(s.ports.post).not.toHaveBeenCalled();
    });

    it("answers busy while its family already has a request outstanding", async () => {
      const s = setup();
      void s.send(command);
      await expect(s.send(command)).resolves.toEqual({ status: "error", reason: "busy" });
      expect(s.ports.post).toHaveBeenCalledTimes(1);
    });

    it("answers transport when posting throws", async () => {
      const s = setup({ postThrows: true });
      await expect(s.send(command)).resolves.toEqual({ status: "error", reason: "transport" });
    });

    it("times out after 11 seconds", async () => {
      vi.useFakeTimers();
      const s = setup();
      const pending = s.send(command);
      vi.advanceTimersByTime(11_000);
      await expect(pending).resolves.toEqual({ status: "error", reason: "timeout" });
    });

    it("turns unconfirmed and invalidates every command when the viewer broadcasts unconfirmed", async () => {
      const s = setup();
      const pending = s.send(command);
      expect(s.reply(command, { status: "unconfirmed" })).toBe(true);
      await expect(pending).resolves.toEqual({ status: "unconfirmed" });
      expect(s.ports.onInvalidated).toHaveBeenCalledTimes(1);
    });

    it("ignores a malformed reply", () => {
      const s = setup();
      void s.send(command);
      expect(s.reply(command, { status: "exploded", clientRequestId: "client_1" })).toBe(true);
      expect(s.ports.onInvalidated).not.toHaveBeenCalled();
    });
  });
});

describe("viewer command channel on the console side", () => {
  it("shares one camera slot between camera view and camera state, but keeps fly, overlay style and section separate", async () => {
    const s = setup();
    void s.send("camera_view");
    await expect(s.send("camera_state")).resolves.toEqual({ status: "error", reason: "busy" });
    void s.send("fly_navigation");
    void s.send("overlay_style");
    void s.send("section_plane");
    expect(s.posted.map(message => message.type)).toEqual(["camera_view", "fly_navigation", "overlay_style", "section_plane"]);
  });

  it("settles a camera view with a camera_state_result carrying its clientRequestId", async () => {
    const s = setup();
    const pending = s.send("camera_view");
    s.side.acceptViewerMessage({ type: "camera_state_result", status: "applied", clientRequestId: "client_1", requestId: "r1", camera });
    await expect(pending).resolves.toMatchObject({ status: "applied" });
  });

  it("cancels every outstanding request as unconfirmed", async () => {
    const s = setup();
    const replies = [s.send("camera_view"), s.send("fly_navigation"), s.send("overlay_style"), s.send("section_plane")];
    s.side.cancel();
    await expect(Promise.all(replies)).resolves.toEqual([
      { status: "unconfirmed" }, { status: "unconfirmed" }, { status: "unconfirmed" }, { status: "unconfirmed" }]);
    expect(s.ports.onInvalidated).not.toHaveBeenCalled();
  });

  it("passes measurement state through and controls measurement only when ready", () => {
    const s = setup();
    expect(s.side.acceptViewerMessage({ type: "measurement_state", status: "first", requestId: "r1" })).toBe(true);
    expect(s.ports.onMeasurementState).toHaveBeenCalledWith({ status: "first", requestId: "r1" });
    expect(s.side.acceptViewerMessage({ type: "measurement_state", status: "nonsense" })).toBe(true);
    expect(s.ports.onMeasurementState).toHaveBeenCalledTimes(1);
    expect(s.side.port.controlMeasurement("start")).toBe(true);
    expect(s.posted).toEqual([{ type: "measurement_control", action: "start" }]);
    expect(s.side.port.controlMeasurement("explode" as never)).toBe(false);
    expect(setup({ ready: false }).side.port.controlMeasurement("start")).toBe(false);
  });

  it("leaves other viewer messages to the caller", () => {
    const s = setup();
    for (const type of ["first_frame", "stage_loaded", "highlight_result", "issue_view_result", "stage_tree", "viewer_ready"]) {
      expect(s.side.acceptViewerMessage({ type })).toBe(false);
    }
  });
});

describe("forwardViewerCommandPort", () => {
  const target = (): ViewerCommandPort & { sent: string[]; measured: string[] } => {
    const sent: string[] = [], measured: string[] = [];
    return {
      sent, measured,
      send: command => { sent.push(command); return Promise.resolve({ status: "applied", clientRequestId: "c", requestId: "r" } as never); },
      controlMeasurement: action => { measured.push(action); return true; },
    };
  };

  it("forwards to the current target", async () => {
    const inner = target();
    const port = forwardViewerCommandPort(() => inner);
    await expect(port.send("fly_navigation", 2)).resolves.toMatchObject({ status: "applied" });
    expect(port.controlMeasurement("clear")).toBe(true);
    expect(inner.sent).toEqual(["fly_navigation"]);
  });

  it("answers unavailable without a target", async () => {
    const port = forwardViewerCommandPort(() => null);
    await expect(port.send("section_plane", CASES.section_plane.input)).resolves.toEqual({ status: "error", reason: "unavailable" });
    expect(port.controlMeasurement("start")).toBe(false);
  });

  it("blocks sends and measurement start while blocked, but still lets measurement be cancelled or cleared", async () => {
    const inner = target();
    const port = forwardViewerCommandPort(() => inner, () => true);
    await expect(port.send("camera_view", CASES.camera_view.input)).resolves.toEqual({ status: "error", reason: "unavailable" });
    expect(port.controlMeasurement("start")).toBe(false);
    expect(port.controlMeasurement("cancel")).toBe(true);
    expect(inner.sent).toEqual([]);
    expect(inner.measured).toEqual(["cancel"]);
  });
});
