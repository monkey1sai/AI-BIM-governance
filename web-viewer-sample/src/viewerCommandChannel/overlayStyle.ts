// CFD 疊圖透明度（S5）：console → viewer `overlay_style` → Kit `overlayStyleRequest`（session layer 覆寫 displayOpacity）。
// 值域來自 Kit Command Vocabulary（OVERLAY_DISPLAY_OPACITY）；prim path 只允許 /World/Overlays/Cfd 之下，與 schema pattern 同形。
import { OVERLAY_DISPLAY_OPACITY } from "../generated/kit-command-vocabulary";
import { parseReplyBase, type CommandReason } from "./camera";

export const OVERLAY_DISPLAY_OPACITY_MIN = OVERLAY_DISPLAY_OPACITY.minimum;
export const OVERLAY_DISPLAY_OPACITY_MAX = OVERLAY_DISPLAY_OPACITY.maximum;
export const CFD_OVERLAY_ROOT = "/World/Overlays/Cfd";
/** 行人風場切面 prim 名（cfd_pipeline/usd_results.py）；滑桿只調這一片，建物面與流線維持原色階。 */
export const CFD_PEDESTRIAN_PLANE_PRIM = "PedestrianWind_1p5m";
const PRIM_PATH = /^\/World\/Overlays\/Cfd\/[A-Za-z_][A-Za-z0-9_]*(\/[A-Za-z_][A-Za-z0-9_]*)*$/;
const PRIM_PATH_MAX_LENGTH = 400;

export interface OverlayStyleInput { primPath: string; displayOpacity: number }
type ReplyStatus = "applied" | "unconfirmed" | "error";
export interface OverlayStyleReply {
  status: ReplyStatus; clientRequestId?: string; requestId?: string; reason?: CommandReason; primPath?: string; displayOpacity?: number;
}
export type OverlayStyleState = { status: "idle" | "pending" } | OverlayStyleReply;

/** 與 usd_results.safe_prim_name 同規則：非 [A-Za-z0-9_] 換成 _，首字非字母／底線就補 _。 */
export function cfdSafePrimName(value: string): string {
  const name = value.replace(/[^A-Za-z0-9_]/g, "_");
  return name && /^[A-Za-z_]/.test(name) ? name : `_${name}`;
}

export function cfdOverlayPrimPath(runId: string, primName: string = CFD_PEDESTRIAN_PLANE_PRIM): string {
  return `${CFD_OVERLAY_ROOT}/${cfdSafePrimName(runId)}/${primName}`;
}

export function parseOverlayPrimPath(value: unknown): string | null {
  return typeof value === "string" && value.length <= PRIM_PATH_MAX_LENGTH && PRIM_PATH.test(value) ? value : null;
}

export function parseDisplayOpacity(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    && value >= OVERLAY_DISPLAY_OPACITY_MIN && value <= OVERLAY_DISPLAY_OPACITY_MAX ? value : null;
}

export function parseOverlayStyleInput(value: unknown): OverlayStyleInput | null {
  if (!value || typeof value !== "object") return null;
  const { primPath, displayOpacity } = value as Record<string, unknown>;
  const path = parseOverlayPrimPath(primPath);
  const opacity = parseDisplayOpacity(displayOpacity);
  return path !== null && opacity !== null ? { primPath: path, displayOpacity: opacity } : null;
}

/** Kit 回報的 readback 才是給使用者看的真值；prim 路徑也要對得上這次請求。 */
export function overlayStyleReadback(input: OverlayStyleInput, payload: Record<string, unknown>): OverlayStyleInput | null {
  if (payload.result !== "success" || payload.prim_path !== input.primPath) return null;
  const opacity = parseDisplayOpacity(payload.display_opacity);
  return opacity === null ? null : { primPath: input.primPath, displayOpacity: opacity };
}

export function parseOverlayStyleReply(value: unknown): OverlayStyleReply | null {
  const base = parseReplyBase(value);
  if (!base) return null;
  const { raw, ...reply } = base;
  const primPath = raw.primPath === undefined ? undefined : parseOverlayPrimPath(raw.primPath);
  const displayOpacity = raw.displayOpacity === undefined ? undefined : parseDisplayOpacity(raw.displayOpacity);
  if (primPath === null || displayOpacity === null) return null;
  if (reply.status === "applied" && (primPath === undefined || displayOpacity === undefined)) return null;
  return { ...reply, ...(primPath !== undefined ? { primPath } : {}), ...(displayOpacity !== undefined ? { displayOpacity } : {}) };
}
