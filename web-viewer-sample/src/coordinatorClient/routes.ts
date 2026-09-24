// The coordinator routes the browser calls, each tagged with what serves it (docs/architecture/coordinator-browser-client-adr.md §3):
// a Coordinator Browser Contract `operationId`, `proxied` (Kit and governance routes the contract does not declare), or
// `non_contract` (`/health`, `/api/dev/*`). Paths are the contract's templates; the drift test compares them with
// tests/contracts/coordinator-browser-api-v1.openapi.json. Several client methods may serve one operation.

export type RouteTag = { operationId: string } | "proxied" | "non_contract";

export interface RouteSpec {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Path template with `{param}` segments and no query string. */
  path: string;
  tag: RouteTag;
}

const serves = (operationId: string): RouteTag => ({ operationId });

export const COORDINATOR_ROUTES = {
  health: { method: "GET", path: "/health", tag: "non_contract" },
  runtimeStatus: { method: "GET", path: "/api/runtime/status", tag: serves("getRuntimeStatus") },
  listReviewSessions: { method: "GET", path: "/api/runtime/status", tag: serves("getRuntimeStatus") },
  listClosedReviewSessions: { method: "GET", path: "/api/review-sessions", tag: serves("listClosedReviewSessions") },
  createReviewSession: { method: "POST", path: "/api/review-sessions", tag: serves("createReviewSession") },
  getReviewSession: { method: "GET", path: "/api/review-sessions/{sessionId}", tag: serves("getReviewSession") },
  recreateReviewSession: { method: "POST", path: "/api/review-sessions/{sessionId}/recreate", tag: serves("recreateReviewSession") },
  sessionClose: { method: "POST", path: "/api/review-sessions/{sessionId}/close", tag: serves("closeReviewSession") },
  streamConfig: { method: "GET", path: "/api/review-sessions/{sessionId}/stream-config", tag: serves("getStreamConfig") },
  reportFirstFrame: { method: "POST", path: "/api/review-sessions/{sessionId}/first-frame", tag: serves("reportFirstFrame") },
  recordSessionActivity: { method: "POST", path: "/api/review-sessions/{sessionId}/activity", tag: serves("recordSessionActivity") },
  getSessionIdleStatus: { method: "GET", path: "/api/review-sessions/{sessionId}/idle-status", tag: serves("getSessionIdleStatus") },
  postIssueSnapshot: { method: "POST", path: "/api/review-sessions/{sessionId}/issue-snapshot", tag: serves("enqueueIssueSnapshot") },
  createA4Handoff: { method: "POST", path: "/api/review-sessions/{sessionId}/a4-handoffs", tag: serves("createA4Handoff") },
  consumeA4Handoff: { method: "POST", path: "/api/review-sessions/{sessionId}/a4-handoffs/{handoffId}/consume", tag: serves("consumeA4Handoff") },
  claimViewerLease: { method: "POST", path: "/api/review-sessions/{sessionId}/viewer-leases/claim", tag: serves("claimViewerLease") },
  viewerLeaseHeartbeat: {
    method: "POST", path: "/api/review-sessions/{sessionId}/viewer-leases/{leaseId}/heartbeat", tag: serves("heartbeatViewerLease"),
  },
  releaseViewerLease: {
    method: "POST", path: "/api/review-sessions/{sessionId}/viewer-leases/{leaseId}/release", tag: serves("releaseViewerLease"),
  },
  getA4ViewerLeaseStatus: { method: "GET", path: "/api/review-sessions/{sessionId}/viewer-leases/status", tag: serves("getViewerLeaseStatus") },
  getStageBindingRevisions: { method: "GET", path: "/api/review-sessions/{sessionId}/viewer-leases/status", tag: serves("getViewerLeaseStatus") },
  preauthorizeStageBinding: { method: "POST", path: "/api/review-sessions/{sessionId}/stage-binding", tag: serves("preauthorizeStageBinding") },
  cancelStageBinding: { method: "POST", path: "/api/review-sessions/{sessionId}/stage-binding-cancellations", tag: serves("cancelStageBinding") },
  listIfcReady: { method: "GET", path: "/api/external/ifc-ready", tag: serves("listIfcReadyJobs") },
  getIfcReadyJob: { method: "GET", path: "/api/external/ifc-ready/{jobId}", tag: serves("getIfcReadyJob") },
  createReviewSessionForIfcReady: { method: "POST", path: "/api/external/ifc-ready/{jobId}/review-session", tag: serves("openIfcReadyReviewSession") },
  minioWatchStatus: { method: "GET", path: "/api/external/minio-watch/status", tag: serves("getMinioWatchStatus") },
  conversionQualityMetrics: { method: "GET", path: "/api/conversions/{conversionJobId}/quality-metrics", tag: serves("getConversionQualityMetrics") },
  conversionPrioritize: { method: "POST", path: "/api/conversion/jobs/{ifcReadyJobId}/prioritize", tag: serves("prioritizeConversionJob") },
  conversionRetry: { method: "POST", path: "/api/conversion/jobs/{ifcReadyJobId}/retry", tag: serves("retryConversionJob") },
  conversionWatchToggle: { method: "PUT", path: "/api/conversion/watch", tag: serves("setConversionWatch") },
  getConversionRecords: { method: "GET", path: "/api/conversion/records", tag: serves("listConversionRecords") },
  getObjectConversionHistory: { method: "GET", path: "/api/conversion/records", tag: serves("listConversionRecords") },
  readyReviewSession: { method: "POST", path: "/api/conversion/records/{readyModelId}/review-session", tag: serves("openReadyModelReviewSession") },
  triggerConversion: { method: "POST", path: "/api/conversion/trigger", tag: serves("triggerConversion") },
  reconvertIfc: { method: "POST", path: "/api/conversion/trigger", tag: serves("triggerConversion") },
  getMinioObjects: { method: "GET", path: "/api/minio/objects", tag: serves("listMinioObjects") },
  getMinioFolder: { method: "GET", path: "/api/minio/objects", tag: serves("listMinioObjects") },
  lookupLineageSourceBundles: { method: "GET", path: "/api/lineage/source-bundles", tag: serves("lookupLineageSourceBundles") },
  listLineageConversionReports: { method: "GET", path: "/api/lineage/conversion-reports", tag: serves("listLineageConversionReports") },
  getLineageConversionReport: {
    method: "GET", path: "/api/lineage/conversion-reports/{conversionJobId}", tag: serves("getLineageConversionReport"),
  },
  listLineageConversionReportDifferences: {
    method: "GET", path: "/api/lineage/conversion-reports/{conversionJobId}/differences", tag: serves("listLineageConversionReportDifferences"),
  },
  getCallbackOutboxSummary: { method: "GET", path: "/api/callback-outbox/summary", tag: serves("getCallbackOutboxSummary") },
  getSessionIdlePolicy: { method: "GET", path: "/api/runtime/session-idle-policy", tag: serves("getSessionIdlePolicy") },
  updateSessionIdlePolicy: { method: "PUT", path: "/api/runtime/session-idle-policy", tag: serves("updateSessionIdlePolicy") },
  kitInstanceCurrent: { method: "GET", path: "/api/kit/instances/current", tag: "proxied" },
  kitHealth: { method: "GET", path: "/api/kit/health", tag: "proxied" },
  governanceIssues: { method: "GET", path: "/api/governance/issues", tag: "proxied" },
  governanceRuleRuns: { method: "GET", path: "/api/governance/rule-runs", tag: "proxied" },
  getConversionsHistory: { method: "GET", path: "/api/dev/conversions", tag: "non_contract" },
  getConversionResult: { method: "GET", path: "/api/dev/conversions/{jobId}/result", tag: "non_contract" },
  getTestDataProjects: { method: "GET", path: "/api/dev/test-data-projects", tag: "non_contract" },
} as const satisfies Record<string, RouteSpec>;

export type CoordinatorRouteName = keyof typeof COORDINATOR_ROUTES;

/** Fill a route template: each `{param}` is replaced by its value, percent-encoded. */
export function routePath(route: RouteSpec, params: Record<string, string> = {}, query?: URLSearchParams | string): string {
  const path = route.path.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing path parameter ${name} for ${route.path}`);
    return encodeURIComponent(value);
  });
  const search = typeof query === "string" ? query : query?.toString();
  return search ? `${path}?${search}` : path;
}
