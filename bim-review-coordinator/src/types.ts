export type SessionStatus = "created" | "active" | "closing" | "closed" | "failed";
export type RoutingPolicy = "same_instance" | "dedicated_instance" | "shared_state";

export interface KitInstance {
  instance_id: string;
  provider: "local_fixed";
  status: "allocated" | "starting" | "ready" | "draining" | "released" | "failed";
  stream_server: string;
  signaling_port: number;
  media_server: string;
  media_port?: number | null;
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
  ready_status: "ready" | "missing_model" | "missing_mapping" | "blocked_conversion" | "converting" | "failed";
  conversion_authority?: "bim-streaming-server" | string | null;
  conversion_job_id?: string | null;
  conversion_status?: string | null;
  failure_code?: string | null;
  diagnostic?: string | null;
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
    mediaPort?: number | null;
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

/**
 * Additive, opt-in pass-through of conversion quality metrics surfaced by `_worker`.
 *
 * The coordinator does NOT compute, cache, or modify these values; it only forwards what the
 * orchestrator/caller provides at session creation time. The viewer card consumes this read-only.
 * Keep this strictly additive — never make it required, and never let it gate session creation.
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
  quality_metrics_summary?: ConversionQualityMetricsSummary | null;
}

export interface Artifact {
  artifact_id: string;
  artifact_type: string;
  name: string;
  url?: string | null;
  mapping_url?: string | null;
  status: string;
  conversion_authority?: "bim-streaming-server" | string | null;
  conversion_job_id?: string | null;
  conversion_status?: string | null;
  failure_code?: string | null;
  diagnostic?: string | null;
  quality_metrics_summary?: ConversionQualityMetricsSummary | null;
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
    mediaPort?: number | null;
  };
  model: {
    status: "ready" | "missing" | "converting" | "failed" | "blocked";
    artifact_id: string | null;
    url: string | null;
    mapping_url: string | null;
    conversion_authority?: "bim-streaming-server" | string | null;
    conversion_job_id?: string | null;
    conversion_status?: string | null;
    failure_code?: string | null;
    diagnostic?: string | null;
  };
  artifacts: Artifact[];
  artifact_bindings: ArtifactBinding[];
  kit_instance_bindings: KitInstanceBinding[];
  quality_metrics_summary?: ConversionQualityMetricsSummary | null;
  stage_composition: {
    applied_policy: "coordinator_load_order";
    primary_artifact_id: string | null;
    secondary_artifact_ids: string[];
    primary: ArtifactBinding | null;
    secondary_layers: ArtifactBinding[];
  };
  viewport_sharing: {
    mode: string;
    primary_kit_instance_id: string | null;
    shared_state: boolean;
    spectator_ready: boolean;
  };
}
