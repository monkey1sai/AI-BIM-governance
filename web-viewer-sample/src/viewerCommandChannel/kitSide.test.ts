import { afterEach, describe, expect, it, vi } from "vitest";
import { createViewerCommandKitSide, type KitSidePorts } from "./kitSide";
import { VIEWER_COMMANDS } from "./registry";
import type { ViewerCommandType } from "./viewerEmbedProtocol";
import { isRuntimeMutator } from "../viewer/core/runtimeCommandProtocol";
import { isKitResultForCommand } from "../viewer/core/runtimeEventCatalog";
import { KIT_EVENTS } from "../generated/kit-command-vocabulary";
import type { StreamMessage } from "../types/streamMessages";

const camera = { projection: "perspective", position: [0, 0, 30], direction: [0, 0, -1], up: [0, 1, 0],
  target_distance: 30, fov_deg: 40, ortho_height: null };

/** 每個指令一筆：怎麼從 console 發起、Kit 的成功結果長什麼樣、回給 console 的 vg01 type。 */
const CASES: Record<ViewerCommandType, {
  request: Record<string, unknown>;
  success: Record<string, unknown>;
  replyType: string;
}> = {
  camera_view: { request: { type: "camera_view", camera: { action: "preset", view: "top", scope: "building" }, clientRequestId: "c1" },
    success: { result: "success", camera }, replyType: "camera_view_result" },
  camera_state: { request: { type: "camera_state", clientRequestId: "c1" },
    success: { result: "success", camera }, replyType: "camera_state_result" },
  fly_navigation: { request: { type: "fly_navigation", speed: 3, clientRequestId: "c1" },
    success: { result: "success", speed: 3 }, replyType: "fly_navigation_result" },
  section_plane: { request: { type: "section_plane", section: { enabled: true, axis: "z", direction: 1, position: 2 }, clientRequestId: "c1" },
    success: { result: "success", enabled: true, planes: [[0, 0, 1, -2]] }, replyType: "section_result" },
  measurement_control: { request: { type: "measurement_control", action: "start" },
    success: { status: "started", meters_per_unit: 1 }, replyType: "measurement_state" },
};

function setup({ matched = true }: { matched?: boolean } = {}) {
  let snapshot: string | null = "stage1";
  let next = 0;
  const ports = {
    snapshot: vi.fn(() => snapshot),
    requestId: vi.fn(() => `runtime_${++next}`),
    send: vi.fn((message: StreamMessage) => Boolean(message)),
    correlate: vi.fn(() => matched),
    claimTerminal: vi.fn(),
    post: vi.fn(),
  } satisfies KitSidePorts;
  const channel = createViewerCommandKitSide(ports);
  const sent = () => ports.send.mock.calls[ports.send.mock.calls.length - 1][0] as { event_type: string; payload: Record<string, unknown> };
  const measurementId = () => (sent().payload.measurement_id as string | undefined);
  const result = (type: ViewerCommandType, payload: Record<string, unknown>) => {
    const request = sent();
    const eventType = KIT_EVENTS.find(event => isKitResultForCommand(event, VIEWER_COMMANDS[type].kitCommand))!;
    return channel.receiveKitEvent(eventType, { request_id: request.payload.request_id, measurement_id: measurementId(), ...payload });
  };
  return { ports, channel, sent, result, setSnapshot: (value: string | null) => { snapshot = value; } };
}

const TYPES = Object.keys(VIEWER_COMMANDS) as ViewerCommandType[];
afterEach(() => { vi.useRealTimers(); });

