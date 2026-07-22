import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Btn, Field, Panel } from "./components";
import { coordinatorClient, type RuntimeSessionSummary, type ViewerLeaseClaimResponse } from "./coordinatorClient";
import { EmbeddedViewer, type EmbeddedViewerHandle, type HighlightItem, type HighlightResultMessage } from "./EmbeddedViewer";
import { t } from "./i18n";
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
type ReviewSessionViewerPaneMode = "review-room" | "a1-inline" | "a2-overlay";

interface ReviewViewerIdentity {
  viewer_id: string;
  user_id: string;
  user_token: string;
  display_name: string;
}

function createReviewViewerIdentity(mode: ReviewSessionViewerPaneMode): ReviewViewerIdentity {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const prefix = mode === "a1-inline" ? "a1_inline" : mode === "a2-overlay" ? "a2_overlay" : "review_room";
  const userToken = `${prefix}_operator_${random}`;
  return {
    viewer_id: `${prefix}_viewer_${random}`,
    user_id: userToken,
    user_token: userToken,
    display_name: mode === "a1-inline"
      ? "A1 inline primary viewer"
      : mode === "a2-overlay"
        ? "A2 diff overlay primary viewer"
        : "Review Room primary viewer",
  };
}

// A2 批次疊加對外 handle：外部（VersionDiffPage）備好 HighlightItem 群組後經此送出。
// 送出前先過與單筆高亮相同的 viewer 證據 gate（session observed / lease / first frame /
// DataChannel / stage match）；gate 未過誠實回 { sent:false, reason }，絕不佯裝已送。
export interface ReviewSessionViewerPaneHandle {
  sendHighlightBatch(items: HighlightItem[]): { sent: true } | { sent: false; reason: string };
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
  // A2 批次疊加 gate 通知：viewer 證據鏈（lease/first frame/DataChannel/stage match）任一變動時回報，
  // 外部據以 enable/disable「套用疊加」鈕並顯示誠實理由。非 a2 用途可不傳（零行為變更）。
  onBatchGateChange?: (gate: ReviewSessionViewerPaneBatchGate) => void;
  // viewer highlight_result ack 透傳（含批次 ack 的 sent_count/unmapped_count 加性欄位）。
  onBatchAck?: (message: HighlightResultMessage) => void;
}

