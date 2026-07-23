import { buildFocusPrimRequest, buildHighlightPrimsRequest } from "./streamMessages";
import type { ReviewSession, ReviewStreamConfig } from "../types/review";
import type { StreamMessage } from "../types/streamMessages";

export const A4_HANDOFF_ID_PATTERN = /^a4h_[A-Za-z0-9_-]{16,96}$/;
export const A4_HANDOFF_COMMAND_TIMEOUT_MS = 10_000;

const USD_PRIM_PATTERN = /^\/[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*$/;

export type A4HandoffAction = "focus" | "highlight";

export interface A4HandoffIntent {
    handoff_id: string;
    action: A4HandoffAction;
    expires_at: string;
    prim_paths: string[];
    binding: {
        review_session_id: string;
        model_version_id: string;
        primary_artifact_id: string;
        active_binding_revision: string;
    };
}

export interface A4ViewerLeaseStatus {
    session_id: string;
    auth_scope: "bound" | "local_dev_lab";
    primary: {
        available: boolean;
        owned_by_caller: boolean;
    };
    leases: Array<{
        lease_id: string;
        role: "primary" | "spectator";
        status: "active" | "released" | "expired";
        expires_at: string;
    }>;
    stage_binding: {
        active_binding_revision: string | null;
    };
}

export interface A4LocalAuthoritySnapshot {
    session_id: string | null;
    model_version_id: string | null;
    primary_artifact_id: string | null;
    active_binding_revision: string | null;
    lifecycle_status: string | null;
    stage_status: "unproven" | "pending" | "matched" | "mismatch" | "disconnected";
    stage_matches_expected: boolean;
    datachannel_ready: boolean;
    spectator: boolean;
}

export interface A4ServerAuthoritySnapshot {
    session: ReviewSession;
    stream_config: ReviewStreamConfig;
    lease_status: A4ViewerLeaseStatus;
}

export type A4GateResult =
    | { kind: "ready" }
    | { kind: "wait"; code: string }
    | { kind: "reject"; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength = 256): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

export function normalizeA4HandoffId(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.trim();
    return A4_HANDOFF_ID_PATTERN.test(normalized) ? normalized : null;
}

export function parseA4HandoffIntent(value: unknown, expectedHandoffId: string): A4HandoffIntent | null {
    if (!isRecord(value) || value.handoff_id !== expectedHandoffId || !A4_HANDOFF_ID_PATTERN.test(expectedHandoffId)) {
        return null;
    }
    if (value.action !== "focus" && value.action !== "highlight") return null;
    if (!boundedString(value.expires_at, 64) || !Number.isFinite(Date.parse(value.expires_at))) return null;
    if (!Array.isArray(value.prim_paths)) return null;
    const primPaths = value.prim_paths;
    const expectedCount = value.action === "focus" ? 1 : primPaths.length;
    if (
        primPaths.length !== expectedCount
        || primPaths.length < 1
        || primPaths.length > 64
        || !primPaths.every((item): item is string => typeof item === "string" && USD_PRIM_PATTERN.test(item))
        || new Set(primPaths).size !== primPaths.length
    ) return null;
    if (!isRecord(value.binding)) return null;
    const binding = value.binding;
    if (
        !boundedString(binding.review_session_id)
        || !boundedString(binding.model_version_id)
        || !boundedString(binding.primary_artifact_id)
        || !boundedString(binding.active_binding_revision)
    ) return null;
    return {
        handoff_id: expectedHandoffId,
        action: value.action,
        expires_at: value.expires_at,
        prim_paths: [...primPaths],
        binding: {
            review_session_id: binding.review_session_id,
            model_version_id: binding.model_version_id,
            primary_artifact_id: binding.primary_artifact_id,
            active_binding_revision: binding.active_binding_revision,
        },
    };
}

export function parseA4ViewerLeaseStatus(value: unknown, expectedSessionId: string): A4ViewerLeaseStatus | null {
    if (!isRecord(value) || value.session_id !== expectedSessionId) return null;
    if (value.auth_scope !== "bound" && value.auth_scope !== "local_dev_lab") return null;
    if (!isRecord(value.primary) || typeof value.primary.available !== "boolean" || typeof value.primary.owned_by_caller !== "boolean") {
        return null;
    }
    if (!Array.isArray(value.leases) || !isRecord(value.stage_binding)) return null;
    const leases: A4ViewerLeaseStatus["leases"] = [];
    for (const lease of value.leases) {
        if (
            !isRecord(lease)
            || !boundedString(lease.lease_id)
            || (lease.role !== "primary" && lease.role !== "spectator")
            || (lease.status !== "active" && lease.status !== "released" && lease.status !== "expired")
            || !boundedString(lease.expires_at, 64)
            || !Number.isFinite(Date.parse(lease.expires_at))
        ) return null;
        leases.push({
            lease_id: lease.lease_id,
            role: lease.role,
            status: lease.status,
            expires_at: lease.expires_at,
        });
    }
    const activeBindingRevision = value.stage_binding.active_binding_revision;
    if (activeBindingRevision !== null && !boundedString(activeBindingRevision)) return null;
    return {
        session_id: expectedSessionId,
        auth_scope: value.auth_scope,
        primary: {
            available: value.primary.available,
            owned_by_caller: value.primary.owned_by_caller,
        },
        leases,
        stage_binding: { active_binding_revision: activeBindingRevision },
    };
}

export function evaluateA4LocalAuthority(
    intent: A4HandoffIntent,
    snapshot: A4LocalAuthoritySnapshot,
    nowMs = Date.now(),
): A4GateResult {
    if (Date.parse(intent.expires_at) <= nowMs) return { kind: "reject", code: "a4_handoff_expired" };
    if (snapshot.spectator) return { kind: "reject", code: "spectator_readonly" };
    if (snapshot.lifecycle_status !== "active" && snapshot.lifecycle_status !== "created") {
        return { kind: "reject", code: "session_lifecycle_blocked" };
    }
    if (!snapshot.session_id || !snapshot.model_version_id || !snapshot.primary_artifact_id) {
        return { kind: "wait", code: "session_binding_pending" };
    }
    if (snapshot.session_id !== intent.binding.review_session_id) return { kind: "reject", code: "session_changed" };
    if (snapshot.model_version_id !== intent.binding.model_version_id) return { kind: "reject", code: "model_changed" };
    if (snapshot.primary_artifact_id !== intent.binding.primary_artifact_id) return { kind: "reject", code: "artifact_changed" };
    if (!snapshot.active_binding_revision) return { kind: "wait", code: "binding_revision_pending" };
    if (snapshot.active_binding_revision !== intent.binding.active_binding_revision) {
        return { kind: "reject", code: "binding_revision_changed" };
    }
    if (snapshot.stage_status === "mismatch" || snapshot.stage_status === "disconnected") {
        return { kind: "reject", code: "loaded_stage_invalid" };
    }
    if (snapshot.stage_status !== "matched" || !snapshot.stage_matches_expected) {
        return { kind: "wait", code: "loaded_stage_pending" };
    }
    if (!snapshot.datachannel_ready) return { kind: "wait", code: "datachannel_pending" };
    return { kind: "ready" };
}

function primaryArtifactId(streamConfig: ReviewStreamConfig): string | null {
    return streamConfig.stage_composition?.primary_artifact_id || streamConfig.model.artifact_id || null;
}

function expectedStageUrl(streamConfig: ReviewStreamConfig): string | null {
    return streamConfig.stage_composition?.primary?.url || streamConfig.model.url || null;
}

export function a4ServerAuthorityBlockReason(
    intent: A4HandoffIntent,
    snapshot: A4ServerAuthoritySnapshot,
    expectedLeaseId: string,
    expectedLoadedStageUrl: string,
    nowMs = Date.now(),
): string | null {
    if (
        snapshot.session.session_id !== intent.binding.review_session_id
        || snapshot.stream_config.session_id !== intent.binding.review_session_id
        || snapshot.lease_status.session_id !== intent.binding.review_session_id
    ) return "session_changed";
    if (snapshot.session.status !== "active" && snapshot.session.status !== "created") return "session_lifecycle_blocked";
    if (snapshot.stream_config.lifecycle_status !== "active" && snapshot.stream_config.lifecycle_status !== "created") {
        return "session_lifecycle_blocked";
    }
    if (snapshot.session.model_version_id !== intent.binding.model_version_id) return "model_changed";
    if (primaryArtifactId(snapshot.stream_config) !== intent.binding.primary_artifact_id) return "artifact_changed";
    if (expectedStageUrl(snapshot.stream_config) !== expectedLoadedStageUrl) return "loaded_stage_changed";
    if (snapshot.lease_status.auth_scope !== "bound") return "a4_authentic_lease_unavailable";
    if (!snapshot.lease_status.primary.owned_by_caller) return "primary_lease_changed";
    const lease = snapshot.lease_status.leases.find((candidate) => candidate.lease_id === expectedLeaseId);
    if (!lease || lease.role !== "primary" || lease.status !== "active" || Date.parse(lease.expires_at) <= nowMs) {
        return "primary_lease_changed";
    }
    if (snapshot.lease_status.stage_binding.active_binding_revision !== intent.binding.active_binding_revision) {
        return "binding_revision_changed";
    }
    return null;
}

export function buildA4HandoffCommand(
    intent: A4HandoffIntent,
    requestId: string,
    retryOfRequestId?: string,
): StreamMessage {
    const base = intent.action === "focus"
        ? buildFocusPrimRequest(intent.prim_paths[0], requestId)
        : buildHighlightPrimsRequest(intent.prim_paths.map((prim_path) => ({ prim_path })), true, requestId);
    const payload = isRecord(base.payload) ? base.payload : {};
    return {
        ...base,
        payload: {
            ...payload,
            ...(retryOfRequestId ? { retry_of_request_id: retryOfRequestId } : {}),
        },
    };
}
