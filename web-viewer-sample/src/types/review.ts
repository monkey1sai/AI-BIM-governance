import type { ArtifactBinding, ReviewArtifact } from "./artifacts";
import type { ReviewIssue } from "./issues";

export type ReviewLifecycleStatus = "created" | "active" | "closing" | "closed" | "failed" | "blocked_conversion" | "queued_for_instance";

export interface KitInstanceBinding {
    kit_instance_id: string;
    provider: "local_fixed";
    tenant_id: string;
    assigned_artifact_ids: string[];
    status: "allocated" | "starting" | "ready" | "draining" | "released" | "failed";
    stream_config: {
        signalingServer: string;
        signalingPort: number;
        mediaServer: string;
    };
    released_at: string | null;
}

export interface ReviewSession {
    session_id: string;
    review_request_id?: string;
    status: ReviewLifecycleStatus;
    project_id: string;
    model_version_id: string;
    created_by: string;
    kit_instance: {
        stream_server: string;
        signaling_port: number;
        media_server: string;
    };
    artifact_bindings: ArtifactBinding[];
    kit_instance_bindings: KitInstanceBinding[];
}

export interface ReviewStreamConfig {
    session_id: string;
    lifecycle_status: ReviewLifecycleStatus;
    source: "local_fixed";
    webrtc: {
        signalingServer: string;
        signalingPort: number;
        mediaServer: string;
    };
    model: {
        status: "ready" | "missing";
        artifact_id: string | null;
        url: string | null;
        mapping_url: string | null;
    };
    artifacts: ReviewArtifact[];
    artifact_bindings: ArtifactBinding[];
    kit_instance_bindings: KitInstanceBinding[];
}

export interface ReviewBootstrap {
    model_version_id: string;
    artifacts: ReviewArtifact[];
    issues: ReviewIssue[];
}

export interface ReviewSessionRequest {
    review_request_id: string;
    requested_by: string;
    tenant_id: string;
    project_id: string;
    model_version_id: string;
    artifact_group_ids: string[];
    selected_artifact_ids: string[];
    startup_policy: Record<string, unknown>;
    kit_profile: Record<string, unknown>;
    status: ReviewLifecycleStatus;
    blocker?: string | null;
    missing_refs?: string[];
    session_id?: string | null;
    artifact_bindings: ArtifactBinding[];
    kit_instance_bindings: KitInstanceBinding[];
}
