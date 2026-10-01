import type { CfdRunResult, CfdRunDirectionResult } from "../console/unified/cfdClient";
import { isNorthReference, northCaption, referencedHeading, type NorthReference } from "./northReference";

export interface HudScale { min: number; max: number; unit: string; label: string }
export interface CfdHudSection { id: string; label: string; axis: "x" | "y" | "z"; positionM: number;
  footprint: number[][]; groundZ: number; buildingHeight: number }
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
  section?: CfdHudSection | null;
}
export const modelWindBearing = (bearing: number, north: number): number => ((bearing - north) % 360 + 360) % 360;

/** Only the applied result drives these labels; never read the editable run form. */
export function buildCfdHud(result: CfdRunResult, direction: CfdRunDirectionResult, revisionId: string, pressureVisible: boolean,
  section: CfdHudSection | null = null): CfdHudModel {
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
    ...(section ? { section } : {}),
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
  if (v.section !== undefined && v.section !== null) {
    const s = v.section as CfdHudSection, finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e9;
    if (typeof s !== "object" || !text(s.id, 120) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.id) || !text(s.label, 120)
      || !["x", "y", "z"].includes(s.axis) || !finite(s.positionM) || !finite(s.groundZ) || !finite(s.buildingHeight) || s.buildingHeight <= 0
      || !Array.isArray(s.footprint) || s.footprint.length < 3 || s.footprint.length > 64 || !s.footprint.every(p => Array.isArray(p) && p.length === 2 && p.every(finite))) return null;
  }
  return { revisionId: v.revisionId, runId: v.runId, windFrom: v.windFrom, modelBearing: v.modelBearing,
    ...(v.northReference === undefined ? {} : { northReference: v.northReference as NorthReference | null }),
    ...(v.section === undefined ? {} : { section: v.section as CfdHudSection | null }),
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
  if (hud.section) {
    const section = hud.section, bx = w - 206, by = 14;
    box(bx, by, 192, 194);
    ctx.fillText(`模型 XY · ${section.label}`, bx + 8, by + 8);
    ctx.fillText(`${section.axis.toUpperCase()} = ${section.positionM.toFixed(2)} m`, bx + 8, by + 25);
    const xs = section.footprint.map(p => p[0]), ys = section.footprint.map(p => p[1]);
    if (section.axis === "x") xs.push(section.positionM);
    if (section.axis === "y") ys.push(section.positionM);
    const xmin = Math.min(...xs), ymin = Math.min(...ys), xrange = Math.max(1, Math.max(...xs) - xmin), yrange = Math.max(1, Math.max(...ys) - ymin);
    const scale = Math.min(118 / xrange, 106 / yrange), x = (v: number) => bx + 12 + (v - xmin) * scale,
      y = (v: number) => by + 152 - (v - ymin) * scale;
    ctx.strokeStyle = "#9baec0"; ctx.lineWidth = 1; ctx.beginPath();
    section.footprint.forEach((p, i) => i === 0 ? ctx.moveTo(x(p[0]), y(p[1])) : ctx.lineTo(x(p[0]), y(p[1])));
    ctx.closePath(); ctx.stroke(); ctx.strokeStyle = "#ff8058"; ctx.lineWidth = 2; ctx.beginPath();
    if (section.axis === "x") { ctx.moveTo(x(section.positionM), by + 44); ctx.lineTo(x(section.positionM), by + 154); }
    else if (section.axis === "y") { ctx.moveTo(bx + 8, y(section.positionM)); ctx.lineTo(bx + 134, y(section.positionM)); }
    else {
      const px = bx + 158, top = by + 48, base = by + 152;
      ctx.moveTo(px, top); ctx.lineTo(px, base);
      const sy = base - Math.max(0, Math.min(1, (section.positionM - section.groundZ) / section.buildingHeight)) * (base - top);
      ctx.moveTo(px - 8, sy); ctx.lineTo(px + 8, sy);
      ctx.fillText("H", px + 9, top); ctx.fillText("0", px + 9, base - 12);
    }
    ctx.stroke();
    const north = (hud.northReference?.degrees ?? 0) * Math.PI / 180, nx = bx + 153, ny = by + 33;
    ctx.strokeStyle = "#ffffff"; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx - Math.sin(north) * 18, ny - Math.cos(north) * 18); ctx.stroke();
    ctx.fillText(hud.northReference ? "N 真北" : "N 專案北", bx + 128, by + 34);
    ctx.fillText("建物內部為實體；未模擬室內", bx + 8, by + 174);
  }
  box(124, h - 53, Math.max(100, w - 138), 39);
  ctx.fillText(`設計比較用 · ${hud.validationLevel} · ${hud.runId.slice(-12)} · ${hud.windFrom}°`, 134, h - 48);
  ctx.fillText(`${hud.northLabel} · ${utc}`, 134, h - 30);
  ctx.restore();
}