describe("every registered viewer command", () => {
  it("is covered by this suite and names a Kit command with at least one result", () => {
    expect(TYPES.sort()).toEqual(Object.keys(CASES).sort());
    for (const type of TYPES) {
      expect(KIT_EVENTS.some(event => isKitResultForCommand(event, VIEWER_COMMANDS[type].kitCommand))).toBe(true);
    }
  });

  describe.each(TYPES)("%s", type => {
    const c = CASES[type];
    const kitCommand = VIEWER_COMMANDS[type].kitCommand;
    const mutates = isRuntimeMutator(kitCommand);

    it("sends the Kit command for a parent request", () => {
      const s = setup();
      expect(s.channel.acceptParentMessage(c.request, { fromParent: true, canOperate: true })).toBe(true);
      expect(s.sent().event_type).toBe(kitCommand);
    });

    it("claims the tracker only for a mutating command", () => {
      const s = setup();
      s.channel.acceptParentMessage(c.request, { fromParent: true, canOperate: true });
      expect(s.result(type, c.success)).toBe(true);
      expect(s.ports.post).toHaveBeenLastCalledWith(expect.objectContaining({ type: c.replyType }));
      expect(s.ports.claimTerminal).toHaveBeenCalledTimes(mutates ? 1 : 0);
      expect(s.ports.correlate).toHaveBeenCalledTimes(mutates ? 1 : 0);
    });

    it("does not settle a mutating result the tracker did not match", () => {
      if (!mutates) return;
      const s = setup({ matched: false });
      s.channel.acceptParentMessage(c.request, { fromParent: true, canOperate: true });
      expect(s.result(type, c.success)).toBe(false);
      expect(s.ports.post).not.toHaveBeenCalledWith(expect.objectContaining({ status: expect.stringMatching(/applied|first/) }));
    });

    it("reports a Kit refusal immediately", () => {
      const s = setup();
      s.channel.acceptParentMessage(c.request, { fromParent: true, canOperate: true });
      s.channel.rejectCommand(kitCommand, s.sent().payload.request_id as string);
      expect(s.ports.post).toHaveBeenLastCalledWith(expect.objectContaining({ type: c.replyType, status: "error", reason: "rejected" }));
    });

    it("reports a transport failure", () => {
      const s = setup();
      s.channel.acceptParentMessage(c.request, { fromParent: true, canOperate: true });
      s.channel.failTransport(kitCommand, s.sent().payload.request_id as string);
      expect(s.ports.post).toHaveBeenLastCalledWith(expect.objectContaining({ type: c.replyType, status: "error", reason: "transport" }));
    });

    it("ignores refusals and failures for other requests", () => {
      const s = setup();
      s.channel.acceptParentMessage(c.request, { fromParent: true, canOperate: true });
      const before = s.ports.post.mock.calls.length;
      s.channel.rejectCommand(kitCommand, "someone_else");
      s.channel.failTransport(kitCommand, "someone_else");
      expect(s.ports.post.mock.calls.length).toBe(before);
    });

    it("times out once without retrying", () => {
      vi.useFakeTimers();
      const s = setup();
      s.channel.acceptParentMessage(c.request, { fromParent: true, canOperate: true });
      vi.advanceTimersByTime(10_000);
      expect(s.ports.post).toHaveBeenLastCalledWith(expect.objectContaining({ type: c.replyType, status: "error", reason: "timeout" }));
      expect(s.ports.send).toHaveBeenCalledTimes(1);
    });

    it("turns an in-flight request unconfirmed when the stage changes", () => {
      const s = setup();
      s.channel.acceptParentMessage(c.request, { fromParent: true, canOperate: true });
      s.setSnapshot("stage2");
      s.channel.sync();
      expect(s.ports.post).toHaveBeenLastCalledWith(expect.objectContaining({ type: c.replyType, status: "unconfirmed" }));
    });

    it("claims its message type but drops it when not from the embedding parent", () => {
      const s = setup();
      expect(s.channel.acceptParentMessage(c.request, { fromParent: false, canOperate: true })).toBe(true);
      expect(s.ports.send).not.toHaveBeenCalled();
    });

    it("disposes without replying", () => {
      vi.useFakeTimers();
      const s = setup();
      s.channel.acceptParentMessage(c.request, { fromParent: true, canOperate: true });
      const before = s.ports.post.mock.calls.length;
      s.channel.dispose();
      vi.runAllTimers();
      expect(s.ports.post.mock.calls.length).toBe(before);
    });
  });
});

