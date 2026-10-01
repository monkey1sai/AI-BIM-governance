import { useEffect, useState } from "react";
import { t } from "../i18n";
import { controlField } from "./controlStyles";
import { commandErrorText } from "./viewerCommandText";
import { cfdOverlayPrimPathForArtifact } from "../../viewerCommandChannel/overlayStyle";
import type { ViewerCommandPort } from "../../viewerCommandChannel/parentSide";
import type { OverlayVisibilityState, OverlayVisibilityReadback, OverlayPlaybackState } from "../../viewerCommandChannel/overlayControls";

const ROLE_LABELS: Record<string, [string, string]> = {
  plane: ["行人面", "Pedestrian plane"], surface_pressure: ["表面壓力", "Surface pressure"],
  streamlines: ["流線", "Streamlines"], streamline_growth: ["流線生長", "Streamline growth"],
  particles: ["流動粒子", "Flow particles"], vectors: ["向量", "Vectors"], wind_arrow: ["風向箭頭", "Wind arrow"],
  section: ["切面", "Section"], section_vectors: ["切面向量", "Section vectors"], context: ["周遭量體", "Surrounding massing"],
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** CP3 adds the result schema; CP2 keeps old results' controls and accepts only declared, direct child prims. */
export function presentationPrims(direction: unknown): Array<{ name: string; role: string }> {
  if (!record(direction) || !record(direction.presentation) || direction.presentation.version !== 2
    || !Array.isArray(direction.presentation.prims)) return [];
  const seen = new Set<string>();
  return direction.presentation.prims.flatMap(prim => {
    if (!record(prim) || typeof prim.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(prim.name)
      || typeof prim.role !== "string" || !Object.prototype.hasOwnProperty.call(ROLE_LABELS, prim.role) || seen.has(prim.name)) return [];
    seen.add(prim.name);
    return [{ name: prim.name, role: prim.role }];
  });
}

export function OverlayPresentationControls({ artifactId, direction, ready, commands,
  visibility = { status: "idle" }, playback = { status: "idle" },
}: { artifactId: string; direction: unknown; ready: boolean; commands: ViewerCommandPort;
  visibility?: OverlayVisibilityState; playback?: OverlayPlaybackState }) {
  const [seen, setSeen] = useState<Record<string, OverlayVisibilityReadback["items"][number]>>({});
  useEffect(() => {
    if (visibility.status === "applied") setSeen(previous => ({ ...previous,
      ...Object.fromEntries((visibility.items ?? []).map(item => [item.primPath, item])) }));
    else if (visibility.status === "unconfirmed" || visibility.status === "error") setSeen({});
  }, [visibility]);
  const actual = playback.status === "applied" ? playback : null;
  const disabled = !ready || playback.status === "pending" || visibility.status === "pending";
  return <fieldset data-testid="wind-presentation-controls" style={{ border: "1px solid var(--border)", display: "grid", gap: 6 }}>
    <legend>{t("疊圖呈現", "Overlay presentation")}</legend>
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {(["play", "pause", "restart"] as const).map((action, index) => <button key={action} style={controlField}
        data-testid={`wind-playback-${action}`} disabled={disabled}
        onClick={() => { void commands.send("overlay_playback", { action }); }}>
        {t(...([["播放", "Play"], ["暫停", "Pause"], ["重播", "Restart"]] as [string, string][])[index])}
      </button>)}
      <select aria-label={t("動畫速度", "Animation speed")} data-testid="wind-playback-rate" style={controlField}
        value={actual?.rate ?? ""} disabled={disabled}
        onChange={event => { void commands.send("overlay_playback", { action: "set_rate", rate: Number(event.target.value) }); }}>
        <option value="" disabled>{t("速度尚未讀回", "Speed not yet confirmed")}</option>
        {[0.25, 0.5, 1, 2, 4].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
      </select>
    </div>
    <small role="status" data-testid="wind-playback-status" data-state={playback.status}>
      {actual ? `${t(actual.playing ? "播放中" : "已暫停", actual.playing ? "Playing" : "Paused")} · ${actual.rate}× · ${actual.timeSeconds?.toFixed(2)} s`
        : playback.status === "pending" ? t("等待播放狀態…", "Waiting for playback state…")
        : playback.status === "error" ? `${t("未能控制動畫（疊圖可能不含動畫）：", "Playback unavailable (the overlay may have no animation): ")}${commandErrorText(playback.reason)}`
        : t("播放狀態尚未確認；操作後顯示讀回值。", "Playback is unconfirmed; a control action returns the state.")}
    </small>
    <small>{t("示意動畫，基於穩態解；非瞬態模擬", "Illustrative animation based on a steady-state solution; not a transient simulation")}</small>
    {presentationPrims(direction).map(prim => {
      const path = cfdOverlayPrimPathForArtifact(artifactId, prim.name);
      if (!path) return null;
      const value = seen[path];
      return <div key={prim.name} data-testid={`wind-layer-${prim.name}`}>
        <span>{t(...ROLE_LABELS[prim.role])} · {prim.name} </span>
        {[true, false].map(visible => <button key={String(visible)} style={controlField}
          data-testid={`wind-layer-${visible ? "show" : "hide"}-${prim.name}`} disabled={disabled || value?.present === false}
          onClick={() => { void commands.send("overlay_visibility", { items: [{ primPath: path, visible }] }); }}>
          {t(visible ? "顯示" : "隱藏", visible ? "Show" : "Hide")}
        </button>)}
        <small>{value ? t(!value.present ? "此疊圖沒有此圖層" : value.visible ? "已顯示" : "已隱藏",
          !value.present ? "Layer absent" : value.visible ? "Visible" : "Hidden") : t("尚未讀回", "Unconfirmed")}</small>
      </div>;
    })}
    {visibility.status === "pending" ? <small>{t("等待圖層狀態…", "Waiting for layer state…")}</small> : null}
    {visibility.status === "error" ? <small role="alert">{t("圖層未能套用：", "Layer change failed: ")}{commandErrorText(visibility.reason)}</small> : null}
  </fieldset>;
}
