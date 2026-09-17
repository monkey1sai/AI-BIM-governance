import { describe, expect, it, vi } from "vitest";
import { CoordinatorClient, CoordinatorHttpError } from "./coordinatorClient";

const BASE = "http://127.0.0.1:8004";
const SESSION = "review_session_x";

function jsonResponse(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function clientWith(...responses: Response[]) {
    const fetchImpl = vi.fn(async () => {
        const next = responses.shift();
        if (!next) throw new Error("unexpected fetch");
        return next;
    });
    return { client: new CoordinatorClient(BASE, fetchImpl as unknown as typeof fetch), fetchImpl };
}

function requestOf(fetchImpl: ReturnType<typeof vi.fn>, index = 0): { url: string; init: RequestInit } {
    const [url, init] = fetchImpl.mock.calls[index] as [string, RequestInit];
    return { url, init };
}

const preauthorization = {
    status: "pending",
    session_id: SESSION,
    stage_binding_authorization_id: "stage_auth_001",
    binding_revision_id: "rev_001",
    pending_expires_at: "2026-09-16T12:00:30.000Z",
    stage_composition: {
        primary: { artifact_id: "artifact_primary", role: "primary", load_order: 0, usdc_url: "stage://p.usdc" },
        secondary_layers: [
            { artifact_id: "artifact_secondary", role: "secondary", load_order: 1, usdc_url: "stage://s.usdc" },
        ],
    },
};

describe("CoordinatorClient viewer lease transport", () => {
    it("claims with the user token header and the contract body", async () => {
        const granted = { lease_id: "lease_1", lease_token: "token_1", role: "primary" };
        const { client, fetchImpl } = clientWith(jsonResponse(200, granted));

        await expect(client.claimViewerLease(SESSION, { viewer_id: "viewer_1", requested_role: "primary" }, "user_1"))
            .resolves.toEqual(granted);

        const { url, init } = requestOf(fetchImpl);
        expect(url).toBe(`${BASE}/api/review-sessions/${SESSION}/viewer-leases/claim`);
        expect(init).toMatchObject({
            method: "POST",
            headers: expect.objectContaining({ "Content-Type": "application/json", "X-User-Token": "user_1" }),
        });
        expect(JSON.parse(String(init.body))).toEqual({ viewer_id: "viewer_1", requested_role: "primary" });
    });

    it("heartbeats with the lease token header and runtime evidence", async () => {
        const { client, fetchImpl } = clientWith(jsonResponse(200, { lease_id: "lease/1", heartbeat_after_ms: 15_000 }));

        await client.heartbeatViewerLease(SESSION, "lease/1", "token_1", { datachannel_ready: true });

        const { url, init } = requestOf(fetchImpl);
        expect(url).toBe(`${BASE}/api/review-sessions/${SESSION}/viewer-leases/lease%2F1/heartbeat`);
        expect(init.headers).toMatchObject({ "X-Viewer-Lease-Token": "token_1" });
        expect(JSON.parse(String(init.body))).toEqual({ datachannel_ready: true });
    });

    it("releases with keepalive so the request survives page unload", async () => {
        const { client, fetchImpl } = clientWith(jsonResponse(200, { lease_id: "lease_1", status: "released" }));

        await client.releaseViewerLease(SESSION, "lease_1", "token_1");

        const { url, init } = requestOf(fetchImpl);
        expect(url).toBe(`${BASE}/api/review-sessions/${SESSION}/viewer-leases/lease_1/release`);
        expect(init).toMatchObject({ method: "POST", keepalive: true, body: "{}" });
        expect(init.headers).toMatchObject({ "X-Viewer-Lease-Token": "token_1" });
    });

    it("surfaces the coordinator error code on failure", async () => {
        const { client } = clientWith(jsonResponse(404, {
            detail: "Viewer lease not found or token invalid.",
            error_code: "viewer_lease_not_found",
        }));

        const failure = client.heartbeatViewerLease(SESSION, "lease_1", "token_1", {});

        await expect(failure).rejects.toBeInstanceOf(CoordinatorHttpError);
        await expect(failure).rejects.toMatchObject({ status: 404, errorCode: "viewer_lease_not_found" });
    });

    it("exposes the three calls as a ViewerLeaseTransport with the same argument order", async () => {
        const { client, fetchImpl } = clientWith(
            jsonResponse(200, { lease_id: "lease_1", lease_token: "token_1", role: "primary" }),
            jsonResponse(200, { lease_id: "lease_1", heartbeat_after_ms: 15_000 }),
            jsonResponse(200, {}),
        );
        const transport = client.viewerLeaseTransport();

        await transport.claim(SESSION, { viewer_id: "viewer_1" }, "user_1");
        await transport.heartbeat(SESSION, "lease_1", "token_1", { first_frame: true });
        await transport.release(SESSION, "lease_1", "token_1");

        const claim = requestOf(fetchImpl, 0);
        expect(claim.url).toBe(`${BASE}/api/review-sessions/${SESSION}/viewer-leases/claim`);
        expect(claim.init.headers).toMatchObject({ "X-User-Token": "user_1" });
        const heartbeat = requestOf(fetchImpl, 1);
        expect(heartbeat.url).toBe(`${BASE}/api/review-sessions/${SESSION}/viewer-leases/lease_1/heartbeat`);
        expect(heartbeat.init.headers).toMatchObject({ "X-Viewer-Lease-Token": "token_1" });
        expect(JSON.parse(String(heartbeat.init.body))).toEqual({ first_frame: true });
        const release = requestOf(fetchImpl, 2);
        expect(release.url).toBe(`${BASE}/api/review-sessions/${SESSION}/viewer-leases/lease_1/release`);
        expect(release.init).toMatchObject({ keepalive: true, headers: expect.objectContaining({ "X-Viewer-Lease-Token": "token_1" }) });
    });
});

describe("CoordinatorClient stage binding", () => {
    const credentials = { userToken: "user_1", leaseToken: "token_1" };
    const body = {
        source_client_id: "lease_1",
        role: "primary" as const,
        client_request_id: "stage_preauth_1",
        artifacts: [{ artifact_id: "artifact_primary", role: "primary" as const, load_order: 0 }],
    };

    it("preauthorizes with both credential headers and returns the validated transaction", async () => {
        const { client, fetchImpl } = clientWith(jsonResponse(200, preauthorization));
        const controller = new AbortController();

        await expect(client.preauthorizeStageBinding(SESSION, body, credentials, controller.signal))
            .resolves.toEqual(preauthorization);

        const { url, init } = requestOf(fetchImpl);
        expect(url).toBe(`${BASE}/api/review-sessions/${SESSION}/stage-binding`);
        expect(init).toMatchObject({
            method: "POST",
            signal: controller.signal,
            headers: expect.objectContaining({ "X-User-Token": "user_1", "X-Viewer-Lease-Token": "token_1" }),
        });
        expect(JSON.parse(String(init.body))).toEqual(body);
    });

    it.each([
        ["a non-pending status", { ...preauthorization, status: "active" }],
        ["another session", { ...preauthorization, session_id: "review_session_other" }],
        ["a missing revision", { ...preauthorization, binding_revision_id: "" }],
        ["a primary without usdc_url", {
            ...preauthorization,
            stage_composition: { ...preauthorization.stage_composition, primary: { artifact_id: "a", role: "primary" } },
        }],
        ["a secondary with the wrong role", {
            ...preauthorization,
            stage_composition: {
                ...preauthorization.stage_composition,
                secondary_layers: [{ artifact_id: "b", role: "primary", usdc_url: "stage://b.usdc" }],
            },
        }],
    ])("rejects a preauthorization with %s", async (_label, payload) => {
        const { client } = clientWith(jsonResponse(200, payload));

        await expect(client.preauthorizeStageBinding(SESSION, body, credentials))
            .rejects.toMatchObject({ status: 502, errorCode: "stage_binding_preauthorization_malformed" });
    });

    it("reports a refused preauthorization with its status", async () => {
        const { client } = clientWith(jsonResponse(409, { detail: "busy", error_code: "stage_binding_conflict" }));

        await expect(client.preauthorizeStageBinding(SESSION, body, credentials))
            .rejects.toMatchObject({ status: 409, errorCode: "stage_binding_conflict" });
    });

    it("cancels a preauthorization with both credential headers", async () => {
        const { client, fetchImpl } = clientWith(jsonResponse(200, { status: "cancelled" }));

        await client.cancelStageBinding(
            SESSION,
            { source_client_id: "lease_1", client_request_id: "stage_preauth_1" },
            credentials,
        );

        const { url, init } = requestOf(fetchImpl);
        expect(url).toBe(`${BASE}/api/review-sessions/${SESSION}/stage-binding-cancellations`);
        expect(init.headers).toMatchObject({ "X-User-Token": "user_1", "X-Viewer-Lease-Token": "token_1" });
        expect(JSON.parse(String(init.body))).toEqual({ source_client_id: "lease_1", client_request_id: "stage_preauth_1" });
    });

    it("reads the stage binding revisions with the user token only", async () => {
        const { client, fetchImpl } = clientWith(jsonResponse(200, {
            stage_binding: { active_binding_revision: "rev_7", last_good_binding_revision: "rev_6" },
        }));

        await expect(client.getStageBindingRevisions(SESSION, "user_1")).resolves.toEqual({ active: "rev_7", lastGood: "rev_6" });

        const { url, init } = requestOf(fetchImpl);
        expect(url).toBe(`${BASE}/api/review-sessions/${SESSION}/viewer-leases/status`);
        expect(init.headers).toEqual({ Accept: "application/json", "X-User-Token": "user_1" });
    });

    it("rejects a lease status without a stage binding block", async () => {
        const { client } = clientWith(jsonResponse(200, { leases: [] }));

        await expect(client.getStageBindingRevisions(SESSION, "user_1"))
            .rejects.toMatchObject({ status: 502, errorCode: "viewer_lease_status_malformed" });
    });

    it("reports missing revisions as null", async () => {
        const { client } = clientWith(jsonResponse(200, { stage_binding: { active_binding_revision: null } }));

        await expect(client.getStageBindingRevisions(SESSION, "user_1")).resolves.toEqual({ active: null, lastGood: null });
    });
});
