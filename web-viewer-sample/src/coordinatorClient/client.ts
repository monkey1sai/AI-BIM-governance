// Coordinator Browser Client (docs/architecture/coordinator-browser-client-adr.md): every call a console surface or the
// viewer makes to the coordinator's own routes. One transport, one error type, one timeout rule, one viewer-lease transport.
import type {
  ClaimViewerLeaseRequest,
  ClaimViewerLeaseResponse,
  HeartbeatViewerLeaseRequest,
  HeartbeatViewerLeaseResponse,
  QueuedForInstanceConflict,
  SessionActivityResponse,
  SessionIdleStatusResponse,
  StageBindingCancellationResponse,
  StageBindingPreauthorizationRequest,
} from "../contract/coordinatorApi";
import type { ReviewSession } from "../types/review";
import { parseA4HandoffIntent, parseA4ViewerLeaseStatus, type A4HandoffIntent, type A4ViewerLeaseStatus } from "../clients/a4Handoff";
import type { ViewerLeaseTransport } from "../clients/viewerCredentials";
import type { IssueRow, RuleRunHistoryResponse } from "../console/governanceClient";
import { CoordinatorHttpError, QueuedForInstanceError } from "./errors";
import { COORDINATOR_ROUTES as ROUTES, routePath } from "./routes";
import { createCoordinatorTransport, type CoordinatorTransportOptions } from "./transport";
import type {
  CallbackOutboxSummary,
  ClosedReviewSessionPage,
  ConversionControlResponse,
  ConversionQualityMetricsResponse,
  ConversionRecord,
  CoordinatorHealth,
  CreateReviewSessionRequest,
  CreateReviewSessionResponse,
  DevConversionRecord,
  DevConversionResult,
  IfcReadyJobDetail,
  IfcReadyListItem,
  IfcReadyReviewSessionResponse,
  IssueSnapshotResponse,
  KitHealth,
  KitInstanceState,
  LineageConversionReport,
  LineageConversionReportDifferences,
  LineageConversionReportList,
  LineageDifferenceSet,
  LineageReportFileName,
  MinioFolderListing,
  MinioObject,
  MinioWatchStatus,
  ReadyReviewIntent,
  ReadyReviewSessionResponse,
  RecreateReviewSessionResponse,
  RuntimeSessionSummary,
  RuntimeStatus,
  SessionCloseResponse,
  SessionIdlePolicy,
  SourceBundleLookupResponse,
  StageBindingCredentials,
  StageBindingPreauthorization,
  StageBindingRevisions,
  StreamConfigResponse,
  TriggerConversionResponse,
  ViewerLeaseClaimResponse,
  ViewerLeaseSummary,
} from "./types";

/**
 * Whether operator credentials may travel to this base: HTTPS, or HTTP to an exact loopback host.
 */
