import { OVERLAY_PLAYBACK_ACTIONS, OVERLAY_PLAYBACK_RATE } from "../generated/kit-command-vocabulary";
import { parseReplyBase, type CommandReason } from "./camera";
import { parseOverlayPrimPath } from "./overlayStyle";

export interface OverlayVisibilityItem { primPath: string; visible: boolean }
export interface OverlayVisibilityInput { items: OverlayVisibilityItem[] }
export interface OverlayVisibilityCommand { items: Array<{ primPath: string; visible?: boolean }> }
export interface OverlayVisibilityReadback { items: Array<OverlayVisibilityItem & { present: boolean }> }
export interface OverlayPlaybackInput { action: typeof OVERLAY_PLAYBACK_ACTIONS[number]; rate?: number; sampleIndex?: number }
export interface OverlayPlaybackReadback { playing: boolean; rate: number; timeSeconds: number;
  runId?: string; sampleIndex?: number; physicalTimeSeconds?: number }
interface ReplyBase { status: "applied" | "unconfirmed" | "error"; clientRequestId?: string; requestId?: string; reason?: CommandReason }
export interface OverlayVisibilityReply extends ReplyBase { items?: OverlayVisibilityReadback["items"] }
export interface OverlayPlaybackReply extends ReplyBase { playing?: boolean; rate?: number; timeSeconds?: number;
  runId?: string; sampleIndex?: number; physicalTimeSeconds?: number }
export type OverlayVisibilityState = { status: "idle" | "pending" } | OverlayVisibilityReply;
export type OverlayPlaybackState = { status: "idle" | "pending" } | OverlayPlaybackReply;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const rateOf = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value)
  && value >= OVERLAY_PLAYBACK_RATE.minimum && value <= OVERLAY_PLAYBACK_RATE.maximum ? value : null;

export function parseOverlayVisibilityInput(value: unknown): OverlayVisibilityCommand | null {
  if (!record(value) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 32) return null;
  const items: OverlayVisibilityCommand["items"] = [];
  for (const item of value.items) {
    if (!record(item) || (item.visible !== undefined && typeof item.visible !== "boolean")) return null;
    const primPath = parseOverlayPrimPath(item.primPath);
    if (!primPath || items.some(existing => existing.primPath === primPath)) return null;
    items.push({ primPath, ...(item.visible === undefined ? {} : { visible: item.visible as boolean }) });
  }
  return { items };
}

function visibilityValue(value: unknown): OverlayVisibilityReadback | null {
  const parsed = parseOverlayVisibilityInput(value);
  if (!parsed || !record(value)) return null;
  const raw = value.items as Record<string, unknown>[];
  if (raw.some(item => typeof item.present !== "boolean" || typeof item.visible !== "boolean" || (!item.present && item.visible))) return null;
  return { items: parsed.items.map((item, i) => ({ ...item, visible: raw[i].visible as boolean, present: raw[i].present as boolean })) };
}

export function overlayVisibilityReadback(input: OverlayVisibilityCommand, payload: Record<string, unknown>): OverlayVisibilityReadback | null {
  if (payload.result !== "success" || !Array.isArray(payload.items)) return null;
  const value = visibilityValue({ items: payload.items.map(item => record(item)
    ? { primPath: item.prim_path, visible: item.visible, present: item.present } : item) });
  return value && value.items.length === input.items.length
    && input.items.every(item => value.items.some(actual => actual.primPath === item.primPath)) ? value : null;
}

export function parseOverlayPlaybackInput(value: unknown): OverlayPlaybackInput | null {
  if (!record(value) || !OVERLAY_PLAYBACK_ACTIONS.includes(value.action as OverlayPlaybackInput["action"])) return null;
  const action = value.action as OverlayPlaybackInput["action"];
  if (action === "seek") return value.rate === undefined && typeof value.sampleIndex === "number"
    && Number.isInteger(value.sampleIndex) && value.sampleIndex >= 0 && value.sampleIndex <= 63
    ? { action, sampleIndex: value.sampleIndex } : null;
  if (value.sampleIndex !== undefined) return null;
  if (action !== "set_rate") return value.rate === undefined ? { action } : null;
  const rate = rateOf(value.rate);
  return rate === null ? null : { action, rate };
}

function playbackValue(value: unknown): OverlayPlaybackReadback | null {
  if (!record(value) || typeof value.playing !== "boolean" || rateOf(value.rate) === null
    || typeof value.timeSeconds !== "number" || !Number.isFinite(value.timeSeconds) || value.timeSeconds < 0) return null;
  const temporal = value.runId !== undefined || value.sampleIndex !== undefined || value.physicalTimeSeconds !== undefined;
  if (temporal && (typeof value.runId !== "string" || !/^cfd_[A-Za-z0-9_]{6,120}$/.test(value.runId)
    || typeof value.sampleIndex !== "number" || !Number.isInteger(value.sampleIndex) || value.sampleIndex < 0 || value.sampleIndex > 63
    || typeof value.physicalTimeSeconds !== "number" || !Number.isFinite(value.physicalTimeSeconds) || value.physicalTimeSeconds < 0)) return null;
  return { playing: value.playing, rate: value.rate as number, timeSeconds: value.timeSeconds,
    ...(temporal ? { runId: value.runId as string, sampleIndex: value.sampleIndex as number,
      physicalTimeSeconds: value.physicalTimeSeconds as number } : {}) };
}

export function overlayPlaybackReadback(input: OverlayPlaybackInput, payload: Record<string, unknown>): OverlayPlaybackReadback | null {
  const value = payload.result === "success" ? playbackValue({ ...payload, timeSeconds: payload.time_seconds,
    runId: payload.run_id, sampleIndex: payload.sample_index, physicalTimeSeconds: payload.physical_time_seconds }) : null;
  return input.action === "seek" && value?.sampleIndex !== input.sampleIndex ? null : value;
}

export function parseOverlayVisibilityReply(value: unknown): OverlayVisibilityReply | null {
  const base = parseReplyBase(value);
  if (!base) return null;
  const { raw, ...reply } = base;
  const actual = visibilityValue(raw);
  return reply.status === "applied" ? (actual ? { ...reply, ...actual } : null) : reply;
}

export function parseOverlayPlaybackReply(value: unknown): OverlayPlaybackReply | null {
  const base = parseReplyBase(value);
  if (!base) return null;
  const { raw, ...reply } = base;
  const actual = playbackValue(raw);
  return reply.status === "applied" ? (actual ? { ...reply, ...actual } : null) : reply;
}
