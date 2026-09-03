import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Btn, Field, Panel } from "./components";
import { coordinatorClient, type RuntimeSessionSummary, type ViewerLeaseClaimResponse } from "./coordinatorClient";
import { viewerLeaseHeartbeatDelayMs } from "../clients/viewerLeaseHeartbeat";
import { EmbeddedViewer, type EmbeddedViewerHandle, type HighlightItem, type HighlightResultMessage, type StageTreeMessage } from "./EmbeddedViewer";
import { t } from "./i18n";
import { getLocalDevUserCarrier } from "./localDevPrincipal";
import { useSharedStatus } from "./useSharedStatus";

export interface ReviewRoomHandoff {
  source: string | null;
  sessionId: string;
  ruleRunId: string | null;
  ifcGuid: string | null;
  usdPrimPath: string | null;
  ruleCode: string | null;
  severity: string | null;
  label: string | null;
  expectedStageUrl: string | null;
  mappingInformationStatus: string | null;
  mappingIssueCode: string | null;
  mappingIssueCount: string | null;
}

const EMPTY_HANDOFF: ReviewRoomHandoff = {
  source: null,
  sessionId: "",
  ruleRunId: null,
  ifcGuid: null,
  usdPrimPath: null,
  ruleCode: null,
  severity: null,
  label: null,
  expectedStageUrl: null,
  mappingInformationStatus: null,
  mappingIssueCode: null,
  mappingIssueCount: null,
};

export function parseReviewRoomHandoff(hash = typeof window !== "undefined" ? window.location.hash : ""): ReviewRoomHandoff {
  const queryStart = hash.indexOf("?");
  if (queryStart < 0) return EMPTY_HANDOFF;
  const params = new URLSearchParams(hash.slice(queryStart + 1));
  return {
    source: params.get("source"),
    sessionId: params.get("session") ?? "",
    ruleRunId: params.get("rule_run_id"),
    ifcGuid: params.get("ifc_guid"),
    usdPrimPath: params.get("usd_prim_path"),
    ruleCode: params.get("rule_code"),
    severity: params.get("severity"),
    label: params.get("label"),
    expectedStageUrl: params.get("expected_stage_url"),
    mappingInformationStatus: params.get("mapping_information_status"),
    mappingIssueCode: params.get("mapping_issue_code"),
    mappingIssueCount: params.get("mapping_issue_count"),
  };
}

export function reviewRoomHandoffHasPayload(handoff: ReviewRoomHandoff): boolean {
  return Boolean(handoff.source || handoff.sessionId || handoff.ruleRunId || handoff.ifcGuid || handoff.usdPrimPath || handoff.mappingInformationStatus || handoff.mappingIssueCode);
}

