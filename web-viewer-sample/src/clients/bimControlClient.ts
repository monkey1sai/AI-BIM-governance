import type { ReviewArtifact } from "../types/artifacts";
import type { ReviewIssue } from "../types/issues";
import type { ReviewSessionRequest } from "../types/review";

function readItems<T>(payload: unknown, alternateKey?: string): T[] {
    if (Array.isArray(payload)) return payload as T[];
    if (typeof payload === "object" && payload !== null) {
        const record = payload as Record<string, unknown>;
        if (Array.isArray(record.items)) return record.items as T[];
        if (alternateKey && Array.isArray(record[alternateKey])) return record[alternateKey] as T[];
    }
    return [];
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export class BimControlClient {
    constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = defaultFetch) {}

    async getArtifacts(modelVersionId: string): Promise<ReviewArtifact[]> {
        const response = await this.request(`/api/model-versions/${modelVersionId}/artifacts`);
        return readItems<ReviewArtifact>(response, "artifacts");
    }

    async getReviewIssues(modelVersionId: string): Promise<ReviewIssue[]> {
        const response = await this.request(`/api/model-versions/${modelVersionId}/review-issues`);
        return readItems<ReviewIssue>(response);
    }

    async getReviewSessionRequest(reviewRequestId: string): Promise<ReviewSessionRequest> {
        return this.request<ReviewSessionRequest>(`/api/review-session-requests/${reviewRequestId}`);
    }

    async patchReviewSessionRequest(reviewRequestId: string, payload: Record<string, unknown>): Promise<ReviewSessionRequest> {
        return this.request<ReviewSessionRequest>(`/api/review-session-requests/${reviewRequestId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    }

    private async request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            headers: { Accept: "application/json", ...(init?.headers || {}) },
            ...init,
        });
        if (!response.ok) {
            throw new Error(`_bim-control request failed: ${response.status} ${path}`);
        }
        return response.json() as Promise<T>;
    }
}
