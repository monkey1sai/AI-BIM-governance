import type { ArtifactBinding, ReviewArtifact } from "./artifacts";
import type { ReviewIssue } from "./issues";

/**
 * Additive, read-only pass-through of streaming conversion quality metrics.
 *
 * The viewer MUST NOT compute, cache, or rebroadcast these values. When the coordinator forwards
 * them, the viewer renders them as-is in the conversion summary card. When omitted, the viewer
 * MAY (in dev builds only) fall back to the coordinator dev conversion proxy.
 */
export interface ConversionQualityMetricsSummary {
    fixture_name?: string | null;
    conversion_job_id?: string | null;
    artifact_group_id?: string | null;
    source_ifc_entity_count?: number | null;
    sidecar_carrier_count?: number | null;
    materialization_strategy?: string | null;
    coverage_ratio?: number | null;
    coverage_status?: string | null;
    conversion_duration_seconds?: number | null;
}

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
        mediaPort?: number | null;
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
        mediaPort?: number | null;
    };
    model: {
        status: "ready" | "missing" | "converting" | "failed" | "blocked";
        artifact_id: string | null;
        url: string | null;
        mapping_url: string | null;
        conversion_authority?: string | null;
        conversion_job_id?: string | null;
        conversion_status?: string | null;
        failure_code?: string | null;
        diagnostic?: string | null;
    };
    artifacts: ReviewArtifact[];
    artifact_bindings: ArtifactBinding[];
    kit_instance_bindings: KitInstanceBinding[];
    quality_metrics_summary?: ConversionQualityMetricsSummary | null;
    stage_composition?: {
        applied_policy: "coordinator_load_order";
        primary_artifact_id: string | null;
        secondary_artifact_ids: string[];
        primary: ArtifactBinding | null;
        secondary_layers: ArtifactBinding[];
    };
    viewport_sharing?: {
        mode: string;
        primary_kit_instance_id: string | null;
        shared_state: boolean;
        spectator_ready: boolean;
    };
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
