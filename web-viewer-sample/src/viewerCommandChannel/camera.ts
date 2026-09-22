import { CAMERA_PROJECTIONS, CAMERA_VIEW_PRESETS, CAMERA_VIEW_SCOPES, FLY_SPEED } from "../generated/kit-command-vocabulary";

// 值域來自 Kit Command Vocabulary（schema 的 x-kit-constant）；PRESET_FORWARD 以 Record<CameraPreset, …> 保證每個 preset 都有方向。
export type CameraPreset = (typeof CAMERA_VIEW_PRESETS)[number];
export type CameraProjection = (typeof CAMERA_PROJECTIONS)[number];
export type CameraScope = (typeof CAMERA_VIEW_SCOPES)[number];
export type CameraViewInput =
  | { action: "preset"; view: CameraPreset; scope: CameraScope }
  | { action: "projection"; projection: CameraProjection };
export type Vec3 = [number, number, number];
export interface CameraState {
  projection: CameraProjection; position: Vec3; direction: Vec3; up: Vec3;
  targetDistance: number; fovDeg: number | null; orthoHeight: number | null;
}
export type CommandReason = "invalid" | "busy" | "unavailable" | "rejected" | "transport" | "timeout" | "readback";
type ReplyStatus = "applied" | "unconfirmed" | "error";
export interface CameraReply { status: ReplyStatus; clientRequestId?: string; requestId?: string; reason?: CommandReason; camera?: CameraState }
export interface FlyReply { status: ReplyStatus; clientRequestId?: string; requestId?: string; reason?: CommandReason; speed?: number }
export type CameraViewState = { status: "idle" | "pending" } | CameraReply;
export type FlyState = { status: "idle" | "pending" } | FlyReply;
export interface ExchangeReply<V> { status: ReplyStatus; clientRequestId?: string; requestId?: string; reason?: CommandReason; value?: V }

const S = 1 / Math.sqrt(3);
// Camera forward (where the camera looks) per preset, in model axes with Z up. Mirrors Kit camera_view.py.
export const PRESET_FORWARD: Record<CameraPreset, Vec3> = {
  top: [0, 0, -1], front: [0, 1, 0], back: [0, -1, 0], left: [1, 0, 0], right: [-1, 0, 0], iso: [-S, S, -S],
};
export const FLY_SPEED_MIN = FLY_SPEED.minimum;
export const FLY_SPEED_MAX = FLY_SPEED.maximum;
const PRESETS = Object.keys(PRESET_FORWARD) as CameraPreset[];
const PROJECTIONS: readonly CameraProjection[] = CAMERA_PROJECTIONS;
const SCOPES: readonly CameraScope[] = CAMERA_VIEW_SCOPES;
const REASONS: CommandReason[] = ["invalid", "busy", "unavailable", "rejected", "transport", "timeout", "readback"];
const MAX_ABS = 1e9;
const COS_HALF_DEGREE = Math.cos(Math.PI / 360);

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_ABS;
const vec3 = (value: unknown): Vec3 | null =>
  Array.isArray(value) && value.length === 3 && value.every(finite) ? [value[0], value[1], value[2]] : null;
const correlationId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);

export function parseCameraViewInput(value: unknown): CameraViewInput | null {
  if (!record(value)) return null;
  if (value.action === "preset" && onlyKeys(value, ["action", "view", "scope"])
    && PRESETS.includes(value.view as CameraPreset) && SCOPES.includes(value.scope as CameraScope)) {
    return { action: "preset", view: value.view as CameraPreset, scope: value.scope as CameraScope };
  }
  if (value.action === "projection" && onlyKeys(value, ["action", "projection"])
    && PROJECTIONS.includes(value.projection as CameraProjection)) {
    return { action: "projection", projection: value.projection as CameraProjection };
  }
  return null;
}

function buildCameraState(projection: unknown, position: unknown, direction: unknown, up: unknown,
  distance: unknown, fov: unknown, ortho: unknown): CameraState | null {
  const p = vec3(position), d = vec3(direction), u = vec3(up);
  if (!PROJECTIONS.includes(projection as CameraProjection) || !p || !d || !u || !finite(distance) || distance <= 0) return null;
  const perspective = projection === "perspective";
  if (perspective ? !(finite(fov) && fov > 0 && fov < 180) || ortho !== null
    : fov !== null || !(finite(ortho) && ortho > 0)) return null;
  return { projection: projection as CameraProjection, position: p, direction: d, up: u, targetDistance: distance,
    fovDeg: perspective ? fov as number : null, orthoHeight: perspective ? null : ortho as number };
}

