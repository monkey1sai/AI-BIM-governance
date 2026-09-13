export type MeasurementAction = "start" | "cancel" | "clear";
export type WorldPoint = [number, number, number];
export interface MeasurementState {
  status: "idle" | "pending" | "first" | "second" | "result" | "cancelled" | "cleared" | "error" | "unconfirmed";
  requestId?: string;
  distanceMetres?: number;
  points?: [WorldPoint, WorldPoint];
  reason?: string;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const point = (v: unknown): v is WorldPoint => Array.isArray(v) && v.length === 3 && v.every(finite);
export function parseMeasurementState(value: unknown): MeasurementState | null {
  if (!record(value) || !["idle", "pending", "first", "second", "result", "cancelled", "cleared", "error", "unconfirmed"].includes(value.status as string)) return null;
  if (value.requestId !== undefined && (typeof value.requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value.requestId))) return null;
  if (value.status === "result" && (!finite(value.distanceMetres) || value.distanceMetres < 0 || !value.requestId
    || !Array.isArray(value.points) || value.points.length !== 2 || !value.points.every(point))) return null;
  return { status: value.status as MeasurementState["status"],
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
    ...(value.status === "result" ? { distanceMetres: value.distanceMetres as number, points: value.points as [WorldPoint, WorldPoint] } : {}),
    ...(typeof value.reason === "string" && /^[a-z_]{1,100}$/.test(value.reason) ? { reason: value.reason } : {}) };
}

/** Convert a click in a contain-fitted video to top-left-origin UV; reject bars. */
export function measurementUv(x: number, y: number, box: { left: number; top: number; width: number; height: number }, width: number, height: number): [number, number] | null {
  if (![x, y, box.left, box.top, box.width, box.height, width, height].every(finite)
    || Math.min(box.width, box.height, width, height) <= 0) return null;
  const scale = Math.min(box.width / width, box.height / height);
  const u = (x - box.left - (box.width - width * scale) / 2) / (width * scale);
  const v = (y - box.top - (box.height - height * scale) / 2) / (height * scale);
  return u >= 0 && v >= 0 && u < 1 && v < 1 ? [u, v] : null;
}

export class MeasurementExchange {
  state: MeasurementState = { status: "idle" };
  private id = "";
  private units: number | null = null;
  private firstPoint: WorldPoint | null = null;
  private snapshot: string | null = null;
  private pending: { requestId: string; action: MeasurementAction | "pick" } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly host: {
    snapshot(): string | null;
    requestId(): string;
    send(payload: Record<string, unknown>): boolean;
    complete(id: string, outcome: "success" | "error" | "timed-out" | "superseded"): void;
    notify(state: MeasurementState): void;
  }) {}
  get capturesInput(): boolean { return ["pending", "first", "second"].includes(this.state.status); }
  private publish(state: MeasurementState): void { this.state = state; this.host.notify(state); }
  private retire(outcome: "success" | "error" | "timed-out" | "superseded"): string | undefined {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const id = this.pending?.requestId;
    this.pending = null;
    if (id) this.host.complete(id, outcome);
    return id;
  }
  sync(): void {
    if (this.snapshot !== null && this.host.snapshot() !== this.snapshot) {
      this.retire("superseded"); this.snapshot = null; this.id = "";
      this.publish({ status: "unconfirmed" });
    }
  }
  control(action: MeasurementAction): void {
    this.sync();
    if (action === "start") {
      if (this.pending) return;
      this.id = this.host.requestId();
      this.units = null; this.firstPoint = null;
      this.snapshot = this.host.snapshot();
    } else {
      this.retire("superseded");
      if (!this.id) { this.publish({ status: action === "clear" ? "cleared" : "cancelled" }); return; }
    }
    this.send(action);
  }
  pick(uv: [number, number]): void {
    this.sync();
    if (!["first", "second"].includes(this.state.status) || this.pending || !uv.every(n => finite(n) && n >= 0 && n < 1)) return;
    this.send("pick", uv);
  }
  private send(action: MeasurementAction | "pick", uv?: [number, number]): void {
    if (this.snapshot === null || this.host.snapshot() !== this.snapshot) {
      this.publish({ status: "error", reason: "unavailable" }); return;
    }
    const requestId = this.host.requestId();
    this.pending = { requestId, action };
    this.publish({ status: "pending", requestId });
    this.timer = setTimeout(() => {
      this.retire("timed-out"); this.publish({ status: "error", reason: "timeout", requestId });
    }, 10000);
    try {
      if (!this.host.send({ request_id: requestId, action, measurement_id: this.id, ...(uv ? { uv } : {}) })) this.fail(requestId, "unavailable");
    } catch { this.fail(requestId, "transport"); }
  }
  fail(requestId: string, reason: string): void {
    if (this.pending?.requestId !== requestId) return;
    this.retire("error"); this.publish({ status: "error", reason, requestId });
  }
  receive(payload: Record<string, unknown>): boolean {
    this.sync();
    const pending = this.pending;
    if (!pending || payload.request_id !== pending.requestId || payload.measurement_id !== this.id) return false;
    const requestId = pending.requestId;
    let state: MeasurementState = { status: "error", reason: "readback", requestId };
    if (payload.status === "started" && pending.action === "start" && finite(payload.meters_per_unit) && payload.meters_per_unit > 0) {
      this.units = payload.meters_per_unit; state = { status: "first", requestId };
    } else if (payload.status === "point" && pending.action === "pick" && this.firstPoint === null && payload.point_index === 1 && point(payload.point)) {
      this.firstPoint = [...payload.point]; state = { status: "second", requestId };
    }
    else if (payload.status === "result" && pending.action === "pick" && Array.isArray(payload.points) && payload.points.length === 2 && payload.points.every(point)
      && finite(payload.distance_metres) && payload.distance_metres >= 0 && finite(payload.distance_model_units) && finite(payload.meters_per_unit) && payload.meters_per_unit > 0) {
      const [a, b] = payload.points;
      const model = Math.hypot(...a.map((n, i) => n - b[i]));
      const metres = model * payload.meters_per_unit;
      if (this.firstPoint && a.every((n, i) => n === this.firstPoint?.[i]) && payload.meters_per_unit === this.units
        && Number.isFinite(metres) && Math.abs(metres - payload.distance_metres) <= 1e-9 * Math.max(1, metres)
        && Math.abs(model - payload.distance_model_units) <= 1e-9 * Math.max(1, model)) {
        state = { status: "result", requestId, distanceMetres: payload.distance_metres, points: payload.points as [WorldPoint, WorldPoint] };
      }
    } else if (payload.status === "cancelled" && pending.action === "cancel") state = { status: "cancelled", requestId };
    else if (payload.status === "cleared" && pending.action === "clear") state = { status: "cleared", requestId };
    else if (payload.status === "rejected") state = { status: "error", reason: "rejected", requestId };
    this.retire(state.status === "error" ? "error" : "success"); this.publish(state);
    return true;
  }
  dispose(): void { this.retire("superseded"); this.snapshot = null; this.id = ""; }
}
