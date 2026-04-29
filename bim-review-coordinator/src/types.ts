export type SessionStatus = "active" | "closed";

export interface KitInstance {
  instance_id: string;
  provider: "local_fixed";
  status: "allocated";
  stream_server: string;
  signaling_port: number;
  media_server: string;
}

export interface ReviewParticipant {
  user_id: string;
  display_name?: string;
  joined_at: string;
  last_seen_at: string;
}

export interface ReviewSession {
  session_id: string;
  project_id: string;
  model_version_id: string;
  source_artifact_id?: string;
  usdc_artifact_id?: string;
  status: SessionStatus;
  mode: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  kit_instance: KitInstance;
  participants: ReviewParticipant[];
}

export interface Artifact {
  artifact_id: string;
  artifact_type: string;
  name: string;
  url?: string | null;
  mapping_url?: string | null;
  status: string;
}

export interface ReviewIssue {
  issue_id: string;
  severity: string;
  title: string;
  usd_prim_path?: string | null;
  ifc_guid?: string | null;
}

export interface StreamConfigResponse {
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
  artifacts: Artifact[];
}
