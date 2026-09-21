// 統一工作台「風環境」面板（building-energy-cfd-p2-contract.md S3）。
// 選 1–16 個風向 → POST /api/cfd/runs → 輪詢進度 → 每方向一列（收斂、行人高度峰值、壓力範圍）→
// 「顯示疊圖」= POST /api/review-sessions/{id}/cfd-overlays 登記 overlay binding，再以既有 stage-binding
// 交易帶 primary＋secondary 給 Kit；只有 Kit 確認（stage_binding_result applied）才宣告已載入。
// 誠實鐵律：所有結果常駐「設計比較用」標示；assumptions／sealing_suspect 原樣顯示；瀏覽器只打 coordinator。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { ProvTag } from "../components";
import { coordinatorClient } from "../coordinatorClient";
import { controlField } from "./controlStyles";
import {
  CFD_TERMINAL_STATUSES, cfdConsoleClient,
  type CfdConsoleClient, type CfdRunDirectionResult, type CfdRunLedgerRecord, type CfdRunResult, type CfdRunStatusDocument,
} from "./cfdClient";
import type { StageBindingResultMessage, StageBindingSelection } from "../../viewerCommandChannel/viewerEmbedProtocol";
import {
  cfdOverlayPrimPath, OVERLAY_DISPLAY_OPACITY_MAX, OVERLAY_DISPLAY_OPACITY_MIN, type OverlayStyleInput, type OverlayStyleState,
} from "../../viewerCommandChannel/overlayStyle";
import { commandErrorText } from "./viewerCommandText";

export interface WindSource {
  conversionJobId: string;
  primaryArtifactId: string;
}

export interface WindEnvironmentPanelProps {
  sessionId: string;
  /** viewer 指令閘門是否開啟（決定能否套用疊圖；建 run 不需要 3D 就緒）。 */
  ready: boolean;
  blockedReason?: string;
  applyStageBinding?: (artifacts: StageBindingSelection[]) => Promise<StageBindingResultMessage>;
  /** S5：行人面透明度滑桿 → Kit overlayStyleRequest（session layer 覆寫 displayOpacity）；缺任一即不顯示滑桿。 */
  overlayStyleState?: OverlayStyleState;
  sendOverlayStyle?: (input: OverlayStyleInput) => void;
  invalidateOverlayStyle?: () => void;
  /** 測試注入：預設查 stream-config 取 primary derived binding。 */
  loadSource?: (sessionId: string) => Promise<WindSource | null>;
  client?: CfdConsoleClient;
  pollIntervalMs?: number;
}

const COMPASS_16: ReadonlyArray<{ deg: number; label: string }> = [
  { deg: 0, label: "N" }, { deg: 22.5, label: "NNE" }, { deg: 45, label: "NE" }, { deg: 67.5, label: "ENE" },
  { deg: 90, label: "E" }, { deg: 112.5, label: "ESE" }, { deg: 135, label: "SE" }, { deg: 157.5, label: "SSE" },
  { deg: 180, label: "S" }, { deg: 202.5, label: "SSW" }, { deg: 225, label: "SW" }, { deg: 247.5, label: "WSW" },
  { deg: 270, label: "W" }, { deg: 292.5, label: "WNW" }, { deg: 315, label: "NW" }, { deg: 337.5, label: "NNW" },
];

const ASSUMPTION_TEXT: Record<CfdRunResult["assumptions"][number], [string, string]> = {
  true_north_default_direction: ["IFC TrueNorth 為預設方向：風向相對 project north", "IFC TrueNorth is the default direction: wind is relative to project north"],
  true_north_unknown_assumed_project_north: ["真北未知，假設等於 project north", "True north unknown; project north assumed"],
  true_north_manual: ["真北為手動輸入", "True north entered manually"],
  sealing_suspect_accepted: ["外殼封閉性可疑但已接受", "Shell sealing is suspect but accepted"],
};

const STATUS_TEXT: Record<CfdRunLedgerRecord["status"], [string, string]> = {
  queued: ["排隊中", "Queued"], preprocessing: ["前處理", "Preprocessing"], meshing: ["網格", "Meshing"],
  solving: ["求解中", "Solving"], postprocessing: ["後處理", "Postprocessing"], ready: ["完成", "Ready"],
  failed: ["失敗", "Failed"], cancelled: ["已取消", "Cancelled"],
};

