import type { CfdRunResult, CfdRunDirectionResult } from "../console/unified/cfdClient";
import { isNorthReference, northCaption, referencedHeading, type NorthReference } from "./northReference";

export interface HudScale { min: number; max: number; unit: string; label: string }
export interface CfdHudModel {
  revisionId: string;
  runId: string;
  windFrom: number;
  modelBearing: number | null;
  northLabel: string;
  northReference?: NorthReference | null;
  validationLevel: string;
  purpose: "design_comparison_only";
  velocity: HudScale | null;
  pressure: HudScale | null;
}
export const modelWindBearing = (bearing: number, north: number): number => ((bearing - north) % 360 + 360) % 360;

/** Only the applied result drives these labels; never read the editable run form. */
export function buildCfdHud(result: CfdRunResult, direction: CfdRunDirectionResult, revisionId: string, pressureVisible: boolean): CfdHudModel {
  const frame = result.wind_frame;
  const assumedProject = result.assumptions.some(a => a === "true_north_unknown_assumed_project_north" || a === "true_north_default_direction");
  const north = frame?.true_north_degrees_used ?? (assumedProject ? 0 : null);
  const normalizedNorth = typeof north === "number" && Number.isFinite(north) ? ((north % 360) + 360) % 360 : null;
  const reference = { degrees: normalizedNorth, source: frame?.true_north_source === "manual" ? "manual" : "IFC" };
  const northReference = frame?.directions_relative_to === "true_north" && !assumedProject
    && (frame.true_north_source === "manual" || frame.true_north_source === "geo_reference") && isNorthReference(reference) ? reference : null;
  const scale = (value: { available?: boolean; min?: number; max?: number; unit: string } | undefined, label: string): HudScale | null =>
    value && value.available !== false && typeof value.min === "number" && typeof value.max === "number"
      && Number.isFinite(value.min) && Number.isFinite(value.max) && value.max > value.min
      ? { min: value.min, max: value.max, unit: value.unit, label } : null;
  return {
    revisionId, runId: result.run_id, windFrom: direction.wind_from_degrees,
    northReference,
    modelBearing: north === null ? null : modelWindBearing(direction.wind_from_degrees, north),
    northLabel: northReference ? `相對 true north · ${northReference.source === "manual" ? "手動" : "IFC"}`
      : north === null ? "相對 project north；真北角未記錄，風向箭頭未提供" : "相對 project north",
    validationLevel: result.validation_level ?? "未提供", purpose: result.purpose,
    velocity: scale(direction.legend?.U, "風速 |U|"),
    pressure: pressureVisible ? scale(direction.legend?.p, "表面運動壓力 p/ρ（相對出口）") : null,
  };
}

/** postMessage is untrusted even after the existing parent-origin guard. */
export function parseCfdHud(value: unknown): CfdHudModel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const text = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
  const angle = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 360;
  const scale = (x: unknown): x is HudScale | null => {
    if (x === null) return true;
    if (!x || typeof x !== "object" || Array.isArray(x)) return false;
    const s = x as Record<string, unknown>;
    return typeof s.min === "number" && Number.isFinite(s.min) && typeof s.max === "number" && Number.isFinite(s.max)
      && s.max > s.min && text(s.unit, 40) && text(s.label, 100);
  };
  if (!text(v.revisionId, 240) || !text(v.runId, 124) || !/^cfd_[A-Za-z0-9_]{6,120}$/.test(v.runId)
    || !angle(v.windFrom) || !(v.modelBearing === null || angle(v.modelBearing)) || !text(v.northLabel, 120)
    || !(v.northReference === undefined || v.northReference === null || isNorthReference(v.northReference))
    || !text(v.validationLevel, 40) || v.purpose !== "design_comparison_only" || !scale(v.velocity) || !scale(v.pressure)) return null;
  return { revisionId: v.revisionId, runId: v.runId, windFrom: v.windFrom, modelBearing: v.modelBearing,
    ...(v.northReference === undefined ? {} : { northReference: v.northReference as NorthReference | null }),
    northLabel: v.northLabel, validationLevel: v.validationLevel, purpose: v.purpose, velocity: v.velocity, pressure: v.pressure };
}

export const CFD_COLOUR_STOPS = ["#0000ff", "#00ffff", "#00ff00", "#ffff00", "#ff0000"] as const;

/** Shared canvas painter for the visible HUD and the later local capture slice. */
export function drawCfdHud(ctx: CanvasRenderingContext2D, width: number, height: number, hud: CfdHudModel, heading: number | null, utc: string): void {
  ctx.save();
  const factor = Math.min(1.5, Math.max(.65, width / 900));
  ctx.scale(factor, factor);
  const w = width / factor, h = height / factor;
  ctx.font = "12px sans-serif"; ctx.textBaseline = "top";
  const box = (x: number, y: number, bw: number, bh: number) => { ctx.fillStyle = "rgba(5,12,22,.88)"; ctx.fillRect(x, y, bw, bh); ctx.fillStyle = "#ffffff"; };
  let y = 14;
  for (const scale of [hud.velocity, hud.pressure]) {
    if (!scale) continue;
    box(14, y, 280, 75);
    ctx.fillText(`${scale.label} · ${scale.unit}`, 24, y + 8);
    const gradient = ctx.createLinearGradient(24, 0, 274, 0);
    CFD_COLOUR_STOPS.forEach((colour, i) => gradient.addColorStop(i / 4, colour));
    ctx.fillStyle = gradient; ctx.fillRect(24, y + 29, 250, 10); ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 5; i++) {
      ctx.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center";
      ctx.fillText((scale.min + (scale.max - scale.min) * i / 4).toFixed(2), 24 + i * 62.5, y + 46);
    }
    ctx.textAlign = "left"; y += 83;
  }
  box(14, y, 320, 44);
  ctx.fillText(`風的來向 ${hud.windFrom}° · ${hud.northLabel}`, 24, y + 7);
  ctx.fillText("示意動畫，基於穩態解；非瞬態模擬", 24, y + 25);
  // Same project-north camera convention as CompassHud; arrow points toward the incoming wind.
  const cx = 64, cy = h - 90, modelTurn = (heading ?? 0) * Math.PI / 180,
    turn = referencedHeading(heading ?? 0, hud.northReference) * Math.PI / 180;
  box(14, h - 145, 100, 114);
  ctx.strokeStyle = "#9baec0"; ctx.beginPath(); ctx.arc(cx, cy, 43, 0, 2 * Math.PI); ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const [i, label] of ["N", "E", "S", "W"].entries()) {
    const angle = i * Math.PI / 2 - turn;
    ctx.fillText(label, cx + Math.sin(angle) * 30, cy - Math.cos(angle) * 30);
  }
  if (hud.modelBearing !== null && heading !== null) {
    const angle = hud.modelBearing * Math.PI / 180 - modelTurn;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.strokeStyle = "#ff8058"; ctx.fillStyle = "#ff8058"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(0, -22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -29); ctx.lineTo(-6, -17); ctx.lineTo(6, -17); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  ctx.fillText(heading === null ? "方位未取得" : northCaption(hud.northReference), cx, h - 40);
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  box(124, h - 53, Math.max(100, w - 138), 39);
  ctx.fillText(`設計比較用 · ${hud.validationLevel} · ${hud.runId.slice(-12)} · ${hud.windFrom}°`, 134, h - 48);
  ctx.fillText(`${hud.northLabel} · ${utc}`, 134, h - 30);
  ctx.restore();
}