export function isSecureOperatorTransport(base: string): boolean {
  try {
    const url = new URL(base, window.location.origin);
    return url.protocol === "https:"
      || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isQueuedForInstanceResponse(value: unknown): value is QueuedForInstanceConflict {
  return isRecord(value) && value.status === "queued_for_instance" && Array.isArray(value.artifact_bindings);
}

function isStageArtifact(value: unknown, role: "primary" | "secondary"): boolean {
  return isRecord(value) && value.role === role && nonEmptyString(value.artifact_id) && nonEmptyString(value.usdc_url);
}

function isStageBindingPreauthorization(payload: unknown, sessionId: string): payload is StageBindingPreauthorization {
  if (!isRecord(payload) || !isRecord(payload.stage_composition)) return false;
  const { primary, secondary_layers: secondaryLayers } = payload.stage_composition;
  return payload.status === "pending"
    && payload.session_id === sessionId
    && nonEmptyString(payload.stage_binding_authorization_id)
    && nonEmptyString(payload.binding_revision_id)
    && nonEmptyString(payload.pending_expires_at)
    && isStageArtifact(primary, "primary")
    && Array.isArray(secondaryLayers)
    && secondaryLayers.every((artifact) => isStageArtifact(artifact, "secondary"));
}

/** A reply the coordinator answered with 2xx but in a shape this client cannot accept. */
function malformed(path: string, errorCode: string): CoordinatorHttpError {
  return new CoordinatorHttpError(path, 502, errorCode, errorCode);
}

function stageBindingHeaders(credentials: StageBindingCredentials): Record<string, string> {
  return { "X-User-Token": credentials.userToken, "X-Viewer-Lease-Token": credentials.leaseToken };
}

export function createCoordinatorClient(options: CoordinatorTransportOptions) {
  const transport = createCoordinatorTransport(options);
  const base = options.baseUrl;
  const client = {
    base,
    health: () => transport.request<CoordinatorHealth>(ROUTES.health, "/health"),
    runtimeStatus: () => transport.request<RuntimeStatus>(ROUTES.runtimeStatus, "/api/runtime/status"),
    listClosedReviewSessions: (limit = 20, cursor?: string) => {
      const params = new URLSearchParams({ status: "closed", limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      return transport.request<ClosedReviewSessionPage>(ROUTES.listClosedReviewSessions, routePath(ROUTES.listClosedReviewSessions, {}, params));
    },
    recreateReviewSession: (closedSessionId: string, idempotencyKey: string) =>
      transport.request<RecreateReviewSessionResponse>(
        ROUTES.recreateReviewSession,
        routePath(ROUTES.recreateReviewSession, { sessionId: closedSessionId }),
        { headers: { "Idempotency-Key": idempotencyKey } },
      ),
    kitInstanceCurrent: () => transport.request<KitInstanceState>(ROUTES.kitInstanceCurrent, "/api/kit/instances/current"),
    listIfcReady: (limit = 20) =>
      transport.request<{ count: number; items: IfcReadyListItem[] }>(ROUTES.listIfcReady, `/api/external/ifc-ready?limit=${limit}`),
    createReviewSessionForIfcReady: (jobId: string) =>
      transport.request<IfcReadyReviewSessionResponse>(ROUTES.createReviewSessionForIfcReady, routePath(ROUTES.createReviewSessionForIfcReady, { jobId })),
    minioWatchStatus: () => transport.request<MinioWatchStatus>(ROUTES.minioWatchStatus, "/api/external/minio-watch/status"),
    streamConfig: (sessionId: string) =>
      transport.request<StreamConfigResponse>(ROUTES.streamConfig, routePath(ROUTES.streamConfig, { sessionId })),
    conversionQualityMetrics: (conversionJobId: string) =>
      transport.request<ConversionQualityMetricsResponse>(ROUTES.conversionQualityMetrics, routePath(ROUTES.conversionQualityMetrics, { conversionJobId })),
    conversionPrioritize: (id: string, reason?: string) =>
      transport.request<ConversionControlResponse>(ROUTES.conversionPrioritize, routePath(ROUTES.conversionPrioritize, { ifcReadyJobId: id }), { body: { reason } }),
    conversionRetry: (id: string, reason?: string) =>
      transport.request<ConversionControlResponse>(ROUTES.conversionRetry, routePath(ROUTES.conversionRetry, { ifcReadyJobId: id }), { body: { reason } }),
    conversionWatchToggle: (enabled: boolean, reason?: string) =>
      transport.request<MinioWatchStatus>(ROUTES.conversionWatchToggle, "/api/conversion/watch", { body: { enabled, reason } }),
    // IX-SS-04: an operator ends a session with a cooperative close; the body carries only the reason (no final events).
    sessionClose: (sessionId: string, reason?: string) =>
      transport.request<SessionCloseResponse>(ROUTES.sessionClose, routePath(ROUTES.sessionClose, { sessionId }), { body: { reason } }),
    /** 409 `queued_for_instance` (no Kit capacity) is a `QueuedForInstanceError`; every other failure a `CoordinatorHttpError`. */
    createReviewSession: async (body: CreateReviewSessionRequest): Promise<CreateReviewSessionResponse> => {
      try {
        return await transport.request<CreateReviewSessionResponse>(ROUTES.createReviewSession, "/api/review-sessions", { body });
      } catch (error) {
        if (error instanceof CoordinatorHttpError && error.status === 409 && isQueuedForInstanceResponse(error.body)) {
          throw new QueuedForInstanceError("/api/review-sessions", error.body);
        }
        throw error;
      }
    },
    getReviewSession: (sessionId: string) =>
      transport.request<ReviewSession>(ROUTES.getReviewSession, routePath(ROUTES.getReviewSession, { sessionId })),
    claimViewerLease: (sessionId: string, body: ClaimViewerLeaseRequest, userToken: string) =>
      transport.request<ViewerLeaseClaimResponse & ClaimViewerLeaseResponse>(
        ROUTES.claimViewerLease,
        routePath(ROUTES.claimViewerLease, { sessionId }),
        { body, headers: { "X-User-Token": userToken } },
      ),
    viewerLeaseHeartbeat: (sessionId: string, leaseId: string, leaseToken: string, body: HeartbeatViewerLeaseRequest) =>
      transport.request<HeartbeatViewerLeaseResponse>(
        ROUTES.viewerLeaseHeartbeat,
        routePath(ROUTES.viewerLeaseHeartbeat, { sessionId, leaseId }),
        { body, headers: { "X-Viewer-Lease-Token": leaseToken } },
      ),
    // keepalive: release is often sent while the document unloads (pagehide); without it the request is cancelled (#851).
    releaseViewerLease: (sessionId: string, leaseId: string, leaseToken: string) =>
      transport.request<ViewerLeaseSummary>(
        ROUTES.releaseViewerLease,
        routePath(ROUTES.releaseViewerLease, { sessionId, leaseId }),
        { headers: { "X-Viewer-Lease-Token": leaseToken }, keepalive: true },
      ),
    /** The three lease calls as a `ViewerLeaseTransport`, resolved at call time so a spy on the client still applies. */
    viewerLeaseTransport: (): ViewerLeaseTransport => ({
      claim: (sessionId, body, userToken) => client.claimViewerLease(sessionId, body, userToken),
      heartbeat: (sessionId, leaseId, leaseToken, body) => client.viewerLeaseHeartbeat(sessionId, leaseId, leaseToken, body),
      release: (sessionId, leaseId, leaseToken) => client.releaseViewerLease(sessionId, leaseId, leaseToken),
    }),
    getA4ViewerLeaseStatus: async (sessionId: string, userToken: string, viewerLeaseToken: string): Promise<A4ViewerLeaseStatus> => {
      const path = routePath(ROUTES.getA4ViewerLeaseStatus, { sessionId });
      const payload = await transport.request<unknown>(ROUTES.getA4ViewerLeaseStatus, path, {
        headers: { "X-User-Token": userToken, "X-Viewer-Lease-Token": viewerLeaseToken },
      });
      const parsed = parseA4ViewerLeaseStatus(payload, sessionId);
      if (!parsed) throw malformed(path, "viewer_lease_status_malformed");
      return parsed;
    },
    /** The active and last successful stage binding revisions (null when none); needs only the user token. */
    getStageBindingRevisions: async (sessionId: string, userToken: string): Promise<StageBindingRevisions> => {
      const path = routePath(ROUTES.getStageBindingRevisions, { sessionId });
      const payload = await transport.request<unknown>(ROUTES.getStageBindingRevisions, path, { headers: { "X-User-Token": userToken } });
      if (!isRecord(payload) || !isRecord(payload.stage_binding)) throw malformed(path, "viewer_lease_status_malformed");
      const { active_binding_revision: active, last_good_binding_revision: lastGood } = payload.stage_binding;
      return { active: nonEmptyString(active) ? active : null, lastGood: nonEmptyString(lastGood) ? lastGood : null };
    },
    preauthorizeStageBinding: async (
      sessionId: string,
      body: StageBindingPreauthorizationRequest,
      credentials: StageBindingCredentials,
      signal?: AbortSignal,
    ): Promise<StageBindingPreauthorization> => {
      const path = routePath(ROUTES.preauthorizeStageBinding, { sessionId });
      const payload = await transport.request<unknown>(ROUTES.preauthorizeStageBinding, path, {
        body, headers: stageBindingHeaders(credentials), signal,
      });
      if (!isStageBindingPreauthorization(payload, sessionId)) throw malformed(path, "stage_binding_preauthorization_malformed");
      return payload;
    },
    cancelStageBinding: (
      sessionId: string,
      body: { source_client_id: string; client_request_id: string },
      credentials: StageBindingCredentials,
      signal?: AbortSignal,
    ) =>
      transport.request<StageBindingCancellationResponse>(
        ROUTES.cancelStageBinding,
        routePath(ROUTES.cancelStageBinding, { sessionId }),
        { body, headers: stageBindingHeaders(credentials), signal },
      ),
    recordSessionActivity: (sessionId: string, leaseId: string, leaseToken: string) =>
      transport.request<SessionActivityResponse>(
        ROUTES.recordSessionActivity,
        routePath(ROUTES.recordSessionActivity, { sessionId }),
        { body: { lease_id: leaseId }, headers: { "X-Viewer-Lease-Token": leaseToken } },
      ),
    // VG-01: the active review sessions come from /api/runtime/status (there is no bare GET /api/review-sessions list).
    listReviewSessions: async (): Promise<{ items: RuntimeSessionSummary[] }> => {
      const runtime = await transport.request<RuntimeStatus>(ROUTES.listReviewSessions, "/api/runtime/status");
      return { items: runtime.sessions.items };
    },
    // VG-01: the console forwards the viewer's first frame; the viewer itself never calls the coordinator for it.
    reportFirstFrame: (sessionId: string, endpointId?: string) =>
      transport.request<{ session_id: string; first_frame_at: string }>(
        ROUTES.reportFirstFrame,
        routePath(ROUTES.reportFirstFrame, { sessionId }),
        { body: { endpoint_id: endpointId } },
      ),
    // The coordinator redirects this to the browser-visible viewer URL.
    openInViewerUrl: (sessionId: string) => `${base}/ui/open?session=${encodeURIComponent(sessionId)}`,
    createA4Handoff: (sessionId: string, body: { action: "focus" | "highlight"; evidence_proofs: string[] }, userToken: string) =>
      transport.request<{
        handoff_id: string;
        url: string;
        expires_at: string;
        action: "focus" | "highlight";
        prim_paths: string[];
        binding: unknown;
      }>(ROUTES.createA4Handoff, routePath(ROUTES.createA4Handoff, { sessionId }), { body, headers: { "X-User-Token": userToken } }),
    consumeA4Handoff: async (sessionId: string, handoffId: string, userToken: string, viewerLeaseToken: string): Promise<A4HandoffIntent> => {
      const path = routePath(ROUTES.consumeA4Handoff, { sessionId, handoffId });
      const payload = await transport.request<unknown>(ROUTES.consumeA4Handoff, path, {
        headers: { "X-User-Token": userToken, "X-Viewer-Lease-Token": viewerLeaseToken },
      });
      const parsed = parseA4HandoffIntent(payload, handoffId);
      if (!parsed) throw malformed(path, "a4_handoff_response_malformed");
      return parsed;
    },
    getConversionRecords: (limit = 50) =>
      transport.request<{ count: number; items: ConversionRecord[] }>(ROUTES.getConversionRecords, `/api/conversion/records?limit=${limit}`),
    getObjectConversionHistory: (key: string, sourceId: string) =>
      transport.request<{ count: number; items: ConversionRecord[] }>(
        ROUTES.getObjectConversionHistory,
        `/api/conversion/records?limit=100&object_key=${encodeURIComponent(key)}&source_id=${encodeURIComponent(sourceId)}`,
      ),
    reconvertIfc: (key: string, requestId: string, expectedEtag: string) =>
      transport.request<{ ready_model_id: string; status?: string; conversion_job_id?: string | null; intent_replay: boolean }>(
        ROUTES.reconvertIfc,
        "/api/conversion/trigger",
        { body: { key, force_retrigger: true, request_id: requestId, expected_etag: expectedEtag } },
      ),
    readyReviewSession: (readyModelId: string, intent: ReadyReviewIntent) =>
      transport.request<ReadyReviewSessionResponse>(ROUTES.readyReviewSession, routePath(ROUTES.readyReviewSession, { readyModelId }), { body: intent }),
    // Read-only S3 list proxy; without a prefix the coordinator lists its configured watch prefix.
    getMinioObjects: (prefix?: string) =>
      transport.request<{ bucket: string | null; count: number; objects: MinioObject[] }>(
        ROUTES.getMinioObjects,
        `/api/minio/objects${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""}`,
      ),
    minioEventsUrl: () => `${base}/api/minio/events`,
    // Folder listing (delimiter=/ is sent percent-encoded as %2F, which some proxies need).
    getMinioFolder: (prefix?: string, listing?: { refresh?: boolean }): Promise<MinioFolderListing> => {
      const params = new URLSearchParams({ delimiter: "/" });
      if (prefix) params.set("prefix", prefix);
      if (listing?.refresh) params.set("refresh", "1");
      return transport.request<MinioFolderListing>(ROUTES.getMinioFolder, routePath(ROUTES.getMinioFolder, {}, params));
    },
    // Governed lineage: find the accepted source bundles of a MinIO IFC object (URLSearchParams encodes + as %2B).
    lookupLineageSourceBundles: (bucket: string, key: string, etag: string) => {
      const params = new URLSearchParams({ source_ifc_bucket: bucket, source_ifc_key: key, source_ifc_etag: etag });
      return transport.request<SourceBundleLookupResponse>(ROUTES.lookupLineageSourceBundles, routePath(ROUTES.lookupLineageSourceBundles, {}, params));
    },
    listLineageConversionReports: (filter: { sourceIfcKey?: string; limit?: number } = {}) => {
      const params = new URLSearchParams();
      if (filter.sourceIfcKey !== undefined) params.set("source_ifc_key", filter.sourceIfcKey);
      if (filter.limit !== undefined) params.set("limit", String(filter.limit));
      return transport.request<LineageConversionReportList>(
        ROUTES.listLineageConversionReports,
        routePath(ROUTES.listLineageConversionReports, {}, params),
      );
    },
    getLineageConversionReport: (conversionJobId: string) =>
      transport.request<LineageConversionReport>(ROUTES.getLineageConversionReport, routePath(ROUTES.getLineageConversionReport, { conversionJobId })),
    listLineageConversionReportDifferences: (conversionJobId: string, set: LineageDifferenceSet, page: { offset: number; limit: number }) => {
      const params = new URLSearchParams({ set, offset: String(page.offset), limit: String(page.limit) });
      return transport.request<LineageConversionReportDifferences>(
        ROUTES.listLineageConversionReportDifferences,
        routePath(ROUTES.listLineageConversionReportDifferences, { conversionJobId }, params),
      );
    },
    /** Download link of a report file (an attachment the coordinator sends after checking its checksum). */
    lineageConversionReportFileUrl: (conversionJobId: string, name: LineageReportFileName) =>
      `${base}/api/lineage/conversion-reports/${encodeURIComponent(conversionJobId)}/files/${name}`,
    // The browser sends only the key; presigning and the webhook secret stay on the coordinator.
    triggerConversion: (key: string, trigger?: { forceRetrigger?: boolean }) =>
      transport.request<TriggerConversionResponse>(
        ROUTES.triggerConversion,
        "/api/conversion/trigger",
        { body: trigger?.forceRetrigger === true ? { key, force_retrigger: true } : { key } },
      ),
    getIfcReadyJob: (jobId: string) =>
      transport.request<IfcReadyJobDetail>(ROUTES.getIfcReadyJob, routePath(ROUTES.getIfcReadyJob, { jobId })),
    // Conversion-service job history (GET /api/dev/conversions), a different source from getConversionRecords.
    getConversionsHistory: () =>
      transport.request<{ items: DevConversionRecord[]; count?: number }>(ROUTES.getConversionsHistory, "/api/dev/conversions"),
    getConversionResult: (jobId: string) =>
      transport.request<DevConversionResult>(ROUTES.getConversionResult, routePath(ROUTES.getConversionResult, { jobId })),
    getTestDataProjects: () =>
      transport.request<{ projects: string[] }>(ROUTES.getTestDataProjects, "/api/dev/test-data-projects"),
    getCallbackOutboxSummary: (limit = 50) =>
      transport.request<CallbackOutboxSummary>(ROUTES.getCallbackOutboxSummary, `/api/callback-outbox/summary?limit=${limit}`),
    // The browser sends identifiers only; the coordinator reads the statistics from governance (502 when it cannot).
    postIssueSnapshot: (sessionId: string, body: { rule_run_id: string; model_version_id?: string }) =>
      transport.request<IssueSnapshotResponse>(ROUTES.postIssueSnapshot, routePath(ROUTES.postIssueSnapshot, { sessionId }), { body }),
    kitHealth: () => transport.request<KitHealth>(ROUTES.kitHealth, "/api/kit/health"),
    governanceIssues: () => transport.request<{ issues: IssueRow[] }>(ROUTES.governanceIssues, "/api/governance/issues"),
    governanceRuleRuns: (limit = 5) =>
      transport.request<RuleRunHistoryResponse>(ROUTES.governanceRuleRuns, `/api/governance/rule-runs?limit=${limit}`),
    getSessionIdleStatus: (sessionId: string) =>
      transport.request<SessionIdleStatusResponse>(ROUTES.getSessionIdleStatus, routePath(ROUTES.getSessionIdleStatus, { sessionId })),
    getSessionIdlePolicy: () => transport.request<SessionIdlePolicy>(ROUTES.getSessionIdlePolicy, "/api/runtime/session-idle-policy"),
    updateSessionIdlePolicy: (
      timeoutMs: number | null,
      expectedRevision: number,
      expectedProcessEpoch: string,
      reason: string,
      operatorToken: string,
    ) => {
      if (!isSecureOperatorTransport(base)) {
        return Promise.reject(new Error("operator credential transport requires HTTPS or exact loopback HTTP"));
      }
      return transport.request<SessionIdlePolicy>(ROUTES.updateSessionIdlePolicy, "/api/runtime/session-idle-policy", {
        body: {
          timeout_ms: timeoutMs,
          expected_revision: expectedRevision,
          expected_process_epoch: expectedProcessEpoch,
          reason,
        },
        headers: { "X-Operator-Token": operatorToken },
      });
    },
  };
  return client;
}

export type CoordinatorBrowserClient = ReturnType<typeof createCoordinatorClient>;
