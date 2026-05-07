import type { ReviewBootstrap, ReviewSession, ReviewStreamConfig } from "../types/review";
import type { ArtifactBinding } from "../types/artifacts";

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

export class QueuedForInstanceError extends Error {
    constructor(readonly response: QueuedForInstanceResponse) {
        super(response.detail || "No Kit capacity available.");
        this.name = "QueuedForInstanceError";
    }
}

export function isQueuedForInstanceError(error: unknown): error is QueuedForInstanceError {
    return error instanceof QueuedForInstanceError;
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

    async getReviewBootstrap(modelVersionId: string): Promise<ReviewBootstrap> {
        return this.request<ReviewBootstrap>(`/api/model-versions/${modelVersionId}/review-bootstrap`);
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
