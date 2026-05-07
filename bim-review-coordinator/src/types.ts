export type SessionStatus = "created" | "active" | "closing" | "closed" | "failed";
export type RoutingPolicy = "same_instance" | "dedicated_instance" | "shared_state";

export interface KitInstance {
  instance_id: string;
  provider: "local_fixed";
  status: "allocated" | "starting" | "ready" | "draining" | "released" | "failed";
  stream_server: string;
  signaling_port: number;
  media_server: string;
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
  routing_policy: RoutingPolicy;
  ready_status: "ready" | "missing_model" | "missing_mapping" | "blocked_conversion";
}

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
  started_at: string;
  last_heartbeat_at: string;
  released_at: string | null;
  gpu_profile: {
    profile: string;
    capacity_slot: string;
  };
}

export interface ReviewParticipant {
  user_id: string;
  display_name?: string;
  joined_at: string;
  last_seen_at: string;
}

export interface ReviewSession {
  session_id: string;
  review_request_id?: string;
  tenant_id: string;
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
  artifact_bindings: ArtifactBinding[];
  kit_instance_bindings: KitInstanceBinding[];
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
  lifecycle_status: SessionStatus;
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
  artifact_bindings: ArtifactBinding[];
  kit_instance_bindings: KitInstanceBinding[];
}
