import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CorrelatedRuntimeExchange, PendingReply, cameraStateReadback, cameraViewReadback, flyReadback,
  parseCameraReply, parseCameraState, parseCameraViewInput, parseClientCameraState, parseFlyReply, parseFlySpeed,
  type CameraReply, type ExchangeReply,
} from "./camera";

const wireCamera = { projection: "perspective", position: [0, -10, 2], direction: [0, 1, 0], up: [0, 0, 1],
  target_distance: 10, fov_deg: 45, ortho_height: null };
const clientCamera = { projection: "perspective", position: [0, -10, 2], direction: [0, 1, 0], up: [0, 0, 1],
  targetDistance: 10, fovDeg: 45, orthoHeight: null };
afterEach(() => { vi.useRealTimers(); });

describe("camera input and state parsing", () => {
  it.each([
    [{ action: "preset", view: "iso", scope: "all" }],
    [{ action: "projection", projection: "orthographic" }],
  ])("accepts %j", value => { expect(parseCameraViewInput(value)).toEqual(value); });
  it.each([
    [{ action: "preset", view: "bottom", scope: "all" }],
    [{ action: "preset", view: "top" }],
    [{ action: "preset", view: "top", scope: "all", projection: "perspective" }],
    [{ action: "projection", projection: "fisheye" }],
    [{ action: "apply_state" }],
    [null], ["top"],
  ])("rejects %j", value => { expect(parseCameraViewInput(value)).toBeNull(); });
  it("converts wire camera to client camera and rejects open or non-finite shapes", () => {
    expect(parseCameraState(wireCamera)).toEqual(clientCamera);
    expect(parseCameraState({ ...wireCamera, extra: 1 })).toBeNull();
    expect(parseCameraState({ ...wireCamera, position: [0, Number.NaN, 0] })).toBeNull();
    expect(parseCameraState({ ...wireCamera, fov_deg: null })).toBeNull();
    expect(parseCameraState({ ...wireCamera, projection: "orthographic", fov_deg: null, ortho_height: 5 }))
      .toMatchObject({ projection: "orthographic", fovDeg: null, orthoHeight: 5 });
    expect(parseClientCameraState(clientCamera)).toEqual(clientCamera);
    expect(parseClientCameraState(wireCamera)).toBeNull();
  });
  it("accepts only bounded fly speeds", () => {
    expect(parseFlySpeed(2.5)).toBe(2.5);
    for (const bad of [0, 0.001, 1000.5, Number.NaN, "2", null]) expect(parseFlySpeed(bad)).toBeNull();
  });
});

describe("Kit readback matching", () => {
  it("confirms a preset only when the camera looks along the preset forward", () => {
    const input = { action: "preset", view: "front", scope: "building" } as const;
    expect(cameraViewReadback(input, { result: "success", camera: wireCamera })).toEqual(clientCamera);
    expect(cameraViewReadback(input, { result: "success", camera: { ...wireCamera, direction: [0, 0, -1] } })).toBeNull();
    expect(cameraViewReadback(input, { result: "error", error: "x" })).toBeNull();
  });
  it("confirms a projection only when Kit reports it", () => {
    const input = { action: "projection", projection: "orthographic" } as const;
    const ortho = { ...wireCamera, projection: "orthographic", fov_deg: null, ortho_height: 12 };
    expect(cameraViewReadback(input, { result: "success", camera: ortho })).toMatchObject({ projection: "orthographic" });
    expect(cameraViewReadback(input, { result: "success", camera: wireCamera })).toBeNull();
  });
  it("reads camera state and fly speed", () => {
    expect(cameraStateReadback(null, { result: "success", camera: wireCamera })).toEqual(clientCamera);
    expect(flyReadback(2, { result: "success", speed: 2 })).toBe(2);
    expect(flyReadback(2, { result: "success", speed: 0 })).toBeNull();
    expect(flyReadback(2, { result: "error" })).toBeNull();
  });
});

describe("reply parsing for the parent window", () => {
  it("requires correlation ids for applied replies and validates payloads", () => {
    expect(parseCameraReply({ status: "applied", clientRequestId: "c1", requestId: "r1", camera: clientCamera }))
      .toEqual({ status: "applied", clientRequestId: "c1", requestId: "r1", camera: clientCamera });
    expect(parseCameraReply({ status: "applied", clientRequestId: "c1", camera: clientCamera })).toBeNull();
    expect(parseCameraReply({ status: "applied", clientRequestId: "c1", requestId: "r1" })).toBeNull();
    expect(parseCameraReply({ status: "error", reason: "busy", clientRequestId: "c1" })).toEqual({
      status: "error", reason: "busy", clientRequestId: "c1" });
    expect(parseCameraReply({ status: "error", reason: "secret" })).toBeNull();
    expect(parseCameraReply({ status: "unconfirmed" })).toEqual({ status: "unconfirmed" });
    expect(parseFlyReply({ status: "applied", clientRequestId: "c1", requestId: "r1", speed: 3 }))
      .toEqual({ status: "applied", clientRequestId: "c1", requestId: "r1", speed: 3 });
    expect(parseFlyReply({ status: "applied", clientRequestId: "c1", requestId: "r1" })).toBeNull();
  });
});