async function defaultLoadSource(sessionId: string): Promise<WindSource | null> {
  const config = await coordinatorClient.streamConfig(sessionId);
  const bindings = (config.artifact_bindings ?? [])
    .filter((binding) => binding.artifact_role === "derived" && binding.ready_status === "ready" && Boolean(binding.url))
    .sort((left, right) => left.load_order - right.load_order);
  const primary = bindings.find((binding) => binding.artifact_id === config.stage_composition?.primary_artifact_id) ?? bindings[0];
  if (!primary || typeof primary.conversion_job_id !== "string" || !primary.conversion_job_id) return null;
  return { conversionJobId: primary.conversion_job_id, primaryArtifactId: primary.artifact_id };
}

/** Same five-stop ramp as cfd_pipeline.usd_results.colormap (blue → cyan → green → yellow → red). */
const RAMP_CSS = "linear-gradient(90deg, rgb(0,0,255) 0%, rgb(0,255,255) 25%, rgb(0,255,0) 50%, rgb(255,255,0) 75%, rgb(255,0,0) 100%)";
/** Fixed pedestrian-wind scale written by the overlay writer (U_SCALE_M_S); the legend must match the prim colours. */
const U_SCALE: readonly [number, number] = [0, 5];
/** Plane opacity authored by usd_results (PLANE_OPACITY); the slider starts here after each overlay load. */
const PLANE_OPACITY_DEFAULT = 0.6;

