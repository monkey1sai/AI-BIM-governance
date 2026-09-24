// Coordinator Browser Client (docs/architecture/coordinator-browser-client-adr.md): every call a console surface or the
// viewer makes to the coordinator's own routes. One transport, one error type, one timeout rule, one viewer-lease transport.
// Each call names its route and passes only template parameters and a query; the transport builds the path from the
// route's template, so a call cannot reach a path other than the one its route (and its tag) declares.
import type {
  ClaimViewerLeaseRequest,
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
    health: () => transport.request<CoordinatorHealth>(ROUTES.health),
    runtimeStatus: () => transport.request<RuntimeStatus>(ROUTES.runtimeStatus),
    listClosedReviewSessions: (limit = 20, cursor?: string) => {
      const query = new URLSearchParams({ status: "closed", limit: String(limit) });
      if (cursor) query.set("cursor", cursor);
      return transport.request<ClosedReviewSessionPage>(ROUTES.listClosedReviewSessions, { query });
    },
    recreateReviewSession: (closedSessionId: string, idempotencyKey: string) =>
      transport.request<RecreateReviewSessionResponse>(ROUTES.recreateReviewSession, {
        params: { sessionId: closedSessionId }, headers: { "Idempotency-Key": idempotencyKey },
      }),
    kitInstanceCurrent: () => transport.request<KitInstanceState>(ROUTES.kitInstanceCurrent),
    listIfcReady: (limit = 20) =>
      transport.request<{ count: number; items: IfcReadyListItem[] }>(ROUTES.listIfcReady, { query: `limit=${limit}` }),
    createReviewSessionForIfcReady: (jobId: string) =>
      transport.request<IfcReadyReviewSessionResponse>(ROUTES.createReviewSessionForIfcReady, { params: { jobId } }),
    minioWatchStatus: () => transport.request<MinioWatchStatus>(ROUTES.minioWatchStatus),
    streamConfig: (sessionId: string) => transport.request<StreamConfigResponse>(ROUTES.streamConfig, { params: { sessionId } }),
    conversionQualityMetrics: (conversionJobId: string) =>
      transport.request<ConversionQualityMetricsResponse>(ROUTES.conversionQualityMetrics, { params: { conversionJobId } }),
    conversionPrioritize: (id: string, reason?: string) =>
      transport.request<ConversionControlResponse>(ROUTES.conversionPrioritize, { params: { ifcReadyJobId: id }, body: { reason } }),
    conversionRetry: (id: string, reason?: string) =>
      transport.request<ConversionControlResponse>(ROUTES.conversionRetry, { params: { ifcReadyJobId: id }, body: { reason } }),
    conversionWatchToggle: (enabled: boolean, reason?: string) =>
      transport.request<MinioWatchStatus>(ROUTES.conversionWatchToggle, { body: { enabled, reason } }),
    // IX-SS-04: an operator ends a session with a cooperative close; the body carries only the reason (no final events).
    sessionClose: (sessionId: string, reason?: string) =>
      transport.request<SessionCloseResponse>(ROUTES.sessionClose, { params: { sessionId }, body: { reason } }),
    /** 409 `queued_for_instance` (no Kit capacity) is a `QueuedForInstanceError`; every other failure a `CoordinatorHttpError`. */
    createReviewSession: async (body: CreateReviewSessionRequest): Promise<CreateReviewSessionResponse> => {
      try {
        return await transport.request<CreateReviewSessionResponse>(ROUTES.createReviewSession, { body });
      } catch (error) {
        if (error instanceof CoordinatorHttpError && error.status === 409 && isQueuedForInstanceResponse(error.body)) {
          throw new QueuedForInstanceError(error.path, error.body);
        }
        throw error;
      }
    },
    getReviewSession: (sessionId: string) => transport.request<ReviewSession>(ROUTES.getReviewSession, { params: { sessionId } }),
    claimViewerLease: (sessionId: string, body: ClaimViewerLeaseRequest, userToken: string) =>
      transport.request<ViewerLeaseClaimResponse>(ROUTES.claimViewerLease, {
        params: { sessionId }, body, headers: { "X-User-Token": userToken },
      }),
    viewerLeaseHeartbeat: (sessionId: string, leaseId: string, leaseToken: string, body: HeartbeatViewerLeaseRequest) =>
      transport.request<HeartbeatViewerLeaseResponse>(ROUTES.viewerLeaseHeartbeat, {
        params: { sessionId, leaseId }, body, headers: { "X-Viewer-Lease-Token": leaseToken },
      }),
    // keepalive: release is often sent while the document unloads (pagehide); without it the request is cancelled (#851).
    releaseViewerLease: (sessionId: string, leaseId: string, leaseToken: string) =>
      transport.request<ViewerLeaseSummary>(ROUTES.releaseViewerLease, {
        params: { sessionId, leaseId }, headers: { "X-Viewer-Lease-Token": leaseToken }, keepalive: true,
      }),
    /** The three lease calls as a `ViewerLeaseTransport`, resolved at call time so a spy on the client still applies. */
    viewerLeaseTransport: (): ViewerLeaseTransport => ({
      claim: (sessionId, body, userToken) => client.claimViewerLease(sessionId, body, userToken),
      heartbeat: (sessionId, leaseId, leaseToken, body) => client.viewerLeaseHeartbeat(sessionId, leaseId, leaseToken, body),
      release: (sessionId, leaseId, leaseToken) => client.releaseViewerLease(sessionId, leaseId, leaseToken),
    }),
    getA4ViewerLeaseStatus: async (sessionId: string, userToken: string, viewerLeaseToken: string): Promise<A4ViewerLeaseStatus> => {
      const payload = await transport.request<unknown>(ROUTES.getA4ViewerLeaseStatus, {
        params: { sessionId }, headers: { "X-User-Token": userToken, "X-Viewer-Lease-Token": viewerLeaseToken },
      });
      const parsed = parseA4ViewerLeaseStatus(payload, sessionId);
      if (!parsed) throw malformed(routePath(ROUTES.getA4ViewerLeaseStatus, { sessionId }), "viewer_lease_status_malformed");
      return parsed;
    },
    /** The active and last successful stage binding revisions (null when none); needs only the user token. */
    getStageBindingRevisions: async (sessionId: string, userToken: string): Promise<StageBindingRevisions> => {
      const payload = await transport.request<unknown>(ROUTES.getStageBindingRevisions, {
        params: { sessionId }, headers: { "X-User-Token": userToken },
      });
      if (!isRecord(payload) || !isRecord(payload.stage_binding)) {
        throw malformed(routePath(ROUTES.getStageBindingRevisions, { sessionId }), "viewer_lease_status_malformed");
      }
      const { active_binding_revision: active, last_good_binding_revision: lastGood } = payload.stage_binding;
      return { active: nonEmptyString(active) ? active : null, lastGood: nonEmptyString(lastGood) ? lastGood : null };
    },
    preauthorizeStageBinding: async (
      sessionId: string,
      body: StageBindingPreauthorizationRequest,
      credentials: StageBindingCredentials,
      signal?: AbortSignal,
    ): Promise<StageBindingPreauthorization> => {
      const payload = await transport.request<unknown>(ROUTES.preauthorizeStageBinding, {
        params: { sessionId }, body, headers: stageBindingHeaders(credentials), signal,
      });
      if (!isStageBindingPreauthorization(payload, sessionId)) {
        throw malformed(routePath(ROUTES.preauthorizeStageBinding, { sessionId }), "stage_binding_preauthorization_malformed");
      }
      return payload;
    },
    cancelStageBinding: (
      sessionId: string,
      body: { source_client_id: string; client_request_id: string },
      credentials: StageBindingCredentials,
      signal?: AbortSignal,
    ) =>
      transport.request<StageBindingCancellationResponse>(ROUTES.cancelStageBinding, {
        params: { sessionId }, body, headers: stageBindingHeaders(credentials), signal,
      }),
    recordSessionActivity: (sessionId: string, leaseId: string, leaseToken: string) =>
      transport.request<SessionActivityResponse>(ROUTES.recordSessionActivity, {
        params: { sessionId }, body: { lease_id: leaseId }, headers: { "X-Viewer-Lease-Token": leaseToken },
      }),
    // VG-01: the active review sessions come from /api/runtime/status (there is no bare GET /api/review-sessions list).
    listReviewSessions: async (): Promise<{ items: RuntimeSessionSummary[] }> => {
      const runtime = await transport.request<RuntimeStatus>(ROUTES.listReviewSessions);
      return { items: runtime.sessions.items };
    },
    // VG-01: the console forwards the viewer's first frame; the viewer itself never calls the coordinator for it.
    reportFirstFrame: (sessionId: string, endpointId?: string) =>
      transport.request<{ session_id: string; first_frame_at: string }>(ROUTES.reportFirstFrame, {
        params: { sessionId }, body: { endpoint_id: endpointId },
      }),
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
      }>(ROUTES.createA4Handoff, { params: { sessionId }, body, headers: { "X-User-Token": userToken } }),
    consumeA4Handoff: async (sessionId: string, handoffId: string, userToken: string, viewerLeaseToken: string): Promise<A4HandoffIntent> => {
      const payload = await transport.request<unknown>(ROUTES.consumeA4Handoff, {
        params: { sessionId, handoffId }, headers: { "X-User-Token": userToken, "X-Viewer-Lease-Token": viewerLeaseToken },
      });
      const parsed = parseA4HandoffIntent(payload, handoffId);
      if (!parsed) throw malformed(routePath(ROUTES.consumeA4Handoff, { sessionId, handoffId }), "a4_handoff_response_malformed");
      return parsed;
    },
    getConversionRecords: (limit = 50) =>
      transport.request<{ count: number; items: ConversionRecord[] }>(ROUTES.getConversionRecords, { query: `limit=${limit}` }),
    getObjectConversionHistory: (key: string, sourceId: string) =>
      transport.request<{ count: number; items: ConversionRecord[] }>(ROUTES.getObjectConversionHistory, {
        query: `limit=100&object_key=${encodeURIComponent(key)}&source_id=${encodeURIComponent(sourceId)}`,
      }),
    reconvertIfc: (key: string, requestId: string, expectedEtag: string) =>
      transport.request<{ ready_model_id: string; status?: string; conversion_job_id?: string | null; intent_replay: boolean }>(
        ROUTES.reconvertIfc,
        { body: { key, force_retrigger: true, request_id: requestId, expected_etag: expectedEtag } },
      ),
    readyReviewSession: (readyModelId: string, intent: ReadyReviewIntent) =>
      transport.request<ReadyReviewSessionResponse>(ROUTES.readyReviewSession, { params: { readyModelId }, body: intent }),
    // Read-only S3 list proxy; without a prefix the coordinator lists its configured watch prefix.
    getMinioObjects: (prefix?: string) =>
      transport.request<{ bucket: string | null; count: number; objects: MinioObject[] }>(ROUTES.getMinioObjects, {
        query: prefix ? `prefix=${encodeURIComponent(prefix)}` : undefined,
      }),
    minioEventsUrl: () => `${base}/api/minio/events`,
    // Folder listing (delimiter=/ is sent percent-encoded as %2F, which some proxies need).
    getMinioFolder: (prefix?: string, listing?: { refresh?: boolean }): Promise<MinioFolderListing> => {
      const query = new URLSearchParams({ delimiter: "/" });
      if (prefix) query.set("prefix", prefix);
      if (listing?.refresh) query.set("refresh", "1");
      return transport.request<MinioFolderListing>(ROUTES.getMinioFolder, { query });
    },
    // Governed lineage: find the accepted source bundles of a MinIO IFC object (URLSearchParams encodes + as %2B).
    lookupLineageSourceBundles: (bucket: string, key: string, etag: string) =>
      transport.request<SourceBundleLookupResponse>(ROUTES.lookupLineageSourceBundles, {
        query: new URLSearchParams({ source_ifc_bucket: bucket, source_ifc_key: key, source_ifc_etag: etag }),
      }),
    listLineageConversionReports: (filter: { sourceIfcKey?: string; limit?: number } = {}) => {
      const query = new URLSearchParams();
      if (filter.sourceIfcKey !== undefined) query.set("source_ifc_key", filter.sourceIfcKey);
      if (filter.limit !== undefined) query.set("limit", String(filter.limit));
      return transport.request<LineageConversionReportList>(ROUTES.listLineageConversionReports, { query });
    },
    getLineageConversionReport: (conversionJobId: string) =>
      transport.request<LineageConversionReport>(ROUTES.getLineageConversionReport, { params: { conversionJobId } }),
    listLineageConversionReportDifferences: (conversionJobId: string, set: LineageDifferenceSet, page: { offset: number; limit: number }) =>
      transport.request<LineageConversionReportDifferences>(ROUTES.listLineageConversionReportDifferences, {
        params: { conversionJobId },
        query: new URLSearchParams({ set, offset: String(page.offset), limit: String(page.limit) }),
      }),
    /** Download link of a report file (an attachment the coordinator sends after checking its checksum). */
    lineageConversionReportFileUrl: (conversionJobId: string, name: LineageReportFileName) =>
      `${base}/api/lineage/conversion-reports/${encodeURIComponent(conversionJobId)}/files/${name}`,
    // The browser sends only the key; presigning and the webhook secret stay on the coordinator.
    triggerConversion: (key: string, trigger?: { forceRetrigger?: boolean }) =>
      transport.request<TriggerConversionResponse>(ROUTES.triggerConversion, {
        body: trigger?.forceRetrigger === true ? { key, force_retrigger: true } : { key },
      }),
    getIfcReadyJob: (jobId: string) => transport.request<IfcReadyJobDetail>(ROUTES.getIfcReadyJob, { params: { jobId } }),
    // Conversion-service job history (GET /api/dev/conversions), a different source from getConversionRecords.
    getConversionsHistory: () => transport.request<{ items: DevConversionRecord[]; count?: number }>(ROUTES.getConversionsHistory),
    getConversionResult: (jobId: string) => transport.request<DevConversionResult>(ROUTES.getConversionResult, { params: { jobId } }),
    getTestDataProjects: () => transport.request<{ projects: string[] }>(ROUTES.getTestDataProjects),
    getCallbackOutboxSummary: (limit = 50) =>
      transport.request<CallbackOutboxSummary>(ROUTES.getCallbackOutboxSummary, { query: `limit=${limit}` }),
    // The browser sends identifiers only; the coordinator reads the statistics from governance (502 when it cannot).
    postIssueSnapshot: (sessionId: string, body: { rule_run_id: string; model_version_id?: string }) =>
      transport.request<IssueSnapshotResponse>(ROUTES.postIssueSnapshot, { params: { sessionId }, body }),
    kitHealth: () => transport.request<KitHealth>(ROUTES.kitHealth),
    governanceIssues: () => transport.request<{ issues: IssueRow[] }>(ROUTES.governanceIssues),
    governanceRuleRuns: (limit = 5) => transport.request<RuleRunHistoryResponse>(ROUTES.governanceRuleRuns, { query: `limit=${limit}` }),
    getSessionIdleStatus: (sessionId: string) =>
      transport.request<SessionIdleStatusResponse>(ROUTES.getSessionIdleStatus, { params: { sessionId } }),
    getSessionIdlePolicy: () => transport.request<SessionIdlePolicy>(ROUTES.getSessionIdlePolicy),
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
      return transport.request<SessionIdlePolicy>(ROUTES.updateSessionIdlePolicy, {
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