export function parseCameraState(value: unknown): CameraState | null {
  if (!record(value) || !onlyKeys(value, ["projection", "position", "direction", "up", "target_distance", "fov_deg", "ortho_height"])) return null;
  return buildCameraState(value.projection, value.position, value.direction, value.up, value.target_distance, value.fov_deg, value.ortho_height);
}

export function parseClientCameraState(value: unknown): CameraState | null {
  if (!record(value) || !onlyKeys(value, ["projection", "position", "direction", "up", "targetDistance", "fovDeg", "orthoHeight"])) return null;
  return buildCameraState(value.projection, value.position, value.direction, value.up, value.targetDistance, value.fovDeg, value.orthoHeight);
}

function successCamera(payload: Record<string, unknown>): CameraState | null {
  return payload.result === "success" ? parseCameraState(payload.camera) : null;
}

function alignedWith(direction: Vec3, forward: Vec3): boolean {
  const length = Math.hypot(...direction);
  if (!(length > 0)) return false;
  const dot = (direction[0] * forward[0] + direction[1] * forward[1] + direction[2] * forward[2]) / length;
  return dot >= COS_HALF_DEGREE;
}

export function cameraViewReadback(input: CameraViewInput, payload: Record<string, unknown>): CameraState | null {
  const camera = successCamera(payload);
  if (!camera) return null;
  if (input.action === "preset") return alignedWith(camera.direction, PRESET_FORWARD[input.view]) ? camera : null;
  return camera.projection === input.projection ? camera : null;
}

export function cameraStateReadback(_input: null, payload: Record<string, unknown>): CameraState | null {
  return successCamera(payload);
}

export function parseFlySpeed(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= FLY_SPEED_MIN && value <= FLY_SPEED_MAX ? value : null;
}

export function flyReadback(_speed: number, payload: Record<string, unknown>): number | null {
  // Kit may clamp to its own speed limits; the reported value is the truth shown to users.
  return payload.result === "success" ? parseFlySpeed(payload.speed) : null;
}

export function parseReplyBase(value: unknown): (Omit<ExchangeReply<never>, "value"> & { raw: Record<string, unknown> }) | null {
  if (!record(value) || !["applied", "unconfirmed", "error"].includes(value.status as string)) return null;
  if (value.clientRequestId !== undefined && !correlationId(value.clientRequestId)) return null;
  if (value.requestId !== undefined && !correlationId(value.requestId)) return null;
  if (value.status === "applied" && (!value.clientRequestId || !value.requestId)) return null;
  if (value.reason !== undefined && !REASONS.includes(value.reason as CommandReason)) return null;
  return { raw: value, status: value.status as ReplyStatus,
    ...(value.clientRequestId ? { clientRequestId: value.clientRequestId as string } : {}),
    ...(value.requestId ? { requestId: value.requestId as string } : {}),
    ...(value.reason ? { reason: value.reason as CommandReason } : {}) };
}

export function parseCameraReply(value: unknown): CameraReply | null {
  const base = parseReplyBase(value);
  if (!base) return null;
  const { raw, ...reply } = base;
  const camera = raw.camera === undefined ? undefined : parseClientCameraState(raw.camera);
  if (camera === null || (reply.status === "applied" && !camera)) return null;
  return { ...reply, ...(camera ? { camera } : {}) };
}

export function parseFlyReply(value: unknown): FlyReply | null {
  const base = parseReplyBase(value);
  if (!base) return null;
  const { raw, ...reply } = base;
  const speed = raw.speed === undefined ? undefined : parseFlySpeed(raw.speed);
  if (speed === null || (reply.status === "applied" && speed === undefined)) return null;
  return { ...reply, ...(speed !== undefined ? { speed } : {}) };
}

