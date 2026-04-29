export interface ReviewArtifact {
    artifact_id: string;
    artifact_type: string;
    name: string;
    url?: string | null;
    mapping_url?: string | null;
    status: string;
}
