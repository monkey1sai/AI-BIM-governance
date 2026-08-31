import type { ReviewSession, ReviewStreamConfig } from "../types/review";
import type { ArtifactBinding } from "../types/artifacts";
import {
    parseA4HandoffIntent,
    parseA4ViewerLeaseStatus,
    type A4HandoffIntent,
    type A4ViewerLeaseStatus,
} from "./a4Handoff";

export interface CreateReviewSessionInput {
    review_request_id?: string;
    tenant_id?: string;
    project_id: string;
    model_version_id: string;
    created_by: string;
    mode?: string;
    routing_policy?: "same_instance" | "dedicated_instance" | "shared_state";
    artifact_bindings?: ArtifactBinding[];
    kit_profile?: Record<string, unknown>;
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export interface QueuedForInstanceResponse {
    detail?: string;
    status: "queued_for_instance";
    artifact_bindings: ArtifactBinding[];
}

export interface CloseReviewSessionResponse {
    session_id: string;
    status: "closed";
}

export class QueuedForInstanceError extends Error {
    constructor(readonly response: QueuedForInstanceResponse) {
        super(response.detail || "No Kit capacity available.");
        this.name = "QueuedForInstanceError";
    }
}

export function isQueuedForInstanceError(error: unknown): error is QueuedForInstanceError {
    return error instanceof QueuedForInstanceError;
}

export class CoordinatorHttpError extends Error {
    constructor(
        readonly status: number,
        readonly path: string,
        readonly errorCode: string,
    ) {
        super(`Coordinator request failed: ${status} ${path} (${errorCode})`);
        this.name = "CoordinatorHttpError";
    }
}

export class CoordinatorClient {
    constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = defaultFetch) {}

    async createReviewSession(input: CreateReviewSessionInput): Promise<ReviewSession> {
        const path = "/api/review-sessions";
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({
                ...input,
                mode: input.mode || "single_kit_shared_state",
                routing_policy: input.routing_policy || "same_instance",
                artifact_bindings: input.artifact_bindings || [],
                kit_profile: input.kit_profile || {},
                options: { auto_allocate_kit: true },
            }),
        });
        if (response.status === 409) {
            const payload = await readJson(response);
            if (isQueuedForInstanceResponse(payload)) {
                throw new QueuedForInstanceError(payload);
            }
        }
        if (!response.ok) {
            throw new Error(`Coordinator request failed: ${response.status} ${path}`);
        }
        return response.json() as Promise<ReviewSession>;
    }

    async getReviewSession(sessionId: string): Promise<ReviewSession> {
        return this.request<ReviewSession>(`/api/review-sessions/${sessionId}`);
    }

    async getStreamConfig(sessionId: string): Promise<ReviewStreamConfig> {
        return this.request<ReviewStreamConfig>(`/api/review-sessions/${sessionId}/stream-config`);
    }

    async closeReviewSession(sessionId: string): Promise<CloseReviewSessionResponse> {
        const path = `/api/review-sessions/${encodeURIComponent(sessionId)}/close`;
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: "{}",
        });
        const payload = await readJson(response);
        if (!response.ok) throw coordinatorHttpError(response.status, path, payload);
        if (!isCloseReviewSessionResponse(payload, sessionId)) {
            throw new CoordinatorHttpError(502, path, "review_session_close_response_malformed");
        }
        return payload;
    }

    async consumeA4Handoff(
        sessionId: string,
        handoffId: string,
        userToken: string,
        viewerLeaseToken: string,
    ): Promise<A4HandoffIntent> {
        const path = `/api/review-sessions/${encodeURIComponent(sessionId)}/a4-handoffs/${encodeURIComponent(handoffId)}/consume`;
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-User-Token": userToken,
                "X-Viewer-Lease-Token": viewerLeaseToken,
            },
            body: "{}",
        });
        const payload = await readJson(response);
        if (!response.ok) throw coordinatorHttpError(response.status, path, payload);
        const parsed = parseA4HandoffIntent(payload, handoffId);
        if (!parsed) throw new CoordinatorHttpError(502, path, "a4_handoff_response_malformed");
        return parsed;
    }

    async getA4ViewerLeaseStatus(
        sessionId: string,
        userToken: string,
        viewerLeaseToken: string,
    ): Promise<A4ViewerLeaseStatus> {
        const path = `/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/status`;
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            headers: {
                Accept: "application/json",
                "X-User-Token": userToken,
                "X-Viewer-Lease-Token": viewerLeaseToken,
            },
        });
        const payload = await readJson(response);
        if (!response.ok) throw coordinatorHttpError(response.status, path, payload);
        const parsed = parseA4ViewerLeaseStatus(payload, sessionId);
        if (!parsed) throw new CoordinatorHttpError(502, path, "viewer_lease_status_malformed");
        return parsed;
    }

    async recordSessionActivity(
        sessionId: string,
        leaseId: string,
        leaseToken: string,
    ): Promise<{ ok: boolean; session_id: string; recorded_at: string }> {
        return this.request<{ ok: boolean; session_id: string; recorded_at: string }>(
            `/api/review-sessions/${encodeURIComponent(sessionId)}/activity`,
            {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "X-Viewer-Lease-Token": leaseToken,
                },
                body: JSON.stringify({ lease_id: leaseId }),
            },
        );
    }

    async getSessionIdleStatus(sessionId: string): Promise<{
        session_id: string;
        is_counting_down: boolean;
        remaining_seconds: number;
        last_activity_at: string;
    }> {
        return this.request(
            `/api/review-sessions/${encodeURIComponent(sessionId)}/idle-status`,
        );
    }

    private async request<T>(path: string, init?: RequestInit): Promise<T> {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            headers: { Accept: "application/json", ...(init?.headers || {}) },
            ...init,
        });
        if (!response.ok) {
            throw new Error(`Coordinator request failed: ${response.status} ${path}`);
        }
        return response.json() as Promise<T>;
    }
}

async function readJson(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function isQueuedForInstanceResponse(payload: unknown): payload is QueuedForInstanceResponse {
    if (!payload || typeof payload !== "object") return false;
    const candidate = payload as { status?: unknown; artifact_bindings?: unknown };
    return candidate.status === "queued_for_instance" && Array.isArray(candidate.artifact_bindings);
}

function isCloseReviewSessionResponse(
    payload: unknown,
    sessionId: string,
): payload is CloseReviewSessionResponse {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const candidate = payload as { session_id?: unknown; status?: unknown };
    return candidate.session_id === sessionId && candidate.status === "closed";
}

function coordinatorHttpError(status: number, path: string, payload: unknown): CoordinatorHttpError {
    const errorCode = payload && typeof payload === "object" && !Array.isArray(payload)
        && typeof (payload as { error_code?: unknown }).error_code === "string"
        && /^[a-z0-9_]{1,64}$/.test((payload as { error_code: string }).error_code)
        ? (payload as { error_code: string }).error_code
        : `http_${status}`;
    return new CoordinatorHttpError(status, path, errorCode);
}