export const ReviewSessionViewerPane = forwardRef<ReviewSessionViewerPaneHandle, ReviewSessionViewerPaneProps>(
  function ReviewSessionViewerPane({ handoff = parseReviewRoomHandoff(), mode = "review-room", onBatchGateChange, onBatchAck }, ref) {
  const isA1Inline = mode === "a1-inline";
  const isA2Overlay = mode === "a2-overlay";
  // testid 前綴 = mode（review-room / a1-inline / a2-overlay），既有兩模式的 testid 逐字不變。
  const tidPrefix = mode;
  const [sessionId, setSessionId] = useState(handoff.sessionId);
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeSessionSummary[]>([]);
  const [viewerOrigin, setViewerOrigin] = useState<string | null>(null);
  const [coordinatorBase, setCoordinatorBase] = useState<string | null>(null);
  const [runtimeErr, setRuntimeErr] = useState<string | null>(null);
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
  const validSession = sessionIdIsValid(sid);
  const activePrimaryLease = lease && lease.session_id === sid && lease.role === "primary" && lease.status === "active" ? lease : null;
  const runtimeSession = runtimeSessions.find((s) => s.session_id === sid) ?? null;
  const sessionObserved = Boolean(runtimeSession);
  const artifactHealth = runtimeSession?.artifact_health ?? null;
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

  useEffect(() => {
    let alive = true;
    coordinatorClient.runtimeStatus()
      .then((rt) => {
        if (!alive) return;
        setRuntimeSessions(rt.sessions.items.filter((s) => s.status === "active" || s.status === "created"));
        setViewerOrigin(rt.configured_endpoints.viewer.browser_url_base || null);
        setCoordinatorBase(rt.configured_endpoints.coordinator.public_base_url || null);
        setRuntimeErr(null);
      })
      .catch((e) => {
        if (!alive) return;
        setRuntimeSessions([]);
        setViewerOrigin(null);
        setCoordinatorBase(null);
        setRuntimeErr(String(e));
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setSessionId(handoff.sessionId);
    setLease(null);
    setLeaseErr(null);
    setFirstFrame(false);
    setDataChannelReady(false);
    setLoadedStageUrl(null);
    setStageProofStatus("not_observed");
    setHighlightResult(null);
    setCommandTrace(null);
  }, [handoff.sessionId]);

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
    const heartbeatMs = Math.max(5000, activePrimaryLease.heartbeat_after_ms || 15000);
    const timer = window.setInterval(() => {
      void coordinatorClient.viewerLeaseHeartbeat(sid, activePrimaryLease.lease_id, activePrimaryLease.lease_token, {
        ...(loadedStageUrl ? { loaded_stage_url: loadedStageUrl } : {}),
        datachannel_ready: dataChannelReady,
      }).catch(() => {});
    }, heartbeatMs);
    return () => window.clearInterval(timer);
  }, [
    sid,
    activePrimaryLease?.lease_id,
    activePrimaryLease?.lease_token,
    activePrimaryLease?.heartbeat_after_ms,
    dataChannelReady,
    loadedStageUrl,
  ]);

  const claimPrimary = useCallback(async () => {
    if (!validSession || !viewerOrigin || !sessionObserved || modelArtifactStale || leaseBusy) return;
    const identity = identityRef.current ?? createReviewViewerIdentity(mode);
    identityRef.current = identity;
    setLeaseBusy(true);
    setLeaseErr(null);
    setLease(null);
    setFirstFrame(false);
    setDataChannelReady(false);
    setLoadedStageUrl(null);
    setHighlightResult(null);
    setCommandTrace(null);
    try {
      const claimed = await coordinatorClient.claimViewerLease(sid, {
        viewer_id: identity.viewer_id,
        user_id: identity.user_id,
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
  }, [sid, validSession, viewerOrigin, sessionObserved, modelArtifactStale, leaseBusy, mode]);

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
    setHighlightResult(null);
    const item: HighlightItem = {
      ifc_guid: handoff.ifcGuid,
      severity: handoff.severity ?? undefined,
      label: handoff.label ?? handoff.ifcGuid,
      rule_code: handoff.ruleCode,
    };
    viewerRef.current?.sendHighlight([item]);
    setCommandTrace(JSON.stringify({
      command: "highlight",
      source: mode,
      session_id: sid,
      rule_run_id: handoff.ruleRunId,
      ifc_guid: handoff.ifcGuid,
      usd_prim_path: handoff.usdPrimPath,
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
      setHighlightResult(null); // pending viewer ack（誠實：送出 ≠ 成功，等 viewer highlight_result）
      viewerRef.current?.sendHighlightBatch(items);
      setCommandTrace(JSON.stringify({
        command: "highlight_batch",
        source: mode,
        session_id: sidRef.current,
        item_count: items.length,
        items,
      }, null, 2));
      return { sent: true as const };
    },
  }), [mode]);

  return (
    <>
      <Panel
        title={isA1Inline
          ? t("A1 3D 高亮 session", "A1 3D highlight session")
          : isA2Overlay
            ? t("A2 3D 疊加 session", "A2 3D overlay session")
            : t("Review Room 3D session attach", "Review Room 3D session attach")}
        sub={isA1Inline
          ? t("在 A1 本頁啟動 Kit viewer lease、等待 first frame / DataChannel / stage match，然後直接送出高亮。", "Start the Kit viewer lease on A1, wait for first frame / DataChannel / stage match, then send highlight directly.")
          : isA2Overlay
            ? t("在 A2 本頁啟動 Kit viewer lease、等待 first frame / DataChannel / stage match，再由上方「套用疊加」送出 diff 構件批次。", "Start the Kit viewer lease on A2, wait for first frame / DataChannel / stage match, then send the diff element batch via the Apply overlay control above.")
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
            disabled={!validSession || !viewerOrigin || !sessionObserved || modelArtifactStale || leaseBusy || Boolean(activePrimaryLease)}
            caption={!validSession ? t("需有效 session id", "valid session id required")
              : !viewerOrigin ? t("runtime/status 尚未提供 viewer 入口", "runtime/status has not provided a viewer entry")
              : !sessionObserved ? t("runtime/status 未列出此 session（可能 stale / 已關閉）", "runtime/status does not list this session (possibly stale / closed)")
              : modelArtifactStale ? `model_usdc_reachable=false: ${artifactHealth?.stale_reason ?? "derived_artifact_unreachable"}`
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
                : t("尚未啟動 3D session。這裡不做自動 claim；請按手動啟動後才會掛載 viewer。", "3D session is not started. This page does not auto-claim; the viewer mounts only after manual start.")}
          </p>
        ) : viewerOrigin ? (
          <div data-testid={viewerHostTestId} style={{ height: 480 }}>
            <EmbeddedViewer
              ref={viewerRef}
              key={`${sid}:${activePrimaryLease.lease_id}`}
              sessionId={sid}
              viewerOrigin={viewerOrigin}
              coordinatorApiBase={coordinatorBase}
              coordinatorSocketUrl={coordinatorBase}
              streamRole="primary"
              kitInstanceId={activePrimaryLease.kit_instance_id}
              userId={activePrimaryLease.user_id}
              displayName={activePrimaryLease.display_name}
              sourceClientId={activePrimaryLease.lease_id}
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
                  ...(activeUrl ? { loaded_stage_url: activeUrl } : {}),
                  datachannel_ready: true,
                }).catch(() => {});
              }}
              onHighlightResult={(m) => {
                setHighlightResult({ ok: m.ok, reason: m.reason });
                // 批次 ack 透傳（A2）：含 sent_count/unmapped_count 加性欄位；單筆 ack 也原樣透傳。
                onBatchAckRef.current?.(m);
              }}
            />
          </div>
        ) : (
          <p className="ec-warn-note" data-testid={viewerOriginMissingTestId}>{t("runtime/status 無 viewer 入口，無法掛載 viewer", "runtime/status has no viewer entry; cannot mount viewer")}</p>
        )}
      </Panel>

      {/* a2-overlay 模式抑制單筆 handoff 高亮面板：A2 疊加控制（apply/ack/unmapped）由 VersionDiffPage
          自帶（a2-overlay-* testids）；此面板的單筆 ifc_guid 語意對 diff 批次不適用，顯示會誤導。 */}
      {!isA2Overlay && reviewRoomHandoffHasPayload(handoff) && (
        <Panel
          title={isA1Inline ? t("A1 高亮目標", "A1 highlight target") : t("A1 handoff", "A1 handoff")}
          sub={isA1Inline
            ? t("從治理檢核結果帶入的失敗構件；高亮由 A1 本頁 viewer 送出。", "Failed element from the governance result; highlight is sent by the A1 inline viewer.")
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
            {isA1Inline ? t("在 A1 3D 中標示", "Highlight in A1 3D") : t("在 3D 高亮 handoff 構件", "Highlight handoff element in 3D")}
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