describe("viewer command channel routing", () => {
  it("leaves messages it does not own to the caller", () => {
    const s = setup();
    expect(s.channel.acceptParentMessage({ type: "highlight", items: [] }, { fromParent: true, canOperate: true })).toBe(false);
    expect(s.channel.acceptParentMessage("camera_view", { fromParent: true, canOperate: true })).toBe(false);
    expect(s.channel.receiveKitEvent("highlightPrimsResult", { request_id: "x" })).toBe(false);
    expect(s.ports.correlate).not.toHaveBeenCalled();
  });

  it("drops correlated commands without a usable clientRequestId", () => {
    const s = setup();
    s.channel.acceptParentMessage({ type: "camera_view", camera: { action: "preset", view: "top", scope: "building" } },
      { fromParent: true, canOperate: true });
    s.channel.acceptParentMessage({ type: "fly_navigation", speed: 3, clientRequestId: "x".repeat(201) },
      { fromParent: true, canOperate: true });
    expect(s.ports.send).not.toHaveBeenCalled();
    expect(s.ports.post).not.toHaveBeenCalled();
  });

  it("answers camera_state unavailable when the viewer cannot operate but silently drops mutators", () => {
    const s = setup();
    s.channel.acceptParentMessage({ type: "camera_state", clientRequestId: "s1" }, { fromParent: true, canOperate: false });
    expect(s.ports.post).toHaveBeenLastCalledWith({ type: "camera_state_result", status: "error", reason: "unavailable", clientRequestId: "s1" });
    s.ports.post.mockClear();
    s.channel.acceptParentMessage(CASES.camera_view.request, { fromParent: true, canOperate: false });
    s.channel.acceptParentMessage(CASES.fly_navigation.request, { fromParent: true, canOperate: false });
    s.channel.acceptParentMessage(CASES.section_plane.request, { fromParent: true, canOperate: false });
    expect(s.ports.send).not.toHaveBeenCalled();
    expect(s.ports.post).not.toHaveBeenCalled();
  });

  it("lets measurement be cancelled but not started while the viewer cannot operate", () => {
    const s = setup();
    s.channel.acceptParentMessage({ type: "measurement_control", action: "start" }, { fromParent: true, canOperate: false });
    expect(s.ports.send).not.toHaveBeenCalled();
    s.channel.acceptParentMessage({ type: "measurement_control", action: "cancel" }, { fromParent: true, canOperate: false });
    expect(s.ports.post).toHaveBeenLastCalledWith({ type: "measurement_state", status: "cancelled" });
    s.channel.acceptParentMessage({ type: "measurement_control", action: "explode" }, { fromParent: true, canOperate: true });
    expect(s.ports.send).not.toHaveBeenCalled();
  });

  it("reports an applied section with its effective plane and a disabled section as off", () => {
    const s = setup();
    s.channel.acceptParentMessage(CASES.section_plane.request, { fromParent: true, canOperate: true });
    expect(s.sent().payload).toMatchObject({ enabled: true, axis: "z", position: 2, normal: [0, 0, 1] });
    s.result("section_plane", CASES.section_plane.success);
    expect(s.ports.post).toHaveBeenLastCalledWith({ type: "section_result", status: "applied", clientRequestId: "c1",
      requestId: "runtime_1", effective: { enabled: true, axis: "z", direction: 1, position: 2 } });
    s.channel.acceptParentMessage({ type: "section_plane", section: { enabled: false, axis: "x", direction: 1, position: 15 }, clientRequestId: "c2" },
      { fromParent: true, canOperate: true });
    s.result("section_plane", { result: "success", enabled: false, planes: [[0, 0, 1, -2]] });
    expect(s.ports.post).toHaveBeenLastCalledWith({ type: "section_result", status: "off", clientRequestId: "c2", requestId: "runtime_2" });
  });

  it("reports a busy section without sending twice", () => {
    const s = setup();
    s.channel.acceptParentMessage(CASES.section_plane.request, { fromParent: true, canOperate: true });
    s.channel.acceptParentMessage({ ...CASES.section_plane.request, clientRequestId: "c2" }, { fromParent: true, canOperate: true });
    expect(s.ports.send).toHaveBeenCalledTimes(1);
    expect(s.ports.post).toHaveBeenLastCalledWith({ type: "section_result", status: "error", reason: "busy", clientRequestId: "c2" });
  });

  it("reports a section whose Kit readback does not match", () => {
    const s = setup();
    s.channel.acceptParentMessage(CASES.section_plane.request, { fromParent: true, canOperate: true });
    s.result("section_plane", { result: "success", enabled: true, planes: [[1, 0, 0, -2]] });
    expect(s.ports.post).toHaveBeenLastCalledWith(expect.objectContaining({ type: "section_result", status: "error", reason: "readback" }));
  });

  it("invalidates a confirmed section once when the stage changes", () => {
    const s = setup();
    s.channel.acceptParentMessage(CASES.section_plane.request, { fromParent: true, canOperate: true });
    s.result("section_plane", CASES.section_plane.success);
    s.setSnapshot("stage2");
    s.channel.sync(); s.channel.sync();
    expect(s.ports.post).toHaveBeenCalledTimes(2);
    expect(s.ports.post).toHaveBeenLastCalledWith({ type: "section_result", status: "unconfirmed" });
  });
});
