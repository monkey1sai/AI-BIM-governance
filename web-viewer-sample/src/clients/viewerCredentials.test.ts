import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimViewerLeaseResponse, HeartbeatViewerLeaseResponse } from "../contract/coordinatorApi";
import { CoordinatorHttpError } from "./coordinatorClient";
import {
    createBorrowedViewerCredentials,
    createHeldViewerCredentials,
    type HeldViewerCredentialsOptions,
    type ViewerCredentials,
    type ViewerLeaseTransport,
} from "./viewerCredentials";

const SESSION = "review_session_x";
const NOW = Date.parse("2026-09-16T12:00:00.000Z");

function lease(overrides: Partial<ClaimViewerLeaseResponse> = {}): ClaimViewerLeaseResponse {
    return {
        lease_id: "viewer_lease_primary",
        lease_token: "lease_token_primary",
        role: "primary",
        expires_at: new Date(Date.now() + 45_000).toISOString(),
        heartbeat_after_ms: 15_000,
        ...overrides,
    } as ClaimViewerLeaseResponse;
}

function refreshed(overrides: Partial<HeartbeatViewerLeaseResponse> = {}): HeartbeatViewerLeaseResponse {
    return {
        lease_id: "viewer_lease_primary",
        expires_at: new Date(Date.now() + 45_000).toISOString(),
        heartbeat_after_ms: 15_000,
        ...overrides,
    } as HeartbeatViewerLeaseResponse;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function fakeTransport() {
    const transport = {
        claim: vi.fn<ViewerLeaseTransport["claim"]>(async () => lease()),
        heartbeat: vi.fn<ViewerLeaseTransport["heartbeat"]>(async () => refreshed()),
        release: vi.fn<ViewerLeaseTransport["release"]>(async () => undefined),
    };
    return transport;
}

function held(transport: ViewerLeaseTransport, overrides: Partial<HeldViewerCredentialsOptions> = {}) {
    return createHeldViewerCredentials({
        sessionId: SESSION,
        userToken: "standalone_viewer_operator_1",
        fallbackSourceClientId: "dev_user_001",
        transport,
        claimRequest: (attempt) => ({
            viewer_id: "dev_user_001",
            requested_role: "primary",
            client_nonce: `nonce:${attempt}`,
        }),
        ...overrides,
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("held Viewer Credentials：claim", () => {
    it("starts without a lease and falls back to the configured source client id", () => {
        const source = held(fakeTransport());

        expect(source.current()).toMatchObject({
            userToken: "standalone_viewer_operator_1",
            leaseId: null,
            leaseToken: null,
            sourceClientId: "dev_user_001",
            loss: null,
        });
    });

    it("sends one claim for concurrent ensure() calls and publishes the lease", async () => {
        const transport = fakeTransport();
        const source = held(transport);
        const before = source.current();
        const listener = vi.fn();
        source.subscribe(listener);

        const [first, second] = await Promise.all([source.ensure(), source.ensure()]);

        expect(transport.claim).toHaveBeenCalledTimes(1);
        expect(transport.claim).toHaveBeenCalledWith(
            SESSION,
            { viewer_id: "dev_user_001", requested_role: "primary", client_nonce: "nonce:1" },
            "standalone_viewer_operator_1",
        );
        expect(first).toBe(second);
        expect(first).toMatchObject({
            leaseId: "viewer_lease_primary",
            leaseToken: "lease_token_primary",
            sourceClientId: "viewer_lease_primary",
        });
        expect(first?.epoch).not.toBe(before.epoch);
        expect(listener).toHaveBeenCalledWith(first);
    });

    it("reuses a fresh lease without claiming again", async () => {
        const transport = fakeTransport();
        const source = held(transport);

        await source.ensure();
        await source.ensure();

        expect(transport.claim).toHaveBeenCalledTimes(1);
    });

    it("reports a failed claim as a loss with the coordinator error code and keeps no lease", async () => {
        const transport = fakeTransport();
        transport.claim.mockRejectedValueOnce(new CoordinatorHttpError(409, "/claim", "primary_already_claimed"));
        const source = held(transport);

        await expect(source.ensure()).resolves.toBeNull();

        expect(source.current()).toMatchObject({
            leaseToken: null,
            leaseDetails: null,
            sourceClientId: "dev_user_001",
            loss: { reason: "claim_failed", status: 409, errorCode: "primary_already_claimed" },
        });
    });

    it("publishes the lease details the coordinator assigned", async () => {
        const transport = fakeTransport();
        transport.claim.mockResolvedValueOnce(lease({
            kit_instance_id: "kit_local_001",
            user_id: "local_user",
            display_name: "Review Room",
        }));
        const source = held(transport);

        await expect(source.ensure()).resolves.toMatchObject({
            leaseDetails: { kitInstanceId: "kit_local_001", userId: "local_user", displayName: "Review Room" },
        });
    });

    it("rejects a claim response that is not an unexpired primary lease", async () => {
        const transport = fakeTransport();
        transport.claim.mockResolvedValueOnce(lease({ role: "spectator" }));
        const source = held(transport);

        await expect(source.ensure()).resolves.toBeNull();

        expect(source.current().loss).toMatchObject({ reason: "claim_rejected" });
    });

    it("releases a rejected claim that still carries a lease and reports why it was rejected", async () => {
        const transport = fakeTransport();
        transport.claim.mockResolvedValueOnce(lease({ heartbeat_after_ms: Number.NaN }));
        const source = held(transport);

        await expect(source.ensure()).resolves.toBeNull();

        expect(source.current().loss).toMatchObject({ reason: "claim_rejected", detail: "heartbeat_after_ms missing" });
        expect(transport.release).toHaveBeenCalledWith(SESSION, "viewer_lease_primary", "lease_token_primary");
    });

    it("measures expiry from the coordinator's own clock when the local clock runs ahead", async () => {
        const transport = fakeTransport();
        const serverNow = NOW - 60_000;
        transport.claim.mockResolvedValueOnce(lease({
            claimed_at: new Date(serverNow).toISOString(),
            expires_at: new Date(serverNow + 45_000).toISOString(),
        }));
        transport.heartbeat.mockImplementation(async () => {
            const heartbeatAt = serverNow + (Date.now() - NOW);
            return refreshed({
                last_heartbeat_at: new Date(heartbeatAt).toISOString(),
                expires_at: new Date(heartbeatAt + 45_000).toISOString(),
            });
        });
        const source = held(transport);

        await expect(source.ensure()).resolves.toMatchObject({ leaseToken: "lease_token_primary" });
        await vi.advanceTimersByTimeAsync(40_000);
        expect(source.current().leaseToken).toBe("lease_token_primary");
        expect(transport.heartbeat).toHaveBeenCalledTimes(2);
    });

    it("measures expiry from the coordinator's own clock when the local clock runs behind", async () => {
        const transport = fakeTransport();
        transport.heartbeat.mockImplementation(() => new Promise(() => {}));
        const serverNow = NOW + 60_000;
        transport.claim.mockResolvedValueOnce(lease({
            claimed_at: new Date(serverNow).toISOString(),
            expires_at: new Date(serverNow + 45_000).toISOString(),
        }));
        const source = held(transport);
        await source.ensure();

        vi.setSystemTime(NOW + 46_000);

        expect(source.current()).toMatchObject({ leaseToken: null, loss: { reason: "expired" } });
    });

    it("does not claim again on its own after the lease is lost", async () => {
        const transport = fakeTransport();
        transport.heartbeat.mockRejectedValueOnce(new CoordinatorHttpError(404, "/heartbeat", "viewer_lease_not_found"));
        const source = held(transport);
        await source.ensure();

        await vi.advanceTimersByTimeAsync(15_000);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(transport.claim).toHaveBeenCalledTimes(1);

        await source.ensure();
        expect(transport.claim).toHaveBeenCalledTimes(2);
        expect(transport.claim.mock.calls[1][1]).toMatchObject({ client_nonce: "nonce:2" });
    });
});

describe("held Viewer Credentials：heartbeat", () => {
    it("heartbeats at the server interval, refreshes expiry and keeps the credential epoch", async () => {
        const transport = fakeTransport();
        const source = held(transport, {
            heartbeatEvidence: () => ({ datachannel_ready: true, loaded_stage_url: "stage://a.usdc" }),
        });
        const granted = await source.ensure();

        await vi.advanceTimersByTimeAsync(14_999);
        expect(transport.heartbeat).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        expect(transport.heartbeat).toHaveBeenCalledWith(
            SESSION,
            "viewer_lease_primary",
            "lease_token_primary",
            { datachannel_ready: true, loaded_stage_url: "stage://a.usdc" },
        );
        expect(source.current().epoch).toBe(granted?.epoch);

        // The refreshed expiry keeps the lease alive past the original 45 s.
        await vi.advanceTimersByTimeAsync(40_000);
        expect(source.current().leaseToken).toBe("lease_token_primary");
        expect(transport.heartbeat).toHaveBeenCalledTimes(3);
    });

    it("applies the shared heartbeat floor to a too-short server interval", async () => {
        const transport = fakeTransport();
        transport.claim.mockResolvedValueOnce(lease({ heartbeat_after_ms: 10 }));
        const source = held(transport);
        await source.ensure();

        await vi.advanceTimersByTimeAsync(4_999);
        expect(transport.heartbeat).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    });

    it("falls back to the default interval when the server interval is not positive", async () => {
        const transport = fakeTransport();
        transport.claim.mockResolvedValueOnce(lease({ heartbeat_after_ms: 0 }));
        const source = held(transport);
        await source.ensure();

        await vi.advanceTimersByTimeAsync(14_999);
        expect(transport.heartbeat).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    });

    it("heartbeatNow() sends the given evidence at once and restarts the interval", async () => {
        const transport = fakeTransport();
        const source = held(transport, { heartbeatEvidence: () => ({ datachannel_ready: false }) });
        await source.ensure();
        await vi.advanceTimersByTimeAsync(10_000);

        await source.heartbeatNow({ first_frame: true, datachannel_ready: true });

        expect(transport.heartbeat).toHaveBeenLastCalledWith(
            SESSION,
            "viewer_lease_primary",
            "lease_token_primary",
            { first_frame: true, datachannel_ready: true },
        );
        await vi.advanceTimersByTimeAsync(14_999);
        expect(transport.heartbeat).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(transport.heartbeat).toHaveBeenCalledTimes(2);
        expect(transport.heartbeat).toHaveBeenLastCalledWith(SESSION, "viewer_lease_primary", "lease_token_primary", { datachannel_ready: false });
    });

    it("heartbeatNow() drops a lease the coordinator no longer has but ignores transient failures", async () => {
        const transport = fakeTransport();
        const source = held(transport);
        await source.ensure();

        transport.heartbeat.mockRejectedValueOnce(new Error("offline"));
        await source.heartbeatNow({ first_frame: true });
        expect(source.current().leaseToken).toBe("lease_token_primary");
        await vi.advanceTimersByTimeAsync(15_000);
        expect(transport.heartbeat).toHaveBeenCalledTimes(2);

        transport.heartbeat.mockRejectedValueOnce(new CoordinatorHttpError(404, "/heartbeat", "viewer_lease_not_found"));
        await source.heartbeatNow({ first_frame: true });
        expect(source.current()).toMatchObject({
            leaseToken: null,
            loss: { reason: "lease_gone", status: 404, errorCode: "viewer_lease_not_found" },
        });
    });

    it("heartbeatNow() does nothing without a lease", async () => {
        const transport = fakeTransport();
        const source = held(transport);

        await source.heartbeatNow({ first_frame: true });

        expect(transport.heartbeat).not.toHaveBeenCalled();
    });

    it.each([
        ["viewer_lease_not_found", 404],
        ["review_session_not_found", 404],
        ["review_session_not_active", 409],
    ])("drops the lease at once when the heartbeat answers %s (%i)", async (code, status) => {
        const transport = fakeTransport();
        transport.heartbeat.mockRejectedValueOnce(new CoordinatorHttpError(status, "/heartbeat", code));
        const source = held(transport);
        const granted = await source.ensure();

        await vi.advanceTimersByTimeAsync(15_000);

        const after = source.current();
        expect(after).toMatchObject({ leaseToken: null, sourceClientId: "dev_user_001", loss: { reason: "lease_gone", status } });
        expect(after.epoch).not.toBe(granted?.epoch);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    });

    it("keeps the lease across transient failures and drops it only when it expires", async () => {
        const transport = fakeTransport();
        transport.heartbeat.mockRejectedValue(new CoordinatorHttpError(503, "/heartbeat", "production_identity_unavailable"));
        const source = held(transport);
        await source.ensure();

        await vi.advanceTimersByTimeAsync(15_000);
        expect(source.current().leaseToken).toBe("lease_token_primary");
        await vi.advanceTimersByTimeAsync(15_000);
        expect(source.current().leaseToken).toBe("lease_token_primary");
        expect(transport.heartbeat).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(15_000);

        expect(source.current()).toMatchObject({ leaseToken: null, loss: { reason: "expired" } });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(transport.heartbeat).toHaveBeenCalledTimes(2);
    });

    it("keeps heartbeating when the evidence provider throws", async () => {
        const transport = fakeTransport();
        const evidence = vi.fn(() => ({ datachannel_ready: true }));
        evidence.mockImplementationOnce(() => { throw new Error("evidence unavailable"); });
        const source = held(transport, { heartbeatEvidence: evidence });
        await source.ensure();

        await vi.advanceTimersByTimeAsync(15_000);
        expect(transport.heartbeat).not.toHaveBeenCalled();
        expect(source.current().leaseToken).toBe("lease_token_primary");

        await vi.advanceTimersByTimeAsync(15_000);
        expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    });

    it("treats a malformed heartbeat response as transient", async () => {
        const transport = fakeTransport();
        transport.heartbeat.mockResolvedValueOnce(refreshed({ lease_id: "someone_else" }));
        const source = held(transport);
        await source.ensure();

        await vi.advanceTimersByTimeAsync(15_000);
        expect(source.current().leaseToken).toBe("lease_token_primary");
        await vi.advanceTimersByTimeAsync(15_000);
        expect(transport.heartbeat).toHaveBeenCalledTimes(2);
    });

    it("drops an expired lease when it is read, and claims a new one on ensure()", async () => {
        const transport = fakeTransport();
        transport.heartbeat.mockImplementation(() => new Promise(() => {}));
        const source = held(transport);
        await source.ensure();

        vi.setSystemTime(NOW + 46_000);

        expect(source.current()).toMatchObject({ leaseToken: null, loss: { reason: "expired" } });
        transport.claim.mockResolvedValueOnce(lease({ lease_id: "viewer_lease_2", lease_token: "lease_token_2" }));
        await expect(source.ensure()).resolves.toMatchObject({ leaseToken: "lease_token_2" });
    });
});

describe("held Viewer Credentials：release, renew, dispose", () => {
    it("release() drops the lease after the coordinator confirms, sending one request for concurrent calls", async () => {
        const transport = fakeTransport();
        const source = held(transport);
        await source.ensure();

        await Promise.all([source.release(), source.release()]);

        expect(transport.release).toHaveBeenCalledTimes(1);
        expect(transport.release).toHaveBeenCalledWith(SESSION, "viewer_lease_primary", "lease_token_primary");
        expect(source.current()).toMatchObject({ leaseToken: null, loss: { reason: "released" } });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(transport.heartbeat).not.toHaveBeenCalled();
    });

    it("a failed release keeps the lease and can be retried", async () => {
        const transport = fakeTransport();
        transport.release.mockRejectedValueOnce(new Error("offline"));
        const source = held(transport);
        await source.ensure();

        await expect(source.release()).rejects.toThrow("offline");
        expect(source.current().leaseToken).toBe("lease_token_primary");

        await source.release();
        expect(transport.release).toHaveBeenCalledTimes(2);
        expect(source.current().leaseToken).toBeNull();
    });

    it("renew() releases the current lease before claiming a new one", async () => {
        const transport = fakeTransport();
        const order: string[] = [];
        transport.release.mockImplementation(async () => { order.push("release"); });
        transport.claim.mockImplementation(async () => {
            order.push("claim");
            return order.length === 1 ? lease() : lease({ lease_id: "viewer_lease_2", lease_token: "lease_token_2" });
        });
        const source = held(transport);
        await source.ensure();

        await expect(source.renew()).resolves.toMatchObject({ leaseId: "viewer_lease_2" });
        expect(order).toEqual(["claim", "release", "claim"]);
    });

    it("release() treats a lease the coordinator no longer has as released", async () => {
        const transport = fakeTransport();
        transport.release.mockRejectedValueOnce(new CoordinatorHttpError(404, "/release", "viewer_lease_not_found"));
        const source = held(transport);
        await source.ensure();

        await expect(source.release()).resolves.toBeUndefined();

        expect(source.current()).toMatchObject({ leaseToken: null, loss: { reason: "lease_gone", status: 404 } });
        transport.claim.mockResolvedValueOnce(lease({ lease_id: "viewer_lease_2", lease_token: "lease_token_2" }));
        await expect(source.ensure()).resolves.toMatchObject({ leaseToken: "lease_token_2" });
    });

    it("renew() after dispose() sends no claim", async () => {
        const transport = fakeTransport();
        const pendingRelease = deferred<void>();
        transport.release.mockReturnValueOnce(pendingRelease.promise);
        const source = held(transport);
        await source.ensure();

        const renewed = source.renew();
        await vi.advanceTimersByTimeAsync(0);
        source.dispose();
        pendingRelease.resolve();

        await expect(renewed).resolves.toBeNull();
        expect(transport.claim).toHaveBeenCalledTimes(1);
    });

    it("renew() does not claim when the release fails", async () => {
        const transport = fakeTransport();
        transport.release.mockRejectedValueOnce(new Error("offline"));
        const source = held(transport);
        await source.ensure();

        await expect(source.renew()).rejects.toThrow("offline");
        expect(transport.claim).toHaveBeenCalledTimes(1);
    });

    it("dispose() releases the held lease and stops heartbeats", async () => {
        const transport = fakeTransport();
        const source = held(transport);
        await source.ensure();
        const listener = vi.fn();
        source.subscribe(listener);

        source.dispose();

        expect(transport.release).toHaveBeenCalledWith(SESSION, "viewer_lease_primary", "lease_token_primary");
        expect(source.current().leaseToken).toBeNull();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(transport.heartbeat).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
        await expect(source.ensure()).resolves.toBeNull();
        expect(transport.claim).toHaveBeenCalledTimes(1);
    });

    it("dispose() does not send a second release while one for the same lease is in flight", async () => {
        const transport = fakeTransport();
        const pendingRelease = deferred<void>();
        transport.release.mockReturnValueOnce(pendingRelease.promise);
        const source = held(transport);
        await source.ensure();

        const released = source.release();
        await vi.advanceTimersByTimeAsync(0);
        source.dispose();
        pendingRelease.resolve();
        await released;

        expect(transport.release).toHaveBeenCalledTimes(1);
    });

    it("a claim that resolves after dispose() is released, not published", async () => {
        const transport = fakeTransport();
        const pending = deferred<ClaimViewerLeaseResponse>();
        transport.claim.mockReturnValueOnce(pending.promise);
        const source = held(transport);
        const listener = vi.fn();
        source.subscribe(listener);

        const ensured = source.ensure();
        source.dispose();
        pending.resolve(lease({ lease_id: "late_lease", lease_token: "late_token" }));

        await expect(ensured).resolves.toBeNull();
        expect(transport.release).toHaveBeenCalledWith(SESSION, "late_lease", "late_token");
        expect(listener).not.toHaveBeenCalled();
        expect(source.current().leaseToken).toBeNull();
    });

    it("a heartbeat answer for a released lease is ignored", async () => {
        const transport = fakeTransport();
        const pending = deferred<HeartbeatViewerLeaseResponse>();
        transport.heartbeat.mockReturnValueOnce(pending.promise);
        const source = held(transport);
        await source.ensure();
        await vi.advanceTimersByTimeAsync(15_000);

        await source.release();
        pending.reject(new CoordinatorHttpError(404, "/heartbeat", "viewer_lease_not_found"));
        await vi.advanceTimersByTimeAsync(0);

        expect(source.current().loss).toMatchObject({ reason: "released" });
    });
});

describe("borrowed Viewer Credentials", () => {
    it("never claims; ensure() only returns a credential the parent supplied", async () => {
        const source = createBorrowedViewerCredentials({ sourceClientId: "viewer_lease_parent" });

        expect(source.current()).toMatchObject({ userToken: "", leaseId: null, leaseToken: null, sourceClientId: "viewer_lease_parent" });
        await expect(source.ensure()).resolves.toBeNull();
        await expect(source.renew()).resolves.toBeNull();

        source.accept({ leaseToken: "parent_lease_token", userToken: "parent_user_token" });

        await expect(source.ensure()).resolves.toMatchObject({
            userToken: "parent_user_token",
            leaseId: "viewer_lease_parent",
            leaseToken: "parent_lease_token",
            sourceClientId: "viewer_lease_parent",
        });
    });

    it("changes the epoch only when the supplied credential changes", () => {
        const source = createBorrowedViewerCredentials({ sourceClientId: "viewer_lease_parent" });
        const listener = vi.fn<(credentials: ViewerCredentials) => void>();
        source.subscribe(listener);

        source.accept({ leaseToken: "t1", userToken: "u1" });
        const first = source.current();
        source.accept({ leaseToken: "t1" });
        expect(source.current()).toBe(first);
        source.accept({ leaseToken: "t2" });

        expect(listener).toHaveBeenCalledTimes(2);
        expect(source.current()).toMatchObject({ leaseToken: "t2", userToken: "u1" });
        expect(source.current().epoch).not.toBe(first.epoch);
    });

    it("an empty token withdraws the lease but keeps the source client id", () => {
        const source = createBorrowedViewerCredentials({
            sourceClientId: "viewer_lease_parent",
            initial: { leaseToken: "t1", userToken: "u1" },
        });

        source.accept({ leaseToken: "" });

        expect(source.current()).toMatchObject({ leaseId: null, leaseToken: null, userToken: "u1", sourceClientId: "viewer_lease_parent" });
    });

    it("release() leaves the parent's lease alone and dispose() stops further updates", async () => {
        const source = createBorrowedViewerCredentials({
            sourceClientId: "viewer_lease_parent",
            initial: { leaseToken: "t1" },
        });
        const listener = vi.fn();
        source.subscribe(listener);

        await source.release();
        expect(source.current().leaseToken).toBe("t1");

        source.dispose();
        source.accept({ leaseToken: "t2" });
        expect(listener).not.toHaveBeenCalled();
        expect(source.current().leaseToken).toBeNull();
    });

    it("epochs stay unique across instances", () => {
        const a = createBorrowedViewerCredentials({ sourceClientId: "x" });
        const b = createBorrowedViewerCredentials({ sourceClientId: "x" });
        expect(a.current().epoch).not.toBe(b.current().epoch);
    });
});