/** One bounded runtime request with Kit readback. Authority and terminal ownership remain with Window. */
export class CorrelatedRuntimeExchange<I, V> {
  private pending: { input: I; clientRequestId: string; requestId: string; snapshot: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private confirmedSnapshot: string | null = null;
  constructor(private readonly host: {
    parse(value: unknown): I | null;
    readback(input: I, payload: Record<string, unknown>): V | null;
    snapshot(): string | null;
    requestId(): string;
    send(input: I, requestId: string): boolean;
    complete(requestId: string, outcome: "success" | "error" | "timed-out" | "superseded"): void;
    notify(reply: ExchangeReply<V>): void;
  }, private readonly timeoutMs = 10_000) {}
  start(value: unknown, clientRequestId: string): void {
    if (!correlationId(clientRequestId)) return;
    this.sync();
    if (this.pending) { this.host.notify({ status: "error", reason: "busy", clientRequestId }); return; }
    const input = this.host.parse(value), snapshot = this.host.snapshot();
    if (input === null || snapshot === null) {
      this.host.notify({ status: "error", reason: input === null ? "invalid" : "unavailable", clientRequestId }); return;
    }
    const requestId = this.host.requestId();
    this.pending = { input, snapshot, requestId, clientRequestId };
    this.timer = setTimeout(() => this.finish({ status: "error", reason: "timeout" }, "timed-out"), this.timeoutMs);
    try {
      if (!this.host.send(input, requestId)) this.finish({ status: "error", reason: "unavailable" }, "error");
    } catch {
      this.finish({ status: "error", reason: "transport" }, "error");
    }
  }
  receive(payload: Record<string, unknown>): boolean {
    const pending = this.pending;
    if (!pending || payload.request_id !== pending.requestId) return false;
    const value = this.host.readback(pending.input, payload);
    this.finish(value === null ? { status: "error", reason: "readback" } : { status: "applied", value },
      value === null ? "error" : "success");
    return true;
  }
  fail(requestId: string, reason: "transport" | "rejected"): void {
    if (this.pending?.requestId === requestId) this.finish({ status: "error", reason }, "error");
  }
  sync(): void {
    const snapshot = this.host.snapshot();
    if (this.pending && snapshot !== this.pending.snapshot) this.finish({ status: "unconfirmed" }, "superseded");
    if (this.confirmedSnapshot !== null && snapshot !== this.confirmedSnapshot) {
      this.confirmedSnapshot = null;
      this.host.notify({ status: "unconfirmed" });
    }
  }
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.pending = null; this.confirmedSnapshot = null;
  }
  private finish(reply: ExchangeReply<V>, outcome: "success" | "error" | "timed-out" | "superseded"): void {
    const pending = this.pending;
    if (!pending) return;
    const stale = this.host.snapshot() !== pending.snapshot;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.pending = null;
    this.confirmedSnapshot = !stale && reply.status === "applied" ? pending.snapshot : null;
    this.host.complete(pending.requestId, stale ? "superseded" : outcome);
    this.host.notify({ ...(stale ? { status: "unconfirmed" as const } : reply),
      clientRequestId: pending.clientRequestId, requestId: pending.requestId });
  }
}

/** Parent-window side: one outstanding request per command family. */
export class PendingReply<R extends { clientRequestId?: string }> {
  private current: { id: string; resolve: (reply: R) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  constructor(private readonly timeoutReply: R, private readonly cancelReply: R, private readonly timeoutMs = 11_000) {}
  get busy(): boolean { return this.current !== null; }
  start(id: string, post: () => void, transportReply: R): Promise<R> {
    if (this.current) return Promise.reject(new Error("PendingReply already has an outstanding request."));
    return new Promise<R>(resolve => {
      const timer = setTimeout(() => {
        if (this.current?.id !== id) return;
        this.current = null; resolve(this.timeoutReply);
      }, this.timeoutMs);
      this.current = { id, resolve, timer };
      try { post(); } catch {
        clearTimeout(timer); this.current = null; resolve(transportReply);
      }
    });
  }
  settle(reply: R): boolean {
    const current = this.current;
    if (!current || reply.clientRequestId !== current.id) return false;
    this.current = null; clearTimeout(current.timer); current.resolve(reply);
    return true;
  }
  cancel(): void {
    const current = this.current;
    this.current = null;
    if (current) { clearTimeout(current.timer); current.resolve(this.cancelReply); }
  }
}
