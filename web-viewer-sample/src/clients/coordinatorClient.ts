import type { ReviewBootstrap, ReviewSession, ReviewStreamConfig } from "../types/review";

export interface CreateReviewSessionInput {
    project_id: string;
    model_version_id: string;
    created_by: string;
    mode?: string;
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
                options: { auto_allocate_kit: true },
            }),
        });
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
