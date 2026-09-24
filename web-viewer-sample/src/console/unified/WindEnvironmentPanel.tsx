// 統一工作台「風環境」面板（building-energy-cfd-p2-contract.md S3；S7 改為以模型為主體）。
// 模型來源二選一：有 review session 時取 session 綁的模型（可顯示疊圖）；沒有 session 也能從 ready 模型清單挑一個，
// 瀏覽／送出計算（疊圖需要 session）。run 以模型為鍵存在 coordinator ledger，關掉 session 不會消失。
// 選 1–16 個風向 → POST /api/cfd/runs → 輪詢進度 → 每方向一列（收斂、行人高度峰值、壓力範圖）→
// 「顯示疊圖」= POST /api/review-sessions/{id}/cfd-overlays 登記 overlay binding，再以既有 stage-binding
// 交易帶 primary＋secondary 給 Kit；只有 Kit 確認（stage_binding_result applied）才宣告已載入。
// 誠實鐵律：所有結果常駐「設計比較用」標示；assumptions／sealing_suspect 原樣顯示；瀏覽器只打 coordinator。
// S8（settings phase A2）：計算設定區完全由 GET /api/cfd/options 產生（不寫死預設值與上下限）；送出前顯示估算並在
// 超過門檻時再確認，超過算力上限不送；run 詳情顯示當時的設定並可「用這組設定重新送出」。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { ProvTag } from "../components";
import { coordinatorClient } from "../coordinatorClient";
import { controlField, fieldsetLegend } from "./controlStyles";
import {
  CFD_TERMINAL_STATUSES, cfdConsoleClient,
  type CfdConsoleClient, type CfdEstimate, type CfdFindingResponse, type CfdOptionsDocument, type CfdRunDirectionResult, type CfdRunLedgerRecord, type CfdRunOrigin,
  type CfdRunResult, type CfdRunStatusDocument, type WindModelOption,
} from "./cfdClient";
import { applyPreset, buildSettings, confirmReasonsText, estimateRequest, initialSettings, settingsFromOrigin, settingsKey, type BuiltSettings } from "./cfdSettings";
import { WindRunSettings, type EstimateState } from "./WindRunSettings";
import type { StageBindingResultMessage, StageBindingSelection } from "../../viewerCommandChannel/viewerEmbedProtocol";
import {
  cfdOverlayPrimPathForArtifact, OVERLAY_DISPLAY_OPACITY_MAX, OVERLAY_DISPLAY_OPACITY_MIN, type OverlayStyleState,
} from "../../viewerCommandChannel/overlayStyle";
import type { ViewerCommandPort } from "../../viewerCommandChannel/parentSide";
import { commandErrorText } from "./viewerCommandText";

export interface WindSource {
  conversionJobId: string;
  primaryArtifactId: string;
  /** S6: governance model_version_id of the session's model (issue binding); null when the binding does not carry one. */
  modelVersionId?: string | null;
}

