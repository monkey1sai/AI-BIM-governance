export interface ReviewArtifact {
    artifact_id: string;
    artifact_type: string;
    name: string;
    url?: string | null;
    mapping_url?: string | null;
    status: string;
}

export interface ArtifactBinding {
    binding_id: string;
    artifact_group_id: string;
    model_version_id: string;
    artifact_id: string;
    artifact_role: "source" | "derived" | "overlay" | "mapping";
    url: string | null;
    mapping_url: string | null;
    load_order: number;
    routing_policy: "same_instance" | "dedicated_instance" | "shared_state";
    ready_status: "ready" | "missing_model" | "missing_mapping" | "blocked_conversion";
}
