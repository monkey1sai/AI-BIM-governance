import type { Artifact, ReviewIssue } from "../types.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 3000;

function asItems<T>(payload: unknown, alternateKey?: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as T[];
    if (alternateKey && Array.isArray(record[alternateKey])) return record[alternateKey] as T[];
  }
  return [];
}

export class BimControlClient {
  private readonly requestTimeoutMs: number;

  constructor(private readonly baseUrl: string, requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) {
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async getArtifacts(modelVersionId: string): Promise<Artifact[]> {
    const payload = await this.getJson(`/api/model-versions/${modelVersionId}/artifacts`);
    return asItems<Artifact>(payload, "artifacts");
  }

  async getReviewIssues(modelVersionId: string): Promise<ReviewIssue[]> {
    const payload = await this.getJson(`/api/model-versions/${modelVersionId}/review-issues`);
    return asItems<ReviewIssue>(payload);
  }

  async createAnnotation(sessionId: string, payload: unknown): Promise<unknown> {
    this.ensureConfigured();
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/review-sessions/${sessionId}/annotations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      throw new Error(`external control-plane annotation save failed: ${response.status}`);
    }
    return response.json();
  }

  private async getJson(path: string): Promise<unknown> {
    this.ensureConfigured();
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`external control-plane returned ${response.status} for ${path}`);
    }
    return response.json();
  }

  private async fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    // The external control-plane may be unavailable in local B-scheme runs. Without an explicit
    // timeout, a hung connection (firewalled host, SYN drop, etc.) would
    // tie up an entire request and make tests / live endpoints flaky.
    return fetch(url, { ...init, signal: AbortSignal.timeout(this.requestTimeoutMs) });
  }

  private ensureConfigured(): void {
    if (this.baseUrl.trim().length === 0) {
      throw new Error("BIM_CONTROL_API_BASE is not configured; company cloud control-plane is external in B-scheme.");
    }
  }
}
