import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, Field, Panel } from "./components";
import { coordinatorClient, type RuntimeSessionSummary, type ViewerLeaseClaimResponse } from "./coordinatorClient";
import { EmbeddedViewer, type EmbeddedViewerHandle, type HighlightItem } from "./EmbeddedViewer";
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

function createReviewViewerIdentity(): { viewer_id: string; user_id: string; display_name: string } {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    viewer_id: `review_room_viewer_${random}`,
    user_id: `review_room_operator_${random}`,
    display_name: "Review Room primary viewer",
  };
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

export function ReviewSessionViewerPane({ handoff = parseReviewRoomHandoff() }: { handoff?: ReviewRoomHandoff }) {
  const [sessionId, setSessionId] = useState(handoff.sessionId);
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeSessionSummary[]>([]);
  const [viewerOrigin, setViewerOrigin] = useState<string | null>(null);
  const [coordinatorBase, setCoordinatorBase] = useState<string | null>(null);
  const [runtimeErr, setRuntimeErr] = useState<string | null>(null);
  const [lease, setLease] = useState<ViewerLeaseClaimResponse | null>(null);
  const [leaseBusy, setLeaseBusy] = useState(false);
  const [leaseErr, setLeaseErr] = useState<string | null>(null);
  const [firstFrame, setFirstFrame] = useState(false);
  const [dataChannelReady, setDataChannelReady] = useState(false);
  const [loadedStageUrl, setLoadedStageUrl] = useState<string | null>(null);
  const [highlightResult, setHighlightResult] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [commandTrace, setCommandTrace] = useState<string | null>(null);
  const identityRef = useRef<{ viewer_id: string; user_id: string; display_name: string } | null>(null);
  const viewerRef = useRef<EmbeddedViewerHandle>(null);
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
    const identity = identityRef.current ?? createReviewViewerIdentity();
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
      });
      setLease(claimed);
    } catch (e) {
      setLeaseErr(String(e));
    } finally {
      setLeaseBusy(false);
    }
  }, [sid, validSession, viewerOrigin, sessionObserved, modelArtifactStale, leaseBusy]);

  const stageText = !loadedStageUrl
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
      source: "review-room",
      session_id: sid,
      rule_run_id: handoff.ruleRunId,
      ifc_guid: handoff.ifcGuid,
      usd_prim_path: handoff.usdPrimPath,
      item,
    }, null, 2));
  }, [canHighlight, handoff, sid]);

  return (
    <>
      <Panel title={t("Review Room 3D session attach", "Review Room 3D session attach")} sub={t("Kit / WebRTC / viewer lease 必須由本畫面手動啟動；A1 不自動啟動", "Kit / WebRTC / viewer lease must be started manually here; A1 does not auto-start it")} prov="asbuilt">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <input
            className="ec-btn"
            data-testid="review-room-session-input"
            list="review-room-session-candidates"
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
          <datalist id="review-room-session-candidates" data-testid="review-room-session-candidates">
            {sessionCandidates.map((id) => <option key={id} value={id} />)}
          </datalist>
          <Btn
            primary
            data-testid="review-room-manual-start"
            disabled={!validSession || !viewerOrigin || !sessionObserved || modelArtifactStale || leaseBusy || Boolean(activePrimaryLease)}
            caption={!validSession ? t("需有效 session id", "valid session id required")
              : !viewerOrigin ? t("runtime/status 尚未提供 viewer 入口", "runtime/status has not provided a viewer entry")
              : !sessionObserved ? t("runtime/status 未列出此 session（可能 stale / 已關閉）", "runtime/status does not list this session (possibly stale / closed)")
              : modelArtifactStale ? `model_usdc_reachable=false: ${artifactHealth?.stale_reason ?? "derived_artifact_unreachable"}`
              : activePrimaryLease ? t("已 attach primary viewer lease", "primary viewer lease attached")
              : t("POST /api/review-sessions/:id/viewer-leases/claim", "POST /api/review-sessions/:id/viewer-leases/claim")}
            onClick={() => { void claimPrimary(); }}
          >
            {leaseBusy ? t("啟動中...", "Starting...") : t("手動啟動 / attach Kit session", "Start / attach Kit session")}
          </Btn>
          <a
            className={`ec-btn ${validSession ? "" : "disabled"}`}
            {...(viewerOpenUrl ? { href: viewerOpenUrl, target: "_blank", rel: "noreferrer" } : { tabIndex: -1 })}
            style={viewerOpenUrl ? undefined : { pointerEvents: "none", opacity: 0.45 }}
            aria-disabled={!viewerOpenUrl}
          >
            {t("另開 viewer /ui/open", "Open viewer /ui/open")}
          </a>
        </div>
        <div
          className="ec-grid"
          data-testid="review-room-runtime-evidence"
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
        {leaseErr && <p className="ec-warn-note" data-testid="review-room-lease-error">{leaseErr}</p>}
        {!activePrimaryLease ? (
          <p className="ec-note" data-testid="review-room-kit-not-started">
            {t("尚未啟動 3D session。這裡不做自動 claim；請按手動啟動後才會掛載 viewer。", "3D session is not started. This page does not auto-claim; the viewer mounts only after manual start.")}
          </p>
        ) : viewerOrigin ? (
          <div data-testid="review-room-viewer-host" style={{ height: 480 }}>
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
              onFirstFrame={(m) => {
                setFirstFrame(true);
                setDataChannelReady(true);
                if (m.stageUrl) setLoadedStageUrl(m.stageUrl);
                void coordinatorClient.viewerLeaseHeartbeat(sid, activePrimaryLease.lease_id, activePrimaryLease.lease_token, {
                  first_frame: true,
                  loaded_stage_url: m.stageUrl,
                  datachannel_ready: true,
                }).catch(() => {});
                void coordinatorClient.reportFirstFrame(sid).catch(() => {});
              }}
              onStageLoaded={(u) => {
                setDataChannelReady(true);
                if (u) setLoadedStageUrl(u);
                void coordinatorClient.viewerLeaseHeartbeat(sid, activePrimaryLease.lease_id, activePrimaryLease.lease_token, {
                  ...(u ? { loaded_stage_url: u } : {}),
                  datachannel_ready: true,
                }).catch(() => {});
              }}
              onHighlightResult={(m) => setHighlightResult({ ok: m.ok, reason: m.reason })}
            />
          </div>
        ) : (
          <p className="ec-warn-note" data-testid="review-room-viewer-origin-missing">{t("runtime/status 無 viewer 入口，無法掛載 viewer", "runtime/status has no viewer entry; cannot mount viewer")}</p>
        )}
      </Panel>

      {reviewRoomHandoffHasPayload(handoff) && (
        <Panel title={t("A1 handoff", "A1 handoff")} sub={t("從治理檢核結果帶入的第一筆失敗構件；只有 Review Room 可送 3D highlight", "First failed element handed off from governance results; only Review Room can send 3D highlight")} prov="asbuilt">
          <div
            className="ec-grid"
            data-testid="review-room-handoff-summary"
            style={{ marginBottom: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))" }}
          >
            <Field k="source" v={handoff.source ?? "—"} prov="asbuilt" />
            <Field k="rule_run_id" v={handoff.ruleRunId ?? "—"} prov="asbuilt" />
            <Field k="ifc_guid" v={handoff.ifcGuid ?? "—"} prov={handoff.ifcGuid ? "asbuilt" : "p1"} />
            <Field k="usd_prim_path" v={handoff.usdPrimPath ?? "—"} prov={handoff.usdPrimPath ? "asbuilt" : "p1"} />
            <Field k="rule_code" v={handoff.ruleCode ?? "—"} prov="asbuilt" />
            <Field k="mapping_status" v={handoff.usdPrimPath ? t("mapped", "mapped") : mappingDiagnosticText(handoff)} prov={handoff.usdPrimPath ? "asbuilt" : "p1"} />
          </div>
          <Btn data-testid="review-room-highlight" disabled={!canHighlight} caption={canHighlight ? t("postMessage highlight -> viewer DataChannel", "postMessage highlight -> viewer DataChannel") : highlightDisabledReason} onClick={sendHighlight}>
            {t("在 3D 高亮 handoff 構件", "Highlight handoff element in 3D")}
          </Btn>
          <span className="ec-note" data-testid="review-room-highlight-reason" style={{ marginLeft: 8 }}>
            {highlightResult ? highlightResultText(highlightResult) : (canHighlight ? t("可送出", "ready to send") : highlightDisabledReason)}
          </span>
          {commandTrace && <pre className="ec-note" data-testid="review-room-command-trace" style={{ whiteSpace: "pre-wrap" }}>{commandTrace}</pre>}
        </Panel>
      )}
    </>
  );
}