function stageUrlsEquivalent(loaded: string, expected: string): boolean {
  if (loaded === expected) return true;
  try {
    const a = new URL(loaded);
    const b = new URL(expected);
    if (a.protocol !== b.protocol) return false;
    if (a.protocol !== "http:" && a.protocol !== "https:") return false;
    return a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

function sessionIdIsValid(sessionId: string): boolean {
  return /^(lwv_|review_session_)[A-Za-z0-9_]+$/.test(sessionId);
}

// "a2-overlay"（A2 F2⑥）：VersionDiffPage 內嵌的 diff 三組批次疊加宿主。複用本 pane 全部
// session/lease/viewer 證據鏈（最小泛化，不複製元件）；差異只在 testid 前綴、文案與
// 「批次疊加由外部（A2 頁）經 ref handle 觸發」。
type ReviewSessionViewerPaneMode = "review-room" | "a1-inline" | "a2-overlay" | "a3-inline" | "a4-inline";

interface ReviewViewerIdentity {
  viewer_id: string;
  user_token: string;
  display_name: string;
}

function createReviewViewerIdentity(mode: ReviewSessionViewerPaneMode): ReviewViewerIdentity {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const prefix = mode.replace(/-/g, "_");
  const userToken = getLocalDevUserCarrier();
  return {
    viewer_id: `${prefix}_viewer_${random}`,
    user_token: userToken,
    display_name: mode === "a1-inline"
      ? "A1 inline primary viewer"
      : mode === "a2-overlay"
        ? "A2 diff overlay primary viewer"
        : mode === "a3-inline"
          ? "A3 federation primary viewer"
          : mode === "a4-inline"
            ? "A4 semantic primary viewer"
            : "Review Room primary viewer",
  };
}

// A2 批次疊加對外 handle：外部（VersionDiffPage）備好 HighlightItem 群組後經此送出。
// 送出前先過與單筆高亮相同的 viewer 證據 gate（session observed / lease / first frame /
// DataChannel / stage match）；gate 未過誠實回 { sent:false, reason }，絕不佯裝已送。
export interface ReviewSessionViewerPaneHandle {
  sendHighlightBatch(items: HighlightItem[]): { sent: true } | { sent: false; reason: string };
  requestStageTree(primPath?: string): void;
  selectPrim(primPath: string, multiSelect?: boolean): void;
  sendToolbarAction(
    action: "reset_camera" | "camera_view" | "toggle_fullscreen" | "toggle_projection",
    cameraView?: string,
  ): void;
}

export interface ReviewSessionViewerPaneBatchGate {
  canSend: boolean;
  reason: string; // canSend=false 時的誠實理由（"" 代表可送）
}

function highlightResultText(result: { ok: boolean; reason?: string }): string {
  if (result.ok) return t("已送出並收到 viewer 回報", "Sent and acknowledged by the viewer");
  if (result.reason === "unmapped") return t("viewer 回報未對映，無法高亮", "viewer reported unmapped; cannot highlight");
  if (result.reason === "datachannel_not_ready") return t("viewer DataChannel 尚未就緒", "viewer DataChannel is not ready");
  return t("viewer 回報高亮未成功", "viewer reported highlight failure");
}

function mappingDiagnosticText(handoff: ReviewRoomHandoff): string {
  const parts = [
    handoff.mappingInformationStatus ? `status=${handoff.mappingInformationStatus}` : null,
    handoff.mappingIssueCode ? `code=${handoff.mappingIssueCode}` : null,
    handoff.mappingIssueCount ? `issues=${handoff.mappingIssueCount}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0
    ? parts.join(" / ")
    : t("missing usd_prim_path / mapping", "missing usd_prim_path / mapping");
}

function healthValue(value: boolean | null | undefined): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "unknown";
}

let highlightCorrelationSequence = 0;

function createHighlightCorrelationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `viewer_highlight_${uuid}`;
  highlightCorrelationSequence += 1;
  return `viewer_highlight_${Date.now().toString(36)}_${highlightCorrelationSequence.toString(36)}`;
}

type ViewerLeaseError =
  | { kind: "primary_occupied"; message: string }
  | { kind: "other"; message: string };

function classifyViewerLeaseError(error: unknown): ViewerLeaseError {
  const message = String(error);
  if (/\b409\b[\s\S]*\bprimary_already_claimed\b/.test(message)) {
    return { kind: "primary_occupied", message };
  }
  return { kind: "other", message };
}

export interface ReviewSessionViewerPaneProps {
  handoff?: ReviewRoomHandoff;
  mode?: ReviewSessionViewerPaneMode;
  // 失敗態矩陣 first-frame-timeout（task 5.6）：claim 後未收首幀的可見逾時。90s 與
  // stage-load-timeout 的 90×1s busy-poll 上限對齊；測試注入小值。
  firstFrameTimeoutMs?: number;
  // 測試縫：heartbeat 排程延遲計算。預設＝f4 統一政策 viewerLeaseHeartbeatDelayMs，
  // 不得在生產路徑另定數值。
  heartbeatDelayFn?: (heartbeatAfterMs: number) => number;
  // A2 批次疊加 gate 通知：viewer 證據鏈（lease/first frame/DataChannel/stage match）任一變動時回報，
  // 外部據以 enable/disable「套用疊加」鈕並顯示誠實理由。非 a2 用途可不傳（零行為變更）。
  onBatchGateChange?: (gate: ReviewSessionViewerPaneBatchGate) => void;
  // viewer highlight_result ack 透傳（含批次 ack 的 sent_count/unmapped_count 加性欄位）。
  onBatchAck?: (message: HighlightResultMessage) => void;
  // A3 currently has no element-level mapping/clash contract. It may attach the
  // real federated stage while keeping single-element highlight actions hidden.
  showHandoffActions?: boolean;
  onStageTree?: (message: StageTreeMessage) => void;
}

export const ReviewSessionViewerPane = forwardRef<ReviewSessionViewerPaneHandle, ReviewSessionViewerPaneProps>(
  function ReviewSessionViewerPane({ handoff = parseReviewRoomHandoff(), mode = "review-room", onBatchGateChange, onBatchAck, onStageTree, showHandoffActions = true, firstFrameTimeoutMs = 90_000, heartbeatDelayFn = viewerLeaseHeartbeatDelayMs }, ref) {
  const isA1Inline = mode === "a1-inline";
  const isA2Overlay = mode === "a2-overlay";
  const isA3Inline = mode === "a3-inline";
  const isA4Inline = mode === "a4-inline";
  // testid 前綴 = mode（review-room / a1-inline / a2-overlay），既有兩模式的 testid 逐字不變。
  const tidPrefix = mode;
  const [sessionId, setSessionId] = useState(handoff.sessionId);
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeSessionSummary[]>([]);
  const [viewerOrigin, setViewerOrigin] = useState<string | null>(null);
  const [coordinatorBase, setCoordinatorBase] = useState<string | null>(null);
  const [runtimeErr, setRuntimeErr] = useState<string | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [gpuUnavailable, setGpuUnavailable] = useState(false);
  const [leaseExpired, setLeaseExpired] = useState(false);
  const [firstFrameTimedOut, setFirstFrameTimedOut] = useState(false);
  const [streamDisconnected, setStreamDisconnected] = useState(false);
  // viewer bootstrap 需要 canonical structured-log trace carrier；真源＝coordinator
  // stream-config（sessionTraceResolver 權威，取不到時 coordinator 自己回 409）。
  // 取不到就不掛 viewer——舊行為是掛一個必定 white-screen 的 iframe，operator 只會看到
  // 誤導的 first-frame 逾時。
  const [viewerTraceId, setViewerTraceId] = useState<string | null>(null);
  const [viewerTraceErr, setViewerTraceErr] = useState<string | null>(null);
  const [viewerMountNonce, setViewerMountNonce] = useState(0);
  const [lease, setLease] = useState<ViewerLeaseClaimResponse | null>(null);
  const [leaseBusy, setLeaseBusy] = useState(false);
  const [leaseErr, setLeaseErr] = useState<ViewerLeaseError | null>(null);
  const [firstFrame, setFirstFrame] = useState(false);
  const [dataChannelReady, setDataChannelReady] = useState(false);
  const [loadedStageUrl, setLoadedStageUrl] = useState<string | null>(null);
  const [stageProofStatus, setStageProofStatus] = useState<"not_observed" | "active" | "unproven">("not_observed");
  const [highlightResult, setHighlightResult] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [commandTrace, setCommandTrace] = useState<string | null>(null);
  const identityRef = useRef<ReviewViewerIdentity | null>(null);
  const viewerRef = useRef<EmbeddedViewerHandle>(null);
  const sessionInputTestId = `${tidPrefix}-session-input`;
  const sessionCandidatesTestId = `${tidPrefix}-session-candidates`;
  const sessionCandidatesId = sessionCandidatesTestId;
  const manualStartTestId = `${tidPrefix}-manual-start`;
  const runtimeEvidenceTestId = `${tidPrefix}-runtime-evidence`;
  const viewerHostTestId = `${tidPrefix}-viewer-host`;
  const kitNotStartedTestId = `${tidPrefix}-kit-not-started`;
  const viewerOriginMissingTestId = `${tidPrefix}-viewer-origin-missing`;
  const handoffSummaryTestId = `${tidPrefix}-handoff-summary`;
  const highlightButtonTestId = `${tidPrefix}-highlight`;
  const highlightReasonTestId = `${tidPrefix}-highlight-reason`;
  const commandTraceTestId = `${tidPrefix}-command-trace`;
  // Task 13（七軸和諧整合）：只借 useSharedStatus() 餵 session input 的候選 <datalist>；不改變本 pane 既有的
  // runtimeStatus 判定 / lease 授權邏輯（N3：claimPrimary、lease/heartbeat effects、sendHighlight、
  // EmbeddedViewer 皆不動）。input 仍是自由輸入欄，datalist 只是額外的自動完成候選來源。
  const shared = useSharedStatus();
  // sessionsById（spec §5.2）是全量表（不分狀態，coordinator 從不刪除 session：active→closing→closed 永久保留）。
  // datalist 是「可 attach 候選」（spec §5.5），只列與本 pane runtimeSessions（下方 line 123）同一組可 attach 狀態
  // （active/created）的 session_id；否則長壽環境累積的 closed/closing 過期 session 會被當成外觀無異的自動完成
  // 候選，把過期 session 假裝成可 attach（違反 N5 誠實鐵律，比照 KitGpuFleetPage task#8 的 active-only 修法）。
  const sessionCandidates = Object.values(shared.sessionsById)
    .filter((s) => s.status === "active" || s.status === "created")
    .map((s) => s.session_id);
  const sid = sessionId.trim();
  const highlightTargetFingerprint = `${sid}\u0000${handoff.ifcGuid ?? ""}\u0000${handoff.usdPrimPath ?? ""}`;
  const highlightTargetFingerprintRef = useRef<string | null>(null);
  const highlightTargetGenerationRef = useRef(0);
  const pendingHighlightRef = useRef<{
    clientRequestId: string;
    targetGeneration: number;
    kind: "single" | "batch";
  } | null>(null);
  // ref 在 render 中只保留目前 props 的純導出值。目標切換時立刻讓舊 ACK 失效，
  // 不等待 effect 才清除，避免 DataChannel 於 React effect 前到達而誤套用。
  if (highlightTargetFingerprintRef.current !== highlightTargetFingerprint) {
    highlightTargetFingerprintRef.current = highlightTargetFingerprint;
    highlightTargetGenerationRef.current += 1;
    pendingHighlightRef.current = null;
  }
  useEffect(() => {
    setHighlightResult(null);
    setCommandTrace(null);
  }, [highlightTargetFingerprint]);
  const validSession = sessionIdIsValid(sid);
  const activePrimaryLease = lease && lease.session_id === sid && lease.role === "primary" && lease.status === "active" ? lease : null;
  const runtimeSession = runtimeSessions.find((s) => s.session_id === sid) ?? null;
  const sessionObserved = Boolean(runtimeSession);
  const artifactHealth = runtimeSession?.artifact_health ?? null;
  // session-preparing（task 5.6）：session 已列於 runtime/status 但 conversion 未達終態。
  const conversionPreparing = Boolean(sessionObserved && runtimeSession && runtimeSession.conversion_status && runtimeSession.conversion_status !== 'succeeded');
  const modelArtifactStale = artifactHealth?.model_usdc_reachable === false;
  const mappingArtifactStale = artifactHealth?.mapping_reachable === false;
  const artifactHealthSummary = artifactHealth
    ? [
        `source_ifc_exists=${healthValue(artifactHealth.source_ifc_exists)}`,
        `model_usdc_reachable=${healthValue(artifactHealth.model_usdc_reachable)}`,
        `mapping_reachable=${healthValue(artifactHealth.mapping_reachable)}`,
        artifactHealth.stale_reason ? `stale_reason=${artifactHealth.stale_reason}` : null,
      ].filter((part): part is string => Boolean(part)).join(" / ")
    : t("not_observed（尚未取得 artifact health）", "not_observed (artifact health not available yet)");
  const expectedStageUrl = handoff.expectedStageUrl ?? runtimeSession?.expected_stage_url ?? null;
  const stageMatched = Boolean(loadedStageUrl && expectedStageUrl && stageUrlsEquivalent(loadedStageUrl, expectedStageUrl));
  const viewerOpenUrl = validSession ? coordinatorClient.openInViewerUrl(sid) : undefined;

  // 失敗態矩陣（task 5.6）：viewer-origin-missing 需要「重新整理 runtime status」可行動作，
  // 因此把單次 fetch 抽成可重複呼叫的 refresh；unmount 後不再 set state（沿用既有 alive 語意）。
  const runtimeAliveRef = useRef(true);
  useEffect(() => () => { runtimeAliveRef.current = false; }, []);
  const refreshRuntimeStatus = useCallback(() => {
    // gpu-unavailable（task 5.6）：kit-manager instances 查詢失敗或無可用 instance 即
    // 誠實停用啟動鈕；查詢成功才恢復。與 runtime status 同一 refresh 動作重測。
    void coordinatorClient.kitInstanceCurrent()
      .then(() => { if (runtimeAliveRef.current) setGpuUnavailable(false); })
      .catch(() => { if (runtimeAliveRef.current) setGpuUnavailable(true); });
    return coordinatorClient.runtimeStatus()
      .then((rt) => {
        if (!runtimeAliveRef.current) return;
        setRuntimeSessions(rt.sessions.items.filter((s) => s.status === "active" || s.status === "created"));
        setViewerOrigin(rt.configured_endpoints.viewer.browser_url_base || null);
        setCoordinatorBase(rt.configured_endpoints.coordinator.public_base_url || null);
        setRuntimeErr(null);
        setRuntimeReady(true);
      })
      .catch((e) => {
        if (!runtimeAliveRef.current) return;
        setRuntimeSessions([]);
        setViewerOrigin(null);
        setCoordinatorBase(null);
        setRuntimeErr(String(e));
        setRuntimeReady(true);
      });
  }, []);
  useEffect(() => { void refreshRuntimeStatus(); }, [refreshRuntimeStatus]);

  useEffect(() => {
    setSessionId(handoff.sessionId);
    setLease(null);
    setLeaseErr(null);
    setLeaseExpired(false);
    setFirstFrameTimedOut(false);
    setStreamDisconnected(false);
    setFirstFrame(false);
    setDataChannelReady(false);
    setLoadedStageUrl(null);
    setStageProofStatus("not_observed");
    setHighlightResult(null);
    setCommandTrace(null);
    setViewerTraceId(null);
    setViewerTraceErr(null);
  }, [handoff.sessionId]);

  // ACK and command trace belong to the exact highlighted target, not merely
  // to the surrounding Review Session. Preserve the active lease/runtime
  // evidence when the operator changes rows, but require a fresh send + ACK.
  useEffect(() => {
    setHighlightResult(null);
    setCommandTrace(null);
  }, [handoff.ifcGuid, handoff.usdPrimPath, handoff.ruleRunId]);

  useEffect(() => {
    if (!activePrimaryLease) return;
    return () => {
      void coordinatorClient.releaseViewerLease(activePrimaryLease.session_id, activePrimaryLease.lease_id, activePrimaryLease.lease_token).catch(() => {});
    };
  }, [
    activePrimaryLease?.session_id,
    activePrimaryLease?.lease_id,
    activePrimaryLease?.lease_token,
  ]);

  useEffect(() => {
    if (!activePrimaryLease) return;
    const heartbeatMs = heartbeatDelayFn(activePrimaryLease.heartbeat_after_ms);
    const timer = window.setInterval(() => {
      void coordinatorClient.viewerLeaseHeartbeat(sid, activePrimaryLease.lease_id, activePrimaryLease.lease_token, {
        loaded_stage_url: loadedStageUrl,
        datachannel_ready: dataChannelReady,
      }).catch((e) => {
        // lease-expired（task 5.6）：coordinator 對過期/失效 lease 的 heartbeat 回
        // 404「Viewer lease not found or token invalid」。轉入可見失效態並清 lease；
        // 其他 heartbeat 失敗維持既有沉默重試語意，不誤標為過期。
        const message = String(e);
        if (/\b404\b/.test(message) && /viewer lease/i.test(message)) {
          setLease(null);
          setLeaseExpired(true);
        }
      });
    }, heartbeatMs);
    return () => window.clearInterval(timer);
  }, [
    sid,
    activePrimaryLease?.lease_id,
    activePrimaryLease?.lease_token,
    activePrimaryLease?.heartbeat_after_ms,
    dataChannelReady,
    loadedStageUrl,
    heartbeatDelayFn,
  ]);

  // canonical trace carrier：session 可觀測即向 coordinator 取，讓 viewer iframe 掛載前
  // 就備妥 trace_id。coordinator 409（trace authority unavailable）與網路失敗一律誠實記錄，
  // 不合成 `rev_<sessionId>`——ifc-ready 建立的 session 用的是 `ifcready_` 前綴。
  useEffect(() => {
    if (!validSession || !sessionObserved) return;
    let alive = true;
    coordinatorClient.streamConfig(sid)
      .then((config) => {
        if (!alive) return;
        const traceId = typeof config.trace_id === "string" ? config.trace_id : "";
        if (traceId) {
          setViewerTraceId(traceId);
          setViewerTraceErr(null);
          return;
        }
        setViewerTraceId(null);
        setViewerTraceErr("stream-config 未提供 trace_id");
      })
      .catch((e) => {
        if (!alive) return;
        setViewerTraceId(null);
        setViewerTraceErr(String(e));
      });
    return () => { alive = false; };
  }, [sid, validSession, sessionObserved]);

  // first-frame-timeout（task 5.6）：claim 成功且 viewer 已掛載，但期限內未收
  // first_frame 即轉入可見逾時態；首幀到達或 lease/session 變更時清除。
  // viewer 未掛載（缺 trace carrier）時不得起這個計時器：那會把「iframe 根本沒被掛上」
  // 誤報成「串流已建立但未收到首幀」，把 operator 導去查 Kit / GPU。
  const activeLeaseIdForFirstFrame = activePrimaryLease && viewerTraceId ? activePrimaryLease.lease_id : null;
  useEffect(() => {
    if (!activeLeaseIdForFirstFrame || firstFrame) return;
    const timer = window.setTimeout(() => { setFirstFrameTimedOut(true); }, firstFrameTimeoutMs);
    return () => { window.clearTimeout(timer); };
  }, [activeLeaseIdForFirstFrame, firstFrame, firstFrameTimeoutMs]);
  useEffect(() => {
    if (firstFrame) {
      setFirstFrameTimedOut(false);
      setStreamDisconnected(false);
    }
  }, [firstFrame]);

  const claimPrimary = useCallback(async () => {
    if (!validSession || !viewerOrigin || !sessionObserved || modelArtifactStale || gpuUnavailable || leaseBusy) return;
    const identity = identityRef.current ?? createReviewViewerIdentity(mode);
    identityRef.current = identity;
    setLeaseBusy(true);
    setLeaseErr(null);
    setLeaseExpired(false);
    setFirstFrameTimedOut(false);
    setStreamDisconnected(false);
    setLease(null);
    setFirstFrame(false);
    setDataChannelReady(false);
    setLoadedStageUrl(null);
    setStageProofStatus("not_observed");
    setHighlightResult(null);
    setCommandTrace(null);
    try {
      const claimed = await coordinatorClient.claimViewerLease(sid, {
        viewer_id: identity.viewer_id,
        display_name: identity.display_name,
        requested_role: "primary",
        client_nonce: `${identity.viewer_id}:${sid}:primary`,
      }, identity.user_token);
      setLease(claimed);
    } catch (e) {
      setLeaseErr(classifyViewerLeaseError(e));
    } finally {
      setLeaseBusy(false);
    }
  }, [sid, validSession, viewerOrigin, sessionObserved, modelArtifactStale, gpuUnavailable, leaseBusy, mode]);

  const stageText = stageProofStatus === "unproven"
    ? t("unproven（coordinator authority 尚未證實；handoff 已阻擋）", "unproven (coordinator authority is not confirmed; handoff is blocked)")
    : !loadedStageUrl
    ? t("not_observed（尚未收到 viewer stage）", "not_observed (no viewer stage yet)")
    : !expectedStageUrl
      ? t("loaded（無 expected 可比對）", "loaded (no expected stage to compare)")
      : stageMatched
        ? t("matched（expected == loaded）", "matched (expected == loaded)")
        : t("mismatch（expected != loaded）", "mismatch (expected != loaded)");

  const highlightDisabledReason = !handoff.ifcGuid
    ? t("handoff 缺 ifc_guid，無法高亮", "handoff is missing ifc_guid")
    : !handoff.usdPrimPath
      ? `${t("缺 usd_prim_path / mapping，禁止高亮：", "missing usd_prim_path / mapping; highlight is blocked: ")}${mappingDiagnosticText(handoff)}`
      : mappingArtifactStale
        ? `mapping_reachable=false: ${artifactHealth?.stale_reason ?? "derived_artifact_unreachable"}`
      : !validSession
        ? t("尚未輸入有效 review session", "enter a valid review session first")
        : !sessionObserved
          ? t("runtime/status 未列出此 session（可能 stale / 已關閉）", "runtime/status does not list this session (possibly stale / closed)")
          : !activePrimaryLease
            ? t("需先手動啟動 / attach Kit session", "manually start / attach the Kit session first")
            : !firstFrame
              ? t("等待 3D 第一幀", "waiting for first frame")
              : !dataChannelReady
                ? t("等待 viewer DataChannel", "waiting for viewer DataChannel")
              : !stageMatched
                ? t("stage 未對齊，禁止誤標", "stage mismatch; highlight is blocked")
                : "";
  const canHighlight = highlightDisabledReason === "";

  const sendHighlight = useCallback(() => {
    if (!canHighlight || !handoff.ifcGuid) return;
    const clientRequestId = createHighlightCorrelationId();
    pendingHighlightRef.current = {
      clientRequestId,
      targetGeneration: highlightTargetGenerationRef.current,
      kind: "single",
    };
    setHighlightResult(null);
    const item: HighlightItem = {
      ifc_guid: handoff.ifcGuid,
      severity: handoff.severity ?? undefined,
      label: handoff.label ?? handoff.ifcGuid,
      rule_code: handoff.ruleCode,
    };
    viewerRef.current?.sendHighlight([item], clientRequestId);
    setCommandTrace(JSON.stringify({
      command: "highlight",
      source: mode,
      session_id: sid,
      rule_run_id: handoff.ruleRunId,
      ifc_guid: handoff.ifcGuid,
      usd_prim_path: handoff.usdPrimPath,
      client_request_id: clientRequestId,
      item,
    }, null, 2));
  }, [canHighlight, handoff, sid, mode]);

  // A2 批次疊加 gate：與單筆高亮共用同一組 viewer 證據條件，但不含 handoff 專屬欄位
  //（ifc_guid / usd_prim_path 由外部批次項目自帶；mapping 解析在送端與 viewer 端各自誠實計數）。
  const batchGateReason = mappingArtifactStale
    ? `mapping_reachable=false: ${artifactHealth?.stale_reason ?? "derived_artifact_unreachable"}`
    : !validSession
      ? t("尚未輸入有效 review session", "enter a valid review session first")
      : !sessionObserved
        ? t("runtime/status 未列出此 session（可能 stale / 已關閉）", "runtime/status does not list this session (possibly stale / closed)")
        : !activePrimaryLease
          ? t("需先手動啟動 / attach Kit session", "manually start / attach the Kit session first")
          : !firstFrame
            ? t("等待 3D 第一幀", "waiting for first frame")
            : !dataChannelReady
              ? t("等待 viewer DataChannel", "waiting for viewer DataChannel")
              : !stageMatched
                ? t("stage 未對齊，禁止誤標", "stage mismatch; highlight is blocked")
                : "";
  // callback 經 ref 讀最新值：gate 通知只隨 gate 內容變動觸發，不因外部 callback identity 變動重跑。
  const onBatchGateChangeRef = useRef(onBatchGateChange);
  onBatchGateChangeRef.current = onBatchGateChange;
  useEffect(() => {
    onBatchGateChangeRef.current?.({ canSend: batchGateReason === "", reason: batchGateReason });
  }, [batchGateReason]);
  const onBatchAckRef = useRef(onBatchAck);
  onBatchAckRef.current = onBatchAck;
  const batchGateReasonRef = useRef(batchGateReason);
  batchGateReasonRef.current = batchGateReason;
  const sidRef = useRef(sid);
  sidRef.current = sid;

  useImperativeHandle(ref, () => ({
    sendHighlightBatch(items: HighlightItem[]) {
      const reason = batchGateReasonRef.current;
      if (reason !== "") return { sent: false as const, reason };
      if (items.length === 0) {
        return { sent: false as const, reason: t("無可送出的構件（0 筆）", "no items to send (0 items)") };
      }
      const clientRequestId = createHighlightCorrelationId();
      pendingHighlightRef.current = {
        clientRequestId,
        targetGeneration: highlightTargetGenerationRef.current,
        kind: "batch",
      };
      setHighlightResult(null); // pending viewer ack（誠實：送出 ≠ 成功，等 viewer highlight_result）
      viewerRef.current?.sendHighlightBatch(items, clientRequestId);
      setCommandTrace(JSON.stringify({
        command: "highlight_batch",
        source: mode,
        session_id: sidRef.current,
        client_request_id: clientRequestId,
        item_count: items.length,
        items,
      }, null, 2));
      return { sent: true as const };
    },
    requestStageTree(primPath = "/World") {
      viewerRef.current?.requestStageTree(primPath);
    },
    selectPrim(primPath: string, multiSelect = false) {
      viewerRef.current?.selectPrim(primPath, multiSelect);
    },
    sendToolbarAction(action, cameraView) {
      viewerRef.current?.sendToolbarAction(action, cameraView);
    },
  }), [mode]);

  return (
    <>
      <Panel
        title={isA1Inline
          ? t("A1 3D 高亮 session", "A1 3D highlight session")
          : isA2Overlay
            ? t("A2 3D 疊加 session", "A2 3D overlay session")
            : isA3Inline
              ? t("A3 Federation 3D session", "A3 federation 3D session")
              : isA4Inline
                ? t("A4 語意查詢 3D session", "A4 semantic-search 3D session")
            : t("Review Room 3D session attach", "Review Room 3D session attach")}
        sub={isA1Inline
          ? t("在 A1 本頁啟動 Kit viewer lease、等待 first frame / DataChannel / stage match，然後直接送出高亮。", "Start the Kit viewer lease on A1, wait for first frame / DataChannel / stage match, then send highlight directly.")
          : isA2Overlay
            ? t("在 A2 本頁啟動 Kit viewer lease、等待 first frame / DataChannel / stage match，再由上方「套用疊加」送出 diff 構件批次。", "Start the Kit viewer lease on A2, wait for first frame / DataChannel / stage match, then send the diff element batch via the Apply overlay control above.")
            : isA3Inline
              ? t("在 A3 本頁掛載 federated stage；first frame / DataChannel / stage match 各自 fail-closed。後端未提供 element mapping / clash contract，因此不顯示假高亮。", "Mount the federated stage on A3; first frame / DataChannel / stage match each fail closed. The backend exposes no element mapping or clash contract, so no fake highlight is shown.")
              : isA4Inline
                ? t("在 A4 本頁掛載所選 Review Session；只有 first frame、DataChannel、stage match 與 viewer ACK 全部成立才宣告高亮成功。", "Mount the selected Review Session on A4; highlight succeeds only after first frame, DataChannel, stage match, and viewer ACK are all established.")
            : t("Kit / WebRTC / viewer lease 必須由本畫面手動啟動；A1 不自動啟動", "Kit / WebRTC / viewer lease must be started manually here; A1 does not auto-start it")}
        prov="asbuilt"
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <input
            className="ec-btn"
            data-testid={sessionInputTestId}
            list={sessionCandidatesId}
            style={{ flex: "1 1 220px", minWidth: 0, maxWidth: "100%" }}
            placeholder={t("review_session_xxx 或 lwv_xxx", "review_session_xxx or lwv_xxx")}
            value={sessionId}
            onChange={(e) => {
              setSessionId(e.target.value);
              setLease(null);
              setLeaseErr(null);
              setFirstFrame(false);
              setDataChannelReady(false);
              setLoadedStageUrl(null);
              setStageProofStatus("not_observed");
              setHighlightResult(null);
              setCommandTrace(null);
            }}
          />
          <datalist id={sessionCandidatesId} data-testid={sessionCandidatesTestId}>
            {sessionCandidates.map((id) => <option key={id} value={id} />)}
          </datalist>
          <Btn
            primary
            data-testid={manualStartTestId}
            disabled={!validSession || !viewerOrigin || !sessionObserved || modelArtifactStale || gpuUnavailable || leaseBusy || Boolean(activePrimaryLease)}
            caption={!validSession ? t("需有效 session id", "valid session id required")
              : !viewerOrigin ? t("runtime/status 尚未提供 viewer 入口", "runtime/status has not provided a viewer entry")
              : !sessionObserved ? t("runtime/status 未列出此 session（可能 stale / 已關閉）", "runtime/status does not list this session (possibly stale / closed)")
              : modelArtifactStale ? `model_usdc_reachable=false: ${artifactHealth?.stale_reason ?? "derived_artifact_unreachable"}`
              : gpuUnavailable ? t("Kit runtime 不可用（instances 查詢失敗或無可用 instance）", "Kit runtime is unavailable (instances query failed or none available)")
              : activePrimaryLease ? t("已 attach primary viewer lease", "primary viewer lease attached")
              : t("POST /api/review-sessions/:id/viewer-leases/claim", "POST /api/review-sessions/:id/viewer-leases/claim")}
            onClick={() => { void claimPrimary(); }}
          >
            {leaseBusy
              ? t("啟動中...", "Starting...")
              : isA1Inline
                ? t("啟動 A1 3D Session", "Start A1 3D Session")
                : isA2Overlay
                  ? t("啟動 A2 3D Session", "Start A2 3D Session")
                  : isA3Inline
                    ? t("啟動 A3 3D Session", "Start A3 3D Session")
                    : isA4Inline
                      ? t("啟動 A4 3D Session", "Start A4 3D Session")
                  : t("手動啟動 / attach Kit session", "Start / attach Kit session")}
          </Btn>
          {!isA1Inline && (
            <a
              className={`ec-btn ${validSession ? "" : "disabled"}`}
              {...(viewerOpenUrl ? { href: viewerOpenUrl, target: "_blank", rel: "noreferrer" } : { tabIndex: -1 })}
              style={viewerOpenUrl ? undefined : { pointerEvents: "none", opacity: 0.45 }}
              aria-disabled={!viewerOpenUrl}
            >
              {t("另開 viewer /ui/open", "Open viewer /ui/open")}
            </a>
          )}
        </div>
        <div
          className="ec-grid"
          data-testid={runtimeEvidenceTestId}
          role="status"
          aria-live="polite"
          style={{ marginBottom: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))" }}
        >
          <Field k="session" v={sid || "—"} prov={validSession ? "asbuilt" : "p1"} />
          <Field k="runtime session" v={!sid ? "—" : sessionObserved ? t("observed", "observed") : t("not_listed（可能 stale / 已關閉）", "not_listed (possibly stale / closed)")} prov={sessionObserved ? "asbuilt" : "p1"} />
          <Field k="primary lease" v={activePrimaryLease ? activePrimaryLease.lease_id : t("not_started（需手動）", "not_started (manual action required)")} prov={activePrimaryLease ? "asbuilt" : "p1"} />
          <Field k="first frame" v={firstFrame ? t("observed", "observed") : t("not_observed", "not_observed")} prov={firstFrame ? "asbuilt" : "p1"} />
          <Field k="DataChannel ready" v={dataChannelReady ? t("observed", "observed") : t("not_observed", "not_observed")} prov={dataChannelReady ? "asbuilt" : "p1"} />
          <Field k="stage truth" v={stageText} prov={stageMatched ? "asbuilt" : "p1"} />
          <Field k="artifact health" v={artifactHealthSummary} prov={artifactHealth && !modelArtifactStale && !mappingArtifactStale ? "asbuilt" : "p1"} />
          <Field k="highlight ack" v={!commandTrace ? t("not_sent", "not_sent") : highlightResult ? highlightResultText(highlightResult) : t("pending viewer ack", "pending viewer ack")} prov={highlightResult?.ok ? "asbuilt" : "p1"} />
          <Field k="kit_instance_id" v={activePrimaryLease?.kit_instance_id ?? "—"} prov={activePrimaryLease?.kit_instance_id ? "asbuilt" : "p1"} />
        </div>
        {runtimeErr && <p className="ec-warn-note" data-testid="review-room-runtime-error">{runtimeErr}</p>}
        {conversionPreparing && (
          <p className="ec-note" data-testid={`${tidPrefix}-session-preparing`}>
            {t("此 session 的模型轉檔尚未完成（conversion status: ", "This session's model conversion is not finished yet (conversion status: ")}
            {runtimeSession?.conversion_status}
            {t("）；請至 Pipeline 追蹤。", "); track it on the Pipeline page. ")}{" "}
            <a href="#pipeline">{t("前往 Pipeline", "Go to Pipeline")}</a>
          </p>
        )}
        {gpuUnavailable && (
          <div className="ec-warn-note" data-testid={`${tidPrefix}-gpu-unavailable`} role="alert" aria-live="assertive">
            <span>
              {t(
                "Kit runtime 不可用（kit-manager instances 查詢失敗或無可用 instance）；啟動已誠實停用。",
                "Kit runtime is unavailable (the kit-manager instances query failed or no instance is available); start is honestly disabled.",
              )}
            </span>{" "}
            <a href="#runtime">{t("檢視 Runtime", "Inspect Runtime")}</a>
          </div>
        )}
        {leaseExpired && (
          <div className="ec-warn-note" data-testid={`${tidPrefix}-lease-expired`} role="alert" aria-live="assertive">
            <span>
              {t(
                "viewer lease 已過期（heartbeat 遭 coordinator 拒絕）；不會自動搶佔，請手動重新 claim。",
                "The viewer lease has expired (the coordinator rejected the heartbeat); nothing is auto-reclaimed - re-claim manually.",
              )}
            </span>{" "}
            <Btn data-testid={`${tidPrefix}-lease-reclaim`} disabled={leaseBusy} onClick={() => { void claimPrimary(); }}>
              {leaseBusy ? t("重新 claim 中...", "Re-claiming...") : t("重新 claim", "Re-claim")}
            </Btn>
          </div>
        )}
        {firstFrameTimedOut && !firstFrame && (
          <div className="ec-warn-note" data-testid={`${tidPrefix}-first-frame-timeout`} role="alert" aria-live="assertive">
            <span>
              {t(
                "串流已建立但期限內未收到首幀；可重試啟動，或至 Runtime 檢視 Kit 診斷。",
                "The stream is established but no first frame arrived within the deadline; retry the start or inspect Kit diagnostics on Runtime.",
              )}
            </span>{" "}
            <Btn data-testid={`${tidPrefix}-first-frame-retry`} disabled={leaseBusy} onClick={() => { void claimPrimary(); }}>
              {leaseBusy ? t("重試中...", "Retrying...") : t("重試", "Retry")}
            </Btn>{" "}
            <a href="#runtime">{t("檢視 Runtime", "Inspect Runtime")}</a>
          </div>
        )}
        {streamDisconnected && (
          <div className="ec-warn-note" data-testid={`${tidPrefix}-stream-disconnected`} role="alert" aria-live="assertive">
            <span>
              {t(
                "串流中斷（WebRTC 連線已終止）；viewer 端保留最後畫格與診斷。可重新連線（重掛 viewer）。",
                "The stream disconnected (the WebRTC connection terminated); the viewer keeps the last frame and diagnostics. Reconnect to remount the viewer.",
              )}
            </span>{" "}
            <Btn
              data-testid={`${tidPrefix}-stream-reconnect`}
              onClick={() => {
                setStreamDisconnected(false);
                setViewerMountNonce((nonce) => nonce + 1);
              }}
            >
              {t("重新連線", "Reconnect")}
            </Btn>
          </div>
        )}
        {sid === "" && (
          <p className="ec-note" data-testid={`${tidPrefix}-no-session`}>
            {t(
              "尚未附掛 review session；請由上方欄位選擇或輸入 session id。",
              "No review session is attached; pick or enter a session id in the field above.",
            )}
          </p>
        )}
        {runtimeReady && !runtimeErr && !viewerOrigin && (
          <div
            className="ec-warn-note"
            data-testid={viewerOriginMissingTestId}
            role="alert"
            aria-live="assertive"
          >
            <span>
              {t(
                "runtime/status 無 viewer 入口（viewer origin 未配置），無法掛載 viewer。",
                "runtime/status has no viewer entry (viewer origin is not configured); the viewer cannot mount.",
              )}
            </span>{" "}
            <Btn
              data-testid={`${tidPrefix}-viewer-origin-refresh`}
              onClick={() => { void refreshRuntimeStatus(); }}
            >
              {t("重新整理 runtime status", "Refresh runtime status")}
            </Btn>
          </div>
        )}
        {leaseErr?.kind === "primary_occupied" ? (
          <div
            className="ec-warn-note"
            data-testid={`${tidPrefix}-lease-occupied`}
            role="alert"
            aria-live="assertive"
          >
            <span>
              {t(
                "Primary viewer lease 已被另一位操作員占用；不會顯示持有者資訊。請稍後重新嘗試。",
                "The primary viewer lease is occupied by another operator. Holder details stay private; retry later.",
              )}
            </span>{" "}
            <Btn
              data-testid={`${tidPrefix}-lease-retry`}
              disabled={leaseBusy}
              onClick={() => { void claimPrimary(); }}
            >
              {leaseBusy ? t("重試中...", "Retrying...") : t("重新嘗試", "Retry")}
            </Btn>
          </div>
        ) : leaseErr ? (
          <p className="ec-warn-note" data-testid="review-room-lease-error">{leaseErr.message}</p>
        ) : null}
        {!activePrimaryLease ? (
          <p className="ec-note" data-testid={kitNotStartedTestId}>
            {isA1Inline
              ? t("尚未啟動 A1 3D session。按上方按鈕後會在本頁掛載 viewer。", "A1 3D session is not started. Use the button above to mount the viewer on this page.")
              : isA2Overlay
                ? t("尚未啟動 A2 3D session。按上方按鈕掛載 viewer 後，「套用疊加」才會 enable。", "A2 3D session is not started. Mount the viewer with the button above; Apply overlay enables afterwards.")
                : isA3Inline
                  ? t("尚未啟動 A3 3D session；federated stage 與串流證據尚未觀測。", "A3 3D session is not started; the federated stage and streaming evidence are not observed.")
                  : isA4Inline
                    ? t("尚未啟動 A4 3D session；高亮維持封鎖。", "A4 3D session is not started; highlight remains blocked.")
                : t("尚未啟動 3D session。這裡不做自動 claim；請按手動啟動後才會掛載 viewer。", "3D session is not started. This page does not auto-claim; the viewer mounts only after manual start.")}
          </p>
        ) : viewerOrigin && !viewerTraceId ? (
          <p className="ec-warn-note" data-testid={`${tidPrefix}-viewer-trace-missing`} role="alert" aria-live="assertive">
            {t(
              "尚未取得此 session 的 structured-log trace carrier，viewer 不會掛載（掛了也只會是白畫面）。",
              "The structured-log trace carrier for this session is not available; the viewer is not mounted (it would only render blank).",
            )}
            {viewerTraceErr ? `（${viewerTraceErr}）` : null}
          </p>
        ) : viewerOrigin ? (
          <div data-testid={viewerHostTestId} style={{ height: 480 }}>
            <EmbeddedViewer
              ref={viewerRef}
              key={`${sid}:${activePrimaryLease.lease_id}:${viewerMountNonce}`}
              sessionId={sid}
              viewerOrigin={viewerOrigin}
              coordinatorApiBase={coordinatorBase}
              coordinatorSocketUrl={coordinatorBase}
              streamRole="primary"
              kitInstanceId={activePrimaryLease.kit_instance_id}
              userId={activePrimaryLease.user_id}
              displayName={activePrimaryLease.display_name}
              sourceClientId={activePrimaryLease.lease_id}
              traceId={viewerTraceId}
              viewerLeaseToken={activePrimaryLease.lease_token}
              userToken={identityRef.current?.user_token}
              onFirstFrame={() => {
                setFirstFrame(true);
                setDataChannelReady(true);
                void coordinatorClient.viewerLeaseHeartbeat(sid, activePrimaryLease.lease_id, activePrimaryLease.lease_token, {
                  first_frame: true,
                  datachannel_ready: true,
                }).catch(() => {});
                void coordinatorClient.reportFirstFrame(sid).catch(() => {});
              }}
              onStageLoaded={(message) => {
                setDataChannelReady(true);
                const activeUrl = message.status === "active" ? message.stageUrl : null;
                setLoadedStageUrl(activeUrl);
                setStageProofStatus(message.status);
                void coordinatorClient.viewerLeaseHeartbeat(sid, activePrimaryLease.lease_id, activePrimaryLease.lease_token, {
                  loaded_stage_url: activeUrl,
                  datachannel_ready: true,
                }).catch(() => {});
              }}
              onStreamState={(message) => {
                if (message.state !== "disconnected") return;
                // 失敗態矩陣 stream-disconnected（task 5.6 slice-3）：誠實回退所有
                // streaming 證據——不再顯示已中斷連線的 first frame / DataChannel /
                // stage 狀態，highlight gate 立即回封鎖。
                setStreamDisconnected(true);
                setFirstFrame(false);
                setDataChannelReady(false);
                setLoadedStageUrl(null);
                setStageProofStatus("not_observed");
                setHighlightResult(null);
              }}
              onHighlightResult={(m) => {
                const pending = pendingHighlightRef.current;
                if (
                  !pending
                  || pending.targetGeneration !== highlightTargetGenerationRef.current
                  || m.clientRequestId !== pending.clientRequestId
                ) return;
                pendingHighlightRef.current = null;
                setHighlightResult({ ok: m.ok, reason: m.reason });
                // 批次 ack 只在本次指令與當前目標均吻合時透傳；舊指令不得污染新選取列。
                if (pending.kind === "batch") onBatchAckRef.current?.(m);
              }}
              onStageTree={onStageTree}
            />
          </div>
        ) : null /* origin-missing 態改由上方常駐 note（含 refresh 動作）呈現，避免 testid 重複 */}
      </Panel>

      {/* a2-overlay 模式抑制單筆 handoff 高亮面板：A2 疊加控制（apply/ack/unmapped）由 VersionDiffPage
          自帶（a2-overlay-* testids）；此面板的單筆 ifc_guid 語意對 diff 批次不適用，顯示會誤導。 */}
      {showHandoffActions && !isA2Overlay && reviewRoomHandoffHasPayload(handoff) && (
        <Panel
          title={isA1Inline
            ? t("A1 高亮目標", "A1 highlight target")
            : isA4Inline
              ? t("A4 高亮目標", "A4 highlight target")
              : t("A1 handoff", "A1 handoff")}
          sub={isA1Inline
            ? t("從治理檢核結果帶入的失敗構件；高亮由 A1 本頁 viewer 送出。", "Failed element from the governance result; highlight is sent by the A1 inline viewer.")
            : isA4Inline
              ? t("從 A4 真實查詢結果帶入的構件；mapping 缺失時維持 unmapped，viewer ACK 前不宣告成功。", "Element from the real A4 query result; missing mapping remains unmapped, and success is not declared before viewer ACK.")
            : t("從治理檢核結果帶入的第一筆失敗構件；只有 Review Room 可送 3D highlight", "First failed element handed off from governance results; only Review Room can send 3D highlight")}
          prov="asbuilt"
        >
          <div
            className="ec-grid"
            data-testid={handoffSummaryTestId}
            style={{ marginBottom: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))" }}
          >
            <Field k="source" v={handoff.source ?? "—"} prov="asbuilt" />
            <Field k="rule_run_id" v={handoff.ruleRunId ?? "—"} prov="asbuilt" />
            <Field k="ifc_guid" v={handoff.ifcGuid ?? "—"} prov={handoff.ifcGuid ? "asbuilt" : "p1"} />
            <Field k="usd_prim_path" v={handoff.usdPrimPath ?? "—"} prov={handoff.usdPrimPath ? "asbuilt" : "p1"} />
            <Field k="rule_code" v={handoff.ruleCode ?? "—"} prov="asbuilt" />
            <Field k="mapping_status" v={handoff.usdPrimPath ? t("mapped", "mapped") : mappingDiagnosticText(handoff)} prov={handoff.usdPrimPath ? "asbuilt" : "p1"} />
          </div>
          <Btn data-testid={highlightButtonTestId} disabled={!canHighlight} caption={canHighlight ? t("postMessage highlight -> viewer DataChannel", "postMessage highlight -> viewer DataChannel") : highlightDisabledReason} onClick={sendHighlight}>
            {isA1Inline
              ? t("在 A1 3D 中標示", "Highlight in A1 3D")
              : isA4Inline
                ? t("在 A4 3D 中標示", "Highlight in A4 3D")
                : t("在 3D 高亮 handoff 構件", "Highlight handoff element in 3D")}
          </Btn>
          <span className="ec-note" data-testid={highlightReasonTestId} style={{ marginLeft: 8 }}>
            {highlightResult ? highlightResultText(highlightResult) : (canHighlight ? t("可送出", "ready to send") : highlightDisabledReason)}
          </span>
          {commandTrace && <pre className="ec-note" data-testid={commandTraceTestId} style={{ whiteSpace: "pre-wrap" }}>{commandTrace}</pre>}
        </Panel>
      )}
    </>
  );
});
