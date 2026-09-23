import { describe, expect, it, vi } from "vitest";
import { createCoordinatorClient, CoordinatorHttpError } from "../coordinatorClient";

function jsonResponse(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("Coordinator Browser Client sessionClose", () => {
    it("posts an exact cooperative-close body", async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(200, {
            session_id: "review_session_close_x",
            status: "closed",
        }));
        const client = createCoordinatorClient({ baseUrl: "http://127.0.0.1:8004", fetch: fetchImpl as typeof fetch });

        await expect(client.sessionClose("review_session_close_x")).resolves.toEqual({
            session_id: "review_session_close_x",
            status: "closed",
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl).toHaveBeenCalledWith(
            "http://127.0.0.1:8004/api/review-sessions/review_session_close_x/close",
            {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: "{}",
            },
        );
    });

    it("percent-encodes reserved session-id characters in the close path", async () => {
        const sessionId = "review_session_close/x ?#";
        const fetchImpl = vi.fn(async () => jsonResponse(200, {
            session_id: sessionId,
            status: "closed",
        }));
        const client = createCoordinatorClient({ baseUrl: "http://127.0.0.1:8004", fetch: fetchImpl as typeof fetch });

        await expect(client.sessionClose(sessionId)).resolves.toEqual({
            session_id: sessionId,
            status: "closed",
        });
        expect(fetchImpl).toHaveBeenCalledWith(
            "http://127.0.0.1:8004/api/review-sessions/review_session_close%2Fx%20%3F%23/close",
            expect.objectContaining({ method: "POST", body: "{}" }),
        );
    });

    it("preserves the coordinator error code for a non-2xx close", async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(503, { error_code: "runtime_unavailable" }));
        const client = createCoordinatorClient({ baseUrl: "http://127.0.0.1:8004", fetch: fetchImpl as typeof fetch });

        const error = await client.sessionClose("review_session_close_x").catch((caught) => caught);
        expect(error).toBeInstanceOf(CoordinatorHttpError);
        expect(error).toMatchObject({ status: 503, errorCode: "runtime_unavailable" });
    });
});

describe("Coordinator Browser Client recordSessionActivity", () => {
    it("binds activity to the caller's viewer lease id and token", async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(200, {
            ok: true,
            session_id: "review_session_activity_x",
            recorded_at: "2026-08-31T00:00:00.000Z",
        }));
        const client = createCoordinatorClient({ baseUrl: "http://127.0.0.1:8004", fetch: fetchImpl as typeof fetch });

        await expect(client.recordSessionActivity(
            "review_session_activity_x",
            "viewer_lease_x",
            "lease_token_x",
        )).resolves.toMatchObject({ ok: true, session_id: "review_session_activity_x" });
        expect(fetchImpl).toHaveBeenCalledWith(
            "http://127.0.0.1:8004/api/review-sessions/review_session_activity_x/activity",
            {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "X-Viewer-Lease-Token": "lease_token_x",
                },
                body: JSON.stringify({ lease_id: "viewer_lease_x" }),
            },
        );
    });
});

describe("Coordinator Browser Client getSessionIdleStatus", () => {
    it("preserves disabled and untracked nullable status fields", async () => {
        const payload = {
            session_id: "review_session_idle_x",
            enabled: false,
            has_connected_viewer: false,
            is_counting_down: false,
            remaining_seconds: null,
            last_activity_at: null,
        };
        const fetchImpl = vi.fn(async () => jsonResponse(200, payload));
        const client = createCoordinatorClient({ baseUrl: "http://127.0.0.1:8004", fetch: fetchImpl as typeof fetch });

        await expect(client.getSessionIdleStatus(payload.session_id)).resolves.toEqual(payload);
        expect(fetchImpl).toHaveBeenCalledWith(
            "http://127.0.0.1:8004/api/review-sessions/review_session_idle_x/idle-status",
            { headers: { Accept: "application/json" } },
        );
    });
});
