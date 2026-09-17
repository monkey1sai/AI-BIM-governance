import type { ReviewSession, ReviewStreamConfig } from "../types/review";
import type { ArtifactBinding } from "../types/artifacts";
import type {
    ClaimViewerLeaseRequest,
    ClaimViewerLeaseResponse,
    HeartbeatViewerLeaseRequest,
    HeartbeatViewerLeaseResponse,
    QueuedForInstanceConflict,
    ReleaseViewerLeaseResponse,
    ReviewSession as ContractReviewSession,
    SessionActivityResponse,
    SessionIdleStatusResponse,
    StageBindingCancellationResponse,
    StageBindingPreauthorizationRequest,
    StageBindingPreauthorizationResponse,
} from "../contract/coordinatorApi";
import {
    parseA4HandoffIntent,
    parseA4ViewerLeaseStatus,
    type A4HandoffIntent,
    type A4ViewerLeaseStatus,
} from "./a4Handoff";
import type { ViewerLeaseTransport } from "./viewerCredentials";

export interface StageBindingArtifact {
    artifact_id: string;
    role: "primary" | "secondary";
    load_order: number;
    usdc_url: string;
}

/** 已驗證的 stage binding 預授權：primary 與每個 secondary 都帶 artifact_id 與 usdc_url。 */
export type StageBindingPreauthorization = Omit<StageBindingPreauthorizationResponse, "stage_composition"> & {
    stage_composition: {
        primary: StageBindingArtifact & { role: "primary" };
        secondary_layers: Array<StageBindingArtifact & { role: "secondary" }>;
    };
};

export interface StageBindingRevisions {
    active: string | null;
    lastGood: string | null;
}

export interface StageBindingCredentials {
    userToken: string;
    leaseToken: string;
}

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

export type QueuedForInstanceResponse = QueuedForInstanceConflict;