export interface WindEnvironmentPanelProps {
  sessionId: string;
  /** viewer 指令閘門是否開啟（決定能否套用疊圖；建 run 不需要 3D 就緒）。 */
  ready: boolean;
  blockedReason?: string;
  applyStageBinding?: (artifacts: StageBindingSelection[]) => Promise<StageBindingResultMessage>;
  /** S5：行人面透明度滑桿 → Kit overlayStyleRequest（session layer 覆寫 displayOpacity）；缺任一即不顯示滑桿。 */
  commands?: ViewerCommandPort;
  overlayStyleState?: OverlayStyleState;
  invalidateOverlayStyle?: () => void;
  /** 測試注入：預設查 stream-config 取 primary derived binding。 */
  loadSource?: (sessionId: string) => Promise<WindSource | null>;
  client?: CfdConsoleClient;
  pollIntervalMs?: number;
  /** S8：設定變更後多久才向 coordinator 要估算（毫秒）。送出時若估算已過期會立即重新估算，不受此延遲影響。 */
  estimateDebounceMs?: number;
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

/** S6 finding: why a direction did not open an issue (per-direction answer of POST /api/cfd/runs/{id}/findings). */
const SKIPPED_REASON_TEXT: Record<string, [string, string]> = {
  direction_not_ready: ["方向未完成，沒有評估", "direction not ready; not evaluated"],
  below_threshold: ["未超過門檻", "below the threshold"],
  not_in_run: ["不在此 run 的風向中", "not a direction of this run"],
  overlay_missing: ["超標，但沒有本 run 的疊圖層，未開 issue", "exceeds, but this run has no overlay layer for it; no issue opened"],
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
  const modelVersionId = (primary as { model_version_id?: unknown }).model_version_id;
  return { conversionJobId: primary.conversion_job_id, primaryArtifactId: primary.artifact_id, modelVersionId: typeof modelVersionId === "string" && modelVersionId ? modelVersionId : null };
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
  | { status: "applied"; runId: string; deg: number; artifactId: string; revisionId: string | null; layerConfirmed: boolean | null }
  | { status: "failed"; deg: number | null; reason: string };

/** Moving to another run: an applied overlay stays until the release effect takes it off Kit; any other state is dropped. */
const keepAppliedOverlay = (current: OverlayState): OverlayState => (current.status === "applied" ? current : { status: "off" });

type FindingState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "done"; response: CfdFindingResponse }
  | { status: "error"; reason: string };

type SubmitState = { status: "idle" } | { status: "sending" } | { status: "error"; reason: string };

type CfdRunCreateRequestPart = Parameters<CfdConsoleClient["createRun"]>[0];

function originSettingsText(origin: CfdRunOrigin): string {
  const recorded = origin.zref_m !== undefined;
  const parts = [
    `U_ref ${origin.uref_m_s} m/s`,
    recorded ? `z_ref ${origin.zref_m} m` : null,
    recorded ? `z0 ${origin.z0_m} m` : null,
    recorded ? (origin.true_north_source === "manual" ? t(`真北 手動 ${origin.true_north_degrees_manual}°`, `true north manual ${origin.true_north_degrees_manual}°`) : t("真北 IFC 定位資料", "true north from IFC")) : null,
    origin.background_cell_m === null ? t("背景格 自動", "background cells automatic") : t(`背景格 ${origin.background_cell_m} m`, `background cells ${origin.background_cell_m} m`),
    origin.end_time === null ? t("endTime 預設", "endTime default") : `endTime ${origin.end_time}`,
  ].filter(Boolean);
  const preset = !recorded ? t("（S8 以前送出：當時 z_ref／z0／真北為標準值，未另外記錄）", " (submitted before S8: z_ref / z0 / true north were the standard values and not recorded)")
    : origin.preset_match === "standard" ? t(" · 標準預設組", " · standard preset")
    : origin.preset_match ? ` · ${origin.preset_match}` : t(" · 未對應到預設組", " · no matching preset");
  return `${parts.join(" · ")}${preset}`;
}

function replyReason(reply: { status: number; errorCode: string | null; detail: string | null }): string {
  if (reply.status === 0) return t("無法連線 coordinator", "Cannot reach the coordinator");
  return reply.errorCode ? `${reply.errorCode}${reply.detail ? `: ${reply.detail}` : ""}` : `HTTP ${reply.status}${reply.detail ? `: ${reply.detail}` : ""}`;
}

export function WindEnvironmentPanel({
  sessionId, ready, blockedReason, applyStageBinding, commands, overlayStyleState, invalidateOverlayStyle,
  loadSource = defaultLoadSource, client = cfdConsoleClient, pollIntervalMs = 5000, estimateDebounceMs = 500,
}: WindEnvironmentPanelProps) {
  const [source, setSource] = useState<WindSource | null | "loading" | "unavailable">(sessionId ? "loading" : null);
  // S7: model-first. `models` are ready conversions; `pickedJobId` is the user's choice when no session supplies one.
  const [models, setModels] = useState<WindModelOption[] | null>(null);
  const [pickedJobId, setPickedJobId] = useState<string | null>(null);
  const [allRuns, setAllRuns] = useState<CfdRunLedgerRecord[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [stale, setStale] = useState(false);
  const [runs, setRuns] = useState<CfdRunLedgerRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<CfdRunStatusDocument | null>(null);
  const [result, setResult] = useState<CfdRunResult | null>(null);
  const [selectedDegrees, setSelectedDegrees] = useState<number[]>([0]);
  // S8: the settings form is generated from cfd-options/v1; values are the raw input strings keyed by contract field.
  const [options, setOptions] = useState<CfdOptionsDocument | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [estimate, setEstimate] = useState<EstimateState>({ status: "idle" });
  // The automatic background cell last estimated for a model: where unticking "automatic" starts.
  const [autoCell, setAutoCell] = useState<{ jobId: string; cell: number } | null>(null);
  // A pending second confirmation, valid only for the settings it was raised for (key).
  const [confirm, setConfirm] = useState<{ kind: "threshold" | "resubmit"; key: string; reasons: readonly string[] } | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [overlay, setOverlay] = useState<OverlayState>({ status: "off" });
  // S6 A1 finding: threshold input + last coordinator answer for the selected run.
  const [findingThreshold, setFindingThreshold] = useState("5");
  const [finding, setFinding] = useState<FindingState>({ status: "idle" });
  const [opacity, setOpacity] = useState(PLANE_OPACITY_DEFAULT);
  const opacityDirty = useRef(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  // The model whose run list is currently being loaded; a newer load supersedes an older in-flight one.
  const loadJobRef = useRef<string | null>(null);

  const refreshRuns = useCallback(async (conversionJobId: string, preferRunId?: string | null) => {
    const sessionAtCall = sessionRef.current;
    loadJobRef.current = conversionJobId;
    const reply = await client.listRuns(conversionJobId);
    // Drop late replies: the session changed, or another model's load started after this one (S7 review).
    if (sessionRef.current !== sessionAtCall || loadJobRef.current !== conversionJobId) return;
    if (!reply.body) { setRefreshError(replyReason(reply)); return; }
    setRefreshError(null);
    setEnabled(reply.body.enabled);
    setStale(reply.body.stale);
    setRuns(reply.body.items);
    setSelectedRunId((current) => preferRunId ?? current ?? reply.body!.items[0]?.run_id ?? null);
  }, [client]);

  // S7: cross-model overview (newest 20 runs) so a queued run stays visible whatever session or model is selected.
  const refreshAllRuns = useCallback(async () => {
    const reply = await client.listRuns(null, 20);
    if (reply.body) setAllRuns(reply.body.items);
  }, [client]);
  useEffect(() => { void refreshAllRuns(); }, [refreshAllRuns]);
  useEffect(() => {
    let cancelled = false;
    client.listModels().then((reply) => { if (!cancelled) setModels(reply.body?.items ?? []); }).catch(() => { if (!cancelled) setModels([]); });
    return () => { cancelled = true; };
  }, [client]);

  // session → source（primary derived binding 與 conversion job）→ ledger
  useEffect(() => {
    setStatus(null); setResult(null); setRuns([]); setSelectedRunId(null); setOverlay({ status: "off" }); setSubmit({ status: "idle" });
    if (!sessionId) { setSource(null); return; }
    let cancelled = false;
    setSource("loading");
    loadSource(sessionId).then((next) => {
      if (cancelled) return;
      setSource(next ?? "unavailable");
      if (next) { setPickedJobId(next.conversionJobId); setRuns([]); setSelectedRunId(null); void refreshRuns(next.conversionJobId); }
    }).catch(() => { if (!cancelled) setSource("unavailable"); });
    return () => { cancelled = true; };
  }, [sessionId, loadSource, refreshRuns]);

  // Session model wins; otherwise the picked model. Overlays need the session's primary artifact, runs do not.
  const sessionSource = typeof source === "object" && source ? source : null;
  const activeJobId = sessionSource?.conversionJobId ?? pickedJobId;
  // Handlers that await compare these with the model and run they started from, so a late reply never lands in the
  // view of a model or run the user has picked since (the model picker stays usable while a request is pending).
  const activeJobRef = useRef(activeJobId);
  activeJobRef.current = activeJobId;
  const selectedRunRef = useRef(selectedRunId);
  selectedRunRef.current = selectedRunId;
  // While a session source is resolving nothing is loaded here, so the picked model cannot race the session model.
  useEffect(() => {
    if (sessionSource || source === "loading") return;
    setStatus(null); setResult(null); setRuns([]); setSelectedRunId(null); setOverlay({ status: "off" }); setSubmit({ status: "idle" });
    if (pickedJobId) void refreshRuns(pickedJobId);
  }, [pickedJobId, sessionSource, source, refreshRuns]);

  useEffect(() => { setFinding({ status: "idle" }); }, [selectedRunId]);

  // S8: options are needed only once a model is chosen (the form belongs to a model); loaded once per panel,
  // again only when the user retries after a failure.
  useEffect(() => {
    if (!activeJobId || options) return;
    let cancelled = false;
    client.getOptions().then((reply) => {
      if (cancelled) return;
      if (reply.body) { setOptions(reply.body); setSettings(initialSettings(reply.body)); setOptionsError(null); }
      else setOptionsError(replyReason(reply));
    }).catch((error: unknown) => { if (!cancelled) setOptionsError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [activeJobId, client, options, optionsAttempt]);

  // 選定 run：抓 detail；非終態時每 pollIntervalMs 輪詢（document.hidden 時不發）；ready 後抓 result 一次。
  // 換 run 時先清掉上一個 run 的 status／result，否則非 ready 的 run 會沿用上一個 run 的方向表與疊圖按鈕。
  useEffect(() => {
    setStatus(null); setResult(null);
    if (!selectedRunId) return;
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
        if (CFD_TERMINAL_STATUSES.has(doc.status)) void refreshAllRuns();
      } else {
        setRefreshError(t("streaming CFD 服務暫時不可達，顯示 ledger 快取", "Streaming CFD service unreachable; showing ledger cache"));
      }
      if (!cancelled && !(doc && CFD_TERMINAL_STATUSES.has(doc.status))) timer = setTimeout(tick, pollIntervalMs);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [selectedRunId, client, pollIntervalMs, refreshAllRuns]);

  const built = useMemo<BuiltSettings | null>(() => (options ? buildSettings(options, settings) : null), [options, settings]);
  const currentKey = built && activeJobId ? settingsKey(activeJobId, selectedDegrees, built) : null;
  const estimateSeq = useRef(0);
  const runEstimate = useCallback(async (jobId: string, directions: number[], settingsNow: BuiltSettings, key: string): Promise<CfdEstimate | null> => {
    const seq = ++estimateSeq.current;
    setEstimate({ status: "loading" });
    const reply = await client.estimate(estimateRequest(jobId, directions, settingsNow));
    // The automatic cell depends only on the model's geometry, so any automatic-rule estimate of this model is a valid hint.
    if (reply.body?.available && reply.body.background_cell_rule === "auto" && typeof reply.body.background_cell_m === "number") {
      setAutoCell({ jobId, cell: reply.body.background_cell_m });
    }
    if (seq === estimateSeq.current) {
      if (reply.body) setEstimate({ status: "done", key, estimate: reply.body });
      else setEstimate({ status: "error", key, reason: replyReason(reply) });
    }
    return reply.body ?? null;
  }, [client]);
  // Debounced estimate for what is on screen; only valid settings are estimated (the form shows the errors otherwise).
  useEffect(() => {
    if (!activeJobId || !built || !built.ok || !currentKey || selectedDegrees.length === 0 || enabled === false) {
      estimateSeq.current += 1;
      setEstimate({ status: "idle" });
      return;
    }
    const timer = setTimeout(() => { void runEstimate(activeJobId, selectedDegrees, built, currentKey); }, estimateDebounceMs);
    return () => clearTimeout(timer);
    // `currentKey` changes exactly when the job, the directions or the parsed settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, enabled, estimateDebounceMs, runEstimate]);
  const currentEstimate = estimate.status === "done" && estimate.key === currentKey ? estimate.estimate : null;
  // Until the debounced estimate of the settings on screen arrives, an answer for other settings is not shown as current.
  const shownEstimate: EstimateState = (estimate.status === "done" || estimate.status === "error") && estimate.key !== currentKey ? { status: "loading" } : estimate;
  const autoCellHint = autoCell && autoCell.jobId === activeJobId ? autoCell.cell : null;
  const overHardCap = Boolean(currentEstimate?.available && currentEstimate.limits.exceeds_hard_cap);
  // While a session's model resolves, the model a submission would use is not known yet (same rule as the model picker).
  const canSubmit = Boolean(activeJobId) && source !== "loading" && enabled !== false && selectedDegrees.length > 0 && Boolean(built?.ok) && !overHardCap && submit.status !== "sending";
  const activeConfirm = confirm && confirm.key === currentKey ? confirm : null;

  const toggleDegree = (deg: number) => setSelectedDegrees((current) =>
    current.includes(deg) ? current.filter((value) => value !== deg) : [...current, deg].sort((a, b) => a - b));

  /** `confirmed` names the confirmation the user just accepted; only a threshold confirmation answers the threshold. */
  const submitRun = async (confirmed: "threshold" | "resubmit" | null = null) => {
    if (!canSubmit || !activeJobId || !built || !currentKey) return;
    setSubmit({ status: "sending" });
    // The confirmation and the hard cap must be judged on an estimate of exactly these settings: reuse the one on
    // screen, otherwise ask now (the debounced one may not have run yet). A failed estimate does not block: the
    // server enforces the cap itself.
    const judged = currentEstimate ?? await runEstimate(activeJobId, selectedDegrees, built, currentKey);
    // The user left this session or model while the estimate was pending: do not submit for it.
    if (sessionRef.current !== sessionId || activeJobRef.current !== activeJobId) return;
    if (judged?.available && judged.limits.exceeds_hard_cap) {
      setSubmit({ status: "error", reason: t("預估超過算力上限，伺服器會拒絕；請加大背景格。", "The estimate is over the compute cap and the server would reject it; use larger background cells.") });
      return;
    }
    // Accepting a resubmission only accepts the recorded settings; a costly run is still asked about on its own.
    if (confirmed !== "threshold" && judged?.available && judged.limits.confirm_required) {
      setSubmit({ status: "idle" });
      setConfirm({ kind: "threshold", key: currentKey, reasons: judged.limits.confirm_reasons });
      return;
    }
    setConfirm(null);
    const reply = await client.createRun({
      schema: "cfd-run-request/v1",
      idempotency_key: `cfdreq_ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: { conversion_job_id: activeJobId },
      preprocess: built.sections.preprocess as CfdRunCreateRequestPart["preprocess"],
      wind: { ...built.sections.wind, wind_from_degrees: selectedDegrees } as CfdRunCreateRequestPart["wind"],
      mesh: built.sections.mesh as CfdRunCreateRequestPart["mesh"],
      solver: built.sections.solver as CfdRunCreateRequestPart["solver"],
      // S7: submission context kept in the coordinator ledger (never forwarded to streaming). Only a resolved
      // review session is recorded; an unresolvable id (e.g. a non-review viewer session) is not an origin.
      origin: { session_id: sessionSource ? sessionId : null },
    });
    // Same once sent: a created run still shows in the cross-model overview, but reloading the old model's list here
    // would replace the list of the model now on screen.
    if (sessionRef.current !== sessionId || activeJobRef.current !== activeJobId) { if (reply.body) void refreshAllRuns(); return; }
    if (!reply.body) { setSubmit({ status: "error", reason: replyReason(reply) }); if (reply.errorCode === "cfd_disabled") setEnabled(false); return; }
    setSubmit({ status: "idle" });
    setOverlay(keepAppliedOverlay);
    await refreshRuns(activeJobId, reply.body.run_id);
    void refreshAllRuns();
  };

  // S8: bring a recorded run's settings back into the form and ask once before submitting them again.
  const resubmitWith = (origin: CfdRunOrigin) => {
    if (!options || !activeJobId) return;
    const nextValues = settingsFromOrigin(options, origin, settings);
    const nextDirections = [...origin.wind_from_degrees].sort((a, b) => a - b);
    setSettings(nextValues);
    setSelectedDegrees(nextDirections);
    setConfirm({ kind: "resubmit", key: settingsKey(activeJobId, nextDirections, buildSettings(options, nextValues)), reasons: [] });
  };

  const findingThresholdValue = Number(findingThreshold);
  const findingThresholdValid = findingThreshold.trim() !== "" && Number.isFinite(findingThresholdValue) && findingThresholdValue >= 0.5 && findingThresholdValue <= 30;

  // S6: coordinator composes the governance payload (existing /api/issues, annotation kind); the browser only names the run,
  // the threshold and the session's model_version_id. The answer lists every direction so nothing is opened silently.
  const createFindings = async () => {
    if (!selectedRunId || !findingThresholdValid || !activeJobId) return;
    setFinding({ status: "sending" });
    const reply = await client.createFindings(selectedRunId, { threshold_u_m_s: findingThresholdValue, model_version_id: sessionSource?.modelVersionId ?? null });
    // The answer is about this run: once the user picked another model or run it must not replace their view.
    if (activeJobRef.current !== activeJobId || selectedRunRef.current !== selectedRunId) return;
    if (!reply.body) setFinding({ status: "error", reason: replyReason(reply) });
    else setFinding({ status: "done", response: reply.body });
    // Also after a failure: a partial run may already have opened issues for earlier directions, and the ledger lists them.
    await refreshRuns(activeJobId, selectedRunId);
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
    setOverlay({ status: "applied", runId: selectedRunId, deg, artifactId, revisionId: outcome.revision_id, layerConfirmed });
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

  // An applied overlay belongs to the run it was shown from. Once another run is selected (run picker, a new
  // submission, or a Kit confirmation that arrives after the switch), take its layer off Kit the way "hide" does,
  // so Kit never keeps a CFD layer the panel no longer lists. Like "hide" it needs the viewer command gate, which
  // refuses at once while closed, so the release waits for the gate and goes out when it reopens.
  const appliedRunId = overlay.status === "applied" ? overlay.runId : null;
  const canRelease = ready && Boolean(applyStageBinding);
  useEffect(() => {
    if (appliedRunId && appliedRunId !== selectedRunId && canRelease) void hideOverlay();
    // hideOverlay is a new function on every render; the applied run, the selection and the gate decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRunId, selectedRunId, canRelease]);

  // Slider: local value while dragging; the Kit command goes out on commit (pointer up / key up / blur) so a drag
  // is one request, not sixty. Only the pedestrian plane is styled; the readback (not the slider) is what we report.
  // The styled prim lives in the applied overlay layer: derive it from that layer's artifact id (cfd:<run>:<wNNN>).
  const overlayPrimPath = overlay.status === "applied" ? cfdOverlayPrimPathForArtifact(overlay.artifactId) : null;
  const opacityStyleBusy = overlayStyleState?.status === "pending";
  const opacityEnabled = Boolean(overlayPrimPath && commands && ready && overlay.status === "applied" && overlay.layerConfirmed && !opacityStyleBusy);
  const commitOpacity = () => {
    // Tab/blur/modifier keys without a value change must not touch the stage.
    if (!opacityDirty.current || !opacityEnabled || !overlayPrimPath || !commands) return;
    opacityDirty.current = false;
    void commands.send("overlay_style", { primPath: overlayPrimPath, displayOpacity: opacity });
  };

  // Only a run of the active model may drive status/result/overlay; a stale selection from another model renders nothing.
  const selectedRun = useMemo(() => runs.find((item) => item.run_id === selectedRunId && item.conversion_job_id === activeJobId) ?? null, [runs, selectedRunId, activeJobId]);
  const overlayBusy = overlay.status === "registering" || overlay.status === "applying";
  const overlayBlocked = !ready || !applyStageBinding || overlayBusy || !sessionSource;
  const progress = status?.progress ?? (selectedRun ? { directions_total: selectedRun.directions_total, directions_done: selectedRun.directions_done } : null);
  const currentStatus = status?.status ?? selectedRun?.status ?? null;

  return (
    <section aria-label={t("風環境", "Wind environment")} data-testid="wind-panel" data-prov="asbuilt"
      style={{ flexShrink: 0, borderTop: "1px solid var(--ab-border)", paddingTop: 12, display: "grid", gap: 8, fontSize: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>{t("風環境", "Wind environment")}<ProvTag prov="asbuilt" /></h3>
      <p data-testid="wind-purpose" role="note" style={{ margin: 0, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--ab-border)", color: "var(--ab-text-muted, var(--ab-text))" }}>
        {t("設計比較用：非法規或認證依據；粗網格概念驗證，無網格收斂研究。", "Design comparison only: not a regulatory or certification basis; coarse proof-of-concept mesh without a grid-convergence study.")}
      </p>

      {/* S7: model picker. With a session the session's model is fixed; without one any ready model can be browsed/submitted. */}
      <label>{t("模型", "Model")}
        <select aria-label={t("模型", "Model")} data-testid="wind-model-select" style={controlField} value={activeJobId ?? ""}
          disabled={Boolean(sessionSource) || source === "loading"} onChange={(event) => setPickedJobId(event.target.value || null)}>
          <option value="">{models === null ? t("讀取模型清單…", "Loading models…") : t("— 選擇 ready 模型 —", "— choose a ready model —")}</option>
          {(models ?? []).map((item) => <option key={item.conversionJobId} value={item.conversionJobId}>{item.label}</option>)}
          {activeJobId && !(models ?? []).some((item) => item.conversionJobId === activeJobId)
            ? <option value={activeJobId}>{activeJobId}</option> : null}
        </select>
      </label>
      {sessionSource ? <small data-testid="wind-model-from-session">{t("模型由目前 review session 決定；疊圖會套用到此 3D 畫面。", "Model fixed by the current review session; overlays apply to this 3D view.")}</small> : null}
      {!sessionId ? <span data-testid="wind-no-session">{t("沒有 review session：可瀏覽與送出風場計算；「顯示疊圖」需要先啟動 3D session。", "No review session: runs can be browsed and submitted; showing an overlay needs a 3D session.")}</span> : null}
      {models !== null && models.length === 0 && !sessionSource ? <span data-testid="wind-no-models">{t("coordinator 目前沒有 ready 的轉檔模型。", "The coordinator has no ready converted model yet.")}</span> : null}
      {source === "loading" ? <span role="status">{t("讀取模型來源…", "Loading model source…")}</span> : null}
      {source === "unavailable" ? <span role="alert" data-testid="wind-source-unavailable">{t("此 session 沒有 ready 的模型 binding 或缺 conversion job，無法建立風場計算。", "This session has no ready model binding or conversion job; a wind run cannot be created.")}</span> : null}
      {enabled === false ? <span role="alert" data-testid="wind-disabled">{t("此 coordinator 未啟用 CFD（CFD_ENABLED=false）；只顯示既有 ledger。", "CFD is not enabled on this coordinator (CFD_ENABLED=false); only the existing ledger is shown.")}</span> : null}
      {refreshError ? <span role="alert" data-testid="wind-refresh-error">{refreshError}</span> : null}
      {stale ? <span data-testid="wind-stale">{t("清單為 ledger 快取（streaming CFD 服務暫時不可達）。", "List is the ledger cache (streaming CFD service temporarily unreachable).")}</span> : null}

      {activeJobId ? (
        <>
          <fieldset data-testid="wind-directions" style={{ border: "1px solid var(--ab-border)", borderRadius: 6, padding: 8, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
            <legend style={fieldsetLegend}>{settings["wind.true_north_source"] === "manual"
              ? t("風向（來向，相對手動輸入的真北）", "Wind from (relative to the manually entered true north)")
              : t("風向（來向，相對 project north）", "Wind from (relative to project north)")}</legend>
            {COMPASS_16.map(({ deg, label }) => (
              <label key={deg} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" data-testid={`wind-dir-${deg}`} checked={selectedDegrees.includes(deg)} onChange={() => toggleDegree(deg)} disabled={submit.status === "sending"} />
                <span>{label} {deg}°</span>
              </label>
            ))}
          </fieldset>
          {options && built ? (
            <WindRunSettings options={options} values={settings} presetId={built.presetId} errors={built.errors} disabled={submit.status === "sending"}
              estimate={shownEstimate} autoCellHint={autoCellHint}
              onChange={(key, raw) => setSettings((current) => ({ ...current, [key]: raw }))}
              onPreset={(presetId) => setSettings((current) => applyPreset(options, current, presetId))} />
          ) : optionsError ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span role="alert" data-testid="wind-options-error">{t("無法取得計算設定選項：", "Run settings unavailable: ")}{optionsError}{t("；暫時不能送出新的計算。", "; a new run cannot be submitted for now.")}</span>
              <button data-testid="wind-options-retry" style={controlField} onClick={() => { setOptionsError(null); setOptionsAttempt((attempt) => attempt + 1); }}>{t("重試", "Retry")}</button>
            </div>
          ) : <span role="status" data-testid="wind-options-loading">{t("讀取計算設定選項…", "Loading run settings…")}</span>}
          {activeConfirm ? (
            <div role="alertdialog" aria-label={t("再確認", "Confirm")} data-testid="wind-confirm" data-kind={activeConfirm.kind}
              style={{ display: "grid", gap: 4, padding: 8, border: "1px solid var(--ab-border)", borderRadius: 6 }}>
              <span>{activeConfirm.kind === "resubmit"
                ? t("已帶入這組設定與風向。確認後會用它重新送出。", "The recorded settings and directions are loaded. Confirm to submit them again.")
                : t(`預估超過再確認門檻（${confirmReasonsText(activeConfirm.reasons)[0]}），確定要送出嗎？`, `The estimate is above the confirmation threshold (${confirmReasonsText(activeConfirm.reasons)[1]}). Submit anyway?`)}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button data-testid="wind-confirm-submit" style={controlField} disabled={!canSubmit} onClick={() => { void submitRun(activeConfirm.kind); }}>{t("確認送出", "Submit")}</button>
                <button data-testid="wind-confirm-cancel" style={controlField} onClick={() => setConfirm(null)}>{t("取消", "Cancel")}</button>
              </div>
            </div>
          ) : null}
          <button data-testid="wind-submit" style={controlField} disabled={!canSubmit || Boolean(activeConfirm)} onClick={() => { void submitRun(); }}>
            {submit.status === "sending" ? t("送出中…", "Submitting…") : t("送出風場計算", "Start wind run")}
            {selectedDegrees.length ? ` (${selectedDegrees.length})` : ""}
          </button>
          {submit.status === "error" ? <span role="alert" data-testid="wind-submit-error">{t("送出失敗：", "Submit failed: ")}{submit.reason}</span> : null}

          {runs.length ? (
            <label>{t("計算紀錄", "Runs")}
              <select aria-label={t("計算紀錄", "Runs")} data-testid="wind-run-select" style={controlField} value={selectedRunId ?? ""} onChange={(event) => { setSelectedRunId(event.target.value || null); setOverlay(keepAppliedOverlay); }}>
                {runs.map((item) => <option key={item.run_id} value={item.run_id}>{item.created_at.slice(0, 16).replace("T", " ")} · {t(...STATUS_TEXT[item.status])} · {item.directions_done}/{item.directions_total}</option>)}
              </select>
            </label>
          ) : <span data-testid="wind-no-runs">{t("此模型尚無風場計算。", "No wind runs for this model yet.")}</span>}

          {selectedRun && currentStatus ? (
            <div role="status" aria-live="polite" data-testid="wind-run-status" data-status={currentStatus} style={{ display: "grid", gap: 4 }}>
              {selectedRun?.queue_position ? <span data-testid="wind-queue-position">{t(`排隊第 ${selectedRun.queue_position} 位（單一求解 worker，依送出時間）`, `Queue position ${selectedRun.queue_position} (single solver worker, FIFO by submission time)`)}</span> : null}
              {selectedRun?.origin ? <small data-testid="wind-run-origin">{selectedRun.origin.session_id
                ? t(`來自 session ${selectedRun.origin.session_id.slice(-12)}`, `From session ${selectedRun.origin.session_id.slice(-12)}`)
                : t("未綁定 session 送出", "Submitted without a session")} · {selectedRun.origin.wind_from_degrees.length} {t("向", "dir")} · U {selectedRun.origin.uref_m_s} m/s</small> : null}
              {selectedRun?.origin ? (
                <div data-testid="wind-run-settings" style={{ display: "grid", gap: 2 }}>
                  <small data-testid="wind-run-settings-text">{t("設定：", "Settings: ")}{originSettingsText(selectedRun.origin)}</small>
                  <button data-testid="wind-resubmit" style={controlField} disabled={!options || enabled === false || submit.status === "sending"}
                    onClick={() => { if (selectedRun.origin) resubmitWith(selectedRun.origin); }}>{t("用這組設定重新送出", "Submit again with these settings")}</button>
                </div>
              ) : null}
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
                {commands ? (
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
                    const shown = overlay.status === "applied" && overlay.runId === selectedRunId && overlay.deg === deg;
                    const busyHere = overlayBusy && "deg" in overlay && overlay.deg === deg;
                    const canShow = direction.status === "ready" && Boolean(direction.overlay_layer) && !overlayBlocked;
                    const showTitle = !sessionSource ? t("顯示疊圖需要 review session 與 3D 畫面", "Showing an overlay needs a review session and the 3D view") : undefined;
                    return (
                      <tr key={deg} data-testid={`wind-row-${deg}`}>
                        <td>{COMPASS_16.find((item) => item.deg === deg)?.label ?? ""} {deg}°</td>
                        <td>{t(...STATUS_TEXT[direction.status])}</td>
                        <td>{direction.converged_by_residual_control === null ? "—" : direction.converged_by_residual_control ? `${t("是", "yes")}${direction.iterations !== null ? ` (${direction.iterations})` : ""}` : `${t("否", "no")}${direction.iterations !== null ? ` (${direction.iterations})` : ""}`}{direction.end_time_extended_to ? <small data-testid={`wind-extended-${deg}`}> {t(`已自動延長至 ${direction.end_time_extended_to} 步`, `auto-extended to ${direction.end_time_extended_to} steps`)}</small> : null}</td>
                        <td>{direction.pedestrian_1p5m ? `${direction.pedestrian_1p5m.U_magnitude_max.toFixed(2)} m/s` : "—"}</td>
                        <td>{direction.building_pressure ? `${direction.building_pressure.p_min.toFixed(1)} / ${direction.building_pressure.p_max.toFixed(1)} Pa` : "—"}</td>
                        <td>
                          {shown
                            ? <button data-testid={`wind-overlay-off-${deg}`} style={controlField} disabled={overlayBlocked} onClick={() => { void hideOverlay(); }}>{t("關閉疊圖", "Hide overlay")}</button>
                            : <button data-testid={`wind-overlay-on-${deg}`} style={controlField} disabled={!canShow} title={showTitle} onClick={() => { void showOverlay(direction); }}>{busyHere ? t("套用中…", "Applying…") : t("顯示疊圖", "Show overlay")}</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* S6 A1 finding: exceeding directions → governance issues via the coordinator (contract S6; text stays screening-honest). */}
              <div data-testid="wind-finding" style={{ display: "grid", gap: 4 }}>
                <label>{t("A1 finding 門檻：行人面 |U|max（m/s）", "A1 finding threshold: pedestrian |U|max (m/s)")}
                  <input type="number" data-testid="wind-finding-threshold" style={controlField} min={0.5} max={30} step={0.5} value={findingThreshold}
                    aria-invalid={!findingThresholdValid} onChange={(event) => setFindingThreshold(event.target.value)} />
                </label>
                <button data-testid="wind-finding-create" style={controlField} disabled={!findingThresholdValid || finding.status === "sending" || currentStatus !== "ready"}
                  onClick={() => { void createFindings(); }}>
                  {finding.status === "sending" ? t("建立中…", "Opening…") : t("超標方向轉 A1 issue", "Open A1 issues for exceeding directions")}
                </button>
                <small>{t("經既有 issue 入口建立（annotation，不綁單一元件）；內容如實寫入 validation_level 與「設計比較用」，同一 run／風向／門檻只開一次。",
                  "Opened through the existing issue outlet (annotation, not bound to one element); the text states validation_level and design-comparison-only; one issue per run/direction/threshold.")}</small>
                {finding.status === "error" ? <span role="alert" data-testid="wind-finding-error">{t("建立中斷：", "Opening stopped: ")}{finding.reason}{t("；已開的 issue 列於下方，重試只補未開的方向。", "; issues already opened are listed below, a retry only opens the missing directions.")}</span> : null}
                {finding.status === "done" ? <span role="status" data-testid="wind-finding-result">
                  {t(`新開 ${finding.response.created_count} 筆 issue；超標 ${finding.response.evaluated.filter((item) => item.exceeds).length}／${finding.response.evaluated.length} 向；門檻 ${finding.response.threshold_u_m_s} m/s（${finding.response.validation_level}）`,
                    `${finding.response.created_count} issue(s) opened; ${finding.response.evaluated.filter((item) => item.exceeds).length}/${finding.response.evaluated.length} directions exceed; threshold ${finding.response.threshold_u_m_s} m/s (${finding.response.validation_level})`)}
                </span> : null}
                {finding.status === "done" ? (
                  <details data-testid="wind-finding-evaluated">
                    <summary>{t("逐向結果", "Per direction")}</summary>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {finding.response.evaluated.map((item) => (
                        <li key={item.wind_from_degrees} data-testid={`wind-finding-eval-${item.wind_from_degrees}`}>
                          {item.wind_from_degrees}° · {item.u_max_m_s === null ? "—" : `${item.u_max_m_s.toFixed(2)} m/s`} · {item.finding
                            ? (item.idempotent_replay ? t(`已存在 ${item.finding.issue_id}`, `already open ${item.finding.issue_id}`) : t(`已開 ${item.finding.issue_id}`, `opened ${item.finding.issue_id}`))
                            : item.skipped_reason ? t(...(SKIPPED_REASON_TEXT[item.skipped_reason] ?? [item.skipped_reason, item.skipped_reason])) : "—"}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {selectedRun?.findings?.length ? (
                  <ul data-testid="wind-finding-list" style={{ margin: 0, paddingLeft: 16 }}>
                    {selectedRun.findings.map((item) => (
                      <li key={`${item.issue_id}`} data-testid={`wind-finding-${item.issue_id}`}>
                        {item.wind_from_degrees}° · {item.u_max_m_s.toFixed(2)} m/s {">"} {item.threshold_u_m_s} m/s · {item.severity} · {item.issue_kind} {item.issue_id}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
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

      {/* S7: cross-model overview — every recent run in the coordinator ledger, whatever session or model is selected. */}
      <details data-testid="wind-all-runs">
        <summary>{t("所有模型的風場計算", "Wind runs across all models")} ({allRuns.length})</summary>
        {allRuns.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ textAlign: "left" }}><th>{t("送出", "Submitted")}</th><th>{t("模型", "Model")}</th><th>{t("狀態", "Status")}</th><th>{t("排隊", "Queue")}</th></tr></thead>
            <tbody>
              {allRuns.map((run) => (
                <tr key={run.run_id} data-testid={`wind-all-run-${run.run_id}`} style={{ fontWeight: run.run_id === selectedRunId ? 600 : 400 }}>
                  <td>{run.created_at.slice(0, 16).replace("T", " ")}</td>
                  <td title={run.conversion_job_id}>{models?.find((item) => item.conversionJobId === run.conversion_job_id)?.label ?? run.conversion_job_id.slice(-12)}</td>
                  <td>{t(...STATUS_TEXT[run.status])} {run.directions_done}/{run.directions_total}</td>
                  <td>{run.queue_position ? `#${run.queue_position}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <small>{t("尚無風場計算。", "No wind runs yet.")}</small>}
      </details>
    </section>
  );
}