function harness(snapshot: { value: string | null }) {
  const sent: Array<{ input: number; requestId: string }> = [];
  const replies: Array<ExchangeReply<number>> = [];
  const completed: Array<[string, string]> = [];
  let next = 0;
  const exchange = new CorrelatedRuntimeExchange<number, number>({
    parse: value => (typeof value === "number" ? value : null),
    readback: (input, payload) => (payload.value === input ? input : null),
    snapshot: () => snapshot.value,
    requestId: () => `req-${++next}`,
    send: (input, requestId) => { sent.push({ input, requestId }); return true; },
    complete: (requestId, outcome) => { completed.push([requestId, outcome]); },
    notify: reply => { replies.push(reply); },
  });
  return { exchange, sent, replies, completed };
}

describe("CorrelatedRuntimeExchange", () => {
  it("applies only a matching readback and ignores other request ids", () => {
    const h = harness({ value: "s1" });
    h.exchange.start(4, "c1");
    expect(h.sent).toEqual([{ input: 4, requestId: "req-1" }]);
    expect(h.exchange.receive({ request_id: "other", value: 4 })).toBe(false);
    expect(h.exchange.receive({ request_id: "req-1", value: 4 })).toBe(true);
    expect(h.replies).toEqual([{ status: "applied", value: 4, clientRequestId: "c1", requestId: "req-1" }]);
    expect(h.completed).toEqual([["req-1", "success"]]);
  });
  it("reports readback mismatch, busy, invalid and unavailable", () => {
    const snapshot = { value: "s1" as string | null };
    const h = harness(snapshot);
    h.exchange.start(4, "c1");
    h.exchange.start(5, "c2");
    h.exchange.receive({ request_id: "req-1", value: 3 });
    h.exchange.start("x", "c3");
    snapshot.value = null;
    h.exchange.start(6, "c4");
    expect(h.replies.map(reply => [reply.clientRequestId, reply.reason])).toEqual([
      ["c2", "busy"], ["c1", "readback"], ["c3", "invalid"], ["c4", "unavailable"]]);
  });
  it("times out after 10 seconds and supersedes on snapshot change", () => {
    vi.useFakeTimers();
    const snapshot = { value: "s1" as string | null };
    const h = harness(snapshot);
    h.exchange.start(1, "c1");
    vi.advanceTimersByTime(10_000);
    expect(h.replies[0]).toMatchObject({ status: "error", reason: "timeout" });
    h.exchange.start(2, "c2");
    snapshot.value = "s2";
    h.exchange.sync();
    expect(h.replies[1]).toMatchObject({ status: "unconfirmed", clientRequestId: "c2" });
    expect(h.completed[h.completed.length - 1]).toEqual(["req-2", "superseded"]);
  });
  it("marks a confirmed value unconfirmed once the snapshot changes", () => {
    const snapshot = { value: "s1" as string | null };
    const h = harness(snapshot);
    h.exchange.start(1, "c1");
    h.exchange.receive({ request_id: "req-1", value: 1 });
    snapshot.value = "s2";
    h.exchange.sync();
    expect(h.replies[h.replies.length - 1]).toEqual({ status: "unconfirmed" });
  });
  it("maps transport and rejection failures", () => {
    const h = harness({ value: "s1" });
    h.exchange.start(1, "c1");
    h.exchange.fail("req-1", "rejected");
    h.exchange.start(2, "c2");
    h.exchange.fail("req-2", "transport");
    expect(h.replies.map(reply => reply.reason)).toEqual(["rejected", "transport"]);
  });
});

describe("PendingReply", () => {
  const timeout: CameraReply = { status: "error", reason: "timeout" };
  const cancel: CameraReply = { status: "unconfirmed" };
  it("settles only the matching client request and cancels as unconfirmed", async () => {
    const pending = new PendingReply<CameraReply>(timeout, cancel, 11_000);
    const first = pending.start("c1", () => undefined, { status: "error", reason: "transport" });
    expect(pending.busy).toBe(true);
    expect(pending.settle({ status: "applied", clientRequestId: "other" })).toBe(false);
    expect(pending.settle({ status: "applied", clientRequestId: "c1", requestId: "r1", camera: parseClientCameraState(clientCamera)! })).toBe(true);
    await expect(first).resolves.toMatchObject({ status: "applied" });
    const second = pending.start("c2", () => undefined, { status: "error", reason: "transport" });
    pending.cancel();
    await expect(second).resolves.toEqual(cancel);
    expect(pending.busy).toBe(false);
  });
  it("resolves timeout and transport failures", async () => {
    vi.useFakeTimers();
    const pending = new PendingReply<CameraReply>(timeout, cancel, 11_000);
    const late = pending.start("c1", () => undefined, { status: "error", reason: "transport" });
    vi.advanceTimersByTime(11_000);
    await expect(late).resolves.toEqual(timeout);
    const broken = pending.start("c2", () => { throw new Error("private"); }, { status: "error", reason: "transport" });
    await expect(broken).resolves.toEqual({ status: "error", reason: "transport" });
  });
  it("rejects an overlapping start while one request is outstanding", async () => {
    const pending = new PendingReply<CameraReply>(timeout, cancel, 11_000);
    const first = pending.start("c1", () => undefined, { status: "error", reason: "transport" });
    const secondPost = vi.fn();
    const second = pending.start("c2", secondPost, { status: "error", reason: "transport" });
    await expect(second).rejects.toThrow("PendingReply already has an outstanding request.");
    expect(secondPost).not.toHaveBeenCalled();
    expect(pending.settle({ status: "applied", clientRequestId: "c1", requestId: "r1", camera: parseClientCameraState(clientCamera)! })).toBe(true);
    await expect(first).resolves.toMatchObject({ status: "applied" });
    expect(pending.busy).toBe(false);
  });
});
