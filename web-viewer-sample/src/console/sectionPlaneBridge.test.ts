import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSectionInput, sectionReadbackMatches, SectionPlaneExchange } from "./sectionPlaneBridge";

const input = { enabled: true, axis: "z" as const, direction: 1 as const, position: 2 };
afterEach(() => vi.useRealTimers());
describe("section plane contract", () => {
  it.each([null, {}, { ...input, position: "" }, { ...input, position: NaN }, { ...input, position: Infinity }, { ...input, axis: "a" }, { ...input, direction: 0 }, { ...input, role: "primary" }])("rejects malformed or authority-bearing input %j", value => {
    expect(parseSectionInput(value)).toBeNull();
  });
  it("accepts a finite model coordinate without converting units", () => {
    expect(parseSectionInput({ ...input, position: -3.25 })).toEqual({ ...input, position: -3.25 });
  });
  it("requires effective readback, tolerating float32 but not wrong planes", () => {
    expect(sectionReadbackMatches(input, { result: "success", enabled: true, planes: [[0, 0, 1, -2.0000001]] })).toBe(true);
    expect(sectionReadbackMatches(input, { result: "success", enabled: true, planes: [[0, 0, 1, -3]] })).toBe(false);
    expect(sectionReadbackMatches(input, { result: "success", enabled: true })).toBe(false);
    expect(sectionReadbackMatches(input, { result: "success", enabled: true, planes: [[0, 0, 1, NaN]] })).toBe(false);
  });
  it.each([{ planes: [] }, { planes: [[0, 0, 1, -2], [1, 0, 0, -8]] }])("off accepts preserved planes %j", ({ planes }) => {
    expect(sectionReadbackMatches({ ...input, enabled: false }, { result: "success", enabled: false, planes })).toBe(true);
  });
});
function setup() {
  let snapshot: string | null = "stage1";
  const notify = vi.fn(), complete = vi.fn(), send = vi.fn(() => true);
  const exchange = new SectionPlaneExchange({ snapshot: () => snapshot, notify, complete, send, requestId: () => "runtime_1" });
  return { exchange, notify, complete, send, change: (value: string | null) => { snapshot = value; } };
}
describe("bounded correlated section exchange", () => {
  it("off does not present draft coordinates as effective renderer settings", () => {
    const s = setup();
    s.exchange.start({ enabled: false, axis: "x", direction: 1, position: 15 }, "off_1");
    s.exchange.receive({ request_id: "runtime_1", result: "success", enabled: false, planes: [[0, 0, 1, -2]] });
    expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({ status: "off" }));
    expect(s.notify.mock.calls[0][0]).not.toHaveProperty("effective");
  });
  it("does not treat dispatch as success; ignores wrong and duplicate ACK", () => {
    const s = setup();
    s.exchange.start(input, "local_1");
    expect(s.notify).not.toHaveBeenCalled();
    expect(s.exchange.receive({ request_id: "other", result: "success" })).toBe(false);
    expect(s.exchange.receive({ request_id: "runtime_1", result: "success", enabled: true, planes: [[0, 0, 1, -2]] })).toBe(true);
    expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({ clientRequestId: "local_1", requestId: "runtime_1", status: "applied" }));
    s.exchange.receive({ request_id: "runtime_1", result: "success", enabled: true, planes: [[0, 0, 1, -2]] });
    expect(s.notify).toHaveBeenCalledTimes(1);
    s.exchange.dispose();
  });
  it("blocks duplicate submission and sanitizes failed dispatch", () => {
    const s = setup(); s.exchange.start(input, "a"); s.exchange.start(input, "b");
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.notify).toHaveBeenLastCalledWith(expect.objectContaining({ clientRequestId: "b", reason: "busy" }));
    s.exchange.dispose();
    const blocked = setup(); blocked.send.mockReturnValue(false); blocked.exchange.start(input, "c");
    expect(blocked.notify).toHaveBeenLastCalledWith(expect.objectContaining({ status: "error", reason: "unavailable" }));
  });
  it("rejects stale ACK synchronously before React lifecycle runs", () => {
    const s = setup(); s.exchange.start(input, "a"); s.change("stage2");
    s.exchange.receive({ request_id: "runtime_1", result: "success", enabled: true, planes: [[0, 0, 1, -2]] });
    expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({ status: "unconfirmed" }));
    expect(s.notify).not.toHaveBeenCalledWith(expect.objectContaining({ status: "applied" }));
  });
  it("invalidates an already acknowledged display once", () => {
    const s = setup(); s.exchange.start(input, "a");
    s.exchange.receive({ request_id: "runtime_1", result: "success", enabled: true, planes: [[0, 0, 1, -2]] });
    s.change("stage2"); s.exchange.sync(); s.exchange.sync();
    expect(s.notify).toHaveBeenCalledTimes(2);
    expect(s.notify).toHaveBeenLastCalledWith({ status: "unconfirmed" });
  });
  it("timeouts without automatic retry and disposes without notification", () => {
    vi.useFakeTimers(); const s = setup(); s.exchange.start(input, "a");
    vi.advanceTimersByTime(10000);
    expect(s.notify).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "timeout" }));
    expect(s.send).toHaveBeenCalledTimes(1);
    const other = setup(); other.exchange.start(input, "b"); other.exchange.dispose();
    vi.runAllTimers(); expect(other.notify).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("transport/rejection only settles the matching request", () => {
    const s = setup(); s.exchange.start(input, "a");
    s.exchange.fail("wrong", "transport"); expect(s.notify).not.toHaveBeenCalled();
    s.exchange.fail("runtime_1", "rejected");
    expect(s.notify).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "rejected" }));
  });
});
