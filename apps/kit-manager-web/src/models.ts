export interface UsdcArtifact {
  artifact_id: string;
  filename: string;
  relative_path: string;
  runtime_uri: string;
  size_bytes: number;
}

export interface KitInstanceState {
  instance_id: string;
  status: string;
  selected_artifact_ids: string[];
  opened_runtime_uris: string[];
  last_command?: string;
  control_status: string;
}

export interface HealthResponse {
  status: string;
  runtime_mode: string;
  host_local_runtime_allowed: boolean;
  kit_instance_id: string;
  kit_control_url: string;
}

export interface OpenResponse {
  instance: KitInstanceState;
  stage_composition_payload: Record<string, unknown>;
  message: string;
}

export interface CloseResponse {
  instance: KitInstanceState;
  message: string;
}
