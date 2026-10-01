import { useEffect, useRef, useState } from "react";
import { confirmedPhysicalSample, temporalOf } from "./cfdTemporal";
import { t } from "../i18n";
import { controlField } from "./controlStyles";
import { commandErrorText } from "./viewerCommandText";
import { cfdOverlayPrimPathForArtifact } from "../../viewerCommandChannel/overlayStyle";
import type { OverlayStyleState } from "../../viewerCommandChannel/overlayStyle";
import { OverlayPressureOpacity } from "./OverlayPressureOpacity";
import type { ViewerCommandPort } from "../../viewerCommandChannel/parentSide";
import type { OverlayVisibilityState, OverlayVisibilityReadback, OverlayPlaybackState } from "../../viewerCommandChannel/overlayControls";

const ROLE_LABELS: Record<string, [string, string]> = {
  plane: ["行人面", "Pedestrian plane"], surface_pressure: ["表面壓力", "Surface pressure"],
  streamlines: ["流線", "Streamlines"], streamline_growth: ["流線生長", "Streamline growth"],
  particles: ["流動粒子", "Flow particles"], vectors: ["向量", "Vectors"], wind_arrow: ["風向箭頭", "Wind arrow"],
  near_wall_speed: ["近壁風速薄膜", "Near-wall wind speed"],
  section: ["切面", "Section"], section_vectors: ["切面向量", "Section vectors"], context: ["周遭量體", "Surrounding massing"],
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function nearWallSampling(direction: unknown): { distance: number; cell: number } | null {
  if (!record(direction) || !record(direction.presentation) || !record(direction.presentation.near_wall)) return null;
  const value = direction.presentation.near_wall;
  return value.reference === "computation_shell" && value.interpolation === "cellPoint"
    && typeof value.distance_m === "number" && Number.isFinite(value.distance_m) && value.distance_m > 0
    && typeof value.surface_cell_m === "number" && Number.isFinite(value.surface_cell_m) && value.surface_cell_m > 0
    ? { distance: value.distance_m, cell: value.surface_cell_m } : null;
}

function visualRoiSource(direction: unknown): "ifc_envelope" | "retained_geometry" | null {
  if (!record(direction) || !record(direction.presentation) || !record(direction.presentation.visual_roi)) return null;
  const value = direction.presentation.visual_roi;
  return (value.source === "ifc_envelope" || value.source === "retained_geometry")
    && value.horizontal_margin_h === 1 && value.top_margin_h === 0.25
    && Array.isArray(value.extent_m) && value.extent_m.length === 3
    && value.extent_m.every(n => typeof n === "number" && Number.isFinite(n) && n > 0)
    ? value.source : null;
}

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
  visibility = { status: "idle" }, playback = { status: "idle" }, styleState = { status: "idle" },
}: { artifactId: string; direction: unknown; ready: boolean; commands: ViewerCommandPort;
  visibility?: OverlayVisibilityState; playback?: OverlayPlaybackState; styleState?: OverlayStyleState }) {
  const [seen, setSeen] = useState<Record<string, OverlayVisibilityReadback["items"][number]>>({});
  useEffect(() => {
    if (visibility.status === "applied") setSeen(previous => ({ ...previous,
      ...Object.fromEntries((visibility.items ?? []).map(item => [item.primPath, item])) }));
    else if (visibility.status === "unconfirmed" || visibility.status === "error") setSeen({});
  }, [visibility]);
  const temporal = temporalOf(direction);
  const expectedRun = /^cfd:(cfd_[A-Za-z0-9_]+):w[0-9]{3}$/.exec(artifactId)?.[1];
  const actual = playback.status === "applied" && (!temporal || (expectedRun && confirmedPhysicalSample(temporal, expectedRun, playback))) ? playback : null;
  const disabled = !ready || playback.status === "pending" || visibility.status === "pending" || styleState.status === "pending";
  const nearWall = nearWallSampling(direction);
  const roiSource = visualRoiSource(direction);
  const queryBusy = useRef(false);
  const commandRef = useRef(commands);
  commandRef.current = commands;
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const [queryFailed, setQueryFailed] = useState(false);
  useEffect(() => {
    setQueryFailed(false);
    if (!ready || !temporal) return;
    let stopped = false;
    const items = presentationPrims(direction).flatMap(prim => {
      const primPath = cfdOverlayPrimPathForArtifact(artifactId, prim.name);
      return primPath ? [{ primPath }] : [];
    });
    if (items.length) void commandRef.current.send("overlay_visibility", { items }).catch(() => {
      if (!stopped) setQueryFailed(true);
    });
    const query = async () => {
      if (stopped || queryBusy.current || playbackRef.current.status === "pending") return;
      queryBusy.current = true;
      try {
        const reply = await commandRef.current.send("overlay_playback", { action: "query" });
        if (!stopped && ((reply.status === "error" && reply.reason !== "busy") || reply.status === "unconfirmed")) {
          setQueryFailed(true); stopped = true;
        }
      }
      catch { if (!stopped) { setQueryFailed(true); stopped = true; } }
      finally { queryBusy.current = false; }
    };
    void query();
    const timer = window.setInterval(() => { void query(); }, 500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [ready, artifactId, temporal?.mode]);
  return <fieldset data-testid="wind-presentation-controls" style={{ border: "1px solid var(--border)", display: "grid", gap: 6 }}>
    <legend>{t("疊圖呈現", "Overlay presentation")}</legend>
    {roiSource ? <small data-testid="wind-visual-roi">{t(
      `流線與向量聚焦${roiSource === "ifc_envelope" ? "建築主體" : "保留構件（無主體分類）"}周圍：水平外擴 1H，流線頂部外擴 0.25H（H 為主體地面以上高度）。計算域與行人雲圖統計不變；顯示範圍外不代表無風。`,
      `Tracks and vectors focus on ${roiSource === "ifc_envelope" ? "the building envelope" : "retained geometry (no envelope classification)"}: 1H horizontal margin and 0.25H above the roof for tracks. H is the above-ground height. Solver domain and pedestrian statistics are unchanged; outside the display region does not mean no wind.`,
    )}</small> : null}
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
      {actual ? `${t(actual.playing ? "播放中" : "已暫停", actual.playing ? "Playing" : "Paused")} · ${actual.rate}× · ${temporal ? t("物理時間 ", "Physical time ") + (actual.physicalTimeSeconds?.toFixed(2) ?? "未讀回") : actual.timeSeconds?.toFixed(2)} s`
        : playback.status === "pending" ? t("等待播放狀態…", "Waiting for playback state…")
        : playback.status === "error" ? `${t("未能控制動畫（疊圖可能不含動畫）：", "Playback unavailable (the overlay may have no animation): ")}${commandErrorText(playback.reason)}`
        : t("播放狀態尚未確認；操作後顯示讀回值。", "Playback is unconfirmed; a control action returns the state.")}
    </small>
    {queryFailed ? <small role="alert">{t("物理時間讀取中斷；重新載入疊圖後再驗證。", "Physical-time polling stopped; reload the overlay to verify again.")}</small> : null}
    {temporal ? <>
      <label>{t("已計算時間步", "Computed time step")}
        <input type="range" data-testid="wind-physical-time" min={0} max={temporal.sample_times_s.length-1} step={1}
          value={actual?.sampleIndex ?? 0} disabled={disabled}
          onChange={event => { void commands.send("overlay_playback", { action: "seek", sampleIndex: Number(event.target.value) }); }} />
      </label>
      <small data-testid="wind-temporal-note">{t(
        `真實非穩態快照：${temporal.sample_times_s[0]}–${temporal.sample_times_s[temporal.sample_times_s.length-1]} s，共 ${temporal.sample_times_s.length} 組；三表面共用時間、固定幾何，無流固耦合。HUD 為每 0.5 秒查詢的最後 Kit 讀回，非逐影格時間；精確時間截圖請先暫停／選時間步。${temporal.complete_requested_duration ? "" : "求解到限，未完成原設定時段。"}未驗證統計穩定或工程精度；沒有三維非穩態流線資料。`,
        "Computed URANS snapshots: three paired surfaces, fixed geometry, no FSI. The bounded solve did not finish the requested interval. Statistical stability and engineering accuracy are unverified; no transient 3D tracks are available.")}</small>
    </> : <small>{t("示意動畫，基於穩態解；非瞬態模擬", "Illustrative animation based on a steady-state solution; not a transient simulation")}</small>}
    {presentationPrims(direction).map(prim => {
      const path = cfdOverlayPrimPathForArtifact(artifactId, prim.name);
      if (!path) return null;
      const value = seen[path];
      return <div key={prim.name} data-testid={`wind-layer-${prim.name}`}>
        <span>{t(...ROLE_LABELS[prim.role])} · {prim.name} </span>
        {[true, false].map(visible => <button key={String(visible)} style={controlField}
          data-testid={`wind-layer-${visible ? "show" : "hide"}-${prim.name}`}
          disabled={disabled || value?.present === false || (visible && prim.role === "near_wall_speed" && !nearWall)}
          onClick={() => { void (async () => {
            if (visible && prim.role === "near_wall_speed") {
              const reply = await commands.send("overlay_style", { primPath: path, displayOpacity: 0.35 });
              if (reply.status !== "applied") return;
            }
            await commands.send("overlay_visibility", { items: [{ primPath: path, visible }] });
          })(); }}>
          {t(visible ? "顯示" : "隱藏", visible ? "Show" : "Hide")}
        </button>)}
        <small>{value ? t(!value.present ? "此疊圖沒有此圖層" : value.visible ? "已顯示" : "已隱藏",
          !value.present ? "Layer absent" : value.visible ? "Visible" : "Hidden") : t("尚未讀回", "Unconfirmed")}</small>
        {prim.role === "near_wall_speed" ? <small data-testid="wind-near-wall-sampling" style={{ display: "block" }}>
          {nearWall ? t(`距計算外殼 ${nearWall.distance.toFixed(2)} m；名義近建物網格 ${nearWall.cell.toFixed(2)} m。取樣流體風速 |U|，非牆面速度；半透明 0.35；外殼簡化與網格限制仍適用。`,
            `${nearWall.distance.toFixed(2)} m from the computation shell; nominal near-building cell ${nearWall.cell.toFixed(2)} m. Sampled fluid |U|, not wall velocity; opacity 0.35; shell and mesh limitations still apply.`)
            : t("缺少近壁取樣距離，不能顯示。", "Sampling distance is missing; cannot show the layer.")}
        </small> : null}
        {prim.role === "surface_pressure" ? <OverlayPressureOpacity key={path} primPath={path}
          ready={ready && value?.present !== false} commands={commands} state={styleState} /> : null}
      </div>;
    })}
    {visibility.status === "pending" ? <small>{t("等待圖層狀態…", "Waiting for layer state…")}</small> : null}
    {visibility.status === "error" ? <small role="alert">{t("圖層未能套用：", "Layer change failed: ")}{commandErrorText(visibility.reason)}</small> : null}
    {styleState.status === "error" ? <small role="alert">{t("透明材質未能套用：", "Translucent material failed: ")}{commandErrorText(styleState.reason)}</small> : null}
  </fieldset>;
}
