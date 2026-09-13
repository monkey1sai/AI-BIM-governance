import { afterEach, expect, it, vi } from "vitest";
import { MeasurementExchange, measurementUv, parseMeasurementState } from "./measurementBridge";

afterEach(() => vi.useRealTimers());
function setup() {
  let context: string | null = "session/lease/binding-1", id = 0;
  const host = { snapshot: () => context, requestId: () => `request-${++id}`,
    send: vi.fn((payload: Record<string, unknown>) => { void payload; return true; }), complete: vi.fn(), notify: vi.fn() };
  const exchange = new MeasurementExchange(host);
  const reply = (payload: Record<string, unknown>) => {
    const sent = host.send.mock.calls[host.send.mock.calls.length - 1]?.[0];
    return exchange.receive({ request_id: sent.request_id, measurement_id: sent.measurement_id, ...payload });
  };
  return { exchange, host, reply, change: (value: string | null) => { context = value; } };
}
it("converts contain-video clicks at varying aspect ratios and rejects letterbox/invalid input", () => {
  const box = { left: 20, top: 10, width: 400, height: 400 };
  expect(measurementUv(220, 210, box, 800, 400)).toEqual([0.5, 0.5]);
  expect(measurementUv(220, 30, box, 800, 400)).toBeNull();
  expect(measurementUv(420, 210, box, 800, 400)).toBeNull();
  expect(measurementUv(NaN, 210, box, 800, 400)).toBeNull();
  expect(measurementUv(20, 210, box, 0, 400)).toBeNull();
});
it("publishes only correlated native points with a consistent distance and units", () => {
  const { exchange, reply } = setup();
  exchange.control("start"); reply({ status: "started", meters_per_unit: 0.01 });
  expect(exchange.state.status).toBe("first");
  exchange.pick([0.2, 0.3]); reply({ status: "point", point: [0, 0, 0], point_index: 1 });
  expect(exchange.state.status).toBe("second");
  exchange.pick([0.3, 0.4]); reply({ status: "result", points: [[0, 0, 0], [300, 400, 0]],
    meters_per_unit: 0.01, distance_model_units: 500, distance_metres: 5 });
  expect(exchange.state).toMatchObject({ status: "result", distanceMetres: 5 });
  expect(exchange.capturesInput).toBe(false);
  exchange.dispose();
});
it.each(["NaN", "mismatch", "missing"])("rejects %s result instead of claiming distance", kind => {
  const { exchange, reply } = setup();
  exchange.control("start"); reply({ status: "started", meters_per_unit: 1 });
  exchange.pick([0.2, 0.3]); reply({ status: "point", point: [0, 0, 0], point_index: 1 });
  exchange.pick([0.3, 0.4]); reply({ status: "result", points: [[0, 0, 0], [3, 4, 0]],
    meters_per_unit: 1, distance_model_units: 5, distance_metres: kind === "NaN" ? NaN : kind === "mismatch" ? 50 : undefined });
  expect(exchange.state.status).toBe("error");
  expect(exchange.state.distanceMetres).toBeUndefined();
});
it("cancel supersedes a pending native response and clear removes the result", () => {
  const { exchange, host, reply } = setup();
  exchange.control("start"); reply({ status: "started", meters_per_unit: 1 });
  exchange.pick([0.2, 0.3]);
  const old = host.send.mock.calls[host.send.mock.calls.length - 1]?.[0];
  exchange.control("cancel");
  expect(exchange.receive({ ...old, status: "point", point: [0, 0, 0], point_index: 1 })).toBe(false);
  reply({ status: "cancelled" }); expect(exchange.state.status).toBe("cancelled");
  exchange.control("clear"); reply({ status: "cleared" }); expect(exchange.state.status).toBe("cleared");
});
it("timeout or context replacement never resurrects late results", () => {
  vi.useFakeTimers();
  const { exchange, host, change, reply } = setup();
  exchange.control("start");
  vi.advanceTimersByTime(10001);
  expect(exchange.state).toMatchObject({ status: "error", reason: "timeout" });
  expect(reply({ status: "started", meters_per_unit: 1 })).toBe(false);
  exchange.control("start"); change("session/lease/binding-2"); exchange.sync();
  expect(exchange.state.status).toBe("unconfirmed");
  expect(host.complete).toHaveBeenLastCalledWith(expect.any(String), "superseded");
  expect(reply({ status: "started", meters_per_unit: 1 })).toBe(false);
});
it("same viewer context survives Dock changes and missing authority cannot send", () => {
  const { exchange, host, reply, change } = setup();
  exchange.control("start"); reply({ status: "started", meters_per_unit: 1 });
  exchange.sync(); expect(exchange.state.status).toBe("first");
  change(null); exchange.sync(); exchange.control("start");
  expect(host.send).toHaveBeenCalledTimes(1);
  expect(exchange.state.status).toBe("error");
});
it("parent state decoder rejects unproven/invalid results", () => {
  expect(parseMeasurementState({ status: "result", distanceMetres: 5 })).toBeNull();
  expect(parseMeasurementState({ status: "result", requestId: "r1", distanceMetres: Infinity, points: [[0, 0, 0], [3, 4, 0]] })).toBeNull();
});