function LegendBar({ label, min, max, unit, testId }: { label: string; min: number; max: number; unit: string; testId: string }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  return (
    <div data-testid={testId} style={{ display: "grid", gap: 2 }}>
      <span>{label}</span>
      <div aria-hidden="true" style={{ height: 10, borderRadius: 3, background: RAMP_CSS, border: "1px solid var(--ab-border)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontVariantNumeric: "tabular-nums" }}>
        {ticks.map((value, index) => <span key={index}>{Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)}</span>)}
      </div>
      <small>{unit}</small>
    </div>
  );
}

type OverlayState =
  | { status: "off" }
  | { status: "registering" | "applying"; deg: number }
  | { status: "applied"; deg: number; artifactId: string; revisionId: string | null; layerConfirmed: boolean | null }
  | { status: "failed"; deg: number | null; reason: string };

type SubmitState = { status: "idle" } | { status: "sending" } | { status: "error"; reason: string };

function replyReason(reply: { status: number; errorCode: string | null; detail: string | null }): string {
  if (reply.status === 0) return t("無法連線 coordinator", "Cannot reach the coordinator");
  return reply.errorCode ? `${reply.errorCode}${reply.detail ? `: ${reply.detail}` : ""}` : `HTTP ${reply.status}${reply.detail ? `: ${reply.detail}` : ""}`;
}

export function WindEnvironmentPanel({
  sessionId, ready, blockedReason, applyStageBinding, overlayStyleState, sendOverlayStyle, invalidateOverlayStyle,
  loadSource = defaultLoadSource, client = cfdConsoleClient, pollIntervalMs = 5000,
}: WindEnvironmentPanelProps) {
  const [source, setSource] = useState<WindSource | null | "loading" | "unavailable">(sessionId ? "loading" : null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [stale, setStale] = useState(false);
  const [runs, setRuns] = useState<CfdRunLedgerRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<CfdRunStatusDocument | null>(null);
  const [result, setResult] = useState<CfdRunResult | null>(null);
  const [selectedDegrees, setSelectedDegrees] = useState<number[]>([0]);
  const [uref, setUref] = useState("5");
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [overlay, setOverlay] = useState<OverlayState>({ status: "off" });
  const [opacity, setOpacity] = useState(PLANE_OPACITY_DEFAULT);
  const opacityDirty = useRef(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  const refreshRuns = useCallback(async (conversionJobId: string, preferRunId?: string | null) => {
    const reply = await client.listRuns(conversionJobId);
    if (sessionRef.current !== sessionId) return;
    if (!reply.body) { setRefreshError(replyReason(reply)); return; }
    setRefreshError(null);
    setEnabled(reply.body.enabled);
    setStale(reply.body.stale);
    setRuns(reply.body.items);
    setSelectedRunId((current) => preferRunId ?? current ?? reply.body!.items[0]?.run_id ?? null);
  }, [client, sessionId]);

  // session → source（primary derived binding 與 conversion job）→ ledger
  useEffect(() => {
    setStatus(null); setResult(null); setRuns([]); setSelectedRunId(null); setOverlay({ status: "off" }); setSubmit({ status: "idle" });
    if (!sessionId) { setSource(null); return; }
    let cancelled = false;
    setSource("loading");
    loadSource(sessionId).then((next) => {
      if (cancelled) return;
      setSource(next ?? "unavailable");
      if (next) void refreshRuns(next.conversionJobId);
    }).catch(() => { if (!cancelled) setSource("unavailable"); });
    return () => { cancelled = true; };
  }, [sessionId, loadSource, refreshRuns]);

  // 選定 run：抓 detail；非終態時每 pollIntervalMs 輪詢（document.hidden 時不發）；ready 後抓 result 一次。
  useEffect(() => {
    if (!selectedRunId) { setStatus(null); setResult(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) { timer = setTimeout(tick, pollIntervalMs); return; }
      const reply = await client.getRun(selectedRunId);
      if (cancelled) return;
      const doc = reply.body?.status ?? null;
      if (!reply.body) { setRefreshError(replyReason(reply)); }
      else if (doc) {
        setRefreshError(null);
        setStatus(doc);
        setRuns((current) => current.map((item) => (item.run_id === reply.body!.ledger.run_id ? reply.body!.ledger : item)));
        if (doc.status === "ready") {
          const resultReply = await client.getRunResult(selectedRunId);
          if (!cancelled) setResult(resultReply.body ?? null);
        }
      } else {
        setRefreshError(t("streaming CFD 服務暫時不可達，顯示 ledger 快取", "Streaming CFD service unreachable; showing ledger cache"));
      }
      if (!cancelled && !(doc && CFD_TERMINAL_STATUSES.has(doc.status))) timer = setTimeout(tick, pollIntervalMs);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [selectedRunId, client, pollIntervalMs]);

  const urefValue = Number(uref);
  const urefValid = uref.trim() !== "" && Number.isFinite(urefValue) && urefValue > 0 && urefValue <= 60;
  const canSubmit = typeof source === "object" && source !== null && enabled !== false && selectedDegrees.length > 0 && urefValid && submit.status !== "sending";

  const toggleDegree = (deg: number) => setSelectedDegrees((current) =>
    current.includes(deg) ? current.filter((value) => value !== deg) : [...current, deg].sort((a, b) => a - b));

  const submitRun = async () => {
    if (!canSubmit || typeof source !== "object" || !source) return;
    setSubmit({ status: "sending" });
    const reply = await client.createRun({
      schema: "cfd-run-request/v1",
      idempotency_key: `cfdreq_ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: { conversion_job_id: source.conversionJobId },
      preprocess: { profile: "exterior-wind/v1" },
      wind: { wind_from_degrees: selectedDegrees, uref_m_s: urefValue, zref_m: 10, z0_m: 0.5, true_north_source: "geo_reference" },
      mesh: {},
      solver: {},
    });
    if (sessionRef.current !== sessionId) return;
    if (!reply.body) { setSubmit({ status: "error", reason: replyReason(reply) }); if (reply.errorCode === "cfd_disabled") setEnabled(false); return; }
    setSubmit({ status: "idle" });
    setOverlay({ status: "off" });
    await refreshRuns(source.conversionJobId, reply.body.run_id);
  };

  const cancelRun = async () => {
    if (!selectedRunId) return;
    const reply = await client.cancelRun(selectedRunId);
    if (reply.body) setStatus(reply.body);
    else setRefreshError(replyReason(reply));
  };

  const showOverlay = async (direction: CfdRunDirectionResult) => {
    if (typeof source !== "object" || !source || !selectedRunId || !applyStageBinding) return;
    const deg = direction.wind_from_degrees;
    setOverlay({ status: "registering", deg });
    const registered = await client.registerOverlay(sessionId, selectedRunId, deg);
    if (!registered.body) { setOverlay({ status: "failed", deg, reason: replyReason(registered) }); return; }
    const artifactId = registered.body.artifact_id;
    setOverlay({ status: "applying", deg });
    const outcome = await applyStageBinding([
      { artifact_id: source.primaryArtifactId, role: "primary", load_order: 0 },
      { artifact_id: artifactId, role: "secondary", load_order: 1 },
    ]);
    if (outcome.status !== "applied") { setOverlay({ status: "failed", deg, reason: outcome.reason ?? "stage_binding_failed" }); return; }
    const layers = outcome.applied_secondary_layers;
    const layerConfirmed = layers ? layers.includes(artifactId) : null;
    if (layerConfirmed === false) { setOverlay({ status: "failed", deg, reason: t("Kit 已回報 stage，但疊圖層不在已套用清單", "Kit reported the stage but the overlay layer is not in the applied list") }); return; }
    // Kit drops its session-layer overrides whenever the CFD layer set is recomposed (stage_loading), so the
    // re-added layer shows the authored look again; mirror that here.
    setOpacity(PLANE_OPACITY_DEFAULT); opacityDirty.current = false; invalidateOverlayStyle?.();
    setOverlay({ status: "applied", deg, artifactId, revisionId: outcome.revision_id, layerConfirmed });
  };

  const hideOverlay = async () => {
    if (typeof source !== "object" || !source || !applyStageBinding) return;
    const previous = overlay;
    setOverlay({ status: "applying", deg: "deg" in previous && typeof previous.deg === "number" ? previous.deg : 0 });
    const outcome = await applyStageBinding([{ artifact_id: source.primaryArtifactId, role: "primary", load_order: 0 }]);
    if (outcome.status !== "applied") { setOverlay({ status: "failed", deg: null, reason: outcome.reason ?? "stage_binding_failed" }); return; }
    opacityDirty.current = false; invalidateOverlayStyle?.();
    setOverlay({ status: "off" });
  };

  // Slider: local value while dragging; the Kit command goes out on commit (pointer up / key up / blur) so a drag
  // is one request, not sixty. Only the pedestrian plane is styled; the readback (not the slider) is what we report.
  const overlayPrimPath = selectedRunId && overlay.status === "applied" ? cfdOverlayPrimPath(selectedRunId) : null;
  const opacityStyleBusy = overlayStyleState?.status === "pending";
  const opacityEnabled = Boolean(overlayPrimPath && sendOverlayStyle && ready && overlay.status === "applied" && overlay.layerConfirmed && !opacityStyleBusy);
  const commitOpacity = () => {
    // Tab/blur/modifier keys without a value change must not touch the stage.
    if (!opacityDirty.current || !opacityEnabled || !overlayPrimPath || !sendOverlayStyle) return;
    opacityDirty.current = false;
    sendOverlayStyle({ primPath: overlayPrimPath, displayOpacity: opacity });
  };

  const selectedRun = useMemo(() => runs.find((item) => item.run_id === selectedRunId) ?? null, [runs, selectedRunId]);
  const overlayBusy = overlay.status === "registering" || overlay.status === "applying";
  const overlayBlocked = !ready || !applyStageBinding || overlayBusy;
  const progress = status?.progress ?? (selectedRun ? { directions_total: selectedRun.directions_total, directions_done: selectedRun.directions_done } : null);
  const currentStatus = status?.status ?? selectedRun?.status ?? null;

  return (
    <section aria-label={t("風環境", "Wind environment")} data-testid="wind-panel" data-prov="asbuilt"
      style={{ flexShrink: 0, borderTop: "1px solid var(--ab-border)", paddingTop: 12, display: "grid", gap: 8, fontSize: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>{t("風環境", "Wind environment")}<ProvTag prov="asbuilt" /></h3>
      <p data-testid="wind-purpose" role="note" style={{ margin: 0, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--ab-border)", color: "var(--ab-text-muted, var(--ab-text))" }}>
        {t("設計比較用：非法規或認證依據；粗網格概念驗證，無網格收斂研究。", "Design comparison only: not a regulatory or certification basis; coarse proof-of-concept mesh without a grid-convergence study.")}
      </p>

      {!sessionId ? <span data-testid="wind-no-session">{t("先在右側選擇模型與審查，取得 review session 後才能送出風場計算。", "Choose a model and review on the right first; a review session is required to start a wind run.")}</span> : null}
      {source === "loading" ? <span role="status">{t("讀取模型來源…", "Loading model source…")}</span> : null}
      {source === "unavailable" ? <span role="alert" data-testid="wind-source-unavailable">{t("此 session 沒有 ready 的模型 binding 或缺 conversion job，無法建立風場計算。", "This session has no ready model binding or conversion job; a wind run cannot be created.")}</span> : null}
      {enabled === false ? <span role="alert" data-testid="wind-disabled">{t("此 coordinator 未啟用 CFD（CFD_ENABLED=false）；只顯示既有 ledger。", "CFD is not enabled on this coordinator (CFD_ENABLED=false); only the existing ledger is shown.")}</span> : null}
      {refreshError ? <span role="alert" data-testid="wind-refresh-error">{refreshError}</span> : null}
      {stale ? <span data-testid="wind-stale">{t("清單為 ledger 快取（streaming CFD 服務暫時不可達）。", "List is the ledger cache (streaming CFD service temporarily unreachable).")}</span> : null}

      {typeof source === "object" && source ? (
        <>
          <fieldset data-testid="wind-directions" style={{ border: "1px solid var(--ab-border)", borderRadius: 6, padding: 8, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
            <legend>{t("風向（來向，相對 project north）", "Wind from (relative to project north)")}</legend>
            {COMPASS_16.map(({ deg, label }) => (
              <label key={deg} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" data-testid={`wind-dir-${deg}`} checked={selectedDegrees.includes(deg)} onChange={() => toggleDegree(deg)} disabled={submit.status === "sending"} />
                <span>{label} {deg}°</span>
              </label>
            ))}
          </fieldset>
          <label>{t("參考風速 U(10 m)，m/s", "Reference wind speed U(10 m), m/s")}
            <input aria-label={t("參考風速", "Reference wind speed")} data-testid="wind-uref" type="number" step="any" min="0.1" max="60" style={controlField} value={uref} onChange={(event) => setUref(event.target.value)} disabled={submit.status === "sending"} />
          </label>
          {!urefValid ? <span role="alert">{t("參考風速須為 0 到 60 之間的數字。", "Reference wind speed must be a number between 0 and 60.")}</span> : null}
          <button data-testid="wind-submit" style={controlField} disabled={!canSubmit} onClick={() => { void submitRun(); }}>
            {submit.status === "sending" ? t("送出中…", "Submitting…") : t("送出風場計算", "Start wind run")}
            {selectedDegrees.length ? ` (${selectedDegrees.length})` : ""}
          </button>
          {submit.status === "error" ? <span role="alert" data-testid="wind-submit-error">{t("送出失敗：", "Submit failed: ")}{submit.reason}</span> : null}

          {runs.length ? (
            <label>{t("計算紀錄", "Runs")}
              <select aria-label={t("計算紀錄", "Runs")} data-testid="wind-run-select" style={controlField} value={selectedRunId ?? ""} onChange={(event) => { setSelectedRunId(event.target.value || null); setOverlay({ status: "off" }); }}>
                {runs.map((item) => <option key={item.run_id} value={item.run_id}>{item.created_at.slice(0, 16).replace("T", " ")} · {t(...STATUS_TEXT[item.status])} · {item.directions_done}/{item.directions_total}</option>)}
              </select>
            </label>
          ) : <span data-testid="wind-no-runs">{t("此模型尚無風場計算。", "No wind runs for this model yet.")}</span>}

          {selectedRunId && currentStatus ? (
            <div role="status" aria-live="polite" data-testid="wind-run-status" data-status={currentStatus} style={{ display: "grid", gap: 4 }}>
              <strong>{t(...STATUS_TEXT[currentStatus])}{progress ? ` · ${progress.directions_done}/${progress.directions_total}` : ""}</strong>
              {status?.error ? <span>{status.error}</span> : null}
              {status?.failure_code ? <span>{t("失敗代碼：", "Failure code: ")}{status.failure_code}</span> : null}
              {status?.sealing_suspect ? <span role="alert">{t("外殼封閉性可疑（洩漏率超過門檻）：結果僅供參考。", "Shell sealing is suspect (leak fraction over the limit): treat results as indicative only.")}</span> : null}
              {!CFD_TERMINAL_STATUSES.has(currentStatus) ? <button data-testid="wind-cancel" style={controlField} onClick={() => { void cancelRun(); }}>{t("取消計算", "Cancel run")}</button> : null}
            </div>
          ) : null}

          {result ? (
            <div data-testid="wind-result" style={{ display: "grid", gap: 6 }}>
              <small>{t("洩漏率", "Leak fraction")} {(result.preprocess.leak_fraction * 100).toFixed(1)}%（{t("門檻", "limit")} {(result.preprocess.leak_fraction_limit * 100).toFixed(0)}%）· {t("附屬結構納入外殼", "appendages included in the shell")}</small>
              {result.assumptions.length ? <ul data-testid="wind-assumptions" style={{ margin: 0, paddingLeft: 16 }}>{result.assumptions.map((item) => <li key={item}>{t(...ASSUMPTION_TEXT[item])}</li>)}</ul> : null}
              {/* Legend mirrors the fixed scales authored into the overlay (run prim customData cfd:legend): U 0–5 m/s on
                  the pedestrian plane, streamlines and flow particles; p from this direction's building surface range. */}
              <div data-testid="wind-legend" style={{ display: "grid", gap: 6, padding: 8, border: "1px solid var(--ab-border)", borderRadius: 6 }}>
                <LegendBar testId="wind-legend-u" label={t("風速 |U|（行人面、流線、粒子）", "Wind speed |U| (pedestrian plane, streamlines, particles)")} min={U_SCALE[0]} max={U_SCALE[1]} unit="m/s" />
                {(() => {
                  const shownDeg = "deg" in overlay && typeof overlay.deg === "number" ? overlay.deg : null;
                  const pressure = (shownDeg !== null ? result.directions.find((d) => d.wind_from_degrees === shownDeg)?.building_pressure : null)
                    ?? result.directions.find((d) => d.building_pressure)?.building_pressure ?? null;
                  return pressure
                    ? <LegendBar testId="wind-legend-p" label={t("建物表面壓力 p", "Building surface pressure p")} min={pressure.p_min} max={pressure.p_max} unit="Pa" />
                    : <small data-testid="wind-legend-p-missing">{t("此方向沒有建物表面壓力資料。", "No building surface pressure for this direction.")}</small>;
                })()}
                <small>{t("流動粒子為示意動畫，基於穩態解；非瞬態模擬。", "Flow particles are an illustrative animation based on the steady-state solution, not a transient simulation.")}</small>
                {sendOverlayStyle ? (
                  <div data-testid="wind-opacity" data-state={overlayStyleState?.status ?? "idle"} style={{ display: "grid", gap: 4 }}>
                    <label style={{ display: "grid", gap: 2 }}>
                      {t("行人面透明度", "Pedestrian plane opacity")} <span data-testid="wind-opacity-value">{opacity.toFixed(2)}</span>
                      <input aria-label={t("行人面透明度", "Pedestrian plane opacity")} data-testid="wind-opacity-slider" type="range"
                        min={OVERLAY_DISPLAY_OPACITY_MIN} max={OVERLAY_DISPLAY_OPACITY_MAX} step={0.05} value={opacity} disabled={!opacityEnabled}
                        onChange={(event) => { opacityDirty.current = true; setOpacity(Number(event.target.value)); }}
                        onPointerUp={commitOpacity} onKeyUp={commitOpacity} onBlur={commitOpacity} />
                    </label>
                    <small role="status" aria-live="polite" data-testid="wind-opacity-status">
                      {overlay.status !== "applied" ? t("先顯示一個方向的疊圖，才能調整透明度。", "Show an overlay direction first to adjust opacity.")
                        : overlayStyleState?.status === "pending" ? t("等待 Kit 套用透明度…", "Waiting for Kit to apply opacity…")
                        : overlayStyleState?.status === "applied" ? `${t("Kit 已套用透明度 ", "Kit applied opacity ")}${overlayStyleState.displayOpacity?.toFixed(2) ?? ""}`
                        : overlayStyleState?.status === "error" ? `${t("透明度未套用：", "Opacity not applied: ")}${commandErrorText(overlayStyleState.reason)}`
                        : overlayStyleState?.status === "unconfirmed" ? t("疊圖或連線已變更，透明度回到圖層預設。", "Overlay or connection changed; opacity is back to the layer default.")
                        : t("拖動後放開即送出；只調行人面，建物面與流線不變。", "Release the slider to apply; only the pedestrian plane changes.")}
                    </small>
                  </div>
                ) : null}
              </div>
              <table data-testid="wind-direction-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ textAlign: "left" }}><th>{t("風向", "From")}</th><th>{t("狀態", "Status")}</th><th>{t("收斂", "Converged")}</th><th>U 1.5 m max</th><th>p min / max</th><th>{t("疊圖", "Overlay")}</th></tr></thead>
                <tbody>
                  {result.directions.map((direction) => {
                    const deg = direction.wind_from_degrees;
                    const shown = overlay.status === "applied" && overlay.deg === deg;
                    const busyHere = overlayBusy && "deg" in overlay && overlay.deg === deg;
                    const canShow = direction.status === "ready" && Boolean(direction.overlay_layer) && !overlayBlocked;
                    return (
                      <tr key={deg} data-testid={`wind-row-${deg}`}>
                        <td>{COMPASS_16.find((item) => item.deg === deg)?.label ?? ""} {deg}°</td>
                        <td>{t(...STATUS_TEXT[direction.status])}</td>
                        <td>{direction.converged_by_residual_control === null ? "—" : direction.converged_by_residual_control ? `${t("是", "yes")}${direction.iterations !== null ? ` (${direction.iterations})` : ""}` : `${t("否", "no")}${direction.iterations !== null ? ` (${direction.iterations})` : ""}`}</td>
                        <td>{direction.pedestrian_1p5m ? `${direction.pedestrian_1p5m.U_magnitude_max.toFixed(2)} m/s` : "—"}</td>
                        <td>{direction.building_pressure ? `${direction.building_pressure.p_min.toFixed(1)} / ${direction.building_pressure.p_max.toFixed(1)} Pa` : "—"}</td>
                        <td>
                          {shown
                            ? <button data-testid={`wind-overlay-off-${deg}`} style={controlField} disabled={overlayBlocked} onClick={() => { void hideOverlay(); }}>{t("關閉疊圖", "Hide overlay")}</button>
                            : <button data-testid={`wind-overlay-on-${deg}`} style={controlField} disabled={!canShow} onClick={() => { void showOverlay(direction); }}>{busyHere ? t("套用中…", "Applying…") : t("顯示疊圖", "Show overlay")}</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div role="status" aria-live="polite" data-testid="wind-overlay-status" data-state={overlay.status}>
                {overlay.status === "registering" ? <span>{t("登記疊圖層…", "Registering overlay layer…")}</span> : null}
                {overlay.status === "applying" ? <span>{t("等待 Kit 套用 stage binding…", "Waiting for Kit to apply the stage binding…")}</span> : null}
                {overlay.status === "applied" ? <span>
                  {overlay.layerConfirmed
                    ? t("Kit 已確認載入疊圖", "Kit confirmed the overlay layer is loaded")
                    : t("Kit 已確認 stage，但未回報疊圖層清單；請在畫面確認", "Kit confirmed the stage but did not report the layer list; verify in the view")}
                  {overlay.revisionId ? ` · ${overlay.revisionId}` : ""}
                </span> : null}
                {overlay.status === "failed" ? <span role="alert">{t("疊圖未套用：", "Overlay not applied: ")}{overlay.reason}</span> : null}
                {!ready ? <span>{blockedReason || t("3D 尚未就緒或目前沒有操作權限，無法套用疊圖。", "3D is not ready or access is unavailable; the overlay cannot be applied.")}</span> : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