export type CloseReviewSessionResponse = Pick<ContractReviewSession, "session_id"> & { status: "closed" };

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
    ): Promise<SessionActivityResponse> {
        return this.request<SessionActivityResponse>(
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

    async getSessionIdleStatus(sessionId: string): Promise<SessionIdleStatusResponse> {
        return this.request(
            `/api/review-sessions/${encodeURIComponent(sessionId)}/idle-status`,
        );
    }

    async claimViewerLease(
        sessionId: string,
        body: ClaimViewerLeaseRequest,
        userToken: string,
    ): Promise<ClaimViewerLeaseResponse> {
        return this.postJson<ClaimViewerLeaseResponse>(
            `/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/claim`,
            body,
            { "X-User-Token": userToken },
        );
    }

    async heartbeatViewerLease(
        sessionId: string,
        leaseId: string,
        leaseToken: string,
        body: HeartbeatViewerLeaseRequest,
    ): Promise<HeartbeatViewerLeaseResponse> {
        return this.postJson<HeartbeatViewerLeaseResponse>(
            `/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/${encodeURIComponent(leaseId)}/heartbeat`,
            body,
            { "X-Viewer-Lease-Token": leaseToken },
        );
    }

    /** keepalive：release 常在文件卸載（pagehide）當下送出，否則請求會隨分頁關閉被取消。 */
    async releaseViewerLease(sessionId: string, leaseId: string, leaseToken: string): Promise<ReleaseViewerLeaseResponse> {
        return this.postJson<ReleaseViewerLeaseResponse>(
            `/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/${encodeURIComponent(leaseId)}/release`,
            {},
            { "X-Viewer-Lease-Token": leaseToken },
            { keepalive: true },
        );
    }

    viewerLeaseTransport(): ViewerLeaseTransport {
        return {
            claim: (sessionId, body, userToken) => this.claimViewerLease(sessionId, body, userToken),
            heartbeat: (sessionId, leaseId, leaseToken, body) => this.heartbeatViewerLease(sessionId, leaseId, leaseToken, body),
            release: (sessionId, leaseId, leaseToken) => this.releaseViewerLease(sessionId, leaseId, leaseToken),
        };
    }

    async preauthorizeStageBinding(
        sessionId: string,
        body: StageBindingPreauthorizationRequest,
        credentials: StageBindingCredentials,
        signal?: AbortSignal,
    ): Promise<StageBindingPreauthorization> {
        const path = `/api/review-sessions/${encodeURIComponent(sessionId)}/stage-binding`;
        const payload = await this.postJson<unknown>(path, body, stageBindingHeaders(credentials), { signal });
        if (!isStageBindingPreauthorization(payload, sessionId)) {
            throw new CoordinatorHttpError(502, path, "stage_binding_preauthorization_malformed");
        }
        return payload;
    }

    async cancelStageBinding(
        sessionId: string,
        body: { source_client_id: string; client_request_id: string },
        credentials: StageBindingCredentials,
        signal?: AbortSignal,
    ): Promise<StageBindingCancellationResponse> {
        return this.postJson<StageBindingCancellationResponse>(
            `/api/review-sessions/${encodeURIComponent(sessionId)}/stage-binding-cancellations`,
            body,
            stageBindingHeaders(credentials),
            { signal },
        );
    }

    /** 目前生效與最後成功的 stage binding revision（無則 null）；只需使用者憑證。 */
    async getStageBindingRevisions(sessionId: string, userToken: string): Promise<StageBindingRevisions> {
        const path = `/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/status`;
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            headers: { Accept: "application/json", "X-User-Token": userToken },
        });
        const payload = await readJson(response);
        if (!response.ok) throw coordinatorHttpError(response.status, path, payload);
        if (!isRecord(payload) || !isRecord(payload.stage_binding)) {
            throw new CoordinatorHttpError(502, path, "viewer_lease_status_malformed");
        }
        const { active_binding_revision: active, last_good_binding_revision: lastGood } = payload.stage_binding;
        return {
            active: nonEmptyString(active) ? active : null,
            lastGood: nonEmptyString(lastGood) ? lastGood : null,
        };
    }

    private async postJson<T>(
        path: string,
        body: unknown,
        headers: Record<string, string>,
        init: Pick<RequestInit, "keepalive" | "signal"> = {},
    ): Promise<T> {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
            body: JSON.stringify(body),
            ...init,
        });
        const payload = await readJson(response);
        if (!response.ok) throw coordinatorHttpError(response.status, path, payload);
        return payload as T;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function stageBindingHeaders(credentials: StageBindingCredentials): Record<string, string> {
    return { "X-User-Token": credentials.userToken, "X-Viewer-Lease-Token": credentials.leaseToken };
}

function isStageArtifact(value: unknown, role: "primary" | "secondary"): boolean {
    return isRecord(value)
        && value.role === role
        && nonEmptyString(value.artifact_id)
        && nonEmptyString(value.usdc_url);
}

function isStageBindingPreauthorization(payload: unknown, sessionId: string): payload is StageBindingPreauthorization {
    if (!isRecord(payload) || !isRecord(payload.stage_composition)) return false;
    const { primary, secondary_layers: secondaryLayers } = payload.stage_composition;
    return payload.status === "pending"
        && payload.session_id === sessionId
        && nonEmptyString(payload.stage_binding_authorization_id)
        && nonEmptyString(payload.binding_revision_id)
        && nonEmptyString(payload.pending_expires_at)
        && isStageArtifact(primary, "primary")
        && Array.isArray(secondaryLayers)
        && secondaryLayers.every((artifact) => isStageArtifact(artifact, "secondary"));
}

function coordinatorHttpError(status: number, path: string, payload: unknown): CoordinatorHttpError {
    const errorCode = payload && typeof payload === "object" && !Array.isArray(payload)
        && typeof (payload as { error_code?: unknown }).error_code === "string"
        && /^[a-z0-9_]{1,64}$/.test((payload as { error_code: string }).error_code)
        ? (payload as { error_code: string }).error_code
        : `http_${status}`;
    return new CoordinatorHttpError(status, path, errorCode);
}
