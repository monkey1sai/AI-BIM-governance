// Coordinator Browser Client tests (docs/architecture/coordinator-browser-client-adr.md): the transport's error mode,
// headers, keepalive, the queued-for-instance conflict, the malformed-reply checks and the timeout rule, through the
// client's own interface with a fake fetch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorClient } from "./client";
import {
  CoordinatorHttpError,
  isCoordinatorNotFound,
  isDevRoutesDisabled,
  isQueuedForInstanceError,
  QueuedForInstanceError,
} from "./errors";

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
