import type { ReviewArtifact } from "./artifacts";
import type { ReviewIssue } from "./issues";

export interface ReviewSession {
    session_id: string;
    project_id: string;
    model_version_id: string;
    created_by: string;
    kit_instance: {
        stream_server: string;
        signaling_port: number;
        media_server: string;
    };
}

export interface ReviewStreamConfig {
    session_id: string;
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
}

export interface ReviewBootstrap {
    model_version_id: string;
    artifacts: ReviewArtifact[];
    issues: ReviewIssue[];
}
