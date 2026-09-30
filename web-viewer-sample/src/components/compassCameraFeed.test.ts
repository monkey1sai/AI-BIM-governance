import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPASS_REQUEST_PREFIX, CompassCameraFeed, type CompassCameraFeedPorts } from "./compassCameraFeed";

const camera = (direction: number[], up = [0, 0, 1]) => ({
  projection: "perspective", position: [0, -30, 10], direction, up, target_distance: 30, fov_deg: 40, ortho_height: null,
});

/** `replyAfterMs` makes a fake Kit that answers every HUD read that many ms after it was sent. */
function setup({ replyAfterMs }: { replyAfterMs?: number } = {}) {
  let ready = true;
  const start = Date.now();
  const sendTimes: number[] = [];
  const ports = {
    ready: vi.fn(() => ready),
    send: vi.fn<(requestId: string) => boolean>((requestId) => {
      sendTimes.push(Date.now() - start);
      if (replyAfterMs !== undefined) {
        setTimeout(() => feed.receive("cameraStateResult", { request_id: requestId, result: "success", camera: camera([1, 0, 0]) }), replyAfterMs);
      }
      return true;
    }),
  } satisfies CompassCameraFeedPorts;
  let next = 0;
  // The fake Kit's reply closure reads `feed` only after it is constructed.
  const feed = new CompassCameraFeed(ports, () => `id${++next}`);
  feed.start();
  const lastId = () => ports.send.mock.calls[ports.send.mock.calls.length - 1][0];
  const reply = (requestId: string, direction = [1, 0, 0]) =>
    feed.receive("cameraStateResult", { request_id: requestId, result: "success", camera: camera(direction) });
  return { ports, feed, lastId, reply, sendTimes, heading: () => feed.getSnapshot().heading, setReady: (value: boolean) => { ready = value; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("CompassCameraFeed", () => {
  it("reads the camera with its own request id, consumes only its own reply and counts the read", () => {
    const s = setup();
    const listener = vi.fn();
    s.feed.subscribe(listener);
    s.feed.refresh();
    expect(s.ports.send).toHaveBeenCalledTimes(1);
    expect(s.lastId()).toBe(`${COMPASS_REQUEST_PREFIX}id1`);
    expect(s.lastId()).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    expect(s.feed.getSnapshot().reads).toBe(1);
    expect(s.reply(s.lastId(), [1, 0, 0])).toBe(true);
    expect(s.heading()).toBe(90);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps at most one read in flight and reads once more after it settles", () => {
    const s = setup();
    s.feed.refresh(); s.feed.refresh(); s.feed.refresh();
    expect(s.ports.send).toHaveBeenCalledTimes(1);
    s.reply(s.lastId());
    expect(s.ports.send).toHaveBeenCalledTimes(2);
    s.reply(s.lastId());
    expect(s.ports.send).toHaveBeenCalledTimes(2);
  });

  it("does not send while the viewer cannot read (DataChannel not ready or a parent camera command in flight)", () => {
    const s = setup();
    s.setReady(false);
    s.feed.refresh();
    expect(s.ports.send).not.toHaveBeenCalled();
    s.setReady(true);
    s.feed.refresh();
    expect(s.ports.send).toHaveBeenCalledTimes(1);
  });

  it("frees the slot and does not count a read the send pipeline refused", () => {
    const s = setup();
    s.ports.send.mockReturnValueOnce(false);
    s.feed.refresh();
    expect(s.feed.getSnapshot().reads).toBe(0);
    s.feed.refresh();
    expect(s.ports.send).toHaveBeenCalledTimes(2);
    expect(s.feed.getSnapshot().reads).toBe(1);
  });

  it("gives up on a read Kit never answers", () => {
    const s = setup();
    s.feed.refresh();
    vi.advanceTimersByTime(3_000);
    s.feed.refresh();
    expect(s.ports.send).toHaveBeenCalledTimes(2);
  });

  it("drops a late reply to an abandoned read without moving the rose", () => {
    const s = setup();
    s.feed.refresh();
    const abandoned = s.lastId();
    vi.advanceTimersByTime(3_000);
    expect(s.reply(abandoned, [0, 1, 0])).toBe(true);
    expect(s.heading()).toBeNull();
  });

  it("claims only its own refusals, frees the slot and backs off before reading again", () => {
    const s = setup();
    s.feed.refresh();
    expect(s.feed.reject("cmd_parent")).toBe(false);
    s.feed.refresh();
    expect(s.feed.reject(s.lastId())).toBe(true);
    s.feed.refresh();
    s.feed.pointerDown();
    vi.advanceTimersByTime(4_500);
    expect(s.ports.send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(s.ports.send).toHaveBeenCalledTimes(2);
  });

  it("frees the slot at once on a transport failure of its own read", () => {
    const s = setup();
    s.feed.refresh();
    expect(s.feed.fail("cmd_parent")).toBe(false);
    expect(s.feed.fail(s.lastId())).toBe(true);
    s.feed.refresh();
    expect(s.ports.send).toHaveBeenCalledTimes(2);
  });

  it("waits at least 500 ms after each reply before the next drag read", () => {
    const s = setup({ replyAfterMs: 50 });
    s.feed.pointerDown();
    vi.advanceTimersByTime(2_000);
    s.feed.pointerUp();
    vi.advanceTimersByTime(1_000);
    expect(s.sendTimes).toEqual([500, 1_050, 1_600, 2_200]);
  });

  it("bounds the reads of a drag whose replies take 400 ms: polling stops after the slow read, one read on release", () => {
    const s = setup({ replyAfterMs: 400 });
    s.feed.pointerDown();
    vi.advanceTimersByTime(2_000);
    s.feed.pointerUp();
    vi.advanceTimersByTime(1_000);
    expect(s.ports.send.mock.calls.length).toBeLessThanOrEqual(3 + 1);
    expect(s.sendTimes).toEqual([500, 2_200]);
  });

  it("skips a drag poll that finds a read in flight without queueing another read", () => {
    const s = setup();
    s.feed.pointerDown();
    vi.advanceTimersByTime(400);
    s.feed.refresh();
    expect(s.ports.send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120);
    s.reply(s.lastId());
    expect(s.ports.send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(499);
    expect(s.ports.send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(s.ports.send).toHaveBeenCalledTimes(2);
  });

  it("ignores a pointer release that did not start on the stage", () => {
    const s = setup();
    s.feed.pointerUp();
    vi.advanceTimersByTime(1_000);
    expect(s.ports.send).not.toHaveBeenCalled();
  });

  it("debounces wheel zoom into one read", () => {
    const s = setup();
    s.feed.settleSoon(); vi.advanceTimersByTime(100);
    s.feed.settleSoon(); vi.advanceTimersByTime(100);
    s.feed.settleSoon();
    expect(s.ports.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(s.ports.send).toHaveBeenCalledTimes(1);
  });

  it("reads the camera straight from camera-view and other camera-state results without claiming them", () => {
    const s = setup();
    expect(s.feed.receive("cameraViewResult", { request_id: "cmd_view", result: "success", camera: camera([0, -1, 0]) })).toBe(false);
    expect(s.heading()).toBe(180);
    expect(s.feed.receive("cameraStateResult", { request_id: "cmd_state", result: "success", camera: camera([-1, 0, 0]) })).toBe(false);
    expect(s.heading()).toBe(270);
    expect(s.feed.receive("cameraViewResult", { request_id: "cmd_view", result: "error", error: "x" })).toBe(false);
    expect(s.heading()).toBe(270);
    expect(s.ports.send).not.toHaveBeenCalled();
  });

  it("re-reads after a camera reset or frame", () => {
    const s = setup();
    expect(s.feed.receive("resetStageResponse", { request_id: "cmd_reset", result: "success" })).toBe(false);
    expect(s.feed.receive("cameraFrameResult", { request_id: "cmd_reset", result: "success" })).toBe(false);
    vi.advanceTimersByTime(200);
    expect(s.ports.send).toHaveBeenCalledTimes(1);
  });

  it("forgets the heading when told the stage changed", () => {
    const s = setup();
    s.feed.refresh();
    s.reply(s.lastId(), [0, 1, 0]);
    expect(s.heading()).toBe(0);
    const listener = vi.fn();
    s.feed.subscribe(listener);
    s.feed.clearHeading();
    expect(s.heading()).toBeNull();
    s.feed.clearHeading();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does nothing before start or after dispose", () => {
    const s = setup();
    s.feed.pointerDown();
    s.feed.dispose();
    s.feed.refresh(); s.feed.settleSoon();
    vi.advanceTimersByTime(5_000);
    expect(s.ports.send).not.toHaveBeenCalled();
    expect(s.feed.receive("cameraViewResult", { request_id: "cmd_view", result: "success", camera: camera([0, 1, 0]) })).toBe(false);
    expect(s.heading()).toBeNull();
  });
});
