// Coordinator Browser Client tests (docs/architecture/coordinator-browser-client-adr.md): each member's method and URL,
// the transport's error mode, headers, keepalive, the queued-for-instance conflict, the malformed-reply checks and the
// timeout rule, through the client's own interface with a fake fetch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorClient, type CoordinatorBrowserClient } from "./client";
import {
  CoordinatorHttpError,
  isCoordinatorNotFound,
  isDevRoutesDisabled,
  isQueuedForInstanceError,
  QueuedForInstanceError,
} from "./errors";
import { COORDINATOR_ROUTES } from "./routes";

const BASE = "http://127.0.0.1:8004";

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    statusText: status === 503 ? "Service Unavailable" : "",
    headers: { "Content-Type": "application/json" },
  });
}

function clientWith(response: Response | (() => Response), options: { timeoutMs?: number } = {}) {
  const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => (typeof response === "function" ? response() : response));
  return { client: createCoordinatorClient({ baseUrl: BASE, fetch: fetchImpl as unknown as typeof fetch, ...options }), fetchImpl };
}

function initOf(fetchImpl: ReturnType<typeof vi.fn>): RequestInit {
  return (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
}

afterEach(() => vi.restoreAllMocks());

const CREDENTIALS = { userToken: "u", leaseToken: "l" };

// The method and URL each member sends, with arguments that exercise the encoding of path parameters and queries.
const WIRE: Array<[member: string, call: (client: CoordinatorBrowserClient) => Promise<unknown>, method: string, url: string]> = [
  ["health", (c) => c.health(), "GET", "/health"],
  ["runtimeStatus", (c) => c.runtimeStatus(), "GET", "/api/runtime/status"],
  ["listReviewSessions", (c) => c.listReviewSessions(), "GET", "/api/runtime/status"],
  ["listClosedReviewSessions", (c) => c.listClosedReviewSessions(20, "c/1"), "GET", "/api/review-sessions?status=closed&limit=20&cursor=c%2F1"],
  ["createReviewSession", (c) => c.createReviewSession({} as never), "POST", "/api/review-sessions"],
  ["getReviewSession", (c) => c.getReviewSession("s_1"), "GET", "/api/review-sessions/s_1"],
  ["recreateReviewSession", (c) => c.recreateReviewSession("s_1", "k"), "POST", "/api/review-sessions/s_1/recreate"],
  ["sessionClose", (c) => c.sessionClose("s_1"), "POST", "/api/review-sessions/s_1/close"],
  ["streamConfig", (c) => c.streamConfig("s_1"), "GET", "/api/review-sessions/s_1/stream-config"],
  ["reportFirstFrame", (c) => c.reportFirstFrame("s_1"), "POST", "/api/review-sessions/s_1/first-frame"],
  ["recordSessionActivity", (c) => c.recordSessionActivity("s_1", "l_1", "t"), "POST", "/api/review-sessions/s_1/activity"],
  ["getSessionIdleStatus", (c) => c.getSessionIdleStatus("s_1"), "GET", "/api/review-sessions/s_1/idle-status"],
  ["postIssueSnapshot", (c) => c.postIssueSnapshot("s_1", { rule_run_id: "rr_1" }), "POST", "/api/review-sessions/s_1/issue-snapshot"],
  ["createA4Handoff", (c) => c.createA4Handoff("s_1", { action: "focus", evidence_proofs: [] }, "u"), "POST", "/api/review-sessions/s_1/a4-handoffs"],
  ["consumeA4Handoff", (c) => c.consumeA4Handoff("s_1", "h_1", "u", "l"), "POST", "/api/review-sessions/s_1/a4-handoffs/h_1/consume"],
  ["claimViewerLease", (c) => c.claimViewerLease("s_1", {} as never, "u"), "POST", "/api/review-sessions/s_1/viewer-leases/claim"],
  ["viewerLeaseHeartbeat", (c) => c.viewerLeaseHeartbeat("s_1", "l_1", "t", {} as never), "POST", "/api/review-sessions/s_1/viewer-leases/l_1/heartbeat"],
  ["releaseViewerLease", (c) => c.releaseViewerLease("s_1", "l_1", "t"), "POST", "/api/review-sessions/s_1/viewer-leases/l_1/release"],
  ["getA4ViewerLeaseStatus", (c) => c.getA4ViewerLeaseStatus("s_1", "u", "l"), "GET", "/api/review-sessions/s_1/viewer-leases/status"],
  ["getStageBindingRevisions", (c) => c.getStageBindingRevisions("s_1", "u"), "GET", "/api/review-sessions/s_1/viewer-leases/status"],
  ["preauthorizeStageBinding", (c) => c.preauthorizeStageBinding("s_1", {} as never, CREDENTIALS), "POST", "/api/review-sessions/s_1/stage-binding"],
  [
    "cancelStageBinding", (c) => c.cancelStageBinding("s_1", { source_client_id: "c", client_request_id: "r" }, CREDENTIALS),
    "POST", "/api/review-sessions/s_1/stage-binding-cancellations",
  ],
  ["listIfcReady", (c) => c.listIfcReady(5), "GET", "/api/external/ifc-ready?limit=5"],
  ["getIfcReadyJob", (c) => c.getIfcReadyJob("job_1"), "GET", "/api/external/ifc-ready/job_1"],
  ["createReviewSessionForIfcReady", (c) => c.createReviewSessionForIfcReady("job_1"), "POST", "/api/external/ifc-ready/job_1/review-session"],
  ["minioWatchStatus", (c) => c.minioWatchStatus(), "GET", "/api/external/minio-watch/status"],
  ["conversionQualityMetrics", (c) => c.conversionQualityMetrics("cj_1"), "GET", "/api/conversions/cj_1/quality-metrics"],
  ["conversionPrioritize", (c) => c.conversionPrioritize("job_1", "why"), "POST", "/api/conversion/jobs/job_1/prioritize"],
  ["conversionRetry", (c) => c.conversionRetry("job_1"), "POST", "/api/conversion/jobs/job_1/retry"],
  ["conversionWatchToggle", (c) => c.conversionWatchToggle(true), "PUT", "/api/conversion/watch"],
  ["getConversionRecords", (c) => c.getConversionRecords(7), "GET", "/api/conversion/records?limit=7"],
  [
    "getObjectConversionHistory", (c) => c.getObjectConversionHistory("a b/c.ifc", "src 1"),
    "GET", "/api/conversion/records?limit=100&object_key=a%20b%2Fc.ifc&source_id=src%201",
  ],
  [
    "readyReviewSession", (c) => c.readyReviewSession("rm_1", { mode: "open_existing", session_id: "s_1" }),
    "POST", "/api/conversion/records/rm_1/review-session",
  ],
  ["triggerConversion", (c) => c.triggerConversion("k.ifc"), "POST", "/api/conversion/trigger"],
  ["reconvertIfc", (c) => c.reconvertIfc("k.ifc", "r_1", "e_1"), "POST", "/api/conversion/trigger"],
  ["getMinioObjects", (c) => c.getMinioObjects("a b/"), "GET", "/api/minio/objects?prefix=a%20b%2F"],
  ["getMinioFolder", (c) => c.getMinioFolder("a b/", { refresh: true }), "GET", "/api/minio/objects?delimiter=%2F&prefix=a+b%2F&refresh=1"],
  [
    "lookupLineageSourceBundles", (c) => c.lookupLineageSourceBundles("bkt", "a+b.ifc", "e_1"),
    "GET", "/api/lineage/source-bundles?source_ifc_bucket=bkt&source_ifc_key=a%2Bb.ifc&source_ifc_etag=e_1",
  ],
  [
    "listLineageConversionReports", (c) => c.listLineageConversionReports({ sourceIfcKey: "k", limit: 3 }),
    "GET", "/api/lineage/conversion-reports?source_ifc_key=k&limit=3",
  ],
  ["getLineageConversionReport", (c) => c.getLineageConversionReport("cj_1"), "GET", "/api/lineage/conversion-reports/cj_1"],
  [
    "listLineageConversionReportDifferences", (c) => c.listLineageConversionReportDifferences("cj_1", "csv_only", { offset: 0, limit: 50 }),
    "GET", "/api/lineage/conversion-reports/cj_1/differences?set=csv_only&offset=0&limit=50",
  ],
  ["getCallbackOutboxSummary", (c) => c.getCallbackOutboxSummary(9), "GET", "/api/callback-outbox/summary?limit=9"],
  ["getSessionIdlePolicy", (c) => c.getSessionIdlePolicy(), "GET", "/api/runtime/session-idle-policy"],
  ["updateSessionIdlePolicy", (c) => c.updateSessionIdlePolicy(60_000, 1, "epoch", "why", "op"), "PUT", "/api/runtime/session-idle-policy"],
  ["kitInstanceCurrent", (c) => c.kitInstanceCurrent(), "GET", "/api/kit/instances/current"],
  ["kitHealth", (c) => c.kitHealth(), "GET", "/api/kit/health"],
  ["governanceIssues", (c) => c.governanceIssues(), "GET", "/api/governance/issues"],
  ["governanceRuleRuns", (c) => c.governanceRuleRuns(3), "GET", "/api/governance/rule-runs?limit=3"],
  ["getConversionsHistory", (c) => c.getConversionsHistory(), "GET", "/api/dev/conversions"],
  ["getConversionResult", (c) => c.getConversionResult("job_1"), "GET", "/api/dev/conversions/job_1/result"],
  ["getTestDataProjects", (c) => c.getTestDataProjects(), "GET", "/api/dev/test-data-projects"],
];

describe("wire", () => {
  it("has a row for every route the client calls", () => {
    expect(WIRE.map(([member]) => member).sort()).toEqual(Object.keys(COORDINATOR_ROUTES).sort());
  });

  it.each(WIRE.map(([member, call, method, url]) => ({ member, call, method, url })))("$member sends $method $url", async ({ call, method, url }) => {
    const { client, fetchImpl } = clientWith(() => reply(200, {}));
    await call(client).catch(() => undefined);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}${url}`);
    expect(initOf(fetchImpl).method ?? "GET").toBe(method);
  });
});

describe("error mode", () => {
  it("throws one error type with the console message for a failed GET, POST and PUT alike", async () => {
    const failures = [
      () => clientWith(reply(404, { detail: "job missing", error_code: "not_found" })).client.getIfcReadyJob("job_1"),
      () => clientWith(reply(400, { detail: "bad id", error_code: "invalid_request" })).client.sessionClose("s_1", "done"),
      () => clientWith(reply(409, { detail: "watch busy", error_code: "conflict" })).client.conversionWatchToggle(true),
    ];
    const errors = await Promise.all(failures.map((call) => call().catch((error: unknown) => error)));
    for (const error of errors) expect(error).toBeInstanceOf(CoordinatorHttpError);
    expect(errors.map((error) => String(error))).toEqual([
      "CoordinatorHttpError: coordinator /api/external/ifc-ready/job_1 -> 404 job missing",
      "CoordinatorHttpError: coordinator /api/review-sessions/s_1/close -> 400 bad id",
      "CoordinatorHttpError: coordinator /api/conversion/watch -> 409 watch busy",
    ]);
    expect(errors.map((error) => (error as CoordinatorHttpError).errorCode)).toEqual(["not_found", "invalid_request", "conflict"]);
  });

  it("falls back to the body text or the status text, and ignores an error code that is not a contract code", async () => {
    const plain = (await clientWith(reply(500, "upstream exploded")).client.health().catch((error: unknown) => error)) as CoordinatorHttpError;
    expect([plain.detail, plain.errorCode]).toEqual(["upstream exploded", null]);
    const empty = (await clientWith(new Response("", { status: 503, statusText: "Service Unavailable" })).client.health()
      .catch((error: unknown) => error)) as CoordinatorHttpError;
    expect([empty.detail, empty.errorCode]).toEqual(["Service Unavailable", null]);
    const odd = (await clientWith(reply(409, { detail: "x", error_code: "Not A Code" })).client.health()
      .catch((error: unknown) => error)) as CoordinatorHttpError;
    expect(odd.errorCode).toBeNull();
  });

  it("classifies dev-route and not-found failures by status and code", async () => {
    const disabled = await clientWith(reply(404, { detail: "dev routes disabled", error_code: "dev_routes_disabled" })).client
      .getTestDataProjects().catch((error: unknown) => error);
    expect([isDevRoutesDisabled(disabled), isCoordinatorNotFound(disabled)]).toEqual([true, true]);
    const missing = await clientWith(reply(404, { detail: "no" })).client.getTestDataProjects().catch((error: unknown) => error);
    expect([isDevRoutesDisabled(missing), isCoordinatorNotFound(missing)]).toEqual([false, true]);
  });

  it("refuses a 2xx reply that is not JSON as a malformed coordinator reply", async () => {
    const error = await clientWith(reply(200, "<html>proxy page</html>")).client.runtimeStatus().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 502, errorCode: "coordinator_response_malformed", path: "/api/runtime/status" });
  });

  it("rejects as fetch does when the reply body cannot be read, rather than calling the reply malformed", async () => {
    const failure = new TypeError("network error");
    const body = new ReadableStream({ start: (controller) => controller.error(failure) });
    const error = await clientWith(new Response(body, { status: 200 })).client.runtimeStatus().catch((caught: unknown) => caught);
    expect(error).toBe(failure);
  });

  it("turns a queued-for-instance conflict into its own error, which is still a coordinator error", async () => {
    const conflict = { detail: "No Kit capacity.", error_code: "queued_for_instance", status: "queued_for_instance", artifact_bindings: [] };
    const error = await clientWith(reply(409, conflict)).client.createReviewSession({ project_id: "p", model_version_id: "v", created_by: "u" } as never)
      .catch((caught: unknown) => caught);
    expect(isQueuedForInstanceError(error)).toBe(true);
    expect(error).toBeInstanceOf(CoordinatorHttpError);
    expect((error as QueuedForInstanceError).response).toEqual(conflict);
    expect(String(error)).toBe("QueuedForInstanceError: coordinator /api/review-sessions -> 409 No Kit capacity.");
    const other = await clientWith(reply(409, { detail: "duplicate", error_code: "conflict" })).client
      .createReviewSession({ project_id: "p", model_version_id: "v", created_by: "u" } as never).catch((caught: unknown) => caught);
    expect(isQueuedForInstanceError(other)).toBe(false);
  });

  it("refuses a malformed A4 handoff, lease status and stage binding reply with a named code", async () => {
    const consume = await clientWith(reply(200, { nope: true })).client.consumeA4Handoff("s_1", "a4h_1", "u", "l").catch((e: unknown) => e);
    expect(consume).toMatchObject({ status: 502, errorCode: "a4_handoff_response_malformed" });
    const revisions = await clientWith(reply(200, {})).client.getStageBindingRevisions("s_1", "u").catch((e: unknown) => e);
    expect(revisions).toMatchObject({ status: 502, errorCode: "viewer_lease_status_malformed" });
    const preauth = await clientWith(reply(200, { status: "pending" })).client
      .preauthorizeStageBinding("s_1", {} as never, { userToken: "u", leaseToken: "l" }).catch((e: unknown) => e);
    expect(preauth).toMatchObject({ status: 502, errorCode: "stage_binding_preauthorization_malformed" });
  });
});

describe("requests", () => {
  it("sends each identity header only where the route needs it, and never in the URL", async () => {
    const { client: claimClient, fetchImpl: claimFetch } = clientWith(reply(200, { lease_id: "l_1" }));
    await claimClient.claimViewerLease("s_1", { viewer_id: "v_1" }, "user-token-secret");
    expect(initOf(claimFetch).headers).toEqual({
      Accept: "application/json", "Content-Type": "application/json", "X-User-Token": "user-token-secret",
    });
    expect(String(claimFetch.mock.calls[0][0])).not.toContain("secret");

    const { client: recreateClient, fetchImpl: recreateFetch } = clientWith(reply(201, { session_id: "s_2" }));
    await recreateClient.recreateReviewSession("s_1", "idem-key-1");
    expect(initOf(recreateFetch).headers).toMatchObject({ "Idempotency-Key": "idem-key-1" });

    const { client: stageClient, fetchImpl: stageFetch } = clientWith(reply(200, { cancelled: true }));
    await stageClient.cancelStageBinding("s_1", { source_client_id: "c", client_request_id: "r" }, { userToken: "u", leaseToken: "l" });
    expect(initOf(stageFetch).headers).toMatchObject({ "X-User-Token": "u", "X-Viewer-Lease-Token": "l" });
  });

  it("keeps lease release alive through page unload", async () => {
    const { client, fetchImpl } = clientWith(reply(200, { lease_id: "l_1" }));
    await client.releaseViewerLease("s_1", "l_1", "lease-token");
    expect(initOf(fetchImpl)).toMatchObject({ method: "POST", keepalive: true, body: "{}" });
  });

  it("sends the operator token only over a secure transport", async () => {
    const insecure = createCoordinatorClient({ baseUrl: "http://coordinator.example:8004", fetch: vi.fn() as unknown as typeof fetch });
    await expect(insecure.updateSessionIdlePolicy(60_000, 1, "epoch", "why", "operator-secret"))
      .rejects.toThrow("operator credential transport requires HTTPS or exact loopback HTTP");
    const { client, fetchImpl } = clientWith(reply(200, { revision: 2 }));
    await client.updateSessionIdlePolicy(60_000, 1, "epoch", "why", "operator-secret");
    expect(initOf(fetchImpl)).toMatchObject({ method: "PUT", headers: expect.objectContaining({ "X-Operator-Token": "operator-secret" }) });
  });

  it("percent-encodes path parameters and resolves the lease transport's methods at call time", async () => {
    const { client, fetchImpl } = clientWith(reply(200, {}));
    await client.streamConfig("s/1 ?#");
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/api/review-sessions/s%2F1%20%3F%23/stream-config`);
    const transport = client.viewerLeaseTransport();
    const claim = vi.spyOn(client, "claimViewerLease").mockResolvedValue({} as never);
    await transport.claim("s_1", { viewer_id: "v_1" }, "u");
    expect(claim).toHaveBeenCalledWith("s_1", { viewer_id: "v_1" }, "u");
  });
});

describe("timeout rule", () => {
  it("gives a call without a signal the instance's default timeout, and none when the instance has no default", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const console = clientWith(reply(200, {}), { timeoutMs: 15_000 });
    await console.client.runtimeStatus();
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(initOf(console.fetchImpl).signal).toBeInstanceOf(AbortSignal);
    timeout.mockClear();
    const viewer = clientWith(reply(200, {}));
    await viewer.client.getReviewSession("s_1");
    expect(timeout).not.toHaveBeenCalled();
    expect(initOf(viewer.fetchImpl)).not.toHaveProperty("signal");
  });

  it("lets a caller's signal win over the default timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const controller = new AbortController();
    const { client, fetchImpl } = clientWith(reply(200, { cancelled: true }), { timeoutMs: 15_000 });
    await client.cancelStageBinding("s_1", { source_client_id: "c", client_request_id: "r" }, { userToken: "u", leaseToken: "l" }, controller.signal);
    expect(initOf(fetchImpl).signal).toBe(controller.signal);
    expect(timeout).not.toHaveBeenCalled();
  });
});
