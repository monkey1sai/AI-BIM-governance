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

export class CoordinatorClient {
    constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = defaultFetch) {}

    async createReviewSession(input: CreateReviewSessionInput): Promise<ReviewSession> {
        return this.request<ReviewSession>("/api/review-sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...input,
                mode: input.mode || "single_kit_shared_state",
                routing_policy: input.routing_policy || "same_instance",
                artifact_bindings: input.artifact_bindings || [],
                kit_profile: input.kit_profile || {},
                options: { auto_allocate_kit: true },
            }),
        });
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
