import { describe, expect, it, vi } from "vitest";
import { CoordinatorClient, CoordinatorHttpError } from "./coordinatorClient";

function jsonResponse(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("CoordinatorClient.closeReviewSession", () => {
    it("posts an exact cooperative-close body and validates the same closed session", async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(200, {
            session_id: "review_session_close_x",
            status: "closed",
        }));
        const client = new CoordinatorClient("http://127.0.0.1:8004", fetchImpl as typeof fetch);

        await expect(client.closeReviewSession("review_session_close_x")).resolves.toEqual({
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
        const client = new CoordinatorClient("http://127.0.0.1:8004", fetchImpl as typeof fetch);

        await expect(client.closeReviewSession(sessionId)).resolves.toEqual({
            session_id: sessionId,
            status: "closed",
        });
        expect(fetchImpl).toHaveBeenCalledWith(
            "http://127.0.0.1:8004/api/review-sessions/review_session_close%2Fx%20%3F%23/close",
            expect.objectContaining({ method: "POST", body: "{}" }),
        );
    });

    it.each([
        [{ session_id: "review_session_other", status: "closed" }],
        [{ session_id: "review_session_close_x", status: "closing" }],
        [{ status: "closed" }],
        [null],
    ])("rejects a malformed or mismatched close response", async (payload) => {
        const fetchImpl = vi.fn(async () => jsonResponse(200, payload));
        const client = new CoordinatorClient("http://127.0.0.1:8004", fetchImpl as typeof fetch);

        const error = await client.closeReviewSession("review_session_close_x").catch((caught) => caught);
        expect(error).toBeInstanceOf(CoordinatorHttpError);
        expect(error).toMatchObject({ status: 502, errorCode: "review_session_close_response_malformed" });
    });

    it("preserves the coordinator error code for a non-2xx close", async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(503, { error_code: "runtime_unavailable" }));
        const client = new CoordinatorClient("http://127.0.0.1:8004", fetchImpl as typeof fetch);

        const error = await client.closeReviewSession("review_session_close_x").catch((caught) => caught);
        expect(error).toBeInstanceOf(CoordinatorHttpError);
        expect(error).toMatchObject({ status: 503, errorCode: "runtime_unavailable" });
    });
});
